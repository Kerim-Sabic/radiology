import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Mail, ShieldCheck, UserRoundPlus } from 'lucide-react';

/** Mirrors server/admin.ts. */
interface Person {
  email: string;
  name: string;
  account: 'clerk' | 'whop' | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  firstVisit: string | null;
  lastStudied: string | null;
  studyDays: number;
  access: 'admin' | 'paid' | 'member' | 'free' | 'none';
  role: 'admin' | 'user';
  /** Only in the owner's view. */
  adminSource?: 'owner' | 'vercel' | 'dashboard';
  permissions?: Grantable[];
  plan?: 'monthly' | 'yearly' | 'lifetime';
  paidUntil?: string | null;
  grant?: {
    until: string | null;
    note?: string;
    by: string;
    at: string;
    active: boolean;
  };
}
interface People {
  counts: {
    accounts: number;
    clerkAccounts: number;
    openedApp: number;
    paying: number | null;
    payingWithoutAccount: number | null;
    plans: { monthly: number; yearly: number; lifetime: number } | null;
    free: number;
    freeWaiting: number;
    admins: number;
    newAccounts: { d1: number; d7: number; d30: number };
    active: { d7: number; d30: number };
    studied: { d7: number; d30: number };
  };
  whop: 'ok' | 'unavailable' | 'off' | 'hidden';
  people: Person[];
}

/** What an admin may do (mirrors server/roles.ts); "admins", managing admins, is the owner's alone. */
export type AdminPermission = Grantable | 'admins';
type Grantable = 'people' | 'payments' | 'add' | 'free' | 'promos' | 'numbers' | 'certificates';
const GRANTABLE: Array<[Grantable, string]> = [
  ['people', 'See the people list: names, emails, study'],
  ['payments', 'See who pays and on which plan'],
  ['add', 'Add people and email them the sign-in steps'],
  ['free', 'Give and remove free access'],
  ['promos', 'Create, pause and delete promo codes'],
  ['numbers', 'See the sign-up and retention numbers'],
  ['certificates', 'Look up and revoke certificates'],
];
type Can = (p: AdminPermission) => boolean;

type Length = 'none' | '1m' | '3m' | '6m' | '1y' | 'forever' | 'date';
const LENGTHS: Array<[Length, string]> = [
  ['forever', 'Free access, no end date'],
  ['1y', 'Free access for 1 year'],
  ['6m', 'Free access for 6 months'],
  ['3m', 'Free access for 3 months'],
  ['1m', 'Free access for 1 month'],
  ['date', 'Free access until a date…'],
];
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tomorrow = () => localDay(new Date(Date.now() + 86_400_000));
/** The last day of free access for a choice (YYYY-MM-DD), null for no end date, undefined for none. */
function lastDay(length: Length, date: string): string | null | undefined {
  if (length === 'none') return undefined;
  if (length === 'forever') return null;
  if (length === 'date') return date;
  const d = new Date();
  d.setMonth(d.getMonth() + { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[length]);
  return localDay(d);
}
const date = (value: string | null | undefined) =>
  value
    ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '–';
function ago(value: string | null) {
  if (!value) return 'never';
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : date(value);
}
const freeText = (until: string | null) => (until ? `until ${date(until)}` : 'no end date');
const planName = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };

async function post(path: string, body: unknown) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `The request failed (HTTP ${r.status}).`);
  return data;
}

/** Accounts, paying members and free access: exact counts, adding a person by email, and everyone in a list. */
export function AdminPeople({ version, can }: { version: number; can: Can }) {
  const [data, setData] = useState<People | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!can('people')) return;
    setError('');
    try {
      const r = await fetch('/api/admin/people', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 403 ? 'Admin accounts only.' : `Could not load the people (HTTP ${r.status}).`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, [can]);
  useEffect(() => void load(), [load, version]);
  return (
    <>
      {error ? <div className="notice bad">{error}</div> : null}
      {can('people') ? data ? <Counts c={data.counts} /> : !error ? <p className="muted">Loading the accounts…</p> : null : null}
      {can('add') ? <AddPerson onDone={load} canFree={can('free')} /> : null}
      {can('people') && data ? <PeopleList data={data} onChange={load} can={can} /> : null}
    </>
  );
}

