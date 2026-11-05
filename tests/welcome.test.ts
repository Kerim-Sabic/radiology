import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Redis, Whop and Resend stand-ins for the welcome email and its personal code.
const fake = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),
  background: [] as Promise<unknown>[],
  access: { active: false } as { active: boolean; pendingMembership?: boolean } | Error,
  people: [] as Array<Record<string, unknown>>,
  whop: 'ok' as string,
  create: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('../server/store', () => {
  const store = {
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, v);
      return 'OK';
    },
    del: async (k: string) => fake.kv.delete(k),
    mget: async (...ks: string[]) => ks.map((k) => fake.kv.get(k) ?? null),
    sadd: async (k: string, m: string) => fake.sets.set(k, new Set([...(fake.sets.get(k) ?? []), m])),
    srem: async (k: string, m: string) => fake.sets.get(k)?.delete(m),
    smembers: async (k: string) => [...(fake.sets.get(k) ?? [])],
  };
  return { db: () => store, rateLimit: async () => true };
});
vi.mock('../server/admin', () => ({ everyone: async () => ({ whop: fake.whop, people: fake.people }) }));
vi.mock('../server/billing', () => ({
  accessFor: async () => {
    if (fake.access instanceof Error) throw fake.access;
    return fake.access;
  },
  whop: async () => ({ promoCodes: { create: fake.create, retrieve: fake.retrieve } }),
}));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => fake.background.push(p) }));

import { earlierAccounts, firstName, sendWelcome, welcomeCode, welcomeCron, welcomeEarlierAccounts, welcomeMail, welcomeNewAccount } from '../server/welcome';
import { ownWelcomeCode, welcomeKey, welcomeOffer, type WelcomeRecord } from '../server/welcomeCode';
import { checkoutDiscount } from '../server/studentDiscount';
import { unsubscribe, unsubscribeUrl } from '../server/engage';
import { timeLeft } from '../src/auth/welcomeOffer';

const uid = 'b'.repeat(64);
const other = 'c'.repeat(64);
const user = { userId: uid, email: 'ana@example.com', name: 'Ana Šarić' };
let mails: Array<Record<string, unknown>> = [];
const HOUR = 3_600_000;

