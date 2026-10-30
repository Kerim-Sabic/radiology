import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Check, RotateCcw, Target, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { ViewerEngine } from '../viewer/engine';
import { ViewportPanel, type MarkBadge } from '../components/ws/ViewportPanel';
import { shapeArea, shapeContains, shapeRings, shapesForPanel } from '../components/ws/overlayShapes';
import type { LoadedTarget } from '../grading/spatialGrader';
import { patientToPlaneMm, polygonArea, type Vec2, type Vec3 } from '../lib/geometry';
import { AI_LABEL, cleanLabel, isAutomatic } from '../lib/provenance';
import { noteFor, type WindowName } from '../content/structureNotes';
import {
  KIND_LABEL,
  REGIONS,
  WINDOW_CHOICES,
  WINDOW_WHY,
  bestWindow,
  conditionForFinding,
  buildPool,
  distanceToShapes,
  distractors,
  eligible,
  inSentence,
  insideShapes,
  isDue,
  kindsFor,
  pickNext,
  presetFor,
  recordAnswer,
  summary,
  type DrillCandidate,
  type DrillKind,
  type DrillStats,
} from '../services/drill';

interface Question {
  n: number;
  cand: DrillCandidate;
  kind: DrillKind;
  target: LoadedTarget;
  all: LoadedTarget[];
  bestSop: string | null;
  startIndex: number;
  range: [number, number];
  choices: string[];
  answer: string;
  state: 'asking' | 'answered';
  correct?: boolean;
  picked?: string;
  feedback?: string;
  clickedId?: string | null;
  click?: { world: Vec3 | null; imageId: string | null; ok: boolean };
}

interface Setup {
  region: string;
  kinds: DrillKind[];
  expertOnly: boolean;
  length: number; // 0 = endless
  dueOnly: boolean;
}

const ALL_KINDS: DrillKind[] = ['locate', 'find', 'name', 'window'];
const shuffle = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]);

