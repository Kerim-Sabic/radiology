/**
 * Matching two DIFFERENT patients at the same anatomical level. Patients differ in height and in
 * where the scanner put them, so millimetres cannot be compared directly. Instead every structure
 * labelled on both scans (vertebrae best, organs and vessels too) becomes a landmark pair, and a
 * level in one scan is mapped to the other by interpolating between the nearest landmarks.
 */
import type { LoadedTarget } from '../grading/spatialGrader';
import type { SeriesIndex } from '../grading/seriesIndex';
import { canonicalAnatomyKey } from '../content/bookAnatomy';

export interface Landmark {
  key: string;
  lo: number;
  hi: number;
  mid: number;
}

/** Head–foot extent (patient z in mm, + = towards the head) of each labelled structure. */
export function landmarks(targets: LoadedTarget[], idx: SeriesIndex | undefined): Map<string, Landmark> {
  const out = new Map<string, Landmark>();
  for (const t of targets) {
    const g = t.geom;
    if (g.geometryType !== 'contour_set' || !g.planes.length) continue;
    const zs: number[] = [];
    for (const pl of g.planes) {
      const ipp = idx?.bySop.get(pl.sopInstanceUid)?.plane?.ipp;
      if (ipp) zs.push(ipp[2]);
      else if (g.space === 'patient_lps_mm' && pl.polygons[0]?.[0]) zs.push((pl.polygons[0][0] as number[])[2]);
    }
    if (!zs.length) continue;
    const key = canonicalAnatomyKey(t.ref.classId);
    const lo = Math.min(...zs);
    const hi = Math.max(...zs);
    out.set(key, { key, lo, hi, mid: (lo + hi) / 2 });
  }
  return out;
}

/**
 * Landmark pairs (z in A, z in B) for structures on both scans, ordered head to foot and kept
 * consistent: pairs that would make the mapping run backwards are dropped (longest increasing run).
 */
export function matchLevels(a: Map<string, Landmark>, b: Map<string, Landmark>): Array<[number, number]> {
  const pairs = [...a.values()]
    .filter((l) => b.has(l.key))
    .map((l) => [l.mid, b.get(l.key)!.mid] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  if (pairs.length < 2) return pairs;
  const len = pairs.map(() => 1);
  const prev = pairs.map(() => -1);
  for (let i = 0; i < pairs.length; i++)
    for (let j = 0; j < i; j++)
      if (pairs[j][1] < pairs[i][1] && pairs[j][0] < pairs[i][0] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
  let end = len.indexOf(Math.max(...len));
  const keep: Array<[number, number]> = [];
  while (end >= 0) {
    keep.unshift(pairs[end]);
    end = prev[end];
  }
  return keep;
}

/** Map a z level in scan A to scan B; outside the landmarks, keep the offset of the nearest one. */
export function mapZ(z: number, pairs: Array<[number, number]>): number | null {
  if (!pairs.length) return null;
  if (z <= pairs[0][0]) return z + pairs[0][1] - pairs[0][0];
  const last = pairs[pairs.length - 1];
  if (z >= last[0]) return z + last[1] - last[0];
  for (let i = 0; i < pairs.length - 1; i++) {
    const [a0, b0] = pairs[i];
    const [a1, b1] = pairs[i + 1];
    if (z >= a0 && z <= a1) return b0 + ((z - a0) / (a1 - a0 || 1)) * (b1 - b0);
  }
  return null;
}

/** Vertebral level at z, e.g. "T8", when vertebrae are labelled. */
export function levelName(z: number, marks: Map<string, Landmark>): string | null {
  let best: Landmark | null = null;
  for (const l of marks.values()) {
    if (!/^[ctl]\d+_vertebra$|^sacrum$/.test(l.key) || z < l.lo - 2 || z > l.hi + 2) continue;
    if (!best || Math.abs(z - l.mid) < Math.abs(z - best.mid)) best = l;
  }
  if (!best) return null;
  return best.key === 'sacrum' ? 'sacrum' : best.key.replace('_vertebra', '').toUpperCase();
}
