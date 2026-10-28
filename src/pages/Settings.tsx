import { useEffect, useState, useSyncExternalStore } from 'react';
import { Upload } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { bookStatus, EXPECTED_SHA256, hasBook, importBook, openBook, removeLocalBook } from '../book/bookPdf';
import { formatBytes } from '../components/ui';
import { packBaseUrl } from '../services/caseRepository';

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

      <section className="card stack">
        <h2>Study</h2>
        <div className="row wrap">
          <label className="stack" style={{ gap: 4 }}>
            Level
            <select value={settings.level} onChange={(e) => setSettings({ level: e.target.value as 'student' | 'resident' })}>
              <option value="student">Student — guided descriptions</option>
              <option value="resident">Resident — full report, differential</option>
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
          Members can open the fifth-edition textbook directly on the site. You may also import your own PDF; imported copies stay only in this browser.
        </p>
        {haveBook ? (
          <div className="stack" style={{ gap: 4 }}>
            <div>
              Source: <b>{status.source}</b> {status.name ? `· ${status.name}` : ''} {status.pageCount ? `· ${status.pageCount} pages` : ''}
            </div>
            {status.source === 'local' ? (
              status.verified ? (
                <span className="chip ok">SHA-256 matches the verified 5th-edition copy</span>
              ) : (
                <span className="chip warn">Different file (hash {status.sha256?.slice(0, 12)}…) — anchors may be offset</span>
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

      <section className="card stack">
        <h2>Data packs</h2>
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
      </section>

    </div>
  );
}
