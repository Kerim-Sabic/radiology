import { describe, expect, it } from 'vitest';
import type { ReferenceTarget, Series, TargetGeometry } from '../src/schema/content';
import { SeriesIndex } from '../src/grading/seriesIndex';
import { findingMetrics, findingPlace } from '../src/grading/findingMetrics';
import type { LoadedTarget } from '../src/grading/spatialGrader';
import type { Vec3 } from '../src/lib/geometry';

// Synthetic axial CT: 20 slices 2.5 mm apart, 1 mm pixels, 100 x 100; patient x = col - 50, y = row - 50, z = 2.5 * slice.
const UID = '1.2.3';
const series = {
  uid: UID, studyUid: 's', subjectKey: 'test:s', modality: 'CT', sopClassUid: 'x', frameOfReferenceUid: 'f', number: 1, description: '',
  bodyPart: null, role: 'diagnostic', roleNote: '', acquisition: {},
  geometry: { rows: 100, columns: 100, pixelSpacing: [1, 1], pixelSpacingSource: 'PixelSpacing', spacingCalibrated: true, iop: [1, 0, 0, 0, 1, 0], sliceSpacing: 2.5, sliceSpacingUniform: true, volumeEligible: true, volumeIssues: [], photometric: 'MONOCHROME2', bitsStored: 12, pixelRepresentation: 1, rescale: null, hu: true },
  encoding: { transferSyntaxes: [], reencodedFrom: null, lossless: true, note: '' },
  instances: Array.from({ length: 20 }, (_, i) => ({ sopInstanceUid: `sop${i}`, file: '', bytes: 1, sha256: '', frames: 1, instanceNumber: i + 1, ipp: [-50, -50, i * 2.5] as Vec3 })),
  thumbnail: null, bytes: 1, windowPresets: [],
} as unknown as Series;
const idx = new SeriesIndex(series);

const ref = (id: string, classId: string, label: string, provenance: ReferenceTarget['provenance']): ReferenceTarget =>
  ({ id, label, classId, seriesUid: UID, geometryType: 'contour_set', geometryFile: '', provenance, provenanceDetail: { source: 't', method: 't' }, completeness: 'target_only', assessedClasses: [classId], unassessedNote: '', review: { status: 'unreviewed', reviewer: null, at: null, note: null } }) as ReferenceTarget;
/** Rectangle in pixels [c0,r0]-[c1,r1] on slices from..to. */
const rect = (c0: number, r0: number, c1: number, r1: number, from: number, to: number): TargetGeometry => ({
  geometryType: 'contour_set', space: 'image_px',
  planes: Array.from({ length: to - from + 1 }, (_, k) => ({ sopInstanceUid: `sop${from + k}`, frame: 1, polygons: [[[c0, r0], [c1, r0], [c1, r1], [c0, r1], [c0, r0]]] })),
}) as TargetGeometry;

describe('finding measurements from the expert outline', () => {
  const tumour: LoadedTarget = { ref: ref('t', 'finding:glioma', 'Glioma', 'source_manual'), geom: rect(40, 45, 70, 55, 4, 11) };

  it('measures long and short axis on the largest image, extent across images and volume', () => {
    const m = findingMetrics(tumour, idx)!;
    expect(m.images).toBe(8);
    expect(m.longAxis).toBeCloseTo(Math.hypot(30, 10), 5);
    // Widest extent perpendicular to the diagonal of a 30 x 10 rectangle.
    expect(m.shortAxis).toBeCloseTo((2 * 30 * 10) / Math.hypot(30, 10), 5);
    expect(m.throughPlane).toBeCloseTo(8 * 2.5, 5);
    expect(m.volumeMl).toBeCloseTo((300 * 8 * 2.5) / 1000, 5);
    expect(m.unit).toBe('mm');
    expect(m.centroid![2]).toBeCloseTo(((4 + 11) / 2) * 2.5, 5);
  });

  it('places the centre in the anatomy outline that contains it and names the near ones, flagged AI or expert', () => {
    const lobe: LoadedTarget = { ref: ref('a', 'anatomy:frontal_lobe_right', 'Right frontal lobe', 'ai_draft'), geom: rect(20, 20, 80, 80, 0, 19) };
    const vent: LoadedTarget = { ref: ref('b', 'anatomy:lateral_ventricle_right', 'Right lateral ventricle', 'ai_draft'), geom: rect(56, 58, 60, 62, 0, 19) };
    const far: LoadedTarget = { ref: ref('c', 'anatomy:cerebellum_left', 'Left cerebellar hemisphere', 'ai_draft'), geom: rect(85, 85, 95, 95, 0, 19) };
    const m = findingMetrics(tumour, idx)!;
    const p = findingPlace(m, UID, [lobe, vent, far], idx)!;
    expect(p.inside.map((x) => x.label)).toEqual(['Right frontal lobe']);
    expect(p.inside[0].ai).toBe(true);
    expect(p.near.map((x) => x.label)).toEqual(['Right lateral ventricle']);
    expect(p.near[0].mm).toBeCloseTo(Math.hypot(1, 8), 5);
  });

  it('gives an area, not a volume, on a radiograph, and says when sizes are not calibrated', () => {
    const xr = new SeriesIndex({ ...series, modality: 'CR', geometry: { ...series.geometry, iop: null, spacingCalibrated: false }, instances: [{ ...series.instances[0], ipp: null }] } as unknown as Series);
    const box: LoadedTarget = { ref: { ...ref('x', 'finding:nodule', 'Nodule', 'source_manual'), geometryType: 'box' }, geom: { geometryType: 'box', space: 'image_px', boxes: [{ sopInstanceUid: 'sop0', frame: 1, box: [10, 10, 30, 20] }] } as TargetGeometry };
    const m = findingMetrics(box, xr)!;
    expect(m.volumeMl).toBeNull();
    expect(m.areaMm2).toBeCloseTo(200, 5);
    expect(m.calibrated).toBe(false);
  });
});
