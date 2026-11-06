/**
 * Measurements of a finding from its expert outline: size on the image where it is largest (long axis and the widest
 * extent perpendicular to it), how far it runs across images, its volume on a cross-sectional series, and where it lies
 * relative to the anatomy layer. Shown to the learner only once the reference is visible; never used for grading.
 *
 * Everything is computed from the dataset's own outline: nothing about the finding is inferred. The location comes from the
 * anatomy layer and is labelled with that layer's provenance (an unreviewed AI outline says so).
 */
import { imageToPatient, patientToPlaneMm, polygonArea, type Vec2, type Vec3 } from '../lib/geometry';
import type { SeriesIndex } from './seriesIndex';
import { measureProbe, type LoadedTarget } from './spatialGrader';

export interface FindingMetrics {
  targetId: string;
  label: string;
  /** Images that carry the outline. */
  images: number;
  /** Longest in-plane diameter (mm, or px when the pixel size is not known) and the image it is on. */
  longAxis: number | null;
  /** Widest extent perpendicular to the long axis on that image. */
  shortAxis: number | null;
  largestSop: string | null;
  /** Extent across images along the slice normal (mm): images x spacing. */
  throughPlane: number | null;
  /** Volume (ml): outlined area on every image x slice spacing. Cross-sectional series only. */
  volumeMl: number | null;
  /** Area on a projection image (mm2), for radiographs. */
  areaMm2: number | null;
  unit: 'mm' | 'px';
  /** True when the pixel size is calibrated for patient size (CT, MR; not most radiographs). */
  calibrated: boolean;
  centroid: Vec3 | null;
}

type Plane = { sop: string; rings: Vec2[][]; holes: Vec2[][] };

/** Each outlined image as rings in millimetres on that image (or pixels when the pixel size is unknown). */
function planesMm(t: LoadedTarget, s: SeriesIndex): { planes: Plane[]; unit: 'mm' | 'px' } {
  const g = t.geom;
  const [mc, mr] = s.mmPerPx();
  const unit: 'mm' | 'px' = s.spacing ? 'mm' : 'px';
  const toMm = (p: number[]): Vec2 => [p[0] * (unit === 'mm' ? mc : 1), p[1] * (unit === 'mm' ? mr : 1)];
  if (g.geometryType === 'box') {
    return {
      unit,
      planes: g.boxes.map((b) => {
        const [c0, r0, c1, r1] = b.box;
        return { sop: b.sopInstanceUid, rings: [[toMm([c0, r0]), toMm([c1, r0]), toMm([c1, r1]), toMm([c0, r1])]], holes: [] };
      }),
    };
  }
  if (g.geometryType !== 'contour_set') return { unit, planes: [] };
  return {
    unit: g.space === 'patient_lps_mm' ? 'mm' : unit,
    planes: g.planes.map((pl) => {
      const conv = (ring: number[][]): Vec2[] => {
        if (g.space === 'image_px') return ring.map(toMm);
        const inst = s.bySop.get(pl.sopInstanceUid);
        return inst?.plane ? ring.map((q) => patientToPlaneMm(inst.plane!, q as Vec3)) : [];
      };
      return { sop: pl.sopInstanceUid, rings: (pl.polygons as number[][][]).map(conv), holes: ((pl.holes ?? []) as number[][][]).map(conv) };
    }),
  };
}

/** Centre of mass of a polygon (shoelace), not the mean of its vertices; the mean of the vertices if it has no area. */
function areaCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((x, q) => x + q[0], 0) / poly.length, poly.reduce((x, q) => x + q[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

function area(p: Plane): number {
  return p.rings.reduce((a, r) => a + polygonArea(r), 0) - p.holes.reduce((a, r) => a + polygonArea(r), 0);
}

/** Longest distance between two outline points on one image, and the widest extent perpendicular to it. */
function axes(p: Plane): [number, number] {
  const pts = p.rings.flat();
  let best = 0;
  let u: Vec2 = [1, 0];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > best) {
        best = d;
        u = [(pts[j][0] - pts[i][0]) / d, (pts[j][1] - pts[i][1]) / d];
      }
    }
  const proj = pts.map((q) => -u[1] * q[0] + u[0] * q[1]);
  return [best, proj.length ? Math.max(...proj) - Math.min(...proj) : 0];
}

