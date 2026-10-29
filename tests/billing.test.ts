import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { Whop } from '@whop/sdk';

const fake = vi.hoisted(() => ({ records: new Map<string, unknown>(), members: [] as unknown[], memberships: [] as unknown[], payments: [] as unknown[], checkoutCalls: [] as unknown[], revoke: vi.fn(), exchange: vi.fn(), identity: vi.fn(), clerkIdentity: vi.fn() }));
vi.mock('../server/clerk', () => ({ clerkIdentity: fake.clerkIdentity }));
vi.mock('../server/store', () => {
  const store = {
    get: async (key: string) => fake.records.get(key) ?? null,
    getdel: async (key: string) => { const value = fake.records.get(key); fake.records.delete(key); return value ?? null; },
    set: async (key: string, value: unknown, opts?: { nx?: boolean }) => { if (opts?.nx && fake.records.has(key)) return null; fake.records.set(key, value); return 'OK'; },
    del: async (key: string) => fake.records.delete(key),
    multi: () => { const pending: [string, unknown][] = []; return { set: (k: string, v: unknown) => pending.push([k, v]), exec: async () => { for (const [k, v] of pending) fake.records.set(k, v); } }; },
  };
  return { db: () => store, rateLimit: async () => true };
});
vi.mock('../server/oauth', () => ({ merchantToken: async () => 'test-token', exchange: fake.exchange, identity: fake.identity, revoke: fake.revoke }));
vi.mock('@whop/sdk', () => ({ WhopClient: class {
  members = { list: async () => ({ async *[Symbol.asyncIterator]() { yield* fake.members; } }) };
  memberships = { list: async () => ({ data: fake.memberships, async *[Symbol.asyncIterator]() { yield* fake.memberships; } }) };
  payments = { list: async () => ({ data: fake.payments }) };
  variants = { retrieve: async ({ id }: { id: string }) => ({ id, account: { id: 'biz_test' }, currency: 'usd', plan_type: 'renewal', billing_period: id === 'plan_yearly' ? 365 : 30, initial_price: 0, renewal_price: id === 'plan_monthly' ? 20 : id === 'plan_legacy_monthly' ? 10 : 150, adaptive_pricing_enabled: false }) };
  checkoutConfigurations = { create: async (body: unknown, options: unknown) => { fake.checkoutCalls.push({ body, options }); return { id: 'ch_test', purchase_url: 'https://whop.com/checkout/ch_test' }; } };
} }));

import { accessFor, checkout, membershipAccess, paymentGrantsAccess, safeWhopUrl, validatePlan, referralProfile } from '../server/billing';
import { beginSignIn, createSession, finishSignIn, hash, session } from '../server/auth';
import { handle } from '../server/handler';

const future = () => new Date(Date.now() + 86400000).toISOString();
const member = (changes = {}) => ({ id: 'mem_test', account: { id: 'biz_test' }, plan_id: 'plan_monthly', status: 'active', current_period_end: future(), expires_at: null, manage_url: 'https://whop.com/billing', user_id: 'user_test', product_id: 'prod_test', ...changes }) as Whop.Membership;

beforeEach(() => {
  fake.records.clear(); fake.members = []; fake.memberships = []; fake.payments = []; fake.checkoutCalls = []; fake.clerkIdentity.mockReset();
  for (const [k, v] of Object.entries({ ADMIN_EMAILS: '', APP_URL: 'https://radiology.monster', WHOP_APP_ID: 'app_test', WHOP_API_KEY: 'test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_PRODUCT_ID: 'prod_test', WHOP_MONTHLY_PLAN_ID: 'plan_monthly', WHOP_YEARLY_PLAN_ID: 'plan_yearly', WHOP_LEGACY_MONTHLY_PLAN_ID: 'plan_legacy_monthly', WHOP_LIFETIME_PLAN_ID: 'plan_lifetime', KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test' })) vi.stubEnv(k, v);
});
afterAll(() => vi.unstubAllEnvs());

