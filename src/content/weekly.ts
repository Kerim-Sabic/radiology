/**
 * Free cases and the case of the week. A free account (signed up, no plan) reads only the sample patients; the case
 * of the week is for members (their weekly highlight and Monday email; free accounts see it locked). The server
 * allows a free account to load exactly the sample patients (see server/freeEdition.generated.ts, which
 * `npm run free:sync` writes from this file; a unit test keeps the two in step).
 */

/** Sample patients every free account can read. */
export const FREE_CASES = ['starter-ct-chest-01', 'cxr-00003400-003'];

/**
 * Anatomy on the sample patients: the outlines their tasks use, plus these main structures. Every other labelled
 * structure (lobes, ribs, vertebrae, vessels and the rest) is for members; its files are not served to free accounts.
 */
export const FREE_ANATOMY = ['anatomy:heart', 'anatomy:aorta', 'anatomy:pulmonary_trunk', 'anatomy:trachea', 'anatomy:liver', 'anatomy:spleen', 'anatomy:stomach', 'anatomy:sternum'];

/** Weeks start on Monday 00:00 UTC; week 0 began on this Monday. */
export const WEEKLY_EPOCH = '2026-10-26';

/** The case of each week, in order; the list repeats when it runs out. */
export const WEEKLY_CASES = [
  'pe-pat005',
  'stroke-isles-0015',
  'fx-img0000151',
  'us-breast-case048',
  'mg-cbis-p00039',
  'body-kits-00015',
  'cxr-00001437-012',
  'peds-wrist-3390',
  'ct-crlm-1140',
  'lung-dx-a0010',
  'neuro-remind-025',
  'cxr-00000377-004',
  'hcc-010',
  'vs-seg-001',
  'chest-pairs-lidc-idri-0078',
  'us-fetal-head-113',
  // A year in all: the patients added in October 2026, one modality after another.
  'mr-diffusion-0124',
  'us-breast-case018',
  'cxr-00018055-005',
  'xr-wrist-child-0040',
  'mg-p00732',
  'cxr-00021181-002',
  'us-breast-case008',
  'mr-diffusion-0247',
  'xr-wrist-child-0006',
  'mg-p00506',
  'cxr-00026136-002',
  'us-breast-case050',
  'mr-diffusion-0211',
  'xr-wrist-child-0177',
  'mg-p00018',
  'cxr-00001369-000',
  'us-breast-case021',
  'cxr-00018101-012',
  'mr-diffusion-0004',
  'mg-p00014',
  'us-breast-case058',
  'cxr-00001555-002',
  'xr-wrist-child-1241',
  'us-breast-case023',
  'cxr-00010610-003',
  'mr-diffusion-0157',
  'mg-p01356',
  'us-breast-case026',
  'xr-wrist-child-2813',
  'cxr-00004344-013',
  'us-breast-case082',
  'mg-p00781',
  'mr-diffusion-0075',
  'us-breast-case067',
  'xr-wrist-child-4206',
  'cxr-00012576-004',
];

const WEEK_MS = 7 * 86_400_000;

export function weekNumber(now: Date = new Date()): number {
  return Math.floor((now.getTime() - Date.parse(`${WEEKLY_EPOCH}T00:00:00Z`)) / WEEK_MS);
}

export interface CaseOfWeek {
  caseId: string;
  /** 0 for the first week. */
  week: number;
  startsAt: Date;
  endsAt: Date;
}

export function caseOfWeek(now: Date = new Date()): CaseOfWeek {
  const week = Math.max(0, weekNumber(now));
  const startsAt = new Date(Date.parse(`${WEEKLY_EPOCH}T00:00:00Z`) + week * WEEK_MS);
  return { caseId: WEEKLY_CASES[week % WEEKLY_CASES.length], week, startsAt, endsAt: new Date(startsAt.getTime() + WEEK_MS) };
}

/** Patients a free account can open. */
export function freeCaseIds(): Set<string> {
  return new Set(FREE_CASES);
}
