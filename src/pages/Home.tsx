import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Bone, BookOpen, Play, Target } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { mistakeNotebook, statsFor, todayPlan, unseenAssessTasks } from '../services/learningModel';
import { summary, type DrillStats } from '../services/drill';

export function HomePage() {
  const { catalog, attempts, settings, setSettings, curriculum, progress } = useApp();
  const [drill, setDrill] = useState<DrillStats>({});
  useEffect(() => {
    progress.drillStats().then(setDrill);
  }, [progress]);
  const drillSum = summary(drill);
  const navigate = useNavigate();
  const plan = todayPlan(attempts, catalog, settings.minutesPerDay);
  const first = plan[0];
  const overall = statsFor(attempts);
  const mistakes = mistakeNotebook(attempts, catalog).filter((m) => !m.resolved);
  const unseen = unseenAssessTasks(attempts, catalog);
  const patients = catalog ? new Set([...catalog.cases.values()].map((c) => c.subjectKey)).size : 0;
  const daysToExam = settings.examDate ? Math.ceil((Date.parse(settings.examDate) - Date.now()) / 86400e3) : null;

  const start = () => {
    if (first) navigate(`/read/${first.caseId}?task=${encodeURIComponent(first.taskId)}&mode=practice`);
    else navigate('/cases');
  };

  return (
    <div className="page-inner stack" style={{ gap: 20 }}>
      <section className="hero">
        <div className="stack" style={{ gap: 8, maxWidth: 560 }}>
          <span style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Real cases. Deeper understanding.</span>
          <h1>Read real studies. Mark what you see. Get spatial feedback.</h1>
          <p className="muted">
            Practice on genuine CT, MRI and radiographs from different patients. Every scored answer is checked against a source reference on the exact slice — and linked back to the
            page of <i>Learning Radiology</i> (5th ed.) that explains it.
          </p>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <button className="btn primary lg" onClick={start} disabled={!catalog}>
              <Play size={17} /> Start practice
            </button>
            {unseen.length ? (
              <button className="btn lg" onClick={() => navigate(`/read/${unseen[0].caseId}?task=${encodeURIComponent(unseen[0].id)}&mode=assess`)}>
                <Target size={17} /> Assess on an unseen patient
              </button>
            ) : null}
          </div>
          {first ? <small className="faint">Next up: {first.why}.</small> : null}
        </div>
        <div className="row wrap" style={{ gap: 28 }}>
          <div className="stat">
            <b>{patients}</b>
            <span>patients installed</span>
          </div>
          <div className="stat">
            <b>{catalog?.tasks.size ?? '–'}</b>
            <span>image tasks</span>
          </div>
          <div className="stat">
            <b>{overall.patients}</b>
            <span>patients you’ve read</span>
          </div>
          <div className="stat">
            <b>{overall.independentCorrect}</b>
            <span>independent correct</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card stack">
          <div className="row">
            <h2>Today</h2>
            <span className="spacer" />
            <label className="row" style={{ gap: 6 }}>
              Minutes
              <select value={settings.minutesPerDay ?? ''} onChange={(e) => setSettings({ minutesPerDay: e.target.value ? Number(e.target.value) : null })} aria-label="Minutes available today">
                <option value="">auto</option>
                {[10, 20, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {daysToExam !== null ? <small className="muted">{daysToExam >= 0 ? `${daysToExam} days until your exam.` : 'Exam date has passed — update it in Settings.'}</small> : null}
          {plan.length === 0 ? (
            <p className="muted">{catalog ? 'No practice tasks are installed yet. Check Settings → Data packs.' : 'Loading cases…'}</p>
          ) : (
            <ol className="stack" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
              {plan.map((p) => {
                const t = catalog?.tasks.get(p.taskId);
                const k = catalog?.cases.get(p.caseId);
                return (
                  <li key={p.taskId}>
                    <Link to={`/read/${p.caseId}?task=${encodeURIComponent(p.taskId)}&mode=practice`}>{k?.neutralTitle ?? p.caseId}</Link>{' '}
                    <span className="faint">— {t?.type.replace(/_/g, ' ')} · {p.why}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section className="card stack">
          <h2>Mistake notebook</h2>
          {mistakes.length === 0 ? (
            <p className="muted">Nothing to revisit yet. Misses, uncertain answers and revealed answers collect here until you get the same skill right on a different patient.</p>
          ) : (
            <>
              <p className="muted">{mistakes.length} item(s) waiting for a retry on a different patient.</p>
              {mistakes.slice(0, 5).map((m) => (
                <div key={m.attempt.id} className="row">
                  <span className="chip warn">{m.reason}</span>
                  <Link to={`/read/${m.attempt.caseId}?task=${encodeURIComponent(m.attempt.taskId)}&mode=review`}>{m.task?.title ?? m.attempt.taskId}</Link>
                </div>
              ))}
              <Link to="/progress" className="btn sm" style={{ alignSelf: 'flex-start' }}>
                Open notebook <ArrowRight size={13} />
              </Link>
            </>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="row">
          <h2>How a session works</h2>
          <span className="spacer" />
          <div className="mode-switch" role="group" aria-label="Your level">
            {(['student', 'resident'] as const).map((l) => (
              <button key={l} aria-pressed={settings.level === l} onClick={() => setSettings({ level: l })}>
                {l === 'student' ? 'Student' : 'Resident'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-3">
          {[
            ['1 · Orient', 'Check modality, plane, side markers and window. Scroll the whole stack before deciding.'],
            ['2 · Search & mark', 'Use Point or Arrow (M / A) on the slice where you see it. Name each mark.'],
            ['3 · Commit', settings.level === 'resident' ? 'Write findings, impression and a focused differential, then submit.' : 'Say what you see and how sure you are, then submit.'],
            ['4 · Feedback', 'See your marks against the source reference: level, identity, side and position are graded separately.'],
            ['5 · Read the book', 'Jump to the exact page/figure of the 5th edition — then return to your scan state.'],
            ['6 · New patient', 'Repeat the skill on a different patient. That is what counts as learning here.'],
          ].map(([h, t]) => (
            <div key={h} className="stack" style={{ gap: 4 }}>
              <b>{h}</b>
              <small className="muted">{t}</small>
            </div>
          ))}
        </div>
      </section>

      {curriculum?.file ? (
        <section className="card row wrap">
          <BookOpen size={18} />
          <span>
            Curriculum: {curriculum.file.units.length} units, {curriculum.file.units.reduce((a, u) => a + u.objectives.length, 0)} source-linked objectives.
          </span>
          <span className="spacer" />
          <Link className="btn sm" to="/course">
            Open course map
          </Link>
          <Link className="btn sm primary" to="/book">
            Continue reading the book
          </Link>
        </section>
      ) : null}

      <section className="card row wrap">
        <Target size={18} />
        <span>
          <b>Anatomy drills</b> — point to it, find its level, name the outline, pick the window. Misses come back on a different patient.
          {drillSum.practised ? ` ${drillSum.due} due now · ${drillSum.secure} known well.` : ''}
        </span>
        <span className="spacer" />
        <Link className="btn sm primary" to="/drill">
          {drillSum.due ? `Review ${drillSum.due} due` : 'Start drilling'}
        </Link>
      </section>

      <section className="card row wrap">
        <Bone size={18} />
        <span>
          <b>Anatomy atlas</b> — pick any structure (a rib, a vertebra, the adrenal glands…) and see it alone on a real CT or radiograph.
        </span>
        <span className="spacer" />
        <Link className="btn sm" to="/atlas">
          Open the atlas
        </Link>
      </section>
    </div>
  );
}
