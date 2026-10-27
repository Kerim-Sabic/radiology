/**
 * Catalogue validation over the REAL installed content (public/packs, public/content).
 * Packs whose binaries are not fetched are skipped, but every manifest/lesson present is checked.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LessonFile, PackIndex, PackManifest, TargetGeometry, type PackManifest as TPack, type LessonFile as TLessons } from '../src/schema/content';
import { CurriculumFile, PageMap } from '../src/services/curriculum';
import { gradeTask } from '../src/grading/spatialGrader';

const ROOT = join(__dirname, '..');
const PACKS = join(ROOT, 'public', 'packs');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const index = PackIndex.parse(read(join(PACKS, 'index.json')));
const packDirs = readdirSync(PACKS, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'pack.json')));
const packs = new Map<string, TPack>();
const lessons = new Map<string, TLessons>();
for (const d of packDirs) {
  packs.set(d.name, PackManifest.parse(read(join(PACKS, d.name, 'pack.json'))));
  if (existsSync(join(PACKS, d.name, 'lessons.json'))) lessons.set(d.name, LessonFile.parse(read(join(PACKS, d.name, 'lessons.json'))));
}
const allSeries = new Map([...packs.values()].flatMap((p) => p.series.map((s) => [s.uid, s] as const)));
const allTargets = new Map([...packs.values()].flatMap((p) => p.referenceTargets.map((t) => [t.id, { t, pack: p }] as const)));
const allStudies = new Map([...packs.values()].flatMap((p) => p.studies.map((s) => [s.uid, s] as const)));
const allCases = new Map([...lessons.values()].flatMap((l) => l.cases.map((c) => [c.id, c] as const)));
const pageMapPath = join(ROOT, 'public', 'content', 'book', 'page-map.v1.json');
const pageMap = existsSync(pageMapPath) ? PageMap.parse(read(pageMapPath)) : null;
const curPath = join(ROOT, 'public', 'content', 'curriculum.v1.json');
const curriculum = existsSync(curPath) ? CurriculumFile.parse(read(curPath)) : null;
const objectiveIds = new Set(curriculum?.units.flatMap((u) => u.objectives.map((o) => o.id)) ?? []);

describe('pack index', () => {
  it('lists only packs that exist on disk', () => {
    for (const e of index.packs) expect(existsSync(join(PACKS, e.manifest)), e.manifest).toBe(true);
  });
});

describe.each([...packs.entries()])('pack %s', (id, pack) => {
  it('has namespaced, collision-free subject keys and consistent ownership', () => {
    for (const s of pack.subjects) expect(s.key.startsWith(`${s.sourceId}:`)).toBe(true);
    for (const st of pack.studies) expect(pack.subjects.some((s) => s.key === st.subjectKey) || pack.subjects.length === 0).toBe(true);
    for (const se of pack.series) expect(pack.studies.find((st) => st.uid === se.studyUid)?.subjectKey ?? se.subjectKey).toBe(se.subjectKey);
  });
  it('never marks MR or radiograph pixels as Hounsfield units', () => {
    for (const s of pack.series) if (s.modality !== 'CT') expect(s.geometry.hu, s.uid).toBe(false);
  });
  it('labels scouts and keeps them out of diagnostic radiograph roles', () => {
    for (const s of pack.series) if (/locator|scout|topogram/i.test(s.description)) expect(s.role).toBe('scout');
  });
  it('has valid target geometry files that reference real SOP instances', () => {
    const sopsOf = new Map<string, Set<string>>();
    const problems: string[] = [];
    for (const t of pack.referenceTargets) {
      const series = allSeries.get(t.seriesUid);
      if (!series) {
        problems.push(`${t.id}: series not installed`);
        continue;
      }
      const g = TargetGeometry.parse(read(join(PACKS, id, t.geometryFile)));
      if (!sopsOf.has(series.uid)) sopsOf.set(series.uid, new Set(series.instances.map((i) => i.sopInstanceUid)));
      const sops = sopsOf.get(series.uid)!;
      const refs = g.geometryType === 'contour_set' ? g.planes.map((p) => p.sopInstanceUid) : g.geometryType === 'box' ? g.boxes.map((b) => b.sopInstanceUid) : g.geometryType === 'point' ? [g.sopInstanceUid] : g.sopInstanceUids;
      for (const r of refs) if (!sops.has(r)) problems.push(`${t.id} → ${r}`);
      if (t.provenance === 'human_reviewed' && t.review.status !== 'reviewed_by_user') problems.push(`${t.id}: human_reviewed without a review`);
    }
    expect(problems.slice(0, 20)).toEqual([]);
  }, 60_000);
});

describe.each([...lessons.entries()])('lessons %s', (_id, file) => {
  it('references real series/targets of the same subject only', () => {
    for (const c of file.cases) {
      for (const st of c.studyUids) expect(allStudies.get(st)?.subjectKey, `${c.id} study ${st}`).toBe(c.subjectKey);
      expect(allSeries.get(c.primarySeriesUid)?.subjectKey).toBe(c.subjectKey);
    }
    for (const t of file.tasks) {
      const kase = allCases.get(t.caseId)!;
      expect(kase, t.id).toBeTruthy();
      for (const s of [...t.seriesUids, t.start.seriesUid]) expect(allSeries.get(s)?.subjectKey, `${t.id} ${s}`).toBe(kase.subjectKey);
      for (const tt of t.targets) {
        const tgt = allTargets.get(tt.targetId);
        expect(tgt, `${t.id} → ${tt.targetId}`).toBeTruthy();
        expect(t.seriesUids).toContain(tgt!.t.seriesUid);
      }
    }
  });
  it('never scores authoritatively against AI drafts or automated labels (grader demotes them)', () => {
    for (const t of file.tasks.filter((x) => x.scoring === 'authoritative' && x.targets.length)) {
      const provs = t.targets.map((tt) => allTargets.get(tt.targetId)!.t.provenance);
      const result = gradeTask({ task: t, targets: new Map(t.targets.map((tt) => [tt.targetId, { ref: allTargets.get(tt.targetId)!.t, geom: { geometryType: 'image_label', sopInstanceUids: [], labels: [] } }])), series: new Map(), marks: [] });
      expect(result.authoritative, t.id).toBe(provs.every((p) => p === 'source_manual'));
    }
  });
  it('keeps neutral titles and assess prompts free of target names', () => {
    for (const c of file.cases) {
      const names = [...lessons.values()].flatMap((l) => l.tasks).filter((t) => t.caseId === c.id).flatMap((t) => t.targets.map((x) => x.name.toLowerCase()));
      for (const n of names) expect(c.neutralTitle.toLowerCase().includes(n), `${c.id} title leaks "${n}"`).toBe(false);
      expect(/nodule|hemorrhage|fracture|tumou?r|pneumonia|embol|cancer|covid/i.test(c.neutralTitle), c.neutralTitle).toBe(false);
    }
    for (const t of file.tasks.filter((x) => x.type === 'whole_study' && x.modes.includes('assess'))) {
      expect(/\b(one|two|three|\d+) (nodule|finding|lesion)s?\b/i.test(t.prompt), `${t.id} reveals a count`).toBe(false);
    }
  });
  it('cites book pages that exist in the verified page map with the right printed label', () => {
    if (!pageMap) return;
    const label = new Map(pageMap.pages.map((p) => [p.physical, p.printed]));
    const anchors = [...file.cases.flatMap((c) => c.bookAnchors), ...file.tasks.flatMap((t) => t.bookAnchors)];
    for (const a of anchors) {
      expect(label.has(a.physical), `PDF ${a.physical}`).toBe(true);
      if (a.printed !== null) expect(label.get(a.physical), `PDF ${a.physical}`).toBe(a.printed);
    }
  });
  it('links only to objectives that exist in the curriculum', () => {
    if (!curriculum) return;
    for (const id of [...file.cases.flatMap((c) => c.objectiveIds), ...file.tasks.flatMap((t) => t.objectiveIds)]) expect(objectiveIds.has(id), id).toBe(true);
  });
});

describe('book page map', () => {
  it('has the verified anchors (five-vessel level and inserted electronic pages)', () => {
    if (!pageMap) return;
    const label = new Map(pageMap.pages.map((p) => [p.physical, p.printed]));
    expect(pageMap.pages).toHaveLength(552);
    expect(label.get(39)).toBe('24');
    expect(label.get(40)).toBe('25');
    expect(label.get(17)).toBe('2.e1');
    expect(label.get(95)).toBe('79.e1');
    expect(label.get(99)).toBe('79.e5');
    expect(label.get(469)).toBe('e50');
    expect(label.get(532)).toBe('400');
    expect(pageMap.document.sha256).toBe('0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1');
  });
  it('covers 29 chapters and 8 appendices in the curriculum', () => {
    if (!curriculum) return;
    expect(curriculum.units.filter((u) => u.kind === 'chapter')).toHaveLength(29);
    expect(curriculum.units.filter((u) => u.kind === 'appendix')).toHaveLength(8);
  });
});
