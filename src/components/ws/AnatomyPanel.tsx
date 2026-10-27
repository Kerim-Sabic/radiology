import { useMemo, useState } from 'react';
import { Eye, Layers } from 'lucide-react';
import type { LoadedTarget } from '../../grading/spatialGrader';
import { CATEGORY_COLORS, categoryFor } from './overlayShapes';
import { AI_DRAFT_BY, cleanLabel as clean, isAutomatic, provenanceTag } from '../../lib/provenance';

interface Props {
  allowed: boolean;
  on: boolean;
  loading: boolean;
  targets: LoadedTarget[]; // structures on the series shown in the focused panel
  totalOnStudy: number;
  presentIds: Set<string>; // outlined on the image currently displayed
  showNames: boolean;
  hidden: Set<string>;
  isolateId: string | null;
  onToggle: (on: boolean) => void;
  onShowNames: (v: boolean) => void;
  onToggleCategory: (c: string) => void;
  onPick: (t: LoadedTarget) => void;
  onShowAll: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  organ: 'Organs',
  airway: 'Airways & lungs',
  vessel: 'Heart & vessels',
  bone: 'Bones',
  muscle: 'Muscles',
  gland: 'Glands',
  other: 'Other',
};
const ORDER = ['organ', 'airway', 'vessel', 'bone', 'muscle', 'gland', 'other'];
const isAi = (t: LoadedTarget) => isAutomatic(t.ref.provenance);

export function AnatomyPanel(p: Props) {
  const [q, setQ] = useState('');
  const [onlyHere, setOnlyHere] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, LoadedTarget[]>();
    for (const t of p.targets) {
      if (q && !clean(t.ref.label).toLowerCase().includes(q.toLowerCase())) continue;
      if (onlyHere && !p.presentIds.has(t.ref.id)) continue;
      const c = categoryFor(t.ref);
      m.set(c, [...(m.get(c) ?? []), t]);
    }
    for (const arr of m.values()) arr.sort((a, b) => clean(a.ref.label).localeCompare(clean(b.ref.label), undefined, { numeric: true }));
    return [...m.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [p.targets, q, onlyHere, p.presentIds]);

  if (!p.allowed)
    return <div className="notice">Anatomy labels are available in Learn and Review mode, and after you submit in Practice or Assess — so they never give an answer away.</div>;

  const expert = p.targets.filter((t) => !isAi(t)).length;
  const ai = p.targets.length - expert;
  const isolated = p.targets.find((t) => t.ref.id === p.isolateId);

  return (
    <div className="stack" style={{ gap: 10 }}>
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
      ) : (
        <div className="row wrap">
          <button className={`btn${p.on ? ' primary' : ''}`} onClick={() => p.onToggle(!p.on)}>
            {p.on ? 'Hide all outlines' : 'Show all outlines'}
          </button>
          <label className="row" style={{ gap: 4, color: 'var(--text)' }}>
            <input type="checkbox" checked={p.showNames} onChange={(e) => p.onShowNames(e.target.checked)} /> Names on image
          </label>
        </div>
      )}
      <small className="muted">
        <b>Click a structure to see only it</b> — the viewer jumps to the slice where it is largest and centres it. {p.targets.length} structures on this series
        {p.totalOnStudy > p.targets.length ? ` (${p.totalOnStudy} across this patient's series)` : ''}: {expert} expert, {ai} {AI_DRAFT_BY}{p.loading ? ' — loading…' : ''}.
      </small>
      <div className="stack" style={{ gap: 2, fontSize: 12 }}>
        <span>
          <span className="legend-swatch" style={{ borderColor: '#e7ebf0' }} /> solid outline = expert label from the source dataset
        </span>
        <span>
          <span className="legend-swatch" style={{ borderColor: '#e7ebf0', borderTopStyle: 'dashed' }} /> dashed = {AI_DRAFT_BY} (quality-checked, not yet reviewed by a radiologist; edges can be a few mm off)
        </span>
      </div>
      <div className="row wrap">
        {ORDER.map((c) =>
          groups.some(([g]) => g === c) || p.hidden.has(c) ? (
            <button key={c} className="chip" aria-pressed={!p.hidden.has(c)} onClick={() => p.onToggleCategory(c)} title="Show/hide this group on the image">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[c] }} /> {CATEGORY_LABEL[c]}
            </button>
          ) : null,
        )}
      </div>
      <div className="row">
        <input type="search" placeholder="Find a structure (kidney, rib 5, aorta…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a structure" style={{ flex: 1 }} />
        <label className="row" style={{ gap: 4, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} /> On this slice
        </label>
      </div>
      {p.targets.length === 0 && !p.loading ? <small className="faint">No anatomical outlines exist for this series yet.</small> : null}
      {groups.map(([cat, items]) => (
        <div key={cat} className="stack" style={{ gap: 0 }}>
          <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '6px 0 2px' }}>
            {CATEGORY_LABEL[cat] ?? cat} · {items.length}
          </div>
          {items.map((t) => (
            <button
              key={t.ref.id}
              className={`anat-item${p.presentIds.has(t.ref.id) ? ' here' : ''}`}
              aria-current={p.isolateId === t.ref.id}
              onClick={() => p.onPick(t)}
              title={p.presentIds.has(t.ref.id) ? 'Visible on the current slice — click to show only this structure' : 'Click to jump to it and show only this structure'}
            >
              <span className="dot" style={{ background: CATEGORY_COLORS[cat] ?? '#fff' }} />
              <span style={{ flex: 1 }}>{clean(t.ref.label)}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>
                {provenanceTag(t.ref.provenance)}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
