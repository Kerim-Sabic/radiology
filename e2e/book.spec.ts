/**
 * Book reader on the production build. Requires the owner's PDF installed locally
 * (python scripts/book/install_book.py --pdf <file>); skipped otherwise.
 */
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.skip(!existsSync('public/book/learning-radiology-5e.pdf'), 'book PDF not installed on this machine');

test('opens Fig 3.5 at PDF 40 / printed 25 with objectives and linked real-scan practice', async ({ page }) => {
  await page.goto('/book/40');
  await expect(page.getByText(/Chapter 3 · Recognizing Normal Cardiac Anatomy/)).toBeVisible();
  await expect(page.getByText(/Page 25 · PDF 40 of 552/)).toBeVisible();
  await expect(page.getByText('Fig 3.5', { exact: true })).toBeVisible();
  await expect(page.getByText('ch03-o04')).toBeVisible();
  await expect(page.getByRole('link', { name: /five great vessels/ }).first()).toBeVisible();
  await page.waitForFunction(() => (document.querySelector('canvas[aria-label^="Book page"]') as HTMLCanvasElement)?.width > 200);
});

test('inserted electronic pages keep later anchors correct', async ({ page }) => {
  await page.goto('/book/99');
  await expect(page.getByText(/Page 79\.e5 · PDF 99/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/Page 80 · PDF 100/)).toBeVisible();
  await page.goto('/book/469');
  await expect(page.getByText(/^Appendix F · /)).toBeVisible();
  await expect(page.getByText(/Page e50 · PDF 469/)).toBeVisible();
});
