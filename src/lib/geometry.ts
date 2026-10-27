/**
 * DICOM geometry helpers. Pure functions, no Cornerstone dependency, unit tested.
 *
 * Contract (docs/COORDINATES.md):
 *  - Patient space: LPS millimetres (+x patient Left, +y Posterior, +z Superior/Head).
 *  - Image space ("contract px"): [column, row], zero-based, continuous, (0,0) = centre of
 *    the first transmitted pixel (matches ImagePositionPatient).
 *  - Cornerstone image coords put (0,0) at the top-left CORNER of the first pixel, so
 *    cs = contract + 0.5. Use csToContract / contractToCs at every boundary.
 *  - ImageOrientationPatient: iop[0..2] = row direction (increasing column index),
 *    iop[3..5] = column direction (increasing row index).
 *  - PixelSpacing = [rowSpacing (between rows), columnSpacing (between columns)].
 */
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};
export const distance3 = (a: Vec3, b: Vec3) => norm(sub(a, b));

export interface ImagePlane {
  ipp: Vec3;
  iop: number[]; // length 6
  pixelSpacing: Vec2; // [rowSpacing, columnSpacing]
  rows: number;
  columns: number;
}

export function rowDir(iop: number[]): Vec3 {
  return normalize([iop[0], iop[1], iop[2]]);
}
export function colDir(iop: number[]): Vec3 {
  return normalize([iop[3], iop[4], iop[5]]);
}
/** Slice normal = row × column (right-handed, as used for slice sorting). */
export function sliceNormal(iop: number[]): Vec3 {
  return normalize(cross(rowDir(iop), colDir(iop)));
}

/** Contract image px [col,row] → patient LPS mm. */
export function imageToPatient(plane: ImagePlane, px: Vec2): Vec3 {
  const [rowSp, colSp] = plane.pixelSpacing;
  const r = rowDir(plane.iop);
  const c = colDir(plane.iop);
  return add(add(plane.ipp, scale(r, px[0] * colSp)), scale(c, px[1] * rowSp));
}

/** Patient LPS mm → contract px [col,row] on this plane, plus signed distance from the plane (mm). */
export function patientToImage(plane: ImagePlane, p: Vec3): { px: Vec2; planeDistanceMm: number } {
  const [rowSp, colSp] = plane.pixelSpacing;
  const d = sub(p, plane.ipp);
  return {
    px: [dot(d, rowDir(plane.iop)) / colSp, dot(d, colDir(plane.iop)) / rowSp],
    planeDistanceMm: dot(d, sliceNormal(plane.iop)),
  };
}

/** Patient point → in-plane millimetre coordinates [u,v] (u along rows, v along columns). */
export function patientToPlaneMm(plane: Pick<ImagePlane, 'ipp' | 'iop'>, p: Vec3): Vec2 {
  const d = sub(p, plane.ipp);
  return [dot(d, rowDir(plane.iop)), dot(d, colDir(plane.iop))];
}

export const csToContract = (p: Vec2): Vec2 => [p[0] - 0.5, p[1] - 0.5];
export const contractToCs = (p: Vec2): Vec2 => [p[0] + 0.5, p[1] + 0.5];

// ---------------------------------------------------------------- slice sorting

export interface SliceInput {
  key: string;
  ipp: Vec3 | null;
  iop: number[] | null;
}

export interface SortResult {
  order: string[]; // keys in geometric order (ascending projection on the normal)
  positions: number[]; // projection (mm) for each key in `order`
  normal: Vec3 | null;
  spacing: number | null; // median spacing
  issues: string[];
  volumeEligible: boolean;
}

const ORIENTATION_EPS = 1e-3;

/**
 * Sort slices by ImagePositionPatient projected onto the normal derived from
 * ImageOrientationPatient. Never by filename or InstanceNumber.
 */
