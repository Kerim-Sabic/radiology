import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, BookOpen, Bone, CalendarClock, Flame, GraduationCap, Library, Play, Search, Siren, Target, Trophy } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { mistakeNotebook, statsFor, todayPlan, unseenAssessTasks } from '../services/learningModel';
import { summary, type DrillStats } from '../services/drill';
import { dailyActivity, streak, type ActivityLog } from '../services/activity';
import { areaProgress, weakestArea } from '../services/areas';
import { CONDITIONS } from '../content/conditions';
import { ActivityCalendar } from '../components/ActivityCalendar';
import '../styles/home.css';

const greeting = (h: number) => (h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
const readUrl = (caseId: string, taskId: string, mode = 'practice') => `/read/${caseId}?task=${encodeURIComponent(taskId)}&mode=${mode}`;

export function HomePage() {
  const { catalog, attempts, settings, setSettings, curriculum, progress } = useApp();
  const [drill, setDrill] = useState<DrillStats>({});
  const [log, setLog] = useState<ActivityLog>({});
  // Re-read after any progress change (a drill answer, an import), not only on first render.
  useEffect(() => {
    void Promise.all([progress.drillStats(), progress.activityLog()]).then(([d, l]) => {
      setDrill(d);
      setLog(l);
    });
  }, [progress, attempts]);
  const drillSum = summary(drill);
  const navigate = useNavigate();
  const plan = todayPlan(attempts, catalog, settings.minutesPerDay);
  const first = plan[0];
  const firstCase = first ? catalog?.cases.get(first.caseId) : undefined;
  const firstTask = first ? catalog?.tasks.get(first.taskId) : undefined;
  const thumb = firstCase && catalog ? catalog.thumbnailUrl(firstCase.primarySeriesUid) : null;
  const overall = statsFor(attempts);
  const mistakes = mistakeNotebook(attempts, catalog).filter((m) => !m.resolved);
  const unseen = unseenAssessTasks(attempts, catalog);
  const patients = catalog ? new Set([...catalog.cases.values()].map((c) => c.subjectKey)).size : 0;
  const daysToExam = settings.examDate ? Math.ceil((Date.parse(settings.examDate) - Date.now()) / 86400e3) : null;
  const days = useMemo(() => dailyActivity(attempts, log, drill, 140), [attempts, log, drill]);
  const run = streak(days);
  const week = days.slice(-7).reduce((s, d) => s + d.total, 0);
  const areas = useMemo(() => (catalog ? areaProgress(catalog, attempts).filter((a) => a.patients > 0) : []), [catalog, attempts]);
  const focus = weakestArea(areas);
  const units = curriculum?.file?.units.length ?? 0;

  const start = () => {
    if (first) navigate(readUrl(first.caseId, first.taskId));
    else navigate('/cases');
  };

  const tiles: Array<{ to: string; icon: React.ReactNode; title: string; sub: string; hot?: boolean }> = [
    { to: '/cases', icon: <Library />, title: 'Cases', sub: `${patients || '–'} patients` },
    { to: '/conditions', icon: <Search />, title: 'Conditions', sub: `Search ${CONDITIONS.length} conditions` },
    { to: '/drill', icon: <Target />, title: 'Drills', sub: drillSum.due ? `${drillSum.due} due now` : 'Point and name', hot: drillSum.due > 0 },
    { to: '/oncall', icon: <Siren />, title: 'On call', sub: 'Timed unknown cases' },
    { to: '/atlas', icon: <Bone />, title: 'Atlas', sub: 'Any structure, alone' },
    { to: '/course', icon: <GraduationCap />, title: 'Course', sub: units ? `${units} chapters` : 'Chapter by chapter' },
    { to: '/book', icon: <BookOpen />, title: 'Book', sub: 'Read beside your scans' },
  ];

  return (
    <div className="page-inner home">
      <section className="home-hero">
        <div className="home-hero-main">
          <div className="home-hero-top">
            <span className="home-greet">{greeting(new Date().getHours())}</span>
            <div className="mode-switch" role="group" aria-label="Your level">
              {(['student', 'resident'] as const).map((l) => (
                <button key={l} aria-pressed={settings.level === l} onClick={() => setSettings({ level: l })}>
                  {l === 'student' ? 'Student' : 'Resident'}
                </button>
              ))}
            </div>
          </div>
          <h1>{overall.attempts ? 'Pick up your next scan.' : 'Read your first real scan.'}</h1>
          {first && firstCase ? (
            <Link className="home-next" to={readUrl(first.caseId, first.taskId)}>
              {thumb ? <img src={thumb} alt="" /> : <span className="home-next-ph" />}
              <span className="home-next-text">
                <small>Next up</small>
                <b>{firstCase.neutralTitle}</b>
                <span>
                  {firstTask?.type.replace(/_/g, ' ')} · {first.why}
                </span>
              </span>
              <ArrowRight className="home-next-go" size={18} />
            </Link>
          ) : (
            <p className="muted">{catalog ? 'No practice tasks are installed yet. Check Settings → Data packs.' : 'Loading cases…'}</p>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary lg" onClick={start} disabled={!catalog}>
              <Play size={17} /> Start practice
            </button>
            {unseen.length ? (
              <button className="btn lg" onClick={() => navigate(readUrl(unseen[0].caseId, unseen[0].id, 'assess'))}>
                <Target size={17} /> Assess on an unseen patient
              </button>
            ) : null}
            <button className="btn lg" onClick={() => navigate('/oncall')}>
              <Siren size={17} /> On-call shift
            </button>
          </div>
        </div>
        <aside className="home-streak" aria-label="Your study streak">
          <div className="home-streak-head">
            <span className={`home-flame${run.today ? ' lit' : ''}`}>
              <Flame size={22} />
            </span>
            <div>
              <b>
                {run.current} day{run.current === 1 ? '' : 's'}
              </b>
              <span>{run.today ? 'Studied today. Keep it going tomorrow.' : run.current ? 'Study today to keep your streak.' : 'Answer one question to start a streak.'}</span>
            </div>
          </div>
          <ActivityCalendar days={days} />
          <div className="home-streak-foot">
            <span>
              <Trophy size={13} /> Best {run.best} day{run.best === 1 ? '' : 's'}
            </span>
            <span>{week} answers this week</span>
            {daysToExam !== null ? (
              <span>
                <CalendarClock size={13} /> {daysToExam >= 0 ? `${daysToExam} days to your exam` : 'Exam date passed'}
              </span>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="home-stats" aria-label="Your numbers">
        <div>
          <b>{overall.patients}</b>
          <span>of {patients || '–'} patients read</span>
        </div>
        <div>
          <b>{overall.independentCorrect}</b>
          <span>right with no help</span>
        </div>
        <div>
          <b>{drillSum.secure}</b>
          <span>drill items known well</span>
        </div>
        <div>
          <b>{mistakes.length}</b>
          <span>mistakes to retry</span>
        </div>
      </section>

      <nav className="home-tiles" aria-label="Study modes">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className={`home-tile${t.hot ? ' hot' : ''}`}>
            <span className="home-tile-icon" aria-hidden="true">
              {t.icon}
            </span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </Link>
        ))}
      </nav>

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
          {plan.length === 0 ? (
            <p className="muted">{catalog ? 'Nothing planned: every installed task is done for now.' : 'Loading cases…'}</p>
          ) : (
            <ol className="home-plan">
              {plan.map((p, i) => {
                const t = catalog?.tasks.get(p.taskId);
                const k = catalog?.cases.get(p.caseId);
                return (
                  <li key={p.taskId}>
                    <span className="home-plan-n">{i + 1}</span>
                    <span className="home-plan-text">
                      <Link to={readUrl(p.caseId, p.taskId)}>{k?.neutralTitle ?? p.caseId}</Link>
                      <small className="faint">
                        {t?.type.replace(/_/g, ' ')} · {p.why}
                      </small>
                    </span>
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

      {areas.length ? (
        <section className="card stack">
          <div className="row wrap">
            <h2>Your areas</h2>
            <span className="faint">Patients read in each area, and how often you were right.</span>
          </div>
          <div className="home-areas">
            {areas.map((a) => (
              <div key={a.id} className={`home-area${focus?.id === a.id ? ' focus' : ''}`}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <b>{a.label}</b>
                  {focus?.id === a.id ? <span className="chip accent">Work on this next</span> : null}
                </div>
                <small className="faint">
                  {a.read} of {a.patients} patients read{a.accuracy !== null ? ` · ${Math.round(a.accuracy * 100)}% right` : ''}
                </small>
                <div className="home-bar" role="img" aria-label={`${a.label}: ${a.read} of ${a.patients} patients read`}>
                  <span style={{ width: `${(100 * a.read) / a.patients}%` }} />
                </div>
                {a.next ? (
                  <Link className="home-area-go" to={readUrl(a.next.caseId, a.next.taskId)}>
                    Practise {a.label.toLowerCase()} <ArrowRight size={12} />
                  </Link>
                ) : (
                  <small className="faint">Every task here is done.</small>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {overall.attempts < 5 ? (
        <section className="card stack">
          <h2>How a session works</h2>
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
          <small className="faint">
            Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to jump to a page, a condition, a case or a chapter.
          </small>
        </section>
      ) : null}
    </div>
  );
}
