import { describe, expect, it } from 'vitest';
import type { ReferenceTarget, Series, Task, TargetGeometry } from '../src/schema/content';
import { SeriesIndex } from '../src/grading/seriesIndex';
import { gradeTask, type LoadedTarget } from '../src/grading/spatialGrader';
import type { LearnerMark } from '../src/grading/types';
import { imageToPatient, type Vec3 } from '../src/lib/geometry';

// Synthetic axial CT: 20 slices, 2.5 mm apart, 1 mm pixels, 100x100. Patient left = +x = +column.
const SERIES_UID = '1.2.3';
const iop = [1, 0, 0, 0, 1, 0];
const series: Series = {
  uid: SERIES_UID,
  studyUid: 's',
  subjectKey: 'test:subj',
  modality: 'CT',
  sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
  frameOfReferenceUid: 'for',
  number: 1,
  description: 'synthetic',
  bodyPart: null,
  role: 'diagnostic',
  roleNote: '',
  acquisition: {},
  geometry: {
    rows: 100,
    columns: 100,
    pixelSpacing: [1, 1],
    pixelSpacingSource: 'PixelSpacing',
    spacingCalibrated: true,
    iop,
    sliceSpacing: 2.5,
    sliceSpacingUniform: true,
    volumeEligible: true,
    volumeIssues: [],
    photometric: 'MONOCHROME2',
    bitsStored: 12,
    pixelRepresentation: 1,
    rescale: { slope: 1, intercept: -1024, type: 'HU' },
    hu: true,
  },
  encoding: { transferSyntaxes: ['1.2.840.10008.1.2.1'], reencodedFrom: null, lossless: true, note: '' },
  instances: Array.from({ length: 20 }, (_, i) => ({
    sopInstanceUid: `sop${i}`,
    file: `f${i}`,
    bytes: 1,
    sha256: 'x',
    frames: 1,
    instanceNumber: i + 1,
    ipp: [-50, -50, i * 2.5] as Vec3,
  })),
  thumbnail: null,
  bytes: 20,
  windowPresets: [],
};
const idx = new SeriesIndex(series);
const seriesMap = new Map([[SERIES_UID, idx]]);

function ref(id: string, classId: string, label: string, provenance: ReferenceTarget['provenance'] = 'source_manual', geometryType: ReferenceTarget['geometryType'] = 'contour_set'): ReferenceTarget {
  return {
    id,
    label,
    classId,
    seriesUid: SERIES_UID,
    geometryType,
    geometryFile: `${id}.json`,
    provenance,
    provenanceDetail: { source: 'test', method: 'synthetic' },
    completeness: 'target_only',
    assessedClasses: [classId],
    unassessedNote: '',
    review: { status: 'unreviewed', reviewer: null, at: null, note: null },
  };
}

/** Square contour in patient LPS on slices [from,to], centred at (cx,cy) mm, half-size h. */
function squareContour(cx: number, cy: number, h: number, from: number, to: number): TargetGeometry {
  const planes = [];
  for (let i = from; i <= to; i++) {
    const z = i * 2.5;
    planes.push({
      sopInstanceUid: `sop${i}`,
      frame: 1,
      polygons: [
        [
          [cx - h, cy - h, z],
          [cx + h, cy - h, z],
          [cx + h, cy + h, z],
          [cx - h, cy + h, z],
        ] as Vec3[],
      ],
    });
  }
  return { geometryType: 'contour_set', space: 'patient_lps_mm', planes };
}

const targets = new Map<string, LoadedTarget>([
  ['lungL', { ref: ref('lungL', 'anatomy:lung_left', 'Left lung'), geom: squareContour(25, 0, 10, 2, 17) }],
  ['lungR', { ref: ref('lungR', 'anatomy:lung_right', 'Right lung'), geom: squareContour(-25, 0, 10, 2, 17) }],
  ['heart', { ref: ref('heart', 'anatomy:heart', 'Heart'), geom: squareContour(0, -10, 6, 4, 10) }],
  [
    'level',
    {
      ref: ref('level', 'level:five_vessel', 'Level', 'source_manual', 'slice_interval'),
      geom: { geometryType: 'slice_interval', space: 'patient_lps_mm', normal: [0, 0, 1], range: [20, 30], sopInstanceUids: ['sop8', 'sop9', 'sop10', 'sop11', 'sop12'], derivation: 'synthetic' },
    },
  ],
]);

function pointMark(id: string, col: number, row: number, slice: number, label: string | null = null): LearnerMark {
  return {
    id,
    tool: 'point',
    label,
    seriesUid: SERIES_UID,
    sopInstanceUid: `sop${slice}`,
    frame: 1,
    imagePx: [[col, row]],
    worldLps: [imageToPatient(idx.instances[slice].plane!, [col, row])],
    view: 'stack',
    createdAt: '2026-10-27T00:00:00Z',
  };
}
// Patient x = col - 50, y = row - 50.
const px = (x: number, y: number) => [x + 50, y + 50] as const;

