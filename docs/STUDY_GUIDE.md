# Study guide

## Daily routine (15–60 min)
1. **Today → Start practice.** The plan puts overdue mistakes first (on a *different* patient), then your weakest skill, then unseen patients. Set your minutes on Today; an exam date in Settings is optional.
2. **Orient before you search.** Modality, plane, side letters at the image edges, window. Scroll the whole stack first (wheel, ↑/↓, or the slider).
3. **Mark and commit.** `M` point, `A` named arrow, `B` box, `O` outline. Hold **Shift + drag** to window while a marking tool is active. Say *Not sure* or *Not assessable* when that is the honest answer — it is recorded, not punished.
4. **Read the feedback by component.** Level, identity, side and position are graded separately; marks outside every validated reference are *unscored* (the reference is incomplete there), not wrong.
5. **Open the book page** from the feedback, then **Return to my scan position**.
6. **Same skill, different patient.** Repeating on new patients is what the progress model counts.

Modes: **Learn** (reference and explanation visible; always counts as assisted), **Practice** (hidden answers, hints), **Assess** (neutral titles; no hints or book until you submit; optional timer in Settings), **Review** (past attempts with their feedback).

Students: keep **Student** level (guided descriptions). Residents: switch to **Resident** (full findings / impression / differential on every task, oral-exam prompts).

## What the numbers mean
- *Independent* = no hint or reveal before submitting. *Assisted* attempts are kept but counted separately.
- *Provisionally independent* (a product heuristic): independent success on ≥3 distinct patients including a retry ≥20 h after the first success. It is not a clinical competence claim.
- Small samples are flagged as such.

## Read the book in the app
**Book** (top bar) opens the full reader: chapter and section contents (case quiz ❓/✅, take-home ★, pitfalls ⚠), page-by-page reading with ←/→, zoom and search. The right panel shows what is on the page: figures (click to highlight), the curriculum objectives anchored there, **real-scan tasks** that practise them, the chapter's case quiz (write your answer, then open the book's answer page) and your own notes. **Figures** shows every figure of a chapter cropped from your PDF. The Course map shows how much of each chapter you have opened.

## See every structure (Anatomy labels)
In **Learn** mode (and after you submit in Practice/Assess) press the layers button or open the **Anatomy** tab: every outlined structure on the current slice is drawn — solid outlines are expert labels from the source dataset, dashed outlines are tagged **AI draft by Horalix** (quality-checked, not reviewed by a radiologist; edges can be a few mm off). **Click a structure to see only it**: the viewer jumps to the slice where it is largest and centres it; use ‹ › on the image to step to the next structure and *Show all* to return. Tick *Names on image* for non-overlapping name tags, switch groups (organs, airways & lungs, heart & vessels, bones, muscles, glands) on and off, or tick *On this slice* to list only what you are looking at.

## Anatomy atlas
**Atlas** (top bar) lists every labelled structure on every patient. Search “rib 5”, “L1” or “adrenal”, open a structure and pick a patient: the scan opens in Learn mode with that structure shown alone. *Most completely labelled studies* lists the best whole-anatomy studies (the children's CTs have every organ outlined by experts). The **book anatomy checklist** shows, chapter by chapter, which structures the book expects you to recognise are available on a real scan — and which are still gaps.

## Import the book
On your own computer the book is already installed for local use (`python scripts/book/install_book.py --pdf <file>` copies it to the git-ignored `public/book/`). On another device: Settings → Book → Import PDF. The file is checked against the verified 5th-edition SHA-256 (`0f711fa4…`). Page anchors use a page-by-page map (inserted e-pages such as 2.e1 and 79.e1–e5 are handled). Search builds a local index the first time (text stays in your browser).

## Open your own DICOM
Import → drop a folder, files or a ZIP (ZIPs expanding beyond 1.5 GB or 20,000 files are refused). Files are parsed in the browser, grouped by study/series/orientation and sorted by slice position. Imported studies have no answer key — free reading with self-review — and last for the browser session.

## Add a curated case
1. Add the subject (TCIA collection, PatientID, series UIDs, rationale) to `scripts/data/selection.json`.
2. `python scripts/data/packs.py build <pack>` then `python scripts/data/packs.py validate <pack>` (re-hashes, decodes, re-sorts by IPP, checks every target against its SOPs; writes `docs/data/<pack>-inventory.md`).
3. Author tasks in `scripts/lessons/<pack>.py` (helpers resolve UIDs from `pack.json` and refuse cross-patient or missing references), run it, then `npm test` (validates every pack, lesson and book anchor) and `node scripts/report/content-report.mjs`.

## Review a draft reference
Author → filter *ai draft* → *Inspect in viewer* → if the outline is right, **I reviewed it** (your name, time, note). From then on that target scores your attempts (“Scored vs your reviewed reference”). **Dispute** keeps a note beside the original; source files are never modified. Reviews are part of the progress backup.

## Manage data packs
Settings → Data packs shows what is installed and where it is served from. `python scripts/data/packs.py list` / `fetch <pack>` rebuilds a pack reproducibly with checksums. Raw downloads live outside the repo (`%USERPROFILE%\radiology-data\raw`).

## Back up progress
Progress → Export backup (JSON: attempts, bookmarks, notes, reviews). Import it in another browser or device; newer records win. Reset (with confirmation) clears this browser only.
