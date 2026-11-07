import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { CLIENT_EVENTS, EV_HOSTS, SERVER_EVENTS, type PropType, type ServerEvent } from '../shared/events.js';
import { db, rateLimit } from './store.js';

/**
 * The anonymous event log (docs/TRACKING.md): one Redis list per UTC day (`rvm:ev:<day>`, kept 90 days), one entry per
 * batch: `{ vid, sid, a?, c, d, os, et?, sd?, tag?, ev: [[t, name, props?], …] }`.
 *
 * - **Kept:** what the browser sent after validation, plus the country, device class and OS family from the request,
 *   and the signed-in account as a salted hash (`a`), so a visitor's journey joins their account's journey.
 * - **Never kept:** IP addresses, user agents, emails, names, free text or card data.
 * - **Dropped:** previews and localhost, the e2e suite (`x-rvm-test`), automated browsers, bots, and admin, owner or
 *   professor accounts (Kerim's own visits; `?internal=1` stops his signed-out devices in the browser).
 */
export const EV_DAYS_KEPT = 90;
const MAX_EVENTS_PER_10_MIN = 400;
const ID = /^[0-9a-z]{16}$/;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios/i;

const value = z.union([z.string().max(80).refine((s) => !s.includes('@')), z.number().finite(), z.boolean()]);
const Batch = z
  .object({
    v: z.literal(1),
    vid: z.string().regex(ID),
    sid: z.string().regex(ID),
    tag: z.string().max(80).optional(),
    et: z.enum(['slow-2g', '2g', '3g', '4g']).optional(),
    sd: z.boolean().optional(),
    wd: z.boolean().optional(),
    ev: z.array(z.tuple([z.number().int().positive(), z.string().max(24), z.record(z.string().max(16), value).optional()])).min(1).max(30),
  })
  .strict();
export type EvBatch = z.infer<typeof Batch>;

/** Props allowed for an event: only the dictionary's keys, each of its type. */
export function validProps(spec: Record<string, PropType>, props: Record<string, unknown> | undefined): boolean {
  for (const [k, v] of Object.entries(props ?? {})) {
    const t = spec[k];
    if (!t || (t === 's' && typeof v !== 'string') || (t === 'n' && typeof v !== 'number') || (t === 'b' && typeof v !== 'boolean')) return false;
  }
  return true;
}

/** A batch the browser sent, checked against the dictionary; null when anything in it is unknown or malformed. */
export function parseBatch(body: unknown): EvBatch | null {
  const parsed = Batch.safeParse(body);
  if (!parsed.success) return null;
  for (const [, name, props] of parsed.data.ev) {
    const spec = (CLIENT_EVENTS as Record<string, Record<string, PropType>>)[name];
    if (!spec || !validProps(spec, props)) return null;
  }
  return parsed.data;
}

export type Who = 'visitor' | 'account' | 'internal';

/** Why a request's events are not kept, or null when they are. */
export function dropReason(request: Request, batch: Pick<EvBatch, 'wd'>, who: Who): string | null {
  const host = new URL(request.url).hostname;
  if (!EV_HOSTS.includes(host)) return 'host';
  if (request.headers.get('x-rvm-test')) return 'test';
  if (batch.wd) return 'automation';
  if (BOT.test(request.headers.get('user-agent') ?? '')) return 'bot';
  if (who === 'internal') return 'internal';
  return null;
}

/** Device class and OS family from the user agent (the user agent itself is never kept). */
export function device(ua: string): { d: 'phone' | 'tablet' | 'desktop'; os: 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other' } {
  const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /mac os/i.test(ua) ? 'mac' : /linux/i.test(ua) ? 'linux' : 'other';
  const d = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'phone' : 'desktop';
  return { d, os };
}

/** A signed-in account in the log: a salted hash, the same for every event of that account and useless without the secret. */
export function accountHash(userId: string): string {
  const secret = process.env.EVENT_SALT || process.env.EMAIL_SECRET || process.env.CRON_SECRET || 'rvm-dev-only';
  return createHmac('sha256', secret).update(`ev:${userId}`).digest('base64url').slice(0, 16);
}

export const evKey = (day: string) => `rvm:ev:${day}`;
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

async function append(entry: Record<string, unknown>) {
  const key = evKey(utcDay());
  await db().rpush(key, JSON.stringify(entry));
  await db().expire(key, EV_DAYS_KEPT * 86_400);
}

/** POST /api/ev: always answers 204, kept or not, so nothing tells a client what is filtered. */
export async function ingestEvents(request: Request, body: unknown, who: Who, userId?: string): Promise<{ kept: boolean; reason?: string }> {
  const batch = parseBatch(body);
  if (!batch) return { kept: false, reason: 'invalid' };
  const reason = dropReason(request, batch, who);
  if (reason) return { kept: false, reason };
  if (!(await rateLimit(`ev:${batch.vid}`, MAX_EVENTS_PER_10_MIN, 600).catch(() => true))) return { kept: false, reason: 'rate' };
  const { d, os } = device(request.headers.get('user-agent') ?? '');
  const c = (request.headers.get('x-vercel-ip-country') ?? '').toUpperCase().slice(0, 2) || undefined;
  await append({ vid: batch.vid, sid: batch.sid, ...(userId ? { a: accountHash(userId) } : {}), c, d, os, et: batch.et, sd: batch.sd, tag: batch.tag, ev: batch.ev });
  return { kept: true };
}

/** An event only the server can know (a checkout created, a payment): logged against the account's hash. */
export async function logServerEvent(name: ServerEvent, userId: string, props?: Record<string, string | number | boolean>, request?: Request) {
  try {
    if (!validProps(SERVER_EVENTS[name], props)) return;
    const c = (request?.headers.get('x-vercel-ip-country') ?? '').toUpperCase().slice(0, 2) || undefined;
    await append({ a: accountHash(userId), srv: 1, c, ev: [[Date.now(), name, props]] });
  } catch {
    /* the log is best effort */
  }
}

/** The stored batches of one day, oldest first (for the admin's Journeys and the export). */
export async function readDay(day: string): Promise<StoredBatch[]> {
  const rows = (await db().lrange(evKey(day), 0, -1)) as Array<string | StoredBatch>;
  return rows.map((r) => (typeof r === 'string' ? (JSON.parse(r) as StoredBatch) : r));
}

export interface StoredBatch {
  vid?: string;
  sid?: string;
  a?: string;
  c?: string;
  d?: string;
  os?: string;
  et?: string;
  sd?: boolean;
  tag?: string;
  srv?: 1;
  ev: Array<[number, string, Record<string, string | number | boolean>?]>;
}
