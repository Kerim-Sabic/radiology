import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Eye, Layers, RotateCcw, Target } from 'lucide-react';
import type { LoadedTarget } from '../../grading/spatialGrader';
import { AI_CREDIT, AI_LABEL, cleanLabel as clean, isAutomatic, provenanceTag } from '../../lib/provenance';
import { noteFor } from '../../content/structureNotes';
import { canonicalAnatomyKey } from '../../content/bookAnatomy';
import { GROUP_LABEL, GROUP_ORDER, groupFor, type Group3D } from '../../viewer/anatomyMask';
import { colorOf, lookOf, segStyle, withGroup, withStructure } from '../../viewer/segStyle';
import { ColorSwatch, LookSwitch, SegStyleBar, useSegStyle } from './SegStyleControls';

interface Props {
  allowed: boolean;
  on: boolean;
  loading: boolean;
  targets: LoadedTarget[]; // structures on the series shown in the focused panel
  totalOnStudy: number;
  presentIds: Set<string>; // outlined on the image currently displayed
  showNames: boolean;
  /** Groups hidden on the image (see Group3D). */
  hidden: Set<string>;
  isolateId: string | null;
  /** 'XR' | 'CT' | 'MR' of the focused series, for the right wording of notes. */
  family?: string;
  onToggle: (on: boolean) => void;
  onShowNames: (v: boolean) => void;
  onToggleGroup: (g: Group3D) => void;
  onPick: (t: LoadedTarget) => void;
  onShowAll: () => void;
  /** A free account: only the main structures are labelled (the rest is for members). */
  limited?: boolean;
  onUpgrade?: () => void;
}

const isAi = (t: LoadedTarget) => isAutomatic(t.ref.provenance);
const keyOf = (t: LoadedTarget) => canonicalAnatomyKey(t.ref.classId);

