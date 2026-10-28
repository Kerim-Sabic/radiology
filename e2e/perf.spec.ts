/**
 * Performance measurements on the production build (local preview server, so network time is
 * near zero — real hosting adds transfer time proportional to the bytes recorded here).
 * Run: npx playwright test e2e/perf.spec.ts --project=chromium
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';

const results: Record<string, unknown> = { measuredAt: new Date().toISOString(), host: 'vite preview (localhost)', note: 'Local server: excludes real network latency/bandwidth.' };

test('measure shell, first image, full series, scrolling, memory', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'memory APIs are Chromium-only');
  const bytes: Record<string, number> = { js: 0, wasm: 0, dicom: 0, json: 0, other: 0 };
  page.on('response', async (r) => {
    if (r.request().method() === 'HEAD') return; // availability probes transfer no body
    const len = Number(r.headers()['content-length'] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length;
    const u = r.url();
    const k = /\.m?js(\?|$)/.test(u) ? 'js' : /\.wasm/.test(u) ? 'wasm' : /\.dcm/.test(u) ? 'dicom' : /\.json/.test(u) ? 'json' : 'other';
    bytes[k] += len;
  });

  const t0 = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practice' }).waitFor();
  results.shellInteractiveMs = Date.now() - t0;
  results.shellNav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd), firstContentfulPaintMs: fcp ? Math.round(fcp.startTime) : null };
  });
  results.shellBytes = { ...bytes };

  // First useful image: starter chest CT (131 slices, JPEG-LS, 20.7 MB).
  const t1 = Date.now();
  await page.goto('/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=practice');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  results.ctFirstImageMs = Date.now() - t1;
  await page.waitForFunction(() => {
    const p = (window as any).__rvm.panelState('p0').progress;
    return p && p.done + p.failed === p.total;
  }, null, { timeout: 120_000 });
  results.ctAllSlicesFetchedMs = Date.now() - t1;
  results.ctSeries = await page.evaluate(() => (window as any).__rvm.panelState('p0').progress);

  // Cached scrolling: 60 slice changes, wait for each render.
  results.cachedScroll = await page.evaluate(async () => {
    const e = (window as any).__rvm;
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      e.setIndex('p0', 20 + i);
      await new Promise<void>((res) => {
        const check = () => (e.panelState('p0').index === 20 + i ? requestAnimationFrame(() => res()) : requestAnimationFrame(check));
        check();
      });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return { slices: times.length, medianMs: +times[30].toFixed(1), p95Ms: +times[56].toFixed(1), maxMs: +times[59].toFixed(1) };
  });

  // MPR build (volume from the already-fetched series).
  const t2 = Date.now();
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: 'MPR: axial / coronal / sagittal' }).click();
  await page.waitForFunction(() => ['p0', 'p1', 'p2'].every((p) => (window as any).__rvm.panelState(p)?.ready), null, { timeout: 60_000 });
  results.mprReadyMs = Date.now() - t2;
  results.jsHeapMB = await page.evaluate(() => {
    const m = (performance as any).memory;
    return m ? { used: +(m.usedJSHeapSize / 1048576).toFixed(1), total: +(m.totalJSHeapSize / 1048576).toFixed(1) } : null;
  });

  // Radiograph (7.5 MB MONOCHROME1 CR, single image).
  const t3 = Date.now();
  await page.goto('/read/starter-cxr-01?task=starter-cxr-01%3Asystematic&mode=practice');
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  results.radiographFirstImageMs = Date.now() - t3;
  results.totalBytes = bytes;

  mkdirSync('docs/perf', { recursive: true });
  writeFileSync('docs/perf/measurements.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
});
