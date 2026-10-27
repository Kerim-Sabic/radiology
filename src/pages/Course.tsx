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
          <div>
            <h1>
              {unit.kind === 'chapter' ? `Chapter ${unit.number}` : `Appendix ${unit.number}`} · {unit.title}
            </h1>
            <small className="faint">
              Printed pp. {unit.printedRange[0]}–{unit.printedRange[1]} · PDF {unit.physicalRange[0]}–{unit.physicalRange[1]} · Learning Radiology, 5th ed.
            </small>
          </div>
          <div className="row wrap">
            <Link className="btn sm primary" to={`/book/${unit.physicalRange[0]}`}>
              <BookOpen size={13} /> Read this {unit.kind === 'chapter' ? 'chapter' : 'appendix'} ({Math.round(readingProgress.fraction(unit.physicalRange) * 100)}% opened)
            </Link>
            <Link className="btn sm" to={`/book/figures?unit=${unit.id}`}>
              Figures ({unit.figureCount ?? 0})
            </Link>
            <span className="chip">{unit.objectives.length} objectives</span>
            <span className={`chip ${cov.covered ? 'ok' : 'warn'}`}>{cov.covered} with real-scan tasks</span>
            <span className="chip">{cov.patients} patients</span>
            <span className="chip">{cov.scored} reference-scored tasks</span>
            {unit.caseQuiz?.question ? (
              <button className="chip" onClick={() => setAnchor({ physical: unit.caseQuiz!.question!.physical, printed: unit.caseQuiz!.question!.printed, chapterId: unit.id })}>
                <BookOpen size={11} /> Chapter case quiz
              </button>
            ) : null}
            {unit.takeHome ? (
              <button className="chip" onClick={() => setAnchor({ physical: unit.takeHome!.physical, printed: unit.takeHome!.printed, chapterId: unit.id })}>
                <BookOpen size={11} /> Take-home points
              </button>
            ) : null}
          </div>
          {cov.uncovered.length ? (
            <div className="notice">
              {cov.uncovered.length} objective(s) have no real-scan practice installed yet. They stay visible here as gaps (book learning only) rather than being hidden.
            </div>
          ) : null}
          {unit.objectives.map((o) => {
            const tasks = cov.tasks.filter((t) => t.objectiveIds.includes(o.id));
            const st = byObjective(attempts, o.id);
            return (
              <article key={o.id} className="card stack" style={{ gap: 8 }}>
                <div className="row wrap">
                  <span className="mono faint">{o.id}</span>
                  <span className={`chip ${st.state === 'provisional_independent' ? 'ok' : st.state === 'not_started' ? '' : 'accent'}`} title={MILESTONE_RULE}>
                    {STATE_LABEL[st.state]}
                  </span>
                  {o.scanNeed ? <span className={`chip ${o.scanNeed.feasibility === 'open_tcia' ? '' : 'warn'}`}>{o.scanNeed.feasibility.replace(/_/g, ' ')}</span> : null}
                </div>
                <div className="grid-3" style={{ gap: 10 }}>
                  <div>
                    <b>See</b>
                    <p className="muted">{o.see}</p>
                  </div>
                  <div>
                    <b>Show</b>
                    <p className="muted">{o.show}</p>
                  </div>
                  <div>
                    <b>Explain</b>
                    <p className="muted">{o.explain}</p>
                  </div>
                </div>
                {o.contrastWith ? <small className="muted">Distinguish from: {o.contrastWith}</small> : null}
                <div className="row wrap">
                  {o.anchors.map((a, i) => (
                    <button key={i} className="chip" onClick={() => setAnchor({ physical: a.physical, printed: a.printed, chapterId: unit.id, figureId: a.figureId ?? null })}>
                      <BookOpen size={11} /> p. {a.printed ?? '?'}
                      {a.figureId ? ` · ${a.figureId}` : ''}
                    </button>
                  ))}
                </div>
                {tasks.length ? (
                  <div className="row wrap">
                    {tasks.slice(0, 8).map((t) => (
                      <Link key={t.id} className="btn sm" to={`/read/${t.caseId}?task=${encodeURIComponent(t.id)}&mode=practice`}>
                        {catalog?.cases.get(t.caseId)?.neutralTitle} · {t.type.replace(/_/g, ' ')}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <small className="faint">No installed real-scan task yet{o.scanNeed?.description ? ` — needs: ${o.scanNeed.description}` : ''}.</small>
                )}
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
          29 chapters and 8 appendices of <i>Learning Radiology: Recognizing the Basics</i>, 5th edition. A unit is never marked mastered from reading or quizzes alone — only from
          performance on real scans across different patients.
        </p>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Unit</th>
              <th className="cov-cell">Read</th>
              <th className="cov-cell">Objectives</th>
              <th className="cov-cell">Figures</th>
              <th className="cov-cell">Objectives with real-scan tasks</th>
              <th className="cov-cell">Patients</th>
              <th className="cov-cell">Scored tasks</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {totals.map(({ u, cov }) => (
              <tr key={u.id}>
                <td>
                  <Link to={`/course/${u.id}`}>
                    {u.kind === 'chapter' ? u.number : `App ${u.number}`} · {u.title}
                  </Link>
                </td>
                <td className="cov-cell">
                  <Link to={`/book/${u.physicalRange[0]}`}>{Math.round(readingProgress.fraction(u.physicalRange) * 100)}%</Link>
                </td>
                <td className="cov-cell">{u.objectives.length}</td>
                <td className="cov-cell">{u.figureCount ?? '–'}</td>
                <td className="cov-cell">
                  {cov.covered}/{u.objectives.length}
                </td>
                <td className="cov-cell">{cov.patients}</td>
                <td className="cov-cell">{cov.scored}</td>
                <td>
                  <small className="faint">
                    {cov.uncovered.length
                      ? `${cov.uncovered.length} uncovered${cov.feasibility.credentialed ? ` · ${cov.feasibility.credentialed} need credentialed data` : ''}${cov.feasibility.not_dicom || cov.feasibility.book_only ? ` · ${(cov.feasibility.not_dicom ?? 0) + (cov.feasibility.book_only ?? 0)} book-only` : ''}`
                      : 'covered'}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
