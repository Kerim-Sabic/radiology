import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, CalendarClock, Flame, Play, Siren, Target, Trophy } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { mistakeNotebook, statsFor, todayPlan, unseenAssessTasks } from '../services/learningModel';
import { summary, type DrillStats } from '../services/drill';
import { dailyActivity, streak, type ActivityLog } from '../services/activity';
import { areaProgress, weakestArea } from '../services/areas';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { CaseOfWeekCard, UpgradeCard } from '../components/Upgrade';
import { EmailOptIn } from '../components/EmailChoices';
import { LANDING_FACTS } from '../auth/landingFacts';
import { taskTypeLabel } from '../lib/taskTypes';
import '../styles/home.css';

const readUrl = (caseId: string, taskId: string, mode = 'practice') => `/read/${caseId}?task=${encodeURIComponent(taskId)}&mode=${mode}`;

/** Monday to Sunday of this week: days gone, today outlined, days to come faint. */
function ThisWeek() {
  const today = (new Date().getDay() + 6) % 7; // Monday = 0
  return (
    <div className="home-week" aria-label="This week">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
        <span key={d} className={`home-week-day${i === today ? ' today' : i > today ? ' next' : ''}`}>
          <i aria-hidden="true" />
          <small>{i === today ? 'Today' : d}</small>
        </span>
      ))}
    </div>
  );
}

export function HomePage() {
  const { catalog, attempts, settings, setSettings, progress } = useApp();
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
  const after = plan.slice(1, 6);
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
  /** Never studied here: the streak card invites rather than shows twenty empty weeks. */
  const fresh = run.best === 0 && days.every((d) => d.total === 0);
  const areas = useMemo(() => (catalog ? areaProgress(catalog, attempts).filter((a) => a.patients > 0) : []), [catalog, attempts]);
  const focus = weakestArea(areas);

  const start = () => {
    if (first) navigate(readUrl(first.caseId, first.taskId));
    else navigate('/cases');
  };

  return (
    <div className="page-inner home">
      <section className="home-hero">
        <div className="home-hero-main">
          <h1>{overall.attempts ? 'Pick up your next scan.' : 'Read your first real scan.'}</h1>
          {first && firstCase ? (
            <Link className="home-next" to={readUrl(first.caseId, first.taskId)}>
              {thumb ? <img src={thumb} alt="" /> : <span className="home-next-ph" />}
              <span className="home-next-text">
                <b>{firstCase.neutralTitle}</b>
                <span>
                  {taskTypeLabel(firstTask?.type)} · {first.why}
                </span>
              </span>
              <ArrowRight className="home-next-go" size={18} />
            </Link>
          ) : (
            <p className="muted">{catalog ? 'No practice tasks are installed yet. Check Settings → Data packs.' : 'Loading cases…'}</p>
          )}
          <div className="home-actions">
            <button className="btn primary lg" onClick={start} disabled={!catalog}>
              <Play size={17} /> Start practice
            </button>
            {unseen.length ? (
              <button className="btn" title="A patient you have not seen, with no hints" onClick={() => navigate(readUrl(unseen[0].caseId, unseen[0].id, 'assess'))}>
                <Target size={15} /> Assess yourself
              </button>
            ) : null}
            <button className="btn" onClick={() => navigate('/oncall')}>
              <Siren size={15} /> On-call shift
            </button>
          </div>
        </div>
        <aside className={`home-streak${fresh ? ' fresh' : ''}`} aria-label="Your study streak">
          <div className="home-streak-head">
            {fresh ? null : (
              <span className={`home-flame${run.today ? ' lit' : ''}`}>
                <Flame size={22} />
              </span>
            )}
            <div>
              <b>{fresh ? 'Your streak starts here' : `${run.current} day${run.current === 1 ? '' : 's'}`}</b>
              <span>
                {run.today
                  ? 'Studied today. Keep it going tomorrow.'
                  : run.current
                    ? 'Study today to keep your streak.'
                    : fresh
                      ? 'Answer one question today and your first square lights up.'
                      : 'Answer one question to start a new streak.'}
              </span>
            </div>
          </div>
          {/* A newcomer sees this week, with today waiting to light up, not twenty empty weeks. */}
          {fresh ? <ThisWeek /> : <ActivityCalendar days={days} />}
          <div className="home-streak-foot">
            {fresh ? null : (
              <>
                <span>
                  <Trophy size={13} /> Best {run.best} day{run.best === 1 ? '' : 's'}
                </span>
                <span>
                  {week} answer{week === 1 ? '' : 's'} this week
                </span>
              </>
            )}
            {daysToExam !== null ? (
              <span>
                <CalendarClock size={13} /> {daysToExam >= 0 ? `${daysToExam} days to your exam` : 'Exam date passed'}
              </span>
            ) : null}
          </div>
        </aside>
      </section>

      <EmailOptIn />
      <CaseOfWeekCard />
      <UpgradeCard
        title={`${LANDING_FACTS.patients}+ real patients for members`}
        text="Your free account opens two sample patients. Members also get the case of the week, drills, on-call shifts and certificates."
      />

      {overall.attempts ? (
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
      ) : null}

      <div className={mistakes.length ? 'grid-2' : 'stack'}>
        <section className="card stack">
          <div className="row">
            <h2>After that</h2>
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
          {after.length === 0 ? (
            <p className="muted">{catalog ? 'Nothing planned: every installed task is done for now.' : 'Loading cases…'}</p>
          ) : (
            <ol className="home-plan">
              {after.map((p, i) => {
                const t = catalog?.tasks.get(p.taskId);
                const k = catalog?.cases.get(p.caseId);
                return (
                  <li key={p.taskId}>
                    <span className="home-plan-n">{i + 2}</span>
                    <span className="home-plan-text">
                      <Link className="home-plan-link" to={readUrl(p.caseId, p.taskId)}>
                        {k?.neutralTitle ?? p.caseId}
                      </Link>
                      <small className="faint">
                        {taskTypeLabel(t?.type)} · {p.why}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {mistakes.length ? (
          <section className="card stack">
            <h2>Mistake notebook</h2>
            <p className="muted">
              {mistakes.length} {mistakes.length === 1 ? 'answer waits' : 'answers wait'} for a retry on a different patient.
            </p>
            {mistakes.slice(0, 5).map((m) => (
              <div key={m.attempt.id} className="row">
                <span className="chip warn">{m.reason}</span>
                <Link to={`/read/${m.attempt.caseId}?task=${encodeURIComponent(m.attempt.taskId)}&mode=review`}>{m.task?.title ?? m.attempt.taskId}</Link>
              </div>
            ))}
            <Link to="/progress" className="btn sm" style={{ alignSelf: 'flex-start' }}>
              Open notebook <ArrowRight size={13} />
            </Link>
          </section>
        ) : null}
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

    </div>
  );
}
