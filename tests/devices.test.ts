import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ records: new Map<string, unknown>(), clerkIdentity: vi.fn(), revoke: vi.fn() }));
vi.mock('../server/clerk', () => ({ clerkIdentity: fake.clerkIdentity, revokeOtherClerkSessions: fake.revoke }));
vi.mock('../server/store', () => {
  const store = {
    get: async (key: string) => fake.records.get(key) ?? null,
    set: async (key: string, value: unknown, opts?: { nx?: boolean }) => { if (opts?.nx && fake.records.has(key)) return null; fake.records.set(key, value); return 'OK'; },
    del: async (key: string) => fake.records.delete(key),
    smembers: async () => [],
    multi: () => { const pending: [string, unknown][] = []; return { set: (k: string, v: unknown) => pending.push([k, v]), exec: async () => { for (const [k, v] of pending) fake.records.set(k, v); } }; },
  };
  return { db: () => store, rateLimit: async () => true };
});
vi.mock('../server/oauth', () => ({ merchantToken: async () => 'test-token', exchange: vi.fn(), identity: vi.fn(), revoke: vi.fn() }));

import { DEVICE_LIMIT, DeviceLimitError, deviceLabel, deviceSummary, recordSignIn, signInsKey, type SignIn } from '../server/devices';
import { createSession, hash } from '../server/auth';
import { handle } from '../server/handler';

const DAY = 86400000;
const now = Date.parse('2026-11-05T12:00:00Z');
const signIn = (device: string, daysAgo: number, country: string | null = 'BA'): SignIn => ({ at: new Date(now - daysAgo * DAY).toISOString(), device, country, label: 'Windows · Chrome' });
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const windowsChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

beforeEach(() => {
  fake.records.clear(); fake.clerkIdentity.mockReset(); fake.revoke.mockReset(); fake.revoke.mockResolvedValue(undefined);
  for (const [k, v] of Object.entries({ ADMIN_EMAILS: '', OWNER_EMAILS: '', APP_URL: 'https://radiology.monster', WHOP_APP_ID: 'app_test', CLERK_SECRET_KEY: 'test', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x', KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test', WELCOME_EMAIL: 'off' })) vi.stubEnv(k, v);
});
afterAll(() => vi.unstubAllEnvs());

