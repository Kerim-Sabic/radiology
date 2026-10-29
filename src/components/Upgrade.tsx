import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarDays, Check, Lock, LockOpen } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { caseOfWeek, FREE_CASES } from '../content/weekly';
import { LANDING_FACTS } from '../auth/landingFacts';
import { modalityName, useTeaser, type TeaserCase } from '../services/teaser';
import '../styles/upgrade.css';

const readUrl = (caseId: string, taskId: string, mode = 'learn') => `/read/${caseId}?task=${encodeURIComponent(taskId)}&mode=${mode}`;

/** A slim line under the top bar for free accounts: what they have, and the way to everything else. */
export function FreeBanner() {
  const { free, openPlans } = useApp();
  if (!free) return null;
  return (
    <div className="free-banner" role="note">
      <span className="free-pill">Free account</span>
      <span className="free-banner-text">
        {FREE_CASES.length} sample patients are open.<span className="long"> Members read {LANDING_FACTS.patients}+ patients, the case of the week, drills and on-call shifts.</span>
      </span>
      <button className="free-banner-cta" onClick={openPlans}>
        See plans <ArrowRight size={14} />
      </button>
    </div>
  );
}

/** Full-page placeholder for a members-only area, saying what it is and what membership adds. */
export function LockedFeature({ icon, title, text, points }: { icon: ReactNode; title: string; text: string; points: string[] }) {
  const { openPlans } = useApp();
  return (
    <div className="page-inner locked-page">
      <div className="locked-card">
        <span className="locked-icon" aria-hidden="true">
          {icon}
          <span className="locked-badge">
            <Lock size={12} />
          </span>
        </span>
        <span className="locked-kicker">Members</span>
        <h1>{title}</h1>
        <p className="locked-lead">{text}</p>
        <ul className="locked-points">
          {points.map((p) => (
            <li key={p}>
              <Check size={15} /> {p}
            </li>
          ))}
        </ul>
        <div className="locked-actions">
          <button className="btn primary lg" onClick={openPlans}>
            See plans
          </button>
          <Link className="btn ghost lg" to="/cases">
            Open the free patients
          </Link>
        </div>
      </div>
    </div>
  );
}

/** An inline nudge for free accounts (Today, the library, after an answer). */
export function UpgradeCard({ title, text, compact }: { title: string; text: string; compact?: boolean }) {
  const { free, openPlans } = useApp();
  if (!free) return null;
  return (
    <section className={`upgrade-card${compact ? ' compact' : ''}`}>
      <span className="upgrade-ico" aria-hidden="true">
        <LockOpen size={18} />
      </span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
      <button className="btn primary" onClick={openPlans}>
        See plans
      </button>
    </section>
  );
}

