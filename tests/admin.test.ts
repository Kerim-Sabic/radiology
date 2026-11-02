import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),
  clerkUsers: [] as Array<Record<string, unknown>>,
  created: [] as unknown[],
  members: [] as unknown[],
  memberships: [] as unknown[],
  mails: [] as Array<{ to: string[]; subject: string; text: string }>,
  promos: [] as Array<Record<string, unknown> & { id: string; plans: string[] }>,
  promoCreated: [] as Array<{ body: Record<string, unknown>; options: unknown }>,
  promoForbidden: false,
}));
vi.mock('../server/store', () => {
  const set = (k: string) => fake.sets.get(k) ?? fake.sets.set(k, new Set()).get(k)!;
  const store = {
    get: async (k: string) => fake.records.get(k) ?? null,
    mget: async (...ks: string[]) => ks.map((k) => fake.records.get(k) ?? null),
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => (o?.nx && fake.records.has(k) ? null : (fake.records.set(k, v), 'OK')),
    del: async (k: string) => fake.records.delete(k),
    incrby: async () => 1,
    sadd: async (k: string, v: string) => set(k).add(v).size,
    srem: async (k: string, v: string) => set(k).delete(v),
    smembers: async (k: string) => [...set(k)],
    scard: async (k: string) => set(k).size,
    multi: () => {
      const pending: [string, unknown][] = [];
      return { set: (k: string, v: unknown) => pending.push([k, v]), exec: async () => pending.forEach(([k, v]) => fake.records.set(k, v)) };
    },
  };
  return { db: () => store, rateLimit: async () => true };
});
vi.mock('../server/oauth', () => ({ merchantToken: async () => 'test-token', exchange: vi.fn(), identity: vi.fn(), revoke: vi.fn() }));
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: () => ({
    users: {
      getUserList: async (p: { emailAddress?: string[] }) => {
        const data = p.emailAddress ? fake.clerkUsers.filter((u) => (u.emailAddresses as Array<{ emailAddress: string }>).some((e) => p.emailAddress!.includes(e.emailAddress))) : fake.clerkUsers;
        return { data, totalCount: data.length };
      },
      createUser: async (p: { emailAddress: string[]; firstName?: string; lastName?: string }) => {
        if (p.emailAddress[0].endsWith('@blocked.test')) throw { errors: [{ message: 'blocked', longMessage: 'This email domain is not allowed.' }] };
        fake.created.push(p);
        const u = clerkUser(`clerk_${fake.created.length}`, p.emailAddress[0], p.firstName);
        fake.clerkUsers.push(u);
        return u;
      },
    },
  }),
}));
vi.mock('@clerk/backend/errors', () => ({ isClerkAPIResponseError: (e: { errors?: unknown }) => Array.isArray(e?.errors) }));
vi.mock('@whop/sdk', () => ({
  WhopClient: class {
    members = { list: async () => ({ async *[Symbol.asyncIterator]() { yield* fake.members; } }) };
    memberships = { list: async () => ({ data: fake.memberships, async *[Symbol.asyncIterator]() { yield* fake.memberships; } }) };
    payments = { list: async () => ({ data: [{ status: 'paid', substatus: 'succeeded' }] }) };
    promoCodes = {
      list: async (p: { plan_ids?: string[] }) => {
        if (fake.promoForbidden) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
        const found = fake.promos.filter((c) => !p.plan_ids || c.plans.some((id) => p.plan_ids!.includes(id)));
        return { async *[Symbol.asyncIterator]() { yield* found; } };
      },
      create: async (body: Record<string, unknown>, options: unknown) => {
        fake.promoCreated.push({ body, options });
        const c = { id: `promo_${fake.promos.length + 1}`, account: { id: 'biz_test' }, code: body.code, plans: body.plan_ids as string[], status: 'active', uses: 0, created_at: new Date().toISOString() };
        fake.promos.push(c);
        return c;
      },
      retrieve: async ({ id }: { id: string }) => fake.promos.find((c) => c.id === id) ?? Promise.reject(Object.assign(new Error('Not found'), { statusCode: 404 })),
      deactivate: async ({ id }: { id: string }) => Object.assign(fake.promos.find((c) => c.id === id)!, { status: 'inactive' }),
      activate: async ({ id }: { id: string }) => Object.assign(fake.promos.find((c) => c.id === id)!, { status: 'active' }),
      delete: async ({ id }: { id: string }) => (Object.assign(fake.promos.find((c) => c.id === id)!, { status: 'archived' }), true),
    };
  },
}));

