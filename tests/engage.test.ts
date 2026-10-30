import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the Redis calls the engagement and certificate code uses.
const fake = vi.hoisted(() => ({ kv: new Map<string, unknown>(), sets: new Map<string, Set<string>>() }));
vi.mock('../server/store', () => {
  const store = {
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, v);
      return 'OK';
    },
    del: async (k: string) => fake.kv.delete(k),
    incrby: async (k: string, n: number) => {
      const v = Number(fake.kv.get(k) ?? 0) + n;
      fake.kv.set(k, v);
      return v;
    },
    mget: async (...ks: string[]) => ks.map((k) => fake.kv.get(k) ?? null),
    sadd: async (k: string, m: string) => fake.sets.set(k, new Set([...(fake.sets.get(k) ?? []), m])),
    srem: async (k: string, m: string) => fake.sets.get(k)?.delete(m),
    smembers: async (k: string) => [...(fake.sets.get(k) ?? [])],
    scard: async (k: string) => fake.sets.get(k)?.size ?? 0,
  };
  return { db: () => store, rateLimit: async () => true };
});

import { adminStats, countOnce, dailyCron, emailPrefs, localDay, recordActivity, streakEnding, unsubscribe, unsubscribeToken, unsubscribeUrl, weeklyCron, type Profile } from '../server/engage';

import { markJoined } from '../server/joined';