beforeEach(() => {
  fake.kv.clear();
  fake.sets.clear();
  fake.background = [];
  fake.access = { active: false };
  fake.people = [];
  fake.whop = 'ok';
  fake.create.mockReset().mockImplementation(async (body: { code: string }) => ({ id: 'promo_1', code: body.code }));
  fake.retrieve.mockReset().mockResolvedValue({ uses: 0, status: 'active' });
  mails = [];
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
  vi.stubEnv('EMAIL_SECRET', 'test-secret');
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('EMAIL_FROM', 'Kerim at Radiology Monster <hello@radiology.monster>');
  vi.stubEnv('WHOP_ACCOUNT_ID', 'biz_1');
  vi.stubEnv('WHOP_PRODUCT_ID', 'prod_1');
  vi.stubEnv('WHOP_MONTHLY_PLAN_ID', 'plan_m');
  vi.stubEnv('WHOP_YEARLY_PLAN_ID', 'plan_y');
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    mails.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function joined() {
  await welcomeNewAccount(user);
  await Promise.all(fake.background);
  return fake.kv.get(welcomeKey(uid)) as WelcomeRecord;
}

describe('personal welcome codes', () => {
  it('carry the first name, without accents, and an unambiguous random tail', () => {
    expect(welcomeCode('Ana Šarić', () => 0)).toBe('welcome-ana-aaaaa');
    expect(welcomeCode('Émile', () => 0.999)).toBe('welcome-emile-99999');
    expect(welcomeCode('ana@example.com')).toMatch(/^welcome-[a-z2-9]{5}$/);
    expect(welcomeCode('Maximiliana Long')).toMatch(/^welcome-maximili-[a-z2-9]{5}$/);
    expect(welcomeCode('Ana').length).toBeLessThanOrEqual(30);
    expect(firstName('ana smith')).toBe('Ana');
    expect(firstName('ana@example.com')).toBe('');
  });
});

describe('the welcome email', () => {
  it('goes out on the first sign-in with a personal 40% code for the first payment, both plans, one use, 72 hours', async () => {
    const before = Date.now();
    const r = await joined();
    expect(fake.create).toHaveBeenCalledTimes(1);
    const body = fake.create.mock.calls[0][0];
    expect(body).toMatchObject({ account_id: 'biz_1', product_id: 'prod_1', plan_ids: ['plan_m', 'plan_y'], promo_type: 'percentage', amount_off: 40, promo_duration_months: 1, one_per_customer: true, unlimited_stock: false, stock: 1 });
    expect(body.code).toMatch(/^welcome-ana-[a-z2-9]{5}$/);
    const ends = Date.parse(body.expires_at);
    expect(ends - before).toBeGreaterThanOrEqual(72 * HOUR - 1000);
    expect(ends - before).toBeLessThanOrEqual(72 * HOUR + 5000);
    expect(r.code).toBe(body.code);
    expect(r.sentAt).toBeTruthy();
    expect(await ownWelcomeCode(uid, body.code)).toBe(true);
    expect(await ownWelcomeCode(other, body.code)).toBe(false);

    expect(mails).toHaveLength(1);
    const m = mails[0] as { to: string[]; subject: string; html: string; text: string; headers: Record<string, string> };
    expect(m.to).toEqual(['ana@example.com']);
    expect((mails[0] as { from: string }).from).toBe('Radiology Monster <hello@radiology.monster>');
    expect(m.html).toContain('<b>Radiology Monster</b>');
    expect(`${m.html}${m.text}`).not.toContain('Kerim');
    expect(m.subject).toBe('Ana, your first scan is ready (and 40% off is yours)');
    expect(m.html).toContain(body.code.toUpperCase());
    expect(m.html).toContain('$90 for your first year instead of $150');
    expect(m.html).toContain('$12 for your first month instead of $20');
    expect(m.html).toContain(`/?plans&amp;promo=${body.code}`);
    expect(m.html).toContain('/read/cxr-00003400-003?task=cxr-00003400-003%3Alocate&amp;mode=practice');
    expect(m.html).toContain('Welcome, Ana.');
    expect(m.text).toContain(body.code.toUpperCase());
    expect(m.headers['List-Unsubscribe']).toContain('k=offers');
  });

  it('is sent once, however often sign-in or the cron runs', async () => {
    await joined();
    await welcomeNewAccount(user);
    await sendWelcome(uid);
    await welcomeCron();
    expect(mails).toHaveLength(1);
    expect(fake.create).toHaveBeenCalledTimes(1);
  });

  it('is not sent to an account that already has access (a member, an admin, free access from a class)', async () => {
    fake.access = { active: true };
    const r = await joined();
    expect(fake.create).not.toHaveBeenCalled();
    expect(r.noOffer).toBe(true);
    expect(mails).toHaveLength(0);
    expect(await welcomeCron()).toEqual({ welcomed: 0, reminded: 0 });
  });

  it('without an offer, still welcomes and points to the first case', () => {
    const r: WelcomeRecord = { email: 'ana@example.com', name: 'Ana', joinedAt: new Date().toISOString(), noOffer: true };
    const m = welcomeMail(uid, r, { student: false, replies: false });
    expect(m.subject).toBe('Welcome, Ana. Your first scan is ready');
    expect(m.html).not.toContain('40%');
    expect(m.html).toContain('Read your first scan');
  });

  it('goes out without an offer when Whop gives no promo access, and waits for the cron after other errors', async () => {
    fake.create.mockRejectedValueOnce(Object.assign(new Error('no'), { statusCode: 403 }));
    const r = await joined();
    expect(r.noOffer).toBe(true);
    expect(mails).toHaveLength(1);

    fake.kv.clear();
    fake.sets.clear();
    mails = [];
    fake.create.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 503 }));
    await joined();
    expect(mails).toHaveLength(0);
    expect(await welcomeCron()).toEqual({ welcomed: 1, reminded: 0 });
    expect((mails[0] as { html: string }).html).toContain('40% off your first payment');
  });

  it('tries a new code when Whop refuses one that is taken', async () => {
    fake.create.mockRejectedValueOnce(Object.assign(new Error('taken'), { statusCode: 422 }));
    const r = await joined();
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(r.code).toBe(fake.create.mock.calls[1][0].code);
  });

  it('is not sent without the email settings, or when switched off', async () => {
    vi.stubEnv('WELCOME_EMAIL', 'off');
    await joined();
    vi.stubEnv('WELCOME_EMAIL', '');
    vi.stubEnv('RESEND_API_KEY', '');
    await joined();
    expect(mails).toHaveLength(0);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('mentions the student price only to a verified university email', () => {
    const r: WelcomeRecord = { email: 'ana@uni.edu', name: 'Ana', joinedAt: new Date().toISOString(), code: 'welcome-ana-abcde', expiresAt: new Date(Date.now() + 72 * HOUR).toISOString() };
    expect(welcomeMail(uid, r, { student: true, replies: false }).html).toContain('30% off every renewal');
    expect(welcomeMail(uid, r, { student: false, replies: false }).html).not.toContain('30% off every renewal');
    expect(welcomeMail(uid, r, { student: false, replies: true }).html).toContain('just reply to this email');
  });
});

describe('the sender', () => {
  it('is always shown as Radiology Monster, at the configured address', async () => {
    const { mailFrom } = await import('../server/mailbox');
    vi.stubEnv('EMAIL_FROM', 'Kerim Sabic <hello@radiology.monster>');
    expect(mailFrom()).toBe('Radiology Monster <hello@radiology.monster>');
    vi.stubEnv('EMAIL_FROM', 'hello@radiology.monster');
    expect(mailFrom()).toBe('Radiology Monster <hello@radiology.monster>');
    vi.stubEnv('EMAIL_FROM', '');
    expect(mailFrom()).toBeNull();
  });
});

describe('the reminder', () => {
  it('goes once, in the last day, to an unused code', async () => {
    const r = await joined();
    const ends = Date.parse(r.expiresAt!);
    mails = [];
    expect((await welcomeCron(ends - 30 * HOUR)).reminded).toBe(0);
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(1);
    const m = mails[0] as { subject: string; html: string; text: string };
    expect(m.subject).toBe('Ana, your 40% off ends in 10 hours');
    expect(`${m.html}${m.text}`).not.toContain('Kerim');
    expect(m.html).toContain(r.code!.toUpperCase());
    expect((await welcomeCron(ends - 5 * HOUR)).reminded).toBe(0);
    expect(mails).toHaveLength(1);
  });

  it('skips a code already used, an account that paid, and anyone who stopped offer emails', async () => {
    let r = await joined();
    let ends = Date.parse(r.expiresAt!);
    fake.retrieve.mockResolvedValueOnce({ uses: 1, status: 'active' });
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);

    fake.kv.clear();
    fake.sets.clear();
    r = await joined();
    ends = Date.parse(r.expiresAt!);
    fake.kv.set(`rvm:once:paid:${uid}`, '2026-11-05');
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);

    fake.kv.clear();
    fake.sets.clear();
    r = await joined();
    ends = Date.parse(r.expiresAt!);
    expect(await unsubscribe(new URL(unsubscribeUrl(uid, 'offers')))).toBe(true);
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);
  });
});

