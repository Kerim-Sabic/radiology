# radiology.monster

**Real cases. Deeper understanding.** A personal radiology reading workstation for studying *Learning Radiology: Recognizing the Basics* (Herring, 5th ed.) on **real DICOM studies**. Open an unfamiliar study, orient, window, scroll, mark what you see, commit, and get **deterministic spatial feedback** against source annotations on the exact slice — then jump to the book page that explains it and repeat the skill on a **different patient**.

For education and practice. Not a diagnostic device; its certificates record practice in the app, not a qualification; no guarantee of exam results.

## What is in the box

- **Viewer** (Cornerstone3D 5.13.2): stack scrolling (wheel, keys, slider, touch), window/level with modality-correct presets, zoom/pan/fit/reset/invert, full screen, orientation letters derived from image geometry (radiographs: from `PatientOrientation`, never guessed), axial/coronal/sagittal **MPR from one shared volume** with always-on linked crosshairs, thick slabs (MIP / MinIP / average, 1–60 mm) and oblique planes, linked scrolling and reference lines across views of one patient, double-click to show a point everywhere, **3D** with rendering presets, cut box and cut-at-slice, and coloured **3D anatomy models** (isolate heart, arteries, veins, airways, bones…) with hover names and a 3D quiz, a **condition search** (case + location + book pages), **finding drills** with spaced repetition, an **on-call mode** (timed shift of unknown cases with a scored report), cine playback and pinch zoom, point/arrow/box/outline marks, length/angle/ellipse ROI, undo/redo, bookmarks (series + slice + camera + window), honest pixel readout (HU only for CT).
- **Free account and membership**: signing up without a plan opens the sample patients in the full workstation; the rest of the library (the case of the week included) is listed by neutral title and locked, and members-only areas explain themselves. The server enforces it file by file (`server/free.ts`). Members get a featured case every Monday with its email, streak reminders (opt-in, one-click unsubscribe) and certificates with public pages made for sharing. Funnel and retention numbers for admins at `/admin`; Vercel Web Analytics without cookies.
- **Same-patient comparison**: 2-up and 4-up layouts with independent controls, verified relationships (same volume / common frame / independent acquisition with the real relative interval), CT scouts labelled as scouts.
- **Learning engine**: Learn / Practice / Assess / Review modes, progressive 5-level hints, reveal tracking (independent vs assisted), structured reports and differentials, rubric self-review, oral-exam prompts, mistake notebook, Today plan, unseen-patient assessment, skill dimensions with transparent heuristics.
- **Deterministic grading** (`src/grading`): point-in-contour with slab and in-plane tolerances, labelled one-to-one matching (no duplicate credit), slice-interval level grading, findings detection with IoU feedback, separate errors for navigation, wrong structure, wrong side, imprecise outline, missed finding and overcalling. Unmatched marks are *unscored* unless the reference covers the whole study. AI-draft references can never score authoritatively.
- **Book**: a full in-app reader of your own copy (contents with sections, case quizzes, take-home points; page navigation; search; per-page objectives, figures, notes and links to real-scan practice), a figure gallery for every chapter, and a verified page map for all 552 PDF pages (inserted e-pages handled), 918 figures, 1,013 sections and 274 objectives (see / show / explain) across 29 chapters + 8 appendices. The PDF is **never** in the public repository: it is installed locally (`scripts/book/install_book.py`, git-ignored) or imported per device (SHA-256 checked).
- **Anatomy labels** (Learn mode, or after submitting): every outlined structure on the current slice, with collision-free name tags and leader lines, searchable and grouped (heart, arteries, veins, airways, lungs, brain & spinal cord, bones, organs, glands, muscles). Each group can be recoloured and drawn outlined or filled (one style shared by slices, reformats and 3D models, kept per browser), with a colour key on the image; **Save image** exports the view as a PNG credited to its source. Click a structure to see it alone — the viewer jumps to the slice where it is largest and centres it; ‹ › steps through neighbours. Expert source contours are drawn solid; machine labels are dashed and tagged **“AI draft by Horalix”** (quality-checked, not reviewed by a radiologist).
- **Anatomy atlas** (`/atlas`): every labelled structure across all patients (CT, X-ray, MRI), each one link away from being shown alone on a real scan, plus a book anatomy checklist that lists covered structures and honest gaps. The aorta is labelled in parts (ascending, arch, descending thoracic, abdominal) and the colon by segment (cecum/ascending, transverse, descending, sigmoid, rectum) where the split passed quality checks. The pulmonary trunk and the right and left pulmonary arteries are separate outlines, the arteries inside the lungs are named by lobe (lobar and segmental), and the heart outline never covers them. On contrast CTs where every check passed, the four heart chambers and the left-ventricular muscle are outlined. The trachea ends at the carina; below it the airway is the right or left main bronchus. Anything that failed a check is not outlined at all.
- **Structure notes**: every labelled structure has a short note — how it looks, what it sits next to, one common pitfall, the best CT window and the book chapter (`src/content/structureNotes.ts`; a test fails if any installed structure lacks one).
- **Anatomy drills** (`/drill`): point to a structure, scroll to its level, name an outline (wrong options are its other-side twin and its neighbours on that slice) or pick the window that shows it. Spaced repetition per structure; a miss comes back a few questions later on a different patient, then on a widening schedule.
- **Search-pattern coach** (Coach tab): a systematic checklist for chest X-ray, chest CT, abdomen/pelvis CT and brain; *Show me* outlines the structures of each step together, at the level where most of them appear, in the right window.
- **Compare with another patient at the same level**: opens a second patient beside the scan and keeps both at the same anatomical level by pairing every structure labelled on both (vertebrae, organs, vessels), not by millimetres; the same structures are highlighted on both.
- **Confidence check**: answers rated 4–5/5 and graded wrong are flagged “sure but wrong”, go to the top of the review plan, and Progress shows how often “sure” is actually right.
- **Content (installed, real)**: 30 patients · 42 studies · 52 series · 4,321 DICOM instances · 131 tasks — see [docs/CONTENT_INVENTORY.md](docs/CONTENT_INVENTORY.md) and [docs/COVERAGE.md](docs/COVERAGE.md).

