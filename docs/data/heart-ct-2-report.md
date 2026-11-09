# heart-ct-2: second set of heart and great-vessel chest CTs

Added 9 November 2026. Scripts: `scripts/data/heart_ct_2.py` (screen, pick, fetch, prep), `heart_ct_ai_2.py` (MONAI path), `heart_ct_build_2.py` (build), `heart_ct_qc_2.py` (QC sheets), lessons `scripts/lessons/heart_ct_2.py`.
They import round one's modules (`heart_ct.py`, `heart_ct_build.py`, `heart_ct_ai.py`, `heart_ct_qc.py`), which are unchanged; selection, crop, outlines, QC rules and lessons are the same as in `docs/data/heart-ct-report.md`
(read that file for the dataset's labels, licence CC BY 4.0, the contrast rule and the AI rules). Facts per case: `docs/data/heart-ct-2-cases.json` (written by the builder).

## Summary

- **31 chest CTs of adults**, 2,149 DICOM slices (3 mm, cropped from above the arch to below the heart), **95.8 MB + lessons = 96.4 MB, 2,712 files** (budget about 100 MB / 3,000 files). 36 were built first (113 MB, 3,141 files, over budget); 5 faint-contrast cases were dropped to fit: s0553, s0626 (Philips), s1132 (GE), s0785 (Siemens, hospital A), s0667 (Siemens, hospital C).
- 530 outlines: 405 from the dataset (model-assisted, radiologist-verified; `source_automated`), 125 AI drafts (`ai_draft`, layer `atlas`, never graded). 119 tasks.
- **No licensed TotalSegmentator task was run and no licence or configuration file was read.** The chamber and pulmonary-artery drafts come only from the licence-free MONAI bundle path of round one (Apache-2.0 weights, trained on the CC BY 4.0 dataset v1). No coronary-artery outlines.
- Nothing is made free.

## Diversity added (round one: 28 of 36 cases from hospital J, only Siemens and GE, no Philips)

| | round two |
|---|---|
| Hospitals | J 12, B 5, C 5, E 4, A 3, K 2 |
| Makes | **Philips 9** (Ingenuity Core 128: 4; IQon spectral CT: 5), Siemens 21, GE 1 |
| Study types in the dataset table | chest-abdomen-pelvis 8, chest-abdomen 7, heart plus thoracic aorta 7, aortic valve 3, neck-chest-abdomen-pelvis 3, atrium 2, chest 1 |
| Heart-gated or dedicated cardiac studies (J) | 12 (heart-thoracic-aorta 7, aortic valve 3, atrium 2); all enhanced except s1259 |
| Contrast (measured: median HU of the dataset's aorta outline at the heart's levels) | 26 enhanced (>= 150 HU), 1 clearly unenhanced (s1259, 43 HU), 4 with 96-135 HU (portal-venous-like or late; taught as "faint contrast", no contrast question asked) |

Screening: 143 cases round one never screened (every Philips/Toshiba chest study, other hospitals' chest-abdomen and CT-angiography studies) were read from their own segmentations with round one's field-of-view rule (heart, aorta, pulmonary vein and both venae cavae present, heart at least 3 voxels from the edges in plane and 4 slices from the ends, 150-1200 ml): 120 eligible, of them 28 Philips.
Round one skipped the table's pathology tag `unclear`; **all Philips cases carry it** (it means the table says nothing), so it is admitted for Philips only and nothing about disease is claimed for those cases. 2 Siemens K/C and 1 A case with a table tag naming a thoracic finding were included (below).

## Pathology: what the dataset's table says, and what the pack claims

`meta.csv` gives only a coarse tag and a body-region list, never a diagnosis; the paper does not add case-level findings. So the pack names **no** aneurysm, dissection, embolus, cardiomegaly or effusion. Tags among the 31 cases: `vascular, thorax` 8 (J heart-gated aorta/valve studies; none is called a disease); `tumor, thorax` 2 (s0618, s1287); `inflammation, thorax` 1 (s0830); `unclear` 9 (all Philips); `no_pathology` 11.
The tags are in `heart-ct-2-cases.json` only; no lesson text or title repeats them, and the tumour or inflammation is not outlined. Measured, not diagnosed: three cases have an aorta whose largest inscribed circle is 44-47 mm (s0919 44 mm, s1073 44 mm, s1155 47 mm) and are taught as "a widened aorta" with the measurement (round two uses the measurement alone, not the tag).
The images of s0422 and s0455 (Philips IQon) show a large mediastinal soft-tissue mass on the arch slices; the table tags them `unclear`, so it is not named. s0737 shows a large hiatal-hernia-like stomach below the heart; also not named.

## Quality control by eye

All 31 cases were rendered from the built pack with `heart_ct_qc_2.py` (four axial levels, coronal and sagittal reformats of the stored polygons) and every sheet was looked at: dataset outlines sit on the right structures and the right side in all 31. Weak points seen and left in (unreviewed AI drafts, never graded):
the AI left-ventricle outline is small in s1330 (its myocardium and left atrium failed the rules, so that case has no chamber lesson); the heart outline of s0919 is fine but the chamber model returned nothing usable for it. s0618, s1155 and s0455 are noisy thin-slice or low-dose scans (outlines still sit correctly).

AI structures dropped by the round-one rules (blood pool under 120 HU or under 40 HU above the muscle, volume, inside the heart, side order): right atrium and/or right ventricle in s0349, s0371, s0472, s0618, s0709, s0717, s0946, s1073 (early arterial phase: right heart not yet opacified); left ventricle in s0422; left atrium in s1248, s1330; myocardium in s1330; all six structures in s0919.
Chamber model not run (no clear contrast, aorta under 150 HU): s0830, s1259, s1270, s1287, s1336 and the 4 cases dropped for size. 14 cases keep all four chambers and the muscle, which get the chamber lessons.

## Lessons

119 tasks: vessels 31, arch 31, contrast 27, chambers 14 + 14 chamber-position questions, aorta size 2. Naming tasks are `exploratory_self_review` against the dataset outlines (not authoritative); chamber tasks are self-review with AI outlines only as a late hint. Neutral titles `Patient <code> · Chest CT` (codes AGV-AHZ). Same teaching notes and book anchors as round one.
Patient identity: PatientName blank, PatientID `HCT-<hash>`; hold-out group is the case. A case in round two is never a case of round one (checked against round one's selection).

## Checks
`packs.py validate heart-ct-2` 0 errors 0 warnings; zod check ok (530 targets); `free:sync` no change; tsc clean; vitest 72 files / 1052 tests pass; build ok; Playwright learning-flow + views (chromium) and a look in the dev server (desktop and 390x844): see the commit notes.
