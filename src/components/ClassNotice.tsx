import { useState } from 'react';
import { School } from 'lucide-react';
import { useAccount } from '../auth/AccountGate';

/** For a student in a class: who can follow their progress, and leaving the class (Settings and Progress). */
export function ClassNotice() {
  const classes = useAccount()?.account.classes ?? [];
  const [left, setLeft] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const shown = classes.filter((c) => !left.includes(c.email));
  if (!shown.length) return null;
  async function leave(email: string) {
    setError('');
    try {
      const r = await fetch('/api/class/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ professor: email }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Please try again.');
      setLeft([...left, email]);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    }
  }
  return (
    <section className="card stack class-notice" aria-label="Your class">
      {shown.map((c) => (
        <div key={c.email} className="row wrap" style={{ gap: 10 }}>
          <School size={18} aria-hidden="true" />
          <span style={{ flex: '1 1 260px' }}>
            You are in <b>{c.name}</b>’s class. {c.name} can see your study days, exam results and certificates, not your answers or payments.
          </span>
          {confirm === c.email ? (
            <button className="btn" onClick={() => void leave(c.email)}>
              Leave for good
            </button>
          ) : (
            <button className="btn" onClick={() => setConfirm(c.email)}>
              Leave this class
            </button>
          )}
        </div>
      ))}
      {confirm ? <small className="faint">Leaving ends any free access you have through the class.</small> : null}
      {error ? <p className="notice bad">{error}</p> : null}
    </section>
  );
}
