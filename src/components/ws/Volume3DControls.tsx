import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ChevronDown, ChevronRight, HeartPulse, RotateCcw, Scissors, X } from 'lucide-react';
import { NO_CUT, PLANE_COLORS, type Cut3D, type PlaneKind, type Side, type ViewerEngine } from '../../viewer/engine';
import type { LoadedTarget } from '../../grading/spatialGrader';
import { GROUP_LABEL, GROUP_ORDER, type Group3D } from '../../viewer/anatomyMask';
import type { Structure3D } from '../../viewer/anatomy3d';
import type { Vec2 } from '../../lib/geometry';
import { plainName } from '../../lib/provenance';
import { inSentence } from '../../services/drill';
import { segStyle, withGroup, withStructure } from '../../viewer/segStyle';
import { ColorSwatch } from './SegStyleControls';

export interface ThreeDProps {
  /** Anatomy models follow the reference rules: Learn mode, Review, or after submitting. */
  allowed: boolean;
  loading: boolean;
  targets: LoadedTarget[];
  /** A quiz answer (counts towards the structure's drill reviews). */
  onAnswer?: (target: LoadedTarget, correct: boolean) => void;
}

// Every CT preset here keeps air (−1000 HU) fully transparent; presets that give air even a little opacity
// (CT-Air, CT-Chest-Vessels) turn the air around the body into a solid box and are left out.
const CT_PRESETS: Array<[string, string]> = [
  ['CT-Bone', 'Bone'],
  ['CT-Soft-Tissue', 'Soft tissue'],
  ['CT-Muscle', 'Muscle'],
  ['CT-Lung', 'Lungs'],
  ['CT-Chest-Contrast-Enhanced', 'Chest, contrast'],
  ['CT-Pulmonary-Arteries', 'Pulmonary arteries'],
  ['CT-AAA', 'Aorta and arteries'],
  ['CT-Cardiac', 'Heart'],
  ['CT-Coronary-Arteries', 'Coronary arteries'],
  ['CT-Liver-Vasculature', 'Liver vessels'],
  ['CT-MIP', 'MIP (brightest voxel)'],
];
const MR_PRESETS: Array<[string, string]> = [
  ['MR-Default', 'Default'],
  ['MR-Angio', 'Angiography'],
  ['MR-MIP', 'MIP (brightest voxel)'],
  ['MR-T2-Brain', 'T2 brain'],
];
const VIEWS: Array<[Side, string]> = [
  ['A', 'From the front'],
  ['P', 'From the back'],
  ['R', "From the patient's right"],
  ['L', "From the patient's left"],
  ['S', 'From above (head)'],
  ['I', 'From below (feet)'],
];
const AXES: Array<{ key: keyof Cut3D['box']; plane: PlaneKind; title: string; lo: string; hi: string; sides: [Side, string][] }> = [
  { key: 'x', plane: 'sagittal', title: 'Right ↔ left', lo: 'R', hi: 'L', sides: [['R', 'Keep right'], ['L', 'Keep left']] },
  { key: 'y', plane: 'coronal', title: 'Front ↔ back', lo: 'Front', hi: 'Back', sides: [['A', 'Keep front'], ['P', 'Keep back']] },
  { key: 'z', plane: 'axial', title: 'Feet ↔ head', lo: 'Feet', hi: 'Head', sides: [['I', 'Keep feet side'], ['S', 'Keep head side']] },
];
/** Whole structures left out of a group pick when their parts are labelled (the parts are what you want to see). */
const WHOLE_WHEN_PARTS: Array<[RegExp, RegExp]> = [
  [/^heart$/, /^heart_(atrium|ventricle)_/],
  [/^aorta$/, /^aorta_/],
  [/^colon$/, /^colon_/],
  [/^lung_left$/, /^lung_\w+_lobe_left$/],
  [/^lung_right$/, /^lung_\w+_lobe_right$/],
];
const QUICK: Array<[string, Group3D[]]> = [
  ['Findings', ['findings']],
  ['Heart & great vessels', ['heart', 'arteries', 'veins']],
  ['Arteries', ['arteries']],
  ['Veins', ['veins']],
  ['Airways & lungs', ['airways', 'lungs']],
  ['Bones', ['bones']],
  ['Organs', ['abdomen']],
];

