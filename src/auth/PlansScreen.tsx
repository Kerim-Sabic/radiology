import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Award, BookOpen, CalendarDays, Check, Layers, LogOut, Repeat, Siren } from 'lucide-react';
import { fact, LANDING_FACTS } from './landingFacts';

const UNLOCKS: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <Layers size={18} />,
    title: `${fact(LANDING_FACTS.patients)}+ real patients`,
    text: `CT, MRI, X-ray, mammography and ultrasound, with ${fact(LANDING_FACTS.tasks)}+ tasks graded against the expert outline.`,
  },
  {
    icon: <Repeat size={18} />,
    title: 'Drills that remember',
    text: 'Anatomy and findings on every patient; what you miss comes back on a different one until you know it.',
  },
  {
    icon: <Siren size={18} />,
    title: 'On-call shifts',
    text: 'A run of unknown cases, no hints, an optional clock and a scored report at the end.',
  },
  {
    icon: <CalendarDays size={18} />,
    title: 'Every case of the week',
    text: 'This week’s and all the earlier ones, with a reminder email on Mondays if you want it.',
  },
  {
    icon: <Award size={18} />,
    title: 'Certificates',
    text: 'A certificate with a public check link for each body area you complete.',
  },
  {
    icon: <BookOpen size={18} />,
    title: 'The book, page by page',
    text: 'Every task opens the page of Learning Radiology that explains it, in your own copy (included for SSST students).',
  },
];

/** The plans for a signed-in account without one: what membership unlocks, and the checkout panel. */
export function PlansScreen({ panel, email, onClose, onSignOut }: { panel: ReactNode; email: string; onClose: () => void; onSignOut: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div ref={root} tabIndex={-1} className="plans-screen lp" role="dialog" aria-modal="true" aria-labelledby="plans-title">
      <header className="plans-top">
        <button className="plans-back" onClick={onClose}>
          <ArrowLeft size={16} /> Back<span className="plans-back-long"> to the app</span>
        </button>
        <span className="plans-brand">
          <img src="/logo-mark.svg" alt="" width={20} height={21} />
          {'radiology'}
          <span>.monster</span>
        </span>
        <span className="plans-who">
          <span>{email}</span>
          <button className="plans-signout" onClick={onSignOut} title="Sign out">
            <LogOut size={15} />
          </button>
        </span>
      </header>
      <div className="plans-body">
        <section className="plans-value" aria-labelledby="plans-title">
          <span className="lp-kicker">Membership</span>
          <h1 id="plans-title">
            You have seen the workstation.
            <br />
            <em>Now read everything.</em>
          </h1>
          <p className="plans-now">
            <Check size={15} /> Your free account: two sample patients in the full workstation.
          </p>
          <ul className="plans-unlocks">
            {UNLOCKS.map((u) => (
              <li key={u.title}>
                <span className="plans-ico" aria-hidden="true">
                  {u.icon}
                </span>
                <div>
                  <b>{u.title}</b>
                  <p>{u.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <div className="plans-panel">{panel}</div>
      </div>
    </div>
  );
}