function task(over: Partial<Task>): Task {
  return {
    id: 't',
    caseId: 'c',
    type: 'find_structure',
    title: 't',
    prompt: 'p',
    modes: ['practice'],
    seriesUids: [SERIES_UID],
    start: { seriesUid: SERIES_UID, slice: 'first', windowPreset: null },
    targets: [{ targetId: 'lungL', name: 'Left lung', required: true }],
    grading: { kind: 'point_in_target', slabToleranceMm: 1.3, inPlaneToleranceMm: 2 },
    scoring: 'authoritative',
    hints: [],
    explanation: '',
    bookAnchors: [],
    objectiveIds: [],
    skillDimensions: ['anatomy'],
    allowUncertain: true,
    ...over,
  };
}

describe('point_in_target', () => {
  it('accepts a known-correct mark', () => {
    const r = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m1', ...px(25, 0), 8)] });
    expect(r.authoritative).toBe(true);
    expect(r.outcome).toBe('correct');
    expect(r.score).toBe(1);
  });
  it('reports a wrong-side mark as the other validated structure', () => {
    const r = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m1', ...px(-25, 0), 8)] });
    expect(r.outcome).toBe('incorrect');
    expect(r.marks[0].status).toBe('wrong_structure');
    expect(r.marks[0].note).toMatch(/Right lung/);
  });
  it('applies the tolerance boundary exactly', () => {
    // contour edge at x=15; tolerance 2 mm -> x=13.0 inside tolerance, x=12.9 outside
    const inside = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m', ...px(13.0, 0), 8)] });
    const outside = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m', ...px(12.9, 0), 8)] });
    expect(inside.outcome).toBe('correct');
    expect(outside.outcome).toBe('incorrect');
  });
  it('rejects a mark on a slice where the structure is not outlined', () => {
    const r = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m', ...px(25, 0), 19)] });
    expect(r.outcome).toBe('incorrect');
  });
  it('does not invent a structure for clicks outside every reference', () => {
    const r = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('m', ...px(0, 40), 8)] });
    expect(r.marks[0].status).toBe('unmatched_unscored');
  });
  it('penalizes shotgun marking', () => {
    const r = gradeTask({ task: task({}), targets, series: seriesMap, marks: [pointMark('a', ...px(25, 0), 8), pointMark('b', ...px(-25, 0), 8)] });
    expect(r.outcome).toBe('partial');
    expect(r.score).toBeCloseTo(0.5);
  });
});

describe('labelled_points (five-vessel style)', () => {
  const t = task({
    targets: [
      { targetId: 'lungL', name: 'Left lung', required: true },
      { targetId: 'lungR', name: 'Right lung', required: true },
      { targetId: 'heart', name: 'Heart', required: true },
    ],
    grading: { kind: 'labelled_points', slabToleranceMm: 1.3, inPlaneToleranceMm: 2, levelTargetId: 'level', requireLabels: true },
  });
  it('credits correct labelled marks on the accepted level', () => {
    const r = gradeTask({
      task: t,
      targets,
      series: seriesMap,
      marks: [pointMark('a', ...px(25, 0), 9, 'left lung'), pointMark('b', ...px(-25, 0), 9, 'Right Lung'), pointMark('c', ...px(0, -10), 9, 'heart')],
    });
    expect(r.outcome).toBe('correct');
    expect(r.components.level?.ok).toBe(true);
  });
  it('counts duplicate clicks in one structure once', () => {
    const r = gradeTask({
      task: t,
      targets,
      series: seriesMap,
      marks: [pointMark('a', ...px(25, 0), 9, 'left lung'), pointMark('a2', ...px(26, 1), 9, 'left lung')],
    });
    expect(r.targets.filter((x) => x.status === 'found')).toHaveLength(1);
    expect(r.marks.find((m) => m.markId === 'a2')?.status).toBe('duplicate');
    expect(r.score).toBeCloseTo(1 / 3);
  });
  it('detects left/right confusion', () => {
    const r = gradeTask({ task: t, targets, series: seriesMap, marks: [pointMark('a', ...px(-25, 0), 9, 'left lung')] });
    expect(r.marks[0].status).toBe('wrong_side');
    expect(r.errors).toContain('wrong_laterality');
  });
  it('detects a correct structure on the wrong level', () => {
    const r = gradeTask({ task: t, targets, series: seriesMap, marks: [pointMark('a', ...px(25, 0), 15, 'left lung')] });
    expect(r.marks[0].status).toBe('off_level');
    expect(r.errors).toContain('navigation_failure');
  });
  it('detects a correct location with the wrong name', () => {
    const r = gradeTask({ task: t, targets, series: seriesMap, marks: [pointMark('a', ...px(0, -10), 9, 'left lung')] });
    expect(r.marks[0].status).toBe('wrong_structure');
  });
});

describe('slice_interval navigation', () => {
  const t = task({ type: 'navigate_level', targets: [{ targetId: 'level', name: 'Level', required: true }], grading: { kind: 'slice_interval', toleranceMm: 0 } });
  it('passes inside the interval and explains direction outside it', () => {
    const ok = gradeTask({ task: t, targets, series: seriesMap, marks: [], position: { seriesUid: SERIES_UID, sopInstanceUid: 'sop10', worldLps: null } });
    expect(ok.outcome).toBe('correct');
    const low = gradeTask({ task: t, targets, series: seriesMap, marks: [], position: { seriesUid: SERIES_UID, sopInstanceUid: 'sop2', worldLps: null } });
    expect(low.outcome).toBe('incorrect');
    expect(low.messages[0]).toMatch(/15 mm inferior \(caudal\)/);
  });
});

