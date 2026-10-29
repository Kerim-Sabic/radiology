/**
 * Projects reference geometry onto a viewport. Stack views draw only shapes referenced to the
 * displayed SOP instance; volume (MPR) views intersect patient-space polygons with the
 * current view plane. All maths in patient LPS mm → Cornerstone canvas via the engine.
 */
import type { LoadedTarget } from '../../grading/spatialGrader';
import type { SeriesIndex } from '../../grading/seriesIndex';
import { add, cross, dot, imageToPatient, norm, normalize, pointInPolygon, polygonArea, scale, sub, type Vec2, type Vec3 } from '../../lib/geometry';
import type { ViewerEngine } from '../../viewer/engine';

export interface Shape {
  targetId: string;
  label: string;
  kind: 'poly' | 'seg' | 'circle';
  pts: Vec2[];
  /** Holes inside this outline on the slice (e.g. the cranial cavity inside the skull): not part of the structure. */
  holes?: Vec2[][];
  provenance: string;
  category: string;
  layer: string;
}

/** Is the point on the structure itself (inside the outline and not in one of its holes)? */
export function shapeContains(sh: Shape, p: Vec2): boolean {
  return pointInPolygon(p, sh.pts) && !(sh.holes ?? []).some((h) => pointInPolygon(p, h));
}

/** Area of the structure on this slice: the outline minus its holes. */
export function shapeArea(sh: Shape): number {
  return polygonArea(sh.pts) - (sh.holes ?? []).reduce((a, h) => a + polygonArea(h), 0);
}

/** Every ring of the shapes (outlines and holes), for even-odd hit tests and edge distances. */
export function shapeRings(shapes: Shape[]): Vec2[][] {
  return shapes.flatMap((sh) => [sh.pts, ...(sh.holes ?? [])]);
}

