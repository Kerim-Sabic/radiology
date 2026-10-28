/**
 * ViewerAdapter: owns the Cornerstone rendering engine, viewports, tool groups, data
 * fetching and resource disposal. React components talk to it through this API and
 * subscribe to its change counter; image arrays and WebGL objects never enter React state.
 */
import { cs, cst, initCornerstone, TOOL, MARK_TOOLS, MEASURE_TOOLS, arrowLabelHook } from './csInit';
import { SeriesFetcher, type FetchProgress } from './seriesFetcher';
import { csToContract, orientationLetters, edgeLabelsFromPatientOrientation, sub, type Vec2, type Vec3 } from '../lib/geometry';
import type { LearnerMark } from '../grading/types';

export type ViewKind = 'stack' | 'axial' | 'coronal' | 'sagittal' | '3d';
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
          g.addTool(n, { getReferenceLineColor: () => 'rgb(94, 196, 255)', mobile: { enabled: false } });
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
          vp.setProperties({ preset: source.modality === 'CT' ? 'CT-Bone' : 'MR-Default' });
          vp.render();
        } else {
          const orientation = { axial: cs.Enums.OrientationAxis.AXIAL, coronal: cs.Enums.OrientationAxis.CORONAL, sagittal: cs.Enums.OrientationAxis.SAGITTAL }[kind];
          re.enableElement({ viewportId, element, type: cs.Enums.ViewportType.ORTHOGRAPHIC, defaultOptions: { orientation, background: [0, 0, 0] } });
          cst.ToolGroupManager.getToolGroup(MPR_GROUP)!.addViewport(viewportId, ENGINE_ID);
          await cs.setVolumesForViewports(re, [{ volumeId }], [viewportId]);
          if (stale()) return;
          const vp = re.getViewport(viewportId) as unknown as CsViewport;
          vp.resetCamera();
          if (source.defaultWindow) this.setWindow(panelId, source.defaultWindow.center, source.defaultWindow.width, false);
          vp.render();
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
    p.cleanup.forEach((c) => c());
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
      for (const n of [TOOL.WindowLevel, TOOL.Pan, TOOL.Zoom, TOOL.Probe, TOOL.Arrow, TOOL.Rectangle, TOOL.Freehand, TOOL.Length, TOOL.Angle, TOOL.Ellipse, TOOL.Eraser, ...(id === MPR_GROUP ? [TOOL.Crosshairs] : [])]) {
        if (MARK_TOOLS.has(n) || MEASURE_TOOLS.has(n)) g.setToolPassive(n);
        else g.setToolDisabled(n);
      }
      const primary = TOOL_MAP[tool];
      const usable = id === MPR_GROUP || tool !== 'crosshairs';
      if (usable && primary !== TOOL.StackScroll && primary !== TOOL.TrackballRotate) g.setToolActive(primary, { bindings: [{ mouseButton: MB.Primary }] });
      if (tool === 'scroll') g.setToolActive(TOOL.StackScroll, { bindings: [{ mouseButton: MB.Primary }, { mouseButton: MB.Wheel }] });
      else g.setToolActive(TOOL.StackScroll, { bindings: [{ mouseButton: MB.Wheel }] });
      if (tool !== 'zoom') g.setToolActive(TOOL.Zoom, { bindings: [{ mouseButton: MB.Secondary }] });
      if (tool !== 'pan') g.setToolActive(TOOL.Pan, { bindings: [{ mouseButton: MB.Auxiliary }] });
      if (tool !== 'windowLevel' && tool !== 'pan' && tool !== 'zoom') {
        // Keep W/L reachable with Shift+drag even while a marking tool is active.
        g.setToolActive(TOOL.WindowLevel, { bindings: [{ mouseButton: MB.Primary, modifierKey: cst.Enums.KeyboardBindings.Shift }] });
      }
    }
    const vr = cst.ToolGroupManager.getToolGroup(VR_GROUP);
    if (vr) {
      vr.setToolActive(TOOL.TrackballRotate, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Primary }] });
      vr.setToolActive(TOOL.Zoom, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Secondary }, { mouseButton: cst.Enums.MouseBindings.Wheel }] });
      vr.setToolActive(TOOL.Pan, { bindings: [{ mouseButton: cst.Enums.MouseBindings.Auxiliary }] });
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
    vp.render();
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
