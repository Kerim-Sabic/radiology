import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { appOrigin } from './config.js';
import { db } from './store.js';
import { equal, type Session } from './auth.js';
import { FREE_EDITION } from './freeEdition.generated.js';
import { weeklyCase } from './free.js';

/**
 * Study activity on the server (only which days someone studied, for streak reminders and retention), email
 * preferences, the daily streak reminder and the Monday case-of-the-week email, and the funnel counters the
 * admin page shows. Study answers themselves stay in the learner's browser.
 */

export interface Profile {
  email: string;
  name: string;
  /** IANA time zone of the learner's browser, for "today". */
  tz: string;
  /** Local days (YYYY-MM-DD) with any study, oldest first, at most the last 120. */
  days: string[];
  prefs: { streak: boolean; weekly: boolean };
  lastStreakMail?: string;
  lastWeeklyMail?: number;
}

export const METRICS = ['visit', 'signup_start', 'signup', 'studied', 'plans', 'checkout', 'paid'] as const;
export type Metric = (typeof METRICS)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const profileKey = (userId: string) => `rvm:profile:${userId}`;
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** The calendar day in a time zone (falls back to UTC for an unknown zone). */
export function localDay(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return utcDay(now);
  }
}
const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000));

/** Days in a row with study, ending on `end` (or the day before, if `end` has none yet). */
export function streakEnding(days: string[], end: string): number {
  const set = new Set(days);
  let d = set.has(end) ? end : addDays(end, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Count one event for today; never fails the request it rides on. */
export async function count(metric: Metric, n = 1) {
  try {
    await db().incrby(`rvm:m:${metric}:${utcDay()}`, n);
  } catch {
    /* metrics are best effort */
  }
}

/** First-time events per account (a sign-up, a first answer, a first payment) are counted once. */
export async function countOnce(metric: Metric, userId: string) {
  try {
    if ((await db().set(`rvm:once:${metric}:${userId}`, utcDay(), { nx: true })) === 'OK') {
      await count(metric);
      if (metric === 'signup') await db().sadd('rvm:users', userId);
    }
  } catch {
    /* metrics are best effort */
  }
}

async function profile(user: Session): Promise<Profile> {
  const p = await db().get<Profile>(profileKey(user.userId));
  return p ?? { email: user.email, name: user.name, tz: 'UTC', days: [], prefs: { streak: false, weekly: false } };
}

const ActivityBody = z.object({ day: z.string().regex(DAY), tz: z.string().max(64) }).strict();

/** The learner studied on this local day (sent at most once a day by the app). */
export async function recordActivity(user: Session, body: unknown) {
  const parsed = ActivityBody.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: 'Expected the day and time zone.' };
  const tz = (() => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: parsed.data.tz });
      return parsed.data.tz;
    } catch {
      return 'UTC';
    }
  })();
  // Only today or yesterday in that zone (an app left open over midnight); never invented history.
  const today = localDay(tz);
  if (parsed.data.day !== today && parsed.data.day !== addDays(today, -1)) return { ok: false as const, error: 'That day is not today.' };
  const p = await profile(user);
  const days = [...new Set([...p.days, parsed.data.day])].sort().slice(-120);
  await db().set(profileKey(user.userId), { ...p, email: user.email, name: user.name, tz, days });
  await db().sadd('rvm:users', user.userId);
  await countOnce('studied', user.userId);
  return { ok: true as const, streak: streakEnding(days, today) };
}

const PrefsBody = z.object({ streak: z.boolean().optional(), weekly: z.boolean().optional() }).strict();

export async function emailPrefs(user: Session, body?: unknown) {
  const p = await profile(user);
  if (body === undefined) return { ok: true as const, prefs: p.prefs };
  const parsed = PrefsBody.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: 'Expected streak and weekly choices.' };
  const prefs = { ...p.prefs, ...parsed.data };
  await db().set(profileKey(user.userId), { ...p, email: user.email, name: user.name, prefs });
  if (prefs.streak || prefs.weekly) await db().sadd('rvm:subscribers', user.userId);
  else await db().srem('rvm:subscribers', user.userId);
  return { ok: true as const, prefs };
}

// ---------------------------------------------------------------- unsubscribe links
type MailKind = 'streak' | 'weekly';
const secret = () => process.env.EMAIL_SECRET || process.env.CRON_SECRET || '';
export function unsubscribeToken(userId: string, kind: MailKind): string {
  return createHmac('sha256', secret()).update(`unsubscribe:${userId}:${kind}`).digest('base64url');
}
export function unsubscribeUrl(userId: string, kind: MailKind): string {
  return `${appOrigin()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&k=${kind}&t=${unsubscribeToken(userId, kind)}`;
}