import { createSession, hash } from '../server/auth';
import { accessFor } from '../server/billing';
import { handle } from '../server/handler';
import { mailboxKey } from '../server/mailbox';
import { welcomeMail } from '../server/admin';

function clerkUser(id: string, email: string, firstName?: string, createdAt = Date.now()) {
  return { id, primaryEmailAddressId: `idn_${id}`, emailAddresses: [{ id: `idn_${id}`, emailAddress: email }], firstName: firstName ?? null, lastName: null, createdAt, lastActiveAt: createdAt, lastSignInAt: null };
}
const request = (cookie: string, path: string, method = 'GET', body?: unknown, origin = 'https://radiology.monster') =>
  new Request(`https://radiology.monster${path}`, { method, headers: { Cookie: cookie.split(';')[0], Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const owner = () => createSession({ sub: 'clerk_owner', provider: 'clerk', email: 'kerim.sabic@gmail.com', emailVerified: true });
const nextYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  fake.records.clear();
  fake.sets.clear();
  fake.clerkUsers = [clerkUser('clerk_owner', 'kerim.sabic@gmail.com', 'Kerim', Date.now() - 40 * 86_400_000)];
  fake.created = [];
  fake.members = [];
  fake.memberships = [];
  fake.mails = [];
  fake.promos = [];
  fake.promoCreated = [];
  fake.promoForbidden = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => (fake.mails.push(JSON.parse(init.body)), new Response('{}'))));
  for (const [k, v] of Object.entries({ OWNER_EMAILS: 'kerim.sabic@gmail.com', ADMIN_EMAILS: 'kerim.sabic@gmail.com,vercel.admin@example.com', APP_URL: 'https://radiology.monster', WHOP_APP_ID: 'app_test', WHOP_API_KEY: 'test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_PRODUCT_ID: 'prod_test', WHOP_MONTHLY_PLAN_ID: 'plan_monthly', WHOP_YEARLY_PLAN_ID: 'plan_yearly', CLERK_SECRET_KEY: 'sk_test', KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test', RESEND_API_KEY: 're_test', EMAIL_FROM: 'radiology.monster <hello@radiology.monster>' })) vi.stubEnv(k, v);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('admin dashboard boundaries', () => {
  it('answers only a verified admin, and only same-origin changes', async () => {
    for (const path of ['/api/admin/people', '/api/admin/free']) expect((await handle(request('', path, 'POST', {}))).status).toBe(401);
    const learner = await createSession({ sub: 'clerk_learner', provider: 'clerk', email: 'learner@example.com', emailVerified: true });
    expect((await handle(request(learner, '/api/admin/people'))).status).toBe(403);
    for (const path of ['/api/admin/people', '/api/admin/free', '/api/admin/free/remove', '/api/admin/email-sign-in', '/api/admin/role'])
      expect((await handle(request(learner, path, 'POST', { email: 'learner@example.com', freeUntil: null, sendEmail: false, role: 'admin' }))).status).toBe(403);
    expect(fake.records.has(`rvm:grant:${mailboxKey('learner@example.com')}`)).toBe(false);
    expect(fake.records.has(`rvm:admin:${mailboxKey('learner@example.com')}`)).toBe(false);
    const admin = await owner();
    expect((await handle(request(admin, '/api/admin/people', 'POST', { email: 'x@example.com', sendEmail: false }, 'https://evil.test'))).status).toBe(403);
    expect((await handle(request(admin, '/api/admin/people'))).status).toBe(200);
  });
});

describe('the owner, admins and their permissions', () => {
  const role = (cookie: string, body: unknown) => handle(request(cookie, '/api/admin/role', 'POST', body));
  const helperSession = () => createSession({ sub: 'clerk_helper', provider: 'clerk', email: 'helper@gmail.com', emailVerified: true });
  it('gives an admin only the permissions the owner chose, at once', async () => {
    const owner_ = await owner();
    const helper = await helperSession();
    expect((await handle(request(helper, '/api/admin/people'))).status).toBe(403);
    // Kept by mailbox: a Gmail address however it is written.
    expect(await (await role(owner_, { email: 'Hel.per@gmail.com', role: 'admin', permissions: ['people'] })).json()).toMatchObject({ ok: true, permissions: ['people'] });
    expect(fake.records.get(`rvm:admin:${mailboxKey('helper@gmail.com')}`)).toMatchObject({ permissions: ['people'], by: 'kerim.sabic@gmail.com' });
    expect(await (await handle(request(helper, '/api/session'))).json()).toMatchObject({ access: { active: true, role: 'admin' }, adminPermissions: ['people'] });
    expect((await handle(request(helper, '/api/admin/people'))).status).toBe(200);
    for (const [path, method, body] of [
      ['/api/admin/stats', 'GET', undefined],
      ['/api/admin/free', 'POST', { email: 'x@example.com', freeUntil: null }],
      ['/api/admin/free/remove', 'POST', { email: 'x@example.com' }],
      ['/api/admin/people', 'POST', { email: 'x@example.com', sendEmail: false }],
      ['/api/admin/email-sign-in', 'POST', { email: 'x@example.com' }],
      ['/api/admin/certificates/revoke', 'POST', { id: 'RAD-2026-abcdef', reason: 'Testing revocation' }],
    ] as const)
      expect((await handle(request(helper, path, method, body))).status).toBe(403);
    // More permissions, still without free access: adding works, giving free access while adding does not.
    await role(owner_, { email: 'helper@gmail.com', role: 'admin', permissions: ['people', 'add', 'numbers'] });
    expect((await handle(request(helper, '/api/admin/stats'))).status).toBe(200);
    expect((await handle(request(helper, '/api/admin/people', 'POST', { email: 'x@example.com', freeUntil: null, sendEmail: false }))).status).toBe(403);
    expect((await handle(request(helper, '/api/admin/people', 'POST', { email: 'x@example.com', sendEmail: false }))).status).toBe(200);
    expect(fake.sets.get('rvm:grants')?.size ?? 0).toBe(0);
    await role(owner_, { email: 'helper@gmail.com', role: 'user' });
    expect((await handle(request(helper, '/api/admin/people'))).status).toBe(403);
    expect(await (await handle(request(helper, '/api/session'))).json()).toMatchObject({ access: { active: false } });
  });
  it('keeps managing admins the owner’s alone, and invisible to everyone else', async () => {
    const owner_ = await owner();
    const helper = await helperSession();
    await role(owner_, { email: 'helper@gmail.com', role: 'admin', permissions: ['people', 'payments', 'add', 'free', 'numbers', 'certificates'] });
    const vercelAdmin = await createSession({ sub: 'clerk_vercel', provider: 'clerk', email: 'vercel.admin@example.com', emailVerified: true });
    for (const cookie of [helper, vercelAdmin]) {
      // "Not found", as if the address did not exist; nobody else's role changes.
      const r = await role(cookie, { email: 'kerim.sabic@gmail.com', role: 'user' });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'Not found' });
      expect((await role(cookie, { email: 'friend@example.com', role: 'admin', permissions: ['people'] })).status).toBe(404);
      const session = await (await handle(request(cookie, '/api/session'))).json();
      expect(session.adminPermissions).not.toContain('admins');
      const people = JSON.stringify(await (await handle(request(cookie, '/api/admin/people'))).json());
      expect(people).not.toMatch(/owner|adminSource|permissions/);
    }
    expect(fake.records.has(`rvm:admin:${mailboxKey('friend@example.com')}`)).toBe(false);
    expect((await (await handle(request(owner_, '/api/session'))).json()).adminPermissions).toContain('admins');
    // The owner's own role and ADMIN_EMAILS admins are not changed here.
    expect((await role(owner_, { email: 'kerim.sabic@gmail.com', role: 'user' })).status).toBe(400);
    const v = await role(owner_, { email: 'vercel.admin@example.com', role: 'user' });
    expect(v.status).toBe(400);
    expect((await v.json()).error).toContain('Vercel');
    expect((await role(owner_, { email: 'helper@gmail.com', role: 'owner' })).status).toBe(400);
    expect((await role(owner_, { email: 'helper@gmail.com', role: 'admin', permissions: ['admins'] })).status).toBe(400);
  });
  it('hides payments from admins without that permission', async () => {
    fake.clerkUsers.push(clerkUser('clerk_payer', 'payer@example.com', 'Payer'));
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    fake.memberships = [{ id: 'mem_payer', account: { id: 'biz_test' }, plan_id: 'plan_yearly', status: 'active', current_period_end: future, expires_at: null, manage_url: null, user_id: 'user_payer', product_id: 'prod_test' }];
    fake.members = [{ account_id: 'biz_test', email: 'payer@example.com', user: { id: 'user_payer' } }];
    const owner_ = await owner();
    const helper = await helperSession();
    await role(owner_, { email: 'helper@gmail.com', role: 'admin', permissions: ['people'] });
    const seen = await (await handle(request(helper, '/api/admin/people'))).json();
    expect(seen.whop).toBe('hidden');
    expect(seen.counts).toMatchObject({ paying: null, plans: null });
    const payer = seen.people.find((p: { email: string }) => p.email === 'payer@example.com');
    expect(payer).toMatchObject({ access: 'member' });
    expect(payer).not.toHaveProperty('plan');
    expect(payer).not.toHaveProperty('paidUntil');
    await role(owner_, { email: 'helper@gmail.com', role: 'admin', permissions: ['people', 'payments'] });
    const paid = await (await handle(request(helper, '/api/admin/people'))).json();
    expect(paid.people.find((p: { email: string }) => p.email === 'payer@example.com')).toMatchObject({ access: 'paid', plan: 'yearly' });
  });
  it('needs a verified email before an admin role opens anything', async () => {
    const owner_ = await owner();
    await role(owner_, { email: 'unverified@example.com', role: 'admin', permissions: ['people'] });
    const id = hash('whop:user_unverified');
    fake.records.set(`rvm:identity:${id}`, { email: 'unverified@example.com', emailVerified: false });
    expect((await accessFor(id)).active).toBe(false);
  });
  it('shows the owner each admin’s source and permissions', async () => {
    fake.clerkUsers.push(clerkUser('clerk_helper', 'helper@example.com', 'Helper'));
    const owner_ = await owner();
    await role(owner_, { email: 'helper@example.com', role: 'admin', permissions: ['numbers', 'people'] });
    await role(owner_, { email: 'future-admin@example.com', role: 'admin', permissions: [] });
    const r = await (await handle(request(owner_, '/api/admin/people'))).json();
    const by = Object.fromEntries((r.people as Array<{ email: string }>).map((p) => [p.email, p]));
    expect(by['kerim.sabic@gmail.com']).toMatchObject({ role: 'admin', adminSource: 'owner', access: 'admin' });
    expect(by['helper@example.com']).toMatchObject({ role: 'admin', adminSource: 'dashboard', permissions: ['people', 'numbers'] });
    expect(by['future-admin@example.com']).toMatchObject({ role: 'admin', account: null, permissions: [] });
    expect(r.counts.admins).toBe(3);
  });
});

