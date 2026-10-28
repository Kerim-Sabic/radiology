# Anatomy atlas pipeline (→ `public/packs/anatomy-atlas`)

Whole-anatomy outlines for the Learn-mode anatomy layer on every CT series and every frontal chest radiograph of the
image packs (`starter`, `chest-pairs`, `body`, `expansion`, `ct-mri-pairs`, `neuro-msk`, `more-ct-xr`, `pe-cta`, `ct-findings`, `ct-tumors`).

**Every target is an unreviewed AI draft**: `provenance: "ai_draft"`, `review.status: "unreviewed"`,
`completeness: "target_only"`, `layer: "atlas"`, a `category` (bone | organ | vessel | airway | muscle | gland | other)
and a plain anatomical `label` ("Rib 5 left", "L1 vertebra", "Left upper lobe", "Ascending aorta"; "(partially imaged)"
when cut by the scan edge). In the pack, `provenanceDetail.source` is "Horalix" and `method` is "AI draft by Horalix —
automatic segmentation, not reviewed by a radiologist" (owner decision); `provenanceDetail.note` carries the structure's
QC result. The actual tools and versions are documented only here and in `docs/data/anatomy-atlas-report.md`.

## Tools

* CT whole-body: TotalSegmentator (PyPI), task `total` (all 117 classes; licence-free). Licence status of every task is
  read from the tool itself (`TotalSegmentator --list-tasks`, `totalsegmentator.registry.requires_license`); licensed tasks
  are never used.
* CT pulmonary arteries / main bronchi: licence-free TotalSegmentator task `lung_vessels` (airways, lung arteries, lung
  veins as separate classes), ~5 min per chest CT on CPU (`ct_run_lungvessels.py`).
* CT heart chambers: MONAI model-zoo bundle `wholeBody_ct_segmentation` v0.1.9 (SegResNet, 1.5 mm) — bundle licence
  Apache-2.0, training data TotalSegmentator dataset (Zenodo 6802614) CC-BY-4.0, i.e. commercial use allowed with
  attribution (`ct_heart_chambers.py`; contrast CTs only, inference inside the heart box, ~10–25 s per CT on CPU).
* Radiographs: torchxrayvision (PyPI) `xrv.baseline_models.chestx_det.PSPNet` (ChestX-Det, 14 structures).

## Environments (outside OneDrive)

```bash
TS=C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe        # see scripts/vessels/README.md (torch CPU, PyPI)
C:/Users/kerim/AppData/Local/Programs/Python/Python312/python.exe -m venv C:/Users/kerim/radiology-data/venv-xrv
C:/Users/kerim/radiology-data/venv-xrv/Scripts/python.exe -m pip install --index-url https://pypi.org/simple torchxrayvision pydicom python-gdcm scikit-image
XRV=C:/Users/kerim/radiology-data/venv-xrv/Scripts/python.exe
```

Weights come from the libraries' own GitHub releases (TotalSegmentator `v2.0.0-weights`; torchxrayvision
`v1/pspnet_chestxray_best_model_4.pth`, cached in `C:/Users/kerim/radiology-data/xrv-cache`). TotalSegmentator usage
statistics are disabled in `TOTALSEG_HOME_DIR/config.json`.

## Run (from the repo root)

