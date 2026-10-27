# Verification report — 27 October 2026

What was built, what was actually tested and measured, and what is still limited. Numbers come from generated files (`docs/CONTENT_INVENTORY.md`, `docs/COVERAGE.md`, `docs/perf/measurements.json`, `docs/perf/e2e-results-latest.json`); nothing here is planned or projected content.

## 1. What exists

A React 19 + TypeScript 6 + Vite 8 single-page app with Cornerstone3D 5.13.2 as the only viewer, PDF.js 6.4 for the user's own copy of the book, IndexedDB persistence, and one optional serverless tutor function (Anthropic SDK 1.3.0, `claude-opus-5-5`) with Netlify and Vercel adapters. Offline Python pipelines prepare data (TCIA download → inventory → lossless re-encode → annotation conversion → validation), index the book, draft vessel outlines (TotalSegmentator 2.18.0, CPU) and author lessons.

## 2. Installed content (real, verified)

| | count |
|---|---|
| Distinct patients with usable cases | **30** (namespaced by source; 1 holdout group each) |
| Studies / series / DICOM instances | 42 / 52 / 4,321 |
| Image-based tasks | **131** |
| — spatially scored vs source manual annotation | 51 |
| — auto-checked choice on a real image | 11 |
| — self-review against a source-linked checklist | 54 |
| — spatial vs unreviewed AI-draft vessels (self-review until you review them) | 15 |
| Reference targets | 193 (125 source manual, 3 source automated, 65 AI draft) |
| Curriculum | 37 units (29 chapters + 8 appendices), 274 objectives, 670 verified anchors; 552-page map; 918 figures; 1,013 sections |

Packs: `starter` (in repo, 32 MB), `chest-pairs` 202 MB, `ct-mri-pairs` 60 MB, `body` 83 MB, `neuro-msk` 55 MB, `expansion` 263 MB (rebuilt from TCIA by `scripts/data/packs.py fetch`), `vessel-drafts` 1.1 MB (in repo). Sources: LCTSC, LIDC-IDRI, COVID-19-AR, PROSTATEx + zone SEG, Soft-tissue-Sarcoma, C4KC-KiTS, ReMIND, Spine-Mets-CT-SEG, CBIS-DDSM.

**Same-patient comparisons present (all `independent`, none registered):**
- Radiograph ↔ diagnostic CT: 9 patients — COVID-19-AR 16434363 (same day), 16434411 (same day), 16406502 (PA + lateral, CT 3 days later), LIDC-IDRI 0078, 0217, 0053, 0134, 0208, 0111 (interval unknown: placeholder dates).
- Radiograph ↔ CT **scout only**: COVID-19-AR 16406503 (the CT is a localizer, explicitly labelled as not a radiograph).
- CT ↔ MRI: Soft-tissue-Sarcoma STS_033 (same day; T1 + T2 fat-sat) and STS_042 (MRI then CT 18 days later; T1 + STIR). The CT is the CT component of PET/CT.
- No X-ray + CT + MRI triple exists in the installed data.

**Flagship five-vessel exercise:** implemented on 5 different patients' contrast chest CTs, with accepted slice intervals (2–10 slices each), level / identity / side / position graded separately, 5-level hints, reveal tracking, aortic-arch level navigation, and book anchors to Ch 3 PDF 39 / p. 24 and Fig 3.5 at PDF 40 / p. 25. The vessel references are **unreviewed AI drafts**, so the app shows a draft comparison and self-review, never a score, until you record your own review in Author.

**Coverage:** 26 of 274 objectives (9%) have at least one real-scan task. Chapters with real-scan practice: 1, 2, 3, 4, 8, 10, 13, 17, 20, 22, 26, 29. The rest remain visible in the Course map with their book anchors and the kind of data they would need.

## 3. Tests actually run (Windows 11, AMD Ryzen 9 7950X, Node 22.18)

| check | result |
|---|---|
| `npm run typecheck` (app, server functions, tests) | pass |
| `npm test` — 98 unit tests: geometry and transforms, slice sorting incl. shuffled input, gaps, duplicates and mixed orientation, laterality letters, grading (correct, wrong structure, wrong side, tolerance boundary at 13.0 mm vs 12.9 mm, off-level, duplicate clicks, shotgun penalty, unscored marks, AI-draft demotion, fake `human_reviewed` without review), tutor guards (no key, malformed, oversized, rate limit), and validation of every installed pack, lesson and book anchor | **98 / 98 pass** |
| `npx vite build` | pass (shell 467 KB JS; the 3.6 MB imaging engine is lazy-loaded) |
| Playwright e2e on the production build (`vite preview`), Chromium + Firefox | **36 / 36 pass, 0 flaky** (18 per browser) |

