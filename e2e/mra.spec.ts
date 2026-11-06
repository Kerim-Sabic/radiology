/**
 * MR angiography (brain-mra + anatomy-atlas-mr): the anatomy layer, isolation and the 3D view work on the new modality.
 */
import { expect, test, type Page } from './member';

async function waitPanel(page: Page, panel = 'p0') {
  await page.waitForFunction((p) => (window as any).__rvm?.panelState(p)?.ready === true, panel, { timeout: 90_000 });
}

const ANEURYSM = '/read/mra-aneurysm-454?task=mra-aneurysm-454%3Alocate&mode=learn';
const CONTROL = '/read/mra-cow-sub-002?task=mra-cow-sub-002%3Aarteries&mode=learn';

test.describe('MR angiography', () => {
  test('the AI arteries of the Circle of Willis are listed, labelled AI and shown alone on click', async ({ page }) => {
    await page.goto(ANEURYSM);
    await waitPanel(page);
    await page.getByRole('tab', { name: 'Anatomy' }).click();
    const basilar = page.locator('.anat-item', { hasText: /^Basilar artery/ });
    await expect(basilar).toBeVisible({ timeout: 30_000 });
    await expect(basilar).toContainText('AI');
    await expect(page.locator('.anat-group[data-group="arteries"]')).toBeVisible();
    await basilar.click();
    await expect(page.locator('.vp-isolate')).toContainText('Basilar artery');
    await expect.poll(async () => page.evaluate(() => (window as any).__rvm.panelState('p0')?.index ?? 0)).toBeGreaterThan(0);
  });

  test('expert labels replace the AI layer on the labelled controls', async ({ page }) => {
    await page.goto(CONTROL);
    await waitPanel(page);
    await page.getByRole('tab', { name: 'Anatomy' }).click();
    const basilar = page.locator('.anat-item', { hasText: /^Basilar artery/ });
    await expect(basilar).toBeVisible({ timeout: 30_000 });
    await expect(basilar).not.toContainText('AI');
  });

  test('the 3D view of an MR angiogram opens with the angiography rendering', async ({ page }) => {
    await page.goto(ANEURYSM);
    await waitPanel(page);
    test.skip(!(await page.evaluate(() => (window as any).__rvm.gpu)), 'no WebGL in this browser');
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('menuitem', { name: 'MPR + 3D' }).click();
    await waitPanel(page, 'p3');
    expect(await page.evaluate(() => (window as any).__rvm.get3DPreset('p3'))).toBe('MR-Angio');
  });
});
