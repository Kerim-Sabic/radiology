/**
 * The Certificates tab (members): three levels for each body area and for the whole library, the certificates the
 * account holds, and the example certificate anyone can open.
 */
import { expect, test } from './member';

test('the certificates tab shows every level, what each asks for, and the certificates held', async ({ page }) => {
  await page.route('**/api/certificates', (r) =>
    r.fulfill({ json: { certificates: [{ id: 'abcDEF123_-x', name: 'Test Member', area: 'chest', level: 1, title: 'Chest imaging', patients: 12, judged: 14, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' }] } }),
  );
  await page.goto('/');
  await page.getByRole('link', { name: 'Certificates' }).first().click();
  await expect(page).toHaveURL(/\/certificates$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible();
  const levels = page.locator('.certs-levels');
  await expect(levels).toContainText('Level 1 · Core');
  await expect(levels).toContainText('Level 2 · Proficient');
  await expect(levels).toContainText('Level 3 · Advanced');
  await expect(levels).toContainText('30 graded answers without hints · 85% right');
  for (const title of ['Chest imaging', 'Neuroimaging', 'Breast imaging', 'General radiology']) await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  // Three levels in every area, each with its progress.
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest imaging' }) });
  await expect(chest.locator('.certs-ladder > li')).toHaveCount(3);
  await expect(chest.getByRole('progressbar', { name: /Chest imaging, Level 3 · Advanced/ })).toBeVisible();
  // The certificate held: listed, and marked on its level.
  await expect(page.locator('.certs-mine')).toContainText('Level 1 · Core');
  await expect(page.locator('.certs-mine').getByRole('link', { name: /View and share/ })).toHaveAttribute('href', '/certificate/abcDEF123_-x');
  await expect(chest.locator('.certs-ladder > li').first()).toContainText('Issued');
  await expect(page.getByRole('link', { name: /See an example/ })).toHaveAttribute('href', '/certificate/example');
  // Progress points here.
  await page.goto('/progress');
  await page.getByRole('link', { name: 'Open certificates' }).click();
  await expect(page).toHaveURL(/\/certificates$/);
});

test('the example certificate shows a level and says it is an example', async ({ page }) => {
  await page.goto('/certificate/example');
  await expect(page.locator('.cert-name')).toHaveText('Your Name');
  await expect(page.locator('.cert-line')).toHaveText('has completed Level 2 · Proficient in');
  await expect(page.locator('.cert-example')).toContainText('This is an example');
  await expect(page.locator('.cert-seal')).toContainText('Level 2');
  await expect(page.getByRole('button', { name: 'Add to LinkedIn profile' })).toHaveCount(0);
  await expect(page.locator('.cert-check')).toHaveCount(0);
});

test('start certification: the app opens the patient a level needs, then the next one after each answer', async ({ page }) => {
  await page.goto('/certificates');
  await expect(page.locator('.certs-how')).toContainText('Start certification');
  await expect(page.locator('.certs-how')).toContainText('Finish certification');
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest imaging' }) });
  await chest.getByRole('button', { name: /Start certification/ }).first().click();
  await expect(page).toHaveURL(/\/read\/[^?]+\?task=.+&mode=practice&cert=chest-1$/);
  const bar = page.locator('.ws-cert');
  await expect(bar).toContainText('Chest imaging · Level 1 · Core');
  await expect(bar).toContainText('0/10 patients');
  const first = new URL(page.url()).pathname;
  // Answer in the quickest honest way (first option, or "not assessable").
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  const options = page.getByRole('group', { name: 'Answer options' }).locator('input');
  if (await options.count()) await options.first().check();
  else if (await page.getByRole('button', { name: 'Not visible / not assessable' }).count()) await page.getByRole('button', { name: 'Not visible / not assessable' }).click();
  else if (await page.getByRole('button', { name: 'No abnormality found' }).count()) await page.getByRole('button', { name: 'No abnormality found' }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(bar).toContainText('1/10 patients');
  await page.getByRole('button', { name: 'Next for your certificate →' }).click();
  await expect(page).toHaveURL(/cert=chest-1$/);
  expect(new URL(page.url()).pathname).not.toBe(first);
  await expect(page.locator('.ws-cert')).toContainText('1/10 patients');
  // Switching mode keeps the certificate.
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Learn' }).click();
  await expect(page).toHaveURL(/cert=chest-1/);
});
