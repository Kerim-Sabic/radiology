import type { Series } from '../schema/content';
import { dot, sliceNormal, type ImagePlane, type Vec2, type Vec3 } from '../lib/geometry';

export interface InstanceGeom {
  sopInstanceUid: string;
  index: number; // geometric index within the series
  plane: ImagePlane | null; // null for projection images without IOP/IPP
  normalPos: number | null; // projection of IPP on the series normal
}

/** Per-series geometric lookup used by the grader and the overlay renderer. */
export class SeriesIndex {
  readonly uid: string;
  readonly normal: Vec3 | null;
  readonly instances: InstanceGeom[];
  readonly bySop = new Map<string, InstanceGeom>();
  readonly spacing: Vec2 | null;
  readonly calibrated: boolean;
  readonly rows: number;
  readonly columns: number;
  readonly modality: string;

  constructor(series: Series) {
    this.uid = series.uid;
    this.modality = series.modality;
    const g = series.geometry;
    this.rows = g.rows;
    this.columns = g.columns;
    this.spacing = g.pixelSpacing;
    this.calibrated = g.spacingCalibrated;
    this.normal = g.iop ? sliceNormal(g.iop) : null;
    this.instances = series.instances.map((inst, index) => {
      const plane: ImagePlane | null =
        g.iop && inst.ipp && g.pixelSpacing
          ? { ipp: inst.ipp as Vec3, iop: g.iop, pixelSpacing: g.pixelSpacing as Vec2, rows: g.rows, columns: g.columns }
          : null;
      return {
        sopInstanceUid: inst.sopInstanceUid,
        index,
        plane,
        normalPos: plane && this.normal ? dot(plane.ipp, this.normal) : null,
      };
    });
    for (const i of this.instances) this.bySop.set(i.sopInstanceUid, i);
  }

  /** Distance between neighbouring slices along the normal (median, mm), or null without slice positions. */
  get spacingMm(): number | null {
    const pos = this.instances.map((i) => i.normalPos).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const gaps = pos.slice(1).map((x, i) => x - pos[i]).filter((g) => g > 1e-3).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  }

  get hasPatientGeometry() {
    return this.normal !== null && this.instances.every((i) => i.plane !== null);
  }

  /** Nearest instance (by position along the normal) to a patient-space point. */
  nearestInstance(p: Vec3): InstanceGeom | null {
    if (!this.normal) return null;
    const pos = dot(p, this.normal);
    let best: InstanceGeom | null = null;
    let bestD = Infinity;
    for (const inst of this.instances) {
      if (inst.normalPos === null) continue;
      const d = Math.abs(inst.normalPos - pos);
      if (d < bestD) {
        bestD = d;
        best = inst;
      }
    }
    return best;
  }

  /** In-plane mm per contract px: [mm per column step, mm per row step]; falls back to 1 when uncalibrated. */
  mmPerPx(): Vec2 {
    if (!this.spacing) return [1, 1];
    return [this.spacing[1], this.spacing[0]];
  }
}
