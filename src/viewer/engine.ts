/**
 * ViewerAdapter: owns the Cornerstone rendering engine, viewports, tool groups, data
 * fetching and resource disposal. React components talk to it through this API and
 * subscribe to its change counter; image arrays and WebGL objects never enter React state.
 */
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { cs, cst, initCornerstone, TOOL, MARK_TOOLS, MEASURE_TOOLS, arrowLabelHook } from './csInit';
import { SeriesFetcher, type FetchProgress } from './seriesFetcher';
import { add, cross, csToContract, dot, normalize, orientationLetters, edgeLabelsFromPatientOrientation, sub, type Vec2, type Vec3 } from '../lib/geometry';
import type { LearnerMark } from '../grading/types';
import { Anatomy3D, type Anatomy3DState } from './anatomy3d';
import type { LoadedTarget } from '../grading/spatialGrader';

export type ViewKind = 'stack' | 'axial' | 'coronal' | 'sagittal' | '3d';
export type PlaneKind = 'axial' | 'coronal' | 'sagittal';
/** Colour of each MPR plane: its reference line in the other views and its tag in its own corner. */
export const PLANE_COLORS: Record<PlaneKind, string> = { axial: '#f87171', coronal: '#4ade80', sagittal: '#c084fc' };
/** Reference line of a stack view (another series of the same patient) drawn in the linked views. */
export const STACK_LINE_COLOR = '#38bdf8';
/** Thick-slab rendering of the MPR views (MIP for vessels and nodules, MinIP for airways). */
export type SlabMode = { mm: number; blend: 'mip' | 'minip' | 'avg' } | null;
/** Patient directions: S head, I feet, A front, P back, R patient's right, L patient's left. */
export type Side = 'S' | 'I' | 'A' | 'P' | 'R' | 'L';
export const SIDE_VECTOR: Record<Side, Vec3> = { S: [0, 0, 1], I: [0, 0, -1], A: [0, -1, 0], P: [0, 1, 0], R: [-1, 0, 0], L: [1, 0, 0] };
export interface Cut3D {
  /** Part of the volume kept, as fractions of its extent: x right → left, y front → back, z feet → head. */
  box: { x: [number, number]; y: [number, number]; z: [number, number] };
  /** Cut at the current slice of an MPR view and keep the given side; the cut follows that view as it scrolls. */
  follow: Partial<Record<PlaneKind, Side>>;
}
export const NO_CUT: Cut3D = { box: { x: [0, 1], y: [0, 1], z: [0, 1] }, follow: {} };
export interface RefLine {
  a: Vec2;
  b: Vec2;
  color: string;
}
export type ToolId =
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'scroll'
  | 'point'
  | 'arrow'
  | 'box'
  | 'outline'
  | 'length'
  | 'angle'
  | 'ellipse'
  | 'eraser'
  | 'crosshairs'
  | 'rotate3d';

const TOOL_MAP: Record<ToolId, string> = {
  windowLevel: TOOL.WindowLevel,
  pan: TOOL.Pan,
  zoom: TOOL.Zoom,
  scroll: TOOL.StackScroll,
  point: TOOL.Probe,
  arrow: TOOL.Arrow,
  box: TOOL.Rectangle,
  outline: TOOL.Freehand,
  length: TOOL.Length,
  angle: TOOL.Angle,
  ellipse: TOOL.Ellipse,
  eraser: TOOL.Eraser,
  crosshairs: TOOL.Crosshairs,
  rotate3d: TOOL.TrackballRotate,
};
const MARK_TOOL_KIND: Record<string, LearnerMark['tool']> = {
  [TOOL.Probe]: 'point',
  [TOOL.Arrow]: 'arrow',
  [TOOL.Rectangle]: 'box',
  [TOOL.Freehand]: 'outline',
};

export interface SeriesSource {
  seriesUid: string;
  imageIds: string[];
  urls: string[]; // fetch URLs (same order as imageIds); empty strings for local files already registered
  sopUids: string[];
  modality: string;
  hasPatientGeometry: boolean; // true for CT/MR with IOP/IPP; false for projection radiographs
  patientOrientation: string[] | null; // radiograph PatientOrientation (0020,0020)
  volumeEligible: boolean;
  defaultWindow: { center: number; width: number } | null;
  /** Views of one frame of reference (same patient, same scan session) can be linked by position. */
  frameOfReferenceUid?: string | null;
  /** Slice normal and the position of every image (same order as imageIds; null when unknown). */
  normal?: Vec3 | null;
  positions?: Array<Vec3 | null>;
}

export interface PanelState {
  panelId: string;
  kind: ViewKind;
  seriesUid: string;
  index: number;
  count: number;
  window: { center: number; width: number } | null;
  zoom: number;
  edges: { left: string; right: string; top: string; bottom: string } | null;
  ready: boolean;
  error: string | null;
  progress: FetchProgress | null;
  currentImageId: string | null;
  /** Thick slab shown in this MPR view (null for a thin slice or a stack). */
  slab: SlabMode;
  /** How far this MPR view is tilted from its straight plane, in degrees (0 = straight). */
  obliqueDeg: number;
}

interface Panel {
  id: string;
  kind: ViewKind;
  element: HTMLDivElement;
  source: SeriesSource;
  viewportId: string;
  error: string | null;
  ready: boolean;
  cleanup: Array<() => void>;
}

type Listener = () => void;

const STACK_GROUP = 'tg-stack';
const MPR_GROUP = 'tg-mpr';
const VR_GROUP = 'tg-3d';
const ENGINE_ID = 'rvm-engine';

export interface ViewSnapshot {
  seriesUid: string;
  kind: ViewKind;
  index: number;
  sopInstanceUid: string | null;
  camera: { focalPoint: Vec3; position: Vec3; viewUp: Vec3; parallelScale: number };
  window: { center: number; width: number } | null;
}

export class ViewerEngine {
  private re: InstanceType<typeof cs.RenderingEngine> | null = null;
  private panels = new Map<string, Panel>();
  private fetchers = new Map<string, SeriesFetcher>();
  private listeners = new Set<Listener>();
  private version = 0;
  private activeTool: ToolId = 'windowLevel';
  private annotationListener: ((e: Event) => void) | null = null;
  private sopBySeriesImageId = new Map<string, { seriesUid: string; sop: string; index: number; projection: boolean }>();
  gpu = true;
  /** Marks are tagged with the current task so attempts never mix. */
  markScope = 'free';
  /** Linked views: reference lines everywhere, and scrolling one view moves the parallel views of the same patient. */
  private linked = true;
  /** Panels moved by the link, with the slice they were sent to (their own new-image event must not echo back). */
  private following = new Map<string, number>();
  private slab: SlabMode = null;
  private cuts = new Map<string, Cut3D>();
  private presets = new Map<string, string>();
  private anatomy = new Map<string, Anatomy3D>();
  private spacingCache = new WeakMap<SeriesSource, number>();
  /** Straight (non-oblique) camera direction of each MPR view, and the tilt applied from each view (degrees). */
  private baseOrientation = new Map<string, { normal: Vec3; up: Vec3 }>();
  private tilts = new Map<string, number>();
  /** Panels playing as a cine loop. */
  private playing = new Set<string>();

