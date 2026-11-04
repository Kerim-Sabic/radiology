/**
 * Progress follows the account: two browser contexts are two devices signed in to one (mocked) account, sharing the
 * server's saved-record code (progressServer.ts). An answer submitted on one appears on the other, exactly once,
 * and the reading room says truthfully whether it is saved.
 */
import type { Browser, Page } from '@playwright/test';
import { expect, signedInMember, test } from './member';
import { progressServer } from './progressServer';

const HEART = '/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=practice';

async function device(browser: Browser, server: ReturnType<typeof progressServer>) {
  const context = await browser.newContext({ baseURL: 'http://localhost:4317', viewport: { width: 1440, height: 900 } });
  await signedInMember(context);
  await server.attach(context);
  return { context, page: await context.newPage() };
}

/** Answer the heart task correctly: a point at the middle of the reference outline, then Submit. */
async function answerHeart(page: Page, open = true) {
  if (open) await page.goto(HEART);
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  const { c, idx } = await page.evaluate(async () => {
    const g = await fetch('/packs/starter/targets/lctsc-train-s1-012_heart.json').then((r) => r.json());
    const plane = g.planes[Math.floor(g.planes.length / 2)];
    const poly = plane.polygons[0];
    const c = poly.reduce((a: number[], p: number[]) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length, a[2] + p[2] / poly.length], [0, 0, 0]);
    return { c, idx: (window as any).__rvm.panel('p0').source.sopUids.indexOf(plane.sopInstanceUid) };
  });
  await page.evaluate((i) => (window as any).__rvm.setIndex('p0', i), idx);
  await page.waitForFunction((i) => {
    const e = (window as any).__rvm;
    const st = e.panelState('p0');
    return st?.index === i && st.currentImageId === e.panel('p0').source.imageIds[i];
  }, idx);
  await page.evaluate(() => (window as any).__rvm.setTool('point'));
  for (let k = 0; k < 2; k++) {
    await page.locator('[data-panel="p0"] .vp-el').waitFor();
    await page.evaluate((world) => {
      const e = (window as any).__rvm;
      const xy = e.worldToCanvas('p0', world);
      const el = document.querySelector('[data-panel="p0"] .vp-el')!;
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + xy[0], clientY: r.top + xy[1], button: 0, view: window };
      el.dispatchEvent(new MouseEvent('mousemove', { ...o, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    }, c);
    if (await page.waitForFunction(() => (window as any).__rvm.collectMarks().length > 0, null, { timeout: 2000 }).then(() => true, () => false)) break;
  }
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
}

const correctOnProgress = (page: Page) => page.locator('.stat').filter({ hasText: 'independent correct' }).locator('b');

test('an answer made on one device appears on the other after sign-in, with no duplicates', async ({ browser }) => {
  const server = progressServer();
  const laptop = await device(browser, server);
  const phone = await device(browser, server);
  const status = laptop.page.getByTestId('sync-status');

  // The laptop loses its connection just before submitting: the answer is kept and the reading room says Offline.
  await laptop.page.goto(HEART);
  await expect(status).toHaveText('Saved');
  server.down = true;
  await answerHeart(laptop.page, false);
  await expect(status).toHaveText('Offline');
  expect(server.entries()).toHaveLength(0);

  // Back online: the queued answer is saved to the account, once.
  server.down = false;
  await expect(status).toHaveText('Saved', { timeout: 15_000 });
  expect(server.entries().map((e) => e.t)).toEqual(['c']);

  // The phone signs in: the answer is there.
  await phone.page.goto('/progress');
  await expect(correctOnProgress(phone.page)).toHaveText('1');
  await expect(phone.page.getByText('Every answer you submit is saved to your account')).toBeVisible();

  // Refreshes on both devices and returning to the reading room add nothing.
  await laptop.page.reload();
  await phone.page.reload();
  await expect(correctOnProgress(phone.page)).toHaveText('1');
  await laptop.page.goto('/progress');
  await expect(correctOnProgress(laptop.page)).toHaveText('1');
  await phone.page.goto(HEART);
  await expect(phone.page.getByTestId('sync-status')).toHaveText('Saved');
  expect(server.entries()).toHaveLength(1);

  // And the other way: the phone answers too; the laptop sees both once it is back in view.
  await answerHeart(phone.page);
  await expect(phone.page.getByTestId('sync-status')).toHaveText('Saved');
  expect(server.entries()).toHaveLength(2);
  await laptop.page.reload();
  await expect(correctOnProgress(laptop.page)).toHaveText('2');
  expect(server.entries()).toHaveLength(2);

  await laptop.context.close();
  await phone.context.close();
});
