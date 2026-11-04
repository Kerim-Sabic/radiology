/**
 * Reports from learners that something on a case looks wrong: an outline, the expected answer, the image itself or a
 * book link. Each report keeps the case, the task, the view and slice the learner was on, and who sent it (so the
 * team can reply). The newest MAX_REPORTS are kept; admins with the "reports" permission read them and mark them fixed.
 */
import { z } from 'zod';
import type { Session } from './auth.js';
import { random } from './auth.js';
import { db } from './store.js';

export const REPORT_KINDS = ['outline', 'answer', 'image', 'book', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const MAX_REPORTS = 500;
export const MAX_REPORT_TEXT = 1000;
const LIST = 'rvm:reports';
const DONE = 'rvm:reports:done';

const Id = z.string().min(1).max(160).regex(/^[\w.:-]+$/);
const ReportBody = z
  .object({
    kind: z.enum(REPORT_KINDS),
    text: z.string().max(MAX_REPORT_TEXT * 2).transform((s) => s.trim().slice(0, MAX_REPORT_TEXT)),
    caseId: Id,
    taskId: Id,
    mode: z.enum(['learn', 'practice', 'assess', 'review']),
    exam: z.boolean().optional(),
    /** The view the learner was on: its series, the kind of view, and the slice (1-based) of how many. */
    view: z
      .object({
        seriesUid: z.string().max(200),
        kind: z.string().max(12),
        slice: z.number().int().min(0).max(100_000),
        of: z.number().int().min(0).max(100_000),
      })
      .strict()
      .nullable(),
  })
  .strict();

export interface CaseReport extends z.infer<typeof ReportBody> {
  id: string;
  at: string;
  userId: string;
  email: string;
  name: string;
}

/** Keep a learner's report. "Something else" needs a few words, since there is nothing else to go on. */
export async function fileReport(user: Session, body: unknown, now = new Date()) {
  const p = ReportBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'That report could not be read. Please try again.' };
  if (p.data.kind === 'other' && p.data.text.length < 3) return { ok: false as const, error: 'Please say in a few words what looks wrong.' };
  const report: CaseReport = { ...p.data, id: random().slice(0, 16), at: now.toISOString(), userId: user.userId, email: user.email, name: user.name };
  await db().lpush(LIST, JSON.stringify(report));
  await db().ltrim(LIST, 0, MAX_REPORTS - 1);
  return { ok: true as const, id: report.id };
}

/** Every kept report, newest first, with whether it was marked fixed. */
export async function listReports() {
  const rows = ((await db().lrange(LIST, 0, MAX_REPORTS - 1)) ?? []) as unknown[];
  const done = new Set((await db().smembers(DONE)) as string[]);
  const reports = rows
    .map((row) => {
      try {
        return (typeof row === 'string' ? JSON.parse(row) : row) as CaseReport;
      } catch {
        return null;
      }
    })
    .filter((r): r is CaseReport => !!r && typeof r.id === 'string')
    .map((r) => ({ ...r, done: done.has(r.id) }));
  return { reports, open: reports.filter((r) => !r.done).length };
}

const ResolveBody = z.object({ id: z.string().min(1).max(40).regex(/^[\w-]+$/), done: z.boolean() }).strict();

/** Mark a report fixed, or open it again. */
export async function resolveReport(body: unknown) {
  const p = ResolveBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Expected a report and whether it is fixed.' };
  if (p.data.done) await db().sadd(DONE, p.data.id);
  else await db().srem(DONE, p.data.id);
  return { ok: true as const };
}