function Counts({ c }: { c: People['counts'] }) {
  return (
    <div className="admin-kpis" aria-label="Accounts at a glance">
      <section className="card">
        <b>Accounts</b>
        <span className="big-num">{c.accounts}</span>
        <small className="faint">
          {c.newAccounts.d1} today · {c.newAccounts.d7} this week · {c.newAccounts.d30} in 30 days
        </small>
      </section>
      {c.plans ? (
        <section className="card">
          <b>Paying</b>
          <span className="big-num">{c.paying ?? '–'}</span>
          <small className="faint">
            {c.paying === null ? 'Whop could not be read' : `${c.plans.monthly} monthly · ${c.plans.yearly} yearly${c.plans.lifetime ? ` · ${c.plans.lifetime} lifetime` : ''}`}
            {c.payingWithoutAccount ? ` · ${c.payingWithoutAccount} paid on Whop with no account here` : ''}
          </small>
        </section>
      ) : null}
      <section className="card">
        <b>Free access</b>
        <span className="big-num">{c.free}</span>
        <small className="faint">{c.freeWaiting ? `${c.freeWaiting} not signed in yet` : 'everyone has signed in'}</small>
      </section>
      <section className="card">
        <b>Active this week</b>
        <span className="big-num">{c.active.d7}</span>
        <small className="faint">{c.active.d30} in the last 30 days</small>
      </section>
      <section className="card">
        <b>Studied this week</b>
        <span className="big-num">{c.studied.d7}</span>
        <small className="faint">
          {c.studied.d30} in 30 days · {c.openedApp} have opened the app
        </small>
      </section>
    </div>
  );
}