| step | command | notes |
|---|---|---|
| CT-1 | `$TS scripts/atlas/ct_convert.py [case ...]` | every `role: diagnostic` CT → `WORK/<case>/ct.nii.gz` on the original slice grid + `slices.json`; converted cases are skipped |
| CT-2 | `$TS scripts/atlas/ct_run_totalseg.py --body_seg [case ...]` | `--task total --ml --device cpu [--body_seg]`; 5–25 min per CT on CPU. A second parallel queue needs its own `TOTALSEG_HOME_DIR` plus `TOTALSEG_WEIGHTS_PATH=<first home>/nnunet/results` |
| CT-2b | `$TS scripts/atlas/ct_run_lungvessels.py [case ...]` | licence-free lung-vessel task on every CT with heart + lungs (second queue: own `TOTALSEG_HOME_DIR` + shared `TOTALSEG_WEIGHTS_PATH`) |
| CT-2c | `$TS scripts/atlas/ct_heart_chambers.py [case ...]` | heart-chamber model on contrast CTs (needs `pip install monai` in the CT venv and the bundle in `C:/Users/kerim/radiology-data/monai-bundles`, fetched with `monai.bundle.download(name="wholeBody_ct_segmentation", source="github")`) |
| CT-3 | `$TS scripts/atlas/ct_contours.py [--force] [case ...]` | QC rules 0/1/2/4/6, trachea cut at the carina (the airway below it goes to the main bronchi), spine numbering (a level with two bodies, an interior slab or only the arch drops itself, every vertebra below and the matching ribs; ribs that never reach the spine are fragments), pixels contested between a chamber and a vessel left unmarked, "partially imaged" also when a full cross-section touches the scan edge, aorta + colon + pulmonary-artery sub-parts, lobe-wise intrapulmonary arteries, heart minus PA/aorta/SVC, chambers, per-SOP image_px contours |
| check | `$TS scripts/atlas/render_pa.py [--chambers or --veins] case ...` | axial renders at the PA bifurcation / cardiac levels / dense veins → `WORK/<case>/pa_png/`; record findings in `WORK/pa_visual_check.json`, `chamber_visual_check.json`, `vein_visual_check.json` |
| check | `$TS scripts/atlas/point_check.py [--work case] <seriesUid> <sop:structure> ...` | point-in-polygon at a structure's centroid on a given SOP: which outlines contain it (what the viewer's hover reports) |
| check | `$TS scripts/atlas/expert_heart_overlap.py` | share of the AI pulmonary parts lying inside expert (source_manual) heart contours, never modifying them |
| check | `$TS scripts/atlas/render_parts.py case ...` | coronal + sagittal renders of the published aorta / colon parts → `WORK/<case>/parts_png/parts.png`; inspect them and record the result (and any part to drop) in `WORK/parts_visual_check.json` |
| CXR | `PYTHONIOENCODING=utf-8 $XRV scripts/atlas/cxr_segment.py [case ...]` | frontal selection, VOI / MONOCHROME1, pad → 512 → model → exact mapping back, CXR QC |
| pack | `$TS scripts/atlas/write_pack.py [--no-index]` | rule 3 across all CTs, writes `pack.json` + `targets/`, runs `verify_atlas.py`, writes the report, merges the entry into `public/packs/index.json` by id (other packs untouched; `--no-index` to skip) |
| zod | `node --experimental-strip-types --no-warnings scripts/data/zod_check.mjs public/packs/anatomy-atlas public/packs/index.json` | contract check (helper reused unmodified) |

`WORK` = `C:/Users/kerim/radiology-data/work/atlas` (`RADIOLOGY_ATLAS_WORK`). New image packs: add them to
`SOURCE_PACKS` in `common.py` and re-run every step; finished cases are skipped. `lessons.json` in the pack folder is
never written by these scripts.

## QC rules (`qc_rules.py`, applied in `ct_contours.py`, `cxr_segment.py`, `write_pack.py`)

