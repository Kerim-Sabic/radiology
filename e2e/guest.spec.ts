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
  await expect(result.getByRole('button', { name: 'Next task' })).toBeVisible();
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
