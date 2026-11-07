/**
 * One view alone (one-up) in any multi-view layout, and the phone view switcher. Going back restores the grid with every
 * view exactly as it was (slice, zoom, pan, window), because the hidden views are never resized or remounted.
 */
import { expect, test, type Page } from './member';

const CT = '/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=practice';

async function waitPanel(page: Page, panel = 'p0') {
  await page.waitForFunction((p) => (window as any).__rvm?.panelState(p)?.ready === true, panel, { timeout: 90_000 });
}
async function chooseLayout(page: Page, name: string) {
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name }).click();
}
/** What must survive a round trip: the image shown, the camera and the window. */
function viewOf(page: Page, panel: string) {
  return page.evaluate((id) => {
    const e = (window as any).__rvm;
    const st = e.panelState(id);
    const cam = e.viewport(id).getCamera();
    const r = (v: number[]) => v.map((x: number) => Math.round(x * 100) / 100);
    return { index: st.index, window: st.window, focal: r(cam.focalPoint), scale: Math.round(cam.parallelScale * 100) / 100 };
  }, panel);
}
const box = (page: Page, panel: string) => page.locator(`[data-panel="${panel}"]`).boundingBox();

test.describe('One view full screen', () => {
  test('in MPR + 3D the 3D view goes full screen with its own button, which its 3D bar no longer covers, and comes back', async ({ page }) => {
    test.setTimeout(180_000); // the 3D volume alone can take a minute on a busy machine
    await page.goto(CT);
    await waitPanel(page);
    await chooseLayout(page, 'MPR + 3D');
    const p3 = page.locator('[data-panel="p3"]');
    await expect(p3.locator('.v3d-bar').first()).toBeVisible({ timeout: 90_000 });
    // The view's two corner buttons are clear of the 3D bar.
    const bar = (await p3.locator('.v3d-bar').first().boundingBox())!;
    for (const sel of ['.vp-full', '.vp-max']) {
      const b = (await p3.locator(sel).boundingBox())!;
      const overlap = b.x < bar.x + bar.width && bar.x < b.x + b.width && b.y < bar.y + bar.height && bar.y < b.y + b.height;
      expect(overlap, sel).toBe(false);
    }
    await p3.getByRole('button', { name: /full screen$/ }).click();
    await expect(page.locator('.ws-main')).toHaveClass(/full-view/);
    // Only the 3D view, over the whole screen.
    const vp = page.viewportSize()!;
    await expect.poll(async () => (await p3.boundingBox())!.width).toBeGreaterThan(vp.width * 0.9);
    await p3.getByRole('button', { name: 'Leave full screen' }).click();
    await expect(page.locator('.ws-main')).not.toHaveClass(/full-view/);
    await expect.poll(async () => (await p3.boundingBox())!.width).toBeLessThan(vp.width * 0.6);
  });
});

test.describe('One view alone', () => {
  test('the corner button shows one MPR view over the whole image area and Esc restores every view unchanged', async ({ page }) => {
    await page.goto(CT);
    await waitPanel(page);
    await chooseLayout(page, 'MPR: axial / coronal / sagittal');
    for (const p of ['p0', 'p1', 'p2']) await waitPanel(page, p);
    // Change the coronal view: another slice, zoomed, panned, another window.
    await page.evaluate(() => {
      const e = (window as any).__rvm;
      e.setIndex('p1', Math.max(0, e.panelState('p1').index - 12));
      const vp = e.viewport('p1');
      const cam = vp.getCamera();
      vp.setCamera({ parallelScale: cam.parallelScale * 0.6, focalPoint: [cam.focalPoint[0] + 8, cam.focalPoint[1], cam.focalPoint[2] + 5], position: [cam.position[0] + 8, cam.position[1], cam.position[2] + 5] });
      e.setWindow('p1', 40, 400);
      vp.render();
    });
    const before = { p1: await viewOf(page, 'p1'), p2: await viewOf(page, 'p2'), box1: await box(page, 'p1'), box0: await box(page, 'p0') };
    const grid = (await page.locator('.vgrid').boundingBox())!;

    await page.locator('[data-panel="p0"]').getByRole('button', { name: /Show the Axial alone/ }).click();
    const solo = (await box(page, 'p0'))!;
    expect(solo.width).toBeGreaterThan(grid.width - 4);
    expect(solo.height).toBeGreaterThan(grid.height - 40);
    await expect(page.locator('[data-panel="p1"]')).toBeHidden();
    await expect(page.getByRole('tablist', { name: 'Views of this layout' })).toBeVisible();
    // The hidden views keep their size (never resized).
    expect(await box(page, 'p1')).toEqual(before.box1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel="p1"]')).toBeVisible();
    expect(await box(page, 'p0')).toEqual(before.box0);
    expect(await viewOf(page, 'p1')).toEqual(before.p1);
    expect(await viewOf(page, 'p2')).toEqual(before.p2);

    // Hidden views keep following: a point shown in the axial view alone moves the sagittal plane behind it.
    await page.locator('[data-panel="p0"]').getByRole('button', { name: /Show the Axial alone/ }).click();
    await page.evaluate(() => {
      const el = document.querySelector('[data-panel="p0"] .vp-el')!;
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: b.left + b.width * 0.3, clientY: b.top + b.height * 0.5 }));
    });
    await expect.poll(async () => (await viewOf(page, 'p2')).focal).not.toEqual(before.p2.focal);
  });

  test('double-click on a view title and the U key toggle it; the switcher picks another view', async ({ page }) => {
    await page.goto(CT);
    await waitPanel(page);
    await chooseLayout(page, 'Four-up');
    await waitPanel(page, 'p1');
    await page.locator('[data-panel="p1"] .vp-title').dblclick();
    await expect(page.locator('[data-panel="p0"]')).toBeHidden();
    await expect(page.locator('[data-panel="p1"]')).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Views of this layout' }).getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await tabs.first().click();
    await expect(page.locator('[data-panel="p0"]')).toBeVisible();
    await expect(page.locator('[data-panel="p1"]')).toBeHidden();
    await page.keyboard.press('u');
    await expect(page.locator('[data-panel="p1"]')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Views of this layout' })).toHaveCount(0);
    await page.keyboard.press('u');
    await expect(page.locator('[data-panel="p1"]')).toBeHidden();
  });
});