  async init() {
    const { gpu } = await initCornerstone();
    this.gpu = gpu;
    if (!this.re) this.re = new cs.RenderingEngine(ENGINE_ID);
    for (const id of [STACK_GROUP, MPR_GROUP, VR_GROUP]) {
      if (cst.ToolGroupManager.getToolGroup(id)) continue;
      const g = cst.ToolGroupManager.createToolGroup(id)!;
      const names =
        id === VR_GROUP
          ? [TOOL.TrackballRotate, TOOL.Zoom, TOOL.Pan]
          : [TOOL.WindowLevel, TOOL.Pan, TOOL.Zoom, TOOL.StackScroll, TOOL.Probe, TOOL.Arrow, TOOL.Rectangle, TOOL.Freehand, TOOL.Length, TOOL.Angle, TOOL.Ellipse, TOOL.Eraser, ...(id === MPR_GROUP ? [TOOL.Crosshairs] : [])];
      for (const n of names) {
        if (n === TOOL.Arrow) {
          g.addTool(n, {
            getTextCallback: (done: (t: string) => void) => (arrowLabelHook.request ? arrowLabelHook.request(done) : done('')),
            changeTextCallback: (_d: unknown, _e: unknown, done: (t: string) => void) => (arrowLabelHook.request ? arrowLabelHook.request(done) : done('')),
          });
        } else if (n === TOOL.Crosshairs) {
          g.addTool(n, {
            getReferenceLineColor: (viewportId: string) => {
              const k = [...this.panels.values()].find((p) => p.viewportId === viewportId)?.kind;
              return k && k !== 'stack' && k !== '3d' ? PLANE_COLORS[k] : STACK_LINE_COLOR;
            },
            mobile: { enabled: false },
          });
        } else g.addTool(n);
      }
    }
    this.applyTool(this.activeTool);
    if (!this.annotationListener) {
      this.annotationListener = () => this.bump();
      for (const ev of [cst.Enums.Events.ANNOTATION_COMPLETED, cst.Enums.Events.ANNOTATION_MODIFIED, cst.Enums.Events.ANNOTATION_REMOVED]) {
        cs.eventTarget.addEventListener(ev, this.annotationListener);
      }
    }
  }

  // ------------------------------------------------------------ subscription
  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ data
  fetcherFor(src: SeriesSource): SeriesFetcher {
    let f = this.fetchers.get(src.seriesUid);
    if (!f || f.aborted) {
      f = new SeriesFetcher(src.imageIds, src.urls);
      this.fetchers.set(src.seriesUid, f);
      f.onProgress(() => this.bump());
    }
    src.imageIds.forEach((id, index) => this.sopBySeriesImageId.set(id, { seriesUid: src.seriesUid, sop: src.sopUids[index], index, projection: !src.hasPatientGeometry }));
    return f;
  }

