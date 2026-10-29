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
| Distinct patients with usable cases | **114** |
| Studies / series / DICOM instances | 134 / 158 / 8,209 |
| Image-based tasks | **363** |
| — spatially scored vs source manual annotation | 144 |
| — auto-checked choice on a real image | 84 |
| — self-review against a source-linked checklist | 120 |
| — spatial vs unreviewed AI-draft reference (self-review until you review it) | 15 |
| Reference targets | 4,833 (356 source manual, 3 source automated, 4,474 AI draft by Horalix) |
| Curriculum | 37 units (29 chapters + 8 appendices), 274 objectives; 64 objectives (23%) have at least one real-scan task |

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
| `npm test` — unit tests (see below) | **334 / 334 pass** |
| `npm run build` | pass (shell 529 KB JS; the 4.3 MB imaging engine and the PDF reader are lazy-loaded; the book PDF is never in a build) |
| Playwright e2e on the production build (`vite preview`), Chromium + Firefox, as a signed-in member (account API mocked; the gate itself has its own tests) | **79 pass, 0 fail**; 7 skipped: the speed measurement runs in Chromium only, and the book-reader tests need the owner's PDF, which no build contains (they pass with it copied into `dist/book`) |
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

## 3d. Ultrasound, mammography, children and joints; per-modality viewing (28 October, night)

**New cases (all CC BY 3.0/4.0; every image looked at with its label drawn; sources, citations and hashes in `docs/data/conditions-data.md`):**
- Breast ultrasound: 6 women — 2 invasive carcinomas and 2 fibroadenomas (biopsy-proven), 2 simple cysts (confirmed on follow-up) — each outlined by a radiologist (Breast-Lesions-USG). Stored with true pixel spacing and an ultrasound region record.
- Fetal head ultrasound: 3 heads with the sonographer's head-circumference ellipse (HC18).
- Mammography: 5 women, CC and MLO of every breast (one with all four views), masses and calcification groups with their outlines and the stated pathology (CBIS-DDSM).
- Children: 4 wrist fractures on frontal and lateral films — 2 Salter-Harris II, 2 torus/greenstick (GRAZPEDWRI-DX).
- Knees: 3 knees graded Kellgren–Lawrence 0, 2 and 4 by two experts who agreed (graded, not located).
- 24 new practice tasks tied to book objectives on installed cases (book-practice). Objectives with a real-scan task: 46 → 64 of 274.

**Viewing by modality (all checked in the browser):** MRI sequence guide on every MR view (T1, T1+C, T2, FLAIR, STIR, PD, DWI, ADC, T2*), linked to the book's T1/T2 page; mammography hanging (CC above MLO, right breast on the left, chest walls back to back — the four-view case hangs with the posterior edge of each film toward the middle and the burned-in film markers agree with the tags); a 3× magnifier for radiographs, mammograms and ultrasound; ultrasound readouts say "echo level (not calibrated)" and never invent an orientation.

**Not available under a licence the paid site can use, with the finding located:** abdominal plain films, neonatal and vascular ultrasound, FAST, hemothorax, intracranial hemorrhage.

## 3e. Landing page, Today, quick search, solid outlines on reformats (29 October)

**Public landing page** (what a visitor without access sees; `npm run dev:landing` shows it locally):
- Hero, five-modality tour, features, how a session works, pricing (the existing plans and checkout panel, unchanged in behaviour), questions and answers.
- Every image is a screenshot of the app (`scripts/landing/shoot.mjs`, run in its own browser profile) showing data whose licence allows commercial use, credited in the footer: FUMPE, C4KC-KiTS, ISLES 2022, CBIS-DDSM, BrEaST, NIH ChestX-ray14.
- The numbers it states (100+ patients, 340+ tasks, 75+ conditions, 274 objectives, 5 modalities) are checked by `tests/landingFacts.test.ts` against the commercial catalogue members actually get: 108 patients and 346 tasks after the non-commercial filter.
- The page still loads no study content before access, and is checked at 1440 px and 390 px with no sideways scrolling. A signed-in visitor without access sees the plans in the hero.

