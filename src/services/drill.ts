/**
 * Anatomy drills built from the labels: point to a structure, find its level, name an outline,
 * pick the right window. Spaced repetition per structure (Leitner boxes), and a missed structure
 * comes back on a DIFFERENT patient. Pure logic — the Drill page does the viewing.
 */
import type { Catalog } from './caseRepository';
import type { LoadedTarget } from '../grading/spatialGrader';
import { canonicalAnatomyKey, imageFamily } from '../content/bookAnatomy';
import { noteFor, structureBase, type WindowName } from '../content/structureNotes';
import { categoryFor } from '../components/ws/overlayShapes';
import { isAutomatic, plainName } from '../lib/provenance';
import type { Vec2 } from '../lib/geometry';

export type DrillKind = 'locate' | 'find' | 'name' | 'window';
export const KIND_LABEL: Record<DrillKind, string> = {
  locate: 'Point to it',
  find: 'Find its level',
  name: 'Name the outline',
  window: 'Best window',
};

export interface DrillCandidate {
  caseId: string;
  targetId: string;
  seriesUid: string;
  key: string; // canonical, side kept: "adrenal_left"
  base: string; // side and number removed: "adrenal"
  name: string;
  family: 'XR' | 'CT' | 'MR' | 'other';
  provenance: string;
  category: string;
}

export interface DrillStat {
  key: string;
  name: string;
  seen: number;
  correct: number;
  box: number; // 0 = learning; 5 = long-term
  due: string;
  lastAt: string;
  lastCase: string | null;
  misses: number;
}
export type DrillStats = Record<string, DrillStat>;

const CHEST = /^(trachea|main_bronchus|lung|hilum|mediastinum|heart|atrial_appendage|aorta$|aorta_(ascending|arch|descending_thoracic)|pulmonary|superior_vena_cava|brachiocephalic|common_carotid|subclavian|esophagus|thyroid|thymus|rib|sternum|costal|clavicle|scapula|thoracic_vertebra|breast|diaphragm|humerus|spine)/;
const ABDOMEN = /^(liver|gallbladder|spleen|pancreas|kidney|adrenal|stomach|duodenum|small_bowel|colon|rectum|bladder|prostate|uterus|gonads|aorta_abdominal|inferior_vena_cava|portal|iliac|iliopsoas|gluteus|autochthon|lumbar_vertebra|sacrum|hip|femur|femoral)/;

export interface Region {
  id: string;
  label: string;
  test: (c: DrillCandidate) => boolean;
}
export const REGIONS: Region[] = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: 'chest_ct', label: 'Chest CT', test: (c) => c.family === 'CT' && CHEST.test(c.base) },
  { id: 'abdomen_ct', label: 'Abdomen & pelvis CT', test: (c) => c.family === 'CT' && ABDOMEN.test(c.base) },
  { id: 'vessels', label: 'Heart & vessels', test: (c) => c.category === 'vessel' },
  { id: 'bones', label: 'Bones', test: (c) => c.category === 'bone' },
  { id: 'chest_xr', label: 'Chest X-ray', test: (c) => c.family === 'XR' },
  { id: 'mri', label: 'MRI', test: (c) => c.family === 'MR' },
];

/** Every labelled structure on every installed scan (manifests only; nothing is downloaded). */
export function buildPool(catalog: Catalog): DrillCandidate[] {
  const out: DrillCandidate[] = [];
  const seen = new Set<string>();
  for (const k of catalog.cases.values()) {
    const series = catalog.seriesForCase(k).filter((s) => catalog.seriesSource(s.uid));
    for (const id of catalog.anatomyTargetsForSeries(series.map((s) => s.uid))) {
      if (seen.has(id)) continue;
      const t = catalog.targets.get(id);
      if (!t || t.geometryType !== 'contour_set') continue;
      seen.add(id);
      const key = canonicalAnatomyKey(t.classId);
      out.push({
        caseId: k.id,
        targetId: id,
        seriesUid: t.seriesUid,
        key,
        base: structureBase(key),
        name: plainName(t.label),
        family: imageFamily(catalog.series.get(t.seriesUid)?.modality ?? ''),
        provenance: t.provenance,
        category: categoryFor(t),
      });
    }
  }
  return out;
}