const uid = 'a'.repeat(64);
const user = { userId: uid, email: 'learner@example.com', name: 'Ada Lovelace', tokenHash: 'x' };
let sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  fake.kv.clear();
  fake.sets.clear();
  sent = [];
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
  vi.stubEnv('EMAIL_SECRET', 'test-secret');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('EMAIL_FROM', 'radiology.monster <hello@radiology.monster>');
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    sent.push(...JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('study days and streaks', () => {
  it('counts days in a row ending today, or yesterday while today is still open', () => {
    expect(streakEnding(['2026-10-26', '2026-10-27', '2026-10-28'], '2026-10-28')).toBe(3);
    expect(streakEnding(['2026-10-26', '2026-10-27', '2026-10-28'], '2026-10-29')).toBe(3);
    expect(streakEnding(['2026-10-25', '2026-10-27'], '2026-10-28')).toBe(1);
    expect(streakEnding([], '2026-10-28')).toBe(0);
    expect(localDay('Asia/Tokyo', new Date('2026-10-29T20:00:00Z'))).toBe('2026-10-30');
    expect(localDay('Not/AZone', new Date('2026-10-29T20:00:00Z'))).toBe('2026-10-29');
  });

  it('records only today or yesterday in the learner’s zone', async () => {
    const today = localDay('Europe/Sarajevo');
    expect((await recordActivity(user, { day: '2020-01-01', tz: 'Europe/Sarajevo' })).ok).toBe(false);
    expect((await recordActivity(user, { day: today, tz: 'Europe/Sarajevo', extra: 1 })).ok).toBe(false);
    const r = await recordActivity(user, { day: today, tz: 'Europe/Sarajevo' });
    expect(r).toEqual({ ok: true, streak: 1 });
    expect((fake.kv.get(`rvm:profile:${uid}`) as Profile).days).toEqual([today]);
    expect(fake.kv.get(`rvm:m:studied:${new Date().toISOString().slice(0, 10)}`)).toBe(1);
    await recordActivity(user, { day: today, tz: 'Europe/Sarajevo' });
    expect(fake.kv.get(`rvm:m:studied:${new Date().toISOString().slice(0, 10)}`)).toBe(1); // first answer counted once
  });
});

describe('emails', () => {
  const profile = (days: string[], prefs = { streak: true, weekly: true }): Profile => ({ email: 'learner@example.com', name: 'Ada Lovelace', tz: 'UTC', days, prefs });

  it('subscribes and unsubscribes with signed one-click links', async () => {
    await emailPrefs(user, { streak: true, weekly: true });
    expect(fake.sets.get('rvm:subscribers')?.has(uid)).toBe(true);
    expect(await unsubscribe(new URL(`https://x/api?u=${uid}&k=weekly&t=wrong`))).toBe(false);
    expect(await unsubscribe(new URL(unsubscribeUrl(uid, 'weekly')))).toBe(true);
    expect((fake.kv.get(`rvm:profile:${uid}`) as Profile).prefs).toEqual({ streak: true, weekly: false });
    expect(await unsubscribe(new URL(`https://x/api?u=${uid}&k=streak&t=${unsubscribeToken(uid, 'streak')}`))).toBe(true);
    expect(fake.sets.get('rvm:subscribers')?.has(uid)).toBe(false);
    expect((await emailPrefs(user, { streak: 'yes' })).ok).toBe(false);
  });

  it('reminds a 2+ day streak that has not studied today, once, with an unsubscribe header', async () => {
    const now = new Date('2026-10-29T17:00:00Z');
    fake.kv.set(`rvm:profile:${uid}`, profile(['2026-10-27', '2026-10-28']));
    fake.sets.set('rvm:subscribers', new Set([uid]));
    expect(await dailyCron(now)).toEqual({ candidates: 1, sent: 1 });
    expect(sent[0].subject).toBe('Your 2-day streak ends at midnight');
    expect((sent[0].headers as Record<string, string>)['List-Unsubscribe']).toContain('/api/email/unsubscribe?u=');
    expect(String(sent[0].html)).toContain('Ada'); // first name
    expect(await dailyCron(now)).toEqual({ candidates: 0, sent: 0 }); // not twice the same day
    // Studied today, a 1-day streak, or reminders off: no email.
    for (const p of [profile(['2026-10-28', '2026-10-29']), profile(['2026-10-28']), profile(['2026-10-27', '2026-10-28'], { streak: false, weekly: true })]) {
      fake.kv.set(`rvm:profile:${uid}`, p);
      expect((await dailyCron(now)).candidates).toBe(0);
    }
  });

  it('sends this week’s case on Monday, once a week, by neutral title', async () => {
    fake.kv.set(`rvm:profile:${uid}`, profile([], { streak: false, weekly: true }));
    fake.sets.set('rvm:subscribers', new Set([uid]));
    const monday = new Date('2026-11-02T07:00:00Z');
    expect(await weeklyCron(monday)).toEqual({ candidates: 1, sent: 1 });
    expect(String(sent[0].subject)).toMatch(/^Case of the week: Patient [A-Z]+ · /);
    expect(String(sent[0].text)).toContain('/read/');
    expect((await weeklyCron(monday)).sent).toBe(0);
    expect((await weeklyCron(new Date('2026-11-09T07:00:00Z'))).sent).toBe(1);
  });
});

describe('funnel numbers for the admin page', () => {
  it('counts sign-ups by first sign-in day and day-1 / day-7 returns', async () => {
    const now = new Date('2026-10-29T12:00:00Z');
    fake.kv.set(`rvm:once:signup:${uid}`, '2026-10-20');
    fake.sets.set('rvm:users', new Set([uid]));
    fake.kv.set(`rvm:profile:${uid}`, { email: 'a', name: 'a', tz: 'UTC', days: ['2026-10-20', '2026-10-28'], prefs: { streak: false, weekly: false } });
    fake.kv.set('rvm:m:visit:2026-10-29', 12);
    const s = await adminStats(now, 30);
    expect(s.totals.visit).toBe(12);
    expect(s.series.find((d) => d.day === '2026-10-20')?.signup).toBe(1);
    expect(s.retention).toEqual({ d1: { base: 1, back: 1 }, d7: { base: 1, back: 1 } });
    await markJoined('b'.repeat(64));
    await countOnce('paid', uid);
    await countOnce('paid', uid);
    expect(fake.kv.get(`rvm:m:paid:${new Date().toISOString().slice(0, 10)}`)).toBe(1);
  });
});
