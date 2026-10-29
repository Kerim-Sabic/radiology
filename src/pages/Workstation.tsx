import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Dialog, DropdownMenu, Tabs } from 'radix-ui';
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Box,
  ChevronDown,
  Columns2,
  Contrast,
  Crosshair,
  Eraser,
  Expand,
  Grid2x2,
  Keyboard,
  MapPin,
  Move,
  PanelLeft,
  PanelRight,
  PenLine,
  Redo2,
  RotateCcw,
  Rotate3d,
  Ruler,
  ScanLine,
  Square,
  SunMoon,
  Timer,
  Triangle,
  Undo2,
  ZoomIn,
  Circle,
  Eye,
  EyeOff,
  Square as SquareIcon,
  Layers,
  Users,
  SkipForward,
  Link2,
  Link2Off,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  Search as SearchIcon,
  PaintBucket,
  ImageDown,
} from 'lucide-react';
import '../styles/viewer3d.css';
import { useApp } from '../app/AppContext';
import { ViewerEngine, type ToolId, type ViewKind } from '../viewer/engine';
import { PlanesControl } from '../components/ws/MprControls';
import { hangMammograms, mammoView } from '../content/mammo';
import { secondsLeft, shiftUrl, type OncallShift, type ShiftItem } from '../services/oncall';

const MARK_TOOLS = new Set<ToolId>(['point', 'arrow', 'box', 'outline', 'eraser']);
import { arrowLabelHook } from '../viewer/csInit';
import { lookOf, segStyle, withLookAll } from '../viewer/segStyle';
import { GROUP_ORDER } from '../viewer/anatomyMask';
import { downloadBlob, shortLicense, slug, viewToPng } from '../lib/viewImage';
import { ViewportPanel, type MarkBadge } from '../components/ws/ViewportPanel';
import { TaskPanel } from '../components/ws/TaskPanel';
import { BookPanel } from '../components/ws/BookPanel';
import { AnatomyPanel } from '../components/ws/AnatomyPanel';
import { CoachPanel } from '../components/ws/CoachPanel';
import type { CoachStep } from '../content/searchPatterns';
import { canonicalAnatomyKey, imageFamily } from '../content/bookAnatomy';
import { presetFor, recordAnswer, type DrillCandidate } from '../services/drill';
import { structureBase } from '../content/structureNotes';
import { categoryFor } from '../components/ws/overlayShapes';
import { landmarks, levelName, mapZ, matchLevels, type Landmark } from '../services/levelSync';
import { IconButton, ProvenanceChip, Toast, useToast } from '../components/ui';
import { gradeTask, measureWithinSlab, probeOfMark, type LoadedTarget } from '../grading/spatialGrader';
import type { GradeResult, LearnerMark } from '../grading/types';
import type { BookAnchorRef, Series, Task } from '../schema/content';
import type { SeriesIndex } from '../grading/seriesIndex';
import { canSubmit, newSession, reportShown, rules, hintLadder, type SessionState } from '../services/lessonEngine';
import { newId, type Attempt, type Mode } from '../services/progressRepository';
import { anchorLabel as fmtAnchor } from '../services/curriculum';
import type { ViewSnapshot } from '../viewer/engine';
import { imageToPatient, patientToPlaneMm, polygonArea, polygonCentroid, type Vec2, type Vec3 } from '../lib/geometry';
import { AI_DRAFT_BY, cleanLabel, isAiDraft, plainName } from '../lib/provenance';

const centroid3 = (poly: Vec3[]): Vec3 => [
  poly.reduce((a, q) => a + q[0], 0) / poly.length,
  poly.reduce((a, q) => a + q[1], 0) / poly.length,
  poly.reduce((a, q) => a + q[2], 0) / poly.length,
];

type Layout = '1' | '2' | '4' | 'mpr' | 'mpr3d' | 'mg';
interface PanelDef {
  id: string;
  seriesUid: string;
  kind: ViewKind;
}

const MODES: Array<[Mode, string]> = [
  ['learn', 'Learn'],
  ['practice', 'Practice'],
  ['assess', 'Assess'],
  ['review', 'Review'],
];

function studyLabel(series: Series, date: string | null) {
  return `${series.modality}${date ? ` · ${date}` : ''} · ${series.description || `Series ${series.number ?? ''}`}`;
}