const DAY = 86400e3;
/** Days until the next review for each box. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35];

export function isDue(s: DrillStat | undefined, now: number): boolean {
  return !!s && Date.parse(s.due) <= now;
}

/** Record one answer. Correct moves the structure up a box; a miss sends it back to box 0 (asked again soon). */
export function recordAnswer(stats: DrillStats, c: DrillCandidate, correct: boolean, now = Date.now()): DrillStats {
  const prev = stats[c.key];
  const box = correct ? Math.min(BOX_DAYS.length - 1, (prev?.box ?? 0) + 1) : 0;
  const next: DrillStat = {
    key: c.key,
    name: c.name,
    seen: (prev?.seen ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
    box,
    due: new Date(now + (correct ? BOX_DAYS[box] * DAY : 10 * 60e3)).toISOString(),
    lastAt: new Date(now).toISOString(),
    lastCase: c.caseId,
    misses: (prev?.misses ?? 0) + (correct ? 0 : 1),
  };
  return { ...stats, [c.key]: next };
}

export interface PickOptions {
  region: string;
  kinds: DrillKind[];
  expertOnly: boolean;
  onlyKey?: string | null;
  /** Bases asked in the last few questions (avoid repeating). */
  recentBases: string[];
  /** Case of the previous question (prefer a different patient). */
  lastCase: string | null;
  now?: number;
  rng?: () => number;
}

export function eligible(pool: DrillCandidate[], o: Pick<PickOptions, 'region' | 'expertOnly' | 'onlyKey'>): DrillCandidate[] {
  const region = REGIONS.find((r) => r.id === o.region) ?? REGIONS[0];
  return pool.filter((c) => region.test(c) && (!o.expertOnly || !isAutomatic(c.provenance)) && (!o.onlyKey || c.key === o.onlyKey || c.base === o.onlyKey));
}

/** Priority of a structure for the next question: due reviews, then unseen, then weak, then the rest. */
export function priority(s: DrillStat | undefined, now: number): number {
  if (!s) return 2;
  if (isDue(s, now)) return 3 + Math.min(1, (now - Date.parse(s.due)) / (7 * DAY));
  if (s.seen >= 2 && s.correct / s.seen < 0.6) return 1.5;
  return 0.5;
}

export function kindsFor(c: DrillCandidate, wanted: DrillKind[]): DrillKind[] {
  return wanted.filter((k) => (k === 'find' ? c.family === 'CT' || c.family === 'MR' : k === 'window' ? c.family === 'CT' : true));
}

export function pickNext(pool: DrillCandidate[], stats: DrillStats, o: PickOptions): { cand: DrillCandidate; kind: DrillKind } | null {
  const now = o.now ?? Date.now();
  const rng = o.rng ?? Math.random;
  const list = eligible(pool, o).filter((c) => kindsFor(c, o.kinds).length);
  if (!list.length) return null;
  // Choose a structure family (base) first so 24 ribs do not crowd out the adrenals.
  const byBase = new Map<string, DrillCandidate[]>();
  for (const c of list) byBase.set(c.base, [...(byBase.get(c.base) ?? []), c]);
  const recent = new Set(o.recentBases.slice(-4));
  const scored = [...byBase.entries()].map(([base, cs]) => {
    const p = Math.max(...cs.map((c) => priority(stats[c.key], now)));
    return { base, cs, score: p - (recent.has(base) && byBase.size > 4 ? 2.5 : 0) + rng() * 0.9 };
  });
  scored.sort((a, b) => b.score - a.score);
  const { cs } = scored[0];
  // Within the base: the most urgent key, then a different patient from last time.
  const keyScore = (c: DrillCandidate) => priority(stats[c.key], now) + rng() * 0.5;
  const best = [...cs].sort((a, b) => keyScore(b) - keyScore(a))[0];
  const sameKey = cs.filter((c) => c.key === best.key);
  const avoid = new Set([stats[best.key]?.lastCase, o.lastCase].filter(Boolean));
  const fresh = sameKey.filter((c) => !avoid.has(c.caseId));
  const options = fresh.length ? fresh : sameKey;
  const cand = options[Math.floor(rng() * options.length)];
  const kinds = kindsFor(cand, o.kinds);
  return { cand, kind: kinds[Math.floor(rng() * kinds.length)] };
}

// ---------------------------------------------------------------- answers

const centre = (pl: number[][]) => [pl.reduce((a, q) => a + q[0], 0) / pl.length, pl.reduce((a, q) => a + q[1], 0) / pl.length];

/**
 * Wrong answers for "name the outline": the other-side twin first (laterality is a classic error),
 * then structures on the same slice nearest to it, then others from the same scan.
 */
export function distractors(target: LoadedTarget, all: LoadedTarget[], sop: string | null, n = 3): string[] {
  const name = plainName(target.ref.label);
  const key = canonicalAnatomyKey(target.ref.classId);
  const twinKey = key.replace(/_(left|right)(?=$|_)/, (_m, s: string) => (s === 'left' ? '_right' : '_left'));
  const here = (t: LoadedTarget) => t.geom.geometryType === 'contour_set' && !!sop && t.geom.planes.some((p) => p.sopInstanceUid === sop);
  const firstPoly = (t: LoadedTarget) => {
    if (t.geom.geometryType !== 'contour_set') return null;
    const pl = (sop && t.geom.planes.find((p) => p.sopInstanceUid === sop)) || t.geom.planes[0];
    return pl?.polygons[0] ? centre(pl.polygons[0] as number[][]) : null;
  };
  const c0 = firstPoly(target);
  const others = all.filter((t) => t.ref.id !== target.ref.id && plainName(t.ref.label) !== name);
  const dist = (t: LoadedTarget) => {
    const c = firstPoly(t);
    return c && c0 ? Math.hypot(c[0] - c0[0], c[1] - c0[1]) : Infinity;
  };
  const ranked = [
    ...others.filter((t) => canonicalAnatomyKey(t.ref.classId) === twinKey && twinKey !== key),
    ...others.filter(here).sort((a, b) => dist(a) - dist(b)),
    ...others.filter((t) => !here(t) && categoryFor(t.ref) === categoryFor(target.ref)),
    ...others,
  ];
  const out: string[] = [];
  for (const t of ranked) {
    const nm = plainName(t.ref.label);
    if (!out.includes(nm)) out.push(nm);
    if (out.length >= n) break;
  }
  return out;
}

export const WINDOW_CHOICES: Array<{ id: WindowName; label: string }> = [
  { id: 'Lung', label: 'Lung window' },
  { id: 'Soft tissue', label: 'Soft-tissue (mediastinal) window' },
  { id: 'Bone', label: 'Bone window' },
];

/** The CT window that shows a structure best. */
export function bestWindow(c: Pick<DrillCandidate, 'key' | 'category'>): WindowName {
  const n = noteFor(c.key);
  if (n) return n.window;
  return c.category === 'airway' ? 'Lung' : c.category === 'bone' ? 'Bone' : 'Soft tissue';
}

export const WINDOW_WHY: Record<WindowName, string> = {
  Lung: 'A wide window centred low (about W 1500 / L −600) spreads the greys across air, so vessels, fissures and nodules show inside the black lung.',
  'Soft tissue': 'A narrow window (about W 400 / L 40) separates fat, fluid, muscle, organs and contrast; air looks black and bone white.',
  Bone: 'A very wide window centred high (about W 2000 / L 500) shows cortex and trabeculae; all soft tissues look the same grey.',
};

/** Pick the series window preset that matches a window name. */
export function presetFor(presets: Array<{ label: string; center: number; width: number }>, w: WindowName, chest: boolean) {
  const by = (l: string) => presets.find((p) => p.label.toLowerCase() === l.toLowerCase());
  if (w === 'Lung') return by('Lung');
  if (w === 'Bone') return by('Bone');
  return (chest ? by('Mediastinum') : null) ?? by('Soft tissue') ?? by('Mediastinum');
}

// ---------------------------------------------------------------- click grading

/** Even–odd test over all outlines of a structure on one slice (holes are handled). */
export function insideShapes(p: Vec2, polys: Vec2[][]): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to the edges of the outlines (same units as the points). */
export function distanceToShapes(p: Vec2, polys: Vec2[][]): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j];
      const [bx, by] = poly[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
    }
  }
  return best;
}

export function summary(stats: DrillStats, now = Date.now()) {
  const list = Object.values(stats);
  return {
    practised: list.length,
    due: list.filter((s) => isDue(s, now)).length,
    secure: list.filter((s) => s.box >= 3).length,
    weakest: list
      .filter((s) => s.seen >= 2)
      .sort((a, b) => a.correct / a.seen - b.correct / b.seen || b.misses - a.misses)
      .slice(0, 8),
  };
}
