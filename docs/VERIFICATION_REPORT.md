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
| Distinct patients with usable cases | **84** |
| Studies / series / DICOM instances | 104 / 114 / 7,304 |
| Image-based tasks | **278** |
| — spatially scored vs source manual annotation | 117 |
| — auto-checked choice on a real image | 48 |
| — self-review against a source-linked checklist | 98 |
| — spatial vs unreviewed AI-draft reference (self-review until you review it) | 15 |
| Reference targets | 4,023 (305 source manual, 3 source automated, 3,715 AI draft by Horalix) |
| Curriculum | 37 units (29 chapters + 8 appendices), 274 objectives; 46 objectives (17%) have at least one real-scan task |

**Same-patient comparisons (all `independent`, none registered):**
- Radiograph ↔ diagnostic CT: 17 patients (COVID-19-AR and LIDC-IDRI).
- Radiograph ↔ CT scout only: 1 patient.
- CT ↔ MRI: 2 patients (Soft-tissue-Sarcoma).

### Anatomy layer ("AI draft by Horalix", `anatomy-atlas`)

The layer has 3,650 outlines on 40 CT series and 24 frontal chest radiographs. Every outline passed automatic quality checks; **anything that failed is not outlined**. All drops are listed per study in `docs/data/anatomy-atlas-report.md`:

| rule | dropped |
|---|---|
| CT fragments / too small | 60 |
| CT density (HU) | 116 |
| CT coverage / typical volume | 209 |
| CT side / anatomical order / spine and rib numbering | 87 |
| CT heart-chamber QC | 1 |
| Radiograph fragments | 3 |
| Radiograph area / side / fragment (incl. all left/right structures on the 3 radiographs without PatientOrientation) | 27 |

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
- **Laterality:** 981 left/right pairs checked from the published outlines; 0 on the wrong side.
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
| `npm test` — unit tests (see below) | **230 / 230 pass** |
| `npm run build` | pass (shell 529 KB JS; the 4.3 MB imaging engine and the PDF reader are lazy-loaded; the book PDF is never in a build) |
| Playwright e2e on the production build (`vite preview`), Chromium + Firefox, as a signed-in member (account API mocked; the gate itself has its own tests) | **61 pass, 0 fail**; 5 skipped: the speed measurement runs in Chromium only, and the 4 book-reader tests need the owner's PDF, which no build contains (they pass 4/4 with it copied into `dist/book`) |
| Anatomy pack contract check (zod) and DICOM re-read | 3,650 / 3,650 targets pass |

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
- **3D models:** grouping and teaching colours; outline → voxel mask with holes left open and outlines clipped to the grid; the smoothing margin that keeps every surface closed; picking the first structure along the ray, the smallest where structures overlap, and looking through what the cut removed.
- **Condition search:** synonyms, British spellings, abbreviations and small typos match; "thorax" never matches "hemothorax"; results built from the installed packs.

The e2e suite covers:
- **Loading:** real CT/MR/CR in JPEG-LS, JPEG 2000 and Implicit VR; the MONOCHROME1 radiograph; head-to-feet order with hash-named files.
- **Viewing:** scroll, presets, zoom and reset; a known distance; MPR with correct letters in all planes.
- **Marking:** correct, wrong-structure and wrong-side marks, with attempts saved in IndexedDB; marks staying in place through zoom, pan and resize; reveal making an attempt assisted.
- **Modes and errors:** Assess mode hiding hints and the book; deep-link refresh; a missing asset showing Retry; local import ordered by geometry; a gapped series refused for MPR.
- **Anatomy layer:** labels shown in Learn and locked in Practice until submitting; an Atlas deep link showing one structure alone; a structure on another series opened alone and centred in the view.
- **Book anchors:** Fig 3.5 opens at PDF 40 / printed p. 25, and inserted electronic pages keep later anchors correct.
- **Study tools:**
  - a drill answered correctly, with its note;
  - the coach's *Great vessels* step;
  - comparison with another patient, level-matched, with the second panel following the first.
- **Linked views and planes:** a double-click in the axial view puts the point on the coronal and sagittal planes (< 0.5 mm); the crosshair lines are on without choosing a tool; a 10 mm MIP slab; a 15° tilt shown as oblique on both other planes; straighten.
- **3D:** "take off the front half" adds one cut plane keeping the back; heart and great vessels isolated with the CT hidden; hover names only structures that are shown; the 3D quiz answered correctly.

## 3a. Audit of 28 October and what it fixed

Two independent reviews ran on 28 October: one checked every outline anatomically (order, position, overlap, density, size, labels), the other read the code for bugs. Everything below was confirmed, fixed, and re-checked.

