import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { REPORT_KIND_LABEL, type ReportKind } from '../services/reports';

interface Report {
  id: string;
  at: string;
  kind: ReportKind;
  text: string;
  caseId: string;
  taskId: string;
  mode: string;
  exam?: boolean;
  view: { seriesUid: string; kind: string; slice: number; of: number } | null;
  email: string;
  name: string;
  done: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** What learners reported as wrong on a case, open ones first; each opens its case in Learn mode and can be marked fixed. */
export function AdminReports({ version }: { version: number }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setError('');
    fetch('/api/admin/reports', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return setError(`Could not load the case reports (HTTP ${r.status}).`);
        const body = (await r.json()) as { reports?: Report[] };
        setReports(Array.isArray(body.reports) ? body.reports : []);
      })
      .catch(() => setError('Could not reach the server.'));
  }, [version]);
  const openPerTask = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports ?? []) if (!r.done) m.set(r.taskId, (m.get(r.taskId) ?? 0) + 1);
    return m;
  }, [reports]);
  const open = reports?.filter((r) => !r.done).length ?? 0;
  const shown = (reports ?? []).filter((r) => all || !r.done);
  const resolve = async (id: string, done: boolean) => {
    setBusy(id);
    setError('');
    const ok = await fetch('/api/admin/reports/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, done }) })
      .then((r) => r.ok)
      .catch(() => false);
    setBusy(null);
    if (!ok) return setError('That change was not saved. Please try again.');
    setReports((rs) => rs?.map((r) => (r.id === id ? { ...r, done } : r)) ?? rs);
  };
  return (
    <section className="card stack" aria-labelledby="reports-title">
      <div className="row wrap">
        <h2 id="reports-title" style={{ margin: 0 }}>
          Case reports
        </h2>
        {reports ? <span className={`chip${open ? ' warn' : ''}`}>{open} open</span> : null}
        <span className="spacer" />
        <div className="row" role="group" aria-label="Which reports">
          <button type="button" className="chip" aria-pressed={!all} onClick={() => setAll(false)}>
            Open
          </button>
          <button type="button" className="chip" aria-pressed={all} onClick={() => setAll(true)}>
            All
          </button>
        </div>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      {!reports ? (
        error ? null : <p className="muted">Loading the case reports…</p>
      ) : !shown.length ? (
        <p className="muted">{all ? 'No reports yet.' : 'No open reports.'}</p>
      ) : (
        <ul className="report-list">
          {shown.map((r) => {
            const same = openPerTask.get(r.taskId) ?? 0;
            return (
              <li key={r.id} className={r.done ? 'done' : undefined}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <b>{REPORT_KIND_LABEL[r.kind] ?? r.kind}</b>
                  <Link className="mono" to={`/read/${encodeURIComponent(r.caseId)}?task=${encodeURIComponent(r.taskId)}&mode=learn`}>
                    {r.taskId}
                  </Link>
                  {same > 1 && !r.done ? <span className="chip warn">{same} open reports on this task</span> : null}
                  {r.exam ? <span className="chip">In an exam</span> : null}
                  {r.done ? <span className="chip ok">Fixed</span> : null}
                  <span className="spacer" />
                  <small className="faint">{when(r.at)}</small>
                </div>
                {r.text ? <p className="report-text">{r.text}</p> : <p className="faint report-text">No details given.</p>}
                <div className="row wrap" style={{ gap: 8 }}>
                  <small className="faint">
                    {r.mode}
                    {r.view ? ` · slice ${r.view.slice} of ${r.view.of}${r.view.kind !== 'stack' ? ` (${r.view.kind})` : ''}` : ''} · {r.name}{' '}
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                  </small>
                  <span className="spacer" />
                  <button type="button" className="btn sm" disabled={busy === r.id} onClick={() => resolve(r.id, !r.done)}>
                    {r.done ? 'Open again' : 'Mark fixed'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
