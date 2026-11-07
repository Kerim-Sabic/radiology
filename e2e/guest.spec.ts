/**
 * A visitor with no account, from an ad or a shared link, opens a sample patient straight away: marks it, submits,
 * sees the grade, and is asked to create a free account to keep it. Signing up keeps the page and uploads the answer.
 * Members-only patients and every other page still show the landing page.
 */
import { expect, test, type Page } from '@playwright/test';

const AD = '/read/cxr-00003400-003?task=cxr-00003400-003%3Alocate&mode=practice&utm_source=meta&utm_medium=paid_social&utm_campaign=noarrow_a';

async function visitor(page: Page) {
  const state = { signedIn: false, track: [] as Array<Record<string, unknown>>, accountCalls: [] as string[], uploaded: [] as Array<Record<string, unknown>> };
  await page.route('**/api/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/config') return r.fulfill({ json: { auth: true, billing: true } });
    if (path === '/api/session')
      return state.signedIn
        ? r.fulfill({ json: { user: { name: 'New Student', email: 'new@example.com' }, access: { active: false }, billingReady: true } })
        : r.fulfill({ status: 401, json: { user: null, error: 'Please sign in.' } });
    if (path === '/api/track') {
      state.track.push(r.request().postDataJSON());
      return r.fulfill({ json: { ok: true } });
    }
    if (!state.signedIn) state.accountCalls.push(path);
    if (path === '/api/progress/attempts' && r.request().method() === 'GET') return r.fulfill({ json: { ok: true, gen: 'g1', resetAt: null, from: 0, entries: [], next: 0, total: 0 } });
    if (path === '/api/progress/attempts' && r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as { attempts: Array<Record<string, unknown>> };
      state.uploaded.push(...body.attempts);
      return r.fulfill({ json: { ok: true, codes: '1'.repeat(body.attempts.length), start: 0, end: body.attempts.length } });
    }
    return r.fulfill({ status: state.signedIn ? 200 : 401, json: state.signedIn ? { ok: true } : { error: 'Please sign in.' } });
  });
  return state;
}

/** A point in the middle of the NIH radiologist box (image pixels 607–849 × 57–285). */
async function markTheFinding(page: Page) {
  await page.evaluate(() => (window as any).__rvm.setTool('point'));
  await page.evaluate(() => {
    const e = (window as any).__rvm;
    const id = e.panelState('p0').currentImageId;
    const c = e.worldToCanvas('p0', e.imagePxToWorld(id, [728, 171]));
    const el = document.querySelector('[data-panel="p0"] .vp-el')!;
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + c[0], clientY: r.top + c[1], button: 0, view: window };
    el.dispatchEvent(new MouseEvent('mousemove', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
  });
  await page.waitForFunction(() => (window as any).__rvm.collectMarks().length > 0, null, { timeout: 5000 });
}

test('a visitor with no account answers the free X-ray from an ad, then keeps it by signing up', async ({ page }) => {
  const state = await visitor(page);
  await page.goto(AD);
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Find the pneumothorax' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guest: create a free account to save your answer' })).toBeVisible();
  // No report link and no account calls for a guest.
  await expect(page.getByRole('button', { name: 'Report a problem with this case' })).toHaveCount(0);

  await markTheFinding(page);
  await page.getByRole('button', { name: /^Submit/ }).first().click();
  await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
  const card = page.getByRole('region', { name: 'Save your answer' });
  await expect(card).toContainText('Keep this answer.');
  await expect.poll(() => state.track.map((t) => t.event)).toEqual(expect.arrayContaining(['guest_open', 'guest_answer']));
  expect(state.track.find((t) => t.event === 'guest_open')?.source).toBe('meta:noarrow_a');
  expect(state.accountCalls.filter((p) => !p.startsWith('/api/progress'))).toEqual([]);
  expect(state.accountCalls.filter((p) => p.startsWith('/api/progress'))).toEqual([]);

  // Start free opens the sign-up form over the case.
  await card.getByRole('button', { name: 'Start free' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your next chapter starts here.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');

  // The account is made and comes back to this page (src/auth/returnPath.ts): the case is still open and the
  // guest's answer goes up to the new account.
  state.signedIn = true;
  await page.goto(`${AD}&account=verified`);
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Find the pneumothorax' })).toBeVisible();
  await expect.poll(() => state.uploaded.map((a) => a.taskId)).toContain('cxr-00003400-003:locate');
  expect(new URL(page.url()).searchParams.has('account')).toBe(false);
  await expect(page.getByRole('button', { name: 'Guest: create a free account to save your answer' })).toHaveCount(0);
});

