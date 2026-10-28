import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Search, Upload } from 'lucide-react';
import { bookOpenProgress, bookStatus, ensureTextIndex, hasBook, importBook, renderPage, searchBook, EXPECTED_SHA256 } from '../../book/bookPdf';
import { printedLabel, unitForPhysical, type Curriculum } from '../../services/curriculum';
import type { BookAnchorRef } from '../../schema/content';

interface Props {
  curriculum: Curriculum | null;
  anchor: BookAnchorRef | null;
  onReturnToScan?: (() => void) | null;
  locked?: string | null;
}

export function BookPanel({ curriculum, anchor, onReturnToScan, locked }: Props) {
  const [page, setPage] = useState<number>(anchor?.physical ?? 40);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ physical: number; snippet: string }> | null>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const status = useSyncExternalStore(bookStatus.subscribe, bookStatus.get);

  useEffect(() => {
    if (anchor) setPage(anchor.physical);
  }, [anchor]);

  useEffect(() => {
    hasBook().then(setAvailable);
  }, [status]);

  useEffect(() => {
    if (!available || !canvas.current || !box.current || locked) return;
    setError(null);
    const width = box.current.clientWidth || 340;
    const job = renderPage(page, canvas.current, width);
    job.done.then(setDims).catch((e: Error) => {
      if (e.message !== 'cancelled' && e.name !== 'RenderingCancelledException') setError(e.message);
    });
    return () => job.cancel();
  }, [page, available, locked]);

  if (locked) return <div className="notice">{locked}</div>;

  const unit = curriculum ? unitForPhysical(curriculum, page) : null;
  const printed = curriculum ? printedLabel(curriculum, page) : null;
  const fig = anchor?.figureId && anchor.physical === page ? curriculum?.figures?.figures.find((f) => f.id === anchor.figureId) : null;
  const bbox = (anchor?.physical === page ? anchor?.bbox : null) ?? (fig?.bbox as number[] | null | undefined) ?? null;

  if (available === false) {
    return (
      <div className="stack">
        <div className="notice info">
          The member textbook is temporarily unavailable. Reload to try again, or import your own PDF on this device.
        </div>
        <label className="btn">
          <Upload size={14} /> Import Learning Radiology PDF
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const st = await importBook(f);
                if (st.sha256 !== EXPECTED_SHA256) setError('Imported, but this copy differs from the verified 5th-edition file — page anchors may not line up.');
                setAvailable(true);
              } catch (err) {
                setError(String(err));
              }
            }}
          />
        </label>
        {error ? <div className="notice bad">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <button className="icon-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.2 }}>
          <div style={{ fontSize: 13 }}>
            {unit ? `${unit.kind === 'chapter' ? 'Chapter' : 'Appendix'} ${unit.number}` : 'Book'} · p. {printed ?? '?'}
          </div>
          <div className="faint" style={{ fontSize: 11 }}>
            PDF page {page}
            {anchor?.figureId && anchor.physical === page ? ` · ${anchor.figureId}` : ''}
            {status.source !== 'none' && !status.verified ? ' · unverified copy' : ''}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setPage((p) => Math.min(status.pageCount ?? 552, p + 1))} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
      {anchor && anchor.physical !== page ? (
        <button className="btn sm" onClick={() => setPage(anchor.physical)}>
          Back to the linked page ({anchor.printed ?? anchor.physical})
        </button>
      ) : null}
      <a className="btn sm" href={`/book/${page}`} target="_blank" rel="noreferrer">
        Open in the full book reader ↗
      </a>
      {onReturnToScan ? (
        <button className="btn sm" onClick={onReturnToScan}>
          Return to my scan position
        </button>
      ) : null}
      {!dims && !error ? (
        <div className="notice info" role="status">
          Opening your book… {bookOpenProgress() ? `${(bookOpenProgress()!.loaded / 1048576).toFixed(1)} MB read` : ''}
        </div>
      ) : null}
      <div ref={box} className="book-canvas-wrap">
        <canvas ref={canvas} aria-label={`Book page ${printed ?? page}`} />
        {bbox && dims ? (
          <div className="book-highlight" style={{ left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`, width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%` }} />
        ) : null}
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setIndexing('Preparing search index (first time only)…');
          await ensureTextIndex((d, t) => setIndexing(`Indexing pages ${d}/${t}…`));
          setIndexing(null);
          setResults(await searchBook(query));
        }}
      >
        <input type="search" placeholder="Search the book" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} aria-label="Search the book" />
        <button className="icon-btn" type="submit" aria-label="Search">
          <Search size={15} />
        </button>
      </form>
      {indexing ? <small className="faint">{indexing}</small> : null}
      {results ? (
        <div className="stack" style={{ gap: 4 }}>
          {results.length === 0 ? <small className="faint">No matches.</small> : null}
          {results.map((r) => (
            <button key={r.physical} className="menu-item" style={{ display: 'block' }} onClick={() => setPage(r.physical)}>
              <b>p. {curriculum ? (printedLabel(curriculum, r.physical) ?? '?') : '?'}</b> <span className="faint">(PDF {r.physical})</span>
              <div className="faint" style={{ fontSize: 12 }}>
                {r.snippet}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