export default function Workstation() {
  const { caseId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { catalog, curriculum, progress, attempts, settings, reviews } = useApp();
  const engineRef = useRef<ViewerEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ViewerEngine();
  const engine = engineRef.current;
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  useEffect(() => () => engine.destroy(), [engine]);
  // Inspection handle for automated acceptance tests (read-only use).
  (window as unknown as { __rvm: ViewerEngine }).__rvm = engine;

  const kase = catalog?.cases.get(caseId) ?? null;
  const tasks = useMemo(() => (catalog?.tasksByCase.get(caseId) ?? []).slice(), [catalog, caseId]);
  const mode = (sp.get('mode') as Mode) || 'practice';
  const availableTasks = tasks.filter((t) => mode === 'review' || t.modes.includes(mode === 'assess' ? 'assess' : mode === 'learn' ? 'learn' : 'practice'));
  const task: Task | null = availableTasks.find((t) => t.id === sp.get('task')) ?? availableTasks[0] ?? tasks.find((t) => t.id === sp.get('task')) ?? null;

  const [layout, setLayout] = useState<Layout>('1');
  /** One view enlarged with the others in a strip beside it (they stay live and linked). */
  const [bigPanel, setBigPanel] = useState<string | null>(null);
  const [panels, setPanels] = useState<PanelDef[]>([]);
  const [focused, setFocused] = useState('p0');
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 860);
  const [rightOpen, setRightOpen] = useState(true);
  const [tab, setTab] = useState('task');
  const [session, setSession] = useState<SessionState | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [submittedMarks, setSubmittedMarks] = useState<LearnerMark[]>([]);
  const [selfReview, setSelfReview] = useState<Attempt['selfReview']>(null);
  const [attemptId, setAttemptId] = useState<string>(newId());
  const [targets, setTargets] = useState<Map<string, LoadedTarget>>(new Map());
  const [refToggle, setRefToggle] = useState(true);
  const [refOpacity, setRefOpacity] = useState(0.9);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [bookAnchor, setBookAnchor] = useState<BookAnchorRef | null>(null);
  const [returnSnap, setReturnSnap] = useState<ViewSnapshot | null>(null);
  const [labelReq, setLabelReq] = useState<((t: string) => void) | null>(null);
  const [labelText, setLabelText] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [anatomyOn, setAnatomyOn] = useState<boolean | null>(null); // null = mode default
  const [anatomyNames, setAnatomyNames] = useState(false);
  const [anatomyHidden, setAnatomyHidden] = useState<Set<string>>(new Set(['muscles']));
  const look = useSyncExternalStore(segStyle.subscribe, segStyle.get);
  const allFilled = GROUP_ORDER.every((g) => lookOf(look, g) === 'fill');
  const toggleFill = () => segStyle.update((x) => withLookAll(x, allFilled ? 'outline' : 'fill'));
  const [anatomyHighlight, setAnatomyHighlight] = useState<string | null>(null);
  const [isolateId, setIsolateId] = useState<string | null>(null);
  const [anatomyTargets, setAnatomyTargets] = useState<LoadedTarget[]>([]);
  const [anatomyLoading, setAnatomyLoading] = useState(false);
  // Search-pattern coach: a group of structures shown together for one step.
  const [focusSet, setFocusSet] = useState<{ ids: Set<string>; label: string; step: string } | null>(null);
  const [pendingStep, setPendingStep] = useState<CoachStep | null>(null);
  // Comparison with a different patient, matched by anatomical level.
  const [compare, setCompare] = useState<{ rank: number; total: number; caseId: string; seriesUid: string; noFindings: boolean } | null>(null);
  const [compareTargets, setCompareTargets] = useState<LoadedTarget[]>([]);
  const [syncPairs, setSyncPairs] = useState<Array<[number, number]>>([]);
  const [marksA, setMarksA] = useState<Map<string, Landmark>>(new Map());
  const toast = useToast();

  // ---------------------------------------------------------------- case & task setup
  const caseSeries = useMemo(() => (kase && catalog ? catalog.seriesForCase(kase) : []), [kase, catalog]);
  const seriesOptions = useMemo(
    () =>
      caseSeries.map((s) => ({
        uid: s.uid,
        label: studyLabel(s, catalog?.studies.get(s.studyUid)?.date ?? null),
      })),
    [caseSeries, catalog],
  );

  useEffect(() => {
    if (!catalog || !kase) return;
    let cancelled = false;
    // Task-layer targets, plus any atlas-layer (expert) outline a task of this case grades against.
    const taskIds = (catalog.tasksByCase.get(kase.id) ?? []).flatMap((t) => t.targets.map((x) => x.targetId));
    const ids = [...new Set([...catalog.targetsForSeries(caseSeries.map((s) => s.uid)), ...taskIds])];
    catalog.loadTargets(ids).then((m) => {
      if (cancelled) return; // a later case (or review change) owns the targets now
      // Apply the learner's own review records (never invented): reviewed drafts become human_reviewed.
      for (const r of reviews) {
        const t = m.get(r.targetId);
        if (t && r.status === 'reviewed_by_user')
          m.set(r.targetId, { ...t, ref: { ...t.ref, provenance: 'human_reviewed', review: { status: 'reviewed_by_user', reviewer: r.reviewer, at: r.at, note: r.note } } });
      }
      setTargets(m);
    });
    return () => {
      cancelled = true;
    };
  }, [catalog, kase, caseSeries, reviews]);
  // Free other cases' image data, but keep this case and the comparison patient (a progress save must never abort them).
  useEffect(() => {
    engine.releaseUnused(new Set([...caseSeries.map((s) => s.uid), ...(compare ? [compare.seriesUid] : [])]));
  }, [engine, caseSeries, compare?.seriesUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const startIndexFor = useCallback(
    (uid: string, t: Task | null) => {
      const s = catalog?.series.get(uid);
      const n = s ? s.instances.reduce((a, i) => a + i.frames, 0) : 1;
      const spec = t && t.start.seriesUid === uid ? t.start.slice : 'middle';
      if (spec === 'first') return 0;
      if (spec === 'last') return n - 1;
      if (spec === 'middle') return Math.floor(n / 2);
      return Math.max(0, Math.min(n - 1, spec));
    },
    [catalog],
  );

  // Reset the session whenever task or mode changes.
  useEffect(() => {
    if (!task || !kase) return;
    engine.clearMarks();
    const s = newSession(task, mode);
    setSession(s);
    setGrade(null);
    setSubmittedMarks([]);
    setSelfReview(null);
    setAttemptId(newId());
    setHighlight(new Set());
    setAnatomyOn(null);
    setAnatomyHighlight(null);
    setIsolateId(null);
    setFocusSet(null);
    setCompare(null);
    setLayout('1');
    setBigPanel(null);
    setPanels([{ id: 'p0', seriesUid: task.start.seriesUid, kind: 'stack' }]);
    setFocused('p0');
    setTab('task');
    setTimeLeft(mode === 'assess' && settings.assessTimerMinutes ? settings.assessTimerMinutes * 60 : null);
    if (mode === 'review') {
      progress.attemptsForTask(task.id).then((list) => {
        const last = list.filter((a) => a.submittedAt).sort((a, b) => (a.submittedAt! < b.submittedAt! ? 1 : -1))[0];
        if (last) {
          setGrade(last.grade);
          setSubmittedMarks(last.marks);
          setSelfReview(last.selfReview);
          setSession((cur) => (cur ? { ...cur, report: last.report ?? cur.report, choice: last.choice, hintsOpened: last.hintsUsed, revealed: last.revealed } : cur));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, kase?.id, mode]);

  // Apply the task's starting window preset once the first panel is ready.
  const p0Ready = engine.panelState('p0')?.ready;
  useEffect(() => {
    if (!p0Ready || !task?.start.windowPreset) return;
    const s = catalog?.series.get(task.start.seriesUid);
    const preset = s?.windowPresets.find((w) => w.label === task.start.windowPreset);
    if (preset) engine.setWindow('p0', preset.center, preset.width);
  }, [p0Ready, task, catalog, engine]);

  // ---------------------------------------------------------------- on-call shift
  const shiftId = sp.get('shift');
  const [shift, setShift] = useState<OncallShift | null>(null);
  useEffect(() => {
    if (!shiftId) {
      setShift(null);
      return;
    }
    let cancelled = false;
    progress.oncallShift().then((s) => {
      if (!cancelled) setShift(s && s.id === shiftId && !s.finishedAt ? s : null);
    });
    return () => {
      cancelled = true;
    };
  }, [shiftId, progress]);
  const shiftIndex = shift && task ? shift.items.findIndex((it) => it.caseId === caseId && it.taskId === task.id) : -1;
  const shiftItem = shift && shiftIndex >= 0 && mode === 'assess' ? shift.items[shiftIndex] : null;
  const updateShiftItem = (patch: Partial<ShiftItem>) => {
    if (!shift || shiftIndex < 0) return;
    const next = { ...shift, items: shift.items.map((it, i) => (i === shiftIndex ? { ...it, ...patch } : it)) };
    setShift(next);
    void progress.saveOncallShift(next);
  };
  // The case clock starts when the case is first opened and keeps running across reloads.
  useEffect(() => {
    if (!shift || !shiftItem) return;
    if (!shiftItem.startedAt) updateShiftItem({ startedAt: new Date().toISOString() });
    else if (!shiftItem.submittedAt) setTimeLeft(secondsLeft(shift, shiftItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift?.id, shiftIndex, shiftItem?.startedAt]);
  // Record the answer in the shift (with whether it ran over time).
  useEffect(() => {
    if (!shift || !shiftItem || !session?.submitted || shiftItem.submittedAt) return;
    const at = new Date().toISOString();
    updateShiftItem({ submittedAt: at, attemptId, overTime: (secondsLeft(shift, { ...shiftItem, submittedAt: at }) ?? 1) < 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.submitted, shiftItem?.submittedAt]);
  const nextInShift = shift ? shift.items.findIndex((it, i) => i !== shiftIndex && !it.submittedAt) : -1;
  const goNextInShift = async () => {
    if (!shift) return;
    if (nextInShift >= 0) navigate(shiftUrl(shift, nextInShift));
    else {
      await progress.finishOncallShift(shift);
      navigate('/oncall');
    }
  };

  // Mammography hanging: turn each view so the chest walls meet in the middle, once its image has loaded.
  const facedRef = useRef(new Set<string>());
  useEffect(() => {
    if (layout !== 'mg') {
      facedRef.current.clear();
      return;
    }
    for (const pd of panels) {
      const side = mgFacing.current.get(pd.id);
      const key = `${pd.id}|${pd.seriesUid}`;
      if (!side || facedRef.current.has(key) || !engine.panelState(pd.id)?.ready) continue;
      if (engine.faceChestWall(pd.id, side)) facedRef.current.add(key);
    }
  });

  // Assess timer (optional; never forces submission).
  useEffect(() => {
    if (timeLeft === null || session?.submitted) return;
    if (timeLeft <= 0) {
      toast.show('Time is up — submit when ready (the timer never discards your work).');
      return;
    }
    const t = setTimeout(() => setTimeLeft((x) => (x === null ? null : x - 1)), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, session?.submitted, toast]);

  // Arrow tool label prompt.
  useEffect(() => {
    arrowLabelHook.request = (done) => {
      setLabelText('');
      setLabelReq(() => done);
    };
    return () => {
      arrowLabelHook.request = null;
    };
  }, []);

  const marks = useMemo(() => engine.collectMarks(), [engine, engine.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave draft attempt after meaningful changes (debounced).
  useEffect(() => {
    if (!session || !task || !kase || session.submitted || mode === 'review') return;
    if (!marks.length && !session.report.findings && !session.choice.length) return;
    const t = setTimeout(() => {
      void progress.saveAttempt(buildAttempt(null)).catch((e) => toast.show(String(e.message ?? e)));
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks.length, session?.report, session?.choice, session?.hintsOpened.length, session?.submitted, attemptId]);

  // ---------------------------------------------------------------- layout changes
  const applyLayout = (l: Layout) => {
    if (!task) return;
    const primary = panels[0]?.seriesUid ?? task.start.seriesUid;
    const s = catalog?.series.get(primary);
    if ((l === 'mpr' || l === 'mpr3d') && !s?.geometry.volumeEligible) {
      toast.show(s?.geometry.volumeIssues.length ? `MPR unavailable: ${s.geometry.volumeIssues.join('; ')}` : 'MPR needs a CT/MR volume with regular geometry.');
      return;
    }
    if (l === 'mpr3d' && !engine.gpu) {
      toast.show('3D needs GPU rendering, which this device does not provide. 2D views remain available.');
      return;
    }
    setLayout(l);
    setBigPanel(null);
    setCompare(null);
    // Prefer other diagnostic series; fall back to scouts (clearly labelled) when nothing else exists.
    const others = [...caseSeries.filter((x) => x.uid !== primary && x.role !== 'scout'), ...caseSeries.filter((x) => x.uid !== primary && x.role === 'scout')];
    if (l === '1') setPanels([{ id: 'p0', seriesUid: primary, kind: 'stack' }]);
    if (l === '2') setPanels([{ id: 'p0', seriesUid: primary, kind: 'stack' }, { id: 'p1', seriesUid: others[0]?.uid ?? primary, kind: others[0] ? 'stack' : s?.geometry.volumeEligible ? 'coronal' : 'stack' }]);
    if (l === '4') setPanels([0, 1, 2, 3].map((i) => ({ id: `p${i}`, seriesUid: i === 0 ? primary : (others[i - 1]?.uid ?? primary), kind: 'stack' as ViewKind })));
    if (l === 'mpr')
      setPanels([
        { id: 'p0', seriesUid: primary, kind: 'axial' },
        { id: 'p1', seriesUid: primary, kind: 'coronal' },
        { id: 'p2', seriesUid: primary, kind: 'sagittal' },
      ]);
    if (l === 'mpr3d')
      setPanels([
        { id: 'p0', seriesUid: primary, kind: 'axial' },
        { id: 'p1', seriesUid: primary, kind: 'coronal' },
        { id: 'p2', seriesUid: primary, kind: 'sagittal' },
        { id: 'p3', seriesUid: primary, kind: '3d' },
      ]);
    if (l === 'mg') {
      // Book ch. 29 hanging: CC row above the MLO row, right breast on the left, chest walls back to back.
      const hung = hangMammograms(mgSeries.map((x) => ({ uid: x.uid, view: mammoView(x.description, x.acquisition) })));
      mgFacing.current = new Map(hung.map((h, i) => [`p${i}`, h.chestWall]));
      setPanels(hung.slice(0, 4).map((h, i) => ({ id: `p${i}`, seriesUid: h.uid, kind: 'stack' as ViewKind })));
    } else mgFacing.current = new Map();
    setFocused('p0');
  };

  const mgSeries = caseSeries.filter((x) => x.modality === 'MG');
  /** Mammography layout: which edge each panel's chest wall must face (applied once its image is loaded). */
  const mgFacing = useRef(new Map<string, 'left' | 'right' | null>());

  const pickSeries = (panelId: string, uid: string) => setPanels((ps) => ps.map((p) => (p.id === panelId ? { ...p, seriesUid: uid, kind: 'stack' } : p)));

  // ---------------------------------------------------------------- reference visibility
  const taskTargetIds = useMemo(() => new Set(task?.targets.map((t) => t.targetId) ?? []), [task]);
  const refAllowed = !!session && rules.referenceVisible(session);
  const anatomyVisible = refAllowed && (anatomyOn ?? (mode === 'learn' || mode === 'review'));
  // The 3D structure models need the outlines even when the 2D labels are switched off.
  const anatomyNeeded = anatomyVisible || (refAllowed && layout === 'mpr3d');
  useEffect(() => {
    if (!anatomyNeeded || !catalog || !kase) return;
    const ids = catalog.anatomyTargetsForSeries(caseSeries.map((x) => x.uid));
    if (!ids.length) {
      setAnatomyTargets([]);
      return;
    }
    let cancelled = false;
    setAnatomyLoading(true);
    catalog.loadTargets(ids).then((m) => {
      if (cancelled) return;
      setAnatomyTargets([...m.values()]);
      setAnatomyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [anatomyNeeded, catalog, kase, caseSeries]);
  const anatomyIds = useMemo(() => new Set(anatomyTargets.map((t) => t.ref.id)), [anatomyTargets]);
  // Structures the anatomy layer already names, per series. Named parts (aortic arch, sigmoid colon, left ventricle)
  // also stand for their whole, so a machine-drawn whole outline from another pack is not drawn over them.
  const anatomyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of anatomyTargets) {
      const k = canonicalAnatomyKey(t.ref.classId);
      keys.add(`${t.ref.seriesUid}|${k}`);
      const whole = /^aorta_/.test(k) ? 'aorta' : /^colon_/.test(k) ? 'colon' : /^heart_(atrium|ventricle)_/.test(k) ? 'heart' : null;
      if (whole) keys.add(`${t.ref.seriesUid}|${whole}*`);
    }
    return keys;
  }, [anatomyTargets]);
  const namedByAnatomy = useCallback(
    (t: LoadedTarget) => {
      const k = `${t.ref.seriesUid}|${canonicalAnatomyKey(t.ref.classId)}`;
      return anatomyKeys.has(k) || (t.ref.provenance === 'ai_draft' && anatomyKeys.has(`${k}*`));
    },
    [anatomyKeys],
  );
  const visibleTargets = useMemo(() => {
    // When the anatomy layer is on it draws anatomical structures itself; avoid drawing them twice.
    // Other tasks' references for a structure the anatomy layer already names (e.g. a vessel task's SVC) are not drawn again.
    const all = [...targets.values()].filter((t) => !(anatomyVisible && !taskTargetIds.has(t.ref.id) && (anatomyIds.has(t.ref.id) || namedByAnatomy(t))));
    if (refAllowed && refToggle) return mode === 'learn' || mode === 'review' ? all.filter((t) => taskTargetIds.has(t.ref.id) || t.ref.geometryType !== 'slice_interval') : all.filter((t) => taskTargetIds.has(t.ref.id));
    return all.filter((t) => highlight.has(t.ref.id));
  }, [targets, refAllowed, refToggle, mode, taskTargetIds, highlight, anatomyVisible, anatomyIds, namedByAnatomy]);
  // Reference names are written only where the anatomy layer does not already name the same structure.
  const refLabelIds = useMemo(() => (anatomyVisible ? new Set(visibleTargets.filter((t) => !namedByAnatomy(t)).map((t) => t.ref.id)) : null), [anatomyVisible, visibleTargets, namedByAnatomy]);

  const badges = useMemo<MarkBadge[]>(() => {
    if (!grade) return [];
    const list = submittedMarks.length ? submittedMarks : marks;
    return list
      .map((m, i) => {
        const mo = grade.marks.find((x) => x.markId === m.id);
        if (!mo) return null;
        const tone: MarkBadge['tone'] = mo.status === 'matched' ? 'ok' : mo.status === 'unmatched_unscored' ? 'neutral' : mo.status === 'duplicate' || mo.status === 'near_miss' ? 'warn' : 'bad';
        const glyph = tone === 'ok' ? '✓' : tone === 'neutral' ? '?' : tone === 'warn' ? '!' : '✗';
        const src = catalog?.seriesSource(m.seriesUid);
        const imageId = src && m.sopInstanceUid ? src.imageIds[src.sopUids.indexOf(m.sopInstanceUid)] : null;
        return { id: m.id, world: m.worldLps?.[0] ?? null, imageId, px: m.imagePx?.[0] ?? null, glyph, text: `${i + 1}`, tone };
      })
      .filter((b): b is NonNullable<typeof b> => !!b);
  }, [grade, submittedMarks, marks, catalog]);

  // ---------------------------------------------------------------- actions
  const update = (patch: Partial<SessionState>) => setSession((s) => (s ? { ...s, ...patch } : s));

  function buildAttempt(g: GradeResult | null, final = false): Attempt {
    const s = session!;
    return {
      id: attemptId,
      taskId: task!.id,
      caseId: kase!.id,
      subjectKey: kase!.subjectKey,
      holdoutGroup: catalog!.holdoutGroup(kase!.id),
      packId: kase!.packId,
      lessonVersion: catalog!.packs.find((p) => p.id === kase!.packId)?.lessons?.version ?? '?',
      mode,
      startedAt: new Date(s.startedAt).toISOString(),
      submittedAt: final ? new Date().toISOString() : null,
      durationMs: Date.now() - s.startedAt,
      marks: final ? submittedMarks.length ? submittedMarks : marks : marks,
      position: null,
      choice: s.choice,
      declaredNoFinding: s.declaredNoFinding,
      uncertain: s.uncertain || s.notAssessable,
      report: s.report.findings || s.report.impression || s.report.differential ? s.report : null,
      confidence: s.confidence,
      hintsUsed: s.hintsOpened,
      revealed: s.revealed,
      grade: g,
      selfReview,
      independent: rules.independent(s),
      objectiveIds: task!.objectiveIds,
      skillDimensions: task!.skillDimensions,
    };
  }

  const submit = async () => {
    if (!session || !task || !catalog) return;
    const frozen = engine.collectMarks();
    if (!canSubmit(task, session, frozen.length, reportShown(task, settings.level))) return;
    const pp = panels.find((p) => p.id === focused) ?? panels[0];
    const cp = engine.currentPlanePoint(pp.id);
    const seriesMap = new Map(caseSeries.map((s) => [s.uid, catalog.seriesIndex(s.uid)!]));
    const g = gradeTask({
      task,
      targets,
      series: seriesMap,
      marks: frozen,
      position: { seriesUid: pp.seriesUid, sopInstanceUid: cp.sop, worldLps: cp.world },
      choice: session.choice,
      declaredNoFinding: session.declaredNoFinding || session.notAssessable,
    });
    // Unscored marks: say what the anatomy layer (expert or AI atlas) places there — informative only, never scored.
    const unscored = g.marks.filter((m) => m.status === 'unmatched_unscored');
    if (unscored.length) {
      const atlas = await catalog.loadTargets(catalog.anatomyTargetsForSeries(caseSeries.map((x) => x.uid)));
      for (const mo of unscored) {
        const mk = frozen.find((x) => x.id === mo.markId);
        if (!mk) continue;
        const probe = probeOfMark(mk, seriesMap.get(mk.seriesUid));
        const hits = [...atlas.values()]
          .map((t) => ({ t, m: measureWithinSlab(probe, t, seriesMap.get(mk.seriesUid), 1.6) }))
          .filter((x) => x.m.comparable && x.m.sliceDistanceMm <= 1.6 && x.m.inPlaneDistanceMm === 0)
          .map((x) => `${cleanLabel(x.t.ref.label)}${isAiDraft(x.t.ref.provenance) ? ` (${AI_DRAFT_BY}, unreviewed)` : ''}`);
        if (hits.length) mo.note += ` Anatomy labels place this point in: ${[...new Set(hits)].slice(0, 3).join(', ')}.`;
      }
    }
    if (g.outcome === 'not_attempted' && (session.notAssessable || session.uncertain)) {
      g.outcome = g.authoritative ? 'incorrect' : 'self_review';
      g.messages.push('You reported this as uncertain or not assessable. The reference shows the target on this study — use the explanation to see why.');
    }
    setSubmittedMarks(frozen);
    setGrade(g);
    const next = { ...session, submitted: true };
    setSession(next);
    const attempt: Attempt = { ...buildAttempt(g, true), marks: frozen, position: { seriesUid: pp.seriesUid, sopInstanceUid: cp.sop, worldLps: cp.world }, independent: rules.independent(session) };
    try {
      await progress.saveAttempt(attempt);
    } catch (e) {
      toast.show((e as Error).message);
    }
    engine.setMarksVisible(true);
  };

  useEffect(() => {
    // Persist self-review verdicts on the submitted attempt.
    if (!grade || !session?.submitted || mode === 'review' || !selfReview) return;
    void progress.saveAttempt({ ...buildAttempt(grade, true), marks: submittedMarks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfReview]);

  const onHint = (level: number) => {
    if (!task || !session) return;
    const h = hintLadder(task).find((x) => x.level === level);
    update({ hintsOpened: [...new Set([...session.hintsOpened, level])], revealed: session.revealed || h?.action?.type === 'reveal' });
    const a = h?.action;
    if (!a) return;
    if (a.type === 'showRegion') setHighlight(new Set(a.targetIds));
    if (a.type === 'setWindow') {
      const s = catalog?.series.get(panels[0].seriesUid);
      const w = s?.windowPresets.find((x) => x.label === a.preset);
      if (w) engine.setWindow(focused, w.center, w.width);
    }
    if (a.type === 'jumpToTarget' || a.type === 'jumpSliceInterval') void jumpToTarget(a.targetId);
    if (a.type === 'open3D') applyLayout('mpr3d');
    if (a.type === 'reveal') setRefToggle(true);
  };

  const jumpToTarget = async (targetId: string) => {
    const t = targets.get(targetId);
    if (t) jumpToLoaded(t);
  };

  /** Show a loaded target; returns false while its series is not yet on screen and ready (caller may retry). */
  const jumpToLoaded = (t: LoadedTarget): boolean => {
    if (!catalog) return false;
    const idx = catalog.seriesIndex(t.ref.seriesUid);
    const pid = panels.find((p) => p.seriesUid === t.ref.seriesUid)?.id;
    if (!pid || !idx) return false;
    const ready = engine.panelState(pid);
    if (!ready || ready.seriesUid !== t.ref.seriesUid || !ready.ready) return false;
    const g = t.geom;
    let sop: string | null = null;
    let centre: { px?: Vec2; world?: Vec3 } | null = null;
    if (g.geometryType === 'contour_set' && g.planes.length) {
      // Go to the slice where the structure is largest, and centre on its biggest outline there.
      let bestArea = -1;
      for (const pl of g.planes) {
        const inst = idx.bySop.get(pl.sopInstanceUid);
        for (const poly of pl.polygons) {
          const pts2: Vec2[] =
            g.space === 'image_px' ? (poly as Vec2[]) : inst?.plane ? (poly as Vec3[]).map((q) => patientToPlaneMm(inst.plane!, q)) : [];
          if (pts2.length < 3) continue;
          const a = polygonArea(pts2);
          if (a > bestArea) {
            bestArea = a;
            sop = pl.sopInstanceUid;
            centre = g.space === 'image_px' ? { px: polygonCentroid(poly as Vec2[]) } : { world: centroid3(poly as Vec3[]) };
          }
        }
      }
    }
    if (g.geometryType === 'box' && g.boxes.length) sop = g.boxes[0].sopInstanceUid;
    if (g.geometryType === 'point') sop = g.sopInstanceUid;
    if (g.geometryType === 'slice_interval') sop = g.sopInstanceUids[Math.floor(g.sopInstanceUids.length / 2)] ?? null;
    const src = catalog.seriesSource(t.ref.seriesUid);
    const imageId = sop && src ? src.imageIds[src.sopUids.indexOf(sop)] : null;
    let world: Vec3 | null = centre?.world ?? null;
    // From the slice geometry in the manifest, so it works before the image itself has loaded
    // (falling back to the image origin would centre the view on its top-left corner).
    const plane = sop ? idx.bySop.get(sop)?.plane : undefined;
    if (!world && centre?.px && plane) world = imageToPatient(plane, centre.px);
    if (!world && centre?.px && imageId) world = engine.imagePxToWorld(imageId, centre.px);
    const st = engine.panelState(pid);
    if (st?.kind === 'stack' && sop) {
      const i = src?.sopUids.indexOf(sop) ?? -1;
      if (i >= 0) engine.setIndex(pid, i);
      if (world) {
        const w = world;
        setTimeout(() => engine.centerOn(pid, w), 120);
      }
    } else if (world) engine.jumpToWorld(pid, world);
    return true;
  };
  const jumpRef = useRef(jumpToLoaded);
  jumpRef.current = jumpToLoaded;
  /** Retry until the target's series is mounted (e.g. after switching a panel to it), for up to ~4 s. */
  const jumpWhenReady = (t: LoadedTarget, tries = 26) => {
    if (!jumpRef.current(t) && tries > 0) setTimeout(() => jumpWhenReady(t, tries - 1), 150);
  };

  const sameSkillDifferentPatient = useMemo(() => {
    if (!catalog || !task || !kase) return null;
    const here = catalog.holdoutGroup(kase.id);
    const tried = new Set(attempts.map((a) => a.taskId));
    // "Same skill" = same structure class, or a shared curriculum objective, or (for target-free
    // tasks) the same task type and primary skill. Different holdout group = different patient.
    const classes = new Set(task.targets.map((x) => catalog.targets.get(x.targetId)?.classId).filter(Boolean));
    const cands = [...catalog.tasks.values()].filter((t) => {
      if (catalog.holdoutGroup(t.caseId) === here || !t.modes.includes('practice')) return false;
      const theirClasses = t.targets.map((x) => catalog.targets.get(x.targetId)?.classId);
      if (classes.size && theirClasses.some((c) => c && classes.has(c))) return true;
      if (t.objectiveIds.some((o) => task.objectiveIds.includes(o))) return true;
      return !task.targets.length && !t.targets.length && t.type === task.type && t.skillDimensions[0] === task.skillDimensions[0];
    });
    return cands.sort((a, b) => Number(tried.has(a.id)) - Number(tried.has(b.id)))[0] ?? null;
  }, [catalog, task, kase, attempts]);

  const goTask = (t: Task, m: Mode = mode === 'learn' || mode === 'review' ? 'practice' : mode) => navigate(`/read/${t.caseId}?task=${encodeURIComponent(t.id)}&mode=${m}`);

  const openBook = (a: BookAnchorRef) => {
    const snap = engine.snapshot(focused);
    if (snap) setReturnSnap(snap);
    setBookAnchor(a);
    setTab('book');
    setRightOpen(true);
  };

  // 3D quiz answers count towards the structure's spaced-repetition drill box (saved one after another).
  const drillChain = useRef<Promise<unknown>>(Promise.resolve());
  const onAnswer3d = (t: LoadedTarget, correct: boolean) => {
    if (!kase || !catalog) return;
    const key = canonicalAnatomyKey(t.ref.classId);
    const cand: DrillCandidate = {
      caseId: kase.id,
      targetId: t.ref.id,
      seriesUid: t.ref.seriesUid,
      key,
      base: structureBase(key),
      name: plainName(t.ref.label),
      family: imageFamily(catalog.series.get(t.ref.seriesUid)?.modality ?? ''),
      provenance: t.ref.provenance,
      category: categoryFor(t.ref),
    };
    drillChain.current = drillChain.current
      .then(async () => progress.saveDrillStats(recordAnswer(await progress.drillStats(), cand, correct)))
      .catch((e) => toast.show(String(e?.message ?? e)));
  };

  const addBookmark = async () => {
    const snap = engine.snapshot(focused);
    if (!snap || !kase) return;
    const st = engine.panelState(focused);
    await progress.saveBookmark({ id: newId(), caseId: kase.id, label: `${catalog?.series.get(snap.seriesUid)?.description ?? 'View'} · image ${(st?.index ?? 0) + 1}`, createdAt: new Date().toISOString(), snapshot: snap });
    toast.show('Bookmark saved (series, slice, camera and window).');
  };

  // The focused view as a PNG for notes, credited to its image source (never while an Assess answer is open:
  // the dataset name can hint at the diagnosis).
  const saveImage = async () => {
    const pd = panels.find((x) => x.id === focused);
    const s = pd ? catalog?.series.get(pd.seriesUid) : undefined;
    const el = document.querySelector<HTMLElement>(`[data-panel="${focused}"]`);
    const st = engine.panelState(focused);
    if (!el || !s || !kase || !catalog) return;
    const subject = catalog.subjects.get(kase.subjectKey);
    const src = catalog.packs.find((x) => x.id === kase.packId)?.manifest.sources.find((x) => x.id === subject?.sourceId);
    const where = st && st.kind !== '3d' ? `image ${st.index + 1}/${st.count}` : '3D';
    const blob = await viewToPng(el, [
      [kase.neutralTitle, `${s.modality} ${s.description ?? ''}`.trim(), where].filter(Boolean).join(' · '),
      [src ? `Source: ${src.name} (${shortLicense(src.license)})` : '', 'radiology.monster'].filter(Boolean).join(' · '),
    ]);
    if (!blob) {
      toast.show('This view could not be saved as an image.');
      return;
    }
    downloadBlob(blob, `${slug(kase.neutralTitle)}-${slug(s.description || s.modality)}-${st && st.kind !== '3d' ? st.index + 1 : '3d'}.png`);
    toast.show('Image saved, with the outlines and the image source.');
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt?.closest?.('input, textarea, select, [contenteditable]') || labelReq) return;
      const k = e.key;
      const tools: Record<string, ToolId> = { w: 'windowLevel', p: 'pan', z: 'zoom', s: 'scroll', m: 'point', a: 'arrow', b: 'box', o: 'outline', l: 'length', g: 'angle', e: 'eraser', x: 'crosshairs', q: 'magnify' };
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') {
        e.preventDefault();
        engine.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'Enter') {
        e.preventDefault();
        void submit();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'ArrowUp' || k === 'ArrowLeft') {
        e.preventDefault();
        engine.scroll(focused, -1);
      } else if (k === 'ArrowDown' || k === 'ArrowRight') {
        e.preventDefault();
        engine.scroll(focused, 1);
      } else if (k === 'PageUp') {
        e.preventDefault();
        engine.scroll(focused, -5);
      } else if (k === 'PageDown') {
        e.preventDefault();
        engine.scroll(focused, 5);
      } else if (k === 'Home') engine.setIndex(focused, 0);
      else if (k === 'End') engine.setIndex(focused, 100000);
      else if (tools[k.toLowerCase()]) {
        const tool = tools[k.toLowerCase()];
        // Marking tools are locked once the answer is submitted (the reference is visible then).
        if (MARK_TOOLS.has(tool) && session && !rules.canEditMarks(session)) return;
        engine.setTool(tool);
      }
      else if (k === 'k') engine.setLinked(!engine.isLinked);
      else if (k === ' ') {
        e.preventDefault();
        engine.togglePlay(focused);
      }
      else if (k === 'r') engine.reset(focused);
      else if (k === 'i') engine.invert(focused);
      else if (k === 'f') toggleFullscreen();
      else if (k === 'v' && refAllowed) {
        setAnatomyOn(true);
        toggleFill();
      } else if (k === 'n' && anatomyVisible) setAnatomyNames((v) => !v);
      else if (k === '?') setHelpOpen(true);
      else if (k === '[') setLeftOpen((v) => !v);
      else if (k === ']') setRightOpen((v) => !v);
      else if (k === 'h' && session && rules.hintsAllowed(session) && !session.submitted && task) {
        const next = hintLadder(task).find((x) => !session.hintsOpened.includes(x.level));
        if (next && next.action?.type !== 'reveal') onHint(next.level);
      } else if (/^[1-6]$/.test(k)) {
        const p = panels.find((x) => x.id === focused);
        const s = p ? catalog?.series.get(p.seriesUid) : null;
        const w = s?.windowPresets[Number(k) - 1];
        if (w) engine.setWindow(focused, w.center, w.width);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Deep link from the Anatomy atlas: ?mode=learn&show=<targetId> opens the case with that structure shown alone.
  const showId = sp.get('show');
  const shownRef = useRef<string | null>(null);
  const isolateRef = useRef<(t: LoadedTarget) => void>(() => {});
  useEffect(() => {
    if (!showId || shownRef.current === showId || !panels.length) return;
    const t = anatomyTargets.find((x) => x.ref.id === showId);
    if (t) {
      shownRef.current = showId;
      setTab('anatomy');
      setTimeout(() => isolateRef.current(t), 150);
      return;
    }
    // A finding (from the condition search): open its series at the finding, with its outline highlighted.
    const f = targets.get(showId);
    if (!f || !f.ref.classId.startsWith('finding:')) return; // anatomy waits for the anatomy layer (shown alone there)
    shownRef.current = showId;
    if (!panels.some((p) => p.seriesUid === f.ref.seriesUid)) pickSeries(panels[0].id, f.ref.seriesUid);
    setHighlight(new Set([showId]));
    setTimeout(() => jumpWhenReady(f), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId, anatomyTargets, targets, panels.length]);

  // ---------------------------------------------------------------- coach + comparison patient
  const focusedUid = (panels.find((p) => p.id === focused) ?? panels[0])?.seriesUid ?? null;
  const focusedKeys = useMemo(
    () => new Set(catalog && focusedUid ? catalog.anatomyTargetsForSeries([focusedUid]).map((id) => canonicalAnatomyKey(catalog.targets.get(id)!.classId)) : []),
    [catalog, focusedUid],
  );

  // A coach step asked to show its structures: wait for the anatomy layer, then show them together at the level where most appear.
  useEffect(() => {
    if (!pendingStep?.show || anatomyLoading || !anatomyTargets.length || !catalog) return;
    const step = pendingStep;
    setPendingStep(null);
    const ts = anatomyTargets.filter((t) => t.ref.seriesUid === focusedUid && step.show!.test(canonicalAnatomyKey(t.ref.classId)));
    if (!ts.length) {
      toast.show('No labelled structures for this step on this series.');
      return;
    }
    setIsolateId(null);
    setAnatomyHighlight(null);
    setFocusSet({ ids: new Set(ts.map((t) => t.ref.id)), label: step.title, step: step.id });
    const count = new Map<string, number>();
    for (const t of ts) if (t.geom.geometryType === 'contour_set') for (const pl of t.geom.planes) count.set(pl.sopInstanceUid, (count.get(pl.sopInstanceUid) ?? 0) + 1);
    const sop = levelSop(step, anatomyTargets.filter((t) => t.ref.seriesUid === focusedUid), focusedUid ? catalog.seriesIndex(focusedUid) : undefined) ?? [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const src = focusedUid ? catalog.seriesSource(focusedUid) : null;
    const i = sop && src ? src.sopUids.indexOf(sop) : -1;
    if (i >= 0 && engine.panelState(focused)?.kind === 'stack') engine.setIndex(focused, i);
  }, [pendingStep, anatomyLoading, anatomyTargets, catalog, focusedUid, focused, engine, toast]);

  // Comparison patient: load its labels and pair landmarks with the primary scan.
  const primaryUid = panels[0]?.seriesUid ?? null;
  useEffect(() => {
    if (!compare || !catalog || !primaryUid) {
      setCompareTargets([]);
      setSyncPairs([]);
      return;
    }
    let cancelled = false;
    Promise.all([catalog.loadTargets(catalog.anatomyTargetsForSeries([primaryUid])), catalog.loadTargets(catalog.anatomyTargetsForSeries([compare.seriesUid]))]).then(([a, b]) => {
      if (cancelled) return;
      const la = landmarks([...a.values()], catalog.seriesIndex(primaryUid));
      const lb = landmarks([...b.values()], catalog.seriesIndex(compare.seriesUid));
      setMarksA(la);
      setSyncPairs(matchLevels(la, lb));
      setCompareTargets([...b.values()]);
    });
    return () => {
      cancelled = true;
    };
  }, [compare, catalog, primaryUid]);

  // Keep the comparison patient at the same anatomical level as the primary scan.
  // Keyed on the displayed image, not the index: a panel that is still loading also reports index 0.
  const p0Image = engine.panelState('p0')?.currentImageId;
  const p1Ready = engine.panelState('p1')?.ready;
  const levelZ = useMemo(() => {
    const sop = p0Image ? engine.imageIdInfo(p0Image)?.sop : null;
    return sop && primaryUid ? (catalog?.seriesIndex(primaryUid)?.bySop.get(sop)?.plane?.ipp[2] ?? null) : null;
  }, [p0Image, primaryUid, catalog, engine]);
  useEffect(() => {
    if (!compare || !syncPairs.length || !p1Ready || levelZ === null || !catalog) return;
    const zb = mapZ(levelZ, syncPairs);
    const idxB = catalog.seriesIndex(compare.seriesUid);
    const srcB = catalog.seriesSource(compare.seriesUid);
    if (zb === null || !idxB || !srcB) return;
    let best = -1;
    let bd = Infinity;
    for (const inst of idxB.instances) {
      const z = inst.plane?.ipp[2];
      if (z === undefined || Math.abs(z - zb) >= bd) continue;
      bd = Math.abs(z - zb);
      best = srcB.sopUids.indexOf(inst.sopInstanceUid);
    }
    if (best >= 0 && engine.panelState('p1')?.index !== best) engine.setIndex('p1', best);
  }, [compare, syncPairs, p1Ready, levelZ, catalog, engine]);

  const toggleFullscreen = () => {
    const el = document.querySelector('.ws-main') as HTMLElement | null;
    if (!document.fullscreenElement) void el?.requestFullscreen?.();
    else void document.exitFullscreen();
  };

  // ---------------------------------------------------------------- render
  // 3D models: the anatomy layer plus the outlined findings of the case (a PE clot, nodules, metastases).
  const targets3d = useMemo(
    () => [...anatomyTargets, ...[...targets.values()].filter((t) => t.ref.classId.startsWith('finding:') && t.geom.geometryType === 'contour_set')],
    [anatomyTargets, targets],
  );
  if (!catalog) return <div className="vp-status">Loading case catalogue…</div>;
  if (!kase || !task || !session) {
    return (
      <div className="page-inner stack">
        <h1>Case not available</h1>
        <p className="muted">{kase ? 'This case has no tasks for the selected mode.' : 'This case is not in the installed packs (it may need its data pack fetched).'}</p>
        <Link className="btn" to="/cases">
          Browse cases
        </Link>
      </div>
    );
  }

  const tool = engine.getTool();
  const big = bigPanel && panels.some((x) => x.id === bigPanel) ? bigPanel : null;
  const focusedKind = panels.find((x) => x.id === focused)?.kind ?? null;
  const focusedPanel = panels.find((p) => p.id === focused) ?? panels[0];
  const focusedSeries = focusedPanel ? catalog.series.get(focusedPanel.seriesUid) : undefined;
  const assessMasked = mode === 'assess' && !session.submitted;
  const title = assessMasked ? kase.neutralTitle : mode === 'learn' || session.submitted ? kase.learnTitle : kase.neutralTitle;
  const study0 = catalog.studies.get(caseSeries[0]?.studyUid ?? '');
  const anchorLabel = (a: BookAnchorRef) => (curriculum ? fmtAnchor(curriculum, a) : `PDF ${a.physical}`);
  const st0 = engine.panelState(focused);
  const currentSliceLabel = st0 ? `image ${st0.index + 1} of ${st0.count}` : null;
  const taskRefs = task.targets.map((t) => targets.get(t.targetId)?.ref).filter((r): r is NonNullable<typeof r> => !!r);
  const scoringLabel: { text: string; tone: 'ok' | 'warn' | 'accent'; title: string } =
    task.scoring !== 'authoritative' || task.grading.kind === 'self_review'
      ? { text: 'Exploratory · self-review', tone: 'warn', title: 'Compared with a checklist or reference, not automatically scored.' }
      : task.grading.kind === 'choice'
        ? { text: 'Auto-checked answer', tone: 'ok', title: 'Fixed answer key written for this task.' }
        : taskRefs.length && taskRefs.every((r) => r.provenance === 'source_manual')
          ? { text: 'Scored vs source reference', tone: 'ok', title: 'Deterministic geometry against source-provided manual annotations.' }
          : taskRefs.some((r) => r.provenance === 'human_reviewed') && taskRefs.every((r) => r.provenance === 'source_manual' || r.provenance === 'human_reviewed')
            ? { text: 'Scored vs your reviewed reference', tone: 'accent', title: 'Includes references you reviewed in Author.' }
            : { text: 'Draft reference · self-review', tone: 'warn', title: `Unreviewed references (${AI_DRAFT_BY} or dataset auto-labels): comparison only until you review them.` };
  const independentNote = rules.independent(session) ? 'Counts as an independent attempt (no hints or reveal so far).' : 'This attempt is recorded as assisted.';
  const relNote = (p: PanelDef) => {
    if (compare && p.id === 'p1' && p.seriesUid === compare.seriesUid) {
      const lvl = levelZ !== null ? levelName(levelZ, marksA) : null;
      const how = syncPairs.length ? `level-matched by ${syncPairs.length} labelled structures${lvl ? ` · ≈ ${lvl}` : ''}` : 'not level-matched (scroll it yourself)';
      return `Different patient ${compare.rank + 1}/${compare.total}${compare.noFindings ? ' · no findings annotated' : ' · has annotated findings'} · ${how}`;
    }
    if (p.id === panels[0]?.id || panels.length < 2) return null;
    const r = catalog.relationship(panels[0].seriesUid, p.seriesUid);
    if (p.seriesUid === panels[0].seriesUid) return p.kind === '3d' ? 'Same volume · 3D rendering' : 'Same volume · shared patient-space crosshair';
    if (r.kind === 'same_volume' || r.kind === 'common_frame') return 'Same frame of reference';
    if (r.kind === 'registered') return 'Registered volumes';
    const a = catalog.studies.get(catalog.series.get(panels[0].seriesUid)!.studyUid);
    const b = catalog.studies.get(catalog.series.get(p.seriesUid)!.studyUid);
    // Only the pack's verified relative interval is trusted; raw de-identified dates can be placeholders.
    const interval =
      a && b && a.uid !== b.uid
        ? a.relativeDays !== null && b.relativeDays !== null
          ? a.relativeDays === b.relativeDays
            ? 'same day'
            : `${Math.abs(b.relativeDays - a.relativeDays)} days apart`
          : 'interval unknown'
        : 'same study';
    return `Same patient · separate acquisition (${interval}) · independent controls`;
  };

  const focusedSeriesUid = (panels.find((p) => p.id === focused) ?? panels[0])?.seriesUid;
  const allAnatomy = compareTargets.length ? [...anatomyTargets, ...compareTargets] : anatomyTargets;
  const focusedAnatomy = allAnatomy
    .filter((t) => t.ref.seriesUid === focusedSeriesUid)
    .sort((a, b) => a.ref.label.localeCompare(b.ref.label));
  const isolateTarget = isolateId ? (allAnatomy.find((t) => t.ref.id === isolateId) ?? null) : null;
  const isolate = (t: LoadedTarget) => {
    setAnatomyOn(true);
    setFocusSet(null);
    setIsolateId(t.ref.id);
    setAnatomyHighlight(t.ref.id);
    if (!panels.some((p) => p.seriesUid === t.ref.seriesUid)) pickSeries(focused, t.ref.seriesUid);
    setTimeout(() => jumpWhenReady(t), 60);
  };
  isolateRef.current = isolate;
  const stepIsolate = (dir: 1 | -1) => {
    if (!focusedAnatomy.length) return;
    const i = focusedAnatomy.findIndex((t) => t.ref.id === isolateId);
    isolate(focusedAnatomy[(i + dir + focusedAnatomy.length) % focusedAnatomy.length]);
  };
  const anatomyProps = {
    on: anatomyVisible,
    targets: anatomyTargets,
    showNames: anatomyNames,
    hidden: anatomyHidden,
    highlightId: anatomyHighlight,
    isolateId: anatomyVisible && !focusSet ? isolateId : null,
    isolateSet: anatomyVisible ? (focusSet?.ids ?? null) : null,
    isolateLabel: focusSet?.label ?? isolateTarget?.ref.label,
    onIsolateStep: stepIsolate,
    onIsolateGoTo: () => isolateTarget && jumpToLoaded(isolateTarget),
    onIsolateClear: () => {
      setIsolateId(null);
      setFocusSet(null);
      setAnatomyHighlight(null);
    },
  };
  // The comparison patient shows the same structures (matched by name) as the primary scan.
  const keyOf = new Map(allAnatomy.map((t) => [t.ref.id, canonicalAnatomyKey(t.ref.classId)]));
  const compareByKey = new Map(compareTargets.map((t) => [canonicalAnatomyKey(t.ref.classId), t.ref.id]));
  const anatomyFor = (pd: PanelDef) => {
    if (!compare || pd.seriesUid !== compare.seriesUid) return anatomyProps;
    const asSet = anatomyProps.isolateSet ?? (anatomyProps.isolateId ? new Set([anatomyProps.isolateId]) : null);
    const mapped = asSet
      ? new Set([...asSet].map((id) => (compareTargets.some((t) => t.ref.id === id) ? id : compareByKey.get(keyOf.get(id) ?? ''))).filter((x): x is string => !!x))
      : null;
    return { ...anatomyProps, targets: compareTargets, isolateId: null, isolateSet: mapped, onIsolateStep: undefined, onIsolateGoTo: undefined };
  };

  const compareCandidates = () => {
    const primary = panels[0]?.seriesUid;
    const sA = primary ? catalog.series.get(primary) : undefined;
    if (!sA) return [];
    const fam = imageFamily(sA.modality);
    const keysOf = (uid: string) => new Set(catalog.anatomyTargetsForSeries([uid]).map((id) => canonicalAnatomyKey(catalog.targets.get(id)!.classId)));
    const keysA = keysOf(sA.uid);
    const lateral = (v: unknown) => /^(L|R)L$|LAT/i.test(String(v ?? ''));
    const withFindings = new Set([...catalog.targets.values()].filter((t) => t.classId.startsWith('finding:')).map((t) => t.seriesUid));
    const here = catalog.holdoutGroup(kase.id);
    const out: Array<{ caseId: string; seriesUid: string; noFindings: boolean; score: number }> = [];
    const seen = new Set<string>();
    for (const k of catalog.cases.values()) {
      if (catalog.holdoutGroup(k.id) === here) continue;
      for (const sB of catalog.seriesForCase(k)) {
        if (seen.has(sB.uid) || imageFamily(sB.modality) !== fam || sB.role === 'scout' || !catalog.seriesSource(sB.uid)) continue;
        seen.add(sB.uid);
        if (fam === 'XR' && lateral(sA.acquisition.ViewPosition) !== lateral(sB.acquisition.ViewPosition)) continue;
        const common = [...keysOf(sB.uid)].filter((x) => keysA.has(x)).length;
        if (fam !== 'XR' && common < 3) continue;
        const noFindings = !withFindings.has(sB.uid);
        out.push({ caseId: k.id, seriesUid: sB.uid, noFindings, score: common + (noFindings ? 25 : 0) });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 10);
  };
  const startCompare = (rank: number) => {
    const list = compareCandidates();
    const primary = panels[0]?.seriesUid;
    if (!list.length || !primary) {
      toast.show('No other patient with a comparable scan is installed for this kind of image.');
      return;
    }
    const c = list[rank % list.length];
    setLayout('2');
    setBigPanel(null);
    setPanels([
      { id: 'p0', seriesUid: primary, kind: 'stack' },
      { id: 'p1', seriesUid: c.seriesUid, kind: 'stack' },
    ]);
    setFocused('p0');
    setCompare({ rank: rank % list.length, total: list.length, caseId: c.caseId, seriesUid: c.seriesUid, noFindings: c.noFindings });
  };
  const coachWindow = (step: CoachStep) => {
    if (!step.window || focusedSeries?.modality !== 'CT') return;
    const chest = [...focusedKeys].some((k) => /^lung|^trachea/.test(k));
    const w = presetFor(focusedSeries.windowPresets, step.window, chest);
    if (w) engine.setWindow(focused, w.center, w.width);
  };
  const focusedImageId = engine.panelState(focused)?.currentImageId ?? null;
  const focusedSop = focusedImageId ? (engine.imageIdInfo(focusedImageId)?.sop ?? null) : null;
  const presentIds = new Set(
    anatomyTargets.filter((t) => t.geom.geometryType === 'contour_set' && focusedSop && t.geom.planes.some((pl) => pl.sopInstanceUid === focusedSop)).map((t) => t.ref.id),
  );

  return (
    <div className="ws">
      {/* ------------------------------------------------ toolbar */}
      <div className="ws-bar" role="toolbar" aria-label="Viewer tools">
        <IconButton label="Back to cases" onClick={() => navigate('/cases')}>
          <ArrowLeft size={17} />
        </IconButton>
        <IconButton label="Case navigator" shortcut="[" active={leftOpen} onClick={() => setLeftOpen((v) => !v)}>
          <PanelLeft size={17} />
        </IconButton>
        <div className="ws-title">
          <strong>{title}</strong>
          <span>{study0?.description ?? ''}</span>
        </div>
        {shiftItem ? (
          <span className="chip accent" title="On-call shift: unknown cases, no hints until you submit">
            On call · {shiftIndex + 1}/{shift!.items.length}
          </span>
        ) : null}
        {shiftItem && session.submitted ? (
          <button className="btn sm primary" onClick={goNextInShift}>
            {nextInShift >= 0 ? 'Next case →' : 'End shift: see the report'}
          </button>
        ) : null}
        <div className="mode-switch" role="group" aria-label="Mode" style={shiftItem && !session.submitted ? { display: 'none' } : undefined}>
          {MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setSp({ task: task.id, mode: m })}>
              {label}
            </button>
          ))}
        </div>
        <span className="sep" />
        <IconButton label="Window / level" shortcut="W" active={tool === 'windowLevel'} onClick={() => engine.setTool('windowLevel')}>
          <SunMoon size={17} />
        </IconButton>
        <IconButton label="Pan" shortcut="P" active={tool === 'pan'} onClick={() => engine.setTool('pan')}>
          <Move size={17} />
        </IconButton>
        <IconButton label="Zoom" shortcut="Z" active={tool === 'zoom'} onClick={() => engine.setTool('zoom')}>
          <ZoomIn size={17} />
        </IconButton>
        <IconButton label="Scroll slices (drag)" shortcut="S" active={tool === 'scroll'} onClick={() => engine.setTool('scroll')}>
          <ScanLine size={17} />
        </IconButton>
        <IconButton label="Magnifier: hold the mouse button over fine detail (radiographs, mammograms, ultrasound)" shortcut="Q" active={tool === 'magnify'} onClick={() => engine.setTool('magnify')}>
          <SearchIcon size={17} />
        </IconButton>
        <span className="sep" />
        <IconButton label="Point mark" shortcut="M" active={tool === 'point'} onClick={() => engine.setTool('point')} disabled={!rules.canEditMarks(session)}>
          <MapPin size={17} />
        </IconButton>
        <IconButton label="Arrow + label" shortcut="A" active={tool === 'arrow'} onClick={() => engine.setTool('arrow')} disabled={!rules.canEditMarks(session)}>
          <ArrowUpRight size={17} />
        </IconButton>
        <IconButton label="Box" shortcut="B" active={tool === 'box'} onClick={() => engine.setTool('box')} disabled={!rules.canEditMarks(session)}>
          <Square size={17} />
        </IconButton>
        <IconButton label="Freehand outline" shortcut="O" active={tool === 'outline'} onClick={() => engine.setTool('outline')} disabled={!rules.canEditMarks(session)}>
          <PenLine size={17} />
        </IconButton>
        <span className="sep hide-sm" />
        <span className="hide-sm row" style={{ gap: 2 }}>
          <IconButton label="Length (calibrated images only)" shortcut="L" active={tool === 'length'} onClick={() => engine.setTool('length')}>
            <Ruler size={17} />
          </IconButton>
          <IconButton label="Angle" shortcut="G" active={tool === 'angle'} onClick={() => engine.setTool('angle')}>
            <Triangle size={17} />
          </IconButton>
          <IconButton label="Ellipse ROI statistics" active={tool === 'ellipse'} onClick={() => engine.setTool('ellipse')}>
            <Circle size={17} />
          </IconButton>
          <IconButton label="Eraser" shortcut="E" active={tool === 'eraser'} onClick={() => engine.setTool('eraser')}>
            <Eraser size={17} />
          </IconButton>
          <IconButton label="Undo" shortcut="Ctrl+Z" onClick={() => engine.undo()}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton label="Redo" shortcut="Ctrl+Y" onClick={() => engine.redo()}>
            <Redo2 size={17} />
          </IconButton>
        </span>
        <span className="sep" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="btn sm" aria-label="Window presets">
              <Contrast size={14} /> Window <ChevronDown size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="popover" sideOffset={6}>
              {(focusedSeries?.windowPresets ?? []).map((w, i) => (
                <DropdownMenu.Item key={w.label} className="menu-item" onSelect={() => engine.setWindow(focused, w.center, w.width)}>
                  <span className="kbd">{i + 1}</span> {w.label}
                  <span className="faint mono" style={{ marginLeft: 'auto' }}>
                    {w.width}/{w.center}
                  </span>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Item className="menu-item" onSelect={() => engine.invert(focused)}>
                <span className="kbd">I</span> Invert
              </DropdownMenu.Item>
              {focusedSeries?.modality === 'CT' ? null : (
                <div className="faint" style={{ fontSize: 11, padding: '4px 8px', maxWidth: 240 }}>
                  {focusedSeries?.modality === 'MR'
                    ? 'MR signal is arbitrary units — there are no Hounsfield presets.'
                    : focusedSeries?.modality === 'US'
                      ? 'Ultrasound brightness is echogenicity (how strongly tissue reflects sound), not a calibrated value.'
                      : focusedSeries?.modality === 'MG'
                        ? 'Mammogram pixel values are not HU; use the magnifier (Q) for calcifications.'
                        : 'Radiograph pixel values are not HU.'}
                </div>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <IconButton label="Reset view" shortcut="R" onClick={() => engine.reset(focused)}>
          <RotateCcw size={17} />
        </IconButton>
        {focusedKind !== '3d' ? (
          <IconButton label={engine.isPlaying(focused) ? 'Stop the cine loop' : 'Play the slices as a cine loop'} shortcut="Space" active={engine.isPlaying(focused)} onClick={() => engine.togglePlay(focused)}>
            {engine.isPlaying(focused) ? <Pause size={17} /> : <Play size={17} />}
          </IconButton>
        ) : null}
        <span className="sep" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="btn sm" aria-label="Layout" title="Layout">
              {LAYOUTS.find(([l]) => l === layout)?.[2]} <ChevronDown size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="popover" sideOffset={6}>
              {LAYOUTS.filter(([l]) => l !== 'mg' || mgSeries.length >= 2).map(([l, label, icon]) => (
                <DropdownMenu.Item key={l} className="menu-item" onSelect={() => applyLayout(l)}>
                  {icon} {label}
                  {layout === l ? <span style={{ marginLeft: 'auto', paddingLeft: 10 }}>✓</span> : null}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <IconButton
          label={compare ? 'Stop comparing with another patient' : 'Compare with another patient at the same level'}
          active={!!compare}
          disabled={mode === 'assess' && !session.submitted}
          onClick={() => (compare ? applyLayout('1') : startCompare(0))}
        >
          <Users size={17} />
        </IconButton>
        {compare && compare.total > 1 ? (
          <IconButton label="Next comparison patient" onClick={() => startCompare(compare.rank + 1)}>
            <SkipForward size={17} />
          </IconButton>
        ) : null}
        {layout === 'mpr' || layout === 'mpr3d' ? (
          <IconButton label="Crosshairs: click or drag to move all planes" shortcut="X" active={tool === 'crosshairs'} onClick={() => engine.setTool('crosshairs')}>
            <Crosshair size={17} />
          </IconButton>
        ) : null}
        {panels.length > 1 ? (
          <IconButton
            label={engine.isLinked ? 'Views linked: scrolling one moves the others, lines show where each view cuts; double-click a point to show it everywhere. Click to unlink.' : 'Views unlinked. Click to link them.'}
            shortcut="K"
            active={engine.isLinked}
            onClick={() => engine.setLinked(!engine.isLinked)}
          >
            {engine.isLinked ? <Link2 size={17} /> : <Link2Off size={17} />}
          </IconButton>
        ) : null}
        {panels.some((x) => x.kind === 'axial' || x.kind === 'coronal' || x.kind === 'sagittal') ? (
          <PlanesControl engine={engine} focused={focused} kind={focusedKind === 'axial' || focusedKind === 'coronal' || focusedKind === 'sagittal' ? focusedKind : null} />
        ) : null}
        {panels.length > 1 ? (
          <IconButton label={big ? 'Back to the grid' : 'Enlarge the selected view (the others stay live beside it)'} active={!!big} onClick={() => setBigPanel(big ? null : focused)}>
            {big ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </IconButton>
        ) : null}
        <span className="spacer" />
        {timeLeft !== null && !session.submitted ? (
          <span className={`chip ${timeLeft <= 0 ? 'bad' : 'warn'}`} aria-live="off">
            <Timer size={12} /> {timeLeft <= 0 ? 'over time' : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}
          </span>
        ) : null}
        {refAllowed ? (
          <IconButton label={refToggle ? 'Hide reference overlay' : 'Show reference overlay'} active={refToggle} onClick={() => setRefToggle((v) => !v)}>
            {refToggle ? <Eye size={17} /> : <EyeOff size={17} />}
          </IconButton>
        ) : null}
        {refAllowed && refToggle ? (
          <input type="range" min={0.2} max={1} step={0.1} value={refOpacity} onChange={(e) => setRefOpacity(Number(e.target.value))} aria-label="Reference opacity" style={{ width: 64 }} />
        ) : null}
        <IconButton
          label={refAllowed ? (anatomyVisible ? 'Hide anatomy labels' : 'Show all anatomy labels') : 'Anatomy labels: Learn mode or after submitting'}
          active={anatomyVisible}
          disabled={!refAllowed}
          onClick={() => {
            setAnatomyOn(!anatomyVisible);
            if (!anatomyVisible) setTab('anatomy');
          }}
        >
          <Layers size={17} />
        </IconButton>
        {refAllowed ? (
          <IconButton
            label={allFilled ? 'Outline the structures (no fill)' : 'Fill the structures with colour'}
            shortcut="V"
            active={allFilled && anatomyVisible}
            onClick={() => {
              setAnatomyOn(true);
              toggleFill();
            }}
          >
            <PaintBucket size={17} />
          </IconButton>
        ) : null}
        <IconButton label={assessMasked ? 'Save image (after you submit)' : 'Save this view as an image'} disabled={assessMasked} onClick={() => void saveImage()}>
          <ImageDown size={17} />
        </IconButton>
        <IconButton label="Bookmark this view" onClick={addBookmark}>
          <Bookmark size={17} />
        </IconButton>
        <IconButton label="Full screen" shortcut="F" onClick={toggleFullscreen}>
          <Expand size={17} />
        </IconButton>
        <IconButton label="Keyboard shortcuts" shortcut="?" onClick={() => setHelpOpen(true)}>
          <Keyboard size={17} />
        </IconButton>
        <IconButton label="Learning panel" shortcut="]" active={rightOpen} onClick={() => setRightOpen((v) => !v)}>
          <PanelRight size={17} />
        </IconButton>
      </div>

      {/* ------------------------------------------------ left navigator */}
      <aside className={`ws-left${leftOpen ? '' : ' collapsed'}`} aria-label="Case navigator">
        <div className="side-section">
          <h3>Studies &amp; series</h3>
          {kase.studyUids.map((stUid) => {
            const st = catalog.studies.get(stUid);
            if (!st) return null;
            return (
              <div key={stUid} className="stack" style={{ gap: 4, marginBottom: 10 }}>
                <div className="faint" style={{ fontSize: 11.5 }}>
                  {st.modalities.join('+')} · {st.date ?? 'date unknown'}
                  {st.dateShifted === 'yes' ? ' (shifted)' : ''}
                </div>
                {st.seriesUids.map((u) => {
                  const s = catalog.series.get(u);
                  if (!s) return null;
                  const thumb = catalog.thumbnailUrl(u);
                  return (
                    <button
                      key={u}
                      className="series-item"
                      aria-current={focusedPanel?.seriesUid === u}
                      onClick={() => pickSeries(focused, u)}
                      title="Show in the focused panel"
                    >
                      <span className="series-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} aria-hidden />
                      <span className="series-meta">
                        <strong>{s.description || `Series ${s.number ?? ''}`}</strong>
                        <span className="faint">
                          {s.modality} · {s.instances.length} {s.instances.length === 1 ? 'image' : 'images'}
                          {s.geometry.sliceSpacing ? ` · ${s.geometry.sliceSpacing.toFixed(1)} mm` : ''}
                        </span>
                        {s.role === 'scout' ? <span className="chip warn" style={{ marginTop: 3 }}>Scout</span> : null}
                        {s.geometry.volumeEligible ? <span className="chip" style={{ marginTop: 3 }}>MPR ready</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="side-section">
          <h3>Tasks on this study</h3>
          <div className="stack" style={{ gap: 4 }}>
            {availableTasks.map((t, i) => {
              const done = attempts.some((a) => a.taskId === t.id && a.submittedAt);
              return (
                <button key={t.id} className="series-item" style={{ gridTemplateColumns: '18px 1fr' }} aria-current={t.id === task.id} onClick={() => setSp({ task: t.id, mode })}>
                  <span className="faint">{done ? '✓' : i + 1}</span>
                  <span className="series-meta">
                    <strong>{mode === 'assess' && t.id !== task.id ? `Task ${i + 1}` : mode === 'assess' && !session.submitted ? `Task ${i + 1}` : t.title}</strong>
                    <span className="faint">{t.type.replace(/_/g, ' ')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------ viewports */}
      <section className="ws-main" aria-label="Image viewports">
        <div
          className={`vgrid ${layout === '1' ? 'l1' : layout === '2' ? 'l2' : layout === 'mpr' ? 'l3mpr' : layout === 'mpr3d' ? 'l4 mpr3d' : layout === 'mg' ? (panels.length > 2 ? 'l4' : 'l2') : 'l4'}${big ? ' big' : ''}`}
          style={big ? { gridTemplateRows: `repeat(${panels.length - 1}, 1fr)` } : undefined}
        >
          {panels.map((pd) => {
            const src = catalog.seriesSource(pd.seriesUid);
            const s = catalog.series.get(pd.seriesUid);
            if (!src || !s) return <div key={pd.id} className="vpanel"><div className="vp-status">Series unavailable.</div></div>;
            return (
              <ViewportPanel
                key={`${pd.id}-${pd.seriesUid}-${pd.kind}`}
                engine={engine}
                panelId={pd.id}
                source={src}
                series={s}
                seriesIndex={catalog.seriesIndex(pd.seriesUid)}
                kind={pd.kind}
                startIndex={startIndexFor(pd.seriesUid, task)}
                focused={focused === pd.id}
                big={big === pd.id}
                onFocus={() => setFocused(pd.id)}
                onImageDoubleClick={(c) => {
                  // Marking tools keep double-click for themselves.
                  if (tool === 'windowLevel' || tool === 'pan' || tool === 'zoom' || tool === 'scroll' || tool === 'crosshairs') engine.linkJump(pd.id, c);
                }}
                threeD={pd.kind === '3d' ? { allowed: refAllowed, loading: anatomyLoading, targets: targets3d, onAnswer: onAnswer3d } : undefined}
                overlay={{
                  // While one structure is isolated, nothing else is drawn on the image.
                  targets: anatomyProps.isolateId || anatomyProps.isolateSet ? [] : visibleTargets,
                  showReference: !anatomyProps.isolateId && !anatomyProps.isolateSet && visibleTargets.length > 0,
                  opacity: refOpacity,
                  highlightIds: highlight,
                  showLabels: refAllowed,
                  labelIds: refLabelIds,
                  badges,
                  anatomy: anatomyFor(pd),
                }}
                seriesOptions={layout === 'mpr' || layout === 'mpr3d' || (compare && pd.id === 'p1') ? [] : seriesOptions}
                onPickSeries={(u) => pickSeries(pd.id, u)}
                relationNote={relNote(pd)}
                assessMasked={assessMasked}
              />
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ right panel */}
      <aside className={`ws-right${rightOpen ? '' : ' collapsed'}`} aria-label="Learning panel">
        <Tabs.Root value={tab} onValueChange={setTab} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <Tabs.List className="tabs-list" aria-label="Learning panel tabs">
            <Tabs.Trigger value="task">Task</Tabs.Trigger>
            <Tabs.Trigger value="book">Book</Tabs.Trigger>
            <Tabs.Trigger value="anatomy">Anatomy</Tabs.Trigger>
            <Tabs.Trigger value="coach">Coach</Tabs.Trigger>
            <Tabs.Trigger value="info">Case</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="task" className="tab-body">
            <TaskPanel
              task={task}
              kase={kase}
              session={session}
              update={update}
              marks={session.submitted ? submittedMarks : marks}
              grade={grade}
              level={settings.level}
              activeTool={tool}
              currentSliceLabel={currentSliceLabel}
              anchorLabel={anchorLabel}
              onTool={(t) => engine.setTool(t)}
              onLabel={(id, l) => engine.setMarkLabel(id, l)}
              onRemoveMark={(id) => engine.removeMark(id)}
              onHint={onHint}
              onSubmit={submit}
              onOpenBook={openBook}
              onNextDifferentPatient={sameSkillDifferentPatient ? () => goTask(sameSkillDifferentPatient) : null}
              onRetry={() => {
                engine.clearMarks();
                setSession(newSession(task, mode === 'review' ? 'practice' : mode));
                setGrade(null);
                setSubmittedMarks([]);
                setSelfReview(null);
                setAttemptId(newId());
                setHighlight(new Set());
                if (mode === 'review') setSp({ task: task.id, mode: 'practice' });
                toast.show('New attempt on the same patient — it will be recorded, but it is not an unseen-patient test.');
              }}
              onNextTask={(() => {
                const i = availableTasks.findIndex((t) => t.id === task.id);
                const n = availableTasks[i + 1];
                return n ? () => setSp({ task: n.id, mode }) : null;
              })()}
              selfReview={selfReview}
              onSelfReview={setSelfReview}
              independentNote={independentNote}
              scoringLabel={scoringLabel}
            />
          </Tabs.Content>
          <Tabs.Content value="book" className="tab-body">
            <BookPanel
              curriculum={curriculum}
              anchor={bookAnchor ?? task.bookAnchors[0] ?? kase.bookAnchors[0] ?? null}
              locked={rules.bookAllowed(session) ? null : 'The book opens after you submit in Assess mode, so it cannot give the answer away.'}
              onReturnToScan={
                returnSnap
                  ? () => {
                      const target = panels.find((p) => p.seriesUid === returnSnap.seriesUid);
                      if (target) void engine.restore(target.id, returnSnap);
                      setTab('task');
                    }
                  : null
              }
            />
          </Tabs.Content>
          <Tabs.Content value="anatomy" className="tab-body">
            <AnatomyPanel
              allowed={refAllowed}
              on={anatomyVisible}
              loading={anatomyLoading}
              targets={focusedAnatomy}
              totalOnStudy={anatomyTargets.length}
              presentIds={presentIds}
              showNames={anatomyNames}
              hidden={anatomyHidden}
              isolateId={focusSet ? null : isolateId}
              family={imageFamily(focusedSeries?.modality ?? '')}
              onToggle={(v) => setAnatomyOn(v)}
              onShowNames={setAnatomyNames}
              onToggleGroup={(c) =>
                setAnatomyHidden((h) => {
                  const n = new Set(h);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
              onPick={isolate}
              onShowAll={() => {
                setIsolateId(null);
                setFocusSet(null);
                setAnatomyHighlight(null);
              }}
            />
          </Tabs.Content>
          <Tabs.Content value="coach" className="tab-body">
            <CoachPanel
              caseId={kase.id}
              family={imageFamily(focusedSeries?.modality ?? '')}
              keys={focusedKeys}
              canShow={refAllowed}
              canWindow={!assessMasked}
              activeStep={focusSet?.step ?? null}
              onShow={(step) => {
                setAnatomyOn(true);
                setPendingStep(step);
                if (step.window) coachWindow(step);
              }}
              onWindow={coachWindow}
              onBook={(page, unit) => openBook({ physical: page, printed: null, chapterId: unit })}
              onClear={() => {
                setFocusSet(null);
                setIsolateId(null);
              }}
            />
          </Tabs.Content>
          <Tabs.Content value="info" className="tab-body">
            <CaseInfo caseId={kase.id} assessMasked={assessMasked} targets={targets} onOpenBook={openBook} anchorLabel={anchorLabel} engine={engine} panels={panels} />
          </Tabs.Content>
        </Tabs.Root>
      </aside>

      {/* ------------------------------------------------ dialogs */}
      <Dialog.Root open={!!labelReq} onOpenChange={(o) => !o && (labelReq?.(''), setLabelReq(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby={undefined}>
            <Dialog.Title asChild>
              <h2>Name this arrow</h2>
            </Dialog.Title>
            <div className="row wrap" style={{ margin: '12px 0' }}>
              {(task.grading.kind === 'labelled_points' || task.grading.kind === 'point_in_target' ? task.targets.map((t) => t.name) : []).map((n) => (
                <button
                  key={n}
                  className="chip"
                  onClick={() => {
                    labelReq?.(n);
                    setLabelReq(null);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                labelReq?.(labelText);
                setLabelReq(null);
              }}
            >
              <input autoFocus type="text" value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Or type a label" style={{ flex: 1 }} aria-label="Arrow label" />
              <button className="btn primary" type="submit">
                Save
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby={undefined}>
            <Dialog.Title asChild>
              <h2>Keyboard &amp; mouse</h2>
            </Dialog.Title>
            <table className="table" style={{ marginTop: 12 }}>
              <tbody>
                {[
                  ['Mouse wheel / ↑ ↓', 'Previous / next slice'],
                  ['PgUp / PgDn, Home / End', 'Jump 5 slices, first / last'],
                  ['Right-drag', 'Zoom'],
                  ['Middle-drag', 'Pan'],
                  ['Shift + drag', 'Window/level while a marking tool is active'],
                  ['W P Z S', 'Window/level, Pan, Zoom, Scroll tool'],
                  ['M A B O', 'Point, Arrow+label, Box, Outline marks'],
                  ['L G E', 'Length, Angle, Eraser'],
                  ['1–6', 'Window presets for this series'],
                  ['I  R  F', 'Invert, Reset, Full screen'],
                  ['V  N', 'Filled or outlined structures, names on the image (Learn, Review, after submitting)'],
                  ['X', 'Crosshairs: click to move all MPR planes'],
                  ['K', 'Link / unlink views (scroll together, reference lines)'],
                  ['Space', 'Play / stop the slices as a cine loop'],
                  ['Q', 'Magnifier (hold over fine detail; not in MPR views)'],
                  ['Pinch / 3 fingers', 'Zoom / pan on a touch screen'],
                  ['Double-click', 'Show that point in every linked view'],
                  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
                  ['H', 'Next hint (Practice)'],
                  ['Ctrl+Enter', 'Submit'],
                  ['[  ]', 'Toggle navigator / learning panel'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <span className="kbd">{k}</span>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="spacer" />
              <Dialog.Close className="btn">Close</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Toast message={toast.msg} onDone={toast.clear} />
    </div>
  );
}

/**
 * The slice a coach step is about, from its anchor structure (e.g. the aortic arch's largest slice,
 * or just below the arch for the aortopulmonary window). Null when the anchor is not labelled.
 */
function levelSop(step: CoachStep, targets: LoadedTarget[], idx: SeriesIndex | undefined): string | null {
  for (const L of step.level ?? []) {
    const anchor = targets.find((t) => L.anchor.test(canonicalAnatomyKey(t.ref.classId)));
    const sop = anchor ? anchorSop(L, anchor, idx) : null;
    if (sop) return sop;
  }
  return null;
}

function anchorSop(L: NonNullable<CoachStep['level']>[number], anchor: LoadedTarget, idx: SeriesIndex | undefined): string | null {
  if (anchor.geom.geometryType !== 'contour_set' || !anchor.geom.planes.length || !idx) return null;
  const g = anchor.geom;
  if (L.at === 'largest') {
    let best: string | null = null;
    let bestArea = -1;
    for (const pl of g.planes) {
      const inst = idx.bySop.get(pl.sopInstanceUid);
      const a = pl.polygons.reduce((s, poly) => {
        const pts: Vec2[] = g.space === 'image_px' ? (poly as Vec2[]) : inst?.plane ? (poly as Vec3[]).map((q) => patientToPlaneMm(inst.plane!, q)) : [];
        return s + (pts.length >= 3 ? polygonArea(pts) : 0);
      }, 0);
      if (a > bestArea) {
        bestArea = a;
        best = pl.sopInstanceUid;
      }
    }
    return best;
  }
  const zs = g.planes.map((pl) => idx.bySop.get(pl.sopInstanceUid)?.plane?.ipp[2]).filter((z): z is number => z !== undefined);
  if (!zs.length) return null;
  const top = Math.max(...zs);
  const bottom = Math.min(...zs);
  const z = L.at === 'above' ? top + 8 : L.at === 'below' ? bottom - 8 : top - L.at * (top - bottom);
  let sop: string | null = null;
  let d = Infinity;
  for (const inst of idx.instances) {
    const iz = inst.plane?.ipp[2];
    if (iz === undefined || Math.abs(iz - z) >= d) continue;
    d = Math.abs(iz - z);
    sop = inst.sopInstanceUid;
  }
  return sop;
}

function CaseInfo({
  caseId,
  assessMasked,
  targets,
  onOpenBook,
  anchorLabel,
  engine,
  panels,
}: {
  caseId: string;
  assessMasked: boolean;
  targets: Map<string, LoadedTarget>;
  onOpenBook: (a: BookAnchorRef) => void;
  anchorLabel: (a: BookAnchorRef) => string;
  engine: ViewerEngine;
  panels: PanelDef[];
}) {
  const { catalog, progress } = useApp();
  const kase = catalog!.cases.get(caseId)!;
  const subject = catalog!.subjects.get(kase.subjectKey);
  const pack = catalog!.packs.find((p) => p.id === kase.packId);
  const source = pack?.manifest.sources.find((s) => s.id === subject?.sourceId);
  const [bookmarks, setBookmarks] = useState<Awaited<ReturnType<typeof progress.bookmarks>>>([]);
  const v = useSyncExternalStore(progress.subscribe, progress.getVersion);
  useEffect(() => {
    progress.bookmarks(caseId).then(setBookmarks);
  }, [progress, caseId, v]);
  const similar = [...catalog!.cases.values()].filter((c) => c.id !== kase.id && c.subjectKey !== kase.subjectKey && c.objectiveIds.some((o) => kase.objectiveIds.includes(o))).slice(0, 5);
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <h3>Patient &amp; source</h3>
        {/* The subject key and linkage name the source dataset, which can hint at the diagnosis while assessing. */}
        {!assessMasked ? (
          <>
            <small className="muted">
              Subject <span className="mono">{kase.subjectKey}</span>
            </small>
            <small className="muted">{subject?.linkageEvidence}</small>
          </>
        ) : null}
        {kase.clinicalContext ? <p>Context: {kase.clinicalContext}</p> : null}
        {source && assessMasked ? (
          <small className="faint">The image source and its licence appear after you submit: a dataset's name can hint at the diagnosis.</small>
        ) : source ? (
          <small className="faint">
            {source.name} · {source.license} ·{' '}
            <a href={source.doi ? `https://doi.org/${source.doi.replace(/^https?:\/\/doi\.org\//, '')}` : source.url} target="_blank" rel="noreferrer">
              source
            </a>
            {source.citation ? <span style={{ display: 'block', marginTop: 2 }}>Cite: {source.citation}</span> : null}
          </small>
        ) : null}
      </div>
      {!assessMasked ? (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <h3>Reference coverage</h3>
            <small className="muted">{kase.referenceSummary}</small>
            {[...targets.values()]
              .filter((t) => t.ref.geometryType !== 'slice_interval' || true)
              .slice(0, 30)
              .map((t) => (
                <div key={t.ref.id} className="stack" style={{ gap: 2, fontSize: 12.5 }}>
                  <div className="row wrap">
                    <span>{cleanLabel(t.ref.label)}</span>
                    <ProvenanceChip provenance={t.ref.provenance} />
                    <span className="chip">{t.ref.completeness.replace(/_/g, ' ')}</span>
                  </div>
                  {t.ref.teachingNote ? <small className="faint">{t.ref.teachingNote}</small> : null}
                </div>
              ))}
          </div>
          {kase.bookAnchors.length ? (
            <div className="stack" style={{ gap: 4 }}>
              <h3>Book</h3>
              {kase.bookAnchors.map((a, i) => (
                <button key={i} className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => onOpenBook(a)}>
                  {anchorLabel(a)}
                </button>
              ))}
            </div>
          ) : null}
          {similar.length ? (
            <div className="stack" style={{ gap: 4 }}>
              <h3>Similar teaching cases · different patients</h3>
              {similar.map((c) => (
                <Link key={c.id} to={`/read/${c.id}?mode=practice`} className="btn sm" style={{ justifyContent: 'flex-start' }}>
                  {c.neutralTitle} <span className="chip">Different patient</span>
                </Link>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="notice">Diagnosis-revealing details are hidden until you submit.</div>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <h3>Bookmarks</h3>
        {bookmarks.length === 0 ? <small className="faint">Use the bookmark button to save the exact slice, camera and window.</small> : null}
        {bookmarks.map((b) => (
          <div key={b.id} className="row">
            <button
              className="btn sm"
              style={{ flex: 1, justifyContent: 'flex-start' }}
              onClick={() => {
                const p = panels.find((x) => x.seriesUid === b.snapshot.seriesUid);
                if (p) void engine.restore(p.id, b.snapshot);
              }}
            >
              {b.label}
            </button>
            <button className="btn sm ghost" onClick={() => progress.deleteBookmark(b.id)} aria-label="Delete bookmark">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const LAYOUTS: Array<[Layout, string, React.ReactNode]> = [
  ['1', 'Single view', <SquareIcon key="1" size={16} />],
  ['2', 'Two-up comparison (same patient)', <Columns2 key="2" size={16} />],
  ['4', 'Four-up', <Grid2x2 key="4" size={16} />],
  ['mpr', 'MPR: axial / coronal / sagittal', <Box key="m" size={16} />],
  ['mpr3d', 'MPR + 3D', <Rotate3d key="3" size={16} />],
  ['mg', 'Mammography: CC and MLO, back to back', <Columns2 key="g" size={16} />],
];
