import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useAccount } from '../auth/AccountGate';
import '../styles/upgrade.css';
import { AdminPeople, type AdminPermission } from '../components/AdminPeople';
import { AdminPromos } from '../components/AdminPromos';
import { CertificateAdmin } from '../components/CertificateAdmin';
import { AdminReports } from '../components/AdminReports';

type Metric =
  | 'visit'
  | 'guest_open'
  | 'guest_mark'
  | 'guest_mark_s'
  | 'guest_answer'
  | 'guest_second'
  | 'signup_start'
  | 'code_sent'
  | 'signup'
  | 'opened'
  | 'studied'
  | 'plans'
  | 'checkout'
  | 'checkout_ready'
  | 'checkout_error'
  | 'paid';
interface SourceRow {
  source: string;
  visits: number;
  tried?: number;
  marked?: number;
  answered?: number;
  second?: number;
  starts: number;
  codes?: number;
  accounts: number;
  studied: number;
  paid: number;
}
interface Stats {
  series: Array<{ day: string } & Record<Metric, number>>;
  totals: Record<Metric, number>;
  accounts: number;
  subscribers: number;
  retention: { d1: { base: number; back: number }; d7: { base: number; back: number } };
  /** Per campaign tag (utm_source:utm_campaign, plus :utm_content when the link has one) over 30 days; the last row, with no tag, is everything untagged. */
  sources?: SourceRow[];
}

const STEPS: Array<[Metric, string]> = [
  ['visit', 'Landing visits'],
  ['signup_start', 'Clicked Start free'],
  ['code_sent', 'Email code sent'],
  ['signup', 'Accounts created'],
  ['opened', 'Opened a first case'],
  ['studied', 'Answered a first task'],
  ['plans', 'Opened the plans'],
  ['checkout', 'Started checkout'],
  ['checkout_ready', 'Saw the payment form'],
  ['paid', 'Paid'],
];

/** Everything on this page as one CSV (per-day counts, then the campaigns), for a spreadsheet. */
function statsCsv(stats: Stats): string {
  const cell = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const metrics = Object.keys(stats.totals) as Metric[];
  const lines = [['day', ...metrics].join(',')];
  for (const d of stats.series) lines.push([d.day, ...metrics.map((m) => d[m] ?? 0)].map(cell).join(','));
  lines.push(['total', ...metrics.map((m) => stats.totals[m] ?? 0)].map(cell).join(','));
  lines.push('');
  const cols: Array<keyof SourceRow> = ['source', 'visits', 'tried', 'marked', 'answered', 'second', 'starts', 'codes', 'accounts', 'studied', 'paid'];
  lines.push(cols.join(','));
  for (const r of stats.sources ?? []) lines.push(cols.map((c) => cell(c === 'source' ? r.source || '(no tag)' : (r[c] ?? 0))).join(','));
  return lines.join('\n') + '\n';
}


