import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useAccount } from '../auth/AccountGate';
import '../styles/upgrade.css';

type Metric = 'visit' | 'signup_start' | 'signup' | 'studied' | 'plans' | 'checkout' | 'paid';
interface Stats {
  series: Array<{ day: string } & Record<Metric, number>>;
  totals: Record<Metric, number>;
  accounts: number;
  subscribers: number;
  retention: { d1: { base: number; back: number }; d7: { base: number; back: number } };
}

const STEPS: Array<[Metric, string]> = [
  ['visit', 'Landing visits'],
  ['signup_start', 'Clicked Start free'],
  ['signup', 'Accounts created'],
  ['studied', 'Answered a first task'],
  ['plans', 'Opened the plans'],
  ['checkout', 'Started checkout'],
  ['paid', 'Paid'],
];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** Owner's numbers: the sign-up funnel and retention (admin accounts only). */
export default function AdminPage() {
  const account = useAccount();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const load = () => {
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
      <div className="row">
        <h1 style={{ margin: 0 }}>Numbers</h1>
        <span className="spacer" />
        <button className="btn" onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
        <a className="btn" href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">
          Web Analytics <ExternalLink size={13} />
        </a>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      {stats ? (
        <>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Funnel, last 30 days</h2>
            <ol className="funnel">
              {STEPS.map(([m, label], i) => {
                const v = stats.totals[m];
                const first = stats.totals.visit || Math.max(...STEPS.map(([k]) => stats.totals[k]), 1);
                return (
                  <li key={m}>
                    <span className="funnel-label">{label}</span>
                    <span className="funnel-bar">
                      <span style={{ width: `${Math.max(2, (v / first) * 100)}%` }} />
                    </span>
                    <b>{v}</b>
                    <small className="faint">{i ? `${pct(v, stats.totals[STEPS[i - 1][0]])} of the step before` : ''}</small>
                  </li>
                );
              })}
            </ol>
            <small className="faint">Landing visits and Start-free clicks are counted once per browser session; accounts by their first sign-in; Paid once per account.</small>
          </section>
          <div className="grid-3">
            <section className="card stack">
              <b>Accounts</b>
              <span className="big-num">{stats.accounts}</span>
              <small className="faint">{stats.subscribers} want emails</small>
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
        <p className="muted">Loading…</p>
      ) : null}
    </div>
  );
}
