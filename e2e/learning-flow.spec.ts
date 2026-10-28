/**
 * Acceptance tests on the production build with the real starter pack (LCTSC CT + RTSTRUCT,
 * COVID-19-AR CR (MONOCHROME1) + CT scout, PROSTATEx T2 MRI + SEG zones).
 */
import { expect, test, type Page } from './member';

const CT_TASK = (task: string, mode = 'practice') => `/read/starter-ct-chest-01?task=starter-ct-chest-01%3A${task}&mode=${mode}`;

async function waitPanel(page: Page, panel = 'p0') {
  await page.waitForFunction((p) => (window as any).__rvm?.panelState(p)?.ready === true, panel, { timeout: 60_000 });
}

/**
 * A canvas point surely inside the drill's answer (outline or box): the middle of the widest even-odd span on a scan
 * line (a vertex average can fall outside a curved outline or inside a hole), taken once the view has settled.
 * Null when the question is not a pointing question or the answer is not on the shown image.
 */
async function drillAnswerPoint(page: Page): Promise<[number, number] | null> {
  const pick = () =>
    page.evaluate(() => {
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
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [ax, ay] = r[j];
            const [bx, by] = r[i];
            if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
          }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2)
          if (xs[i + 1] - xs[i] > width) {
            width = xs[i + 1] - xs[i];
            best = [(xs[i] + xs[i + 1]) / 2, y];
          }
      }
      return best;
    });
  let target = await pick();
  for (let k = 0; k < 12; k++) {
    await page.waitForTimeout(150);
    const again = await pick();
    const still = !!target && !!again && Math.hypot(again[0] - target[0], again[1] - target[1]) < 1;
    target = again;
    if (still) break;
  }
  return target;
}

/** Pick a layout from the toolbar's Layout menu. */
async function chooseLayout(page: Page, name: string) {
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name }).click();
}

/** Go to a display slice and wait until it is the rendered image. */
async function goSlice(page: Page, idx: number, panel = 'p0') {
  await page.evaluate(({ idx, panel }) => (window as any).__rvm.setIndex(panel, idx), { idx, panel });
  await page.waitForFunction(
    ({ idx, panel }) => {
      const e = (window as any).__rvm;
      const st = e.panelState(panel);
      return st?.index === idx && st.currentImageId === e.panel(panel).source.imageIds[idx];
    },
    { idx, panel },
  );
  await page.waitForTimeout(150);
}

