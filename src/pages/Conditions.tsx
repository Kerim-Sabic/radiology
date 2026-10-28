import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, ExternalLink, Search, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { CONDITIONS, CONDITION_BY_ID, MODALITY_LABEL, REGION_LABEL, type Condition, type Region } from '../content/conditions';
import { findCases, groupByFamily, normalizeQuery, searchConditions, STRENGTH_LABEL, type CaseHit } from '../services/conditionSearch';
import { anchorLabel } from '../services/curriculum';
import '../styles/conditions.css';

const STRENGTH_CHIP: Record<CaseHit['strength'], string> = { outlined: 'ok', labelled: 'accent', collection: 'warn' };

export default function ConditionsPage() {
  const { catalog, curriculum } = useApp();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const pickedId = sp.get('c');
  const [hitsById, setHitsById] = useState<Map<string, CaseHit[]> | null>(null);

  // Find the installed cases for every condition that can have them (a few small label files are read once).
  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    const load = (id: string) => catalog.targetGeometry(id).catch(() => null);
    Promise.all(CONDITIONS.filter((c) => c.evidence?.length).map(async (c) => [c.id, await findCases(catalog, c, load)] as const)).then((rows) => {
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
    document.title = shown ? `${shown.name}: imaging, cases and book pages · radiology.monster` : 'Conditions: find any condition in real cases · radiology.monster';
  }, [shown]);

  const setQuery = (text: string) => setSp(text ? { q: text } : {}, { replace: true });
  const open = (c: Condition) => setSp({ q: c.name, c: c.id });

  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Conditions</h1>
        <span className="muted">Type a condition to see where it is in the installed cases and where the book explains it.</span>
      </div>
      <div className="cond-search">
        <Search size={18} aria-hidden className="faint" />
        <input
          type="search"
          value={q}
          autoFocus
          placeholder="e.g. hemothorax, pneumothorax, lung nodule, PE…"
          aria-label="Search conditions"
          onChange={(e) => setQuery(e.target.value)}
        />
        {q ? (
          <button className="btn sm ghost" onClick={() => setQuery('')} aria-label="Clear search">
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
            <div className="row wrap" aria-label="Other matching conditions">
              <span className="faint">Also matching:</span>
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
            hits={hitsById ? (hitsById.get(shown.id) ?? []) : null}
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
  const withCases = CONDITIONS.filter((c) => caseCount(c.id) > 0);
  const regions = [...new Set(CONDITIONS.map((c) => c.region))] as Region[];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack" style={{ gap: 8 }}>
        <h3>In your installed cases</h3>
        {!hitsById ? (
          <span className="faint">Looking through the installed cases…</span>
        ) : withCases.length ? (
          <div className="row wrap">
            {withCases.map((c) => (
              <button key={c.id} className="chip accent" onClick={() => open(c)}>
                {c.name} · {caseCount(c.id)} {caseCount(c.id) === 1 ? 'patient' : 'patients'}
              </button>
            ))}
          </div>
        ) : (
          <span className="faint">No installed case shows a listed condition yet.</span>
        )}
      </div>
      <div className="grid-2">
        {regions.map((r) => (
          <div key={r} className="card cond-region">
            <h3>{REGION_LABEL[r]}</h3>
            <div className="row wrap">
              {CONDITIONS.filter((c) => c.region === r).map((c) => (
                <button key={c.id} className="chip" onClick={() => open(c)}>
                  {c.name}
                  {caseCount(c.id) ? <b> · {caseCount(c.id)}</b> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <small className="faint">
        Results name the diagnosis. Use them to learn; Assess mode is fairest on patients you have not looked up here.
      </small>
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
        <span className="chip">{REGION_LABEL[c.region]}</span>
        {c.modalities.map((m) => (
          <span key={m} className="chip">
            {MODALITY_LABEL[m]}
          </span>
        ))}
        {p.via ? <span className="faint">matched “{p.via}”</span> : null}
      </div>

      <div className="cond-grid">
        <section className="stack" style={{ gap: 12 }} aria-label="Installed cases">
          <h3>
            In your cases{hits && patients ? ` · ${patients} ${patients === 1 ? 'patient' : 'patients'}` : ''}
          </h3>
          {!hits ? (
            <span className="faint">Looking through the installed cases…</span>
          ) : !hits.length ? (
            <div className="notice">
              <b>No installed case shows {c.name.toLowerCase()} yet.</b> The book pages and signs on this page still apply.
              {suggestions.length ? (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <span>{relatedWithCases.length ? 'Related conditions you can see in cases:' : `${REGION_LABEL[c.region]} conditions you can see in cases:`}</span>
                  {suggestions.map((r) => (
                    <button key={r.id} className="chip accent" onClick={() => p.open(r)}>
                      {r.name} · {p.caseCount(r.id)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.family} className="stack" style={{ gap: 8 }}>
                <h4>
                  {g.family} <span className="faint">· {g.hits.length}</span>
                </h4>
                {g.hits.map((h) => (
                  <HitCard key={`${h.seriesUid}-${h.strength}`} h={h} />
                ))}
              </div>
            ))
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
            <small className="faint">Our short summary — the book pages above explain it fully.</small>
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

function HitCard({ h }: { h: CaseHit }) {
  return (
    <div className="cond-hit">
      <span className="cond-thumb" style={h.thumb ? { backgroundImage: `url(${h.thumb})` } : undefined} aria-hidden />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <b>{h.patient}</b>
          <span className={`chip ${STRENGTH_CHIP[h.strength]}`}>{STRENGTH_LABEL[h.strength]}</span>
        </div>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {h.modality} · {h.seriesDescription}
        </span>
        {h.items.length ? (
          <ul>
            {h.items.map((it, i) => (
              <li key={it.targetId ?? i}>
                {it.label}
                {it.where ? <span className="faint"> — {it.where}</span> : null}
                {it.source ? <span className="faint"> ({it.source})</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <small className="faint">{h.note}</small>
        <div>
          <Link className="btn sm primary" to={h.link}>
            <ExternalLink size={13} /> Open in the viewer
          </Link>
        </div>
      </div>
    </div>
  );
}
