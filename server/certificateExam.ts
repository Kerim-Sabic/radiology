import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { db } from './store.js';
import { gradeTask, type LoadedTarget } from '../src/grading/spatialGrader.js';
import { SeriesIndex } from '../src/grading/seriesIndex.js';
import type { Series, Task } from '../src/schema/content.js';
import { CERT_AREAS, examRule, levelLabel, type CertArea, type CertLevel } from '../shared/certificateLevels.js';
import { examEligibleTask, examPoints, isMarking, isTwoOption, pickExam, questionAreaOf, waitWords, type ExamCandidate, type QuestionOutcome } from '../shared/examQuestions.js';

/**
 * Certification exams on the server. The server picks every exam's questions from the published answer keys (built
 * with the app from the same lessons), starts each question's clock when it opens, grades each answer itself with
 * the app's grader against the expert's reference, and scores the exam. Only an exam it scored as passed can issue a
 * certificate. It also keeps the levels in order and the wait before a failed higher level is tried again.
 */
export interface TaskKey {
  task: Task;
  caseId: string;
  /** The patient (hold-out group). */
  patient: string;
  areas: CertArea[];
  /** The case's region and difficulty, to place and pick the question. */
  region: string[];
  difficulty: string;
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
/** An answer as given: the marks, the slice or the choice, never a grade. */
export const Answer = z
  .object({
    taskId: str,
    lessonVersion: str,
    mode: z.literal('assess'),
    marks: z.array(Mark).max(80),
    position: z.object({ seriesUid: str, sopInstanceUid: str.nullable(), worldLps: v3.nullable() }).nullable(),
    choice: z.array(str).max(100),
    declaredNoFinding: z.boolean(),
    hintsUsed: z.array(z.number().int()).max(20),
    revealed: z.boolean(),
  })
  .strict();

/** Grades an answer with the trusted task and reference, as the app does. */
export function gradeAnswer(a: z.infer<typeof Answer>, keys: AnswerKeys): { ok: true; outcome: 'correct' | 'partial' | 'incorrect' } | { ok: false; error: string } {
  const trusted = keys.tasks[a.taskId];
  if (!trusted || trusted.lessonVersion !== a.lessonVersion) return { ok: false, error: 'Reload this case to use its current assessment.' };
  const targets = new Map(trusted.task.targets.flatMap((t) => (keys.targets[t.targetId] ? [[t.targetId, keys.targets[t.targetId]] as const] : [])));
  const seriesIds = new Set([trusted.task.start.seriesUid, ...trusted.task.seriesUids, ...[...targets.values()].map((t) => t.ref.seriesUid)]);
  // Marks or a slice on another series of the patient cannot match this question's reference: they are left out.
  const marks = a.marks.filter((m) => seriesIds.has(m.seriesUid));
  const position = a.position && seriesIds.has(a.position.seriesUid) ? a.position : undefined;
  // Hints and the reveal are not offered in an exam: an answer that used them counts as wrong.
  if (a.hintsUsed.length || a.revealed) return { ok: true, outcome: 'incorrect' };
  const series = new Map([...seriesIds].flatMap((id) => (keys.series[id] ? [[id, new SeriesIndex(keys.series[id])] as const] : [])));
  const grade = gradeTask({ task: trusted.task, targets, series, marks, position, choice: a.choice, declaredNoFinding: a.declaredNoFinding });
  return { ok: true, outcome: grade.outcome === 'correct' || grade.outcome === 'partial' ? grade.outcome : 'incorrect' };
}

/** Every question the exams can ask, as the app works them out from its catalogue. */
export function examCandidates(keys: AnswerKeys): ExamCandidate[] {
  const out: ExamCandidate[] = [];
  for (const [taskId, k] of Object.entries(keys.tasks)) {
    if (!examEligibleTask(k.task, (id) => keys.targets[id]?.ref.provenance)) continue;
    const area = questionAreaOf(
      k.region,
      k.task.targets.map((t) => keys.targets[t.targetId]?.ref.classId ?? ''),
    );
    if (area) out.push({ taskId, caseId: k.caseId, area, group: k.patient, subtle: k.difficulty === 'subtle', marking: isMarking(k.task), twoOption: isTwoOption(k.task) });
  }
  return out;
}

export interface ServerExamQuestion {
  taskId: string;
  caseId: string;
  area: CertArea;
  patient: string;
  revision: string;
  openedAt: string | null;
  answeredAt: string | null;
  outcome: QuestionOutcome;
}
export interface ServerExam {
  id: string;
  userId: string;
  area: CertArea;
  level: CertLevel;
  startedAt: string;
  finishedAt: string | null;
  questions: ServerExamQuestion[];
  result?: { points: number; questions: number; score: number; passed: boolean; patients: number; areas: number; outcomes: QuestionOutcome[]; finishedAt: string };
}

const NINETY_DAYS = 90 * 86_400;
/** Seconds of network delay allowed on top of a question's time. */
const GRACE_SECONDS = 15;
export const examKey = (id: string) => `rvm:exam:${id}`;
const openKey = (userId: string) => `rvm:exam-open:${userId}`;
const seenKey = (userId: string) => `rvm:exam-seen:${userId}`;
export const lastExamKey = (userId: string, area: CertArea, level: CertLevel) => `rvm:exam-last:${userId}:${area}:${level}`;
const Level = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** What the app shows of an exam: its questions and their clocks, never the answer keys. */
const forApp = (e: ServerExam) => ({
  id: e.id,
  area: e.area,
  level: e.level,
  startedAt: e.startedAt,
  finishedAt: e.finishedAt,
  items: e.questions.map((q) => ({ caseId: q.caseId, taskId: q.taskId, area: q.area, startedAt: q.openedAt, submittedAt: q.answeredAt, attemptId: null, timedOut: q.outcome === 'timeout' })),
  ...(e.result ? { result: e.result } : {}),
});

async function load(userId: string, examId: unknown): Promise<ServerExam | null> {
  if (typeof examId !== 'string' || !/^exam-[a-f0-9]{24}$/.test(examId)) return null;
  const e = await db().get<ServerExam>(examKey(examId));
  return e && e.userId === userId ? e : null;
}
const save = (e: ServerExam) => db().set(examKey(e.id), e, { ex: NINETY_DAYS });

/**
 * Starts an exam: the levels in order (Level 2 needs Level 1 held), a level held is not taken again, the wait after a
 * failed higher level, then questions picked here, those the learner had in earlier exams last. An unfinished exam
 * of this learner is ended first (its unanswered questions count as wrong).
 */
export async function startExam(userId: string, held: Array<{ area: string; level: number; status?: string }>, body: unknown, keys = answerKeys(), now = new Date(), rng = Math.random) {
  const p = z.object({ area: z.enum(CERT_AREAS), level: Level }).strict().safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Choose an exam.' };
  const { area, level } = p.data;
  const has = (l: number) => held.some((c) => c.area === area && c.level === l && c.status !== 'revoked');
  if (has(level)) return { ok: false as const, error: 'You already hold this certificate.' };
  if (level > 1 && !has(level - 1)) return { ok: false as const, error: `${levelLabel(level)} is taken after ${levelLabel((level - 1) as CertLevel)}: get that certificate first.` };
  const rule = examRule(area, level);
  const last = await db().get<{ finishedAt: string; passed: boolean }>(lastExamKey(userId, area, level));
  if (last && !last.passed && rule.retakeHours) {
    const until = Date.parse(last.finishedAt) + rule.retakeHours * 3_600_000;
    if (until > now.getTime()) return { ok: false as const, error: `You can try this exam again in ${waitWords(until - now.getTime())}.` };
  }
  const open = await db().get<string>(openKey(userId));
  if (open) {
    const prev = await load(userId, open);
    if (prev && !prev.finishedAt) await finish(prev, now);
  }
  const seen = new Set(await db().smembers<string[]>(seenKey(userId)));
  const picked = pickExam(examCandidates(keys), area, level, seen, rng);
  if (picked.length < rule.questions) return { ok: false as const, error: 'The library cannot fill this exam yet.' };
  const exam: ServerExam = {
    id: `exam-${randomBytes(12).toString('hex')}`,
    userId,
    area,
    level,
    startedAt: now.toISOString(),
    finishedAt: null,
    questions: picked.map((c) => ({ taskId: c.taskId, caseId: c.caseId, area: c.area, patient: c.group, revision: keys.tasks[c.taskId].revision, openedAt: null, answeredAt: null, outcome: null })),
  };
  await save(exam);
  await db().set(openKey(userId), exam.id, { ex: NINETY_DAYS });
  for (const q of exam.questions) await db().sadd(seenKey(userId), q.taskId);
  return { ok: true as const, exam: forApp(exam) };
}

const Index = z.object({ examId: z.string(), index: z.number().int().min(0).max(200) }).strict();

/** Starts a question's clock, once: reopening it (a reload, a later visit) keeps the first time. */
export async function openQuestion(userId: string, body: unknown, now = new Date()) {
  const p = Index.safeParse(body);
  const e = p.success ? await load(userId, p.data.examId) : null;
  const q = e && p.success ? e.questions[p.data.index] : null;
  if (!e || !q) return { ok: false as const, error: 'That exam question was not found.' };
  if (e.finishedAt) return { ok: false as const, error: 'This exam has ended.' };
  if (!q.openedAt) {
    q.openedAt = now.toISOString();
    await save(e);
  }
  return { ok: true as const, openedAt: q.openedAt };
}

/**
 * Saves the answer to one question, graded here. An answer after the question's time (plus a little for the network)
 * counts as out of time, as does a question whose time ran out with nothing to save. A question is answered once.
 */
export async function answerQuestion(userId: string, body: unknown, keys = answerKeys(), now = new Date()) {
  const p = z
    .object({ examId: z.string(), index: z.number().int().min(0).max(200), answer: z.unknown().optional(), timedOut: z.literal(true).optional() })
    .strict()
    .safeParse(body);
  const e = p.success ? await load(userId, p.data.examId) : null;
  const q = e && p.success ? e.questions[p.data.index] : null;
  if (!p.success || !e || !q) return { ok: false as const, error: 'That exam question was not found.' };
  if (e.finishedAt) return { ok: false as const, error: 'This exam has ended.' };
  if (q.answeredAt) return { ok: false as const, error: 'This question has already been answered.' };
  const limit = examRule(e.area, e.level).secondsPerQuestion;
  if (limit && !q.openedAt) return { ok: false as const, error: 'Open the question before answering it.' };
  const late = !!limit && now.getTime() - Date.parse(q.openedAt!) > (limit + GRACE_SECONDS) * 1000;
  let outcome: QuestionOutcome;
  if (p.data.timedOut || late) outcome = 'timeout';
  else {
    const a = Answer.safeParse(p.data.answer);
    if (!a.success || a.data.taskId !== q.taskId) return { ok: false as const, error: 'This answer could not be read.' };
    if (keys.tasks[q.taskId]?.revision !== q.revision) return { ok: false as const, error: 'This question changed after the exam began. End the exam and start a new one.' };
    const g = gradeAnswer(a.data, keys);
    if (!g.ok) return g;
    outcome = g.outcome;
  }
  q.answeredAt = now.toISOString();
  q.outcome = outcome;
  await save(e);
  return { ok: true as const, saved: true as const };
}

async function finish(e: ServerExam, now: Date) {
  const outcomes = e.questions.map((q) => q.outcome);
  const r = examPoints(outcomes, e.area, e.level);
  e.finishedAt = now.toISOString();
  e.result = {
    points: r.points,
    questions: e.questions.length,
    score: r.score,
    passed: r.passed && new Set(e.questions.map((q) => q.area)).size >= (examRule(e.area, e.level).minAreas ?? 1),
    patients: new Set(e.questions.map((q) => q.patient)).size,
    areas: new Set(e.questions.map((q) => q.area)).size,
    outcomes,
    finishedAt: e.finishedAt,
  };
  await save(e);
  await db().set(lastExamKey(e.userId, e.area, e.level), { finishedAt: e.finishedAt, passed: e.result.passed }, { ex: NINETY_DAYS });
  if ((await db().get<string>(openKey(e.userId))) === e.id) await db().del(openKey(e.userId));
  return e;
}

/** Ends an exam (questions not answered count as wrong) and returns the verdict; a finished exam returns its verdict again. */
export async function finishExam(userId: string, body: unknown, now = new Date()) {
  const p = z.object({ examId: z.string() }).strict().safeParse(body);
  const e = p.success ? await load(userId, p.data.examId) : null;
  if (!e) return { ok: false as const, error: 'That exam was not found.' };
  const done = e.finishedAt ? e : await finish(e, now);
  return { ok: true as const, result: done.result! };
}

/** A finished exam of this learner, for issuing its certificate. */
export const examFor = (userId: string, examId: unknown) => load(userId, examId);