## Quick start

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:5173 and press **Start practice**. The `starter` pack (3 patients, 32 MB of real DICOM) ships in the repository, so this works from a clean clone. The other packs are rebuilt from TCIA:

```bash
pip install -r scripts/data/requirements.txt
```

```bash
python scripts/data/packs.py fetch chest-pairs
```

(`packs.py list` shows all packs; repeat `fetch` for `ct-mri-pairs`, `body`, `neuro-msk`, `expansion`. Downloads go to `%USERPROFILE%\radiology-data\raw`, outside OneDrive, and are verified by SHA-256.)

Members on radiology.monster can open **Book** directly. For local development, use **Settings → Book → Import PDF** with your own fifth-edition copy.

## Commands

| command | what it does |
|---|---|
| `npm run dev` | dev server (opens the study space without sign-in on your own computer) |
| `npm run dev:landing` | the public landing page as a visitor sees it (port 5174; sign-in answers as signed out) |
| `node scripts/landing/shoot.mjs` + `python scripts/landing/encode.py` | retake the landing-page screenshots from the running dev server (own browser profile) |
| `npm run build` | type-check (app, server, tests) + production build to `dist/` |
| `npm run preview` | serve the production build on :4317 |
| `npm test` | unit tests + validation of every installed pack/lesson/book anchor |
| `npm run test:e2e` | Playwright acceptance tests on the production build (Chromium + Firefox) |
| `node scripts/report/content-report.mjs` | regenerate the content inventory and coverage map from installed files |
| `python scripts/book/index_book.py --pdf <book.pdf> --out public/content/book --check` | rebuild/verify the book page map |
| `python scripts/lessons/<pack>.py` | regenerate a pack's authored lessons (validates every reference) |

## Architecture

| responsibility | where |
|---|---|
| CaseRepository (packs, manifests, assets, local import) | `src/services/caseRepository.ts`, `src/services/localImport.ts` |
| ViewerAdapter (viewports, tools, fetching, disposal) | `src/viewer/engine.ts`, `src/viewer/seriesFetcher.ts`, `src/viewer/csInit.ts` |
| LessonEngine (mode rules, hints, reveals) | `src/services/lessonEngine.ts` |
| SpatialGrader | `src/grading/spatialGrader.ts`, `src/lib/geometry.ts` |
| BookRepository | `src/services/curriculum.ts`, `src/book/bookPdf.ts` |
| ProgressRepository | `src/services/progressRepository.ts` (IndexedDB, export/import) |
| Content contract | `src/schema/content.ts` (zod, versioned) and [docs/COORDINATES.md](docs/COORDINATES.md) |

Data preparation is offline Python (`scripts/data`, `scripts/vessels`, `scripts/book`, `scripts/lessons`); no GPU or server is needed to study.

## Deploying

**Netlify:** Add new site → Import from GitHub → this repository; `netlify.toml` has the build settings and every data pack is in the repository. Import the book once per device from the Book page. Details and privacy options: [docs/DEPLOY.md](docs/DEPLOY.md). Private alternative: Vercel with **Deployment Protection → All Deployments + Vercel Authentication** (available on every plan) protects every URL including the DICOM and JSON files. Vercel Hobby limits CLI uploads to 100 MB, so a Hobby deployment carries the app + starter pack; larger packs need Vercel Pro (1 GB), Netlify, or local use.

## Documentation

- [docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md) — how to study, add a case, import the book, manage packs, back up progress
- [docs/DEPLOY.md](docs/DEPLOY.md) — Netlify / Vercel setup, privacy, CORS, env vars
- [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) — what was built, tested and measured, and what remains limited
- [docs/CONTENT_INVENTORY.md](docs/CONTENT_INVENTORY.md), [docs/COVERAGE.md](docs/COVERAGE.md) — generated from installed files
- [docs/data/DATA_REPORT.md](docs/data/DATA_REPORT.md), `docs/data/*-inventory.md`, [docs/data/vessel-drafts-report.md](docs/data/vessel-drafts-report.md) — data provenance and QC
- [docs/curriculum/BOOK_INDEX_REPORT.md](docs/curriculum/BOOK_INDEX_REPORT.md) — how the book map was built and verified

## Data sources and attribution

All images are de-identified research data from The Cancer Imaging Archive, used for personal education under each collection's licence as recorded per source in every `pack.json`: LCTSC, LIDC-IDRI, COVID-19-AR, PROSTATEx (+ zone segmentations), Soft-tissue-Sarcoma, C4KC-KiTS, ReMIND, Spine-Mets-CT-SEG, CBIS-DDSM and Pediatric-CT-SEG (CC BY 3.0/4.0), and **MIDRC-RICORD-1C (CC BY-NC 4.0 — non-commercial use only; remove the six RICORD radiographs from `more-ct-xr` before any commercial use)**. Please cite the DOIs listed in each pack. Outlines tagged “AI draft by Horalix” (the `anatomy-atlas` and `vessel-drafts` packs) are automatic segmentations that no radiologist has reviewed; build details are in `docs/data/`.

The textbook is © its publisher and is not included in this repository. The site owner’s requested member copy is stored separately in private Vercel Blob storage and served by `/api/book` after session and membership checks. The static build still excludes PDF files. See [PAYMENTS.md](PAYMENTS.md) for deployment and access details.
