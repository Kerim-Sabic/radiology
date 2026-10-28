import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { PLANE_COLORS, type ViewerEngine, type SeriesSource, type ViewKind } from '../../viewer/engine';
import { Volume3DControls, type ThreeDProps } from './Volume3DControls';
import type { Series } from '../../schema/content';
import type { LoadedTarget } from '../../grading/spatialGrader';
import type { SeriesIndex } from '../../grading/seriesIndex';
import { shapesForPanel, shapeArea, shapeContains, CATEGORY_COLORS, type Shape } from './overlayShapes';
import { polygonArea } from '../../lib/geometry';
import { layoutLabels, leaderEnd } from './labelLayout';
import type { Vec2, Vec3 } from '../../lib/geometry';
import { formatBytes } from '../ui';
import { cleanLabel as cleanName, isAutomatic, provenanceTag } from '../../lib/provenance';

/** SVG path of several closed rings (an outline and its holes), drawn with the even-odd rule. */
const ringsPath = (rings: Vec2[][]) => rings.map((r) => `M${r.map((q) => q.join(',')).join('L')}Z`).join(' ');

export interface MarkBadge {
  id: string;
  world: Vec3 | null;
  imageId: string | null;
  px: Vec2 | null;
  glyph: string; // ✓ ✗ ? ⧉
  text: string;
  tone: 'ok' | 'bad' | 'warn' | 'neutral';
}

export interface AnatomyLayerProps {
  on: boolean;
  targets: LoadedTarget[];
  showNames: boolean;
  hidden: Set<string>; // categories hidden by the learner
  highlightId: string | null;
  /** When set, ONLY this structure is drawn (filled, named) — chosen from the structure list. */
  isolateId: string | null;
  /** When set, only these structures are drawn and named (a search-pattern step, e.g. "Great vessels"). */
  isolateSet?: Set<string> | null;
  isolateLabel?: string;
  /** Drill mode: draw outlines but never show their names (no labels, hover or banner). */
  quiz?: boolean;
  onIsolateStep?: (dir: 1 | -1) => void;
  onIsolateGoTo?: () => void;
  onIsolateClear?: () => void;
}

export interface PanelOverlayProps {
  anatomy?: AnatomyLayerProps;
  targets: LoadedTarget[];
  showReference: boolean;
  opacity: number;
  highlightIds: Set<string>;
  showLabels: boolean;
  /** When set, only these reference targets get a written name (others are named by the anatomy layer). */
  labelIds?: Set<string> | null;
  badges: MarkBadge[];
}

interface Props {
  engine: ViewerEngine;
  panelId: string;
  source: SeriesSource;
  series: Series;
  seriesIndex: SeriesIndex | undefined;
  kind: ViewKind;
  startIndex: number;
  focused: boolean;
  /** Enlarged in the grid (the others sit in a strip beside it). */
  big?: boolean;
  onFocus: () => void;
  overlay: PanelOverlayProps;
  seriesOptions: Array<{ uid: string; label: string }>;
  onPickSeries?: (uid: string) => void;
  relationNote?: string | null;
  assessMasked?: boolean;
  /** A plain click (not a drag) on the image, in canvas pixels. */
  onImageClick?: (canvas: Vec2) => void;
  /** Double-click on the image (the workstation shows that point in every linked view). */
  onImageDoubleClick?: (canvas: Vec2) => void;
  /** 3D panel: rendering controls, cut and structure models. */
  threeD?: ThreeDProps;
}

const TONE: Record<MarkBadge['tone'], string> = { ok: '#4fd18b', bad: '#ff6b6b', warn: '#f2c14e', neutral: '#aab3bf' };

