import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Whop } from '@whop/sdk';

const fake = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  members: [] as unknown[],
  memberships: [] as unknown[],
  /** Payments by membership id (access checks) and by plan id (the admin page). */
  byMembership: new Map<string, unknown[]>(),
  byPlan: new Map<string, unknown[]>(),
  variants: new Map<string, unknown>(),
  checkoutCalls: [] as Array<{ body: Record<string, unknown> }>,
}));
vi.mock('../server/clerk', () => ({ clerkIdentity: vi.fn() }));
vi.mock('../server/store', () => {
  const store = {
    get: async (key: string) => fake.records.get(key) ?? null,
    set: async (key: string, value: unknown, opts?: { nx?: boolean }) => { if (opts?.nx && fake.records.has(key)) return null; fake.records.set(key, value); return 'OK'; },
    del: async (key: string) => fake.records.delete(key),
    multi: () => { const pending: [string, unknown][] = []; return { set: (k: string, v: unknown) => pending.push([k, v]), exec: async () => { for (const [k, v] of pending) fake.records.set(k, v); } }; },
  };
  return { db: () => store, rateLimit: async () => true };
});
vi.mock('../server/oauth', () => ({ merchantToken: async () => 'test-token', exchange: vi.fn(), identity: vi.fn(), revoke: vi.fn() }));
vi.mock('../server/welcomeCode', () => ({ welcomeOffer: async () => null, ownWelcomeCode: async () => false, WELCOME_PREFIX: 'welcome-' }));
vi.mock('@whop/sdk', () => ({ WhopClient: class {
  promoCodes = { list: async () => [] };
  members = { list: async () => ({ async *[Symbol.asyncIterator]() { yield* fake.members; } }) };
  memberships = { list: async () => ({ data: fake.memberships, async *[Symbol.asyncIterator]() { yield* fake.memberships; } }) };
  payments = {
    list: async (q: { membership_id?: string; plan_id?: string }) => ({ data: q.membership_id ? fake.byMembership.get(q.membership_id) ?? [] : fake.byPlan.get(q.plan_id!) ?? [] }),
    retrieve: async ({ id }: { id: string }) => [...fake.byMembership.values(), ...fake.byPlan.values()].flat().find((p) => (p as { id: string }).id === id),
  };
  variants = { retrieve: async ({ id }: { id: string }) => fake.variants.get(id) ?? standardPlan(id) };
  checkoutConfigurations = { create: async (body: Record<string, unknown>) => { fake.checkoutCalls.push({ body }); return { id: 'ch_test', purchase_url: 'https://whop.com/checkout/ch_test' }; } };
} }));

function standardPlan(id: string) {
  return { id, account: { id: 'biz_test' }, currency: 'usd', plan_type: 'renewal', billing_period: id === 'plan_yearly' ? 365 : 30, initial_price: 0, renewal_price: id === 'plan_yearly' ? 150 : 20, adaptive_pricing_enabled: false };
}

import { regionalPlans, type RegionalPlan } from '../server/config';
import { ruleBlocked, regionalOffer, regionalPlanProblems, regionOf, regionalStatus, setRegionalLive } from '../server/regional';
import { accessFor, checkout, membershipAccess, whop } from '../server/billing';
import { handle } from '../server/handler';
import { hash } from '../server/auth';

const B = regionalPlans.b, C = regionalPlans.c;
const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
/** A regional plan as Whop returns it when it is set up right. */
function whopPlan(p: RegionalPlan, changes: Record<string, unknown> = {}) {
  return {
    id: p.id, account: { id: 'biz_test' }, product: { id: 'prod_test' }, currency: 'usd', visibility: 'hidden', trial_period_days: null, split_pay_required_payments: null, adaptive_pricing_enabled: false,
    plan_type: p.pass ? 'one_time' : 'renewal', initial_price: p.pass ? p.price : 0, renewal_price: p.pass ? 0 : p.price, billing_period: p.pass ? null : p.days, expiration_days: p.pass ? p.days : null,
    effective_payment_method_configuration: { enabled: ['card', 'apple_pay', 'google_pay'], disabled: [], include_platform_defaults: false },
    ...changes,
  } as unknown as Whop.Variant;
}
/** A regional payment that went through (no rule declined it). */
const approved = (id: string, changes = {}) => ({ id, status: 'paid', substatus: 'succeeded', created_at: new Date().toISOString(), usd_total: 9.99, payment_rule_matches: [], ...changes });
/** One the card rule declined. */
const declined = (id: string) => ({ id, status: 'open', substatus: 'failed', created_at: new Date().toISOString(), usd_total: 9.99, payment_rule_matches: [{ id: 'prule_9', action: 'block', name: 'RVM regional block $9.99 unless B card' }] });
const goLive = () => fake.records.set('rvm:regional:live', true);

