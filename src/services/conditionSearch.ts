/**
 * Look up a condition by name and find where it is in the installed cases. Matching forgives British
 * spelling, accents, abbreviations, word order and small typos, but never matches inside a word
 * ("thorax" does not find hemothorax). Cases are found only from source evidence: an outline of the
 * finding, study labels every expert reader group agreed on, or — said plainly — a patient taken from
 * a collection of people with the condition whose lesion is not outlined here.
 */
import type { Catalog } from './caseRepository';
import type { ReferenceTarget, TargetGeometry, TeachingCase } from '../schema/content';
import { CONDITIONS, type Condition, type Evidence } from '../content/conditions';
import { cleanLabel } from '../lib/provenance';

// ------------------------------------------------------------------ matching

/** Lower case, no accents, American spelling, punctuation to spaces: "Haemothorax" → "hemothorax". */
export function normalizeQuery(s: string): string {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t
    .replace(/haem/g, 'hem')
    .replace(/oedem/g, 'edem')
    .replace(/oesophag/g, 'esophag')
    .replace(/tumour/g, 'tumor')
    .replace(/paediatric/g, 'pediatric')
    .replace(/ischaem/g, 'ischem')
    .replace(/caec/g, 'cec')
    .replace(/goitre/g, 'goiter')
    .replace(/\bdisk(s?)\b/g, 'disc$1')
    .replace(/diskitis/g, 'discitis');
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/\bcovid ?19\b/g, 'covid19').replace(/\bsars cov ?2\b/g, 'sars cov2');
}

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}

/** Typos allowed between two words: none for short words, one up to 7 letters, two beyond. */
const allowedTypos = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  return n <= 4 ? 0 : n <= 7 ? 1 : 2;
};

/**
 * How well a normalized query matches one normalized name or synonym (0 = not at all). Words in `known`
 * are real words of some other condition, so they are never read as typos ("hemothorax" ≠ "hemithorax").
 */
export function termScore(q: string, term: string, known?: Set<string>): number {
  if (!q || !term) return 0;
  if (q === term) return 100;
  if (q.length >= 2 && term.startsWith(q)) return 92 - Math.min(8, (term.length - q.length) * 0.25);
  const qWords = q.split(' ');
  const tWords = term.split(' ');
  let penalty = 0;
  let all = true;
  for (const w of qWords) {
    let best = Infinity;
    for (const tw of tWords) {
      if (tw === w) {
        best = 0;
        break;
      }
      if (w.length >= 3 && tw.startsWith(w)) best = Math.min(best, 0.5);
      else if (!known?.has(w)) {
        const dist = editDistance(w, tw);
        if (dist <= allowedTypos(w, tw)) best = Math.min(best, dist);
      }
    }
    if (best === Infinity) {
      all = false;
      break;
    }
    penalty += best;
  }
  if (all) return 85 - penalty * 8 - Math.max(0, tWords.length - qWords.length);
  // "tension pneumothorax on ct": the whole name inside a longer query; longer names are more specific.
  if (` ${q} `.includes(` ${term} `)) return 72 + Math.min(12, tWords.length * 4);
  return 0;
}

export interface ConditionMatch {
  condition: Condition;
  score: number;
  /** The name or synonym that matched (normalized). */
  via: string;
}

const termsCache = new WeakMap<Condition, string[]>();
const vocabCache = new WeakMap<Condition[], Set<string>>();
const vocabularyOf = (list: Condition[]) => {
  let v = vocabCache.get(list);
  if (!v) {
    v = new Set(list.flatMap((c) => termsOf(c).flatMap((t) => t.split(' '))));
    vocabCache.set(list, v);
  }
  return v;
};
const termsOf = (c: Condition) => {
  let t = termsCache.get(c);
  if (!t) {
    const name = c.name.replace(/\(([^)]*)\)/g, ' ');
    const inner = [...c.name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    t = [...new Set([c.name, name, ...inner, ...c.synonyms].map(normalizeQuery).filter(Boolean))];
    termsCache.set(c, t);
  }
  return t;
};

/** Conditions matching a query, best first. `withCases` lifts conditions that have installed cases on ties. */
export function searchConditions(query: string, list: Condition[] = CONDITIONS, withCases?: (id: string) => boolean): ConditionMatch[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const out: ConditionMatch[] = [];
  const known = vocabularyOf(list);
  for (const c of list) {
    let best = 0;
    let via = '';
    for (const t of termsOf(c)) {
      const s = termScore(q, t, known);
      if (s > best) {
        best = s;
        via = t;
      }
    }
    if (best >= 60) out.push({ condition: c, score: best, via });
  }
  return out.sort((a, b) => b.score - a.score || Number(withCases?.(b.condition.id) ?? 0) - Number(withCases?.(a.condition.id) ?? 0) || a.condition.name.localeCompare(b.condition.name));
}

