import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import {
  BOOK_EXAM_CHAPTERS, BankChapter, MAX_ESSAY_CHARS, MCQ_POINTS, MIN_ESSAY_WORDS, PASS_MARK, chapterPoints, essayPoints, percent, rubricHits, rubricPoints, shuffled,
  type BankQuestion, type ChapterRecord, type OpenQuestion,
} from '../shared/bookExams.js';

/**
 * Book exams on the server: chapters 1-13 of Learning Radiology. The server holds the question bank (answers,
 * explanations, essay rubrics and model answers), starts each exam with its own shuffle of the options, grades the
 * multiple-choice answers and scores each essay against its rubric (keywords, no outside service). A learner sees the
 * explanations, rubric and model answer only after finishing. The essays a learner wrote are kept for that learner
 * alone, for 90 days. Who may take them is decided by the caller (a membership and the book).
 */
const bank = new Map<number, BankChapter>();
export function chapterBank(n: number): BankChapter | null {
  if (!(BOOK_EXAM_CHAPTERS as readonly number[]).includes(n)) return null;
  let c = bank.get(n);
  if (!c) {
    c = BankChapter.parse(JSON.parse(readFileSync(new URL(`./data/bookExams/ch${String(n).padStart(2, '0')}.json`, import.meta.url), 'utf8')));
    bank.set(n, c);
  }
  return c;
}

const NINETY_DAYS = 90 * 86_400;
const attemptKey = (id: string) => `rvm:bookexam:a:${id}`;
const recordKey = (userId: string) => `rvm:bookexam:u:${userId}`;
const idOk = (id: unknown): id is string => typeof id === 'string' && /^bx-[a-f0-9]{24}$/.test(id);

interface QuestionResult {
  id: string;
  /** mcq: the index (in the order shown) the learner chose, or null. essay: the written answer. */
  picked?: number | null;
  answer?: string;
  /** The rubric items the answer mentioned (as found by the server), and those the learner confirmed afterwards. */
  hits?: string[];
  checked?: string[];
  earned: number;
}
interface Attempt {
  id: string;
  userId: string;
  chapter: number;
  startedAt: string;
  finishedAt: string | null;
  qids: string[];
  /** For each multiple-choice question: option positions as shown (position i shows original option order[i]). */
  order: Record<string, number[]>;
  results?: QuestionResult[];
  points?: number;
}
interface UserRecord {
  chapters: Record<string, ChapterRecord>;
}

const openForm = (q: BankQuestion, order: Record<string, number[]>): OpenQuestion =>
  q.type === 'mcq'
    ? { id: q.id, type: 'mcq', prompt: q.prompt, options: order[q.id].map((i) => q.options[i]) }
    : { id: q.id, type: 'essay', prompt: q.prompt, images: q.images.map((i) => ({ thumb: `/packs/${i.thumb}`, caption: i.caption })), points: essayPoints(q), minWords: MIN_ESSAY_WORDS };

/** Everything about a finished exam the learner may see: every question with its answer, explanation, rubric and model answer. */
function report(a: Attempt) {
  const c = chapterBank(a.chapter)!;
  const total = chapterPoints(c);
  const questions = a.qids.map((qid) => {
    const q = c.questions.find((x) => x.id === qid)!;
    const r = a.results!.find((x) => x.id === qid)!;
    if (q.type === 'mcq') {
      const order = a.order[qid];
      return { id: qid, type: 'mcq' as const, level: q.level, prompt: q.prompt, options: order.map((i) => q.options[i]), picked: r.picked ?? null, correct: order.indexOf(q.answer), explanation: q.explanation, book: q.book, lesson: q.lesson ?? null, earned: r.earned, max: MCQ_POINTS };
    }
    const shown = r.checked ?? r.hits ?? [];
    return {
      id: qid, type: 'essay' as const, prompt: q.prompt, images: q.images.map((i) => ({ thumb: `/packs/${i.thumb}`, caption: i.caption })),
      answer: r.answer ?? '', rubric: q.rubric.map((x) => ({ id: x.id, label: x.label, points: x.points, found: (r.hits ?? []).includes(x.id), confirmed: shown.includes(x.id) })),
      model: q.model, book: q.book, earned: r.earned, max: essayPoints(q), selfChecked: !!r.checked,
    };
  });
  const points = a.results!.reduce((n, r) => n + r.earned, 0);
  return { attemptId: a.id, chapter: a.chapter, title: c.title, finishedAt: a.finishedAt, points, total, percent: percent(points, total), passed: points / total >= PASS_MARK, questions };
}

async function loadAttempt(userId: string, id: unknown): Promise<Attempt | null> {
  if (!idOk(id)) return null;
  const a = await db().get<Attempt>(attemptKey(id));
  return a && a.userId === userId ? a : null;
}

/** The chapters, each with the learner's best and last result. */
export async function listExams(userId: string) {
  const rec = (await db().get<UserRecord>(recordKey(userId))) ?? { chapters: {} };
  return {
    passMark: PASS_MARK,
    chapters: BOOK_EXAM_CHAPTERS.map((n) => {
      const c = chapterBank(n)!;
      return { chapter: n, title: c.title, blurb: c.blurb, mcq: c.questions.filter((q) => q.type === 'mcq').length, essays: c.questions.filter((q) => q.type === 'essay').length, points: chapterPoints(c), record: rec.chapters[String(n)] ?? null };
    }),
  };
}