describe('paid access policy', () => {
  it('credits the referral on both plans, keeps retries stable and isolates different referrers', async () => {
    await checkout('new-customer', 'yearly', undefined, 'student-one');
    await checkout('new-customer', 'yearly', undefined, 'student-one');
    await checkout('new-customer', 'yearly', undefined, 'student-two');
    await checkout('new-customer', 'yearly');
    await checkout('new-customer', 'monthly', 'nadin', 'student-one');
    const calls = fake.checkoutCalls as { body: { plan_id: string; affiliate_code?: string }; options: { idempotencyKey: string } }[];
    expect(calls[0].body).toMatchObject({ plan_id: 'plan_yearly', affiliate_code: 'student-one' });
    expect(calls[0].options.idempotencyKey).toBe(calls[1].options.idempotencyKey);
    expect(new Set([calls[0], calls[2], calls[3]].map(c => c.options.idempotencyKey)).size).toBe(3);
    expect(calls[3].body.affiliate_code).toBeUndefined();
    expect(calls[4].body).toMatchObject({ plan_id: 'plan_legacy_monthly', affiliate_code: 'student-one' });
  });
  it('builds a referral link only for an exact verified member and suppresses known self-referrals', async () => {
    await createSession({ sub: 'clerk_referrer', provider: 'clerk', email: 'member@example.com', emailVerified: true });
    const id = hash('clerk:clerk_referrer');
    fake.members = [{ account_id: 'biz_other', email: 'member@example.com', user: { id: 'user_other', username: 'not-mine' } }, { account_id: 'biz_test', email: 'somebody@example.com', user: { id: 'user_else', username: 'also-not-mine' } }];
    expect((await referralProfile(id)).shareUrl).toBeNull();
    fake.members.push({ account_id: 'biz_test', email: 'MEMBER@example.com', user: { id: 'user_mine', username: 'study-pal' } });
    expect((await referralProfile(id)).shareUrl).toBe('https://whop.com/e/trk_zpdZ5h59TRkTrN/study-pal');
    await checkout(id, 'monthly', undefined, 'study-pal');
    expect(fake.checkoutCalls[0]).not.toHaveProperty('body.affiliate_code');
    fake.members.push({ account_id: 'biz_test', email: 'member@example.com', user: { id: 'user_duplicate', username: 'another' } });
    await expect(referralProfile(id)).rejects.toThrow('Ambiguous');
  });
  it('restores Whop membership only through an exact match to the verified Clerk email', async () => {
    await createSession({ sub: 'clerk_test', provider: 'clerk', email: 'buyer@example.com', emailVerified: true });
    const userId = hash('clerk:clerk_test');
    fake.memberships = [member()]; fake.payments = [{ status: 'paid', substatus: 'succeeded' }];
    fake.members = [{ account_id: 'biz_test', email: 'someone@example.com', user: { id: 'user_test' } }];
    expect((await accessFor(userId, true)).active).toBe(false);
    fake.members = [{ account_id: 'biz_other', email: 'buyer@example.com', user: { id: 'user_test' } }];
    expect((await accessFor(userId, true)).active).toBe(false);
    fake.members = [{ account_id: 'biz_test', email: 'BUYER@example.com', user: { id: 'user_test' } }];
    expect((await accessFor(userId, true)).active).toBe(true);
    expect(fake.records.get(`rvm:whop-user:${userId}`)).toBe('user_test');
  });
  it('does not select a customer when an email lookup is ambiguous', async () => {
    await createSession({ sub: 'clerk_test', provider: 'clerk', email: 'buyer@example.com', emailVerified: true });
    fake.members = ['user_one', 'user_two'].map(id => ({ account_id: 'biz_test', email: 'buyer@example.com', user: { id } }));
    await expect(accessFor(hash('clerk:clerk_test'), true)).rejects.toThrow('Ambiguous');
  });
  it('allows a new verified customer to open checkout before a Whop member exists', async () => {
    await createSession({ sub: 'clerk_new', provider: 'clerk', email: 'new@example.com', emailVerified: true });
    expect(await checkout(hash('clerk:clerk_new'), 'monthly')).toMatchObject({ id: 'ch_test' });
  });
  it('preserves legacy monthly discounts and lifetime access alongside the new plans', () => {
    expect(membershipAccess(member({ plan_id: 'plan_legacy_monthly' }))).toMatchObject({ active: true, tier: 'monthly' });
    expect(membershipAccess(member({ plan_id: 'plan_yearly' }))).toMatchObject({ active: true, tier: 'yearly' });
    expect(membershipAccess(member({ plan_id: 'plan_yearly', current_period_end: '2020-01-01' })).active).toBe(false);
    expect(membershipAccess(member({ plan_id: 'plan_yearly', current_period_end: null })).active).toBe(false);
    expect(membershipAccess(member({ plan_id: 'plan_yearly', status: 'completed' })).active).toBe(false);
    expect(membershipAccess(member()).active).toBe(true);
    expect(membershipAccess(member({ plan_id: 'plan_lifetime', status: 'completed', current_period_end: null }))).toMatchObject({ active: true, tier: 'lifetime', expiresAt: null });
  });
  it.each(['past_due', 'canceled', 'expired', 'trialing'])('denies %s memberships', status => expect(membershipAccess(member({ status })).active).toBe(false));
  it('rejects other businesses, unapproved plans, expired and malformed dates', () => {
    for (const changes of [{ account: { id: 'biz_other' } }, { plan_id: 'plan_other' }, { current_period_end: null }, { current_period_end: 'invalid' }, { current_period_end: '2020-01-01' }, { expires_at: 'invalid' }]) expect(membershipAccess(member(changes)).active).toBe(false);
  });
  it('keeps access until period end when cancellation is scheduled', () => expect(membershipAccess(member({ cancel_at_period_end: true })).active).toBe(true));
  it.each(['refunded', 'auto_refunded', 'dispute_lost', 'dispute_under_review', 'pending', 'failed'])('denies payment state %s', substatus => expect(paymentGrantsAccess({ status: 'paid', substatus } as Whop.Payment)).toBe(false));
  it('does not trust returned checkout parameters or another customer’s membership', async () => {
    fake.records.set('rvm:whop-user:u', 'user_test');
    fake.memberships = [member({ user_id: 'user_other' })]; fake.payments = [{ status: 'paid', substatus: 'succeeded' }];
    expect((await accessFor('u', true)).active).toBe(false);
    fake.memberships = [member()]; fake.payments = [];
    expect((await accessFor('u', true)).active).toBe(false);
    fake.payments = [{ status: 'paid', substatus: 'succeeded' }];
    expect((await accessFor('u', true)).active).toBe(true);
    fake.payments = [{ status: 'paid', substatus: 'refunded' }];
    expect((await accessFor('u', true)).active).toBe(false);
  });
  it('reuses the checkout idempotency key and blocks existing paid subscribers', async () => {
    fake.records.set('rvm:whop-user:u', 'user_test');
    await checkout('u', 'monthly'); await checkout('u', 'monthly');
    const calls = fake.checkoutCalls as { options: { idempotencyKey: string }; body: { plan_id: string } }[];
    expect(calls[0].options.idempotencyKey).toBe(calls[1].options.idempotencyKey);
    expect(calls[0].body.plan_id).toBe('plan_monthly');
    fake.memberships = [member()]; fake.payments = [{ status: 'paid', substatus: 'succeeded' }];
    await expect(checkout('u', 'yearly')).rejects.toThrow('already have access');
  });
  it('returns a reusable embedded checkout configuration with the approved return origin', async () => {
    fake.records.set('rvm:whop-user:u', 'user_test');
    expect(await checkout('u', 'yearly')).toEqual({ id: 'ch_test', url: 'https://whop.com/checkout/ch_test', returnUrl: 'https://radiology.monster/?checkout=returned' });
  });
  it('routes Nadin to its original one-use offer and never lets it discount yearly', async () => {
    const result = await checkout('new-customer', 'monthly', ' NADIN ');
    expect(result.promoCode).toBe('nadin');
    expect(fake.checkoutCalls[0]).toMatchObject({ body: { plan_id: 'plan_legacy_monthly' } });
    await expect(checkout('new-customer', 'yearly', 'nadin')).rejects.toThrow('not available');
    await expect(checkout('new-customer', 'monthly', 'empa')).rejects.toThrow('not available');
    expect(fake.checkoutCalls).toHaveLength(1);
  });
  it('binds yearly checkout to the yearly plan and rejects wrong annual terms', async () => {
    await checkout('new-customer', 'yearly');
    expect(fake.checkoutCalls[0]).toMatchObject({ body: { plan_id: 'plan_yearly' } });
    const annual = { account: { id: 'biz_test' }, currency: 'usd', plan_type: 'renewal', billing_period: 365, initial_price: 0, renewal_price: 150 } as Whop.Variant;
    expect(() => validatePlan(annual, 'yearly')).not.toThrow();
    expect(() => validatePlan({ ...annual, billing_period: 30 }, 'yearly')).toThrow();
    expect(() => validatePlan({ ...annual, renewal_price: 100 }, 'yearly')).toThrow();
  });
  it('keeps paid legacy subscribers entitled and prevents a duplicate purchase', async () => {
    fake.records.set('rvm:whop-user:u', 'user_test');
    fake.memberships = [member({ plan_id: 'plan_legacy_monthly' })];
    fake.payments = [{ status: 'paid', substatus: 'succeeded' }];
    expect(await accessFor('u', true)).toMatchObject({ active: true, tier: 'monthly' });
    await expect(checkout('u', 'yearly')).rejects.toThrow('already have access');
  });
  it('grants free admin access only to the exact verified email and revokes it when removed', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'kerim.sabic@gmail.com');
    const userId = hash('whop:user_admin');
    fake.records.set(`rvm:identity:${userId}`, { email: 'kerim.sabic@gmail.com', emailVerified: false });
    expect((await accessFor(userId)).active).toBe(false);
    fake.records.set(`rvm:identity:${userId}`, { email: 'kerim.sabic@gmail.com.evil.test', emailVerified: true });
    expect((await accessFor(userId)).active).toBe(false);
    await createSession({ sub: 'user_admin', email: 'Kerim.Sabic@gmail.com', emailVerified: true });
    expect(await accessFor(userId)).toEqual({ active: true, role: 'admin', expiresAt: null });
    await expect(checkout(userId, 'monthly')).rejects.toThrow('already have access');
    expect(fake.checkoutCalls).toHaveLength(0);
    vi.stubEnv('WHOP_MONTHLY_PLAN_ID', '');
    expect((await accessFor(userId)).active).toBe(true);
    vi.stubEnv('ADMIN_EMAILS', '');
    expect((await accessFor(userId)).active).toBe(false);
  });
  it('rejects a changed price and unsafe redirect hosts', () => {
    expect(() => validatePlan({ account: { id: 'biz_test' }, currency: 'usd', plan_type: 'renewal', billing_period: 30, initial_price: 10, renewal_price: 10 } as Whop.Variant, 'monthly')).toThrow();
    for (const url of ['https://whop.com.evil.test/', 'javascript:alert(1)', 'http://whop.com/']) expect(safeWhopUrl(url)).toBeNull();
  });
});

