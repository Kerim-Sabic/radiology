/**
 * Pure helpers for the 3D anatomy models: which group and colour a structure gets, how its slice
 * outlines become a voxel mask, how that mask is smoothed before surfacing, and how a ray finds the
 * first visible structure under the cursor. No WebGL here, so all of it is unit-tested.
 */
import type { Vec3 } from '../lib/geometry';

export type Group3D = 'heart' | 'arteries' | 'veins' | 'airways' | 'lungs' | 'bones' | 'abdomen' | 'muscles' | 'other';

export const GROUP_LABEL: Record<Group3D, string> = {
  heart: 'Heart',
  arteries: 'Arteries',
  veins: 'Veins',
  airways: 'Airways',
  lungs: 'Lungs',
  bones: 'Bones',
  abdomen: 'Abdominal organs',
  muscles: 'Muscles',
  other: 'Other',
};
export const GROUP_ORDER: Group3D[] = ['heart', 'arteries', 'veins', 'airways', 'lungs', 'bones', 'abdomen', 'muscles', 'other'];

/** Group of a canonical anatomy key (see canonicalAnatomyKey). Pulmonary arteries are arteries, pulmonary veins veins. */
export function groupFor(key: string): Group3D {
  if (/^heart|^atrial_appendage/.test(key)) return 'heart';
  if (/^aorta|artery|arteries|^pulmonary_trunk|^brachiocephalic_trunk/.test(key)) return 'arteries';
  if (/vein|vena|^portal/.test(key)) return 'veins';
  if (/^trachea|bronch/.test(key)) return 'airways';
  if (/^lung/.test(key)) return 'lungs';
  if (/rib|vertebra|^sacrum|^femur|^humerus|^scapula|^clavicle|^sternum|^hip|^skull|^spine|costal/.test(key)) return 'bones';
  if (/^(liver|gallbladder|spleen|pancreas|kidney|adrenal|stomach|duodenum|small_bowel|colon|rectum|bladder|prostate|uterus|esophagus)/.test(key)) return 'abdomen';
  if (/gluteus|iliopsoas|autochthon|diaphragm|muscle/.test(key)) return 'muscles';
  return 'other';
}

/**
 * Teaching colours (as in anatomy atlases): systemic arteries red, systemic veins blue, pulmonary arteries
 * (deoxygenated blood) blue-violet, pulmonary veins rose, portal venous system purple; right heart blue, left heart red.
 */
export function colorFor(key: string): string {
  const rules: Array<[RegExp, string]> = [
    [/^heart_atrium_right/, '#60a5fa'],
    [/^heart_ventricle_right/, '#818cf8'],
    [/^heart_atrium_left|^atrial_appendage_left/, '#fb7185'],
    [/^heart_ventricle_left/, '#ef4444'],
    [/^heart_myocardium/, '#be123c'],
    [/^heart/, '#f43f5e'],
    [/^pulmonary_(trunk|arter)/, '#6366f1'],
    [/^pulmonary_vein/, '#f472b6'],
    [/^portal/, '#a855f7'],
    [/^aorta|artery|^brachiocephalic_trunk/, '#dc2626'],
    [/vein|vena/, '#3b82f6'],
    [/^trachea|bronch/, '#67e8f9'],
    [/^lung/, '#f9a8d4'],
    [/costal/, '#cbd5e1'],
    [/rib|vertebra|^sacrum|^femur|^humerus|^scapula|^clavicle|^sternum|^hip|^skull|^spine/, '#f5f0e6'],
    [/^liver/, '#b45309'],
    [/^gallbladder/, '#65a30d'],
    [/^spleen/, '#7c3aed'],
    [/^kidney_cyst/, '#fde68a'],
    [/^kidney/, '#d97706'],
    [/^adrenal/, '#facc15'],
    [/^pancreas/, '#fcd34d'],
    [/^(stomach|esophagus)/, '#fb923c'],
    [/^(duodenum|small_bowel)/, '#fdba74'],
    [/^(colon|rectum)/, '#c2410c'],
    [/^bladder/, '#fde047'],
    [/^(prostate|thyroid)/, '#34d399'],
    [/^spinal_cord/, '#fef08a'],
    [/gluteus|iliopsoas|autochthon|diaphragm|muscle/, '#ea580c'],
  ];
  for (const [re, c] of rules) if (re.test(key)) return c;
  return '#94a3b8';
}

/** Lungs are drawn see-through so the airways and vessels inside them stay visible. */
export function opacityFor(key: string): number {
  if (/^lung/.test(key)) return 0.28;
  if (/^heart$|^heart_myocardium|^mediastinum|^hilum/.test(key)) return 0.55;
  return 1;
}

/** A structure's voxels on the model grid, stored only inside its bounding box. */
export interface Mask {
  /** Grid bounding box, inclusive start: [x0, y0, z0]; size [nx, ny, nz]. */
  origin: Vec3;
  size: Vec3;
  data: Uint8Array;
  voxels: number;
}

/** A closed ring in grid coordinates (x along columns, y along rows) on one grid slice z. */
export interface SliceRings {
  z: number;
  rings: Array<Array<[number, number]>>;
}

/**
 * Fill outlines into a mask with the even-odd rule (holes and islands come out right). A grid point
 * (x, y) is inside when it lies inside an odd number of rings; ring vertices are continuous grid coordinates.
 */
