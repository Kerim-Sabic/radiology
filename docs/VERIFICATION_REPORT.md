# Verification report — 28 October 2026

This report covers what was built, what was actually tested and measured, and what is still limited. Numbers come from generated files: `docs/CONTENT_INVENTORY.md`, `docs/COVERAGE.md`, `docs/data/anatomy-atlas-report.md`, `docs/perf/measurements.json` and `docs/perf/e2e-results-latest.json`. Nothing here is planned or projected content.

## 1. What exists

The app is a React 19 + TypeScript 6 + Vite 8 single-page app:
- **Viewer:** Cornerstone3D 5.13.2 is the only one.
- **Book:** PDF.js shows the user's own copy, imported on each device. The PDF is never shipped.
- **Storage:** progress lives in IndexedDB, with export and import.
- **No AI tutor:** it was removed (see `docs/REMOVED_AI_TUTOR.md`). The app has no server functions and needs no API keys.

Offline Python pipelines prepare everything the app serves:
- TCIA download, inventory, lossless re-encode, annotation conversion and validation.
- The book index.
- The machine-drawn anatomy and vessel outlines, shown in the app as **"AI draft by Horalix"**. Tools, versions and licences are recorded only in `docs/data/`.

**Study tools:**
- Learn / Practice / Assess / Review modes with deterministic grading.
- The anatomy layer and the Atlas, with a book anatomy checklist.
- Anatomy drills with spaced repetition.
- A short note for every labelled structure.
- A search-pattern coach, including the book's six cardiac CT levels (Ch 3, Figs 3.5–3.10).
- Comparison with another patient at the same anatomical level.
- A confidence check: "sure but wrong" answers come back first.
- The course map, the progress page and the mistake notebook.

## 2. Installed content (real, verified)

| | count |
|---|---|
| Distinct patients with usable cases | **51** |
| Studies / series / DICOM instances | 71 / 81 / 6,696 |
| Image-based tasks | **220** |
| — spatially scored vs source manual annotation | 83 |
| — auto-checked choice on a real image | 26 |
| — self-review against a source-linked checklist | 96 |
| — spatial vs unreviewed AI-draft reference (self-review until you review it) | 15 |
| Reference targets | 4,063 (268 source manual, 3 source automated, 3,792 AI draft by Horalix) |
| Curriculum | 37 units (29 chapters + 8 appendices), 274 objectives; 31 objectives (11%) have at least one real-scan task |

**Same-patient comparisons (all `independent`, none registered):**
- Radiograph ↔ diagnostic CT: 17 patients (COVID-19-AR and LIDC-IDRI).
- Radiograph ↔ CT scout only: 1 patient.
- CT ↔ MRI: 2 patients (Soft-tissue-Sarcoma).

### Anatomy layer ("AI draft by Horalix", `anatomy-atlas`)

The layer has 3,727 outlines on 40 CT series and 24 frontal chest radiographs. Every outline passed automatic quality checks; **anything that failed is not outlined**. All drops are listed per study in `docs/data/anatomy-atlas-report.md`:

| rule | dropped |
|---|---|
| CT fragments / too small | 60 |
| CT density (HU) | 116 |
| CT coverage / typical volume | 210 |
| CT side / anatomical order | 12 |
| CT heart-chamber QC | 1 |
| Radiograph fragments | 3 |
| Radiograph area / side (incl. all left/right structures on the 3 radiographs without PatientOrientation) | 24 |

Structures split the way the book teaches them:
- **Aorta:** ascending, arch, descending thoracic and abdominal; the arch on 26 CTs.
- **Colon:** by segment, on the 2 CTs where the whole colon is in view.
- **Pulmonary arteries:**
  - The pulmonary trunk (main pulmonary artery) and the right and left pulmonary arteries on 30 chest CTs.
  - Lobar and segmental arteries per lobe: 51 of 158 lobe groups. The rest were dropped because 3 mm slices make them mostly aerated lung.
  - No individual segmental artery is named, because there is no reliable landmark for it.
- **Heart:**
  - The heart outline never covers the pulmonary trunk or arteries: 0 of 8,166 pulmonary-artery outline centres lie inside a machine-drawn heart. This is enforced by a unit test.
  - Expert heart contours from the source datasets are never modified. They include the pericardial sac, so the root of the trunk lies inside them; hovering still names the trunk, because the smallest outline wins.
  - Heart chambers (right and left atrium and ventricle, plus left-ventricular muscle): all five on 9 contrast CTs, three on one more. They are drawn only where the blood pool was bright enough to separate them, and only by a licence-free model.
- **Airway:**
  - The trachea ends at the carina on all 31 chest CTs; this is enforced by a unit test. Before this rule it ran 9–27 mm into the main bronchi on every one of them.
  - Below the carina the airway is the left main bronchus (28 CTs) or the right main bronchus (28 CTs). On 25 CTs the right outline reaches more than 25 mm below the carina (15 mm in children) and is named "Right main bronchus and bronchus intermedius".
- **Laterality:** 1,007 left/right pairs checked from the published outlines; 0 on the wrong side.
- **Re-reading:** every outline was re-read against its DICOM slice: 0 failures.

