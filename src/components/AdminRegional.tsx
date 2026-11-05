import { useCallback, useEffect, useState } from 'react';

/** Mirrors server/regional.ts regionalStatus(). */
interface RegionalStatus {
  live: boolean;
  ready: boolean;
  verified: boolean;
  plans: Array<{ id: string; label: string; region: 'b' | 'c'; problems: string[] }>;
  payments: Array<{ id: string; plan: string; status: string | null; amount: number | null; createdAt: string; approved: boolean | null; blocked: boolean }>;
  unapproved: number;
  rulePrefix: string;
  countries: Record<'b' | 'c', string[]>;
  prices: Array<{ label: string; region: 'b' | 'c'; price: number; link: string }>;
}

const when = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/**
 * Regional prices: lower prices for cards issued in the B and C countries. The card rules live in Whop (Settings →
 * Payment rules); this shows whether the plans are set up right, every payment on them and whether a rule approved
 * it, and the switch. The switch turns on only after a real payment proved the rules work.
 */
export function AdminRegional() {
  const [status, setStatus] = useState<RegionalStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await fetch('/api/admin/regional', { cache: 'no-store' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Could not load regional prices (HTTP ${r.status}).`);
      setStatus(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, []);
  useEffect(() => void load(), [load]);
  async function setLive(live: boolean) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/admin/regional/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ live }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `The change failed (HTTP ${r.status}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change failed.');
    } finally {
      setBusy(false);
    }
  }
  const blocker = !status ? '' : !status.ready ? 'A plan in Whop needs fixing first (see the list).' : !status.verified ? 'Waiting for one test payment that a regional allow rule approved.' : '';
  return (
    <div className="notice stack" style={{ gap: 8 }}>
      <b>
        Regional prices · {status ? (status.live ? 'on' : 'off') : '…'}
      </b>
      <span className="muted">
        Lower prices for cards issued in the countries below. The visitor's country picks the price; Whop's payment rules decline any card from elsewhere, and a regional payment opens nothing unless a rule named “{status?.rulePrefix ?? 'RVM regional allow'}…” approved it.
      </span>
      {error ? <span className="notice bad">{error}</span> : null}
      {status ? (
        <>
          <span className="stack" style={{ gap: 2 }}>
            {status.plans.map((p) => (
              <span key={p.id}>
                {p.problems.length ? '✗' : '✓'} {p.label}
                {p.problems.length ? <span className="muted"> · {p.problems.join('; ')}</span> : null}
              </span>
            ))}
          </span>
          {status.unapproved ? (
            <span className="notice bad">
              {status.unapproved} paid regional {status.unapproved === 1 ? 'payment was' : 'payments were'} not approved by a card rule. {status.unapproved === 1 ? 'It' : 'They'} opened nothing; refund {status.unapproved === 1 ? 'it' : 'them'} in Whop.
            </span>
          ) : null}
          <span>
            {status.payments.length ? (
              <>
                Last payments on regional plans:
                <span className="stack" style={{ gap: 2, marginTop: 4 }}>
                  {status.payments.slice(0, 8).map((p) => (
                    <span key={p.id} className="muted">
                      {when(p.createdAt)} · {p.plan} · {p.amount !== null ? `$${p.amount}` : '—'} · {p.status ?? 'unknown'} · {p.approved ? 'approved by the card rule' : p.blocked ? 'declined by the card rule' : p.approved === false ? 'not approved' : 'rules unknown'}
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <span className="muted">No payments on the regional plans yet.</span>
            )}
          </span>
          <span className="row wrap" style={{ gap: 8 }}>
            {status.live ? (
              <button className="btn" disabled={busy} onClick={() => void setLive(false)}>
                {busy ? 'Turning off…' : 'Turn regional prices off'}
              </button>
            ) : (
              <button className="btn primary" disabled={busy || !!blocker} onClick={() => void setLive(true)}>
                {busy ? 'Turning on…' : 'Turn regional prices on'}
              </button>
            )}
            <button className="btn" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide set-up' : 'Set-up and test links'}
            </button>
          </span>
          {!status.live && blocker ? <span className="muted">{blocker}</span> : null}
          {open ? (
            <span className="stack" style={{ gap: 6 }}>
              <span>
                <b>Countries.</b> B (about half price): {status.countries.b.join(', ')}. C (one-time passes): {status.countries.c.join(', ')}.
              </span>
              <span>
                <b>Test.</b> Pay one regional price with a card from that region using its Whop link, check it shows “approved by the card rule” here, then refund it in Whop:
              </span>
              <span className="stack" style={{ gap: 2 }}>
                {status.prices.map((p) => (
                  <a key={p.link} href={p.link} target="_blank" rel="noopener noreferrer">
                    {p.label}
                  </a>
                ))}
              </span>
            </span>
          ) : null}
        </>
      ) : !error ? (
        <span className="muted">Checking the regional plans in Whop…</span>
      ) : null}
    </div>
  );
}