type Pane = 'cut' | 'anatomy' | null;

export function Volume3DControls(p: {
  engine: ViewerEngine;
  panelId: string;
  seriesUid: string;
  modality: string;
  threeD: ThreeDProps;
  clickRef: MutableRefObject<((c: Vec2) => void) | null>;
}) {
  const { engine, panelId } = p;
  const [pane, setPane] = useState<Pane>(null);
  const preset = engine.get3DPreset(panelId) ?? '';
  const presets = p.modality === 'CT' ? CT_PRESETS : MR_PRESETS;
  const cut = engine.get3DCut(panelId);
  const cutOn = JSON.stringify(cut) !== JSON.stringify(NO_CUT);
  const anat = engine.anatomy3dState(panelId);
  const shownCount = anat?.structures.filter((s) => s.shown).length ?? 0;

  useEffect(() => {
    if (p.threeD.allowed && p.threeD.targets.length) engine.setAnatomy3dTargets(panelId, p.threeD.targets);
  }, [engine, panelId, p.threeD.allowed, p.threeD.targets]);

  return (
    <div className="v3d-ui">
      <div className="v3d-bar" onMouseDown={(e) => e.stopPropagation()}>
        <select value={preset} onChange={(e) => engine.set3DPreset(panelId, e.target.value)} aria-label="3D rendering preset" title="What the 3D rendering shows (vessel presets need a contrast-enhanced scan)">
          {presets.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) engine.set3DView(panelId, e.target.value as Side);
          }}
          aria-label="Turn the 3D view to face one side"
          title="Turn the view (drag on the image to rotate freely)"
        >
          <option value="">View</option>
          {VIEWS.map(([side, title]) => (
            <option key={side} value={side}>
              {title}
            </option>
          ))}
        </select>
        <button className={`btn sm${pane === 'cut' || cutOn ? ' on' : ''}`} onClick={() => setPane(pane === 'cut' ? null : 'cut')} aria-expanded={pane === 'cut'} aria-label="Cut" title="Cut away part of the 3D view">
          <Scissors size={13} /> <span className="v3d-label">Cut</span>
        </button>
        <button className={`btn sm${pane === 'anatomy' || shownCount ? ' on' : ''}`} onClick={() => setPane(pane === 'anatomy' ? null : 'anatomy')} aria-expanded={pane === 'anatomy'} aria-label={shownCount ? `Structures (${shownCount} shown)` : "Structures"} title="Show only chosen structures (heart, arteries, veins…)">
          <HeartPulse size={13} /> <span className="v3d-label">Structures</span>{shownCount ? ` ${shownCount}` : ''}
        </button>
        <button className="btn sm ghost" title="Reset the 3D view (turn, zoom and cut)" aria-label="Reset the 3D view" onClick={() => {
          engine.set3DCut(panelId, null);
          engine.set3DView(panelId, 'A');
        }}>
          <RotateCcw size={13} />
        </button>
      </div>
      {pane === 'cut' ? <CutPane engine={engine} panelId={panelId} seriesUid={p.seriesUid} cut={cut} onClose={() => setPane(null)} /> : null}
      {pane === 'anatomy' ? <AnatomyPane {...p} onClose={() => setPane(null)} /> : null}
    </div>
  );
}