export function AnatomyPanel(p: Props) {
  const [q, setQ] = useState('');
  const [onlyHere, setOnlyHere] = useState(false);
  const style = useSegStyle();
  // Every group on this series keeps its header (colour, fill, show/hide) even when the search hides its items.
  const groups = useMemo(() => {
    const m = new Map<Group3D, { all: LoadedTarget[]; items: LoadedTarget[] }>();
    for (const t of p.targets) {
      const g = groupFor(keyOf(t));
      const e = m.get(g) ?? { all: [], items: [] };
      e.all.push(t);
      if ((!q || clean(t.ref.label).toLowerCase().includes(q.toLowerCase())) && (!onlyHere || p.presentIds.has(t.ref.id))) e.items.push(t);
      m.set(g, e);
    }
    for (const e of m.values()) e.items.sort((a, b) => clean(a.ref.label).localeCompare(clean(b.ref.label), undefined, { numeric: true }));
    return [...m.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [p.targets, q, onlyHere, p.presentIds]);

  if (!p.allowed)
    return <div className="notice">Anatomy labels are available in Learn and Review mode, and after you submit in Practice or Assess — so they never give an answer away.</div>;

  const expert = p.targets.filter((t) => !isAi(t)).length;
  const ai = p.targets.length - expert;
  const isolated = p.targets.find((t) => t.ref.id === p.isolateId);

  return (
    <div className="stack" style={{ gap: 10 }}>
      {p.limited ? (
        <div className="notice info row" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>
            Free account: the main structures only. Members see every labelled structure on every patient: lobes, ribs, vertebrae, vessels and more.
          </span>
          {p.onUpgrade ? (
            <button className="btn sm primary" onClick={p.onUpgrade}>
              See plans
            </button>
          ) : null}
        </div>
      ) : null}
      {isolated ? (
        <div className="notice info row" style={{ gap: 8 }}>
          <Eye size={15} />
          <span style={{ flex: 1 }}>
            Showing only <b>{clean(isolated.ref.label)}</b>
          </span>
          <button className="btn sm" onClick={p.onShowAll}>
            <Layers size={13} /> Show all
          </button>
        </div>
      ) : null}
      {isolated ? <StructureColor target={isolated} /> : null}
      {isolated ? <StructureNoteCard target={isolated} family={p.family} /> : (
        <div className="row wrap">
          <button className={`btn${p.on ? ' primary' : ''}`} onClick={() => p.onToggle(!p.on)}>
            {p.on ? 'Hide all outlines' : 'Show all outlines'}
          </button>
          <label className="row" style={{ gap: 4, color: 'var(--text)' }}>
            <input type="checkbox" checked={p.showNames} onChange={(e) => p.onShowNames(e.target.checked)} /> Names on image
          </label>
          <label className="row" style={{ gap: 4, color: 'var(--text)' }}>
            <input type="checkbox" checked={style.legend} onChange={(e) => segStyle.update((s) => ({ ...s, legend: e.target.checked }))} /> Colour key
          </label>
        </div>
      )}
      <small className="muted">
        <b>Click a structure to see only it</b> — the viewer jumps to the slice where it is largest and centres it. {p.targets.length} structures on this series
        {p.totalOnStudy > p.targets.length ? ` (${p.totalOnStudy} across this patient's series)` : ''}: {expert} expert, {ai} {AI_LABEL}{p.loading ? ' — loading…' : ''}.
      </small>
      <div className="stack" style={{ gap: 2, fontSize: 12 }}>
        <span>
          <span className="legend-swatch" style={{ borderColor: '#e7ebf0' }} /> solid outline = expert label from the source dataset
        </span>
        <span>
          <span className="legend-swatch" style={{ borderColor: '#e7ebf0', borderTopStyle: 'dashed' }} /> dashed = {AI_LABEL} (quality-checked, not yet reviewed by a radiologist; edges can be a few mm off).{' '}
          <a href={AI_CREDIT.url} target="_blank" rel="noopener">
            Thanks to {AI_CREDIT.name}
          </a>
          , every structure here is marked.
        </span>
      </div>
      {p.targets.length ? <SegStyleBar /> : null}
      <div className="row">
        <input type="search" placeholder="Find a structure (kidney, rib 5, aorta…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a structure" style={{ flex: 1 }} />
        <label className="row" style={{ gap: 4, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} /> On this slice
        </label>
      </div>
      {p.targets.length === 0 && !p.loading ? <small className="faint">No anatomical outlines exist for this series yet.</small> : null}
      {groups.map(([g, { all, items }]) => {
        const label = GROUP_LABEL[g];
        const off = p.hidden.has(g);
        return (
          <div key={g} className={`anat-group${off ? ' off' : ''}`} data-group={g}>
            <div className="anat-group-head">
              <input type="checkbox" checked={!off} onChange={() => p.onToggleGroup(g)} aria-label={`Show ${label} on the image`} title="Show or hide this group on the image" />
              <ColorSwatch
                colors={[...new Set(all.map((t) => colorOf(style, keyOf(t), g)))]}
                label={`Colour of ${label}`}
                onChange={(c) => segStyle.update((s) => withGroup(s, g, { color: c }))}
              />
              <span className="anat-group-name">
                {label} <span className="faint">· {all.length}</span>
              </span>
              {style.groups[g]?.color ? (
                <button className="btn sm ghost icon" onClick={() => segStyle.update((s) => withGroup(s, g, { color: null }))} aria-label={`${label}: back to atlas colours`} title="Back to atlas colours">
                  <RotateCcw size={11} />
                </button>
              ) : null}
              <LookSwitch look={lookOf(style, g)} label={label} onChange={(l) => segStyle.update((s) => withGroup(s, g, { look: l }))} />
            </div>
            {items.map((t) => (
            <button
              key={t.ref.id}
              className={`anat-item${p.presentIds.has(t.ref.id) ? ' here' : ''}`}
              aria-current={p.isolateId === t.ref.id}
              onClick={() => p.onPick(t)}
              title={p.presentIds.has(t.ref.id) ? 'Visible on the current slice — click to show only this structure' : 'Click to jump to it and show only this structure'}
            >
              <span className="dot" style={{ background: colorOf(style, keyOf(t), g) }} />
              <span style={{ flex: 1 }}>{clean(t.ref.label)}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>
                {provenanceTag(t.ref.provenance)}
              </span>
            </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The colour of the structure shown alone: its own colour, or back to its group's. */
function StructureColor({ target }: { target: LoadedTarget }) {
  const style = useSegStyle();
  const key = keyOf(target);
  const name = clean(target.ref.label);
  return (
    <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
      <ColorSwatch colors={[colorOf(style, key)]} label={`Colour of ${name}`} onChange={(c) => segStyle.update((s) => withStructure(s, key, c))} size={18} />
      <span>Colour of {name}</span>
      {style.structures[key] ? (
        <button className="btn sm ghost" onClick={() => segStyle.update((s) => withStructure(s, key, null))}>
          <RotateCcw size={11} /> Group colour
        </button>
      ) : null}
    </div>
  );
}

/** "What am I looking at?" — how it looks, what it touches, one pitfall, and where the book teaches it. */
export function StructureNoteCard({ target, family }: { target: LoadedTarget; family?: string }) {
  const key = canonicalAnatomyKey(target.ref.classId);
  const n = noteFor(key, family);
  if (!n) return null;
  return (
    <div className="stack struct-note">
      <span>
        <b>Looks like:</b> {n.look}
      </span>
      <span>
        <b>Next to:</b> {n.near}
      </span>
      {n.pitfall ? (
        <span>
          <b>Pitfall:</b> {n.pitfall}
        </span>
      ) : null}
      <span className="row wrap" style={{ gap: 10, fontSize: 12 }}>
        <Link to={`/course/${n.unit}`}>Chapter in the book</Link>
        <Link to={`/drill?key=${encodeURIComponent(key)}`}>
          <Target size={12} /> Drill it on other patients
        </Link>
      </span>
    </div>
  );
}
