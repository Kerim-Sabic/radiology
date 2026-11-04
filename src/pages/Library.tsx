import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { Empty, formatBytes, Loading } from '../components/ui';
import { AI_LABEL } from '../lib/provenance';
import { LockedLibrary } from '../components/Upgrade';
import { caseOfWeek } from '../content/weekly';
import type { Series } from '../schema/content';

const PAGE = 48;

interface CaseInfo {
  series: Series[];
  modalities: string[];
  labels: { expert: number; ai: number; total: number };
  full: boolean;
  /** Lower-case title, modalities and regions, for the text filter. */
  words: string;
}

export function LibraryPage() {
  const { catalog, attempts } = useApp();
  const [region, setRegion] = useState('all');
  const [modality, setModality] = useState('all');
  const [pairedOnly, setPairedOnly] = useState(false);
  const [labelledOnly, setLabelledOnly] = useState(false);
  const [text, setText] = useState('');
  const cases = useMemo(() => (catalog ? [...catalog.cases.values()] : []), [catalog]);
  // Everything a card or a filter needs, worked out once per catalog (never per keystroke or per filter change).
  const info = useMemo(() => {
    const out = new Map<string, CaseInfo>();
    if (!catalog) return out;
    for (const c of cases) {
      const all = catalog.seriesForCase(c);
      const series = all.filter((s) => s.role !== 'scout');
      const modalities = [...new Set(series.map((s) => s.modality))];
      const labels = catalog.anatomyCounts(c.id);
      // "Fully labelled": every organ in the field of view outlined (≥20 on cross-sectional studies; the 14-structure set on a radiograph).
      const xrOnly = all.every((s) => s.modality === 'CR' || s.modality === 'DX');
      const full = labels.total >= 20 || (xrOnly && labels.total >= 12);
      out.set(c.id, { series, modalities, labels, full, words: `${c.neutralTitle} ${modalities.join(' ')} ${c.region.join(' ')}`.toLowerCase() });
    }
    return out;
  }, [catalog, cases]);
  const regions = useMemo(() => [...new Set(cases.flatMap((c) => c.region))].sort(), [cases]);
  const mods = useMemo(() => [...new Set([...info.values()].flatMap((x) => x.modalities))].sort(), [info]);
  const seen = useMemo(() => new Set(attempts.map((a) => a.holdoutGroup)), [attempts]);
  const weekly = caseOfWeek().caseId;

  const filtered = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = cases.filter((c) => {
      const x = info.get(c.id);
      if (!x) return false;
      if (labelledOnly && !x.full) return false;
      if (region !== 'all' && !c.region.includes(region)) return false;
      if (modality !== 'all' && !x.modalities.includes(modality)) return false;
      if (pairedOnly && c.studyUids.length < 2) return false;
      return words.every((w) => x.words.includes(w));
    });
    return labelledOnly ? out.sort((a, b) => (info.get(b.id)?.labels.total ?? 0) - (info.get(a.id)?.labels.total ?? 0)) : out;
  }, [cases, info, text, region, modality, pairedOnly, labelledOnly]);

  // Cards are drawn a page at a time; more are added as the end of the list comes near.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [text, region, modality, pairedOnly, labelledOnly]);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((n) => n + PAGE), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered, limit]);

  if (!catalog) return <Loading page label="Loading the case library…" />;
  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <div className="lib-head">
        <h1>Cases</h1>
        <span className="faint">
          Titles stay neutral so a case never tells you its diagnosis. Looking for one? <Link to="/conditions">Search by condition</Link>.
        </span>
      </div>
      <div className="lib-filters">
        <input
          type="search"
          className="lib-find"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Patient code or scan, e.g. NW, CT, breast"
          aria-label="Find a patient or scan"
        />
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
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={pairedOnly} onChange={(e) => setPairedOnly(e.target.checked)} /> Same-patient comparisons
        </label>
        <label className="row" style={{ gap: 6 }}>
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
        <>
        <span className="faint" aria-live="polite">
          {filtered.length === cases.length ? `${cases.length} patients` : `${filtered.length} of ${cases.length} patients`}
        </span>
        <div className="grid-3">
          {filtered.slice(0, limit).map((c) => {
            const { series, modalities, labels, full } = info.get(c.id)!;
            const thumbs = series.slice(0, 3).map((s) => catalog.thumbnailUrl(s.uid));
            const tasks = catalog.tasksByCase.get(c.id) ?? [];
            const bytes = series.reduce((a, s) => a + s.bytes, 0);
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
                  {labels.total ? (
                    <span className={`chip ${full ? 'accent' : ''}`} title={`${labels.expert} expert-drawn, ${labels.ai} ${AI_LABEL} anatomy outlines`}>
                      {full ? 'Full anatomy · ' : ''}
                      {labels.total} labels
                    </span>
                  ) : null}
                </div>
                <small className="faint">
                  {tasks.length} task(s) · {series.length} series · {formatBytes(bytes)}
                </small>
              </Link>
            );
          })}
        </div>
        {limit < filtered.length ? (
          <div ref={more} className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
              Show more ({filtered.length - limit} left)
            </button>
          </div>
        ) : null}
        </>
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
