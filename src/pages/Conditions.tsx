import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, Search, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { CONDITIONS, CONDITION_BY_ID, MODALITY_LABEL, REGION_LABEL, type Condition, type Region } from '../content/conditions';
import { findCases, groupByFamily, normalizeQuery, searchConditions, type CaseHit } from '../services/conditionSearch';
import { anchorLabel } from '../services/curriculum';
import '../styles/conditions.css';

/** What the image itself shows, as a short label on the scan. */
const STRENGTH_TAG: Record<CaseHit['strength'], string> = { outlined: 'Marked', labelled: 'Reader labels', collection: 'Not outlined' };

export default function ConditionsPage() {
  const { catalog, curriculum } = useApp();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const pickedId = sp.get('c');
  const [hitsById, setHitsById] = useState<Map<string, CaseHit[]> | null>(null);
  // The shown condition's hits with the slice range of every outline ("images 41–46 of 133"), read when it is opened.
  const [detail, setDetail] = useState<{ id: string; hits: CaseHit[] } | null>(null);

  // Find the installed cases for every condition that can have them, without reading any outline: the list and the counts
  // appear at once (only the few reader-label files are read).
  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    const load = (id: string) => catalog.targetGeometry(id).catch(() => null);
    Promise.all(CONDITIONS.filter((c) => c.evidence?.length).map(async (c) => [c.id, await findCases(catalog, c, load, { where: false })] as const)).then((rows) => {
      if (!cancelled) setHitsById(new Map(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  const caseCount = (id: string) => new Set((hitsById?.get(id) ?? []).map((h) => h.caseId)).size;
  const matches = useMemo(() => searchConditions(q, CONDITIONS, (id) => !!hitsById?.get(id)?.length), [q, hitsById]);
  const picked = pickedId ? (CONDITION_BY_ID.get(pickedId) ?? null) : null;
  const shown = picked ?? matches[0]?.condition ?? null;
  const via = !picked && matches[0] ? matches[0].via : null;
  useEffect(() => {
    if (!catalog || !shown?.evidence?.length) return;
    let cancelled = false;
    findCases(catalog, shown, (id) => catalog.targetGeometry(id).catch(() => null)).then((hits) => {
      if (!cancelled) setDetail({ id: shown.id, hits });
    });
    return () => {
      cancelled = true;
    };
  }, [catalog, shown]);
  useEffect(() => {
    document.title = shown ? `${shown.name}: imaging, cases and book pages · Radiology Monster` : 'Conditions: find any condition in real cases · Radiology Monster';
  }, [shown]);

  const setQuery = (text: string) => setSp(text ? { q: text } : {}, { replace: true });
  const open = (c: Condition) => setSp({ q: c.name, c: c.id });

  return (
    <div className="page-inner cond-page">
      <header className="lib-head">
        <h1>Conditions</h1>
        <p className="muted">Every patient who has it, where it is on the image, and the book pages that explain it.</p>
      </header>
      <div className="lib-search cond-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={q}
          autoFocus
          placeholder="e.g. hemothorax, pneumothorax, lung nodule, PE…"
          aria-label="Search conditions"
          onChange={(e) => setQuery(e.target.value)}
        />
        {q ? (
          <button className="cond-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : null}
      </div>

      {!q && !picked ? (
        <Browse hitsById={hitsById} caseCount={caseCount} open={open} />
      ) : !shown ? (
        <div className="notice">
          No condition matches “{q}”. Try another name or spelling, or <button className="btn sm ghost" onClick={() => setQuery('')}>browse the list</button>.
        </div>
      ) : (
        <>
          {matches.length > 1 ? (
            <div className="row wrap cond-also" aria-label="Other matching conditions">
              <span className="faint">Also matching</span>
              {matches
                .filter((m) => m.condition.id !== shown.id)
                .slice(0, 8)
                .map((m) => (
                  <button key={m.condition.id} className="chip" onClick={() => open(m.condition)}>
                    {m.condition.name}
                    {caseCount(m.condition.id) ? <b> · {caseCount(m.condition.id)}</b> : null}
                  </button>
                ))}
            </div>
          ) : null}
          <ConditionView
            c={shown}
            via={via && normalizeQuery(shown.name) !== via ? via : null}
            hits={detail?.id === shown.id ? detail.hits : hitsById ? (hitsById.get(shown.id) ?? []) : null}
            caseCount={caseCount}
            open={open}
            bookLabel={(a) => (curriculum ? anchorLabel(curriculum, a) : `PDF page ${a.physical}`)}
            unitTitle={(id) => curriculum?.unitById.get(id)?.title ?? null}
          />
        </>
      )}
    </div>
  );
}

function Browse({ hitsById, caseCount, open }: { hitsById: Map<string, CaseHit[]> | null; caseCount: (id: string) => number; open: (c: Condition) => void }) {
  const regions = [...new Set(CONDITIONS.map((c) => c.region))] as Region[];
  return (
    <div className="cond-browse">
      {!hitsById ? <p className="faint">Looking through the installed cases…</p> : null}
      <div className="cond-regions">
        {regions.map((r) => {
          const list = CONDITIONS.filter((c) => c.region === r).sort((a, b) => Number(caseCount(b.id) > 0) - Number(caseCount(a.id) > 0));
          return (
            <section key={r} className="cond-region" aria-label={REGION_LABEL[r]}>
              <h2>{REGION_LABEL[r]}</h2>
              <div className="cond-names">
                {list.map((c) => {
                  const n = caseCount(c.id);
                  return (
                    <button key={c.id} className={`cond-name${n ? '' : ' none'}`} onClick={() => open(c)}>
                      {c.name}
                      {n ? <span>{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <p className="faint cond-fine">Numbers are patients in the library. Results name the diagnosis, so use them to learn; Assess mode is fairest on patients you have not looked up here.</p>
    </div>
  );
}

function ConditionView(p: {
  c: Condition;
  via: string | null;
  hits: CaseHit[] | null;
  caseCount: (id: string) => number;
  open: (c: Condition) => void;
  bookLabel: (a: { physical: number; chapterId: string; figureId?: string | null }) => string;
  unitTitle: (chapterId: string) => string | null;
}) {
  const { c, hits } = p;
  const groups = hits ? groupByFamily(hits) : [];
  const patients = hits ? new Set(hits.map((h) => h.caseId)).size : 0;
  const related = c.related.map((id) => CONDITION_BY_ID.get(id)).filter((x): x is Condition => !!x);
  // Related conditions you can actually see in a case; failing that, others from the same body region.
  const relatedWithCases = related.filter((r) => p.caseCount(r.id) > 0);
  const suggestions = relatedWithCases.length ? relatedWithCases : CONDITIONS.filter((x) => x.id !== c.id && x.region === c.region && p.caseCount(x.id) > 0);
  const chapters = [...new Set(c.book.map((a) => a.chapterId))];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="cond-head">
        <h2>{c.name}</h2>
        <p className="muted">
          {[REGION_LABEL[c.region], c.modalities.map((m) => MODALITY_LABEL[m]).join(', ')].join(' · ')}
          {p.via ? <span className="faint"> · matched “{p.via}”</span> : null}
        </p>
      </div>

      <div className="cond-grid">
        <section className="cond-cases" aria-label="Installed cases">
          <h3>{hits && patients ? `${patients} ${patients === 1 ? 'patient' : 'patients'}` : 'Patients'}</h3>
          {!hits ? (
            <span className="faint">Looking through the installed cases…</span>
          ) : !hits.length ? (
            <div className="notice">
              <b>No installed case shows {c.name.toLowerCase()} yet.</b> The book pages and signs on this page still apply.
              {suggestions.length ? (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <span>{relatedWithCases.length ? 'Related conditions you can see in cases:' : `${REGION_LABEL[c.region]} conditions you can see in cases:`}</span>
                  {suggestions.map((r) => (
                    <button key={r.id} className="chip" onClick={() => p.open(r)}>
                      {r.name} · {p.caseCount(r.id)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            groups.map((g) => {
              // Most groups share one note (the collection and how it marks the finding): said once, not on every tile.
              const notes = [...new Set(g.hits.map((h) => h.note).filter(Boolean))];
              return (
                <div key={g.family} className="cond-group">
                  <h4>
                    {g.family} <span className="faint">{g.hits.length}</span>
                  </h4>
                  {notes.length ? (
                    <p className="faint cond-note">
                      {notes.slice(0, 2).join(' ')}
                      {notes.length > 2 ? ` And ${notes.length - 2} more sources.` : ''}
                    </p>
                  ) : null}
                  <div className="cond-tiles">
                    {g.hits.map((h) => (
                      <HitTile key={`${h.seriesUid}-${h.strength}`} h={h} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {hits?.some((h) => h.strength === 'collection') ? (
            <small className="faint">“Not outlined” means the patient comes from a collection of people with this condition, but nothing marks where it is — the images may even look normal.</small>
          ) : null}
        </section>

        <aside className="stack" style={{ gap: 12 }} aria-label="Book and signs">
          <div className="card stack" style={{ gap: 8 }}>
            <h3 className="row" style={{ gap: 6 }}>
              <BookOpen size={16} aria-hidden /> In Learning Radiology (5th ed.)
            </h3>
            <ul className="cond-book">
              {c.book.map((a, i) => (
                <li key={`${a.physical}-${i}`}>
                  <Link to={`/book/${a.physical}`}>
                    <b>{a.heading ?? a.figureId}</b>
                  </Link>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {p.bookLabel(a)}
                    {p.unitTitle(a.chapterId) ? ` · ${p.unitTitle(a.chapterId)}` : ''}
                  </div>
                  {a.note ? <div style={{ fontSize: 12.5 }}>{a.note}</div> : null}
                </li>
              ))}
            </ul>
            <div className="row wrap">
              {chapters.map((ch) => (
                <Link key={ch} className="btn sm" to={`/book/figures?unit=${ch}`}>
                  Figures · {ch.replace(/^ch0?/, 'Ch ').replace(/^app/, 'App ')}
                </Link>
              ))}
            </div>
          </div>
          <div className="card stack" style={{ gap: 8 }}>
            <h3>What to look for</h3>
            <ul className="cond-signs">
              {c.signs.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <small className="faint">A short summary. The book pages above explain it in full.</small>
          </div>
          {related.length ? (
            <div className="row wrap">
              <span className="faint">Related:</span>
              {related.map((r) => (
                <button key={r.id} className="chip" onClick={() => p.open(r)}>
                  {r.name}
                  {p.caseCount(r.id) ? <b> · {p.caseCount(r.id)}</b> : null}
                </button>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function HitTile({ h }: { h: CaseHit }) {
  const [who, what] = h.patient.includes(' · ') ? [h.patient.slice(0, h.patient.indexOf(' · ')), h.patient.slice(h.patient.indexOf(' · ') + 3)] : [h.patient, ''];
  const where = h.items.map((it) => it.where).find(Boolean);
  const detail = h.items.map((it) => `${it.label}${it.where ? ` (${it.where})` : ''}${it.source ? `, ${it.source}` : ''}`).join('; ');
  return (
    <Link className="case-card cond-tile" to={h.link} title={detail || undefined}>
      <span className="case-art" aria-hidden>
        <span style={h.thumb ? { backgroundImage: `url(${h.thumb})` } : undefined} />
        <span className="case-tags">
          <i>{STRENGTH_TAG[h.strength]}</i>
        </span>
      </span>
      <span className="case-meta">
        <b>{who}</b>
        <small>{[h.seriesDescription || what, where && where !== 'boxed on the image' ? where : null].filter(Boolean).join(' · ')}</small>
        {detail ? <span className="sr-only">{detail}</span> : null}
      </span>
    </Link>
  );
}
