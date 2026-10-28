import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { ProvenanceChip } from '../components/ui';
import { provenanceMethod } from '../lib/provenance';
import { newId } from '../services/progressRepository';

/**
 * Small content-inspection tool: inspect references, record YOUR review or dispute (stored
 * separately; originals are never overwritten), attach personal notes. Reviews are exported
 * with your progress backup.
 */
const PAGE = 100;

export default function AuthorPage() {
  const { catalog, reviews, progress, settings } = useApp();
  const [filter, setFilter] = useState<'all' | 'ai_draft' | 'source_manual' | 'disputed'>('all');
  const [note, setNote] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const targets = useMemo(() => (catalog ? [...catalog.targets.values()] : []), [catalog]);
  // Where to inspect each target: the task that uses it, else (anatomy outlines) a case showing its series, with it shown alone.
  const inspectLink = useMemo(() => {
    const m = new Map<string, string>();
    if (!catalog) return m;
    const caseBySeries = new Map<string, string>();
    for (const k of catalog.cases.values()) for (const s of catalog.seriesForCase(k)) if (!caseBySeries.has(s.uid)) caseBySeries.set(s.uid, k.id);
    for (const task of catalog.tasks.values())
      for (const x of task.targets) if (!m.has(x.targetId)) m.set(x.targetId, `/read/${encodeURIComponent(task.caseId)}?task=${encodeURIComponent(task.id)}&mode=learn`);
    for (const t of catalog.targets.values()) {
      const caseId = caseBySeries.get(t.seriesUid);
      if (!m.has(t.id) && caseId) m.set(t.id, `/read/${encodeURIComponent(caseId)}?mode=learn&show=${encodeURIComponent(t.id)}`);
    }
    return m;
  }, [catalog]);
  const reviewBy = new Map(reviews.map((r) => [r.targetId, r]));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = targets.filter(
    (t) =>
      (filter === 'all' ? true : filter === 'disputed' ? reviewBy.get(t.id)?.status === 'disputed' : t.provenance === filter) &&
      words.every((w) => t.label.toLowerCase().includes(w) || t.id.toLowerCase().includes(w)),
  );
  if (!catalog) return <div className="page-inner">Loading…</div>;

  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <h1>Content inspection</h1>
      <p className="muted">
        Inspect every reference target with its provenance. Marking a draft as reviewed records <b>your</b> review (name, time, note) in this browser and lets it score your
        attempts; the source files stay unchanged. Disputes and corrections are kept as notes beside the original.
      </p>
      <div className="row wrap">
        {(['all', 'ai_draft', 'source_manual', 'disputed'] as const).map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => (setFilter(f), setLimit(PAGE))}>
            {f.replace('_', ' ')}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search a structure or patient id, e.g. “aorta arch” or “16434411”"
          value={q}
          onChange={(e) => (setQ(e.target.value), setLimit(PAGE))}
          aria-label="Search targets"
          style={{ minWidth: 320 }}
        />
        <span className="faint">
          {shown.length} target(s){shown.length > limit ? ` · showing ${limit}` : ''}
        </span>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Provenance</th>
              <th>Scope</th>
              <th>Your review</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((t) => {
              const r = reviewBy.get(t.id);
              const link = inspectLink.get(t.id);
              return (
                <tr key={t.id}>
                  <td>
                    <b>{t.label}</b>
                    <div className="faint mono" style={{ fontSize: 11 }}>
                      {t.id}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {provenanceMethod(t)}
                    </div>
                    {t.teachingNote ? <div className="faint" style={{ fontSize: 12 }}>{t.teachingNote}</div> : null}
                  </td>
                  <td>
                    <ProvenanceChip provenance={t.provenance} />
                  </td>
                  <td>
                    <span className="chip">{t.completeness.replace(/_/g, ' ')}</span>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {t.unassessedNote}
                    </div>
                  </td>
                  <td>
                    {r ? (
                      <span className={`chip ${r.status === 'disputed' ? 'bad' : 'ok'}`}>
                        {r.status === 'disputed' ? 'Disputed' : 'Reviewed'} by {r.reviewer}
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                    {r?.note ? <div className="faint" style={{ fontSize: 12 }}>{r.note}</div> : null}
                  </td>
                  <td className="stack" style={{ gap: 4, minWidth: 220 }}>
                    {link ? (
                      <Link className="btn sm" to={link}>
                        Inspect in viewer
                      </Link>
                    ) : null}
                    <input type="text" placeholder="Review note" value={note[t.id] ?? ''} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} aria-label={`Note for ${t.label}`} />
                    <div className="row">
                      <button
                        className="btn sm"
                        onClick={() => progress.saveReview({ targetId: t.id, status: 'reviewed_by_user', reviewer: settings.reviewerName || 'me', at: new Date().toISOString(), note: note[t.id] ?? '' })}
                      >
                        I reviewed it
                      </button>
                      <button
                        className="btn sm"
                        onClick={async () => {
                          await progress.saveReview({ targetId: t.id, status: 'disputed', reviewer: settings.reviewerName || 'me', at: new Date().toISOString(), note: note[t.id] ?? '' });
                          await progress.saveNote({ id: newId(), scope: 'target', refId: t.id, kind: 'dispute', text: note[t.id] ?? '', createdAt: new Date().toISOString() });
                        }}
                      >
                        Dispute
                      </button>
                      {r ? (
                        <button className="btn sm ghost" onClick={() => progress.deleteReview(t.id)}>
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length > limit ? (
          <button className="btn" style={{ margin: 12 }} onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, shown.length - limit)} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
