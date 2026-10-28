/**
 * Book reader on the production build. RVM_BOOK_TEST_PDF supplies the member
 * endpoint fixture; no textbook is committed or copied into the static build.
 */
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { expect, test } from './member';
import { BOOK_SIZE, bookRange, memberBook } from '../server/book';

// Every build removes dist/book (see vite.config.ts).
const testPdf = process.env.RVM_BOOK_TEST_PDF;
const liveStorage = process.env.RVM_BOOK_LIVE_STORAGE === '1';
test.skip(!liveStorage && !testPdf && !existsSync('dist/book/learning-radiology-5e.pdf'), 'Set RVM_BOOK_TEST_PDF or RVM_BOOK_LIVE_STORAGE to exercise the protected member reader');
test.beforeEach(async ({ page }) => {
  if (liveStorage) {
    await page.route('**/api/book', async route => {
      const request = route.request();
      const response = await memberBook(new Request(request.url(), { method: request.method(), headers: request.headers() }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    return;
  }
  if (!testPdf) return;
  await page.route('**/api/book', async route => {
    const headers = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
    if (route.request().method() === 'HEAD') return route.fulfill({ headers: { ...headers, 'Content-Length': String(BOOK_SIZE) }, body: '' });
    const range = bookRange(route.request().headers().range || null);
    if (!range) return route.fulfill({ status: 416 });
    const fd = openSync(testPdf, 'r'), body = Buffer.alloc(range.end - range.start + 1);
    try { readSync(fd, body, 0, body.length, range.start); } finally { closeSync(fd); }
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${BOOK_SIZE}` }, body });
  });
});

test('opens Fig 3.5 at PDF 40 / printed 25 with objectives and linked real-scan practice', async ({ page }) => {
  await page.goto('/book/40');
  await expect(page.getByText(/Chapter 3 · Recognizing Normal Cardiac Anatomy/)).toBeVisible();
  await expect(page.getByText(/Page 25 · PDF 40 of 552/)).toBeVisible();
  await expect(page.getByText('Fig 3.5', { exact: true })).toBeVisible();
  await expect(page.getByText('ch03-o04')).toBeVisible();
  await expect(page.getByRole('link', { name: /five great vessels/ }).first()).toBeVisible();
  await expect(page.locator('canvas[aria-label^="Book page"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Import PDF', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'test-results/member-book-desktop.png', fullPage: true });
});

test('member book renders on a phone without requiring a PDF import', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/book/40');
  await expect(page.locator('canvas[aria-label^="Book page"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/member-book-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await expect(page.locator('#book-contents-list')).toBeVisible();
  await page.getByRole('button', { name: 'Close contents', exact: true }).click();
  await expect(page.locator('#book-contents-list')).not.toBeVisible();
});

test('inserted electronic pages keep later anchors correct', async ({ page }) => {
  await page.goto('/book/99');
  await expect(page.getByText(/Page 79\.e5 · PDF 99/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/Page 80 · PDF 100/)).toBeVisible();
  await page.goto('/book/469');
  await expect(page.getByText(/^Appendix F · /)).toBeVisible();
  await expect(page.getByText(/Page e50 · PDF 469/)).toBeVisible();
  await expect(page.locator('canvas[aria-label^="Book page"]')).toHaveAttribute('aria-busy', 'false');
});
