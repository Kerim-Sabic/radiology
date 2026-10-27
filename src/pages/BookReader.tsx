import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BookOpen, ChevronLeft, ChevronRight, Images, Search, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { bookOpenProgress, bookStatus, ensureTextIndex, hasBook, importBook, renderPage, searchBook } from '../book/bookPdf';
import { readingProgress } from '../book/readingProgress';
import { printedLabel, unitForPhysical } from '../services/curriculum';
import { newId, type Note } from '../services/progressRepository';

const LAST_PAGE_KEY = 'rvm.bookLastPage';

export default function BookReader() {
  const { physical: param } = useParams();
  const navigate = useNavigate();
  const { curriculum, catalog, progress } = useApp();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [rendering, setRendering] = useState(true);
  useSyncExternalStore(bookStatus.subscribe, bookStatus.get);
  const openProg = bookOpenProgress();
  const [selFigure, setSelFigure] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ physical: number; snippet: string }> | null>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [quizAnswer, setQuizAnswer] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useSyncExternalStore(readingProgress.subscribe, () => readingProgress.pages().size);
  const pv = useSyncExternalStore(progress.subscribe, progress.getVersion);

  const total = curriculum?.pageMap?.document.physicalPageCount ?? 552;
  const page = Math.max(1, Math.min(total, Number(param) || Number(localStorage.getItem(LAST_PAGE_KEY)) || 15));
  const go = (p: number) => navigate(`/book/${Math.max(1, Math.min(total, p))}`);

  useEffect(() => {
    hasBook().then(setAvailable);
  }, []);

  useEffect(() => {
    if (!available || !canvas.current || !box.current) return;
    setError(null);
    const width = Math.min(box.current.clientWidth - 2, 920) * zoom;
    setRendering(true);
    const job = renderPage(page, canvas.current, width);
    job.done
      .then((d) => {
        setDims(d);
        setRendering(false);
        readingProgress.markRead(page);
        try {
          localStorage.setItem(LAST_PAGE_KEY, String(page));
        } catch {
          /* ignore */
        }
      })
      .catch((e: Error) => {
        if (e.message !== 'cancelled' && e.name !== 'RenderingCancelledException') setError(e.message);
      });
    return () => job.cancel();
  }, [page, available, zoom]);

  useEffect(() => {
    progress.notes(`page:${page}`).then(setNotes);
    setSelFigure(null);
    setQuizAnswer('');
  }, [page, progress, pv]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const unit = curriculum ? unitForPhysical(curriculum, page) : null;
  const printed = curriculum ? printedLabel(curriculum, page) : null;
  const sections = useMemo(() => curriculum?.sections?.sections ?? [], [curriculum]);
  const figuresHere = useMemo(() => (curriculum?.figures?.figures ?? []).filter((f) => f.physical === page), [curriculum, page]);
  const sectionsHere = sections.filter((s) => s.physical === page);
  const objectivesHere = useMemo(
    () => (curriculum?.file?.units ?? []).flatMap((u) => u.objectives.filter((o) => o.anchors.some((a) => a.physical === page)).map((o) => ({ u, o }))),
    [curriculum, page],
  );
  const tasksHere = useMemo(() => {
    if (!catalog) return [];
    const ids = new Set(objectivesHere.map((x) => x.o.id));
    const pageAnchored = [...catalog.tasks.values()].filter((t) => t.bookAnchors.some((a) => a.physical === page));
    const objLinked = [...catalog.tasks.values()].filter((t) => t.objectiveIds.some((o) => ids.has(o)));
    const seen = new Set<string>();
    return [...pageAnchored, ...objLinked].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 12);
  }, [catalog, objectivesHere, page]);
  const quizQ = unit?.caseQuiz?.question?.physical === page ? unit.caseQuiz : null;
  const currentSection = [...sections].filter((s) => s.physical <= page && s.chapterId === unit?.id && (s.level ?? 1) <= 2).pop();

  if (available === false) {
    return (
      <div className="page-inner stack" style={{ maxWidth: 720 }}>
        <h1>Book</h1>
        <div className="notice info">
          Your copy of <i>Learning Radiology</i> (5th ed.) is not on this device yet. It is never stored in the public repository. Import it once here (kept in this
          browser), or install it into a private build with <span className="mono">python scripts/book/install_book.py --pdf &lt;file&gt;</span>.
        </div>
        <label className="btn primary" style={{ alignSelf: 'flex-start' }}>
          <Upload size={14} /> Import PDF
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                await importBook(f);
                setAvailable(true);
              }
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 340px)', height: '100%', minHeight: 0 }} className="book-layout">
      {/* ---------------- table of contents */}
      <nav className="ws-left" style={{ width: 'auto', gridArea: 'auto', minHeight: 0 }} aria-label="Book contents">
        <div className="side-section">
          <div className="row">
            <h3 style={{ margin: 0 }}>Contents</h3>
            <span className="spacer" />
            <Link to="/book/figures" className="btn sm">
              <Images size={13} /> Figures
            </Link>
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {(curriculum?.file?.units ?? []).map((u) => {
            const open = unit?.id === u.id;
            const pct = Math.round(readingProgress.fraction(u.physicalRange) * 100);
            return (
              <div key={u.id}>
                <button className="anat-item" aria-current={open} onClick={() => go(u.physicalRange[0])} title={`${pct}% of pages opened`}>
                  <span className="faint" style={{ width: 30, flex: 'none' }}>
                    {u.kind === 'chapter' ? u.number : `e${u.number}`}
                  </span>
                  <span style={{ flex: 1 }}>{u.title}</span>
                  <span className="faint" style={{ fontSize: 10.5 }}>{pct ? `${pct}%` : ''}</span>
                </button>
                {open ? (
                  <div style={{ paddingLeft: 30 }}>
                    {sections
                      .filter((s) => s.chapterId === u.id && ((s.level ?? 1) <= 2 || s.kind !== 'heading'))
                      .map((s) => (
                        <button key={s.id} className={`anat-item${currentSection?.id === s.id ? ' here' : ''}`} onClick={() => go(s.physical)} style={{ fontSize: 12 }}>
                          <span style={{ flex: 1 }}>
                            {s.kind === 'case_quiz_question' ? '❓ ' : s.kind === 'case_quiz_answer' ? '✅ ' : s.kind === 'take_home' ? '★ ' : s.kind === 'pitfalls' ? '⚠ ' : ''}
                            {s.title}
                          </span>
                          <span className="faint" style={{ fontSize: 10.5 }}>
                            {s.printed}
                          </span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      {/* ---------------- page */}
      <section style={{ overflow: 'auto', minWidth: 0, background: 'var(--bg)' }} aria-label="Book page">
        <div className="row" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '6px 10px' }}>
          <button className="icon-btn" onClick={() => go(page - 1)} aria-label="Previous page">
            <ChevronLeft size={17} />
          </button>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600 }}>
              {unit ? `${unit.kind === 'chapter' ? 'Chapter' : 'Appendix'} ${unit.number} · ${unit.title}` : 'Front/back matter'}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              Page {printed ?? '–'} · PDF {page} of {total}
              {currentSection ? ` · ${currentSection.title}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={() => go(page + 1)} aria-label="Next page">
            <ChevronRight size={17} />
          </button>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
          <form
            className="row hide-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              setIndexing('Building the search index (first time only)…');
              await ensureTextIndex((d, t) => setIndexing(`Indexing ${d}/${t}…`));
              setIndexing(null);
              setResults(await searchBook(query, 60));
            }}
          >
            <input type="search" placeholder="Search the book" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the book" style={{ width: 180 }} />
            <button className="icon-btn" type="submit" aria-label="Search">
              <Search size={15} />
            </button>
          </form>
        </div>
        {indexing ? <div className="notice info" style={{ margin: 10 }}>{indexing}</div> : null}
        {results ? (
          <div className="card" style={{ margin: 10, maxHeight: 280, overflow: 'auto' }}>
            <div className="row">
              <b>{results.length} result(s)</b>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setResults(null)}>
                Close
              </button>
            </div>
            {results.map((r) => (
              <button key={r.physical} className="menu-item" style={{ display: 'block' }} onClick={() => go(r.physical)}>
                <b>p. {curriculum ? (printedLabel(curriculum, r.physical) ?? '?') : '?'}</b> <span className="faint">(PDF {r.physical})</span>
                <div className="faint" style={{ fontSize: 12 }}>
                  {r.snippet}
                </div>
              </button>
            ))}
          </div>
        ) : null}
        <div ref={box} style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          {rendering && !dims ? (
            <div className="vp-status" style={{ position: 'static', minHeight: 300 }} role="status">
              <div>Opening your book…</div>
              <div className="progress-bar">
                <span style={{ width: `${openProg?.total ? Math.min(100, (openProg.loaded / openProg.total) * 100) : 15}%` }} />
              </div>
              <small>{openProg ? `${(openProg.loaded / 1048576).toFixed(1)} MB read` : 'Starting PDF engine'}</small>
            </div>
          ) : null}
          <div className="book-canvas-wrap" style={{ width: dims ? dims.width : undefined, display: rendering && !dims ? 'none' : undefined }}>
            <canvas ref={canvas} aria-label={`Book page ${printed ?? page}`} />
            {dims
              ? figuresHere
                  .filter((f) => f.bbox)
                  .map((f) => (
                    <button
                      key={f.id}
                      className="book-highlight"
                      title={f.id}
                      onClick={() => setSelFigure(f.id)}
                      style={{
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        borderColor: selFigure === f.id ? 'var(--accent)' : 'rgba(94,196,255,0.35)',
                        background: selFigure === f.id ? 'rgba(94,196,255,0.10)' : 'transparent',
                        left: `${f.bbox![0] * 100}%`,
                        top: `${f.bbox![1] * 100}%`,
                        width: `${(f.bbox![2] - f.bbox![0]) * 100}%`,
                        height: `${(f.bbox![3] - f.bbox![1]) * 100}%`,
                      }}
                    />
                  ))
              : null}
          </div>
        </div>
        {error ? <div className="notice bad" style={{ margin: 10 }}>{error}</div> : null}
        <div className="row" style={{ justifyContent: 'center', paddingBottom: 24 }}>
          <button className="btn" onClick={() => go(page - 1)}>
            <ChevronLeft size={14} /> Previous
          </button>
          <button className="btn primary" onClick={() => go(page + 1)}>
            Next <ChevronRight size={14} />
          </button>
        </div>
      </section>

      {/* ---------------- on this page */}
      <aside className="ws-right" style={{ width: 'auto', gridArea: 'auto', minHeight: 0, overflowY: 'auto' }} aria-label="On this page">
        <div className="tab-body stack" style={{ gap: 14 }}>
          {quizQ ? (
            <div className="card stack" style={{ gap: 8, borderColor: 'rgba(94,196,255,0.5)' }}>
              <b>❓ Chapter case quiz</b>
              <small className="muted">Study the images on this page, write your answer, then open the book's answer page.</small>
              <textarea value={quizAnswer} onChange={(e) => setQuizAnswer(e.target.value)} placeholder="Your answer…" />
              <div className="row">
                {quizQ.answer ? (
                  <button
                    className="btn sm primary"
                    disabled={!quizAnswer.trim()}
                    onClick={async () => {
                      await progress.saveNote({ id: newId(), scope: 'page', refId: `page:${page}`, kind: 'note', text: `Case quiz answer: ${quizAnswer}`, createdAt: new Date().toISOString() });
                      go(quizQ.answer!.physical);
                    }}
                  >
                    Save & show answer (p. {quizQ.answer.printed})
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {figuresHere.length ? (
            <div className="stack" style={{ gap: 4 }}>
              <h3>Figures on this page</h3>
              {figuresHere.map((f) => (
                <button key={f.id} className="anat-item" aria-current={selFigure === f.id} onClick={() => setSelFigure(f.id)}>
                  <b style={{ width: 70, flex: 'none' }}>{f.id}</b>
                  <span className="faint" style={{ flex: 1 }}>
                    {[f.modality, f.description].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
              <small className="faint">Book figures are teaching illustrations, not the book patient's full study. Practise the same concept on real studies below.</small>
            </div>
          ) : null}

          {objectivesHere.length ? (
            <div className="stack" style={{ gap: 8 }}>
              <h3>Objectives anchored here</h3>
              {objectivesHere.map(({ u, o }) => (
                <div key={o.id} className="hint" style={{ fontSize: 12.5 }}>
                  <div className="row">
                    <span className="mono faint">{o.id}</span>
                    <span className="spacer" />
                    <Link to={`/course/${u.id}`} className="faint" style={{ fontSize: 11 }}>
                      course →
                    </Link>
                  </div>
                  <div>
                    <b>See:</b> {o.see}
                  </div>
                  <div>
                    <b>Show:</b> {o.show}
                  </div>
                  <div>
                    <b>Explain:</b> {o.explain}
                  </div>
                </div>
              ))}
            </div>
          ) : sectionsHere.length ? null : (
            <small className="faint">No objective is anchored to this exact page.</small>
          )}

          <div className="stack" style={{ gap: 6 }}>
            <h3>Practise on real scans</h3>
            {tasksHere.length ? (
              tasksHere.map((t) => (
                <Link key={t.id} className="btn sm" style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 8px', whiteSpace: 'normal', textAlign: 'left' }} to={`/read/${t.caseId}?task=${encodeURIComponent(t.id)}&mode=practice`}>
                  <BookOpen size={12} style={{ flex: 'none' }} /> {catalog?.cases.get(t.caseId)?.neutralTitle} — {t.title}
                </Link>
              ))
            ) : (
              <small className="faint">{unit ? 'No installed real-scan task links to this page yet — see this chapter in the Course map for its coverage.' : '—'}</small>
            )}
            {unit ? (
              <Link to={`/course/${unit.id}`} className="btn sm ghost" style={{ justifyContent: 'flex-start' }}>
                All objectives and tasks for {unit.kind === 'chapter' ? 'Chapter' : 'Appendix'} {unit.number} →
              </Link>
            ) : null}
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <h3>My notes on this page</h3>
            {notes.map((n) => (
              <div key={n.id} className="note-card" style={{ fontSize: 12.5 }}>
                {n.text}
                <div className="row">
                  <span className="faint" style={{ fontSize: 11 }}>
                    {n.createdAt.slice(0, 10)}
                  </span>
                  <span className="spacer" />
                  <button className="btn sm ghost" onClick={() => progress.deleteNote(n.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note (kept in this browser; included in backups)" />
            <button
              className="btn sm"
              disabled={!draft.trim()}
              onClick={async () => {
                await progress.saveNote({ id: newId(), scope: 'page', refId: `page:${page}`, kind: 'note', text: draft.trim(), createdAt: new Date().toISOString() });
                setDraft('');
              }}
            >
              Save note
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
