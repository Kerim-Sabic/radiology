/**
 * How structure outlines are drawn, as the learner chose it: a colour per group or per structure, outlined or
 * filled, how strong the fill is and how thick the line. Kept in this browser; the slice views, the reformatted
 * views and the 3D models all read the same style, so the aorta is the same red everywhere.
 */
import { colorFor, groupFor, GROUP_ORDER, type Group3D } from './anatomyMask';

export type Look = 'outline' | 'fill';

export interface SegStyle {
  /** Per group: one colour for the whole group, and outlined or filled. */
  groups: Partial<Record<Group3D, { color?: string; look?: Look }>>;
  /** Per structure (canonical anatomy key): its own colour, which wins over the group's. */
  structures: Record<string, string>;
  /** Fill strength of filled shapes, 0.1–0.8. */
  fill: number;
  /** Outline width in screen pixels. */
  line: number;
  /** A colour key on the image: which group each colour stands for. */
  legend: boolean;
}

export const DEFAULT_SEG_STYLE: SegStyle = { groups: {}, structures: {}, fill: 0.35, line: 1.5, legend: true };
export const LINE_WIDTHS: Array<[number, string]> = [
  [1, 'Thin'],
  [1.5, 'Medium'],
  [2.5, 'Thick'],
];
/** Reference (answer) outlines on the slices, until a findings colour is chosen. */
export const REFERENCE_COLOR = '#ffd166';
export const REFERENCE_AI_COLOR = '#f2a65a';
/** Drill questions draw the asked structure in one neutral colour: an atlas colour would hint at the answer. */
export const QUIZ_COLOR = '#7dd3fc';

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** A stored style, checked field by field (anything unexpected falls back to the default). */
export function parseSegStyle(raw: unknown): SegStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const groups: SegStyle['groups'] = {};
  for (const [g, v] of Object.entries((r.groups && typeof r.groups === 'object' ? r.groups : {}) as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || !GROUP_ORDER.includes(g as Group3D)) continue;
    const { color, look } = v as { color?: unknown; look?: unknown };
    const e: { color?: string; look?: Look } = {};
    if (typeof color === 'string' && HEX.test(color)) e.color = color.toLowerCase();
    if (look === 'outline' || look === 'fill') e.look = look;
    if (e.color || e.look) groups[g as Group3D] = e;
  }
  const structures: Record<string, string> = {};
  for (const [k, c] of Object.entries((r.structures && typeof r.structures === 'object' ? r.structures : {}) as Record<string, unknown>))
    if (typeof c === 'string' && HEX.test(c)) structures[k] = c.toLowerCase();
  return {
    groups,
    structures,
    fill: clamp(r.fill, 0.1, 0.8, DEFAULT_SEG_STYLE.fill),
    line: clamp(r.line, 1, 3, DEFAULT_SEG_STYLE.line),
    legend: typeof r.legend === 'boolean' ? r.legend : DEFAULT_SEG_STYLE.legend,
  };
}

/** Colour of a structure: its own, else its group's, else the atlas colour. */
export function colorOf(s: SegStyle, key: string, group: Group3D = groupFor(key)): string {
  return s.structures[key] ?? s.groups[group]?.color ?? colorFor(key);
}

export function lookOf(s: SegStyle, group: Group3D): Look {
  return s.groups[group]?.look ?? 'outline';
}

/** Has the learner changed anything at all? */
export const isDefault = (s: SegStyle) =>
  !Object.keys(s.groups).length && !Object.keys(s.structures).length && s.fill === DEFAULT_SEG_STYLE.fill && s.line === DEFAULT_SEG_STYLE.line && s.legend === DEFAULT_SEG_STYLE.legend;

export function withGroup(s: SegStyle, g: Group3D, patch: { color?: string | null; look?: Look | null }): SegStyle {
  const e = { ...s.groups[g] };
  if (patch.color === null) delete e.color;
  else if (patch.color) e.color = patch.color.toLowerCase();
  if (patch.look === null) delete e.look;
  else if (patch.look) e.look = patch.look;
  const groups = { ...s.groups };
  if (e.color || e.look) groups[g] = e;
  else delete groups[g];
  // A group colour replaces the colours given to single structures of that group.
  const structures = patch.color ? Object.fromEntries(Object.entries(s.structures).filter(([k]) => groupFor(k) !== g)) : s.structures;
  return { ...s, groups, structures };
}

export function withStructure(s: SegStyle, key: string, color: string | null): SegStyle {
  const structures = { ...s.structures };
  if (color) structures[key] = color.toLowerCase();
  else delete structures[key];
  return { ...s, structures };
}

/** Outline or fill every group at once (clears per-group choices). */
export function withLookAll(s: SegStyle, look: Look): SegStyle {
  const groups: SegStyle['groups'] = {};
  for (const [g, e] of Object.entries(s.groups) as Array<[Group3D, { color?: string; look?: Look }]>) if (e.color) groups[g] = { color: e.color };
  if (look === 'fill') for (const g of GROUP_ORDER) groups[g] = { ...groups[g], look: 'fill' };
  return { ...s, groups };
}

/** Colours back to the atlas, keeping outline/fill, fill strength and line width. */
export function withAtlasColors(s: SegStyle): SegStyle {
  const groups: SegStyle['groups'] = {};
  for (const [g, e] of Object.entries(s.groups) as Array<[Group3D, { color?: string; look?: Look }]>) if (e.look) groups[g] = { look: e.look };
  return { ...s, groups, structures: {} };
}

// ------------------------------------------------------------------ the learner's style in this browser
const KEY = 'rvm.segStyle.v1';
const listeners = new Set<() => void>();
let current: SegStyle = (() => {
  try {
    return parseSegStyle(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return DEFAULT_SEG_STYLE;
  }
})();

export const segStyle = {
  get: (): SegStyle => current,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(next: SegStyle) {
    current = parseSegStyle(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* storage unavailable — keep in memory */
    }
    for (const fn of listeners) fn();
  },
  update(fn: (s: SegStyle) => SegStyle) {
    segStyle.set(fn(current));
  },
};