**Outlines (anatomy layer and vessel drafts):**
- **Vertebra numbering.** On 4 CTs one label covered two vertebral bodies (Spine-Mets 14078: T7 and L3; Spine-Mets 13800: L3), was only a slab of the level above (LIDC-0217: T7) or only an arch (child CT 40FEFEF6: L5). A new rule compares each vertebra with the fully imaged levels around it. A level holding two bodies, an interior slab or fragment, or an arch that never reaches in front of the spinal cord means the numbering below it cannot be trusted. That level, everything below it and the matching ribs are no longer outlined. The rule also caught LCTSC-Test-S3-202 from T9 down; on the other 35 CTs it found nothing.
- **Rib fragments.** Rib outlines that never come within 75 mm of the spinal cord (fragments, e.g. both "rib 7" outlines on LIDC-0217) are dropped. Ribs cut by the scan edge are exempt.
- **Contested pixels.** Pixels claimed by both a heart chamber and a vessel from another model are left unmarked: the pulmonary trunk vs the right ventricle at the valve, the IVC vs the right atrium, and the left atrial appendage vs the left-ventricular muscle. The shared area per slice fell from up to 98–100 % to at most 1.8 % (edge rounding).
- **"(partially imaged)".** An outline that still has a full cross-section on the first or last slice of the scan is now marked as cut off. 0 cut-off outlines lack the label, in both packs.
- **Vessel drafts.** Their trachea now also ends at the carina; it ran 6–8 slices into the main bronchi. The brachiocephalic trunk has one name in both packs, "Brachiocephalic trunk (innominate artery)", because the book calls it the innominate artery.
- **Radiographs.** Outlines under 20 % of their typical size are fragments and dropped: one diaphragm, one aortic knob and one left hilum.
- **Labels.** "Cerebrum ('Brain' segment)" now reads "Cerebrum". The Atlas uses the book's words for colon and small bowel.

**App (all with tests):**
- A submitted answer could be overwritten by a pending draft autosave within 1.2 s of submitting. Fixed.
- Ctrl+Enter could submit in Review mode, before any answer, or a second time after the reference was shown. Marking shortcuts worked after submitting. Fixed: the button and the shortcut share one rule.
- **Holes in outlines.** Hover, drills and drawing ignored them, so a click inside the skull counted as "skull" and the ventricle cavity counted as heart muscle. Holes now belong to their outline: hover names what is inside them, drills grade them as misses, and isolated outlines are drawn with the hole open.
- **Centring.** "Show alone" centred the view on the image's top-left corner when the structure was on another series (e.g. from the Atlas). It now centres on the structure; a browser test checks this.
- Self-review answers all went into the mistake notebook. Now only answers you judged wrong do.
- **Viewer robustness:**
  - A superseded viewer load could blank the live panel.
  - Saving progress could stop the comparison patient from loading.
  - A late result from a previous case could make a task ungradable.
  - Comparison at the same level did not follow a scan that starts on its first image.
- **Drills and progress:**
  - "Review N due" turned into an ordinary drill. It now ends when nothing is due.
  - Drill feedback lowercased T2/S1.
  - The drill asked a "best window" question for intrapulmonary arteries, where the answer depends on contrast; it no longer does.
  - Drill numbers on the Progress page did not refresh after import or reset.
  - Book reading progress was missing from backups.
- **Layout and pages:**
  - On phones the top bar widened the whole page and zoomed it out. Tables and chips ran off the screen.
  - The Author page drew all 3,986 outlines at once; it now has search, paging and a viewer link for every outline.
  - Today's plan filled a new student's day with one patient; it now spreads across patients.
- **Book safety.** A build never contains the owner's book PDF (since the paid edition, not even with the old `KEEP_BOOK_IN_BUILD=1`). An uploaded `dist/` folder can therefore never publish it.

**Checks that passed in the audit:**
- 1,599 cranio-caudal relations and 45 front/back and left/right relations, with 0 real failures.
- 539 vertebra neighbour pairs in order.
- Density inside all 3,473 CT outlines in range for their name.
- Every label matching its structure, with 0 British spellings.
- 21 of 21 radiographs with heart, lungs and clavicles in place.

## 3b. Update of 28 October (afternoon): linked views, planes, 3D, conditions, new name

**Added and checked in the browser on a contrast chest CT (COVID-19-AR, 105 slices):**
- **Linked views.** Scrolling one view moves the parallel views of the same patient, both ways and during fast scrolling. Coloured reference lines show where each view cuts the others; in MPR the crosshair lines are always on. A double-click shows a point in every view: the coronal and sagittal planes moved through the clicked point and an axial stack jumped to the matching slice. Views of different patients are never linked; they keep the separate level matching.
- **Planes.** Slab MIP / MinIP / average from 1 to 60 mm, labelled in each view. Tilting from the axial view turned the coronal and sagittal planes by the set angle around the crosshair centre; the views show "oblique N°" and the side letters follow the tilt. *Straighten all planes* restores them.
- **3D.**
  - Opens facing the patient (front view) instead of looking along the scanner axis.
  - Rendering presets and six standard views.
  - **Cut:** a box with two planes per axis, or a cut at the slice being read that follows that view, including a tilted plane. It is put back after every rotation, because the 3D viewport otherwise turns the first two clipping planes into a thin slab.
