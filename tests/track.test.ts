/**
 * The funnel counters (/api/track, /api/track/opened) leave out the same traffic as the event log (server/events.ts
 * dropReason): previews and localhost, the e2e suite, automated browsers, bots and the team.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ kv: new Map<string, unknown>(), counts: new Map<string, number>() }));
vi.mock('../server/store', () => {
  const known: Record<string, (...a: any[]) => unknown> = {
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, v);
      return 'OK';
    },
    del: async (k: string) => fake.kv.delete(k),
    incrby: async (k: string, n: number) => fake.counts.set(k, (fake.counts.get(k) ?? 0) + n).get(k),
    multi: () => {
      const pending: Array<[string, unknown]> = [];
      return { set: (k: string, v: unknown) => pending.push([k, v]), exec: async () => pending.forEach(([k, v]) => fake.kv.set(k, v)) };
    },
  };
  // Anything else the server touches on the way answers "nothing there".
  const store = new Proxy(known, { get: (t, p: string) => t[p] ?? (async () => null) });
  return { db: () => store, rateLimit: async () => true };
});

import { createSession } from '../server/auth';
import { handle } from '../server/handler';

const PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Instagram 357.0';
const counted = (metric: string) => [...fake.counts.entries()].filter(([k]) => k.startsWith(`rvm:m:${metric}:`)).reduce((n, [, v]) => n + v, 0);

function track(body: Record<string, unknown>, { host = 'www.radiology.monster', headers = {} as Record<string, string>, path = '/api/track' } = {}) {
  return handle(
    new Request(`https://${host}${path}`, {
      method: 'POST',
      headers: { origin: `https://${host}`, 'content-type': 'application/json', 'user-agent': PHONE, 'x-forwarded-for': '203.0.113.9', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  fake.kv.clear();
  fake.counts.clear();
  for (const [k, v] of Object.entries({ ADMIN_EMAILS: 'kerim@example.com', OWNER_EMAILS: '', APP_URL: 'https://www.radiology.monster', CLERK_SECRET_KEY: 'test', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x', KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test', WELCOME_EMAIL: 'off' }))
    vi.stubEnv(k, v);
});
afterAll(() => vi.unstubAllEnvs());

describe('the funnel counters', () => {
  it('count a real visitor on the site', async () => {
    const r = await track({ event: 'guest_answer' });
    expect(await r.json()).toEqual({ ok: true });
    expect(counted('guest_answer')).toBe(1);
  });

  it('leave out the e2e suite, automated browsers, bots, previews and localhost, with the same answer', async () => {
    const dropped = [
      track({ event: 'guest_answer' }, { headers: { 'x-rvm-test': '1' } }),
      track({ event: 'guest_answer', wd: true }),
      track({ event: 'guest_answer' }, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }),
      track({ event: 'guest_answer' }, { headers: { 'user-agent': 'Mozilla/5.0 HeadlessChrome/130.0' } }),
      track({ event: 'guest_answer' }, { host: 'radiology-git-main-kerim.vercel.app' }),
      track({ event: 'guest_answer' }, { host: 'localhost:4317' }),
    ];
    for (const r of await Promise.all(dropped)) expect(await r.json()).toEqual({ ok: true });
    expect(counted('guest_answer')).toBe(0);
  });

  it('leave out the team: an admin signed in counts nothing, a student does', async () => {
    const cookieOf = async (email: string, sub: string) => (await createSession({ sub, email, emailVerified: true, provider: 'clerk' })).split(';')[0];
    await track({ event: 'plans' }, { headers: { cookie: await cookieOf('kerim@example.com', 'admin1') } });
    expect(counted('plans')).toBe(0);
    await track({ event: 'plans' }, { headers: { cookie: await cookieOf('student@example.com', 'student1') } });
    expect(counted('plans')).toBe(1);
  });

  it('count a first case opened once per account, never for the e2e suite or an automated browser', async () => {
    const cookie = (await createSession({ sub: 's2', email: 'learner@example.com', emailVerified: true, provider: 'clerk' })).split(';')[0];
    await track({ wd: true }, { path: '/api/track/opened', headers: { cookie } });
    await track({}, { path: '/api/track/opened', headers: { cookie, 'x-rvm-test': '1' } });
    expect(fake.kv.has(`rvm:once:opened:${(await import('../server/auth')).hash('clerk:s2')}`)).toBe(false);
    await track({}, { path: '/api/track/opened', headers: { cookie } });
    expect(counted('opened')).toBe(1);
  });

  it('still refuse an unknown event', async () => {
    const r = await track({ event: 'nope' });
    expect(r.status).toBe(400);
  });
});
