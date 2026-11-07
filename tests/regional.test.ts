import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  /** Promo codes in Whop, and which account each welcome code was made for. */
  promos: [] as Array<{ code: string; plan_ids: string[]; expires_at: string | null; unlimited_stock: boolean; stock: number }>,
  ownCodes: new Map<string, string>(),
  /** Codes this server asked Whop to make (the student's 30% code). */
  created: [] as Array<Record<string, unknown>>,
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
vi.mock('../server/welcomeCode', () => ({
  welcomeOffer: async () => null,
  ownWelcomeCode: async (userId: string, code: string) => fake.ownCodes.get(code.toLowerCase()) === userId,
  WELCOME_PREFIX: 'welcome-',
  WELCOME_PERCENT: 40,
}));
vi.mock('@whop/sdk', () => ({ WhopClient: class {
  promoCodes = {
    list: async (q: { plan_ids?: string[] }) => fake.promos.filter((c) => !q.plan_ids || q.plan_ids.some((id) => c.plan_ids.includes(id))),
    create: async (body: Record<string, unknown>) => { fake.created.push(body); return { id: `promo_${fake.created.length}` }; },
    // As Whop answers for a code made just now: active, unused, one use left.
    retrieve: async ({ id }: { id: string }) => {
      const body = fake.created[Number(id.split('_')[1]) - 1];
      return { id, account: { id: 'biz_test' }, product: { id: 'prod_test' }, status: 'active', code: body.code, promo_type: 'percentage', amount_off: body.amount_off, duration: body.promo_duration_months === 0 ? 'forever' : 'once',
        unlimited_stock: false, stock: 1, uses: 0, expires_at: body.expires_at, one_per_customer: true, existing_memberships_only: false, churned_users_only: false, new_users_only: false };
    },
  };
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

import { allRegionalPlans, membershipPlans, regionalPlan, regionalPlans, upiPlans, welcomeCodePlanIds, type RegionalPlan } from '../server/config';
import { upiOffered, upiPlanProblems, ruleAmounts, ruleBlocked, regionalOffer, regionalPlanProblems, regionOf, regionalStatus, setRegionalLive, setStudentRegionalLive, studentAmount, studentRuleAmounts, welcomeAmount } from '../server/regional';
import { priceAnswers } from '../src/auth/priceAnswers';
import { regionalTerms, studentTerms, withStudentPrices } from '../src/auth/regionalPrice';
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
  fake.promos = []; fake.ownCodes.clear(); fake.created = [];
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
  it('needs one Whop rule per amount a tier can charge, the welcome-code and student prices included', () => {
    // Whop rounds 40% off $9.99 to $5.99 (checked on its checkout, 2026-11-05).
    expect(welcomeAmount(9.99)).toBe(5.99);
    expect(ruleAmounts('b')).toEqual([9.99, 5.99, 6.99, 74.99, 44.99, 52.49]);
    expect(ruleAmounts('c')).toEqual([4.99, 2.99, 3.49, 39.99, 23.99, 27.99]);
  });
  it('takes 30% off the regional prices for a student, rounded to the cent', () => {
    expect([9.99, 74.99, 4.99, 39.99].map(studentAmount)).toEqual([6.99, 52.49, 3.49, 27.99]);
    expect(studentRuleAmounts('b')).toEqual([6.99, 52.49]);
    expect(studentRuleAmounts('c')).toEqual([3.49, 27.99]);
  });
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
  describe('with a welcome code', () => {
    const code = 'welcome-ana-k7q3m';
    const welcomeCode = (planIds: string[]) => ({ code, plan_ids: planIds, expires_at: future(2), unlimited_stock: false, stock: 1 });
    const everyPlan = ['plan_monthly', 'plan_yearly', B.monthly.id, B.yearly.id, C.monthly.id, C.yearly.id];
    it('keeps the price for the visitor\'s country, and the code takes 40% off it', async () => {
      goLive();
      fake.promos = [welcomeCode(everyPlan)];
      fake.ownCodes.set(code, 'user_ba');
      const result = await checkout('user_ba', 'monthly', code.toUpperCase(), undefined, 'BA');
      expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: B.monthly.id, metadata: { rvm_region: 'b' } });
      expect(result).toMatchObject({ promoCode: code, welcome: true, studentDiscount: false, regional: { country: 'BA', price: 9.99 } });
      fake.ownCodes.set(code, 'user_in');
      await checkout('user_in', 'yearly', code, undefined, 'IN');
      expect(fake.checkoutCalls[1].body).toMatchObject({ plan_id: C.yearly.id });
    });
    it('falls back to the standard price for a code made before it covered the regional plans', async () => {
      goLive();
      fake.promos = [welcomeCode(['plan_monthly', 'plan_yearly'])];
      fake.ownCodes.set(code, 'user_ba');
      const result = await checkout('user_ba', 'monthly', code, undefined, 'BA');
      expect(fake.checkoutCalls[0].body.plan_id).toBe('plan_monthly');
      expect(result).toMatchObject({ promoCode: code, welcome: true });
      expect(result).not.toHaveProperty('regional');
    });
    it('refuses a welcome code made for someone else', async () => {
      goLive();
      fake.promos = [welcomeCode(everyPlan)];
      fake.ownCodes.set(code, 'someone_else');
      await expect(checkout('user_ba', 'monthly', code, undefined, 'BA')).rejects.toThrow('belongs to another account');
      expect(fake.checkoutCalls).toHaveLength(0);
    });
  });
  it('refuses a regional plan that is not set up right in Whop', async () => {
    goLive();
    fake.variants.set(B.monthly.id, whopPlan(B.monthly, { visibility: 'visible' }));
    await expect(checkout('user_ba', 'monthly', undefined, undefined, 'BA')).rejects.toThrow('Unexpected Whop plan configuration');
    expect(fake.checkoutCalls).toHaveLength(0);
  });
});