/** Click on the viewport at a patient-space point (world → canvas via the live viewport); retries once. */
async function clickWorld(page: Page, world: number[], panel = 'p0') {
  const before = await page.evaluate(() => (window as any).__rvm.collectMarks().length);
  for (let attempt = 0; attempt < 2; attempt++) {
    // The viewport element can be briefly re-mounted while overlays load (seen in Firefox under load): wait for it.
    await page.locator(`[data-panel="${panel}"] .vp-el`).waitFor();
    await page.evaluate(
      ({ world, panel }) => {
        const e = (window as any).__rvm;
        const c = e.worldToCanvas(panel, world);
        const el = document.querySelector(`[data-panel="${panel}"] .vp-el`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: r.left + c[0], clientY: r.top + c[1], button: 0, view: window };
        el.dispatchEvent(new MouseEvent('mousemove', { ...o, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
        document.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
      },
      { world, panel },
    );
    try {
      await page.waitForFunction((n) => (window as any).__rvm.collectMarks().length > n, before, { timeout: 2000 });
      return;
    } catch {
      /* retry once */
    }
  }
  throw new Error('mark was not created');
}

/** Centroid (LPS) of a target's middle contour plane, and the display index of that plane. */
async function targetCentroid(page: Page, pack: string, targetId: string) {
  return page.evaluate(
    async ({ pack, targetId }) => {
      const g = await fetch(`/packs/${pack}/targets/${targetId}.json`).then((r) => r.json());
      const plane = g.planes[Math.floor(g.planes.length / 2)];
      const poly = plane.polygons[0];
      const c = poly.reduce((a: number[], p: number[]) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length, a[2] + p[2] / poly.length], [0, 0, 0]);
      const idx = (window as any).__rvm.panel('p0').source.sopUids.indexOf(plane.sopInstanceUid);
      return { c, idx };
    },
    { pack, targetId },
  );
}

test.describe('A. real imaging', () => {
  test('CT loads, decodes JPEG-LS, shows correct side letters and geometric order', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    const info = await page.evaluate(() => {
      const e = (window as any).__rvm;
      const { cs } = (window as any).__cs;
      const vp = e.viewport('p0');
      const img = vp.getCornerstoneImage();
      const ids: string[] = e.panel('p0').source.imageIds;
      const z = ids.slice(0, 40).map((id) => cs.metaData.get('imagePlaneModule', id)?.imagePositionPatient?.[2]);
      return { st: e.panelState('p0'), min: img.minPixelValue, max: img.maxPixelValue, z, files: ids.slice(0, 5).map((s) => s.split('/').pop()) };
    });
    expect(info.st.edges).toEqual({ left: 'R', right: 'L', top: 'A', bottom: 'P' });
    expect(info.min).toBeLessThanOrEqual(-900); // HU after rescale (air)
    // Display order is head → feet by ImagePositionPatient (strictly decreasing z), while file names are content hashes.
    const loaded = info.z.filter((v: number | undefined) => v !== undefined) as number[];
    for (let i = 1; i < loaded.length; i++) expect(loaded[i]).toBeLessThan(loaded[i - 1]);
    expect(info.files.join(' ')).not.toMatch(/^(0*1|IM-?0*1)\.dcm/i);
  });

  test('scroll, window presets, zoom, reset work in the production build', async ({ page }) => {
    await page.goto(CT_TASK('window'));
    await waitPanel(page);
    await page.locator('[data-panel="p0"] .vp-el').focus();
    const i0 = await page.evaluate(() => (window as any).__rvm.panelState('p0').index);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').index)).toBe(i0 + 2);
    await page.keyboard.press('2'); // second preset = Lung
    await expect.poll(() => page.evaluate(() => Math.round((window as any).__rvm.panelState('p0').window.width))).toBe(1500);
    const z0 = await page.evaluate(() => (window as any).__rvm.panelState('p0').zoom);
    await page.evaluate(() => {
      const vp = (window as any).__rvm.viewport('p0');
      vp.setZoom(vp.getZoom() * 2);
      vp.render();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').zoom)).toBeGreaterThan(z0 * 1.5);
    await page.keyboard.press('r');
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.panelState('p0').zoom)).toBeCloseTo(z0, 1);
  });

  test('MONOCHROME1 radiograph displays inverted correctly and has no invented orientation', async ({ page }) => {
    await page.goto('/read/starter-cxr-01?task=starter-cxr-01%3Asystematic&mode=practice');
    await waitPanel(page);
    const r = await page.evaluate(() => {
      const vp = (window as any).__rvm.viewport('p0');
      const { cs } = (window as any).__cs;
      const px = cs.metaData.get('imagePixelModule', vp.getCurrentImageId());
      return { photometric: px?.photometricInterpretation, invert: vp.getProperties().invert, edges: (window as any).__rvm.panelState('p0').edges };
    });
    expect(r.photometric).toBe('MONOCHROME1');
    expect(r.invert).toBe(true); // Cornerstone inverts MONOCHROME1 so that bone stays white
    expect(r.edges).toBeNull(); // PatientOrientation is empty in this file → "Orientation not recorded"
    await expect(page.getByText('Orientation not recorded in file')).toBeVisible();
  });

  test('JPEG 2000 MRI decodes; MR values are never labelled HU', async ({ page }) => {
    await page.goto('/read/starter-mr-prostate-01?task=starter-mr-prostate-01%3Aweighting&mode=practice');
    await waitPanel(page);
    const r = await page.evaluate(() => {
      const e = (window as any).__rvm;
      const el = document.querySelector('[data-panel="p0"] .vp-el')!;
      const b = el.getBoundingClientRect();
      return { probe: e.probeValue('p0', [b.width / 2, b.height / 2]), ts: e.viewport('p0').getCornerstoneImage().imageId };
    });
    expect(r.probe?.unit).toBe('signal (arbitrary units)');
  });

  test('a known physical distance: 100 columns on the CT measure 97.66 mm (PixelSpacing 0.9766)', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    const d = await page.evaluate(() => {
      const e = (window as any).__rvm;
      const id = e.panelState('p0').currentImageId;
      const a = e.imagePxToWorld(id, [100, 256]);
      const b = e.imagePxToWorld(id, [200, 256]);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    });
    expect(d).toBeCloseTo(97.66, 1);
  });
});

