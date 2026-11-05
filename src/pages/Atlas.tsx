import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronRight, CircleDashed, Search, Target, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { BOOK_ANATOMY, canonicalAnatomyKey, imageFamily } from '../content/bookAnatomy';
import { GROUP_LABEL, GROUP_ORDER, groupFor, type Group3D } from '../viewer/anatomyMask';
import { colorOf } from '../viewer/segStyle';
import { useSegStyle } from '../components/ws/SegStyleControls';
import { AI_CREDIT, AI_LABEL, isAutomatic, plainName, provenanceTag } from '../lib/provenance';
import { noteFor } from '../content/structureNotes';

interface Entry {
  caseId: string;
  caseTitle: string;
  targetId: string;
  seriesUid: string;
  family: string;
  provenance: string;
}
interface Structure {
  key: string;
  name: string;
  group: Group3D;
  entries: Entry[];
}

// The book's words where source datasets use other names, so the atlas and the checklist read the same.
const BOOK_NAME: Record<string, string> = { colon: 'Colon (large intestine)', small_bowel: 'Small bowel (small intestine)' };
const FAMILY_LABEL: Record<string, string> = { XR: 'X-ray', CT: 'CT', MR: 'MRI' };
/** Short names for the system pills. */
const GROUP_SHORT: Record<Group3D, string> = {
  findings: 'Findings',
  heart: 'Heart',
  arteries: 'Arteries',
  veins: 'Veins',
  airways: 'Airways',
  lungs: 'Lungs',
  brain: 'Brain',
  bones: 'Bones',
  abdomen: 'Organs',
  glands: 'Glands',
  muscles: 'Muscles',
  other: 'Other',
};
const patientCount = (s: Structure) => new Set(s.entries.map((e) => e.caseId)).size;

