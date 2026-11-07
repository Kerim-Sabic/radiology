import { useState } from 'react';
import { ev } from '../services/ev';

/**
 * One question on the plans, for a free account: what would make it worth paying for. One tap, no free text (the event
 * log keeps no personal words), asked once per browser. Answers show in Admin → Journeys.
 */
export const WORTH_ANSWERS = [
  ['price', 'A lower price'],
  ['exam', 'Questions for my exam (NEET-PG, USMLE…)'],
  ['upi', 'Paying without a card (UPI…)'],
  ['cases', 'More cases in my subject'],
  ['looking', 'I’m just looking'],
] as const;
const KEY = 'rvm.survey.worth';

export function WorthSurvey() {
  const [done, setDone] = useState(() => {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  });
  const [thanks, setThanks] = useState(false);
  if (done && !thanks) return null;
  const answer = (a: string) => {
    ev('survey', { q: 'plans_worth', a }, true);
    try {
      localStorage.setItem(KEY, a);
    } catch {
      /* asked again next time */
    }
    setDone(true);
    setThanks(true);
  };
  return (
    <section className="worth-survey" aria-label="One question">
      {thanks ? (
        <p role="status">Thank you. That helps us decide what to build next.</p>
      ) : (
        <>
          <p>One question: what would make it worth paying for?</p>
          <div className="worth-answers">
            {WORTH_ANSWERS.map(([key, label]) => (
              <button key={key} type="button" className="chip" onClick={() => answer(key)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
