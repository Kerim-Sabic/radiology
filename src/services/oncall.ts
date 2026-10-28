/**
 * On-call shifts: a run of unknown cases read like a night on call — Assess mode (no hints, labels or book until
 * you submit), an optional clock per case, one case per patient, patients you have not seen first, and a scored
 * report at the end. Pure logic; the On-call page and the workstation do the viewing and storage.
 */
import type { Catalog } from './caseRepository';
import type { Attempt } from './progressRepository';
import type { Task } from '../schema/content';

/** Reading tasks (find, describe and interpret findings); anatomy, level and window questions are not on-call work. */
const TYPE_RANK: Record<string, number> = { whole_study: 0, locate_finding: 1, describe_finding: 2, differential: 3, correlate_modalities: 4, compare_appearances: 5 };

export interface ShiftItem {
  caseId: string;
  taskId: string;
  /** When the case was first opened (the clock runs from here, also across reloads). */
  startedAt: string | null;
  submittedAt: string | null;
  attemptId: string | null;
  overTime: boolean;
  /** The patient had been read before this shift. */
  seenBefore: boolean;
}

export interface OncallShift {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  minutesPerCase: number | null;
  region: string;
  items: ShiftItem[];
}

export interface ShiftRegion {
  id: string;
  label: string;
  test: (regions: string[]) => boolean;
}
export const SHIFT_REGIONS: ShiftRegion[] = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: 'chest', label: 'Chest', test: (r) => r.includes('chest') },
  { id: 'abdomen', label: 'Abdomen & pelvis', test: (r) => r.includes('abdomen') || r.includes('pelvis') },
  { id: 'head', label: 'Brain & head', test: (r) => r.includes('head') },
  { id: 'msk', label: 'Bones, spine & soft tissue', test: (r) => r.includes('extremity') || r.includes('spine') },
  { id: 'breast', label: 'Breast', test: (r) => r.includes('breast') },
];

/** The on-call task of a case: its broadest reading task that can be assessed, or null when it has none. */
export function oncallTaskFor(tasks: Task[]): Task | null {
  const ok = tasks.filter((t) => t.modes.includes('assess') && t.type in TYPE_RANK);
  return ok.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type])[0] ?? null;
}

/** Cases available for a region: one per patient (hold-out group), each with its on-call task. */
export function shiftPool(catalog: Pick<Catalog, 'cases' | 'tasksByCase' | 'holdoutGroup'>, region: string) {
  const reg = SHIFT_REGIONS.find((r) => r.id === region) ?? SHIFT_REGIONS[0];
  const byGroup = new Map<string, Array<{ caseId: string; task: Task }>>();
  for (const k of catalog.cases.values()) {
    if (!reg.test(k.region)) continue;
    const task = oncallTaskFor(catalog.tasksByCase.get(k.id) ?? []);
    if (!task) continue;
    const g = catalog.holdoutGroup(k.id);
    byGroup.set(g, [...(byGroup.get(g) ?? []), { caseId: k.id, task }]);
  }
  return byGroup;
}

export function buildShift(
  catalog: Pick<Catalog, 'cases' | 'tasksByCase' | 'holdoutGroup'>,
  attempts: Attempt[],
  o: { count: number; region: string; minutesPerCase: number | null; rng?: () => number; now?: Date; id?: string },
): OncallShift {
  const rng = o.rng ?? Math.random;
  const seen = new Set(attempts.filter((a) => a.submittedAt).map((a) => a.holdoutGroup));
  const groups = [...shiftPool(catalog, o.region).entries()].map(([g, cases]) => ({ g, pick: cases[Math.floor(rng() * cases.length)], r: rng() }));
  // Patients you have not read come first; within each, a random order.
  groups.sort((a, b) => Number(seen.has(a.g)) - Number(seen.has(b.g)) || a.r - b.r);
  const items = groups.slice(0, o.count).map(({ g, pick }) => ({
    caseId: pick.caseId,
    taskId: pick.task.id,
    startedAt: null,
    submittedAt: null,
    attemptId: null,
    overTime: false,
    seenBefore: seen.has(g),
  }));
  // Shuffle once more so the unseen ones are not all at the start of the shift.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const now = o.now ?? new Date();
  return { id: o.id ?? `shift-${now.getTime().toString(36)}`, startedAt: now.toISOString(), finishedAt: null, minutesPerCase: o.minutesPerCase, region: o.region, items };
}

export const shiftUrl = (shift: OncallShift, i: number) => {
  const it = shift.items[i];
  return `/read/${encodeURIComponent(it.caseId)}?task=${encodeURIComponent(it.taskId)}&mode=assess&shift=${encodeURIComponent(shift.id)}`;
};

/** Index of the next case to read, or -1 when every case is answered. */
export const nextItem = (shift: OncallShift) => shift.items.findIndex((it) => !it.submittedAt);

/** Seconds left on a case's clock (negative when over time), or null for an untimed shift. */
export function secondsLeft(shift: OncallShift, item: ShiftItem, now = Date.now()): number | null {
  if (!shift.minutesPerCase) return null;
  const start = item.startedAt ? Date.parse(item.startedAt) : now;
  const end = item.submittedAt ? Date.parse(item.submittedAt) : now;
  return Math.round(shift.minutesPerCase * 60 - (end - start) / 1000);
}

export type ItemResult = 'correct' | 'partial' | 'incorrect' | 'not_judged' | 'not_read';
export const RESULT_LABEL: Record<ItemResult, string> = {
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Missed',
  not_judged: 'Judge it in review',
  not_read: 'Not read',
};

/** Result of one case: the automatic grade, or your own verdict for self-review answers. */
export function itemResult(item: ShiftItem, attempts: Attempt[]): { result: ItemResult; attempt: Attempt | null; seconds: number | null } {
  const a = item.attemptId ? (attempts.find((x) => x.id === item.attemptId) ?? null) : null;
  const seconds = item.startedAt && item.submittedAt ? Math.round((Date.parse(item.submittedAt) - Date.parse(item.startedAt)) / 1000) : null;
  if (!item.submittedAt || !a) return { result: 'not_read', attempt: a, seconds };
  const o = a.grade?.outcome;
  if (o === 'correct' || o === 'partial' || o === 'incorrect') return { result: o, attempt: a, seconds };
  const v = a.selfReview?.verdict;
  return { result: v === 'correct' || v === 'partial' || v === 'incorrect' ? v : 'not_judged', attempt: a, seconds };
}

/** Shift score: correct 1, partly right ½; cases still to be judged are listed but not counted yet. */
export function shiftScore(shift: OncallShift, attempts: Attempt[]) {
  const rows = shift.items.map((it) => ({ item: it, ...itemResult(it, attempts) }));
  const judged = rows.filter((r) => r.result !== 'not_judged');
  const points = judged.reduce((s, r) => s + (r.result === 'correct' ? 1 : r.result === 'partial' ? 0.5 : 0), 0);
  const times = rows.map((r) => r.seconds).filter((x): x is number => x !== null);
  return {
    rows,
    points,
    max: judged.length,
    toJudge: rows.length - judged.length,
    overTime: rows.filter((r) => r.item.overTime).length,
    medianSeconds: times.length ? [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] : null,
  };
}
