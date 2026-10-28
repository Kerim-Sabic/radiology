import { describe, expect, it } from 'vitest';
import { colorFor, firstHit, groupFor, inMask, opacityFor, rasterize, smoothField, type Mask } from '../src/viewer/anatomyMask';
import type { Vec3 } from '../src/lib/geometry';

const square = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe('3D anatomy groups and colours', () => {
  it('puts each structure in the group a student looks for', () => {
    expect(groupFor('heart_ventricle_left')).toBe('heart');
    expect(groupFor('atrial_appendage_left')).toBe('heart');
    expect(groupFor('aorta_arch')).toBe('arteries');
    expect(groupFor('pulmonary_trunk')).toBe('arteries');
    expect(groupFor('pulmonary_arteries_right_lower_lobe')).toBe('arteries');
    expect(groupFor('brachiocephalic_trunk')).toBe('arteries');
    expect(groupFor('brachiocephalic_vein_left')).toBe('veins');
    expect(groupFor('pulmonary_vein')).toBe('veins');
    expect(groupFor('superior_vena_cava')).toBe('veins');
    expect(groupFor('portal_vein_and_splenic_vein')).toBe('veins');
    expect(groupFor('iliac_vena_left')).toBe('veins');
    expect(groupFor('iliac_artery_left')).toBe('arteries');
    expect(groupFor('main_bronchus_right')).toBe('airways');
    expect(groupFor('lung_upper_lobe_left')).toBe('lungs');
    expect(groupFor('t7_vertebra')).toBe('bones');
    expect(groupFor('rib_left_5')).toBe('bones');
    expect(groupFor('costal_cartilages')).toBe('bones');
    expect(groupFor('liver')).toBe('abdomen');
    expect(groupFor('iliopsoas_left')).toBe('muscles');
    expect(groupFor('spinal_cord')).toBe('other');
  });

  it('colours by the atlas convention: systemic arteries red, veins blue, pulmonary arteries blue-violet', () => {
    const red = (hex: string) => parseInt(hex.slice(1, 3), 16) > parseInt(hex.slice(5, 7), 16);
    expect(red(colorFor('aorta_arch'))).toBe(true);
    expect(red(colorFor('common_carotid_artery_left'))).toBe(true);
    expect(red(colorFor('superior_vena_cava'))).toBe(false);
    expect(red(colorFor('pulmonary_trunk'))).toBe(false);
    expect(red(colorFor('pulmonary_artery_left'))).toBe(false);
    expect(red(colorFor('heart_ventricle_left'))).toBe(true);
    expect(red(colorFor('heart_ventricle_right'))).toBe(false);
    expect(colorFor('pulmonary_vein')).not.toBe(colorFor('superior_vena_cava'));
    expect(opacityFor('lung_left')).toBeLessThan(0.5);
    expect(opacityFor('aorta')).toBe(1);
  });
});

describe('outline → mask', () => {
  it('fills the grid points inside a ring', () => {
    const m = rasterize([{ z: 2, rings: [square(1.5, 1.5, 4.5, 3.5)] }], [10, 10, 5])!;
    expect(m.voxels).toBe(3 * 2); // x 2..4, y 2..3
    expect(inMask(m, [3, 3, 2])).toBe(true);
    expect(inMask(m, [3, 3, 1])).toBe(false);
    expect(inMask(m, [1, 3, 2])).toBe(false);
  });

  it('leaves holes open (even-odd), e.g. the cavity inside the skull', () => {
    const m = rasterize([{ z: 0, rings: [square(0, 0, 10, 10), square(3, 3, 7, 7)] }], [12, 12, 1])!;
    expect(inMask(m, [1, 1, 0])).toBe(true);
    expect(inMask(m, [5, 5, 0])).toBe(false);
  });

  it('clips outlines to the grid and returns nothing for empty input', () => {
    const m = rasterize([{ z: 0, rings: [square(-5, -5, 2.2, 2.2)] }], [4, 4, 1])!;
    expect(m.origin).toEqual([0, 0, 0]);
    expect(m.voxels).toBe(9);
    expect(rasterize([], [4, 4, 1])).toBeNull();
    expect(rasterize([{ z: 7, rings: [square(0, 0, 2, 2)] }], [4, 4, 3])).toBeNull();
  });
});

describe('smoothing before surfacing', () => {
  it('keeps the inside above 0.5 and the margin far below it', () => {
    const slices = [0, 1, 2, 3, 4].map((z) => ({ z, rings: [square(0, 0, 8, 8)] }));
    const m = rasterize(slices, [9, 9, 5])!;
    const { field, size, origin } = smoothField(m, 2);
    expect(size).toEqual([13, 13, 9]);
    expect(origin).toEqual([-2, -2, -2]);
    const at = (x: number, y: number, z: number) => field[(z - origin[2]) * size[0] * size[1] + (y - origin[1]) * size[0] + (x - origin[0])];
    expect(at(4, 4, 2)).toBeGreaterThan(0.95);
    // The outermost margin stays far below 0.5, so every surface closes.
    expect(at(-2, -2, 2)).toBeLessThan(0.01);
    expect(at(-2, 4, 2)).toBeLessThan(0.1);
    // The edge sits near 0.5, so the surface stays where the outline was.
    expect(at(8, 4, 2)).toBeGreaterThan(0.4);
    expect(at(8, 4, 2)).toBeLessThan(0.75);
  });
});

describe('picking a model under the cursor', () => {
  const box = (o: Vec3, s: Vec3): Mask => ({ origin: o, size: s, data: new Uint8Array(s[0] * s[1] * s[2]).fill(1), voxels: s[0] * s[1] * s[2] });
  const front = { id: 'front', mask: box([0, 0, 0], [10, 3, 10]) };
  const back = { id: 'back', mask: box([0, 6, 0], [10, 3, 10]) };
  const inner = { id: 'inner', mask: box([4, 0, 4], [2, 2, 2]) };
  const id = (w: Vec3) => w;

  it('returns the first structure along the ray', () => {
    expect(firstHit([front, back], [5, -5, 5], [0, 1, 0], 30, 0.5, id, () => true)).toBe('front');
    expect(firstHit([front, back], [5, 20, 5], [0, -1, 0], 30, 0.5, id, () => true)).toBe('back');
  });

  it('names the smallest structure where several overlap (a ventricle inside the heart)', () => {
    expect(firstHit([front, inner], [5, -5, 5], [0, 1, 0], 30, 0.5, id, () => true)).toBe('inner');
  });

  it('looks through what the 3D cut removed', () => {
    expect(firstHit([front, back], [5, -5, 5], [0, 1, 0], 30, 0.5, id, (w) => w[1] > 4)).toBe('back');
    expect(firstHit([front, back], [50, -5, 5], [0, 1, 0], 30, 0.5, id, () => true)).toBeNull();
  });
});
