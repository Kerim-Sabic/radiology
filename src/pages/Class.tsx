import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Award, RefreshCw, UserMinus, UserRoundPlus } from 'lucide-react';
import { useAccount } from '../auth/AccountGate';
import '../styles/upgrade.css';

/** Mirrors server/classes.ts. */
interface Student {
  email: string;
  name: string;
  account: boolean;
  lastActiveAt: string | null;
  days7: number;
  days30: number;
  lastStudied: string | null;
  exams: Array<{ area: string; level: 1 | 2 | 3; passed: boolean; score: number | null; finishedAt: string }>;
  certificates: Array<{ id: string; title: string; issuedAt: string; revoked: boolean }>;
  freeFromClass: { until: string | null } | null;
}
interface ClassData {
  free: { seats: number; used: number; left: number; until: string | null; open: boolean };
  summary: { students: number; signedUp: number; active7: number; examsPassed: number; certificates: number };
  students: Student[];
}

const AREA: Record<string, string> = { chest: 'Chest', abdomen: 'Abdomen', head: 'Head', msk: 'Bones & joints', breast: 'Breast', all: 'Whole library' };
const date = (value: string | null) => (value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
function ago(value: string | null) {
  if (!value) return 'never';
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : date(value);
}
/** Email addresses from pasted text: one per line, or separated by commas, spaces or semicolons. */
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

/** A professor's class: add students by email and follow their study, exams and certificates. */
export default function ClassPage() {
  const teaches = useAccount()?.account.teaches === true;
  const [data, setData] = useState<ClassData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await fetch('/api/class', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'This page is for professors.' : `Could not load your class (HTTP ${r.status}).`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, []);
  useEffect(() => {
    if (teaches) void load();
  }, [teaches, load]);
  if (!teaches)
    return (
      <div className="page-inner">
        <h1>My class</h1>
        <p className="muted">This page is for professors.</p>
      </div>
    );
  return (
    <div className="page-inner stack admin" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1 style={{ margin: 0 }}>My class</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      {data ? (
        <>
          <div className="admin-kpis" aria-label="Your class at a glance">
            <section className="card">
              <b>Students</b>
              <span className="big-num">{data.summary.students}</span>
              <small className="faint">{data.summary.signedUp} have an account</small>
            </section>
            <section className="card">
              <b>Studied this week</b>
              <span className="big-num">{data.summary.active7}</span>
              <small className="faint">of {data.summary.students}</small>
            </section>
            <section className="card">
              <b>Exams passed</b>
              <span className="big-num">{data.summary.examsPassed}</span>
              <small className="faint">across all areas and levels</small>
            </section>
            <section className="card">
              <b>Certificates</b>
              <span className="big-num">{data.summary.certificates}</span>
              <small className="faint">earned by your students</small>
            </section>
          </div>
          <AddStudents free={data.free} onDone={load} />
          <Roster data={data} onChange={load} />
        </>
      ) : !error ? (
        <p className="muted">Loading your class…</p>
      ) : null}
    </div>
  );
}

function AddStudents({ free, onDone }: { free: ClassData['free']; onDone: () => void }) {
  const [text, setText] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const emails = useMemo(() => parseEmails(text), [text]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/class/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails, sendEmail }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `The request failed (HTTP ${r.status}).`);
      const results = body.results as Array<{ email: string; added: boolean; free?: boolean; emailed?: boolean; note?: string }>;
      const added = results.filter((x) => x.added);
      const skipped = results.filter((x) => !x.added);
      setResult({
        ok: skipped.length === 0,
        text: [
          `Added ${added.length} student${added.length === 1 ? '' : 's'}.`,
          added.some((x) => x.free) ? `${added.filter((x) => x.free).length} got free access through your class.` : '',
          sendEmail && added.length ? `${added.filter((x) => x.emailed).length} were emailed how to sign in.` : '',
          skipped.length ? `Not added: ${skipped.map((x) => `${x.email} (${x.note})`).join('; ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      if (added.length) setText('');
      onDone();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="add-students-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="add-students-title" style={{ margin: 0 }}>
          Add students
        </h2>
        <p className="muted">
          Paste their emails, one per line or separated by commas. Each gets an account if they have none and signs in with that email and a code.{' '}
          {free.open && free.seats
            ? `Your class gives free access to ${free.left} more student${free.left === 1 ? '' : 's'} (${free.used} of ${free.seats} used${free.until ? `, until ${date(free.until)}` : ''}).`
            : 'Your students use their own plan or the free edition.'}
        </p>
      </div>
      <form className="stack" onSubmit={(e) => void submit(e)} aria-label="Add students">
        <label>
          Student emails
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={'amra@stu.ssst.edu.ba\nemir@stu.ssst.edu.ba'} spellCheck={false} />
        </label>
        <div className="row wrap">
          <label className="admin-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email them how to sign in
          </label>
          <span className="spacer" />
          <small className="faint">{emails.length ? `${emails.length} email${emails.length === 1 ? '' : 's'} found` : ''}</small>
          <button className="btn primary" type="submit" disabled={busy || !emails.length || emails.length > 100}>
            <UserRoundPlus size={15} /> {busy ? 'Adding…' : 'Add to class'}
          </button>
        </div>
        {emails.length > 100 ? <small className="faint">Add up to 100 at a time.</small> : null}
      </form>
      <small className="faint">Students see that you can follow their study days, exam results and certificates, and can leave the class.</small>
      {result ? (
        <p className={`notice ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.text}
        </p>
      ) : null}
    </section>
  );
}

