import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, Check, Contrast, Eye } from 'lucide-react';
import { patternsFor, type CoachStep } from '../../content/searchPatterns';

interface Props {
  caseId: string;
  family: string;
  /** Canonical anatomy keys labelled on the focused series (from manifests). */
  keys: Set<string>;
  /** Labels may be shown (Learn/Review, or after submitting). */
  canShow: boolean;
  /** Window presets may be applied (everything except an unsubmitted Assess task). */
  canWindow: boolean;
  activeStep: string | null;
  onShow: (step: CoachStep) => void;
  onWindow: (step: CoachStep) => void;
  /** Open the book at a PDF page in the side panel. */
  onBook?: (page: number, unit: string) => void;
  onClear: () => void;
}

const storeKey = (caseId: string, pattern: string) => `rvm-coach:${caseId}:${pattern}`;
function readDone(k: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(k) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Systematic search pattern: tick each area as you check it; "Show me" outlines the structures involved. */
export function CoachPanel(p: Props) {
  const patterns = useMemo(() => patternsFor(p.family, p.keys), [p.family, p.keys]);
  const [pid, setPid] = useState<string | null>(null);
  const pattern = patterns.find((x) => x.id === pid) ?? patterns[0] ?? null;
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    if (pattern) setDone(readDone(storeKey(p.caseId, pattern.id)));
  }, [p.caseId, pattern]);
  const toggle = (id: string) => {
    if (!pattern) return;
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try {
      sessionStorage.setItem(storeKey(p.caseId, pattern.id), JSON.stringify(next));
    } catch {
      /* private mode: ticks last for this view only */
    }
  };

  if (!pattern) return <div className="notice">No reading checklist fits this kind of image yet.</div>;
  const has = (s: CoachStep) => !!s.show && [...p.keys].some((k) => s.show!.test(k));
  const checked = done.filter((d) => pattern.steps.some((s) => s.id === d)).length;

  return (
    <div className="coach">
      <div className="coach-intro">
        <h3>Read it in order</h3>
        <p>
          Radiologists check every scan in the same order, so a second finding is not missed after the first. Go through each step and tick it when done.
          {pattern.steps.some(has) ? ' “Show me” outlines that step’s structures on the image.' : ''}
        </p>
      </div>
      <div className="coach-head">
        {patterns.length > 1 ? (
          <select value={pattern.id} onChange={(e) => setPid(e.target.value)} aria-label="Search pattern">
            {patterns.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        ) : (
          <b>{pattern.title}</b>
        )}
        <span className={`coach-count${checked === pattern.steps.length ? ' all' : ''}`}>
          {checked} of {pattern.steps.length} checked
        </span>
      </div>
      <div className="coach-bar" aria-hidden>
        <span style={{ width: `${(100 * checked) / pattern.steps.length}%` }} />
      </div>
      {p.activeStep ? (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={p.onClear}>
          Show all outlines again
        </button>
      ) : null}
      <div>
        {pattern.steps.map((s, i) => {
          const isDone = done.includes(s.id);
          return (
            <div key={s.id} className={`coach-step${isDone ? ' done' : ''}`}>
              <input type="checkbox" checked={isDone} onChange={() => toggle(s.id)} aria-label={`Checked: ${s.title}`} />
              <div>
                <b>
                  <span className="coach-n">{i + 1}</span> {s.title}
                </b>
                <ul>
                  {s.look.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <div className="row wrap" style={{ gap: 6 }}>
                  {has(s) ? (
                    <button
                      className={`btn sm${p.activeStep === s.id ? ' primary' : ''}`}
                      disabled={!p.canShow}
                      title={p.canShow ? 'Outline these structures on the scan' : 'Labels open in Learn mode, or after you submit'}
                      onClick={() => p.onShow(s)}
                    >
                      <Eye size={13} /> Show me
                    </button>
                  ) : null}
                  {s.window && p.family === 'CT' ? (
                    <button className="btn sm ghost" disabled={!p.canWindow} onClick={() => p.onWindow(s)}>
                      <Contrast size={13} /> {s.window} window
                    </button>
                  ) : null}
                  {s.page && p.onBook ? (
                    <button className="btn sm ghost" onClick={() => p.onBook!(s.page!, pattern.unit)}>
                      <BookOpen size={13} /> Book
                    </button>
                  ) : null}
                  {isDone ? <Check size={14} className="coach-ok" aria-hidden /> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Link to={`/course/${pattern.unit}`} className="coach-book">
        Where the book teaches this order
      </Link>
    </div>
  );
}
