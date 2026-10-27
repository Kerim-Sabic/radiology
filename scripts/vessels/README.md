# Vessel drafts pipeline (TotalSegmentator → `public/packs/vessel-drafts`)

Offline tooling that proposes outlines of the five great vessels of the superior mediastinum (right and left
brachiocephalic veins, brachiocephalic trunk, left common carotid, left subclavian) plus context structures, and
derives five-vessel / aortic-arch slice intervals, on the contrast-enhanced chest CTs already in the image packs.

**Everything it produces is an unreviewed AI draft**: provenance `ai_draft`, `review.status = "unreviewed"`,
completeness `target_only`. Nothing here claims human review. Results and QC numbers:
`docs/data/vessel-drafts-report.md` (generated).

## Environment (one-off)

Kept outside OneDrive and outside the repo:

```bash
# Python 3.12, isolated venv, packages from PyPI only (the Windows torch wheel on PyPI is CPU-only)
C:/Users/kerim/AppData/Local/Programs/Python/Python312/python.exe -m venv C:/Users/kerim/radiology-data/venv-ts
C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe -m pip install --upgrade pip
C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe -m pip install --index-url https://pypi.org/simple TotalSegmentator pydicom scikit-image
```

Versions used for the committed pack: TotalSegmentator 2.18.0, nnU-Net 2.8.1, torch 2.14.1+cpu, pydicom 3.0.2
(+ python-gdcm 3.2.6 for JPEG-LS), SimpleITK 2.5.6, nibabel 5.4.2, scikit-image 0.26.0, scipy 1.18.1.

`run_totalseg.py` sets `TOTALSEG_HOME_DIR=C:/Users/kerim/radiology-data/totalseg-home` and writes `config.json` there
with `"send_usage_stats": false`. On first use TotalSegmentator downloads its own weights from
`https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/` (task `total` is an open task, no
licence key). Paths can be overridden with `RADIOLOGY_DATA_DIR`, `RADIOLOGY_VESSELS_WORK`, `RADIOLOGY_TS_VENV`,
`TOTALSEG_HOME_DIR`.

## Run

From the repo root, always with the venv interpreter (`PY=C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe`):

| step | command | what it does |
|---|---|---|
| 1 | `$PY scripts/vessels/convert_dicom_to_nifti.py [case ...]` | screens every diagnostic CT in the `chest-pairs` and `body` packs (contrast from DICOM headers, original axial, uniform spacing, no tilt) and writes `ct.nii.gz` on the ORIGINAL slice grid + `slices.json` (slice k → SOP UID) |
| 2 | `$PY scripts/vessels/run_totalseg.py [--fast] [case ...]` | TotalSegmentator `--task total --roi_subset <classes> --device cpu --report ...` (full-resolution models unless `--fast`) |
| 3 | `$PY scripts/vessels/masks_to_contours.py [--fast] [case ...]` | masks → per-slice `image_px` contours; NIfTI-affine vs DICOM-geometry alignment check |
| 4 | `$PY scripts/vessels/derive_levels_qc.py [--fast] [--png] [case ...]` | contrast (aorta HU), laterality, coverage, five-vessel and aortic-arch intervals; `--png` writes overlay PNGs to the scratch folder |
| 5 | `$PY scripts/vessels/write_pack.py [--fast]` | writes `public/packs/vessel-drafts/pack.json` + `targets/*.json`, runs `verify_targets.py` on them, writes `docs/data/vessel-drafts-report.md`, prints the `index.json` entry |
| 6 | `node --experimental-strip-types --no-warnings scripts/data/zod_check.mjs public/packs/vessel-drafts` | zod contract check of the manifest and every target file (helper reused unmodified) |

`verify_targets.py` can also be run on its own (exit code 1 on failure). Scratch outputs live in
`C:/Users/kerim/radiology-data/work/vessels/<case>/` (`ct.nii.gz`, `seg/`, `contours/`, `structures.json`, `qc.json`,
`run.json`, `ts_report.json`, `qc_png/`). Case ids: `ar-<COVID-19-AR number>`, `lidc-<LIDC number>`, otherwise a slug.

`write_pack.py` never touches `public/packs/vessel-drafts/lessons.json` (authored elsewhere) and does not edit
`public/packs/index.json`; add the printed entry there by hand or via the pack tooling.

## Coordinate handling

* DICOM → NIfTI: SimpleITK image with index (i, j, k) = (column, row, slice sorted by IPP·n), origin = IPP of the
  first sorted slice, spacing = (PixelSpacing[1], PixelSpacing[0], step), direction = (IOP row cosine, IOP column
  cosine, n). ITK is LPS internally; its NIfTI writer stores RAS (x, y negated). Checked by nibabel read-back:
  `diag(-1,-1,1,1) @ affine_RAS == affine_LPS`.
* Masks: TotalSegmentator returns masks on the input grid; shape + affine are compared with `ct.nii.gz` and a mismatch
  would trigger nearest-neighbour resampling (recorded per class).
* Contours: NIfTI slice `mask[:, :, k].T` is a (row, col) image of SOP `slices[k]`; `skimage.measure.find_contours`
  at 0.5 on a 1-pixel zero-padded copy gives (row, col) in pixel-centre units → stored as `[col, row]`
  (`image_px`, (0,0) = centre of the first pixel). Rings are closed and simplified with
  `approximate_polygon(0.35 px)` (below half a pixel, so the rasterised pixel set is unchanged — Dice 1.0 in
  verification). Components < 4 px are dropped; enclosed gaps become `holes`.
* `slice_interval`: `normal` = unit IOP row × column cosine, `range` = [min, max] of IPP·normal of the listed SOPs.

## Rules (see docstrings in `derive_levels_qc.py`)

* "present" on a slice = ≥ 10 mm² of mask after speck removal.
* Laterality: on every slice where both are present, centroid LPS x of the left structure > right structure for
  (L BCV, R BCV), (L subclavian, trunk), (L carotid, trunk), (L/R carotids), (L/R subclavians) and the two cross pairs;
  any wrong slice drops both structures of the pair.
* Arch top = most superior slice with any aorta mask. Five-vessel level = contiguous run, nearest the arch, of slices
  strictly above the arch top on which all five structures are present as distinct labels (wall contact recorded, not
  excluded). Coverage requires ≥ 15 mm above the arch top and ≥ 1 such slice.
* Aortic-arch level (only if robust): from the top slice with ≥ 10 mm² aorta down to just before the aorta splits into
  two components ≥ 100 mm² (ascending + descending); needs a slice spanning the tracheal midline and ≤ 45 mm length.
