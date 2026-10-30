import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, Check, Minus, RotateCcw, Timer, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { CertSeal } from '../components/CertSeal';
import { CERT_TITLES, claimCertificate, examRequirement, levelLabel, myCertificates, type IssuedCertificate } from '../services/certificates';
import { examBlock, examScore, examUrl, finishExam, QUESTION_RESULT_LABEL, startExam, type CertExam, type QuestionResult } from '../services/exam';
import '../styles/upgrade.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ICON: Record<QuestionResult, typeof Check> = { correct: Check, partial: Minus, incorrect: X, timeout: Timer, unanswered: X };

/** The end of an exam: the server's verdict (passed or not) and score, the certificate for a pass, and every answer to review. */
export default function ExamResultPage() {
  const { id = '' } = useParams();
  const { catalog, attempts, progress, settings, free } = useApp();
  const account = useAccount();
  const navigate = useNavigate();
  const [exam, setExam] = useState<CertExam | null | undefined>(undefined);
  const [held, setHeld] = useState<IssuedCertificate[]>([]);
  const [history, setHistory] = useState<CertExam[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verdictError, setVerdictError] = useState('');
  useEffect(() => {
    void progress.certExam(id).then(setExam);
    void progress.certExamHistory().then(setHistory);
  }, [id, progress]);
  // The verdict is the server's: ask for it when this exam does not have it yet.
  const askVerdict = async (e: CertExam) => {
    setVerdictError('');
    const r = await finishExam(e.id);
    if (!r.ok) return setVerdictError(r.error);
    setExam(await progress.finishCertExam({ ...e, result: r.data.result, finishedAt: e.finishedAt ?? r.data.result.finishedAt }));
  };
  useEffect(() => {
    if (exam && exam.finishedAt && !exam.result) void askVerdict(exam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, !!exam?.result]);
  useEffect(() => {
    if (!exam || !account || free) return;
    void myCertificates().then(setHeld);
    const own = account.account.user?.name;
    setName(own && !own.includes('@') ? own : settings.reviewerName === 'me' ? '' : settings.reviewerName);
  }, [exam, account, free, settings.reviewerName]);

  if (exam === undefined) return <div className="page-inner muted">Loading the result…</div>;
  if (!exam)
    return (
      <div className="page-inner">
        <h1>Exam not found</h1>
        <p className="muted">
          Exams are kept in this browser. <Link to="/certificates">Back to certificates</Link>.
        </p>
      </div>
    );
  if (!exam.finishedAt)
    return (
      <div className="page-inner">
        <h1>This exam is not finished</h1>
        <p className="muted">
          <Link to="/certificates">Continue it from the Certificates page</Link>.
        </p>
      </div>
    );

  const r = examScore(exam, attempts);
  const issued = held.find((c) => c.area === exam.area && (c.level ?? 1) === exam.level && c.status !== 'revoked') ?? null;
  const block = examBlock(exam.area, exam.level, held, history, attempts);
  const title = `${CERT_TITLES[exam.area]} · ${levelLabel(exam.level)}`;
  const claim = async () => {
    setBusy(true);
    setError('');
    const c = await claimCertificate(exam, name.trim(), email);
    setBusy(false);
    if (!c.ok) return setError(c.error);
    setHeld((xs) => [...xs.filter((x) => x.id !== c.certificate.id), c.certificate]);
    window.location.assign(`/verify/${c.certificate.id}#add-to-linkedin`);
  };
  const again = async () => {
    setError('');
    const next = await startExam(exam.area, exam.level);
    if (!next.ok) return setError(next.error);
    await progress.saveCertExam(next.data.exam);
    navigate(examUrl(next.data.exam, 0));
  };
  if (!r.verified)
    return (
      <div className="page-inner exam-result">
        <section className="card exam-verdict" aria-labelledby="exam-verdict-h">
          <div className="stack" style={{ gap: 6 }}>
            <span className="faint">{title}</span>
            <h1 id="exam-verdict-h">Scoring your exam…</h1>
            <p className="muted" style={{ margin: 0 }}>
              The server grades every answer against the expert's reference and gives the verdict.
            </p>
            {verdictError ? (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="notice bad">{verdictError}</span>
                <button className="btn" onClick={() => void askVerdict(exam)}>
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    );

  return (
    <div className="page-inner exam-result">
      <section className={`card exam-verdict ${r.passed ? 'pass' : 'fail'}`} aria-labelledby="exam-verdict-h">
        {r.passed ? <CertSeal level={exam.level} size={120} /> : null}
        <div className="stack" style={{ gap: 6 }}>
          <span className="faint">{title}</span>
          <h1 id="exam-verdict-h">{r.passed ? 'Passed' : 'Not passed'}</h1>
          <p className="exam-score">
            <b>{pct(r.score)}</b> right ({r.points} of {r.questions} points) · pass mark {pct(r.passMark)}
          </p>
          <small className="faint">
            The exam: {examRequirement(r.rule)}
            {r.rule.partialCredit ? '; a partly right answer counts half' : ''}.
          </small>
          <p className="muted" style={{ margin: 0 }}>
            {r.passed
              ? 'Well done. Get your certificate below, then look through your answers.'
              : `You needed ${pct(r.passMark)}. Look through the answers below to see what was missed, then try again: a new attempt brings questions you have not had yet.`}
            {r.answered < r.questions ? ` ${r.questions - r.answered} question${r.questions - r.answered === 1 ? ' was' : 's were'} not answered (or ran out of time) and counted as wrong.` : ''}
            {!r.passed && block?.reason === 'wait' ? ` ${block.text}` : ''}
          </p>
        </div>
      </section>

      {r.passed ? (
        <section className="card stack" aria-labelledby="exam-cert-h">
          <h2 id="exam-cert-h">Your certificate</h2>
          {free || !account ? (
            <p className="notice">Certificates are issued to members who are signed in.</p>
          ) : issued ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="muted">Issued {new Date(issued.issuedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</span>
              <a className="btn primary" href={`/verify/${issued.id}`}>
                View and share <ArrowRight size={14} />
              </a>
            </div>
          ) : (
            <div className="cert-claim">
              <label>
                Name on the certificate
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your full name" autoFocus />
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email me the certificate and LinkedIn link
              </label>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn primary" disabled={busy || name.trim().length < 2} onClick={() => void claim()}>
                  {busy ? 'Issuing…' : 'Get my certificate'}
                </button>
              </div>
              <small className="faint">The certificate is issued once, in this name, and cannot be changed afterwards.</small>
              {error ? <div className="notice bad">{error}</div> : null}
            </div>
          )}
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="exam-answers-h">
        <div className="row wrap">
          <h2 id="exam-answers-h" style={{ margin: 0 }}>
            Your answers
          </h2>
          <span className="spacer" />
          {r.passed ? null : (
            <button className="btn sm" onClick={() => void again()} disabled={!!block} title={block?.text}>
              <RotateCcw size={13} /> Try again
            </button>
          )}
          <Link className="btn sm ghost" to="/certificates">
            All certificates
          </Link>
        </div>
        <ol className="exam-answers">
          {r.rows.map(({ item, result }, i) => {
            const kase = catalog?.cases.get(item.caseId);
            const task = catalog?.tasks.get(item.taskId);
            const Icon = ICON[result];
            return (
              <li key={`${item.taskId}-${i}`} className={result}>
                <span className="exam-answer-ico" aria-hidden="true">
                  <Icon size={14} />
                </span>
                <div className="exam-answer-text">
                  <b>
                    {i + 1}. {task?.title ?? 'Question'}
                  </b>
                  <span className="faint">{kase?.learnTitle ?? kase?.neutralTitle ?? item.caseId}</span>
                </div>
                <span className={`chip ${result === 'correct' ? 'ok' : result === 'partial' ? 'warn' : 'bad'}`}>
                  {result === 'partial' && !r.rule.partialCredit ? 'Partly right (no points)' : QUESTION_RESULT_LABEL[result]}
                </span>
                {result !== 'unanswered' && result !== 'timeout' ? (
                  <Link className="btn sm" to={`/read/${encodeURIComponent(item.caseId)}?task=${encodeURIComponent(item.taskId)}&mode=review`}>
                    Review
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
        <small className="faint">Review opens the question with your answer, the expert's reference and the explanation.</small>
      </section>
    </div>
  );
}
