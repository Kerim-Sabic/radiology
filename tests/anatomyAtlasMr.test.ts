/**
 * anatomy-atlas-mr: the MRI anatomy layer is honest about what it is (unreviewed AI drafts credited to Horalix, in the atlas
 * layer only, never graded), names no third-party tool in anything the app shows, and points at real series and images.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LessonFile, PackManifest, TargetGeometry } from '../src/schema/content';

const PACKS = join(__dirname, '..', 'public', 'packs');
const DIR = join(PACKS, 'anatomy-atlas-mr');
const installed = existsSync(join(DIR, 'pack.json'));

describe.skipIf(!installed)('anatomy-atlas-mr', () => {
  const pack = PackManifest.parse(JSON.parse(readFileSync(join(DIR, 'pack.json'), 'utf-8')));
  const series = new Map<string, { sops: Set<string>; rows: number; cols: number; modality: string }>();
  for (const d of readdirSync(PACKS)) {
    const f = join(PACKS, d, 'pack.json');
    if (!existsSync(f) || d === 'anatomy-atlas-mr') continue;
    const m = JSON.parse(readFileSync(f, 'utf-8'));
    for (const s of m.series)
      series.set(s.uid, { sops: new Set(s.instances.map((i: { sopInstanceUid: string }) => i.sopInstanceUid)), rows: s.geometry.rows, cols: s.geometry.columns, modality: s.modality });
  }

  it('holds only unreviewed AI drafts in the atlas layer, credited to Horalix', () => {
    expect(pack.referenceTargets.length).toBeGreaterThan(100);
    for (const t of pack.referenceTargets) {
      expect(t.provenance).toBe('ai_draft');
      expect(t.review.status).toBe('unreviewed');
      expect(t.completeness).toBe('target_only');
      expect(t.layer).toBe('atlas');
      expect(t.provenanceDetail.source).toBe('Horalix');
      expect(t.provenanceDetail.method).toBe('AI — automatic segmentation, not reviewed by a radiologist');
      expect(t.classId).toMatch(/^anatomy:/);
      expect(t.category).toBeTruthy();
    }
  });

  it('never names the tools behind the outlines in labels, methods or notes', () => {
    const tools = /TopCoW|CLAIM|GOUHFI|TotalSeg|nnU-?Net|SynthSeg|FreeSurfer|Charit|YOLO/i;
    for (const t of pack.referenceTargets) for (const text of [t.label, t.provenanceDetail.method, t.provenanceDetail.note ?? '', t.unassessedNote]) expect(text, t.id).not.toMatch(tools);
  });

  it('draws every outline on an MR series of the image packs, inside its images', () => {
    // Collected first and asserted once: thousands of outlines with an expect per point take minutes.
    const bad: string[] = [];
    for (const t of pack.referenceTargets) {
      const s = series.get(t.seriesUid);
      if (!s || s.modality !== 'MR') {
        bad.push(`${t.id}: not on an MR series of the image packs`);
        continue;
      }
      const g = TargetGeometry.parse(JSON.parse(readFileSync(join(DIR, t.geometryFile), 'utf-8')));
      if (g.geometryType !== 'contour_set' || g.space !== 'image_px') {
        bad.push(`${t.id}: not an image_px contour set`);
        continue;
      }
      for (const p of g.planes) {
        if (!s.sops.has(p.sopInstanceUid)) bad.push(`${t.id}: unknown SOP ${p.sopInstanceUid}`);
        for (const ring of p.polygons)
          for (const [c, r] of ring as number[][]) if (!(c >= -0.5 && c <= s.cols - 0.5 && r >= -0.5 && r <= s.rows - 0.5)) bad.push(`${t.id}: point ${c},${r} off the image`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 120_000);

  it('adds no AI outline where expert outlines of the same arteries are shown, and no task grades on it', () => {
    const expert = new Set<string>();
    for (const d of readdirSync(PACKS)) {
      const f = join(PACKS, d, 'pack.json');
      if (!existsSync(f) || d === 'anatomy-atlas-mr') continue;
      for (const t of JSON.parse(readFileSync(f, 'utf-8')).referenceTargets) if (t.provenance === 'source_manual' && /artery/.test(t.classId)) expert.add(t.seriesUid);
    }
    for (const t of pack.referenceTargets) if (/artery/.test(t.classId)) expect(expert.has(t.seriesUid), t.id).toBe(false);
    const ids = new Set(pack.referenceTargets.map((t) => t.id));
    for (const d of readdirSync(PACKS)) {
      const f = join(PACKS, d, 'lessons.json');
      if (!existsSync(f)) continue;
      for (const task of LessonFile.parse(JSON.parse(readFileSync(f, 'utf-8'))).tasks) for (const tt of task.targets) expect(ids.has(tt.targetId), task.id).toBe(false);
    }
  });
});
