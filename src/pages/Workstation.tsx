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
  MoreHorizontal,
  Link2Off,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  Search as SearchIcon,
  PaintBucket,
  ImageDown,
  LayoutGrid,
} from 'lucide-react';
import '../styles/viewer3d.css';
import { useApp } from '../app/AppContext';
import { ViewerEngine, pinnedSource, type ToolId, type ViewKind } from '../viewer/engine';
import { AngioSlabControl, PlanesControl } from '../components/ws/MprControls';
import { FindingAnalysis } from '../components/ws/FindingAnalysis';
import { ImageAdjust } from '../components/ws/ImageAdjust';
import { hangMammograms, mammoView } from '../content/mammo';
import { hangRadiographs, isRadiograph, radiographView, viewNamedIn, type XrView } from '../content/radiographViews';
import { defaultAngioSlabMm } from '../viewer/presets3d';
import { secondsLeft, shiftUrl, type OncallShift, type ShiftItem } from '../services/oncall';

const MARK_TOOLS = new Set<ToolId>(['point', 'arrow', 'box', 'outline', 'eraser']);
import { arrowLabelHook } from '../viewer/csInit';
import { lookOf, segStyle, withLookAll } from '../viewer/segStyle';
import { GROUP_ORDER } from '../viewer/anatomyMask';
import { downloadBlob, shortLicense, slug, viewToPng } from '../lib/viewImage';
import { GuestSaveCard, LockedCase, UpgradeCard } from '../components/Upgrade';
import { todayPlan } from '../services/learningModel';
import { fact, LANDING_FACTS } from '../auth/landingFacts';
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
import { ReportProblem } from '../components/ReportProblem';
import { trackFunnel, trackOpened, WARM_ACCOUNT_EVENT } from '../services/serverSync';
import { ev, evFired } from '../services/ev';
import { SyncBadge } from '../components/SyncBadge';
import { gradeTask, measureWithinSlab, probeOfMark, type LoadedTarget } from '../grading/spatialGrader';
import type { GradeResult, LearnerMark } from '../grading/types';
import type { BookAnchorRef, Series, Task } from '../schema/content';
import type { SeriesIndex } from '../grading/seriesIndex';
import { canSubmit, newSession, needsMarks, reportShown, rules, hintLadder, type SessionState } from '../services/lessonEngine';
import { newId, type Attempt, type Mode } from '../services/progressRepository';
import { anchorLabel as fmtAnchor } from '../services/curriculum';
import type { ViewSnapshot } from '../viewer/engine';
import { imageToPatient, patientToPlaneMm, polygonArea, polygonCentroid, type Vec2, type Vec3 } from '../lib/geometry';
import { AI_CREDIT, AI_LABEL, cleanLabel, isAiDraft, plainName } from '../lib/provenance';
import { answerQuestion, examResultUrl, examUrl, finishExam, openQuestion, questionSecondsLeft, type CertExam } from '../services/exam';
import { CERT_TITLES, levelLabel } from '../services/certificates';
import { taskTypeLabel } from '../lib/taskTypes';

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
  /** Pinned to one image of the series (the PA or the lateral of a two-image radiograph series). */
  pin?: number;
}

/**
 * A study description as the scanner wrote it ("RT^RCCT_THORAX_8F_High (Adult)", "CT CHEST W CONTRAST") is noise to a
 * student and can name the protocol: show it only when it is plain words.
 */
function plainDescription(d: string | undefined): string {
  if (!d) return '';
  if (/[\^_]|\d{2,}/.test(d) || d === d.toUpperCase()) return '';
  return d;
}

/** What each tool does with one finger (a pinch always zooms). */
const TOOL_NAMES: Record<ToolId, string> = {
  windowLevel: 'Window / level: drag to change brightness and contrast',
  pan: 'Pan: drag to move the image',
  zoom: 'Zoom: drag up or down',
  scroll: 'Scroll: drag up or down through the slices',
  magnify: 'Magnifier: hold over fine detail',
  point: 'Point mark: tap the finding',
  arrow: 'Arrow: drag from the finding',
  box: 'Box: drag around the finding',
  outline: 'Outline: draw around the finding',
  length: 'Length: drag between two points',
  angle: 'Angle: drag one arm, then tap the end of the other',
  ellipse: 'Ellipse: drag over the area to measure',
  eraser: 'Eraser: tap a mark to remove it',
  crosshairs: 'Crosshairs: tap to move every plane',
  rotate3d: 'Rotate: drag to turn the model',
};

const MODES: Array<[Mode, string]> = [
  ['learn', 'Learn'],
  ['practice', 'Practice'],
  ['assess', 'Assess'],
  ['review', 'Review'],
];

/** "1:05" */
const clockText = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

function studyLabel(series: Series, date: string | null) {
  return `${series.modality}${date ? ` · ${date}` : ''} · ${series.description || `Series ${series.number ?? ''}`}`;
}

