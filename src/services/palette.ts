/**
 * Quick search (Ctrl/⌘ K): pages, conditions, cases and book chapters in one list. Cases are found by their neutral
 * titles only, so searching never reveals a case's diagnosis.
 */
import type { Catalog } from './caseRepository';
import type { CurriculumFile } from './curriculum';
import { CONDITIONS, REGION_LABEL } from '../content/conditions';
import { normalizeQuery, searchConditions } from './conditionSearch';

export type PaletteKind = 'page' | 'condition' | 'case' | 'chapter';
export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  title: string;
  sub?: string;
  to: string;
  /** Extra words that find it (synonyms, modality, region). */
  words?: string;
}

export const PAGES: PaletteItem[] = [
  ['/', 'Today', 'your plan, streak and next scan', 'home dashboard start'],
  ['/cases', 'Cases', 'every installed patient', 'library studies patients'],
  ['/conditions', 'Conditions', 'search a disease, see it on real scans', 'diagnosis disease finding'],
  ['/atlas', 'Anatomy atlas', 'any structure, shown alone', 'anatomy organs structures'],
  ['/drill', 'Drills', 'point to structures and findings', 'quiz spaced repetition practice'],
  ['/oncall', 'On call', 'a timed shift of unknown cases', 'shift exam timed test'],
  ['/course', 'Course', 'chapter by chapter', 'curriculum objectives syllabus'],
  ['/book', 'Book', 'Learning Radiology, 5th edition', 'textbook read pages'],
  ['/book/figures', 'Book figures', 'figures by chapter', 'images figures'],
  ['/progress', 'Progress', 'skills, mistakes, backup', 'stats statistics export import backup'],
  ['/certificates', 'Certificates', 'levels, claim, LinkedIn', 'certificate certification level linkedin award diploma'],
  ['/settings', 'Settings', 'level, exam date, data packs', 'preferences options'],
  ['/guide', 'Guide', 'how to use the app and its shortcuts', 'help keyboard shortcuts manual'],
  ['/import', 'Import', 'open your own DICOM files', 'dicom upload files'],
  ['/author', 'Author', 'write your own tasks', 'create tasks lessons'],
].map(([to, title, sub, words]) => ({ id: `page:${to}`, kind: 'page' as const, title, sub, to, words }));

export function paletteItems(catalog: Pick<Catalog, 'cases' | 'seriesForCase'> | null, curriculum: Pick<CurriculumFile, 'units'> | null): PaletteItem[] {
  const conditions: PaletteItem[] = CONDITIONS.map((c) => ({
    id: `condition:${c.id}`,
    kind: 'condition',
    title: c.name,
    sub: REGION_LABEL[c.region],
    to: `/conditions?c=${encodeURIComponent(c.id)}`,
    words: c.synonyms.join(' '),
  }));
  const chapters: PaletteItem[] = (curriculum?.units ?? []).map((u) => {
    const label = u.kind === 'chapter' ? `Chapter ${u.number}` : `Appendix ${u.number}`;
    return { id: `chapter:${u.id}`, kind: 'chapter', title: u.title, sub: label, to: `/course/${encodeURIComponent(u.id)}`, words: label };
  });
  const cases: PaletteItem[] = catalog
    ? [...catalog.cases.values()].map((k) => {
        const mods = [...new Set(catalog.seriesForCase(k).map((s) => s.modality))].join(' ');
        return { id: `case:${k.id}`, kind: 'case', title: k.neutralTitle, sub: [mods, k.region.join(', ')].filter(Boolean).join(' · '), to: `/read/${encodeURIComponent(k.id)}`, words: `${mods} ${k.region.join(' ')} ${k.id}` };
      })
    : [];
  return [...PAGES, ...conditions, ...chapters, ...cases];
}

const KIND_RANK: Record<PaletteKind, number> = { page: 3, condition: 2, chapter: 1, case: 0 };
const words = (s: string) => normalizeQuery(s).split(' ').filter(Boolean);

/** How well an item matches: every query word must start a word of the item (or sit inside one, for longer words). */
function score(item: PaletteItem, q: string[]): number {
  const title = words(item.title);
  const all = [...title, ...words(`${item.sub ?? ''} ${item.words ?? ''}`)];
  let s = 0;
  for (const w of q) {
    if (title.includes(w)) s += 4;
    else if (title.some((t) => t.startsWith(w))) s += 3;
    else if (all.some((t) => t.startsWith(w))) s += 2;
    else if (w.length >= 3 && all.some((t) => t.includes(w))) s += 1;
    else return 0;
  }
  if (normalizeQuery(item.title).startsWith(q.join(' '))) s += 2;
  return s * 10 + KIND_RANK[item.kind];
}

/** Items for a query, best first (pages when the query is empty). Conditions also match with small typos. */
export function paletteSearch(items: PaletteItem[], query: string, limit = 12): PaletteItem[] {
  const q = words(query);
  if (!q.length) return items.filter((i) => i.kind === 'page').slice(0, limit);
  const scored = new Map<string, { item: PaletteItem; s: number }>();
  for (const item of items) {
    const s = score(item, q);
    if (s > 0) scored.set(item.id, { item, s });
  }
  // Typo-tolerant condition matches ("pnemothorax"), below exact word matches.
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const m of searchConditions(query).slice(0, 6)) {
    const item = byId.get(`condition:${m.condition.id}`);
    if (item && !scored.has(item.id)) scored.set(item.id, { item, s: Math.round(m.score / 10) + KIND_RANK.condition });
  }
  return [...scored.values()]
    .sort((a, b) => b.s - a.s || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((x) => x.item);
}
