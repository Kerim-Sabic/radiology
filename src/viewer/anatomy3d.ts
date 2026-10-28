/**
 * 3D anatomy models for the 3D panel. Each labelled structure of the series becomes a smooth coloured
 * surface, built only when first shown: its slice outlines are filled into a mask on the volume grid,
 * blurred, contoured with marching cubes and moved into patient space. The same masks answer "what is
 * under the cursor" by marching a ray through them.
 */
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';
import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import { cs } from './csInit';
import type { SeriesSource } from './engine';
import type { LoadedTarget } from '../grading/spatialGrader';
import { canonicalAnatomyKey } from '../content/bookAnatomy';
import { cleanLabel, provenanceTag } from '../lib/provenance';
import { colorFor, firstHit, groupFor, opacityFor, rasterize, smoothField, type Group3D, type Mask, type SliceRings } from './anatomyMask';
import { normalize, sub, type Vec2, type Vec3 } from '../lib/geometry';

export interface Structure3D {
  id: string;
  key: string;
  label: string;
  group: Group3D;
  color: string;
  /** Where the outline comes from ("AI draft by Horalix", "source manual"…). */
  tag: string;
  shown: boolean;
  status: 'idle' | 'building' | 'ready' | 'empty';
}

export interface Anatomy3DState {
  structures: Structure3D[];
  showVolume: boolean;
  /** Models still being built. */
  building: number;
  highlight: string | null;
  /** A quiz is running: nothing may name the structures on hover. */
  quiz: boolean;
}

interface ImageDataLike {
  worldToIndex(w: number[], out?: number[]): number[];
  indexToWorld(i: number[], out?: number[]): number[];
  getBounds(): number[];
  getSpacing(): number[];
}
type VtkActor = ReturnType<typeof vtkActor.newInstance>;
interface Vp3D {
  getImageData(): { imageData: ImageDataLike; dimensions: number[] } | undefined;
  getActors(): Array<{ uid: string; actor: { getClassName?(): string; setVisibility?(v: boolean): void; getMapper?(): unknown } }>;
  addActor(a: { uid: string; actor: unknown }): void;
  removeActors(uids: string[]): void;
  getCamera(): { focalPoint: number[]; position: number[]; viewPlaneNormal: number[]; parallelProjection?: boolean };
  canvasToWorld(c: number[]): number[];
  render(): void;
}
interface Entry {
  target: LoadedTarget;
  info: Structure3D;
  mask?: Mask | null;
  actor?: VtkActor;
}