describe('the offer in the app and at checkout', () => {
  it('is shown while it works, then disappears', async () => {
    const r = await joined();
    expect(await welcomeOffer(uid)).toEqual({ code: r.code, expiresAt: r.expiresAt, percent: 40 });
    expect(await welcomeOffer(uid, Date.parse(r.expiresAt!) + 1)).toBeNull();
    expect(await welcomeOffer(other)).toBeNull();
  });

  it('is honoured at checkout only for its own account', async () => {
    const r = await joined();
    const client = {} as never;
    await expect(checkoutDiscount(client, uid, 'yearly', 'plan_y', r.code!.toUpperCase())).resolves.toEqual({ promoCode: r.code, studentDiscount: false, welcome: true });
    await expect(checkoutDiscount(client, other, 'yearly', 'plan_y', r.code)).rejects.toThrow('belongs to another account');
  });

  it('counts down in plain words', () => {
    expect(timeLeft(0)).toBeNull();
    expect(timeLeft(5 * 60_000)).toBe('5 min');
    expect(timeLeft(3 * HOUR + 12 * 60_000)).toBe('3 h 12 min');
    expect(timeLeft(2 * 24 * HOUR + 5 * HOUR)).toBe('2 days 5 h');
    expect(timeLeft(24 * HOUR)).toBe('1 day');
  });
});

