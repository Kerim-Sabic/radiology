import { describe, expect, it } from 'vitest';
import { crossSection } from '../src/components/ws/overlayShapes';
import type { Vec3 } from '../src/lib/geometry';

/** A square of side 2r centred at (cx, cy) on the axial slice at height z (LPS mm). */
const square = (cx: number, cy: number, r: number, z: number): Vec3[] => [
  [cx - r, cy - r, z],
  [cx + r, cy - r, z],
  [cx + r, cy + r, z],
  [cx - r, cy + r, z],
];
const zs = (ring: Vec3[]) => ring.map((p) => p[2]);
const xs = (ring: Vec3[]) => ring.map((p) => p[0]);

describe('cross-section of slice outlines on a reformatted plane', () => {
  const axial: Vec3 = [0, 0, 1];
  const coronalAt = (y: number): [Vec3, Vec3] => [[0, y, 0], [0, 1, 0]];

  it('joins one outline per slice into one solid shape reaching half a slice beyond the ends', () => {
    const polys = [0, 1, 2, 3, 4].map((z) => square(0, 0, 5, z));
    const rings = crossSection(polys, axial, ...coronalAt(0), 1);
    expect(rings).toHaveLength(1);
    expect(Math.min(...zs(rings[0]))).toBeCloseTo(-0.5);
    expect(Math.max(...zs(rings[0]))).toBeCloseTo(4.5);
    expect(Math.min(...xs(rings[0]))).toBeCloseTo(-5);
    expect(Math.max(...xs(rings[0]))).toBeCloseTo(5);
    for (const p of rings[0]) expect(p[1]).toBeCloseTo(0); // on the view plane
  });

  it('keeps separate pieces apart: side by side, and across a gap in the slices', () => {
    const side = [0, 1, 2].flatMap((z) => [square(-10, 0, 3, z), square(10, 0, 3, z)]);
    expect(crossSection(side, axial, ...coronalAt(0), 1)).toHaveLength(2);
    const gap = [0, 1, 5, 6].map((z) => square(0, 0, 3, z));
    expect(crossSection(gap, axial, ...coronalAt(0), 1)).toHaveLength(2);
  });

  it('carries an outline into the larger branch where it splits, and misses outlines the plane does not cut', () => {
    const polys = [square(0, 0, 8, 0), square(0, 0, 8, 1), square(-6, 0, 1, 2), square(5, 0, 3, 2)];
    const rings = crossSection(polys, axial, ...coronalAt(0), 1);
    expect(rings).toHaveLength(2);
    const main = rings.find((r) => Math.min(...zs(r)) < 0)!;
    expect(Math.max(...zs(main))).toBeCloseTo(2.5); // continued into the wider branch
    expect(Math.max(...xs(main.filter((p) => p[2] > 2)))).toBeCloseTo(8);
    expect(crossSection([square(0, 20, 3, 0)], axial, ...coronalAt(0), 1)).toHaveLength(0);
    expect(crossSection([square(0, 0, 3, 0)], axial, [0, 0, 0], axial, 1)).toHaveLength(0); // parallel view
  });

  it('follows an oblique plane: the ends stay on the plane', () => {
    const tilt: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2];
    const rings = crossSection([0, 1, 2].map((z) => square(0, 0, 6, z)), axial, [0, 0, 1], tilt, 1);
    expect(rings).toHaveLength(1);
    for (const p of rings[0]) expect(p[1] * tilt[1] + (p[2] - 1) * tilt[2]).toBeCloseTo(0);
  });
});
