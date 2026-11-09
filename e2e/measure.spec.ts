/**
 * The heart–chest ratio drill: four taps on a real chest film, then the ratio against the reference, on a computer and on a phone.
 * Practice only; the reference is hidden until the learner commits.
 */
import { expect, test } from './member';

for (const [name, viewport, touch] of [['computer', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test('measures a ratio from four taps, then shows the reference and moves on', async ({ page }) => {
      await page.goto('/measure');
      await expect(page.getByRole('heading', { name: 'Measure the heart–chest ratio' })).toBeVisible();
      const film = page.locator('.measure-film');
      await expect(film.locator('img')).toBeVisible();
      // The reference is not on screen before the learner commits.
      await expect(film.locator('svg path')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Check my ratio/ })).toBeDisabled();
      const b = (await film.boundingBox())!;
      for (const x of [0.4, 0.72, 0.2, 0.82]) {
        if (touch) await page.touchscreen.tap(b.x + b.width * x, b.y + b.height * 0.6);
        else await page.mouse.click(b.x + b.width * x, b.y + b.height * 0.6);
      }
      await expect(page.getByText(/Your ratio so far: \d\.\d\d/)).toBeVisible();
      await page.getByRole('button', { name: /Check my ratio/ }).click();
      await expect(page.getByRole('heading', { name: /Your ratio \d\.\d\d · reference \d\.\d\d/ })).toBeVisible();
      await expect(film.locator('svg path')).toHaveCount(3); // heart and the two lungs
      await expect(page.getByText(/Practice only/)).toBeVisible();
      await page.getByRole('button', { name: /Next film/ }).click();
      await expect(film.locator('svg path')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /Tap 1 of 4/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