function downloadCsv(stats: Stats) {
  const url = URL.createObjectURL(new Blob([statsCsv(stats)], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `radiology-monster-funnel-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** The owner's dashboard: accounts and free access, the sign-up funnel and retention, certificates (admin accounts only). */
export default function AdminPage() {
  const account = useAccount();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const permissions = account?.account.adminPermissions;
  // Stable while the permissions are, so the people list does not reload on every render.
  const can = useCallback((p: AdminPermission) => !!permissions?.includes(p), [permissions?.join()]);
  const load = () => {
    if (!can('numbers')) return;
    setError('');
    fetch('/api/admin/stats', { cache: 'no-store' })
      .then(async (r) => (r.ok ? setStats(await r.json()) : setError(r.status === 403 ? 'Admin accounts only.' : `Could not load the numbers (HTTP ${r.status}).`)))
      .catch(() => setError('Could not reach the server.'));
  };
  useEffect(load, []);
  if (account?.account.access.role !== 'admin') return <div className="page-inner"><h1>Admin</h1><p className="muted">Admin accounts only.</p></div>;
  const max = Math.max(1, ...(stats?.series.map((d) => d.visit) ?? [1]));
  return (
    <div className="page-inner stack admin" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1 style={{ margin: 0 }}>Admin</h1>
        <span className="spacer" />
        <button
          className="btn"
          onClick={() => {
            load();
            setVersion((v) => v + 1);
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
        {stats ? (
          <button className="btn" onClick={() => downloadCsv(stats)}>
            <Download size={14} /> Download CSV
          </button>
        ) : null}
        <a className="btn" href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">
          Web Analytics <ExternalLink size={13} />
        </a>
      </div>
      {can('people') || can('add') ? <AdminPeople version={version} can={can} /> : null}
      {can('promos') ? <AdminPromos version={version} /> : null}
      {can('reports') ? <AdminReports version={version} /> : null}
      {!['people', 'add', 'promos', 'numbers', 'certificates', 'reports'].some((p) => can(p as AdminPermission)) ? <p className="muted">There is nothing here for your account yet.</p> : null}
      {error ? <div className="notice bad">{error}</div> : null}
      {!can('numbers') ? null : stats ? (
        <>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Funnel, last 30 days</h2>
            <ol className="funnel">
              {STEPS.map(([m, label], i) => {
                const v = stats.totals[m] ?? 0;
                const first = stats.totals.visit || Math.max(...STEPS.map(([k]) => stats.totals[k] ?? 0), 1);
                return (
                  <li key={m}>
                    <span className="funnel-label">{label}</span>
                    <span className="funnel-bar">
                      <span style={{ width: `${Math.max(2, (v / first) * 100)}%` }} />
                    </span>
                    <b>{v}</b>
                    <small className="faint">{i ? `${pct(v, stats.totals[STEPS[i - 1][0]] ?? 0)} of the step before` : ''}</small>
                  </li>
                );
              })}
            </ol>
            <p className="admin-guests" aria-label="Tried a sample patient without an account">
              <b>Without an account</b> (from an ad or a link to a sample patient): opened a case <b>{stats.totals.guest_open ?? 0}</b> · marked it{' '}
              <b>{stats.totals.guest_mark ?? 0}</b>{' '}
              <small className="faint">
                {stats.totals.guest_mark ? `after ${Math.round((stats.totals.guest_mark_s ?? 0) / stats.totals.guest_mark)} s on average` : ''}
              </small>{' '}
              · answered it <b>{stats.totals.guest_answer ?? 0}</b> <small className="faint">{pct(stats.totals.guest_answer ?? 0, stats.totals.guest_open ?? 0)} of those who opened it</small> · opened a second
              task <b>{stats.totals.guest_second ?? 0}</b> <small className="faint">{pct(stats.totals.guest_second ?? 0, stats.totals.guest_answer ?? 0)} of those who answered</small>
              {stats.totals.checkout_error ? (
                <>
                  {' '}
                  · payment form failed to load <b>{stats.totals.checkout_error}</b>
                </>
              ) : null}
            </p>
            <small className="faint">Landing visits, cases opened and answered without an account (counted from 4 November 2026) and Start-free clicks are counted once per browser session; accounts by their first sign-in; Opened a first case (counted from 4 November 2026) once per account, when a case's images are on screen; Paid once per account (free access is not counted).</small>
          </section>
          {stats.sources ? (
            <section className="card stack" aria-labelledby="sources-title">
              <h2 id="sources-title" style={{ margin: 0 }}>
                Where sign-ups come from, last 30 days
              </h2>
              <small className="faint">
                Tag every ad and post link, for example <span className="mono">https://www.radiology.monster/?utm_source=instagram&amp;utm_campaign=find-it</span>; add <span className="mono">&amp;utm_content=a</span>, <span className="mono">b</span>… to tell ads of one campaign apart. Accounts are counted by the tag they arrived with, and First answer and Paid are of those accounts.
              </small>
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Visits</th>
                    <th>Tried a case</th>
                    <th>Marked</th>
                    <th>Answered</th>
                    <th>2nd task</th>
                    <th>Start free</th>
                    <th>Code sent</th>
                    <th>Accounts</th>
                    <th>First answer</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sources.map((r) => (
                    <tr key={r.source || 'untagged'}>
                      <td>{r.source ? <span className="mono">{r.source}</span> : <span className="faint">No tag (direct, search, old links)</span>}</td>
                      <td data-label="Visits">{r.visits}</td>
                      <td data-label="Tried a case">{r.tried ?? 0}</td>
                      <td data-label="Marked">{r.marked ?? 0}</td>
                      <td data-label="Answered">{r.answered ?? 0}</td>
                      <td data-label="2nd task">{r.second ?? 0}</td>
                      <td data-label="Start free">{r.starts}</td>
                      <td data-label="Code sent">{r.codes ?? 0}</td>
                      <td data-label="Accounts">{r.accounts}</td>
                      <td data-label="First answer">
                        {r.studied} <small className="faint">{pct(r.studied, r.accounts)}</small>
                      </td>
                      <td data-label="Paid" style={{ textAlign: 'left' }}>
                        {r.paid} <small className="faint">{pct(r.paid, r.accounts)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <div className="grid-3">
            <section className="card stack">
              <b>Want emails</b>
              <span className="big-num">{stats.subscribers}</span>
              <small className="faint">accounts with a streak reminder or the case of the week switched on</small>
            </section>
            <section className="card stack">
              <b>Back on day 1+</b>
              <span className="big-num">{pct(stats.retention.d1.back, stats.retention.d1.base)}</span>
              <small className="faint">
                {stats.retention.d1.back} of {stats.retention.d1.base} accounts studied again from the day after joining
              </small>
            </section>
            <section className="card stack">
              <b>Back on day 7+</b>
              <span className="big-num">{pct(stats.retention.d7.back, stats.retention.d7.base)}</span>
              <small className="faint">
                {stats.retention.d7.back} of {stats.retention.d7.base} accounts studied a week or more after joining
              </small>
            </section>
          </div>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Day by day</h2>
            <div className="daily" role="img" aria-label="Landing visits and sign-ups per day">
              {stats.series.map((d) => (
                <span key={d.day} title={`${d.day}: ${d.visit} visits, ${d.signup} sign-ups, ${d.paid} paid`}>
                  <i style={{ height: `${(d.visit / max) * 100}%` }} />
                  <em style={{ height: `${(d.signup / max) * 100}%` }} />
                </span>
              ))}
            </div>
            <small className="faint">Grey: landing visits · blue: accounts created. Hover a day for its numbers.</small>
          </section>
        </>
      ) : !error ? (
        <p className="muted">Loading the funnel…</p>
      ) : null}
      {can('certificates') ? <CertificateAdmin /> : null}
    </div>
  );
}