export default function Workstation() {
  const { caseId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { catalog, curriculum, progress, attempts, settings, reviews, free, guest, openPlans, startAccount } = useApp();
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
  // A question of a certification exam (from the Certificates page): only that question, in Assess mode.
  const examId = sp.get('exam');
  const availableTasks = tasks.filter(
    (t) => (!examId || t.id === sp.get('task')) && (mode === 'review' || t.modes.includes(mode === 'assess' ? 'assess' : mode === 'learn' ? 'learn' : 'practice')),
  );
  const task: Task | null = availableTasks.find((t) => t.id === sp.get('task')) ?? availableTasks[0] ?? tasks.find((t) => t.id === sp.get('task')) ?? null;

  const [layout, setLayout] = useState<Layout>('1');
  /** One view alone over the whole image area (one-up). The other views stay mounted at their size, hidden, so their
   *  slice, zoom, pan and window are unchanged on return and linked views keep following. */
  const [soloPanel, setSoloPanel] = useState<string | null>(null);
  /** Phones show one view at a time by default, with a switcher between the views of the layout. */
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = () => setIsPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [panels, setPanels] = useState<PanelDef[]>([]);
  /** Radiographs hung frontal | lateral: the view shown in each panel (from the DICOM tags or the description). */
  const [xrViews, setXrViews] = useState<Map<string, XrView>>(new Map());
  const [focused, setFocused] = useState('p0');
  const solo = panels.length > 1 && soloPanel && panels.some((x) => x.id === soloPanel) ? soloPanel : null;
  const toggleSolo = (id: string) => {
    if (panels.length < 2) return;
    if (solo) return setSoloPanel(null);
    setSoloPanel(id);
    setFocused(id);
  };
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 860);
  const [rightOpen, setRightOpen] = useState(true);
  /** On a phone the learning panel sits under the image: half the screen, or most of it. */
  const [sheetTall, setSheetTall] = useState(false);
  const [tab, setTab] = useState('task');
  const [session, setSession] = useState<SessionState | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [submittedMarks, setSubmittedMarks] = useState<LearnerMark[]>([]);
  const [selfReview, setSelfReview] = useState<Attempt['selfReview']>(null);
  const [attemptId, setAttemptId] = useState<string>(newId());
  /** The attempt as submitted: a later self-review changes only its verdict, never its answer, grade or submit time. */
  const committed = useRef<Attempt | null>(null);
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
    const show = (m: Map<string, LoadedTarget>) => {
      if (cancelled) return; // a later case (or review change) owns the targets now
      // Apply the learner's own review records (never invented): reviewed drafts become human_reviewed.
      for (const r of reviews) {
        const t = m.get(r.targetId);
        if (t && r.status === 'reviewed_by_user')
          m.set(r.targetId, { ...t, ref: { ...t.ref, provenance: 'human_reviewed', review: { status: 'reviewed_by_user', reviewer: r.reviewer, at: r.at, note: r.note } } });
      }
      setTargets(m);
    };
    // The open task's outlines first; the case's other outlines once the first image is on screen, so on a slow phone
    // connection they don't hold up the picture (the free chest CT carries ~400 KB of them).
    const first = new Set((task && task.caseId === kase.id ? task.targets.map((x) => x.targetId) : []).filter((id) => ids.includes(id)));
    if (!first.size) catalog.loadTargets(ids).then(show);
    else
      catalog.loadTargets([...first]).then((m) => {
        show(new Map(m));
        void Promise.race([engine.firstImage, new Promise((r) => setTimeout(r, 15_000))]).then(() => catalog.loadTargets(ids).then(show));
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
    committed.current = null;
    setHighlight(new Set());
    setAnatomyOn(null);
    setAnatomyHighlight(null);
    setIsolateId(null);
    setFocusSet(null);
    setCompare(null);
    setLayout('1');
    setSoloPanel(null);
    setXrViews(new Map());
    setPanels([{ id: 'p0', seriesUid: task.start.seriesUid, kind: 'stack' }]);
    setFocused('p0');
    setTab('task');
    setTimeLeft(mode === 'assess' && !examId && settings.assessTimerMinutes ? settings.assessTimerMinutes * 60 : null);
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

  // Hanging protocol for radiographs with two or more views (frontal left, lateral right): separate series of the study, or
  // the images of one "PA & LATERAL" series, each pinned to its own panel. The view comes from each image's own DICOM tags,
  // else an unambiguous description; when one is unknown the stored order is kept. The panel a task names gets the focus.
  const hungFor = useRef<string | null>(null);
  useEffect(() => {
    if (!task || !kase || !catalog) return;
    const key = `${kase.id}|${task.id}|${mode}`;
    if (hungFor.current === key) return;
    hungFor.current = key;
    const start = catalog.series.get(task.start.seriesUid);
    if (!start || !isRadiograph(start.modality)) return;
    const views = caseSeries.filter((x) => x.studyUid === start.studyUid && isRadiograph(x.modality) && x.role !== 'scout');
    let cancelled = false;
    const hang = (items: Array<{ panel: PanelDef; view: XrView | null }>) => {
      if (cancelled || hungFor.current !== key || items.length < 2) return;
      const hung = hangRadiographs(items).slice(0, 4).map((x, i) => ({ ...x, panel: { ...x.panel, id: `p${i}` } }));
      setLayout(hung.length > 2 ? '4' : '2');
      setPanels(hung.map((x) => x.panel));
      setXrViews(new Map(hung.filter((x) => x.view).map((x) => [x.panel.id, x.view!])));
      const named = viewNamedIn(`${task.title} ${task.prompt}`);
      const target = (named && hung.find((x) => x.view === named)?.panel.id) || hung.find((x) => x.panel.seriesUid === task.start.seriesUid && x.panel.pin === undefined)?.panel.id || 'p0';
      setFocused(target);
      setSoloPanel(window.matchMedia('(max-width: 860px)').matches ? target : null);
    };
    if (views.length >= 2) {
      hang(views.map((x) => ({ panel: { id: '', seriesUid: x.uid, kind: 'stack' as ViewKind }, view: radiographView(x.acquisition.ViewPosition, x.acquisition.PatientOrientation, x.description) })));
    } else if (start.instances.length >= 2 && start.instances.length <= 4) {
      const src = catalog.seriesSource(start.uid);
      if (src)
        void engine.imageViews(src).then((v) =>
          hang(v.map((x, i) => ({ panel: { id: '', seriesUid: start.uid, kind: 'stack' as ViewKind, pin: i }, view: radiographView(x.viewPosition, x.patientOrientation, null) }))),
        );
    }
    return () => {
      cancelled = true;
      if (hungFor.current === key) hungFor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, kase?.id, mode, catalog]);

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

  // ---------------------------------------------------------------- certification exam
  // One question after another, with no feedback: the server grades the answer and the next question opens; after the
  // last one the server scores the exam and the result page says whether you passed.
  const [exam, setExam] = useState<CertExam | null>(null);
  useEffect(() => {
    if (!examId) {
      setExam(null);
      return;
    }
    let cancelled = false;
    progress.certExam(examId).then((e) => {
      if (cancelled) return;
      if (e?.finishedAt) navigate(examResultUrl(e), { replace: true });
      else setExam(e);
    });
    return () => {
      cancelled = true;
    };
  }, [examId, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const examIndex = exam && task ? exam.items.findIndex((it) => it.caseId === caseId && it.taskId === task.id) : -1;
  const examItem = exam && examIndex >= 0 && mode === 'assess' ? exam.items[examIndex] : null;
  const goNextInExam = async (e: CertExam) => {
    const i = e.items.findIndex((it) => !it.submittedAt);
    if (i >= 0) return navigate(examUrl(e, i), { replace: true });
    // The last answer: the server scores the exam (the result page asks again if this fails).
    const r = await finishExam(e.id);
    navigate(examResultUrl(await progress.finishCertExam(r.ok ? { ...e, result: r.data.result, finishedAt: r.data.result.finishedAt } : e)), { replace: true });
  };
  // An answered question (e.g. opened again with Back) moves on to the next one.
  useEffect(() => {
    if (exam && examItem?.submittedAt) void goNextInExam(exam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, examIndex]);
  // From Level 2 each question has a clock, kept by the server. It starts once the image is on screen and keeps running
  // across reloads and visits, so leaving does not stop it.
  useEffect(() => {
    if (!exam || !examItem || examItem.startedAt || examItem.submittedAt || !p0Ready) return;
    let cancelled = false;
    void openQuestion(exam.id, examIndex).then((r) => {
      if (cancelled) return;
      if (!r.ok) return toast.show(r.error);
      const next = { ...exam, items: exam.items.map((it, i) => (i === examIndex ? { ...it, startedAt: r.data.openedAt } : it)) };
      setExam(next);
      void progress.saveCertExam(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, examIndex, examItem?.startedAt, p0Ready]);
  const [examNow, setExamNow] = useState(() => Date.now());
  const examTimed = !!(exam && examItem?.startedAt && !examItem.submittedAt && questionSecondsLeft(exam, examItem) !== null);
  useEffect(() => {
    if (!examTimed) return;
    const t = setInterval(() => setExamNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [examTimed]);
  const examLeft = exam && examItem?.startedAt ? questionSecondsLeft(exam, examItem, examNow) : null;
  // Time up: what is marked or chosen is saved as the answer; with nothing to save, the question counts as not answered.
  const timedOutRef = useRef('');
  useEffect(() => {
    if (examLeft === null || examLeft > 0 || !exam || !examItem || examItem.submittedAt || !task || !session) return;
    const key = `${exam.id}|${examIndex}`;
    if (timedOutRef.current === key) return;
    timedOutRef.current = key;
    void (async () => {
      if (canSubmit(task, session, engine.collectMarks().length, false)) {
        toast.show('Time is up: your answer was saved.');
        await submit();
        return;
      }
      const saved = await answerQuestion(exam.id, examIndex, null);
      if (!saved.ok) {
        timedOutRef.current = '';
        return toast.show(saved.error);
      }
      const next = { ...exam, items: exam.items.map((it, i) => (i === examIndex ? { ...it, submittedAt: new Date().toISOString(), timedOut: true } : it)) };
      await progress.saveCertExam(next);
      setExam(next);
      toast.show('Time is up: this question counts as not answered.');
      await goNextInExam(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examLeft]);
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
      toast.show('Time is up. Submit when ready; the timer never discards your work.');
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
  // A guest's first mark, with how long they looked at the picture before it (the funnel's "time to first mark").
  const shownAt = useRef<number | null>(null);
  const guestTasks = useRef(new Set<string>());
  useEffect(() => {
    if (guest && marks.length && shownAt.current !== null) trackFunnel('guest_mark', true, (performance.now() - shownAt.current) / 1000);
    if (marks.length && task) ev('mark', { task: task.id, tool: marks[0].tool, secs: shownAt.current === null ? -1 : Math.round((performance.now() - shownAt.current) / 1000) }, true);
  }, [guest, marks.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A guest who opens a second task (the step after the first grade).
  useEffect(() => {
    if (!guest || !task) return;
    guestTasks.current.add(task.id);
    if (guestTasks.current.size === 2) trackFunnel('guest_second', true);
  }, [guest, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // A phone shows one view at a time (the switcher above the image picks it); a computer shows the grid.
    setSoloPanel(isPhone && l !== '1' ? 'p0' : null);
    setXrViews(new Map());
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
    // Angiograms: the MPR views open as a MIP slab, so a vessel is followed over several millimetres (switch in the toolbar).
    if (l === 'mpr' || l === 'mpr3d') {
      const src0 = catalog?.seriesSource(primary);
      engine.setSlab(src0?.angiography ? { mm: defaultAngioSlabMm(src0.modality), blend: 'mip' } : null);
    }
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

  const pickSeries = (panelId: string, uid: string) => {
    // Another series in a panel: it shows that series whole (no pinned image) and is no longer a hung radiograph view.
    setPanels((ps) => ps.map((p) => (p.id === panelId ? { id: p.id, seriesUid: uid, kind: 'stack' } : p)));
    setXrViews((m) => (m.has(panelId) ? new Map([...m].filter(([k]) => k !== panelId)) : m));
  };

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
    if (!canSubmit(task, session, frozen.length, !examItem && reportShown(task, settings.level))) return;
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
          .map((x) => `${cleanLabel(x.t.ref.label)}${isAiDraft(x.t.ref.provenance) ? ` (${AI_LABEL}, unreviewed)` : ''}`);
        if (hits.length) mo.note += ` Anatomy labels place this point in: ${[...new Set(hits)].slice(0, 3).join(', ')}.`;
      }
    }
    if (g.outcome === 'not_attempted' && (session.notAssessable || session.uncertain)) {
      g.outcome = g.authoritative ? 'incorrect' : 'self_review';
      g.messages.push('You reported this as uncertain or not assessable. The reference shows the target on this study; use the explanation to see why.');
    }
    const attempt: Attempt = { ...buildAttempt(g, true), marks: frozen, position: { seriesUid: pp.seriesUid, sopInstanceUid: cp.sop, worldLps: cp.world }, independent: rules.independent(session) };
    // Logged as soon as it is graded (before the grade is drawn and saved), so the log reads answer → grade_seen.
    const graded = { task: attempt.taskId, mode, correct: attempt.grade?.outcome === 'correct', score: Math.round((attempt.grade?.score ?? 0) * 100) / 100, assisted: !attempt.independent, secs: Math.round(attempt.durationMs / 1000) };
    if (evFired('answer')) ev('second_answer', { task: graded.task, correct: graded.correct }, true);
    ev('answer', graded);
    if (exam && examItem) {
      // Exam: the server grades the answer as given; save it here too and go on, without showing the result.
      try {
        await progress.saveAttempt(attempt);
      } catch (e) {
        toast.show((e as Error).message);
        return;
      }
      const saved = await answerQuestion(exam.id, examIndex, {
        taskId: attempt.taskId,
        lessonVersion: attempt.lessonVersion,
        mode: 'assess',
        marks: attempt.marks,
        position: attempt.position,
        choice: attempt.choice,
        declaredNoFinding: attempt.declaredNoFinding,
        hintsUsed: attempt.hintsUsed,
        revealed: attempt.revealed,
      });
      if (!saved.ok) return toast.show(`Your answer was not saved: ${saved.error}`);
      const next = { ...exam, items: exam.items.map((it, i) => (i === examIndex ? { ...it, submittedAt: attempt.submittedAt, attemptId: attempt.id } : it)) };
      await progress.saveCertExam(next);
      setExam(next);
      await goNextInExam(next);
      return;
    }
    setSubmittedMarks(frozen);
    setGrade(g);
    const next = { ...session, submitted: true };
    setSession(next);
    committed.current = attempt;
    try {
      await progress.saveAttempt(attempt);
    } catch (e) {
      toast.show((e as Error).message);
    }
    if (guest) {
      trackFunnel('guest_answer', true);
      window.dispatchEvent(new Event(WARM_ACCOUNT_EVENT));
    }
    engine.setMarksVisible(true);
  };

  useEffect(() => {
    // Persist self-review verdicts on the submitted attempt.
    if (!grade || !session?.submitted || mode === 'review' || !selfReview) return;
    const base = committed.current ?? { ...buildAttempt(grade, true), marks: submittedMarks };
    void progress.saveAttempt({ ...base, selfReview, reviewedAt: new Date().toISOString() }).catch((e) => toast.show(String(e.message ?? e)));
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
  /** Where a target is best seen: the slice where it is largest (its index in the series) and the point to centre on. */
  const targetView = (t: LoadedTarget): { sop: string | null; index: number; world: Vec3 | null } | null => {
    if (!catalog) return null;
    const idx = catalog.seriesIndex(t.ref.seriesUid);
    if (!idx) return null;
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
    return { sop, index: sop && src ? src.sopUids.indexOf(sop) : -1, world };
  };
  const jumpToLoaded = (t: LoadedTarget): boolean => {
    const pid = panels.find((p) => p.seriesUid === t.ref.seriesUid)?.id;
    if (!pid) return false;
    const view = targetView(t);
    if (!view) return false;
    const ready = engine.panelState(pid);
    if (!ready || ready.seriesUid !== t.ref.seriesUid || !ready.ready) {
      // Still loading its first image: open there instead (the slice is fetched next), then centre once ready.
      if (view.index >= 0) engine.preferOpenAt(t.ref.seriesUid, view.index);
      return false;
    }
    const { index, world } = view;
    if (ready.kind === 'stack' && index >= 0) {
      // Go there once that slice has arrived, so its outline is never drawn over another slice's picture.
      void engine.goToSliceWhenLoaded(pid, t.ref.seriesUid, index).then((ok) => {
        if (ok && world) setTimeout(() => engine.centerOn(pid, world), 120);
      });
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

  const goTask = (t: Task, m: Mode = mode === 'learn' || mode === 'review' ? 'practice' : mode) =>
    navigate(`/read/${t.caseId}?task=${encodeURIComponent(t.id)}&mode=${m}`);
  const nextOnStudy = (() => {
    const n = task ? availableTasks[availableTasks.findIndex((t) => t.id === task.id) + 1] : undefined;
    return n ? () => setSp({ task: n.id, mode }) : null;
  })();
  // After an answer there is always one next step: the next task on this study, else the next patient in today's plan.
  const nextPatient = useMemo(() => {
    const p = catalog ? todayPlan(attempts, catalog, settings.minutesPerDay).find((x) => x.caseId !== kase?.id) : undefined;
    return p ? catalog?.tasks.get(p.taskId) : undefined;
  }, [attempts, catalog, settings.minutesPerDay, kase?.id]);
  const nextStep = nextOnStudy ? { label: 'Next task', go: nextOnStudy } : nextPatient ? { label: 'Next patient', go: () => goTask(nextPatient, 'practice') } : null;
  // A guest (from an ad, often on a phone) keeps going with the same one-tap kind of task, now without the outline
  // (Practice): a harder try right after the first grade, rather than a two-arrow naming task.
  const guestNext = (() => {
    if (!guest || !task) return null;
    const tried = new Set(attempts.map((a) => a.taskId));
    const oneTap = (t: Task) => t.grading.kind === 'point_in_target' && t.targets.filter((x) => x.required).length <= 1 && t.modes.includes('practice');
    const n = availableTasks.find((t) => t.id !== task.id && oneTap(t) && !tried.has(t.id));
    if (!n) return nextOnStudy ? { label: 'Next task', go: nextOnStudy } : null;
    const label = /^find /i.test(n.title) ? `Next: ${n.title[0].toLowerCase()}${n.title.slice(1)}, no outline` : `Next: ${n.title}`;
    return {
      label,
      go: () => {
        ev('next_task', { task: n.id });
        setSp({ task: n.id, mode: 'practice' });
      },
    };
  })();

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
      else if (k === 'u' && panels.length > 1) toggleSolo(focused);
      else if (k === 'Escape' && solo && !isPhone && !document.querySelector('[role="dialog"], [role="menu"]')) setSoloPanel(null);
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

  // A guest from an ad or a shared link opens at the level where the task's structure is, not at slice 1, so the first
  // screen is the one the reel or post showed and one tap answers it. In Learn the reference is shown anyway; in Practice
  // only the level is given, the outline stays hidden until the answer. Assess (and every account) keeps the task's start.
  const guestOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!guest || (mode !== 'learn' && mode !== 'practice') || !task || showId || guestOpened.current === task.id) return;
    const t = task.targets.map((x) => targets.get(x.targetId)).find((x): x is LoadedTarget => !!x);
    if (!t) return;
    guestOpened.current = task.id;
    // Ask for the structure's slice now, so a slow phone connection fetches it right after (or instead of) slice 1,
    // and keep trying for up to a minute while the first image arrives.
    const v = targetView(t);
    if (v && v.index >= 0) engine.preferOpenAt(t.ref.seriesUid, v.index);
    setTimeout(() => jumpWhenReady(t, 400), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest, mode, task, targets, showId]);

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
  // On a touch screen the tool buttons have no hover label: picking one says its name for a moment.
  const activeTool = engine.getTool();
  const [toolFlash, setToolFlash] = useState<string | null>(null);
  const lastTool = useRef(activeTool);
  useEffect(() => {
    if (lastTool.current === activeTool) return;
    lastTool.current = activeTool;
    if (!window.matchMedia('(hover: none)').matches) return;
    setToolFlash(TOOL_NAMES[activeTool]);
    const t = setTimeout(() => setToolFlash(null), 1800);
    return () => clearTimeout(t);
  }, [activeTool]);
  // Marks land on the true thin slice: a thick slab is set aside while a marking tool is in use and comes back after.
  const slabBeforeMarking = useRef<ReturnType<ViewerEngine['getSlab']>>(null);
  useEffect(() => {
    const marking = MARK_TOOLS.has(activeTool) && activeTool !== 'eraser';
    if (marking && engine.getSlab() && panels.some((x) => x.kind !== 'stack' && x.kind !== '3d')) {
      slabBeforeMarking.current = engine.getSlab();
      engine.setSlab(null);
      toast.show('Marking on the thin slice: the MIP slab is back when you pick a viewing tool.');
    } else if (!marking && slabBeforeMarking.current) {
      engine.setSlab(slabBeforeMarking.current);
      slabBeforeMarking.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);
  // A tap or click on the finding with a viewing tool does nothing: say how to mark, a few times at most. On a phone
  // (Scroll is its default, so a swipe moves through the slices), a tap on a one-point task places the point there,
  // and another tap moves it: the ad's "tap the heart" works without finding the Point tool first.
  const markHints = useRef(0);
  const tappedAt = useRef(0);
  const MARK_HINT = 'To mark the finding, choose Point or Box in the toolbar first';
  const hintMark = (canvas: Vec2, panelId: string, touch = false) => {
    const t = engine.getTool();
    if (!task || !session || !needsMarks(task) || !rules.canEditMarks(session)) return;
    if (t !== 'windowLevel' && t !== 'pan' && t !== 'zoom' && t !== 'scroll') return;
    const onePoint = task.grading.kind === 'point_in_target' && task.targets.filter((x) => x.required).length <= 1;
    if (onePoint && t === 'scroll') {
      if (!touch) {
        if (Date.now() - tappedAt.current < 1000) return; // the mouse events a browser sends after the same tap
      } else {
        for (const m of engine.collectMarks()) if (m.tool === 'point') engine.removeMark(m.id);
        if (engine.placePointAt(panelId, canvas)) {
          tappedAt.current = Date.now();
          return;
        }
      }
    }
    if (markHints.current >= 3) return;
    markHints.current += 1;
    ev('tap_no_mark', { why: t });
    setToolFlash(MARK_HINT);
    window.setTimeout(() => setToolFlash((f) => (f === MARK_HINT ? null : f)), 2600);
  };
  // A guest on a phone (from an ad or a link) is told on the image itself what one tap does, until their first mark:
  // three in four guests saw the image and left without touching it (Vercel, 7 Nov).
  const tapHintTarget = task?.targets.find((x) => x.required)?.name ?? task?.targets[0]?.name;
  const tapHint =
    guest &&
    task &&
    session &&
    !session.submitted &&
    marks.length === 0 &&
    task.grading.kind === 'point_in_target' &&
    task.targets.filter((x) => x.required).length <= 1 &&
    tapHintTarget &&
    engine.getTool() === 'scroll' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
      ? `Tap the ${tapHintTarget.toLowerCase()}`
      : null;
  // The funnel's "Opened a first case": the focused view has its images on screen.
  const focusedState = engine.panelState(focused);
  const focusedShown = !!focusedState?.ready && !focusedState.error;
  useEffect(() => {
    if (kase && task) ev('case_shell', { case: kase.id, task: task.id, ms: Math.round(performance.now()) }, true);
  }, [kase?.id, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const err = focusedState?.error;
    if (err) ev('image_error', { case: kase?.id ?? '', status: Number(/HTTP (\d{3})/.exec(err)?.[1] ?? 0) }, true);
  }, [focusedState?.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session?.submitted && task) ev('grade_seen', { task: task.id });
  }, [session?.submitted, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focusedShown && shownAt.current === null) {
      shownAt.current = performance.now();
      const ms = Math.round(performance.now());
      ev('first_image', { case: kase?.id ?? '', ms }, true);
      if (ms > 10_000) ev('slow', { step: 'first_image', ms }, true);
    }
    if (focusedShown) (guest ? trackFunnel('guest_open', true) : trackOpened());
  }, [focusedShown, guest]);
  if (!catalog) return <div className="vp-status">Loading case catalogue…</div>;
  // A free account opening a members' patient from a link sees what it is and the plans, not an error.
  if (!kase && free) return <LockedCase caseId={caseId ?? ''} />;
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
            : { text: 'Draft reference · self-review', tone: 'warn', title: `Unreviewed references (${AI_LABEL} outlines or dataset auto-labels): comparison only until you review them.` };
  // Said only when it matters: an unaided answer is the default and needs no note.
  const independentNote = rules.independent(session) ? '' : 'This attempt is recorded as assisted.';
  /** Short name of a view for the switcher and the panel title: the plane, the radiographic view, or the series. */
  const panelName = (pd: PanelDef, i: number): string => {
    if (pd.kind !== 'stack') return pd.kind === '3d' ? '3D' : pd.kind[0].toUpperCase() + pd.kind.slice(1);
    if (compare && pd.id === 'p1') return 'Other patient';
    const xv = xrViews.get(pd.id);
    if (xv) return xv === 'frontal' ? 'Frontal' : 'Lateral';
    if (pd.pin !== undefined) return `Image ${pd.pin + 1}`;
    const s = catalog.series.get(pd.seriesUid);
    if (s?.modality === 'MG') {
      const v = mammoView(s.description, s.acquisition);
      if (v.side || v.view) return `${v.side ?? ''} ${v.view ?? ''}`.trim();
    }
    const d = (s?.description ?? '').trim();
    return d ? (d.length > 16 ? `${d.slice(0, 15)}…` : d) : `View ${i + 1}`;
  };
  const relNote = (p: PanelDef) => {
    if (compare && p.id === 'p1' && p.seriesUid === compare.seriesUid) {
      const lvl = levelZ !== null ? levelName(levelZ, marksA) : null;
      const how = syncPairs.length ? `level-matched by ${syncPairs.length} labelled structures${lvl ? ` · ≈ ${lvl}` : ''}` : 'not level-matched (scroll it yourself)';
      return `Different patient ${compare.rank + 1}/${compare.total}${compare.noFindings ? ' · no findings annotated' : ' · has annotated findings'} · ${how}`;
    }
    if (p.id === panels[0]?.id || panels.length < 2 || p.pin !== undefined || xrViews.has(p.id)) return null;
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
    setSoloPanel(isPhone ? 'p0' : null);
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
  const closeNavOnPhone = () => {
    if (window.matchMedia('(max-width: 860px)').matches) setLeftOpen(false);
  };
  // A report carries the case, the task and the slice of the focused view at the moment it is sent.
  const reportContext = () => {
    const st = engine.panelState(focused);
    return { caseId: kase.id, taskId: task.id, mode, ...(examItem ? { exam: true } : {}), view: st ? { seriesUid: st.seriesUid, kind: st.kind, slice: st.index + 1, of: st.count } : null };
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
        {/* On a phone: the case and its mode on one row, the tools on a second row that scrolls. Wider: one row. */}
        <div className="ws-bar-head">
        <IconButton label={examItem ? 'Leave the exam (your answers are kept)' : 'Back to cases'} onClick={() => navigate(examItem ? '/certificates' : '/cases')}>
          <ArrowLeft size={17} />
        </IconButton>
        <IconButton label="Case navigator" shortcut="[" active={leftOpen} onClick={() => setLeftOpen((v) => !v)}>
          <PanelLeft size={17} />
        </IconButton>
        <div className="ws-title">
          <strong>{title}</strong>
          <span>{assessMasked ? '' : plainDescription(study0?.description)}</span>
        </div>
        <SyncBadge />
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
        {examItem && exam ? (
          <span className="ws-exam" title="Certification exam: no hints, and no result until the end">
            <span className="chip accent">
              Exam · {CERT_TITLES[exam.area]} · {levelLabel(exam.level)}
            </span>
            <span className="ws-exam-count">
              Question {examIndex + 1} of {exam.items.length}
            </span>
            {examLeft !== null ? (
              <span className={`chip ${examLeft <= 20 ? 'bad' : 'warn'} ws-exam-clock`} aria-label="Time left for this question">
                <Timer size={12} /> {clockText(examLeft)}
              </span>
            ) : null}
            <span
              className="ws-exam-bar"
              role="progressbar"
              aria-label="Questions answered"
              aria-valuemin={0}
              aria-valuemax={exam.items.length}
              aria-valuenow={exam.items.filter((it) => it.submittedAt).length}
            >
              <span style={{ width: `${(100 * exam.items.filter((it) => it.submittedAt).length) / exam.items.length}%` }} />
            </span>
          </span>
        ) : null}
        <div className="mode-switch" role="group" aria-label="Mode" style={(shiftItem && !session.submitted) || examItem ? { display: 'none' } : undefined}>
          {MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setSp({ task: task.id, mode: m })}>
              {label}
            </button>
          ))}
        </div>
        {(shiftItem && !session.submitted) || examItem ? null : (
          <select className="mode-select" aria-label="Mode" value={mode} onChange={(e) => setSp({ task: task.id, mode: e.target.value as Mode })}>
            {MODES.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        )}
        <span className="ws-sm-only">
          <IconButton label="Learning panel" shortcut="]" active={rightOpen} onClick={() => setRightOpen((v) => !v)}>
            <PanelRight size={17} />
          </IconButton>
        </span>
        </div>
        <div className="ws-bar-tools">
        <span className="sep" />
        {/* Phones: brightness and contrast as sliders and presets, since dragging on the image also marks and scrolls. */}
        {focusedPanel && focusedSeries && focusedKind !== '3d' ? (
          <ImageAdjust engine={engine} panelId={focusedPanel.id} seriesUid={focusedPanel.seriesUid} modality={focusedSeries.modality} presets={focusedSeries.windowPresets} />
        ) : null}
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
          {/* Measuring is occasional: one menu keeps the toolbar to the tools used on every case. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={`icon-btn${tool === 'length' || tool === 'angle' || tool === 'ellipse' ? ' active' : ''}`}
                aria-label="Measure"
                title="Measure: length (L), angle (G), ellipse"
              >
                <Ruler size={17} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="popover" sideOffset={6}>
                <DropdownMenu.Item className="menu-item" onSelect={() => engine.setTool('length')}>
                  <Ruler size={14} /> Length <span className="faint">(calibrated images only)</span>
                  <span className="kbd" style={{ marginLeft: 'auto' }}>L</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => engine.setTool('angle')}>
                  <Triangle size={14} /> Angle
                  <span className="kbd" style={{ marginLeft: 'auto' }}>G</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => engine.setTool('ellipse')}>
                  <Circle size={14} /> Ellipse ROI statistics
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
        <span className="sep hide-sm" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            {/* On a phone the Brightness button on the image does this with sliders. */}
            <button className="btn sm hide-sm" aria-label="Window presets">
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
                    ? 'MR signal is in arbitrary units, so there are no Hounsfield presets.'
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
        {(layout === 'mpr' || layout === 'mpr3d') && catalog.seriesSource(panels[0]?.seriesUid ?? '')?.angiography ? (
          <AngioSlabControl engine={engine} modality={catalog.series.get(panels[0].seriesUid)?.modality ?? 'CT'} />
        ) : null}
        {panels.some((x) => x.kind === 'axial' || x.kind === 'coronal' || x.kind === 'sagittal') ? (
          <PlanesControl engine={engine} focused={focused} kind={focusedKind === 'axial' || focusedKind === 'coronal' || focusedKind === 'sagittal' ? focusedKind : null} />
        ) : null}
        {panels.length > 1 ? (
          <IconButton
            label={solo ? 'Back to all the views (Esc)' : 'Show the selected view alone (double-click its title)'}
            shortcut="U"
            active={!!solo}
            onClick={() => toggleSolo(focused)}
          >
            {solo ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
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
        <IconButton label="Full screen" shortcut="F" onClick={toggleFullscreen}>
          <Expand size={17} />
        </IconButton>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className={`icon-btn${tool === 'eraser' ? ' active' : ''}`} aria-label="More" title="Undo, redo, eraser, save image, bookmark, keyboard shortcuts">
              <MoreHorizontal size={17} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="popover" sideOffset={6} align="end">
              <DropdownMenu.Item className="menu-item" onSelect={() => engine.undo()}>
                <Undo2 size={14} /> Undo
                <span className="kbd" style={{ marginLeft: 'auto' }}>Ctrl Z</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => engine.redo()}>
                <Redo2 size={14} /> Redo
                <span className="kbd" style={{ marginLeft: 'auto' }}>Ctrl Y</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => engine.setTool('eraser')}>
                <Eraser size={14} /> Eraser
                <span className="kbd" style={{ marginLeft: 'auto' }}>E</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="nav-sep" />
              <DropdownMenu.Item className="menu-item" disabled={assessMasked} onSelect={() => void saveImage()}>
                <ImageDown size={14} /> {assessMasked ? 'Save image (after you submit)' : 'Save this view as an image'}
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={addBookmark}>
                <Bookmark size={14} /> Bookmark this view
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => setHelpOpen(true)}>
                <Keyboard size={14} /> Keyboard shortcuts
                <span className="kbd" style={{ marginLeft: 'auto' }}>?</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="hide-sm">
          <IconButton label="Learning panel" shortcut="]" active={rightOpen} onClick={() => setRightOpen((v) => !v)}>
            <PanelRight size={17} />
          </IconButton>
        </span>
        </div>
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
                      onClick={() => {
                        pickSeries(focused, u);
                        closeNavOnPhone();
                      }}
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
                <button key={t.id} className="series-item" style={{ gridTemplateColumns: '18px 1fr' }} aria-current={t.id === task.id} onClick={() => {
                  setSp({ task: t.id, mode });
                  closeNavOnPhone();
                }}>
                  <span className="faint">{done ? '✓' : i + 1}</span>
                  <span className="series-meta">
                    <strong>{mode === 'assess' && t.id !== task.id ? `Task ${i + 1}` : mode === 'assess' && !session.submitted ? `Task ${i + 1}` : t.title}</strong>
                    <span className="faint">{taskTypeLabel(t.type)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
      {leftOpen ? <button className="ws-scrim" tabIndex={-1} aria-label="Close the case navigator" onClick={() => setLeftOpen(false)} /> : null}

      {/* ------------------------------------------------ viewports */}
      <section className="ws-main" aria-label="Image viewports">
        {toolFlash ? (
          <div className="ws-tool-flash" role="status">
            {toolFlash}
          </div>
        ) : tapHint ? (
          <div className="ws-tool-flash ws-tap-hint" role="status">
            {tapHint}
          </div>
        ) : null}
        {panels.length > 1 && (solo || isPhone) ? (
          <div className="vswitch" role="tablist" aria-label="Views of this layout">
            {panels.map((pd, i) => (
              <button
                key={pd.id}
                role="tab"
                aria-selected={solo === pd.id}
                className={solo === pd.id ? 'on' : ''}
                onClick={() => {
                  setSoloPanel(pd.id);
                  setFocused(pd.id);
                }}
              >
                {panelName(pd, i)}
              </button>
            ))}
            <button role="tab" aria-selected={!solo} className={!solo ? 'on' : ''} onClick={() => setSoloPanel(null)} title="All the views together">
              <LayoutGrid size={14} aria-hidden /> <span className="vswitch-all">All</span>
            </button>
          </div>
        ) : null}
        <div
          className={`vgrid ${layout === '1' ? 'l1' : layout === '2' ? 'l2' : layout === 'mpr' ? 'l3mpr' : layout === 'mpr3d' ? 'l4 mpr3d' : layout === 'mg' ? (panels.length > 2 ? 'l4' : 'l2') : 'l4'}${solo ? ' solo' : ''}${panels.length > 1 && isPhone ? ' switched' : ''}`}
        >
          {panels.flatMap((pd, i) => {
            const full = catalog.seriesSource(pd.seriesUid);
            const src = full && pd.pin !== undefined ? pinnedSource(full, pd.pin) : full;
            const s = catalog.series.get(pd.seriesUid);
            // The view shown alone leaves its grid cell to a placeholder, so the hidden views keep their cells and sizes.
            const slot = solo === pd.id ? [<div key={`slot-${pd.id}`} className="vslot" aria-hidden />] : [];
            if (!src || !s) return [...slot, <div key={pd.id} className={`vpanel${solo === pd.id ? ' solo' : ''}`}><div className="vp-status">Series unavailable.</div></div>];
            return [
              ...slot,
              <ViewportPanel
                key={`${pd.id}-${pd.seriesUid}-${pd.kind}-${pd.pin ?? ''}`}
                engine={engine}
                panelId={pd.id}
                source={src}
                series={s}
                seriesIndex={catalog.seriesIndex(pd.seriesUid)}
                kind={pd.kind}
                startIndex={pd.pin !== undefined ? 0 : startIndexFor(pd.seriesUid, task)}
                viewTag={xrViews.get(pd.id) === 'frontal' ? 'Frontal' : xrViews.get(pd.id) === 'lateral' ? 'Lateral' : undefined}
                focused={focused === pd.id}
                solo={solo === pd.id}
                onToggleSolo={panels.length > 1 ? () => toggleSolo(pd.id) : undefined}
                viewName={panels.length > 1 ? panelName(pd, i) : undefined}
                onFocus={() => setFocused(pd.id)}
                onImageClick={pd.kind === '3d' ? undefined : (c, touch) => hintMark(c, pd.id, touch)}
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
                seriesOptions={layout === 'mpr' || layout === 'mpr3d' || (compare && pd.id === 'p1') || pd.pin !== undefined || xrViews.has(pd.id) ? [] : seriesOptions}
                onPickSeries={(u) => pickSeries(pd.id, u)}
                relationNote={relNote(pd)}
                assessMasked={assessMasked}
              />,
            ];
          })}
        </div>
      </section>

      {/* ------------------------------------------------ right panel */}
      <aside className={`ws-right${rightOpen ? '' : ' collapsed'}${sheetTall ? ' tall' : ''}`} aria-label="Learning panel">
        <button
          className="ws-sheet-handle"
          aria-expanded={sheetTall}
          aria-label={sheetTall ? 'Make the learning panel smaller' : 'Make the learning panel taller'}
          onClick={() => setSheetTall((v) => !v)}
        >
          <span aria-hidden />
        </button>
        <Tabs.Root value={tab} onValueChange={setTab} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <Tabs.List className="tabs-list" aria-label="Learning panel tabs">
            <Tabs.Trigger value="task">Task</Tabs.Trigger>
            <Tabs.Trigger value="book">Book</Tabs.Trigger>
            <Tabs.Trigger value="anatomy">Anatomy</Tabs.Trigger>
            <Tabs.Trigger value="coach">Checklist</Tabs.Trigger>
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
                committed.current = null;
                setHighlight(new Set());
                if (mode === 'review') setSp({ task: task.id, mode: 'practice' });
                toast.show('New attempt on the same patient. It is recorded, but it is not an unseen-patient test.');
              }}
              onNextTask={nextOnStudy}
              // A guest's first step after a result is keeping it (a free account, no card); the next task stays one tap away.
              next={exam || shift ? null : guest ? { label: 'Save it: free account', go: () => startAccount('signup') } : (nextStep ?? (free ? { label: 'See the plans', go: openPlans } : null))}
              alsoNext={guest && !exam && !shift ? guestNext : null}
              selfReview={selfReview}
              onSelfReview={setSelfReview}
              independentNote={independentNote}
              scoringLabel={scoringLabel}
              exam={examItem && exam ? { index: examIndex, total: exam.items.length, secondsLeft: examLeft } : null}
            />
            {/* Size, extent, volume and place of each expert-outlined finding: only once the reference may be seen. */}
            {refAllowed && !exam ? (
              <FindingAnalysis
                findings={[...targets.values()].filter((t) => t.ref.classId.startsWith('finding:') && (t.ref.provenance === 'source_manual' || t.ref.provenance === 'human_reviewed') && caseSeries.some((x) => x.uid === t.ref.seriesUid)).slice(0, 8)}
                anatomy={anatomyTargets}
                seriesIndex={(uid) => catalog.seriesIndex(uid)}
                imageOf={(uid, sop) => {
                  const src = catalog.seriesSource(uid);
                  const i = src ? src.sopUids.indexOf(sop) : -1;
                  return i >= 0 && src ? { index: i, count: src.sopUids.length } : null;
                }}
                onGoTo={(t, sop) => {
                  const pd = panels.find((x) => x.seriesUid === t.ref.seriesUid && x.kind === 'stack' && x.pin === undefined) ?? null;
                  if (!pd) pickSeries(panels[0].id, t.ref.seriesUid);
                  const id = pd?.id ?? panels[0].id;
                  setHighlight(new Set([t.ref.id]));
                  const go = (tries = 20) => {
                    const src = catalog.seriesSource(t.ref.seriesUid);
                    const i = src ? src.sopUids.indexOf(sop) : -1;
                    if (i >= 0 && engine.panelState(id)?.ready && engine.panelState(id)?.seriesUid === t.ref.seriesUid) engine.setIndex(id, i);
                    else if (tries > 0) setTimeout(() => go(tries - 1), 150);
                  };
                  go();
                }}
              />
            ) : null}
            {/* After the learner's own result, never before it. */}
            {guest && session.submitted ? (
              <GuestSaveCard onStart={() => startAccount('signup')} onSignIn={() => startAccount('login')} />
            ) : free && session.submitted ? (
              <UpgradeCard compact title="Graded on the exact slice." text={`Members get ${fact(LANDING_FACTS.tasks)}+ tasks like this on ${LANDING_FACTS.patients}+ patients, with drills and on-call shifts.`} />
            ) : null}
            {guest ? null : <ReportProblem context={reportContext} onSent={toast.show} />}
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
              limited={free}
              onUpgrade={openPlans}
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
            {guest ? null : <ReportProblem context={reportContext} onSent={toast.show} />}
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
                  ['U  /  Esc', 'Show the selected view alone (or double-click its title) / back to all the views'],
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
        {kase.clinicalContext ? <p>Context: {kase.clinicalContext}</p> : null}
        {source && assessMasked ? (
          <small className="faint">The image source and its licence appear after you submit: a dataset's name can hint at the diagnosis.</small>
        ) : source ? (
          <small className="muted">
            {source.name} · {source.license} ·{' '}
            <a href={source.doi ? `https://doi.org/${source.doi.replace(/^https?:\/\/doi\.org\//, '')}` : source.url} target="_blank" rel="noreferrer">
              source
            </a>
          </small>
        ) : null}
        {/* The subject key and linkage name the source dataset, which can hint at the diagnosis while assessing. */}
        {!assessMasked ? (
          <details className="case-details">
            <summary>Data details</summary>
            <small className="faint">
              Subject <span className="mono">{kase.subjectKey}</span>
            </small>
            {subject?.linkageEvidence ? <small className="faint">{subject.linkageEvidence}</small> : null}
            {source?.citation ? <small className="faint">Cite: {source.citation}</small> : null}
          </details>
        ) : null}
        {catalog!.anatomyTargetsForSeries(catalog!.seriesForCase(kase).map((s) => s.uid)).length ? (
          <small className="faint">
            Anatomy outlines: {AI_LABEL}.{' '}
            <a href={AI_CREDIT.url} target="_blank" rel="noopener">
              Thanks to {AI_CREDIT.name}
            </a>
            , every structure in the anatomy layer is marked.
          </small>
        ) : null}
      </div>
      {!assessMasked ? (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <h3>Reference coverage</h3>
            <small className="muted">{kase.referenceSummary}</small>
            {(() => {
              // Structures that share a source, a completeness and a note are listed together, with the note said once.
              const groups = new Map<string, { names: string[]; provenance: string; completeness: string; note?: string }>();
              for (const t of [...targets.values()].slice(0, 60)) {
                const key = `${t.ref.provenance}|${t.ref.completeness}|${t.ref.teachingNote ?? ''}`;
                const g = groups.get(key) ?? { names: [], provenance: t.ref.provenance, completeness: t.ref.completeness, note: t.ref.teachingNote };
                g.names.push(cleanLabel(t.ref.label));
                groups.set(key, g);
              }
              return [...groups.entries()].map(([key, g]) => (
                <div key={key} className="ref-group">
                  <p>{g.names.join(', ')}</p>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <ProvenanceChip provenance={g.provenance} />
                    <span className="chip">{g.completeness.replace(/_/g, ' ')}</span>
                  </div>
                  {g.note ? <small className="faint">{g.note}</small> : null}
                </div>
              ));
            })()}
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
              <h3>Similar cases, other patients</h3>
              {similar.map((c) => (
                <Link key={c.id} to={`/read/${c.id}?mode=practice`} className="btn sm" style={{ justifyContent: 'flex-start' }}>
                  {c.neutralTitle}
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
