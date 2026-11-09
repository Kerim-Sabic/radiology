/**
 * Book exams (chapters 1-13 of Learning Radiology): the app's side. The questions come from the server one exam at a
 * time without their answers; the learner's answers wait in this browser (so a reload loses nothing) until the exam is
 * finished, and the server grades them. See server/bookExams.ts.
 */
export interface ChapterSummary {
  chapter: number;
  title: string;
  blurb: string;
  mcq: number;
  essays: number;
  points: number;
  record: { best: number; bestPoints: number; last: number; attempts: number; lastAt: string; lastAttempt: string } | null;
}
export interface ExamImage {
  thumb: string;
  caption: string;
}
export type OpenQuestion =
  | { id: string; type: 'mcq'; prompt: string; options: string[] }
  | { id: string; type: 'essay'; prompt: string; images: ExamImage[]; points: number; minWords: number };
export interface OpenExam {
  attemptId: string;
  chapter: number;
  title: string;
  startedAt: string;
  questions: OpenQuestion[];
}
export type Answers = Record<string, number | string | null>;
export type ResultQuestion =
  | { id: string; type: 'mcq'; level: string; prompt: string; options: string[]; picked: number | null; correct: number; explanation: string; book: string; lesson: string | null; earned: number; max: number }
  | { id: string; type: 'essay'; prompt: string; images: ExamImage[]; answer: string; rubric: Array<{ id: string; label: string; points: number; found: boolean; confirmed: boolean }>; model: string; book: string; earned: number; max: number; selfChecked: boolean };
export interface ExamResult {
  attemptId: string;
  chapter: number;
  title: string;
  finishedAt: string;
  points: number;
  total: number;
  percent: number;
  passed: boolean;
  questions: ResultQuestion[];
}
export type Api<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, body?: unknown): Promise<Api<T>> {
  try {
    const r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    return r.ok ? { ok: true, data: j } : { ok: false, status: r.status, error: j.error ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection.' };
  }
}

export const listExams = () => call<{ passMark: number; chapters: ChapterSummary[] }>('/api/book-exams');
export const startExam = (chapter: number) => call<OpenExam>('/api/book-exams/start', { chapter });
export const loadAttempt = (id: string) => call<({ finished: false } & OpenExam) | { finished: true; result: ExamResult }>(`/api/book-exams/attempt?id=${encodeURIComponent(id)}`);
export const finishExam = (attemptId: string, answers: Answers) => call<{ result: ExamResult }>('/api/book-exams/finish', { attemptId, answers });
export const reviewEssay = (attemptId: string, questionId: string, checked: string[]) => call<{ result: ExamResult }>('/api/book-exams/review', { attemptId, questionId, checked });

// The exam in progress, per chapter, kept on this device only.
const openKey = (chapter: number) => `rvm.bx.open.${chapter}`;
const draftKey = (attemptId: string) => `rvm.bx.draft.${attemptId}`;
export interface Draft {
  answers: Answers;
  index: number;
}
const store = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
export function openAttempt(chapter: number): string | null {
  try {
    return store()?.getItem(openKey(chapter)) ?? null;
  } catch {
    return null;
  }
}
export function rememberAttempt(chapter: number, attemptId: string | null) {
  try {
    if (attemptId) store()?.setItem(openKey(chapter), attemptId);
    else store()?.removeItem(openKey(chapter));
  } catch {
    /* Storage is optional. */
  }
}
export function readDraft(attemptId: string): Draft {
  try {
    const d = JSON.parse(store()?.getItem(draftKey(attemptId)) ?? 'null') as Draft | null;
    if (d && typeof d.index === 'number' && d.answers && typeof d.answers === 'object') return d;
  } catch {
    /* Storage is optional. */
  }
  return { answers: {}, index: 0 };
}
export function saveDraft(attemptId: string, d: Draft) {
  try {
    store()?.setItem(draftKey(attemptId), JSON.stringify(d));
  } catch {
    /* Storage is optional. */
  }
}
export function dropDraft(attemptId: string) {
  try {
    store()?.removeItem(draftKey(attemptId));
  } catch {
    /* Storage is optional. */
  }
}
export const words = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).length;
