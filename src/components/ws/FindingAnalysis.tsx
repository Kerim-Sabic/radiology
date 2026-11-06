/**
 * Finding analysis: size, extent, volume and place of each finding the dataset's experts outlined on this case, measured on
 * their outline. Shown only when the reference is visible (Learn mode, Review, after submitting). The place comes from the
 * anatomy layer and says when that layer is an unreviewed AI outline.
 */
import { useMemo } from 'react';
import { Ruler } from 'lucide-react';
import { findingMetrics, findingPlace, type FindingMetrics } from '../../grading/findingMetrics';
import type { SeriesIndex } from '../../grading/seriesIndex';
import type { LoadedTarget } from '../../grading/spatialGrader';
import { cleanLabel as cleanName } from '../../lib/provenance';

const f1 = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

export function FindingAnalysis(p: {
  findings: LoadedTarget[];
  anatomy: LoadedTarget[];
  seriesIndex: (uid: string) => SeriesIndex | undefined;
  imageOf: (seriesUid: string, sop: string) => { index: number; count: number } | null;
  onGoTo: (t: LoadedTarget, sop: string) => void;
}) {
  const rows = useMemo(
    () =>
      p.findings
        .map((t) => {
          const s = p.seriesIndex(t.ref.seriesUid);
          const m = findingMetrics(t, s);
          return m ? { t, m, place: findingPlace(m, t.ref.seriesUid, p.anatomy, s) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [p.findings, p.anatomy, p], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!rows.length) return null;
  const totalMl = rows.reduce((a, r) => a + (r.m.volumeMl ?? 0), 0);
  return (
    <section className="card finding-analysis" aria-label="Finding analysis">
      <h3>
        <Ruler size={14} /> Finding analysis
      </h3>
      <p className="faint">Measured on the outline drawn by the dataset's experts.</p>
      {rows.length > 1 ? (
        <p>
          <b>{rows.length} findings</b>
          {totalMl > 0 ? ` · ${f1(totalMl)} ml in all` : ''}
        </p>
      ) : null}
      {rows.map(({ t, m, place }) => (
        <div key={t.ref.id} className="fa-item">
          <b>{cleanName(t.ref.label)}</b>
          <dl>
            <Size m={m} img={m.largestSop ? p.imageOf(t.ref.seriesUid, m.largestSop) : null} />
            {m.throughPlane !== null ? (
              <>
                <dt>Extent</dt>
                <dd>
                  {m.images} {m.images === 1 ? 'image' : 'images'} · about {f1(m.throughPlane)} mm across the slices
                </dd>
              </>
            ) : null}
            {m.volumeMl !== null ? (
              <>
                <dt>Volume</dt>
                <dd>{m.volumeMl < 0.1 ? `${(m.volumeMl * 1000).toFixed(0)} mm³` : `${f1(m.volumeMl)} ml`}</dd>
              </>
            ) : null}
            {m.areaMm2 !== null ? (
              <>
                <dt>Area</dt>
                <dd>
                  {f1(m.areaMm2 / 100)} cm² on the film{m.calibrated ? '' : ' (not corrected for magnification)'}
                </dd>
              </>
            ) : null}
            {place && (place.inside.length || place.near.length) ? (
              <>
                <dt>Where</dt>
                <dd>
                  {place.inside.length ? <>in the {place.inside.map((x) => cleanName(x.label).toLowerCase()).join(' and ')}</> : null}
                  {place.inside.length && place.near.length ? '; ' : ''}
                  {place.near.length ? <>next to the {place.near.map((x) => `${cleanName(x.label).toLowerCase()} (${f1(x.mm)} mm)`).join(', ')}</> : null}
                  {[...place.inside, ...place.near].some((x) => x.ai) ? <span className="faint"> · from the AI anatomy layer, not reviewed</span> : null}
                </dd>
              </>
            ) : null}
          </dl>
          {m.largestSop ? (
            <button className="btn sm" onClick={() => p.onGoTo(t, m.largestSop!)}>
              Show its largest image
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Size({ m, img }: { m: FindingMetrics; img: { index: number; count: number } | null }) {
  if (m.longAxis === null) return null;
  const u = m.unit === 'mm' ? 'mm' : 'px';
  return (
    <>
      <dt>Size</dt>
      <dd>
        {f1(m.longAxis)} × {f1(m.shortAxis ?? 0)} {u} (longest diameter × widest across it)
        {img && img.count > 1 ? `, largest on image ${img.index + 1} of ${img.count}` : ''}
        {m.unit === 'mm' && !m.calibrated ? ' · pixel size not corrected for magnification' : ''}
      </dd>
    </>
  );
}
