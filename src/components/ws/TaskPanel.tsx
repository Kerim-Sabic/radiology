import { BookOpen, Check, Eye, Lightbulb, MapPin, ArrowUpRight, Square, PenLine, Trash2, ArrowRight, RotateCcw, Timer, X } from 'lucide-react';
import type { BookAnchorRef, Task, TeachingCase } from '../../schema/content';
import type { GradeResult, LearnerMark } from '../../grading/types';
import { ERROR_LABELS } from '../../grading/types';
import { canSubmit, hintLadder, needsLabels, needsMarks, reportShown, rules, type SessionState } from '../../services/lessonEngine';
import type { Level } from '../../app/AppContext';
import { OutcomeBadge } from '../ui';
import type { ToolId } from '../../viewer/engine';

interface Props {
  task: Task;
  kase: TeachingCase;
  session: SessionState;
  update: (patch: Partial<SessionState>) => void;
  marks: LearnerMark[];
  grade: GradeResult | null;
  level: Level;
  activeTool: ToolId;
  currentSliceLabel: string | null;
  anchorLabel: (a: BookAnchorRef) => string;
  onTool: (t: ToolId) => void;
  onLabel: (markId: string, label: string) => void;
  onRemoveMark: (markId: string) => void;
  onHint: (level: number) => void;
  onSubmit: () => void;
  onOpenBook: (a: BookAnchorRef) => void;
  onNextDifferentPatient: (() => void) | null;
  onRetry: () => void;
  onNextTask: (() => void) | null;
  selfReview: { checked: string[]; verdict: 'correct' | 'partial' | 'incorrect' | null } | null;
  onSelfReview: (s: { checked: string[]; verdict: 'correct' | 'partial' | 'incorrect' | null }) => void;
  independentNote: string;
  scoringLabel: { text: string; tone: 'ok' | 'warn' | 'accent'; title: string };
  /** A question of a certification exam: the question and its answer only, then on to the next one. */
  exam?: { index: number; total: number; secondsLeft: number | null } | null;
}

const TOOL_NAME: Record<LearnerMark['tool'], string> = { point: 'Point', arrow: 'Arrow', box: 'Box', outline: 'Outline' };

