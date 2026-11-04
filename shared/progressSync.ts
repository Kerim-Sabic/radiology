/**
 * The protocol between a browser and the account's saved study record (server/progressSync.ts on the server,
 * src/services/progressSync.ts in the app). The server keeps an append-only log per account:
 *
 * - a commit entry the first time an attempt id arrives (the answer, its marks and its grade, never changed again);
 * - a review entry when a later copy of that attempt carries a newer self-review verdict (only the verdict).
 *
 * The same attempt sent twice (a retry, a refresh, a double tap) adds nothing, so a grade is never counted twice.
 */

/** Sizes the server accepts. A browser sends batches well below them and reads the log a page at a time. */
export const SYNC_LIMITS = {
  /** Attempts in one upload. */
  batch: 25,
  /** Characters in one upload body (Upstash and Vercel both take more; this keeps each request quick on a phone). */
  bodyChars: 600_000,
  /** One attempt as JSON (outlines with many points are the largest; a typical attempt is 2–5 KB). */
  attemptChars: 200_000,
  /** Log entries in one page read. */
  page: 200,
  /** Characters in one page read. */
  pageChars: 500_000,
  /** Attempts one account can keep (thousands of hours of study). */
  maxAttempts: 25_000,
  /** Bytes one account can keep. */
  maxBytes: 40_000_000,
} as const;

/** Timestamps as the app writes them (`Date.toISOString()`), so that comparing the strings compares the times. */
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const ATTEMPT_ID = /^[\w-]{1,64}$/;

export interface SelfReview {
  checked: string[];
  verdict: 'correct' | 'partial' | 'incorrect' | null;
}

/** What the sync needs to know about an attempt; the rest of it travels as it is. */
export interface SyncedAttempt {
  id: string;
  submittedAt: string | null;
  reviewedAt?: string | null;
  selfReview: SelfReview | null;
}

/** An attempt's version: when it was submitted, or when its self-review last changed (whichever is later). */
export function attemptVersion(a: Pick<SyncedAttempt, 'submittedAt' | 'reviewedAt'>): string {
  const submitted = a.submittedAt ?? '';
  return a.reviewedAt && a.reviewedAt > submitted ? a.reviewedAt : submitted;
}

export type LogEntry<A extends SyncedAttempt = SyncedAttempt> = { t: 'c'; a: A } | { t: 'r'; id: string; at: string; r: SelfReview | null };

/** One upload's answer. `codes` has one letter per attempt sent: a added, m self-review added, d already saved, f account full, x refused. */
export interface PushResult {
  ok: true;
  codes: string;
  /** Log length before and after this upload: entries in [start, end) are this upload's own. */
  start: number;
  end: number;
}

export interface PullResult<A extends SyncedAttempt = SyncedAttempt> {
  ok: true;
  /** The log's generation: it changes when the learner deletes the saved record ("Reset"). */
  gen: string;
  /** When the record was last deleted (null if never). */
  resetAt: string | null;
  /** Where these entries start (0 when the browser's generation was out of date). */
  from: number;
  entries: Array<LogEntry<A>>;
  /** Where the next page starts. */
  next: number;
  /** Entries in the log. */
  total: number;
}