describe('promo codes', () => {
  const promo = (changes: Record<string, unknown> = {}) => ({
    id: 'promo_spring', account: { id: 'biz_test' }, code: 'spring20', plans: ['plan_monthly', 'plan_yearly'], promo_type: 'percentage', amount_off: 0.2,
    duration: 'once', promo_duration_months: 1, uses: 4, stock: 46, unlimited_stock: false, expires_at: null, new_users_only: false, one_per_customer: true,
    status: 'active', created_at: '2026-11-01T10:00:00.000Z', ...changes,
  });
  const create = (cookie: string, body: Record<string, unknown>) => handle(request(cookie, '/api/admin/promos', 'POST', body));
  const valid = { code: 'Spring20', type: 'percentage', amountOff: 20, plans: ['monthly', 'yearly'], duration: 'once', stock: 50, lastDay: null, newUsersOnly: false, onePerCustomer: true };
  it('lists the codes with their plans and uses, without the single-use student offers', async () => {
    fake.promos = [
      promo(),
      promo({ id: 'promo_year', code: 'year30', plans: ['plan_yearly'], promo_type: 'flat_amount', amount_off: 30, duration: 'forever', promo_duration_months: 0, unlimited_stock: true, created_at: '2026-11-02T10:00:00.000Z' }),
      promo({ id: 'promo_old', code: 'gone', status: 'archived' }),
      // The two live cases Whop showed as 1/2 and 1/1.
      promo({ id: 'promo_nadin', code: 'nadin', uses: 1, stock: 1, created_at: '2026-10-20T10:00:00.000Z' }),
      promo({ id: 'promo_test123', code: 'test123', uses: 1, stock: 0, created_at: '2026-10-19T10:00:00.000Z' }),
      promo({ id: 'promo_s1', code: 'rvmstudentabc', uses: 1 }),
      promo({ id: 'promo_s2', code: 'rvmstudentdef', uses: 0 }),
    ];
    const r = await (await handle(request(await owner(), '/api/admin/promos'))).json();
    expect(r.promos.map((p: { code: string }) => p.code)).toEqual(['year30', 'spring20', 'nadin', 'test123']);
    expect(r.promos[2]).toMatchObject({ uses: 1, stock: 2, left: 1 });
    expect(r.promos[3]).toMatchObject({ uses: 1, stock: 1, left: 0 });
    // Whop counts stock down: 4 used and 46 left is 4 of 50.
    expect(r.promos[1]).toMatchObject({ type: 'percentage', amountOff: 20, plans: ['monthly', 'yearly'], uses: 4, stock: 50, left: 46, duration: 'once' });
    expect(r.promos[0]).toMatchObject({ type: 'flat_amount', amountOff: 30, plans: ['yearly'], stock: null, left: null, duration: 'forever' });
    expect(r.studentOffers).toEqual({ issued: 2, used: 1 });
  });
  it('creates a code in Whop with exactly the chosen terms', async () => {
    const admin = await owner();
    const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const r = await create(admin, { ...valid, duration: 'months', months: 3, lastDay: day, newUsersOnly: true });
    expect(await r.json()).toMatchObject({ ok: true, code: 'spring20' });
    expect(fake.promoCreated[0].body).toEqual({
      account_id: 'biz_test', product_id: 'prod_test', plan_ids: ['plan_monthly', 'plan_yearly'], code: 'spring20', promo_type: 'percentage', amount_off: 20, base_currency: 'usd',
      promo_duration_months: 3, new_users_only: true, churned_users_only: false, existing_memberships_only: false, one_per_customer: true, unlimited_stock: false, stock: 50,
      expires_at: `${day}T23:59:59.999Z`,
    });
    expect(fake.promoCreated[0].options).toMatchObject({ idempotencyKey: expect.stringMatching(/^promo-[a-f0-9]{64}$/) });
    // Every payment, no limit, no end, monthly only.
    await create(admin, { ...valid, code: 'forever10', amountOff: 10, plans: ['monthly'], duration: 'forever', stock: null });
    expect(fake.promoCreated[1].body).toMatchObject({ plan_ids: ['plan_monthly'], promo_duration_months: 0, unlimited_stock: true, expires_at: null });
    expect(fake.promoCreated[1].body).not.toHaveProperty('stock');
  });
  it('refuses unclear or impossible codes before Whop sees them', async () => {
    const admin = await owner();
    fake.promos = [promo()];
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ code: 'SPRING20' }, 'already exists'],
      [{ code: 'rvmstudentfree' }, 'student offers'],
      [{ code: 'no spaces' }, 'Check the code'],
      [{ code: 'ab' }, 'Check the code'],
      [{ amountOff: 120 }, 'whole number from 1 to 100'],
      [{ amountOff: 12.5 }, 'whole number from 1 to 100'],
      [{ type: 'flat_amount', amountOff: 25, plans: ['monthly', 'yearly'] }, 'at most $20'],
      [{ duration: 'months' }, 'how many months'],
      [{ lastDay: '2020-01-01' }, 'in the future'],
      [{ plans: [] }, 'Check the code'],
      [{ extra: true }, 'Check the code'],
    ];
    for (const [changes, error] of cases) {
      const r = await create(admin, { ...valid, code: 'fresh1', ...changes });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toContain(error);
    }
    expect(fake.promoCreated).toHaveLength(0);
  });
  it('pauses, resumes and deletes only this business’s codes, never a student offer', async () => {
    const admin = await owner();
    fake.promos = [promo(), promo({ id: 'promo_other', account: { id: 'biz_other' } }), promo({ id: 'promo_s1', code: 'rvmstudentabc' })];
    const change = (id: string, action: string) => handle(request(admin, '/api/admin/promos/change', 'POST', { id, action }));
    expect((await change('promo_spring', 'pause')).status).toBe(200);
    expect(fake.promos[0].status).toBe('inactive');
    expect((await change('promo_spring', 'resume')).status).toBe(200);
    expect(fake.promos[0].status).toBe('active');
    expect((await change('promo_spring', 'delete')).status).toBe(200);
    expect(fake.promos[0].status).toBe('archived');
    for (const id of ['promo_other', 'promo_s1']) expect((await change(id, 'pause')).status).toBe(400);
    expect(fake.promos[1].status).toBe('active');
    expect((await change('promo_spring', 'archive')).status).toBe(400);
  });
  it('says plainly when the Whop connection has no promo code access', async () => {
    fake.promoForbidden = true;
    const admin = await owner();
    expect(await (await handle(request(admin, '/api/admin/promos'))).json()).toMatchObject({ ok: false, needsWhopAccess: true });
    const r = await create(admin, valid);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ needsWhopAccess: true });
  });
  it('is the owner’s, or an admin’s given the promo permission', async () => {
    const admin = await owner();
    const helper = await createSession({ sub: 'clerk_helper', provider: 'clerk', email: 'helper@example.com', emailVerified: true });
    await handle(request(admin, '/api/admin/role', 'POST', { email: 'helper@example.com', role: 'admin', permissions: ['people'] }));
    expect((await handle(request(helper, '/api/admin/promos'))).status).toBe(403);
    expect((await create(helper, valid)).status).toBe(403);
    await handle(request(admin, '/api/admin/role', 'POST', { email: 'helper@example.com', role: 'admin', permissions: ['people', 'promos'] }));
    expect((await handle(request(helper, '/api/admin/promos'))).status).toBe(200);
    expect((await create(helper, valid)).status).toBe(200);
  });
});

