import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Redis, Whop and Resend stand-ins for the welcome email, the welcome gift a day later and its personal code.
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

import { earlierAccounts, firstName, offerMail, sendWelcome, sendWelcomeOffer, studentNote, welcomeCode, welcomeCron, welcomeEarlierAccounts, welcomeMail, welcomeNewAccount } from '../server/welcome';
import { ownWelcomeCode, welcomeKey, welcomeOffer, type WelcomeRecord } from '../server/welcomeCode';
import { checkoutDiscount } from '../server/studentDiscount';
import { unsubscribe, unsubscribeUrl } from '../server/engage';
import { timeLeft, welcomeTerms } from '../src/auth/welcomeOffer';
import { allRegionalPlans } from '../server/config';

const uid = 'b'.repeat(64);
const other = 'c'.repeat(64);
const user = { userId: uid, email: 'ana@example.com', name: 'Ana Šarić' };
type Mail = { to: string[]; from: string; subject: string; html: string; text: string; headers: Record<string, string> };
let mails: Mail[] = [];
const HOUR = 3_600_000;
const MIN = 60_000;

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

/** A new account signs in for the first time; the welcome goes out in the background. */
async function joined(who = user, country?: string) {
  await welcomeNewAccount(who, country);
  await Promise.all(fake.background);
  return fake.kv.get(welcomeKey(who.userId)) as WelcomeRecord;
}
/** The record's time of sign-up, plus some hours. */
const after = (r: WelcomeRecord, hours: number) => Date.parse(r.joinedAt) + hours * HOUR;
/** Signed up, then the welcome cron ran 24 hours later and sent the gift. */
async function gifted(who = user, country?: string) {
  const r = await joined(who, country);
  await welcomeCron(after(r, 24));
  return fake.kv.get(welcomeKey(who.userId)) as WelcomeRecord;
}
const record = (r: Partial<WelcomeRecord> = {}): WelcomeRecord => ({ email: 'ana@uni.edu', name: 'Ana', joinedAt: new Date().toISOString(), code: 'welcome-ana-abcde', expiresAt: new Date(Date.now() + 72 * HOUR).toISOString(), ...r });

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

