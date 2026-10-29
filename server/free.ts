import { FREE_EDITION } from './freeEdition.generated.js';

/**
 * A free account (signed in, no plan) may load the sample patients and nothing else: every DICOM file, outline and
 * lesson of the other patients, the case of the week included, answers 402. Weeks start Monday 00:00 UTC (the case of
 * the week is for members; `weeklyCase` names it for the Monday email).
 */
const WEEK_MS = 7 * 86_400_000;
const cases = FREE_EDITION.cases;

export function weeklyCase(now: Date = new Date()): string {
  const week = Math.max(0, Math.floor((now.getTime() - Date.parse(`${FREE_EDITION.epoch}T00:00:00Z`)) / WEEK_MS));
  return FREE_EDITION.weekly[week % FREE_EDITION.weekly.length];
}

export function freeCaseIds(): string[] {
  return FREE_EDITION.always;
}

export function freePathAllowed(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (path.includes('..') || path.includes('\\') || path.includes('//')) return false;
  if (FREE_EDITION.shared.includes(path)) return true;
  return freeCaseIds().some((id) => {
    const c = cases[id];
    // A folder prefix allows the files directly inside it, never deeper paths.
    return !!c && (c.files.includes(path) || c.prefixes.some((p) => path.startsWith(p) && !path.slice(p.length).includes('/')));
  });
}
