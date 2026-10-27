# Book index report — Learning Radiology, 5th ed.

Source: the user's own PDF copy (ISBN 9780323878173, 552 physical pages), SHA-256
`0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1` (verified).
The PDF is never committed (`*.pdf` is gitignored). Full-text extraction stayed in a
local scratch directory. The repository holds only IDs, page numbers, bounding boxes,
heading titles and text written for this project.

## How the index was built

`python scripts/book/index_book.py --pdf <book.pdf> --out public/content/book [--check]`

- **Text layer.** Every page is a full-page raster with an invisible text layer. The script
  reads it with PyMuPDF (`get_text("dict")`), which gives span text, size and bbox. Font
  names differ from page to page, so the rules use size and position, not font names.
- **Page map.** The printed label is the page-number token in the header band (top
  45 pt) or the footer band (chapter-opening pages), at the outer margin. When a page
  has no number, the label is inferred from the nearest labelled pages in the same
  series (roman, arabic or `eN`) and marked `"inferred": true`. Unit ranges come from
  the PDF's level-1 bookmarks. They are checked against the running header on every
  page (`CHAPTER n` or `E-APPENDIX X`); there are 0 mismatches.
- **Sections.** Headings come from the PDF outline (977 bookmarks). Each one is
  matched to a line on its target page whose font size is at least the heading size
  (12.9, 12.0 or 10.5 pt), with wrapped lines joined. All 902 match on the exact
  bookmark page. Outline level 2 maps to level 1, level 3 to 2, and level 4 or 5 to 3.
  The special banners are found from their 11 pt uppercase lines: case quiz
  question/answer, take-home points and diagnostic pitfalls. The "Video Contents"
  front-matter page is recorded as a `video_listing` section. `videoReferences` lists
  the 31 video IDs with the page of their first mention in the text. It is not a claim
  that any video is available.
- **Figures, tables and boxes.** A caption start is a `Fig.`/`eFig.`/`e-Fig.` span at
  7.5–8.6 pt (or a `TABLE`/`BOX`/`eTable`/`eBox` span at 9.9 pt) followed by a number,
  with all of these true:
  - it begins a visual line;
  - it is not followed by `)` or a panel letter;
  - it is not directly below a line of caption prose (that pattern is a wrapped reference);
  - its number belongs to the page's own unit.

  The first valid occurrence wins. Numbering is complete, with no gaps, in every unit.
- **bbox.** The page is rendered at 72 dpi and all text spans are erased. The script
  looks for "ink" (gray < 205, or saturated colour) between the caption and the nearest
  body-text or heading line. It searches above the caption first, then below, then to
  the side. Row and column ink profiles give the region, which is normalized to 0–1.
  Tables and boxes get `bbox: null`, since they are typeset text, not images.
- **modality / hasPrintedAnnotations / description.** These are heuristics. The
  modality is the earliest explicit modality word in the caption. If there is none,
  pixel cues decide: paper-white line drawings become `diagram` and colour pictures
  become `diagram`, `photo` or `other`. After that come the containing headings, then a
  per-chapter default, then `null`. `hasPrintedAnnotations` is `true` when the caption
  mentions arrows, circles, asterisks or bracketed letter labels (not A–H panel letters),
  and `null` otherwise. Descriptions are composed by machine from a controlled
  vocabulary in the script, or from the containing heading title. No caption words are
  copied. A 6-gram overlap check against the book text found 0 hits outside quoted
  headings.
- **Curriculum.** The objectives were written by hand in my own words. Every anchor
  was checked against the page text in scratch, using a keyword that must appear on
  the anchor page. Figure anchors were also checked against the caption. A 7-gram
  overlap check of all objective text against the book text found 4 generic hits,
  which were rephrased; there are now 0. `--check` revalidates every curriculum anchor
  against the page map, figures and sections.
- **Output.** The output is deterministic: sorted keys, one array element per line, and
  identical MD5 hashes across repeated runs.

## Anchor checks (`--check`, 111 checks, 0 failed)

| Check | Result |
|---|---|
| SHA-256, 552 pages | PASS |
| PDF15 = `1` (ch01 start), PDF16 = `2`, PDF17 = `2.e1` (kind `inserted`), PDF18 = `3` | PASS |
| PDF39 = `24` holds section "Five-Vessel Level (Fig. 3.5)" (ch03-s07) | PASS |
| PDF40 = `25` holds Fig 3.5 and Fig 3.6 | PASS |
| PDF95–99 = `79.e1`–`79.e5` (kind `inserted`, ch09; eFig 9.1–9.10); PDF100 = `80` | PASS |
| PDF420 = `e1` (appA), PDF469 = `e50` (appF start), PDF532 = `400` (bibliography), PDF535 = `403` (index) | PASS |
| All 37 unit starts and selected unit ends (physical page and printed label) | PASS |
| Figure/table/box numbering has no gaps; all 29 chapters have quiz Q/A and take-home markers | PASS |
| Running headers agree with unit ranges; all outline headings found on their page | PASS |
| 670 curriculum anchors agree with page map, figures and sections | PASS |