describe('the welcome email, at sign-up', () => {
  it('goes out at once with the free case, and no code and no offer', async () => {
    const before = Date.now();
    const r = await joined();
    expect(fake.create).not.toHaveBeenCalled();
    expect(r.code).toBeUndefined();
    expect(r.sentAt).toBeTruthy();
    expect(Date.parse(r.offerDueAt!) - Date.parse(r.joinedAt)).toBe(24 * HOUR);
    expect(Date.parse(r.joinedAt)).toBeGreaterThanOrEqual(before);

    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.to).toEqual(['ana@example.com']);
    expect(m.from).toBe('Radiology Monster <hello@radiology.monster>');
    expect(m.subject).toBe('Welcome, Ana. Your first scan is ready');
    expect(m.html).toContain('Welcome, Ana.');
    expect(m.html).toContain('<b>Radiology Monster</b>');
    expect(`${m.html}${m.text}`).not.toContain('Kerim');
    expect(m.html).toContain('/read/cxr-00003400-003?task=cxr-00003400-003%3Alocate&amp;mode=practice');
    for (const words of ['40%', 'welcome-', 'promo=', 'gift', '30% off']) expect(`${m.html}${m.text}`).not.toContain(words);
    expect(m.html).toContain('because you just created an account');
    expect(m.headers['List-Unsubscribe']).toContain('k=offers');
  });

  it('is sent once, however often sign-in or the cron runs', async () => {
    const r = await joined();
    await welcomeNewAccount(user);
    await sendWelcome(uid);
    await welcomeCron(after(r, 1));
    expect(mails).toHaveLength(1);
  });

  it('is not sent to an account that already has access (a member, an admin, free access from a class), nor the gift later', async () => {
    fake.access = { active: true };
    const r = await joined();
    expect(r.noOffer).toBe(true);
    expect(mails).toHaveLength(0);
    expect(await welcomeCron(after(r, 25))).toEqual({ welcomed: 0, offered: 0, reminded: 0 });
    expect(fake.create).not.toHaveBeenCalled();
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
});

describe('the welcome gift, 24 hours after sign-up', () => {
  it('waits a day, then makes the code (40% off the first payment, both plans and the regional ones, one use) and emails it', async () => {
    const r = await joined();
    mails = [];
    expect(await welcomeCron(after(r, 24) - MIN)).toEqual({ welcomed: 0, offered: 0, reminded: 0 });
    expect(fake.create).not.toHaveBeenCalled();
    expect(mails).toHaveLength(0);

    const sentAt = after(r, 24) + 10 * MIN;
    expect(await welcomeCron(sentAt)).toEqual({ welcomed: 0, offered: 1, reminded: 0 });
    expect(fake.create).toHaveBeenCalledTimes(1);
    const body = fake.create.mock.calls[0][0];
    expect(body).toMatchObject({ account_id: 'biz_1', product_id: 'prod_1', plan_ids: ['plan_m', 'plan_y', ...allRegionalPlans().map((p) => p.id)], promo_type: 'percentage', amount_off: 40, promo_duration_months: 1, one_per_customer: true, unlimited_stock: false, stock: 1 });
    expect(body.code).toMatch(/^welcome-ana-[a-z2-9]{5}$/);
    // The 72 hours start with this email, not at sign-up.
    expect(Date.parse(body.expires_at)).toBe(sentAt + 72 * HOUR);
    const g = fake.kv.get(welcomeKey(uid)) as WelcomeRecord;
    expect(g).toMatchObject({ code: body.code, expiresAt: body.expires_at, offerSentAt: new Date(sentAt).toISOString() });
    expect(await ownWelcomeCode(uid, body.code)).toBe(true);
    expect(await ownWelcomeCode(other, body.code)).toBe(false);

    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.subject).toBe('Ana, a welcome gift: 40% off your first payment');
    expect(m.html).toContain('You joined Radiology Monster yesterday');
    expect(m.html).toContain(body.code.toUpperCase());
    expect(m.html).toContain('$90 for your first year instead of $150');
    expect(m.html).toContain('$12 for your first month instead of $20');
    expect(m.html).toContain(`/?plans&amp;promo=${body.code}&amp;utm_source=email&amp;utm_campaign=welcome_gift`);
    expect(m.text).toContain(body.code.toUpperCase());
    expect(`${m.html}${m.text}`).not.toContain('Kerim');
    expect(m.headers['List-Unsubscribe']).toContain('k=offers');
  });

  it('is shown in the app only once its email has gone out, and never before', async () => {
    const r = await joined();
    expect(await welcomeOffer(uid)).toBeNull();
    // The code is made but its email fails: still nothing in the app, and the next run sends that same code.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    expect(await sendWelcomeOffer(uid, after(r, 24))).toBe('later');
    const made = fake.kv.get(welcomeKey(uid)) as WelcomeRecord;
    expect(made.code).toBeTruthy();
    expect(made.offerSentAt).toBeUndefined();
    expect(await welcomeOffer(uid, after(r, 24))).toBeNull();
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      mails.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    });
    expect((await welcomeCron(after(r, 24) + 10 * MIN)).offered).toBe(1);
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(mails.at(-1)!.html).toContain(made.code!.toUpperCase());
    const offer = await welcomeOffer(uid, after(r, 25));
    expect(offer).toEqual({ code: made.code, expiresAt: made.expiresAt, percent: 40 });
    expect(await welcomeOffer(uid, Date.parse(made.expiresAt!) + 1)).toBeNull();
    expect(await welcomeOffer(other)).toBeNull();
  });

  it('is sent once and makes one code, however often the cron runs', async () => {
    const r = await joined();
    await welcomeCron(after(r, 24));
    await welcomeCron(after(r, 24) + 10 * MIN);
    await sendWelcomeOffer(uid, after(r, 30));
    expect(mails.filter((m) => m.subject.includes('welcome gift'))).toHaveLength(1);
    expect(fake.create).toHaveBeenCalledTimes(1);
  });

  it('is skipped for an account that has a plan or free access by then, or whose payment is pending', async () => {
    for (const access of [{ active: true }, { active: false, pendingMembership: true }]) {
      fake.kv.clear();
      fake.sets.clear();
      mails = [];
      fake.access = { active: false };
      const r = await joined();
      fake.access = access;
      expect((await welcomeCron(after(r, 24))).offered).toBe(0);
      expect((fake.kv.get(welcomeKey(uid)) as WelcomeRecord).noOffer).toBe(true);
      expect(mails).toHaveLength(1); // the welcome only
    }
    fake.kv.clear();
    fake.sets.clear();
    fake.access = { active: false };
    const r = await joined();
    fake.kv.set(`rvm:once:paid:${uid}`, '2026-11-06');
    expect((await welcomeCron(after(r, 24))).offered).toBe(0);
    expect(fake.create).not.toHaveBeenCalled();
    // Nothing left waiting for it.
    expect(await welcomeCron(after(r, 48))).toEqual({ welcomed: 0, offered: 0, reminded: 0 });
  });

  it('is skipped for anyone who stopped offer emails, and waits while Whop cannot say who pays', async () => {
    let r = await joined();
    expect(await unsubscribe(new URL(unsubscribeUrl(uid, 'offers')))).toBe(true);
    expect((await welcomeCron(after(r, 24))).offered).toBe(0);
    expect(fake.create).not.toHaveBeenCalled();

    fake.kv.clear();
    fake.sets.clear();
    r = await joined();
    fake.access = new Error('Whop is down');
    expect(await sendWelcomeOffer(uid, after(r, 24))).toBe('later');
    expect(fake.create).not.toHaveBeenCalled();
    fake.access = { active: false };
    expect((await welcomeCron(after(r, 24) + 10 * MIN)).offered).toBe(1);
  });

  it('gives up on the offer when Whop gives no promo access, and retries other errors', async () => {
    let r = await joined();
    fake.create.mockRejectedValueOnce(Object.assign(new Error('no'), { statusCode: 403 }));
    expect((await welcomeCron(after(r, 24))).offered).toBe(0);
    expect((fake.kv.get(welcomeKey(uid)) as WelcomeRecord).noOffer).toBe(true);
    expect(mails).toHaveLength(1);

    fake.kv.clear();
    fake.sets.clear();
    mails = [];
    r = await joined();
    fake.create.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 503 }));
    expect((await welcomeCron(after(r, 24))).offered).toBe(0);
    expect((await welcomeCron(after(r, 24) + 10 * MIN)).offered).toBe(1);
    expect(mails.at(-1)!.html).toContain('40% off your first payment');
  });

  it('tries a new code when Whop refuses one that is taken', async () => {
    const r = await joined();
    fake.create.mockRejectedValueOnce(Object.assign(new Error('taken'), { statusCode: 422 }));
    await welcomeCron(after(r, 24));
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect((fake.kv.get(welcomeKey(uid)) as WelcomeRecord).code).toBe(fake.create.mock.calls[1][0].code);
  });

  it('quotes the price for the country the account signed up from, while regional prices are on there', async () => {
    fake.kv.set('rvm:regional:live', true);
    await gifted({ ...user, userId: 'd'.repeat(64) }, 'ba');
    await gifted(user, 'IN');
    expect((fake.kv.get(welcomeKey(uid)) as WelcomeRecord).country).toBe('IN');
    const [ba, india] = mails.filter((m) => m.subject.includes('welcome gift'));
    expect(ba.html).toContain('$5.99 for your first month instead of $9.99');
    expect(ba.html).toContain('$44.99 for your first year instead of $74.99');
    expect(ba.html).toContain('prices for Bosnia');
    expect(ba.text).toContain('$5.99 for your first month instead of $9.99');
    expect(india.html).toContain('$2.99 instead of $4.99');
    expect(india.html).toContain('$23.99 instead of $39.99');
    expect(india.html).toContain('never renews');
    expect(india.html).not.toContain('$12 for your first month');
  });

  it('quotes the standard price elsewhere, and while regional prices are off', async () => {
    await gifted(user, 'BA');
    await gifted({ ...user, userId: 'd'.repeat(64) }, 'US');
    const gifts = mails.filter((m) => m.subject.includes('welcome gift'));
    expect(gifts).toHaveLength(2);
    for (const m of gifts) expect(m.html).toContain('$12 for your first month instead of $20');
    expect((fake.kv.get(welcomeKey('d'.repeat(64))) as WelcomeRecord).country).toBeUndefined();
  });
});