/** This week's case: open for members, shown locked (neutral title only) to free accounts. */
export function CaseOfWeekCard() {
  const { catalog, attempts, free } = useApp();
  const w = caseOfWeek();
  const kase = catalog?.cases.get(w.caseId);
  const tasks = kase ? (catalog?.tasksByCase.get(kase.id) ?? []) : [];
  if (free) return <LockedCaseOfWeek caseId={w.caseId} endsAt={w.endsAt} />;
  if (!kase || !catalog || !tasks.length) return null;
  const done = new Set(attempts.filter((a) => a.caseId === kase.id && a.submittedAt).map((a) => a.taskId));
  const next = tasks.find((t) => !done.has(t.id)) ?? tasks[0];
  const daysLeft = Math.max(1, Math.ceil((w.endsAt.getTime() - Date.now()) / 86_400_000));
  const thumb = catalog.thumbnailUrl(kase.primarySeriesUid);
  const modality = modalityName(catalog.series.get(kase.primarySeriesUid)?.modality ?? '');
  return (
    <section className="cow" aria-label="Case of the week">
      <div className="cow-media">{thumb ? <img src={thumb} alt="" /> : <span />}</div>
      <div className="cow-body">
        <span className="cow-kicker">
          <CalendarDays size={14} /> Case of the week · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
        </span>
        <h2>{kase.neutralTitle}</h2>
        <p>
          {kase.clinicalContext ? `${kase.clinicalContext} ` : ''}
          {modality} · {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {done.size ? ` · ${done.size} done` : ''}
        </p>
        <Link className="btn primary" to={readUrl(kase.id, next.id, 'practice')}>
          {done.size >= tasks.length ? 'Review it' : done.size ? 'Continue' : 'Read it'} <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}

function LockedCaseOfWeek({ caseId, endsAt }: { caseId: string; endsAt: Date }) {
  const { openPlans } = useApp();
  const t = useTeaser(true).find((c) => c.id === caseId);
  const daysLeft = Math.max(1, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return (
    <section className="cow locked" aria-label="Case of the week">
      <div className="cow-media">
        <span className="cow-lock" aria-hidden="true">
          <Lock size={26} />
        </span>
      </div>
      <div className="cow-body">
        <span className="cow-kicker">
          <CalendarDays size={14} /> Case of the week · members · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
        </span>
        <h2>{t ? t.title : 'A new real patient every Monday'}</h2>
        <p>
          {t ? `${modalityName(t.modality)} · ${t.tasks} graded task${t.tasks === 1 ? '' : 's'}. ` : ''}Members read a new featured patient every Monday, with an email when it is out, and keep every earlier one.
        </p>
        <button className="btn primary" onClick={openPlans}>
          Unlock this week’s case
        </button>
      </div>
    </section>
  );
}

/** A members-only patient opened from a link: what it is, and the plans. */
export function LockedCase({ caseId }: { caseId: string }) {
  const { openPlans } = useApp();
  const teaser = useTeaser(true);
  const t: TeaserCase | undefined = teaser.find((c) => c.id === caseId);
  return (
    <div className="page-inner locked-page">
      <div className="locked-card">
        <span className="locked-icon" aria-hidden="true">
          <Lock size={26} />
        </span>
        <span className="locked-kicker">Members</span>
        <h1>{t ? t.title : 'This patient is for members'}</h1>
        <p className="locked-lead">
          {t ? `${modalityName(t.modality)} · ${t.tasks} graded task${t.tasks === 1 ? '' : 's'}. ` : ''}A plan opens this patient and the {LANDING_FACTS.patients}+ others, with the drills and on-call shifts.
        </p>
        <div className="locked-actions">
          <button className="btn primary lg" onClick={openPlans}>
            See plans
          </button>
          <Link className="btn ghost lg" to="/cases">
            Back to the free patients
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The rest of the library for a free account: every patient by neutral title, locked. */
export function LockedLibrary() {
  const { free, catalog, openPlans } = useApp();
  const teaser = useTeaser(free);
  if (!free || !teaser.length) return null;
  const open = new Set(catalog ? [...catalog.cases.keys()] : []);
  const weekly = caseOfWeek().caseId;
  // This week's case first, then the rest.
  const locked = teaser.filter((c) => !open.has(c.id)).sort((a, b) => Number(b.id === weekly) - Number(a.id === weekly));
  const byModality = new Map<string, number>();
  for (const c of locked) byModality.set(modalityName(c.modality), (byModality.get(modalityName(c.modality)) ?? 0) + 1);
  return (
    <section className="locked-library" aria-label="Members' library">
      <div className="locked-library-head">
        <div>
          <h2>
            <Lock size={18} /> {locked.length} more patients for members
          </h2>
          <p className="muted">{[...byModality.entries()].map(([m, n]) => `${n} ${m}`).join(' · ')}</p>
        </div>
        <button className="btn primary" onClick={openPlans}>
          Unlock all
        </button>
      </div>
      <ul className="locked-grid">
        {locked.map((c) => (
          <li key={c.id}>
            <button className="locked-tile" onClick={openPlans} title="Members only">
              <span className="locked-tile-mod">
                {modalityName(c.modality)}
                {c.id === weekly ? <em className="locked-tile-week"> · Case of the week</em> : null}
              </span>
              <b>{c.title.replace(/^Patient [A-Z]+ · /, '')}</b>
              <small>
                {c.tasks} task{c.tasks === 1 ? '' : 's'}
              </small>
              <Lock size={13} className="locked-tile-lock" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
