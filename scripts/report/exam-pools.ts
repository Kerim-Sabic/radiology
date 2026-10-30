// How many questions and patients each certification exam can draw on, from the installed commercial catalogue.
//   npx tsx scripts/report/exam-pools.ts
import { existsSync, readFileSync } from 'node:fs';
import { buildExam, examAvailable, examPool } from '../../src/services/exam';
import { CERT_AREAS, examRule, type CertLevel } from '../../shared/certificateLevels';

const root = 'public/packs/';
const index = JSON.parse(readFileSync(`${root}index.json`, 'utf8')) as { packs: Array<{ manifest: string; lessons: string | null }> };
const cases = new Map<string, { id: string; subjectKey: string; region: string[]; difficulty: string }>();
const tasksByCase = new Map<string, unknown[]>();
const targets = new Map<string, unknown>();
const groups = new Map<string, string>();
for (const e of index.packs) {
  const m = JSON.parse(readFileSync(root + e.manifest, 'utf8'));
  const nonCommercial = new Set(m.sources.filter((s: { license: string; licenseUrl?: string }) => /non.?commercial|by-nc/i.test(`${s.license} ${s.licenseUrl}`)).map((s: { id: string }) => s.id));
  const excluded = new Set(m.subjects.filter((s: { sourceId: string }) => nonCommercial.has(s.sourceId)).map((s: { key: string }) => s.key));
  for (const s of m.subjects) groups.set(s.key, s.holdoutGroup);
  for (const t of m.referenceTargets) targets.set(t.id, t);
  const file = root + (e.lessons ?? e.manifest.replace(/pack\.json$/, 'lessons.json'));
  if (!existsSync(file)) continue;
  const lessons = JSON.parse(readFileSync(file, 'utf8'));
  for (const c of lessons.cases) if (!excluded.has(c.subjectKey)) cases.set(c.id, c);
  for (const t of lessons.tasks) tasksByCase.set(t.caseId, [...(tasksByCase.get(t.caseId) ?? []), t]);
}
const catalog = { cases, tasksByCase, targets, holdoutGroup: (id: string) => groups.get(cases.get(id)?.subjectKey ?? '') ?? id } as never;
for (const area of CERT_AREAS) {
  const pool = examPool(catalog, area);
  const levels = ([1, 2, 3] as CertLevel[]).map((l) => `L${l} ${examAvailable(catalog, area, l) ? `${buildExam(catalog, [], { area, level: l }).items.length}/${examRule(area, l).questions}` : 'not enough'}`);
  console.log(`${area.padEnd(8)} ${String(pool.length).padStart(4)} questions on ${String(new Set(pool.map((q) => q.group)).size).padStart(3)} patients · ${levels.join(' · ')}`);
}