test.describe('B. spatial learning', () => {
  test('known-correct mark is scored correct and saved as an independent attempt', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    const { c, idx } = await targetCentroid(page, 'starter', 'lctsc-train-s1-012_heart');
    await goSlice(page, idx);
    await page.evaluate(() => (window as any).__rvm.setTool('point'));
    await clickWorld(page, c);
    await expect.poll(() => page.evaluate(() => (window as any).__rvm.collectMarks().length)).toBe(1);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Correct', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Independent', { exact: true })).toBeVisible();
    await expect(page.getByText('Mark lies inside the reference.')).toBeVisible();
    // Persistence: attempt is in IndexedDB and visible on the Progress page.
    await page.goto('/progress');
    await expect(page.getByText('independent correct', { exact: true })).toBeVisible();
    await expect(page.locator('.stat').filter({ hasText: 'independent correct' }).locator('b')).toHaveText('1');
  });

  test('a mark in the wrong structure is explained using only validated references', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    const { c, idx } = await targetCentroid(page, 'starter', 'lctsc-train-s1-012_right-lung');
    await goSlice(page, idx);
    await page.evaluate(() => (window as any).__rvm.setTool('point'));
    await clickWorld(page, c);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText(/lies in the reference for Right lung/)).toBeVisible();
    await expect(page.getByText('Wrong structure').first()).toBeVisible();
  });

  test('marks stay on the same anatomy through zoom and pan (stored in source geometry)', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    const { c, idx } = await targetCentroid(page, 'starter', 'lctsc-train-s1-012_heart');
    await goSlice(page, idx);
    await page.evaluate(() => (window as any).__rvm.setTool('point'));
    await clickWorld(page, c);
    const before = await page.evaluate(() => (window as any).__rvm.collectMarks()[0]);
    await page.evaluate(() => {
      const vp = (window as any).__rvm.viewport('p0');
      vp.setZoom(vp.getZoom() * 1.8);
      const cam = vp.getCamera();
      vp.setCamera({ focalPoint: [cam.focalPoint[0] + 20, cam.focalPoint[1] - 15, cam.focalPoint[2]], position: [cam.position[0] + 20, cam.position[1] - 15, cam.position[2]] });
      vp.render();
    });
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => (window as any).__rvm.collectMarks()[0]);
    expect(after.sopInstanceUid).toBe(before.sopInstanceUid);
    for (let k = 0; k < 2; k++) expect(after.imagePx[0][k]).toBeCloseTo(before.imagePx[0][k], 3);
    // The synthetic click itself is quantised to a screen pixel (~1 mm at fit zoom); the mark then never moves.
    for (let k = 0; k < 3; k++) expect(Math.abs(after.worldLps[0][k] - c[k])).toBeLessThan(1.5);
    for (let k = 0; k < 3; k++) expect(after.worldLps[0][k]).toBeCloseTo(before.worldLps[0][k], 6);
  });

  test('left/right confusion is reported as a laterality error', async ({ page }) => {
    await page.goto(CT_TASK('lungs-sides'));
    await waitPanel(page);
    const { c, idx } = await targetCentroid(page, 'starter', 'lctsc-train-s1-012_right-lung');
    await goSlice(page, idx);
    await page.evaluate(() => (window as any).__rvm.setTool('point'));
    await clickWorld(page, c);
    const id = await page.evaluate(() => (window as any).__rvm.collectMarks()[0].id);
    await page.evaluate((id) => (window as any).__rvm.setMarkLabel(id, 'Left lung'), id);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Wrong side').first()).toBeVisible();
    await expect(page.getByText(/Wrong side/).first()).toBeVisible();
  });

  test('revealing the answer makes the attempt assisted and shows the reference', async ({ page }) => {
    await page.goto(CT_TASK('esophagus'));
    await waitPanel(page);
    for (let i = 0; i < 4; i++) {
      const btn = page.getByRole('button', { name: /Hint \d|Reveal answer/ });
      if (!(await btn.count())) break;
      const label = await btn.first().innerText();
      await btn.first().click();
      if (/Reveal/.test(label)) break;
    }
    await expect(page.getByText('This attempt is recorded as assisted.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Hide reference overlay/ })).toBeVisible();
  });
});