describe('never to members', () => {
  it('skips an account whose membership waits on a payment, and waits when Whop cannot answer', async () => {
    fake.access = { active: false, pendingMembership: true };
    let r = await joined();
    expect(r.noOffer).toBe(true);
    expect(mails).toHaveLength(0);
    expect(fake.create).not.toHaveBeenCalled();

    fake.kv.clear();
    fake.sets.clear();
    fake.access = new Error('Whop is down');
    r = await joined();
    expect(r.sentAt).toBeUndefined();
    expect(mails).toHaveLength(0);
    expect(fake.create).not.toHaveBeenCalled();
  });
});

describe('accounts made before the welcome email', () => {
  const person = (id: string, email: string, access: string, account: string | null = 'clerk') => ({ userId: id.repeat(64), email, name: 'Lejla Hodžić', account, access });

  it('counts only accounts without a plan that never had it and did not stop offers', async () => {
    fake.people = [
      person('1', 'free@example.com', 'none'),
      person('2', 'paid@example.com', 'paid'),
      person('3', 'admin@example.com', 'admin'),
      person('4', 'prof@example.com', 'professor'),
      person('5', 'gift@example.com', 'free'),
      person('6', 'stopped@example.com', 'none'),
      person('7', 'welcomed@example.com', 'none'),
      person('8', 'paidbefore@example.com', 'none'),
      person('9', 'noaccount@example.com', 'free', null),
    ];
    fake.kv.set(`rvm:no-offers:${'6'.repeat(64)}`, true);
    fake.kv.set(welcomeKey('7'.repeat(64)), { email: 'welcomed@example.com', name: 'W', joinedAt: '2026-11-05T00:00:00Z', sentAt: '2026-11-05T00:00:00Z' });
    fake.kv.set(`rvm:once:paid:${'8'.repeat(64)}`, '2026-11-01');
    const r = await earlierAccounts();
    expect(r.ok && r.waiting.map((p) => p.email)).toEqual(['free@example.com']);
    expect(r.ok && r.counts).toEqual({ waiting: 1, welcomed: 1, stopped: 1, members: 5 });
  });

  it('refuses when Whop cannot say who pays', async () => {
    fake.whop = 'unavailable';
    fake.people = [person('1', 'free@example.com', 'none')];
    expect(await earlierAccounts()).toMatchObject({ ok: false });
    expect(await welcomeEarlierAccounts()).toMatchObject({ ok: false });
    expect(mails).toHaveLength(0);
  });

  it('sends each one once, with its own code, and says why they get it', async () => {
    fake.people = [person('1', 'one@example.com', 'none'), person('2', 'two@example.com', 'none')];
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 2, skipped: 0, failed: 0, left: 0 });
    expect(mails.map((m) => (m.to as string[])[0])).toEqual(['one@example.com', 'two@example.com']);
    const html = (mails[0] as { html: string }).html;
    expect(html).toContain('Welcome, Lejla.');
    expect(html).toContain('because you created an account');
    expect(html).not.toContain('just created');
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 0, skipped: 0, failed: 0, left: 0 });
    expect(mails).toHaveLength(2);
  });

  it('skips anyone Whop shows as a member at the moment of sending', async () => {
    fake.people = [person('1', 'one@example.com', 'none')];
    fake.access = { active: true };
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 0, skipped: 1, failed: 0, left: 0 });
    expect(mails).toHaveLength(0);
  });
});
