/**
 * The admin dashboard against a mocked account API (`vite preview` serves no /api): the counts, adding a person by
 * email with free access, and changing one person's access from the list.
 */
import { test, expect, type Page } from '@playwright/test';

const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
function people() {
  return {
    counts: {
      accounts: 4,
      clerkAccounts: 4,
      openedApp: 3,
      paying: 2,
      payingWithoutAccount: 1,
      plans: { monthly: 1, yearly: 1, lifetime: 0 },
      free: 2,
      freeWaiting: 1,
      admins: 1,
      newAccounts: { d1: 1, d7: 2, d30: 3 },
      active: { d7: 3, d30: 4 },
      studied: { d7: 2, d30: 3 },
    },
    whop: 'ok',
    people: [
      { email: 'kerim.sabic@gmail.com', name: 'Kerim', account: 'clerk', createdAt: iso(-40 * day), lastActiveAt: iso(0), firstVisit: '2026-09-01', lastStudied: null, studyDays: 0, access: 'admin', role: 'admin', adminSource: 'owner', permissions: ['people', 'payments', 'add', 'free', 'numbers', 'certificates'] },
      { email: 'payer@example.com', name: 'Paying Student', account: 'clerk', createdAt: iso(-3 * day), lastActiveAt: iso(-day), firstVisit: '2026-10-30', lastStudied: '2026-11-01', studyDays: 4, access: 'paid', role: 'user', plan: 'yearly', paidUntil: iso(300 * day) },
      { email: 'friend@example.com', name: 'Lejla', account: 'clerk', createdAt: iso(-2 * day), lastActiveAt: iso(-2 * day), firstVisit: '2026-10-31', lastStudied: null, studyDays: 0, access: 'free', role: 'user', grant: { until: null, note: 'Family', by: 'kerim.sabic@gmail.com', at: iso(-2 * day), active: true } },
      { email: 'waiting@example.com', name: '', account: null, createdAt: null, lastActiveAt: null, firstVisit: null, lastStudied: null, studyDays: 0, access: 'free', role: 'user', grant: { until: '2027-11-02T23:59:59.999Z', by: 'kerim.sabic@gmail.com', at: iso(0), active: true } },
      { email: 'plain@example.com', name: '', account: 'clerk', createdAt: iso(-60 * day), lastActiveAt: iso(-20 * day), firstVisit: '2026-09-03', lastStudied: '2026-10-12', studyDays: 1, access: 'none', role: 'user' },
    ],
  };
}

const ALL = ['people', 'payments', 'add', 'free', 'promos', 'numbers', 'certificates', 'admins'];
const promos = (needsWhopAccess = false) =>
  needsWhopAccess
    ? { ok: false, error: 'Whop has not given this app access to promo codes yet.', needsWhopAccess: true }
    : {
        promos: [
          { id: 'promo_spring', code: 'spring20', type: 'percentage', amountOff: 20, duration: 'once', months: 1, plans: ['monthly', 'yearly'], uses: 4, stock: 50, expiresAt: null, newUsersOnly: false, onePerCustomer: true, status: 'active', createdAt: '2026-11-01T10:00:00.000Z' },
          { id: 'promo_year', code: 'year30', type: 'flat_amount', amountOff: 30, duration: 'forever', months: 0, plans: ['yearly'], uses: 0, stock: null, expiresAt: '2027-01-31T23:59:59.999Z', newUsersOnly: true, onePerCustomer: true, status: 'inactive', createdAt: '2026-10-30T10:00:00.000Z' },
        ],
        studentOffers: { issued: 3, used: 1 },
      };
async function admin(page: Page, adminPermissions = ALL, view: () => object = people, promoView: () => object = promos) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Kerim', email: 'kerim.sabic@gmail.com' }, access: { active: true, role: 'admin', expiresAt: null }, billingReady: true, adminPermissions } }));
  await page.route('**/api/admin/stats', (r) => r.fulfill({ json: { series: [], totals: { visit: 10, signup_start: 5, signup: 4, studied: 3, plans: 2, checkout: 1, paid: 1 }, accounts: 4, subscribers: 1, retention: { d1: { base: 3, back: 2 }, d7: { base: 2, back: 1 } } } }));
  await page.route('**/api/admin/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/admin/stats') return r.fallback();
    if (r.request().method() === 'GET') return r.fulfill({ json: path === '/api/admin/promos' ? promoView() : view() });
    const body = r.request().postDataJSON();
    posts.push({ path, body });
    if (path === '/api/admin/people') return r.fulfill({ json: { ok: true, created: true, emailed: true, grant: body.freeUntil === undefined ? null : { email: body.email, until: body.freeUntil ? `${body.freeUntil}T23:59:59.999Z` : null } } });
    if (path === '/api/admin/promos') return r.fulfill({ json: { ok: true, id: 'promo_new', code: String(body.code).toLowerCase() } });
    if (path === '/api/admin/free') return r.fulfill({ json: { ok: true, grant: { email: body.email, until: body.freeUntil ? `${body.freeUntil}T23:59:59.999Z` : null } } });
    return r.fulfill({ json: { ok: true } });
  });
  return posts;
}

