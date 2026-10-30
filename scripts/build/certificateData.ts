import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PackIndex, PackManifest, LessonFile, TargetGeometry } from '../../src/schema/content';

/** Only the commercially distributable, published teaching materials become answer keys. */
export function writeCertificateData(packs: string, output: string) {
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  const index = PackIndex.parse(read(resolve(packs, 'index.json')));
  const data = {
    version: '',
    tasks: {} as Record<string, unknown>,
    series: {} as Record<string, unknown>,
    targets: {} as Record<string, unknown>,
  };
  for (const entry of index.packs) {
    const manifest = PackManifest.parse(read(resolve(packs, entry.manifest)));
    const lessonsPath = resolve(packs, entry.lessons ?? entry.manifest.replace(/pack\.json$/, 'lessons.json'));
    if (!existsSync(lessonsPath) && !entry.lessons) continue; // Anatomy/reference packs have no assessed lessons.
    const lessons = LessonFile.parse(read(lessonsPath));
    const dir = dirname(resolve(packs, entry.manifest));
    const subjects = new Map(manifest.subjects.map((s) => [s.key, s]));
    for (const s of manifest.series) data.series[s.uid] = s;
    for (const task of lessons.tasks) {
      if (task.scoring !== 'authoritative' || task.grading.kind === 'self_review') continue;
      const c = lessons.cases.find((c) => c.id === task.caseId);
      if (!c || !subjects.has(c.subjectKey)) continue;
      const areas = (['chest', 'abdomen', 'head', 'msk', 'breast'] as const).filter((area) =>
        c.region.some((r) => (area === 'abdomen' ? ['abdomen', 'pelvis'] : area === 'msk' ? ['extremity', 'spine'] : [area]).includes(r)),
      );
      for (const target of task.targets) {
        const ref = manifest.referenceTargets.find((t) => t.id === target.targetId);
        if (!ref) throw new Error(`Missing certificate target ${target.targetId}`);
        const path = resolve(dir, ref.geometryFile);
        if (!path.startsWith(dir + '/') && !path.startsWith(dir + '\\')) throw new Error('Invalid reference path');
        data.targets[ref.id] = { ref, geom: TargetGeometry.parse(read(path)) };
      }
      if (data.tasks[task.id]) throw new Error(`Duplicate certificate task ID: ${task.id}`);
      const revision = createHash('sha256')
        .update(
          JSON.stringify([
            task,
            task.targets.map((t) => data.targets[t.targetId]),
            manifest.series.filter(
              (s) =>
                s.uid === task.start.seriesUid ||
                task.seriesUids.includes(s.uid) ||
                task.targets.some((t) => manifest.referenceTargets.some((r) => r.id === t.targetId && r.seriesUid === s.uid)),
            ),
            subjects.get(c.subjectKey)!.holdoutGroup,
            areas,
          ]),
        )
        .digest('hex');
      data.tasks[task.id] = {
        task,
        caseId: c.id,
        patient: subjects.get(c.subjectKey)!.holdoutGroup,
        areas,
        packId: entry.id,
        lessonVersion: lessons.version,
        revision,
      };
    }
  }
  data.version = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  writeFileSync(output, gzipSync(JSON.stringify(data)));
  console.log(`Certificate answer keys: ${Object.keys(data.tasks).length} graded tasks.`);
}
