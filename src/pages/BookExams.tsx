import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Lock, Maximize2, X } from 'lucide-react';
import { useAccount } from '../auth/AccountGate';
import {
  dropDraft, finishExam, listExams, loadAttempt, openAttempt, readDraft, rememberAttempt, reviewEssay, saveDraft, startExam, words,
  type Answers, type ChapterSummary, type ExamImage, type ExamResult, type OpenExam, type ResultQuestion,
} from '../services/bookExams';
import '../styles/bookExams.css';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Book exams for chapters 1 to 13: only for members who have the book (SSST students and named accounts). */
export default function BookExamsPage() {
  const account = useAccount()?.account;
  // The server decides; the account's own flag lets the page say so without a request.
  if (account && account.book !== true) return <NotForYou />;
  return (
    <Routes>
      <Route index element={<ChapterList />} />
      <Route path="chapter/:chapter" element={<Exam />} />
      <Route path="result/:id" element={<Result />} />
    </Routes>
  );
}

function NotForYou({ text }: { text?: string }) {
  return (
    <div className="page-inner bx-page">
      <header className="bx-intro">
        <h1>Book exams</h1>
      </header>
      <div className="bx-blocked" role="note">
        <Lock size={22} aria-hidden />
        <div>
          <h2>These exams are for readers of the book</h2>
          <p>{text ?? 'The book exams follow Learning Radiology, chapter by chapter. They are open to members whose account has the book: SSST students signed in with their university email, and a few named accounts.'}</p>
          <Link className="btn" to="/book">
            <BookOpen size={15} /> About the book
          </Link>
        </div>
      </div>
    </div>
  );
}