/** One click from an email (GET from the link, POST from the mail app's unsubscribe button). */
export async function unsubscribe(url: URL): Promise<boolean> {
  const userId = url.searchParams.get('u') ?? '';
  const kind = url.searchParams.get('k');
  const token = url.searchParams.get('t') ?? '';
  if (!secret() || !/^[a-f0-9]{64}$/.test(userId) || (kind !== 'streak' && kind !== 'weekly') || !equal(token, unsubscribeToken(userId, kind))) return false;
  const p = await db().get<Profile>(profileKey(userId));
  if (!p) return true;
  const prefs = { ...p.prefs, [kind]: false };
  await db().set(profileKey(userId), { ...p, prefs });
  if (!prefs.streak && !prefs.weekly) await db().srem('rvm:subscribers', userId);
  return true;
}

// ---------------------------------------------------------------- email
export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribe: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, lines: string[], button: { text: string; url: string }, unsubscribe: string, why: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#1d1d1f">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 24px;font-weight:700;font-size:15px">radiology<span style="color:#4f46e5">.monster</span></p>
<div style="background:#fff;border-radius:18px;padding:28px 26px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.01em">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#424245">${esc(l)}</p>`).join('')}
<p style="margin:22px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">${esc(button.text)}</a></p>
</div>
<p style="margin:18px 6px 0;font-size:12px;line-height:1.5;color:#86868b">${esc(why)} <a href="${esc(unsubscribe)}" style="color:#86868b">Stop these emails</a>. For education only, not for clinical diagnosis.</p>
</div></body></html>`;
  const text = `${title}\n\n${lines.join('\n\n')}\n\n${button.text}: ${button.url}\n\n${why} Stop these emails: ${unsubscribe}`;
  return { html, text };
}

export function streakMail(p: Profile, userId: string, streak: number): Mail {
  const unsubscribe = unsubscribeUrl(userId, 'streak');
  const first = p.name.split(/\s+/)[0] || 'there';
  const { html, text } = layout(
    `Keep your ${streak}-day streak going`,
    [`Hi ${first}, you have studied ${streak} days in a row. One answer today keeps the streak alive; it ends at midnight.`, 'Five minutes is enough: one patient, one finding, one page of the book.'],
    { text: 'Read one scan now', url: `${appOrigin()}/` },
    unsubscribe,
    'You asked for a reminder when your study streak is about to end.',
  );
  return { to: p.email, subject: `Your ${streak}-day streak ends at midnight`, html, text, unsubscribe };
}

export function weeklyMail(p: Profile, userId: string, now = new Date()): Mail {
  const unsubscribe = unsubscribeUrl(userId, 'weekly');
  const id = weeklyCase(now);
  const info = FREE_EDITION.info[id];
  const { html, text } = layout(
    'This week’s case is open',
    [
      `${info ? `${info.title} · ${info.tasks} graded task${info.tasks === 1 ? '' : 's'}.` : 'A new real patient.'} Read it in the full workstation, mark what you see and get graded on the exact slice.`,
      'It is free for every account until Sunday.',
    ],
    { text: 'Read this week’s case', url: `${appOrigin()}/read/${encodeURIComponent(id)}?mode=practice` },
    unsubscribe,
    'You signed up for the case of the week.',
  );
  return { to: p.email, subject: info ? `Case of the week: ${info.title}` : 'This week’s case is open', html, text, unsubscribe };
}

/** Send through Resend (batches of up to 100). Returns how many were accepted. */
export async function sendMails(mails: Mail[]): Promise<number> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !mails.length) return 0;
  let sent = 0;
  for (let i = 0; i < mails.length; i += 100) {
    const batch = mails.slice(i, i + 100).map((m) => ({
      from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }));
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
    if (r.ok) sent += batch.length;
    else console.error('Email batch failed', { status: r.status });
  }
  return sent;
}

export function cronAuthorized(request: Request): boolean {
  const s = process.env.CRON_SECRET;
  const got = request.headers.get('authorization') ?? '';
  return !!s && equal(got, `Bearer ${s}`);
}

async function subscribers(): Promise<Array<{ userId: string; p: Profile }>> {
  const ids = (await db().smembers('rvm:subscribers')) as string[];
  const out: Array<{ userId: string; p: Profile }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const ps = (await db().mget<Profile[]>(...chunk.map(profileKey))) as Array<Profile | null>;
    chunk.forEach((userId, j) => ps[j] && out.push({ userId, p: ps[j]! }));
  }
  return out;
}

/** Daily (evening, UTC): remind learners whose streak of 2+ days ends today if they do not study. */
export async function dailyCron(now = new Date()) {
  const mails: Mail[] = [];
  const marks: Array<{ userId: string; p: Profile }> = [];
  for (const { userId, p } of await subscribers()) {
    if (!p.prefs.streak) continue;
    const today = localDay(p.tz, now);
    if (p.days.includes(today) || p.lastStreakMail === today) continue;
    const run = streakEnding(p.days, today);
    if (run < 2) continue;
    mails.push(streakMail(p, userId, run));
    marks.push({ userId, p: { ...p, lastStreakMail: today } });
  }
  const sent = await sendMails(mails);
  if (sent) for (const m of marks) await db().set(profileKey(m.userId), m.p);
  return { candidates: mails.length, sent };
}

/** Monday morning (UTC): this week's case to everyone who asked for it. */
export async function weeklyCron(now = new Date()) {
  const week = Math.floor((now.getTime() - Date.parse(`${FREE_EDITION.epoch}T00:00:00Z`)) / (7 * 86_400_000));
  const list = (await subscribers()).filter(({ p }) => p.prefs.weekly && p.lastWeeklyMail !== week);
  const sent = await sendMails(list.map(({ userId, p }) => weeklyMail(p, userId, now)));
  if (sent) for (const { userId, p } of list) await db().set(profileKey(userId), { ...p, lastWeeklyMail: week });
  return { candidates: list.length, sent };
}

// ---------------------------------------------------------------- admin numbers
export async function adminStats(now = new Date(), days = 30) {
  const dayList = Array.from({ length: days }, (_, i) => utcDay(new Date(now.getTime() - (days - 1 - i) * 86_400_000)));
  const keys = dayList.flatMap((d) => METRICS.map((m) => `rvm:m:${m}:${d}`));
  const values = (await db().mget<Array<number | null>>(...keys)) as Array<number | string | null>;
  const series = dayList.map((day, i) => ({ day, ...Object.fromEntries(METRICS.map((m, j) => [m, Number(values[i * METRICS.length + j] ?? 0)])) })) as Array<{ day: string } & Record<Metric, number>>;
  const joinedOn = new Map<string, number>();

  // Retention: of accounts that signed up 1+ / 7+ days ago, how many studied again on day 1 / day 7 or later.
  const users = (await db().smembers('rvm:users')) as string[];
  let d1Base = 0;
  let d1 = 0;
  let d7Base = 0;
  let d7 = 0;
  for (let i = 0; i < users.length; i += 100) {
    const chunk = users.slice(i, i + 100);
    const joined = (await db().mget<Array<string | null>>(...chunk.map((u) => `rvm:once:signup:${u}`))) as Array<string | null>;
    const ps = (await db().mget<Profile[]>(...chunk.map(profileKey))) as Array<Profile | null>;
    chunk.forEach((_, j) => {
      const start = joined[j] ?? ps[j]?.days[0];
      if (!start) return;
      if (joined[j]) joinedOn.set(joined[j]!, (joinedOn.get(joined[j]!) ?? 0) + 1);
      const age = Math.floor((now.getTime() - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
      const studied = ps[j]?.days ?? [];
      if (age >= 1) {
        d1Base++;
        if (studied.some((d) => d >= addDays(start, 1))) d1++;
      }
      if (age >= 7) {
        d7Base++;
        if (studied.some((d) => d >= addDays(start, 7))) d7++;
      }
    });
  }
  // Sign-ups per day come from each account's first sign-in date.
  for (const s of series) s.signup = joinedOn.get(s.day) ?? 0;
  const totals = Object.fromEntries(METRICS.map((m) => [m, series.reduce((s, d) => s + d[m], 0)])) as Record<Metric, number>;
  const subs = Number((await db().scard('rvm:subscribers')) ?? 0);
  return { series, totals, accounts: users.length, subscribers: subs, retention: { d1: { base: d1Base, back: d1 }, d7: { base: d7Base, back: d7 } } };
}

export function trackable(event: unknown): Metric | null {
  return event === 'visit' || event === 'signup_start' || event === 'plans' ? event : null;
}
