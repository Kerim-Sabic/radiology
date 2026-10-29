import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { Empty, formatBytes } from '../components/ui';
import { AI_DRAFT_BY } from '../lib/provenance';
import { LockedLibrary } from '../components/Upgrade';
import { caseOfWeek } from '../content/weekly';

export function LibraryPage() {
  const { catalog, attempts } = useApp();
  const [region, setRegion] = useState('all');
  const [modality, setModality] = useState('all');
  const [pairedOnly, setPairedOnly] = useState(false);
  const [labelledOnly, setLabelledOnly] = useState(false);
  const cases = useMemo(() => (catalog ? [...catalog.cases.values()] : []), [catalog]);
  const regions = [...new Set(cases.flatMap((c) => c.region))].sort();
  const mods = [...new Set(cases.flatMap((c) => catalog!.seriesForCase(c).map((s) => s.modality)))].sort();
  const seen = new Set(attempts.map((a) => a.holdoutGroup));
  const weekly = caseOfWeek().caseId;

  const counts = new Map(cases.map((c) => [c.id, catalog ? catalog.anatomyCounts(c.id) : { expert: 0, ai: 0, total: 0 }]));
  // "Fully labelled": every organ in the field of view outlined (≥20 on cross-sectional studies; the 14-structure set on a radiograph).
  const isFull = (id: string) => {
    const n = counts.get(id)?.total ?? 0;
    const k = catalog?.cases.get(id);
    const xrOnly = !!k && catalog!.seriesForCase(k).every((s) => s.modality === 'CR' || s.modality === 'DX');
    return n >= 20 || (xrOnly && n >= 12);
  };
  const filtered0 = cases.filter((c) => {
    if (labelledOnly && !isFull(c.id)) return false;
    const ms = new Set(catalog!.seriesForCase(c).map((s) => s.modality));
    if (region !== 'all' && !c.region.includes(region)) return false;
    if (modality !== 'all' && !ms.has(modality)) return false;
    if (pairedOnly && c.studyUids.length < 2) return false;
    return true;
  });
  const filtered = labelledOnly ? [...filtered0].sort((a, b) => (counts.get(b.id)?.total ?? 0) - (counts.get(a.id)?.total ?? 0)) : filtered0;

  if (!catalog) return <div className="page-inner">Loading…</div>;
  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <div className="row wrap">
        <h1>Cases</h1>
        <span className="faint">
          Titles stay neutral so a case never tells you its diagnosis. Looking for one? <Link to="/conditions">Search by condition</Link>.
        </span>
        <span className="spacer" />
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
          <option value="all">All regions</option>
          {regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={modality} onChange={(e) => setModality(e.target.value)} aria-label="Modality">
          <option value="all">All modalities</option>
          {mods.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={pairedOnly} onChange={(e) => setPairedOnly(e.target.checked)} /> Same-patient comparisons
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={labelledOnly} onChange={(e) => setLabelledOnly(e.target.checked)} /> Fully labelled anatomy
        </label>
      </div>
      {catalog.status.some((s) => s.status !== 'loaded') ? (
        <div className="notice">
          Some data packs are not installed:{' '}
          {catalog.status
            .filter((s) => s.status !== 'loaded')
            .map((s) => `${s.title} (${s.status})`)
            .join(', ')}
          . See <Link to="/settings">Settings → Data packs</Link>.
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <Empty title="No cases match">Try another filter, or install more data packs.</Empty>
      ) : (
        <div className="grid-3">
          {filtered.map((c) => {
            const series = catalog.seriesForCase(c).filter((s) => s.role !== 'scout');
            const thumbs = series.slice(0, 3).map((s) => catalog.thumbnailUrl(s.uid));
            const tasks = catalog.tasksByCase.get(c.id) ?? [];
            const bytes = series.reduce((a, s) => a + s.bytes, 0);
            const modalities = [...new Set(series.map((s) => s.modality))];
            return (
              <Link key={c.id} className="case-card" to={labelledOnly ? `/read/${c.id}?mode=learn` : `/read/${c.id}?mode=practice`}>
                <div className="case-thumbs" aria-hidden>
                  {thumbs.map((t, i) => (
                    <span key={i} style={t ? { backgroundImage: `url(${t})` } : undefined} />
                  ))}
                </div>
                <b>{c.neutralTitle}</b>
                <div className="row wrap">
                  {modalities.map((m) => (
                    <span key={m} className="chip">
                      {m}
                    </span>
                  ))}
                  {c.id === weekly ? <span className="chip warn">Case of the week</span> : null}
                  {c.studyUids.length > 1 ? <span className="chip accent">Same patient · {c.studyUids.length} exams</span> : null}
                  {seen.has(catalog.holdoutGroup(c.id)) ? <span className="chip">Seen</span> : <span className="chip ok">Unseen</span>}
                  {(() => {
                    const n = counts.get(c.id)!;
                    if (!n.total) return null;
                    return (
                      <span className={`chip ${isFull(c.id) ? 'accent' : ''}`} title={`${n.expert} expert-drawn, ${n.ai} ${AI_DRAFT_BY} anatomy outlines`}>
                        {isFull(c.id) ? 'Full anatomy · ' : ''}
                        {n.total} labels
                      </span>
                    );
                  })()}
                </div>
                <small className="faint">
                  {tasks.length} task(s) · {series.length} series · {formatBytes(bytes)}
                </small>
              </Link>
            );
          })}
        </div>
      )}
      <LockedLibrary />
      {catalog.invalidCases.length ? (
        <details>
          <summary className="faint">{catalog.invalidCases.length} authored item(s) hidden because their assets did not validate</summary>
          <ul className="faint">
            {catalog.invalidCases.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span>: {c.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
