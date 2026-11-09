# arcade-xca: invasive coronary angiograms with expert annotations

Added 9 November 2026. Builder `scripts/data/arcade_xca.py` (select, build, index), lessons `scripts/lessons/arcade_xca.py`
(lessons.json is the source of truth; edit it directly from now on). Pack-level checks: `python scripts/data/packs.py validate arcade-xca`
(0 errors, 0 warnings; inventory in `docs/data/arcade-xca-inventory.md`), `node scripts/data/zod_check.mjs public/packs/arcade-xca public/packs/index.json` (manifest, 400 targets, index ok).

## Source and licence

- **ARCADE** (Automatic Region-based Coronary Artery Disease diagnostics using x-ray angiography imagEs), Zenodo record 10390295,
  doi:10.5281/zenodo.10390295. Licence **CC0 1.0** (the record's `license.id` is `cc-zero`; public domain dedication). No login or agreement.
- Citation: Popov M, et al. Dataset for Automatic Region-based Coronary Artery Disease Diagnostics Using X-Ray Angiography Images.
  Scientific Data 11, 20 (2024), doi:10.1038/s41597-023-02871-z (open access, PMC10764944).
- Download: `arcade.zip`, 451,573,813 bytes, MD5 `c5b1973ade06f7dff210f878161e1a76` (matches the record), extracted to
  `radiology-data/raw/arcade/x/arcade` (3,006 files). Recorded in pack.json `sources` (id `zenodo:ARCADE`, with accessNote).
- Data: one centre (Research Institute of Cardiology and Internal Diseases, Almaty, Kazakhstan), Philips Azurion 3 and Siemens Artis Zee,
  512 x 512 8-bit PNGs converted from DICOM by the authors (DICOM metadata removed by them), 1,500 patients, 3,000 frames over the two tasks
  (`syntax` and `stenosis`, each 1,000 train + 200 val + 300 test).

## How the labels were made (as written into every target's provenanceDetail)

Interventional cardiologists drew the polygons in CVAT. One initial annotator per image, cross-validation by two senior doctors, consensus as the
final label. `syntax`: the vessel segments of the SYNTAX score (categories 1-16c). `stenosis`: a region around each narrowing of **50% or more**
in vessels of at least 1.5 mm, judged with the angiography system's quantitative coronary analysis and by eye. Limits stated by the paper and repeated in
the targets' `unassessedNote`: annotator Dice agreement 0.73-0.90 (mostly at segment borders and small vessels); the masks cover about 60-80% of the visible
vessels; single centre, retrospective, two vendors. Provenance is `source_manual` for every target; nothing was edited.

## Structure of the dataset (inspected, not assumed)

- 2,868 distinct images by file content (132 files are byte-identical duplicates of another file). 123 images occur in BOTH tasks (a `syntax` file
  and a `stenosis` file with the same content, all in the test split; their two annotations line up exactly). Only the frames in both tasks have
  segment outlines and stenosis regions together, so only they are used. Within a task, images present twice (5 syntax, 4 stenosis) and the 3 unannotated stenosis images are never used.
- Every annotation is a single polygon (COCO `segmentation`, pixel-corner coordinates); the `syntax` categories are 1, 2, 3, 4, 5, 6, 7, 8, 9, 9a, 10, 10a, 11, 12, 12a, 12b, 13, 14, 14a, 14b, 15, 16, 16a, 16b, 16c
  (category 26 "stenosis" is defined in the files but unused in the `syntax` annotations).
- Polygons were converted to the pack's `image_px` convention (pixel centre = 0, so -0.5 px) and written as `contour_set` targets.

## What was added

| | |
|---|---|
| Cases (patients / studies / series / images) | 60 (each its own patient key, study and one-frame series) |
| Modality | `XA`, 512 x 512, 8-bit, wrapped unchanged as DICOM Secondary Capture, JPEG-LS lossless; no pixel spacing, no orientation, no dates |
| Reference targets | 400: 328 SYNTAX segment outlines (24 distinct segments, class `anatomy:coronary_*`) + 72 narrowing regions (`finding:coronary_stenosis`) |
| Coronary systems | 26 right-coronary frames, 34 left-coronary frames |
| Tasks | 316 (all authoritative): 60 "Find the narrowing" (learn, practice, assess); 180 "Find the <segment>" (3 per case, the commonest segments 5, 6, 1, 2, 3, 7, 11, 13, 4, 8, 16; assess only for segments 1, 5, 6); 60 "Which coronary artery was injected?"; 16 "In which segment is the narrowing?" (only where one segment holds at least 60% of the region and no other more than 25%) |
| Difficulty | 25 intro, 24 typical, 11 subtle (from the size of the largest narrowing region) |
| Size | **11.28 MB, 522 files** (6.9 MB DICOM, 400 target files, 60 thumbnails, pack.json 0.86 MB, lessons.json 1.03 MB); budget 60 MB / ~600 files |
| Free edition | unchanged (`npm run free:sync`: 2 sample patients, 52 weekly cases, 21 allowed paths, no file changed); nothing here is free |

Neutral titles are `Patient <code> · Coronary angiogram` (codes continue after the last in use, now into three letters: AAA onward). PatientID is `XCA-<8 hex>`, PatientName blank, no dates.
Study/series descriptions, role and display notes were checked at build against the LEAK pattern (dataset names, diagnoses, "stenosis", "plaque", "narrowing", ...).
No book chapter covers invasive coronary angiography, so cases and tasks have no book anchors or objective ids; the new condition entry
`coronary_artery_stenosis` (src/content/conditions.ts) cites ch11 "Coronary Artery Disease" (p.145) and ch03 coronary anatomy (pp.43, 45) with a note saying so.

Class ids avoid the words left/right (`coronary_main_stem`, `coronary_pda_rca`, `coronary_pda_lcx`) because the laterality test pairs left/right classes; the
vessels' sides are in their names and notes. Every new structure has a note in `src/content/structureNotes.ts` (written for this app, own words).

## Selection, review and every dropped case

- **Rule:** frames present in both tasks (123), each drawn with every segment outline and stenosis region on the frame (overlay sheets, 12 per sheet) and checked by eye;
  102 kept after review; 26 right and 34 left frames taken at even steps through the md5-ordered pool so that the pack stays within its file budget (the other 42 reviewed frames are usable later as a further round).
- **Dropped after review (21),** by image md5 prefix: stenosis region beside or off the vessel (0768f61c1f16, 329fc7d596f9, 72aea66c71f7, 8f5b792470d1, 9af050d8b1c0, a585fed4064f, a6bf1228aa8e, d75188a4e813, de1993e28e00, cd24c996eb0d);
  very low contrast so segments cannot be followed (15010fd0bef6, 1a9f8e359bf0, 862b948daf7e); segments that do not follow a clear vessel (803db52b1af4, b1f1d2a040c2);
  overlapping left main / trifurcation, boundaries ambiguous (2aa24fd98583, 9ac1af86ccd0, c6ef19e5edb0, dde6e91d0860); sternal wires or clutter over the tree (9903dab50fca, 9d4789f1ab73).
  Reasons per image are in `DROPPED` in `scripts/data/arcade_xca.py` and in `docs/data/arcade-xca-build-qc.json`.
- After the build every target was drawn again from the packed DICOM (`scripts/data/qc_render.py arcade-xca`, 34 sheets) and spot-checked: outlines sit on the right vessels.

## Known limits (said in the lessons)

- The dataset gives no pixel size and no projection angle: no distances, no orientation letters; tolerances are in image pixels.
- Stenosis labels are not exhaustive (milder or unlabelled narrowings exist) and segment borders are only approximate; the explanations say so, and "mark the segment" is graded in Assess only for segments 1, 5 and 6.
- No patient identifiers exist; the paper gives 1,500 patients for 3,000 frames, so two pack images may share a patient. Each image is its own hold-out group (a pack-wide group would make the Library treat the whole pack as one read patient).
- The modality is `XA`; the app groups it under "Other" in family filters (no UI change was made).
