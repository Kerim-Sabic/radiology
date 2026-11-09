# arcade-xca-2: second set of coronary angiograms (ARCADE)

Added 9 November 2026. Builder `scripts/data/arcade_xca_2.py` (imports the round-one tables and helpers of `scripts/data/arcade_xca.py`, which is unchanged), lessons `scripts/lessons/arcade_xca_2.py`
(lessons.json is the source of truth from now on). Source, licence (CC0 1.0), citation, label method and limits are exactly those of `docs/data/arcade-xca-report.md`.

## What was added

| | |
|---|---|
| Cases | 112 (one frame each, own hold-out group) |
| A. frames in both ARCADE tasks | 42 (10 right, 32 left): the reviewed round-one frames not packed there; 55 narrowing regions |
| B. frames with segment outlines only | 70 (28 right, 42 left): 96 drawn on overlay sheets and reviewed by eye, 10 dropped, then thinned at even md5 steps for the file budget |
| Targets | 657 (602 SYNTAX segment outlines, 55 narrowing regions), all `source_manual` |
| Tasks | 497: 42 "Find the narrowing", 334 "Find the segment" (3 per case), 112 "Which coronary artery was injected?", plus "In which segment is the narrowing?" where one segment clearly holds the region |
| Size | 21.6 MB, 883 files (budget 25 MB) |

Frames of the stenosis task without segment outlines were not used. Segment-only cases carry no narrowing task and say so in their notes. Titles are `Patient <code> · Coronary angiogram`, codes continuing after the last in use. Nothing is free.
Some syntax-task PNGs are stored as RGB; they were accepted only after checking the three channels are identical (pure grey) and converted to 8-bit grey.

## Dropped after review (segment-only sheets), by md5 prefix
0f585b72ecb4 (outlines beyond visible vessel), 3b2345345da0 (three small segments only), 6386ffcdac37, 8d21f26575fc, e26cc74ca5af (tangled left main / circumflex outlines), b75f685a7424, d857662fac16 (overlapping branches), ccf8691ba10b (outline in empty background), edf694ebf122, fff8c16a2a9c (outlines not on a clear vessel). Reasons: `DROPPED2` in the builder. The 42 frames of group A had passed the round-one review and were drawn again with both annotations and looked at; none dropped.

## Checks
`packs.py validate arcade-xca-2` 0 errors 0 warnings; zod check ok (657 targets); `npm run free:sync` no change; tsc clean; vitest 1019 pass (one timeout in clerkWarm passes alone); build ok; Playwright learning-flow and views (chromium) 41 pass. Every built target was redrawn from the packed DICOM (`qc_render.py`, 55 sheets; spot-checked).
