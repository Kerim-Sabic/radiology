/**
 * Versioned content contract shared by the offline pack builder (scripts/data)
 * and the app. Packs live at public/packs/<packId>/:
 *   pack.json      generated data manifest (this file's PackManifest)
 *   lessons.json   hand-authored teaching cases + tasks (LessonFile)
 *   targets/*.json reference geometry (TargetGeometry), referenced by ReferenceTarget.geometryFile
 *   dicom/...      DICOM Part 10 files, referenced by Instance.file
 *   thumbs/...     series thumbnails (PNG/WebP), visualization derivatives only
 *
 * Coordinate contract (see docs/COORDINATES.md):
 *   patient_lps_mm: DICOM patient coordinates, millimetres, LPS axes.
 *   image_px: [column, row], zero-based, continuous; (0,0) is the CENTRE of the
 *   first transmitted pixel (same convention as ImagePositionPatient). Always
 *   paired with sopInstanceUid + 1-based frame number and source rows/columns.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Vec2 = z.tuple([z.number(), z.number()]);

export const Provenance = z.enum(['source_manual', 'source_automated', 'ai_draft', 'human_reviewed']);
export type Provenance = z.infer<typeof Provenance>;

export const Completeness = z.enum(['target_only', 'region_reviewed', 'whole_study_reviewed']);
export type Completeness = z.infer<typeof Completeness>;

export const SkillDimension = z.enum([
  'orientation',
  'navigation_windowing',
  'anatomy',
  'finding_localization',
  'interpretation',
  'reporting',
  'cross_modality',
]);
export type SkillDimension = z.infer<typeof SkillDimension>;

export const SourceRef = z.object({
  id: z.string(), // e.g. "tcia:LIDC-IDRI"
  name: z.string(),
  url: z.string(),
  doi: z.string().nullable().optional(),
  license: z.string(),
  licenseUrl: z.string().nullable().optional(),
  citation: z.string(),
  accessNote: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Subject = z.object({
  key: z.string(), // namespaced: "<sourceId>:<sourceSubjectId>"
  sourceId: z.string(),
  sourceSubjectId: z.string(),
  linkageEvidence: z.string(),
  holdoutGroup: z.string(),
  sex: z.string().nullable().optional(),
  ageAtFirstStudy: z.string().nullable().optional(),
  studyUids: z.array(z.string()),
});
export type Subject = z.infer<typeof Subject>;

export const Study = z.object({
  uid: z.string(),
  subjectKey: z.string(),
  description: z.string(),
  modalities: z.array(z.string()),
  date: z.string().nullable(), // as distributed (YYYY-MM-DD) — may be shifted
  dateShifted: z.enum(['yes', 'no', 'unknown']),
  relativeDays: z.number().nullable(), // vs subject's earliest study, only if dates internally consistent
  timingNote: z.string(),
  seriesUids: z.array(z.string()),
});
export type Study = z.infer<typeof Study>;

export const Instance = z.object({
  sopInstanceUid: z.string(),
  file: z.string(), // relative to pack root
  bytes: z.number().int(),
  sha256: z.string(),
  frames: z.number().int().min(1),
  instanceNumber: z.number().nullable(),
  ipp: Vec3.nullable(),
});
export type Instance = z.infer<typeof Instance>;

export const WindowPreset = z.object({ label: z.string(), center: z.number(), width: z.number() });
export type WindowPreset = z.infer<typeof WindowPreset>;

export const SeriesRole = z.enum(['diagnostic', 'scout', 'vendor_reformat', 'derived_secondary', 'other']);

export const Series = z.object({
  uid: z.string(),
  studyUid: z.string(),
  subjectKey: z.string(),
  modality: z.string(), // actual DICOM Modality
  sopClassUid: z.string(),
  frameOfReferenceUid: z.string().nullable(),
  number: z.number().nullable(),
  description: z.string(),
  bodyPart: z.string().nullable(),
  role: SeriesRole,
  roleNote: z.string(),
  acquisition: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string()), z.null()])),
  geometry: z.object({
    rows: z.number().int(),
    columns: z.number().int(),
    pixelSpacing: Vec2.nullable(), // [rowSpacing, columnSpacing] mm
    pixelSpacingSource: z.enum(['PixelSpacing', 'ImagerPixelSpacing', 'none']),
    spacingCalibrated: z.boolean(), // true only when spacing is a patient-plane calibrated value
    iop: z.array(z.number()).length(6).nullable(),
    sliceSpacing: z.number().nullable(),
    sliceSpacingUniform: z.boolean().nullable(),
    volumeEligible: z.boolean(),
    volumeIssues: z.array(z.string()),
    photometric: z.string(),
    bitsStored: z.number().int(),
    pixelRepresentation: z.number().int(),
    rescale: z.object({ slope: z.number(), intercept: z.number(), type: z.string().nullable() }).nullable(),
    hu: z.boolean(), // CT Hounsfield units valid
  }),
  encoding: z.object({
    transferSyntaxes: z.array(z.string()),
    reencodedFrom: z.array(z.string()).nullable(),
    lossless: z.boolean(),
    note: z.string(),
  }),
  instances: z.array(Instance), // geometric order (verified by builder; app re-verifies)
  thumbnail: z.string().nullable(),
  bytes: z.number().int(),
  windowPresets: z.array(WindowPreset),
  displayNote: z.string().optional(),
});
export type Series = z.infer<typeof Series>;

export const SpatialLinkKind = z.enum(['same_volume', 'common_frame', 'registered', 'independent', 'different_patients']);
export type SpatialLinkKind = z.infer<typeof SpatialLinkKind>;

export const SpatialLink = z.object({
  id: z.string(),
  kind: SpatialLinkKind,
  seriesA: z.string(),
  seriesB: z.string(),
  evidence: z.string(),
  transform: z
    .object({
      method: z.string(),
      sourceSeries: z.string(),
      targetSeries: z.string(),
      convention: z.string(),
      matrix: z.array(z.number()).length(16),
      units: z.literal('mm'),
      file: z.string().nullable(),
      validation: z.string(),
    })
    .nullable(),
});
export type SpatialLink = z.infer<typeof SpatialLink>;

export const ReviewRecord = z.object({
  status: z.enum(['unreviewed', 'reviewed_by_user']),
  reviewer: z.string().nullable(),
  at: z.string().nullable(),
  note: z.string().nullable(),
});

export const ReferenceTarget = z.object({
  id: z.string(),
  label: z.string(), // display label, e.g. "Heart (RT contour)"
  classId: z.string(), // e.g. "anatomy:heart", "finding:lung_nodule"
  seriesUid: z.string(),
  geometryType: z.enum(['contour_set', 'point', 'box', 'slice_interval', 'image_label']),
  geometryFile: z.string(), // relative to pack root
  provenance: Provenance,
  provenanceDetail: z.object({
    source: z.string(),
    method: z.string(),
    readers: z.array(z.string()).optional(),
    note: z.string().optional(),
  }),
  completeness: Completeness,
  assessedClasses: z.array(z.string()),
  unassessedNote: z.string(),
  review: ReviewRecord,
  teachingNote: z.string().optional(),
  /**
   * 'task' (default): references used by tasks and loaded with the case.
   * 'atlas': whole-anatomy labelling layer (often AI drafts), loaded lazily for the Learn-mode
   * anatomy overlay; never used to grade or to explain a mark authoritatively.
   */
  layer: z.enum(['task', 'atlas']).optional(),
  /** Grouping for the atlas UI, e.g. 'organ', 'bone', 'vessel', 'muscle', 'airway', 'other'. */
  category: z.string().optional(),
});
export type ReferenceTarget = z.infer<typeof ReferenceTarget>;

