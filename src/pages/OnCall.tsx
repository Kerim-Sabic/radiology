import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import { Play, Siren } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { buildShift, nextItem, RESULT_LABEL, SHIFT_REGIONS, shiftPool, shiftScore, shiftUrl, type ItemResult, type OncallShift } from '../services/oncall';

const TONE: Record<ItemResult, string> = { correct: 'ok', partial: 'warn', incorrect: 'bad', not_judged: '', not_read: '' };
const clock = (s: number | null) => (s === null ? '–' : `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`);
const halves = (x: number) => (Number.isInteger(x) ? String(x) : `${Math.floor(x)}½`);

export default function OnCallPage() {
  const { catalog, attempts, progress } = useApp();
  const navigate = useNavigate();
  const v = useSyncExternalStore(progress.subscribe, progress.getVersion);
  const [shift, setShift] = useState<OncallShift | null>(null);
  const [history, setHistory] = useState<OncallShift[]>([]);
  const [count, setCount] = useState(10);
  const [minutes, setMinutes] = useState<number | null>(4);
  const [region, setRegion] = useState('all');
  useEffect(() => {
    progress.oncallShift().then(setShift);
    progress.oncallHistory().then(setHistory);
  }, [progress, v]);

  if (!catalog) return <div className="vp-status">Loading…</div>;
  const active = shift && !shift.finishedAt ? shift : null;
  const available = shiftPool(catalog, region).size;
  const start = async () => {
    const s = buildShift(catalog, attempts, { count, region, minutesPerCase: minutes });
    if (!s.items.length) return;
    await progress.saveOncallShift(s);
    navigate(shiftUrl(s, 0));
  };
  const resume = async () => {
    if (!active) return;
    const i = nextItem(active);
    if (i >= 0) navigate(shiftUrl(active, i));
    else setShift(await progress.finishOncallShift(active));
  };
  const end = async () => active && setShift(await progress.finishOncallShift(active));
  const report = shift?.finishedAt ? shift : null;

  return (
    <div className="page-inner stack" style={{ gap: 18, maxWidth: 980 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>
          <Siren size={20} style={{ verticalAlign: -3 }} /> On call
        </h1>
        <span className="muted">
          Read a run of unknown cases like a night on call: no hints, no labels and no book until you submit each one, one case per patient, patients you have not read
          first. The clock is a guide — it never throws away your work. At the end you get a scored report with every case to review.
        </span>
      </div>

      {active ? (
        <section className="card stack" style={{ gap: 8 }}>
          <h2>Shift in progress</h2>
          <span className="muted">
            {active.items.filter((i) => i.submittedAt).length} of {active.items.length} cases read · started {new Date(active.startedAt).toLocaleString()}
          </span>
          <div className="row wrap">
            <button className="btn primary" onClick={resume}>
              <Play size={15} /> {nextItem(active) >= 0 ? `Continue with case ${nextItem(active) + 1}` : 'See the report'}
            </button>
            <button className="btn" onClick={end}>
              End the shift now
            </button>
          </div>
        </section>
      ) : (
        <section className="card stack" style={{ gap: 12 }}>
          <h2>Start a shift</h2>
          <div className="stack" style={{ gap: 6 }}>
            <b style={{ fontSize: 13 }}>Cases</b>
            <div className="row wrap">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b style={{ fontSize: 13 }}>Time per case</b>
            <div className="row wrap">
              {[2, 4, 6, null].map((m) => (
                <button key={String(m)} className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                  {m ? `${m} min` : 'No clock'}
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b style={{ fontSize: 13 }}>Region</b>
            <div className="row wrap">
              {SHIFT_REGIONS.map((r) => {
                const n = shiftPool(catalog, r.id).size;
                return (
                  <button key={r.id} className="chip" aria-pressed={region === r.id} disabled={!n} onClick={() => setRegion(r.id)}>
                    {r.label} · {n}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="row wrap">
            <button className="btn primary lg" onClick={start} disabled={!available}>
              <Siren size={16} /> Start the shift ({Math.min(count, available)} {Math.min(count, available) === 1 ? 'case' : 'cases'})
            </button>
            {available < count ? <small className="faint">Only {available} patients are installed for this region.</small> : null}
          </div>
        </section>
      )}

      {report ? <ShiftReport shift={report} /> : null}

      {history.length ? (
        <section className="card stack" style={{ gap: 8 }}>
          <h2>Previous shifts</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Region</th>
                <th>Cases</th>
                <th>Score</th>
                <th>Over time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const sc = shiftScore(h, attempts);
                return (
                  <tr key={h.id}>
                    <td>{new Date(h.startedAt).toLocaleDateString()}</td>
                    <td>{SHIFT_REGIONS.find((r) => r.id === h.region)?.label ?? h.region}</td>
                    <td>{h.items.filter((i) => i.submittedAt).length} / {h.items.length}</td>
                    <td>
                      {halves(sc.points)} / {sc.max}
                      {sc.toJudge ? <span className="faint"> · {sc.toJudge} to judge</span> : null}
                    </td>
                    <td>{sc.overTime}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function ShiftReport({ shift }: { shift: OncallShift }) {
  const { catalog, attempts } = useApp();
  const sc = shiftScore(shift, attempts);
  return (
    <section className="card stack" style={{ gap: 10 }} aria-label="Shift report">
      <div className="row wrap" style={{ alignItems: 'baseline', gap: 16 }}>
        <h2>Shift report</h2>
        <span className="oncall-score">
          {halves(sc.points)} / {sc.max}
        </span>
        <span className="muted">
          {sc.medianSeconds !== null ? `median ${clock(sc.medianSeconds)} per case` : ''}
          {sc.overTime ? ` · ${sc.overTime} over time` : ''}
          {sc.toJudge ? ` · ${sc.toJudge} self-review ${sc.toJudge === 1 ? 'answer' : 'answers'} still to judge` : ''}
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Patient</th>
            <th>Task</th>
            <th>Result</th>
            <th>Time</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sc.rows.map((r, i) => {
            const k = catalog?.cases.get(r.item.caseId);
            const t = catalog?.tasks.get(r.item.taskId);
            return (
              <tr key={`${r.item.caseId}-${r.item.taskId}`}>
                <td>{i + 1}</td>
                <td>
                  {k?.neutralTitle ?? r.item.caseId}
                  {r.item.seenBefore ? <span className="faint"> · read before</span> : null}
                </td>
                <td>{t?.title ?? ''}</td>
                <td>
                  <span className={`chip ${TONE[r.result]}`}>{RESULT_LABEL[r.result]}</span>
                </td>
                <td>
                  {clock(r.seconds)}
                  {r.item.overTime ? <span className="chip warn" style={{ marginLeft: 4 }}>over</span> : null}
                </td>
                <td>
                  {r.item.submittedAt ? (
                    <Link to={`/read/${encodeURIComponent(r.item.caseId)}?task=${encodeURIComponent(r.item.taskId)}&mode=review`}>{r.result === 'not_judged' ? 'Judge it' : 'Review'}</Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
