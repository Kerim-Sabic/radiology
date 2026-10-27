/**
 * Accuracy guard over the REAL installed labels: every left/right pair of outlines on a series must lie on
 * the correct side of the patient, and every image-space outline must lie inside its image. A swapped side is
 * the most harmful labelling error, so this runs for expert and "AI draft by Horalix" labels alike.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PackManifest, TargetGeometry, type PackManifest as TPack } from '../src/schema/content';

const PACKS = join(__dirname, '..', 'public', 'packs');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const packs: Array<[string, TPack]> = readdirSync(PACKS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'pack.json')))
  .map((d) => [d.name, PackManifest.parse(read(join(PACKS, d.name, 'pack.json')))]);
const allSeries = new Map(packs.flatMap(([, p]) => p.series.map((s) => [s.uid, s] as const)));

const SIDE = /(^|_)(left|right)(?=$|_)/;
type Series = TPack['series'][number];

/** Signed position towards the patient's LEFT for an image-space point, or null when the image has no usable orientation. */
function towardsLeft(series: Series, sop: string, px: [number, number]): number | null {
  const inst = series.instances.find((i) => i.sopInstanceUid === sop);
  const g = series.geometry;
  if (inst?.ipp && g.iop && g.pixelSpacing) {
    const [rowSp, colSp] = g.pixelSpacing;
    // LPS: +x is the patient's left.
    return inst.ipp[0] + g.iop[0] * px[0] * colSp + g.iop[3] * px[1] * rowSp;
  }
  const po = String((series.acquisition as Record<string, unknown> | undefined)?.PatientOrientation ?? '').split('\\');
  if (po[0] === 'L') return px[0];
  if (po[0] === 'R') return -px[0];
  return null;
}

function meanLeft(series: Series, geom: ReturnType<typeof TargetGeometry.parse>): number | null {
  if (geom.geometryType !== 'contour_set') return null;
  let sum = 0;
  let n = 0;
  for (const pl of geom.planes) {
    for (const poly of pl.polygons) {
      for (let i = 0; i < poly.length; i += 4) {
        const v = geom.space === 'image_px' ? towardsLeft(series, pl.sopInstanceUid, poly[i] as [number, number]) : (poly[i] as number[])[0];
        if (v === null) return null;
        sum += v;
        n++;
      }
    }
  }
  return n ? sum / n : null;
}

for (const [id, pack] of packs) {
  const lateral = pack.referenceTargets.filter((t) => t.geometryType === 'contour_set' && SIDE.test(t.classId.replace(/^anatomy:/, '')));
  if (!lateral.length) continue;
  describe(`laterality · ${id}`, () => {
    const bySeries = new Map<string, Map<string, { left?: (typeof lateral)[number]; right?: (typeof lateral)[number] }>>();
    for (const t of lateral) {
      const key = t.classId.replace(SIDE, '$1X');
      const side = SIDE.exec(t.classId.replace(/^anatomy:/, ''))![2] as 'left' | 'right';
      const m = bySeries.get(t.seriesUid) ?? new Map();
      m.set(key, { ...(m.get(key) ?? {}), [side]: t });
      bySeries.set(t.seriesUid, m);
    }
    it('left structures lie to the patient’s left of their right-sided partners', () => {
      let checked = 0;
      const wrong: string[] = [];
      for (const [uid, pairs] of bySeries) {
        const series = allSeries.get(uid);
        if (!series) continue;
        for (const [key, { left, right }] of pairs) {
          if (!left || !right) continue;
          const l = meanLeft(series, TargetGeometry.parse(read(join(PACKS, id, left.geometryFile))));
          const r = meanLeft(series, TargetGeometry.parse(read(join(PACKS, id, right.geometryFile))));
          if (l === null || r === null) continue;
          checked++;
          if (!(l > r)) wrong.push(`${key} on ${series.description || uid}`);
        }
      }
      expect(wrong, `swapped sides: ${wrong.join(', ')}`).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });
    it('image-space outlines stay inside their image', () => {
      const outside: string[] = [];
      for (const t of lateral) {
        const series = allSeries.get(t.seriesUid);
        if (!series) continue;
        const g = TargetGeometry.parse(read(join(PACKS, id, t.geometryFile)));
        if (g.geometryType !== 'contour_set' || g.space !== 'image_px') continue;
        const { rows, columns } = series.geometry;
        const bad = g.planes.some((pl) => pl.polygons.some((poly) => (poly as number[][]).some(([c, r]) => c < -1 || r < -1 || c > columns || r > rows)));
        if (bad) outside.push(t.id);
      }
      expect(outside).toEqual([]);
    });
  });
}
