import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Award, ExternalLink, Lock, RotateCcw } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { CERT_TITLES, EXAMS, examRequirement, examRule, levelLabel, myCertificates, type CertArea, type CertLevel, type IssuedCertificate } from '../services/certificates';
import { examAvailable, examBlock, examResultUrl, examScore, examUrl, finishExam, nextQuestion, startExam, type CertExam } from '../services/exam';
import { LEVEL_STYLE, examDetail, levelName } from '../../shared/certificateLevels';
import '../styles/upgrade.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ORDER: CertArea[] = ['chest', 'abdomen', 'head', 'msk', 'breast', 'all'];
const LEVELS_123: CertLevel[] = [1, 2, 3];
const onDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Every certificate: one exam per level, the exam in progress, the last result of each, and the certificates held. */
export default function CertificatesPage() {
  const { catalog, attempts, progress, free, openPlans } = useApp();
  const account = useAccount();
  const navigate = useNavigate();
  const [issued, setIssued] = useState<IssuedCertificate[]>([]);
  const [current, setCurrent] = useState<CertExam | null>(null);
  const [history, setHistory] = useState<CertExam[]>([]);
  useEffect(() => {
    if (account && !free) void myCertificates().then(setIssued);
  }, [account, free]);
  useEffect(() => {
    void progress.currentCertExam().then((e) => setCurrent(e && !e.finishedAt ? e : null));
    void progress.certExamHistory().then(setHistory);
  }, [progress, attempts.length]);
  const signedIn = !!account;
  const mine = [...issued].sort((a, b) => ORDER.indexOf(a.area as CertArea) - ORDER.indexOf(b.area as CertArea) || (b.level ?? 1) - (a.level ?? 1));
  const available = useMemo(() => {
    const m = new Map<string, boolean>();
    if (catalog) for (const a of ORDER) for (const l of LEVELS_123) m.set(`${a}-${l}`, examAvailable(catalog, a, l));
    return m;
  }, [catalog]);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // The server picks the questions (and checks the order of levels and the wait after a failed exam).
  const start = async (area: CertArea, level: CertLevel) => {
    setStarting(true);
    setError('');
    const r = await startExam(area, level);
    setStarting(false);
    if (!r.ok) return setError(r.error);
    await progress.saveCertExam(r.data.exam);
    navigate(examUrl(r.data.exam, 0));
  };
  // The last answer given, or an exam ended early: the server scores it (questions not answered count as wrong).
  const end = async (e: CertExam) => {
    const r = await finishExam(e.id);
    const done = await progress.finishCertExam(r.ok ? { ...e, result: r.data.result, finishedAt: r.data.result.finishedAt } : e);
    navigate(examResultUrl(done));
  };
  const resume = (e: CertExam) => {
    const i = nextQuestion(e);
    if (i >= 0) navigate(examUrl(e, i));
    else void end(e);
  };
  const answered = current ? current.items.filter((it) => it.submittedAt).length : 0;

  return (
    <div className="page-inner certs-page">
      <header className="certs-intro">
        <h1>Certificates</h1>
        <p className="muted">
          Each body area has three levels, from Foundation to Advanced, and the whole library three more. Every level is an exam on real patients, and each one is a real
          step up: more questions, a higher pass mark, a clock, more findings to mark on the image yourself, subtle cases, and at Advanced no half points. Pass it and the
          certificate is yours, with a public check link and the steps to add it to LinkedIn under Licenses &amp; certifications.
        </p>
        <ol className="certs-how" aria-label="How the exam works">
          <li>
            <b>Start with Level 1</b>
            <span>The levels go in order: pass one to unlock the next. Each question shows one patient's images and asks one thing.</span>
          </li>
          <li>
            <b>Answer every question</b>
            <span>Mark the finding or choose the answer, then go on. No hints, and no result until the end. From Level 2 each question is timed.</span>
          </li>
          <li>
            <b>Passed or not</b>
            <span>The result comes right after the last question, with every answer to review. Passed? Type your name and your certificate is ready.</span>
          </li>
        </ol>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href="/certificate/example" target="_blank" rel="noopener noreferrer">
            See an example <ExternalLink size={13} />
          </a>
          {free ? (
            <button className="btn primary" onClick={openPlans}>
              See plans
            </button>
          ) : null}
        </div>
        {free ? <p className="notice">The exams draw on the whole library, so they are for members.</p> : null}
        {signedIn && !free ? (
          <p className="faint certs-own">
            The server picks every exam's questions, keeps each question's clock and grades every answer itself; a certificate is issued once, for a pass it scored. Take
            the exams yourself: a certificate can be revoked.
          </p>
        ) : null}
        {error ? (
          <p className="notice bad" role="alert">
            {error}
          </p>
        ) : null}
        {!signedIn ? <p className="notice">Sign in as a member to take the exams and get certificates.</p> : null}
      </header>

      {current ? (
        <section className="card certs-current" aria-labelledby="certs-current-h">
          <div>
            <h2 id="certs-current-h">Exam in progress</h2>
            <p className="muted" style={{ margin: 0 }}>
              <b>{CERT_TITLES[current.area]}</b> · {levelLabel(current.level)} · {answered} of {current.items.length} questions answered
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => resume(current)}>
              Continue the exam <ArrowRight size={14} />
            </button>
            <button className="btn ghost" onClick={() => void end(current)} title="End now: the questions not answered count as wrong">
              End it now
            </button>
          </div>
        </section>
      ) : null}

      {mine.length ? (
        <section className="card stack" aria-labelledby="certs-mine-h">
          <h2 id="certs-mine-h">Your certificates</h2>
          <ul className="certs-mine">
            {mine.map((c) => (
              <li key={c.id}>
                <span className="certs-mine-ico" aria-hidden="true">
                  <Award size={18} />
                </span>
                <div>
                  <b>{c.title}</b>
                  <span className="faint">
                    {levelLabel(c.level)} · {c.exam ? `passed with ${pct(c.accuracy)}` : `${pct(c.accuracy)} right`} · issued {onDay(c.issuedAt)}
                  </span>
                </div>
                <a className="btn sm" href={`/verify/${c.id}`} target="_blank" rel="noopener noreferrer">
                  View and share <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="certs-levels-h">
        <h2 id="certs-levels-h">The exams</h2>
        <div className="certs-levels-wrap">
          <table className="certs-levels">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Each body area</th>
                <th scope="col">General Radiology (the whole library)</th>
              </tr>
            </thead>
            <tbody>
              {EXAMS.area.map((rule, i) => (
                <tr key={rule.level}>
                  <th scope="row">
                    {levelLabel(rule.level)}
                    <small className="faint certs-level-detail">{examDetail(rule)}</small>
                  </th>
                  <td data-label="Each body area">{examRequirement(rule)}</td>
                  <td data-label="General Radiology">{examRequirement(EXAMS.all[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small className="faint">
          Every question is graded automatically against the expert's reference: a mark must land on the finding, on the right image and side, or the answer must match
          the expert's. A partly right answer counts half at Levels 1 and 2 and nothing at Level 3. When a question's time runs out, what you have marked or chosen is
          saved; with nothing marked it counts as wrong. Two-answer questions (a guess passes half of them) are left out from Level 2. Questions you have not answered
          before come first, so a new attempt brings new patients. After an exam you did not pass, Level 2 can be tried again after an hour and Level 3 after a day.
        </small>
      </section>

      <div className="certs-areas">
        {ORDER.map((area) => (
          <section key={area} className="card certs-area" aria-labelledby={`certs-${area}`}>
            <div className="certs-area-head">
              <h2 id={`certs-${area}`}>{CERT_TITLES[area]}</h2>
            </div>
            <ol className="certs-ladder">
              {LEVELS_123.map((level) => {
                const rule = examRule(area, level);
                const have = issued.find((c) => c.area === area && (c.level ?? 1) === level && c.status !== 'revoked');
                const last = history.find((e) => e.area === area && e.level === level) ?? null;
                const lastScore = last ? examScore(last, attempts) : null;
                const here = current && current.area === area && current.level === level ? current : null;
                const ok = available.get(`${area}-${level}`) ?? false;
                const block = examBlock(area, level, issued, history, attempts);
                let status = 'Not taken yet.';
                if (here) status = `In progress: ${here.items.filter((it) => it.submittedAt).length} of ${here.items.length} answered.`;
                else if (last && lastScore)
                  status = `Last exam ${onDay(last.finishedAt ?? last.startedAt)}: ${pct(lastScore.score)}, ${lastScore.passed ? 'passed' : `not passed (needs ${pct(lastScore.passMark)})`}.`;
                else if (have) status = `Issued ${onDay(have.issuedAt)}.`;
                else if (free) status = 'For members: the exam draws on the whole library.';
                else if (!catalog) status = 'Loading the library…';
                else if (!ok) status = 'Not enough patients in the library for this level yet: more are on the way.';
                else if (block) status = block.text;
                return (
                  <li key={level} id={`cert-${area}-${level}`} className={have || lastScore?.passed ? 'ok' : ''} style={{ ['--lvl' as string]: LEVEL_STYLE[level].ring[0] }}>
                    <div className="certs-step-head">
                      <span className="certs-badge" aria-hidden="true">
                        {level}
                      </span>
                      <b>
                        Level {level} · {levelName(level)}
                      </b>
                      <span className="certs-stars" aria-label={`${level} of 3 stars`}>
                        {'★'.repeat(level)}
                        {'☆'.repeat(3 - level)}
                      </span>
                      {have ? <span className="chip ok">Issued</span> : lastScore?.passed ? <span className="chip accent">Passed</span> : null}
                    </div>
                    <span className="faint certs-numbers">{examRequirement(rule)}</span>
                    <div className="cert-row">
                      <small className="faint">{status}</small>
                      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {have ? (
                          <a className="btn sm" href={`/verify/${have.id}`} target="_blank" rel="noopener noreferrer">
                            View and share <ExternalLink size={12} />
                          </a>
                        ) : null}
                        {last && lastScore ? (
                          <button className="btn sm" onClick={() => navigate(examResultUrl(last))}>
                            {lastScore.passed && !have ? 'Get the certificate' : 'See the result'}
                          </button>
                        ) : null}
                        {free ? (
                          <button className="btn sm primary" onClick={openPlans}>
                            See plans
                          </button>
                        ) : here ? (
                          <button className="btn sm primary" onClick={() => resume(here)}>
                            Continue the exam <ArrowRight size={13} />
                          </button>
                        ) : have ? null : signedIn && ok && block?.reason === 'order' ? (
                          <span className="chip" title={block.text}>
                            <Lock size={12} /> Level {level - 1} first
                          </span>
                        ) : signedIn && ok ? (
                          <button
                            className="btn sm primary"
                            disabled={!!current || !!block || starting}
                            title={current ? 'Finish or end the exam in progress first.' : block?.text}
                            onClick={() => void start(area, level)}
                          >
                            {last ? (
                              <>
                                <RotateCcw size={13} /> Try again
                              </>
                            ) : (
                              <>
                                Start the exam <ArrowRight size={13} />
                              </>
                            )}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