**Today:**
- Next scan with its thumbnail.
- Streak and a 20-week activity calendar. Answers come from the attempts; drill answers come from a per-day log that travels in the backup and is cleared by a reset.
- Your areas: patients read and share right per body area, with a link to the next task on an unread patient in the weakest area.
- One tile per study mode.
- The Progress page shows 26 weeks of activity.

**Quick search (Ctrl/⌘ K, every page including the reading room):** pages, conditions (typo-tolerant), book chapters and appendices, and cases by neutral title only. A test checks that a diagnosis never finds a case.

**Outlines on coronal, sagittal and oblique views** were drawn as one line per acquired slice, which looked like hatching. They are now rebuilt as solid cross-sections: neighbouring slices are joined, and each end reaches half a slice beyond the last outline. Covered by `tests/crossSection.test.ts`.

**Top bar:** stays on one line from 900 px to 1920 px, with or without the account menu. Labels give way to icons, less-used pages first.

**Tests on the production build (merged with the monthly/yearly plans):** 356 unit tests; 87 browser tests in Chromium and Firefox (7 skipped as before), including the landing tour, quick search from the reading room, and today's square on the activity calendar.

## 3f. Colours and fill for outlines, colour key, saved images (29 October, afternoon)

**Colours and fill** (`src/viewer/segStyle.ts`):
- Every group in the Anatomy tab (heart, arteries, veins, airways, lungs, brain & spinal cord, bones, organs, glands, muscles) has a colour swatch, *Outline / Filled* and a show/hide tick box. *Fill all / Outline all*, fill strength, line width and *Atlas colours* sit above the list; a structure shown alone can get its own colour.
- Until the learner picks a colour, slices use the same atlas colours as the 3D models (systemic arteries red, veins blue, pulmonary arteries blue-violet). Before this, slices used one pink for the heart, arteries and veins alike.
- One style for axial slices, the coronal, sagittal and oblique reformats, the 3D models (recoloured live) and the Atlas page. It is kept in this browser (`localStorage`, read back field by field).
- Brain & spinal cord, glands and whole bones (`bones`, `femoral_head`) are now groups of their own: they used to fall into *Other*.

**Colour key, keys and toolbar:**
- A colour key on the image lists the groups drawn on that slice. It is hidden on small panels, while a structure is shown alone, and in drills.
- **V** fills or outlines everything, **N** toggles names, and a fill button sits beside the anatomy button.

**Drills:** the asked structure is drawn in one neutral colour. It used to carry its group's colour, which hinted at the answer (vessel pink).

**Save image:** downloads the focused view as a PNG with its outlines, marks, colour key and orientation letters. A footer gives the neutral case title, series, slice, and the image source with a short licence name (CC BY 4.0…).

**Assess leakage fixed:** while an Assess answer is open, the Case tab no longer shows the source dataset, the subject key or the linkage note, because a dataset's name (for example a pulmonary-embolism or stroke collection) can hint at the diagnosis. *Save image* waits for the submission too.

**Tests:**
- Unit: `tests/segStyle.test.ts` (precedence structure → group → atlas, outline/fill per group and for all, reset, defensive parsing, new groups) and `tests/viewImage.test.ts` (licence names, file names, footer fitting).
- Browser: arteries red and filled on the slice while the veins stay outlined, the choice kept after a reload, **V** both ways, the download, and *Atlas colours*. The Assess test also checks the hidden source.
- Totals on the production build: 364 unit tests; 89 browser tests in Chromium and Firefox (7 skipped as before).

## 3g. Library ×3, free accounts, case of the week, emails, certificates, numbers (29 October, evening)

