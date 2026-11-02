import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, Pause, Play, TicketPercent, Trash2 } from 'lucide-react';

/** Mirrors server/promos.ts. */
interface Promo {
  id: string;
  code: string;
  type: 'percentage' | 'flat_amount';
  amountOff: number;
  duration: 'once' | 'repeating' | 'forever';
  months: number | null;
  plans: Array<'monthly' | 'yearly'>;
  uses: number;
  /** Uses allowed in total, and uses left; null for no limit. */
  stock: number | null;
  left: number | null;
  expiresAt: string | null;
  newUsersOnly: boolean;
  onePerCustomer: boolean;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
}
interface Promos {
  promos: Promo[];
  studentOffers: { issued: number; used: number };
}

const PRICE = { monthly: 20, yearly: 150 } as const;
const PLAN = { monthly: 'Monthly', yearly: 'Yearly' } as const;
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shareLink = (code: string) => `${location.origin}/?promo=${encodeURIComponent(code)}`;
const offText = (p: Pick<Promo, 'type' | 'amountOff'>) => (p.type === 'percentage' ? `${p.amountOff}% off` : `${money(p.amountOff)} off`);
function lastsText(p: Pick<Promo, 'duration' | 'months'>) {
  if (p.duration === 'forever' || p.months === 0) return 'every payment';
  if (p.duration === 'once' || p.months === 1) return 'the first payment';
  return `the first ${p.months} months`;
}
/** The price after the discount, never below zero. */
const after = (price: number, type: Promo['type'], amount: number) => Math.max(0, type === 'percentage' ? price * (1 - amount / 100) : price - amount);

async function send(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `The request failed (HTTP ${r.status}).`), { needsWhopAccess: !!data.needsWhopAccess });
  return data;
}

function WhopAccessNotice() {
  return (
    <div className="notice bad stack" style={{ gap: 6 }}>
      <b>Whop has not given this app access to promo codes yet.</b>
      <span>Reconnect Whop once, signed in to Whop as the business owner. It adds promo code permissions only; payments and memberships stay as they are, and no payment is taken.</span>
      <span>
        <a className="btn" href="/api/merchant/connect" target="_blank" rel="noopener">
          Reconnect Whop
        </a>
      </span>
    </div>
  );
}

/** Promo codes, made and kept in Whop: create one for the plans you choose, see its uses, pause, resume or delete it. */
export function AdminPromos({ version }: { version: number }) {
  const [data, setData] = useState<Promos | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await fetch('/api/admin/promos', { cache: 'no-store' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Could not load the promo codes (HTTP ${r.status}).`);
      setNeedsAccess(!!body.needsWhopAccess);
      if (!body.needsWhopAccess) {
        if (!Array.isArray(body.promos)) throw new Error('Could not read the promo codes.');
        setData(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, []);
  useEffect(() => void load(), [load, version]);
  return (
    <section className="card stack" aria-labelledby="promos-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="promos-title" style={{ margin: 0 }}>
          Promo codes
        </h2>
        <p className="muted">Codes are made in Whop, which applies them at checkout and counts their uses. Share a code, or its link that fills it in for the buyer.</p>
      </div>
      {needsAccess ? <WhopAccessNotice /> : null}
      {error ? <div className="notice bad">{error}</div> : null}
      {!needsAccess ? <CreatePromo onDone={load} onNeedsAccess={() => setNeedsAccess(true)} /> : null}
      {data ? <PromoList data={data} onChange={load} /> : !needsAccess && !error ? <p className="muted">Loading the promo codes…</p> : null}
    </section>
  );
}

function CreatePromo({ onDone, onNeedsAccess }: { onDone: () => void; onNeedsAccess: () => void }) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<Promo['type']>('percentage');
  const [amount, setAmount] = useState('20');
  const [plans, setPlans] = useState({ monthly: true, yearly: true });
  const [duration, setDuration] = useState<'once' | 'months' | 'forever'>('once');
  const [months, setMonths] = useState('3');
  const [limited, setLimited] = useState(false);
  const [stock, setStock] = useState('50');
  const [ends, setEnds] = useState(false);
  const [lastDay, setLastDay] = useState('');
  const [newUsersOnly, setNewUsersOnly] = useState(false);
  const [onePerCustomer, setOnePerCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = (['monthly', 'yearly'] as const).filter((t) => plans[t]);
  const value = Number(amount);
  const valid = /^[A-Za-z0-9_-]{3,30}$/.test(code.trim()) && value > 0 && chosen.length > 0 && (!ends || !!lastDay) && (!limited || Number(stock) >= 1) && (duration !== 'months' || Number(months) >= 1);
  const lasts = lastsText({ duration: duration === 'months' ? 'repeating' : duration, months: duration === 'months' ? Number(months) : null });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await send('/api/admin/promos', {
        code: code.trim(),
        type,
        amountOff: value,
        plans: chosen,
        duration,
        ...(duration === 'months' ? { months: Number(months) } : {}),
        stock: limited ? Number(stock) : null,
        lastDay: ends ? lastDay : null,
        newUsersOnly,
        onePerCustomer,
      });
      setResult({ ok: true, text: `Created “${r.code}”. Share it, or the link ${shareLink(r.code)}.` });
      setCode('');
      onDone();
    } catch (err) {
      if ((err as { needsWhopAccess?: boolean }).needsWhopAccess) onNeedsAccess();
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack admin-promo-form" aria-label="Create a promo code" onSubmit={(e) => void submit(e)}>
      <div className="admin-form">
        <label>
          Code
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} maxLength={30} autoComplete="off" spellCheck={false} placeholder="e.g. SPRING20" required />
        </label>
        <label>
          Discount
          <span className="row" style={{ gap: 6 }}>
            <input type="number" min={type === 'percentage' ? 1 : 0.5} max={type === 'percentage' ? 100 : 150} step={type === 'percentage' ? 1 : 0.5} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount off" required />
            <select value={type} onChange={(e) => setType(e.target.value as Promo['type'])} aria-label="Kind of discount">
              <option value="percentage">% off</option>
              <option value="flat_amount">$ off</option>
            </select>
          </span>
        </label>
        <label>
          Lasts for
          <select value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
            <option value="once">The first payment</option>
            <option value="months">A number of months</option>
            <option value="forever">Every payment</option>
          </select>
        </label>
        {duration === 'months' ? (
          <label>
            Months
            <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} required />
          </label>
        ) : null}
      </div>
      <fieldset className="admin-perms">
        <legend>Plans and limits</legend>
        {(['monthly', 'yearly'] as const).map((t) => (
          <label key={t} className="admin-check">
            <input type="checkbox" checked={plans[t]} onChange={(e) => setPlans({ ...plans, [t]: e.target.checked })} /> {PLAN[t]} ({money(PRICE[t])})
          </label>
        ))}
        <label className="admin-check">
          <input type="checkbox" checked={onePerCustomer} onChange={(e) => setOnePerCustomer(e.target.checked)} /> One use per person
        </label>
        <label className="admin-check">
          <input type="checkbox" checked={newUsersOnly} onChange={(e) => setNewUsersOnly(e.target.checked)} /> Only for people who have never paid before
        </label>
        <span className="admin-check">
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} aria-label="Limit the number of uses" /> Limit to
          <input type="number" min={1} value={stock} onChange={(e) => setStock(e.target.value)} disabled={!limited} aria-label="Number of uses" style={{ width: 80 }} /> uses
        </span>
        <span className="admin-check">
          <input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} aria-label="End on a date" /> Ends after
          <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} disabled={!ends} aria-label="Last day" />
        </span>
      </fieldset>
      {valid ? (
        <p className="faint" aria-live="polite">
          {chosen.map((t) => `${PLAN[t]}: ${money(PRICE[t])} → ${money(after(PRICE[t], type, value))} for ${lasts}${lasts === 'every payment' ? '' : `, then ${money(PRICE[t])}`}`).join(' · ')}
        </p>
      ) : null}
      <div className="row wrap">
        <button className="btn primary" type="submit" disabled={busy || !valid}>
          <TicketPercent size={15} /> {busy ? 'Creating…' : 'Create code'}
        </button>
      </div>
      {result ? (
        <p className={`notice ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.text}
        </p>
      ) : null}
    </form>
  );
}

