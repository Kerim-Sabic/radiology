import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { figureCropUrl, hasBook } from '../book/bookPdf';

function FigureThumb({ physical, bbox, alt }: { physical: number; bbox: number[]; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries.some((e) => e.isIntersecting)) return;
        done = true;
        io.disconnect();
        figureCropUrl(physical, bbox, 260).then(setUrl).catch(() => setFailed(true));
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [physical, bbox]);
  return (
    <div ref={ref} style={{ aspectRatio: '4 / 3', background: '#fff', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      ) : (
        <span style={{ fontSize: 12, color: '#555' }}>{failed ? 'Could not render' : 'Rendering…'}</span>
      )}
    </div>
  );
}

/** Every figure of the book, cropped live from YOUR PDF, grouped by chapter. */
export default function BookFigures() {
  const { curriculum } = useApp();
  const [sp, setSp] = useSearchParams();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    hasBook().then(setAvailable);
  }, []);
  const unitId = sp.get('unit') ?? 'ch03';
  const units = curriculum?.file?.units ?? [];
  const figs = useMemo(() => (curriculum?.figures?.figures ?? []).filter((f) => f.chapterId === unitId && f.kind === 'figure'), [curriculum, unitId]);
  const unit = units.find((u) => u.id === unitId);
  return (
    <div className="page-inner stack" style={{ gap: 14 }}>
      <Link to="/book" className="row faint">
        <ChevronLeft size={14} /> Back to the book
      </Link>
      <div className="row wrap">
        <h1>Figures</h1>
        <select value={unitId} onChange={(e) => setSp({ unit: e.target.value })} aria-label="Chapter">
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.kind === 'chapter' ? `Ch ${u.number}` : `App ${u.number}`} · {u.title}
            </option>
          ))}
        </select>
        <span className="faint">{figs.length} figures</span>
      </div>
      <small className="muted">
        Rendered from your own copy in this browser. Book figures carry printed arrows and labels — use them to understand a concept, then practise it on real studies
        (linked from each chapter in the Course map).
      </small>
      {available === false ? <div className="notice">Import your PDF in Settings → Book (or install it locally) to see the figures.</div> : null}
      {available ? (
        <div className="grid-3">
          {figs.map((f) => (
            <Link key={f.id} to={`/book/${f.physical}`} className="case-card" style={{ gap: 6 }}>
              {f.bbox ? <FigureThumb physical={f.physical} bbox={f.bbox} alt={f.id} /> : <div className="faint">No crop box — open the page</div>}
              <b>{f.id}</b>
              <small className="faint">
                p. {f.printed} · {[f.modality, f.description].filter(Boolean).join(' · ')}
              </small>
            </Link>
          ))}
        </div>
      ) : null}
      {unit ? (
        <Link to={`/course/${unit.id}`} className="btn sm" style={{ alignSelf: 'flex-start' }}>
          Objectives and real-scan practice for this chapter →
        </Link>
      ) : null}
    </div>
  );
}