function ChapterList() {
  const navigate = useNavigate();
  const [state, setState] = useState<{ passMark: number; chapters: ChapterSummary[] } | { error: string; status: number } | null>(null);
  useEffect(() => {
    let live = true;
    void listExams().then((r) => live && setState(r.ok ? r.data : { error: r.error, status: r.status }));
    return () => {
      live = false;
    };
  }, []);
  if (!state) return <div className="vp-status">Loading…</div>;
  if ('error' in state) return state.status === 402 || state.status === 403 ? <NotForYou text={state.error} /> : <div className="page-inner bx-page"><div className="notice bad">{state.error}</div></div>;
  return (
    <div className="page-inner bx-page">
      <header className="bx-intro">
        <h1>Book exams</h1>
        <p>
          One exam for each of chapters 1 to 13 of <i>Learning Radiology</i>. Each has multiple-choice questions and short essays on real images. You see no answers until you finish; then every question
          comes with its explanation and the place in the book to read again. A score of {Math.round(state.passMark * 100)}% or more is a pass. For study only: these are not medical advice.
        </p>
      </header>
      <ul className="bx-chapters" aria-label="Chapters">
        {state.chapters.map((c) => {
          const open = openAttempt(c.chapter);
          return (
            <li key={c.chapter} className="bx-chapter" data-chapter={c.chapter}>
              <span className="bx-num" aria-hidden="true">{c.chapter}</span>
              <div className="bx-chapter-main">
                <h2>Chapter {c.chapter}</h2>
                <b className="bx-title">{c.title}</b>
                <p className="muted">{c.blurb}</p>
                <p className="faint">
                  {c.mcq} multiple-choice · {c.essays} {c.essays === 1 ? "essay" : "essays"} on 5–6 images
                </p>
              </div>
              <div className="bx-chapter-side">
                {c.record ? (
                  <div className="bx-score" aria-label={`Best ${c.record.best} percent`}>
                    <b>{c.record.best}%</b>
                    <small>best · {c.record.attempts} {c.record.attempts === 1 ? 'try' : 'tries'}</small>
                    <small>last {c.record.last}% · {when(c.record.lastAt)}</small>
                  </div>
                ) : (
                  <small className="faint">Not taken yet</small>
                )}
                <button className="btn primary" onClick={() => navigate(`/book-exams/chapter/${c.chapter}`)}>
                  {open ? 'Continue' : c.record ? 'Take again' : 'Start'} <ArrowRight size={15} aria-hidden />
                </button>
                {c.record ? (
                  <Link className="bx-link" to={`/book-exams/result/${c.record.lastAttempt}`}>
                    Last result
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The images of an essay: a swipeable strip on a phone, a grid on a computer, and a large view with arrows. */
function Gallery({ images, label }: { images: ExamImage[]; label: string }) {
  const [big, setBig] = useState<number | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (big === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBig(null);
      if (e.key === 'ArrowRight') setBig((b) => (b === null ? b : Math.min(images.length - 1, b + 1)));
      if (e.key === 'ArrowLeft') setBig((b) => (b === null ? b : Math.max(0, b - 1)));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [big, images.length]);
  const onScroll = () => {
    const el = strip.current;
    if (el && el.firstElementChild) setAt(Math.min(images.length - 1, Math.round(el.scrollLeft / ((el.firstElementChild as HTMLElement).offsetWidth + 10))));
  };
  return (
    <div className="bx-gallery" role="group" aria-label={label}>
      <ul ref={strip} onScroll={onScroll} className="bx-strip">
        {images.map((im, i) => (
          <li key={im.thumb}>
            <button className="bx-thumb" onClick={() => setBig(i)} aria-label={`${im.caption}: enlarge`}>
              <img src={im.thumb} alt={im.caption} loading="lazy" draggable={false} />
              <span className="bx-cap">{im.caption}</span>
              <Maximize2 size={14} className="bx-zoom" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="bx-dots faint" aria-hidden="true">
        {at + 1} of {images.length} · swipe or tap an image to enlarge
      </p>
      {big !== null ? (
        <div className="bx-lightbox" role="dialog" aria-modal="true" aria-label={images[big].caption} onClick={() => setBig(null)}>
          <img src={images[big].thumb} alt={images[big].caption} onClick={(e) => e.stopPropagation()} />
          <div className="bx-lb-bar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => setBig(Math.max(0, big - 1))} disabled={big === 0} aria-label="Previous image">
              <ChevronLeft size={18} />
            </button>
            <span>{images[big].caption}</span>
            <button className="btn" onClick={() => setBig(Math.min(images.length - 1, big + 1))} disabled={big === images.length - 1} aria-label="Next image">
              <ChevronRight size={18} />
            </button>
            <button className="btn primary" onClick={() => setBig(null)} aria-label="Close">
              <X size={16} /> Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Exam() {
  const { chapter: ch } = useParams();
  const chapter = Number(ch);
  const navigate = useNavigate();
  const [exam, setExam] = useState<OpenExam | null>(null);
  const [error, setError] = useState<{ text: string; blocked: boolean } | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let live = true;
    const fail = (text: string, status: number) => live && setError({ text, blocked: status === 402 || status === 403 });
    (async () => {
      if (!Number.isInteger(chapter) || chapter < 1 || chapter > 13) return fail('Choose a chapter from 1 to 13.', 400);
      const held = openAttempt(chapter);
      if (held) {
        const r = await loadAttempt(held);
        if (r.ok && !r.data.finished) {
          const d = readDraft(held);
          if (live) {
            setExam(r.data);
            setAnswers(d.answers);
            setIndex(Math.min(d.index, r.data.questions.length - 1));
          }
          return;
        }
        if (!r.ok && r.status !== 404) return fail(r.error, r.status);
        rememberAttempt(chapter, null);
      }
      const s = await startExam(chapter);
      if (!s.ok) return fail(s.error, s.status);
      rememberAttempt(chapter, s.data.attemptId);
      if (live) setExam(s.data);
    })();
    return () => {
      live = false;
    };
  }, [chapter]);

  const set = useCallback(
    (qid: string, v: number | string | null) => {
      setAnswers((a) => {
        const next = { ...a, [qid]: v };
        if (exam) saveDraft(exam.attemptId, { answers: next, index });
        return next;
      });
    },
    [exam, index],
  );
  const go = (i: number) => {
    setIndex(i);
    setConfirm(false);
    if (exam) saveDraft(exam.attemptId, { answers, index: i });
    window.scrollTo?.({ top: 0 });
  };
  const send = async () => {
    if (!exam) return;
    setSending(true);
    const r = await finishExam(exam.attemptId, answers);
    setSending(false);
    if (!r.ok) return setError({ text: r.error, blocked: false });
    rememberAttempt(chapter, null);
    dropDraft(exam.attemptId);
    navigate(`/book-exams/result/${exam.attemptId}`, { state: { result: r.data.result } });
  };

  if (error)
    return error.blocked ? (
      <NotForYou text={error.text} />
    ) : (
      <div className="page-inner bx-page">
        <div className="notice bad">{error.text}</div>
        <Link className="btn" to="/book-exams">
          <ArrowLeft size={15} /> All chapters
        </Link>
      </div>
    );
  if (!exam) return <div className="vp-status">Opening the exam…</div>;
  const qs = exam.questions;
  const q = qs[index];
  const done = (x: (typeof qs)[number]) => (x.type === 'mcq' ? typeof answers[x.id] === 'number' : words(String(answers[x.id] ?? '')) >= x.minWords);
  const left = qs.filter((x) => !done(x)).length;
  const last = index === qs.length - 1;

  return (
    <div className="page-inner bx-page bx-exam">
      <header className="bx-bar">
        <Link className="bx-link" to="/book-exams">
          <ArrowLeft size={14} aria-hidden /> All chapters
        </Link>
        <b>
          Chapter {exam.chapter} · Question {index + 1} of {qs.length}
        </b>
        <span className="faint">{qs.length - left} answered</span>
      </header>
      <div className="bx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={qs.length - left} aria-label="Answered">
        <span style={{ width: `${((qs.length - left) / qs.length) * 100}%` }} />
      </div>
      <section className="bx-q" aria-live="polite" key={q.id} data-kind={q.type}>
        {q.type === 'essay' ? <p className="bx-kind">Short essay · {q.points} points · {q.images.length} images</p> : <p className="bx-kind">Multiple choice · one best answer</p>}
        <h2 className="bx-prompt">{q.prompt}</h2>
        {q.type === 'essay' ? (
          <>
            <Gallery images={q.images} label="Images for this question" />
            <label className="bx-essay">
              <span>Your answer (2–4 sentences)</span>
              <textarea
                value={String(answers[q.id] ?? '')}
                onChange={(e) => set(q.id, e.target.value.slice(0, 1200))}
                rows={6}
                maxLength={1200}
                placeholder="Write what you see and what it means, in your own words."
              />
              <small className={words(String(answers[q.id] ?? '')) >= q.minWords ? 'faint' : 'bx-short'}>
                {words(String(answers[q.id] ?? ''))} words · at least {q.minWords} to be marked
              </small>
            </label>
          </>
        ) : (
          <div className="bx-options" role="radiogroup" aria-label="Answer options">
            {q.options.map((o, i) => (
              <button
                key={i}
                role="radio"
                aria-checked={answers[q.id] === i}
                className={`bx-option${answers[q.id] === i ? ' on' : ''}`}
                onClick={() => set(q.id, answers[q.id] === i ? null : i)}
              >
                <span className="bx-letter" aria-hidden="true">{'ABCD'[i]}</span>
                <span>{o}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <nav className="bx-nav" aria-label="Question navigation">
        <button className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
          <ArrowLeft size={15} /> Back
        </button>
        {!last ? (
          <button className="btn primary" onClick={() => go(index + 1)}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button className="btn primary" onClick={() => setConfirm(true)} disabled={sending}>
            Finish the exam <Check size={15} />
          </button>
        )}
      </nav>
      <ol className="bx-dotsnav" aria-label="Jump to a question">
        {qs.map((x, i) => (
          <li key={x.id}>
            <button className={`${i === index ? 'now ' : ''}${done(x) ? 'done' : ''}`} onClick={() => go(i)} aria-label={`Question ${i + 1}${done(x) ? ', answered' : ''}${x.type === 'essay' ? ', essay' : ''}`} aria-current={i === index ? 'step' : undefined}>
              {x.type === 'essay' ? 'E' : i + 1}
            </button>
          </li>
        ))}
      </ol>
      {confirm ? (
        <div className="bx-confirm notice info" role="alertdialog" aria-label="Finish the exam">
          <p>{left ? `${left} question${left === 1 ? ' is' : 's are'} not answered yet and will score nothing.` : 'All questions are answered.'} You will see the answers and explanations after you finish.</p>
          <div className="row wrap">
            <button className="btn primary" onClick={send} disabled={sending}>
              {sending ? 'Marking…' : 'Finish and see the result'}
            </button>
            <button className="btn" onClick={() => setConfirm(false)} disabled={sending}>
              Keep working
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Result() {
  const { id } = useParams();
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<{ text: string; blocked: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadAttempt(id ?? '').then((r) => {
      if (!live) return;
      if (!r.ok) return setError({ text: r.error, blocked: r.status === 402 || r.status === 403 });
      if (!r.data.finished) return setError({ text: 'This exam is not finished yet.', blocked: false });
      setResult(r.data.result);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const tick = async (q: Extract<ResultQuestion, { type: 'essay' }>, item: string) => {
    if (!result) return;
    const now = new Set(q.rubric.filter((r) => r.confirmed).map((r) => r.id));
    if (now.has(item)) now.delete(item);
    else now.add(item);
    setBusy(q.id);
    const r = await reviewEssay(result.attemptId, q.id, [...now]);
    setBusy(null);
    if (r.ok) setResult(r.data.result);
  };
  const first = useMemo(() => result?.questions.filter((q) => q.type === 'mcq') ?? [], [result]);
  if (error) return error.blocked ? <NotForYou text={error.text} /> : <div className="page-inner bx-page"><div className="notice bad">{error.text}</div><Link className="btn" to="/book-exams"><ArrowLeft size={15} /> All chapters</Link></div>;
  if (!result) return <div className="vp-status">Loading the result…</div>;
  const mcqRight = first.filter((q) => q.type === 'mcq' && q.earned > 0).length;
  return (
    <div className="page-inner bx-page bx-result">
      <header className="bx-intro">
        <Link className="bx-link" to="/book-exams">
          <ArrowLeft size={14} aria-hidden /> All chapters
        </Link>
        <h1>
          Chapter {result.chapter}: {result.percent}%
        </h1>
        <p className={`bx-verdict ${result.passed ? 'pass' : 'review'}`}>
          {result.passed ? 'Passed' : 'Not yet a pass'} · {result.points} of {result.total} points · {mcqRight} of {first.length} multiple-choice right · {when(result.finishedAt)}
        </p>
        <p className="muted">{result.title}</p>
      </header>
      <ol className="bx-review">
        {result.questions.map((q, n) => (
          <li key={q.id} className={`bx-item ${q.type === 'mcq' ? (q.earned ? 'right' : 'wrong') : ''}`} data-id={q.id}>
            <p className="bx-kind">
              Question {n + 1} · {q.type === 'mcq' ? (q.earned ? 'Right' : q.picked === null ? 'Not answered' : 'Wrong') : `Essay · ${q.earned} of ${q.max} points`}
            </p>
            <h3 className="bx-prompt">{q.prompt}</h3>
            {q.type === 'mcq' ? (
              <>
                <ul className="bx-answers">
                  {q.options.map((o, i) => (
                    <li key={i} className={`${i === q.correct ? 'correct' : ''}${i === q.picked && i !== q.correct ? ' mine' : ''}`}>
                      <span className="bx-letter" aria-hidden="true">{'ABCD'[i]}</span>
                      <span>
                        {o}
                        {i === q.correct ? <b className="bx-tag"> · correct answer</b> : null}
                        {i === q.picked ? <b className="bx-tag"> · your answer</b> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="bx-expl">{q.explanation}</p>
                <p className="bx-book">
                  <BookOpen size={13} aria-hidden /> Book: {q.book}
                  {q.lesson ? (
                    <>
                      {' · '}
                      <Link to={`/read/${q.lesson}`} target="_blank" rel="noopener noreferrer">
                        See a matching case <ExternalLink size={11} aria-hidden />
                      </Link>
                    </>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <Gallery images={q.images} label="Images for this question" />
                <div className="bx-mine">
                  <b>Your answer</b>
                  <p>{q.answer || <i className="faint">No answer written.</i>}</p>
                </div>
                <div className="bx-rubric">
                  <b>Rubric: tick what your answer really says (the search for key words is only a first guess)</b>
                  <ul>
                    {q.rubric.map((r) => (
                      <li key={r.id}>
                        <label>
                          <input type="checkbox" checked={r.confirmed} disabled={busy === q.id} onChange={() => void tick(q, r.id)} />
                          <span>
                            {r.label} <small className="faint">({r.points} {r.points === 1 ? 'point' : 'points'}{r.found ? ' · key words found' : ''})</small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="faint">
                    {q.earned} of {q.max} points{q.selfChecked ? ' · from your own check' : ' · from key words'}
                  </p>
                </div>
                <div className="bx-model">
                  <b>Model answer</b>
                  <p>{q.model}</p>
                </div>
                <p className="bx-book">
                  <BookOpen size={13} aria-hidden /> Book: {q.book}
                </p>
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <Link className="btn primary" to={`/book-exams/chapter/${result.chapter}`}>
          Take it again
        </Link>
        <Link className="btn" to="/book-exams">
          All chapters
        </Link>
      </div>
    </div>
  );
}
