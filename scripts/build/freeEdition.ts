import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { LessonFile, PackIndex, PackManifest, type TeachingCase } from '../../src/schema/content';

/**
 * The free edition: what a signed-up account without a plan may load. It is the sample patients, as filtered
 * copies of the pack manifests and lessons, and a teaser list of every patient (neutral titles only) so the library
 * can show what membership unlocks. The schedule's cases of the week are members-only; they appear here only in
 * `info` (neutral title, modality, tasks) for the Monday email.
 */
export interface FreeSchedule {
  epoch: string;
  always: string[];
  weekly: string[];
}

export interface FreeEditionData extends FreeSchedule {
  /** Site paths every free account may read. */
  shared: string[];
  /** Per free patient: folders (prefixes) and single files it needs. */
  cases: Record<string, { prefixes: string[]; files: string[] }>;
  /** Per free patient: neutral title, modality and task count (for the weekly email). */
  info: Record<string, { title: string; modality: string; tasks: number }>;
}

export interface TeaserCase {
  id: string;
  title: string;
  modality: string;
  region: string[];
  tasks: number;
}

const NON_COMMERCIAL = /non.?commercial|by-nc/i;

export function computeFreeEdition(packsDir: string, schedule: FreeSchedule) {
  const index = PackIndex.parse(JSON.parse(readFileSync(resolve(packsDir, 'index.json'), 'utf8')));
  // A pack that does not validate is left out (the app shows it as invalid too); a free case it held is reported below.
  const read = (path: string) => {
    try {
      return JSON.parse(readFileSync(resolve(packsDir, path), 'utf8')) as unknown;
    } catch {
      return null;
    }
  };
  const packs = index.packs.flatMap((e) => {
    if (!existsSync(resolve(packsDir, e.manifest))) return [];
    const manifest = PackManifest.safeParse(read(e.manifest));
    const lessonsPath = e.lessons ?? e.manifest.replace(/pack\.json$/, 'lessons.json');
    const lessons = existsSync(resolve(packsDir, lessonsPath)) ? LessonFile.safeParse(read(lessonsPath)) : null;
    if (!manifest.success || (lessons && !lessons.success)) {
      console.warn(`Free edition: pack ${e.id} does not validate and is left out`);
      return [];
    }
    return [{ entry: e, dir: posix.dirname(e.manifest), manifest: manifest.data, lessons: lessons?.success ? lessons.data : null }];
  });

  const cases = new Map<string, TeachingCase>();
  for (const p of packs) for (const c of p.lessons?.cases ?? []) cases.set(c.id, c);
  const licenceOf = new Map<string, string>();
  for (const p of packs) for (const s of p.manifest.sources) licenceOf.set(s.id, `${s.license} ${s.licenseUrl ?? ''}`);
  const sourceOfSubject = new Map<string, string>();
  for (const p of packs) for (const s of p.manifest.subjects) sourceOfSubject.set(s.key, s.sourceId);

  const freeIds = [...new Set(schedule.always)];
  for (const id of new Set([...schedule.always, ...schedule.weekly])) {
    const c = cases.get(id);
    if (!c) throw new Error(`Free edition: case ${id} is not in any pack`);
    if (NON_COMMERCIAL.test(licenceOf.get(sourceOfSubject.get(c.subjectKey) ?? '') ?? '')) throw new Error(`Free edition: case ${id} has a non-commercial licence`);
  }

  const out: Record<string, { prefixes: string[]; files: string[] }> = {};
  const freeSeries = new Set<string>();
  const freeStudies = new Set<string>();
  const freeSubjects = new Set<string>();
  for (const id of freeIds) {
    const c = cases.get(id)!;
    const studies = new Set(c.studyUids);
    const prefixes = new Set<string>();
    const files = new Set<string>();
    const series = new Set<string>();
    for (const p of packs)
      for (const s of p.manifest.series) {
        if (!studies.has(s.studyUid)) continue;
        series.add(s.uid);
        for (const i of s.instances) prefixes.add(`/packs/${p.dir}/${posix.dirname(i.file)}/`);
        if (s.thumbnail) files.add(`/packs/${p.dir}/${s.thumbnail}`);
      }
    for (const p of packs) for (const t of p.manifest.referenceTargets) if (series.has(t.seriesUid)) files.add(`/packs/${p.dir}/${t.geometryFile}`);
    out[id] = { prefixes: [...prefixes].sort(), files: [...files].sort() };
    series.forEach((s) => freeSeries.add(s));
    studies.forEach((s) => freeStudies.add(s));
    freeSubjects.add(c.subjectKey);
  }

  const outputs: Array<{ rel: string; json: unknown }> = [];
  const shared = ['/packs/index.free.json', '/packs/teaser.json', '/content/curriculum.v1.json'];
  const entries: PackIndex['packs'] = [];
  const free = new Set(freeIds);
  for (const p of packs) {
    const m = p.manifest;
    const series = m.series.filter((s) => freeSeries.has(s.uid));
    const referenceTargets = m.referenceTargets.filter((t) => freeSeries.has(t.seriesUid));
    const lessons = p.lessons ? { ...p.lessons, cases: p.lessons.cases.filter((c) => free.has(c.id)), tasks: p.lessons.tasks.filter((t) => free.has(t.caseId)) } : null;
    if (!series.length && !referenceTargets.length && !lessons?.cases.length && !lessons?.tasks.length) continue;
    const subjects = m.subjects.filter((s) => freeSubjects.has(s.key)).map((s) => ({ ...s, studyUids: s.studyUids.filter((u) => freeStudies.has(u)) }));
    const usedSources = new Set(subjects.map((s) => s.sourceId));
    const manifest: PackManifest = {
      ...m,
      sources: m.sources.filter((s) => usedSources.has(s.id) || !subjects.length),
      subjects,
      studies: m.studies.filter((s) => freeStudies.has(s.uid)).map((s) => ({ ...s, seriesUids: s.seriesUids.filter((u) => freeSeries.has(u)) })),
      series,
      spatialLinks: m.spatialLinks.filter((l) => freeSeries.has(l.seriesA) && freeSeries.has(l.seriesB)),
      referenceTargets,
    };
    outputs.push({ rel: `${p.dir}/pack.free.json`, json: manifest });
    shared.push(`/packs/${p.dir}/pack.free.json`);
    let lessonsRel: string | null = null;
    if (lessons) {
      lessonsRel = `${p.dir}/lessons.free.json`;
      outputs.push({ rel: lessonsRel, json: lessons });
      shared.push(`/packs/${lessonsRel}`);
    }
    entries.push({ ...p.entry, manifest: `${p.dir}/pack.free.json`, lessons: lessonsRel, note: 'Free edition' });
  }
  outputs.push({ rel: 'index.free.json', json: { ...index, packs: entries } });

  const modalityOf = new Map<string, string>();
  for (const p of packs) for (const s of p.manifest.series) modalityOf.set(s.uid, s.modality);
  const tasksOf = new Map<string, number>();
  for (const p of packs) for (const t of p.lessons?.tasks ?? []) tasksOf.set(t.caseId, (tasksOf.get(t.caseId) ?? 0) + 1);
  const teaser: TeaserCase[] = [...cases.values()]
    .map((c) => ({ id: c.id, title: c.neutralTitle, modality: modalityOf.get(c.primarySeriesUid) ?? '', region: c.region, tasks: tasksOf.get(c.id) ?? 0 }))
    .filter((c) => c.tasks > 0)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  outputs.push({ rel: 'teaser.json', json: { cases: teaser } });

  const listed = new Set([...schedule.always, ...schedule.weekly]);
  const info = Object.fromEntries(teaser.filter((t) => listed.has(t.id)).map((t) => [t.id, { title: t.title, modality: t.modality, tasks: t.tasks }]));
  const data: FreeEditionData = { ...schedule, shared: shared.sort(), cases: out, info };
  return { data, outputs };
}

/** Write the free edition beside the packs (the production build calls this on dist/packs). */
export function writeFreeEdition(packsDir: string, schedule: FreeSchedule) {
  const { data, outputs } = computeFreeEdition(packsDir, schedule);
  for (const o of outputs) {
    const target = resolve(packsDir, o.rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(o.json));
  }
  return data;
}

/** Source of the server's allow-list (server/freeEdition.generated.ts). */
export function serverModule(data: FreeEditionData): string {
  return [
    '// Generated by `npm run free:sync` from src/content/weekly.ts and public/packs. Do not edit by hand.',
    '// What a free account (signed in, no plan) may load; see server/free.ts.',
    'export interface FreeEdition {',
    '  epoch: string;',
    '  always: string[];',
    '  weekly: string[];',
    '  shared: string[];',
    '  cases: Record<string, { prefixes: string[]; files: string[] }>;',
    '  info: Record<string, { title: string; modality: string; tasks: number }>;',
    '}',
    `export const FREE_EDITION: FreeEdition = ${JSON.stringify(data, null, 1)};`,
    '',
  ].join('\n');
}