test('shows the exact counts and every person with their access', async ({ page }) => {
  await admin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
  const kpis = page.getByLabel('Accounts at a glance');
  await expect(kpis.locator('.card').first()).toContainText('Accounts4');
  await expect(kpis).toContainText('1 monthly · 1 yearly · 1 paid on Whop with no account here');
  await expect(kpis).toContainText('1 not signed in yet');
  const table = page.locator('table.admin-people');
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(table.getByRole('row', { name: /Paying Student/ })).toContainText('Paying · Yearly');
  await expect(table.getByRole('row', { name: /Lejla/ })).toContainText('no end date');
  await expect(table.getByRole('row', { name: /waiting@example.com/ })).toContainText('No account yet');
  await page.getByRole('button', { name: /^Free access · 2$/ }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /^Everyone · 5$/ }).click();
  await page.getByLabel('Search people').fill('family');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
});

test('creates an account for an email with free access and the sign-in email', async ({ page }) => {
  const posts = await admin(page);
  await page.goto('/admin');
  const form = page.getByRole('region', { name: 'Add a person' });
  await form.getByLabel('Email', { exact: true }).fill('new.student@example.com');
  await form.getByLabel('Name (optional)').fill('Amra');
  await form.getByLabel('Access').selectOption('1y');
  await form.getByLabel('Note (only admins see it)').fill('SSST tutor');
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(form.getByRole('status')).toContainText('Account created for new.student@example.com. Free access is on, until');
  await expect(form.getByRole('status')).toContainText('We emailed them how to sign in.');
  const next = new Date();
  next.setMonth(next.getMonth() + 12);
  const lastDay = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  expect(posts).toEqual([{ path: '/api/admin/people', body: { email: 'new.student@example.com', name: 'Amra', freeUntil: lastDay, note: 'SSST tutor', sendEmail: true } }]);
  await expect(form.getByLabel('Email', { exact: true })).toHaveValue('');
  // Without free access and without the email.
  await form.getByLabel('Email', { exact: true }).fill('plain.account@example.com');
  await form.getByLabel('Access').selectOption('none');
  await form.getByLabel('Email them how to sign in').uncheck();
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(form.getByRole('status')).toContainText('No free access: they see the free edition. No email was sent.');
  expect(posts[1]).toEqual({ path: '/api/admin/people', body: { email: 'plain.account@example.com', sendEmail: false } });
});

test('changes, removes and re-sends from one person’s row', async ({ page }) => {
  const posts = await admin(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Manage plain@example.com' }).click();
  const panel = page.locator('.admin-edit');
  await panel.getByLabel('Access').selectOption('date');
  await panel.getByLabel('Last day of free access').fill('2027-06-30');
  await panel.getByRole('button', { name: 'Give free access' }).click();
  await expect(panel.getByRole('status')).toContainText('Free access is on, until 30 Jun 2027.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/free', body: { email: 'plain@example.com', freeUntil: '2027-06-30', note: '' } });
  await page.getByRole('button', { name: 'Manage friend@example.com' }).click();
  await panel.getByRole('button', { name: 'Remove free access' }).click();
  await expect(panel.getByRole('status')).toContainText('Free access removed.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/free/remove', body: { email: 'friend@example.com' } });
  await panel.getByRole('button', { name: 'Email sign-in steps' }).click();
  await expect(panel.getByRole('status')).toContainText('We emailed friend@example.com how to sign in.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/email-sign-in', body: { email: 'friend@example.com' } });
  await page.getByRole('button', { name: 'Manage waiting@example.com' }).click();
  await panel.getByRole('button', { name: 'Create their account and email them' }).click();
  await expect(panel.getByRole('status')).toContainText('Account created for waiting@example.com. We emailed them how to sign in.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/people', body: { email: 'waiting@example.com', sendEmail: true } });
});