describe('the student price beside the code', () => {
  const regional = (student?: { monthly: number; yearly: number }, pass = false) => ({ region: (pass ? 'c' : 'b') as 'b' | 'c', country: pass ? 'IN' : 'BA', countryName: pass ? 'India' : 'Bosnia & Herzegovina', monthly: { price: pass ? 4.99 : 9.99, pass }, yearly: { price: pass ? 39.99 : 74.99, pass }, ...(student ? { student } : {}) });

  it('is mentioned only to a verified university email', () => {
    const r = record();
    expect(offerMail(uid, r, { student: true, replies: false }).html).toContain('30% off every renewal without the code ($14 a month or $105 a year)');
    expect(offerMail(uid, r, { student: false, replies: false }).html).not.toContain('30% off every');
    expect(welcomeMail(uid, r, { student: true, replies: false }).html).toContain('30% off every renewal');
    expect(offerMail(uid, r, { student: false, replies: true }).html).toContain('Just reply to this email');
    expect(welcomeMail(uid, r, { student: false, replies: true }).html).toContain('just reply to this email');
  });

  it('quotes the student price for the country once student prices are on there, and nothing while they are off', () => {
    expect(studentNote(true, regional())).toBe('');
    expect(studentNote(true, regional({ monthly: 6.99, yearly: 52.49 }))).toBe('Your university email also gets 30% off every payment without the code ($6.99 a month or $52.49 a year): choose whichever suits you.');
    expect(studentNote(true, regional({ monthly: 3.49, yearly: 27.99 }, true))).toBe('Your university email also gets 30% off every pass without the code ($3.49 for 30 days or $27.99 for a year): choose whichever suits you.');
    expect(studentNote(false, regional({ monthly: 6.99, yearly: 52.49 }))).toBe('');
    const m = offerMail(uid, record(), { student: true, replies: false, regional: regional({ monthly: 6.99, yearly: 52.49 }) });
    expect(m.html).toContain('$6.99 a month or $52.49 a year');
    expect(m.text).toContain('$6.99 a month or $52.49 a year');
  });

  it('comes from the live regional price in the gift email of a verified student', async () => {
    fake.kv.set('rvm:regional:live', true);
    fake.kv.set('rvm:regional:student-live', true);
    fake.kv.set('rvm:student-discount-ready', true);
    fake.kv.set(`rvm:identity:${uid}`, { email: 'ana@unsa.edu.ba', emailVerified: true });
    await gifted(user, 'BA');
    expect(mails.at(-1)!.html).toContain('30% off every payment without the code ($6.99 a month or $52.49 a year)');
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
  it('goes once, in the code\'s last day, to an unused code', async () => {
    const r = await gifted();
    const ends = Date.parse(r.expiresAt!);
    mails = [];
    expect((await welcomeCron(ends - 30 * HOUR)).reminded).toBe(0);
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(1);
    const m = mails[0];
    expect(m.subject).toBe('Ana, your 40% off ends in 10 hours');
    expect(`${m.html}${m.text}`).not.toContain('Kerim');
    expect(m.html).toContain(r.code!.toUpperCase());
    expect((await welcomeCron(ends - 5 * HOUR)).reminded).toBe(0);
    expect(mails).toHaveLength(1);
  });

  it('goes about 24 hours before the end now that the cron runs every 10 minutes (48 hours after the gift)', async () => {
    const r = await gifted();
    const ends = Date.parse(r.expiresAt!);
    mails = [];
    expect((await welcomeCron(ends - 24 * HOUR - 10 * MIN)).reminded).toBe(0);
    expect((await welcomeCron(ends - 24 * HOUR + 10 * MIN)).reminded).toBe(1);
    expect(mails[0].subject).toBe('Ana, your 40% off ends in 23 hours');
  });

  it('skips a code already used, an account that paid, and anyone who stopped offer emails', async () => {
    let r = await gifted();
    let ends = Date.parse(r.expiresAt!);
    fake.retrieve.mockResolvedValueOnce({ uses: 1, status: 'active' });
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);

    fake.kv.clear();
    fake.sets.clear();
    r = await gifted();
    ends = Date.parse(r.expiresAt!);
    fake.kv.set(`rvm:once:paid:${uid}`, '2026-11-05');
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);

    fake.kv.clear();
    fake.sets.clear();
    r = await gifted();
    ends = Date.parse(r.expiresAt!);
    expect(await unsubscribe(new URL(unsubscribeUrl(uid, 'offers')))).toBe(true);
    expect((await welcomeCron(ends - 10 * HOUR)).reminded).toBe(0);
  });
});

