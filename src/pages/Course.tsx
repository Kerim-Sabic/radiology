import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BookOpen, ChevronLeft } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { BookPanel } from '../components/ws/BookPanel';
import type { Unit } from '../services/curriculum';
import type { Catalog } from '../services/caseRepository';
import { byObjective, STATE_LABEL, MILESTONE_RULE } from '../services/learningModel';
import { readingProgress } from '../book/readingProgress';
import type { BookAnchorRef } from '../schema/content';
import { taskTypeLabel } from '../lib/taskTypes';

export function unitCoverage(u: Unit, catalog: Catalog | null) {
  const objIds = new Set(u.objectives.map((o) => o.id));
  const tasks = catalog ? [...catalog.tasks.values()].filter((t) => t.objectiveIds.some((o) => objIds.has(o))) : [];
  const cases = new Set(tasks.map((t) => t.caseId));
  const patients = new Set([...cases].map((c) => catalog!.holdoutGroup(c)));
  const scored = tasks.filter((t) => t.scoring === 'authoritative');
  const covered = new Set(tasks.flatMap((t) => t.objectiveIds).filter((o) => objIds.has(o)));
  const feasibility = u.objectives.reduce<Record<string, number>>((acc, o) => {
    const f = o.scanNeed?.feasibility ?? 'unknown';
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});
  return { tasks, cases: cases.size, patients: patients.size, scored: scored.length, covered: covered.size, uncovered: u.objectives.filter((o) => !covered.has(o.id)), feasibility };
}