/** targets/<id>.json */
export const Polygon2D = z.array(Vec2);
export const Polygon3D = z.array(Vec3);
export const TargetGeometry = z.discriminatedUnion('geometryType', [
  z.object({
    geometryType: z.literal('contour_set'),
    space: z.enum(['patient_lps_mm', 'image_px']),
    planes: z.array(
      z.object({
        sopInstanceUid: z.string(),
        frame: z.number().int().min(1),
        polygons: z.array(z.union([Polygon3D, Polygon2D])), // closed rings; space decides tuple length
        holes: z.array(z.union([Polygon3D, Polygon2D])).optional(),
        reader: z.string().optional(),
      }),
    ),
  }),
  z.object({
    geometryType: z.literal('point'),
    space: z.enum(['patient_lps_mm', 'image_px']),
    sopInstanceUid: z.string(),
    frame: z.number().int().min(1),
    point: z.union([Vec3, Vec2]),
    toleranceMm: z.number().nullable(),
    tolerancePx: z.number().nullable().optional(),
  }),
  z.object({
    geometryType: z.literal('box'),
    space: z.literal('image_px'),
    boxes: z.array(
      z.object({
        sopInstanceUid: z.string(),
        frame: z.number().int().min(1),
        box: z.tuple([z.number(), z.number(), z.number(), z.number()]), // col0,row0,col1,row1
        reader: z.string().optional(),
      }),
    ),
  }),
  z.object({
    geometryType: z.literal('slice_interval'),
    space: z.literal('patient_lps_mm'),
    normal: Vec3,
    range: Vec2, // projection of IPP on normal (mm), inclusive
    sopInstanceUids: z.array(z.string()),
    derivation: z.string(),
  }),
  z.object({
    geometryType: z.literal('image_label'),
    sopInstanceUids: z.array(z.string()),
    labels: z.array(z.string()),
  }),
]);
export type TargetGeometry = z.infer<typeof TargetGeometry>;

