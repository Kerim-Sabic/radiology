import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Download, Upload, Trash2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { byDimension, errorCounts, mistakeNotebook, statsFor, STATE_LABEL, MILESTONE_RULE } from '../services/learningModel';
import { summary, type DrillStats } from '../services/drill';
import { ERROR_LABELS, type ErrorCategory } from '../grading/types';
import { OutcomeBadge } from '../components/ui';

export default function ProgressPage() {
  const { attempts, catalog, progress } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const submitted = attempts.filter((a) => a.submittedAt);
  const overall = statsFor(attempts);
  const dims = byDimension(attempts);
  const errors = errorCounts(attempts);
  const notebook = mistakeNotebook(attempts, catalog);
  const cross = submitted.filter((a) => a.skillDimensions.includes('cross_modality'));
  const sure = submitted.filter((a) => a.confidence !== null && a.confidence >= 4);
  const sureRight = sure.filter((a) => a.grade?.outcome === 'correct' || a.selfReview?.verdict === 'correct').length;
  const sureWrong = notebook.filter((m) => m.sureButWrong && !m.resolved);
  const [drill, setDrill] = useState<DrillStats>({});
  // Re-read after any progress change (import, reset), not only on first render.
  useEffect(() => {
    progress.drillStats().then(setDrill);
  }, [progress, attempts]);
  const drillSum = summary(drill);

  const doExport = async () => {
    const data = await progress.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `radiology-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="page-inner stack" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1>Progress</h1>
        <span className="spacer" />
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
            if (window.confirm('Delete all attempts, bookmarks, notes and reviews in this browser? Export a backup first if you may need them.')) {
              await progress.resetAll();
              setMsg('Progress reset.');
            }
          }}
        >
          <Trash2 size={14} /> Reset
        </button>
      </div>
      {msg ? <div className="notice info">{msg}</div> : null}
      <small className="faint">Progress is stored in this browser only. Use Export/Import to move it to another device or browser.</small>

      <section className="row wrap" style={{ gap: 28 }}>
        {[
          [overall.patients, 'unique patients read'],
          [overall.attempts, 'submitted attempts'],
          [overall.independentAttempts, 'independent attempts'],
          [overall.independentCorrect, 'independent correct'],
          [overall.assistedCorrect, 'assisted correct'],
          [cross.length, 'cross-modality attempts'],
        ].map(([n, l]) => (
          <div key={l as string} className="stat">
            <b>{n}</b>
            <span>{l}</span>
          </div>
        ))}
      </section>
      {overall.attempts > 0 && overall.attempts < 20 ? <div className="notice">Small sample: these numbers describe your attempts so far, not a reliable measure of skill.</div> : null}

      <section className="card stack">
        <h2>Skills</h2>
        <small className="faint">{MILESTONE_RULE}</small>
        <table className="table">
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
                <td>{STATE_LABEL[d.stats.state]}</td>
                <td>{d.stats.attempts}</td>
                <td>
                  {d.stats.independentCorrect}/{d.stats.independentAttempts}
                </td>
                <td>{d.stats.assistedCorrect}</td>
                <td>{d.stats.patients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card stack">
        <h2>Error patterns</h2>
        {errors.size === 0 ? (
          <p className="muted">No graded errors yet.</p>
        ) : (
          <div className="row wrap">
            {[...errors.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([e, n]) => (
                <span key={e} className="chip bad">
                  {ERROR_LABELS[e as ErrorCategory] ?? e}: {n}
                </span>
              ))}
          </div>
        )}
        <small className="faint">Misses and false positives are counted separately. False positives only count where the reference covers the whole study.</small>
      </section>

      <section className="card stack">
        <h2>Confidence check</h2>
        {sure.length ? (
          <p className="muted">
            When you said you were sure (4–5 of 5), you were right <b>{Math.round((100 * sureRight) / sure.length)}%</b> of the time ({sureRight} of {sure.length}). Aim for
            confidence that matches accuracy: confident and wrong is the pattern behind real-world misses.
          </p>
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

      <section className="card stack">
        <div className="row">
          <h2>Anatomy drills</h2>
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
                {drillSum.weakest.map((s) => (
                  <Link key={s.key} className="chip" to={`/drill?key=${encodeURIComponent(s.key)}`}>
                    {s.name} · {Math.round((100 * s.correct) / s.seen)}%
                  </Link>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">No drills yet — point to, find and name structures on real scans.</p>
        )}
      </section>

      <section className="card stack">
        <h2>Mistake notebook</h2>
        {notebook.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <table className="table">
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
              {notebook.map((m) => (
                <tr key={m.attempt.id}>
                  <td className="faint">{m.attempt.submittedAt?.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <Link to={`/read/${m.attempt.caseId}?task=${encodeURIComponent(m.attempt.taskId)}&mode=review`}>{m.task?.title ?? m.attempt.taskId}</Link>
                    <div className="faint">{catalog?.cases.get(m.attempt.caseId)?.neutralTitle}</div>
                  </td>
                  <td>{m.reason}</td>
                  <td>{m.attempt.grade ? <OutcomeBadge outcome={m.attempt.grade.outcome} /> : null}</td>
                  <td>{m.resolved ? <span className="chip ok">Redone on another patient</span> : <span className="chip warn">Open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