export default function DrillPage() {
  const { catalog, progress } = useApp();
  const [sp, setSp] = useSearchParams();
  const onlyKey = sp.get('key');
  const engineRef = useRef<ViewerEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ViewerEngine();
  const engine = engineRef.current;
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  useEffect(() => () => engine.destroy(), [engine]);

  const pool = useMemo(() => (catalog ? buildPool(catalog) : []), [catalog]);
  const [stats, setStats] = useState<DrillStats>({});
  useEffect(() => {
    progress.drillStats().then(setStats);
  }, [progress]);

  const [setup, setSetup] = useState<Setup>({ region: 'all', kinds: ALL_KINDS, expertOnly: false, length: 15, dueOnly: false });
  const [running, setRunning] = useState(false);
  const [q, setQ] = useState<Question | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ cand: DrillCandidate; kind: DrillKind; correct: boolean }>>([]);
  const [retry, setRetry] = useState<Array<{ key: string; after: number }>>([]);
  const [showAll, setShowAll] = useState(false);
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const unusable = useRef(new Set<string>()); // labels whose scan or outline could not be loaded

  const now = Date.now();
  const sum = summary(stats, now);
  const focusPool = useMemo(() => (onlyKey ? pool.filter((c) => c.key === onlyKey || c.base === onlyKey) : pool), [pool, onlyKey]);

  // ---------------------------------------------------------------- choose and load the next question
  const next = useCallback(async () => {
    if (!catalog) return;
    setShowAll(false);
    const done = history.length;
    if (setup.length && done >= setup.length) {
      setQ(null);
      setRunning(false);
      return;
    }
    const base = setup.dueOnly ? focusPool.filter((c) => isDue(statsRef.current[c.key], Date.now())) : focusPool;
    const opts = { region: onlyKey ? 'all' : setup.region, kinds: setup.kinds, expertOnly: setup.expertOnly, onlyKey, recentBases: history.map((h) => h.cand.base), lastCase: q?.cand.caseId ?? null };
    let pick: { cand: DrillCandidate; kind: DrillKind } | null = null;
    // A missed structure comes back after three other questions, on a different patient when one exists.
    // In a due-only review, a pending retry is asked as soon as nothing else is due.
    const r = retry.find((x) => x.after <= done) ?? (setup.dueOnly && !base.length ? retry[0] : undefined);
    if (r) {
      const same = eligible(focusPool, opts).filter((c) => c.key === r.key && kindsFor(c, setup.kinds).length);
      const lastCase = [...history].reverse().find((h) => h.cand.key === r.key)?.cand.caseId;
      const other = same.filter((c) => c.caseId !== lastCase);
      const cand = (other.length ? other : same)[Math.floor(Math.random() * Math.max(1, (other.length ? other : same).length))];
      if (cand) pick = { cand, kind: kindsFor(cand, setup.kinds)[0] };
      setRetry((xs) => xs.filter((x) => x !== r));
    }
    const usable = (list: DrillCandidate[]) => list.filter((c) => !unusable.current.has(c.targetId));
    // A due-only review ends when nothing is due, instead of turning into an ordinary session.
    pick ??= pickNext(usable(base), statsRef.current, opts);
    if (!pick) {
      setQ(null);
      setRunning(false);
      return;
    }
    setLoading(true);
    const { cand } = pick;
    let kind = pick.kind;
    // The anatomy of the scan (to name what was clicked instead) plus, for a finding, its expert outline or box.
    const loaded = await catalog.loadTargets([...catalog.anatomyTargetsForSeries([cand.seriesUid]), ...(cand.category === 'finding' ? [cand.targetId] : [])]);
    const all = [...loaded.values()].filter((t) => t.geom.geometryType === 'contour_set' || t.ref.id === cand.targetId);
    const target = loaded.get(cand.targetId);
    const src = catalog.seriesSource(cand.seriesUid);
    const idx = catalog.seriesIndex(cand.seriesUid);
    const usableGeom = target && ((target.geom.geometryType === 'contour_set' && target.geom.planes.length) || (target.geom.geometryType === 'box' && target.geom.boxes.length));
    if (!target || !usableGeom || !src) {
      unusable.current.add(cand.targetId);
      setLoading(false);
      return;
    }
    // Slices that show the structure, with their outline area (mm² for patient-space outlines; px² for boxes).
    const g = target.geom;
    const areas = (
      g.geometryType === 'box'
        ? g.boxes.map((b) => ({ sop: b.sopInstanceUid, i: src.sopUids.indexOf(b.sopInstanceUid), a: Math.abs((b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) }))
        : g.geometryType !== 'contour_set'
          ? []
          : g.planes.map((pl) => {
        const inst = idx?.bySop.get(pl.sopInstanceUid);
        const a = pl.polygons.reduce((s, poly) => {
          const pts: Vec2[] =
            target.geom.geometryType === 'contour_set' && target.geom.space === 'image_px'
              ? (poly as Vec2[])
              : inst?.plane
                ? (poly as Vec3[]).map((p) => patientToPlaneMm(inst.plane!, p))
                : [];
          return s + (pts.length >= 3 ? polygonArea(pts) : 0);
        }, 0);
        return { sop: pl.sopInstanceUid, i: src.sopUids.indexOf(pl.sopInstanceUid), a };
      })
    ).filter((x) => x.i >= 0);
    const max = Math.max(0, ...areas.map((x) => x.a));
    const good = areas.filter((x) => x.a >= max * 0.6);
    const best = good[Math.floor(Math.random() * good.length)] ?? areas[0];
    const lo = Math.min(...areas.map((x) => x.i));
    const hi = Math.max(...areas.map((x) => x.i));
    const count = src.sopUids.length;
    let startIndex = best?.i ?? 0;
    if (kind === 'find') {
      // Start well away from the structure so the level has to be found by scrolling.
      const gap = Math.round(count * 0.12);
      const above = lo - gap;
      const below = count - 1 - (hi + gap);
      if (count < 12 || (above < 1 && below < 1)) kind = 'locate';
      else startIndex = above >= below ? Math.floor(above / 2) : hi + gap + Math.floor(below / 2);
    }
    let choices: string[] = [];
    let answer = cand.name;
    if (kind === 'name') {
      const d = distractors(target, all, best?.sop ?? null);
      if (d.length < 2) kind = 'locate';
      else choices = shuffle([cand.name, ...d]);
    }
    if (kind === 'window') {
      answer = WINDOW_CHOICES.find((w) => w.id === bestWindow(cand))!.label;
      choices = WINDOW_CHOICES.map((w) => w.label);
    }
    setQ({ n: done + 1, cand, kind, target, all, bestSop: best?.sop ?? null, startIndex, range: [lo, hi], choices, answer, state: 'asking' });
    setLoading(false);
  }, [catalog, history, setup, focusPool, onlyKey, retry, q?.cand.caseId]);

  const start = (s: Partial<Setup> = {}) => {
    setSetup((cur) => ({ ...cur, ...s }));
    setHistory([]);
    setRetry([]);
    setRunning(true);
    setQ(null);
  };
  useEffect(() => {
    if (running && !q && !loading && catalog) void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, q, loading, catalog]);

  // Window: show the structure in its best window — except in the window question, which starts in a wrong one.
  const series = q ? catalog?.series.get(q.cand.seriesUid) : undefined;
  const ready = engine.panelState('d0')?.ready;
  const chest = q ? /^(trachea|main_bronchus|lung|heart|aorta(_ascending|_arch|_descending)?$|pulmonary|superior|brachio|carotid|subclavian|esophagus|thyroid|thymus|atrial)/.test(q.cand.base) : false;
  const applyWindow = useCallback(
    (w: WindowName) => {
      if (!series || series.modality !== 'CT') return;
      const p = presetFor(series.windowPresets, w, chest);
      if (p) engine.setWindow('d0', p.center, p.width);
    },
    [series, chest, engine],
  );
  useEffect(() => {
    if (!ready || !q || q.state !== 'asking') return;
    const bw = bestWindow(q.cand);
    applyWindow(q.kind === 'window' ? (bw === 'Lung' ? 'Soft tissue' : 'Lung') : bw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q?.n]);

  // ---------------------------------------------------------------- answering
  const finish = (correct: boolean, patch: Partial<Question>) => {
    if (!q) return;
    const s = recordAnswer(statsRef.current, q.cand, correct);
    setStats(s);
    void progress.saveDrillStats(s);
    setHistory((h) => [...h, { cand: q.cand, kind: q.kind, correct }]);
    if (!correct) setRetry((r) => [...r, { key: q.cand.key, after: history.length + 4 }]);
    setQ({ ...q, ...patch, state: 'answered', correct });
  };

  const onClick = (canvas: Vec2) => {
    if (!q || q.state !== 'asking' || (q.kind !== 'locate' && q.kind !== 'find') || !catalog) return;
    const idx = catalog.seriesIndex(q.cand.seriesUid);
    const shapes = shapesForPanel(engine, 'd0', q.all, idx).filter((sh) => sh.kind === 'poly' && sh.pts.length >= 3);
    // The structure's outlines and their holes: a click in a hole (e.g. inside the skull) is not on the structure.
    const mine = shapeRings(shapes.filter((sh) => sh.targetId === q.target.ref.id));
    const inside = mine.length > 0 && insideShapes(canvas, mine);
    // Canvas pixels → mm, so the edge tolerance is the same at every zoom.
    const w0 = engine.canvasToWorld('d0', canvas);
    const w1 = engine.canvasToWorld('d0', [canvas[0] + 10, canvas[1]]);
    const mmPerPx = w0 && w1 ? Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]) / 10 : 1;
    const edgeMm = mine.length ? distanceToShapes(canvas, mine) * mmPerPx : Infinity;
    const ok = inside || edgeMm <= 2;
    // What did they click instead? The smallest structure under the point.
    let clicked: { id: string; label: string; a: number } | null = null;
    for (const sh of shapes) {
      if (sh.targetId === q.target.ref.id || !shapeContains(sh, canvas)) continue;
      const a = shapeArea(sh);
      if (!clicked || a < clicked.a) clicked = { id: sh.targetId, label: sh.label, a };
    }
    const st = engine.panelState('d0');
    const onSlice = mine.length > 0;
    let feedback: string;
    if (inside) feedback = `Correct — that is the ${inSentence(q.cand.name)}.`;
    else if (ok) feedback = `Accepted: on the edge of the ${inSentence(q.cand.name)} (${edgeMm.toFixed(1)} mm).`;
    else if (!onSlice)
      feedback = `The ${inSentence(q.cand.name)} is not on this image. It is on images ${q.range[0] + 1}–${q.range[1] + 1}${clicked ? `; you clicked the ${inSentence(cleanLabel(clicked.label))}` : ''}.`;
    else feedback = `Not quite — ${clicked ? `you clicked the ${inSentence(cleanLabel(clicked.label))}` : `you were ${edgeMm.toFixed(0)} mm away`}. The ${inSentence(q.cand.name)} is outlined now.`;
    finish(ok, { feedback, clickedId: clicked?.id ?? null, click: { world: w0, imageId: st?.currentImageId ?? null, ok } });
    if (!onSlice && q.bestSop) {
      const src = catalog.seriesSource(q.cand.seriesUid);
      const i = src?.sopUids.indexOf(q.bestSop) ?? -1;
      if (i >= 0) setTimeout(() => engine.setIndex('d0', i), 700);
    }
  };

  const choose = (c: string) => {
    if (!q || q.state !== 'asking') return;
    const correct = c === q.answer;
    let feedback = correct ? 'Correct.' : `Not quite — the answer is ${q.answer}.`;
    if (q.kind === 'window') {
      const w = bestWindow(q.cand);
      applyWindow(w);
      feedback += ` ${WINDOW_WHY[w]}`;
    }
    finish(correct, { picked: c, feedback });
  };

  // Keyboard: 1–4 answer, Enter / N next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (!q) return;
      if (q.state === 'asking' && /^[1-4]$/.test(e.key) && q.choices[Number(e.key) - 1]) choose(q.choices[Number(e.key) - 1]);
      else if (q.state === 'answered' && (e.key === 'Enter' || e.key.toLowerCase() === 'n')) {
        e.preventDefault();
        void next();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') engine.scroll('d0', -1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') engine.scroll('d0', 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!catalog) return <div className="vp-status">Loading…</div>;

  // ---------------------------------------------------------------- setup and summary screen
  if (!running || !q) {
    const regionCount = (id: string) => new Set(eligible(pool, { region: id, expertOnly: setup.expertOnly }).map((c) => c.key)).size;
    const last = history.length ? history : null;
    const missed = last ? [...new Map(last.filter((h) => !h.correct).map((h) => [h.cand.key, h.cand])).values()] : [];
    const focusName = onlyKey ? (focusPool[0]?.name ?? onlyKey) : null;
    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
      <div className="page-inner stack" style={{ gap: 18, maxWidth: 980 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>Drills</h1>
          <span className="muted">
            Quick questions on real scans: point to a structure or a finding (pneumothorax, effusion, nodule, embolus, fracture…), scroll to its level, name an outline,
            or pick the window that shows it. What you miss comes back later on a different patient; what you know comes back less often.
          </span>
        </div>
        {loading ? <div className="notice info">Loading the next scan…</div> : null}
        {last ? (
          <section className="card stack" style={{ gap: 8 }}>
            <h2>
              Session done: {last.filter((h) => h.correct).length} / {last.length} correct
            </h2>
            {missed.length ? (
              <>
                <small className="muted">Missed this time — each one is scheduled to come back soon:</small>
                <div className="row wrap">
                  {missed.map((c) => (
                    <Link key={c.key} className="chip warn" to={`/read/${encodeURIComponent(c.caseId)}?mode=learn&show=${encodeURIComponent(c.targetId)}`}>
                      {c.name}
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <small className="muted">No misses. These structures will come back in a few days to make it stick.</small>
            )}
          </section>
        ) : null}
        <div className="row wrap" style={{ gap: 28 }}>
          <div className="stat">
            <b>{sum.due}</b>
            <span>due for review</span>
          </div>
          <div className="stat">
            <b>{sum.secure}</b>
            <span>known well</span>
          </div>
          <div className="stat">
            <b>{sum.practised}</b>
            <span>structures practised</span>
          </div>
          <div className="stat">
            <b>{new Set(pool.map((c) => c.key)).size}</b>
            <span>structures available</span>
          </div>
        </div>
        {focusName ? (
          <section className="card stack" style={{ gap: 8 }}>
            <h2>Drill one structure: {focusName}</h2>
            <small className="muted">{new Set(focusPool.map((c) => c.caseId)).size} patients have this structure labelled.</small>
            <div className="row wrap">
              <button className="btn primary" onClick={() => start({ length: 8, dueOnly: false })}>
                <Target size={14} /> Start (8 questions)
              </button>
              <button className="btn" onClick={() => setSp({})}>
                Choose other structures
              </button>
            </div>
          </section>
        ) : (
          <section className="card stack" style={{ gap: 12 }}>
            <h2>New session</h2>
            <div className="stack" style={{ gap: 6 }}>
              <b style={{ fontSize: 13 }}>Region</b>
              <div className="row wrap">
                {REGIONS.map((r) => {
                  const n = regionCount(r.id);
                  return (
                    <button key={r.id} className="chip" aria-pressed={setup.region === r.id} disabled={!n} onClick={() => setSetup((s) => ({ ...s, region: r.id }))}>
                      {r.label} · {n}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <b style={{ fontSize: 13 }}>Question types</b>
              <div className="row wrap">
                {ALL_KINDS.map((k) => (
                  <label key={k} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={setup.kinds.includes(k)}
                      onChange={(e) => setSetup((s) => ({ ...s, kinds: e.target.checked ? [...s.kinds, k] : s.kinds.length > 1 ? s.kinds.filter((x) => x !== k) : s.kinds }))}
                    />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 18 }}>
              <label className="row" style={{ gap: 6 }}>
                Length
                <select value={setup.length} onChange={(e) => setSetup((s) => ({ ...s, length: Number(e.target.value) }))} aria-label="Session length">
                  <option value={10}>10 questions</option>
                  <option value={15}>15 questions</option>
                  <option value={25}>25 questions</option>
                  <option value={0}>Until I stop</option>
                </select>
              </label>
              <label className="row" style={{ gap: 4 }} title={`Leave off to include ${AI_LABEL} outlines (aorta and colon parts, bones, vessels).`}>
                <input type="checkbox" checked={setup.expertOnly} onChange={(e) => setSetup((s) => ({ ...s, expertOnly: e.target.checked }))} /> Expert labels only
              </label>
            </div>
            <div className="row wrap">
              <button className="btn primary lg" onClick={() => start({ dueOnly: false })} disabled={!regionCount(setup.region)}>
                <Target size={15} /> Start drilling
              </button>
              <button className="btn lg" onClick={() => start({ dueOnly: true })} disabled={!sum.due}>
                <RotateCcw size={15} /> Review {sum.due} due
              </button>
            </div>
          </section>
        )}
        {sum.weakest.length ? (
          <section className="card stack" style={{ gap: 8 }}>
            <h2>Your weakest structures</h2>
            <div className="row wrap">
              {sum.weakest.map((s) => (
                <Link key={s.key} className="chip" to={`/drill?key=${encodeURIComponent(s.key)}`} title="Drill this structure across patients">
                  {s.name} · {Math.round((100 * s.correct) / s.seen)}%
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      </div>
    );
  }

  // Inspection handle for automated acceptance tests (read-only): the current answer's outline on screen.
  (window as unknown as { __rvmDrill: unknown }).__rvmDrill = {
    kind: q.kind,
    state: q.state,
    name: q.cand.name,
    engine,
    answerPolys: () => shapesForPanel(engine, 'd0', [q.target], catalog.seriesIndex(q.cand.seriesUid)).filter((sh) => sh.kind === 'poly').map((sh) => sh.pts),
  };

  // ---------------------------------------------------------------- question screen
  const src = catalog.seriesSource(q.cand.seriesUid)!;
  const s = catalog.series.get(q.cand.seriesUid)!;
  const kase = catalog.cases.get(q.cand.caseId);
  const note = noteFor(q.cand.key, q.cand.family);
  const condition = q.cand.category === 'finding' ? conditionForFinding(q.cand.key) : null;
  const ai = isAutomatic(q.cand.provenance);
  const answered = q.state === 'answered';
  const showIds = answered ? new Set([q.target.ref.id, ...(q.clickedId ? [q.clickedId] : [])]) : null;
  const badges: MarkBadge[] = q.click ? [{ id: 'click', world: q.click.world, imageId: q.click.imageId, px: null, glyph: q.click.ok ? '✓' : '✗', text: 'you', tone: q.click.ok ? 'ok' : 'bad' }] : [];
  const prompt =
    q.kind === 'locate'
      ? `Click the ${inSentence(q.cand.name)}.`
      : q.kind === 'find'
        ? `Scroll to a slice that shows the ${inSentence(q.cand.name)}, then click it.`
        : q.kind === 'name'
          ? 'Which structure is outlined?'
          : `Which window is best for examining the ${inSentence(q.cand.name)}?`;
  const score = history.filter((h) => h.correct).length;

  return (
    <div className="drill">
      <section className="drill-view" aria-label="Drill image">
        <div className="vgrid l1">
          <ViewportPanel
            key={`d0-${q.n}-${q.cand.seriesUid}`}
            engine={engine}
            panelId="d0"
            source={src}
            series={s}
            seriesIndex={catalog.seriesIndex(q.cand.seriesUid)}
            kind="stack"
            startIndex={q.startIndex}
            focused
            onFocus={() => {}}
            onImageClick={onClick}
            overlay={{
              targets: [],
              showReference: false,
              opacity: 1,
              highlightIds: new Set(),
              showLabels: false,
              badges,
              anatomy: {
                on: answered || q.kind === 'name' || q.kind === 'window',
                targets: answered ? q.all : [q.target],
                showNames: answered && showAll,
                hidden: new Set(),
                highlightId: answered ? q.target.ref.id : null,
                isolateId: answered && !showAll && !q.clickedId ? q.target.ref.id : !answered ? q.target.ref.id : null,
                isolateSet: answered && !showAll && q.clickedId ? showIds : null,
                isolateLabel: answered ? (q.clickedId ? `${q.cand.name} and what you clicked` : q.cand.name) : undefined,
                quiz: !answered,
                onIsolateClear: () => setShowAll(true),
              },
            }}
            seriesOptions={[]}
          />
        </div>
      </section>
      <aside className="drill-side stack" aria-label="Question">
        <div className="row">
          <span className="chip accent">{KIND_LABEL[q.kind]}</span>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12 }}>
            {setup.length ? `${q.n} / ${setup.length}` : `Question ${q.n}`} · {score} correct
          </span>
        </div>
        <h2 style={{ margin: 0 }}>{prompt}</h2>
        <small className="faint">
          {kase?.neutralTitle ?? 'Patient'} · {s.modality} · scroll with the wheel or ↑ ↓{q.kind === 'locate' || q.kind === 'find' ? ' · left-drag changes brightness' : ''}
        </small>
        {q.choices.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {q.choices.map((c, i) => {
              const tone = answered ? (c === q.answer ? 'ok' : c === q.picked ? 'bad' : '') : '';
              return (
                <button key={c} className={`btn drill-choice ${tone}`} disabled={answered} onClick={() => choose(c)}>
                  <span className="kbd">{i + 1}</span> {c}
                  {answered && c === q.answer ? <Check size={14} /> : answered && c === q.picked ? <X size={14} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {answered ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className={`notice ${q.correct ? 'ok' : 'bad'}`}>{q.feedback}</div>
            {condition ? (
              <div className="card stack" style={{ gap: 4, fontSize: 13 }}>
                <b>{q.cand.name}: what to look for</b>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {condition.signs.slice(0, 3).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <Link to={`/conditions?c=${condition.id}`} className="faint" style={{ fontSize: 12 }}>
                  More cases and the book pages
                </Link>
              </div>
            ) : null}
            {note ? (
              <div className="card stack" style={{ gap: 4, fontSize: 13 }}>
                <b>{q.cand.name}</b>
                <span>
                  <b>Looks like:</b> {note.look}
                </span>
                <span>
                  <b>Next to:</b> {note.near}
                </span>
                {note.pitfall ? (
                  <span>
                    <b>Pitfall:</b> {note.pitfall}
                  </span>
                ) : null}
                <Link to={`/course/${note.unit}`} className="faint" style={{ fontSize: 12 }}>
                  Chapter in the book
                </Link>
              </div>
            ) : null}
            <small className="faint">
              Reference: {ai ? `${AI_LABEL} outline — quality-checked, not yet reviewed by a radiologist; edges can be a few mm off.` : 'expert label from the source dataset.'}
            </small>
            <div className="row wrap">
              <button className="btn primary" onClick={() => void next()} autoFocus>
                Next <span className="kbd">Enter</span>
              </button>
              <Link className="btn" to={`/read/${encodeURIComponent(q.cand.caseId)}?mode=learn&show=${encodeURIComponent(q.cand.targetId)}`}>
                Open in viewer
              </Link>
              {!showAll ? (
                <button className="btn ghost" onClick={() => setShowAll(true)}>
                  Show all labels
                </button>
              ) : null}
            </div>
          </div>
        ) : loading ? (
          <small className="faint">Loading…</small>
        ) : null}
        <span className="spacer" />
        <button
          className="btn ghost sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setRunning(false);
            setQ(null);
          }}
        >
          End session
        </button>
      </aside>
    </div>
  );
}