export function findingMetrics(t: LoadedTarget, s: SeriesIndex | undefined): FindingMetrics | null {
  if (!s) return null;
  const { planes, unit } = planesMm(t, s);
  if (!planes.length) return null;
  let largest = planes[0];
  for (const p of planes) if (area(p) > area(largest)) largest = p;
  const [long, short] = axes(largest);
  const spacing = s.spacingMm;
  const cross = s.hasPatientGeometry && !!spacing;
  const sops = new Set(planes.map((p) => p.sop));
  // Centroid in patient space (cross-sectional series): the area-weighted centre of every outlined ring.
  let centroid: Vec3 | null = null;
  if (s.hasPatientGeometry && t.geom.geometryType === 'contour_set') {
    let w = 0;
    const acc: Vec3 = [0, 0, 0];
    for (const pl of t.geom.planes) {
      const inst = s.bySop.get(pl.sopInstanceUid);
      if (!inst?.plane) continue;
      for (const ring of pl.polygons as number[][][]) {
        let c: Vec3;
        let a: number;
        if (t.geom.space === 'image_px') {
          a = polygonArea(ring as Vec2[]);
          c = imageToPatient(inst.plane, areaCentroid(ring as Vec2[]));
        } else {
          const pts = ring.slice(0, ring.length > 1 && ring[0].every((v, k) => v === ring[ring.length - 1][k]) ? -1 : undefined) as Vec3[];
          a = polygonArea(pts.map((q) => patientToPlaneMm(inst.plane!, q)));
          c = [0, 1, 2].map((k) => pts.reduce((x, q) => x + q[k], 0) / pts.length) as Vec3;
        }
        for (let k = 0; k < 3; k++) acc[k] += c[k] * a;
        w += a;
      }
    }
    if (w > 0) centroid = [acc[0] / w, acc[1] / w, acc[2] / w];
  }
  return {
    targetId: t.ref.id,
    label: t.ref.label,
    images: sops.size,
    longAxis: long || null,
    shortAxis: short || null,
    largestSop: largest.sop,
    throughPlane: cross ? sops.size * spacing! : null,
    volumeMl: cross && unit === 'mm' ? (planes.reduce((a, p) => a + area(p), 0) * spacing!) / 1000 : null,
    areaMm2: !cross && unit === 'mm' ? area(largest) : null,
    unit,
    calibrated: s.calibrated,
    centroid,
  };
}

export interface FindingPlace {
  /** Anatomy outlines that contain the finding's centre. */
  inside: Array<{ id: string; label: string; ai: boolean }>;
  /** Other anatomy outlines within `nearMm` of the centre on the same image, nearest first. */
  near: Array<{ id: string; label: string; mm: number; ai: boolean }>;
}

/** Where the finding's centre lies in the anatomy layer of its series (same image; nearest structures). */
export function findingPlace(m: FindingMetrics, seriesUid: string, anatomy: LoadedTarget[], s: SeriesIndex | undefined, nearMm = 10): FindingPlace | null {
  if (!m.centroid || !s) return null;
  const halfGap = (s.spacingMm ?? 1) / 2 + 0.01;
  const inside: FindingPlace['inside'] = [];
  const near: FindingPlace['near'] = [];
  for (const a of anatomy) {
    if (a.ref.seriesUid !== seriesUid) continue;
    const r = measureProbe({ seriesUid, sop: null, px: null, world: m.centroid }, a, s);
    if (!r.comparable || r.sliceDistanceMm > halfGap) continue;
    const ai = a.ref.provenance === 'ai_draft';
    if (r.inPlaneDistanceMm === 0) inside.push({ id: a.ref.id, label: a.ref.label, ai });
    else if (r.inPlaneDistanceMm <= nearMm) near.push({ id: a.ref.id, label: a.ref.label, mm: r.inPlaneDistanceMm, ai });
  }
  near.sort((a, b) => a.mm - b.mm);
  return { inside, near: near.slice(0, 4) };
}
