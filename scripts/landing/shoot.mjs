/**
 * Screenshots of the real app for the public landing page (public/landing/*.webp).
 *
 *   npm run dev            (in another terminal; the study space opens without sign-in locally)
 *   node scripts/landing/shoot.mjs [http://localhost:5173] [only-this-shot]
 *   python scripts/landing/encode.py      (PNG -> WebP into public/landing)
 *
 * Runs in its own browser profile, so nothing is written to your own study progress.
 * Every image shown comes from a data pack whose licence allows commercial use; credits are on the landing page.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:5173';
const ONLY = process.argv[3] || null;
const OUT = 'test-results/landing-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=default', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await context.newPage();
page.on('pageerror', (e) => console.warn('  page error:', e.message));

const ready = (p = 'p0') => page.waitForFunction((id) => window.__rvm?.panelState(id)?.ready === true, p, { timeout: 90_000 });
const settle = (ms = 1500) => page.waitForTimeout(ms);
async function layout(name) {
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name }).click();
}
async function shot(name, clip) {
  await page.mouse.move(2, 2);
  await settle(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log('  saved', name);
}
const want = (n) => !ONLY || ONLY === n;

// 1. Hero: CT pulmonary angiogram, linked MPR + 3D with the clot shown inside the pulmonary arteries.
if (want('hero')) {
  await page.goto(`${BASE}/read/pe-pat005?task=pe-pat005%3Alocate&mode=learn&show=fumpe-pat005_pulmonary-embolism`);
  await ready();
  await settle(2500);
  await layout('MPR + 3D');
  for (const p of ['p0', 'p1', 'p2', 'p3']) await ready(p);
  const p3 = page.locator('[data-panel="p3"]');
  await p3.getByRole('button', { name: /^Structures/ }).click();
  await p3.getByRole('button', { name: 'Arteries', exact: true }).click();
  const findings = p3.getByRole('checkbox', { name: 'Show all Findings (expert outlines)' });
  if (await findings.count()) await findings.check();
  await page.waitForFunction(() => {
    const s = window.__rvm.anatomy3dState('p3');
    return s && !s.building && s.structures.some((x) => x.shown && x.status === 'ready');
  }, null, { timeout: 120_000 });
  await p3.getByRole('button', { name: 'Close' }).click();
  await settle(2500);
  await shot('hero');
}

// 2. Mammography: four views hung as in the book (CC above MLO, chest walls back to back).
if (want('mammo')) {
  await page.goto(`${BASE}/read/mg-cbis-p00021?mode=learn`);
  await ready();
  await layout('Mammography: CC and MLO, back to back');
  for (const p of ['p0', 'p1', 'p2', 'p3']) await ready(p);
  await settle(3000);
  await shot('mammo');
}

// 3. MRI: diffusion-weighted image with the stroke outlined, and the sequence guide.
if (want('mri')) {
  await page.goto(`${BASE}/read/stroke-isles-0015?mode=learn&show=isles-strokecase0015_dwi_ischemic-stroke`);
  await ready();
  await settle(3000);
  await shot('mri');
}

// 4. Ultrasound: breast carcinoma with the radiologist's outline.
if (want('us')) {
  await page.goto(`${BASE}/read/us-breast-case007?mode=learn&show=breast-usg-case007_mass`);
  await ready();
  await settle(3000);
  await shot('us');
}

// 5. Radiograph: pneumothorax, boxed by the source readers.
if (want('xray')) {
  await page.goto(`${BASE}/read/cxr-00003400-003?mode=learn&show=nih-00003400_003_pneumothorax`);
  await ready();
  await settle(3000);
  await shot('xray');
}

// 6. CT with organ outlines in linked MPR (the kidney tumour case).
if (want('ct')) {
  await page.goto(`${BASE}/read/body-kits-00015?mode=learn`);
  await ready();
  await layout('MPR: axial / coronal / sagittal');
  for (const p of ['p0', 'p1', 'p2']) await ready(p);
  await settle(4000);
  await shot('ct');
}

// 7. Condition search.
if (want('conditions')) {
  await page.goto(`${BASE}/conditions?c=pneumothorax`);
  await page.waitForSelector('.cond-detail, .cond-results, main h1', { timeout: 30_000 });
  await settle(3000);
  await shot('conditions');
}

await browser.close();