beforeEach(() => {
  fake.records.clear(); fake.members = []; fake.memberships = []; fake.byMembership.clear(); fake.byPlan.clear(); fake.variants.clear(); fake.checkoutCalls = [];
  for (const p of [B.monthly, B.yearly, C.monthly, C.yearly]) fake.variants.set(p.id, whopPlan(p));
  for (const [k, v] of Object.entries({ ADMIN_EMAILS: '', OWNER_EMAILS: '', APP_URL: 'https://radiology.monster', WHOP_APP_ID: 'app_test', WHOP_API_KEY: 'test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_PRODUCT_ID: 'prod_test', WHOP_MONTHLY_PLAN_ID: 'plan_monthly', WHOP_YEARLY_PLAN_ID: 'plan_yearly', KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test', WELCOME_EMAIL: 'off' })) vi.stubEnv(k, v);
});
afterAll(() => vi.unstubAllEnvs());

describe('which countries get which price', () => {
  it.each([['BA', 'b'], ['rs', 'b'], ['BR', 'b'], ['IN', 'c'], ['PK', 'c'], ['UZ', 'c'], ['US', null], ['DE', null], ['', null], [null, null], ['BAX', null]])('%s → %s', (country, region) => {
    expect(regionOf(country)).toBe(region);
  });
  it('is off until an admin turns it on, and never for countries outside the regions', async () => {
    expect(await regionalOffer('BA')).toBeNull();
    goLive();
    expect(await regionalOffer('BA')).toMatchObject({ region: 'b', country: 'BA', countryName: 'Bosnia & Herzegovina', monthly: { price: 9.99, pass: false }, yearly: { price: 74.99, pass: false } });
    expect(await regionalOffer('IN')).toMatchObject({ region: 'c', monthly: { price: 4.99, pass: true }, yearly: { price: 39.99, pass: true } });
    expect(await regionalOffer('US')).toBeNull();
    expect(await regionalOffer(null)).toBeNull();
  });
});

describe('checking a regional plan in Whop', () => {
  it('passes a plan that is set up right', () => {
    for (const p of [B.monthly, B.yearly, C.monthly, C.yearly]) expect(regionalPlanProblems(whopPlan(p), p)).toEqual([]);
  });
  it.each([
    [{ visibility: 'visible' }, 'hidden'],
    [{ renewal_price: 20 }, 'renew at $9.99'],
    [{ trial_period_days: 7 }, 'free trial'],
    [{ product: { id: 'prod_other' } }, 'another product'],
    [{ effective_payment_method_configuration: { enabled: ['card', 'paypal'], disabled: [], include_platform_defaults: false } }, 'only card'],
    [{ effective_payment_method_configuration: { enabled: ['card'], disabled: [], include_platform_defaults: true } }, 'only card'],
    [{ effective_payment_method_configuration: null }, 'only card'],
  ])('names what is wrong: %j', (changes, words) => {
    expect(regionalPlanProblems(whopPlan(B.monthly, changes), B.monthly).join('; ')).toContain(words);
  });
  it('checks local currency on passes only, since Whop bills recurring plans in the checkout currency', () => {
    expect(regionalPlanProblems(whopPlan(C.monthly, { adaptive_pricing_enabled: true }), C.monthly).join()).toContain('local currency');
    expect(regionalPlanProblems(whopPlan(B.monthly, { adaptive_pricing_enabled: true }), B.monthly)).toEqual([]);
    expect(regionalPlanProblems(whopPlan(B.yearly, { adaptive_pricing_enabled: true }), B.yearly)).toEqual([]);
  });
  it('wants passes to be one-time and to expire', () => {
    expect(regionalPlanProblems(whopPlan(C.monthly, { expiration_days: null }), C.monthly).join()).toContain('one-time $4.99 pass');
    expect(regionalPlanProblems(whopPlan(C.yearly, { plan_type: 'renewal' }), C.yearly).join()).toContain('one-time $39.99 pass');
  });
});

describe('the card rule on a payment', () => {
  it('knows a payment the rule declined', () => {
    expect(ruleBlocked(declined('pay_1'))).toBe(true);
    expect(ruleBlocked(approved('pay_2'))).toBe(false);
    expect(ruleBlocked({})).toBe(false);
  });
});

describe('checkout picks the plan on the server', () => {
  it('gives a Bosnian visitor the regional plan, cards only, and says so', async () => {
    goLive();
    const result = await checkout('user_ba', 'monthly', undefined, undefined, 'BA');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: B.monthly.id, metadata: { rvm_region: 'b', rvm_country: 'BA' } });
    expect(result).toMatchObject({ regional: { country: 'BA', price: 9.99, days: 30, pass: false } });
    expect(result).not.toHaveProperty('promoCode');
  });
  it('gives an Indian visitor the one-time pass', async () => {
    goLive();
    await checkout('user_in', 'yearly', undefined, undefined, 'IN');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: C.yearly.id });
  });
  it('uses the standard plan for other countries, while off, and whenever a code is entered', async () => {
    await checkout('u1', 'monthly', undefined, undefined, 'BA');
    goLive();
    await checkout('u2', 'monthly', undefined, undefined, 'US');
    await checkout('u3', 'monthly', 'spring20', undefined, 'BA');
    expect(fake.checkoutCalls.map((c) => c.body.plan_id)).toEqual(['plan_monthly', 'plan_monthly', 'plan_monthly']);
  });
  it('refuses a regional plan that is not set up right in Whop', async () => {
    goLive();
    fake.variants.set(B.monthly.id, whopPlan(B.monthly, { visibility: 'visible' }));
    await expect(checkout('user_ba', 'monthly', undefined, undefined, 'BA')).rejects.toThrow('Unexpected Whop plan configuration');
    expect(fake.checkoutCalls).toHaveLength(0);
  });
});

