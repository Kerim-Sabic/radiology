import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

/**
 * Admin → Journeys: the anonymous event log (docs/TRACKING.md) as answers. Every view follows the filters: dates, ad tag,
 * country, device, connection, and "people only" (visitors who touched, typed or scrolled).
 */
type Pairs = Array<[string, number]>;
interface DayStats { day: string; visitors: number; sawImage: number; answered: number; newAccounts: number; sawPlans: number; pressedPlan: number; paid: number; firstImageP50: number | null }
interface Report {
  visitors: number;
  sessions: number;
  events: number;
  funnel: Array<{ step: string; visitors: number; ofPrevious: number | null; medianS: number | null; p75S: number | null }>;
  leaves: Pairs;
  lastSteps: Pairs;
  cohorts: Array<{ day: string; accounts: number; studiedDay1: number; returned2to7: number; plans7: number; paid7: number }>;
  paywall: { hits: Pairs; next: Pairs };
  payment: { plansView: number; planClick: number; checkoutCreated: number; checkoutReady: number; paid: number; declined: Pairs; refused: Pairs };
  email: { campaigns: Array<{ campaign: string; visits: number; paid: number }>; codesRedeemed: number };
  speed: {
    firstImage: { n: number; p50: number | null; p75: number | null };
    byCountry: Array<{ key: string; n: number; p50: number | null; p75: number | null }>;
    byConnection: Array<{ key: string; n: number; p50: number | null; p75: number | null }>;
    imageErrorSessions: number;
    caseSessions: number;
    jsErrorSessions: number;
    sessions: number;
    slow: Pairs;
  };
  daily: { yesterday: DayStats; dayBefore: DayStats; today: DayStats };
}

const STEP: Record<string, string> = {
  land: 'Arrived',
  first_image: 'Saw the first image',
  mark: 'Marked it',
  answer: 'Answered',
  grade_seen: 'Saw the grade',
  save_click: 'Pressed Start free / Save it',
  form_shown: 'Saw the sign-up form',
  code_sent: 'Email code sent',
  account: 'Signed in',
  plans_view: 'Saw the plans',
  plan_click: 'Pressed a plan',
  checkout_created: 'Checkout created',
  checkout_ready: 'Saw the payment form',
  paid: 'Paid',
};
const DAILY: Array<[keyof DayStats, string]> = [
  ['visitors', 'Visitors'],
  ['sawImage', 'Saw a case image'],
  ['answered', 'Answered a case'],
  ['newAccounts', 'New accounts'],
  ['sawPlans', 'Saw the plans'],
  ['pressedPlan', 'Pressed a plan'],
  ['paid', 'Paid'],
  ['firstImageP50', 'First image, median ms'],
];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const s = (v: number | null) => (v === null ? '–' : v < 120 ? `${v} s` : `${Math.round(v / 60)} min`);

