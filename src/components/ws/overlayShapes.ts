/**
 * Projects reference geometry onto a viewport. Stack views draw only shapes referenced to the
 * displayed SOP instance; volume (MPR) views intersect patient-space polygons with the
 * current view plane. All maths in patient LPS mm → Cornerstone canvas via the engine.
 */
import type { LoadedTarget } from '../../grading/spatialGrader';
import type { SeriesIndex } from '../../grading/seriesIndex';
import { dot, imageToPatient, sub, type Vec2, type Vec3 } from '../../lib/geometry';
import type { ViewerEngine } from '../../viewer/engine';

export interface Shape {
  targetId: string;
  label: string;
  kind: 'poly' | 'seg' | 'circle';
  pts: Vec2[];
  provenance: string;
  category: string;
  layer: string;
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
          for (const poly of plane.polygons) {
            const pts = (g.space === 'image_px' ? (poly as Vec2[]).map(pxToCanvas) : (poly as Vec3[]).map(toCanvas)).filter((p): p is Vec2 => !!p);
            if (pts.length >= 2) out.push({ ...base, kind: 'poly', pts });
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
    for (const poly of polysLps) {
      const d = poly.map((v) => dot(sub(v, plane.point), plane.normal));
      if (d.every((x) => Math.abs(x) <= halfThickness)) {
        const pts = poly.map(toCanvas).filter((p): p is Vec2 => !!p);
        if (pts.length >= 2) out.push({ ...base, kind: 'poly', pts });
        continue;
      }
      const crossings: Vec3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        if (d[i] === 0) crossings.push(poly[i]);
        else if (d[i] * d[j] < 0) {
          const s = d[i] / (d[i] - d[j]);
          crossings.push([poly[i][0] + s * (poly[j][0] - poly[i][0]), poly[i][1] + s * (poly[j][1] - poly[i][1]), poly[i][2] + s * (poly[j][2] - poly[i][2])]);
        }
      }
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const a = toCanvas(crossings[k]);
        const b = toCanvas(crossings[k + 1]);
        if (a && b) out.push({ ...base, kind: 'seg', pts: [a, b] });
      }
    }
  }
  return out;
}

/** Group a structure for the anatomy list and colours: lungs with the airways, the heart with the vessels. */
export function categoryFor(ref: { category?: string; classId: string }): string {
  const c = ref.classId.toLowerCase();
  if (/lung|trachea|bronch/.test(c)) return 'airway';
  if (/heart|atrial_appendage|atrium|ventricle|myocardium/.test(c)) return 'vessel';
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
