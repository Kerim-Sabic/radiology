import { describe, expect, it } from 'vitest';
import { buildShift, itemResult, nextItem, oncallTaskFor, secondsLeft, shiftPool, shiftScore, type OncallShift } from '../src/services/oncall';
import type { Attempt } from '../src/services/progressRepository';
import type { Task } from '../src/schema/content';

const task = (id: string, caseId: string, type: string, modes = ['practice', 'assess']) => ({ id, caseId, type, modes, title: id }) as unknown as Task;

/** Five patients: A has two studies (cases A1, A2); E is a brain case; D has only an anatomy task. */
function catalog() {
  const cases = new Map(
    [
      ['A1', 'A', ['chest']],
      ['A2', 'A', ['chest']],
      ['B', 'B', ['chest']],
      ['C', 'C', ['abdomen', 'pelvis']],
      ['D', 'D', ['chest']],
      ['E', 'E', ['head']],
    ].map(([id, group, region]) => [id as string, { id, group, region } as never]),
  );
  const tasksByCase = new Map<string, Task[]>([
    ['A1', [task('A1:anat', 'A1', 'find_structure'), task('A1:read', 'A1', 'locate_finding'), task('A1:all', 'A1', 'whole_study')]],
    ['A2', [task('A2:read', 'A2', 'describe_finding')]],
    ['B', [task('B:diff', 'B', 'differential'), task('B:learn', 'B', 'whole_study', ['learn'])]],
    ['C', [task('C:read', 'C', 'locate_finding')]],
    ['D', [task('D:anat', 'D', 'find_structure')]],
    ['E', [task('E:read', 'E', 'locate_finding')]],
  ]);
  return { cases, tasksByCase, holdoutGroup: (id: string) => (cases.get(id) as unknown as { group: string }).group } as never;
}
const attempt = (o: Partial<Attempt>) => ({ id: 'x', holdoutGroup: 'A', submittedAt: '2026-10-28T10:00:00Z', grade: null, selfReview: null, ...o }) as Attempt;

describe('on-call shifts', () => {
  it('reads each case by its broadest assessable reading task, never an anatomy-only or learn-only task', () => {
    const tasksOf = (id: string) => (catalog() as unknown as { tasksByCase: Map<string, Task[]> }).tasksByCase.get(id)!;
    expect(oncallTaskFor(tasksOf('A1'))!.id).toBe('A1:all');
    expect(oncallTaskFor([task('B:learn', 'B', 'whole_study', ['learn'])])).toBeNull();
    expect(oncallTaskFor([task('D:anat', 'D', 'find_structure')])).toBeNull();
  });

  it('takes one case per patient, patients you have not read first, and filters by region', () => {
    const c = catalog();
    expect(shiftPool(c, 'all').size).toBe(4); // A, B, C, E — D has no reading task
    expect([...shiftPool(c, 'chest').keys()].sort()).toEqual(['A', 'B']);
    expect([...shiftPool(c, 'head').keys()]).toEqual(['E']);
    const s = buildShift(c, [attempt({ holdoutGroup: 'A' }), attempt({ holdoutGroup: 'B' })], { count: 2, region: 'all', minutesPerCase: 4, rng: () => 0.3 });
    expect(s.items).toHaveLength(2);
    expect(new Set(s.items.map((i) => i.caseId))).toEqual(new Set(['C', 'E'])); // unseen first
    expect(s.items.every((i) => !i.seenBefore && !i.startedAt && !i.submittedAt)).toBe(true);
    const all = buildShift(c, [attempt({ holdoutGroup: 'A' })], { count: 10, region: 'all', minutesPerCase: null });
    expect(all.items).toHaveLength(4);
    expect(all.items.filter((i) => i.caseId.startsWith('A'))).toHaveLength(1);
    expect(all.items.find((i) => i.caseId.startsWith('A'))!.seenBefore).toBe(true);
  });

  it('runs the clock from when a case was opened, and goes negative over time', () => {
    const s = { minutesPerCase: 4, items: [] } as unknown as OncallShift;
    const it = { startedAt: '2026-10-28T10:00:00Z', submittedAt: null } as never;
    expect(secondsLeft(s, it, Date.parse('2026-10-28T10:01:00Z'))).toBe(180);
    expect(secondsLeft(s, it, Date.parse('2026-10-28T10:05:00Z'))).toBe(-60);
    expect(secondsLeft({ ...s, minutesPerCase: null }, it)).toBeNull();
  });

  it('scores correct 1 and partly right ½, uses your verdict for self-review, and leaves unjudged answers out of the score', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      caseId: id,
      taskId: id,
      startedAt: '2026-10-28T10:00:00Z',
      submittedAt: i < 4 ? `2026-10-28T10:0${i + 1}:00Z` : null,
      attemptId: i < 4 ? id : null,
      overTime: i === 3,
      seenBefore: false,
    }));
    const shift = { id: 's', startedAt: '', finishedAt: null, minutesPerCase: 3, region: 'all', items } as OncallShift;
    const attempts = [
      attempt({ id: 'a', grade: { outcome: 'correct' } as never }),
      attempt({ id: 'b', grade: { outcome: 'partial' } as never }),
      attempt({ id: 'c', grade: { outcome: 'self_review' } as never, selfReview: { checked: [], verdict: 'incorrect' } }),
      attempt({ id: 'd', grade: { outcome: 'self_review' } as never, selfReview: null }),
    ];
    expect(itemResult(items[2], attempts).result).toBe('incorrect');
    expect(itemResult(items[3], attempts).result).toBe('not_judged');
    expect(itemResult(items[4], attempts).result).toBe('not_read');
    const sc = shiftScore(shift, attempts);
    expect(sc.points).toBe(1.5);
    expect(sc.max).toBe(4); // a, b, c and the unread case; d waits for your verdict
    expect(sc.toJudge).toBe(1);
    expect(sc.overTime).toBe(1);
    expect(sc.medianSeconds).toBe(180);
    expect(nextItem(shift)).toBe(4);
  });
});