describe('reference authority', () => {
  it('never lets an unreviewed AI draft masquerade as a scoring key', () => {
    const draft = new Map(targets);
    draft.set('lungL', { ...targets.get('lungL')!, ref: { ...targets.get('lungL')!.ref, provenance: 'ai_draft' } });
    const r = gradeTask({ task: task({}), targets: draft, series: seriesMap, marks: [pointMark('m1', ...px(25, 0), 8)] });
    expect(r.authoritative).toBe(false);
    expect(r.outcome).toBe('self_review');
    expect(r.score).toBeNull();
  });
  it('requires an actual user review record for human_reviewed', () => {
    const fake = new Map(targets);
    fake.set('lungL', { ...targets.get('lungL')!, ref: { ...targets.get('lungL')!.ref, provenance: 'human_reviewed' } });
    expect(gradeTask({ task: task({}), targets: fake, series: seriesMap, marks: [pointMark('m1', ...px(25, 0), 8)] }).authoritative).toBe(false);
  });
});

describe('findings (whole-study style)', () => {
  const t = task({
    type: 'whole_study',
    targets: [{ targetId: 'heart', name: 'Finding A', required: true }],
    grading: { kind: 'findings', matchRule: 'center_in_target', iouThreshold: null, slabToleranceMm: 1.3, inPlaneToleranceMm: 3, allowNoFinding: true },
  });
  it('does not count unmatched marks as false positives when the reference is target-only', () => {
    const r = gradeTask({ task: t, targets, series: seriesMap, marks: [pointMark('a', ...px(0, -10), 6), pointMark('b', ...px(0, 40), 6)] });
    expect(r.outcome).toBe('correct');
    expect(r.marks.find((m) => m.markId === 'b')?.status).toBe('unmatched_unscored');
  });
  it('flags a missed finding when the learner declares no finding', () => {
    const r = gradeTask({ task: t, targets, series: seriesMap, marks: [], declaredNoFinding: true });
    expect(r.outcome).toBe('incorrect');
    expect(r.errors).toContain('missed_finding');
  });
  // E.g. the stroke lesion on DWI (required) and on ADC (optional), or a second box on a chest film.
  const withExtra = task({
    type: 'locate_finding',
    targets: [
      { targetId: 'heart', name: 'Finding A', required: true },
      { targetId: 'lungL', name: 'Extra finding', required: false },
    ],
    grading: { kind: 'findings', matchRule: 'center_in_target', iouThreshold: 0.3, slabToleranceMm: 1.3, inPlaneToleranceMm: 3, allowNoFinding: true },
  });
  it('is fully right when every required finding is marked, without the optional ones', () => {
    const r = gradeTask({ task: withExtra, targets, series: seriesMap, marks: [pointMark('a', ...px(0, -10), 6)] });
    expect(r.outcome).toBe('correct');
    expect(r.score).toBe(1);
    expect(r.errors).not.toContain('missed_finding');
    expect(r.targets.map((x) => x.targetId)).toEqual(['heart']);
  });
  it('credits an optional finding when it is marked, and still needs the required one', () => {
    const both = gradeTask({ task: withExtra, targets, series: seriesMap, marks: [pointMark('a', ...px(0, -10), 6), pointMark('b', ...px(25, 0), 6)] });
    expect(both.outcome).toBe('correct');
    expect(both.targets.find((x) => x.targetId === 'lungL')?.note).toMatch(/not required/);
    const extraOnly = gradeTask({ task: withExtra, targets, series: seriesMap, marks: [pointMark('b', ...px(25, 0), 6)] });
    expect(extraOnly.outcome).toBe('incorrect');
    expect(extraOnly.errors).toContain('missed_finding');
  });
  it('lets the required finding take the mark when an optional one covers the same place', () => {
    const same = new Map(targets);
    same.set('copy', { ref: ref('copy', 'finding:a', 'Same lesion, other series'), geom: squareContour(0, -10, 6, 4, 10) });
    const overlapping = task({ ...withExtra, targets: [{ targetId: 'copy', name: 'Same lesion, other series', required: false }, { targetId: 'heart', name: 'Finding A', required: true }] });
    const r = gradeTask({ task: overlapping, targets: same, series: seriesMap, marks: [pointMark('a', ...px(0, -10), 6)] });
    expect(r.outcome).toBe('correct');
    expect(r.targets.find((x) => x.targetId === 'heart')?.status).toBe('found');
  });
  it('asks only for the required findings when the learner declares none', () => {
    const r = gradeTask({ task: withExtra, targets, series: seriesMap, marks: [], declaredNoFinding: true });
    expect(r.targets.map((x) => x.targetId)).toEqual(['heart']);
    expect(r.messages[0]).toMatch(/1 finding/);
  });
});
