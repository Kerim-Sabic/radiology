/**
 * Certification exams in the app. Each level of each body area (and of the whole library) is one exam, a set of
 * questions on real patients. The server picks every exam's questions, starts each question's clock, grades every
 * answer against the expert's reference and scores the exam; the app asks the questions one after another in the
 * reading room (Assess mode: no hints, labels or book), with no feedback until the end, then shows whether you passed
 * and every answer to review. The rules of each level are in shared/certificateLevels.ts, the choice of questions in
 * shared/examQuestions.ts. The Certificates page, the reading room and the result page do the viewing and storage.
 */
import type { Catalog } from './caseRepository';
import type { Attempt } from './progressRepository';
import type { Task } from '../schema/content';
import { examRule, type CertArea, type CertLevel } from '../../shared/certificateLevels';
import {
  BODY_AREAS,
  examComplete,
  examEligibleTask,
  examPoints,
  isMarking,
  isTwoOption,
  pickExam,
  questionAreaOf,
  waitWords,
  type ExamCandidate,
  type QuestionOutcome,
} from '../../shared/examQuestions';

export { BODY_AREAS, isMarking, isTwoOption, waitWords };

type CatalogView = Pick<Catalog, 'cases' | 'tasksByCase' | 'holdoutGroup' | 'targets'>;

export interface ExamItem {
  caseId: string;
  taskId: string;
  /** The body area the question counts for. */
  area: CertArea;
  /** When the question first opened (the server's clock): it runs from here, also across reloads and visits. */
  startedAt?: string | null;
  submittedAt: string | null;
  attemptId: string | null;
  /** The clock ran out before an answer was given. */
  timedOut?: boolean;
}

/** The server's verdict on a finished exam. */
export interface ExamResult {
  points: number;
  questions: number;
  score: number;
  passed: boolean;
  patients: number;
  areas: number;
  outcomes: QuestionOutcome[];
  finishedAt: string;
}

export interface CertExam {
  id: string;
  area: CertArea;
  level: CertLevel;
  startedAt: string;
  finishedAt: string | null;
  items: ExamItem[];
  /** Filled in when the server has scored the exam. */
  result?: ExamResult;
}

/** The body area a question counts for (see shared/examQuestions.ts). */
export const questionArea = (task: Task, region: string[], catalog: Pick<Catalog, 'targets'>) =>
  questionAreaOf(
    region,
    task.targets.map((t) => catalog.targets.get(t.targetId)?.classId ?? ''),
  );

/** A question the app can grade on its own, against an expert reference (never self-review, never a machine outline). */
export const examEligible = (task: Task, catalog: Pick<Catalog, 'targets'>) => examEligibleTask(task, (id) => catalog.targets.get(id)?.provenance);

/** Every question an exam of this area can ask. */
export function examPool(catalog: CatalogView, area: CertArea): Array<ExamCandidate & { task: Task }> {
  const out: Array<ExamCandidate & { task: Task }> = [];
  for (const k of catalog.cases.values()) {
    for (const task of catalog.tasksByCase.get(k.id) ?? []) {
      const own = questionArea(task, k.region, catalog);
      if (!own || (area !== 'all' && own !== area) || !examEligible(task, catalog)) continue;
      out.push({ taskId: task.id, caseId: k.id, task, area: own, group: catalog.holdoutGroup(k.id), subtle: k.difficulty === 'subtle', marking: isMarking(task), twoOption: isTwoOption(task) });
    }
  }
  return out;
}

/** An exam put together in the app, as the server would: for saying which exams the library can fill, and for tests. */
export function buildExam(
  catalog: CatalogView,
  attempts: Attempt[],
  o: { area: CertArea; level: CertLevel; rng?: () => number; now?: Date; id?: string },
): CertExam {
  const tried = new Set(attempts.filter((a) => a.submittedAt).map((a) => a.taskId));
  const picked = pickExam(examPool(catalog, o.area), o.area, o.level, tried, o.rng ?? Math.random);
  const now = o.now ?? new Date();
  return {
    id: o.id ?? `exam-${now.getTime().toString(36)}`,
    area: o.area,
    level: o.level,
    startedAt: now.toISOString(),
    finishedAt: null,
    items: picked.map((c) => ({ caseId: c.caseId, taskId: c.taskId, area: c.area, startedAt: null, submittedAt: null, attemptId: null })),
  };
}

/** Whether the library can fill an exam: enough questions, enough of them marked on the image, enough body areas. */
export function examAvailable(catalog: CatalogView, area: CertArea, level: CertLevel): boolean {
  return examComplete(pickExam(examPool(catalog, area), area, level, new Set(), () => 0.5), area, level);
}

export const examUrl = (exam: CertExam, i: number) => {
  const it = exam.items[i];
  return `/read/${encodeURIComponent(it.caseId)}?task=${encodeURIComponent(it.taskId)}&mode=assess&exam=${encodeURIComponent(exam.id)}`;
};
export const examResultUrl = (exam: CertExam) => `/certificates/exam/${encodeURIComponent(exam.id)}`;

/** Index of the next question to answer, or -1 when every question is answered. */
export const nextQuestion = (exam: CertExam) => exam.items.findIndex((it) => !it.submittedAt);

