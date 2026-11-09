# cadica-xca-2: second set of coronary angiogram frames with lesion boxes (CADICA)

Added 9 November 2026. Builder `scripts/data/cadica_2.py` (imports the readers, constants and wording of `scripts/data/cadica.py`, which is unchanged), lessons `scripts/lessons/cadica_2.py`
(lessons.json is the source of truth from now on). Source, licence (CC BY 4.0, version 5, CADICA.zip sha256 checked), citation, label method and limits are those of `docs/data/cadica-report.md`;
the dataset owners are credited on /credits.

## What was added

| | |
|---|---|
| Cases | 62 (one frame each); 41 of the 42 patients (hold-out group `mendeley:CADICA:p<N>`, shared with round one) |
| Videos | none of round one's 58 videos is reused (checked), so no frame repeats |
| Frame mix | 14 with a 99% or total-occlusion box (7 + 7), 10 of 50-69%, 12 of 70-89%, 12 of 90-98%, 6 with only milder boxes, 8 from non-lesion videos; 42 left, 20 right |
| Targets | 93 boxes (67 of 50% or more, required in "Find the narrowing"; 26 milder, accepted but not required), all `finding:coronary_stenosis` |
| Tasks | 240: 62 "Find the narrowing", 62 "Is there a significant narrowing?", 54 "How tight is the tightest narrowing?", 62 "Which coronary artery was injected?" |
| Difficulty | 26 intro, 26 typical, 10 subtle |
| Size | 8.4 MB, 219 files (budget 25 MB) |

## Selection and review

- Only videos not used in `cadica-xca`; per video the labelled key frame whose box region carries the most contrast; at most 2 frames per patient (3 for the 99-100% band, since it is rare).
- 99-100% band: every video with a 99% or total-occlusion box was searched with the relaxed size filter (box area 8 x 8 to 220 x 220 px instead of 12 x 12 to 160 x 160). **No relaxation turned out to be needed:** all 14 chosen frames already pass the original filter
  (round one had only 6 in this band because the strict "best frame per video" rule often picked a lower-band frame of a video; here a video with a 99-100% frame is tried for that band first). 15 candidates existed; the quota took all of them, then one was dropped (below).
- Pools before quotas: 25 / 37 / 40 / 14 frames in the four bands, 106 milder-only, 93 non-lesion. Quotas 10 / 12 / 12 / all, 6 milder, 8 non-lesion.
- All 63 first-choice frames were drawn with their boxes (6 overlay sheets) and looked at: every box sits on a vessel. **Dropped after review (2), near-duplicates of a kept frame (same patient, view and box):** p25_v8_00040 (of p25_v7_00043), p32_v8_00021 (of p32_v5_00035).
  Some patients still have frames in both rounds, always from different videos.
- Round one's `DROPPED` lookup compared a doubled key and so never matched; round two compares the frame name directly. Round one is not touched.

## Limits (as in round one, said in the lessons)
Single frame and projection per case; boxes are loose rectangles with visual degree categories (annotator count and agreement not reported); single centre, one vendor; no pixel size or angles; no book anchors; modality `XA` is grouped under "Other" in family filters. Nothing here is free.

## Checks
`packs.py validate cadica-xca-2` 0 errors 0 warnings; zod check ok (93 targets); `free:sync` no change; tsc clean; vitest all pass (clerkWarm times out under load, passes alone); build ok; Playwright learning-flow + views on chromium (see commit).
