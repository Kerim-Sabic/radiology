/**
 * The account's saved study record: an append-only log of committed attempts in Redis, one per account, so answers
 * made on one device appear on every other device after sign-in. Professors and admins never read it; only the
 * signed-in learner's own requests do.
 *
 * Keys (userId is the account's hash):
 *   rvm:progress:{userId}:ids    hash   attempt id → its saved version (submittedAt, or the newest self-review time)
 *   rvm:progress:{userId}:log    list   JSON entries in arrival order (see shared/progressSync.ts)
 *   rvm:progress:{userId}:bytes  string bytes held in the log, for the per-account limit
 *   rvm:progress:{userId}:gen    {id, at} changes when the learner deletes the record, so other devices notice
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import { ATTEMPT_ID, attemptVersion, ISO_TIME, SYNC_LIMITS, type LogEntry, type PullResult, type PushResult, type SelfReview } from '../shared/progressSync.js';

const key = (userId: string, part: 'ids' | 'log' | 'bytes' | 'gen') => `rvm:progress:${userId}:${part}`;
/** The Upstash client (tests pass an in-memory one that runs the same Lua). */
type Redis = ReturnType<typeof db>;

/**
 * Appends a batch in one atomic step. For each attempt: a new id is committed whole; a known id with a newer
 * self-review adds only that verdict; anything else (the same copy again, an older copy) adds nothing.
 * KEYS: ids, log, bytes. ARGV: maxAttempts, maxBytes, n, then per attempt: id, version, commit JSON, review JSON ('' if none).
 * Returns {start, end, codes}: the log length before and after, and one letter per attempt (a, m, d, f).
 */
export const APPEND_SCRIPT = `
local maxIds, maxBytes, n = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local start = redis.call('LLEN', KEYS[2])
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
local count = redis.call('HLEN', KEYS[1])
local codes = ''
local grew = false
for i = 0, n - 1 do
  local base = 4 + i * 4
  local id, ver, commit, review = ARGV[base], ARGV[base + 1], ARGV[base + 2], ARGV[base + 3]
  local cur = redis.call('HGET', KEYS[1], id)
  if not cur then
    if count >= maxIds or used + #commit > maxBytes then
      codes = codes .. 'f'
    else
      redis.call('HSET', KEYS[1], id, ver)
      redis.call('RPUSH', KEYS[2], commit)
      count = count + 1
      used = used + #commit
      grew = true
      codes = codes .. 'a'
    end
  elseif review ~= '' and ver > cur then
    if used + #review > maxBytes then
      codes = codes .. 'f'
    else
      redis.call('HSET', KEYS[1], id, ver)
      redis.call('RPUSH', KEYS[2], review)
      used = used + #review
      grew = true
      codes = codes .. 'm'
    end
  else
    codes = codes .. 'd'
  end
end
if grew then redis.call('SET', KEYS[3], used) end
return {start, redis.call('LLEN', KEYS[2]), codes}
`;

const SelfReviewShape = z.object({ checked: z.array(z.string().max(200)).max(50), verdict: z.enum(['correct', 'partial', 'incorrect']).nullable() });
/** The fields the log relies on are checked; the rest of the attempt is kept as the app wrote it. */
const AttemptShape = z.looseObject({
  id: z.string().regex(ATTEMPT_ID),
  taskId: z.string().min(1).max(200),
  caseId: z.string().min(1).max(200),
  submittedAt: z.string().regex(ISO_TIME),
  reviewedAt: z.string().regex(ISO_TIME).nullish(),
  selfReview: SelfReviewShape.nullable(),
});
const Body = z.object({ attempts: z.array(z.unknown()).min(1).max(SYNC_LIMITS.batch) });

export type PushResponse = PushResult | { ok: false; error: string; status: number };