export default function CoursePage() {
  const { unitId } = useParams();
  const { curriculum, catalog, attempts } = useApp();
  const [anchor, setAnchor] = useState<BookAnchorRef | null>(null);
  if (!curriculum) return <div className="page-inner">Loading curriculum…</div>;
  if (!curriculum.file)
    return (
      <div className="page-inner stack">
        <h1>Course</h1>
        <div className="notice bad">The curriculum file could not be loaded. {curriculum.errors.join(' ')}</div>
      </div>
    );
  const units = curriculum.file.units;
  const unit = unitId ? curriculum.unitById.get(unitId) : null;

  if (unit) {
    const cov = unitCoverage(unit, catalog);
    return (
      <div className="page-inner" style={{ display: 'grid', gridTemplateColumns: anchor ? 'minmax(0,1fr) 420px' : '1fr', gap: 20 }}>
        <div className="stack" style={{ gap: 16 }}>
          <Link to="/course" className="row faint">
            <ChevronLeft size={14} /> All units
          </Link>
          <header className="unit-head">
            <h1>
              {unit.kind === 'chapter' ? `Chapter ${unit.number}` : `Appendix ${unit.number}`} · {unit.title}
            </h1>
            <p className="muted">
              Pages {unit.printedRange[0]}–{unit.printedRange[1]} of <i>Learning Radiology</i> · {unit.objectives.length} objectives · {cov.covered} practised on real scans ·{' '}
              {cov.patients} patient{cov.patients === 1 ? '' : 's'}
            </p>
          </header>
          <div className="unit-actions">
            <Link className="btn primary" to={`/book/${unit.physicalRange[0]}`}>
              <BookOpen size={15} /> Read the {unit.kind === 'chapter' ? 'chapter' : 'appendix'}
              {readingProgress.fraction(unit.physicalRange) > 0 ? ` (${Math.round(readingProgress.fraction(unit.physicalRange) * 100)}% read)` : ''}
            </Link>
            <Link className="btn" to={`/book/figures?unit=${unit.id}`}>
              Figures ({unit.figureCount ?? 0})
            </Link>
            {unit.caseQuiz?.question ? (
              <button className="btn" onClick={() => setAnchor({ physical: unit.caseQuiz!.question!.physical, printed: unit.caseQuiz!.question!.printed, chapterId: unit.id })}>
                Case quiz
              </button>
            ) : null}
            {unit.takeHome ? (
              <button className="btn" onClick={() => setAnchor({ physical: unit.takeHome!.physical, printed: unit.takeHome!.printed, chapterId: unit.id })}>
                Take-home points
              </button>
            ) : null}
          </div>
          {unit.objectives.map((o, i) => {
            const tasks = cov.tasks.filter((t) => t.objectiveIds.includes(o.id));
            // One link per patient (to that patient's first task here), not one per task.
            const byCase = new Map<string, typeof tasks>();
            for (const t of tasks) byCase.set(t.caseId, [...(byCase.get(t.caseId) ?? []), t]);
            const st = byObjective(attempts, o.id);
            return (
              <article key={o.id} className="unit-obj">
                <div className="unit-obj-head">
                  <span className="unit-obj-n">{i + 1}</span>
                  {st.state === 'not_started' ? null : (
                    <span className={`chip ${st.state === 'provisional_independent' ? 'ok' : 'accent'}`} title={MILESTONE_RULE}>
                      {STATE_LABEL[st.state]}
                    </span>
                  )}
                </div>
                <div className="unit-obj-cols">
                  <div>
                    <b>See</b>
                    <p>{o.see}</p>
                  </div>
                  <div>
                    <b>Show</b>
                    <p>{o.show}</p>
                  </div>
                  <div>
                    <b>Explain</b>
                    <p>{o.explain}</p>
                  </div>
                </div>
                {o.contrastWith ? <p className="unit-obj-contrast">Tell it apart from: {o.contrastWith}</p> : null}
                <div className="unit-obj-links">
                  {o.anchors.map((a, j) => (
                    <button key={j} className="unit-link" onClick={() => setAnchor({ physical: a.physical, printed: a.printed, chapterId: unit.id, figureId: a.figureId ?? null })}>
                      <BookOpen size={13} aria-hidden /> p. {a.printed ?? '?'}
                      {a.figureId ? ` · ${a.figureId}` : ''}
                    </button>
                  ))}
                  {[...byCase.entries()].slice(0, 6).map(([caseId, ts]) => {
                    const title = catalog?.cases.get(caseId)?.neutralTitle ?? caseId;
                    return (
                      <Link
                        key={caseId}
                        className="unit-link scan"
                        to={`/read/${caseId}?task=${encodeURIComponent(ts[0].id)}&mode=practice`}
                        title={ts.map((t) => taskTypeLabel(t.type)).join(', ')}
                      >
                        {title.split(' · ')[0]}
                      </Link>
                    );
                  })}
                  {tasks.length ? null : <span className="faint unit-none">No scan to practise this on yet.</span>}
                </div>
              </article>
            );
          })}
        </div>
        {anchor ? (
          <aside className="card" style={{ position: 'sticky', top: 12, alignSelf: 'start', maxHeight: 'calc(100vh - 90px)', overflow: 'auto' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <b>Book</b>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setAnchor(null)}>
                Close
              </button>
            </div>
            <BookPanel curriculum={curriculum} anchor={anchor} />
          </aside>
        ) : null}
      </div>
    );
  }

  const totals = units.map((u) => ({ u, cov: unitCoverage(u, catalog) }));
  return (
    <div className="page-inner stack" style={{ gap: 16 }}>
      <div>
        <h1>Course map</h1>
        <p className="muted">
          The 29 chapters and 8 appendices of <i>Learning Radiology: Recognizing the Basics</i>, 5th edition. A chapter counts as learned only from your answers on real scans
          of different patients, never from reading alone.
        </p>
      </div>
      {(['chapter', 'appendix'] as const).map((kind) => {
        const rows = totals.filter(({ u }) => (kind === 'chapter') === (u.kind === 'chapter'));
        if (!rows.length) return null;
        return (
          <section key={kind} className="course-group">
            <h2>{kind === 'chapter' ? 'Chapters' : 'Appendices'}</h2>
            <ol className="course-list">
              {rows.map(({ u, cov }) => {
                const read = Math.round(readingProgress.fraction(u.physicalRange) * 100);
                const share = u.objectives.length ? cov.covered / u.objectives.length : 0;
                const gap = cov.uncovered.length
                  ? `${cov.uncovered.length} objective${cov.uncovered.length === 1 ? '' : 's'} without a real-scan task yet${cov.feasibility.credentialed ? `, ${cov.feasibility.credentialed} needing credentialed data` : ''}${cov.feasibility.not_dicom || cov.feasibility.book_only ? `, ${(cov.feasibility.not_dicom ?? 0) + (cov.feasibility.book_only ?? 0)} book-only` : ''}`
                  : 'Every objective has a real-scan task';
                return (
                  <li key={u.id} className="course-row">
                    <Link className="course-main" to={`/course/${u.id}`}>
                      <span className="course-num" aria-hidden>
                        {u.number}
                      </span>
                      <span className="course-text">
                        <b>
                          <span className="sr-only">{u.kind === 'chapter' ? `Chapter ${u.number}: ` : `Appendix ${u.number}: `}</span>
                          {u.title}
                        </b>
                        <small>
                          {u.objectives.length} objectives · {cov.patients} patient{cov.patients === 1 ? '' : 's'} · {cov.scored} scored task{cov.scored === 1 ? '' : 's'}
                          {u.figureCount ? ` · ${u.figureCount} figures` : ''}
                        </small>
                      </span>
                    </Link>
                    <span className="course-cov" title={gap}>
                      <span className="course-cov-bar" role="img" aria-label={`${cov.covered} of ${u.objectives.length} objectives practised on real scans. ${gap}.`}>
                        <span style={{ width: `${Math.round(share * 100)}%` }} />
                      </span>
                      <small>
                        {cov.covered}/{u.objectives.length} on real scans
                      </small>
                    </span>
                    <Link className="course-read" to={`/book/${u.physicalRange[0]}`} aria-label={`Read in the book: ${read}% read`}>
                      {read ? `${read}% read` : 'Read'}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
