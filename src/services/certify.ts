/**
 * Guided certification: the next task a certificate level still needs. Start (or Continue) on a level opens it in the
 * reading room; after each answer "Next for your certificate" opens the following one, until the level is reached and
 * Finish certification claims it. Patients first (one you have not read), then graded answers on tasks you have not
 * tried, then your mistakes to retry. An unaided level (Level 3) uses Assess mode, where hints cannot be opened.
 */
import type { Catalog } from './caseRepository';
import type { Attempt, Mode } from './progressRepository';
import type { Task } from '../schema/content';
import { SHIFT_REGIONS } from './oncall';
import { areaProgress } from './areas';
import { certificateStatus, levelLabel, type CertArea, type CertLevel, type CertStatus } from './certificates';
import { levelRule } from '../../shared/certificateLevels';

type CatalogView = Pick<Catalog, 'cases' | 'tasksByCase' | 'holdoutGroup'>;

/** "chest-2" in a reading-room URL: the level being worked towards. */
export const certKey = (area: CertArea, level: CertLevel) => `${area}-${level}`;
export function parseCertKey(value: string | null): { area: CertArea; level: CertLevel } | null {
  const m = /^(chest|abdomen|head|msk|breast|all)-([123])$/.exec(value ?? '');
  return m ? { area: m[1] as CertArea, level: Number(m[2]) as CertLevel } : null;
}

export function certStatusFor(catalog: CatalogView, attempts: Attempt[], area: CertArea, level: CertLevel): CertStatus | null {
  return certificateStatus(areaProgress(catalog, attempts), attempts).find((s) => s.area === area && s.level === level) ?? null;
}

export interface CertStep {
  caseId: string;
  taskId: string;
  mode: Mode;
  /** Why this one, in words. */
  why: string;
}

// Reading tasks first; tasks graded against the expert reference before self-reviewed ones.
const RANK: Record<string, number> = { locate_finding: 0, whole_study: 1, describe_finding: 2, differential: 3, find_structure: 4, choose_window: 5 };
const rank = (t: Task) => RANK[t.type] + (t.scoring === 'authoritative' ? 0 : 10);
const outcome = (a: Attempt) => a.grade?.outcome ?? a.selfReview?.verdict ?? null;

/** The reading-room address of a step, keeping the level in the URL. */
export const stepUrl = (step: CertStep, area: CertArea, level: CertLevel) =>
  `/read/${step.caseId}?task=${encodeURIComponent(step.taskId)}&mode=${step.mode}&cert=${certKey(area, level)}`;

/** The next task for a level, or null when the level is reached (or nothing in the library fits). */
export function nextCertificateTask(catalog: CatalogView, attempts: Attempt[], area: CertArea, level: CertLevel, skipTaskId?: string): CertStep | null {
  const areas = areaProgress(catalog, attempts);
  const s = certificateStatus(areas, attempts).find((x) => x.area === area && x.level === level);
  if (!s || s.eligible) return null;
  const rule = levelRule(area, level);
  const modeFor = (t: Task): Mode | null => (s.independent && t.modes.includes('assess') ? 'assess' : t.modes.includes('practice') ? 'practice' : null);
  const inArea = (region: string[]) => area === 'all' || (SHIFT_REGIONS.find((r) => r.id === area)?.test(region) ?? false);
  const cases = [...catalog.cases.values()].filter((c) => inArea(c.region));
  const done = attempts.filter((a) => a.submittedAt);
  const readGroups = new Set(done.map((a) => a.holdoutGroup));
  const tried = new Set(done.map((a) => a.taskId));
  const taskById = new Map<string, Task>();
  for (const c of cases) for (const t of catalog.tasksByCase.get(c.id) ?? []) taskById.set(t.id, t);

  const pick = (caseOk: (caseId: string, region: string[]) => boolean, taskOk: (t: Task) => boolean): { task: Task; mode: Mode } | null => {
    let best: { task: Task; mode: Mode } | null = null;
    for (const c of cases) {
      if (!caseOk(c.id, c.region)) continue;
      for (const t of catalog.tasksByCase.get(c.id) ?? []) {
        const m = modeFor(t);
        if (!m || t.id === skipTaskId || !(t.type in RANK) || !taskOk(t)) continue;
        if (!best || rank(t) < rank(best.task)) best = { task: t, mode: m };
      }
    }
    return best;
  };
  const step = (p: { task: Task; mode: Mode } | null, why: string): CertStep | null => (p ? { caseId: p.task.caseId, taskId: p.task.id, mode: p.mode, why } : null);
  // The latest wrong or partly right answers (unaided ones for an unaided level), newest first.
  const mistakes = () => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const a of [...done].reverse()) {
      if (seen.has(a.taskId)) continue;
      seen.add(a.taskId);
      if (s.independent && !a.independent) continue;
      const t = taskById.get(a.taskId);
      if (t && t.id !== skipTaskId && modeFor(t) && ['incorrect', 'partial'].includes(outcome(a) ?? '')) out.push(t);
    }
    return out;
  };

  // 1. Patients still to read; for the whole library, in the body areas that still lack breadth first.
  const thin = new Set(areas.filter((a) => a.read < (rule.perArea ?? 0)).map((a) => a.id));
  const wide = areas.length - thin.size;
  const needBreadth = area === 'all' && wide < (rule.minAreas ?? 0);
  if (s.read < s.needPatients || needBreadth) {
    const unread = (id: string) => !readGroups.has(catalog.holdoutGroup(id));
    const inThin = (region: string[]) => [...thin].some((id) => SHIFT_REGIONS.find((r) => r.id === id)?.test(region));
    const p = pick((id, region) => unread(id) && (!needBreadth || inThin(region)), (t) => !tried.has(t.id)) ?? pick((id) => unread(id), (t) => !tried.has(t.id));
    if (p) return step(p, 'A patient you have not read yet.');
  }
  // 2. Below the share right: retry a mistake.
  const lowAccuracy = s.accuracy !== null && s.accuracy < s.minAccuracy;
  if (lowAccuracy) {
    const t = mistakes()[0];
    if (t) return { caseId: t.caseId, taskId: t.id, mode: modeFor(t)!, why: 'A task you got wrong before: try it again.' };
  }
  // 3. More graded answers: a task you have not answered yet, then your mistakes, then any task.
  const fresh = pick(() => true, (t) => !tried.has(t.id));
  if (fresh) return step(fresh, 'A task you have not answered yet.');
  const t = mistakes()[0];
  if (t) return { caseId: t.caseId, taskId: t.id, mode: modeFor(t)!, why: 'A task you got wrong before: try it again.' };
  return step(pick(() => true, () => true), 'Another graded answer for this level.');
}

/** "Chest Imaging · Level 2 · Intermediate" */
export const certName = (s: CertStatus) => `${s.title} · ${levelLabel(s.level)}`;
