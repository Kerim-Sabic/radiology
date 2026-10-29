import { useState } from 'react';
import { BookOpen, ShieldCheck, Upload } from 'lucide-react';
import { EXPECTED_SHA256, importBook } from '../book/bookPdf';
import { useAccount } from '../auth/AccountGate';
import '../styles/upgrade.css';

/**
 * No book on this device: open your own copy of Learning Radiology (it stays in this browser and is checked
 * against the 5th edition so page links line up). SSST students get the book from the server instead.
 */
export function OwnBookPrompt({ onReady, compact }: { onReady: () => void; compact?: boolean }) {
  const account = useAccount();
  const [msg, setMsg] = useState<{ tone: 'info' | 'bad' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className={`own-book${compact ? ' compact' : ''}`}>
      {compact ? null : (
        <span className="own-book-icon" aria-hidden="true">
          <BookOpen size={28} />
        </span>
      )}
      <h2>Open your copy of the book</h2>
      <p>
        Every task names the page of <i>Learning Radiology: Recognizing the Basics</i> (5th ed.) that explains it. Choose your PDF of the book and the links open that page, beside
        your scan.
      </p>
      <label className={`btn primary${busy ? ' disabled' : ''}`}>
        <Upload size={15} /> {busy ? 'Checking the file…' : 'Choose the PDF'}
        <input
          type="file"
          accept="application/pdf"
          hidden
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setMsg(null);
            try {
              const st = await importBook(f);
              setMsg(
                st.sha256 === EXPECTED_SHA256
                  ? { tone: 'ok', text: 'Checked: this is the 5th edition. Page links will open the right page.' }
                  : { tone: 'info', text: 'Opened, but this file is not the copy the page links were made for, so a link may land a page or two away.' },
              );
              onReady();
            } catch (err) {
              setMsg({ tone: 'bad', text: `That file could not be opened as a PDF (${String(err)}).` });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {msg ? <div className={`notice ${msg.tone === 'bad' ? 'bad' : msg.tone === 'ok' ? 'ok' : 'info'}`}>{msg.text}</div> : null}
      <p className="own-book-fine">
        <ShieldCheck size={14} /> The file stays in this browser on this device. It is never uploaded.
        {account?.account.user ? ' SSST students: sign in with your @stu.ssst.edu.ba email and the book opens without a file.' : ''}
      </p>
    </div>
  );
}