describe('the offer in the app and at checkout', () => {
  it('still shows a code that went out with an older welcome (records from before the gift waited a day)', async () => {
    const legacy = record({ email: 'ana@example.com', sentAt: new Date().toISOString() });
    fake.kv.set(welcomeKey(uid), legacy);
    expect(await welcomeOffer(uid)).toEqual({ code: legacy.code, expiresAt: legacy.expiresAt, percent: 40 });
    // A new record whose code is made but not yet emailed is not shown.
    fake.kv.set(welcomeKey(uid), { ...legacy, offerDueAt: legacy.joinedAt });
    expect(await welcomeOffer(uid)).toBeNull();
  });

  it('is honoured at checkout only for its own account', async () => {
    const r = await gifted();
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

  it('says what the code takes off, at the standard price or at the price for the visitor\'s country', () => {
    expect(welcomeTerms(40)).toContain('Yearly $90 for your first year instead of $150 · Monthly $12 for your first month instead of $20');
    const country = { country: 'BA', countryName: 'Bosnia and Herzegovina' };
    expect(welcomeTerms(40, { ...country, region: 'b', monthly: { price: 9.99, pass: false }, yearly: { price: 74.99, pass: false } }))
      .toBe('Yearly $44.99 for your first year instead of $74.99 · Monthly $5.99 for your first month instead of $9.99. Renewals at the price for Bosnia and Herzegovina.');
    expect(welcomeTerms(40, { ...country, region: 'c', monthly: { price: 4.99, pass: true }, yearly: { price: 39.99, pass: true } }))
      .toBe('1-year pass $23.99 instead of $39.99 · 30-day pass $2.99 instead of $4.99. One payment, nothing renews.');
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
    // The gift waits for the welcome.
    expect(await sendWelcomeOffer(uid, after(r, 24))).toBe('later');
    fake.access = { active: false };
    expect(await welcomeCron(after(r, 24))).toEqual({ welcomed: 1, offered: 1, reminded: 0 });
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

  it('sends each one once, with its own code in the welcome (they signed up long ago), and says why they get it', async () => {
    fake.people = [person('1', 'one@example.com', 'none'), person('2', 'two@example.com', 'none')];
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 2, skipped: 0, failed: 0, left: 0 });
    expect(mails.map((m) => m.to[0])).toEqual(['one@example.com', 'two@example.com']);
    const html = mails[0].html;
    expect(html).toContain('Welcome, Lejla.');
    expect(html).toContain('because you created an account');
    expect(html).not.toContain('just created');
    expect(html).toContain('40% off your first payment');
    expect(fake.create).toHaveBeenCalledTimes(2);
    const r = fake.kv.get(welcomeKey('1'.repeat(64))) as WelcomeRecord;
    expect(r.offerSentAt).toBeTruthy();
    expect(await welcomeOffer('1'.repeat(64))).toMatchObject({ code: r.code });
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 0, skipped: 0, failed: 0, left: 0 });
    // No second email a day later.
    expect((await welcomeCron(Date.now() + 25 * HOUR)).offered).toBe(0);
    expect(mails).toHaveLength(2);
  });

  it('skips anyone Whop shows as a member at the moment of sending', async () => {
    fake.people = [person('1', 'one@example.com', 'none')];
    fake.access = { active: true };
    expect(await welcomeEarlierAccounts()).toEqual({ ok: true, sent: 0, skipped: 1, failed: 0, left: 0 });
    expect(mails).toHaveLength(0);
  });
});
