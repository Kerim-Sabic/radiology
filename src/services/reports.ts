/** "Something looks wrong on this case": the learner's report, sent with the case, task and slice (server/reports.ts). */
import type { Mode } from './progressRepository';

export type ReportKind = 'outline' | 'answer' | 'image' | 'book' | 'other';

/** What the learner can pick, in the order shown. */
export const REPORT_KINDS: Array<[ReportKind, string]> = [
  ['outline', 'An outline or label is in the wrong place or wrongly named'],
  ['answer', 'The expected answer or the explanation is wrong'],
  ['image', 'The image does not load or looks wrong'],
  ['book', 'The book page it links to is wrong'],
  ['other', 'Something else'],
];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  outline: 'Outline or label',
  answer: 'Answer or explanation',
  image: 'Image',
  book: 'Book link',
  other: 'Something else',
};

export const MAX_REPORT_TEXT = 1000;

export interface ReportInput {
  kind: ReportKind;
  text: string;
  caseId: string;
  taskId: string;
  mode: Mode;
  exam?: boolean;
  /** The focused view: its series, the kind of view, and the slice (1-based) of how many. */
  view: { seriesUid: string; kind: string; slice: number; of: number } | null;
}

export async function sendReport(report: ReportInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    if (r.ok) return { ok: true };
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `The report was not sent (HTTP ${r.status}). Please try again.` };
  } catch {
    return { ok: false, error: 'The report was not sent: the server could not be reached. Please try again.' };
  }
}