describe('access from a regional payment', () => {
  const membership = (p: RegionalPlan, changes = {}) => ({ id: 'mem_r', account: { id: 'biz_test' }, plan_id: p.id, status: 'active', current_period_end: future(30), expires_at: null, manage_url: 'https://whop.com/billing', user_id: 'user_whop', product_id: 'prod_test', ...changes }) as unknown as Whop.Membership;
  beforeEach(() => {
    fake.records.set('rvm:whop-user:buyer', 'user_whop');
  });
  it('opens access for a paid regional membership', async () => {
    fake.memberships = [membership(B.monthly)];
    fake.byMembership.set('mem_r', [approved('pay_1')]);
    expect(await accessFor('buyer', true)).toMatchObject({ active: true, tier: 'monthly' });
  });
  it('gives a pass access until it ends, and nothing after', () => {
    expect(membershipAccess(membership(C.monthly, { current_period_end: null, expires_at: future(10) }))).toMatchObject({ active: true, tier: 'monthly' });
    expect(membershipAccess(membership(C.monthly, { current_period_end: null, expires_at: future(-1) }))).toEqual({ active: false });
    expect(membershipAccess(membership(C.monthly, { status: 'completed', current_period_end: null, expires_at: future(5) }))).toMatchObject({ active: true });
    expect(membershipAccess(membership(C.yearly, { current_period_end: null, expires_at: null }))).toEqual({ active: false });
  });
  it('lets someone whose pass ended buy again', async () => {
    fake.memberships = [membership(C.monthly, { current_period_end: null, expires_at: future(-2) })];
    expect(await accessFor('buyer', true)).toEqual({ active: false });
  });
});

describe('the admin switch', () => {
  it('stays off until every plan is right and a payment proved the rules', async () => {
    const client = await whop();
    expect(await setRegionalLive(client, true)).toMatchObject({ ok: false, error: expect.stringContaining('test payment') });
    fake.byPlan.set(B.monthly.id, [approved('pay_test')]);
    fake.variants.set(C.yearly.id, whopPlan(C.yearly, { visibility: 'visible' }));
    expect(await setRegionalLive(client, true)).toMatchObject({ ok: false, error: expect.stringContaining('not set up right') });
    fake.variants.set(C.yearly.id, whopPlan(C.yearly));
    expect(await setRegionalLive(client, true)).toEqual({ ok: true, live: true });
    expect(await regionalOffer('BA')).not.toBeNull();
    expect(await setRegionalLive(client, false)).toEqual({ ok: true, live: false });
    expect(await regionalOffer('BA')).toBeNull();
  });
  it('does not count a declined attempt as proof, and lists it as declined', async () => {
    fake.byPlan.set(B.monthly.id, [declined('pay_declined')]);
    fake.byPlan.set(B.yearly.id, [approved('pay_ok', { usd_total: { amount: '74.99', currency: 'usd' } })]);
    const client = await whop();
    const status = await regionalStatus(client);
    expect(status).toMatchObject({ ready: true, verified: true });
    expect(status.payments.find((p) => p.id === 'pay_declined')).toMatchObject({ blocked: true });
    expect(status.payments.find((p) => p.id === 'pay_ok')).toMatchObject({ amount: 74.99, blocked: false });
    fake.byPlan.delete(B.yearly.id);
    expect(await setRegionalLive(client, true)).toMatchObject({ ok: false, error: expect.stringContaining('test payment') });
  });
});

describe('the session', () => {
  it('carries the regional price for the request country', async () => {
    goLive();
    const token = 'a'.repeat(43);
    fake.records.set(`rvm:session:${hash(token)}`, { userId: 'u_ba', email: 'ana@example.com', name: 'Ana' });
    fake.records.set('rvm:device:u_ba', hash(token));
    const request = (country: string) => new Request('https://radiology.monster/api/session', { headers: { cookie: `__Host-rvm-session=${token}`, 'x-vercel-ip-country': country } });
    expect(await (await handle(request('BA'))).json()).toMatchObject({ regionalPrice: { country: 'BA', monthly: { price: 9.99 } } });
    expect(await (await handle(request('US'))).json()).not.toHaveProperty('regionalPrice');
  });
});