export default function AtlasPage() {
  const { catalog } = useApp();
  const look = useSegStyle();
  const [q, setQ] = useState('');
  const [family, setFamily] = useState<'all' | 'XR' | 'CT' | 'MR'>('all');
  const [group, setGroup] = useState<'all' | Group3D>('all');
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
        const s = m.get(key) ?? { key, name: plainName(t.label), group: groupFor(key), entries: [] };
        if (!isAutomatic(t.provenance) && s.entries.every((e) => isAutomatic(e.provenance))) s.name = plainName(t.label); // expert wording wins
        if (BOOK_NAME[key]) s.name = BOOK_NAME[key];
        s.entries.push({ caseId: k.id, caseTitle: k.neutralTitle, targetId: id, seriesUid: t.seriesUid, family: imageFamily(catalog.series.get(t.seriesUid)?.modality ?? ''), provenance: t.provenance });
        m.set(key, s);
      }
    }
    return m;
  }, [catalog]);

  /** Every structure with only the entries the image-type and expert filters allow. */
  const allowed = useMemo(() => {
    const out: Structure[] = [];
    for (const s of structures.values()) {
      const entries = s.entries.filter((e) => (family === 'all' || e.family === family) && (!expertOnly || !isAutomatic(e.provenance)));
      if (entries.length) out.push({ ...s, entries });
    }
    return out;
  }, [structures, family, expertOnly]);

  const groupCounts = useMemo(() => {
    const n = new Map<Group3D, number>();
    for (const s of allowed) n.set(s.group, (n.get(s.group) ?? 0) + 1);
    return GROUP_ORDER.filter((g) => n.has(g)).map((g) => [g, n.get(g)!] as const);
  }, [allowed]);

  const visible = useMemo(() => {
    const words = q.toLowerCase().trim();
    const out = new Map<Group3D, Structure[]>();
    for (const s of allowed) {
      if (group !== 'all' && s.group !== group) continue;
      if (words && !s.name.toLowerCase().includes(words) && !s.key.includes(words.replace(/\s+/g, '_'))) continue;
      out.set(s.group, [...(out.get(s.group) ?? []), s]);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return [...out.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [allowed, q, group]);

  const selected = open ? (allowed.find((s) => s.key === open) ?? null) : null;
  // Escape closes the structure (the sheet on a phone).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);

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
      .slice(0, 8);
  }, [catalog]);

  if (!catalog) return <div className="page-inner">Loading…</div>;
  const link = (e: Entry) => `/read/${encodeURIComponent(e.caseId)}?mode=learn&show=${encodeURIComponent(e.targetId)}`;
  const thumb = (seriesUid: string) => catalog.thumbnailUrl(seriesUid);
  const shown = visible.reduce((a, [, items]) => a + items.length, 0);

  return (
    <div className="page-inner atlas">
      <header className="lib-head">
        <h1>Anatomy atlas</h1>
        <p className="muted">Every labelled structure on every patient. Pick one to see it alone on a real scan.</p>
      </header>

      <div className="lib-controls">
        <label className="lib-search">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Rib 5, aorta, L1, adrenal…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a structure" />
        </label>
        <div className="lib-pills" role="group" aria-label="Body system">
          <button className="lib-pill" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
            All <span>{allowed.length}</span>
          </button>
          {groupCounts.map(([g, n]) => (
            <button key={g} className="lib-pill" aria-pressed={group === g} onClick={() => setGroup(group === g ? 'all' : g)}>
              {GROUP_SHORT[g]} <span>{n}</span>
            </button>
          ))}
        </div>
        <div className="lib-more">
          <select value={family} onChange={(e) => setFamily(e.target.value as typeof family)} aria-label="Image type">
            <option value="all">CT, X-ray and MRI</option>
            <option value="CT">CT</option>
            <option value="XR">X-ray</option>
            <option value="MR">MRI</option>
          </select>
          <button className="chip lib-toggle" aria-pressed={expertOnly} onClick={() => setExpertOnly((v) => !v)} title="Only outlines drawn by the experts who published each dataset">
            Expert labels only
          </button>
        </div>
      </div>

      <div className="atlas-body">
        <div className="atlas-list">
          {shown === 0 ? <p className="faint">No labelled structure matches. Try a shorter name.</p> : null}
          {visible.map(([cat, items]) => (
            <section key={cat} className="atlas-group" aria-label={GROUP_LABEL[cat]}>
              <h2>
                {GROUP_LABEL[cat]} <span>{items.length}</span>
              </h2>
              <ul className="atlas-rows">
                {items.map((s) => {
                  const isOpen = open === s.key;
                  const n = patientCount(s);
                  return (
                    <li key={s.key} className={`atlas-item${isOpen ? ' open' : ''}`}>
                      <button className="atlas-row" aria-expanded={isOpen} aria-controls="atlas-detail" onClick={() => setOpen(isOpen ? null : s.key)}>
                        <span className="dot" style={{ background: colorOf(look, s.key, cat) }} aria-hidden />
                        <span className="atlas-name">{s.name}</span>
                        <span className="atlas-n">{n}</span>
                        <ChevronRight size={15} aria-hidden className="atlas-chev" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside id="atlas-detail" className={`atlas-detail${selected ? ' has' : ''}`} aria-label={selected ? selected.name : 'Most completely labelled studies'}>
          {selected ? (
            <StructureDetail s={selected} color={colorOf(look, selected.key, selected.group)} link={link} thumb={thumb} onClose={() => setOpen(null)} />
          ) : (
            <div className="atlas-intro">
              <h2>Pick a structure</h2>
              <p className="muted">It opens on a real scan, shown alone on the slice where it is largest. Use ‹ › on the image to step to its neighbours.</p>
              <h3>Most completely labelled studies</h3>
              <div className="atlas-tiles">
                {best.map(({ k, n }) => {
                  const [who, what] = k.neutralTitle.includes(' · ') ? k.neutralTitle.split(' · ') : ['', k.neutralTitle];
                  const t = thumb(k.primarySeriesUid);
                  return (
                    <Link key={k.id} className="case-card" to={`/read/${encodeURIComponent(k.id)}?mode=learn`} title={`${n.expert} expert, ${n.ai} ${AI_LABEL}`}>
                      <span className="case-art" aria-hidden>
                        <span style={t ? { backgroundImage: `url(${t})` } : undefined} />
                        <span className="case-tags">
                          <i>{n.total} structures</i>
                        </span>
                      </span>
                      <span className="case-meta">
                        <b>{what}</b>
                        <small>{who}</small>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
        {selected ? <button className="atlas-scrim" aria-label="Close" onClick={() => setOpen(null)} /> : null}
      </div>

      <section className="atlas-check" aria-labelledby="atlas-check-h">
        <div className="atlas-check-head">
          <h2 id="atlas-check-h">Book anatomy checklist</h2>
          <p className="muted">
            The structures each chapter expects you to recognise: {covered} of {total} can be seen on a real patient here.
          </p>
        </div>
        <div className="atlas-check-grid">
          {checklist.map((g, gi) => (
            <div key={gi} className="atlas-check-card">
              <div className="atlas-check-title">
                <b>{g.title}</b>
                <Link to={`/course/${g.unitId}`}>Chapter</Link>
              </div>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.name}>
                    {r.patients ? <Check size={14} className="ok-ico" aria-label="labelled" /> : <CircleDashed size={14} className="faint" aria-label="not yet labelled" />}
                    {r.hits.length ? <Link to={link(r.hits.find((h) => !isAutomatic(h.provenance)) ?? r.hits[0])}>{r.name}</Link> : <span className="faint">{r.name}</span>}
                    <small className="faint">{r.patients ? `${r.patients}${r.expert ? ' · expert' : ''}` : 'not yet'}</small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="faint atlas-fine">
        Solid outlines are expert labels from the source datasets; dashed ones are drawn by {AI_LABEL} (quality-checked, not yet reviewed by a radiologist).{' '}
        <a href={AI_CREDIT.url} target="_blank" rel="noopener">
          Thanks to {AI_CREDIT.name}
        </a>
        , every structure here is marked.
      </p>
    </div>
  );
}

function StructureDetail({ s, color, link, thumb, onClose }: { s: Structure; color: string; link: (e: Entry) => string; thumb: (uid: string) => string | null; onClose: () => void }) {
  const patients = patientCount(s);
  const expert = s.entries.filter((e) => !isAutomatic(e.provenance)).length;
  const families = [...new Set(s.entries.map((e) => FAMILY_LABEL[e.family] ?? e.family))];
  const note = noteFor(s.key, s.entries.every((e) => e.family === 'XR') ? 'XR' : undefined);
  // Expert outlines first, then the rest, one tile per patient and image.
  const entries = [...s.entries].sort((a, b) => Number(isAutomatic(a.provenance)) - Number(isAutomatic(b.provenance)));
  return (
    <div className="atlas-struct">
      <div className="atlas-struct-head">
        <span className="dot big" style={{ background: color }} aria-hidden />
        <h2>{s.name}</h2>
        <button className="atlas-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <p className="muted">
        {patients} patient{patients === 1 ? '' : 's'} · {families.join(', ')}
        {expert ? ` · ${expert} expert outline${expert === 1 ? '' : 's'}` : ` · ${AI_LABEL} outlines`}
      </p>
      {note ? (
        <dl className="atlas-note">
          <div>
            <dt>Looks like</dt>
            <dd>{note.look}</dd>
          </div>
          <div>
            <dt>Next to</dt>
            <dd>{note.near}</dd>
          </div>
          {note.pitfall ? (
            <div>
              <dt>Pitfall</dt>
              <dd>{note.pitfall}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <Link to={`/drill?key=${encodeURIComponent(s.key)}`} className="btn primary atlas-drill">
        <Target size={15} /> Drill it on {patients} patient{patients === 1 ? '' : 's'}
      </Link>
      <h3>See it on a patient</h3>
      <div className="atlas-tiles small">
        {entries.map((e) => {
          const t = thumb(e.seriesUid);
          const [who, what] = e.caseTitle.includes(' · ') ? e.caseTitle.split(' · ') : ['', e.caseTitle];
          return (
            <Link key={e.targetId} className="case-card" to={link(e)}>
              <span className="case-art" aria-hidden>
                <span style={t ? { backgroundImage: `url(${t})` } : undefined} />
                <span className="case-tags">
                  <i>{FAMILY_LABEL[e.family] ?? e.family}</i>
                  <i className={isAutomatic(e.provenance) ? '' : 'expert'}>{provenanceTag(e.provenance)}</i>
                </span>
              </span>
              <span className="case-meta">
                <b>{who || what}</b>
                <small>{who ? what : ''}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