Note: the chapter-start printed labels in the brief were partly estimated. Chapters
10–27 start lower than a single offset predicts: for example, ch10 is PDF112 = `92`,
not 95. The values used here are the detected ones, and they were cross-checked
against the book's Contents pages (92, 111, 149, 161, 223, 283, 347, 382).

Visual spot-checks (rendered pages with the detected bboxes drawn on them): PDF15, 22,
27, 40, 43, 66, 95, 99, 152–155, 205, 222, 228, 234, 262, 292, 310, 350 (Fig 26.11 and
Fig 26.12, printed 330), 360, 376, 408, 425, 445, 470, 500 and 521.

## Counts

- **Pages:** 552 in total. By kind: chapter 399, inserted 6, appendix 112, front 13,
  bibliography 3, index 13, blank 6.
- **Inferred labels (13):**
  - PDF3–7 = i–v (front matter);
  - PDF326 = 306, PDF358 = 338 and PDF414 = 394 (chapter pages without a number);
  - PDF548–552 = 416–420 (trailing blank pages).
- **Pages with no label:** PDF1–2 (cover and inside front cover) have `printed: null`.
- **Figures:** 918.
  - 635 chapter figures, 11 chapter e-figures (eFig 1.1, eFig 9.1–9.10) and 272
    appendix e-figures (A 30, B 24, C 1, D 4, E 10, F 200, G 3).
  - **bbox:** 917 detected, 1 null.
  - **Modality:** radiograph 383, CT 159, US 67, MRI 43, NM 39, diagram 27, mammo 21,
    fluoro 19, photo 4, other 2, null 154 (135 of them in appendix F).
  - **hasPrintedAnnotations:** true 843, null 75.
- **Tables:** 96 (80 in chapters, 16 eTables). **Boxes:** 43 (37 in chapters, 6 eBoxes).
- **Sections:** 1013. These are 902 headings, 30 take-home, 29 quiz questions, 29 quiz
  answers, 22 pitfalls and 1 video listing.
- **Objectives:** 274, with 670 anchors (539 to a figure or table, 129 to a section, 2 to
  a page only). Per unit:
  - chapters 1–9: 7, 7, 8, 7, 6, 7, 7, 7, 7
  - chapters 10–19: 10, 8, 6, 6, 7, 7, 6, 11, 10, 8
  - chapters 20–29: 6, 10, 8, 10, 8, 6, 12, 9, 9, 9
  - appendices A–H: 9, 7, 3, 3, 2, 16, 3, 2
- **scanNeed feasibility:** book_only 97, open_tcia 76, credentialed 61, not_dicom 40.

## Uncertainties and known gaps

- **Fig 2.2 (PDF27) has `bbox: null`.** It is a page-wide composite whose panels are
  interleaved with sub-captions.
- **Some bboxes are partial.** For a few white-background line drawings (e.g., Fig 1.12,
  Fig 3.12, Fig 18.1, Fig 22.4), the bbox covers the drawing but not the text labels
  around it, or only part of a pale drawing.
- **Modality, annotations and descriptions are heuristic.** Expect some errors:
  - a caption that mentions several modalities gets the first one named;
  - appendix F sign figures are mostly `null`;
  - descriptions such as "Mammogram showing shoulder and breast" are vocabulary noise.

  Treat these fields as hints, not ground truth.
- **`hasPrintedAnnotations` is `true` for most figures** because most captions mention
  arrows. It is not a detector of what is actually burned into the image.
- **"IMPORTANT POINTS" boxes (184) are not indexed as sections.** Table/box
  continuation pages ("cont'd") are not listed separately; each item records its first
  page only.
- **Feasibility labels follow the brief's dataset list.** Lateral chest radiographs, ICU
  device films, pediatric films, CT pulmonary angiograms, cervical-spine CT and trauma
  abdominal CT are marked `credentialed`, on the assumption that sources such as
  PhysioNet/Kaggle DICOM sets can be obtained. Abdominal radiographs and most MSK
  radiographs are `book_only`.
- **Chapters 17 (11 objectives) and 26 (12) exceed the ~10 target** because of their
  breadth.
