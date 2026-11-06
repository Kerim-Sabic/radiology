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

test.describe('Angiograms in MPR and 3D', () => {
  test('MPR opens as a MIP slab, marking switches to the thin slice and back', async ({ page }) => {
    // Practice: marking is open (in Learn mode the reference is shown and the marking tools are locked).
    await page.goto(ANEURYSM.replace('mode=learn', 'mode=practice'));
    await waitPanel(page);
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('menuitem', { name: 'MPR: axial / coronal / sagittal' }).click();
    for (const p of ['p0', 'p1', 'p2']) await waitPanel(page, p);
    expect(await page.evaluate(() => (window as any).__rvm.getSlab())).toEqual({ mm: 20, blend: 'mip' });
    await expect(page.getByRole('button', { name: 'MIP 20 mm' })).toBeVisible();
    await expect(page.locator('[data-panel="p1"]').getByText('MIP 20 mm slab')).toBeVisible();
    // Thickness 5-40 mm.
    await page.getByRole('slider', { name: 'MIP slab thickness in millimetres' }).fill('30');
    expect(await page.evaluate(() => (window as any).__rvm.getSlab())).toEqual({ mm: 30, blend: 'mip' });
    // A marking tool puts the views on the thin slice; a viewing tool brings the slab back (keys typed into the slider
    // stay in the slider, so it is left first).
    await page.getByRole('slider', { name: 'MIP slab thickness in millimetres' }).blur();
    await page.keyboard.press('m');
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.getSlab())).toBeNull();
    await page.keyboard.press('w');
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.getSlab())).toEqual({ mm: 30, blend: 'mip' });
    // Off and on.
    await page.getByRole('button', { name: 'MIP 30 mm' }).click();
    expect(await page.evaluate(() => (window as any).__rvm.getSlab())).toBeNull();
    await expect(page.getByRole('button', { name: 'Thin slice' })).toBeVisible();
  });

  test('the 3D Circle of Willis turns slowly on Spin and stops on a click', async ({ page }) => {
    await page.goto(ANEURYSM);
    await waitPanel(page);
    test.skip(!(await page.evaluate(() => (window as any).__rvm.gpu)), 'no WebGL in this browser');
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('menuitem', { name: 'MPR + 3D' }).click();
    await waitPanel(page, 'p3');
    const pos = () => page.evaluate(() => (window as any).__rvm.viewport('p3').getCamera().position.map((x: number) => Math.round(x)));
    const before = await pos();
    await page.locator('[data-panel="p3"]').getByRole('button', { name: 'Turn slowly' }).click();
    expect(await page.evaluate(() => (window as any).__rvm.isSpinning('p3'))).toBe(true);
    await expect.poll(pos, { timeout: 10_000 }).not.toEqual(before);
    await page.locator('[data-panel="p3"]').getByRole('button', { name: 'Stop turning' }).click();
    expect(await page.evaluate(() => (window as any).__rvm.isSpinning('p3'))).toBe(false);
  });

  test('a CT pulmonary angiogram opens 3D with the pulmonary-artery rendering and MPR as a 10 mm MIP', async ({ page }) => {
    await page.goto('/read/pe-pat005?task=pe-pat005%3Alocate&mode=learn');
    await waitPanel(page);
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('menuitem', { name: 'MPR: axial / coronal / sagittal' }).click();
    await waitPanel(page, 'p1');
    expect(await page.evaluate(() => (window as any).__rvm.getSlab())).toEqual({ mm: 10, blend: 'mip' });
    test.skip(!(await page.evaluate(() => (window as any).__rvm.gpu)), 'no WebGL in this browser');
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('menuitem', { name: 'MPR + 3D' }).click();
    await waitPanel(page, 'p3');
    expect(await page.evaluate(() => (window as any).__rvm.get3DPreset('p3'))).toBe('CT-Pulmonary-Arteries');
  });
});

test.describe('Finding analysis', () => {
  test('Learn mode measures the expert aneurysm outline and jumps to its largest image; Practice hides it until submit', async ({ page }) => {
    await page.goto(ANEURYSM);
    await waitPanel(page);
    const card = page.getByRole('region', { name: 'Finding analysis' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Size');
    await expect(card).toContainText(/Volume/);
    await expect(card).toContainText(/mm/);
    const before = await page.evaluate(() => (window as any).__rvm.panelState('p0').index);
    await card.getByRole('button', { name: 'Show its largest image' }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').index)).not.toBe(before);

    await page.goto(ANEURYSM.replace('mode=learn', 'mode=practice'));
    await waitPanel(page);
    await expect(page.getByRole('region', { name: 'Finding analysis' })).toHaveCount(0);
  });
});
