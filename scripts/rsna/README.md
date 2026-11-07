# RSNA-ICA: aneurysm model and teaching cases

RSNA Intracranial Aneurysm Detection (RSNA-ICA) Dataset, v2.0, doi:10.1148/dataset.ica.2026, used with permission.
The plan, the licence status and the ship gate (set before training) are in `docs/data/anatomy-expansion-plan.md`,
"RSNA aneurysm round".

## Rules this folder follows
- **No RSNA image, label or derived volume is ever written inside the repository.** Every output goes under
  `RSNA_HOME` (default `C:\Users\kerim\radiology-data\rsna-ica\`). `tests/rsna.test.ts` scans every tracked file.
- **The download link is personal.** It is read from `RSNA_HOME\ACCESS.txt` and is never printed, logged or
  committed.
- **At most 100 MR and 100 CT series are shown**, all of them listed in `server/rsnaShown.ts` (opaque hashes and
  modality only). The server serves no other series, and a test fails at 101 of either kind.
- **Members only.** Teaching-case files live in the private Blob store under `rsna-ica/` and are served by
  `/api/rsna/...` (`server/rsna.ts`) after the membership check.
- **Training waits for the licence text** (plan, Needs Kerim item 8).

## Steps
1. `python scripts/rsna/fetch.py list`: reads the release zip's directory over HTTP range requests and writes the
   member index. The full ~356 GB zip is never downloaded.
2. `python scripts/rsna/fetch.py labels`: copies `dataset.csv`, `dataset_localizers.csv` and the vessel masks to
   `RSNA_HOME\labels\`.
3. `python scripts/rsna/fetch.py series --batch 40`: extracts the next 40 series to `RSNA_HOME\raw\`.
   - Each batch is then cropped to the Circle of Willis as float16 NIfTI, found with our TopCoW vessel model, in
     `RSNA_HOME\crops\`.
   - The raw batch is then deleted. The step refuses to run if it would leave less than 15 GB free.
4. Training and validation scripts, in this order:
   - vessel segmentation fine-tune;
   - the 13-location + presence classifier with the localizer head;
   - patient-grouped 5-fold CV;
   - held-out sites SITE_19–21;
   - external test on Lausanne.

   These are added once the data's actual layout has been checked.
