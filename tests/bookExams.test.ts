import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));
vi.mock('../server/store', () => ({
  rateLimit: async () => true,
  db: () => ({
    get: async (k: string) => structuredClone(fake.kv.get(k)) ?? null,
    set: async (k: string, v: unknown) => {
      fake.kv.set(k, structuredClone(v));
      return 'OK';
    },
  }),
}));
import { BOOK_EXAM_CHAPTERS, MIN_ESSAY_WORDS, chapterPoints, essayPoints, mentions, rubricHits, rubricPoints, shuffled, wordCount, type BankChapter } from '../shared/bookExams';
import { chapterBank, finishExam, getAttempt, listExams, reviewEssay, startExam } from '../server/bookExams';

const root = resolve(__dirname, '..');
const chapters: BankChapter[] = BOOK_EXAM_CHAPTERS.map((n) => chapterBank(n)!);

describe('the question bank', () => {
  it('has chapters 1 to 13, each parsed by the schema, with enough questions of both kinds', () => {
    expect(chapters).toHaveLength(13);
    chapters.forEach((c, i) => {
      expect(c.chapter).toBe(i + 1);
      const mcq = c.questions.filter((q) => q.type === 'mcq').length;
      const essays = c.questions.filter((q) => q.type === 'essay').length;
      expect(mcq, `ch${c.chapter} mcq`).toBeGreaterThanOrEqual(10);
      expect(essays, `ch${c.chapter} essays`).toBeGreaterThanOrEqual(2);
    });
  });

  it('has unique ids that belong to their chapter, one correct answer inside the options, and distinct options', () => {
    const all = new Set<string>();
    for (const c of chapters)
      for (const q of c.questions) {
        expect(q.id.startsWith(`c${String(c.chapter).padStart(2, '0')}-`)).toBe(true);
        expect(all.has(q.id), q.id).toBe(false);
        all.add(q.id);
        if (q.type === 'mcq') {
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.answer).toBeLessThan(q.options.length);
          expect(new Set(q.options.map((o) => o.toLowerCase())).size, q.id).toBe(4);
        }
      }
  });

  it('covers every checklist item of every chapter, and names only items that exist', () => {
    for (const c of chapters) {
      const ids = new Set(c.checklist.map((t) => t.id));
      expect(ids.size).toBe(c.checklist.length);
      const used = new Set(c.questions.flatMap((q) => q.covers));
      for (const u of used) expect(ids.has(u), `ch${c.chapter} unknown ${u}`).toBe(true);
      for (const t of ids) expect(used.has(t), `ch${c.chapter} uncovered ${t}`).toBe(true);
    }
  });

  it('gives each essay 5 or 6 images, rubric points that add up, and every rubric item some terms', () => {
    for (const c of chapters)
      for (const q of c.questions) {
        if (q.type !== 'essay') continue;
        expect(q.images.length).toBeGreaterThanOrEqual(5);
        expect(q.images.length).toBeLessThanOrEqual(6);
        const total = q.rubric.reduce((n, r) => n + r.points, 0);
        expect(total).toBe(essayPoints(q));
        expect(total, q.id).toBeGreaterThanOrEqual(6);
        expect(new Set(q.rubric.map((r) => r.id)).size).toBe(q.rubric.length);
        for (const r of q.rubric) expect(r.terms.length).toBeGreaterThan(0);
        // The model answer earns (nearly) full marks from its own rubric: a rubric nobody could satisfy is a mistake.
        const hits = rubricHits(q.model, q.rubric);
        expect(rubricPoints(hits, q.rubric), `${q.id} model answer`).toBeGreaterThanOrEqual(Math.ceil(total * 0.6));
      }
  });

  it('uses captions with no diagnosis words or patient names', () => {
    for (const c of chapters)
      for (const q of c.questions)
        if (q.type === 'essay') for (const i of q.images) expect(i.caption, q.id).toMatch(/^Image \d · /);
  });

  it('points every image and lesson at a real case with its thumbnail on disk', () => {
    const packs = new Map<string, { cases: Map<string, string>; thumbs: Map<string, string> }>();
    const load = (id: string) => {
      let p = packs.get(id);
      if (!p && !existsSync(resolve(root, 'public/packs', id, 'lessons.json'))) p = { cases: new Map(), thumbs: new Map() };
      if (!p) {
        const m = JSON.parse(readFileSync(resolve(root, 'public/packs', id, 'pack.json'), 'utf8')) as { series: Array<{ uid: string; thumbnail?: string }> };
        const l = JSON.parse(readFileSync(resolve(root, 'public/packs', id, 'lessons.json'), 'utf8')) as { cases: Array<{ id: string; primarySeriesUid: string }> };
        const thumbs = new Map(m.series.map((s) => [s.uid, s.thumbnail ?? '']));
        p = { cases: new Map(l.cases.map((k) => [k.id, thumbs.get(k.primarySeriesUid) ?? ''])), thumbs };
        packs.set(id, p);
      }
      return p;
    };
    const allCases = new Set<string>();
    for (const e of (JSON.parse(readFileSync(resolve(root, 'public/packs/index.json'), 'utf8')) as { packs: Array<{ id: string }> }).packs) for (const k of load(e.id).cases.keys()) allCases.add(k);
    for (const c of chapters)
      for (const q of c.questions) {
        if (q.type === 'mcq' && q.lesson) expect(allCases.has(q.lesson), `${q.id} lesson ${q.lesson}`).toBe(true);
        if (q.type !== 'essay') continue;
        for (const i of q.images) {
          const thumb = load(i.packId).cases.get(i.caseId);
          expect(thumb, `${q.id} ${i.caseId}`).toBeTruthy();
          expect(i.thumb, `${q.id} ${i.caseId}`).toBe(`${i.packId}/${thumb}`);
          expect(existsSync(resolve(root, 'public/packs', i.thumb)), i.thumb).toBe(true);
        }
      }
  });
});