test.describe('C. multimodality', () => {
  test('MPR builds axial/coronal/sagittal from one volume with correct side letters', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    await chooseLayout(page, 'MPR: axial / coronal / sagittal');
    for (const p of ['p0', 'p1', 'p2']) await waitPanel(page, p);
    const edges = await page.evaluate(() => ['p0', 'p1', 'p2'].map((p) => (window as any).__rvm.panelState(p).edges));
    expect(edges[0]).toEqual({ left: 'R', right: 'L', top: 'A', bottom: 'P' });
    expect(edges[1]).toEqual({ left: 'R', right: 'L', top: 'H', bottom: 'F' });
    expect(edges[2]).toEqual({ left: 'A', right: 'P', top: 'H', bottom: 'F' });
    const volumes = await page.evaluate(() => [...(window as any).__cs.cs.cache._volumeCache?.keys?.() ?? []].length);
    expect(volumes).toBeLessThanOrEqual(1);
  });

  test('linked MPR: double-click shows the point in every plane, planes tilt to any angle, slab thickens', async ({ page }) => {
    await page.goto(CT_TASK('heart'));
    await waitPanel(page);
    await chooseLayout(page, 'MPR: axial / coronal / sagittal');
    for (const p of ['p0', 'p1', 'p2']) await waitPanel(page, p);
    const off = await page.evaluate(() => {
      const e = (window as any).__rvm;
      const el = document.querySelector('[data-panel="p0"] .vp-el')!;
      const b = el.getBoundingClientRect();
      const c = [b.width * 0.35, b.height * 0.4];
      const w = e.canvasToWorld('p0', c);
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: b.left + c[0], clientY: b.top + c[1] }));
      // Distance of the clicked point from the coronal and sagittal planes after the jump.
      return ['p1', 'p2'].map((id) => {
        const k = e.viewport(id).getCamera();
        const n = k.viewPlaneNormal;
        return Math.abs((w[0] - k.focalPoint[0]) * n[0] + (w[1] - k.focalPoint[1]) * n[1] + (w[2] - k.focalPoint[2]) * n[2]);
      });
    });
    for (const d of off) expect(d).toBeLessThan(0.5);
    // Linked: the crosshair lines are on in every plane without picking a tool.
    expect(await page.evaluate(() => (window as any).__cs.cst.ToolGroupManager.getToolGroup('tg-mpr').getToolOptions('Crosshairs').mode)).toBe('Passive');

    await page.getByRole('button', { name: 'Slab and angle of the MPR planes' }).click();
    await page.getByRole('button', { name: 'MIP', exact: true }).click();
    await expect(page.locator('[data-panel="p1"]').getByText('MIP 10 mm slab')).toBeVisible();
    await page.getByRole('button', { name: '+15°' }).click(); // tilts the planes around the axial axis (p0 is selected)
    await expect(page.locator('[data-panel="p1"]').getByText('oblique 15°')).toBeVisible();
    await expect(page.locator('[data-panel="p2"]').getByText('oblique 15°')).toBeVisible();
    await page.getByRole('button', { name: 'Straighten all planes' }).click();
    await expect(page.locator('[data-panel="p1"]').getByText(/oblique/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Thin', exact: true }).click();
    await expect(page.locator('[data-panel="p1"]').getByText(/mm slab/)).toHaveCount(0);
  });

  test('3D: cut away the front, isolate the heart and great vessels, name what is under the cursor, quiz', async ({ page }) => {
    await page.goto(CT_TASK('heart', 'learn'));
    await waitPanel(page);
    test.skip(!(await page.evaluate(() => (window as any).__rvm.gpu)), 'no WebGL in this browser');
    await chooseLayout(page, 'MPR + 3D');
    for (const p of ['p0', 'p1', 'p2', 'p3']) await waitPanel(page, p);
    const p3 = page.locator('[data-panel="p3"]');
    await p3.getByRole('button', { name: 'Cut' }).click();
    await p3.getByRole('button', { name: 'Take off the front half' }).click();
    const planes = await page.evaluate(() =>
      (window as any).__rvm.viewport('p3').getActors()[0].actor.getMapper().getClippingPlanes().map((p: any) => p.getNormal().map((v: number) => Math.round(v))),
    );
    expect(planes).toEqual([[0, 1, 0]]); // keeps the back half (+y is posterior)
    await p3.getByRole('button', { name: 'No cut' }).click();
    await p3.getByRole('button', { name: /^Structures/ }).click();
    await p3.getByRole('button', { name: 'Heart & great vessels' }).click();
    await page.waitForFunction(() => {
      const s = (window as any).__rvm.anatomy3dState('p3');
      return s && !s.building && s.structures.some((x: any) => x.shown && x.status === 'ready');
    }, null, { timeout: 60_000 });
    const r = await page.evaluate(() => {
      const e = (window as any).__rvm;
      const st = e.anatomy3dState('p3');
      const el = document.querySelector('[data-panel="p3"] .vp-el')!.getBoundingClientRect();
      const hits = new Set<string>();
      for (let x = 0.2; x <= 0.8; x += 0.1) for (let y = 0.2; y <= 0.8; y += 0.1) {
        const id = e.anatomy3d('p3').pick([el.width * x, el.height * y]);
        if (id) hits.add(st.structures.find((s: any) => s.id === id)?.group);
      }
      return { volume: st.showVolume, groups: [...hits], shownGroups: [...new Set(st.structures.filter((s: any) => s.shown).map((s: any) => s.group))] };
    });
    expect(r.volume).toBe(false); // isolated: the CT around them is hidden
    expect(r.groups.length).toBeGreaterThan(0);
    for (const g of r.groups) expect(r.shownGroups).toContain(g); // only shown structures are ever named
    await p3.getByRole('button', { name: 'Quiz me' }).click();
    const lit = await page.evaluate(() => {
      const s = (window as any).__rvm.anatomy3dState('p3');
      return s.structures.find((x: any) => x.id === s.highlight)?.label.replace(/\s*\(partially imaged\)$/i, '');
    });
    await p3.getByRole('button', { name: lit, exact: true }).click();
    await expect(p3.getByText('✓ Correct.')).toBeVisible();
    await p3.getByRole('button', { name: 'Stop' }).click();
  });

  test('same-patient radiograph beside the CT scout: scout is labelled, link is independent', async ({ page }) => {
    await page.goto('/read/starter-cxr-01?task=starter-cxr-01%3Ascout-vs-cxr&mode=practice');
    await waitPanel(page);
    await chooseLayout(page, 'Two-up comparison (same patient)');
    await waitPanel(page, 'p1');
    await expect(page.getByText('CT scout / localizer — not a diagnostic radiograph')).toBeVisible();
    await expect(page.getByText(/Same patient · separate acquisition \(1 days apart\)/)).toBeVisible();
  });
});

