import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDING_FACTS } from '../src/auth/landingFacts';
import { CONDITIONS } from '../src/content/conditions';
import { filterCommercial } from '../scripts/build/commercialContent';
import { LessonFile, PackManifest } from '../src/schema/content';

const PACKS = join(__dirname, '..', 'public', 'packs');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

/** The catalogue as members get it: the commercial build drops non-commercial sources. */
function commercialCatalogue() {
  const dirs = readdirSync(PACKS).filter((d) => existsSync(join(PACKS, d, 'pack.json')));
  const packs = dirs.map((d) => ({ d, pack: PackManifest.parse(read(join(PACKS, d, 'pack.json'))) }));
  const excluded = new Set(
    packs.flatMap(({ pack }) => {
      const ids = new Set(pack.sources.filter((s) => /non.?commercial|by-nc/i.test(`${s.license} ${s.licenseUrl}`)).map((s) => s.id));
      return pack.subjects.filter((s) => ids.has(s.sourceId)).map((s) => s.key);
    }),
  );
  const lessons = new Map(dirs.map((d) => [d, existsSync(join(PACKS, d, 'lessons.json')) ? LessonFile.parse(read(join(PACKS, d, 'lessons.json'))) : null]));
  const excludedCases = new Set([...lessons.values()].flatMap((l) => l?.cases.filter((c) => excluded.has(c.subjectKey)).map((c) => c.id) ?? []));
  const out = packs.map(({ d, pack }) => filterCommercial(pack, lessons.get(d) ?? null, excluded, excludedCases).lessons);
  const cases = out.flatMap((l) => l?.cases ?? []);
  const tasks = out.flatMap((l) => l?.tasks ?? []);
  const modalities = new Set(packs.flatMap(({ pack }) => pack.series.filter((s) => !excluded.has(s.subjectKey)).map((s) => s.modality)));
  return { patients: new Set(cases.map((c) => c.subjectKey)).size, tasks: tasks.filter((t) => cases.some((c) => c.id === t.caseId)).length, modalities };
}

describe('landing-page claims', () => {
  const cat = commercialCatalogue();
  it('never claims more patients or tasks than members get', () => {
    expect(cat.patients).toBeGreaterThanOrEqual(LANDING_FACTS.patients);
    expect(cat.tasks).toBeGreaterThanOrEqual(LANDING_FACTS.tasks);
  });
  it('names only modalities that are installed', () => {
    const code = { CT: ['CT'], MRI: ['MR'], 'X-ray': ['CR', 'DX'], Mammography: ['MG'], Ultrasound: ['US'] } as const;
    for (const m of LANDING_FACTS.modalities) expect(code[m].some((c) => cat.modalities.has(c)), m).toBe(true);
  });
  it('counts conditions and book objectives truthfully', () => {
    expect(CONDITIONS.length).toBeGreaterThanOrEqual(LANDING_FACTS.conditions);
    const cur = read(join(__dirname, '..', 'public', 'content', 'curriculum.v1.json'));
    expect(cur.units.reduce((a: number, u: { objectives: unknown[] }) => a + u.objectives.length, 0)).toBe(LANDING_FACTS.objectives);
  });
  it('has every screenshot the page shows', () => {
    for (const n of ['hero', 'ct', 'mri', 'xray', 'mammo', 'us', 'conditions']) expect(existsSync(join(__dirname, '..', 'public', 'landing', `${n}.webp`)), n).toBe(true);
  });
});