/** Seconds left on a question's clock (0 or less once it has run out), or null when the level is untimed. */
export function questionSecondsLeft(exam: CertExam, item: ExamItem, now = Date.now()): number | null {
  const limit = examRule(exam.area, exam.level).secondsPerQuestion;
  if (!limit) return null;
  if (!item.startedAt) return limit;
  return Math.ceil(limit - (now - Date.parse(item.startedAt)) / 1000);
}

export type QuestionResult = 'correct' | 'partial' | 'incorrect' | 'timeout' | 'unanswered';
export const QUESTION_RESULT_LABEL: Record<QuestionResult, string> = {
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Wrong',
  timeout: 'Time ran out',
  unanswered: 'Not answered',
};

/**
 * The exam's score: the server's when it has scored the exam, otherwise worked out here from the saved answers.
 * Correct 1, partly right ½ (nothing at a level without half points), wrong, out of time or not answered 0, out of
 * the number of questions. A question answered "not sure" or "not visible" counts as wrong.
 */
export function examScore(exam: CertExam, attempts: Attempt[]) {
  const rule = examRule(exam.area, exam.level);
  const rows = exam.items.map((item, i) => {
    const attempt = item.attemptId ? (attempts.find((a) => a.id === item.attemptId) ?? null) : null;
    const server = exam.result?.outcomes[i];
    const o = server !== undefined ? server : attempt?.grade?.outcome;
    const result: QuestionResult =
      o === 'timeout' || (item.timedOut && !attempt) ? 'timeout' : o === 'correct' || o === 'partial' || o === 'incorrect' ? o : !item.submittedAt || !attempt ? 'unanswered' : 'incorrect';
    return { item, attempt, result };
  });
  const local = examPoints(
    rows.map((r) => (r.result === 'unanswered' ? null : r.result)),
    exam.area,
    exam.level,
  );
  const s = exam.result;
  return {
    rows,
    rule,
    points: s?.points ?? local.points,
    questions: s?.questions ?? exam.items.length,
    score: s?.score ?? local.score,
    patients: s?.patients ?? new Set(rows.map((r) => r.attempt?.holdoutGroup ?? r.item.caseId)).size,
    areas: s?.areas ?? new Set(exam.items.map((it) => it.area)).size,
    passMark: rule.passMark,
    answered: rows.filter((r) => r.result !== 'unanswered' && r.result !== 'timeout').length,
    passed: s ? s.passed : local.passed && new Set(exam.items.map((it) => it.area)).size >= (rule.minAreas ?? 1),
    /** Whether the server has scored it (only a server-scored pass issues a certificate). */
    verified: !!s,
  };
}

/**
 * Why an exam cannot be started now, or null when it can: the levels are taken in order (Level 2 needs the Level 1
 * certificate), a level already held is not taken again, and after an exam that was not passed the next try waits a
 * while from Level 2 up. The server checks the same.
 */
export function examBlock(
  area: CertArea,
  level: CertLevel,
  issued: Array<{ area: string; level?: number; status?: string }>,
  history: CertExam[],
  attempts: Attempt[],
  now = Date.now(),
): { reason: 'order' | 'wait' | 'held'; text: string; until?: number } | null {
  const held = (l: number) => issued.some((c) => c.area === area && (c.level ?? 1) === l && c.status !== 'revoked');
  if (held(level)) return { reason: 'held', text: 'You hold this certificate.' };
  if (level > 1 && !held(level - 1)) return { reason: 'order', text: `Get the Level ${level - 1} certificate first.` };
  const rule = examRule(area, level);
  const last = history.find((e) => e.area === area && e.level === level && e.finishedAt);
  if (last && rule.retakeHours && !examScore(last, attempts).passed) {
    const until = Date.parse(last.finishedAt!) + rule.retakeHours * 3_600_000;
    if (until > now) return { reason: 'wait', until, text: `You can try again in ${waitWords(until - now)}.` };
  }
  return null;
}

// ---------------------------------------------------------------- the server's side of an exam

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error ?? 'The exam server did not answer. Try again.' };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

/** A new exam, its questions picked by the server. */
export const startExam = (area: CertArea, level: CertLevel) => post<{ exam: CertExam }>('/api/certificates/exam/start', { area, level });
/** Starts a question's clock on the server (once); returns when it started. */
export const openQuestion = (examId: string, index: number) => post<{ openedAt: string }>('/api/certificates/exam/open', { examId, index });

/** What the server needs to grade an answer: the marks or choice as given, never a grade. */
export interface ExamAnswer {
  taskId: string;
  lessonVersion: string;
  mode: 'assess';
  marks: Attempt['marks'];
  position: Attempt['position'];
  choice: string[];
  declaredNoFinding: boolean;
  hintsUsed: number[];
  revealed: boolean;
}
export const answerQuestion = (examId: string, index: number, answer: ExamAnswer | null) =>
  post<{ saved: true }>('/api/certificates/exam/answer', answer ? { examId, index, answer } : { examId, index, timedOut: true });
/** Ends the exam (questions not answered count as wrong) and returns the server's verdict. */
export const finishExam = (examId: string) => post<{ result: ExamResult }>('/api/certificates/exam/finish', { examId });
