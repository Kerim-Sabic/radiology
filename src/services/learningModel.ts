/**
 * Transparent learning model. Tracks separate skill dimensions, distinguishes independent
 * from assisted performance, counts distinct patients (holdout groups), and schedules
 * review on DIFFERENT patients. Thresholds are product heuristics, not clinical claims.
 */
import type { Task } from '../schema/content';
import type { Catalog } from './caseRepository';
import type { Attempt } from './progressRepository';

export const DIMENSIONS = [
  ['orientation', 'Orientation'],
  ['navigation_windowing', 'Navigation & windowing'],
  ['anatomy', 'Anatomy recognition'],
  ['finding_localization', 'Finding localization'],
  ['interpretation', 'Interpretation'],
  ['reporting', 'Reporting'],
  ['cross_modality', 'Cross-modality correlation'],
] as const;

export type LearningState = 'not_started' | 'learning' | 'practising' | 'provisional_independent';
export const STATE_LABEL: Record<LearningState, string> = {
  not_started: 'Not started',
  learning: 'Learning (assisted)',
  practising: 'Practising',
  provisional_independent: 'Provisionally independent',
};
/** Heuristic: independent success on ≥3 distinct patients, including one retry ≥20 h after the first success. */
export const MILESTONE_RULE = 'Independent correct on 3+ distinct patients, including a delayed retry 20+ hours after the first success (product heuristic).';

const submitted = (a: Attempt) => !!a.submittedAt;
const success = (a: Attempt) => a.grade?.outcome === 'correct' || a.selfReview?.verdict === 'correct';

export interface SkillStats {
  attempts: number;
  independentAttempts: number;
  independentCorrect: number;
  assistedCorrect: number;
  patients: number;
  independentPatients: number;
  lastAt: string | null;
  state: LearningState;
}

function stateFor(list: Attempt[]): LearningState {
  if (!list.length) return 'not_started';
  const ind = list.filter((a) => a.independent && success(a)).sort((a, b) => (a.submittedAt! < b.submittedAt! ? -1 : 1));
  const patients = new Set(ind.map((a) => a.holdoutGroup));
  const delayed = ind.length > 1 && Date.parse(ind[ind.length - 1].submittedAt!) - Date.parse(ind[0].submittedAt!) >= 20 * 3600e3;
  if (patients.size >= 3 && delayed) return 'provisional_independent';
  if (ind.length) return 'practising';
  return 'learning';
}

export function statsFor(attempts: Attempt[]): SkillStats {
  const list = attempts.filter(submitted);
  const ind = list.filter((a) => a.independent);
  return {
    attempts: list.length,
    independentAttempts: ind.length,
    independentCorrect: ind.filter(success).length,
    assistedCorrect: list.filter((a) => !a.independent && success(a)).length,
    patients: new Set(list.map((a) => a.holdoutGroup)).size,
    independentPatients: new Set(ind.filter(success).map((a) => a.holdoutGroup)).size,
    lastAt: list.map((a) => a.submittedAt!).sort().pop() ?? null,
    state: stateFor(list),
  };
}

export function byDimension(attempts: Attempt[]) {
  return DIMENSIONS.map(([id, label]) => ({ id, label, stats: statsFor(attempts.filter((a) => a.skillDimensions.includes(id))) }));
}

export function byObjective(attempts: Attempt[], objectiveId: string) {
  return statsFor(attempts.filter((a) => a.objectiveIds.includes(objectiveId)));
}

export function errorCounts(attempts: Attempt[]) {
  const counts = new Map<string, number>();
  for (const a of attempts.filter(submitted)) for (const e of a.grade?.errors ?? []) counts.set(e, (counts.get(e) ?? 0) + 1);
  return counts;
}

/** Confidence 4–5 of 5 on an answer graded wrong (self-review "incorrect" counts too). */
export function isSureButWrong(a: Attempt): boolean {
  const wrong = (a.grade && a.grade.outcome !== 'correct' && a.grade.outcome !== 'not_attempted' && a.grade.outcome !== 'self_review') || a.selfReview?.verdict === 'incorrect';
  return !!wrong && a.confidence !== null && a.confidence >= 4;
}

/** Mistakes and uncertain answers that have not yet been redone correctly on another patient. */
export function mistakeNotebook(attempts: Attempt[], catalog: Catalog | null) {
  const list = attempts.filter(submitted).sort((a, b) => (a.submittedAt! < b.submittedAt! ? 1 : -1));
  const out: Array<{ attempt: Attempt; task: Task | undefined; resolved: boolean; reason: string; sureButWrong: boolean }> = [];
  for (const a of list) {
    // Self-review tasks are judged by the student's own verdict, never by the "self_review" outcome itself.
    const gradedWrong = a.grade?.outcome === 'incorrect' || a.grade?.outcome === 'partial';
    const judgedWrong = a.selfReview?.verdict === 'incorrect' || a.selfReview?.verdict === 'partial';
    const wrong = gradedWrong || judgedWrong;
    const flagged = wrong || a.uncertain || a.revealed || (a.confidence !== null && a.confidence <= 2);
    if (!flagged) continue;
    const task = catalog?.tasks.get(a.taskId);
    const resolved = list.some(
      (b) =>
        b.submittedAt! > a.submittedAt! &&
        b.independent &&
        success(b) &&
        b.holdoutGroup !== a.holdoutGroup &&
        b.skillDimensions.some((d) => a.skillDimensions.includes(d)) &&
        (b.objectiveIds.some((o) => a.objectiveIds.includes(o)) || b.taskId.split(':')[0] === a.taskId.split(':')[0]),
    );
    const reason = a.revealed
      ? 'Answer revealed'
      : gradedWrong
        ? a.grade!.errors.length
          ? a.grade!.errors.join(', ').replace(/_/g, ' ')
          : 'Not correct'
        : judgedWrong
          ? `You judged it ${a.selfReview!.verdict === 'partial' ? 'partly right' : 'not right'}`
          : a.uncertain
            ? 'Marked uncertain'
            : 'Low confidence';
    const sureButWrong = isSureButWrong(a);
    out.push({ attempt: a, task, resolved, reason: sureButWrong ? `Sure but wrong — ${reason}` : reason, sureButWrong });
  }
  // Confident mistakes first: they are the misconceptions that cause real-world misses.
  return out.sort((x, y) => Number(y.sureButWrong) - Number(x.sureButWrong));
}