function Roster({ data, onChange }: { data: ClassData; onChange: () => void }) {
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = data.students.filter((s) => !query.trim() || s.email.includes(query.trim().toLowerCase()) || s.name.toLowerCase().includes(query.trim().toLowerCase()));
  async function remove(s: Student) {
    setMessage(null);
    try {
      const r = await fetch('/api/class/students/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: s.email }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Please try again.');
      setMessage({ ok: true, text: `${s.name || s.email} is no longer in your class.${s.freeFromClass ? ' Their free access through the class has ended.' : ''}` });
      setConfirm(null);
      onChange();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Please try again.' });
    }
  }
  return (
    <section className="card stack" aria-labelledby="roster-title">
      <div className="row wrap">
        <h2 id="roster-title" style={{ margin: 0 }}>
          Students
        </h2>
        <small className="faint">{data.students.length}</small>
        <span className="spacer" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search students" />
      </div>
      {shown.length ? (
        <table className="table admin-table class-roster">
          <thead>
            <tr>
              <th>Student</th>
              <th>Last active</th>
              <th>Study</th>
              <th>Exams</th>
              <th>Certificates</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.email}>
                <td>
                  <b>{s.name || s.email}</b>
                  {s.name ? <small className="faint">{s.email}</small> : null}
                  {!s.account ? <small className="faint">No account yet</small> : null}
                  {s.freeFromClass ? <small className="faint">Free access through your class{s.freeFromClass.until ? ` until ${date(s.freeFromClass.until)}` : ''}</small> : null}
                </td>
                <td data-label="Last active">{s.account ? ago(s.lastActiveAt) : '–'}</td>
                <td data-label="Study">
                  {s.days7} day{s.days7 === 1 ? '' : 's'} this week
                  <small className="faint">
                    {s.days30} in 30 days{s.lastStudied ? ` · last ${date(s.lastStudied)}` : ''}
                  </small>
                </td>
                <td data-label="Exams">
                  {s.exams.length ? (
                    <span className="row wrap" style={{ gap: 4 }}>
                      {s.exams.map((e) => (
                        <span key={`${e.area}${e.level}`} className={`chip ${e.passed ? 'ok' : 'warn'}`} title={`Last attempt ${date(e.finishedAt)}`}>
                          {AREA[e.area] ?? e.area} L{e.level}
                          {e.score !== null ? ` · ${Math.round(e.score * 100)}%` : ''} {e.passed ? '✓' : '✗'}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
                <td data-label="Certificates">
                  {s.certificates.filter((c) => !c.revoked).length ? (
                    s.certificates
                      .filter((c) => !c.revoked)
                      .map((c) => (
                        <a key={c.id} href={`/verify/${c.id}`} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 4 }}>
                          <Award size={13} /> {c.title}
                        </a>
                      ))
                  ) : (
                    '–'
                  )}
                </td>
                <td>
                  {confirm === s.email ? (
                    <button className="btn" onClick={() => void remove(s)} aria-label={`Confirm removing ${s.email}`}>
                      Remove for good
                    </button>
                  ) : (
                    <button className="btn" onClick={() => setConfirm(s.email)} aria-label={`Remove ${s.email}`} title="Remove from the class">
                      <UserMinus size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{data.students.length ? 'Nobody matches.' : 'No students yet. Add them above.'}</p>
      )}
      {message ? (
        <p className={`notice ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
