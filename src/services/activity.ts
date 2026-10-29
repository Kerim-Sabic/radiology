/**
 * Study activity per day, for the streak and the activity calendar. Submitted answers come from the attempts
 * themselves; drill answers are counted in a small per-day log (drill stats keep only the last answer per item).
 * Days are local calendar days.
 */
import type { Attempt } from './progressRepository';
import type { DrillStats } from './drill';

/** Drill answers per local day (YYYY-MM-DD). */
export type ActivityLog = Record<string, { drills: number }>;

export const dayKey = (d: Date | number | string) => {
  const t = new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export function logDrillAnswer(log: ActivityLog, at = new Date()): ActivityLog {
  const k = dayKey(at);
  return { ...log, [k]: { drills: (log[k]?.drills ?? 0) + 1 } };
}

/** Merge two logs (an imported backup into this device): the larger count of each day wins. */
export function mergeLogs(a: ActivityLog, b: ActivityLog): ActivityLog {
  const out: ActivityLog = { ...a };
  for (const [k, v] of Object.entries(b)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v?.drills === 'number') out[k] = { drills: Math.max(out[k]?.drills ?? 0, v.drills) };
  return out;
}

export interface Day {
  key: string;
  date: Date;
  answers: number;
  drills: number;
  total: number;
}

/**
 * The last `days` days, oldest first. Drill days from before the log existed still count once, from each
 * item's last answer.
 */
export function dailyActivity(attempts: Attempt[], log: ActivityLog, drill: DrillStats, days = 84, now = new Date()): Day[] {
  const answers = new Map<string, number>();
  for (const a of attempts) if (a.submittedAt) answers.set(dayKey(a.submittedAt), (answers.get(dayKey(a.submittedAt)) ?? 0) + 1);
  const drillDays = new Map<string, number>();
  for (const s of Object.values(drill)) if (s.lastAt) drillDays.set(dayKey(s.lastAt), (drillDays.get(dayKey(s.lastAt)) ?? 0) + 1);
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(date);
    const a = answers.get(key) ?? 0;
    const d = Math.max(log[key]?.drills ?? 0, drillDays.get(key) ?? 0);
    out.push({ key, date, answers: a, drills: d, total: a + d });
  }
  return out;
}

/**
 * Current streak: days in a row with any study, ending today, or ending yesterday while today is still open.
 * Best: the longest run in the given days.
 */
export function streak(days: Day[]): { current: number; best: number; today: boolean } {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.total > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const today = days.length > 0 && days[days.length - 1].total > 0;
  let current = 0;
  for (let i = days.length - (today ? 1 : 2); i >= 0 && days[i].total > 0; i--) current++;
  return { current, best, today };
}