**Library.** The commercial catalogue grew from 108 patients and 346 tasks to **364 patients and 1,043 tasks**, in five new packs:
- `us-breast-2`: 98 breast ultrasound patients, 392 tasks.
- `stroke-mri-2`: 50 diffusion MRI patients, 106 tasks.
- `cxr-findings-2`: 67 chest radiographs with radiologist boxes, 106 tasks.
- `peds-wrist-2`: 30 children's wrists, both views, 60 tasks.
- `mammo-cbis-2`: 11 mammograms, CC and MLO, 33 tasks.

All five licences allow commercial use with no login: CC BY 4.0, CC BY 3.0 or NIH unrestricted, each checked on the official page and recorded in the pack. Every answer comes from the dataset's expert annotation. Every overlay was rendered and reviewed, and 129 of 196 candidate radiographs were dropped, each with its reason (`docs/data/round4-data.md`, `*-2-build-qc.json`). The packs add 190 MB to the repository. The landing page now says 350+ patients and 1,000+ tasks, still checked by `tests/landingFacts.test.ts`.

**Fixed: wording that gave the diagnosis away before an answer.** It appeared in Assess, quick search, drills and saved images:
- **Case titles.** 63 titles named their dataset (e.g. "HCC-TACE-Seg", "ISLES 2022", "FracAtlas", "FUMPE"). All titles now read "Patient <code> · <scan>".
- **Scan descriptions.** Some studies and series named the dataset or the finding (e.g. "MRI brain, stroke (ISLES 2022)").
- **Clinical context.** 65 contexts named the diagnosis, e.g. "with an ischemic stroke", "lung cancer later confirmed by biopsy", "vestibular schwannoma". They now give a neutral referral, e.g. "sudden neurological symptoms", "referred for chest CT".
- **Case tab in Assess.** The source dataset and subject key are now hidden until submission.
- `tests/neutralTitles.test.ts` checks all four.

**Free account** (signed in, no plan):
- Two sample patients, plus the case of the week: a new patient every Monday (UTC), 52 weeks scheduled in `src/content/weekly.ts`.
- `proxy.ts` lets a free account load only those patients' files, the free manifests, the teaser list and the curriculum (`server/free.ts`, `npm run free:sync`, `tests/freeEdition.test.ts`).
- Locked areas (drills, on call, atlas, book) explain what they are. The library lists every other patient by neutral title, locked. Upgrade prompts appear on Today, after an answer, and in the top bar. Signed-in visitors no longer see the marketing page; plans open on their own screen.

**Book:** served only to verified `@stu.ssst.edu.ba` emails (`server/book.ts`, tested). Everyone else opens their own copy, which is checked against the 5th edition and stays on the device. The landing footer says the app is not affiliated with the book's publisher or authors.

**Emails:**
- A streak reminder (a daily job at 17:00 UTC, for streaks of 2 or more days not yet extended today) and the case-of-the-week email (Monday 07:00 UTC), both through Resend.
- Opt-in, with signed one-click unsubscribe and `List-Unsubscribe` headers.
- The server stores only study days and email choices.

**Certificates:** one per body area (10 patients read, 70% of graded answers right) plus Radiology foundations. Each has a public page at `/certificate/<id>`, with print and "Add to LinkedIn".

**Numbers:** Vercel Web Analytics, cookieless, with query strings dropped. Daily counters for the funnel: landing visit, Start free, account created, first answer, plans opened, checkout, paid. Day-1 and day-7 return. Admins see all of it at `/admin`.

**Look:** the landing page, plans screen and app surfaces were restyled: centred hero, pill buttons, frosted top bar, rounder cards, calmer backgrounds. Checked at 1440 px and 390 px with no sideways scrolling.

**Tests on the production build:** 432 unit tests; 93 browser tests in Chromium and Firefox (7 skipped as before), including the free account, locked patients and the public certificate page.

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
  - No head CT for hemorrhage, no bowel obstruction or perforation, no FAST, neonatal or vascular ultrasound, and no nuclear medicine. Every public set found for these needs a login, a signed agreement, or forbids commercial use.
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