describe('sessions and request boundaries', () => {
  const request = (cookie: string, path = '/api/session', method = 'GET', body?: unknown, origin = 'https://radiology.monster') => new Request(`https://radiology.monster${path}`, { method, headers: { Cookie: cookie.split(';')[0], Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  it('exchanges a verified Clerk identity for a secure app session and preserves free admin access', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
    fake.clerkIdentity.mockResolvedValue({ sub: 'clerk_admin', provider: 'clerk', email: 'admin@example.com', emailVerified: true });
    const result = await handle(request('', '/api/auth/session', 'POST'));
    expect(result.status).toBe(200);
    const cookie = result.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(await (await handle(request(cookie))).json()).toMatchObject({ access: { active: true, role: 'admin' } });
    expect(fake.records.has(`rvm:whop-user:${hash('clerk:clerk_admin')}`)).toBe(false);
  });
  it('rejects forged Clerk authentication and cross-origin session creation', async () => {
    fake.clerkIdentity.mockRejectedValue(new Error('Invalid signature'));
    const result = await handle(request('', '/api/auth/session', 'POST', { email: 'admin@example.com' }));
    expect(result.status).toBe(401);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect((await handle(request('', '/api/auth/session', 'POST', undefined, 'https://evil.test'))).status).toBe(403);
  });
  it('rejects unverified identities even for the configured admin', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'kerim.sabic@gmail.com');
    await expect(createSession({ sub: 'user_admin', email: 'kerim.sabic@gmail.com', emailVerified: false })).rejects.toThrow('Verified email required');
    expect(fake.records.size).toBe(0);
  });
  it('returns admin access from the session and content APIs without creating a payment', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'kerim.sabic@gmail.com');
    const token = await createSession({ sub: 'user_admin', email: 'kerim.sabic@gmail.com', emailVerified: true });
    expect(await (await handle(request(token))).json()).toMatchObject({ access: { active: true, role: 'admin' } });
    expect((await handle(request(token, '/api/access'))).status).toBe(200);
    expect((await handle(request(token, '/api/billing/checkout', 'POST', { tier: 'yearly' }))).status).toBe(409);
    expect(fake.checkoutCalls).toHaveLength(0);
  });
  it('finishes popup sign-in with a secure cookie and an origin-bound notification', async () => {
    const flow = await beginSignIn(), state = new URL(flow.url).searchParams.get('state')!;
    fake.exchange.mockResolvedValue({}); fake.identity.mockResolvedValue({ sub: 'user_test', email: 'test@example.com', emailVerified: true }); fake.revoke.mockResolvedValue(undefined);
    const response = await handle(request(flow.cookie, `/api/auth/callback?state=${state}&code=test`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('__Host-rvm-session=');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'nonce-");
    expect(html).toContain("type:'rvm-auth',ok:true");
    expect(html).toContain('"https://radiology.monster"');
    expect(html).not.toContain('test@example.com');
    expect(html).not.toContain('__Host-rvm-session=');
  });
  it('invalidates the previous device but allows the latest session', async () => {
    const old = await createSession({ sub: 'user_test', email: 'test@example.com', emailVerified: true });
    const latest = await createSession({ sub: 'user_test', email: 'test@example.com', emailVerified: true });
    expect(await session(request(old))).toBeNull();
    expect(await session(request(latest))).toMatchObject({ email: 'test@example.com' });
    expect(latest).toContain('HttpOnly; Secure; SameSite=Lax');
  });
  it('blocks anonymous and forged sessions, cross-origin checkout, and arbitrary prices', async () => {
    expect((await handle(request('', '/api/referrals'))).status).toBe(401);
    expect((await handle(request('__Host-rvm-session=forged'))).status).toBe(401);
    const token = await createSession({ sub: 'user_test', email: 'test@example.com', emailVerified: true });
    expect((await handle(request(token, '/api/billing/checkout', 'POST', { tier: 'monthly' }, 'https://evil.test'))).status).toBe(403);
    expect((await handle(request(token, '/api/billing/checkout', 'POST', { tier: 'monthly', amount: 0 }))).status).toBe(400);
    expect((await handle(request(token, '/api/billing/checkout', 'POST', { tier: 'monthly', affiliateCode: 'https://evil.test' }))).status).toBe(400);
    expect((await handle(request(token, '/api/referrals'))).headers.get('cache-control')).toBe('private, no-store');
    expect((await handle(request(token, '/api/access'))).status).toBe(402);
    expect((await handle(request(token))).headers.get('cache-control')).toBe('private, no-store');
  });
  it('uses PKCE, a nonce and single-use browser-bound OAuth state', async () => {
    const flow = await beginSignIn(), url = new URL(flow.url), state = url.searchParams.get('state')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    const callback = new Request(`https://radiology.monster/api/auth/callback?state=${state}&code=test`, { headers: { Cookie: flow.cookie.split(';')[0] } });
    fake.exchange.mockResolvedValue({}); fake.identity.mockResolvedValue({ sub: 'user_test', email: 'test@example.com', emailVerified: true }); fake.revoke.mockResolvedValue(undefined);
    await finishSignIn(callback);
    expect(fake.records.has(`rvm:oauth:${hash(state)}`)).toBe(false);
    await expect(finishSignIn(callback)).rejects.toThrow('Expired');
    await expect(finishSignIn(new Request(callback.url))).rejects.toThrow('Invalid OAuth state');
  });
});
