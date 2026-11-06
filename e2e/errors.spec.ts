import { expect, test } from '@playwright/test';
import { signedInMember } from './member';

// The app never ends on a black screen: a CT-scanner splash shows before any JavaScript, and failures show the
// reading-room error screen with the message and a reload (src/components/ScanState.tsx, index.html).

test('the scanner splash is in the page before the app starts, and the app replaces it', async ({ page }) => {
  await signedInMember(page);
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('id="rvm-boot"');
  expect(html).toContain('Opening the reading room');
  expect(html).toContain('url(data:image/webp;base64,'); // the CT slices travel with the page: no second request
  await page.goto('/');
  await expect(page.locator('#rvm-boot')).toHaveCount(0);
  await expect(page.getByRole('navigation').first()).toBeVisible();
});

test('the app’s main code failing to download shows the error screen, not a black page', async ({ page }) => {
  await page.route(/\/assets\/index-[^/]+\.js$/, (r) => r.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Radiology Monster didn’t finish loading' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/');
  await expect(page.getByLabel('Error message')).toContainText('Could not download /assets/index-');
});

test('a page whose code fails to download reloads once, then shows the page error screen with the top bar', async ({ page }) => {
  await signedInMember(page);
  let loads = 0;
  page.on('load', () => (loads += 1));
  await page.route(/\/assets\/Course-[^/]+\.js$/, (r) => r.abort('failed'));
  await page.goto('/course');
  await expect(page.getByRole('heading', { name: 'This page didn’t finish loading' })).toBeVisible({ timeout: 20_000 });
  expect(loads).toBe(2); // the first failure reloaded the tab once; the second went to the error screen
  await expect(page.getByLabel('Error message')).toContainText(/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically/);
  await expect(page.getByRole('link', { name: 'Course' }).first()).toBeVisible(); // the top bar still works
});
