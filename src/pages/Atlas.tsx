import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleDashed, Target } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { BOOK_ANATOMY, canonicalAnatomyKey, imageFamily } from '../content/bookAnatomy';
import { CATEGORY_COLORS, categoryFor } from '../components/ws/overlayShapes';
import { AI_DRAFT_BY, isAutomatic, plainName, provenanceTag } from '../lib/provenance';
import { noteFor } from '../content/structureNotes';

interface Entry {
  caseId: string;
  caseTitle: string;
  targetId: string;
  family: string;
  provenance: string;
}
interface Structure {
  key: string;
  name: string;
  category: string;
  entries: Entry[];
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
const FAMILY_LABEL: Record<string, string> = { XR: 'X-ray', CT: 'CT', MR: 'MRI' };

export default function AtlasPage() {
  const { catalog } = useApp();
  const [q, setQ] = useState('');
  const [family, setFamily] = useState<'all' | 'XR' | 'CT' | 'MR'>('all');
  const [expertOnly, setExpertOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Built from manifests only: nothing is downloaded until a structure is opened.
  const structures = useMemo(() => {
    const m = new Map<string, Structure>();
    if (!catalog) return m;
    for (const k of catalog.cases.values()) {
      const ids = catalog.anatomyTargetsForSeries(catalog.seriesForCase(k).map((s) => s.uid));
      for (const id of ids) {
        const t = catalog.targets.get(id);
        if (!t) continue;
        const key = canonicalAnatomyKey(t.classId);
        const s = m.get(key) ?? { key, name: plainName(t.label), category: categoryFor(t), entries: [] };
        if (!isAutomatic(t.provenance) && s.entries.every((e) => isAutomatic(e.provenance))) s.name = plainName(t.label); // expert wording wins
        s.entries.push({ caseId: k.id, caseTitle: k.neutralTitle, targetId: id, family: imageFamily(catalog.series.get(t.seriesUid)?.modality ?? ''), provenance: t.provenance });
        m.set(key, s);
      }
    }
    return m;
  }, [catalog]);

  const visible = useMemo(() => {
    const out = new Map<string, Structure[]>();
    for (const s of structures.values()) {
      const entries = s.entries.filter((e) => (family === 'all' || e.family === family) && (!expertOnly || !isAutomatic(e.provenance)));
      if (!entries.length) continue;
      if (q && !s.name.toLowerCase().includes(q.toLowerCase()) && !s.key.includes(q.toLowerCase().replace(/\s+/g, '_'))) continue;
      out.set(s.category, [...(out.get(s.category) ?? []), { ...s, entries }]);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return [...out.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [structures, q, family, expertOnly]);

  const checklist = useMemo(
    () =>
      BOOK_ANATOMY.map((g) => ({
        ...g,
        rows: g.items.map((it) => {
          const hits = [...structures.values()].filter((s) => it.match.test(s.key)).flatMap((s) => s.entries.filter((e) => !it.on || e.family === it.on));
          return { ...it, hits, patients: new Set(hits.map((h) => h.caseId)).size, expert: hits.some((h) => !isAutomatic(h.provenance)) };
        }),
      })),
    [structures],
  );
  const covered = checklist.reduce((a, g) => a + g.rows.filter((r) => r.patients > 0).length, 0);
  const total = checklist.reduce((a, g) => a + g.rows.length, 0);

  const best = useMemo(() => {
    if (!catalog) return [];
    return [...catalog.cases.values()]
      .map((k) => ({ k, n: catalog.anatomyCounts(k.id) }))
      .filter((x) => x.n.total >= 12)
      .sort((a, b) => b.n.total - a.n.total)
      .slice(0, 12);
  }, [catalog]);

  if (!catalog) return <div className="page-inner">Loading…</div>;
  const link = (e: Entry) => `/read/${encodeURIComponent(e.caseId)}?mode=learn&show=${encodeURIComponent(e.targetId)}`;

  return (
    <div className="page-inner stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Anatomy atlas</h1>
        <span className="muted">
          Every labelled structure on every patient. Pick one to open the scan with that structure shown alone; use ‹ › on the image to step through its neighbours.
          Solid outlines are expert labels from the source datasets; dashed ones are {AI_DRAFT_BY} (quality-checked, not yet reviewed by a radiologist).
        </span>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2>Most completely labelled studies</h2>
        <div className="row wrap">
          {best.map(({ k, n }) => (
            <Link key={k.id} className="chip" to={`/read/${encodeURIComponent(k.id)}?mode=learn`} title={`${n.expert} expert, ${n.ai} ${AI_DRAFT_BY}`}>
              {k.neutralTitle} · <b>{n.total}</b> structures{n.expert >= n.total * 0.9 ? ' · expert' : ''}
            </Link>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <h2>Find a structure</h2>
          <span className="spacer" />
          <input type="search" placeholder="Rib 5, aorta, L1, adrenal…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a structure" style={{ minWidth: 220 }} />
          <select value={family} onChange={(e) => setFamily(e.target.value as typeof family)} aria-label="Image type">
            <option value="all">CT, X-ray and MRI</option>
            <option value="CT">CT</option>
            <option value="XR">X-ray</option>
            <option value="MR">MRI</option>
          </select>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={expertOnly} onChange={(e) => setExpertOnly(e.target.checked)} /> Expert labels only
          </label>
        </div>
        {visible.length === 0 ? <small className="faint">No labelled structure matches.</small> : null}
        {visible.map(([cat, items]) => (
          <div key={cat} className="stack" style={{ gap: 4 }}>
            <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {CATEGORY_LABEL[cat] ?? cat} · {items.length}
            </div>
            <div className="atlas-grid">
              {items.map((s) => {
                const patients = new Set(s.entries.map((e) => e.caseId)).size;
                const expert = s.entries.filter((e) => !isAutomatic(e.provenance)).length;
                const isOpen = open === s.key;
                return (
                  <div key={s.key} className={`atlas-item${isOpen ? ' open' : ''}`}>
                    <button className="anat-item" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.key)}>
                      <span className="dot" style={{ background: CATEGORY_COLORS[cat] ?? '#fff' }} />
                      <span style={{ flex: 1 }}>{s.name}</span>
                      <span className="faint" style={{ fontSize: 11 }}>
                        {patients} patient{patients === 1 ? '' : 's'}
                        {expert ? ` · ${expert} expert` : ''}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="stack" style={{ gap: 2, padding: '4px 0 6px 18px' }}>
                        {(() => {
                          const n = noteFor(s.key, s.entries.every((e) => e.family === 'XR') ? 'XR' : undefined);
                          return n ? (
                            <div className="stack struct-note" style={{ marginBottom: 6 }}>
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
                            </div>
                          ) : null;
                        })()}
                        <Link to={`/drill?key=${encodeURIComponent(s.key)}`} className="row" style={{ gap: 6, fontSize: 12.5, marginBottom: 4 }}>
                          <Target size={13} /> Drill it on {patients} patient{patients === 1 ? '' : 's'}
                        </Link>
                        {s.entries.map((e) => (
                          <Link key={e.targetId} to={link(e)} className="row" style={{ gap: 6, fontSize: 12.5 }}>
                            <span>{e.caseTitle}</span>
                            <span className="chip">{FAMILY_LABEL[e.family] ?? e.family}</span>
                            <span className={`chip ${isAutomatic(e.provenance) ? 'warn' : 'ok'}`}>{provenanceTag(e.provenance)}</span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <h2>Book anatomy checklist</h2>
          <span className="chip accent">
            {covered} / {total} labelled on at least one patient
          </span>
        </div>
        <small className="muted">The structures each chapter expects you to recognise, and where you can see them on a real scan. Items without a scan yet are listed honestly as gaps.</small>
        <div className="grid-3">
          {checklist.map((g, gi) => (
            <div key={gi} className="card stack" style={{ gap: 4 }}>
              <div className="row">
                <b style={{ flex: 1 }}>{g.title}</b>
                <Link className="faint" to={`/course/${g.unitId}`} style={{ fontSize: 12 }}>
                  Chapter
                </Link>
              </div>
              {g.rows.map((r) => (
                <div key={r.name} className="row" style={{ gap: 6, fontSize: 12.5 }}>
                  {r.patients ? <Check size={14} color="#6ee7b7" aria-label="labelled" /> : <CircleDashed size={14} className="faint" aria-label="not yet labelled" />}
                  {r.hits.length ? (
                    <Link to={link(r.hits.find((h) => !isAutomatic(h.provenance)) ?? r.hits[0])} style={{ flex: 1 }}>
                      {r.name}
                    </Link>
                  ) : (
                    <span className="faint" style={{ flex: 1 }}>
                      {r.name}
                    </span>
                  )}
                  <span className="faint" style={{ fontSize: 11 }}>
                    {r.patients ? `${r.patients} pt${r.expert ? ' · expert' : ''}` : 'gap'}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