const Start = z.object({ chapter: z.number().int() }).strict();
/** Starts an exam on a chapter: the questions as the app may see them, options in this attempt's own order. */
export async function startExam(userId: string, body: unknown, now = new Date(), rng = Math.random) {
  const p = Start.safeParse(body);
  const c = p.success ? chapterBank(p.data.chapter) : null;
  if (!p.success || !c) return { ok: false as const, error: 'Choose a chapter from 1 to 13.' };
  const order: Record<string, number[]> = {};
  for (const q of c.questions) if (q.type === 'mcq') order[q.id] = shuffled(rng);
  const a: Attempt = { id: `bx-${randomBytes(12).toString('hex')}`, userId, chapter: c.chapter, startedAt: now.toISOString(), finishedAt: null, qids: c.questions.map((q) => q.id), order };
  await db().set(attemptKey(a.id), a, { ex: NINETY_DAYS });
  return { ok: true as const, attemptId: a.id, chapter: c.chapter, title: c.title, startedAt: a.startedAt, questions: c.questions.map((q) => openForm(q, order)) };
}

/** An exam of this learner: its questions to carry on (not finished), or its result (finished). */
export async function getAttempt(userId: string, id: unknown) {
  const a = await loadAttempt(userId, id);
  if (!a) return { ok: false as const, error: 'That exam was not found. It may be older than 90 days.' };
  if (a.finishedAt) return { ok: true as const, finished: true as const, result: report(a) };
  const c = chapterBank(a.chapter)!;
  return { ok: true as const, finished: false as const, attemptId: a.id, chapter: a.chapter, title: c.title, startedAt: a.startedAt, questions: c.questions.map((q) => openForm(q, a.order)) };
}

const Finish = z.object({ attemptId: z.string(), answers: z.record(z.string().max(12), z.union([z.number().int().min(0).max(3), z.string().max(MAX_ESSAY_CHARS), z.null()])).refine((o) => Object.keys(o).length <= 40) }).strict();

/** Credits this attempt to the learner's record of the chapter. */
async function record(userId: string, a: Attempt, points: number, total: number, firstTime: boolean) {
  const rec = (await db().get<UserRecord>(recordKey(userId))) ?? { chapters: {} };
  const key = String(a.chapter);
  const cur = rec.chapters[key];
  const pct = percent(points, total);
  rec.chapters[key] = {
    best: Math.max(cur?.best ?? 0, pct),
    bestPoints: Math.max(cur?.bestPoints ?? 0, points),
    last: pct,
    attempts: (cur?.attempts ?? 0) + (firstTime ? 1 : 0),
    lastAt: a.finishedAt!,
    lastAttempt: a.id,
  };
  await db().set(recordKey(userId), rec);
}

/** Grades an exam: unanswered questions earn nothing. Finishing again returns the same result. */
export async function finishExam(userId: string, body: unknown, now = new Date()) {
  const p = Finish.safeParse(body);
  const a = p.success ? await loadAttempt(userId, p.data.attemptId) : null;
  if (!p.success || !a) return { ok: false as const, error: 'That exam was not found.' };
  if (a.finishedAt) return { ok: true as const, result: report(a) };
  const c = chapterBank(a.chapter)!;
  a.results = c.questions.map((q): QuestionResult => {
    const given = p.data.answers[q.id];
    if (q.type === 'mcq') {
      const picked = typeof given === 'number' ? given : null;
      return { id: q.id, picked, earned: picked !== null && a.order[q.id][picked] === q.answer ? MCQ_POINTS : 0 };
    }
    const answer = typeof given === 'string' ? given.trim() : '';
    const hits = rubricHits(answer, q.rubric);
    return { id: q.id, answer, hits, earned: rubricPoints(hits, q.rubric) };
  });
  a.points = a.results.reduce((n, r) => n + r.earned, 0);
  a.finishedAt = now.toISOString();
  await db().set(attemptKey(a.id), a, { ex: NINETY_DAYS });
  await record(userId, a, a.points, chapterPoints(c), true);
  return { ok: true as const, result: report(a) };
}

const Review = z.object({ attemptId: z.string(), questionId: z.string(), checked: z.array(z.string().regex(/^r\d$/)).max(6) }).strict();
/**
 * The learner's own check of an essay against the rubric, once the exam is finished: the keyword match is a first
 * estimate, and the learner knows what they meant. The essay's points follow the items they confirm.
 */
export async function reviewEssay(userId: string, body: unknown) {
  const p = Review.safeParse(body);
  const a = p.success ? await loadAttempt(userId, p.data.attemptId) : null;
  if (!p.success || !a || !a.finishedAt || !a.results) return { ok: false as const, error: 'That exam was not found.' };
  const q = chapterBank(a.chapter)!.questions.find((x) => x.id === p.data.questionId);
  const r = a.results.find((x) => x.id === p.data.questionId);
  if (!q || q.type !== 'essay' || !r) return { ok: false as const, error: 'That essay was not found.' };
  const known = new Set(q.rubric.map((x) => x.id));
  r.checked = [...new Set(p.data.checked)].filter((x) => known.has(x));
  r.earned = rubricPoints(r.checked, q.rubric);
  a.points = a.results.reduce((n, x) => n + x.earned, 0);
  await db().set(attemptKey(a.id), a, { ex: NINETY_DAYS });
  // The record's "last" follows the attempt it points to; the best only goes up (a stricter self-check does not take a result away).
  const rec = (await db().get<UserRecord>(recordKey(userId))) ?? { chapters: {} };
  const cur = rec.chapters[String(a.chapter)];
  if (cur?.lastAttempt === a.id) await record(userId, a, a.points, chapterPoints(chapterBank(a.chapter)!), false);
  return { ok: true as const, result: report(a) };
}
