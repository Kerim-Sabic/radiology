import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, Search } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { Empty, Loading } from '../components/ui';
import { AI_LABEL } from '../lib/provenance';
import { LockedLibrary } from '../components/Upgrade';
import { caseOfWeek } from '../content/weekly';
import { modalityName } from '../services/teaser';
import type { Series } from '../schema/content';

const PAGE = 48;
/** The modality pills, in the order a radiology course teaches them. */
const MODALITY_ORDER = ['CT', 'MRI', 'X-ray', 'Mammography', 'Ultrasound'];
const REGION_NAME: Record<string, string> = { breast: 'Breast', chest: 'Chest', extremity: 'Arms and legs', head: 'Head and brain', pelvis: 'Pelvis', abdomen: 'Abdomen', spine: 'Spine' };
const regionName = (r: string) => REGION_NAME[r] ?? r.charAt(0).toUpperCase() + r.slice(1);

/** "Patient J · CT chest" → ["Patient J", "CT chest"]; a title without a patient code stays whole. */
function splitTitle(title: string): [string, string] {
  const i = title.indexOf(' · ');
  return i > 0 && /^Patient /.test(title) ? [title.slice(0, i), title.slice(i + 3)] : ['', title];
}

interface CaseInfo {
  series: Series[];
  /** Plain modality names (CT, MRI, X-ray…), each once. */
  names: string[];
  labels: { expert: number; ai: number; total: number };
  full: boolean;
  thumb: string | null;
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
      const names = [...new Set(series.map((s) => modalityName(s.modality)))];
      const labels = catalog.anatomyCounts(c.id);
      // "Fully labelled": every organ in the field of view outlined (≥20 on cross-sectional studies; the 14-structure set on a radiograph).
      const xrOnly = all.every((s) => s.modality === 'CR' || s.modality === 'DX');
      const full = labels.total >= 20 || (xrOnly && labels.total >= 12);
      const thumb = catalog.thumbnailUrl(c.primarySeriesUid) ?? (series[0] ? catalog.thumbnailUrl(series[0].uid) : null);
      const codes = series.map((s) => s.modality).join(' ');
      out.set(c.id, { series, names, labels, full, thumb, words: `${c.neutralTitle} ${names.join(' ')} ${codes} ${c.region.join(' ')}`.toLowerCase() });
    }
    return out;
  }, [catalog, cases]);
  const regions = useMemo(() => [...new Set(cases.flatMap((c) => c.region))].sort((a, b) => regionName(a).localeCompare(regionName(b))), [cases]);
  const modalityCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of info.values()) for (const m of x.names) n.set(m, (n.get(m) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => (MODALITY_ORDER.indexOf(a[0]) + 99) % 99 - (MODALITY_ORDER.indexOf(b[0]) + 99) % 99);
  }, [info]);
  const seen = useMemo(() => new Set(attempts.map((a) => a.holdoutGroup)), [attempts]);
  const weekly = caseOfWeek().caseId;
  const filtering = text.trim() !== '' || region !== 'all' || modality !== 'all' || pairedOnly || labelledOnly;
  const featured = !filtering && catalog?.cases.has(weekly) ? catalog.cases.get(weekly)! : null;

  const filtered = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = cases.filter((c) => {
      const x = info.get(c.id);
      if (!x) return false;
      if (featured && c.id === featured.id) return false;
      if (labelledOnly && !x.full) return false;
      if (region !== 'all' && !c.region.includes(region)) return false;
      if (modality !== 'all' && !x.names.includes(modality)) return false;
      if (pairedOnly && c.studyUids.length < 2) return false;
      return words.every((w) => x.words.includes(w));
    });
    if (labelledOnly) return out.sort((a, b) => (info.get(b.id)?.labels.total ?? 0) - (info.get(a.id)?.labels.total ?? 0));
    // Patients you have not read come first; the order is otherwise the library's own.
    if (!catalog) return out;
    return out.map((c, i) => [c, i, seen.has(catalog.holdoutGroup(c.id)) ? 1 : 0] as const).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map(([c]) => c);
  }, [cases, info, text, region, modality, pairedOnly, labelledOnly, featured, seen, catalog]);

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
  const href = (id: string) => (labelledOnly ? `/read/${id}?mode=learn` : `/read/${id}?mode=practice`);
  const total = cases.length;
  return (
    <div className="page-inner lib">
      <header className="lib-head">
        <h1>Cases</h1>
        <p className="muted">
          {total} patients. Titles never give away the diagnosis; to find one, <Link to="/conditions">search by condition</Link>.
        </p>
      </header>

      <div className="lib-controls">
        <label className="lib-search">
          <Search size={16} aria-hidden />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search patients and scans" aria-label="Find a patient or scan" />
        </label>
        <div className="lib-pills" role="group" aria-label="Modality">
          <button className="lib-pill" aria-pressed={modality === 'all'} onClick={() => setModality('all')}>
            All
          </button>
          {modalityCounts.map(([m, n]) => (
            <button key={m} className="lib-pill" aria-pressed={modality === m} onClick={() => setModality(modality === m ? 'all' : m)}>
              {m} <span>{n}</span>
            </button>
          ))}
        </div>
        <div className="lib-more">
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Body area">
            <option value="all">Every body area</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {regionName(r)}
              </option>
            ))}
          </select>
          <button className="chip lib-toggle" aria-pressed={pairedOnly} onClick={() => setPairedOnly((v) => !v)} title="Patients with two exams to compare, such as a radiograph and its CT">
            Two exams
          </button>
          <button className="chip lib-toggle" aria-pressed={labelledOnly} onClick={() => setLabelledOnly((v) => !v)} title="Every organ in view outlined; opens in Learn mode">
            Fully labelled
          </button>
        </div>
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

      {featured ? (
        <section className="lib-section" aria-labelledby="lib-week">
          <h2 id="lib-week">This week</h2>
          <Link className="case-feature" to={href(featured.id)}>
            <span className="case-feature-art" aria-hidden style={info.get(featured.id)?.thumb ? { backgroundImage: `url(${info.get(featured.id)!.thumb})` } : undefined} />
            <span className="case-feature-text">
              <b>{splitTitle(featured.neutralTitle)[1]}</b>
              <small>
                {[splitTitle(featured.neutralTitle)[0], info.get(featured.id)?.names.join(' + '), `${(catalog.tasksByCase.get(featured.id) ?? []).length} tasks`].filter(Boolean).join(' · ')}
              </small>
              <span className="btn primary">Read it</span>
            </span>
          </Link>
        </section>
      ) : null}

      <section className="lib-section" aria-labelledby="lib-all">
        <h2 id="lib-all" className={featured ? '' : 'sr-only'}>
          All patients
        </h2>
        {filtered.length === 0 ? (
          <Empty title="No cases match">Try another filter or a shorter search.</Empty>
        ) : (
          <>
            {filtering ? (
              <p className="lib-count" aria-live="polite">
                {filtered.length} of {total} patients
              </p>
            ) : null}
            <div className="case-grid">
              {filtered.slice(0, limit).map((c) => {
                const { names, labels, full, thumb } = info.get(c.id)!;
                const tasks = catalog.tasksByCase.get(c.id) ?? [];
                const [who, what] = splitTitle(c.neutralTitle);
                const read = seen.has(catalog.holdoutGroup(c.id));
                return (
                  <Link key={c.id} className="case-card" to={href(c.id)}>
                    <span className="case-art" aria-hidden>
                      <span style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
                      <span className="case-tags">
                        {names.map((m) => (
                          <i key={m}>{m}</i>
                        ))}
                        {c.studyUids.length > 1 ? <i>{c.studyUids.length} exams</i> : null}
                      </span>
                      {read ? (
                        <span className="case-done" title="You have read this patient">
                          <Check size={13} strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span className="case-meta">
                      <b>{what}</b>
                      <small>
                        {[who, `${tasks.length} task${tasks.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                        {full ? (
                          <span title={`${labels.expert} expert-drawn, ${labels.ai} ${AI_LABEL} anatomy outlines`}> · Fully labelled</span>
                        ) : null}
                        {read ? <span className="sr-only"> · read</span> : null}
                      </small>
                    </span>
                  </Link>
                );
              })}
            </div>
            {limit < filtered.length ? (
              <div ref={more} className="lib-more-row">
                <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
                  Show more ({filtered.length - limit} left)
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

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