/** Save a batch of committed attempts for this account. Attempts the server refuses are marked x and not stored. */
export async function pushAttempts(userId: string, raw: string, redis: Redis = db()): Promise<PushResponse> {
  if (raw.length > SYNC_LIMITS.bodyChars) return { ok: false, error: 'Too much at once. Send fewer attempts.', status: 413 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Not a valid upload.', status: 400 };
  }
  const body = Body.safeParse(parsed);
  if (!body.success) return { ok: false, error: `Send between 1 and ${SYNC_LIMITS.batch} attempts.`, status: 400 };
  const prepared = body.data.attempts.map((value) => prepare(value));
  const args: string[] = [];
  const sent: number[] = [];
  prepared.forEach((p, i) => {
    if (!p) return;
    sent.push(i);
    args.push(p.id, p.version, p.commit, p.review);
  });
  const codes = prepared.map(() => 'x');
  if (!sent.length) return { ok: true, codes: codes.join(''), start: 0, end: 0 };
  const [start, end, stored] = await redis.eval<string[], [number, number, string]>(
    APPEND_SCRIPT,
    [key(userId, 'ids'), key(userId, 'log'), key(userId, 'bytes')],
    [String(SYNC_LIMITS.maxAttempts), String(SYNC_LIMITS.maxBytes), String(sent.length), ...args],
  );
  sent.forEach((i, k) => (codes[i] = String(stored)[k] ?? 'x'));
  return { ok: true, codes: codes.join(''), start: Number(start), end: Number(end) };
}

/** An attempt ready for the log, or null when it is not a committed attempt the server can keep. */
export function prepare(value: unknown): { id: string; version: string; commit: string; review: string } | null {
  const a = AttemptShape.safeParse(value);
  if (!a.success) return null;
  const commit = JSON.stringify({ t: 'c', a: a.data } satisfies LogEntry);
  if (commit.length > SYNC_LIMITS.attemptChars) return null;
  const version = attemptVersion(a.data);
  const review = a.data.selfReview ? JSON.stringify({ t: 'r', id: a.data.id, at: version, r: a.data.selfReview as SelfReview } satisfies LogEntry) : '';
  return { id: a.data.id, version, commit, review };
}

interface Gen {
  id: string;
  at: string;
}

/** Read the log from `after` (a page at a time). A browser on an older generation starts again from the beginning. */
export async function pullAttempts(userId: string, after: number, clientGen: string | null, redis: Redis = db()): Promise<PullResult> {
  const read = async (start: number) => {
    const tx = redis.multi();
    tx.get<Gen>(key(userId, 'gen'));
    tx.llen(key(userId, 'log'));
    tx.lrange(key(userId, 'log'), start, start + SYNC_LIMITS.page - 1);
    const [g, total, rows] = (await tx.exec()) as [Gen | null, number, unknown[] | null];
    return { gen: g?.id ?? '', resetAt: g?.at ?? null, total: Number(total) || 0, rows: rows ?? [] };
  };
  let from = Math.max(0, Math.floor(after) || 0);
  let page = await read(from);
  if (clientGen !== null && clientGen !== page.gen && from !== 0) {
    // The record was deleted since this browser last read it: its position means nothing now, so start again.
    const gen = page.gen;
    from = 0;
    page = await read(0);
    if (page.gen !== gen) return { ok: true, gen: page.gen, resetAt: page.resetAt, from: 0, entries: [], next: 0, total: page.total };
  }
  const { gen, resetAt, total, rows } = page;
  const entries: LogEntry[] = [];
  let chars = 0;
  for (const row of rows) {
    const entry = (typeof row === 'string' ? JSON.parse(row) : row) as LogEntry;
    const size = typeof row === 'string' ? row.length : JSON.stringify(row).length;
    if (entries.length && chars + size > SYNC_LIMITS.pageChars) break;
    entries.push(entry);
    chars += size;
  }
  return { ok: true, gen, resetAt, from, entries, next: from + entries.length, total };
}

/** Delete the account's saved record (Progress → Reset). Other devices see the new generation and clear what they had. */
export async function resetAttempts(userId: string, redis: Redis = db()): Promise<{ ok: true; gen: string; resetAt: string }> {
  const gen: Gen = { id: `g${randomBytes(9).toString('base64url')}`, at: new Date().toISOString() };
  const tx = redis.multi();
  tx.del(key(userId, 'ids'), key(userId, 'log'), key(userId, 'bytes'));
  tx.set(key(userId, 'gen'), gen);
  await tx.exec();
  return { ok: true, gen: gen.id, resetAt: gen.at };
}