- **3D structure models.** Built on demand from the outlines: mask on the volume grid, binomial blur, marching cubes, smoothing.
  - Building the 28 heart and great-vessel models took 4.4 s.
  - Picking under the cursor takes 2–3 ms.
  - From the front, the centre of the heart picks the right ventricle, the most anterior chamber, as it should.
  - Colours follow the atlas convention: systemic arteries red, systemic veins blue, pulmonary arteries blue-violet, pulmonary veins rose, right heart blue, left heart red.
  - The models follow the reference rules: Learn mode, Review, or after submitting.
  - 3D quiz answers count towards the structure's drill box.
- **Conditions search.** It lists every installed case showing a condition, with the images it is on and a link that opens the viewer at the finding: a lung nodule link opened image 61 of 119, inside the outlined 60–62. It also gives the book pages and signs. It says plainly when no installed case shows a condition: pneumothorax and hemothorax currently have none.
- **Name and look.** radiology.monster logo, favicon, app icons, sharing image, colours and self-hosted fonts. Stored progress keys are unchanged, so nobody loses progress.
- **Layout.** The six layout buttons are one *Layout* menu. The toolbar wraps on wide screens instead of hiding buttons off the edge. On a phone, MPR + 3D shows the axial and 3D views, with no sideways scroll.

**Limits of this update:**
- The 3D models come from AI draft outlines that no radiologist has checked. With 3 mm slices or thicker they look stepped.
- The cut uses at most two planes per axis: the WebGL volume renderer takes six.
- 3D needs WebGL, and was checked in Chromium and Firefox only.

## 3c. Located cases for the book's conditions (28 October, evening)

33 patients were added in four packs, each with the finding marked on the images by the dataset's experts. Every dataset was downloadable without a login or an agreement. Sources, licences, citations and exact files with hashes are in `docs/data/conditions-data.md`, and each case shows its source, licence and citation in the Case tab.

| Condition | Cases added | Marked by | Dataset (licence) |
|---|---|---|---|
| Pneumothorax | 4 PA radiographs | radiologist box | NIH ChestX-ray14 (unrestricted; acknowledge NIH Clinical Center and cite) |
| Pleural effusion, atelectasis, cardiomegaly, lung mass, lung nodule, pneumonia | 19 PA radiographs | radiologist box | NIH ChestX-ray14 |
| Pulmonary embolism | 2 CT angiograms | radiologist masks | FUMPE (CC BY 4.0) |
| Liver metastases | 1 CT (3 lesions) | segmentation | TCIA Colorectal-Liver-Metastases (CC BY 4.0) |
| Enlarged mediastinal lymph nodes | 2 CTs | every abnormal node segmented | TCIA Mediastinal-Lymph-Node-SEG (CC BY 4.0) |
| Fracture | 5 radiographs (wrist, ankle, shoulder, knee, hip) | expert outlines | FracAtlas (CC BY 4.0) |

**Checks:**
- Every radiograph was looked at with its box or outline drawn on, and kept only where the finding is clearly visible. 7 unclear NIH boxes were dropped (one "nodule" was the nipple shadow), as was one CT angiogram whose mask covered fewer slices than the scan.
- All four packs pass the pack validator, the zod contract and the catalog tests.
- In the browser, the reference sat on the abnormality in a pneumothorax, the saddle embolus, the liver metastases, the enlarged nodes and the hip fracture. The CT side letters are right, and the radiographs say "Orientation not recorded in file".
- The condition search finds them; a pneumothorax link opens the case at the box.

**Limits:**
- The NIH files do not record the side, so no label states one.
- The NIH labels come from report text and can be wrong; only the radiologist's box is scored.
- FracAtlas has no patient IDs; three images that may be one person share one hold-out group.
- No case shows a hemothorax yet. The only public located sets need a login, a signed agreement, or forbid public display, so they were not used. The same goes for intracranial hemorrhage, stroke, COPD/ILD, bowel conditions and aortic disease.

## 4. Measured performance (`docs/perf/measurements.json`)

These figures are from a production build on a **local** server. Real hosting adds network time in proportion to the bytes:

| Measure | Result |
|---|---|
| Shell interactive | 302 ms (first contentful paint 116 ms) |
| First CT image (starter chest CT, 131 slices, 20.7 MB) | 0.83 s |
| All slices fetched | 1.41 s |
| Cached scrolling (60 slice changes) | median 17 ms, p95 20 ms |
| MPR ready from the loaded volume | 0.38 s |
| JS heap after MPR | 125 MB used |
| Radiograph first image | 0.90 s |

The shell downloads 8.5 MB of JSON manifests, uncompressed (the largest is the anatomy layer's index, 3.5 MB). Hosts such as Netlify compress JSON, typically to under a quarter. Outline geometry is fetched only for the patient being viewed.

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
