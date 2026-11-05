import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Download, Upload, Trash2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { byDimension, errorCounts, mistakeNotebook, statsFor, STATE_LABEL, MILESTONE_RULE } from '../services/learningModel';
import { summary, type DrillStats } from '../services/drill';
import { ERROR_LABELS, type ErrorCategory } from '../grading/types';
import { OutcomeBadge } from '../components/ui';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { CertificatesSummary } from '../components/Certificates';
import { ClassNotice } from '../components/ClassNotice';
import { dailyActivity, streak, type ActivityLog } from '../services/activity';

/** The mistake notebook shows this many entries until "Show all". */
const NOTEBOOK_ROWS = 8;
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function ProgressPage() {
  const { attempts, catalog, progress, sync } = useApp();
  const saved = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const synced = saved.status !== 'off';
  const [msg, setMsg] = useState<string | null>(null);
  const [allMistakes, setAllMistakes] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const submitted = attempts.filter((a) => a.submittedAt);
  const overall = statsFor(attempts);
  const dims = byDimension(attempts);
  const errors = [...errorCounts(attempts).entries()].sort((a, b) => b[1] - a[1]);
  const notebook = mistakeNotebook(attempts, catalog);
  // Open entries first (newest first within each group): those are the ones to go back to.
  const mistakes = [...notebook].sort((a, b) => Number(a.resolved) - Number(b.resolved) || (b.attempt.submittedAt ?? '').localeCompare(a.attempt.submittedAt ?? ''));
  const openMistakes = notebook.filter((m) => !m.resolved).length;
  const cross = submitted.filter((a) => a.skillDimensions.includes('cross_modality'));
  const sure = submitted.filter((a) => a.confidence !== null && a.confidence >= 4);
  const sureRight = sure.filter((a) => a.grade?.outcome === 'correct' || a.selfReview?.verdict === 'correct').length;
  const sureWrong = notebook.filter((m) => m.sureButWrong && !m.resolved);
  const [drill, setDrill] = useState<DrillStats>({});
  const [log, setLog] = useState<ActivityLog>({});
  // Re-read after any progress change (import, reset), not only on first render.
  useEffect(() => {
    void Promise.all([progress.drillStats(), progress.activityLog()]).then(([d, l]) => {
      setDrill(d);
      setLog(l);
    });
  }, [progress, attempts]);
  const drillSum = summary(drill);
  const calendar = dailyActivity(attempts, log, drill, 182);
  const run = streak(calendar);
  const activeDays = calendar.filter((d) => d.total > 0).length;
  /** Nothing studied yet: one line and a way in, not six zeros, an empty half-year and an empty table. */
  const fresh = overall.attempts === 0 && activeDays === 0 && !drillSum.practised;
  const independentShare = overall.independentAttempts ? Math.round((100 * overall.independentCorrect) / overall.independentAttempts) : null;

  const doExport = async () => {
    const data = await progress.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `radiology-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const tiles: Array<[number, string, string | null]> = [
    [overall.patients, 'unique patients read', null],
    [overall.attempts, 'submitted attempts', null],
    [overall.independentAttempts, 'independent attempts', 'Practice or Assess, no hints'],
    [overall.independentCorrect, 'independent correct', independentShare === null ? null : `${independentShare}% of independent attempts`],
    [overall.assistedCorrect, 'assisted correct', 'in Learn, with hints or the answer shown'],
    [cross.length, 'cross-modality attempts', 'one patient on two kinds of scan'],
  ];

  return (
    <div className="page-inner stack progress-page">
      <ClassNotice />
      <header className="page-head">
        <h1>Progress</h1>
        <p className="muted">What you have read, how it went, and what to go back to.</p>
      </header>

      {fresh ? (
        <section className="card progress-empty">
          <h2>Nothing to show yet</h2>
          <p className="muted">Your numbers, streak and skills start with your first answer.</p>
          <Link className="btn primary" to="/">
            Start practice
          </Link>
        </section>
      ) : (
      <section className="progress-stats" aria-label="Totals">
        {tiles.map(([n, label, hint]) => (
          <div key={label} className="stat">
            <span>{label}</span>
            <b>{n}</b>
            {hint ? <small>{hint}</small> : null}
          </div>
        ))}
      </section>
      )}
      {overall.attempts > 0 && overall.attempts < 20 ? <div className="notice">Small sample: these numbers describe your attempts so far, not a reliable measure of skill.</div> : null}

      {fresh ? null : (
      <section className="card progress-activity" aria-labelledby="progress-activity-h">
        <div className="progress-activity-main">
          <h2 id="progress-activity-h">Study activity</h2>
          <p className="faint">Answers and drill answers per day, last 26 weeks.</p>
          <ActivityCalendar days={calendar} />
        </div>
        <dl className="progress-streaks">
          <div>
            <dt>Current streak</dt>
            <dd>{days(run.current)}</dd>
          </div>
          <div>
            <dt>Best streak</dt>
            <dd>{days(run.best)}</dd>
          </div>
          <div>
            <dt>Active days</dt>
            <dd>{activeDays}</dd>
          </div>
        </dl>
      </section>
      )}

      <CertificatesSummary />

      {fresh ? null : (
      <>
      <section className="card stack" aria-labelledby="progress-skills-h">
        <h2 id="progress-skills-h">Skills</h2>
        <small className="faint">{MILESTONE_RULE}</small>
        <table className="table progress-skills">
          <thead>
            <tr>
              <th>Dimension</th>
              <th>State</th>
              <th>Attempts</th>
              <th>Independent correct</th>
              <th>Assisted correct</th>
              <th>Patients</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.id}>
                <td>{d.label}</td>
                <td>
                  <span className={`chip state-${d.stats.state}`}>{STATE_LABEL[d.stats.state]}</span>
                </td>
                <td>{d.stats.attempts}</td>
                <td>
                  <span className="progress-share">
                    <span className="progress-meter" aria-hidden>
                      <i style={{ width: `${d.stats.independentAttempts ? (100 * d.stats.independentCorrect) / d.stats.independentAttempts : 0}%` }} />
                    </span>
                    {d.stats.independentCorrect}/{d.stats.independentAttempts}
                  </span>
                </td>
                <td>{d.stats.assistedCorrect}</td>
                <td>{d.stats.patients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="progress-pair">
        <section className="card stack" aria-labelledby="progress-errors-h">
          <h2 id="progress-errors-h">Error patterns</h2>
          {errors.length === 0 ? (
            <p className="muted">No graded errors yet.</p>
          ) : (
            <ul className="progress-bars">
              {errors.map(([e, n]) => (
                <li key={e}>
                  <span>{ERROR_LABELS[e as ErrorCategory] ?? e}</span>
                  <span className="progress-meter bad" aria-hidden>
                    <i style={{ width: `${(100 * n) / errors[0][1]}%` }} />
                  </span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
          <small className="faint">Misses and false positives are counted separately. False positives only count where the reference covers the whole study.</small>
        </section>

        <section className="card stack" aria-labelledby="progress-confidence-h">
          <h2 id="progress-confidence-h">Confidence check</h2>
          {sure.length ? (
            <div className="progress-confidence">
              <b>{Math.round((100 * sureRight) / sure.length)}%</b>
              <p className="muted">
                right when you said you were sure (4–5 of 5): {sureRight} of {sure.length}. Aim for confidence that matches accuracy: confident and wrong is the
                pattern behind real-world misses.
              </p>
            </div>
          ) : (
            <p className="muted">Rate your confidence before submitting; this shows how often “sure” is actually right.</p>
          )}
          {sureWrong.length ? (
            <div className="row wrap">
              <span className="chip bad">Sure but wrong · {sureWrong.length} open</span>
              {sureWrong.slice(0, 6).map((m) => (
                <Link key={m.attempt.id} className="chip" to={`/read/${m.attempt.caseId}?task=${encodeURIComponent(m.attempt.taskId)}&mode=review`}>
                  {m.task?.title ?? m.attempt.taskId}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      </>
      )}

      <section className="card stack" aria-labelledby="progress-drills-h">
        <div className="row">
          <h2 id="progress-drills-h">Drills</h2>
          <span className="spacer" />
          <Link className="btn sm" to="/drill">
            Open drills
          </Link>
        </div>
        {drillSum.practised ? (
          <>
            <p className="muted">
              {drillSum.practised} structures practised · {drillSum.secure} known well · {drillSum.due} due for review now.
            </p>
            {drillSum.weakest.length ? (
              <div className="row wrap">
                <span className="faint">Weakest:</span>
                {drillSum.weakest.map((s) => (
                  <Link key={s.key} className="chip" to={`/drill?key=${encodeURIComponent(s.key)}`}>
                    {s.name} · {Math.round((100 * s.correct) / s.seen)}%
                  </Link>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">No drills yet. Drills ask you to point to, find and name structures on real scans.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="progress-notebook-h">
        <div className="row wrap">
          <h2 id="progress-notebook-h">Mistake notebook</h2>
          {notebook.length ? (
            <span className="faint">
              {openMistakes} open · {notebook.length - openMistakes} redone on another patient
            </span>
          ) : null}
        </div>
        {notebook.length === 0 ? (
          <p className="muted">Empty. Answers you get wrong, or right but unsure, land here until you get the same skill right on another patient.</p>
        ) : (
          <>
            <table className="table progress-notebook">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Task</th>
                  <th>Why it’s here</th>
                  <th>Outcome</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(allMistakes ? mistakes : mistakes.slice(0, NOTEBOOK_ROWS)).map((m) => (
                  <tr key={m.attempt.id}>
                    <td className="faint">{when(m.attempt.submittedAt)}</td>
                    <td>
                      <Link to={`/read/${m.attempt.caseId}?task=${encodeURIComponent(m.attempt.taskId)}&mode=review`}>{m.task?.title ?? m.attempt.taskId}</Link>
                      <div className="faint">{catalog?.cases.get(m.attempt.caseId)?.neutralTitle}</div>
                    </td>
                    <td>{sentence(m.reason)}</td>
                    <td>{m.attempt.grade ? <OutcomeBadge outcome={m.attempt.grade.outcome} /> : null}</td>
                    <td>{m.resolved ? <span className="chip ok">Redone on another patient</span> : <span className="chip warn">Open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mistakes.length > NOTEBOOK_ROWS ? (
              <button className="btn sm progress-more" onClick={() => setAllMistakes((v) => !v)} aria-expanded={allMistakes}>
                {allMistakes ? 'Show fewer' : `Show all ${mistakes.length}`}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className="card progress-data" aria-labelledby="progress-data-h">
        <div>
          <h2 id="progress-data-h">Your data</h2>
          {synced ? (
            <p className="muted">
              Every answer you submit is saved to your account and appears on any device where you sign in. This browser keeps a copy too, so an answer made offline is
              kept here and saved to your account once you are back online. Bookmarks, notes and drill schedules stay in this browser; Export a backup to keep everything.
            </p>
          ) : (
            <p className="muted">Progress is stored in this browser only. Export a backup to move it to another device or browser, and import it there.</p>
          )}
          {synced && saved.refused ? (
            <p className="muted">
              {saved.refused === 1 ? '1 answer is' : `${saved.refused} answers are`} too large to save to your account and {saved.refused === 1 ? 'stays' : 'stay'} in this browser only.
            </p>
          ) : null}
          {msg ? (
            <div className="notice info" role="status">
              {msg}
            </div>
          ) : null}
        </div>
        <div className="progress-data-actions">
          <button className="btn" onClick={doExport}>
            <Download size={14} /> Export backup
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            <Upload size={14} /> Import backup
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const counts = await progress.importAll(JSON.parse(await f.text()));
                setMsg(`Imported ${counts.attempts} attempts, ${counts.bookmarks} bookmarks, ${counts.notes} notes, ${counts.reviews} reviews.`);
              } catch (err) {
                setMsg((err as Error).message);
              }
              e.target.value = '';
            }}
          />
          <button
            className="btn danger"
            onClick={async () => {
              const question = synced
                ? 'Delete all attempts, bookmarks, notes and reviews in this browser, and the answers saved to your account (every device where you sign in)? Export a backup first if you may need them.'
                : 'Delete all attempts, bookmarks, notes and reviews in this browser? Export a backup first if you may need them.';
              if (window.confirm(question)) {
                try {
                  await sync.resetEverywhere();
                  setMsg(synced ? 'Progress reset here and in your account.' : 'Progress reset.');
                } catch (err) {
                  setMsg(`Nothing was deleted: your account could not be reached (${(err as Error).message}). Try again when you are online.`);
                }
              }
            }}
          >
            <Trash2 size={14} /> Reset
          </button>
        </div>
      </section>
    </div>
  );
}
