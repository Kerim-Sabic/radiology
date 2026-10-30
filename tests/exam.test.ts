import { describe, expect, it } from 'vitest';
import {
  buildExam,
  examAvailable,
  examBlock,
  examEligible,
  examPool,
  examResultUrl,
  examScore,
  examUrl,
  isMarking,
  nextQuestion,
  questionSecondsLeft,
  waitWords,
  type CertExam,
} from '../src/services/exam';
import type { Attempt } from '../src/services/progressRepository';
import type { Task } from '../src/schema/content';

type Opts = { kind?: string; scoring?: string; modes?: string[]; targets?: string[]; options?: number };
const task = (id: string, caseId: string, o: Opts = {}) =>
  ({
    id,
    caseId,
    type: 'locate_finding',
    title: id,
    modes: o.modes ?? ['learn', 'practice', 'assess'],
    scoring: o.scoring ?? 'authoritative',
    grading:
      (o.kind ?? 'choice') === 'choice'
        ? { kind: 'choice', multiple: false, options: Array.from({ length: o.options ?? 3 }, (_, i) => ({ id: `o${i}`, text: `${i}`, correct: i === 0, why: '' })) }
        : { kind: o.kind },
    targets: (o.targets ?? []).map((targetId) => ({ targetId, name: targetId, required: true })),
  }) as unknown as Task;

/**
 * 60 chest patients (a three-answer question, a question marked on the image, and for every fifth one a two-answer
 * question; every third patient subtle), 12 head patients, 6 abdomen patients with three questions each, and
 * questions an exam must never ask: self-review, a machine outline, a Learn-only task, practice-only.
 */
function catalog() {
  const cases = new Map<string, unknown>();
  const tasksByCase = new Map<string, Task[]>();
  const add = (id: string, region: string[], tasks: Task[], subtle = false) => {
    cases.set(id, { id, region, difficulty: subtle ? 'subtle' : 'typical', subjectKey: id });
    tasksByCase.set(id, tasks);
  };
  for (let i = 0; i < 60; i++)
    add(
      `ch${i}`,
      ['chest'],
      [task(`ch${i}:a`, `ch${i}`), task(`ch${i}:b`, `ch${i}`, { kind: 'findings', targets: ['expert'] }), ...(i % 5 === 0 ? [task(`ch${i}:two`, `ch${i}`, { options: 2 })] : [])],
      i % 3 === 0,
    );
  for (let i = 0; i < 12; i++) add(`hd${i}`, ['head'], [task(`hd${i}:a`, `hd${i}`)]);
  for (let i = 0; i < 6; i++) add(`ab${i}`, ['abdomen', 'pelvis'], [task(`ab${i}:a`, `ab${i}`), task(`ab${i}:b`, `ab${i}`), task(`ab${i}:c`, `ab${i}`)]);
  add(
    'odd',
    ['chest'],
    [
      task('odd:self', 'odd', { kind: 'self_review', scoring: 'exploratory_self_review' }),
      task('odd:draft', 'odd', { kind: 'point_in_target', targets: ['draft'] }),
      task('odd:learn', 'odd', { modes: ['learn'] }),
      task('odd:practice', 'odd', { modes: ['practice'] }),
    ],
  );
  const targets = new Map([
    ['expert', { provenance: 'source_manual' }],
    ['draft', { provenance: 'ai_draft' }],
  ]);
  return { cases, tasksByCase, targets, holdoutGroup: (id: string) => id } as never;
}
const seq = (n = 0.37) => {
  let x = n;
  return () => (x = ((x * 9301 + 49297) % 233280) / 233280);
};
const taskOf = (id: string) => (catalog() as unknown as { tasksByCase: Map<string, Task[]> }).tasksByCase.get(id.split(':')[0])!.find((t) => t.id === id)!;
const subtle = (x: CertExam) => x.items.filter((it) => Number(it.caseId.slice(2)) % 3 === 0).length;

