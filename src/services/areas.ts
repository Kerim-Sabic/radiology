/**
 * Progress by body area (the same areas as On call), and the next case to practise in each: a patient you have not
 * read yet, so practice keeps moving to new patients.
 */
import type { Catalog } from './caseRepository';
import type { Attempt } from './progressRepository';
import type { Task } from '../schema/content';
import { SHIFT_REGIONS } from './oncall';

/** Tasks that make a good next step: reading tasks first, then structure and window questions. */
const NEXT_RANK: Record<string, number> = { locate_finding: 0, whole_study: 1, describe_finding: 2, differential: 3, find_structure: 4, choose_window: 5 };

export interface AreaProgress {
  id: string;
  label: string;
  /** Patients with at least one case in the area. */
  patients: number;
  /** Of those, patients you have submitted an answer on. */
  read: number;
  judged: number;
  correct: number;
  /** Share of judged answers that were right (partly right counts half), or null before any. */
  accuracy: number | null;
  /** The same for answers given without hints or reveal. */
  independentJudged: number;
  independentAccuracy: number | null;
  next: { caseId: string; taskId: string } | null;
}

const outcome = (a: Attempt) => a.grade?.outcome ?? a.selfReview?.verdict ?? null;

export function areaProgress(catalog: Pick<Catalog, 'cases' | 'tasksByCase' | 'holdoutGroup'>, attempts: Attempt[]): AreaProgress[] {
  const done = attempts.filter((a) => a.submittedAt);
  const readGroups = new Set(done.map((a) => a.holdoutGroup));
  const triedTasks = new Set(done.map((a) => a.taskId));
  return SHIFT_REGIONS.filter((r) => r.id !== 'all').map((r) => {
    const cases = [...catalog.cases.values()].filter((c) => r.test(c.region));
    const ids = new Set(cases.map((c) => c.id));
    const mine = done.filter((a) => ids.has(a.caseId));
    const judged = mine.filter((a) => ['correct', 'partial', 'incorrect'].includes(outcome(a) ?? ''));
    const points = judged.reduce((s, a) => s + (outcome(a) === 'correct' ? 1 : outcome(a) === 'partial' ? 0.5 : 0), 0);
    const unaided = judged.filter((a) => a.independent);
    const unaidedPoints = unaided.reduce((s, a) => s + (outcome(a) === 'correct' ? 1 : outcome(a) === 'partial' ? 0.5 : 0), 0);
    const pick = (unseenOnly: boolean) => {
      let best: { caseId: string; task: Task } | null = null;
      for (const c of cases) {
        if (unseenOnly && readGroups.has(catalog.holdoutGroup(c.id))) continue;
        for (const t of catalog.tasksByCase.get(c.id) ?? []) {
          if (triedTasks.has(t.id) || !t.modes.includes('practice') || !(t.type in NEXT_RANK)) continue;
          if (!best || NEXT_RANK[t.type] < NEXT_RANK[best.task.type]) best = { caseId: c.id, task: t };
        }
      }
      return best;
    };
    const next = pick(true) ?? pick(false);
    return {
      id: r.id,
      label: r.label,
      patients: new Set(cases.map((c) => catalog.holdoutGroup(c.id))).size,
      read: new Set(cases.map((c) => catalog.holdoutGroup(c.id)).filter((g) => readGroups.has(g))).size,
      judged: judged.length,
      correct: judged.filter((a) => outcome(a) === 'correct').length,
      accuracy: judged.length ? points / judged.length : null,
      independentJudged: unaided.length,
      independentAccuracy: unaided.length ? unaidedPoints / unaided.length : null,
      next: next ? { caseId: next.caseId, taskId: next.task.id } : null,
    };
  });
}

/** The area to work on next: the weakest you have tried (with at least 3 judged answers), else the least read. */
export function weakestArea(areas: AreaProgress[]): AreaProgress | null {
  const open = areas.filter((a) => a.next && a.patients > 0);
  const tried = open.filter((a) => a.judged >= 3 && a.accuracy !== null).sort((a, b) => a.accuracy! - b.accuracy!);
  if (tried.length && tried[0].accuracy! < 0.75) return tried[0];
  return [...open].sort((a, b) => a.read / a.patients - b.read / b.patients)[0] ?? null;
}