The e2e suite covers:
- Real CT/MR/CR loading in JPEG-LS, JPEG 2000 and Implicit VR.
- The MONOCHROME1 radiograph.
- Head-to-feet geometric order with hash-named files.
- Scroll, presets, zoom and reset.
- A known distance (100 columns = 97.66 mm).
- Correct, wrong-structure and wrong-side marks, with the attempt saved in IndexedDB.
- Marks staying in source geometry through zoom, pan and resize.
- Reveal making an attempt assisted.
- MPR from one volume with correct letters in all planes.
- CR beside its CT scout, with scout labelling and a "1 days apart" relationship.
- Assess mode hiding the title, hints, book and tutor.
- Tutor-unavailable fallback labelled as not live.
- Deep-link refresh.
- A missing asset showing Retry instead of a black viewport.
- Local import with shuffled, renamed files ordered by geometry.
- A gapped series refused for MPR.

Two real bugs found by the tests and fixed:
- Import pickers did nothing when used before the catalogue loaded (visible in Firefox).
- A one-line React effect returned the Promise that newer browsers return from `scrollIntoView`.

A third issue, found while debugging, is also fixed: re-importing files that are already installed collided on global DICOM UIDs. Local imports are now namespaced, and duplicates are reported.

**Manually inspected in the browser:**
- The heart task end to end, with the overlay and ✓ badge.
- MPR, and MPR + 3D (all four panels rendered).
- Two-up comparison of the CR and its scout.
- The oblique prostate MR.
- The five-vessel task, with a deliberately mislabelled arrow caught as "wrong name".
- The Course map and the Progress page.
- The phone-width layout (375×812: single viewport, task panel below).

## 4. Measured performance (`docs/perf/measurements.json`)

Production build on a **local** server, so real hosting adds network time proportional to the bytes listed:

| Measure | Result |
|---|---|
| Shell interactive | 262 ms (first contentful paint 132 ms) |
| First CT image (starter chest CT, 131 slices, 20.7 MB) | 0.70 s |
| All slices fetched | 1.35 s |
| Cached scrolling (60 slice changes) | median 18 ms, p95 21 ms |
| MPR ready from the loaded volume | 0.42 s |
| JS heap after MPR | 104 MB used |
| Radiograph (7.5 MB CR) first image | 0.88 s |

The shell downloads 3.4 MB of JSON manifests, uncompressed. Hosts compress it (the largest manifest drops from 966 KB to 180 KB with gzip). No Rust/WASM module was added: nothing measured is a bottleneck.

## 5. Not done / not verified (be aware)

- **No deployment was made.** `vercel.json` and `netlify.toml` exist, but neither host was deployed to or tested, and protected asset URLs were not checked signed-out. Vercel Hobby's 100 MB CLI limit means a free deployment carries the app plus the starter pack only.
- **Live AI tutor never called:** no API key was used. Prompting, citation mapping and refusal-fallback behaviour against the real API are unverified. Only the guard paths and the no-key fallback are tested.
- **Untested browsers and devices:** Safari/WebKit, iOS and Android hardware, Edge, and real touch input. Only Chromium and Firefox desktop are covered.
- **Data not available without credentials:** RSNA intracranial haemorrhage (Ch 26's most common emergency), VinDr-CXR, VinDr-SpineXR, PediCXR, RSNA lumbar MRI, MIMIC-CXR and GOLD Atlas. As a result there is no head CT, no paediatric imaging, no MSK radiographs, no bowel obstruction or perforation, no ultrasound and no nuclear medicine.
- **No whole-study reviewed references:** false positives are therefore never counted (by design: they are reported as "unscored"). No normal/negative control has a reference that establishes absence.
- **Reference quality limits:**
  - Radiotherapy contours are organ-at-risk definitions, not anatomical teaching boundaries.
  - LIDC readers disagree at edges; a mark inside any reader's outline counts.
  - The CBIS mass ROI is automated, so it is self-review only.
  - The CBIS mammogram has no pixel spacing.
  - Sarcoma and ReMIND MR headers lack TR/TE.
- **Optional features not built:** private progress sync (export/import is the supported path), DICOM SEG/RTSTRUCT import in the browser (done offline instead), registration/fusion, curated "see this finding on CT" links from radiograph pixels (only a self-review correlation task exists), and an in-app editor for reference geometry (Author records reviews and disputes but does not edit outlines).
- **Book:** the PDF is not shipped. Search and tutor excerpts need it imported on each device. Figure bounding boxes and modality guesses are heuristic for some figures.

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
npx playwright test e2e/learning-flow.spec.ts e2e/import.spec.ts
```

```bash
npx playwright test e2e/perf.spec.ts --project=chromium
```

```bash
node scripts/report/content-report.mjs
```