const GHOST = '#94a3b8';
const MAX_GRID = 256;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export class Anatomy3D {
  private entries = new Map<string, Entry>();
  private showVolume = true;
  private highlightId: string | null = null;
  private building = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private targetKey = '';
  private sopIndex: Map<string, number>;

  constructor(
    private vp: Vp3D,
    private source: SeriesSource,
    private onChange: () => void,
  ) {
    this.sopIndex = new Map(source.sopUids.map((s, i) => [s, i]));
  }

  /** Structures available for this series; one per anatomical key (the whole-anatomy layer wins over other packs). */
  setTargets(targets: LoadedTarget[]) {
    const mine = targets.filter((t) => t.ref.seriesUid === this.source.seriesUid && t.geom.geometryType === 'contour_set');
    const key = mine.map((t) => t.ref.id).sort().join('|');
    if (key === this.targetKey) return;
    this.targetKey = key;
    const byKey = new Map<string, LoadedTarget>();
    for (const t of mine) {
      const k = canonicalAnatomyKey(t.ref.classId);
      const prev = byKey.get(k);
      if (!prev || (!prev.ref.category && t.ref.category)) byKey.set(k, t);
    }
    const keep = new Set([...byKey.values()].map((t) => t.ref.id));
    for (const [id, e] of this.entries) {
      if (keep.has(id)) continue;
      if (e.actor) this.vp.removeActors([this.uid(id)]);
      this.entries.delete(id);
    }
    for (const [k, t] of byKey) {
      if (this.entries.has(t.ref.id)) continue;
      this.entries.set(t.ref.id, {
        target: t,
        info: { id: t.ref.id, key: k, label: cleanLabel(t.ref.label), group: groupFor(k), color: colorFor(k), tag: provenanceTag(t.ref.provenance), shown: false, status: 'idle' },
      });
    }
    this.onChange();
  }

  state(): Anatomy3DState {
    const structures = [...this.entries.values()].map((e) => ({ ...e.info })).sort((a, b) => a.label.localeCompare(b.label));
    return { structures, showVolume: this.showVolume, building: this.building, highlight: this.highlightId, quiz: this.quiz };
  }

  /** Show exactly these structures (models are built the first time they are shown). */
  show(ids: Set<string>) {
    for (const e of this.entries.values()) {
      e.info.shown = ids.has(e.info.id);
      if (e.actor) e.actor.setVisibility(e.info.shown);
      if (e.info.shown && e.info.status === 'idle') this.enqueue(e);
    }
    this.restyle();
    this.vp.render();
    this.onChange();
  }

  setShowVolume(on: boolean) {
    this.showVolume = on;
    for (const a of this.vp.getActors()) if (a.actor.getClassName?.() === 'vtkVolume') a.actor.setVisibility?.(on);
    this.vp.render();
    this.onChange();
  }

  /** Emphasise one structure; with `ghost`, every other shown model turns into a faint grey silhouette. */
  highlight(id: string | null, ghost = false) {
    this.highlightId = id;
    this.ghost = ghost;
    this.restyle();
    this.vp.render();
    this.onChange();
  }
  private ghost = false;
  private quiz = false;
  setQuiz(on: boolean) {
    this.quiz = on;
    this.onChange();
  }

  /** Name under a canvas point: the first shown structure along the viewing ray that the cut keeps. */
  pick(canvas: Vec2): string | null {
    const img = this.vp.getImageData();
    if (!img) return null;
    const shown = [...this.entries.values()].filter((e) => e.info.shown && e.mask).map((e) => ({ id: e.info.id, mask: e.mask! }));
    if (!shown.length) return null;
    const cam = this.vp.getCamera();
    const p = this.vp.canvasToWorld(canvas) as Vec3;
    const n = cam.viewPlaneNormal as Vec3;
    const b = img.imageData.getBounds();
    const reach = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
    const dir: Vec3 = cam.parallelProjection === false ? normalize(sub(p, cam.position as Vec3)) : [-n[0], -n[1], -n[2]];
    const start: Vec3 = cam.parallelProjection === false ? (cam.position as Vec3) : [p[0] - dir[0] * reach, p[1] - dir[1] * reach, p[2] - dir[2] * reach];
    const step = Math.max(0.5, Math.min(...img.imageData.getSpacing()) * 0.75);
    const g = this.gridStep(img.dimensions);
    const planes = this.clipPlanes();
    const out = [0, 0, 0];
    return firstHit(
      shown,
      start,
      dir,
      reach * 2,
      step,
      (w) => {
        img.imageData.worldToIndex(w, out);
        return [out[0] / g, out[1] / g, out[2]];
      },
      (w) => planes.every((pl) => (w[0] - pl.o[0]) * pl.n[0] + (w[1] - pl.o[1]) * pl.n[1] + (w[2] - pl.o[2]) * pl.n[2] >= 0),
    );
  }

  label(id: string | null) {
    return id ? (this.entries.get(id)?.info.label ?? null) : null;
  }

  dispose() {
    this.disposed = true;
    const uids = [...this.entries.values()].filter((e) => e.actor).map((e) => this.uid(e.info.id));
    try {
      if (uids.length) this.vp.removeActors(uids);
    } catch {
      /* viewport already gone */
    }
    this.entries.clear();
  }

  // ------------------------------------------------------------------ building
  private uid(id: string) {
    return `anat3d:${id}`;
  }

  private gridStep(dims: number[]) {
    return Math.max(1, Math.ceil(Math.max(dims[0], dims[1]) / MAX_GRID));
  }

  private enqueue(e: Entry) {
    e.info.status = 'building';
    this.building++;
    this.queue = this.queue.then(async () => {
      await new Promise((r) => setTimeout(r, 0)); // let the panel repaint between models
      if (this.disposed) return;
      try {
        this.build(e);
      } catch (err) {
        console.warn('3D model failed', e.info.label, err);
        e.info.status = 'empty';
      }
      this.building--;
      if (this.disposed) return;
      this.restyle();
      this.onChange();
    });
  }

  private build(e: Entry) {
    const img = this.vp.getImageData();
    if (!img) throw new Error('volume not ready');
    const step = this.gridStep(img.dimensions);
    e.mask = this.mask(e.target, img, step);
    if (!e.mask) {
      e.info.status = 'empty';
      return;
    }
    const poly = this.surface(e.mask, img.imageData, step);
    const mapper = vtkMapper.newInstance();
    mapper.setInputData(poly);
    mapper.setScalarVisibility(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    const prop = actor.getProperty();
    prop.setAmbient(0.18);
    prop.setDiffuse(0.82);
    prop.setSpecular(0.28);
    prop.setSpecularPower(24);
    prop.setInterpolationToPhong();
    actor.setVisibility(e.info.shown);
    e.actor = actor;
    this.vp.addActor({ uid: this.uid(e.info.id), actor });
    e.info.status = 'ready';
  }

  /** Outlines → mask on the model grid (volume voxels, every `step`-th in-plane). */
  private mask(t: LoadedTarget, img: { imageData: ImageDataLike; dimensions: number[] }, step: number): Mask | null {
    const g = t.geom;
    if (g.geometryType !== 'contour_set') return null;
    const grid: Vec3 = [Math.ceil(img.dimensions[0] / step), Math.ceil(img.dimensions[1] / step), img.dimensions[2]];
    const slices: SliceRings[] = [];
    const idx = [0, 0, 0];
    for (const pl of g.planes) {
      const rings = [...pl.polygons, ...(pl.holes ?? [])].filter((r) => r.length >= 3);
      if (!rings.length) continue;
      let toWorld: (v: number[]) => number[];
      if (g.space === 'image_px') {
        const i = this.sopIndex.get(pl.sopInstanceUid);
        const imageId = i === undefined ? undefined : this.source.imageIds[i];
        const ip = imageId ? (cs.metaData.get('imagePlaneModule', imageId) as PlaneMeta | undefined) : undefined;
        if (!ip?.imagePositionPatient || !ip.rowCosines || !ip.columnCosines) continue;
        const o = ip.imagePositionPatient;
        const r = ip.rowCosines;
        const c = ip.columnCosines;
        const dx = ip.columnPixelSpacing ?? 1;
        const dy = ip.rowPixelSpacing ?? 1;
        // Contract pixels have their centres at integer [col, row].
        toWorld = (v) => [0, 1, 2].map((k) => o[k] + r[k] * dx * v[0] + c[k] * dy * v[1]);
      } else toWorld = (v) => v;
      let zSum = 0;
      let n = 0;
      const gridRings = rings.map((ring) =>
        ring.map((v) => {
          img.imageData.worldToIndex(toWorld(v as number[]), idx);
          zSum += idx[2];
          n++;
          return [idx[0] / step, idx[1] / step] as [number, number];
        }),
      );
      slices.push({ z: Math.round(zSum / n), rings: gridRings });
    }
    return rasterize(slices, grid);
  }

  /** Mask → smooth surface in patient space. */
  private surface(m: Mask, imageData: ImageDataLike, step: number) {
    const { field, size, origin } = smoothField(m);
    const id = vtkImageData.newInstance();
    id.setDimensions(size[0], size[1], size[2]);
    id.setOrigin([0, 0, 0]);
    id.setSpacing([1, 1, 1]);
    id.getPointData().setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values: field, name: 'mask' }));
    const mc = vtkImageMarchingCubes.newInstance({ contourValue: 0.5, computeNormals: false, mergePoints: true });
    mc.setInputData(id);
    const poly = mc.getOutputData();
    const pts = poly.getPoints().getData() as Float32Array;
    const w = [0, 0, 0];
    for (let i = 0; i < pts.length; i += 3) {
      imageData.indexToWorld([(pts[i] + origin[0]) * step, (pts[i + 1] + origin[1]) * step, pts[i + 2] + origin[2]], w);
      pts[i] = w[0];
      pts[i + 1] = w[1];
      pts[i + 2] = w[2];
    }
    poly.getPoints().modified();
    poly.modified();
    const smooth = vtkWindowedSincPolyDataFilter.newInstance({ numberOfIterations: 12, passBand: 0.1, nonManifoldSmoothing: 1, normalizeCoordinates: 1 });
    smooth.setInputData(poly);
    const normals = vtkPolyDataNormals.newInstance({ computePointNormals: true, computeCellNormals: false });
    normals.setInputData(smooth.getOutputData());
    return normals.getOutputData();
  }

  private restyle() {
    for (const e of this.entries.values()) {
      if (!e.actor) continue;
      const prop = e.actor.getProperty();
      const dim = this.ghost && this.highlightId && e.info.id !== this.highlightId;
      const focus = this.highlightId === e.info.id;
      prop.setColor(...rgb(dim ? GHOST : e.info.color));
      prop.setOpacity(dim ? 0.12 : focus ? 1 : opacityFor(e.info.key));
      prop.setAmbient(focus ? 0.35 : 0.18);
    }
  }

  /** Current cut planes (shared by every actor of the panel), to skip what the cut removed when picking. */
  private clipPlanes(): Array<{ o: number[]; n: number[] }> {
    const vol = this.vp.getActors().find((a) => a.actor.getClassName?.() === 'vtkVolume');
    const mapper = vol?.actor.getMapper?.() as { getClippingPlanes?(): Array<{ getOrigin(): number[]; getNormal(): number[] }> } | undefined;
    return (mapper?.getClippingPlanes?.() ?? []).map((p) => ({ o: p.getOrigin(), n: p.getNormal() }));
  }
}

interface PlaneMeta {
  imagePositionPatient?: number[];
  rowCosines?: number[];
  columnCosines?: number[];
  rowPixelSpacing?: number;
  columnPixelSpacing?: number;
}