| rule | CT | radiograph |
|---|---|---|
| 0 mapping | NIfTI affine (RAS→LPS) vs DICOM IPP/IOP/PixelSpacing for sampled voxels < 0.5 mm | outline vs upsampled model output Dice ≥ 0.9 |
| 1 fragments | largest 3D component (multipart exceptions: lobes 2, thyroid 2, colon 4, small bowel 8, duodenum 2, portal/splenic 2, pulmonary veins 4; costal cartilages all parts ≥ 0.5 ml); extra parts ≥ 5 %; rings/holes < 10 mm² dropped; < 0.3 ml or < 2 slices → drop | largest region (diaphragm 2), rings < 0.2 % and structures < 0.1 % of the image dropped |
| 2 density | median HU: ribs/vertebrae/sternum/sacrum ≥ 100, humerus/femur ≥ 100, scapula/clavicle/hip/skull ≥ 150, lung lobes/trachea/bronchi ≤ −300, soft tissue, muscle, myocardium −50…250, SVC / brachiocephalic veins / pulmonary trunk + arteries / cardiac blood pool −50…3000 with contrast (−50…250 without), intrapulmonary arteries −300…3000 (−300…250), other vessels/kidneys/heart −50…250 (≤ 450 with contrast); hollow organs not checked | — |
| 3 coverage | reaches the first/last slice or the image edge → "(partially imaged)"; dropped if < 20 % of the typical (median complete adult) volume; complete structures with ≥ 3 references dropped if < 20 % of typical (no upper limit — enlargement is often real pathology) | — |
| 4 order | left/right pairs per slice + 3D; ribs per slice vs midline; lateral structures vs midline; a left/right structure with no side verification is dropped; vertebrae C1→S1 craniocaudal; aortic, pulmonary-artery and colon part order (one failed part drops the whole split); visual check of parts | left/right pairs; heart left of spine; left/right structures dropped when the header has no PatientOrientation |
| 6 chambers | contrast + opacified blood pool gate; one component; inside the heart; volume; RV most anterior, LA most posterior and in front of oesophagus/descending aorta and joined by the LAA, RA right of LA and touching SVC/IVC, LV left of RV/RA with myocardium wrapping it; overlap ≤ 5 % | — |
| 5 radiograph | — | centroid inside the lung box + 25 %; polarity guard (lungs darker than spine); side from PatientOrientation, else noted as not verifiable |

## Sub-parts (`subparts.py`)

* Aorta: per slice, two components ≥ 20 mm² → anterior+right = ascending, other = descending; single-component slices
  above the zone = arch, below = descending, split thoracic/abdominal at the inferior endplate of T12 (else lowest lung
  slice). Without a two-component zone only the abdominal aorta below T12 is labelled.
* Colon: only if the whole colon is inside the field of view, hip bones and sacrum exist, the largest component holds
  ≥ 85 %, and the 3D skeleton has one dominant path (≥ 60 % of skeleton voxels); walked from the caecum: hepatic
  flexure (highest right point), splenic flexure (highest left point), iliac crest, S3 level. Otherwise only "Colon".

## Pulmonary arteries and heart

* Mediastinal pulmonary arteries = lung-artery mask outside the lung lobes (up to the hila), split by a 1.5 mm skeleton:
  most anterior end = root, most right / left points = hilar ends, shared path = trunk, last shared node = bifurcation.
* Intrapulmonary arteries: arterial voxels inside the lungs, connected to the mediastinal arteries (1-voxel gaps bridged),
  assigned to the lobe they lie in → "<Lobe> arteries (lobar and segmental)". No interlobar or segmental names.
* Main bronchi: airway pieces outside the trachea and lungs that start within 15 mm below the carina, one per side.
* Heart: the whole mediastinal pulmonary-artery mask, ascending aorta and SVC (dilated one voxel) are subtracted before
  tracing; expert heart contours in the image packs are never modified.

## Conventions

* `image_px` = `[col, row]`, (0,0) = centre of the first pixel. CT outlines: `find_contours(mask.T, 0.5)` on each
  original slice (1-pixel zero padding), Douglas–Peucker 1.0 px; pulmonary trunk / arteries / lobe arteries 0.5 px;
  radiographs 0.5 px. Pack budget 80 MB. One target file per structure per series; minified JSON.
* Ids `at-<case>-<structure>`; classIds `anatomy:<name>` (TotalSegmentator names; parts `aorta_ascending`, `aorta_arch`,
  `aorta_descending_thoracic`, `aorta_abdominal`, `colon_ascending`, `colon_transverse`, `colon_descending`,
  `colon_sigmoid`, `rectum`; radiograph classes `lung_left`, `clavicula_left`, `scapula_left`, `hilum_left`, `heart`,
  `aorta`, `diaphragm`, `mediastinum`, `trachea`, `spine`).
