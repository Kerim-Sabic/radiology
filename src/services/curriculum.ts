/**
 * BookRepository (structure only): curriculum units/objectives and the verified page map,
 * figure and section anchors. These files contain NO book text — the PDF itself is loaded
 * from the user's own copy (see bookPdf.ts).
 */
import { z } from 'zod';

const Anchor = z.object({
  physical: z.number(),
  printed: z.string().nullable(),
  figureId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
});

export const Objective = z.object({
  id: z.string(),
  see: z.string(),
  show: z.string(),
  explain: z.string(),
  skillDimensions: z.array(z.string()).default([]),
  anchors: z.array(Anchor).default([]),
  contrastWith: z.string().nullable().optional(),
  scanNeed: z
    .object({
      modality: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      feasibility: z.string(),
    })
    .nullable()
    .optional(),
});
export type Objective = z.infer<typeof Objective>;

const PageRef = z.object({ physical: z.number(), printed: z.string().nullable() }).nullable().optional();

export const Unit = z.object({
  id: z.string(),
  kind: z.enum(['chapter', 'appendix']),
  number: z.string(),
  title: z.string(),
  printedRange: z.tuple([z.string(), z.string()]),
  physicalRange: z.tuple([z.number(), z.number()]),
  region: z.array(z.string()).default([]),
  modalities: z.array(z.string()).default([]),
  objectives: z.array(Objective),
  caseQuiz: z.object({ question: PageRef, answer: PageRef }).nullable().optional(),
  takeHome: PageRef,
  figureCount: z.number().optional(),
  tableCount: z.number().optional(),
});
export type Unit = z.infer<typeof Unit>;

export const CurriculumFile = z.object({
  schemaVersion: z.literal(1),
  bookSha256: z.string(),
  units: z.array(Unit),
});
export type CurriculumFile = z.infer<typeof CurriculumFile>;

export const PageMap = z.object({
  schemaVersion: z.literal(1),
  document: z.object({
    title: z.string(),
    edition: z.string(),
    author: z.string().optional(),
    isbn: z.string().optional(),
    sha256: z.string(),
    filename: z.string().optional(),
    physicalPageCount: z.number(),
  }),
  pages: z.array(
    z.object({
      physical: z.number(),
      printed: z.string().nullable(),
      kind: z.string(),
      chapterId: z.string().nullable(),
      inferred: z.boolean().optional(),
    }),
  ),
});
export type PageMap = z.infer<typeof PageMap>;

export const Figures = z.object({
  schemaVersion: z.literal(1),
  figures: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      chapterId: z.string().nullable(),
      physical: z.number(),
      printed: z.string().nullable(),
      bbox: z.array(z.number()).nullable().optional(),
      hasPrintedAnnotations: z.boolean().nullable().optional(),
      modality: z.string().nullable().optional(),
      description: z.string().optional(),
    }),
  ),
});
export type Figures = z.infer<typeof Figures>;

export const Sections = z.object({
  schemaVersion: z.literal(1),
  sections: z.array(
    z.object({
      id: z.string(),
      chapterId: z.string().nullable(),
      title: z.string(),
      level: z.number().optional(),
      physical: z.number(),
      printed: z.string().nullable(),
      kind: z.string().optional(),
    }),
  ),
});
export type Sections = z.infer<typeof Sections>;

export interface Curriculum {
  file: CurriculumFile | null;
  pageMap: PageMap | null;
  figures: Figures | null;
  sections: Sections | null;
  errors: string[];
  unitById: Map<string, Unit>;
  objectiveById: Map<string, { unit: Unit; objective: Objective }>;
}

async function getJson<T>(url: string, schema: z.ZodType<T>, errors: string[]): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed = schema.safeParse(await r.json());
    if (!parsed.success) {
      errors.push(`${url}: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return null;
    }
    return parsed.data;
  } catch (e) {
    errors.push(`${url}: ${String(e)}`);
    return null;
  }
}

export async function loadCurriculum(): Promise<Curriculum> {
  const base = `${import.meta.env.BASE_URL}content/`;
  const errors: string[] = [];
  const [file, pageMap, figures, sections] = await Promise.all([
    getJson(`${base}curriculum.v1.json`, CurriculumFile, errors),
    getJson(`${base}book/page-map.v1.json`, PageMap, errors),
    getJson(`${base}book/figures.v1.json`, Figures, errors),
    getJson(`${base}book/sections.v1.json`, Sections, errors),
  ]);
  const unitById = new Map<string, Unit>();
  const objectiveById = new Map<string, { unit: Unit; objective: Objective }>();
  for (const u of file?.units ?? []) {
    unitById.set(u.id, u);
    for (const o of u.objectives) objectiveById.set(o.id, { unit: u, objective: o });
  }
  return { file, pageMap, figures, sections, errors, unitById, objectiveById };
}

/** Printed label for a physical page, from the verified page map (never a global offset). */
export function printedLabel(c: Curriculum, physical: number): string | null {
  return c.pageMap?.pages.find((p) => p.physical === physical)?.printed ?? null;
}

export function physicalForPrinted(c: Curriculum, printed: string): number | null {
  return c.pageMap?.pages.find((p) => p.printed === printed)?.physical ?? null;
}

export function unitForPhysical(c: Curriculum, physical: number): Unit | null {
  return c.file?.units.find((u) => physical >= u.physicalRange[0] && physical <= u.physicalRange[1]) ?? null;
}

export function anchorLabel(c: Curriculum, a: { physical: number; printed?: string | null; figureId?: string | null; chapterId?: string | null }): string {
  const unit = a.chapterId ? c.unitById.get(a.chapterId) : unitForPhysical(c, a.physical);
  const printed = a.printed ?? printedLabel(c, a.physical);
  const where = unit ? `${unit.kind === 'chapter' ? 'Ch' : 'App'} ${unit.number}` : 'Book';
  return `${where}${a.figureId ? ` · ${a.figureId}` : ''} · p. ${printed ?? '?'} (PDF ${a.physical})`;
}