export function TaskPanel(p: Props) {
  const { task, session: s } = p;
  const hints = hintLadder(task);
  const opened = new Set(s.hintsOpened);
  const nextHint = hints.find((h) => !opened.has(h.level));
  const names = task.targets.map((t) => t.name);
  const showMarks = needsMarks(task);
  const exam = p.exam ?? null;
  const showReport = !exam && reportShown(task, p.level);
  const submittable = canSubmit(task, s, p.marks.length, showReport);

  if (exam && !s.submitted) return <ExamQuestion {...p} exam={exam} submittable={submittable} />;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap">
        <span className="chip accent">{s.mode === 'learn' ? 'Learn' : s.mode === 'practice' ? 'Practice' : s.mode === 'assess' ? 'Assess' : 'Review'}</span>
        <span className={`chip ${p.scoringLabel.tone}`} title={p.scoringLabel.title}>
          {p.scoringLabel.text}
        </span>
        {task.skillDimensions.slice(0, 2).map((d) => (
          <span key={d} className="chip">
            {d.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      {rules.revealTitle(s) ? <h2>{task.title}</h2> : <h2>Task</h2>}
      <p className="prompt">{task.prompt}</p>

      {rules.explanationVisible(s) && s.mode === 'learn' ? (
        <div className="notice info">
          <div style={{ whiteSpace: 'pre-wrap' }}>{p.kase.learnNotes}</div>
        </div>
      ) : null}

      {task.grading.kind === 'slice_interval' && !s.submitted ? (
        <div className="notice info">
          Scroll to the level you think is right, then press <b>Submit</b>. Your current slice is what gets checked{p.currentSliceLabel ? ` (now: ${p.currentSliceLabel})` : ''}.
        </div>
      ) : null}

      {showMarks && !s.submitted ? <MarkList {...p} names={names} /> : null}

      {task.grading.kind === 'choice' ? <ChoiceList {...p} /> : null}

      {showReport ? (
        <div className="stack" style={{ gap: 8 }}>
          <h3>{p.level === 'resident' ? 'Report' : 'Describe what you see'}</h3>
          <label>
            Findings (location, side, pattern, extent, associated signs)
            <textarea value={s.report.findings} disabled={s.submitted} onChange={(e) => p.update({ report: { ...s.report, findings: e.target.value } })} />
          </label>
          <label>
            Impression
            <textarea value={s.report.impression} disabled={s.submitted} style={{ minHeight: 44 }} onChange={(e) => p.update({ report: { ...s.report, impression: e.target.value } })} />
          </label>
          {task.type === 'differential' || p.level === 'resident' ? (
            <label>
              Differential (with supporting and opposing image evidence)
              <textarea value={s.report.differential} disabled={s.submitted} style={{ minHeight: 44 }} onChange={(e) => p.update({ report: { ...s.report, differential: e.target.value } })} />
            </label>
          ) : null}
        </div>
      ) : null}

      {!s.submitted ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap">
            {task.allowUncertain ? (
              <>
                <button className="chip" aria-pressed={s.uncertain} onClick={() => p.update({ uncertain: !s.uncertain })}>
                  Not sure
                </button>
                <button className="chip" aria-pressed={s.notAssessable} onClick={() => p.update({ notAssessable: !s.notAssessable })}>
                  Not visible / not assessable
                </button>
              </>
            ) : null}
            {task.grading.kind === 'findings' && task.grading.allowNoFinding ? (
              <button className="chip" aria-pressed={s.declaredNoFinding} onClick={() => p.update({ declaredNoFinding: !s.declaredNoFinding })}>
                No abnormality found
              </button>
            ) : null}
          </div>
          <div className="row">
            <label htmlFor="conf" style={{ whiteSpace: 'nowrap' }}>
              Confidence
            </label>
            <div className="row" id="conf" role="radiogroup" aria-label="Confidence">
              {[1, 2, 3, 4, 5].map((c) => (
                <button key={c} className="chip" role="radio" aria-checked={s.confidence === c} aria-pressed={s.confidence === c} onClick={() => p.update({ confidence: c })}>
                  {c}
                </button>
              ))}
            </div>
            <span className="faint" style={{ fontSize: 11 }}>
              1 guess · 5 certain
            </span>
          </div>
        </div>
      ) : null}

      {rules.hintsAllowed(s) && !s.submitted ? (
        <div className="stack" style={{ gap: 6 }}>
          {hints
            .filter((h) => opened.has(h.level))
            .map((h) => (
              <div key={h.level} className="hint">
                <div className="lvl">Hint {h.level}</div>
                <div>{h.text}</div>
              </div>
            ))}
          {nextHint ? (
            <button className="btn" onClick={() => p.onHint(nextHint.level)}>
              {nextHint.action?.type === 'reveal' ? <Eye size={14} /> : <Lightbulb size={14} />}
              {nextHint.action?.type === 'reveal' ? 'Reveal answer' : `Hint ${nextHint.level}`}
              <span className="faint" style={{ fontSize: 11 }}>
                (counts as assisted)
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {!s.submitted ? (
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn primary lg" disabled={!submittable} onClick={p.onSubmit}>
            <Check size={16} /> Submit
          </button>
          <small className="faint">{p.independentNote}</small>
        </div>
      ) : null}

      {s.submitted && p.grade ? <Feedback {...p} /> : null}
    </div>
  );
}

/** The learner's marks: tool buttons, then each mark with its name or label. */
function MarkList(p: Props & { names: string[] }) {
  const { task, names } = p;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <h3>Your marks</h3>
        <span className="spacer" />
        <button className={`btn sm${p.activeTool === 'point' ? ' primary' : ''}`} onClick={() => p.onTool('point')} title="Point (M)">
          <MapPin size={13} /> Point
        </button>
        <button className={`btn sm${p.activeTool === 'arrow' ? ' primary' : ''}`} onClick={() => p.onTool('arrow')} title="Arrow + label (A)">
          <ArrowUpRight size={13} /> Arrow
        </button>
        <button className={`btn sm${p.activeTool === 'box' ? ' primary' : ''}`} onClick={() => p.onTool('box')} title="Box (B)">
          <Square size={13} />
        </button>
        <button className={`btn sm${p.activeTool === 'outline' ? ' primary' : ''}`} onClick={() => p.onTool('outline')} title="Outline (O)">
          <PenLine size={13} />
        </button>
      </div>
      {p.marks.length === 0 ? (
        <p className="faint">Choose a marking tool, then click on the image. Hold Shift and drag to adjust the window while marking.</p>
      ) : (
        p.marks.map((m, i) => (
          <div key={m.id} className="mark-row">
            <span className="mark-dot" aria-hidden />
            <div className="stack" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {i + 1}. {TOOL_NAME[m.tool]} · {m.view === 'stack' ? 'stack' : m.view}
              </span>
              {needsLabels(task) || (task.grading.kind === 'point_in_target' && names.length > 1) ? (
                <select value={m.label ?? ''} onChange={(e) => p.onLabel(m.id, e.target.value)} aria-label={`Name for mark ${i + 1}`}>
                  <option value="">Name this mark…</option>
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                  <option value="Not sure">Not sure</option>
                </select>
              ) : (
                <input type="text" placeholder="Optional label" value={m.label ?? ''} onChange={(e) => p.onLabel(m.id, e.target.value)} aria-label={`Label for mark ${i + 1}`} />
              )}
            </div>
            <button className="icon-btn" onClick={() => p.onRemoveMark(m.id)} aria-label={`Delete mark ${i + 1}`}>
              <Trash2 size={15} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/** The answer options; after submitting, each one says whether it was right and why. */
function ChoiceList(p: Props) {
  const { task, session: s } = p;
  if (task.grading.kind !== 'choice') return null;
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label="Answer options">
      {task.grading.options.map((o) => {
        const picked = s.choice.includes(o.id);
        const g = task.grading.kind === 'choice' ? task.grading : null;
        return (
          <label key={o.id} className="mark-row" style={{ gridTemplateColumns: '20px 1fr', cursor: s.submitted ? 'default' : 'pointer', color: 'var(--text)' }}>
            <input
              type={g?.multiple ? 'checkbox' : 'radio'}
              name={`choice-${task.id}`}
              checked={picked}
              disabled={s.submitted}
              onChange={() => p.update({ choice: g?.multiple ? (picked ? s.choice.filter((x) => x !== o.id) : [...s.choice, o.id]) : [o.id] })}
            />
            <span>
              {o.text}
              {s.submitted ? (
                <span className="faint" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                  {o.correct ? '✓ ' : '✗ '}
                  {o.why}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * A question of a certification exam: the question, the image tools and the answer, nothing else (no hints, no
 * confidence, no written report). Saving the answer opens the next question; the result comes at the end.
 */
function ExamQuestion(p: Props & { exam: { index: number; total: number; secondsLeft: number | null }; submittable: boolean }) {
  const { task, session: s, exam } = p;
  const last = exam.index === exam.total - 1;
  const left = exam.secondsLeft;
  return (
    <div className="stack exam-question" style={{ gap: 14 }}>
      <div className="exam-q-head">
        <span className="exam-q-num">
          Question {exam.index + 1} <span className="faint">of {exam.total}</span>
        </span>
        {left !== null ? (
          <span className={`chip ${left <= 20 ? 'bad' : 'warn'}`} role="timer" aria-label="Time left for this question">
            <Timer size={12} /> {Math.floor(Math.max(0, left) / 60)}:{String(Math.max(0, left) % 60).padStart(2, '0')} left
          </span>
        ) : (
          <span className="chip">No hints · result at the end</span>
        )}
      </div>
      <p className="prompt">{task.prompt}</p>
      {task.grading.kind === 'slice_interval' ? (
        <div className="notice info">
          Scroll to the level you think is right, then save your answer. Your current slice is what gets checked{p.currentSliceLabel ? ` (now: ${p.currentSliceLabel})` : ''}.
        </div>
      ) : null}
      {needsMarks(task) ? <MarkList {...p} names={task.targets.map((t) => t.name)} /> : null}
      {task.grading.kind === 'choice' ? <ChoiceList {...p} /> : null}
      {task.grading.kind === 'findings' && task.grading.allowNoFinding ? (
        <div className="row wrap">
          <button className="chip" aria-pressed={s.declaredNoFinding} onClick={() => p.update({ declaredNoFinding: !s.declaredNoFinding })}>
            No abnormality found
          </button>
        </div>
      ) : null}
      <div className="stack" style={{ gap: 6 }}>
        <button className="btn primary lg" disabled={!p.submittable} onClick={p.onSubmit}>
          {last ? 'Save answer and finish the exam' : 'Save answer · next question'} <ArrowRight size={16} />
        </button>
        <small className="faint">
          {left !== null
            ? 'Answers cannot be changed once saved. When the time is up, what you have marked or chosen is saved; with nothing marked the question counts as not answered. The clock keeps running if you leave.'
            : 'Answers cannot be changed once saved. You can leave and come back: the exam waits for you.'}
        </small>
      </div>
    </div>
  );
}

function Feedback(p: Props) {
  const g = p.grade!;
  const { task, session: s } = p;
  const rubric = task.rubric ?? [];
  const sr = p.selfReview ?? { checked: [], verdict: null };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className={`outcome ${g.outcome}`} role="status">
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <div className="row wrap">
            <OutcomeBadge outcome={g.outcome} />
            {g.score !== null ? <span className="big">{Math.round(g.score * 100)}%</span> : null}
            <span className={`chip ${rules.independent(s) ? 'ok' : 'warn'}`}>{rules.independent(s) ? 'Independent' : 'Assisted'}</span>
          </div>
          <small className="muted">{g.authorityNote}</small>
        </div>
      </div>
      {(g.outcome === 'incorrect' || g.outcome === 'partial' || sr.verdict === 'incorrect') && (s.confidence ?? 0) >= 4 ? (
        <div className="notice bad">
          <b>You were sure, but this was not right.</b> Confident mistakes are the ones that cause real misses, so this goes to the top of your reviews and comes back on a
          different patient. Before moving on, look at the reference and say what you would check next time.
        </div>
      ) : null}
      {Object.entries(g.components).length ? (
        <div className="stack" style={{ gap: 2 }}>
          {Object.entries(g.components).map(([k, v]) => (
            <div key={k} className="target-line">
              {v!.ok ? <Check size={15} color="var(--ok)" aria-label="ok" /> : <X size={15} color="var(--bad)" aria-label="problem" />}
              <span>
                <b style={{ textTransform: 'capitalize' }}>{k}</b> — {v!.detail}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {g.targets.length ? (
        <div className="stack" style={{ gap: 4 }}>
          <h3>Reference targets</h3>
          {g.targets.map((t) => (
            <div key={t.targetId} className="row" style={{ alignItems: 'flex-start' }}>
              <OutcomeBadge outcome={t.status} />
              <div>
                <b>{t.name}</b>
                <div className="faint" style={{ fontSize: 12 }}>
                  {t.note}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {g.marks.filter((m) => m.status !== 'matched').length ? (
        <div className="stack" style={{ gap: 4 }}>
          <h3>About your other marks</h3>
          {g.marks
            .filter((m) => m.status !== 'matched')
            .map((m) => (
              <div key={m.markId} className="row" style={{ alignItems: 'flex-start' }}>
                <OutcomeBadge outcome={m.status} />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {m.note}
                </span>
              </div>
            ))}
        </div>
      ) : null}
      {g.errors.length ? (
        <div className="row wrap">
          {g.errors.map((e) => (
            <span key={e} className="chip bad">
              {ERROR_LABELS[e]}
            </span>
          ))}
        </div>
      ) : null}
      {g.messages.length ? <small className="muted">{g.messages.join(' ')}</small> : null}

      <div className="divider" />
      <h3>Explanation</h3>
      <p style={{ whiteSpace: 'pre-wrap' }}>{task.explanation}</p>
      {task.bookAnchors.length ? (
        <div className="stack" style={{ gap: 4 }}>
          {task.bookAnchors.map((a, i) => (
            <button key={i} className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => p.onOpenBook(a)}>
              <BookOpen size={13} /> {p.anchorLabel(a)}
            </button>
          ))}
        </div>
      ) : null}

      {rubric.length || task.grading.kind === 'self_review' || s.report.findings || s.report.impression ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="divider" />
          <h3>Self-review your description</h3>
          <small className="faint">Compare your words with this source-linked checklist. This is self-reviewed, not automatically verified.</small>
          {s.report.findings || s.report.impression ? (
            <div className="hint" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>
              {[s.report.findings, s.report.impression && `Impression: ${s.report.impression}`, s.report.differential && `Differential: ${s.report.differential}`].filter(Boolean).join('\n')}
            </div>
          ) : null}
          {rubric.map((r) => (
            <label key={r.id} className="row" style={{ alignItems: 'flex-start', color: 'var(--text)', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={sr.checked.includes(r.id)}
                onChange={(e) => p.onSelfReview({ ...sr, checked: e.target.checked ? [...sr.checked, r.id] : sr.checked.filter((x) => x !== r.id) })}
              />
              <span>
                {r.text} <span className="faint">({r.weight}, {r.category.replace('_', ' ')})</span>
              </span>
            </label>
          ))}
          <div className="row wrap">
            <span className="faint" style={{ fontSize: 12 }}>
              My verdict:
            </span>
            {(['correct', 'partial', 'incorrect'] as const).map((v) => (
              <button key={v} className="chip" aria-pressed={sr.verdict === v} onClick={() => p.onSelfReview({ ...sr, verdict: v })}>
                {v === 'correct' ? 'Covered it' : v === 'partial' ? 'Partly' : 'Missed it'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="divider" />
      <div className="stack" style={{ gap: 6 }}>
        {p.onNextDifferentPatient ? (
          <button className="btn primary" onClick={p.onNextDifferentPatient}>
            <ArrowRight size={15} /> Same skill, different patient
          </button>
        ) : (
          <small className="faint">No other patient has this exact skill yet — it is listed as a content gap in the Course view.</small>
        )}
        {p.onNextTask ? (
          <button className="btn" onClick={p.onNextTask}>
            Next task on this study
          </button>
        ) : null}
        <div className="row">
          <button className="btn" onClick={p.onRetry}>
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      </div>
    </div>
  );
}
