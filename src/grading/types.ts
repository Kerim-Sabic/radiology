import type { Vec2, Vec3 } from '../lib/geometry.js';

/** A learner mark, stored in source-image terms — never only canvas pixels. */
export interface LearnerMark {
  id: string;
  tool: 'point' | 'box' | 'outline' | 'arrow';
  label: string | null;
  seriesUid: string;
  /** Source instance the mark was drawn on; null when drawn on a generated (MPR) reformat. */
  sopInstanceUid: string | null;
  frame: number;
  /** Contract image px ([col,row], centre-of-first-pixel origin) on sopInstanceUid. */
  imagePx: Vec2[] | null;
  /** Patient LPS mm. Null for projection images without patient geometry. */
  worldLps: Vec3[] | null;
  view: 'stack' | 'axial' | 'coronal' | 'sagittal';
  createdAt: string;
}

export type ErrorCategory =
  | 'navigation_failure'
  | 'wrong_structure'
  | 'wrong_laterality'
  | 'inaccurate_contour'
  | 'missed_finding'
  | 'overcalling'
  | 'interpretation_error'
  | 'incomplete_reporting';

export const ERROR_LABELS: Record<ErrorCategory, string> = {
  navigation_failure: 'Navigation — wrong slice or level',
  wrong_structure: 'Wrong structure',
  wrong_laterality: 'Wrong side',
  inaccurate_contour: 'Imprecise outline',
  missed_finding: 'Missed finding',
  overcalling: 'Overcalling (false positive)',
  interpretation_error: 'Interpretation',
  incomplete_reporting: 'Incomplete report',
};

export type TargetStatus = 'found' | 'missed' | 'wrong_label' | 'wrong_side' | 'off_level' | 'near_miss';
export type MarkStatus =
  | 'matched'
  | 'duplicate'
  | 'wrong_structure'
  | 'wrong_side'
  | 'off_level'
  | 'near_miss'
  | 'unmatched_unscored'
  | 'false_positive';

export interface TargetOutcome {
  targetId: string;
  name: string;
  status: TargetStatus;
  markId: string | null;
  inPlaneDistanceMm: number | null;
  sliceDistanceMm: number | null;
  overlap: number | null; // IoU for box/outline marks where meaningful
  note: string;
}

export interface MarkOutcome {
  markId: string;
  status: MarkStatus;
  targetId: string | null;
  note: string;
}

export interface GradeResult {
  gradingKind: string;
  authoritative: boolean;
  authorityNote: string;
  outcome: 'correct' | 'partial' | 'incorrect' | 'self_review' | 'not_attempted';
  score: number | null; // 0..1 or null when not authoritatively scorable
  components: Partial<Record<'level' | 'identity' | 'laterality' | 'localization' | 'detection' | 'choice', { ok: boolean; detail: string }>>;
  targets: TargetOutcome[];
  marks: MarkOutcome[];
  errors: ErrorCategory[];
  messages: string[];
}

/** Viewer state captured at submission (for navigation tasks). */
export interface PositionAtSubmit {
  seriesUid: string;
  sopInstanceUid: string | null;
  worldLps: Vec3 | null; // a point on the displayed plane (e.g. the focal point)
}