export const PackManifest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  packId: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  generatedAt: z.string(),
  generator: z.string(),
  sources: z.array(SourceRef),
  subjects: z.array(Subject),
  studies: z.array(Study),
  series: z.array(Series),
  spatialLinks: z.array(SpatialLink),
  referenceTargets: z.array(ReferenceTarget),
});
export type PackManifest = z.infer<typeof PackManifest>;

// ---------------- Authored lessons (lessons.json) ----------------

export const BookAnchorRef = z.object({
  physical: z.number().int().min(1), // 1-based physical PDF page
  printed: z.string().nullable(),
  chapterId: z.string(),
  figureId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  note: z.string().optional(),
});
export type BookAnchorRef = z.infer<typeof BookAnchorRef>;

export const Hint = z.object({
  level: z.number().int().min(1).max(5),
  text: z.string(),
  action: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('jumpToTarget'), targetId: z.string() }),
      z.object({ type: z.literal('showRegion'), targetIds: z.array(z.string()) }),
      z.object({ type: z.literal('jumpSliceInterval'), targetId: z.string() }),
      z.object({ type: z.literal('open3D') }),
      z.object({ type: z.literal('reveal') }),
      z.object({ type: z.literal('setWindow'), preset: z.string() }),
    ])
    .optional(),
});
export type Hint = z.infer<typeof Hint>;

export const TaskTargetRef = z.object({
  targetId: z.string(),
  name: z.string(), // the name the learner must assign (for labelled tasks)
  acceptedNames: z.array(z.string()).optional(),
  required: z.boolean().default(true),
});