export function sortSlicesGeometric(slices: SliceInput[], spacingTolerance = 0.05): SortResult {
  const issues: string[] = [];
  if (slices.length === 0) return { order: [], positions: [], normal: null, spacing: null, issues: ['empty series'], volumeEligible: false };
  const withGeom = slices.filter((s) => s.ipp && s.iop);
  if (withGeom.length !== slices.length) {
    issues.push(`${slices.length - withGeom.length} instance(s) lack position/orientation`);
    return { order: slices.map((s) => s.key), positions: [], normal: null, spacing: null, issues, volumeEligible: false };
  }
  const iop0 = withGeom[0].iop!;
  const mixed = withGeom.some((s) => s.iop!.some((v, i) => Math.abs(v - iop0[i]) > ORIENTATION_EPS));
  if (mixed) issues.push('mixed orientations within series');
  const normal = sliceNormal(iop0);
  const projected = withGeom
    .map((s) => ({ key: s.key, pos: dot(s.ipp as Vec3, normal) }))
    .sort((a, b) => a.pos - b.pos);
  const gaps: number[] = [];
  let duplicates = 0;
  for (let i = 1; i < projected.length; i++) {
    const g = projected[i].pos - projected[i - 1].pos;
    if (Math.abs(g) < 1e-3) duplicates++;
    else gaps.push(g);
  }
  if (duplicates) issues.push(`${duplicates} duplicate slice position(s)`);
  let spacing: number | null = null;
  if (gaps.length) {
    const sorted = [...gaps].sort((a, b) => a - b);
    spacing = sorted[Math.floor(sorted.length / 2)];
    const irregular = gaps.filter((g) => Math.abs(g - spacing!) > spacingTolerance * Math.max(spacing!, 1e-6));
    if (irregular.length) {
      const maxGap = Math.max(...gaps);
      issues.push(
        maxGap > spacing * 1.5
          ? `non-uniform spacing: gap of ${maxGap.toFixed(2)} mm vs median ${spacing.toFixed(2)} mm (missing slice?)`
          : `non-uniform spacing (${irregular.length} irregular gap(s))`,
      );
    }
  }
  // In-plane offset drift (e.g. gantry tilt) — positions should move along the normal only.
  if (projected.length > 2) {
    const first = withGeom.find((s) => s.key === projected[0].key)!.ipp as Vec3;
    const last = withGeom.find((s) => s.key === projected[projected.length - 1].key)!.ipp as Vec3;
    const along = projected[projected.length - 1].pos - projected[0].pos;
    const drift = norm(sub(sub(last, first), scale(normal, along)));
    if (drift > 1) issues.push(`slice positions drift ${drift.toFixed(1)} mm in-plane (gantry tilt/shear)`);
  }
  const volumeEligible = slices.length >= 3 && issues.length === 0;
  return { order: projected.map((p) => p.key), positions: projected.map((p) => p.pos), normal, spacing, issues, volumeEligible };
}

// ---------------------------------------------------------------- orientation labels

/** Letters for a direction in LPS: +x L, -x R, +y P, -y A, +z H (S), -z F (I). */
export function orientationLetters(v: Vec3, threshold = 0.25): string {
  const parts: Array<[number, string]> = [
    [v[0], v[0] > 0 ? 'L' : 'R'],
    [v[1], v[1] > 0 ? 'P' : 'A'],
    [v[2], v[2] > 0 ? 'H' : 'F'],
  ];
  return parts
    .filter(([c]) => Math.abs(c) >= threshold)
    .sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
    .map(([, l]) => l)
    .join('');
}

const OPPOSITE: Record<string, string> = { L: 'R', R: 'L', A: 'P', P: 'A', H: 'F', F: 'H', S: 'I', I: 'S' };
export const oppositeLetters = (s: string) =>
  s
    .split('')
    .map((c) => OPPOSITE[c] ?? c)
    .join('');

/**
 * Projection radiographs often lack IOP but carry PatientOrientation (0020,0020):
 * [direction of increasing column, direction of increasing row], e.g. ["L","F"] for a PA chest.
 * Returns screen edge labels for an unrotated, unflipped display.
 */
export function edgeLabelsFromPatientOrientation(po: string[] | null | undefined) {
  if (!po || po.length < 2) return null;
  const right = po[0].trim().toUpperCase();
  const bottom = po[1].trim().toUpperCase();
  // Valid values are combinations of A, P, R, L, H, F only.
  if (!/^[APRLHF]{1,3}$/.test(right) || !/^[APRLHF]{1,3}$/.test(bottom)) return null;
  return { right, left: oppositeLetters(right), bottom, top: oppositeLetters(bottom) };
}

// ---------------------------------------------------------------- 2D shapes

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance to the polygon's boundary, regardless of inside/outside. */
export function distanceToBoundary(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distanceToSegment(p, poly[j], poly[i]));
  return best;
}

/** 0 when inside the polygon, otherwise the distance to its boundary. */
export function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length < 3) return poly.length ? Math.min(...poly.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))) : Infinity;
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distanceToSegment(p, poly[j], poly[i]));
  return best;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

export type Box = [number, number, number, number]; // x0,y0,x1,y1

export function normBox(b: Box): Box {
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

export function boxIoU(a: Box, b: Box): number {
  const A = normBox(a);
  const B = normBox(b);
  const ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0]));
  const iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
  const inter = ix * iy;
  const union = (A[2] - A[0]) * (A[3] - A[1]) + (B[2] - B[0]) * (B[3] - B[1]) - inter;
  return union <= 0 ? 0 : inter / union;
}

export function polygonBounds(poly: Vec2[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/**
 * Overlap (IoU) between two polygons estimated on a regular grid of `step` units.
 * Deterministic; adequate for contour-quality feedback (not used for detection credit).
 */
export function polygonIoU(a: Vec2[], b: Vec2[], step = 0.5): number {
  const ba = polygonBounds(a);
  const bb = polygonBounds(b);
  const x0 = Math.min(ba[0], bb[0]);
  const y0 = Math.min(ba[1], bb[1]);
  const x1 = Math.max(ba[2], bb[2]);
  const y1 = Math.max(ba[3], bb[3]);
  let inter = 0;
  let uni = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const ia = pointInPolygon([x, y], a);
      const ib = pointInPolygon([x, y], b);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
  }
  return uni === 0 ? 0 : inter / uni;
}
