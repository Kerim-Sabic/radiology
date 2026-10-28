/**
 * LessonEngine: what each mode permits and when, so answers never leak early.
 *  learn    — reference, explanation and book open from the start (always recorded as assisted)
 *  practice — answers hidden; progressive hints; feedback after commitment
 *  assess   — neutral presentation, no hints/book/reference until submitted
 *  review   — revisit a past attempt with its feedback and the reference
 */
import type { Task } from '../schema/content';
import type { Mode, WrittenReport } from './progressRepository';

export interface SessionState {
  taskId: string;
  mode: Mode;
  startedAt: number;
  hintsOpened: number[];
  revealed: boolean;
  submitted: boolean;
  choice: string[];
  uncertain: boolean;
  notAssessable: boolean;
  declaredNoFinding: boolean;
  report: WrittenReport;
  confidence: number | null;
}

export function newSession(task: Task, mode: Mode): SessionState {
  return {
    taskId: task.id,
    mode,
    startedAt: Date.now(),
    hintsOpened: [],
    revealed: false,
    submitted: mode === 'review',
    choice: [],
    uncertain: false,
    notAssessable: false,
    declaredNoFinding: false,
    report: { findings: '', impression: '', differential: '' },
    confidence: null,
  };
}

export const rules = {
  hintsAllowed: (s: SessionState) => s.mode === 'practice' || s.mode === 'learn',
  referenceVisible: (s: SessionState) => s.mode === 'learn' || s.mode === 'review' || s.submitted || s.revealed,
  explanationVisible: (s: SessionState) => s.mode === 'learn' || s.mode === 'review' || s.submitted || s.revealed,
  bookAllowed: (s: SessionState) => s.mode !== 'assess' || s.submitted,
  revealTitle: (s: SessionState) => s.mode !== 'assess' || s.submitted,
  canEditMarks: (s: SessionState) => !s.submitted,
  independent: (s: SessionState) => (s.mode === 'practice' || s.mode === 'assess') && s.hintsOpened.length === 0 && !s.revealed,
};

/** Hints in ladder order; a final reveal step always exists. */
export function hintLadder(task: Task) {
  const hs = [...task.hints].sort((a, b) => a.level - b.level);
  if (!hs.some((h) => h.action?.type === 'reveal' || h.level === 5)) hs.push({ level: 5, text: 'Reveal the reference answer and explanation.', action: { type: 'reveal' } });
  return hs;
}

export const needsReport = (t: Task) => t.grading.kind !== 'choice' && (t.type === 'describe_finding' || t.type === 'whole_study' || t.type === 'differential' || !!t.rubric?.length);
export const needsMarks = (t: Task) => t.grading.kind !== 'choice' && t.grading.kind !== 'slice_interval' && t.grading.kind !== 'self_review';

/** Whether an answer can be submitted now — shared by the Submit button and Ctrl+Enter. */
export function canSubmit(t: Task, s: SessionState, markCount: number, reportShown: boolean): boolean {
  return (
    !s.submitted &&
    (t.grading.kind === 'slice_interval' ||
      t.grading.kind === 'self_review' ||
      (t.grading.kind === 'choice' && s.choice.length > 0) ||
      markCount > 0 ||
      s.declaredNoFinding ||
      s.notAssessable ||
      (reportShown && !!(s.report.findings.trim() || s.report.impression.trim())))
  );
}
/** The report box is shown for written tasks, and for residents on every task except choices and level navigation. */
export const reportShown = (t: Task, level: string) => needsReport(t) || (level === 'resident' && t.grading.kind !== 'choice' && t.type !== 'navigate_level');
export const needsLabels = (t: Task) => t.grading.kind === 'labelled_points' && t.grading.requireLabels;