export const Grading = z.discriminatedUnion('kind', [
  // One mark must fall inside a target contour (within slab) or within toleranceMm of a point target.
  z.object({
    kind: z.literal('point_in_target'),
    slabToleranceMm: z.number(), // allowed distance of the marked slice from a contoured plane
    inPlaneToleranceMm: z.number(), // allowed distance outside the contour edge
  }),
  // Several labelled marks, one-to-one matched to targets.
  z.object({
    kind: z.literal('labelled_points'),
    slabToleranceMm: z.number(),
    inPlaneToleranceMm: z.number(),
    levelTargetId: z.string().nullable(), // slice_interval the marks must lie in, if any
    requireLabels: z.boolean(),
  }),
  // Navigate to a level: the slice at submission must be within a slice_interval target.
  z.object({ kind: z.literal('slice_interval'), toleranceMm: z.number() }),
  // Detect findings with boxes/points; one-to-one matching.
  z.object({
    kind: z.literal('findings'),
    matchRule: z.enum(['center_in_target', 'iou']),
    iouThreshold: z.number().nullable(),
    slabToleranceMm: z.number(),
    inPlaneToleranceMm: z.number(),
    allowNoFinding: z.boolean(),
  }),
  z.object({
    kind: z.literal('choice'),
    options: z.array(z.object({ id: z.string(), text: z.string(), correct: z.boolean(), why: z.string() })),
    multiple: z.boolean(),
  }),
  z.object({ kind: z.literal('self_review') }),
]);
export type Grading = z.infer<typeof Grading>;

export const RubricItem = z.object({
  id: z.string(),
  text: z.string(),
  weight: z.enum(['essential', 'supportive']),
  category: z.enum(['finding', 'location', 'pattern', 'associated_sign', 'differential', 'impression', 'limitation']),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const TaskType = z.enum([
  'find_structure',
  'navigate_level',
  'follow_structure',
  'locate_finding',
  'choose_window',
  'describe_finding',
  'compare_appearances',
  'correlate_modalities',
  'differential',
  'whole_study',
  'not_assessable',
]);
export type TaskType = z.infer<typeof TaskType>;

export const Task = z.object({
  id: z.string(),
  caseId: z.string(),
  type: TaskType,
  title: z.string(), // revealing title (Learn/Practice header after commit)
  prompt: z.string(), // must not leak the answer in Assess mode
  modes: z.array(z.enum(['learn', 'practice', 'assess'])),
  seriesUids: z.array(z.string()), // series the learner may use
  start: z.object({
    seriesUid: z.string(),
    slice: z.union([z.enum(['first', 'middle', 'last']), z.number().int()]),
    windowPreset: z.string().nullable(),
  }),
  targets: z.array(TaskTargetRef),
  grading: Grading,
  scoring: z.enum(['authoritative', 'exploratory_self_review']),
  hints: z.array(Hint),
  explanation: z.string(),
  rubric: z.array(RubricItem).optional(),
  bookAnchors: z.array(BookAnchorRef),
  objectiveIds: z.array(z.string()),
  skillDimensions: z.array(SkillDimension),
  allowUncertain: z.boolean().default(true),
});
export type Task = z.infer<typeof Task>;

export const TeachingCase = z.object({
  id: z.string(),
  packId: z.string(),
  neutralTitle: z.string(), // e.g. "Patient 07 · CT chest" — no diagnosis
  learnTitle: z.string(),
  subjectKey: z.string(),
  studyUids: z.array(z.string()),
  primarySeriesUid: z.string(),
  region: z.array(z.string()),
  clinicalContext: z.string().nullable(),
  contextSource: z.string().nullable(),
  difficulty: z.enum(['intro', 'typical', 'subtle', 'normal_comparison', 'exploratory']),
  objectiveIds: z.array(z.string()),
  bookAnchors: z.array(BookAnchorRef),
  referenceSummary: z.string(), // what is / is not referenced
  learnNotes: z.string(), // original teaching explanation
});
export type TeachingCase = z.infer<typeof TeachingCase>;

export const LessonFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  packId: z.string(),
  version: z.string(),
  cases: z.array(TeachingCase),
  tasks: z.array(Task),
});
export type LessonFile = z.infer<typeof LessonFile>;

export const PackIndex = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  packs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      manifest: z.string(), // relative URL to pack.json
      lessons: z.string().nullable(),
      bytes: z.number().int(),
      distribution: z.enum(['repo', 'fetch_script', 'external']),
      note: z.string(),
    }),
  ),
});
export type PackIndex = z.infer<typeof PackIndex>;
