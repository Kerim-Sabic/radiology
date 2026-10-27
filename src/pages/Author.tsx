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
export default function AuthorPage() {
  const { catalog, reviews, progress, settings } = useApp();
  const [filter, setFilter] = useState<'all' | 'ai_draft' | 'source_manual' | 'disputed'>('all');
  const [note, setNote] = useState<Record<string, string>>({});
  const targets = useMemo(() => (catalog ? [...catalog.targets.values()] : []), [catalog]);
  const reviewBy = new Map(reviews.map((r) => [r.targetId, r]));
  const shown = targets.filter((t) => (filter === 'all' ? true : filter === 'disputed' ? reviewBy.get(t.id)?.status === 'disputed' : t.provenance === filter));
  if (!catalog) return <div className="page-inner">Loading…</div>;
  const caseForTarget = (id: string) => [...catalog.tasks.values()].find((t) => t.targets.some((x) => x.targetId === id));

  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <h1>Content inspection</h1>
      <p className="muted">
        Inspect every reference target with its provenance. Marking a draft as reviewed records <b>your</b> review (name, time, note) in this browser and lets it score your
        attempts; the source files stay unchanged. Disputes and corrections are kept as notes beside the original.
      </p>
      <div className="row wrap">
        {(['all', 'ai_draft', 'source_manual', 'disputed'] as const).map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f.replace('_', ' ')}
          </button>
        ))}
        <span className="faint">{shown.length} target(s)</span>
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
            {shown.map((t) => {
              const r = reviewBy.get(t.id);
              const task = caseForTarget(t.id);
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
                    {task ? (
                      <Link className="btn sm" to={`/read/${task.caseId}?task=${encodeURIComponent(task.id)}&mode=learn`}>
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
      </div>
    </div>
  );
}