test('the ad’s chest CT in Learn mode opens at the heart, and saving the answer comes first after the result', async ({ page }) => {
  await visitor(page);
  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn&utm_source=meta&utm_campaign=131slices&utm_content=a_en');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  // Not slice 1 (the top of the head): the level where the heart is largest.
  await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').index), { timeout: 10_000 }).toBeGreaterThan(40);
  // The view is centred on the heart: a point in the middle of the image is inside it.
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).__rvm.setTool('point'));
  await page.evaluate(() => {
    const el = document.querySelector('[data-panel="p0"] .vp-el')!;
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
    el.dispatchEvent(new MouseEvent('mousemove', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
  });
  await page.waitForFunction(() => (window as any).__rvm.collectMarks().length > 0, null, { timeout: 5000 });
  await page.getByRole('button', { name: /^Submit/ }).first().click();
  await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
  const result = page.locator('.result-first');
  await expect(result.getByRole('button', { name: /Save it: free account/ })).toBeVisible();
  // The next step is the same one-tap kind of task, now without the outline.
  await expect(result.getByRole('button', { name: 'Next: find the esophagus, no outline' })).toBeVisible();
  await result.getByRole('button', { name: /Save it: free account/ }).click();
  await expect(page.getByRole('dialog', { name: 'Your next chapter starts here.' })).toBeVisible();
});

test('the other sample patient opens too, and everything else still asks to sign in', async ({ page }) => {
  await visitor(page);
  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=practice');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Find the heart' })).toBeVisible();

  for (const path of ['/read/pe-pat005?task=pe-pat005%3Alocate&mode=practice', '/cases', '/']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: /Learn to read/ }), path).toBeVisible();
    await expect(page.locator('[data-panel="p0"]'), path).toHaveCount(0);
  }
});

test('on a slow or data-saving connection only the slices near the one shown are fetched, and the window follows the scroll', async ({ page }) => {
  await visitor(page);
  // What the browser reports on a 3G connection with data saver on.
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g', saveData: true, downlink: 0.8 } }));
  const fetched = new Set<string>();
  page.on('request', (r) => {
    if (/\/packs\/starter\/dicom\/[^/]+\/[0-9a-f]+\.dcm$/.test(r.url())) fetched.add(r.url());
  });
  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  // 12 slices each side of the one shown, plus slice 1 and at most the 3 after it when slice 1 arrives before the task's
  // slice is known (a race only a local server loses: on a slow link the task, a small file, is there first).
  expect(fetched.size).toBeLessThanOrEqual(29);
  expect(fetched.size).toBeGreaterThan(5);
  const before = fetched.size;
  await page.evaluate(() => (window as any).__rvm.setIndex('p0', 10));
  await expect.poll(() => fetched.size, { timeout: 15_000 }).toBeGreaterThan(before + 10);
  expect(fetched.size).toBeLessThan(131);
  // Reformatting needs every slice: MPR still fetches the whole series.
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: 'MPR: axial / coronal / sagittal' }).click();
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p1')?.ready === true, null, { timeout: 90_000 });
  expect(fetched.size).toBe(131);
});