  // ------------------------------------------------------------ mounting
  async mount(panelId: string, element: HTMLDivElement, source: SeriesSource, kind: ViewKind, startIndex: number) {
    await this.init();
    this.unmount(panelId);
    const viewportId = `vp-${panelId}`;
    const panel: Panel = { id: panelId, kind, element, source, viewportId, error: null, ready: false, cleanup: [] };
    this.panels.set(panelId, panel);
    this.bump();
    // A newer mount of the same panel (series switch, layout change) supersedes this one: stop at the next await.
    const stale = () => this.panels.get(panelId) !== panel;
    const fetcher = this.fetcherFor(source);
    const re = this.re!;
    try {
      if (kind === 'stack') {
        const idx = Math.max(0, Math.min(startIndex, source.imageIds.length - 1));
        fetcher.start(idx);
        const ok = await fetcher.whenReady(idx);
        if (stale()) return;
        if (!ok) throw new Error(fetcher.errors.get(idx) ?? 'First image failed to load');
        await waitForLayout(element);
        if (stale()) return;
        re.enableElement({ viewportId, element, type: cs.Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } });
        cst.ToolGroupManager.getToolGroup(STACK_GROUP)!.addViewport(viewportId, ENGINE_ID);
        const vp = re.getViewport(viewportId) as InstanceType<typeof cs.StackViewport>;
        await vp.setStack(source.imageIds, idx);
        if (stale()) return;
        // The camera computed inside setStack can precede full metadata resolution; fit explicitly.
        vp.resetCamera();
        if (source.defaultWindow) this.setWindow(panelId, source.defaultWindow.center, source.defaultWindow.width, false);
        vp.render();
        const onNew = () => {
          const i = vp.getCurrentImageIdIndex();
          if (Math.abs(i - idx) > 3) fetcher.prioritize(i);
          this.bump();
        };
        for (const ev of [cs.Enums.Events.STACK_NEW_IMAGE, cs.Enums.Events.CAMERA_MODIFIED, cs.Enums.Events.VOI_MODIFIED]) {
          element.addEventListener(ev, onNew);
          panel.cleanup.push(() => element.removeEventListener(ev, onNew));
        }
        const onImage = () => this.followStack(panelId);
        element.addEventListener(cs.Enums.Events.STACK_NEW_IMAGE, onImage);
        panel.cleanup.push(() => element.removeEventListener(cs.Enums.Events.STACK_NEW_IMAGE, onImage));
      } else {
        if (!source.volumeEligible) throw new Error('This series is not a valid volume (irregular or mixed geometry). Use the stack view — reformatting it would distort anatomy.');
        fetcher.start(Math.floor(source.imageIds.length / 2));
        await fetcher.whenAllSettled();
        if (stale()) return;
        if (fetcher.progress.failed) throw new Error(`${fetcher.progress.failed} slice(s) failed to load; volume views need the complete series.`);
        const volumeId = `cornerstoneStreamingImageVolume:${source.seriesUid}`;
        let volume = cs.cache.getVolume(volumeId);
        if (!volume) {
          volume = await cs.volumeLoader.createAndCacheVolume(volumeId, { imageIds: source.imageIds });
          (volume as unknown as { load: () => void }).load();
        }
        if (stale()) return;
        await waitForLayout(element);
        if (stale()) return;
        if (kind === '3d') {
          re.enableElement({ viewportId, element, type: cs.Enums.ViewportType.VOLUME_3D, defaultOptions: { background: [0.02, 0.02, 0.03] } });
          cst.ToolGroupManager.getToolGroup(VR_GROUP)!.addViewport(viewportId, ENGINE_ID);
          await cs.setVolumesForViewports(re, [{ volumeId }], [viewportId]);
          if (stale()) return;
          const vp = re.getViewport(viewportId) as InstanceType<typeof cs.VolumeViewport3D>;
          const preset = source.modality === 'CT' ? 'CT-Bone' : 'MR-Default';
          vp.setProperties({ preset });
          this.presets.set(panelId, preset);
          // Start facing the patient (anterior view, head up) rather than looking along the scanner axis.
          panel.ready = true;
          this.set3DView(panelId, 'A');
          // Any camera change re-orients the first two clipping planes into a thin slab; put the cut back.
          const onCamera = () => this.applyCut(panelId);
          element.addEventListener(cs.Enums.Events.CAMERA_MODIFIED, onCamera);
          panel.cleanup.push(() => element.removeEventListener(cs.Enums.Events.CAMERA_MODIFIED, onCamera));
          this.applyCut(panelId);
          vp.render();
        } else {
          const orientation = { axial: cs.Enums.OrientationAxis.AXIAL, coronal: cs.Enums.OrientationAxis.CORONAL, sagittal: cs.Enums.OrientationAxis.SAGITTAL }[kind];
          re.enableElement({ viewportId, element, type: cs.Enums.ViewportType.ORTHOGRAPHIC, defaultOptions: { orientation, background: [0, 0, 0] } });
          cst.ToolGroupManager.getToolGroup(MPR_GROUP)!.addViewport(viewportId, ENGINE_ID);
          await cs.setVolumesForViewports(re, [{ volumeId }], [viewportId]);
          if (stale()) return;
          const vp = re.getViewport(viewportId) as unknown as CsViewport;
          vp.resetCamera();
          const cam0 = vp.getCamera();
          this.baseOrientation.set(panelId, { normal: [...cam0.viewPlaneNormal] as Vec3, up: [...cam0.viewUp] as Vec3 });
          if (source.defaultWindow) this.setWindow(panelId, source.defaultWindow.center, source.defaultWindow.width, false);
          this.applySlab(panel);
          vp.render();
          // A 3D cut that follows this plane moves with it.
          const onPlane = () => this.refreshFollowingCuts(source.seriesUid);
          element.addEventListener(cs.Enums.Events.CAMERA_MODIFIED, onPlane);
          panel.cleanup.push(() => element.removeEventListener(cs.Enums.Events.CAMERA_MODIFIED, onPlane));
        }
        const onChange = () => this.bump();
        for (const ev of [cs.Enums.Events.CAMERA_MODIFIED, cs.Enums.Events.VOI_MODIFIED, cs.Enums.Events.VOLUME_NEW_IMAGE]) {
          element.addEventListener(ev, onChange);
          panel.cleanup.push(() => element.removeEventListener(ev, onChange));
        }
      }
      panel.ready = true;
      this.applyTool(this.activeTool);
    } catch (e) {
      if (stale()) return;
      panel.error = e instanceof Error ? e.message : String(e);
    }
    this.bump();
  }

  unmount(panelId: string) {
    const p = this.panels.get(panelId);
    if (!p) return;
    this.stopPlay(panelId);
    p.cleanup.forEach((c) => c());
    this.anatomy.get(panelId)?.dispose();
    this.anatomy.delete(panelId);
    this.cuts.delete(panelId);
    this.presets.delete(panelId);
    this.baseOrientation.delete(panelId);
    this.tilts.delete(panelId);
    this.following.delete(panelId);
    for (const g of [STACK_GROUP, MPR_GROUP, VR_GROUP]) cst.ToolGroupManager.getToolGroup(g)?.removeViewports(ENGINE_ID, p.viewportId);
    try {
      this.re?.disableElement(p.viewportId);
    } catch {
      /* already disabled */
    }
    this.panels.delete(panelId);
    this.bump();
  }

  /** Release fetchers/volumes for series no longer shown (case switch). */
  releaseUnused(keepSeries: Set<string>) {
    for (const [uid, f] of this.fetchers) {
      if (keepSeries.has(uid)) continue;
      f.abort();
      this.fetchers.delete(uid);
      const volumeId = `cornerstoneStreamingImageVolume:${uid}`;
      if (cs.cache.getVolume(volumeId)) cs.cache.removeVolumeLoadObject(volumeId);
    }
  }

  destroy() {
    for (const id of [...this.panels.keys()]) this.unmount(id);
    for (const f of this.fetchers.values()) f.abort();
    this.fetchers.clear();
    cs.cache.purgeCache();
    this.re?.destroy();
    this.re = null;
    for (const g of [STACK_GROUP, MPR_GROUP, VR_GROUP]) cst.ToolGroupManager.destroyToolGroup(g);
    if (this.annotationListener) {
      for (const ev of [cst.Enums.Events.ANNOTATION_COMPLETED, cst.Enums.Events.ANNOTATION_MODIFIED, cst.Enums.Events.ANNOTATION_REMOVED]) {
        cs.eventTarget.removeEventListener(ev, this.annotationListener);
      }
      this.annotationListener = null;
    }
  }

  resize() {
    this.re?.resize(true, true);
    for (const p of this.panels.values()) {
      const vp = this.viewport(p.id);
      if (!vp || p.kind === '3d') continue;
      // Recover from a camera computed while the element was collapsed (zoom ≈ 0).
      const z = vp.getZoom?.() ?? 1;
      if (z < 0.02) {
        vp.resetCamera();
        vp.render();
      }
    }
  }

  // ------------------------------------------------------------ tools
  setTool(tool: ToolId) {
    this.activeTool = tool;
    this.applyTool(tool);
    this.bump();
  }
  getTool() {
    return this.activeTool;
  }

  private applyTool(tool: ToolId) {
    const MB = cst.Enums.MouseBindings;
    for (const id of [STACK_GROUP, MPR_GROUP]) {
      const g = cst.ToolGroupManager.getToolGroup(id);
      if (!g) continue;
      for (const n of [TOOL.WindowLevel, TOOL.Pan, TOOL.Zoom, TOOL.Probe, TOOL.Arrow, TOOL.Rectangle, TOOL.Freehand, TOOL.Length, TOOL.Angle, TOOL.Ellipse, TOOL.Eraser]) {
        if (MARK_TOOLS.has(n) || MEASURE_TOOLS.has(n)) g.setToolPassive(n);
        else g.setToolDisabled(n);
      }
      if (id === MPR_GROUP) {
        // Linked: the crosshair lines stay visible (and draggable) in every plane; X makes a click move them.
        const mode = g.getToolOptions(TOOL.Crosshairs)?.mode;
        if (tool !== 'crosshairs' && this.linked && mode !== cst.Enums.ToolModes.Passive) g.setToolPassive(TOOL.Crosshairs);
        if (tool !== 'crosshairs' && !this.linked && mode !== cst.Enums.ToolModes.Disabled) g.setToolDisabled(TOOL.Crosshairs);
      }
      const primary = TOOL_MAP[tool];
      const usable = id === MPR_GROUP || tool !== 'crosshairs';
      if (usable && primary !== TOOL.StackScroll && primary !== TOOL.TrackballRotate) g.setToolActive(primary, { bindings: [{ mouseButton: MB.Primary }] });
      if (tool === 'scroll') g.setToolActive(TOOL.StackScroll, { bindings: [{ mouseButton: MB.Primary }, { mouseButton: MB.Wheel }] });
      else g.setToolActive(TOOL.StackScroll, { bindings: [{ mouseButton: MB.Wheel }] });
      // Phones and tablets: one finger uses the active tool, a pinch zooms, three fingers pan.
      if (tool !== 'zoom') g.setToolActive(TOOL.Zoom, { bindings: [{ mouseButton: MB.Secondary }, { numTouchPoints: 2 }] });
      if (tool !== 'pan') g.setToolActive(TOOL.Pan, { bindings: [{ mouseButton: MB.Auxiliary }, { numTouchPoints: 3 }] });
      if (tool !== 'windowLevel' && tool !== 'pan' && tool !== 'zoom') {
        // Keep W/L reachable with Shift+drag even while a marking tool is active.
        g.setToolActive(TOOL.WindowLevel, { bindings: [{ mouseButton: MB.Primary, modifierKey: cst.Enums.KeyboardBindings.Shift }] });
      }
    }
    const vr = cst.ToolGroupManager.getToolGroup(VR_GROUP);
    if (vr) {
      vr.setToolActive(TOOL.TrackballRotate, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Primary }] });
      vr.setToolActive(TOOL.Zoom, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Secondary }, { mouseButton: cst.Enums.MouseBindings.Wheel }, { numTouchPoints: 2 }] });
      vr.setToolActive(TOOL.Pan, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Auxiliary }, { numTouchPoints: 3 }] });
    }
  }

  // ------------------------------------------------------------ viewport access
  viewport(panelId: string) {
    const p = this.panels.get(panelId);
    if (!p || !p.ready || !this.re) return null;
    return this.re.getViewport(p.viewportId) as unknown as CsViewport | undefined;
  }

  panel(panelId: string) {
    return this.panels.get(panelId) ?? null;
  }

  imageIdInfo(imageId: string) {
    return this.sopBySeriesImageId.get(imageId) ?? null;
  }

  retry(panelId: string) {
    const p = this.panels.get(panelId);
    if (!p) return;
    this.fetchers.get(p.source.seriesUid)?.retryFailed();
    void this.mount(panelId, p.element, p.source, p.kind, 0);
  }

  panelState(panelId: string): PanelState | null {
    const p = this.panels.get(panelId);
    if (!p) return null;
    const f = this.fetchers.get(p.source.seriesUid);
    const base: PanelState = {
      panelId,
      kind: p.kind,
      seriesUid: p.source.seriesUid,
      index: 0,
      count: p.source.imageIds.length,
      window: null,
      zoom: 1,
      edges: null,
      ready: p.ready,
      error: p.error,
      progress: f?.progress ?? null,
      currentImageId: null,
      slab: p.kind !== 'stack' && p.kind !== '3d' ? this.slab : null,
      obliqueDeg: 0,
    };
    const vp = this.viewport(panelId);
    if (!vp) return base;
    try {
      if (p.kind === 'stack') {
        base.index = vp.getCurrentImageIdIndex();
        base.currentImageId = vp.getCurrentImageId?.() ?? null;
      } else if (p.kind !== '3d') {
        const info = cs.utilities.getVolumeViewportScrollInfo(vp as never, `cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
        base.index = info.currentStepIndex;
        base.count = info.numScrollSteps + 1;
      }
      base.window = this.getWindow(panelId);
      base.zoom = vp.getZoom?.() ?? 1;
      const b0 = this.baseOrientation.get(panelId);
      if (b0 && p.kind !== 'stack' && p.kind !== '3d') {
        const c = Math.min(1, Math.abs(dot(b0.normal, vp.getCamera().viewPlaneNormal as Vec3)));
        base.obliqueDeg = Math.round((Math.acos(c) * 180) / Math.PI);
      }
      base.edges = this.edgeLabels(p, vp);
    } catch {
      /* viewport mid-update */
    }
    return base;
  }

  private edgeLabels(p: Panel, vp: CsViewport) {
    if (p.kind === '3d') return null;
    if (!p.source.hasPatientGeometry) {
      // Projection radiograph: only PatientOrientation of the displayed image is trustworthy; never guess.
      let po = p.source.patientOrientation;
      const imageId = p.kind === 'stack' ? vp.getCurrentImageId?.() : null;
      if (imageId) {
        try {
          const nat = cs.metaData.get('naturalized', imageId) as Record<string, unknown> | undefined;
          const v = nat?.PatientOrientation;
          if (v !== undefined) po = Array.isArray(v) ? (v as string[]) : String(v).split(String.fromCharCode(92));
        } catch {
          /* fall back to series value */
        }
      }
      const e = edgeLabelsFromPatientOrientation(po?.filter((x) => x && x.trim()) ?? null);
      if (!e) return null;
      const cam = vp.getCamera();
      return cam.flipHorizontal ? { ...e, left: e.right, right: e.left } : e;
    }
    const canvas = vp.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const c = vp.canvasToWorld([w / 2, h / 2]) as Vec3;
    const r = vp.canvasToWorld([w / 2 + 50, h / 2]) as Vec3;
    const d = vp.canvasToWorld([w / 2, h / 2 + 50]) as Vec3;
    const right = orientationLetters(sub(r, c));
    const down = orientationLetters(sub(d, c));
    const flip = (s: string) => s.replace(/./g, (ch) => ({ L: 'R', R: 'L', A: 'P', P: 'A', H: 'F', F: 'H' })[ch] ?? ch);
    return { right, left: flip(right), bottom: down, top: flip(down) };
  }

  // ------------------------------------------------------------ navigation & display
  setIndex(panelId: string, index: number) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp) return;
    if (p.kind === 'stack') {
      const i = Math.max(0, Math.min(index, p.source.imageIds.length - 1));
      this.fetchers.get(p.source.seriesUid)?.prioritize(i);
      vp.setImageIdIndex(i);
    } else if (p.kind !== '3d') {
      const info = cs.utilities.getVolumeViewportScrollInfo(vp as never, `cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
      cs.utilities.scroll(vp as never, { delta: index - info.currentStepIndex });
    }
  }

  scroll(panelId: string, delta: number) {
    const s = this.panelState(panelId);
    if (s) this.setIndex(panelId, s.index + delta);
  }

  setWindow(panelId: string, center: number, width: number, render = true) {
    const p = this.panels.get(panelId);
    const vp = this.re && p ? (this.re.getViewport(p.viewportId) as unknown as CsViewport | undefined) : undefined;
    if (!vp || !p || p.kind === '3d') return;
    const voiRange = cs.utilities.windowLevel.toLowHighRange(Math.max(1, width), center);
    if (p.kind === 'stack') vp.setProperties({ voiRange });
    else vp.setProperties({ voiRange }, `cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
    if (render) vp.render();
  }

  getWindow(panelId: string) {
    const vp = this.viewport(panelId);
    const p = this.panels.get(panelId);
    if (!vp || !p || p.kind === '3d') return null;
    const props = p.kind === 'stack' ? vp.getProperties() : vp.getProperties(`cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
    const r = props?.voiRange;
    if (!r) return null;
    const { windowWidth, windowCenter } = cs.utilities.windowLevel.toWindowLevel(r.lower, r.upper);
    return { center: windowCenter, width: windowWidth };
  }

  invert(panelId: string) {
    const vp = this.viewport(panelId);
    const p = this.panels.get(panelId);
    if (!vp || !p || p.kind === '3d') return;
    const props = p.kind === 'stack' ? vp.getProperties() : vp.getProperties(`cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
    if (p.kind === 'stack') vp.setProperties({ invert: !props.invert });
    else vp.setProperties({ invert: !props.invert }, `cornerstoneStreamingImageVolume:${p.source.seriesUid}`);
    vp.render();
  }

  reset(panelId: string) {
    const vp = this.viewport(panelId);
    const p = this.panels.get(panelId);
    if (!vp || !p) return;
    vp.resetCamera();
    if (p.kind !== '3d') {
      if (p.kind === 'stack') vp.resetProperties?.();
      if (p.source.defaultWindow) this.setWindow(panelId, p.source.defaultWindow.center, p.source.defaultWindow.width, false);
    }
    vp.render();
  }

  fit(panelId: string) {
    const vp = this.viewport(panelId);
    if (!vp) return;
    vp.resetCamera({ resetPan: true, resetZoom: true });
    vp.render();
  }

  set3DPreset(panelId: string, preset: string) {
    const vp = this.viewport(panelId);
    if (!vp) return;
    vp.setProperties({ preset });
    this.presets.set(panelId, preset);
    vp.render();
    this.bump();
  }
  get3DPreset(panelId: string) {
    return this.presets.get(panelId) ?? null;
  }

  /** Turn the 3D view to look at the patient from one side (head up; from above or below, front up). */
  set3DView(panelId: string, side: Side) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp || p.kind !== '3d') return;
    const n = SIDE_VECTOR[side];
    const up: Vec3 = side === 'S' || side === 'I' ? [0, -1, 0] : [0, 0, 1];
    const cam = vp.getCamera();
    const f = cam.focalPoint as Vec3;
    const d = Math.hypot(...sub(cam.position as Vec3, f)) || 1000;
    vp.setCamera({ focalPoint: f, position: add(f, [n[0] * d, n[1] * d, n[2] * d]), viewUp: up });
    vp.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
    this.applyCut(panelId);
    vp.render();
  }

  // ------------------------------------------------------------ 3D cut
  set3DCut(panelId: string, cut: Cut3D | null) {
    if (cut) this.cuts.set(panelId, cut);
    else this.cuts.delete(panelId);
    this.applyCut(panelId);
    this.viewport(panelId)?.render();
    this.bump();
  }
  get3DCut(panelId: string): Cut3D {
    return this.cuts.get(panelId) ?? NO_CUT;
  }
  /** Whether a 3D cut can follow this plane (an MPR view of the series is on screen). */
  hasPlane(seriesUid: string, kind: PlaneKind) {
    return !!this.planeViewport(seriesUid, kind);
  }
  private refreshFollowingCuts(seriesUid: string) {
    for (const [id, cut] of this.cuts) {
      const p = this.panels.get(id);
      if (!p || p.source.seriesUid !== seriesUid || !Object.keys(cut.follow).length) continue;
      this.applyCut(id);
      this.viewport(id)?.render();
    }
  }
  /** Re-apply the cut to every actor of a 3D panel (volume and anatomy models). */
  private applyCut(panelId: string) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || p.kind !== '3d' || !vp) return;
    const planes = this.cutPlanes(p, vp);
    for (const entry of (vp as unknown as { getActors(): Array<{ actor?: { getMapper?(): unknown } }> }).getActors()) {
      const mapper = entry.actor?.getMapper?.() as { removeAllClippingPlanes?(): void; addClippingPlane(p: unknown): void } | undefined;
      if (!mapper?.removeAllClippingPlanes) continue;
      mapper.removeAllClippingPlanes();
      for (const pl of planes) mapper.addClippingPlane(vtkPlane.newInstance({ origin: pl.origin, normal: pl.normal }));
    }
  }
  /** At most two planes per patient axis (the WebGL mapper takes six): the box edges, or one plane following a view. */
  private cutPlanes(p: Panel, vp: CsViewport): Array<{ origin: Vec3; normal: Vec3 }> {
    const cut = this.cuts.get(p.id);
    const b = (vp.getImageData()?.imageData as { getBounds?(): number[] } | undefined)?.getBounds?.();
    if (!cut || !b) return [];
    const centre: Vec3 = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
    const out: Array<{ origin: Vec3; normal: Vec3 }> = [];
    (['x', 'y', 'z'] as const).forEach((key, ax) => {
      const kind = (['sagittal', 'coronal', 'axial'] as const)[ax];
      const side = cut.follow[kind];
      const q = side ? this.planeViewport(p.source.seriesUid, kind) : null;
      if (side && q) {
        const cam = q.getCamera();
        const n = cam.viewPlaneNormal as Vec3;
        const s = dot(n, SIDE_VECTOR[side]) >= 0 ? 1 : -1;
        out.push({ origin: cam.focalPoint as Vec3, normal: [n[0] * s, n[1] * s, n[2] * s] });
        return;
      }
      const [lo, hi] = cut.box[key];
      const min = b[2 * ax];
      const max = b[2 * ax + 1];
      for (const [f, dir] of [[lo, 1], [hi, -1]] as const) {
        if ((dir === 1 && f <= 0.001) || (dir === -1 && f >= 0.999)) continue;
        const origin: Vec3 = [...centre];
        origin[ax] = min + f * (max - min);
        const normal: Vec3 = [0, 0, 0];
        normal[ax] = dir;
        out.push({ origin, normal });
      }
    });
    return out;
  }
  private planeViewport(seriesUid: string, kind: PlaneKind): CsViewport | null {
    for (const q of this.panels.values()) if (q.kind === kind && q.ready && q.source.seriesUid === seriesUid) return this.viewport(q.id) ?? null;
    return null;
  }

  // ------------------------------------------------------------ 3D anatomy models
  /** Coloured models of labelled structures in a 3D panel, built from the outlines when first shown. */
  anatomy3d(panelId: string): Anatomy3D | null {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || p.kind !== '3d' || !vp) return null;
    let a = this.anatomy.get(panelId);
    if (!a) {
      a = new Anatomy3D(vp as never, p.source, () => {
        this.applyCut(panelId);
        vp.render();
        this.bump();
      });
      this.anatomy.set(panelId, a);
    }
    return a;
  }
  anatomy3dState(panelId: string): Anatomy3DState | null {
    return this.anatomy.get(panelId)?.state() ?? null;
  }
  setAnatomy3dTargets(panelId: string, targets: LoadedTarget[]) {
    this.anatomy3d(panelId)?.setTargets(targets);
  }

  // ------------------------------------------------------------ slab (thick MPR)
  setSlab(mode: SlabMode) {
    this.slab = mode;
    for (const p of this.panels.values()) if (p.ready) this.applySlab(p);
    this.bump();
  }
  getSlab() {
    return this.slab;
  }
  private applySlab(p: Panel) {
    if (p.kind === 'stack' || p.kind === '3d' || !this.re) return;
    const vp = this.re.getViewport(p.viewportId) as unknown as {
      setBlendMode(m: number): void;
      setSlabThickness(mm: number): void;
      resetSlabThickness(): void;
      render(): void;
    };
    const BM = cs.Enums.BlendModes;
    const m = this.slab;
    try {
      vp.setBlendMode(!m ? BM.COMPOSITE : m.blend === 'mip' ? BM.MAXIMUM_INTENSITY_BLEND : m.blend === 'minip' ? BM.MINIMUM_INTENSITY_BLEND : BM.AVERAGE_INTENSITY_BLEND);
      if (m) vp.setSlabThickness(m.mm);
      else vp.resetSlabThickness();
      vp.render();
    } catch {
      /* viewport mid-update */
    }
  }

  // ------------------------------------------------------------ oblique planes
  /**
   * Tilt the other MPR planes of the patient by `deg` around the axis of this view (through the crosshair
   * centre) — the same as turning a crosshair line in this view. Used to follow an oblique structure.
   */
  tiltFrom(panelId: string, deg: number) {
    const src = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    const fr = src ? this.forOf(src) : null;
    if (!src || !vp || src.kind === 'stack' || src.kind === '3d' || !fr || !deg) return;
    const axis = normalize(vp.getCamera().viewPlaneNormal as Vec3);
    const xh = cst.ToolGroupManager.getToolGroup(MPR_GROUP)?.getToolInstance(TOOL.Crosshairs) as { toolCenter?: number[] } | undefined;
    const c = (xh?.toolCenter && xh.toolCenter.every(Number.isFinite) ? xh.toolCenter : vp.getCamera().focalPoint) as Vec3;
    const t = (deg * Math.PI) / 180;
    const rotV = (v: Vec3): Vec3 => {
      const k = cross(axis, v);
      const d = dot(axis, v) * (1 - Math.cos(t));
      return [0, 1, 2].map((i) => v[i] * Math.cos(t) + k[i] * Math.sin(t) + axis[i] * d) as Vec3;
    };
    const rotP = (p: Vec3) => add(c, rotV(sub(p, c)));
    for (const q of this.panels.values()) {
      if (q === src || !q.ready || q.kind === 'stack' || q.kind === '3d' || this.forOf(q) !== fr) continue;
      const qvp = this.viewport(q.id);
      if (!qvp) continue;
      const cam = qvp.getCamera();
      qvp.setCamera({ focalPoint: rotP(cam.focalPoint as Vec3), position: rotP(cam.position as Vec3), viewUp: rotV(cam.viewUp as Vec3) });
      qvp.render();
    }
    this.tilts.set(panelId, (((this.tilts.get(panelId) ?? 0) + deg + 540) % 360) - 180);
    this.refreshFollowingCuts(src.source.seriesUid);
    this.bump();
  }
  /** Total tilt applied from this view (degrees, −180…180). */
  tiltOf(panelId: string) {
    return this.tilts.get(panelId) ?? 0;
  }
  /** Turn every MPR plane back to straight axial / coronal / sagittal, still crossing at the same point. */
  straighten() {
    const xh = cst.ToolGroupManager.getToolGroup(MPR_GROUP)?.getToolInstance(TOOL.Crosshairs) as { toolCenter?: number[]; setToolCenter?(c: Vec3): void } | undefined;
    const centre = xh?.toolCenter && xh.toolCenter.every(Number.isFinite) ? ([...xh.toolCenter] as Vec3) : null;
    for (const q of this.panels.values()) {
      const b0 = this.baseOrientation.get(q.id);
      const qvp = this.viewport(q.id);
      if (!b0 || !qvp) continue;
      const cam = qvp.getCamera();
      const f = (centre ?? cam.focalPoint) as Vec3;
      const d = Math.hypot(...sub(cam.position as Vec3, cam.focalPoint as Vec3)) || 500;
      qvp.setCamera({ focalPoint: f, position: add(f, [b0.normal[0] * d, b0.normal[1] * d, b0.normal[2] * d]), viewUp: b0.up });
      qvp.render();
    }
    this.tilts.clear();
    if (centre) xh?.setToolCenter?.(centre);
    for (const p of this.panels.values()) this.refreshFollowingCuts(p.source.seriesUid);
    this.bump();
  }

  // ------------------------------------------------------------ cine
  /** Play the slices of a stack or MPR view as a loop (linked views follow it), or stop. */
  togglePlay(panelId: string, framesPerSecond = 12) {
    const p = this.panels.get(panelId);
    if (!p || !p.ready || p.kind === '3d') return;
    if (this.playing.has(panelId)) this.stopPlay(panelId);
    else {
      cst.utilities.cine.playClip(p.element, { framesPerSecond, loop: true });
      this.playing.add(panelId);
    }
    this.bump();
  }
  isPlaying(panelId: string) {
    return this.playing.has(panelId);
  }
  private stopPlay(panelId: string) {
    const p = this.panels.get(panelId);
    if (!this.playing.delete(panelId) || !p) return;
    try {
      cst.utilities.cine.stopClip(p.element);
    } catch {
      /* viewport already gone */
    }
  }

  // ------------------------------------------------------------ linked views
  setLinked(on: boolean) {
    this.linked = on;
    this.applyTool(this.activeTool);
    this.re?.render();
    this.bump();
  }
  get isLinked() {
    return this.linked;
  }
  private forOf(p: Panel) {
    return p.source.hasPatientGeometry ? (p.source.frameOfReferenceUid ?? null) : null;
  }
  /** Median distance between neighbouring slices of a series. */
  private spacing(src: SeriesSource): number {
    let s = this.spacingCache.get(src);
    if (s === undefined) {
      const n = src.normal;
      const d = n ? (src.positions ?? []).filter((x): x is Vec3 => !!x).map((x) => dot(x, n)).sort((a, b) => a - b) : [];
      const gaps = d.slice(1).map((v, i) => v - d[i]).filter((g) => g > 1e-3).sort((a, b) => a - b);
      s = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
      this.spacingCache.set(src, s);
    }
    return s;
  }
  /** Stack slice nearest to a patient-space point, or null when the point lies outside that series' coverage. */
  private nearestSlice(q: Panel, world: Vec3): number | null {
    const n = q.source.normal;
    const pos = q.source.positions;
    if (!n || !pos?.length) return null;
    const d = dot(world, n);
    let best = -1;
    let bestDist = Infinity;
    pos.forEach((x, i) => {
      if (!x) return;
      const dist = Math.abs(dot(x, n) - d);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best >= 0 && bestDist <= Math.max(this.spacing(q.source), 1) ? best : null;
  }
  private syncedAt = new Map<string, number>();
  /** A stack moved: move the parallel stacks of the same patient to the same position. */
  private followStack(panelId: string) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    // A view the link itself just moved does not drive the others (no echo).
    if (!p || !vp || !this.linked || performance.now() - (this.syncedAt.get(panelId) ?? -1e9) < 350) return;
    const idx = vp.getCurrentImageIdIndex();
    const pos = p.source.positions?.[idx];
    const n = p.source.normal;
    const fr = this.forOf(p);
    if (!pos || !n || !fr) return;
    for (const q of this.panels.values()) {
      if (q === p || !q.ready || q.kind !== 'stack' || this.forOf(q) !== fr || !q.source.normal) continue;
      if (Math.abs(dot(q.source.normal, n)) < 0.98) continue; // other orientations show a reference line instead
      const i = this.nearestSlice(q, pos);
      const qvp = this.viewport(q.id);
      if (i === null || !qvp || qvp.getCurrentImageIdIndex() === i) continue;
      this.syncedAt.set(q.id, performance.now());
      this.setIndex(q.id, i);
    }
  }
  /** Show one point in every view of the same patient: MPR planes cross there, stacks go to the nearest slice. */
  linkJump(panelId: string, canvas: Vec2): boolean {
    const src = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    const fr = src ? this.forOf(src) : null;
    if (!src || !vp || src.kind === '3d' || !fr) return false;
    const world = vp.canvasToWorld(canvas) as Vec3;
    let moved = false;
    const mpr = [...this.panels.values()].filter((q) => q.ready && q.kind !== 'stack' && q.kind !== '3d' && this.forOf(q) === fr);
    const xh = mpr.length >= 2 ? (cst.ToolGroupManager.getToolGroup(MPR_GROUP)?.getToolInstance(TOOL.Crosshairs) as { setToolCenter?(c: Vec3): void } | undefined) : undefined;
    if (xh?.setToolCenter) {
      xh.setToolCenter(world);
      moved = true;
    }
    for (const q of this.panels.values()) {
      if (q.id === panelId || !q.ready || q.kind === '3d' || this.forOf(q) !== fr) continue;
      if (q.kind === 'stack') {
        const i = this.nearestSlice(q, world);
        if (i !== null) {
          this.syncedAt.set(q.id, performance.now());
          this.setIndex(q.id, i);
          moved = true;
        }
      } else if (!xh?.setToolCenter) {
        this.jumpToWorld(q.id, world);
        moved = true;
      }
    }
    this.refreshFollowingCuts(src.source.seriesUid);
    return moved;
  }
  /** Where the other linked views cut this one (MPR views among themselves use the crosshair lines instead). */
  referenceLines(panelId: string): RefLine[] {
    const t = this.panels.get(panelId);
    const tvp = this.viewport(panelId);
    const fr = t ? this.forOf(t) : null;
    if (!this.linked || !t || !tvp || t.kind === '3d' || !fr) return [];
    const cam = tvp.getCamera();
    const tn = cam.viewPlaneNormal as Vec3;
    const tf = cam.focalPoint as Vec3;
    const out: RefLine[] = [];
    for (const s of this.panels.values()) {
      if (s === t || !s.ready || s.kind === '3d' || this.forOf(s) !== fr || (s.kind !== 'stack' && t.kind !== 'stack')) continue;
      const quad = this.displayedQuad(s);
      if (!quad) continue;
      const sn = normalize(cross(sub(quad[1], quad[0]), sub(quad[3], quad[0])));
      if (Math.abs(dot(sn, tn)) > 0.95) continue; // parallel views follow each other instead
      const hits: Vec3[] = [];
      for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        const da = dot(sub(a, tf), tn);
        const db = dot(sub(b, tf), tn);
        if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
          const k = da / (da - db);
          hits.push(add(a, [(b[0] - a[0]) * k, (b[1] - a[1]) * k, (b[2] - a[2]) * k]));
        }
      }
      if (hits.length < 2) continue;
      out.push({ a: tvp.worldToCanvas(hits[0]) as Vec2, b: tvp.worldToCanvas(hits[1]) as Vec2, color: s.kind === 'stack' ? STACK_LINE_COLOR : PLANE_COLORS[s.kind] });
    }
    return out;
  }
  /** Corners of the image shown in a panel, in patient space. */
  private displayedQuad(s: Panel): Vec3[] | null {
    const vp = this.viewport(s.id);
    if (!vp) return null;
    if (s.kind === 'stack') {
      const id = vp.getCurrentImageId?.();
      const ip = id ? (cs.metaData.get('imagePlaneModule', id) as ImagePlaneMeta | undefined) : undefined;
      if (!ip?.imagePositionPatient || !ip.rowCosines || !ip.columnCosines || !ip.rows || !ip.columns) return null;
      const r = ip.rowCosines as Vec3;
      const c = ip.columnCosines as Vec3;
      const dx = ip.columnPixelSpacing ?? 1;
      const dy = ip.rowPixelSpacing ?? 1;
      const o: Vec3 = [0, 1, 2].map((i) => ip.imagePositionPatient![i] - 0.5 * r[i] * dx - 0.5 * c[i] * dy) as Vec3;
      const w: Vec3 = [r[0] * dx * ip.columns, r[1] * dx * ip.columns, r[2] * dx * ip.columns];
      const h: Vec3 = [c[0] * dy * ip.rows, c[1] * dy * ip.rows, c[2] * dy * ip.rows];
      return [o, add(o, w), add(add(o, w), h), add(o, h)];
    }
    const w = vp.canvas.clientWidth;
    const h = vp.canvas.clientHeight;
    return ([[0, 0], [w, 0], [w, h], [0, h]] as Vec2[]).map((c) => vp.canvasToWorld(c) as Vec3);
  }

  // ------------------------------------------------------------ bookmarks
  snapshot(panelId: string): ViewSnapshot | null {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp) return null;
    const cam = vp.getCamera();
    const st = this.panelState(panelId)!;
    const imageId = st.currentImageId;
    return {
      seriesUid: p.source.seriesUid,
      kind: p.kind,
      index: st.index,
      sopInstanceUid: imageId ? (this.sopBySeriesImageId.get(imageId)?.sop ?? null) : null,
      camera: { focalPoint: cam.focalPoint as Vec3, position: cam.position as Vec3, viewUp: cam.viewUp as Vec3, parallelScale: cam.parallelScale ?? 1 },
      window: st.window,
    };
  }

  async restore(panelId: string, snap: ViewSnapshot) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp || p.source.seriesUid !== snap.seriesUid) return false;
    if (p.kind === 'stack') await vp.setImageIdIndex(snap.index);
    vp.setCamera({ ...snap.camera });
    if (snap.window) this.setWindow(panelId, snap.window.center, snap.window.width, false);
    vp.render();
    return true;
  }

  /** Point on the displayed plane (focal point) — used for level-navigation grading. */
  currentPlanePoint(panelId: string): { sop: string | null; world: Vec3 | null } {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp) return { sop: null, world: null };
    if (p.kind === 'stack') {
      const id = vp.getCurrentImageId();
      const sop = id ? (this.sopBySeriesImageId.get(id)?.sop ?? null) : null;
      return { sop, world: p.source.hasPatientGeometry ? (vp.getCamera().focalPoint as Vec3) : null };
    }
    return { sop: null, world: vp.getCamera().focalPoint as Vec3 };
  }

  /** Navigate the panel so that a patient-space point is displayed (and centred for volumes). */
  jumpToWorld(panelId: string, world: Vec3) {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp) return;
    if (p.kind === 'stack') {
      const idx = cs.utilities.getClosestStackImageIndexForPoint(world as never, vp as never);
      if (idx !== null && idx !== undefined) vp.setImageIdIndex(idx);
    } else if (p.kind !== '3d') {
      // Move the camera so the plane passes through `world` and centre on it.
      const cam = vp.getCamera();
      const off = sub(cam.position as Vec3, cam.focalPoint as Vec3);
      vp.setCamera({ focalPoint: world, position: [world[0] + off[0], world[1] + off[1], world[2] + off[2]] });
      vp.render();
    }
  }

  /** Pan so that a patient-space point sits in the centre of the panel (stays on the current plane). */
  centerOn(panelId: string, world: Vec3) {
    const vp = this.viewport(panelId);
    if (!vp) return;
    const cam = vp.getCamera();
    const f = cam.focalPoint as Vec3;
    const n = cam.viewPlaneNormal as Vec3;
    const d = sub(world, f);
    const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const shift: Vec3 = [d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]];
    const pos = cam.position as Vec3;
    vp.setCamera({ focalPoint: [f[0] + shift[0], f[1] + shift[1], f[2] + shift[2]], position: [pos[0] + shift[0], pos[1] + shift[1], pos[2] + shift[2]] });
    vp.render();
  }

  worldToCanvas(panelId: string, world: Vec3): Vec2 | null {
    const vp = this.viewport(panelId);
    return vp ? (vp.worldToCanvas(world) as Vec2) : null;
  }
  canvasToWorld(panelId: string, canvas: Vec2): Vec3 | null {
    const vp = this.viewport(panelId);
    return vp ? (vp.canvasToWorld(canvas) as Vec3) : null;
  }
  imagePxToWorld(imageId: string, px: Vec2): Vec3 | null {
    try {
      return cs.utilities.imageToWorldCoords(imageId, [px[0] + 0.5, px[1] + 0.5]) as Vec3;
    } catch {
      return null;
    }
  }
  /** Current camera plane (normal + focal point) for volume overlays. */
  plane(panelId: string): { normal: Vec3; point: Vec3 } | null {
    const vp = this.viewport(panelId);
    if (!vp) return null;
    const cam = vp.getCamera();
    return { normal: cam.viewPlaneNormal as Vec3, point: cam.focalPoint as Vec3 };
  }

  /** Pixel value under a canvas point, with the units that are actually meaningful. */
  probeValue(panelId: string, canvas: Vec2): { value: number; unit: string } | null {
    const p = this.panels.get(panelId);
    const vp = this.viewport(panelId);
    if (!p || !vp || p.kind === '3d') return null;
    try {
      const world = vp.canvasToWorld(canvas);
      const data = vp.getImageData();
      if (!data) return null;
      const ijk = cs.utilities.transformWorldToIndex(data.imageData as never, world as [number, number, number]);
      const dims = data.dimensions;
      if (ijk.some((v: number, i: number) => v < 0 || v >= dims[i])) return null;
      const value = data.voxelManager.getAtIJK(ijk[0], ijk[1], ijk[2]) as number;
      const unit = p.source.modality === 'CT' ? 'HU' : p.source.modality === 'MR' ? 'signal (arbitrary units)' : 'pixel value';
      return { value, unit };
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ learner marks
  /** All learner marks currently drawn, converted to the source-geometry contract. */
  collectMarks(): LearnerMark[] {
    const out: LearnerMark[] = [];
    const all = cst.annotation.state.getAllAnnotations();
    for (const a of all) {
      const toolName = a.metadata?.toolName;
      if (!toolName || !MARK_TOOLS.has(toolName)) continue;
      const pts = (a.data?.handles?.points ?? []) as Vec3[];
      if (!pts.length) continue;
      const refImageId = a.metadata?.referencedImageId as string | undefined;
      const meta = refImageId ? this.sopBySeriesImageId.get(refImageId) : undefined;
      let seriesUid = meta?.seriesUid;
      const viewportPanel = [...this.panels.values()].find((p) => p.source.imageIds.includes(refImageId ?? '')) ?? [...this.panels.values()].find((p) => p.kind !== 'stack' && p.kind !== '3d' && a.metadata?.FrameOfReferenceUID);
      if (!seriesUid && viewportPanel) seriesUid = viewportPanel.source.seriesUid;
      if (!seriesUid) continue;
      const tool = MARK_TOOL_KIND[toolName];
      let handles: Vec3[] = pts;
      if (tool === 'outline') handles = ((a.data as { contour?: { polyline?: Vec3[] } }).contour?.polyline ?? pts) as Vec3[];
      if (tool === 'box' && pts.length >= 4) handles = [pts[0], pts[3]];
      const imagePx = refImageId
        ? handles.map((w) => {
            const ic = cs.utilities.worldToImageCoords(refImageId, w as never) as Vec2;
            return csToContract(ic);
          })
        : null;
      const projection = meta?.projection ?? false;
      const viewKind = viewportPanel?.kind && viewportPanel.kind !== '3d' ? viewportPanel.kind : 'stack';
      out.push({
        id: a.annotationUID!,
        tool,
        label: (a.data as { text?: string; label?: string }).text || (a.data as { label?: string }).label || null,
        seriesUid,
        sopInstanceUid: meta?.sop ?? null,
        frame: 1,
        imagePx,
        worldLps: projection ? null : handles.map((h) => [h[0], h[1], h[2]] as Vec3),
        view: viewKind,
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  }

  setMarkLabel(annotationUID: string, label: string) {
    const a = cst.annotation.state.getAnnotation(annotationUID);
    if (!a) return;
    (a.data as { label?: string; text?: string }).label = label;
    if (a.metadata?.toolName === TOOL.Arrow) (a.data as { text?: string }).text = label;
    cst.annotation.state.triggerAnnotationModified?.(a, undefined as never);
    this.re?.render();
    this.bump();
  }

  removeMark(annotationUID: string) {
    cst.annotation.state.removeAnnotation(annotationUID);
    this.re?.render();
    this.bump();
  }

  clearMarks(includeMeasurements = false) {
    for (const a of cst.annotation.state.getAllAnnotations()) {
      const n = a.metadata?.toolName;
      if (n && (MARK_TOOLS.has(n) || (includeMeasurements && MEASURE_TOOLS.has(n)))) cst.annotation.state.removeAnnotation(a.annotationUID!);
    }
    this.re?.render();
    this.bump();
  }

  setMarksVisible(visible: boolean) {
    for (const a of cst.annotation.state.getAllAnnotations()) cst.annotation.visibility.setAnnotationVisibility(a.annotationUID!, visible);
    this.re?.render();
  }

  undo() {
    cs.utilities.HistoryMemo.DefaultHistoryMemo.undo();
    this.re?.render();
    this.bump();
  }
  redo() {
    cs.utilities.HistoryMemo.DefaultHistoryMemo.redo();
    this.re?.render();
    this.bump();
  }
  get canUndo() {
    return cs.utilities.HistoryMemo.DefaultHistoryMemo.canUndo;
  }
  get canRedo() {
    return cs.utilities.HistoryMemo.DefaultHistoryMemo.canRedo;
  }

  render() {
    this.re?.render();
  }
}

/** A viewport enabled while its element is 0×0 gets a degenerate camera; wait for real layout. */
async function waitForLayout(el: HTMLElement, timeoutMs = 3000) {
  const t0 = performance.now();
  while ((el.clientWidth < 8 || el.clientHeight < 8) && performance.now() - t0 < timeoutMs) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

/** Minimal structural type for the viewport methods we use (stack + volume). */
interface CsViewport {
  canvas: HTMLCanvasElement;
  render(): void;
  resetCamera(opts?: Record<string, unknown>): void;
  resetProperties?(): void;
  getCamera(): { focalPoint: number[]; position: number[]; viewUp: number[]; viewPlaneNormal: number[]; parallelScale?: number; flipHorizontal?: boolean };
  setCamera(c: Record<string, unknown>): void;
  getProperties(volumeId?: string): { voiRange?: { lower: number; upper: number }; invert?: boolean };
  setProperties(p: Record<string, unknown>, volumeId?: string): void;
  getCurrentImageIdIndex(): number;
  getCurrentImageId(): string;
  setImageIdIndex(i: number): Promise<string>;
  getZoom?(): number;
  canvasToWorld(p: number[]): number[];
  worldToCanvas(p: number[]): number[];
  getImageData(): { imageData: unknown; dimensions: number[]; voxelManager: { getAtIJK(i: number, j: number, k: number): unknown } } | undefined;
}

/** The parts of Cornerstone's imagePlaneModule used to place a stack image in patient space. */
interface ImagePlaneMeta {
  imagePositionPatient?: number[];
  rowCosines?: number[];
  columnCosines?: number[];
  rows?: number;
  columns?: number;
  rowPixelSpacing?: number;
  columnPixelSpacing?: number;
}
