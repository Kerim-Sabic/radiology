import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { db } from './store.js';
import { gradeTask, type LoadedTarget } from '../src/grading/spatialGrader.js';
import { SeriesIndex } from '../src/grading/seriesIndex.js';
import type { Series, Task } from '../src/schema/content.js';
import { CERT_AREAS, CERT_TITLES, LEVELS, PATIENT_FLOOR, type CertArea } from '../shared/certificateLevels.js';

export interface TaskKey {
  task: Task;
  caseId: string;
  patient: string;
  areas: CertArea[];
  packId: string;
  lessonVersion: string;
  revision: string;
}
export interface AnswerKeys {
  version: string;
  tasks: Record<string, TaskKey>;
  series: Record<string, Series>;
  targets: Record<string, LoadedTarget>;
}
let loaded: AnswerKeys | undefined;
export function answerKeys(): AnswerKeys {
  return (loaded ??= JSON.parse(gunzipSync(readFileSync(new URL('./certificate-data.json.gz', import.meta.url))).toString()));
}
const str = z.string().max(200);
const v2 = z.tuple([z.number(), z.number()]);
const v3 = z.tuple([z.number(), z.number(), z.number()]);
const Mark = z.object({
  id: str,
  tool: z.enum(['point', 'box', 'outline', 'arrow']),
  label: str.nullable(),
  seriesUid: str,
  sopInstanceUid: str.nullable(),
  frame: z.number().int().min(1).max(100000),
  imagePx: z.array(v2).max(2000).nullable(),
  worldLps: z.array(v3).max(2000).nullable(),
  view: z.enum(['stack', 'axial', 'coronal', 'sagittal']),
  createdAt: str,
});
const Answer = z
  .object({
    taskId: str,
    lessonVersion: str,
    mode: z.enum(['learn', 'practice', 'assess']),
    marks: z.array(Mark).max(80),
    position: z
      .object({
        seriesUid: str,
        sopInstanceUid: str.nullable(),
        worldLps: v3.nullable(),
      })
      .nullable(),
    choice: z.array(str).max(100),
    declaredNoFinding: z.boolean(),
    hintsUsed: z.array(z.number().int()).max(20),
    revealed: z.boolean(),
  })
  .strict();
export interface Evidence {
  taskId: string;
  patient: string;
  areas: CertArea[];
  outcome: 'correct' | 'partial' | 'incorrect';
  independent: boolean;
  at: string;
  version: string;
}
export const evidenceKey = (userId: string) => `rvm:verified-answers:${userId}`;
export async function recordAnswer(userId: string, body: unknown, keys = answerKeys()) {
  const p = Answer.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'This answer could not be verified.' };
  const a = p.data,
    trusted = keys.tasks[a.taskId];
  if (!trusted || trusted.lessonVersion !== a.lessonVersion)
    return {
      ok: false as const,
      error: 'Reload this case to use its current assessment.',
    };
  if (!trusted.task.modes.includes(a.mode))
    return {
      ok: false as const,
      error: 'This assessment is not available in that mode.',
    };
  const targets = new Map(trusted.task.targets.flatMap((t) => (keys.targets[t.targetId] ? [[t.targetId, keys.targets[t.targetId]] as const] : [])));
  const seriesIds = new Set([trusted.task.start.seriesUid, ...trusted.task.seriesUids, ...[...targets.values()].map((t) => t.ref.seriesUid)]);
  if (a.marks.some((m) => !seriesIds.has(m.seriesUid)) || (a.position && !seriesIds.has(a.position.seriesUid)))
    return { ok: false as const, error: 'The answer is on a different study.' };
  const series = new Map([...seriesIds].flatMap((id) => (keys.series[id] ? [[id, new SeriesIndex(keys.series[id])] as const] : [])));
  const grade = gradeTask({
    task: trusted.task,
    targets,
    series,
    marks: a.marks,
    position: a.position ?? undefined,
    choice: a.choice,
    declaredNoFinding: a.declaredNoFinding,
  });
  if (!grade.authoritative || !['correct', 'partial', 'incorrect'].includes(grade.outcome)) return { ok: true as const, counted: false };
  const evidence: Evidence = {
    taskId: a.taskId,
    patient: trusted.patient,
    areas: trusted.areas,
    outcome: grade.outcome as Evidence['outcome'],
    independent: a.mode === 'assess' && !a.revealed && a.hintsUsed.length === 0,
    at: new Date().toISOString(),
    version: trusted.revision,
  };
  await db().hset(evidenceKey(userId), { [a.taskId]: evidence });
  return { ok: true as const, counted: true, outcome: grade.outcome };
}
export function completionStatuses(rows: Evidence[], keys: AnswerKeys) {
  const verified = rows.filter((r) => keys.tasks[r.taskId]?.revision === r.version);
  return CERT_AREAS.flatMap((area) => {
    const tasks = Object.values(keys.tasks).filter((t) => area === 'all' || t.areas.includes(area));
    const patients = new Set(tasks.map((t) => t.patient)).size;
    return LEVELS[area === 'all' ? 'all' : 'area'].map((rule) => {
      const relevant = verified.filter((r) => (area === 'all' || r.areas.includes(area)) && (!rule.independent || r.independent));
      const read = new Set(relevant.map((r) => r.patient)).size;
      const judged = relevant.length;
      const accuracy = judged ? relevant.reduce((n, r) => n + (r.outcome === 'correct' ? 1 : r.outcome === 'partial' ? 0.5 : 0), 0) / judged : null;
      const needPatients = area === 'all' ? rule.minPatients : Math.max(PATIENT_FLOOR, Math.min(rule.minPatients, patients));
      const wide = CERT_AREAS.filter((a) => a !== 'all' && new Set(relevant.filter((r) => r.areas.includes(a)).map((r) => r.patient)).size >= (rule.perArea ?? 0)).length;
      const eligible = patients >= needPatients && read >= needPatients && judged >= rule.minJudged && (accuracy ?? 0) >= rule.minAccuracy && wide >= (rule.minAreas ?? 0);
      return {
        area,
        title: CERT_TITLES[area],
        level: rule.level,
        levelName: rule.name,
        patients,
        read,
        judged,
        accuracy,
        needPatients,
        needJudged: rule.minJudged,
        minAccuracy: rule.minAccuracy,
        independent: rule.independent,
        eligible,
        progress: eligible
          ? 1
          : Math.min(0.99, 0.5 * Math.min(1, read / needPatients) + 0.25 * Math.min(1, judged / rule.minJudged) + 0.25 * Math.min(1, (accuracy ?? 0) / rule.minAccuracy)),
        todo: eligible
          ? null
          : patients < needPatients
            ? 'More graded patients are needed in this area.'
            : read < needPatients
              ? `Complete ${needPatients - read} more patients with server-graded answers${rule.independent ? ' in Assess mode' : ''}.`
              : judged < rule.minJudged
                ? `Complete ${rule.minJudged - judged} more distinct graded tasks.`
                : (accuracy ?? 0) < rule.minAccuracy
                  ? `Reach ${Math.round(rule.minAccuracy * 100)}% correct on your latest answers.`
                  : `Complete at least ${rule.perArea} patients in ${rule.minAreas} areas.`,
      };
    });
  });
}
export async function verifiedProgress(userId: string, keys = answerKeys()) {
  const rows = await db().hgetall<Record<string, Evidence>>(evidenceKey(userId));
  return completionStatuses(Object.values(rows ?? {}), keys);
}
