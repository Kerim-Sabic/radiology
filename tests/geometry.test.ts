import { describe, expect, it } from 'vitest';
import {
  boxIoU,
  csToContract,
  contractToCs,
  distanceToPolygon,
  edgeLabelsFromPatientOrientation,
  imageToPatient,
  orientationLetters,
  patientToImage,
  pointInPolygon,
  sortSlicesGeometric,
  type ImagePlane,
  type Vec3,
} from '../src/lib/geometry';

const axial: ImagePlane = { ipp: [-200, -180, 50], iop: [1, 0, 0, 0, 1, 0], pixelSpacing: [0.8, 0.7], rows: 512, columns: 512 };

describe('image <-> patient transforms', () => {
  it('maps the first pixel centre to IPP', () => {
    expect(imageToPatient(axial, [0, 0])).toEqual([-200, -180, 50]);
  });
  it('uses column spacing along rows and row spacing along columns', () => {
    // 10 columns right = +x by 10*0.7; 20 rows down = +y by 20*0.8
    const p = imageToPatient(axial, [10, 20]);
    expect(p[0]).toBeCloseTo(-193);
    expect(p[1]).toBeCloseTo(-164);
    expect(p[2]).toBeCloseTo(50);
  });
  it('round-trips through patient space, including oblique planes', () => {
    const c = Math.cos(0.3);
    const s = Math.sin(0.3);
    const oblique: ImagePlane = { ipp: [12, -40, 77], iop: [c, s, 0, 0, 0, -1], pixelSpacing: [1.25, 0.9], rows: 256, columns: 256 };
    for (const px of [
      [0, 0],
      [100.25, 37.5],
      [255, 255],
    ] as [number, number][]) {
      const back = patientToImage(oblique, imageToPatient(oblique, px));
      expect(back.px[0]).toBeCloseTo(px[0], 6);
      expect(back.px[1]).toBeCloseTo(px[1], 6);
      expect(back.planeDistanceMm).toBeCloseTo(0, 6);
    }
  });
  it('converts between Cornerstone corner-origin and contract centre-origin pixels', () => {
    expect(csToContract([0.5, 0.5])).toEqual([0, 0]);
    expect(contractToCs([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('geometric slice sorting', () => {
  const iop = [1, 0, 0, 0, 1, 0];
  const make = (zs: number[]) => zs.map((z, i) => ({ key: `f${i}`, ipp: [0, 0, z] as Vec3, iop }));
  it('orders by position along the normal, not by input/filename order', () => {
    const shuffled = make([30, -10, 10, 0, 20]);
    const r = sortSlicesGeometric(shuffled);
    expect(r.order).toEqual(['f1', 'f3', 'f2', 'f4', 'f0']);
    expect(r.spacing).toBeCloseTo(10);
    expect(r.volumeEligible).toBe(true);
  });
  it('sorts a sagittal stack along x', () => {
    const sag = [5, -5, 0].map((x, i) => ({ key: `s${i}`, ipp: [x, 0, 0] as Vec3, iop: [0, 1, 0, 0, 0, -1] }));
    // normal = row x col = [0,1,0] x [0,0,-1] = [-1,0,0]; ascending projection = descending x
    expect(sortSlicesGeometric(sag).order).toEqual(['s0', 's2', 's1']);
  });
  it('flags duplicates, gaps and mixed orientations as unsafe for MPR', () => {
    expect(sortSlicesGeometric(make([0, 0, 1, 2])).issues.join()).toMatch(/duplicate/);
    const gap = sortSlicesGeometric(make([0, 1, 2, 3, 6, 7, 8]));
    expect(gap.volumeEligible).toBe(false);
    expect(gap.issues.join()).toMatch(/missing slice|non-uniform/);
    const mixed = [...make([0, 1]), { key: 'x', ipp: [0, 0, 2] as Vec3, iop: [0, 1, 0, 0, 0, -1] }];
    expect(sortSlicesGeometric(mixed).issues.join()).toMatch(/mixed orientations/);
  });
});

describe('orientation letters (laterality)', () => {
  it('labels LPS directions', () => {
    expect(orientationLetters([1, 0, 0])).toBe('L');
    expect(orientationLetters([-1, 0, 0])).toBe('R');
    expect(orientationLetters([0, -1, 0])).toBe('A');
    expect(orientationLetters([0, 0, 1])).toBe('H');
    expect(orientationLetters([0.7, 0.7, 0])).toMatch(/^(LP|PL)$/);
  });
  it('derives radiograph edge labels from PatientOrientation', () => {
    // PA chest: columns increase toward patient Left, rows toward Feet -> patient right on screen left.
    expect(edgeLabelsFromPatientOrientation(['L', 'F'])).toEqual({ right: 'L', left: 'R', bottom: 'F', top: 'H' });
  });
});

describe('2D shape helpers', () => {
  const sq: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('point in polygon and boundary distance', () => {
    expect(pointInPolygon([5, 5], sq)).toBe(true);
    expect(pointInPolygon([15, 5], sq)).toBe(false);
    expect(distanceToPolygon([5, 5], sq)).toBe(0);
    expect(distanceToPolygon([13, 5], sq)).toBeCloseTo(3);
  });
  it('box IoU', () => {
    expect(boxIoU([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(boxIoU([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3);
    expect(boxIoU([0, 0, 1, 1], [2, 2, 3, 3])).toBe(0);
  });
});
