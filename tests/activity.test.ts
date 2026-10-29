import { describe, expect, it } from 'vitest';
import { dailyActivity, dayKey, logDrillAnswer, mergeLogs, streak } from '../src/services/activity';
import type { Attempt } from '../src/services/progressRepository';
import type { DrillStats } from '../src/services/drill';

const now = new Date(2026, 9, 29, 15, 0);
const daysAgo = (n: number, h = 10) => new Date(2026, 9, 29 - n, h, 0).toISOString();
const attempt = (submittedAt: string | null) => ({ submittedAt }) as Attempt;

describe('study activity', () => {
  it('counts answers and drill answers per local day', () => {
    let log = logDrillAnswer({}, new Date(2026, 9, 29, 9));
    log = logDrillAnswer(log, new Date(2026, 9, 29, 23, 59));
    expect(log[dayKey(now)]).toEqual({ drills: 2 });
    const days = dailyActivity([attempt(daysAgo(0)), attempt(daysAgo(2)), attempt(null)], log, {}, 7, now);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ key: '2026-10-29', answers: 1, drills: 2, total: 3 });
    expect(days[4].total).toBe(1);
    expect(days[5].total).toBe(0);
  });

  it('still counts drill days from before the log existed', () => {
    const drill = { a: { key: 'a', lastAt: daysAgo(3) }, b: { key: 'b', lastAt: daysAgo(3) } } as unknown as DrillStats;
    const days = dailyActivity([], {}, drill, 7, now);
    expect(days[3].drills).toBe(2);
  });

  it('keeps a streak alive until today is over, and remembers the best run', () => {
    const at = (offsets: number[]) => dailyActivity(offsets.map((n) => attempt(daysAgo(n))), {}, {}, 14, now);
    expect(streak(at([0, 1, 2]))).toEqual({ current: 3, best: 3, today: true });
    expect(streak(at([1, 2]))).toEqual({ current: 2, best: 2, today: false }); // today still open
    expect(streak(at([2, 3, 6, 7, 8, 9]))).toEqual({ current: 0, best: 4, today: false });
  });

  it('merges a backup by keeping the larger count of each day', () => {
    expect(mergeLogs({ '2026-10-01': { drills: 3 } }, { '2026-10-01': { drills: 1 }, '2026-10-02': { drills: 4 }, bad: { drills: 9 } })).toEqual({
      '2026-10-01': { drills: 3 },
      '2026-10-02': { drills: 4 },
    });
  });
});

describe('activity log in the progress store', async () => {
  const { ProgressRepository } = await import('../src/services/progressRepository');
  it('counts a drill answer, travels in the backup and is cleared by a reset', async () => {
    const a = new ProgressRepository('activity-test-a');
    await a.saveDrillStats({}, new Date(2026, 9, 28, 12));
    await a.saveDrillStats({}, new Date(2026, 9, 28, 13));
    await a.saveDrillStats({}, null); // not an answer
    expect(await a.activityLog()).toEqual({ '2026-10-28': { drills: 2 } });
    const backup = await a.exportAll();
    const b = new ProgressRepository('activity-test-b');
    await b.saveDrillStats({}, new Date(2026, 9, 29, 12));
    await b.importAll(JSON.parse(JSON.stringify(backup)));
    expect(await b.activityLog()).toEqual({ '2026-10-28': { drills: 2 }, '2026-10-29': { drills: 1 } });
    await b.resetAll();
    expect(await b.activityLog()).toEqual({});
  });
});
