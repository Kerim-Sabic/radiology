/**
 * Local import acceptance: shuffled/renamed files are ordered by geometry; an incomplete series
 * is refused for MPR instead of being reformatted with distortion.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const MR_DIR = join('public', 'packs', 'starter', 'dicom', readdirSync(join('public', 'packs', 'starter', 'dicom')).find((d) => d.startsWith('mr-'))!);
const files = readdirSync(MR_DIR).map((f) => ({ name: f, buffer: readFileSync(join(MR_DIR, f)) }));

function shuffledPayload(drop: number | null) {
  // Deterministic shuffle and misleading names: name order is the reverse of a random order.
  const order = files.map((f, i) => ({ f, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((x) => x.f);
  return order.filter((_, i) => i !== drop).map((f, i) => ({ name: `IMG_${String(order.length - i).padStart(3, '0')}.dcm`, mimeType: 'application/dicom', buffer: f.buffer }));
}

async function importAndOpen(page: import('@playwright/test').Page, payload: ReturnType<typeof shuffledPayload>) {
  await page.goto('/import');
  const input = page.getByTestId('import-files');
  await expect(input).toBeEnabled({ timeout: 30_000 }); // pickers stay disabled until the catalogue is ready
  await input.setInputFiles(payload);
  await page.waitForURL(/\/read\//, { timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
}

test('shuffled, renamed files are displayed in geometric order', async ({ page }) => {
  await importAndOpen(page, shuffledPayload(null));
  const r = await page.evaluate(() => {
    const e = (window as any).__rvm;
    const { cs } = (window as any).__cs;
    const src = e.panel('p0').source;
    const iop = cs.metaData.get('imagePlaneModule', src.imageIds[0]).rowCosines.concat(cs.metaData.get('imagePlaneModule', src.imageIds[0]).columnCosines);
    const n = [iop[1] * iop[5] - iop[2] * iop[4], iop[2] * iop[3] - iop[0] * iop[5], iop[0] * iop[4] - iop[1] * iop[3]];
    const proj = src.imageIds.map((id: string) => {
      const p = cs.metaData.get('imagePlaneModule', id).imagePositionPatient;
      return p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    });
    return { count: proj.length, proj, volumeEligible: src.volumeEligible };
  });
  expect(r.count).toBe(files.length);
  for (let i = 1; i < r.proj.length; i++) expect(r.proj[i]).toBeGreaterThan(r.proj[i - 1]);
  expect(r.volumeEligible).toBe(true);
});

test('a series with a missing slice is refused for MPR (no silent distortion)', async ({ page }) => {
  await importAndOpen(page, shuffledPayload(9));
  const eligible = await page.evaluate(() => (window as any).__rvm.panel('p0').source.volumeEligible);
  expect(eligible).toBe(false);
  await page.getByRole('button', { name: 'MPR: axial / coronal / sagittal' }).click();
  await expect(page.getByText(/MPR unavailable: .*(missing slice|non-uniform)/)).toBeVisible();
});
