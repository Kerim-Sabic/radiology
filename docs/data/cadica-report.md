# cadica-xca: coronary angiogram frames with lesion boxes

Added 9 November 2026. Builder `scripts/data/cadica.py` (select, sheets, build, index), lessons `scripts/lessons/cadica.py`
(lessons.json is the source of truth; edit it directly from now on). Pack checks: `python scripts/data/packs.py validate cadica-xca`
(0 errors, 0 warnings; inventory in `docs/data/cadica-xca-inventory.md`), `node scripts/data/zod_check.mjs public/packs/cadica-xca public/packs/index.json` (79 targets ok).

## Source and licence

- **CADICA**, Mendeley Data `p9bpx9ctcv`, Universidad de Malaga with Hospital Universitario Virgen de la Victoria. Licence **CC BY 4.0** (record's `data_licence`). No login or agreement.
  The owners are credited on /credits (source id `mendeley:CADICA`, shared with `credits_extra.json`); Kerim states they agreed to the use and asked only for credit.
- Version used: **5** (doi 10.17632/p9bpx9ctcv.5), `CADICA.zip` 3,076,112,179 bytes, sha256 `ac945f94...3dbad97b` (equals the record's file listing). Chosen over version 2
  because it adds `CADICAprojections.json` (which videos show the left and which the right coronary artery). The pack.json source carries the .5 DOI; the credits entry keeps the .2 DOI and citation of `credits_extra.json` (the match list covers all versions).
- Citation: Jimenez-Partinen A, et al. CADICA: a new dataset for coronary artery disease detection by using invasive coronary angiography. Expert Systems 41(12), e13708 (2024), doi:10.1111/exsy.13708 (preprint arXiv:2402.00570).
- Data (as distributed): 42 patients, one hospital, Siemens Artis Zee, DICOM videos at 10 frames/s converted by the authors to 512 x 512 8-bit PNG (DICOM metadata not distributed). 668 videos, 382 "selected" by the medical team as readable;
  key frames (`selectedFrames.txt`) are those with enough contrast. Lesions are boxes `[x, y, w, h]` on key frames of lesion videos with a category giving the degree of narrowing
  (p0_20 <20%, p20_50 20-49%, p50_70 50-69%, p70_90 70-89%, p90_98 90-98%, p99, p100 = total occlusion).

## What the labels are (stated in every target)

Boxes, not outlines: a rectangle that the dataset's cardiologists (assisted by computer scientists) drew around a lesion. They are loose and change size between frames of one lesion. The paper gives neither the number of annotators nor
an agreement figure. Provenance `source_manual` for every target; boxes are as distributed, converted to the pack's `image_px` box (-0.5 px shift). Grading: the app's `findings` grading, centre of the mark inside the box (`geometryType: box` already existed).
No pixel size, no projection angle (only left/right artery from the projections list), no dates, no patient data used.

## What was added

| | |
|---|---|
| Cases | 58 (each its own subject, study and one-frame series); 42 patients, at most 2 frames per patient, patients share a hold-out group `mendeley:CADICA:p<N>` |
| Modality | `XA`, 512 x 512, 8-bit, wrapped unchanged as DICOM Secondary Capture, JPEG-LS lossless; no pixel spacing, no orientation |
| Frame mix | 40 with a box of 50% or more (10 of 50-69%, 12 of 70-89%, 12 of 90-98%, 6 of 99-100%); 6 with only milder boxes (<50%); 12 from non-lesion videos (no box). 40 left-artery frames, 18 right |
| Targets | 79 boxes, all `finding:coronary_stenosis` (existing class and condition entry): 54 of 50% or more (required in "Find the narrowing") + 25 milder (shown, accepted, not required) |
| Tasks | 220 (all authoritative): 58 "Find the narrowing" (learn, practice, assess), 58 "Is there a significant narrowing in this angiogram?" (50% or more; learn, practice, assess), 46 "How tight is the tightest narrowing?" (four bands, learn/practice), 58 "Which coronary artery was injected?" |
| Difficulty | 18 intro (90% or more), 30 typical, 10 subtle (50-69%) |
| Size | **8.1 MB, 197 files** (budget 60 MB / 600 files); free edition unchanged (`npm run free:sync`: no file changed); nothing here is free |

Neutral titles `Patient <code> · Coronary angiogram` (codes from XAA on). PatientID `ICA-<8 hex of the image>`, PatientName blank, no dates. Study/series descriptions, role and display notes are checked at build against LEAK
(dataset names, hospital, "stenosis", "lesion", "narrowing", ...).

## Selection and review

- Per video the labelled key frame whose box region carries the most contrast (best visible lesion; boxes under 12 px or over 160 px skipped), frames mixing significant and mild boxes disfavoured; patients ranked by fewest cases already chosen;
  quotas by worst category. Pool before quotas: 25 / 38 / 44 / 10 frames in the four bands (so the 99-100% band holds only 6 here), 111 mild-only, 93 non-lesion videos' frames.
- Every chosen frame was drawn with its boxes (`cadica.py sheets`, 5 sheets) and checked by eye: boxes sit on arteries. **Dropped after review (1):** p3_v4_00028, a non-lesion frame with poor vessel filling and mottle (replaced by the next best).
- 11 of the 40 significant frames also carry milder boxes; they are targets with `required: false`, so marking them is not penalised and not needed.
- Not used: the 286 non-selected videos, the clinical spreadsheet, every other frame (the dataset has 3,996 lesion and 2,130 non-lesion key frames in selected videos): a larger second round is possible.

## Known limits (said in the lessons)

- One frame of one projection: an artery can look normal in one view and narrowed in another; "no significant narrowing" means none labelled on this frame, and non-lesion frames may come from patients with lesions in other runs.
- Boxes are loose rectangles; categories are visual estimates (the paper cites interobserver variability); the paper does not report annotator count or agreement.
- Single centre, 42 patients, one vendor; no angles, no pixel size; the modality `XA` is grouped under "Other" in the family filters (no UI change was made).
- No book chapter covers invasive coronary angiography, so cases and tasks have no book anchors (condition `coronary_artery_stenosis` from the ARCADE pack is reused; its evidence note names ARCADE only).