describe('creating accounts and free access', () => {
  it('creates a passwordless account with free access and emails the sign-in steps', async () => {
    const admin = await owner();
    const until = nextYear();
    const r = await handle(request(admin, '/api/admin/people', 'POST', { email: ' New.Student@Example.com ', name: 'Amra Hodžić', freeUntil: until, note: 'SSST tutor', sendEmail: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, created: true, emailed: true, grant: { email: 'new.student@example.com', until: `${until}T23:59:59.999Z`, note: 'SSST tutor', by: 'kerim.sabic@gmail.com' } });
    expect(fake.created).toEqual([{ emailAddress: ['new.student@example.com'], firstName: 'Amra', lastName: 'Hodžić', skipPasswordRequirement: true }]);
    expect(fake.mails).toHaveLength(1);
    expect(fake.mails[0]).toMatchObject({ to: ['new.student@example.com'], subject: 'Your free radiology.monster access is ready' });
    expect(fake.mails[0].text).toContain('Hi Amra,');
    expect(fake.mails[0].text).toContain('https://radiology.monster/?account=login');
    // Their first sign-in opens everything, with no payment recorded.
    const student = await createSession({ sub: 'clerk_1', provider: 'clerk', email: 'new.student@example.com', emailVerified: true });
    expect(await (await handle(request(student, '/api/session'))).json()).toMatchObject({ access: { active: true, role: 'granted', expiresAt: `${until}T23:59:59.999Z` } });
    expect(fake.records.has(`rvm:once:paid:${hash('clerk:clerk_1')}`)).toBe(false);
  });
  it('reuses an existing account, keeps the note and changes or removes free access at once', async () => {
    fake.clerkUsers.push(clerkUser('clerk_friend', 'friend@example.com', 'Lejla'));
    const admin = await owner();
    const friend = hash('clerk:clerk_friend');
    await createSession({ sub: 'clerk_friend', provider: 'clerk', email: 'friend@example.com', emailVerified: true });
    expect((await accessFor(friend)).active).toBe(false);
    expect(await (await handle(request(admin, '/api/admin/people', 'POST', { email: 'friend@example.com', freeUntil: null, note: 'Family', sendEmail: false }))).json()).toMatchObject({ created: false, emailed: false, grant: { until: null } });
    expect(fake.created).toHaveLength(0);
    expect(fake.mails).toHaveLength(0);
    expect(await accessFor(friend)).toEqual({ active: true, role: 'granted', expiresAt: null });
    const until = nextYear();
    expect(await (await handle(request(admin, '/api/admin/free', 'POST', { email: 'friend@example.com', freeUntil: until }))).json()).toMatchObject({ grant: { until: `${until}T23:59:59.999Z`, note: 'Family' } });
    expect((await handle(request(admin, '/api/admin/free/remove', 'POST', { email: 'friend@example.com' }))).status).toBe(200);
    expect((await accessFor(friend)).active).toBe(false);
  });
  it('refuses past or impossible dates, bad addresses and accounts Clerk will not create', async () => {
    const admin = await owner();
    for (const freeUntil of ['2020-01-01', '2027-02-30', 'tomorrow'])
      expect((await handle(request(admin, '/api/admin/people', 'POST', { email: 'a@example.com', freeUntil, sendEmail: true }))).status).toBe(400);
    expect((await handle(request(admin, '/api/admin/people', 'POST', { email: 'not-an-email', sendEmail: false }))).status).toBe(400);
    expect((await handle(request(admin, '/api/admin/people', 'POST', { email: 'a@example.com', sendEmail: false, role: 'admin' }))).status).toBe(400);
    const blocked = await handle(request(admin, '/api/admin/people', 'POST', { email: 'someone@blocked.test', freeUntil: null, sendEmail: true }));
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toBe('This email domain is not allowed.');
    expect(fake.created).toHaveLength(0);
    expect(fake.mails).toHaveLength(0);
    expect(fake.sets.get('rvm:grants')?.size ?? 0).toBe(0);
  });
  it('emails the sign-in steps again only to an existing account', async () => {
    const admin = await owner();
    expect((await handle(request(admin, '/api/admin/email-sign-in', 'POST', { email: 'nobody@example.com' }))).status).toBe(400);
    fake.clerkUsers.push(clerkUser('clerk_friend', 'friend@example.com', 'Lejla'));
    expect((await handle(request(admin, '/api/admin/email-sign-in', 'POST', { email: 'friend@example.com' }))).status).toBe(200);
    expect(fake.mails[0]).toMatchObject({ to: ['friend@example.com'], subject: 'Your radiology.monster account is ready' });
  });
  it('words the welcome email by the free access it has', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    const base = { email: 'a@example.com', by: 'kerim.sabic@gmail.com', at: '2026-11-02T00:00:00.000Z' };
    expect(welcomeMail('a@example.com', undefined, { ...base, until: '2027-01-31T23:59:59.999Z' }, now).text).toContain('until 31 January 2027');
    expect(welcomeMail('a@example.com', undefined, { ...base, until: null }, now).text).toContain('with no end date');
    const ended = welcomeMail('a@example.com', undefined, { ...base, until: '2020-01-01T23:59:59.999Z' }, now);
    expect(ended.subject).toBe('Your radiology.monster account is ready');
    expect(ended.text).not.toContain('Free access');
    expect(welcomeMail('a<b>@example.com', 'Ana', null, now).html).not.toContain('a<b>');
  });
});