test('a free-access account sees its access in the menu', async ({ page }) => {
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Lejla', email: 'friend@example.com' }, access: { active: true, role: 'granted', expiresAt: '2027-06-30T23:59:59.999Z' }, billingReady: true } }));
  await page.goto('/');
  await expect(page.getByText('Free access until 30 Jun 2027', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
});

test('makes a person an admin with the permissions chosen, only after confirming', async ({ page }) => {
  const posts = await admin(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Manage payer@example.com' }).click();
  const panel = page.locator('.admin-edit');
  const role = panel.getByRole('form', { name: 'Role' });
  const save = role.getByRole('button', { name: 'Save role' });
  await expect(save).toBeDisabled();
  await role.getByRole('combobox', { name: /^Role/ }).selectOption('admin');
  // A new admin starts with seeing people and the numbers; the owner picks the rest.
  await expect(role.getByLabel('See the people list: names, emails, study')).toBeChecked();
  await expect(role.getByLabel('Give and remove free access')).not.toBeChecked();
  await role.getByLabel('Give and remove free access').check();
  await role.getByLabel('See the sign-up and retention numbers').uncheck();
  await expect(save).toBeDisabled();
  await role.getByLabel('I trust them with these permissions').check();
  await save.click();
  await expect(panel.getByRole('status')).toContainText('payer@example.com is an admin now.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/role', body: { email: 'payer@example.com', role: 'admin', permissions: ['people', 'free'] } });
  // Your own row cannot be changed here.
  await page.getByRole('button', { name: 'Manage kerim.sabic@gmail.com' }).click();
  await expect(panel.getByRole('combobox', { name: /^Role/ })).toBeDisabled();
  await expect(panel).toContainText('only you manage admins');
});

test('an admin sees only what they may, and nothing about managing admins', async ({ page }) => {
  // What the server sends an admin who may see people only: payments hidden, roles without their source.
  const limited = () => {
    const v = people();
    return {
      ...v,
      counts: { ...v.counts, paying: null, payingWithoutAccount: null, plans: null },
      whop: 'hidden',
      people: v.people.map(({ adminSource: _s, permissions: _p, plan: _plan, paidUntil: _u, ...p }: Record<string, unknown>) => ({ ...p, access: p.access === 'paid' ? 'member' : p.access })),
    };
  };
  await admin(page, ['people'], limited);
  await page.goto('/admin');
  await expect(page.locator('table.admin-people tbody tr')).toHaveCount(5);
  await expect(page.getByLabel('Accounts at a glance')).not.toContainText('Paying');
  await expect(page.getByRole('row', { name: /Paying Student/ })).toContainText('Member');
  for (const hidden of ['Add a person', 'Funnel, last 30 days', 'Certificate records']) await expect(page.getByText(hidden)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Manage / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Paying · / })).toHaveCount(0);
  await expect(page.getByText(/only you manage|permissions|set in Vercel|Role/)).toHaveCount(0);
});

test('creates a promo code with a clear price preview, and pauses or deletes one', async ({ page }) => {
  const posts = await admin(page);
  await page.goto('/admin');
  const section = page.getByRole('region', { name: 'Promo codes' });
  await expect(section.getByRole('row', { name: /spring20/ })).toContainText('20% off');
  await expect(section.getByRole('row', { name: /spring20/ })).toContainText('4 of 50');
  await expect(section.getByRole('row', { name: /year30/ })).toContainText('$30 off');
  await expect(section.getByRole('row', { name: /year30/ })).toContainText('paused');
  await expect(section).toContainText('3 single-use offers issued');
  const form = section.getByRole('form', { name: 'Create a promo code' });
  await form.getByLabel('Code').fill('Exam25');
  await form.getByLabel('Amount off').fill('25');
  await form.getByLabel('Lasts for').selectOption('months');
  await form.getByLabel('Months', { exact: true }).fill('3');
  await form.getByRole('checkbox', { name: /^Yearly/ }).uncheck();
  await form.getByLabel('Limit the number of uses').check();
  await form.getByLabel('Number of uses', { exact: true }).fill('100');
  await expect(form).toContainText('Monthly: $20 → $15 for the first 3 months, then $20');
  await form.getByRole('button', { name: 'Create code' }).click();
  await expect(form.getByRole('status')).toContainText('Created “exam25”');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/promos', body: { code: 'Exam25', type: 'percentage', amountOff: 25, plans: ['monthly'], duration: 'months', months: 3, stock: 100, lastDay: null, newUsersOnly: false, onePerCustomer: true } });
  await section.getByRole('button', { name: 'Pause spring20' }).click();
  await expect(section.getByRole('status').last()).toContainText('“spring20” is paused.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/promos/change', body: { id: 'promo_spring', action: 'pause' } });
  // Deleting asks once more.
  await section.getByRole('button', { name: 'Delete year30' }).click();
  expect(posts.at(-1)?.body).not.toMatchObject({ action: 'delete' });
  await section.getByRole('button', { name: 'Confirm deleting year30' }).click();
  await expect(section.getByRole('status').last()).toContainText('“year30” is deleted.');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/promos/change', body: { id: 'promo_year', action: 'delete' } });
});

test('explains how to reconnect Whop when it has no promo code access', async ({ page }) => {
  await admin(page, ALL, people, () => promos(true));
  await page.goto('/admin');
  const section = page.getByRole('region', { name: 'Promo codes' });
  await expect(section).toContainText('Whop has not given this app access to promo codes yet.');
  await expect(section).toContainText('scripts/setup-whop-merchant.ts');
  await expect(section.getByRole('form', { name: 'Create a promo code' })).toHaveCount(0);
});

test('a shared promo link fills in the code for the buyer', async ({ page }) => {
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Student', email: 'student@example.com' }, access: { active: false }, billingReady: true } }));
  await page.goto('/?plans&promo=SPRING20');
  await expect(page.getByLabel('Promo code', { exact: true })).toHaveValue('SPRING20');
});
