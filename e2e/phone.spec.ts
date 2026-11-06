/**
 * A phone: taps, not clicks. A tap arrives as touch events and then again as mouse events; the image must act on it
 * once, where the finger was. Brightness and contrast are sliders and presets, since dragging also marks and scrolls.
 */
import { expect, test, type Page } from './member';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'Touch emulation needs Chromium');

const XR = '/read/cxr-00003400-003?task=cxr-00003400-003%3Alocate&mode=practice';

async function ready(page: Page, panel = 'p0') {
  await expect.poll(() => page.evaluate((id) => (window as any).__rvm?.panelState(id)?.ready === true, panel), { timeout: 60000 }).toBe(true);
  await expect(page.locator(`[data-panel="${panel}"] .vp-status`)).toHaveCount(0, { timeout: 30000 });
}

test('one tap with Point makes one mark, under the finger', async ({ page }) => {
  await page.goto(XR);
  await ready(page);
  await page.getByRole('button', { name: 'Point mark', exact: true }).tap();
  const box = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
  const tap: [number, number] = [Math.round(box.width * 0.6), Math.round(box.height * 0.5)];
  await page.touchscreen.tap(box.x + tap[0], box.y + tap[1]);
  await expect.poll(() => page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
  const at = await page.evaluate(() => {
    const e = (window as any).__rvm;
    const m = e.collectMarks()[0];
    return e.worldToCanvas('p0', e.imagePxToWorld(e.panelState('p0').currentImageId, m.imagePx[0]));
  });
  expect(Math.hypot(at[0] - tap[0], at[1] - tap[1])).toBeLessThan(3);
});

test('a tap with a viewing tool says how to mark', async ({ page }) => {
  await page.goto(XR);
  await ready(page);
  const box = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.ws-tool-flash')).toHaveText('To mark the finding, choose Point or Box in the toolbar first');
  expect(await page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(0);
});

test('a drill answers a tap on the structure', async ({ page }) => {
  await page.goto('/drill?key=esophagus');
  await page.getByRole('button', { name: /Start \(8 questions\)/ }).tap();
  let checked = false;
  for (let i = 0; i < 8 && !checked; i++) {
    await expect.poll(() => page.evaluate(() => (window as any).__rvmDrill?.state), { timeout: 30000 }).toBe('asking');
    await expect(page.locator('.drill .vp-status')).toHaveCount(0, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const target = await page.evaluate(() => {
      const d = (window as any).__rvmDrill;
      if (d.kind !== 'locate' && d.kind !== 'find') return null;
      const polys = d.answerPolys() as number[][][];
      if (!polys.length) return null;
      const ys = polys.flat().map((q) => q[1]);
      const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      let best: [number, number] | null = null;
      let width = 0;
      for (let k = 1; k < 20; k++) {
        const y = y0 + ((y1 - y0) * k) / 20;
        const xs: number[] = [];
        for (const r of polys)
          for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
            const [ax, ay] = r[b];
            const [bx, by] = r[a];
            if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
          }
        xs.sort((p, q) => p - q);
        for (let a = 0; a + 1 < xs.length; a += 2)
          if (xs[a + 1] - xs[a] > width) {
            width = xs[a + 1] - xs[a];
            best = [(xs[a] + xs[a + 1]) / 2, y];
          }
      }
      return best;
    });
    const box = (await page.locator('.drill .vp-el').boundingBox())!;
    if (target) {
      await expect(page.locator('.drill-side h2')).toContainText('Tap the');
      await page.touchscreen.tap(box.x + target[0], box.y + target[1]);
      await expect(page.locator('.drill-side .notice.ok')).toContainText('Correct');
      checked = true;
    } else {
      const choice = page.locator('.drill-choice').first();
      if (await choice.count()) await choice.tap();
      else await page.touchscreen.tap(box.x + 8, box.y + 8);
      await expect.poll(() => page.evaluate(() => (window as any).__rvmDrill?.state)).toBe('answered');
      // The question's Next, not the image's "Next structure" (the label strip on the drill image has one too).
      await page.getByRole('complementary', { name: 'Question' }).getByRole('button', { name: /^Next/ }).tap();
    }
  }
  expect(checked).toBe(true);
});

test('brightness and contrast: sliders, presets, reset', async ({ page }) => {
  await page.goto('/read/starter-ct-chest-01?mode=learn');
  await ready(page);
  const win = () => page.evaluate(() => (window as any).__rvm.getWindow('p0') as { center: number; width: number });
  const before = await win();
  await page.getByRole('button', { name: 'Brightness and contrast' }).tap();
  const panel = page.getByRole('group', { name: 'Brightness and contrast' });
  await expect(panel).toBeVisible();
  // The panel sits below the image, not over it.
  const img = (await page.locator('[data-panel="p0"] .vp-el').boundingBox())!;
  const pb = (await panel.boundingBox())!;
  expect(pb.y).toBeGreaterThanOrEqual(img.y + img.height - 1);
  await panel.locator('input[type="range"]').first().fill('60');
  const brighter = await win();
  expect(brighter.center).toBeLessThan(before.center);
  await panel.locator('input[type="range"]').nth(1).fill('40');
  expect((await win()).width).toBeLessThan(before.width);
  await panel.getByRole('button', { name: 'Lung' }).tap();
  expect(await win()).toEqual({ center: -600, width: 1500 });
  await expect(panel.locator('input[type="range"]').first()).toHaveValue('0');
  await panel.getByRole('button', { name: 'Reset' }).tap();
  expect((await win()).width).not.toBe(1500);
  await panel.getByRole('button', { name: 'Done' }).tap();
  await expect(panel).toHaveCount(0);
});
