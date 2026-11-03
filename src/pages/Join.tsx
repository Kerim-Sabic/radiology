import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Check, School } from 'lucide-react';
import { clearJoinCode, fetchInvitation, type Invitation } from '../auth/joinCode';
import '../styles/upgrade.css';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; invite: Invitation }
  | { kind: 'done'; name: string; already: boolean; free: { until: string | null } | null };

const date = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A class join link, signed in: what the professor will see, then joining with one click (or not now). */
export default function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetchInvitation(code).then((invite) =>
      setState(invite ? { kind: 'ready', invite } : { kind: 'invalid', message: 'This join link does not work any more. Ask your professor for the current one.' }),
    );
  }, [code]);
  async function join() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/class/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Please try again.');
      clearJoinCode();
      setState({ kind: 'done', name: body.name, already: !!body.already, free: body.free ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const notNow = () => {
    clearJoinCode();
    navigate('/');
  };
  return (
    <div className="page-inner locked-page">
      <div className="locked-card join-card">
        <span className="locked-icon" aria-hidden="true">
          <School size={26} />
        </span>
        {state.kind === 'loading' ? <p className="muted">Opening the invitation…</p> : null}
        {state.kind === 'invalid' ? (
          <>
            <h1>This link has ended</h1>
            <p className="locked-lead">{state.message}</p>
            <div className="locked-actions">
              <button className="btn primary lg" onClick={notNow}>
                Go to Today
              </button>
            </div>
          </>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <span className="locked-kicker">Class invitation</span>
            <h1>Join {state.invite.name}’s class</h1>
            <p className="locked-lead">
              {state.invite.name} will see your study days, exam results and certificates, not your answers or payments. You can leave the class at any time in Settings.
            </p>
            {state.invite.free ? <p className="notice ok">This class includes free access to everything while its places last.</p> : null}
            <div className="locked-actions">
              <button className="btn primary lg" disabled={busy} onClick={() => void join()}>
                {busy ? 'Joining…' : 'Join the class'}
              </button>
              <button className="btn ghost lg" disabled={busy} onClick={notNow}>
                Not now
              </button>
            </div>
            {error ? (
              <p className="notice bad" role="alert">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
        {state.kind === 'done' ? (
          <>
            <h1>
              <Check size={22} /> You are in {state.name}’s class
            </h1>
            <p className="locked-lead" role="status">
              {state.already
                ? 'You were already in this class.'
                : state.free
                  ? `Free access to everything is on${state.free.until ? ` until ${date(state.free.until)}` : ''}.`
                  : `${state.name} can now follow your study days, exam results and certificates.`}
            </p>
            <div className="locked-actions">
              {/* A full reload, so the app picks up the class and any free access at once. */}
              <button className="btn primary lg" onClick={() => location.assign('/')}>
                Start studying
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