test.describe('D. assess leakage, deep links', () => {
  test('assess mode hides the revealing title, book and hints until submission', async ({ page }) => {
    await page.goto(CT_TASK('heart', 'assess'));
    await waitPanel(page);
    await expect(page.locator('.ws-title strong')).toHaveText('Patient A · CT chest');
    await page.getByRole('tab', { name: 'Book' }).click();
    await expect(page.getByText(/book opens after you submit in Assess mode/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Hint/ })).toHaveCount(0);
  });


  test('deep links survive a refresh on the static host', async ({ page }) => {
    for (const path of ['/course/ch03', '/progress', '/cases', CT_TASK('heart')]) {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.locator('#root')).not.toBeEmpty();
    }
    await page.goto('/course/ch03');
    await expect(page.getByRole('heading', { name: /Chapter 3/ })).toBeVisible();
  });

  test('a missing asset produces a readable error with retry, not a black viewport', async ({ page }) => {
    await page.route('**/packs/starter/dicom/mr-*/**', (r) => r.abort());
    await page.goto('/read/starter-mr-prostate-01?task=starter-mr-prostate-01%3Aweighting&mode=practice');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
  });

  test('anatomy labels: shown in Learn mode, locked in Practice until submission', async ({ page }) => {
    await page.goto(CT_TASK('heart', 'learn'));
    await waitPanel(page);
    await page.getByRole('tab', { name: 'Anatomy' }).click();
    await expect(page.getByRole('button', { name: 'Hide anatomy labels' }).first()).toBeVisible();
    await expect(page.getByText(/Click a structure to see only it/)).toBeVisible();
    const heart = page.locator('.anat-item', { hasText: /^Heart/ });
    await expect(heart).toBeVisible();
    // Clicking a structure shows it alone, centred on the slice where it is largest.
    await heart.click();
    await expect(page.locator('.vp-isolate')).toContainText('Heart');
    await expect(page.getByText(/Showing only/)).toBeVisible();
    await page.locator('.vp-isolate').getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('.vp-isolate')).toHaveCount(0);
    await page.goto(CT_TASK('heart', 'practice'));
    await waitPanel(page);
    await expect(page.getByRole('button', { name: 'Anatomy labels: Learn mode or after submitting' })).toBeDisabled();
    await page.getByRole('tab', { name: 'Anatomy' }).click();
    await expect(page.getByText(/available in Learn and Review mode, and after you submit/)).toBeVisible();
  });

  test('anatomy atlas lists structures and deep-links to one shown alone on the scan', async ({ page }) => {
    await page.goto('/atlas');
    await expect(page.getByRole('heading', { name: 'Anatomy atlas' })).toBeVisible();
    await expect(page.getByText(/Book anatomy checklist/)).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find a structure' }).fill('esophagus');
    await page.locator('.atlas-item', { hasText: /^Esophagus/ }).locator('button').click();
    const entry = page.locator('.atlas-item a[href*="show=lctsc-train-s1-012_esophagus"]');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/\/read\/starter-ct-chest-01\?mode=learn&show=/);
    await waitPanel(page);
    await expect(page.locator('.vp-isolate')).toContainText('Esophagus', { timeout: 15000 });
    // The viewer moved off the first slice to where the structure is drawn.
    await expect.poll(async () => page.evaluate(() => (window as any).__rvm.panelState('p0')?.index ?? 0)).toBeGreaterThan(0);
  });

  test('a structure shown alone on another series is centred in the view', async ({ page }) => {
    // Patient I opens on the radiograph; the pulmonary trunk lives on the CT, so the panel switches series first.
    await page.goto('/read/chest-pairs-covid-19-ar-16434411?mode=learn&show=at-ar-16434411-pulmonary-trunk');
    await expect(page.locator('.vp-isolate')).toContainText('Pulmonary trunk', { timeout: 20000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const poly = document.querySelector('[data-panel="p0"] svg.vp-svg polygon');
            const el = document.querySelector('[data-panel="p0"] .vp-el');
            if (!poly || !el) return 1;
            const pts = poly.getAttribute('points')!.trim().split(/\s+/).map((q) => q.split(',').map(Number));
            const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
            return Math.max(Math.abs(cx / el.clientWidth - 0.5), Math.abs(cy / el.clientHeight - 0.5));
          }),
        { timeout: 20000 },
      )
      .toBeLessThan(0.1);
  });
});

