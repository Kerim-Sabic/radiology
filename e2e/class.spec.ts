/**
 * Professors and their classes against a mocked account API (`vite preview` serves no /api): the class page, adding and
 * removing students, and what a student in a class is told.
 */
import { test, expect, type Page } from '@playwright/test';

const CODE = 'AbCdEf123456';
const classData = () => ({
  join: { code: CODE, open: true },
  free: { seats: 30, used: 2, left: 28, until: '2027-06-30T23:59:59.999Z', open: true },
  summary: { students: 3, signedUp: 2, active7: 1, examsPassed: 2, certificates: 1 },
  students: [
    {
      email: 'lejla@stu.ssst.edu.ba', name: 'Lejla', account: true, lastActiveAt: new Date().toISOString(), days7: 3, days30: 9, lastStudied: '2026-11-02',
      exams: [{ area: 'chest', level: 1, passed: true, score: 0.85, finishedAt: '2026-11-01T10:00:00.000Z' }, { area: 'head', level: 1, passed: false, score: 0.6, finishedAt: '2026-11-02T10:00:00.000Z' }],
      certificates: [{ id: 'RAD-2026-ABCDEF0123456789', title: 'Chest Imaging Certificate – Level 1 (Foundation)', issuedAt: '2026-11-01T10:05:00.000Z', revoked: false }],
      freeFromClass: { until: '2027-06-30T23:59:59.999Z' },
    },
    { email: 'emir@stu.ssst.edu.ba', name: 'Emir', account: true, lastActiveAt: null, days7: 0, days30: 1, lastStudied: '2026-10-20', exams: [{ area: 'msk', level: 1, passed: true, score: 0.72, finishedAt: '2026-10-20T10:00:00.000Z' }], certificates: [], freeFromClass: null },
    { email: 'new@stu.ssst.edu.ba', name: '', account: false, lastActiveAt: null, days7: 0, days30: 0, lastStudied: null, exams: [], certificates: [], freeFromClass: { until: '2027-06-30T23:59:59.999Z' } },
  ],
});

async function professor(page: Page) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Prof. Amra', email: 'prof@ssst.edu.ba' }, access: { active: true, role: 'professor', expiresAt: null }, billingReady: true, teaches: true } }));
  await page.route('**/api/class**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === 'GET') return r.fulfill({ json: classData() });
    const body = r.request().postDataJSON();
    posts.push({ path, body });
    if (path === '/api/class/students')
      return r.fulfill({ json: { ok: true, freeLeft: 26, results: [...(body.emails as string[]).map((email) => ({ email, added: true, created: true, free: true, emailed: true })), { email: 'lejla@stu.ssst.edu.ba', added: false, note: 'already in your class' }] } });
    return r.fulfill({ json: { ok: true } });
  });
  return posts;
}

