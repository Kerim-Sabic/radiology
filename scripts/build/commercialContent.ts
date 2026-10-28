import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { PackManifest, LessonFile, PackIndex } from '../../src/schema/content';

export function filterCommercial(pack: PackManifest, lessons: LessonFile | null, excludedSubjects: Set<string>) {
  const removed = pack.series.filter(s => excludedSubjects.has(s.subjectKey));
  const series = new Set(removed.map(s => s.uid));
  const targets = pack.referenceTargets.filter(t => series.has(t.seriesUid));
  const files = [...removed.flatMap(s => [...s.instances.map(i => i.file), ...(s.thumbnail ? [s.thumbnail] : [])]), ...targets.map(t => t.geometryFile)];
  const filtered: PackManifest = { ...pack,
    sources: pack.sources.filter(s => !/non.?commercial|by-nc/i.test(`${s.license} ${s.licenseUrl}`)),
    subjects: pack.subjects.filter(s => !excludedSubjects.has(s.key)),
    studies: pack.studies.filter(s => !excludedSubjects.has(s.subjectKey)),
    series: pack.series.filter(s => !series.has(s.uid)),
    spatialLinks: pack.spatialLinks.filter(l => !series.has(l.seriesA) && !series.has(l.seriesB)),
    referenceTargets: pack.referenceTargets.filter(t => !series.has(t.seriesUid)),
  };
  if (removed.length) {
    filtered.title = filtered.title.replace('RICORD radiographs, ', '');
    filtered.description = 'Commercial edition: pediatric CT anatomy, chest CT, and permitted radiograph comparisons. Non-commercial-only RICORD images are excluded.';
  }
  const cases = lessons?.cases.filter(c => !excludedSubjects.has(c.subjectKey)) || [];
  const caseIds = new Set(cases.map(c => c.id));
  return { pack: filtered, lessons: lessons ? { ...lessons, cases, tasks: lessons.tasks.filter(t => caseIds.has(t.caseId)) } : null, files };
}

export function prepareCommercialContent(outputDirectory: string) {
  const root = resolve(outputDirectory, 'packs');
  if (!existsSync(root)) throw new Error('Missing study packs in the build');
  const dirs = readdirSync(root).filter(d => existsSync(resolve(root, d, 'pack.json')));
  const packs = dirs.map(d => ({ dir: d, pack: PackManifest.parse(JSON.parse(readFileSync(resolve(root, d, 'pack.json'), 'utf8'))) }));
  const excluded = new Set(packs.flatMap(({ pack }) => {
    const sourceIds = new Set(pack.sources.filter(s => /non.?commercial|by-nc/i.test(`${s.license} ${s.licenseUrl}`)).map(s => s.id));
    return pack.subjects.filter(s => sourceIds.has(s.sourceId)).map(s => s.key);
  }));
  let removedFiles = 0;
  for (const { dir, pack } of packs) {
    const base = resolve(root, dir), lessonsPath = resolve(base, 'lessons.json');
    const lessons = existsSync(lessonsPath) ? LessonFile.parse(JSON.parse(readFileSync(lessonsPath, 'utf8'))) : null;
    const filtered = filterCommercial(pack, lessons, excluded);
    writeFileSync(resolve(base, 'pack.json'), JSON.stringify(filtered.pack));
    if (filtered.lessons) writeFileSync(lessonsPath, JSON.stringify(filtered.lessons));
    for (const file of filtered.files) {
      const target = resolve(base, file);
      if (!target.startsWith(`${base}${sep}`)) throw new Error('Pack asset path escapes output directory');
      rmSync(target, { force: true });
      removedFiles++;
    }
  }
  const indexPath = resolve(root, 'index.json');
  const index = PackIndex.parse(JSON.parse(readFileSync(indexPath, 'utf8')));
  for (const entry of index.packs) {
    entry.title = entry.title.replace('RICORD radiographs, ', '');
    if (entry.id === 'more-ct-xr') entry.note = 'Commercial edition. Non-commercial-only RICORD studies are excluded.';
  }
  writeFileSync(indexPath, JSON.stringify(index));
  console.log(`Commercial content: excluded ${excluded.size} restricted subjects and ${removedFiles} associated files.`);
}