describe('student prices on the regional plans', () => {
  const student = (userId: string, email = 'ana@unsa.edu.ba') => {
    fake.records.set('rvm:student-discount-ready', true);
    fake.records.set(`rvm:identity:${userId}`, { email, emailVerified: true });
  };
  const studentsOn = () => fake.records.set('rvm:regional:student-live', true);

  it('are off until an admin turns them on (after the four Whop rules), and then show with the regional price', async () => {
    goLive();
    expect(await regionalOffer('BA')).not.toHaveProperty('student');
    await setStudentRegionalLive(true);
    expect(await regionalOffer('BA')).toMatchObject({ monthly: { price: 9.99 }, yearly: { price: 74.99 }, student: { monthly: 6.99, yearly: 52.49 } });
    expect(await regionalOffer('IN')).toMatchObject({ monthly: { price: 4.99, pass: true }, student: { monthly: 3.49, yearly: 27.99 } });
    expect(await regionalOffer('US')).toBeNull();
    await setStudentRegionalLive(false);
    expect(await regionalOffer('BA')).not.toHaveProperty('student');
  });

  it('while off, a student in a regional country pays the regional price without a student code', async () => {
    goLive();
    student('user_ba');
    const result = await checkout('user_ba', 'monthly', undefined, undefined, 'BA');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: B.monthly.id });
    expect(result).not.toHaveProperty('promoCode');
    expect(result.regional).not.toHaveProperty('studentPrice');
    expect(fake.created).toHaveLength(0);
  });

  it('while on, a verified student gets their own 30% code on the regional plan, for every payment', async () => {
    goLive();
    studentsOn();
    student('user_ba');
    const result = await checkout('user_ba', 'yearly', undefined, undefined, 'BA');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: B.yearly.id, metadata: { rvm_region: 'b' } });
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({ plan_ids: [B.yearly.id], amount_off: 30, promo_duration_months: 0, promo_type: 'percentage', stock: 1, one_per_customer: true });
    expect(result).toMatchObject({ studentDiscount: true, promoCode: fake.created[0].code, regional: { country: 'BA', price: 74.99, studentPrice: 52.49 } });

    student('user_in', 'arjun@iitb.ac.in');
    const pass = await checkout('user_in', 'monthly', undefined, undefined, 'IN');
    expect(fake.checkoutCalls[1].body).toMatchObject({ plan_id: C.monthly.id });
    expect(fake.created[1]).toMatchObject({ plan_ids: [C.monthly.id], amount_off: 30 });
    expect(pass).toMatchObject({ studentDiscount: true, regional: { price: 4.99, pass: true, studentPrice: 3.49 } });
  });

  it('never for someone without a verified university email', async () => {
    goLive();
    studentsOn();
    fake.records.set('rvm:student-discount-ready', true);
    fake.records.set('rvm:identity:user_ba', { email: 'ana@gmail.com', emailVerified: true });
    const result = await checkout('user_ba', 'monthly', undefined, undefined, 'BA');
    expect(result).not.toHaveProperty('promoCode');
    expect(fake.created).toHaveLength(0);
  });

  it('does not stack with the welcome code: the buyer\'s own welcome code wins, alone (40% off the first payment)', async () => {
    goLive();
    studentsOn();
    student('user_ba');
    const code = 'welcome-ana-k7q3m';
    fake.promos = [{ code, plan_ids: ['plan_monthly', 'plan_yearly', B.monthly.id, B.yearly.id, C.monthly.id, C.yearly.id], expires_at: future(2), unlimited_stock: false, stock: 1 }];
    fake.ownCodes.set(code, 'user_ba');
    const result = await checkout('user_ba', 'monthly', code, undefined, 'BA');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: B.monthly.id });
    expect(result).toMatchObject({ promoCode: code, welcome: true, studentDiscount: false, regional: { price: 9.99 } });
    expect(result.regional).not.toHaveProperty('studentPrice');
    expect(fake.created).toHaveLength(0);
  });

  it('any other code still means the standard plan, where the student rules are unchanged', async () => {
    goLive();
    studentsOn();
    student('user_ba');
    // A 20% code for the first payment: the student's 30% on every renewal is better, so it is used instead (alone).
    fake.promos = [{ code: 'spring20', plan_ids: ['plan_monthly'], expires_at: future(2), unlimited_stock: true, stock: 0, status: 'active', duration: 'once', promo_type: 'percentage', amount_off: 20 } as never];
    const result = await checkout('user_ba', 'monthly', 'spring20', undefined, 'BA');
    expect(fake.checkoutCalls[0].body.plan_id).toBe('plan_monthly');
    expect(result).not.toHaveProperty('regional');
    expect(result).toMatchObject({ studentDiscount: true });
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({ plan_ids: ['plan_monthly'], amount_off: 30 });
  });

  it('are in the session and the public config only while on, and listed for the admin with their rules', async () => {
    goLive();
    const config = () => handle(new Request('https://radiology.monster/api/config', { headers: { 'x-vercel-ip-country': 'BA' } })).then((r) => r.json());
    expect((await config()).regionalPrice).not.toHaveProperty('student');
    studentsOn();
    expect((await config()).regionalPrice).toMatchObject({ student: { monthly: 6.99, yearly: 52.49 } });
    const status = await regionalStatus(await whop());
    expect(status).toMatchObject({ studentLive: true, studentAmounts: { b: [6.99, 52.49], c: [3.49, 27.99] }, ruleAmounts: { b: [9.99, 5.99, 6.99, 74.99, 44.99, 52.49] } });
  });

  it('show on the landing answers and the plan cards for that country', () => {
    const ba = { region: 'b' as const, country: 'BA', countryName: 'Bosnia & Herzegovina', monthly: { price: 9.99, pass: false }, yearly: { price: 74.99, pass: false } };
    const india = { region: 'c' as const, country: 'IN', countryName: 'India', monthly: { price: 4.99, pass: true }, yearly: { price: 39.99, pass: true } };
    const answer = (r: Parameters<typeof priceAnswers>[0], q: string) => priceAnswers(r).find(([question]) => question.startsWith(q))![1];
    // Off: the student answer is about the standard price only.
    expect(answer(ba, 'Is there a student discount?')).toContain('$14 every 30 days or $105 every 365 days');
    expect(answer(ba, 'Is there a student discount?')).not.toContain('$6.99');
    const baOn = { ...ba, student: { monthly: 6.99, yearly: 52.49 } };
    expect(answer(baOn, 'Is there a student discount?')).toContain('30% off the price for Bosnia & Herzegovina: $6.99 every 30 days or $52.49 every 365 days, on every payment');
    expect(answer(baOn, 'How much does it cost?')).toContain('With an eligible university email, $6.99 every 30 days or $52.49 every 365 days.');
    const inOn = { ...india, student: { monthly: 3.49, yearly: 27.99 } };
    expect(answer(inOn, 'Is there a student discount?')).toContain('a 30-day pass is $3.49 and a 1-year pass $27.99, on every pass');
    for (const r of [baOn, inOn]) expect(priceAnswers(r).map(([, a]) => a).join(' ')).not.toMatch(/welcome|40%/i);
    expect(studentTerms(baOn)).toBe('$6.99 a month · $52.49 a year');
    expect(studentTerms(inOn)).toBe('$3.49 for 30 days · $27.99 for a year');
    expect(withStudentPrices(baOn)).toMatchObject({ monthly: { price: 6.99, pass: false }, yearly: { price: 52.49 } });
    expect(withStudentPrices(ba)).toBe(ba);
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

describe('the public config', () => {
  const config = (country?: string) => new Request('https://radiology.monster/api/config', { headers: country ? { 'x-vercel-ip-country': country } : {} });
  it('carries the regional price before sign-in, so the landing page shows it', async () => {
    goLive();
    expect(await (await handle(config('BA'))).json()).toMatchObject({ regionalPrice: { region: 'b', country: 'BA', monthly: { price: 9.99, pass: false }, yearly: { price: 74.99 } } });
    expect(await (await handle(config('IN'))).json()).toMatchObject({ regionalPrice: { region: 'c', monthly: { price: 4.99, pass: true }, yearly: { price: 39.99, pass: true } } });
  });
  it('has no regional price elsewhere, without a country, or while regional prices are off', async () => {
    goLive();
    expect(await (await handle(config('US'))).json()).not.toHaveProperty('regionalPrice');
    expect(await (await handle(config())).json()).not.toHaveProperty('regionalPrice');
    fake.records.delete('rvm:regional:live');
    expect(await (await handle(config('BA'))).json()).not.toHaveProperty('regionalPrice');
  });
});

describe('UPI for India', () => {
  // The two UPI passes account 1 made in Whop (server/config.ts); the tests use stand-in ids and put the real ones back.
  const real = { monthly: upiPlans.monthly.id, yearly: upiPlans.yearly.id };
  const ids = { monthly: 'plan_upiMonthly1', yearly: 'plan_upiYearly1' };
  const upiPlan = (p: (typeof upiPlans)['monthly'], changes: Record<string, unknown> = {}) =>
    ({
      id: p.id, account: { id: 'biz_test' }, product: { id: 'prod_test' }, currency: 'inr', visibility: 'hidden', trial_period_days: null, split_pay_required_payments: null,
      plan_type: 'one_time', initial_price: p.rupees, renewal_price: 0, billing_period: null, expiration_days: p.days,
      effective_payment_method_configuration: { enabled: ['upi'], disabled: [], include_platform_defaults: false },
      ...changes,
    }) as unknown as Whop.Variant;
  const withUpi = () => {
    upiPlans.monthly.id = ids.monthly;
    upiPlans.yearly.id = ids.yearly;
    for (const p of Object.values(upiPlans)) fake.variants.set(p.id, upiPlan(p));
  };
  afterEach(() => {
    upiPlans.monthly.id = real.monthly;
    upiPlans.yearly.id = real.yearly;
  });

  it('is on: both UPI passes are filled in, each a Whop plan id', () => {
    expect(real.monthly).toMatch(/^plan_[A-Za-z0-9]+$/);
    expect(real.yearly).toMatch(/^plan_[A-Za-z0-9]+$/);
    expect(real.monthly).not.toBe(real.yearly);
    expect([real.monthly, real.yearly].some((id) => allRegionalPlans().some((p) => p.id === id))).toBe(false);
  });

  it('is off until both UPI plans exist, and is offered only in India', async () => {
    goLive();
    upiPlans.monthly.id = '';
    expect(upiOffered('IN')).toBe(false);
    expect((await regionalOffer('IN'))?.upi).toBeUndefined();
    withUpi();
    expect(upiOffered('IN')).toBe(true);
    expect(await regionalOffer('IN')).toMatchObject({ upi: { monthly: 469, yearly: 3749 } });
    for (const country of ['PK', 'BD', 'BA', 'US']) expect((await regionalOffer(country))?.upi, country).toBeUndefined();
  });

  it('wants a hidden one-time rupee pass that takes UPI and nothing else (a card could pay it from anywhere)', () => {
    withUpi();
    expect(upiPlanProblems(upiPlan(upiPlans.monthly), upiPlans.monthly)).toEqual([]);
    const bad = (changes: Record<string, unknown>) => upiPlanProblems(upiPlan(upiPlans.yearly, changes), upiPlans.yearly).join('; ');
    expect(bad({ effective_payment_method_configuration: { enabled: ['upi', 'card'], disabled: [], include_platform_defaults: false } })).toContain('UPI and nothing else');
    expect(bad({ effective_payment_method_configuration: { enabled: ['upi'], disabled: [], include_platform_defaults: true } })).toContain('UPI and nothing else');
    expect(bad({ currency: 'usd' })).toContain('Indian rupees');
    expect(bad({ initial_price: 3000 })).toContain('one-time ₹3749 pass');
    expect(bad({ visibility: 'visible' })).toContain('hidden');
  });

  it('gives an Indian visitor who asks for UPI the rupee pass, and everyone else the card plan', async () => {
    goLive();
    withUpi();
    const r = await checkout('user_in', 'yearly', undefined, undefined, 'IN', 'upi');
    expect(fake.checkoutCalls[0].body).toMatchObject({ plan_id: ids.yearly, metadata: { rvm_region: 'c', rvm_country: 'IN', rvm_method: 'upi' } });
    expect(r).toMatchObject({ regional: { country: 'IN', price: 39.99, rupees: 3749, method: 'upi' } });
    await checkout('user_in2', 'yearly', undefined, undefined, 'IN'); // card by default
    await checkout('user_pk', 'yearly', undefined, undefined, 'PK', 'upi'); // UPI is India only
    await checkout('user_ba', 'monthly', undefined, undefined, 'BA', 'upi'); // not tier C
    expect(fake.checkoutCalls.slice(1).map((c) => c.body.plan_id)).toEqual([C.yearly.id, C.yearly.id, B.monthly.id]);
  });

  it('keeps a welcome code made before the UPI plans on the card pass, with its 40 %', async () => {
    goLive();
    withUpi();
    const code = 'welcome-ravi-x1y2z';
    fake.promos = [{ code, plan_ids: ['plan_monthly', 'plan_yearly', C.monthly.id, C.yearly.id], expires_at: future(2), unlimited_stock: false, stock: 1 }];
    fake.ownCodes.set(code, 'user_in');
    const r = await checkout('user_in', 'monthly', code, undefined, 'IN', 'upi');
    expect(fake.checkoutCalls[0].body.plan_id).toBe(C.monthly.id);
    expect(r).toMatchObject({ promoCode: code, welcome: true, regional: { country: 'IN', price: 4.99 } });
    expect(r.regional).not.toHaveProperty('method');
  });

  it('refuses a UPI plan that is not set up right, and grants access for a paid UPI pass like any pass', async () => {
    goLive();
    withUpi();
    fake.variants.set(ids.monthly, upiPlan(upiPlans.monthly, { effective_payment_method_configuration: { enabled: ['card', 'upi'], disabled: [], include_platform_defaults: false } }));
    await expect(checkout('user_in', 'monthly', undefined, undefined, 'IN', 'upi')).rejects.toThrow('Unexpected Whop plan configuration');
    expect(membershipPlans().filter((p) => Object.values(ids).includes(p.id))).toEqual([
      { id: ids.monthly, tier: 'monthly', pass: true },
      { id: ids.yearly, tier: 'yearly', pass: true },
    ]);
    expect(regionalPlan(ids.yearly)).toMatchObject({ pass: true, days: 365 });
    expect(welcomeCodePlanIds()).toEqual(expect.arrayContaining([ids.monthly, ids.yearly]));
    expect(welcomeCodePlanIds(false)).toEqual(allRegionalPlans().map((p) => p.id));
  });

  it('names a UPI pass in rupees at checkout, and a card pass or a student price in dollars', () => {
    const india = { price: 4.99, days: 30, pass: true, rupees: 469 };
    expect(regionalTerms({ ...india, method: 'upi' })).toBe('₹469 for 30 days, one payment that does not renew');
    expect(regionalTerms(india)).toBe('$4.99 USD for 30 days, one payment that does not renew');
    expect(regionalTerms({ ...india, method: 'upi', price: 3.49, rupees: undefined })).toBe('$3.49 USD for 30 days, one payment that does not renew');
  });
});