describe('the people list and its counts', () => {
  it('counts every account exactly and shows each one’s access', async () => {
    const day = 86_400_000;
    fake.clerkUsers.push(
      clerkUser('clerk_payer', 'payer@example.com', 'Payer', Date.now() - 3 * day),
      clerkUser('clerk_yearly', 'yearly@example.com', 'Yearly', Date.now() - 10 * day),
      clerkUser('clerk_gift', 'gift@example.com', 'Gift', Date.now() - 2 * day),
      clerkUser('clerk_plain', 'plain@example.com', 'Plain', Date.now() - 60 * day),
    );
    const admin = await owner();
    await createSession({ sub: 'clerk_plain', provider: 'clerk', email: 'plain@example.com', emailVerified: true });
    fake.records.set(`rvm:profile:${hash('clerk:clerk_plain')}`, { email: 'plain@example.com', name: 'Plain', tz: 'UTC', days: ['2026-01-02', new Date().toISOString().slice(0, 10)], prefs: { streak: false, weekly: false } });
    // An older Whop sign-in, and a Clerk sign-in whose Clerk account was deleted (not an account any more).
    await createSession({ sub: 'user_old', provider: 'whop', email: 'old@example.com', emailVerified: true });
    await createSession({ sub: 'clerk_deleted', provider: 'clerk', email: 'gone@example.com', emailVerified: true });
    fake.records.set(`rvm:whop-user:${hash('clerk:clerk_yearly')}`, 'user_yearly');
    const future = new Date(Date.now() + 20 * day).toISOString();
    const m = (user_id: string, plan_id: string) => ({ id: `mem_${user_id}`, account: { id: 'biz_test' }, plan_id, status: 'active', current_period_end: future, expires_at: null, manage_url: null, user_id, product_id: 'prod_test' });
    fake.memberships = [m('user_payer', 'plan_monthly'), m('user_yearly', 'plan_yearly'), m('user_whop_only', 'plan_monthly')];
    fake.members = [
      { account_id: 'biz_test', email: 'Payer@example.com', user: { id: 'user_payer' } },
      { account_id: 'biz_test', email: 'yearly-other@example.com', user: { id: 'user_yearly' } },
      { account_id: 'biz_test', email: 'whop-only@example.com', user: { id: 'user_whop_only' } },
    ];
    for (const [email, freeUntil] of [['gift@example.com', null], ['waiting@example.com', nextYear()]] as const)
      await handle(request(admin, '/api/admin/free', 'POST', { email, freeUntil }));
    fake.records.set(`rvm:grant:${mailboxKey('ended@example.com')}`, { email: 'ended@example.com', until: '2020-01-01T23:59:59.999Z', by: 'kerim.sabic@gmail.com', at: '2019-12-01T00:00:00.000Z' });
    fake.sets.get('rvm:grants')!.add(mailboxKey('ended@example.com'));

    const r = await (await handle(request(admin, '/api/admin/people'))).json();
    expect(r.whop).toBe('ok');
    expect(r.counts).toMatchObject({
      accounts: 6,
      clerkAccounts: 5,
      openedApp: 3,
      paying: 3,
      payingWithoutAccount: 1,
      plans: { monthly: 2, yearly: 1, lifetime: 0 },
      free: 2,
      freeWaiting: 1,
      admins: 1,
      // The older Whop sign-in joined today; the payer and the gift this week; the yearly member this month.
      newAccounts: { d1: 1, d7: 3, d30: 4 },
      studied: { d7: 1 },
    });
    const by = Object.fromEntries((r.people as Array<{ email: string }>).map((p) => [p.email, p]));
    expect(by['kerim.sabic@gmail.com']).toMatchObject({ access: 'admin', account: 'clerk', firstVisit: expect.any(String) });
    expect(by['payer@example.com']).toMatchObject({ access: 'paid', plan: 'monthly', paidUntil: future });
    expect(by['yearly@example.com']).toMatchObject({ access: 'paid', plan: 'yearly' });
    expect(by['gift@example.com']).toMatchObject({ access: 'free', grant: { until: null, active: true } });
    expect(by['plain@example.com']).toMatchObject({ access: 'none', studyDays: 2, lastStudied: new Date().toISOString().slice(0, 10) });
    expect(by['old@example.com']).toMatchObject({ account: 'whop', access: 'none' });
    expect(by['waiting@example.com']).toMatchObject({ account: null, access: 'free' });
    expect(by['ended@example.com']).toMatchObject({ account: null, access: 'none', grant: { active: false } });
    expect(by['gone@example.com']).toBeUndefined();
  });
  it('still lists everyone when Whop cannot be read', async () => {
    const admin = await owner();
    fake.memberships = [{ get user_id() { throw new Error('Whop is down'); } }];
    const r = await (await handle(request(admin, '/api/admin/people'))).json();
    expect(r).toMatchObject({ whop: 'unavailable', counts: { accounts: 1, paying: null } });
  });
});