function CutPane(p: { engine: ViewerEngine; panelId: string; seriesUid: string; cut: Cut3D; onClose: () => void }) {
  const { engine, panelId, cut } = p;
  const set = (c: Cut3D) => engine.set3DCut(panelId, c);
  const planes = AXES.filter((a) => engine.hasPlane(p.seriesUid, a.plane));
  return (
    <div className="v3d-pane" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Cut the 3D view">
      <div className="v3d-pane-head">
        <b>Cut</b>
        <button className="btn sm ghost" onClick={p.onClose} aria-label="Close">
          <X size={13} />
        </button>
      </div>
      <p className="faint">Drag the handles to keep only part of the body. Everything outside is cut away, including the structure models.</p>
      {AXES.map((a) => {
        const following = cut.follow[a.plane];
        return (
          <DualRange
            key={a.key}
            title={a.title}
            lo={a.lo}
            hi={a.hi}
            value={cut.box[a.key]}
            disabled={!!following}
            note={following ? `Cut at the ${a.plane} slice` : null}
            onChange={(v) => set({ ...cut, box: { ...cut.box, [a.key]: v } })}
          />
        );
      })}
      <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
        <button className="btn sm" onClick={() => set({ ...cut, box: { ...cut.box, y: [0.5, 1] } })}>
          Take off the front half
        </button>
        <button className="btn sm" onClick={() => set({ ...cut, box: { ...cut.box, x: [0, 0.5] } })}>
          Take off the left half
        </button>
        <button className="btn sm" onClick={() => set(NO_CUT)}>
          No cut
        </button>
      </div>
      {planes.length ? (
        <>
          <h4 className="v3d-sub">Cut at the slice you are reading</h4>
          <p className="faint">The cut follows that view: scroll it and the 3D moves with it.</p>
          {planes.map((a) => (
            <div key={a.plane} className="v3d-follow">
              <span className="plane-dot" style={{ background: PLANE_COLORS[a.plane] }} aria-hidden />
              <span style={{ textTransform: 'capitalize', minWidth: 62 }}>{a.plane}</span>
              <span className="seg" role="group" aria-label={`Cut at the ${a.plane} slice`}>
                {[[null, 'Off'] as const, ...a.sides].map(([side, label]) => (
                  <button
                    key={label}
                    className={`btn sm${(cut.follow[a.plane] ?? null) === side ? ' on' : ''}`}
                    aria-pressed={(cut.follow[a.plane] ?? null) === side}
                    onClick={() => {
                      const follow = { ...cut.follow };
                      if (side) follow[a.plane] = side;
                      else delete follow[a.plane];
                      set({ ...cut, follow });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </>
      ) : (
        <p className="faint" style={{ marginTop: 8 }}>
          In the MPR + 3D layout the cut can also follow the slice you are reading.
        </p>
      )}
    </div>
  );
}

function DualRange(p: { title: string; lo: string; hi: string; value: [number, number]; disabled?: boolean; note?: string | null; onChange: (v: [number, number]) => void }) {
  const [a, b] = p.value;
  return (
    <div className={`dual${p.disabled ? ' disabled' : ''}`}>
      <div className="dual-head">
        <span className="faint">{p.lo}</span>
        <b>{p.note ?? p.title}</b>
        <span className="faint">{p.hi}</span>
      </div>
      <div className="dual-track">
        <div className="dual-fill" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(a * 100)}
          disabled={p.disabled}
          aria-label={`${p.title}: ${p.lo} edge`}
          onChange={(e) => p.onChange([Math.min(Number(e.target.value) / 100, b - 0.02), b])}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(b * 100)}
          disabled={p.disabled}
          aria-label={`${p.title}: ${p.hi} edge`}
          onChange={(e) => p.onChange([a, Math.max(Number(e.target.value) / 100, a + 0.02)])}
        />
      </div>
    </div>
  );
}

function preferred(list: Structure3D[]): Structure3D[] {
  const keys = list.map((s) => s.key);
  return list.filter((s) => !WHOLE_WHEN_PARTS.some(([whole, part]) => whole.test(s.key) && keys.some((k) => part.test(k))));
}

function AnatomyPane(p: { engine: ViewerEngine; panelId: string; threeD: ThreeDProps; clickRef: MutableRefObject<((c: Vec2) => void) | null>; onClose: () => void }) {
  const { engine, panelId, threeD } = p;
  const a = engine.anatomy3dState(panelId);
  const model = engine.anatomy3d(panelId);
  const [open, setOpen] = useState<Set<Group3D>>(new Set());
  const [quiz, setQuiz] = useState(false);
  const structures = useMemo(() => a?.structures ?? [], [a]);
  const byGroup = useMemo(() => {
    const m = new Map<Group3D, Structure3D[]>();
    for (const s of structures) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return m;
  }, [structures]);
  const shown = new Set(structures.filter((s) => s.shown).map((s) => s.id));
  const apply = (ids: Set<string>) => {
    // Picking structures from nothing isolates them: the CT around them is hidden until asked for.
    if (!shown.size && ids.size && a?.showVolume) model?.setShowVolume(false);
    if (!ids.size && a && !a.showVolume) model?.setShowVolume(true);
    model?.show(ids);
  };

  let body: React.ReactNode;
  if (!threeD.allowed) body = <p className="faint">Structure models open in Learn mode, in Review, or after you submit — they would give the answer away.</p>;
  else if (threeD.loading || (threeD.targets.length && !structures.length)) body = <p className="faint">Loading the outlines…</p>;
  else if (!structures.length) body = <p className="faint">No labelled structures on this series, so there is nothing to isolate.</p>;
  else if (quiz) body = <Quiz engine={engine} panelId={panelId} threeD={threeD} clickRef={p.clickRef} structures={structures} onExit={() => setQuiz(false)} />;
  else
    body = (
      <>
        <div className="row wrap" style={{ gap: 4 }}>
          {QUICK.filter(([, gs]) => gs.some((g) => byGroup.has(g))).map(([label, gs]) => (
            <button key={label} className="chip-btn" onClick={() => apply(new Set(preferred(gs.flatMap((g) => byGroup.get(g) ?? [])).map((s) => s.id)))}>
              {label}
            </button>
          ))}
          {shown.size ? (
            <button className="chip-btn" onClick={() => apply(new Set())}>
              Clear
            </button>
          ) : null}
        </div>
        <label className="row" style={{ gap: 6, margin: '8px 0 4px' }}>
          <input type="checkbox" checked={!!a?.showVolume} onChange={(e) => model?.setShowVolume(e.target.checked)} />
          Show the CT around them
        </label>
        <div className="v3d-groups">
          {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
            const list = byGroup.get(g)!;
            const pick = preferred(list);
            const on = pick.filter((s) => shown.has(s.id)).length;
            const isOpen = open.has(g);
            return (
              <div key={g} className="v3d-group">
                <div className="v3d-group-head">
                  <input
                    type="checkbox"
                    aria-label={`Show all ${GROUP_LABEL[g]}`}
                    checked={on === pick.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < pick.length;
                    }}
                    onChange={(e) => {
                      const next = new Set(shown);
                      for (const s of list) next.delete(s.id);
                      if (e.target.checked) for (const s of pick) next.add(s.id);
                      apply(next);
                    }}
                  />
                  <ColorSwatch colors={[...new Set(list.map((s) => s.color))]} label={`Colour of ${GROUP_LABEL[g]}`} onChange={(c) => segStyle.update((st) => withGroup(st, g, { color: c }))} size={12} />
                  <button className="linklike" onClick={() => setOpen((o) => new Set(o.has(g) ? [...o].filter((x) => x !== g) : [...o, g]))} aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {GROUP_LABEL[g]} <span className="faint">({list.length})</span>
                  </button>
                </div>
                {isOpen
                  ? list.map((s) => (
                      <div key={s.id} className="v3d-item">
                        <input
                          id={`v3d-${panelId}-${s.id}`}
                          type="checkbox"
                          checked={s.shown}
                          onChange={(e) => {
                            const next = new Set(shown);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            apply(next);
                          }}
                        />
                        <ColorSwatch colors={[s.color]} label={`Colour of ${s.label}`} onChange={(c) => segStyle.update((st) => withStructure(st, s.key, c))} size={11} />
                        <label htmlFor={`v3d-${panelId}-${s.id}`}>
                          {s.label}
                          {s.status === 'building' ? <span className="faint"> · building…</span> : s.status === 'empty' ? <span className="faint"> · nothing to draw</span> : null}
                        </label>
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, gap: 6 }}>
          <span className="faint">{a?.building ? `Building ${a.building} model${a.building > 1 ? 's' : ''}…` : 'Hover a model to name it.'}</span>
          <button className="btn sm" disabled={structures.filter((s) => s.shown && s.status === 'ready').length < 4} onClick={() => setQuiz(true)} title="Needs at least four structures on screen">
            Quiz me
          </button>
        </div>
        <p className="faint" style={{ marginTop: 6, fontSize: 11 }}>
          Models are built from the AI outlines (not checked by a radiologist); slices far apart make them look stepped.
        </p>
      </>
    );

  return (
    <div className="v3d-pane" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Structures in 3D">
      <div className="v3d-pane-head">
        <b>{quiz ? '3D quiz' : 'Structures in 3D'}</b>
        <button className="btn sm ghost" onClick={p.onClose} aria-label="Close">
          <X size={13} />
        </button>
      </div>
      {body}
    </div>
  );
}

type QuizMode = 'name' | 'find';
interface Question {
  target: Structure3D;
  /** Answer options (names without "partially imaged"); the right one is plainName(target.label). */
  options: string[];
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Quiz(p: { engine: ViewerEngine; panelId: string; threeD: ThreeDProps; clickRef: MutableRefObject<((c: Vec2) => void) | null>; structures: Structure3D[]; onExit: () => void }) {
  const { engine, panelId } = p;
  const model = engine.anatomy3d(panelId);
  const [mode, setMode] = useState<QuizMode>('name');
  const [q, setQ] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<{ correct: boolean; text: string } | null>(null);
  const [score, setScore] = useState({ right: 0, asked: 0 });
  const recent = useRef<string[]>([]);
  const pool = p.structures.filter((s) => s.shown && s.status === 'ready');

  const next = (m: QuizMode = mode) => {
    const fresh = pool.filter((s) => !recent.current.includes(s.id));
    const target = shuffle(fresh.length ? fresh : pool)[0];
    if (!target) return;
    recent.current = [target.id, ...recent.current].slice(0, Math.min(3, pool.length - 1));
    const same = shuffle(p.structures.filter((s) => s.id !== target.id && s.group === target.group).map((s) => plainName(s.label)));
    const other = shuffle(p.structures.filter((s) => s.id !== target.id && s.group !== target.group).map((s) => plainName(s.label)));
    const name = plainName(target.label);
    const options = shuffle([name, ...[...new Set([...same, ...other])].filter((l) => l !== name).slice(0, 3)]);
    setQ({ target, options });
    setAnswer(null);
    model?.setQuiz(true);
    model?.highlight(m === 'name' ? target.id : null, m === 'name');
  };
  const record = (correct: boolean, text: string) => {
    if (!q) return;
    setAnswer({ correct, text });
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), asked: s.asked + 1 }));
    const t = p.threeD.targets.find((x) => x.ref.id === q.target.id);
    if (t) p.threeD.onAnswer?.(t, correct);
    model?.highlight(q.target.id, true); // show where it is
  };

  useEffect(() => {
    next('name');
    return () => {
      p.clickRef.current = null;
      model?.setQuiz(false);
      model?.highlight(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    p.clickRef.current =
      mode === 'find' && q && !answer
        ? (c) => {
            const hit = model?.pick(c) ?? null;
            if (!hit) return; // a click on empty space is not an answer
            const want = inSentence(plainName(q.target.label));
            const got = model?.label(hit);
            record(hit === q.target.id, hit === q.target.id ? `Yes — that is the ${want}.` : `That is the ${got ? inSentence(plainName(got)) : 'another structure'}. The ${want} is lit up now.`);
          }
        : null;
  });

  if (!q) return <p className="faint">Show at least four structures to start.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="seg" role="group" aria-label="Quiz type">
        {(
          [
            ['name', 'Name it'],
            ['find', 'Find it'],
          ] as const
        ).map(([m, l]) => (
          <button
            key={m}
            className={`btn sm${mode === m ? ' on' : ''}`}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              next(m);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {mode === 'name' ? (
        <>
          <div>Which structure is lit up?</div>
          <div className="stack" style={{ gap: 4 }}>
            {q.options.map((o) => (
              <button
                key={o}
                className={`btn sm${answer && o === plainName(q.target.label) ? ' ok' : ''}`}
                disabled={!!answer}
                onClick={() => record(o === plainName(q.target.label), o === plainName(q.target.label) ? 'Correct.' : `No — it is the ${inSentence(plainName(q.target.label))}.`)}
                style={{ justifyContent: 'flex-start' }}
              >
                {o}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div>
          Click the <b>{inSentence(plainName(q.target.label))}</b> in the 3D view. <span className="faint">Turn the view first if it is hidden behind something.</span>
        </div>
      )}
      {answer ? (
        <div className={`v3d-answer ${answer.correct ? 'ok' : 'bad'}`} role="status">
          {answer.correct ? '✓ ' : '✗ '}
          {answer.text}
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span className="faint">
          {score.right}/{score.asked} right · counts towards your drill reviews
        </span>
        <span className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={p.onExit}>
            Stop
          </button>
          <button className="btn sm primary" onClick={() => next()}>
            Next
          </button>
        </span>
      </div>
    </div>
  );
}