// ------------------------------------------------------------------ cases

export type Family = 'CT' | 'X-ray' | 'MRI' | 'Mammography' | 'Ultrasound' | 'Other';
export const FAMILY_ORDER: Family[] = ['CT', 'X-ray', 'MRI', 'Mammography', 'Ultrasound', 'Other'];
export const familyOf = (modality: string): Family =>
  modality === 'CT' ? 'CT' : modality === 'CR' || modality === 'DX' ? 'X-ray' : modality === 'MR' ? 'MRI' : modality === 'MG' ? 'Mammography' : modality === 'US' ? 'Ultrasound' : 'Other';

export type Strength = 'outlined' | 'labelled' | 'collection';
export const STRENGTH_LABEL: Record<Strength, string> = {
  outlined: 'Marked on the image',
  labelled: 'Reader labels',
  collection: 'Not outlined',
};

export interface CaseHit {
  caseId: string;
  /** Neutral patient title, e.g. "Patient N · MRI + CT of an extremity". */
  patient: string;
  seriesUid: string;
  modality: string;
  family: Family;
  seriesDescription: string;
  thumb: string | null;
  strength: Strength;
  note: string;
  items: Array<{ targetId?: string; label: string; source?: string; where?: string }>;
  link: string;
}

/** The parts of the catalog the search reads (a plain object in tests). */
export type CatalogView = Pick<Catalog, 'cases' | 'targets' | 'series' | 'tasksByCase' | 'seriesForCase' | 'thumbnailUrl' | 'seriesSource'>;
export type GeometryLoader = (targetId: string) => Promise<TargetGeometry | null>;

const RANK: Record<Strength, number> = { outlined: 0, labelled: 1, collection: 2 };