export function ViewportPanel(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { engine, panelId } = p;
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  const [probe, setProbe] = useState<{ value: number; unit: string } | null>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const downAt = useRef<[number, number, number] | null>(null);
  /** Set by the 3D quiz while it waits for a click on a model. */
  const clickRef = useRef<((c: Vec2) => void) | null>(null);
  const pickRaf = useRef(0);

  useEffect(() => {
    if (!el.current) return;
    void engine.mount(panelId, el.current, p.source, p.kind, p.startIndex);
    return () => engine.unmount(panelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, panelId, p.source.seriesUid, p.kind]);

  useEffect(() => {
    if (!wrap.current) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        engine.resize();
        if (wrap.current) setSize([wrap.current.clientWidth, wrap.current.clientHeight]);
      });
    });
    ro.observe(wrap.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [engine]);

  const st = engine.panelState(panelId);
  const shapes = useMemo(
    () => (p.overlay.showReference && st?.ready ? shapesForPanel(engine, panelId, p.overlay.targets, p.seriesIndex) : []),
    // engine version drives recomputation via st identity fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, panelId, p.overlay.showReference, p.overlay.targets, p.seriesIndex, st?.index, st?.currentImageId, st?.zoom, st?.ready, engine.getVersion(), size[0], size[1]],
  );

  const anatomyShapes = useMemo(() => {
    const a = p.overlay.anatomy;
    if (!a?.on || !st?.ready || !a.targets.length) return [] as Shape[];
    return shapesForPanel(engine, panelId, a.targets, p.seriesIndex).filter((sh) => !a.hidden.has(sh.category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, panelId, p.overlay.anatomy, p.seriesIndex, st?.index, st?.currentImageId, st?.zoom, st?.ready, engine.getVersion(), size[0], size[1]]);
  const [hover, setHover] = useState<{ id: string; label: string; x: number; y: number; tag: string } | null>(null);
  const isolateId = p.overlay.anatomy?.isolateId ?? null;
  const isolateSet = p.overlay.anatomy?.isolateSet ?? null;
  const quiz = !!p.overlay.anatomy?.quiz;
  const isolating = !!isolateId || !!isolateSet;
  const drawnAnatomy = useMemo(
    () => (isolateSet ? anatomyShapes.filter((sh) => isolateSet.has(sh.targetId)) : isolateId ? anatomyShapes.filter((sh) => sh.targetId === isolateId) : anatomyShapes),
    [anatomyShapes, isolateId, isolateSet],
  );
  const labels = useMemo(() => {
    const a = p.overlay.anatomy;
    if (!a?.on || !drawnAnatomy.length || a.quiz) return { placed: [], hidden: 0 };
    if (!isolating && !a.showNames) return { placed: [], hidden: 0 };
    const byTarget = new Map<string, { text: string; color: string; polys: Array<Array<[number, number]>> }>();
    for (const sh of drawnAnatomy) {
      if (sh.kind !== 'poly' || sh.pts.length < 3) continue;
      const e = byTarget.get(sh.targetId) ?? { text: cleanName(sh.label), color: CATEGORY_COLORS[sh.category] ?? CATEGORY_COLORS.other, polys: [] };
      e.polys.push(sh.pts);
      byTarget.set(sh.targetId, e);
    }
    const items = [...byTarget.entries()]
      .filter(([, v]) => isolating || v.polys.some((pl) => polygonArea(pl) > 40))
      .map(([id, v]) => ({ id, ...v, priority: id === hover?.id ? 2 : 0 }));
    return layoutLabels(items, size[0], size[1], { preferOutside: isolating });
  }, [drawnAnatomy, p.overlay.anatomy, isolating, size, hover?.id]);

  const badgePts = useMemo(() => {
    if (!st?.ready) return [];
    return p.overlay.badges
      .map((b) => {
        let c: Vec2 | null = null;
        if (b.world) c = engine.worldToCanvas(panelId, b.world);
        else if (b.imageId && b.px && st.currentImageId === b.imageId) {
          const w = engine.imagePxToWorld(b.imageId, b.px);
          c = w ? engine.worldToCanvas(panelId, w) : null;
        }
        if (b.imageId && st.kind === 'stack' && st.currentImageId !== b.imageId && !b.world) return null;
        if (b.world && st.kind === 'stack' && b.imageId && st.currentImageId !== b.imageId) return null;
        return c ? { ...b, c } : null;
      })
      .filter((x): x is MarkBadge & { c: Vec2 } => !!x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.overlay.badges, st?.ready, st?.currentImageId, st?.index, engine.getVersion(), size[0], size[1]]);

  const onMove = (e: React.MouseEvent) => {
    if (!el.current) return;
    const r = el.current.getBoundingClientRect();
    const c: [number, number] = [e.clientX - r.left, e.clientY - r.top];
    setProbe(engine.probeValue(panelId, c));
    if (p.kind === '3d') {
      const a3 = engine.anatomy3dState(panelId);
      if (!a3 || a3.quiz || !a3.structures.some((x) => x.shown)) {
        if (hover) setHover(null);
        return;
      }
      cancelAnimationFrame(pickRaf.current);
      pickRaf.current = requestAnimationFrame(() => {
        const id = engine.anatomy3d(panelId)?.pick(c) ?? null;
        const hit = id ? a3.structures.find((x) => x.id === id) : null;
        setHover(hit ? { id: hit.id, label: hit.label, x: c[0], y: c[1], tag: hit.tag } : null);
      });
    } else if (anatomyShapes.length && !quiz) {
      // Name the most specific (smallest) structure under the cursor.
      let best: Shape | null = null;
      let bestArea = Infinity;
      for (const sh of drawnAnatomy) {
        if (sh.kind !== 'poly' || sh.pts.length < 3 || !shapeContains(sh, c)) continue;
        const a = shapeArea(sh);
        if (a < bestArea) {
          bestArea = a;
          best = sh;
        }
      }
      setHover(best ? { id: best.targetId, label: best.label, x: c[0], y: c[1], tag: provenanceTag(best.provenance) } : null);
    } else if (hover) setHover(null);
  };

  const refLines = st?.ready && p.kind !== '3d' ? engine.referenceLines(panelId) : [];
  const planeColor = p.kind !== 'stack' && p.kind !== '3d' ? PLANE_COLORS[p.kind] : null;
  const s = p.series;
  const acq = s.acquisition;
  const derived = p.kind !== 'stack' && p.kind !== '3d' && !isAcquisitionPlane(s, p.kind);
  const progress = st?.progress;
  const loading = !st?.ready && !st?.error;
  const pct = progress ? Math.round(((progress.done + progress.failed) / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div ref={wrap} className={`vpanel${p.focused ? ' focused' : ''}${p.big ? ' big' : ''}`} onMouseDown={p.onFocus} onFocus={p.onFocus} data-panel={panelId}>
      <div
        ref={el}
        className="vp-el"
        onMouseMove={onMove}
        onMouseDown={(e) => {
          downAt.current = e.button === 0 ? [e.clientX, e.clientY, Date.now()] : null;
        }}
        onMouseUp={(e) => {
          const d = downAt.current;
          downAt.current = null;
          const click = p.kind === '3d' ? clickRef.current : p.onImageClick;
          if (!d || !click || !el.current || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5 || Date.now() - d[2] > 600) return;
          const r = el.current.getBoundingClientRect();
          click([e.clientX - r.left, e.clientY - r.top]);
        }}
        onDoubleClick={(e) => {
          if (!p.onImageDoubleClick || !el.current || p.kind === '3d') return;
          const r = el.current.getBoundingClientRect();
          p.onImageDoubleClick([e.clientX - r.left, e.clientY - r.top]);
        }}
        onMouseLeave={() => {
          setProbe(null);
          setHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={0}
        role="img"
        aria-label={`${s.modality} viewport, ${p.kind === 'stack' ? 'stack view' : `${p.kind} view`}, image ${(st?.index ?? 0) + 1} of ${st?.count ?? 0}`}
      />
      {drawnAnatomy.length ? (
        <svg className="vp-svg" aria-hidden>
          {drawnAnatomy.map((sh, i) => {
            const ai = isAutomatic(sh.provenance);
            const color = CATEGORY_COLORS[sh.category] ?? CATEGORY_COLORS.other;
            const strong = isolating || p.overlay.anatomy!.highlightId === sh.targetId || hover?.id === sh.targetId;
            const style = {
              stroke: color,
              strokeWidth: isolating ? 2.2 : strong ? 2 : 1,
              fill: isolating ? `${color}38` : strong ? `${color}26` : 'none',
              opacity: strong ? 1 : 0.7,
              strokeDasharray: ai ? (isolating ? '6 3' : '4 2') : undefined,
              strokeLinejoin: 'round' as const,
            };
            if (sh.kind === 'seg') return <line key={i} x1={sh.pts[0][0]} y1={sh.pts[0][1]} x2={sh.pts[1][0]} y2={sh.pts[1][1]} style={style} />;
            if (sh.kind === 'circle') return <circle key={i} cx={sh.pts[0][0]} cy={sh.pts[0][1]} r={5} style={style} />;
            if (sh.holes?.length) return <path key={i} d={ringsPath([sh.pts, ...sh.holes])} fillRule="evenodd" style={style} />;
            return <polygon key={i} points={sh.pts.map((q) => q.join(',')).join(' ')} style={style} />;
          })}
          {labels.placed.map((l) => {
            const end = leaderEnd(l.anchor, l.box);
            return (
              <g key={`lbl-${l.id}`}>
                {l.leader ? (
                  <>
                    <line x1={l.anchor[0]} y1={l.anchor[1]} x2={end[0]} y2={end[1]} stroke={l.color} strokeWidth={1.2} opacity={0.9} />
                    <circle cx={l.anchor[0]} cy={l.anchor[1]} r={2.4} fill={l.color} />
                  </>
                ) : null}
                <rect x={l.box[0]} y={l.box[1]} width={l.box[2]} height={l.box[3]} rx={4} fill="rgba(10,12,15,0.88)" stroke={l.color} strokeWidth={1} />
                <rect x={l.box[0]} y={l.box[1]} width={3} height={l.box[3]} rx={1.5} fill={l.color} />
                <text x={l.box[0] + l.box[2] / 2 + 1} y={l.box[1] + l.box[3] / 2 + 4} fill="#f1f5f9" fontSize={11.5} fontWeight={500} textAnchor="middle">
                  {l.text}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
      {isolating && !quiz && p.overlay.anatomy?.on ? (
        <div className="vp-isolate" role="status">
          {isolateId ? (
            <button className="btn sm ghost" onClick={() => p.overlay.anatomy?.onIsolateStep?.(-1)} aria-label="Previous structure">
              ‹
            </button>
          ) : null}
          <span>
            <b>{cleanName(p.overlay.anatomy.isolateLabel ?? '')}</b>
            {!drawnAnatomy.length ? <span className="faint"> · not on this slice</span> : null}
          </span>
          {!drawnAnatomy.length && p.overlay.anatomy.onIsolateGoTo ? (
            <button className="btn sm" onClick={() => p.overlay.anatomy?.onIsolateGoTo?.()}>
              Go to it
            </button>
          ) : null}
          {isolateId ? (
            <button className="btn sm ghost" onClick={() => p.overlay.anatomy?.onIsolateStep?.(1)} aria-label="Next structure">
              ›
            </button>
          ) : null}
          <button className="btn sm" onClick={() => p.overlay.anatomy?.onIsolateClear?.()}>
            Show all
          </button>
        </div>
      ) : null}
      {!isolating && p.overlay.anatomy?.on && p.overlay.anatomy.showNames && labels.hidden > 0 ? (
        <div className="vp-hidden-labels">{labels.hidden} more names on hover — zoom in to fit them</div>
      ) : null}
      {hover && !isolating && !quiz ? (
        <div className="vp-hover" style={{ left: Math.min(hover.x + 14, size[0] - 180), top: hover.y + 12 }}>
          {cleanName(hover.label)}
          <span className="faint"> · {hover.tag}</span>
        </div>
      ) : null}
      {refLines.length ? (
        <svg className="vp-svg" aria-hidden>
          {refLines.map((l, i) => (
            <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke={l.color} strokeWidth={1.25} opacity={0.85} />
          ))}
        </svg>
      ) : null}
      {shapes.length || badgePts.length ? (
        <svg className="vp-svg" aria-hidden>
          {shapes.map((sh, i) => {
            const hl = p.overlay.highlightIds.has(sh.targetId);
            const color = sh.provenance === 'ai_draft' ? '#f2a65a' : '#ffd166';
            const style = { stroke: color, strokeWidth: hl ? 2.2 : 1.4, fill: hl ? 'rgba(255,209,102,0.12)' : 'none', opacity: p.overlay.opacity, strokeDasharray: sh.provenance === 'ai_draft' ? '5 3' : undefined };
            if (sh.kind === 'circle') return <circle key={i} cx={sh.pts[0][0]} cy={sh.pts[0][1]} r={6} style={style} />;
            if (sh.kind === 'seg') return <line key={i} x1={sh.pts[0][0]} y1={sh.pts[0][1]} x2={sh.pts[1][0]} y2={sh.pts[1][1]} style={style} />;
            if (sh.holes?.length) return <path key={i} d={ringsPath([sh.pts, ...sh.holes])} fillRule="evenodd" style={style} />;
            return <polygon key={i} points={sh.pts.map((q) => q.join(',')).join(' ')} style={style} />;
          })}
          {p.overlay.showLabels &&
            [...new Map(shapes.filter((x) => x.kind === 'poly' && (!p.overlay.labelIds || p.overlay.labelIds.has(x.targetId))).map((x) => [x.targetId, x])).values()].map((sh) => {
              // Centred on the outline, but kept inside the panel (a finding at the image edge keeps a readable name).
              const half = (cleanName(sh.label).length * 6.1) / 2 + 4;
              const cx = Math.min(Math.max(sh.pts.reduce((a, q) => a + q[0], 0) / sh.pts.length, half), Math.max(half, size[0] - half));
              const cy = Math.min(Math.max(sh.pts.reduce((a, q) => a + q[1], 0) / sh.pts.length, 14), Math.max(14, size[1] - 8));
              return (
                <text key={`l-${sh.targetId}`} x={cx} y={cy} fill="#ffd166" fontSize={11} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 3, opacity: p.overlay.opacity }}>
                  {cleanName(sh.label)}
                </text>
              );
            })}
          {badgePts.map((b) => (
            <g key={b.id} transform={`translate(${b.c[0] + 10},${b.c[1] - 12})`}>
              <rect x={-2} y={-11} width={Math.max(18, 8 + b.text.length * 6.2)} height={16} rx={3} fill="rgba(0,0,0,0.75)" stroke={TONE[b.tone]} />
              <text x={3} y={1} fill={TONE[b.tone]} fontSize={11} fontWeight={600}>
                {b.glyph} {b.text}
              </text>
            </g>
          ))}
        </svg>
      ) : null}
      <div className="vp-overlay">
        <div className="vp-corner tl">
          <div>
            <b>{s.modality}</b> {p.kind === 'stack' ? '' : `· ${p.kind.toUpperCase()}`}
            {planeColor ? <span className="plane-dot" style={{ background: planeColor }} title="Colour of this plane's line in the other views" /> : null}
            {st?.obliqueDeg ? <span className="vp-tag info" style={{ marginLeft: 6 }}>oblique {st.obliqueDeg}°</span> : null}
          </div>
          <div>{s.description || 'Series'}</div>
          {acq.SequenceName || acq.ScanningSequence ? <div className="faint">{[acq.ScanningSequence, acq.SequenceVariant, acq.SequenceName].filter(Boolean).join(' / ')}</div> : null}
          {s.role === 'scout' ? <span className="vp-tag warn">CT scout / localizer — not a diagnostic radiograph</span> : null}
          {s.role === 'vendor_reformat' ? <span className="vp-tag info">Vendor reformat/MIP series</span> : null}
          {derived ? <span className="vp-tag info">Reformatted from {s.description ? 'the acquired series' : 'source slices'} (MPR)</span> : null}
        </div>
        <div className="vp-corner tr" hidden={p.kind === '3d' && !!p.threeD}>
          {st?.kind !== '3d' ? (
            <div>
              {p.kind === 'stack' ? 'Im' : 'Slice'} {(st?.index ?? 0) + 1}/{st?.count ?? s.instances.length}
            </div>
          ) : null}
          {st?.window ? (
            <div>
              W {Math.round(st.window.width)} · L {Math.round(st.window.center)}
            </div>
          ) : null}
          {st?.slab ? (
            <div className="vp-tag info">
              {st.slab.blend === 'mip' ? 'MIP' : st.slab.blend === 'minip' ? 'MinIP' : 'Average'} {st.slab.mm} mm slab
            </div>
          ) : null}
          {s.geometry.sliceSpacing && p.kind !== '3d' ? <div className="faint">{s.geometry.sliceSpacing.toFixed(1)} mm spacing</div> : null}
          {acq.EchoTime || acq.RepetitionTime ? (
            <div className="faint">
              {acq.RepetitionTime ? `TR ${acq.RepetitionTime}` : ''} {acq.EchoTime ? `TE ${acq.EchoTime}` : ''}
            </div>
          ) : null}
          {acq.ContrastBolusAgent ? <div className="faint">Contrast: {String(acq.ContrastBolusAgent)}</div> : null}
          {acq.ViewPosition ? <div className="faint">View {String(acq.ViewPosition)}</div> : null}
        </div>
        <div className="vp-corner bl">
          {probe ? (
            <div>
              {Number.isInteger(probe.value) ? probe.value : probe.value.toFixed(1)} <span className="faint">{probe.unit}</span>
            </div>
          ) : null}
          {!s.geometry.spacingCalibrated && p.kind === 'stack' ? <div className="faint">Distances not calibrated for patient size</div> : null}
          {st && st.zoom ? <div className="faint">Zoom {st.zoom.toFixed(2)}×</div> : null}
        </div>
        {st?.edges ? (
          <>
            <span className="vp-edge l">{st.edges.left}</span>
            <span className="vp-edge r">{st.edges.right}</span>
            <span className="vp-edge t">{st.edges.top}</span>
            <span className="vp-edge b">{st.edges.bottom}</span>
          </>
        ) : st?.ready && p.kind !== '3d' ? (
          <span className="vp-edge t vp-tag warn">Orientation not recorded in file</span>
        ) : null}
        {p.relationNote ? (
          <div className="rel-banner">
            <span className="vp-tag info">{p.relationNote}</span>
          </div>
        ) : null}
      </div>
      {st?.ready && p.kind !== '3d' && (st.count ?? 0) > 1 ? (
        <div className="vp-slider">
          <input
            type="range"
            min={0}
            max={(st.count ?? 1) - 1}
            value={st.index}
            onChange={(e) => engine.setIndex(panelId, Number(e.target.value))}
            aria-label="Slice"
          />
        </div>
      ) : null}
      {p.kind === '3d' && st?.ready && p.threeD ? (
        <Volume3DControls engine={engine} panelId={panelId} seriesUid={s.uid} modality={s.modality} threeD={p.threeD} clickRef={clickRef} />
      ) : null}
      {p.seriesOptions.length > 1 && p.onPickSeries ? (
        <div className="vp-picker">
          <select value={s.uid} onChange={(e) => p.onPickSeries!(e.target.value)} aria-label="Series in this panel">
            {p.seriesOptions.map((o) => (
              <option key={o.uid} value={o.uid}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {loading ? (
        <div className="vp-status" role="status" aria-live="polite">
          <div>{p.kind === 'stack' ? 'Loading first image…' : 'Loading the full series for reformatting…'}</div>
          <div className="progress-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <small>
            {progress ? `${progress.done}/${progress.total} images · ${formatBytes(progress.bytes)}` : 'Preparing viewer'}
          </small>
        </div>
      ) : null}
      {st?.error ? (
        <div className="vp-status" role="alert">
          <div style={{ maxWidth: 420 }}>{st.error}</div>
          <button className="btn" onClick={() => engine.retry(panelId)}>
            <RotateCcw size={14} /> Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

function isAcquisitionPlane(s: Series, kind: ViewKind): boolean {
  const iop = s.geometry.iop;
  if (!iop) return false;
  const n = [iop[1] * iop[5] - iop[2] * iop[4], iop[2] * iop[3] - iop[0] * iop[5], iop[0] * iop[4] - iop[1] * iop[3]].map(Math.abs);
  const axis = n.indexOf(Math.max(...n)); // 0 sagittal(x), 1 coronal(y), 2 axial(z)
  return (kind === 'axial' && axis === 2) || (kind === 'coronal' && axis === 1) || (kind === 'sagittal' && axis === 0);
}