test('a professor follows each student’s study, exams and certificates', async ({ page }) => {
  await professor(page);
  await page.goto('/class');
  await expect(page.getByRole('heading', { name: 'My class', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My class' })).toBeVisible();
  await expect(page.getByText('Professor · free access', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your class at a glance')).toContainText('Students3');
  await expect(page.getByRole('region', { name: 'Add students' })).toContainText('free access to 28 more students (2 of 30 used, until 30 Jun 2027)');
  const lejla = page.getByRole('row', { name: /Lejla/ });
  await expect(lejla).toContainText('3 days this week');
  await expect(lejla).toContainText('Chest L1 · 85% ✓');
  await expect(lejla).toContainText('Head L1 · 60% ✗');
  await expect(lejla.getByRole('link', { name: /Chest Imaging Certificate/ })).toHaveAttribute('href', '/verify/RAD-2026-ABCDEF0123456789');
  await expect(lejla).toContainText('Free access through your class until 30 Jun 2027');
  await expect(page.getByRole('row', { name: /new@stu/ })).toContainText('No account yet');
  await page.getByLabel('Search students').fill('emir');
  await expect(page.locator('table.class-roster tbody tr')).toHaveCount(1);
});

test('adds pasted emails and removes a student only after confirming', async ({ page }) => {
  const posts = await professor(page);
  await page.goto('/class');
  const form = page.getByRole('form', { name: 'Add students' });
  await form.getByLabel('Student emails').fill('Amra@stu.ssst.edu.ba, dino@stu.ssst.edu.ba\n  amra@stu.ssst.edu.ba ; not an email');
  await expect(form).toContainText('2 emails found');
  await form.getByRole('button', { name: 'Add to class' }).click();
  await expect(page.getByRole('region', { name: 'Add students' }).getByRole('status')).toContainText('Added 2 students. 2 got free access through your class. 2 were emailed how to sign in. Not added: lejla@stu.ssst.edu.ba (already in your class).');
  expect(posts.at(-1)).toEqual({ path: '/api/class/students', body: { emails: ['amra@stu.ssst.edu.ba', 'dino@stu.ssst.edu.ba'], sendEmail: true } });
  await page.getByRole('button', { name: 'Remove emir@stu.ssst.edu.ba' }).click();
  expect(posts.at(-1)?.path).toBe('/api/class/students');
  await page.getByRole('button', { name: 'Confirm removing emir@stu.ssst.edu.ba' }).click();
  await expect(page.getByRole('region', { name: 'Students', exact: true }).getByRole('status')).toContainText('Emir is no longer in your class.');
  expect(posts.at(-1)).toEqual({ path: '/api/class/students/remove', body: { email: 'emir@stu.ssst.edu.ba' } });
});

test('a student is told who follows their progress, and can leave', async ({ page }) => {
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Lejla', email: 'lejla@stu.ssst.edu.ba' }, access: { active: true, role: 'granted', expiresAt: null }, billingReady: true, classes: [{ email: 'prof@ssst.edu.ba', name: 'Prof. Amra' }] } }));
  await page.route('**/api/class/leave', async (r) => {
    posts.push({ path: '/api/class/leave', body: r.request().postDataJSON() });
    await r.fulfill({ json: { ok: true } });
  });
  await page.goto('/settings');
  const notice = page.getByRole('region', { name: 'Your class' });
  await expect(notice).toContainText('You are in Prof. Amra’s class. Prof. Amra can see your study days, exam results and certificates, not your answers or payments.');
  await expect(page.getByRole('link', { name: 'My class' })).toHaveCount(0);
  await notice.getByRole('button', { name: 'Leave this class' }).click();
  await expect(notice).toContainText('Leaving ends any free access you have through the class.');
  await notice.getByRole('button', { name: 'Leave for good' }).click();
  await expect(notice).toHaveCount(0);
  expect(posts).toEqual([{ path: '/api/class/leave', body: { professor: 'prof@ssst.edu.ba' } }]);
});

test('the owner makes someone a professor with free places for their students', async ({ page }) => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Kerim', email: 'kerim.sabic@gmail.com' }, access: { active: true, role: 'admin', expiresAt: null }, billingReady: true, adminPermissions: ['people', 'admins'] } }));
  await page.route('**/api/admin/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === 'GET')
      return r.fulfill({
        json: {
          counts: { accounts: 1, clerkAccounts: 1, openedApp: 1, paying: null, payingWithoutAccount: null, plans: null, free: 0, freeWaiting: 0, admins: 0, professors: 0, newAccounts: { d1: 0, d7: 0, d30: 0 }, active: { d7: 0, d30: 0 }, studied: { d7: 0, d30: 0 } },
          whop: 'hidden',
          people: [{ email: 'prof@ssst.edu.ba', name: 'Amra', account: 'clerk', createdAt: new Date().toISOString(), lastActiveAt: null, firstVisit: null, lastStudied: null, studyDays: 0, access: 'none', role: 'user' }],
        },
      });
    posts.push({ path, body: r.request().postDataJSON() });
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Manage prof@ssst.edu.ba' }).click();
  const roleForm = page.locator('.admin-edit').getByRole('form', { name: 'Role' });
  await roleForm.getByRole('combobox', { name: /^Role/ }).selectOption('professor');
  await roleForm.getByLabel('Students they may give free access').fill('30');
  await roleForm.getByLabel("Last day of their students' free access").fill('2027-06-30');
  await roleForm.getByRole('button', { name: 'Save role' }).click();
  await expect(page.locator('.admin-edit').getByRole('status')).toContainText('prof@ssst.edu.ba is a professor now');
  expect(posts.at(-1)).toEqual({ path: '/api/admin/role', body: { email: 'prof@ssst.edu.ba', role: 'professor', seats: 30, freeUntil: '2027-06-30' } });
});

test('a professor shares, replaces or pauses the class join link', async ({ page }) => {
  const posts = await professor(page);
  await page.goto('/class');
  const card = page.getByRole('region', { name: 'Join link' });
  await expect(card.getByLabel('Join link')).toHaveValue(`http://localhost:4317/join/${CODE}`);
  await card.getByRole('button', { name: 'Make a new link' }).click();
  expect(posts).toHaveLength(0);
  await expect(card).toContainText('The old link stops working; students already in the class stay.');
  await card.getByRole('button', { name: 'Yes, make a new link' }).click();
  await expect(card.getByRole('status')).toContainText('A new link is ready. The old one no longer works.');
  expect(posts.at(-1)).toEqual({ path: '/api/class/link', body: { action: 'new' } });
  await card.getByRole('button', { name: 'Turn joining off' }).click();
  await expect(card.getByRole('status')).toContainText('Joining is off.');
  expect(posts.at(-1)).toEqual({ path: '/api/class/link', body: { action: 'close' } });
});

async function visitor(page: Page, signedIn: boolean) {
  const joined: unknown[] = [];
  await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await page.route('**/api/session', (r) =>
    r.fulfill(signedIn ? { json: { user: { name: 'Lejla', email: 'lejla@stu.ssst.edu.ba' }, access: { active: false }, billingReady: true } } : { status: 401, json: { user: null } }),
  );
  await page.route('**/api/class/invite**', (r) => (new URL(r.request().url()).searchParams.get('code') === CODE ? r.fulfill({ json: { name: 'Prof. Amra', free: true } }) : r.fulfill({ status: 404, json: { error: 'This join link does not work any more.' } })));
  await page.route('**/api/class/join', async (r) => {
    joined.push(r.request().postDataJSON());
    await r.fulfill({ json: { ok: true, name: 'Prof. Amra', already: false, free: { until: '2027-06-30T23:59:59.999Z' } } });
  });
  return joined;
}

test('a visitor with the link sees the invitation, and is taken back to it after signing in', async ({ page }) => {
  await visitor(page, false);
  await page.goto(`/join/${CODE}`);
  const banner = page.getByRole('note').filter({ hasText: 'invited you to their class' });
  await expect(banner).toContainText('Prof. Amra invited you to their class on radiology.monster. It includes free access to everything.');
  await banner.getByRole('button', { name: 'Create a free account' }).click();
  await expect(page.locator('.auth-dialog')).toBeVisible();
  // Signed in now (the tab kept the code): the app opens the invitation instead of Today.
  await page.unrouteAll();
  await visitor(page, true);
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/join/${CODE}$`));
  await expect(page.getByRole('heading', { name: 'Join Prof. Amra’s class' })).toBeVisible();
});

test('a signed-in student sees what the professor will follow, then joins with one click', async ({ page }) => {
  const joined = await visitor(page, true);
  await page.goto(`/join/${CODE}`);
  await expect(page.getByRole('heading', { name: 'Join Prof. Amra’s class' })).toBeVisible();
  await expect(page.locator('.join-card')).toContainText('Prof. Amra will see your study days, exam results and certificates, not your answers or payments.');
  await expect(page.locator('.join-card')).toContainText('This class includes free access to everything');
  await page.getByRole('button', { name: 'Join the class' }).click();
  await expect(page.getByRole('heading', { name: /You are in Prof. Amra’s class/ })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Free access to everything is on until 30 June 2027.');
  expect(joined).toEqual([{ code: CODE }]);
  // The code is used up in this tab: Today stays Today.
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('an old or mistyped link says so plainly', async ({ page }) => {
  const joined = await visitor(page, true);
  await page.goto('/join/OldCode123456');
  await expect(page.getByRole('heading', { name: 'This link has ended' })).toBeVisible();
  await expect(page.locator('.join-card')).toContainText('Ask your professor for the current one.');
  expect(joined).toHaveLength(0);
});