describe('device names', () => {
  it.each([
    [iphone, 'iPhone · Safari'],
    [windowsChrome, 'Windows · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36 Instagram 300.0', 'Android · Instagram'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/133.0', 'Mac · Firefox'],
    ['', 'Unknown device'],
  ])('%s → %s', (ua, label) => expect(deviceLabel(ua)).toBe(label));
});

describe('what looks like sharing', () => {
  it('leaves a normal student alone: phone, laptop and a library computer in one country', () => {
    expect(deviceSummary([signIn('phone', 1), signIn('laptop', 3), signIn('library', 9), signIn('phone', 12)], now)).toEqual({ devices: 3, countries: ['BA'], signIns: 4, flagged: false });
  });
  it('flags six devices, three countries, or two countries within a day', () => {
    expect(deviceSummary(['a', 'b', 'c', 'd', 'e', 'f'].map((d, i) => signIn(d, i)), now)?.flagged).toBe(true);
    expect(deviceSummary([signIn('a', 1, 'BA'), signIn('a', 5, 'DE'), signIn('a', 20, 'AT')], now)?.flagged).toBe(true);
    expect(deviceSummary([signIn('a', 1, 'BA'), signIn('b', 1.5, 'TR')], now)?.flagged).toBe(true);
    expect(deviceSummary([signIn('a', 1, 'BA'), signIn('a', 6, 'HR')], now)?.flagged).toBe(false);
  });
  it('forgets sign-ins older than 30 days', () => {
    expect(deviceSummary([signIn('a', 31), signIn('b', 40)], now)).toBeNull();
  });
});

describe('the device limit', () => {
  const fill = (n: number, daysAgo = 2) => fake.records.set(signInsKey('u1'), Array.from({ length: n }, (_, i) => signIn(`device${i}`, daysAgo + i * 0.1)));
  it('lets a known device back in at the limit, and refuses a new one until a slot opens', async () => {
    fill(DEVICE_LIMIT);
    await expect(recordSignIn('u1', { device: 'device3', country: 'BA', userAgent: iphone }, false, now)).resolves.toMatchObject({ device: 'device3', label: 'iPhone · Safari' });
    const refused = await recordSignIn('u1', { device: 'brand-new', country: 'BA' }, false, now).catch((e) => e);
    expect(refused).toBeInstanceOf(DeviceLimitError);
    // The oldest device was last seen 2.9 days ago; it leaves the 30-day window 27.1 days from now.
    expect(Date.parse(refused.until)).toBeCloseTo(now - 2.9 * DAY + 30 * DAY, -3);
    expect(refused.message).toContain('10 different devices');
  });
  it('allows a new device below the limit, and when older devices age out', async () => {
    fill(DEVICE_LIMIT - 1);
    await expect(recordSignIn('u1', { device: 'new', country: 'BA' }, false, now)).resolves.toBeTruthy();
    fill(DEVICE_LIMIT, 31);
    await expect(recordSignIn('u1', { device: 'another', country: 'BA' }, false, now)).resolves.toBeTruthy();
  });
  it('has no limit for admins and professors', async () => {
    fill(DEVICE_LIMIT + 5);
    await expect(recordSignIn('u1', { device: 'new', country: 'BA' }, true, now)).resolves.toBeTruthy();
  });
  it('keeps the newest sign-ins first, without the IP', async () => {
    await recordSignIn('u1', { device: 'a', country: 'ba', userAgent: windowsChrome }, false, now);
    await recordSignIn('u1', { device: 'b', country: 'XYZ', userAgent: iphone }, false, now + 1000);
    expect(fake.records.get(signInsKey('u1'))).toEqual([
      { at: new Date(now + 1000).toISOString(), device: 'b', country: null, label: 'iPhone · Safari' },
      { at: new Date(now).toISOString(), device: 'a', country: 'BA', label: 'Windows · Chrome' },
    ]);
  });
  it('is enforced at sign-in, for everyone but admins', async () => {
    const userId = hash('clerk:sub1');
    fake.records.set(signInsKey(userId), Array.from({ length: DEVICE_LIMIT }, (_, i) => signIn(`d${i}`, 1)));
    await expect(createSession({ sub: 'sub1', email: 'student@example.com', emailVerified: true, provider: 'clerk' }, { device: 'new' })).rejects.toBeInstanceOf(DeviceLimitError);
    expect(fake.records.has(`rvm:device:${userId}`)).toBe(false);
    vi.stubEnv('ADMIN_EMAILS', 'student@example.com');
    await expect(createSession({ sub: 'sub1', email: 'student@example.com', emailVerified: true, provider: 'clerk' }, { device: 'new' })).resolves.toContain('__Host-rvm-session=');
  });
});

describe('signing in', () => {
  const signInRequest = (cookie = '', ua = windowsChrome, country = 'BA') => new Request('https://radiology.monster/api/auth/session', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', Origin: 'https://radiology.monster', cookie, 'user-agent': ua, 'x-vercel-ip-country': country }, body: '{}' });
  const cookies = (r: Response) => r.headers.getSetCookie();
  const value = (all: string[], name: string) => all.find((c) => c.startsWith(`${name}=`))!.split(';')[0];
  beforeEach(() => fake.clerkIdentity.mockResolvedValue({ sub: 'clerk_ana', sid: 'sess_laptop', provider: 'clerk', email: 'ana@example.com', emailVerified: true, name: 'Ana' }));

  it('gives the browser a device id, logs the sign-in and ends every other Clerk sign-in', async () => {
    const r = await handle(signInRequest());
    expect(r.status).toBe(200);
    const set = cookies(r);
    expect(value(set, '__Host-rvm-device')).toMatch(/^__Host-rvm-device=[\w-]{20,}$/);
    expect(fake.revoke).toHaveBeenCalledWith('clerk_ana', 'sess_laptop');
    expect(fake.records.get(signInsKey(hash('clerk:clerk_ana')))).toMatchObject([{ country: 'BA', label: 'Windows · Chrome' }]);
    // Next time this browser already has its id: no new cookie.
    const again = await handle(signInRequest(value(set, '__Host-rvm-device')));
    expect(cookies(again).some((c) => c.startsWith('__Host-rvm-device='))).toBe(false);
  });
  it('still signs in when Clerk cannot end the other sign-ins', async () => {
    fake.revoke.mockRejectedValue(new Error('Clerk is down'));
    expect((await handle(signInRequest())).status).toBe(200);
  });
  it('explains the device limit instead of a generic error', async () => {
    fake.records.set(signInsKey(hash('clerk:clerk_ana')), Array.from({ length: DEVICE_LIMIT }, (_, i) => signIn(`d${i}`, 1)));
    const r = await handle(signInRequest());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('different devices in the last 30 days');
  });
  it('tells a browser that was signed out where and when the account was opened', async () => {
    const laptop = cookies(await handle(signInRequest()));
    const laptopCookies = `${value(laptop, '__Host-rvm-session')}; ${value(laptop, '__Host-rvm-device')}`;
    const phone = cookies(await handle(signInRequest('', iphone, 'DE')));
    const session = (cookie: string) => handle(new Request('https://radiology.monster/api/session', { headers: { cookie } }));
    const ended = await session(laptopCookies);
    expect(ended.status).toBe(401);
    expect(await ended.json()).toMatchObject({ endedBy: { label: 'iPhone · Safari', country: 'DE' } });
    // The phone itself is signed in; a browser with no session hears nothing about anyone.
    expect((await session(`${value(phone, '__Host-rvm-session')}; ${value(phone, '__Host-rvm-device')}`)).status).toBe(200);
    expect(await (await session('')).json()).not.toHaveProperty('endedBy');
  });
  it('says nothing when the same browser signed in again', async () => {
    const first = cookies(await handle(signInRequest()));
    const device = value(first, '__Host-rvm-device');
    await handle(signInRequest(device));
    const r = await handle(new Request('https://radiology.monster/api/session', { headers: { cookie: `${value(first, '__Host-rvm-session')}; ${device}` } }));
    expect(r.status).toBe(401);
    expect(await r.json()).not.toHaveProperty('endedBy');
  });
});