export function shapesForPanel(engine: ViewerEngine, panelId: string, targets: LoadedTarget[], series: SeriesIndex | undefined): Shape[] {
  const st = engine.panelState(panelId);
  if (!st || !st.ready || st.kind === '3d') return [];
  const out: Shape[] = [];
  const toCanvas = (w: Vec3) => engine.worldToCanvas(panelId, w);
  if (st.kind === 'stack') {
    const imageId = st.currentImageId;
    if (!imageId) return [];
    const info = engine.imageIdInfo(imageId);
    if (!info) return [];
    for (const t of targets) {
      if (t.ref.seriesUid !== info.seriesUid) continue;
      const g = t.geom;
      const base = { targetId: t.ref.id, label: t.ref.label, provenance: t.ref.provenance, category: categoryFor(t.ref), layer: t.ref.layer ?? 'task' };
      const pxToCanvas = (p: Vec2) => {
        const w = engine.imagePxToWorld(imageId, p);
        return w ? toCanvas(w) : null;
      };
      if (g.geometryType === 'contour_set') {
        for (const plane of g.planes.filter((p) => p.sopInstanceUid === info.sop)) {
          const ring = (poly: Vec2[] | Vec3[]) => (g.space === 'image_px' ? (poly as Vec2[]).map(pxToCanvas) : (poly as Vec3[]).map(toCanvas)).filter((p): p is Vec2 => !!p);
          const holes = (plane.holes ?? []).map(ring).filter((h) => h.length >= 3);
          for (const poly of plane.polygons) {
            const pts = ring(poly);
            if (pts.length < 2) continue;
            // Each hole belongs to the outline that contains it.
            const own = pts.length >= 3 ? holes.filter((h) => pointInPolygon(h[0], pts)) : [];
            out.push(own.length ? { ...base, kind: 'poly', pts, holes: own } : { ...base, kind: 'poly', pts });
          }
        }
      } else if (g.geometryType === 'box') {
        for (const b of g.boxes.filter((x) => x.sopInstanceUid === info.sop)) {
          const [c0, r0, c1, r1] = b.box;
          const pts = ([[c0, r0], [c1, r0], [c1, r1], [c0, r1]] as Vec2[]).map(pxToCanvas).filter((p): p is Vec2 => !!p);
          if (pts.length === 4) out.push({ ...base, kind: 'poly', pts });
        }
      } else if (g.geometryType === 'point' && g.sopInstanceUid === info.sop) {
        const c = g.space === 'image_px' ? pxToCanvas(g.point as Vec2) : toCanvas(g.point as Vec3);
        if (c) out.push({ ...base, kind: 'circle', pts: [c] });
      }
    }
    return out;
  }
  // Volume views: intersect with the current plane.
  const plane = engine.plane(panelId);
  if (!plane || !series) return [];
  const halfThickness = Math.max(0.5, (series.normal ? Math.abs(dot(series.normal, plane.normal)) : 0) > 0.99 ? 1.0 : 0.6);
  for (const t of targets) {
    if (t.ref.seriesUid !== series.uid) continue;
    const g = t.geom;
    const base = { targetId: t.ref.id, label: t.ref.label, provenance: t.ref.provenance, category: categoryFor(t.ref), layer: t.ref.layer ?? 'task' };
    const polysLps: Vec3[][] = [];
    if (g.geometryType === 'contour_set') {
      for (const p of g.planes) {
        const inst = series.bySop.get(p.sopInstanceUid);
        for (const poly of p.polygons) {
          if (g.space === 'patient_lps_mm') polysLps.push(poly as Vec3[]);
          else if (inst?.plane) polysLps.push((poly as Vec2[]).map((px) => imageToPatient(inst.plane!, px)));
        }
      }
    } else if (g.geometryType === 'box') {
      for (const b of g.boxes) {
        const inst = series.bySop.get(b.sopInstanceUid);
        if (!inst?.plane) continue;
        const [c0, r0, c1, r1] = b.box;
        polysLps.push(([[c0, r0], [c1, r0], [c1, r1], [c0, r1]] as Vec2[]).map((px) => imageToPatient(inst.plane!, px)));
      }
    } else if (g.geometryType === 'point' && g.space === 'patient_lps_mm') {
      const d = Math.abs(dot(sub(g.point as Vec3, plane.point), plane.normal));
      if (d < 2) {
        const c = toCanvas(g.point as Vec3);
        if (c) out.push({ ...base, kind: 'circle', pts: [c] });
      }
    }
    const across: Vec3[][] = [];
    for (const poly of polysLps) {
      const d = poly.map((v) => dot(sub(v, plane.point), plane.normal));
      if (d.every((x) => Math.abs(x) <= halfThickness)) {
        const pts = poly.map(toCanvas).filter((p): p is Vec2 => !!p);
        if (pts.length >= 2) out.push({ ...base, kind: 'poly', pts });
      } else across.push(poly);
    }
    if (!across.length || !series.normal) continue;
    // Outlines drawn on the acquired slices, seen across: rebuild the solid cross-section instead of one line per slice.
    for (const ring of crossSection(across, series.normal, plane.point, plane.normal, series.spacingMm ?? 1)) {
      const pts = ring.map(toCanvas).filter((p): p is Vec2 => !!p);
      if (pts.length >= 3) out.push({ ...base, kind: 'poly', pts });
    }
  }
  return out;
}

interface Run {
  /** Position of the acquired slice along its normal (mm). */
  s: number;
  /** Ends of the run along the line where that slice meets the view plane. */
  t0: number;
  t1: number;
}

/**
 * Cross-section of a structure outlined on parallel slices, cut by another plane (MPR, oblique). Each slice's outline meets
 * the view plane in runs along one line; runs that overlap on neighbouring slices are joined into one outline whose ends
 * reach half a slice beyond the first and last slice (each outline stands for its slice's thickness). Patient-space rings.
 */
