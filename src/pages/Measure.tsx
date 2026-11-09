import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, RotateCcw } from 'lucide-react';
import '../styles/measure.css';

/** One chest film: its picture, the AI outlines and the reference ratio worked out from them (scripts/data/cxr_ratio.py). */
interface Film {
  id: string;
  thumb: string;
  aspect: number;
  ctr: number;
  heart: number[][];
  lungLeft: number[][];
  lungRight: number[][];
  /** Reference x positions, 0..1 across the picture: heart left edge, heart right edge, chest left edge, chest right edge. */
  x: [number, number, number, number];
}

const STEPS = [
  { label: 'Right edge of the heart', help: 'Tap the outer edge of the heart on the left of the picture (the patient’s right).' },
  { label: 'Left edge of the heart', help: 'Tap the outer edge of the heart on the right of the picture (the patient’s left).' },
  { label: 'Inside of the chest, left of the picture', help: 'Tap the inside of the chest wall where the chest is widest.' },
  { label: 'Inside of the chest, right of the picture', help: 'Tap the inside of the chest wall where the chest is widest, on the other side.' },
] as const;

const NORMAL = 0.5;
const RATIO_OF = (p: number[]) => {
  const heart = Math.abs(p[1] - p[0]);
  const chest = Math.abs(p[3] - p[2]);
  return chest > 0.15 ? { heart, chest, ratio: heart / chest } : null;
};
const path = (poly: number[][], aspect: number) => poly.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 1000).toFixed(1)} ${((y * 1000) / aspect).toFixed(1)}`).join('') + 'Z';

/** Heart–chest ratio drill: four taps on a real chest film, then compare with the reference. Practice only: never scored. */
export default function MeasurePage() {
  const [films, setFilms] = useState<Film[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [pts, setPts] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch('/content/cxr-ratio.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { films: Film[] }) => {
        if (!live) return;
        setFilms(d.films);
        const ids = d.films.map((_, i) => i);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        setOrder(ids);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, []);

  const film = films && order.length ? films[order[pos % order.length]] : null;
  const mine = useMemo(() => (pts.length === 4 ? RATIO_OF(pts) : null), [pts]);
  const ref = film ? RATIO_OF(film.x) : null;

  const place = useCallback((e: React.PointerEvent) => {
    if (checked || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setPts((p) => {
      if (p.length < 4) return [...p, x];
      // All four placed: a tap moves the nearest one.
      let k = 0;
      p.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(p[k] - x)) k = i; });
      return p.map((v, i) => (i === k ? x : v));
    });
  }, [checked]);

  const next = () => { setPos((n) => n + 1); setPts([]); setChecked(false); };

  if (failed) return <div className="page-inner stack"><h1>Measure</h1><p className="muted">The films could not load. Check your connection and reload.</p></div>;
  if (!film) return <div className="vp-status">Loading…</div>;

  const step = Math.min(pts.length, 3);
  const diff = mine && ref ? mine.ratio - ref.ratio : null;
  const verdict = diff === null ? '' : Math.abs(diff) <= 0.03 ? 'Very close to the reference.' : Math.abs(diff) <= 0.06 ? 'Close to the reference.' : `Off by ${Math.abs(diff).toFixed(2)}: ${diff > 0 ? 'too high' : 'too low'}.`;
  const heartNote = mine && ref ? (mine.heart > ref.heart * 1.08 ? 'Your heart was wider than the outline: check you stopped at the heart’s own edge, not the vessels or fat above it.' : mine.heart < ref.heart * 0.92 ? 'Your heart was narrower than the outline: the widest part of each border is what counts.' : '') : '';
  const chestNote = mine && ref ? (mine.chest > ref.chest * 1.08 ? 'Your chest was wider than the lungs’ own width: check you were at the inside of the ribs, not the outside.' : mine.chest < ref.chest * 0.92 ? 'Your chest was narrower: measure where the chest is widest, usually near the bases.' : '') : '';
  const colours = ['#38bdf8', '#38bdf8', '#fbbf24', '#fbbf24'];

  return (
    <div className="page-inner stack measure" style={{ gap: 14, maxWidth: 980 }}>
      <h1>Measure the heart–chest ratio</h1>
      <p className="muted">
        The cardiothoracic ratio is the widest width of the heart divided by the widest inside width of the chest. On an adult film taken front to back
        (PA), more than {NORMAL.toFixed(2)} suggests a big heart. It does not hold on films taken the other way round (AP), lying down, rotated or in a poor breath in.
        For education, not diagnosis.
      </p>
      <div className="measure-grid">
        <div>
          <div ref={box} className="measure-film" style={{ aspectRatio: String(film.aspect) }} onPointerDown={place} role="img" aria-label={`Chest film ${pos % order.length + 1} of ${order.length}`}>
            <img src={film.thumb} alt="" draggable={false} decoding="async" />
            <svg viewBox={`0 0 1000 ${1000 / film.aspect}`} preserveAspectRatio="none" aria-hidden="true">
              {pts.map((x, i) => (
                <g key={i}>
                  <line x1={x * 1000} x2={x * 1000} y1="0" y2={1000 / film.aspect} stroke={colours[i]} strokeWidth="2" strokeDasharray="6 5" />
                  <circle cx={x * 1000} cy={(500 / film.aspect) + i * 40 - 60} r="12" fill={colours[i]} />
                  <text x={x * 1000} y={(500 / film.aspect) + i * 40 - 54} textAnchor="middle" fontSize="16" fontWeight="700" fill="#0b0b0c">{i + 1}</text>
                </g>
              ))}
              {checked && (
                <g fill="none" strokeWidth="3">
                  <path d={path(film.heart, film.aspect)} stroke="#f472b6" />
                  <path d={path(film.lungLeft, film.aspect)} stroke="#4ade80" />
                  <path d={path(film.lungRight, film.aspect)} stroke="#4ade80" />
                  {film.x.map((x, i) => <line key={i} x1={x * 1000} x2={x * 1000} y1="0" y2={1000 / film.aspect} stroke={i < 2 ? '#f472b6' : '#4ade80'} strokeWidth="2" />)}
                </g>
              )}
            </svg>
          </div>
          <p className="faint measure-credit">Real chest radiographs from public research collections, de-identified. Outlines: AI, not reviewed by a radiologist.</p>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {!checked && (
            <section className="card stack" aria-live="polite">
              <h2>{pts.length < 4 ? `Tap ${pts.length + 1} of 4` : 'All four placed'}</h2>
              <p>{pts.length < 4 ? <><b>{STEPS[step].label}.</b> {STEPS[step].help}</> : 'Happy with them? Check your ratio. Tap near a marker to move it.'}</p>
              <ol className="measure-steps">
                {STEPS.map((s, i) => <li key={s.label} className={i < pts.length ? 'done' : i === pts.length ? 'now' : ''} style={{ color: i < pts.length ? colours[i] : undefined }}>{s.label}</li>)}
              </ol>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={!pts.length} onClick={() => setPts((p) => p.slice(0, -1))}><RotateCcw size={14} /> Undo</button>
                <button type="button" className="btn primary" disabled={!mine} onClick={() => setChecked(true)}><Check size={14} /> Check my ratio</button>
              </div>
              {mine && (
                <p className="measure-live">Your ratio so far: <b>{mine.ratio.toFixed(2)}</b> ({mine.ratio > NORMAL ? 'above' : 'at or below'} {NORMAL.toFixed(2)})</p>
              )}
            </section>
          )}
          {checked && mine && ref && (
            <section className="card stack" aria-live="polite">
              <h2>Your ratio {mine.ratio.toFixed(2)} · reference {ref.ratio.toFixed(2)}</h2>
              <p><b>{verdict}</b></p>
              <div className="measure-bar" aria-hidden="true">
                <span className="mine" style={{ left: `${Math.min(100, (mine.ratio / 0.9) * 100)}%` }} />
                <span className="ref" style={{ left: `${Math.min(100, (ref.ratio / 0.9) * 100)}%` }} />
                <span className="norm" style={{ left: `${(NORMAL / 0.9) * 100}%` }} />
              </div>
              <p className="muted">
                Pink: the heart outline. Green: the lung outlines, whose outer edges stand in for the inside of the chest. The reference is an AI estimate and can read a little high.
                On this film it is {ref.ratio > NORMAL ? 'above' : 'at or below'} {NORMAL.toFixed(2)}.
              </p>
              {heartNote ? <p>{heartNote}</p> : null}
              {chestNote ? <p>{chestNote}</p> : null}
              <p className="faint">Practice only: this is not scored and does not count toward a certificate.</p>
              <div className="row"><button type="button" className="btn primary" onClick={next}>Next film <ChevronRight size={14} /></button></div>
            </section>
          )}
          <section className="card stack">
            <h2>How to measure it</h2>
            <ul className="measure-tips">
              <li>Heart width: the farthest the heart reaches to each side, added together from the middle line. Ignore the great vessels above it.</li>
              <li>Chest width: the widest inside of the ribcage, usually near the bases.</li>
              <li>Divide the heart width by the chest width. Less than {NORMAL.toFixed(2)} is normal for an adult PA film; babies and children normally run higher.</li>
              <li>Check the film first: PA, not rotated, taken in a full breath in. Otherwise the ratio misleads.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