function List({ rows, empty }: { rows: Pairs; empty: string }) {
  return rows.length ? (
    <table className="table admin-table">
      <tbody>
        {rows.map(([k, n]) => (
          <tr key={k}>
            <td>{k}</td>
            <td style={{ textAlign: 'right' }}>{n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="faint">{empty}</p>
  );
}

export function AdminJourneys() {
  const [f, setF] = useState({ from: iso(Date.now() - 6 * 86_400_000), to: iso(Date.now()), tag: '', country: '', device: '', conn: '', humans: true });
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = () => {
    const q = new URLSearchParams({ from: f.from, to: f.to, humans: f.humans ? '1' : '0' });
    for (const k of ['tag', 'country', 'device', 'conn'] as const) if (f[k]) q.set(k, f[k]);
    return q.toString();
  };
  const load = () => {
    setBusy(true);
    setError('');
    fetch(`/api/admin/journeys?${query()}`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? setR(await res.json()) : setError(res.status === 403 ? 'Admin accounts only.' : `Could not load the journeys (HTTP ${res.status}).`)))
      .catch(() => setError('Could not reach the server.'))
      .finally(() => setBusy(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean } }) => setF({ ...f, [k]: k === 'humans' ? !!e.target.checked : e.target.value });

  return (
    <section className="card stack admin-journeys" aria-labelledby="journeys-title">
      <h2 id="journeys-title" style={{ margin: 0 }}>
        Journeys
      </h2>
      <small className="faint">
        From the anonymous event log: one random id per browser, no cookies, no personal data. Tests, automation, previews, admins and professors are not logged. Times are from each visitor’s first event.
      </small>
      <form
        className="row wrap journeys-filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label>
          From <input type="date" value={f.from} onChange={set('from')} />
        </label>
        <label>
          To <input type="date" value={f.to} onChange={set('to')} />
        </label>
        <label>
          Ad tag <input value={f.tag} onChange={set('tag')} placeholder="meta:reel002" size={14} />
        </label>
        <label>
          Country <input value={f.country} onChange={set('country')} placeholder="IN" size={3} maxLength={2} />
        </label>
        <label>
          Device{' '}
          <select value={f.device} onChange={set('device')}>
            <option value="">all</option>
            <option value="phone">phone</option>
            <option value="tablet">tablet</option>
            <option value="desktop">desktop</option>
          </select>
        </label>
        <label>
          Connection{' '}
          <select value={f.conn} onChange={set('conn')}>
            <option value="">all</option>
            <option value="4g">4g</option>
            <option value="3g">3g</option>
            <option value="2g">2g</option>
            <option value="slow-2g">slow-2g</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={f.humans} onChange={set('humans')} /> People only
        </label>
        <button className="btn" type="submit" disabled={busy}>
          <RefreshCw size={14} /> Show
        </button>
        <a className="btn" href={`/api/admin/journeys.csv?kind=funnel&${query()}`}>
          <Download size={14} /> Funnel CSV
        </a>
        <a className="btn" href={`/api/admin/journeys.csv?kind=events&${query()}`}>
          <Download size={14} /> Events CSV
        </a>
      </form>
      {error ? <div className="notice bad">{error}</div> : null}
      {!r ? (
        <p className="faint">{busy ? 'Loading…' : ''}</p>
      ) : (
        <>
          <h3>Yesterday vs the day before</h3>
          <table className="table admin-table">
            <thead>
              <tr>
                <th />
                <th>{r.daily.yesterday.day}</th>
                <th>{r.daily.dayBefore.day}</th>
                <th>Today so far</th>
              </tr>
            </thead>
            <tbody>
              {DAILY.map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>
                    <b>{r.daily.yesterday[k] ?? '–'}</b>
                  </td>
                  <td>{r.daily.dayBefore[k] ?? '–'}</td>
                  <td className="faint">{r.daily.today[k] ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>
            Funnel <small className="faint">{r.visitors} visitors · {r.sessions} sessions · {r.events} events</small>
          </h3>
          <table className="table admin-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Visitors</th>
                <th>Of the step before</th>
                <th>Median time</th>
                <th>75th percentile</th>
              </tr>
            </thead>
            <tbody>
              {r.funnel.map((row) => (
                <tr key={row.step}>
                  <td>{STEP[row.step] ?? row.step}</td>
                  <td>{row.visitors}</td>
                  <td>{row.ofPrevious === null ? '' : `${row.ofPrevious}%`}</td>
                  <td>{s(row.medianS)}</td>
                  <td>{s(row.p75S)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="journeys-grid">
            <div>
              <h3>Where people leave</h3>
              <small className="faint">Page · the last thing done before leaving it</small>
              <List rows={r.leaves} empty="No departures logged yet." />
            </div>
            <div>
              <h3>Last step of each session</h3>
              <List rows={r.lastSteps} empty="No sessions yet." />
            </div>
            <div>
              <h3>The paywall</h3>
              <small className="faint">What was locked</small>
              <List rows={r.paywall.hits} empty="No locked page shown yet." />
              <small className="faint">What they did next</small>
              <List rows={r.paywall.next} empty="—" />
            </div>
            <div>
              <h3>Paying</h3>
              <table className="table admin-table">
                <tbody>
                  <tr>
                    <td>Saw the plans</td>
                    <td>{r.payment.plansView}</td>
                  </tr>
                  <tr>
                    <td>Pressed a plan</td>
                    <td>
                      {r.payment.planClick} <small className="faint">{pct(r.payment.planClick, r.payment.plansView)}</small>
                    </td>
                  </tr>
                  <tr>
                    <td>Checkout created</td>
                    <td>{r.payment.checkoutCreated}</td>
                  </tr>
                  <tr>
                    <td>Saw the payment form</td>
                    <td>{r.payment.checkoutReady}</td>
                  </tr>
                  <tr>
                    <td>Paid</td>
                    <td>{r.payment.paid}</td>
                  </tr>
                </tbody>
              </table>
              <small className="faint">Checkouts refused (HTTP status)</small>
              <List rows={r.payment.refused} empty="None." />
              <small className="faint">Declined (country · reason; needs Whop's webhook)</small>
              <List rows={r.payment.declined} empty="None logged." />
            </div>
            <div>
              <h3>Email</h3>
              {r.email.campaigns.length ? (
                <table className="table admin-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Visits</th>
                      <th>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.email.campaigns.map((c) => (
                      <tr key={c.campaign}>
                        <td>{c.campaign}</td>
                        <td>{c.visits}</td>
                        <td>{c.paid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="faint">No visits from email links yet.</p>
              )}
            </div>
            <div>
              <h3>Speed and errors</h3>
              <p>
                First image: median <b>{r.speed.firstImage.p50 ?? '–'} ms</b>, 75th percentile {r.speed.firstImage.p75 ?? '–'} ms <small className="faint">({r.speed.firstImage.n})</small>
              </p>
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th>Country / connection</th>
                    <th>n</th>
                    <th>Median ms</th>
                    <th>p75 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.speed.byCountry, ...r.speed.byConnection.map((x) => ({ ...x, key: `conn ${x.key}` }))].map((x) => (
                    <tr key={x.key}>
                      <td>{x.key}</td>
                      <td>{x.n}</td>
                      <td>{x.p50 ?? '–'}</td>
                      <td>{x.p75 ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint">
                Image errors in {r.speed.imageErrorSessions} of {r.speed.caseSessions} case sessions · script errors in {r.speed.jsErrorSessions} of {r.speed.sessions} sessions
              </p>
              <List rows={r.speed.slow} empty="No step over 10 s." />
            </div>
          </div>

          <h3>Sign-up cohorts</h3>
          {r.cohorts.length ? (
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Signed up</th>
                  <th>Accounts</th>
                  <th>Studied next day</th>
                  <th>Back on days 2–7</th>
                  <th>Saw plans (7 days)</th>
                  <th>Paid (7 days)</th>
                </tr>
              </thead>
              <tbody>
                {r.cohorts.map((c) => (
                  <tr key={c.day}>
                    <td>{c.day}</td>
                    <td>{c.accounts}</td>
                    <td>{c.studiedDay1}</td>
                    <td>{c.returned2to7}</td>
                    <td>{c.plans7}</td>
                    <td>{c.paid7}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="faint">No new accounts in this range yet.</p>
          )}
        </>
      )}
    </section>
  );
}
