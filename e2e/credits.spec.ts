import { expect, test as base } from '@playwright/test';
import { test as member } from './member';

/** The sources and credits page is public: it opens signed out and signed in, names the owners' datasets and fits a phone. */
async function checkPage(page: import('@playwright/test').Page) {
  await page.goto('/credits');
  await expect(page.getByRole('heading', { level: 1, name: 'Sources and credits' })).toBeVisible();
  await expect(page.getByText('presented by')).toBeVisible();
  for (const name of [/ARCADE/, /CADICA/, /TotalSegmentator/]) await expect(page.getByRole('heading', { level: 3, name }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

base('opens without an account, on a phone too', async ({ page }) => {
  await page.route('**/api/**', (r) => r.fulfill({ status: 401, json: { user: null } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await checkPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await checkPage(page);
});

member('opens for a signed-in member', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkPage(page);
  await expect(page.getByText('Used with the owners’ permission').first()).toBeVisible();
});
