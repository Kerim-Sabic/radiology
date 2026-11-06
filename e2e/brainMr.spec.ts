/**
 * Brain anatomy on MRI (anatomy-atlas-mr, round 2): the AI structures are listed on a diffusion MRI, labelled AI, shown
 * alone on click, and named under the pointer.
 */
import { expect, test, type Page } from './member';

async function waitPanel(page: Page, panel = 'p0') {
  await page.waitForFunction((p) => (window as any).__rvm?.panelState(p)?.ready === true, panel, { timeout: 90_000 });
}

const DWI = '/read/mr-diffusion-0004?task=mr-diffusion-0004%3Alocate&mode=learn';

test.describe('Brain anatomy on MRI', () => {
  test('lobes, deep grey nuclei and ventricles are listed as AI drafts and shown alone on click', async ({ page }) => {
    await page.goto(DWI);
    await waitPanel(page);
    await page.getByRole('tab', { name: 'Anatomy' }).click();
    const thalamus = page.locator('.anat-item', { hasText: /^Left thalamus/ });
    await expect(thalamus).toBeVisible({ timeout: 30_000 });
    await expect(thalamus).toContainText('AI');
    await expect(page.locator('.anat-group[data-group="brain"]')).toBeVisible();
    for (const name of [/^Right frontal lobe/, /^Fourth ventricle/, /^Brainstem/]) await expect(page.locator('.anat-item', { hasText: name })).toBeVisible();
    await thalamus.click();
    await expect(page.locator('.vp-isolate')).toContainText('Left thalamus');
    await expect(page.locator('.vp-svg polygon, .vp-svg path').first()).toBeVisible();
  });
});