export function rasterize(slices: SliceRings[], grid: Vec3): Mask | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const s of slices) {
    if (s.z < 0 || s.z >= grid[2]) continue;
    for (const r of s.rings)
      for (const [x, y] of r) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    z0 = Math.min(z0, s.z);
    z1 = Math.max(z1, s.z);
  }
  if (!Number.isFinite(x0)) return null;
  const ox = Math.max(0, Math.ceil(x0));
  const oy = Math.max(0, Math.ceil(y0));
  const nx = Math.min(grid[0] - 1, Math.floor(x1)) - ox + 1;
  const ny = Math.min(grid[1] - 1, Math.floor(y1)) - oy + 1;
  const nz = z1 - z0 + 1;
  if (nx <= 0 || ny <= 0 || nz <= 0) return null;
  const data = new Uint8Array(nx * ny * nz);
  let voxels = 0;
  const xs: number[] = [];
  for (const s of slices) {
    if (s.z < 0 || s.z >= grid[2]) continue;
    const zOff = (s.z - z0) * nx * ny;
    for (let y = oy; y < oy + ny; y++) {
      xs.length = 0;
      for (const r of s.rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [ax, ay] = r[j];
          const [bx, by] = r[i];
          if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const row = zOff + (y - oy) * nx;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(ox, Math.ceil(xs[k]));
        const to = Math.min(ox + nx - 1, Math.floor(xs[k + 1]));
        // Crossings of all rings sorted together and filled pairwise: the even-odd rule.
        for (let x = from; x <= to; x++) data[row + x - ox] = 1;
      }
    }
  }
  for (let i = 0; i < data.length; i++) voxels += data[i];
  return voxels ? { origin: [ox, oy, z0], size: [nx, ny, nz], data, voxels } : null;
}

/**
 * Mask → smooth scalar field with a margin of `pad` voxels, blurred with a binomial kernel ([1 4 6 4 1] in-plane,
 * [1 2 1] between slices, since slices are usually further apart). Contouring it at 0.5 gives a smooth surface.
 */
export function smoothField(m: Mask, pad = 2): { field: Float32Array; size: Vec3; origin: Vec3 } {
  const [nx, ny, nz] = m.size;
  const sx = nx + 2 * pad;
  const sy = ny + 2 * pad;
  const sz = nz + 2 * pad;
  let a = new Float32Array(sx * sy * sz);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) a[(z + pad) * sx * sy + (y + pad) * sx + x + pad] = m.data[z * nx * ny + y * nx + x];
  const pass = (src: Float32Array, kernel: number[], stride: number, len: number, along: (i: number) => number) => {
    const dst = new Float32Array(src.length);
    const h = (kernel.length - 1) / 2;
    const sum = kernel.reduce((s, v) => s + v, 0);
    for (let i = 0; i < src.length; i++) {
      const pos = along(i);
      let acc = 0;
      for (let k = -h; k <= h; k++) {
        const p = pos + k;
        if (p < 0 || p >= len) continue;
        acc += kernel[k + h] * src[i + k * stride];
      }
      dst[i] = acc / sum;
    }
    return dst;
  };
  const k5 = [1, 4, 6, 4, 1];
  a = pass(a, k5, 1, sx, (i) => i % sx);
  a = pass(a, k5, sx, sy, (i) => Math.floor(i / sx) % sy);
  a = pass(a, [1, 2, 1], sx * sy, sz, (i) => Math.floor(i / (sx * sy)));
  return { field: a, size: [sx, sy, sz], origin: [m.origin[0] - pad, m.origin[1] - pad, m.origin[2] - pad] };
}

/** Whether a grid point (rounded) lies in a mask. */
export function inMask(m: Mask, g: Vec3): boolean {
  const x = Math.round(g[0]) - m.origin[0];
  const y = Math.round(g[1]) - m.origin[1];
  const z = Math.round(g[2]) - m.origin[2];
  if (x < 0 || y < 0 || z < 0 || x >= m.size[0] || y >= m.size[1] || z >= m.size[2]) return false;
  return m.data[z * m.size[0] * m.size[1] + y * m.size[0] + x] === 1;
}

/**
 * March a ray through the grid and return the first structure hit (smallest structure wins where several
 * overlap, e.g. a ventricle inside the heart). `toGrid` maps a world point to grid coordinates; `kept` says
 * whether a world point survives the 3D cut.
 */
export function firstHit(
  masks: Array<{ id: string; mask: Mask }>,
  start: Vec3,
  dir: Vec3,
  length: number,
  step: number,
  toGrid: (w: Vec3) => Vec3,
  kept: (w: Vec3) => boolean,
): string | null {
  for (let t = 0; t <= length; t += step) {
    const w: Vec3 = [start[0] + dir[0] * t, start[1] + dir[1] * t, start[2] + dir[2] * t];
    if (!kept(w)) continue;
    const g = toGrid(w);
    let best: { id: string; voxels: number } | null = null;
    for (const { id, mask } of masks) {
      if (inMask(mask, g) && (!best || mask.voxels < best.voxels)) best = { id, voxels: mask.voxels };
    }
    if (best) return best.id;
  }
  return null;
}