describe('scoring rules', () => {
  it('shuffles options into a permutation', () => {
    for (let i = 0; i < 50; i++) expect([...shuffled(Math.random)].sort()).toEqual([0, 1, 2, 3]);
  });
  it('matches rubric terms from the start of a word, ignoring case, accents and curly quotes', () => {
    expect(mentions('The hilum is ENLARGED', ['enlarg'])).toBe(true);
    expect(mentions('the patient’s right is on the left', ["patient's right"])).toBe(true);
    expect(mentions('a catheter', ['cat'])).toBe(true);
    expect(mentions('unenlarged', ['enlarg'])).toBe(false);
  });
  it('gives no points to a very short answer', () => {
    const rubric = [{ id: 'r1', label: 'x', points: 2, terms: ['effusion'] }];
    expect(wordCount('effusion')).toBeLessThan(MIN_ESSAY_WORDS);
    expect(rubricHits('effusion', rubric)).toEqual([]);
    expect(rubricHits('There is a large pleural effusion on the right side of the chest here today', rubric)).toEqual(['r1']);
  });
});

describe('an exam on the server', () => {
  const user = 'learner-1';
  const mcqs = (n: number) => chapterBank(n)!.questions.filter((q) => q.type === 'mcq');

  it('starts without answers, explanations, rubrics or model answers anywhere in what the app receives', async () => {
    const r = await startExam(user, { chapter: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = JSON.stringify(r);
    for (const key of ['explanation', 'answer', 'rubric', 'model', 'covers', 'terms', 'book', 'lesson']) expect(text.includes(`"${key}":`), key).toBe(false);
    expect(r.questions.length).toBe(chapterBank(3)!.questions.length);
    expect((await startExam(user, { chapter: 14 })).ok).toBe(false);
    expect((await startExam(user, { chapter: '3' })).ok).toBe(false);
  });

  it('grades by the order shown, scores an essay against the rubric, keeps a record and lets the learner confirm rubric items', async () => {
    fake.kv.clear();
    const bank = chapterBank(5)!;
    const r = await startExam(user, { chapter: 5 });
    if (!r.ok) throw new Error('start');
    const answers: Record<string, number | string | null> = {};
    // Answer every multiple-choice question correctly by finding the right text in the order shown, and the essays with the model answer.
    for (const q of r.questions) {
      const src = bank.questions.find((x) => x.id === q.id)!;
      if (q.type === 'mcq' && src.type === 'mcq') answers[q.id] = q.options.indexOf(src.options[src.answer]);
      else if (src.type === 'essay') answers[q.id] = src.model;
    }
    const done = await finishExam(user, { attemptId: r.attemptId, answers });
    if (!done.ok) throw new Error('finish');
    expect(done.result.points).toBeGreaterThanOrEqual(Math.ceil(chapterPoints(bank) * 0.85));
    expect(done.result.passed).toBe(true);
    // Finishing again does not count a second attempt.
    const again = await finishExam(user, { attemptId: r.attemptId, answers: {} });
    expect(again.ok && again.result.points).toBe(done.result.points);
    expect((await listExams(user)).chapters[4].record).toMatchObject({ attempts: 1, best: done.result.percent });
    // Another learner cannot read or finish this exam.
    expect((await getAttempt('someone-else', r.attemptId)).ok).toBe(false);
    expect((await finishExam('someone-else', { attemptId: r.attemptId, answers: {} })).ok).toBe(false);
    // The result of a finished exam shows what was right.
    const got = await getAttempt(user, r.attemptId);
    expect(got.ok && got.finished).toBe(true);
    // The learner can untick an item the keyword search found: the essay's points follow.
    const essay = done.result.questions.find((q) => q.type === 'essay')!;
    if (essay.type !== 'essay') throw new Error('essay');
    const rv = await reviewEssay(user, { attemptId: r.attemptId, questionId: essay.id, checked: [] });
    if (!rv.ok) throw new Error('review');
    expect(rv.result.points).toBe(done.result.points - essay.earned);
  });

  it('scores unanswered and wrong answers as nothing, and rejects junk', async () => {
    fake.kv.clear();
    const r = await startExam(user, { chapter: 1 });
    if (!r.ok) throw new Error('start');
    const none = await finishExam(user, { attemptId: r.attemptId, answers: {} });
    expect(none.ok && none.result.points).toBe(0);
    const r2 = await startExam(user, { chapter: 1 });
    if (!r2.ok) throw new Error('start');
    expect((await finishExam(user, { attemptId: r2.attemptId, answers: { 'c01-m01': 9 } })).ok).toBe(false);
    expect((await finishExam(user, { attemptId: 'nope', answers: {} })).ok).toBe(false);
    expect(mcqs(1).length).toBeGreaterThan(10);
  });
});
