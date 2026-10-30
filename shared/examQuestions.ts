/**
 * Which questions a certification exam may ask, and how one is put together. Shared by the app (to say which exams the
 * library can fill) and the server (which picks every exam's questions itself and grades the answers), so both
 * always apply the same rules. The rules of each level are in certificateLevels.ts.
 */
import type { Task } from '../src/schema/content.js';
import { examRule, type CertArea, type CertLevel } from './certificateLevels.js';

export const BODY_AREAS: CertArea[] = ['chest', 'abdomen', 'head', 'msk', 'breast'];

const REGION_AREA: Record<string, CertArea> = { chest: 'chest', abdomen: 'abdomen', pelvis: 'abdomen', head: 'head', extremity: 'msk', spine: 'msk', breast: 'breast' };
/** Body areas of a case, in the order above. */
export const areasOfRegion = (region: string[]): CertArea[] => BODY_AREAS.filter((a) => region.some((r) => REGION_AREA[r] === a));

// A scan can cover several areas (a child's whole-body CT, a hip on a pelvis film): what a question marks says which.
const CLASS_AREA: Array<[RegExp, CertArea]> = [
  [/^finding:fracture/, 'msk'],
  [/^anatomy:(thymus|heart|lung|trachea|bronch|esophag|pulmonary)/, 'chest'],
  [/^anatomy:(liver|spleen|kidney|pancreas|gallbladder|adrenal|stomach|duodenum|small_intestine|large_intestine|colon|rectum|bladder|prostate|uterus|femoral_head)/, 'abdomen'],
];

/** The body area a question counts for: its case's area, or, on a scan of several areas, the area of what it asks you to mark. */
export function questionAreaOf(region: string[], targetClassIds: string[]): CertArea | null {
  const areas = areasOfRegion(region);
  if (areas.length <= 1) return areas[0] ?? null;
  const votes = new Map<CertArea, number>();
  for (const cls of targetClassIds) {
    const a = CLASS_AREA.find(([re]) => re.test(cls))?.[1];
    if (a && areas.includes(a)) votes.set(a, (votes.get(a) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? areas[0];
}

/** A question the app can grade on its own, against an expert reference (never self-review, never a machine outline). */
export function examEligibleTask(task: Task, provenanceOf: (targetId: string) => string | undefined): boolean {
  if (task.scoring !== 'authoritative' || !task.modes.includes('assess') || task.grading.kind === 'self_review') return false;
  return task.targets.every((t) => {
    const p = provenanceOf(t.targetId);
    return p === 'source_manual' || p === 'source_automated';
  });
}

/** Questions where the finding or structure is marked on the image (harder than choosing an answer). */
export const isMarking = (task: Task) => ['findings', 'point_in_target', 'labelled_points', 'slice_interval'].includes(task.grading.kind);
/** A question with only two answers to choose from, which a guess passes half of the time. */
export const isTwoOption = (task: Task) => task.grading.kind === 'choice' && task.grading.options.length <= 2;

export interface ExamCandidate {
  taskId: string;
  caseId: string;
  /** The body area the question counts for. */
  area: CertArea;
  /** The patient (hold-out group): one question per patient where the library allows. */
  group: string;
  subtle: boolean;
  marking: boolean;
  twoOption: boolean;
}

/** At most this many questions come from one patient, and more than one only where the area is small. */
export const PER_PATIENT = 3;

/**
 * The questions of a new exam. Questions not answered before come first, one per patient where the library allows (a
 * small area adds a second, then a third, never more). The level sets the rest: its share of questions marked on the
 * image comes first, two-answer questions are left out from Level 2, and Foundation leans on typical cases while
 * Advanced starts with the subtle ones. For the whole library the questions are shared out across the body areas.
 */
export function pickExam(candidates: ExamCandidate[], area: CertArea, level: CertLevel, tried: Set<string>, rng: () => number): ExamCandidate[] {
  const rule = examRule(area, level);
  const lean = (c: ExamCandidate) => (rule.lean === 'typical' ? Number(c.subtle) : rule.lean === 'subtle' ? Number(!c.subtle) : 0);
  const pool = candidates
    .filter((c) => (area === 'all' || c.area === area) && !(rule.noTwoOption && c.twoOption))
    .map((c) => ({ c, key: [Number(tried.has(c.taskId)), lean(c), rng()] }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map((x) => x.c);
  const areas = area === 'all' ? BODY_AREAS.filter((a) => pool.some((c) => c.area === a)) : [area];
  const picked: ExamCandidate[] = [];
  const perGroup = new Map<string, number>();
  // Round one takes one question per patient, the next rounds a second and a third; areas take turns.
  const fill = (from: ExamCandidate[], upTo: number) => {
    for (let cap = 1; cap <= PER_PATIENT; cap++) {
      let progress = true;
      while (picked.length < upTo && progress) {
        progress = false;
        for (const a of areas) {
          if (picked.length >= upTo) break;
          const c = from.find((x) => x.area === a && !picked.includes(x) && (perGroup.get(x.group) ?? 0) < cap);
          if (!c) continue;
          picked.push(c);
          perGroup.set(c.group, (perGroup.get(c.group) ?? 0) + 1);
          progress = true;
        }
      }
    }
  };
  fill(
    pool.filter((c) => c.marking),
    Math.ceil(rule.minMarking * rule.questions),
  );
  fill(pool, rule.questions);
  // Mixed order, so one patient's questions and one area's questions are not side by side.
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

/** Whether a set of questions satisfies a level: its length, its share marked on the image, and its body areas. */
export function examComplete(picked: ExamCandidate[], area: CertArea, level: CertLevel): boolean {
  const rule = examRule(area, level);
  return (
    picked.length >= rule.questions &&
    picked.filter((c) => c.marking).length >= Math.ceil(rule.minMarking * rule.questions) &&
    new Set(picked.map((c) => c.area)).size >= (rule.minAreas ?? 1)
  );
}

/** "23 h 10 min", "45 min", "1 min" */
export function waitWords(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

export type QuestionOutcome = 'correct' | 'partial' | 'incorrect' | 'timeout' | null;

/** Correct 1, partly right ½ (nothing at a level without half points), wrong, out of time or not answered 0. */
export function examPoints(outcomes: QuestionOutcome[], area: CertArea, level: CertLevel): { points: number; score: number; passed: boolean } {
  const rule = examRule(area, level);
  const points = outcomes.reduce((s, o) => s + (o === 'correct' ? 1 : o === 'partial' && rule.partialCredit ? 0.5 : 0), 0);
  const score = outcomes.length ? points / outcomes.length : 0;
  return { points, score, passed: outcomes.length >= rule.questions && score >= rule.passMark };
}