const DAY = 86400e3;
const INTERVALS = [1, 3, 7, 21, 45];

export interface PlanItem {
  taskId: string;
  caseId: string;
  why: string;
  kind: 'review' | 'weak' | 'new';
}

/**
 * Today plan: overdue reviews first (on a different patient where possible), then weakest
 * dimension, then unseen patients. `minutes` shapes the length (≈3 min per task).
 */
export function todayPlan(attempts: Attempt[], catalog: Catalog | null, minutes: number | null): PlanItem[] {
  if (!catalog) return [];
  const n = Math.max(3, Math.min(20, Math.round((minutes ?? 20) / 3)));
  const tasks = [...catalog.tasks.values()].filter((t) => t.modes.includes('practice'));
  const now = Date.now();
  const byTask = new Map<string, Attempt[]>();
  for (const a of attempts.filter(submitted)) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a]);
  const seenGroups = new Set(attempts.map((a) => a.holdoutGroup));
  const plan: PlanItem[] = [];
  const used = new Set<string>();
  const push = (t: Task, why: string, kind: PlanItem['kind']) => {
    if (used.has(t.id) || plan.length >= n) return;
    used.add(t.id);
    plan.push({ taskId: t.id, caseId: t.caseId, why, kind });
  };

  // 1) due reviews → a sibling task on a different patient if available
  for (const m of mistakeNotebook(attempts, catalog).filter((x) => !x.resolved)) {
    const prior = (byTask.get(m.attempt.taskId) ?? []).length;
    // A confident mistake is due at once; other misses wait for their review interval.
    const due = m.sureButWrong ? 0 : Date.parse(m.attempt.submittedAt!) + INTERVALS[Math.min(prior - 1, INTERVALS.length - 1)] * DAY * 0.5;
    if (due > now) continue;
    const sibling = tasks.find(
      (t) =>
        catalog.holdoutGroup(t.caseId) !== m.attempt.holdoutGroup &&
        t.skillDimensions.some((d) => m.attempt.skillDimensions.includes(d)) &&
        (t.objectiveIds.some((o) => m.attempt.objectiveIds.includes(o)) || t.type === m.task?.type),
    );
    if (sibling) push(sibling, `${m.sureButWrong ? 'You were sure but wrong: retry' : 'Retry'} “${m.task?.title ?? 'a missed skill'}” on a different patient`, 'review');
    else if (m.task) push(m.task, 'Review a missed task (no other patient available yet)', 'review');
  }
  // 2) weakest dimension
  const dims = byDimension(attempts)
    .filter((d) => tasks.some((t) => t.skillDimensions.includes(d.id as never)))
    .sort((a, b) => a.stats.independentCorrect / Math.max(1, a.stats.attempts) - b.stats.independentCorrect / Math.max(1, b.stats.attempts) || a.stats.attempts - b.stats.attempts);
  for (const d of dims.slice(0, 2)) {
    const verb = d.stats.attempts ? 'Strengthen' : 'Begin with';
    for (const t of tasks.filter((x) => x.skillDimensions.includes(d.id as never) && !byTask.has(x.id)).slice(0, 2)) push(t, `${verb} ${d.label.toLowerCase()}`, 'weak');
  }
  // 3) unseen patients: one task each, so the plan spreads across different people
  const planned = new Set(plan.map((p) => catalog.holdoutGroup(p.caseId)));
  for (const t of tasks) {
    const g = catalog.holdoutGroup(t.caseId);
    if (seenGroups.has(g) || planned.has(g) || byTask.has(t.id)) continue;
    planned.add(g);
    push(t, 'New patient', 'new');
  }
  for (const t of tasks) if (!byTask.has(t.id)) push(t, 'Not yet practised', 'new');
  return plan;
}

/** Tasks on patients never seen in ANY mode (for honest unseen-patient assessment). */
export function unseenAssessTasks(attempts: Attempt[], catalog: Catalog | null): Task[] {
  if (!catalog) return [];
  const seen = new Set(attempts.map((a) => a.holdoutGroup));
  return [...catalog.tasks.values()].filter((t) => t.modes.includes('assess') && !seen.has(catalog.holdoutGroup(t.caseId)));
}

export function nextPracticeTask(attempts: Attempt[], catalog: Catalog | null): PlanItem | null {
  return todayPlan(attempts, catalog, 10)[0] ?? null;
}