test.describe('E. study tools', () => {
  test('finding drill: pointing inside the expert outline or box is graded correct, with the signs to look for', async ({ page }) => {
    await page.goto('/drill');
    await page.getByRole('button', { name: /^Findings \(pneumothorax/ }).click();
    await page.getByRole('checkbox', { name: 'Find its level' }).uncheck(); // every finding question is then "point to it"
    await page.getByRole('button', { name: /^Start/ }).first().click();
    await expect.poll(async () => page.evaluate(() => (window as any).__rvmDrill?.state), { timeout: 30000 }).toBe('asking');
    await expect(page.locator('.drill .vp-status')).toHaveCount(0, { timeout: 30000 });
    const target = await drillAnswerPoint(page);
    expect(target).not.toBeNull();
    const box = (await page.locator('.drill .vp-el').boundingBox())!;
    await page.mouse.click(box.x + target![0], box.y + target![1]);
    await expect(page.locator('.drill-side .notice.ok')).toContainText('Correct');
    await expect(page.locator('.drill-side')).toContainText('what to look for');
    await expect(page.locator('.drill-side').getByRole('link', { name: 'More cases and the book pages' })).toHaveAttribute('href', /\/conditions\?c=/);
  });

  test('on-call shift: unknown cases in Assess mode with a clock, next case, and a scored report', async ({ page }) => {
    // Answer whatever the case asks in the quickest honest way (first option, or "not assessable").
    const answer = async () => {
      await waitPanel(page);
      const options = page.getByRole('group', { name: 'Answer options' }).locator('input');
      if (await options.count()) await options.first().check();
      else if (await page.getByRole('button', { name: 'Not visible / not assessable' }).count()) await page.getByRole('button', { name: 'Not visible / not assessable' }).click();
      else if (await page.getByRole('button', { name: 'No abnormality found' }).count()) await page.getByRole('button', { name: 'No abnormality found' }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
    };
    await page.goto('/oncall');
    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: '2 min' }).click();
    await page.getByRole('button', { name: /^Start the shift/ }).click();
    await expect(page).toHaveURL(/mode=assess&shift=/);
    await expect(page.getByText('On call · 1/5')).toBeVisible();
    await expect(page.locator('.mode-switch')).toBeHidden(); // no switching to Learn mid-case
    await expect(page.locator('.ws-bar .chip', { hasText: /^\s*\d:\d\d$/ })).toBeVisible(); // the case clock
    await answer();
    await page.getByRole('button', { name: 'Next case →' }).click();
    await expect(page.getByText('On call · 2/5')).toBeVisible();
    await answer();
    await expect(page.getByRole('button', { name: 'Next case →' })).toBeVisible();
    await page.goto('/oncall');
    await expect(page.getByText(/2 of 5 cases read/)).toBeVisible();
    await page.getByRole('button', { name: 'End the shift now' }).click();
    const report = page.getByRole('region', { name: 'Shift report' });
    await expect(report.locator('tbody tr')).toHaveCount(5);
    await expect(report.getByText('Not read')).toHaveCount(3);
    await expect(report.getByRole('link', { name: /Review|Judge it/ })).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Previous shifts' })).toBeVisible();
  });

  test('cine: Space plays the slices and stops them', async ({ page }) => {
    await page.goto(CT_TASK('heart', 'learn'));
    await waitPanel(page);
    await page.locator('[data-panel="p0"] .vp-el').click();
    await page.keyboard.press('Space');
    await expect.poll(async () => page.evaluate(() => (window as any).__rvm.panelState('p0').index), { timeout: 15000 }).toBeGreaterThan(2);
    await page.keyboard.press('Space');
    const stopped = await page.evaluate(() => (window as any).__rvm.panelState('p0').index);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as any).__rvm.panelState('p0').index)).toBe(stopped);
    expect(await page.evaluate(() => (window as any).__rvm.isPlaying('p0'))).toBe(false);
  });

  test('anatomy drill: pointing inside the structure is graded correct and explained', async ({ page }) => {
    await page.goto('/drill?key=esophagus');
    await page.getByRole('button', { name: /Start \(8 questions\)/ }).click();
    let checked = false;
    for (let i = 0; i < 8 && !checked; i++) {
      await expect(page.locator('.drill-side h2')).toBeVisible({ timeout: 20000 });
      await expect.poll(async () => page.evaluate(() => (window as any).__rvmDrill?.state), { timeout: 20000 }).toBe('asking');
      await expect(page.locator('.drill .vp-status')).toHaveCount(0, { timeout: 30000 });
      const target = await drillAnswerPoint(page);
      if (target) {
        const box = (await page.locator('.drill .vp-el').boundingBox())!;
        await page.mouse.click(box.x + target[0], box.y + target[1]);
        await expect(page.locator('.drill-side .notice.ok')).toContainText('Correct');
        await expect(page.locator('.drill-side')).toContainText('Looks like:');
        checked = true;
      } else {
        const choice = page.locator('.drill-choice').first();
        if (await choice.count()) await choice.click();
        else {
          const box = (await page.locator('.drill .vp-el').boundingBox())!;
          await page.mouse.click(box.x + 8, box.y + 8);
        }
        await expect(page.locator('.drill-side .notice')).toBeVisible();
        await page.keyboard.press('Enter');
      }
    }
    expect(checked).toBe(true);
  });

  test('search-pattern coach shows a step’s structures together in the right window', async ({ page }) => {
    await page.goto('/read/starter-ct-chest-01?mode=learn');
    await waitPanel(page);
    await page.getByRole('tab', { name: 'Coach' }).click();
    const step = page.locator('.coach-step', { hasText: 'Great vessels' });
    await step.getByRole('button', { name: /Show me/ }).click();
    await expect(page.locator('.vp-isolate')).toContainText('Great vessels', { timeout: 15000 });
    await expect.poll(async () => page.locator('[data-panel="p0"] .vp-svg text').count(), { timeout: 15000 }).toBeGreaterThan(2);
    await step.getByRole('checkbox').check();
    await expect(page.locator('.coach-step.done')).toHaveCount(1);
  });

  test('compare with another patient keeps both scans at the same anatomical level', async ({ page }) => {
    await page.goto('/read/starter-ct-chest-01?mode=learn');
    await waitPanel(page);
    await page.getByRole('button', { name: 'Compare with another patient at the same level' }).click();
    await waitPanel(page, 'p1');
    await expect(page.locator('.rel-banner')).toContainText(/Different patient .* level-matched by \d+ labelled structures/, { timeout: 20000 });
    const before = await page.evaluate(() => (window as any).__rvm.panelState('p1').index);
    await page.evaluate(() => (window as any).__rvm.scroll('p0', 25));
    await expect.poll(async () => page.evaluate(() => (window as any).__rvm.panelState('p1').index), { timeout: 10000 }).not.toBe(before);
  });
});
