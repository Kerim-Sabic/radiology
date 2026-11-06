/**
 * brain-mra (aneurysms and the Circle of Willis on TOF MR angiography): every graded answer is re-derived here from the
 * expert annotation stored with the reference targets in pack.json, independently of scripts/lessons/brain_mra.py.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LessonFile, PackManifest, type Task } from '../src/schema/content';

const DIR = join(__dirname, '..', 'public', 'packs', 'brain-mra');
const installed = existsSync(join(DIR, 'lessons.json'));
const correct = (t: Task | undefined) => (t && t.grading.kind === 'choice' ? t.grading.options.filter((o) => o.correct).map((o) => o.id) : []);

describe.skipIf(!installed)('brain-mra pack', () => {
  const pack = PackManifest.parse(JSON.parse(readFileSync(join(DIR, 'pack.json'), 'utf-8')));
  const lessons = LessonFile.parse(JSON.parse(readFileSync(join(DIR, 'lessons.json'), 'utf-8')));
  const targetsOf = (seriesUid: string) => pack.referenceTargets.filter((t) => t.seriesUid === seriesUid);
  const task = (caseId: string, s: string) => lessons.tasks.find((t) => t.id === `${caseId}:${s}`);

  it('keeps dataset names, diagnoses and variants out of everything the reading room shows', () => {
    const banned = /Lausanne|OpenNeuro|TopCoW|IXI|aneurysm|variant|fetal|stroke|tumou?r/i;
    const texts = [...pack.studies.map((s) => s.description), ...pack.series.flatMap((s) => [s.description, s.roleNote, s.displayNote ?? ''])];
    for (const text of texts) expect(text).not.toMatch(banned);
    for (const c of lessons.cases) {
      expect(c.neutralTitle).toMatch(/^Patient [A-Z]{2,3} · MR angiography, head$/);
      expect(`${c.clinicalContext}`).not.toMatch(banned);
    }
    // The question may name what to look for (as "Mark any fracture you find" does); it never says where or how many.
    for (const t of lessons.tasks.filter((x) => x.modes.includes('assess'))) {
      expect(t.prompt).not.toMatch(/Lausanne|OpenNeuro|TopCoW|IXI|variant|fetal/i);
      expect(t.prompt).not.toMatch(/\b(left|right|anterior communicating|basilar|carotid|middle cerebral|two|three)\b/i);
    }
  });

  it('grades every aneurysm patient on exactly the radiologist outlines of that patient', () => {
    const patients = lessons.cases.filter((c) => c.id.startsWith('mra-aneurysm-'));
    expect(patients.length).toBe(13);
    for (const c of patients) {
      const outlines = targetsOf(c.primarySeriesUid).filter((t) => t.classId === 'finding:intracranial_aneurysm');
      expect(outlines.length, c.id).toBeGreaterThan(0);
      expect(outlines.every((t) => t.provenance === 'source_manual')).toBe(true);
      const loc = task(c.id, 'locate')!;
      expect(loc.grading.kind).toBe('findings');
      expect(loc.scoring).toBe('authoritative');
      expect(loc.targets.map((t) => t.targetId).sort()).toEqual(outlines.map((t) => t.id).sort());
      expect(loc.targets.some((t) => t.required)).toBe(true);
      if (outlines.length > 1) expect(correct(task(c.id, 'count'))).toEqual([String(Math.min(outlines.length, 3))]);
      else expect(task(c.id, 'count')).toBeUndefined();
    }
  });

  it('asks the size band only from the outline diameter, never near a cut-off', () => {
    for (const t of lessons.tasks.filter((x) => x.id.endsWith(':size'))) {
      const mm = Number(/outline is ([\d.]+) mm across/.exec(t.explanation)![1]);
      const band = mm < 5 ? 'small' : mm <= 10 ? 'medium' : 'large';
      expect(Math.min(Math.abs(mm - 5), Math.abs(mm - 10))).toBeGreaterThanOrEqual(1);
      expect(correct(t), t.id).toEqual([band]);
      expect(t.modes).not.toContain('assess');
    }
  });

  it('labels the Circle of Willis on the controls with expert targets only, outside Assess', () => {
    const controls = lessons.cases.filter((c) => c.id.startsWith('mra-cow-'));
    expect(controls.length).toBe(6);
    for (const c of controls) {
      const arteries = task(c.id, 'arteries')!;
      expect(arteries.grading.kind).toBe('labelled_points');
      expect(arteries.modes).not.toContain('assess');
      const ids = new Set(targetsOf(c.primarySeriesUid).map((t) => t.id));
      for (const t of arteries.targets) {
        expect(ids.has(t.targetId), t.targetId).toBe(true);
        expect(pack.referenceTargets.find((x) => x.id === t.targetId)!.provenance).toBe('source_manual');
      }
      expect(arteries.targets.filter((t) => t.required).length).toBe(9);
    }
  });

  it('answers each variant question from the expert record of which segments are seen', () => {
    for (const c of lessons.cases.filter((x) => x.id.startsWith('mra-cow-'))) {
      const note = targetsOf(c.primarySeriesUid)[0].provenanceDetail.note ?? '';
      const e = Object.fromEntries([...note.matchAll(/([LR]-A1|Acom|3rd-A2|[LR]-Pcom|[LR]-P1) (\d)/g)].map((m) => [m[1], Number(m[2])]));
      const v = task(c.id, 'variant');
      if (!v) continue;
      const ans = correct(v)[0];
      if (ans === 'fetal') {
        const side = /right/.test(v.title) ? 'R' : 'L';
        expect(e[`${side}-P1`]).toBe(0);
        expect(e[`${side}-Pcom`]).toBe(1);
      } else if (ans === 'no') expect(e.Acom).toBe(0);
      else if (ans === 'noleft') expect([e['L-A1'], e['R-A1'], e.Acom]).toEqual([0, 1, 1]);
      else if (ans === 'complete') for (const k of ['L-A1', 'R-A1', 'Acom', 'L-Pcom', 'R-Pcom', 'L-P1', 'R-P1']) expect(e[k], `${c.id} ${k}`).toBe(1);
      else throw new Error(`unexpected answer ${ans} in ${v.id}`);
    }
  });
});