test.describe('Phone view switcher', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch emulation needs Chromium');

  test('MPR on a phone shows one plane at a time and every plane is reachable', async ({ page }) => {
    await page.goto(CT);
    await waitPanel(page);
    await chooseLayout(page, 'MPR: axial / coronal / sagittal');
    for (const p of ['p0', 'p1', 'p2']) await waitPanel(page, p);
    const tabs = page.getByRole('tablist', { name: 'Views of this layout' });
    await expect(tabs).toBeVisible();
    await expect(page.locator('[data-panel="p0"]')).toBeVisible();
    await expect(page.locator('[data-panel="p2"]')).toBeHidden();
    for (const [name, panel] of [['Coronal', 'p1'], ['Sagittal', 'p2'], ['Axial', 'p0']] as const) {
      await tabs.getByRole('tab', { name }).tap();
      await expect(page.locator(`[data-panel="${panel}"]`)).toBeVisible();
      const b = (await box(page, panel))!;
      expect(b.width).toBeGreaterThan(300);
    }
    await tabs.getByRole('tab', { name: /All/ }).tap();
    for (const p of ['p0', 'p1', 'p2']) await expect(page.locator(`[data-panel="${p}"]`)).toBeVisible();
  });
});

const PA_LAT = '/read/chest-pairs-lidc-idri-0217?task=chest-pairs-lidc-idri-0217%3Axr-correlate&mode=learn';
const LAT_SOP = '1.3.6.1.4.1.14519.5.2.1.6279.6001.224637902696040165126267898902';
const WRIST = '/read/xr-wrist-child-0040?task=xr-wrist-child-0040%3Alocate&mode=practice';
const CHEST_LATERAL_TASK = '/read/chest-pairs-covid-19-ar-16406502?task=chest-pairs-covid-19-ar-16406502%3Alateral&mode=learn';

test.describe('Radiographs with two views', () => {
  test('a PA & lateral series opens two-up, one image per panel, and a mark on the lateral keeps the lateral image', async ({ page }) => {
    await page.goto(PA_LAT);
    await waitPanel(page, 'p0');
    await waitPanel(page, 'p1');
    await expect(page.locator('[data-panel="p0"]')).toContainText('Frontal · image 1 of 2');
    await expect(page.locator('[data-panel="p1"]')).toContainText('Lateral · image 2 of 2');
    // Each panel holds its own image: the arrows do not flip to the other view.
    expect(await page.evaluate(() => [(window as any).__rvm.panelState('p0').count, (window as any).__rvm.panelState('p1').count])).toEqual([1, 1]);
    await page.keyboard.press('m');
    const b = (await page.locator('[data-panel="p1"] .vp-el').boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
    const m = await page.evaluate(() => (window as any).__rvm.collectMarks()[0]);
    expect(m.sopInstanceUid).toBe(LAT_SOP);
  });

  test('a wrist opens frontal on the left and lateral on the right', async ({ page }) => {
    await page.goto(WRIST);
    await waitPanel(page, 'p0');
    await waitPanel(page, 'p1');
    await expect(page.locator('[data-panel="p0"]')).toContainText('Left wrist, frontal');
    await expect(page.locator('[data-panel="p1"]')).toContainText('Left wrist, lateral');
    await expect(page.locator('[data-panel="p1"]')).toContainText('Lateral');
  });

  test('a task that names the lateral puts the focus on the lateral', async ({ page }) => {
    await page.goto(CHEST_LATERAL_TASK);
    await waitPanel(page, 'p1');
    await expect(page.locator('[data-panel="p1"]')).toHaveClass(/focused/);
    await expect(page.locator('[data-panel="p0"]')).toContainText('Frontal');
  });
});

test.describe('Radiographs with two views on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch emulation needs Chromium');

  test('one view at a time, Frontal and Lateral in the switcher', async ({ page }) => {
    await page.goto(WRIST);
    await waitPanel(page, 'p0');
    const tabs = page.getByRole('tablist', { name: 'Views of this layout' });
    await expect(tabs.getByRole('tab', { name: 'Frontal' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-panel="p1"]')).toBeHidden();
    await tabs.getByRole('tab', { name: 'Lateral' }).tap();
    await expect(page.locator('[data-panel="p1"]')).toBeVisible();
    await expect(page.locator('[data-panel="p0"]')).toBeHidden();
  });
});