test.describe('the ad visitor on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch emulation needs Chromium');

  test('one tap on the heart marks it (a second tap moves the point, a swipe still scrolls), and the answer is graded', async ({ page }) => {
    await visitor(page);
    await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn&utm_source=meta&utm_campaign=131slices&utm_content=b_inpkph');
    await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').index), { timeout: 10_000 }).toBeGreaterThan(40);
    expect(await page.evaluate(() => (window as any).__rvm.getTool())).toBe('scroll');
    // The image says what one tap does, until the first tap.
    await expect(page.locator('.ws-tap-hint')).toHaveText('Tap the heart');
    await page.waitForTimeout(400);
    const box = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
    const tapAt = async (fx: number, fy: number) => {
      const tap: [number, number] = [Math.round(box.width * fx), Math.round(box.height * fy)];
      await page.touchscreen.tap(box.x + tap[0], box.y + tap[1]);
      await expect.poll(() => page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
      await page.waitForTimeout(700); // the mouse events the browser sends after a tap must not add a second mark
      expect(await page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
      const at = await page.evaluate(() => {
        const e = (window as any).__rvm;
        return e.worldToCanvas('p0', e.collectMarks()[0].worldLps[0]);
      });
      expect(Math.hypot(at[0] - tap[0], at[1] - tap[1])).toBeLessThan(3);
    };
    await tapAt(0.3, 0.3);
    await expect(page.locator('.ws-tap-hint')).toHaveCount(0);
    await tapAt(0.5, 0.5); // moved to the middle of the view, inside the heart
    await expect(page.locator('.ws-tool-flash')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__rvm.getTool())).toBe('scroll');
    await page.getByRole('button', { name: /^Submit/ }).first().tap();
    await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
  });

  test('the reel\u2019s question lands as the first task: Practice opens at the esophagus with its outline hidden, one tap answers it', async ({ page }) => {
    await visitor(page);
    await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aesophagus&mode=practice&utm_source=meta&utm_campaign=reel002');
    await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Find the esophagus' })).toBeVisible();
    // At the level where the esophagus is largest (the heart's level), not at slice 1.
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').index), { timeout: 10_000 }).toBeGreaterThan(40);
    await expect(page.locator('.ws-tap-hint')).toHaveText('Tap the esophagus');
    // Practice: the image names nothing before the answer (no reference outline label, no anatomy names).
    await expect(page.locator('[data-panel="p0"]').getByText(/esophagus/i)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(0);
  });

  test('while the reading room downloads, the question and its first picture are already on screen', async ({ page }) => {
    await visitor(page);
    // The reading room's code arrives late, as on a slow phone connection; the app shell and the poster don't.
    await page.route(/\/assets\/Workstation-[^/]+\.js$/, async (r) => {
      await new Promise((res) => setTimeout(res, 4000));
      return r.fallback();
    });
    await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aesophagus&mode=practice&utm_source=meta&utm_campaign=reel002');
    const preview = page.getByRole('status', { name: 'Opening the case' });
    await expect(preview.getByRole('heading', { name: 'Find the esophagus' })).toBeVisible({ timeout: 3500 });
    await expect(preview.locator('img')).toHaveAttribute('src', '/landing/posters/starter-ct-chest-01--esophagus.webp');
    expect(await preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(300);
    // Then the reading room takes over, at the same slice.
    await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
    await expect(preview).toHaveCount(0);
  });

  test('the first picture stays in the viewer until the first slice is drawn', async ({ page }) => {
    await visitor(page);
    await page.route('**/packs/starter/dicom/**', async (r) => {
      await new Promise((res) => setTimeout(res, 2500));
      return r.fallback();
    });
    await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn');
    await expect(page.locator('[data-panel="p0"] .vp-poster')).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
    await expect(page.locator('[data-panel="p0"] .vp-poster')).toHaveCount(0);
  });

  test('on a slow connection the case opens straight at the heart, and an answer given at once is graded, not a crash', async ({ page }) => {
    await visitor(page);
    // Every slice takes a while, as on a slow phone connection; the outlines arrive first.
    await page.route('**/packs/starter/dicom/**', async (r) => {
      await new Promise((res) => setTimeout(res, 400));
      return r.fallback();
    });
    const shown: number[] = [];
    await page.exposeFunction('__shown', (i: number) => shown.push(i));
    await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=learn');
    await page.waitForFunction(
      () => {
        const s = (window as any).__rvm?.panelState('p0');
        if (s?.ready) (window as any).__shown(s.index);
        return s?.ready === true;
      },
      null,
      { timeout: 90_000, polling: 50 },
    );
    // The first picture is the heart's slice, not slice 1 of the scan with the heart's outline drawn over it.
    expect(shown[0]).toBeGreaterThan(40);
    const box = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
    await page.getByRole('button', { name: /^Submit/ }).first().tap();
    await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('This page hit a problem')).toHaveCount(0);
  });
});
