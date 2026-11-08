import { useEffect, useState, useSyncExternalStore } from 'react';
import { Upload } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { bookStatus, EXPECTED_SHA256, hasBook, importBook, openBook, removeLocalBook } from '../book/bookPdf';
import { formatBytes } from '../components/ui';
import { packBaseUrl } from '../services/caseRepository';
import { EmailChoices } from '../components/EmailChoices';
import { ClassNotice } from '../components/ClassNotice';
import { AboutCard } from '../components/MadeBy';

export default function SettingsPage() {
  const { settings, setSettings, catalog, progress, reloadCatalog } = useApp();
  const status = useSyncExternalStore(bookStatus.subscribe, bookStatus.get);
  const [haveBook, setHaveBook] = useState<boolean | null>(null);
  const [bookMsg, setBookMsg] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | undefined>();

  useEffect(() => {
    hasBook().then((h) => {
      setHaveBook(h);
      if (h) openBook().catch((e) => setBookMsg(String(e.message ?? e)));
    });
    progress.estimate().then(setEstimate);
  }, [progress]);

  return (
    <div className="page-inner stack" style={{ gap: 18, maxWidth: 860 }}>
      <h1>Settings</h1>
      <ClassNotice />
      <EmailChoices />

      <section className="card stack">
        <h2>Study</h2>
        <div className="row wrap">
          <label className="stack" style={{ gap: 4 }}>
            Level
            <select value={settings.level} onChange={(e) => setSettings({ level: e.target.value as 'student' | 'resident' })}>
              <option value="student">Student: guided descriptions</option>
              <option value="resident">Resident: full report and differential</option>
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            Exam date (optional)
            <input type="date" value={settings.examDate ?? ''} onChange={(e) => setSettings({ examDate: e.target.value || null })} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            Assess timer (optional)
            <select value={settings.assessTimerMinutes ?? ''} onChange={(e) => setSettings({ assessTimerMinutes: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Off</option>
              {[3, 5, 8, 10, 15].map((m) => (
                <option key={m} value={m}>
                  {m} min per task
                </option>
              ))}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            Reviewer name (for your own reference reviews)
            <input type="text" value={settings.reviewerName} onChange={(e) => setSettings({ reviewerName: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="card stack">
        <h2>Book</h2>
        <p className="muted">
          SSST students with a membership, signed in with their university email, open the fifth-edition textbook right on the site. Everyone else opens their own copy: import the PDF here, and it stays only in this browser.
        </p>
        {haveBook ? (
          <div className="stack" style={{ gap: 4 }}>
            <div>
              {status.source === 'local' ? 'Your own copy' : 'On the site'}: <b>{status.name ?? 'Learning Radiology'}</b>{status.pageCount ? ` · ${status.pageCount} pages` : ''}
            </div>
            {status.source === 'local' ? (
              status.verified ? (
                <span className="chip ok">SHA-256 matches the verified 5th-edition copy</span>
              ) : (
                <span className="chip warn">Different file (hash {status.sha256?.slice(0, 12)}…): page links may be offset</span>
              )
            ) : null}
          </div>
        ) : (
          <div className="notice">No book on this device yet.</div>
        )}
        <div className="row">
          <label className="btn">
            <Upload size={14} /> {haveBook ? 'Replace PDF' : 'Import PDF'}
            <input
              type="file"
              accept="application/pdf"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBookMsg('Verifying and storing…');
                try {
                  const st = await importBook(f);
                  setHaveBook(true);
                  setBookMsg(st.sha256 === EXPECTED_SHA256 ? 'Imported and verified.' : 'Imported, but the hash differs from the verified copy.');
                } catch (err) {
                  setBookMsg(String(err));
                }
              }}
            />
          </label>
          {status.source === 'local' ? (
            <button className="btn danger" onClick={() => removeLocalBook().then(() => setHaveBook(false))}>
              Remove from this browser
            </button>
          ) : null}
        </div>
        {bookMsg ? <small className="muted">{bookMsg}</small> : null}
      </section>

      {/* The image collections: a technical list, folded away unless one fails to load. */}
      <details className="card settings-packs" open={(catalog?.status ?? []).some((x) => x.status !== 'loaded')}>
        <summary>
          <h2>Data packs</h2>
          <span className="faint">
            {(catalog?.status ?? []).filter((x) => x.status === 'loaded').length} of {(catalog?.status ?? []).length} loaded
          </span>
        </summary>
        <small className="faint">
          Served from <span className="mono">{packBaseUrl()}</span>
        </small>
        <table className="table">
          <thead>
            <tr>
              <th>Pack</th>
              <th>Status</th>
              <th>Size</th>
              <th>Distribution</th>
            </tr>
          </thead>
          <tbody>
            {(catalog?.status ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td>
                  <span className={`chip ${s.status === 'loaded' ? 'ok' : 'warn'}`}>{s.status}</span>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {s.detail}
                  </div>
                </td>
                <td>{formatBytes(s.bytes)}</td>
                <td>{s.distribution === 'repo' ? 'in repository' : s.distribution === 'fetch_script' ? 'fetch script' : 'external'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn" onClick={reloadCatalog}>
            Reload catalogue
          </button>
          {estimate ? (
            <small className="faint">
              Browser storage used: {formatBytes(estimate.usage ?? 0)} of {formatBytes(estimate.quota ?? 0)} available
            </small>
          ) : null}
        </div>
      </details>

      <AboutCard />
    </div>
  );
}