function PromoList({ data, onChange }: { data: Promos; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function change(p: Promo, action: 'pause' | 'resume' | 'delete') {
    setBusy(p.id);
    setMessage(null);
    try {
      await send('/api/admin/promos/change', { id: p.id, action });
      setMessage({ ok: true, text: action === 'pause' ? `“${p.code}” is paused.` : action === 'resume' ? `“${p.code}” works again.` : `“${p.code}” is deleted. Memberships that already use it keep their discount.` });
      setConfirm(null);
      onChange();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setBusy(null);
    }
  }
  async function copy(p: Promo) {
    try {
      await navigator.clipboard.writeText(shareLink(p.code));
      setMessage({ ok: true, text: `Copied the link for “${p.code}”.` });
    } catch {
      setMessage({ ok: true, text: `The link for “${p.code}”: ${shareLink(p.code)}` });
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {data.promos.length ? (
        <table className="table admin-table admin-promos">
          <thead>
            <tr>
              <th>Code</th>
              <th>Discount</th>
              <th>Plans</th>
              <th>Used</th>
              <th>Ends</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.promos.map((p) => (
              <tr key={p.id}>
                <td>
                  <b className="mono">{p.code}</b>
                  <small className="faint">{p.left === 0 ? 'used up' : p.status === 'active' ? 'working' : 'paused'}{p.newUsersOnly ? ' · new customers only' : ''}{p.onePerCustomer ? ' · one per person' : ''}</small>
                </td>
                <td data-label="Discount">
                  {offText(p)}
                  <small className="faint">for {lastsText(p)}</small>
                </td>
                <td data-label="Plans">{p.plans.length ? p.plans.map((t) => PLAN[t]).join(', ') : 'Other plans'}</td>
                <td data-label="Used">
                  {p.uses}
                  {p.stock !== null ? ` of ${p.stock}` : ''}
                </td>
                <td data-label="Ends">{p.expiresAt ? date(p.expiresAt) : 'no end'}</td>
                <td>
                  <span className="row wrap" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn" onClick={() => void copy(p)} aria-label={`Copy the link for ${p.code}`} title="Copy the link that fills in this code">
                      <Copy size={14} />
                    </button>
                    {p.status === 'active' ? (
                      <button className="btn" disabled={busy === p.id} onClick={() => void change(p, 'pause')} aria-label={`Pause ${p.code}`} title="Pause">
                        <Pause size={14} />
                      </button>
                    ) : (
                      <button className="btn" disabled={busy === p.id} onClick={() => void change(p, 'resume')} aria-label={`Resume ${p.code}`} title="Resume">
                        <Play size={14} />
                      </button>
                    )}
                    {confirm === p.id ? (
                      <button className="btn" disabled={busy === p.id} onClick={() => void change(p, 'delete')} aria-label={`Confirm deleting ${p.code}`}>
                        Delete for good
                      </button>
                    ) : (
                      <button className="btn" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.code}`} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No promo codes yet.</p>
      )}
      {data.studentOffers.issued ? (
        <small className="faint">
          Student discounts: {data.studentOffers.issued} single-use offers issued at checkout, {data.studentOffers.used} used (made automatically, not listed).
        </small>
      ) : null}
      {message ? (
        <p className={`notice ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
