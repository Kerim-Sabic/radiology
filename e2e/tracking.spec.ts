/**
 * The anonymous event log on the ad's path: a guest on a phone over slow 4G opens the Reel 002 link, taps the
 * esophagus and answers. Each key event is logged once and in order, every batch goes only to this site's own
 * /api/ev, and the suite's requests carry the header that makes the server drop them.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'Touch emulation and network throttling need Chromium');

test('the ad path logs land → case_shell → first_image → mark → answer → grade_seen, each once, only to this site', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const batches: Array<{ url: string; test: string | null; body: { vid: string; sid: string; ev: Array<[number, string, Record<string, unknown>?]> } }> = [];
  await page.route('**/api/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/config') return r.fulfill({ json: { auth: true, billing: true } });
    if (path === '/api/session') return r.fulfill({ status: 401, json: { user: null, error: 'Please sign in.' } });
    if (path === '/api/ev') {
      batches.push({ url: r.request().url(), test: r.request().headers()['x-rvm-test'] ?? null, body: r.request().postDataJSON() });
      return r.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/track') return r.fulfill({ json: { ok: true } });
    return r.fulfill({ status: 401, json: { error: 'Please sign in.' } });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });

  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aesophagus&mode=practice&utm_source=meta&utm_campaign=reel002&utm_content=h1');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 150_000 });
  await expect(page.locator('.ws-tap-hint')).toHaveText('Tap the esophagus');
  // One tap on the esophagus (the centre of the expert outline on image 92).
  const at = await page.evaluate(() => {
    const e = (window as any).__rvm;
    return e.worldToCanvas('p0', e.imagePxToWorld(e.panelState('p0').currentImageId, [262, 296]));
  });
  const box = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
  await page.touchscreen.tap(box.x + at[0], box.y + at[1]);
  await page.getByRole('button', { name: /^Submit/ }).first().tap();
  await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();

  const names = () => batches.flatMap((b) => b.body.ev.map((e) => e[1]));
  await expect.poll(names, { timeout: 15_000 }).toContain('grade_seen');
  const seq = names();
  const order = ['land', 'case_shell', 'first_image', 'mark', 'answer', 'grade_seen'];
  for (const n of order) expect(seq.filter((x) => x === n), n).toHaveLength(1);
  expect(order.map((n) => seq.indexOf(n))).toEqual([...order.map((n) => seq.indexOf(n))].sort((a, b) => a - b));
  // What the events say.
  const all = batches.flatMap((b) => b.body.ev);
  expect(all.find((e) => e[1] === 'land')?.[2]).toMatchObject({ path: '/read/starter-ct-chest-01', tag: 'meta:reel002:h1' });
  expect(all.find((e) => e[1] === 'answer')?.[2]).toMatchObject({ task: 'starter-ct-chest-01:esophagus', mode: 'practice', correct: true, assisted: false });
  expect(Number(all.find((e) => e[1] === 'first_image')?.[2]?.ms)).toBeGreaterThan(0);
  // One visitor and one session throughout; every batch went to this site only, marked as a test.
  expect(new Set(batches.map((b) => b.body.vid)).size).toBe(1);
  expect(new Set(batches.map((b) => b.body.sid)).size).toBe(1);
  for (const b of batches) {
    expect(new URL(b.url).origin).toBe(new URL(baseURL!).origin);
    expect(b.test).toBe('1');
  }
});

test('a browser that opened ?internal=1 logs nothing', async ({ page }) => {
  const sent: string[] = [];
  await page.route('**/api/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/ev') sent.push(path);
    if (path === '/api/config') return r.fulfill({ json: { auth: true, billing: true } });
    return r.fulfill({ status: 401, json: { error: 'Please sign in.' } });
  });
  await page.goto('/?internal=1');
  await page.waitForTimeout(500);
  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('rvm.internal'))).toBe('1');
});
