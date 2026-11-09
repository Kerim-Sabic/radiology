/**
 * Book exams: one exam for each of chapters 1-13 of Learning Radiology, with multiple-choice questions and short-essay
 * questions on real images. The question bank lives on the server (server/data/bookExams/chNN.json) and is never sent
 * to the app with its answers: the app gets the questions, the server grades them. This file holds the shape of the
 * bank, what the app may see of a question, and the pure scoring rules (shared by the server and its tests).
 */
import { z } from 'zod';

export const BOOK_EXAM_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const MCQ_POINTS = 1;
/** Fraction of the points that counts as a pass in the exam's result. */
export const PASS_MARK = 0.7;
/** An essay answer shorter than this earns no points: a few words are not an answer. */
export const MIN_ESSAY_WORDS = 12;
export const MAX_ESSAY_CHARS = 1200;

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^c(0[1-9]|1[0-3])-[me]\d{2}$/);

export const BankImage = z.object({
  packId: z.string().regex(/^[a-z0-9-]+$/),
  caseId: z.string().min(1).max(80),
  /** The case's own series thumbnail, relative to /packs/ (checked against the pack by the tests). */
  thumb: z.string().regex(/^[a-z0-9-]+\/thumbs\/[A-Za-z0-9_.-]+\.(png|webp|jpg)$/),
  /** Neutral: modality and view only. Never the diagnosis, never a patient's identity. */
  caption: text(90),
});

export const BankMcq = z
  .object({
    id,
    type: z.literal('mcq'),
    topic: text(20),
    prompt: text(1000),
    options: z.array(text(500)).length(4),
    /** Index of the one best answer in `options`. */
    answer: z.number().int().min(0).max(3),
    explanation: text(1600),
    /** Where the book teaches this: "Chapter N, section name". */
    book: text(160),
    /** Checklist items (see the chapter's `checklist`) this question covers. */
    covers: z.array(z.string().regex(/^t\d{2}$/)).min(1).max(6),
    level: z.enum(['recall', 'image', 'next', 'hard']),
    /** A case in the app that shows this (opens in the reading room after the exam). */
    lesson: z.string().max(80).optional(),
  })
  .strict();

/** One idea an essay should contain: any one of `terms` (a word or a phrase, matched from the start of a word) earns the points. */
export const RubricItem = z.object({ id: z.string().regex(/^r\d$/), label: text(320), points: z.number().int().min(1).max(3), terms: z.array(text(60)).min(1).max(30) }).strict();

export const BankEssay = z
  .object({
    id,
    type: z.literal('essay'),
    topic: text(20),
    prompt: text(1100),
    images: z.array(BankImage).min(5).max(6),
    rubric: z.array(RubricItem).min(3).max(8),
    model: text(2200),
    book: text(160),
    covers: z.array(z.string().regex(/^t\d{2}$/)).min(1).max(10),
  })
  .strict();

export const BankQuestion = z.discriminatedUnion('type', [BankMcq, BankEssay]);
export const BankChapter = z
  .object({
    chapter: z.number().int().min(1).max(13),
    title: text(140),
    blurb: text(300),
    /** Everything the book teaches in the chapter that the exam must cover: headings, definitions, signs, classifications, measurements, next steps. */
    checklist: z.array(z.object({ id: z.string().regex(/^t\d{2}$/), label: text(400) }).strict()).min(8).max(70),
    questions: z.array(BankQuestion).min(14).max(30),
  })
  .strict();

export type BankImage = z.infer<typeof BankImage>;
export type BankMcq = z.infer<typeof BankMcq>;
export type BankEssay = z.infer<typeof BankEssay>;
export type BankQuestion = z.infer<typeof BankQuestion>;
export type BankChapter = z.infer<typeof BankChapter>;

export const essayPoints = (q: BankEssay) => q.rubric.reduce((n, r) => n + r.points, 0);
export const chapterPoints = (c: BankChapter) => c.questions.reduce((n, q) => n + (q.type === 'mcq' ? MCQ_POINTS : essayPoints(q)), 0);

/** What the app is given of a question while the exam is open: no answer, no explanation, no rubric. */
export type OpenQuestion =
  | { id: string; type: 'mcq'; prompt: string; options: string[] }
  | { id: string; type: 'essay'; prompt: string; images: Array<{ thumb: string; caption: string }>; points: number; minWords: number };

export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).length;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normal = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').replace(/[’‘`]/g, "'");

/** Whether an essay mentions the idea: any term, found from the start of a word (so "enlarg" finds "enlarged"). */
export function mentions(answer: string, terms: string[]): boolean {
  const a = normal(answer);
  return terms.some((t) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(normal(t))}`, 'u').test(a));
}

/** The rubric items an answer covers. An answer under the minimum length covers none. */
export function rubricHits(answer: string, rubric: BankEssay['rubric']): string[] {
  if (wordCount(answer) < MIN_ESSAY_WORDS) return [];
  return rubric.filter((r) => mentions(answer, r.terms)).map((r) => r.id);
}

export const rubricPoints = (hits: string[], rubric: BankEssay['rubric']) => rubric.filter((r) => hits.includes(r.id)).reduce((n, r) => n + r.points, 0);

/** The shuffled order options are shown in (a permutation of 0-3), from random numbers in [0,1). */
export function shuffled(rng: () => number): number[] {
  const o = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

export interface ChapterRecord {
  best: number;
  bestPoints: number;
  last: number;
  attempts: number;
  lastAt: string;
  lastAttempt: string;
}
export const percent = (points: number, total: number) => (total ? Math.round((points / total) * 100) : 0);