function AccessFields({ length, setLength, until, setUntil, withNone }: { length: Length; setLength: (l: Length) => void; until: string; setUntil: (d: string) => void; withNone?: string }) {
  return (
    <>
      <label>
        Access
        <select value={length} onChange={(e) => setLength(e.target.value as Length)}>
          {withNone ? <option value="none">{withNone}</option> : null}
          {LENGTHS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {length === 'date' ? (
        <label>
          Last day of free access
          <input type="date" min={tomorrow()} value={until} onChange={(e) => setUntil(e.target.value)} required />
        </label>
      ) : null}
    </>
  );
}

function AddPerson({ onDone, canFree }: { onDone: () => void; canFree: boolean }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [length, setLength] = useState<Length>('forever');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const freeUntil = canFree ? lastDay(length, until) : undefined;
      const r = await post('/api/admin/people', {
        email,
        ...(name.trim() ? { name } : {}),
        ...(freeUntil !== undefined ? { freeUntil } : {}),
        ...(note.trim() ? { note } : {}),
        sendEmail,
      });
      const who = email.trim().toLowerCase();
      setResult({
        ok: true,
        text: [
          r.created ? `Account created for ${who}.` : `${who} already had an account.`,
          r.grant ? `Free access is on, ${freeText(r.grant.until)}.` : canFree ? 'No free access: they see the free edition.' : '',
          sendEmail ? (r.emailed ? 'We emailed them how to sign in.' : 'The email could not be sent; send it again from the list below.') : 'No email was sent.',
        ]
          .filter(Boolean)
          .join(' '),
      });
      setEmail('');
      setName('');
      setNote('');
      onDone();
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="add-person-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="add-person-title" style={{ margin: 0 }}>
          Add a person
        </h2>
        <p className="muted">Creates their account for this email. They sign in with that email and a code we send them; there is no password.</p>
      </div>
      <form className="admin-form" onSubmit={(e) => void submit(e)}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off" spellCheck={false} placeholder="name@example.com" />
        </label>
        <label>
          Name (optional)
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="off" />
        </label>
        {canFree ? <AccessFields length={length} setLength={setLength} until={until} setUntil={setUntil} withNone="No free access (free edition)" /> : null}
        <label>
          Note (only admins see it)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoComplete="off" placeholder="e.g. SSST tutor" />
        </label>
        <label className="admin-check">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email them how to sign in
        </label>
        <button className="btn primary" type="submit" disabled={busy || !email.trim() || (canFree && length === 'date' && !until)}>
          <UserRoundPlus size={15} /> {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      {result ? (
        <p className={`notice ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.text}
        </p>
      ) : null}
    </section>
  );
}

type Filter = 'all' | 'paid' | 'free' | 'none' | 'admin' | 'waiting';
const PAGE = 100;

const matches = (p: Person, f: Filter) => (f === 'all' ? true : f === 'waiting' ? !p.account : p.access === f);

function PeopleList({ data, onChange, can }: { data: People; onChange: () => void; can: Can }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.people.filter((p) => matches(p, filter) && (!q || p.email.includes(q) || p.name.toLowerCase().includes(q) || (p.grant?.note ?? '').toLowerCase().includes(q)));
  }, [data.people, filter, query]);
  const filters: Array<[Filter, string]> = [
    ['all', 'Everyone'],
    ...(can('payments') ? ([['paid', 'Paying']] as Array<[Filter, string]>) : []),
    ['free', 'Free access'],
    ['none', 'Free edition'],
    ['admin', 'Admins'],
    ['waiting', 'No account yet'],
  ];
  return (
    <section className="card stack" aria-labelledby="people-title">
      <div className="row wrap">
        <h2 id="people-title" style={{ margin: 0 }}>
          People
        </h2>
        <small className="faint">{shown.length === data.people.length ? `${data.people.length}` : `${shown.length} of ${data.people.length}`}</small>
        <span className="spacer" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search name, email or note"
          aria-label="Search people"
        />
      </div>
      <div className="row wrap" role="group" aria-label="Show">
        {filters.map(([f, label]) => (
          <button
            key={f}
            className="chip"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE);
            }}
          >
            {label} · {data.people.filter((p) => matches(p, f)).length}
          </button>
        ))}
      </div>
      {data.whop === 'unavailable' ? <div className="notice bad">Whop could not be read just now, so paying members show as free edition. Refresh in a minute.</div> : null}
      {shown.length ? (
        <table className="table admin-table admin-people">
          <thead>
            <tr>
              <th>Person</th>
              <th>Access</th>
              <th>Joined</th>
              <th>Last active</th>
              <th>Study</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((p) => (
              <PersonRow key={`${p.account}:${p.email}`} p={p} open={open === p.email} toggle={() => setOpen(open === p.email ? null : p.email)} onChange={onChange} can={can} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Nobody matches.</p>
      )}
      {shown.length > limit ? (
        <button className="btn" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      ) : null}
    </section>
  );
}

function AccessCell({ p }: { p: Person }) {
  if (p.access === 'admin')
    return (
      <>
        <span className="chip accent">Admin</span>
        {p.adminSource === 'owner' ? (
          <small className="faint">you</small>
        ) : p.adminSource === 'vercel' ? (
          <small className="faint">set in Vercel</small>
        ) : p.permissions ? (
          <small className="faint">
            {p.permissions.length} of {GRANTABLE.length} permissions
          </small>
        ) : null}
      </>
    );
  if (p.access === 'member') return <span className="chip ok">Member</span>;
  if (p.access === 'paid')
    return (
      <>
        <span className="chip ok">Paying · {planName[p.plan ?? 'monthly']}</span>
        <small className="faint">{p.plan === 'lifetime' ? 'no renewal' : `paid until ${date(p.paidUntil)}`}</small>
      </>
    );
  if (p.access === 'free')
    return (
      <>
        <span className="chip warn">Free access</span>
        <small className="faint">{freeText(p.grant!.until)}</small>
      </>
    );
  return (
    <>
      <span className="chip">Free edition</span>
      {p.grant ? <small className="faint">free access ended {date(p.grant.until)}</small> : null}
    </>
  );
}

function PersonRow({ p, open, toggle, onChange, can }: { p: Person; open: boolean; toggle: () => void; onChange: () => void; can: Can }) {
  return (
    <>
      <tr>
        <td>
          <b>{p.name || p.email}</b>
          {p.name ? <small className="faint">{p.email}</small> : null}
          {p.account === null ? (
            <small className="faint">No account yet: free access opens at their first sign-in</small>
          ) : p.account === 'whop' ? (
            <small className="faint">Signed in with Whop</small>
          ) : null}
          {p.grant?.note ? <small className="faint">Note: {p.grant.note}</small> : null}
        </td>
        <td>
          <AccessCell p={p} />
        </td>
        <td data-label="Joined">{date(p.createdAt)}</td>
        <td data-label="Last active">{p.account === 'clerk' ? ago(p.lastActiveAt) : '–'}</td>
        <td data-label="Study">{p.studyDays ? `${p.studyDays} day${p.studyDays === 1 ? '' : 's'} · last ${date(p.lastStudied)}` : '–'}</td>
        <td>
          {can('free') || can('add') || can('admins') ? (
            <button className="btn" aria-expanded={open} onClick={toggle} aria-label={`Manage ${p.email}`}>
              Manage
            </button>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="admin-edit">
          <td colSpan={6}>
            <ManagePerson p={p} onChange={onChange} can={can} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ManagePerson({ p, onChange, can }: { p: Person; onChange: () => void; can: Can }) {
  const [length, setLength] = useState<Length>(p.grant?.active && p.grant.until ? 'date' : 'forever');
  const [until, setUntil] = useState(p.grant?.active && p.grant.until ? p.grant.until.slice(0, 10) : '');
  const [note, setNote] = useState(p.grant?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      onChange();
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    act(async () => {
      const r = await post('/api/admin/free', {
        email: p.email,
        freeUntil: lastDay(length, until),
        note,
      });
      return `Free access is on, ${freeText(r.grant.until)}.`;
    });
  const remove = () =>
    act(async () => {
      await post('/api/admin/free/remove', { email: p.email });
      return 'Free access removed. They see the free edition now.';
    });
  const resend = () =>
    act(async () => {
      await post('/api/admin/email-sign-in', { email: p.email });
      return `We emailed ${p.email} how to sign in.`;
    });
  const create = () =>
    act(async () => {
      const r = await post('/api/admin/people', {
        email: p.email,
        sendEmail: true,
      });
      return `Account created for ${p.email}.${r.emailed ? ' We emailed them how to sign in.' : ' The email could not be sent; try Email sign-in steps.'}`;
    });
  // Roles and permissions: only the owner sees these controls (the "admins" permission).
  const editable = can('admins') && p.adminSource !== 'owner' && p.adminSource !== 'vercel';
  const [role, setRole] = useState(p.role);
  const [perms, setPerms] = useState<Set<Grantable>>(() => new Set(p.permissions ?? ['people', 'numbers']));
  const [trusted, setTrusted] = useState(false);
  const permsChanged = role === 'admin' && (perms.size !== (p.permissions?.length ?? -1) || [...perms].some((x) => !p.permissions?.includes(x)));
  const saveRole = () =>
    act(async () => {
      await post('/api/admin/role', {
        email: p.email,
        role,
        ...(role === 'admin'
          ? {
              permissions: GRANTABLE.map(([k]) => k).filter((k) => perms.has(k)),
            }
          : {}),
      });
      setTrusted(false);
      return role === 'user' ? `${p.email} is a user now; they no longer see Admin.` : p.role === 'admin' ? `Saved what ${p.email} may see and do.` : `${p.email} is an admin now.`;
    });
  return (
    <div className="stack admin-manage">
      {can('admins') ? (
        <form
          className="stack admin-role"
          aria-label="Role"
          onSubmit={(e) => {
            e.preventDefault();
            void saveRole();
          }}
        >
          <div className="admin-form">
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as Person['role'])} disabled={!editable}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          {editable && role === 'admin' ? (
            <fieldset className="admin-perms">
              <legend>What this admin may see and do</legend>
              {GRANTABLE.map(([k, label]) => (
                <label key={k} className="admin-check">
                  <input
                    type="checkbox"
                    checked={perms.has(k)}
                    onChange={(e) => {
                      const next = new Set(perms);
                      if (e.target.checked) next.add(k);
                      else next.delete(k);
                      setPerms(next);
                    }}
                  />{' '}
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {editable && role === 'admin' && p.role !== 'admin' ? (
            <label className="admin-check">
              <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} /> I trust them with these permissions
            </label>
          ) : null}
          {editable ? (
            <div className="row wrap">
              <button className="btn" type="submit" disabled={busy || (role === p.role && !permsChanged) || (role === 'admin' && p.role !== 'admin' && !trusted)}>
                <ShieldCheck size={14} /> Save role
              </button>
            </div>
          ) : p.adminSource === 'owner' ? (
            <p className="faint">This is you. You can do everything, and only you manage admins; to other admins you look like any admin.</p>
          ) : p.adminSource === 'vercel' ? (
            <p className="faint">Set in Vercel (ADMIN_EMAILS): they can do everything except manage admins. Change it there.</p>
          ) : null}
        </form>
      ) : null}
      {p.access === 'admin' ? <p className="muted">Admins always have full access.</p> : null}
      {p.access === 'paid' ? (
        <p className="notice">They pay on Whop ({planName[p.plan ?? 'monthly']}). Free access does not stop their Whop charges: they cancel renewals from Billing in the app.</p>
      ) : null}
      {can('free') ? (
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <AccessFields length={length} setLength={setLength} until={until} setUntil={setUntil} />
          <label>
            Note (only admins see it)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoComplete="off" />
          </label>
          <button className="btn primary" type="submit" disabled={busy || (length === 'date' && !until)}>
            {p.grant?.active ? 'Save free access' : 'Give free access'}
          </button>
        </form>
      ) : null}
      <div className="row wrap">
        {p.grant && can('free') ? (
          <button className="btn" disabled={busy} onClick={() => void remove()}>
            Remove free access
          </button>
        ) : null}
        {!can('add') ? null : p.account === 'clerk' ? (
          <button className="btn" disabled={busy} onClick={() => void resend()}>
            <Mail size={14} /> Email sign-in steps
          </button>
        ) : p.account === null ? (
          <button className="btn" disabled={busy} onClick={() => void create()}>
            <UserRoundPlus size={14} /> Create their account and email them
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={`notice ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