**Spot checks in the browser** were done on Patient I (COVID-19-AR-16434411), images 34 and 38 of 105. Every outline on each slice was hovered in turn:
- **Image 34:** the trunk is named "Pulmonary trunk (main pulmonary artery)". The right and left pulmonary arteries, the lobe arteries, the left main bronchus and the right main bronchus are named correctly. No outline is "Heart" and none is "Trachea".
- **Image 38:** the left pulmonary artery, left atrial appendage and both main bronchi are named correctly. There is no "Heart" and no "Trachea".
- **Expert-heart patient (Patient A, LCTSC):** hovering the trunk names the trunk.

Coronal renders of the airway labels were inspected on 6 CTs: adults, a child, contrast and non-contrast.

## 3. Tests actually run (Windows 11, AMD Ryzen 9 7950X, Node 22.18)

| check | result |
|---|---|
| `npm run typecheck` (app and tests) | pass |
| `npm test` — unit tests (see below) | **137 / 137 pass** |
| `npm run build` | pass (shell 527 KB JS; the 4.3 MB imaging engine and the PDF reader are lazy-loaded) |
| Playwright e2e on the production build (`vite preview`), Chromium + Firefox | **49 pass, 0 fail, 0 flaky**; 1 skipped (the speed measurement runs in Chromium only) |
| Anatomy pack contract check (zod) and DICOM re-read | 3,727 / 3,727 targets pass |

On the first full run one Firefox test failed. The test's click helper looked for the viewer element while it was being re-mounted, and threw instead of retrying. The helper now waits for the element. That test then passed 5 of 5 times on its own, and the whole suite passed again.

The unit tests cover:
- **Geometry and slice sorting:** transforms, shuffled input, gaps, duplicates and mixed orientation, and laterality letters.
- **Grading:**
  - correct marks, wrong structure, wrong side, the tolerance boundary, off-level marks, duplicate clicks, the shotgun penalty and unscored marks;
  - AI-draft demotion and a fake `human_reviewed` without a review.
- **Study tools:** spaced repetition, drill click grading with holes, distractors and windows, and same-level patient matching.
- **Outline replacement:** parts replace a machine-drawn whole (aorta, colon, heart → chambers), but never an expert outline.
- **Notes and patterns:** every installed structure has a note; every coach step matches installed labels.
- **The installed atlas itself:** the trachea is one tube on every slice, and no pulmonary artery lies inside a machine-drawn heart.
- **Validation:** every installed pack, lesson and book anchor is validated.

The e2e suite covers:
- **Loading:** real CT/MR/CR in JPEG-LS, JPEG 2000 and Implicit VR; the MONOCHROME1 radiograph; head-to-feet order with hash-named files.
- **Viewing:** scroll, presets, zoom and reset; a known distance; MPR with correct letters in all planes.
- **Marking:** correct, wrong-structure and wrong-side marks, with attempts saved in IndexedDB; marks staying in place through zoom, pan and resize; reveal making an attempt assisted.
- **Modes and errors:** Assess mode hiding hints and the book; deep-link refresh; a missing asset showing Retry; local import ordered by geometry; a gapped series refused for MPR.
- **Book anchors:** Fig 3.5 opens at PDF 40 / printed p. 25, and inserted electronic pages keep later anchors correct.
- **Study tools:**
  - a drill answered correctly, with its note;
  - the coach's *Great vessels* step;
  - comparison with another patient, level-matched, with the second panel following the first.

## 4. Measured performance (`docs/perf/measurements.json`)

These figures are from a production build on a **local** server. Real hosting adds network time in proportion to the bytes:

| Measure | Result |
|---|---|
| Shell interactive | 316 ms (first contentful paint 120 ms) |
| First CT image (starter chest CT, 131 slices, 20.7 MB) | 0.83 s |
| All slices fetched | 1.37 s |
| Cached scrolling (60 slice changes) | median 16 ms, p95 20 ms |
| MPR ready from the loaded volume | 0.35 s |
| JS heap after MPR | 125 MB used |
| Radiograph first image | 0.87 s |

The shell downloads 8.6 MB of JSON manifests, uncompressed (the largest is the anatomy layer's index, 3.5 MB). Hosts such as Netlify compress JSON, typically to under a quarter. Outline geometry is fetched only for the patient being viewed.

## 5. Not done / not verified (be aware)

- **Hosting:** the repository is ready for Netlify (`docs/DEPLOY.md`), but no deployment was made or tested from here.
- **Book:** the PDF is never committed or shipped (it is copyrighted). Book search and page links need it imported on each device (Book → Import PDF).
- **Untested browsers and devices:** Safari/WebKit, iOS and Android hardware, Edge, and real touch input. Only Chromium and Firefox desktop are covered.
- **Data limits:**
  - No head CT, no paediatric radiographs, no MSK radiographs, no bowel obstruction or perforation, no ultrasound and no nuclear medicine. These need credentialed datasets.
  - No whole-study reviewed references, so false positives are reported as "unscored", never counted.
- **AI-draft outlines:**
  - No radiologist has reviewed them. Edges can be a few mm off, and they never score you until you review them yourself in Author.
  - The radiograph labelling model's training-data licence was not verified for commercial use (see `docs/data/`).
  - Heart chambers exist on 10 of 22 contrast CTs.
  - Lobe arteries passed on 51 of 158 lobe groups.
- **Licences:** MIDRC-RICORD-1C images are CC BY-NC 4.0 (non-commercial only).

## 6. Commands to reproduce

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

```bash
npx playwright test
```

```bash
npx playwright test e2e/perf.spec.ts --project=chromium
```

```bash
node scripts/report/content-report.mjs
```