export function crossSection(polys: Vec3[][], sliceNormal: Vec3, viewPoint: Vec3, viewNormal: Vec3, spacingMm: number): Vec3[][] {
  const n = normalize(sliceNormal);
  const m = normalize(viewNormal);
  const along = cross(n, m);
  if (norm(along) < 1e-3) return []; // the view is parallel to the slices
  const u = normalize(along);
  // In the view plane, across the runs, pointing to higher slice positions.
  let v = normalize(cross(m, u));
  if (dot(v, n) < 0) v = scale(v, -1);
  const stepPerMm = 1 / Math.max(0.2, dot(v, n)); // in-plane distance per mm along the slice normal
  // A point of the view plane: on the line of slice position s, at position t along it.
  const at = (s: number, t: number): Vec3 => {
    const s0 = dot(viewPoint, n);
    const t0 = dot(viewPoint, u);
    return add(add(viewPoint, scale(v, (s - s0) * stepPerMm)), scale(u, t - t0));
  };

  const bySlice = new Map<number, Run[]>();
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const s = dot(poly[0], n);
    const d = poly.map((p) => dot(sub(p, viewPoint), m));
    const ts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      if (d[i] >= 0 === d[j] >= 0) continue;
      const f = d[i] / (d[i] - d[j]);
      ts.push(dot(add(poly[i], scale(sub(poly[j], poly[i]), f)), u));
    }
    ts.sort((a, b) => a - b);
    const key = Math.round(s * 100) / 100;
    const runs = bySlice.get(key) ?? [];
    for (let k = 0; k + 1 < ts.length; k += 2) runs.push({ s, t0: ts[k], t1: ts[k + 1] });
    if (runs.length) bySlice.set(key, runs);
  }
  // Join overlapping runs on the same slice (several outlines of one structure).
  const slices = [...bySlice.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, runs]) => {
      runs.sort((a, b) => a.t0 - b.t0);
      const merged: Run[] = [];
      for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && r.t0 <= last.t1) last.t1 = Math.max(last.t1, r.t1);
        else merged.push({ ...r });
      }
      return merged;
    });

  const half = spacingMm / 2;
  const rings: Vec3[][] = [];
  const close = (runs: Run[]) => {
    const first = runs[0];
    const last = runs[runs.length - 1];
    rings.push([
      at(first.s - half, first.t0),
      ...runs.map((r) => at(r.s, r.t0)),
      at(last.s + half, last.t0),
      at(last.s + half, last.t1),
      ...runs.map((r) => at(r.s, r.t1)).reverse(),
      at(first.s - half, first.t1),
    ]);
  };
  let open: Run[][] = [];
  for (const runs of slices) {
    const prevS = open[0]?.[open[0].length - 1].s;
    if (prevS !== undefined && runs[0].s - prevS > spacingMm * 1.5) {
      open.forEach(close);
      open = [];
    }
    // Each outline carries on into the run it overlaps most; where a structure splits or merges, the other runs start
    // outlines of their own and the outlines left over end here.
    const pairs: Array<{ o: Run[]; r: Run; overlap: number }> = [];
    for (const o of open)
      for (const r of runs) {
        const a = o[o.length - 1];
        const overlap = Math.min(a.t1, r.t1) - Math.max(a.t0, r.t0);
        if (overlap >= 0) pairs.push({ o, r, overlap });
      }
    pairs.sort((a, b) => b.overlap - a.overlap);
    const continued = new Set<Run[]>();
    const placed = new Set<Run>();
    for (const { o, r } of pairs) {
      if (continued.has(o) || placed.has(r)) continue;
      o.push(r);
      continued.add(o);
      placed.add(r);
    }
    for (const o of open) if (!continued.has(o)) close(o);
    open = [...continued, ...runs.filter((r) => !placed.has(r)).map((r) => [r])];
  }
  open.forEach(close);
  return rings;
}

/** Group a structure for the anatomy list and colours: lungs with the airways, the heart with the vessels. */
export function categoryFor(ref: { category?: string; classId: string }): string {
  const c = ref.classId.toLowerCase();
  if (/lung|trachea|bronch/.test(c)) return 'airway';
  if (/^anatomy:heart|atrial_appendage/.test(c)) return 'vessel';
  return ref.category ?? categoryOf(ref.classId);
}

/** Fallback category from a classId when the pack did not set one. */
export function categoryOf(classId: string): string {
  const c = classId.toLowerCase();
  if (/rib|vertebra|sacrum|femur|humerus|scapula|clavicula|clavicle|sternum|hip|skull|bone|spine/.test(c)) return 'bone';
  if (/artery|vein|aorta|vena|trunk|portal|iliac_(artery|vena)|vessel|carotid|subclavian|brachiocephalic|atrial_appendage/.test(c)) return 'vessel';
  if (/muscle|gluteus|iliopsoas|autochthon/.test(c)) return 'muscle';
  if (/trachea|bronch|airway|lung/.test(c)) return 'airway';
  if (/thyroid|adrenal|prostate|gland/.test(c)) return 'gland';
  if (/finding:/.test(c)) return 'finding';
  return 'organ';
}

export const CATEGORY_COLORS: Record<string, string> = {
  organ: '#7dd3fc',
  bone: '#e7e5e4',
  vessel: '#fb7185',
  muscle: '#fb923c',
  airway: '#c4b5fd',
  gland: '#6ee7b7',
  other: '#fde047',
  finding: '#ffd166',
};