/** Every installed case that shows a condition, strongest evidence first. */
export async function findCases(catalog: CatalogView, cond: Condition, load: GeometryLoader): Promise<CaseHit[]> {
  if (!cond.evidence?.length) return [];
  const caseOfSeries = new Map<string, TeachingCase>();
  for (const k of catalog.cases.values()) for (const s of catalog.seriesForCase(k)) if (!caseOfSeries.has(s.uid)) caseOfSeries.set(s.uid, k);
  const hits: CaseHit[] = [];
  for (const ev of cond.evidence) {
    if (ev.kind === 'finding') hits.push(...(await findingHits(catalog, ev, caseOfSeries, load)));
    else if (ev.kind === 'reader_labels') hits.push(...(await labelHits(catalog, ev, caseOfSeries, load)));
    else hits.push(...collectionHits(catalog, ev));
  }
  // One entry per series and kind of evidence; a case already shown with stronger evidence is not repeated as "collection".
  const seen = new Set<string>();
  const strongCases = new Set(hits.filter((h) => h.strength !== 'collection').map((h) => h.caseId));
  return hits
    .filter((h) => !(h.strength === 'collection' && strongCases.has(h.caseId)))
    .filter((h) => {
      const key = `${h.seriesUid}|${h.strength}|${h.note}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => RANK[a.strength] - RANK[b.strength] || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || a.patient.localeCompare(b.patient));
}

function baseHit(catalog: CatalogView, k: TeachingCase, seriesUid: string): Omit<CaseHit, 'strength' | 'note' | 'items' | 'link'> {
  const s = catalog.series.get(seriesUid);
  return {
    caseId: k.id,
    patient: k.neutralTitle,
    seriesUid,
    modality: s?.modality ?? '',
    family: familyOf(s?.modality ?? ''),
    seriesDescription: s?.description || (s?.number != null ? `Series ${s.number}` : 'Series'),
    thumb: catalog.thumbnailUrl(seriesUid),
  };
}

/** Learn-mode link to the task that asks about these targets (on their own series if possible). */
function linkFor(catalog: CatalogView, caseId: string, seriesUid: string, targetIds: string[]): string {
  const tasks = (catalog.tasksByCase.get(caseId) ?? []).filter((t) => t.modes.includes('learn') && t.targets.some((x) => targetIds.includes(x.targetId)));
  const task = tasks.find((t) => t.start.seriesUid === seriesUid) ?? tasks.find((t) => t.seriesUids.includes(seriesUid)) ?? tasks[0];
  const show = targetIds[0] ? `&show=${encodeURIComponent(targetIds[0])}` : '';
  return task ? `/read/${encodeURIComponent(caseId)}?task=${encodeURIComponent(task.id)}&mode=learn${show}` : `/read/${encodeURIComponent(caseId)}?mode=learn${show}`;
}

/** "images 41–46 of 133" from the slices an outline or box is drawn on (display order, as the viewer counts). */
export function whereText(g: TargetGeometry | null, sopOrder: string[]): string | undefined {
  const sops = g?.geometryType === 'contour_set' ? g.planes.map((p) => p.sopInstanceUid) : g?.geometryType === 'box' ? g.boxes.map((b) => b.sopInstanceUid) : null;
  if (!g || !sops || !sopOrder.length) return undefined;
  if (sopOrder.length === 1) return g.geometryType === 'box' ? 'boxed on the image' : 'outlined on the image';
  const idx = [...new Set(sops.map((sop) => sopOrder.indexOf(sop)).filter((i) => i >= 0))].sort((a, b) => a - b);
  if (!idx.length) return undefined;
  const a = idx[0] + 1;
  const b = idx[idx.length - 1] + 1;
  return a === b ? `image ${a} of ${sopOrder.length}` : `images ${a}–${b} of ${sopOrder.length}`;
}

async function findingHits(catalog: CatalogView, ev: Extract<Evidence, { kind: 'finding' }>, caseOfSeries: Map<string, TeachingCase>, load: GeometryLoader) {
  const bySeries = new Map<string, ReferenceTarget[]>();
  for (const t of catalog.targets.values()) {
    if (!ev.classIds.includes(t.classId) || t.layer === 'atlas') continue;
    const arr = bySeries.get(t.seriesUid) ?? [];
    arr.push(t);
    bySeries.set(t.seriesUid, arr);
  }
  const out: CaseHit[] = [];
  for (const [seriesUid, ts] of bySeries) {
    const k = caseOfSeries.get(seriesUid);
    if (!k) continue;
    const order = catalog.seriesSource(seriesUid)?.sopUids ?? [];
    const sorted = [...ts].sort((a, b) => ev.classIds.indexOf(a.classId) - ev.classIds.indexOf(b.classId) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const items = await Promise.all(
      sorted.map(async (t) => ({
        targetId: t.id,
        label: ev.names?.[t.classId] ?? cleanLabel(t.label),
        source: ev.names?.[t.classId] ? cleanLabel(t.label) : undefined,
        where: whereText(await load(t.id).catch(() => null), order),
      })),
    );
    out.push({ ...baseHit(catalog, k, seriesUid), strength: 'outlined', note: ev.note ?? 'Marked (outline or box) in the source data', items, link: linkFor(catalog, k.id, seriesUid, sorted.map((t) => t.id)) });
  }
  return out;
}

async function labelHits(catalog: CatalogView, ev: Extract<Evidence, { kind: 'reader_labels' }>, caseOfSeries: Map<string, TeachingCase>, load: GeometryLoader) {
  const bySeries = new Map<string, ReferenceTarget[]>();
  for (const t of catalog.targets.values()) {
    if (t.geometryType !== 'image_label' || !t.classId.startsWith('label:')) continue;
    const arr = bySeries.get(t.seriesUid) ?? [];
    arr.push(t);
    bySeries.set(t.seriesUid, arr);
  }
  const out: CaseHit[] = [];
  for (const [seriesUid, ts] of bySeries) {
    const k = caseOfSeries.get(seriesUid);
    if (!k) continue;
    const groups = await Promise.all(ts.map((t) => load(t.id).catch(() => null)));
    const labelSets = groups.map((g) => (g?.geometryType === 'image_label' ? new Set(g.labels.map((l) => l.replace(/\s+/g, ' ').trim())) : null));
    if (labelSets.some((s) => !s)) continue; // only judge when every reader group's labels are known
    const agreed = [...labelSets[0]!].filter((l) => labelSets.every((s) => s!.has(l)));
    if (!agreed.some((l) => ev.labels.test(l))) continue;
    out.push({
      ...baseHit(catalog, k, seriesUid),
      strength: 'labelled',
      note: ev.note ?? 'Study labels agreed by the expert reader groups',
      items: [{ label: `All ${labelSets.length} reader groups: ${agreed.join(' · ')}` }],
      link: linkFor(catalog, k.id, seriesUid, []),
    });
  }
  return out;
}

function collectionHits(catalog: CatalogView, ev: Extract<Evidence, { kind: 'collection' }>): CaseHit[] {
  const out: CaseHit[] = [];
  for (const k of catalog.cases.values()) {
    if (!ev.subject.test(k.subjectKey)) continue;
    out.push({ ...baseHit(catalog, k, k.primarySeriesUid), strength: 'collection', note: ev.note, items: [], link: `/read/${encodeURIComponent(k.id)}?mode=learn` });
  }
  return out;
}

/** Hits grouped by imaging family, in a fixed order (CT, X-ray, MRI, mammography). */
export function groupByFamily(hits: CaseHit[]): Array<{ family: Family; hits: CaseHit[] }> {
  return FAMILY_ORDER.map((family) => ({ family, hits: hits.filter((h) => h.family === family) })).filter((g) => g.hits.length);
}
