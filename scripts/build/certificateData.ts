import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PackIndex, PackManifest, LessonFile, TargetGeometry, type ReferenceTarget, type Subject, type TeachingCase } from '../../src/schema/content';

/**
 * Only the commercially distributable, published teaching materials become answer keys. A lesson file may set tasks
 * on cases, patients and references of other packs (the book practice tasks do), so everything is looked up across
 * all packs.
 */
export function writeCertificateData(packs: string, output: string) {
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  const index = PackIndex.parse(read(resolve(packs, 'index.json')));
  const data = {
    version: '',
    tasks: {} as Record<string, unknown>,
    series: {} as Record<string, unknown>,
    targets: {} as Record<string, unknown>,
  };
  const subjects = new Map<string, Subject>();
  const cases = new Map<string, TeachingCase>();
  const refs = new Map<string, { ref: ReferenceTarget; dir: string }>();
  const lessonFiles: Array<{ packId: string; lessons: ReturnType<typeof LessonFile.parse> }> = [];
  for (const entry of index.packs) {
    const manifest = PackManifest.parse(read(resolve(packs, entry.manifest)));
    const dir = dirname(resolve(packs, entry.manifest));
    for (const s of manifest.subjects) subjects.set(s.key, s);
    for (const s of manifest.series) data.series[s.uid] = s;
    for (const ref of manifest.referenceTargets) refs.set(ref.id, { ref, dir });
    const lessonsPath = resolve(packs, entry.lessons ?? entry.manifest.replace(/pack\.json$/, 'lessons.json'));
    if (!existsSync(lessonsPath) && !entry.lessons) continue; // Anatomy/reference packs have no assessed lessons.
    const lessons = LessonFile.parse(read(lessonsPath));
    for (const c of lessons.cases) cases.set(c.id, c);
    lessonFiles.push({ packId: entry.id, lessons });
  }
  const allSeries = Object.values(data.series) as Array<{ uid: string }>;
  for (const { packId, lessons } of lessonFiles) {
    for (const task of lessons.tasks) {
      if (task.scoring !== 'authoritative' || task.grading.kind === 'self_review') continue;
      const c = cases.get(task.caseId);
      const subject = c && subjects.get(c.subjectKey);
      if (!c || !subject) continue;
      const areas = (['chest', 'abdomen', 'head', 'msk', 'breast'] as const).filter((area) =>
        c.region.some((r) => (area === 'abdomen' ? ['abdomen', 'pelvis'] : area === 'msk' ? ['extremity', 'spine'] : [area]).includes(r)),
      );
      for (const target of task.targets) {
        const found = refs.get(target.targetId);
        if (!found) throw new Error(`Missing certificate target ${target.targetId}`);
        const path = resolve(found.dir, found.ref.geometryFile);
        if (!path.startsWith(found.dir + '/') && !path.startsWith(found.dir + '\\')) throw new Error('Invalid reference path');
        data.targets[found.ref.id] = { ref: found.ref, geom: TargetGeometry.parse(read(path)) };
      }
      if (data.tasks[task.id]) throw new Error(`Duplicate certificate task ID: ${task.id}`);
      const targetSeries = new Set(task.targets.map((t) => refs.get(t.targetId)!.ref.seriesUid));
      const revision = createHash('sha256')
        .update(
          JSON.stringify([
            task,
            task.targets.map((t) => data.targets[t.targetId]),
            allSeries.filter((s) => s.uid === task.start.seriesUid || task.seriesUids.includes(s.uid) || targetSeries.has(s.uid)),
            subject.holdoutGroup,
            areas,
            c.region,
            c.difficulty,
          ]),
        )
        .digest('hex');
      data.tasks[task.id] = {
        task,
        caseId: c.id,
        patient: subject.holdoutGroup,
        areas,
        region: c.region,
        difficulty: c.difficulty,
        packId,
        lessonVersion: lessons.version,
        revision,
      };
    }
  }
  data.version = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  writeFileSync(output, gzipSync(JSON.stringify(data)));
  console.log(`Certificate answer keys: ${Object.keys(data.tasks).length} graded tasks.`);
}
