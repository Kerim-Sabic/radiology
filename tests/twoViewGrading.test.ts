/**
 * Two views in one radiograph series ("CHEST, PA & LATERAL"): each view has its own panel, and a mark is graded against
 * the targets of the image it was placed on, never against the other view at the same pixel.
 */
import { describe, expect, it } from 'vitest';
import type { ReferenceTarget, Series, Task, TargetGeometry } from '../src/schema/content';
import { SeriesIndex } from '../src/grading/seriesIndex';
import { gradeTask, type LoadedTarget } from '../src/grading/spatialGrader';
import type { LearnerMark } from '../src/grading/types';

const UID = '9.9.9';
const series: Series = {
  uid: UID,
  studyUid: 's',
  subjectKey: 'test:xr',
  modality: 'CR',
  sopClassUid: '1.2.840.10008.5.1.4.1.1.1',
  frameOfReferenceUid: null,
  number: 1,
  description: 'CHEST, PA & LATERAL',
  bodyPart: 'CHEST',
  role: 'diagnostic',
  roleNote: '',
  acquisition: {},
  geometry: {
    rows: 200,
    columns: 200,
    pixelSpacing: [0.5, 0.5],
    pixelSpacingSource: 'ImagerPixelSpacing',
    spacingCalibrated: false,
    iop: null,
    sliceSpacing: null,
    sliceSpacingUniform: false,
    volumeEligible: false,
    volumeIssues: ['projection radiograph'],
    photometric: 'MONOCHROME2',
    bitsStored: 12,
    pixelRepresentation: 0,
    rescale: null,
    hu: false,
  },
  encoding: { transferSyntaxes: ['1.2.840.10008.1.2.1'], reencodedFrom: null, lossless: true, note: '' },
  // Image 1 is the PA, image 2 the lateral (projection images: no position in the patient).
  instances: ['pa', 'lat'].map((sop, i) => ({ sopInstanceUid: sop, file: `${sop}.dcm`, bytes: 1, sha256: 'x', frames: 1, instanceNumber: i + 1, ipp: null })),
  thumbnail: null,
  bytes: 2,
  windowPresets: [],
} as unknown as Series;
const idx = new SeriesIndex(series);
const seriesMap = new Map([[UID, idx]]);

function ref(id: string, label: string): ReferenceTarget {
  return {
    id,
    label,
    classId: 'finding:lung_nodule',
    seriesUid: UID,
    geometryType: 'box',
    geometryFile: `${id}.json`,
    provenance: 'source_manual',
    provenanceDetail: { source: 'test', method: 'synthetic' },
    completeness: 'target_only',
    assessedClasses: ['finding:lung_nodule'],
    unassessedNote: '',
    review: { status: 'unreviewed', reviewer: null, at: null, note: null },
  };
}
const box = (sop: string, b: [number, number, number, number]): TargetGeometry => ({ geometryType: 'box', space: 'image_px', boxes: [{ sopInstanceUid: sop, frame: 1, box: b }] }) as TargetGeometry;
// The nodule on the PA is at the left of the image; on the lateral it projects elsewhere (to the right).
const targets = new Map<string, LoadedTarget>([
  ['onPa', { ref: ref('onPa', 'Nodule (PA)'), geom: box('pa', [20, 80, 60, 120]) }],
  ['onLat', { ref: ref('onLat', 'Nodule (lateral)'), geom: box('lat', [140, 80, 180, 120]) }],
]);

const mark = (sop: string, col: number, row: number): LearnerMark => ({
  id: `${sop}-${col}`,
  tool: 'point',
  label: null,
  seriesUid: UID,
  sopInstanceUid: sop,
  frame: 1,
  imagePx: [[col, row]],
  worldLps: null,
  view: 'stack',
  createdAt: '2026-11-06T00:00:00Z',
});

const task = (targetId: string): Task => ({
  id: 't',
  caseId: 'c',
  type: 'locate_finding',
  title: 'Find it on the lateral too',
  prompt: 'Mark the nodule on the lateral view.',
  modes: ['practice'],
  seriesUids: [UID],
  start: { seriesUid: UID, slice: 'first', windowPreset: null },
  targets: [{ targetId, name: 'Nodule', required: true }],
  grading: { kind: 'point_in_target', slabToleranceMm: 0, inPlaneToleranceMm: 2 },
  scoring: 'authoritative',
  hints: [],
  explanation: '',
  bookAnchors: [],
  objectiveIds: [],
  skillDimensions: ['detection'],
  allowUncertain: true,
}) as unknown as Task;

describe('two views of one radiograph series', () => {
  it('grades a mark on the lateral against the lateral target', () => {
    const r = gradeTask({ task: task('onLat'), targets, series: seriesMap, marks: [mark('lat', 160, 100)] });
    expect(r.outcome).toBe('correct');
  });

  it('never credits a lateral mark with the PA target at the same pixel', () => {
    // Inside the PA box, but placed on the lateral image.
    const r = gradeTask({ task: task('onPa'), targets, series: seriesMap, marks: [mark('lat', 40, 100)] });
    expect(r.outcome).not.toBe('correct');
  });

  it('never credits a PA mark with the lateral target at the same pixel', () => {
    const r = gradeTask({ task: task('onLat'), targets, series: seriesMap, marks: [mark('pa', 160, 100)] });
    expect(r.outcome).not.toBe('correct');
  });

  it('grades the PA mark against the PA target', () => {
    const r = gradeTask({ task: task('onPa'), targets, series: seriesMap, marks: [mark('pa', 40, 100)] });
    expect(r.outcome).toBe('correct');
  });
});
