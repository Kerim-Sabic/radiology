import { useEffect, useId, useState } from 'react';
import { Copy, House, RotateCw } from 'lucide-react';
import { describeError, errorDetails } from '../app/errorReport';

/*
 * Loading and error screens that look like a CT scanner: the gantry's X-ray tube and detector arc rotate around
 * the patient and a real axial chest CT slice is rebuilt behind the beam, one slice per rotation, with the corner
 * overlays a PACS shows. The styles (`.rs-*`) live in index.html, so the same screen also shows before any
 * JavaScript has loaded; index.html's boot splash has the same markup in plain HTML. Keep the two in step.
 * The slices are inlined in index.html's CSS (starter case, LCTSC-Train-S1-012, CC BY 3.0; scripts/make_loader_ct.py).
 */

/** The slices are CC BY: they are credited wherever they show. */
const CREDIT = 'Real CT · LCTSC (TCIA), CC BY 3.0';

/** First slice number in the strip, and the step between its 6 slices. */
const FIRST_IM = 51;
const IM_STEP = 7;

/** The gantry: bore, tube, fan beam and detector arc around the slice. `onTurn` fires once per rotation. */
export function CtScanner({ onTurn }: { onTurn?: () => void }) {
  const fan = useId().replace(/:/g, '');
  return (
    <div className="rs-scan">
      <div className="rs-slice" />
      <svg className="rs-gantry" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={fan} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a9d0ff" stopOpacity=".5" />
            <stop offset=".55" stopColor="#409cff" stopOpacity=".14" />
            <stop offset="1" stopColor="#409cff" stopOpacity=".04" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="93" fill="none" stroke="#151517" strokeWidth="12" />
        <circle cx="100" cy="100" r="86.6" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth=".8" />
        <circle cx="100" cy="100" r="99.4" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth=".8" />
        <g className="rs-rotor" onAnimationIteration={onTurn}>
          <path className="rs-fan" d="M100 13 L61.4 179.1 A88 88 0 0 0 138.6 179.1 Z" fill={`url(#${fan})`} />
          <rect className="rs-tube" x="89" y="2" width="22" height="11" rx="3" fill="#d9dde3" />
          <circle cx="100" cy="13" r="2.2" fill="#cfe6ff" />
          <path className="rs-det" d="M56.3 182.1 A93 93 0 0 0 143.7 182.1" fill="none" stroke="#409cff" strokeWidth="5" strokeDasharray="2.4 1.6" />
        </g>
      </svg>
    </div>
  );
}

/** After this long, a loader admits it's slow and offers a reload (a stuck request otherwise spins forever). */
export const SLOW_AFTER_MS = 20_000;

/** Something is loading: the gantry spins, a slice is rebuilt per rotation, and the slice number steps with it. */
export function ScanLoader({ label = 'Opening the reading room…', compact = false }: { label?: string; compact?: boolean }) {
  const [turn, setTurn] = useState(0);
  const im = FIRST_IM + IM_STEP * (turn % 6);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className={`rs${compact ? ' rs-compact' : ''}`} role="status" aria-live="polite">
      <div className="rs-view">
        <CtScanner onTurn={() => setTurn((t) => t + 1)} />
        <div className="rs-ov rs-tl" aria-hidden="true">RADIOLOGY MONSTER<br />CT CHEST · AX</div>
        <div className="rs-ov rs-tr" aria-hidden="true">IM {String(im).padStart(3, '0')}/131</div>
        <div className="rs-ov rs-bl" aria-hidden="true">120 kV · 1.0 mm</div>
        <div className="rs-ov rs-br" aria-hidden="true">ROT 1.2 s</div>
      </div>
      <p className="rs-label">{slow ? 'This is taking longer than usual…' : label}</p>
      <p className="rs-credit">{CREDIT}</p>
      {slow ? (
        <div className="rs-actions">
          <button type="button" className="rs-btn primary" onClick={() => window.location.reload()}>
            <RotateCw size={16} aria-hidden /> Reload
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Something failed: the slice is dimmed under static with a status tag, then what happened in plain words, the
 * technical message, and Reload / Go to Today / Copy details. `scope` is the whole app or one page.
 */
export function ErrorScreen({ error, scope, stack }: { error: unknown; scope: 'app' | 'page'; stack?: string | null }) {
  const copy = describeError(error, scope, typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [copied, setCopied] = useState(false);
  const details = errorDetails(error, { url: location.href, userAgent: navigator.userAgent, at: new Date(), stack });
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const short = details.split('\n')[0];
  return (
    <div className="rs rs-error" role="alert">
      <div className="rs-view">
        <CtScanner />
        <div className="rs-noise" aria-hidden="true" />
        <div className="rs-flag" aria-hidden="true">{copy.tag}</div>
        <div className="rs-ov rs-tl" aria-hidden="true">RADIOLOGY MONSTER<br />STUDY UNAVAILABLE</div>
        <div className="rs-ov rs-tr" aria-hidden="true">IM —/—</div>
        <div className="rs-ov rs-bl" aria-hidden="true">W — L —</div>
        <div className="rs-ov rs-br" aria-hidden="true">{copy.kind === 'offline' ? 'OFFLINE' : 'ERR'}</div>
      </div>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <div className="rs-actions">
        <button type="button" className="rs-btn primary" onClick={() => window.location.reload()}>
          <RotateCw size={16} aria-hidden /> Reload
        </button>
        <a className="rs-btn" href="/">
          <House size={16} aria-hidden /> Go to Today
        </a>
        <button type="button" className="rs-btn" onClick={() => void onCopy()}>
          <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
      <pre className="rs-detail" aria-label="Error message">{short}</pre>
      <p className="rs-credit">{CREDIT}</p>
    </div>
  );
}
