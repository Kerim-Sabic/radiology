import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { getEmailPrefs, setEmailPrefs, type EmailPrefs } from '../services/serverSync';
import '../styles/upgrade.css';

/** Settings: the two emails you can ask for. */
export function EmailChoices() {
  const account = useAccount();
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (account) void getEmailPrefs().then(setPrefs);
  }, [account]);
  if (!account) return null;
  const change = async (p: Partial<EmailPrefs>) => {
    setSaving(true);
    const next = await setEmailPrefs(p);
    if (next) setPrefs(next);
    setSaving(false);
  };
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>
        <Mail size={18} style={{ verticalAlign: '-3px' }} /> Emails
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Sent to {account.account.user?.email}. Every email has a one-click link to stop it.
      </p>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={!!prefs?.streak} disabled={!prefs || saving} onChange={(e) => void change({ streak: e.target.checked })} />
        <span>
          <b>Streak reminder</b> <span className="faint">— an evening email when a streak of 2 or more days is about to end</span>
        </span>
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={!!prefs?.weekly} disabled={!prefs || saving} onChange={(e) => void change({ weekly: e.target.checked })} />
        <span>
          <b>Case of the week</b> <span className="faint">— Monday morning, when the new case opens</span>
        </span>
      </label>
    </section>
  );
}

const DISMISSED = 'rvm.emailOptIn.dismissed';

/** Today, after the first answer: ask once whether to send the two emails. */
export function EmailOptIn() {
  const { attempts } = useApp();
  const account = useAccount();
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(DISMISSED);
    } catch {
      return false;
    }
  });
  const answered = attempts.some((a) => a.submittedAt);
  useEffect(() => {
    if (account && answered && !hidden) void getEmailPrefs().then(setPrefs);
  }, [account, answered, hidden]);
  if (!account || !answered || hidden || !prefs || prefs.streak || prefs.weekly) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return (
    <section className="upgrade-card optin" aria-label="Email reminders">
      <span className="upgrade-ico" aria-hidden="true">
        <Bell size={18} />
      </span>
      <div>
        <b>Keep the habit</b>
        <p>An email when your streak is about to end, and the new case of the week every Monday. Stop either with one click.</p>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn primary"
          onClick={() => {
            void setEmailPrefs({ streak: true, weekly: true }).then(() => close());
          }}
        >
          Yes, email me
        </button>
        <button className="btn ghost" onClick={close}>
          No thanks
        </button>
      </div>
    </section>
  );
}