describe('certification exams', () => {
  it('asks only questions the app grades against an expert reference', () => {
    const c = catalog() as unknown as { tasksByCase: Map<string, Task[]> };
    expect(c.tasksByCase.get('odd')!.map((t) => examEligible(t, catalog()))).toEqual([false, false, false, false]);
    expect(examEligible(c.tasksByCase.get('ch1')![1], catalog())).toBe(true);
    expect(examPool(catalog(), 'chest').some((q) => q.caseId === 'odd')).toBe(false);
    expect(examPool(catalog(), 'abdomen')).toHaveLength(18);
  });

  it('counts a question on a scan of several areas for the area of what it marks', () => {
    const c = catalog() as unknown as { cases: Map<string, unknown>; tasksByCase: Map<string, Task[]>; targets: Map<string, unknown> };
    c.cases.set('wb', { id: 'wb', region: ['chest', 'abdomen', 'pelvis'], difficulty: 'typical', subjectKey: 'wb' });
    c.tasksByCase.set('wb', [task('wb:bowel', 'wb', { kind: 'labelled_points', targets: ['liver', 'colon'] }), task('wb:thymus', 'wb', { kind: 'point_in_target', targets: ['thymus'] }), task('wb:phase', 'wb')]);
    c.targets.set('liver', { provenance: 'source_manual', classId: 'anatomy:liver' });
    c.targets.set('colon', { provenance: 'source_manual', classId: 'anatomy:large_intestine' });
    c.targets.set('thymus', { provenance: 'source_manual', classId: 'anatomy:thymus' });
    const ids = (area: 'chest' | 'abdomen') => examPool(c as never, area).filter((q) => q.caseId === 'wb').map((q) => q.task.id);
    expect(ids('abdomen')).toEqual(['wb:bowel']);
    expect(ids('chest')).toEqual(['wb:thymus', 'wb:phase']);
    expect(examPool(c as never, 'all').filter((q) => q.caseId === 'wb').map((q) => q.area)).toEqual(['abdomen', 'chest', 'chest']);
  });

  it('makes each level harder: longer, more marked on the image, no coin tosses, subtle cases at the top', () => {
    const one = buildExam(catalog(), [], { area: 'chest', level: 1, rng: seq(), now: new Date('2026-10-30T08:00:00Z') });
    const two = buildExam(catalog(), [], { area: 'chest', level: 2, rng: seq() });
    const three = buildExam(catalog(), [], { area: 'chest', level: 3, rng: seq() });
    expect([one, two, three].map((e) => e.items.length)).toEqual([15, 25, 40]);
    expect(one.id).toBe(`exam-${new Date('2026-10-30T08:00:00Z').getTime().toString(36)}`);
    // One question per patient where the library allows.
    for (const e of [one, two, three]) expect(new Set(e.items.map((it) => it.caseId)).size).toBe(e.items.length);
    const marking = (e: CertExam) => e.items.filter((it) => isMarking(taskOf(it.taskId))).length;
    expect(marking(two)).toBeGreaterThanOrEqual(13);
    expect(marking(three)).toBeGreaterThanOrEqual(24);
    for (const e of [two, three]) expect(e.items.some((it) => it.taskId.endsWith(':two'))).toBe(false);
    // Foundation leans on typical cases; Advanced takes every subtle one (20 of the 60 patients).
    expect(subtle(one)).toBe(0);
    expect(subtle(three)).toBe(20);
  });

  it('takes a second and a third question from a patient only when a small area needs it', () => {
    // Abdomen: 6 patients with 3 questions each; Level 1 asks for 15.
    const e = buildExam(catalog(), [], { area: 'abdomen', level: 1, rng: seq() });
    expect(e.items).toHaveLength(15);
    const per = new Map<string, number>();
    for (const it of e.items) per.set(it.caseId, (per.get(it.caseId) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(3);
    expect(per.size).toBe(6);
    expect(examAvailable(catalog(), 'abdomen', 1)).toBe(true);
    // Level 2 needs 25 questions, half of them marked on the image: this small area cannot fill it.
    expect(examAvailable(catalog(), 'abdomen', 2)).toBe(false);
    expect(examAvailable(catalog(), 'chest', 3)).toBe(true);
  });

  it('brings questions not answered before first', () => {
    const done = Array.from({ length: 40 }, (_, i) => ({ taskId: `ch${i}:a`, submittedAt: 'x' }) as Attempt);
    const e = buildExam(catalog(), done, { area: 'chest', level: 1, rng: seq() });
    expect(e.items.some((it) => done.some((a) => a.taskId === it.taskId))).toBe(false);
  });

  it('shares the whole-library exam out across the body areas', () => {
    const e = buildExam(catalog(), [], { area: 'all', level: 1, rng: seq() });
    expect(e.items).toHaveLength(30);
    const areas = new Map<string, number>();
    for (const it of e.items) areas.set(it.area, (areas.get(it.area) ?? 0) + 1);
    expect([...areas.keys()].sort()).toEqual(['abdomen', 'chest', 'head']);
    expect(Math.min(...areas.values())).toBeGreaterThanOrEqual(6);
    // Only three body areas exist in this library: the higher levels ask for four and five.
    expect(examAvailable(catalog(), 'all', 1)).toBe(true);
    expect(examAvailable(catalog(), 'all', 2)).toBe(false);
  });

  const answered = (e: CertExam, outcomes: Array<string | null>, timedOut: number[] = []) => {
    const attempts: Attempt[] = [];
    const exam: CertExam = {
      ...e,
      items: e.items.map((it, i) => {
        if (timedOut.includes(i)) return { ...it, submittedAt: 'x', timedOut: true };
        if (outcomes[i] === null || outcomes[i] === undefined) return it;
        attempts.push({ id: `a${i}`, taskId: it.taskId, holdoutGroup: it.caseId, submittedAt: 'x', grade: { outcome: outcomes[i] } } as unknown as Attempt);
        return { ...it, submittedAt: 'x', attemptId: `a${i}` };
      }),
    };
    return { exam, attempts };
  };

  it('scores correct 1 and partly right ½ at Foundation, against the pass mark', () => {
    const e = buildExam(catalog(), [], { area: 'chest', level: 1, rng: seq(), id: 'exam-x' });
    expect(examUrl(e, 0)).toBe(`/read/${e.items[0].caseId}?task=${encodeURIComponent(e.items[0].taskId)}&mode=assess&exam=exam-x`);
    expect(examResultUrl(e)).toBe('/certificates/exam/exam-x');
    // 9 correct + 3 partly right = 10.5 of 15 = 70%.
    const outcomes = [...Array(9).fill('correct'), 'partial', 'partial', 'partial', 'incorrect', null];
    const { exam, attempts } = answered(e, outcomes, [13]);
    expect(nextQuestion(exam)).toBe(14);
    const r = examScore(exam, attempts);
    expect(r.points).toBe(10.5);
    expect(r.passed).toBe(true);
    expect(r.answered).toBe(13);
    expect(r.rows.map((x) => x.result).slice(-3)).toEqual(['incorrect', 'timeout', 'unanswered']);
  });

  it('gives no half points at Advanced, where 90% must be fully right', () => {
    const e = buildExam(catalog(), [], { area: 'chest', level: 3, rng: seq() });
    const pass = answered(e, [...Array(36).fill('correct'), ...Array(4).fill('partial')]);
    expect(examScore(pass.exam, pass.attempts)).toMatchObject({ points: 36, passed: true });
    const fail = answered(e, [...Array(35).fill('correct'), ...Array(5).fill('partial')]);
    expect(examScore(fail.exam, fail.attempts)).toMatchObject({ points: 35, passed: false });
  });

  it('runs a clock for each question from Level 2', () => {
    const one = buildExam(catalog(), [], { area: 'chest', level: 1, rng: seq() });
    expect(questionSecondsLeft(one, one.items[0])).toBeNull();
    const three = buildExam(catalog(), [], { area: 'chest', level: 3, rng: seq() });
    const opened = { ...three.items[0], startedAt: '2026-10-30T08:00:00.000Z' };
    expect(questionSecondsLeft(three, three.items[0])).toBe(120);
    expect(questionSecondsLeft(three, opened, Date.parse('2026-10-30T08:01:30.000Z'))).toBe(30);
    expect(questionSecondsLeft(three, opened, Date.parse('2026-10-30T08:03:00.000Z'))).toBeLessThanOrEqual(0);
  });

  it('takes the levels in order, and makes you wait before trying a failed higher level again', () => {
    const now = Date.parse('2026-10-30T12:00:00.000Z');
    expect(examBlock('chest', 1, [], [], [], now)).toBeNull();
    expect(examBlock('chest', 2, [], [], [], now)?.text).toBe('Get the Level 1 certificate first.');
    expect(examBlock('chest', 2, [{ area: 'head', level: 1 }], [], [], now)?.reason).toBe('order');
    expect(examBlock('chest', 2, [{ area: 'chest', level: 1, status: 'revoked' }], [], [], now)?.reason).toBe('order');
    expect(examBlock('chest', 2, [{ area: 'chest', level: 1 }], [], [], now)).toBeNull();
    const held = [{ area: 'chest', level: 1 }, { area: 'chest', level: 2 }];
    // A level held is not taken again (a certificate is issued once).
    expect(examBlock('chest', 2, held, [], [], now)?.reason).toBe('held');
    // A failed Advanced exam an hour ago: 23 hours to wait. A failed Foundation exam: none.
    const failed3 = { ...buildExam(catalog(), [], { area: 'chest', level: 3, rng: seq() }), finishedAt: '2026-10-30T11:00:00.000Z' };
    expect(examBlock('chest', 3, held, [failed3], [], now)).toEqual({ reason: 'wait', until: Date.parse('2026-10-31T11:00:00.000Z'), text: 'You can try again in 23 h.' });
    expect(examBlock('chest', 3, held, [failed3], [], Date.parse('2026-10-31T11:00:01.000Z'))).toBeNull();
    const failed1 = { ...buildExam(catalog(), [], { area: 'chest', level: 1, rng: seq() }), finishedAt: '2026-10-30T11:59:00.000Z' };
    expect(examBlock('chest', 1, [], [failed1], [], now)).toBeNull();
    expect(waitWords(61 * 60_000)).toBe('1 h 1 min');
    expect(waitWords(30_000)).toBe('1 min');
  });
});
