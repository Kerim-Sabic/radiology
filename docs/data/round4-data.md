# Round 4: more patients from the open sources already in use

Five packs added on 29 October 2026 to raise the commercial catalogue from 108 to 364 patients (346 to 1043 tasks). Every new
patient is a different person from every earlier pack, every graded answer comes from the source dataset's expert annotation or
clinical data (box, outline, mask, BI-RADS descriptors, pathology or follow-up, AO/OTA code), and nothing was marked by us.
Fetch: `scripts/data/external_r4.py`; build: `scripts/data/build_r4.py` (the same code path as `build_external.py`); lessons:
`scripts/lessons/round4.py` (same task designs and teaching notes as `scripts/lessons/conditions.py`); QC overlays:
`scripts/data/qc_render.py`. All five pass `validate_pack.py` (files re-read, re-hashed, decoded, every target mapped to a real
SOP within the image bounds) and the zod contract; `tests/round4Content.test.ts` re-derives every graded answer from pack.json.

| pack | modality | patients | tasks | reference targets | size |
|---|---|---|---|---|---|
| `us-breast-2` | US | 98 | 392 (392 graded) | 98 | 18.5 MB (296 files, largest 1.51 MB) |
| `stroke-mri-2` | MR | 50 | 106 (106 graded) | 100 | 38.9 MB (7442 files, largest 3.17 MB) |
| `cxr-findings-2` | DX | 67 | 106 (106 graded) | 75 | 28.5 MB (211 files, largest 0.45 MB) |
| `peds-wrist-2` | DX | 30 | 60 (60 graded) | 60 | 45.4 MB (182 files, largest 1.63 MB) |
| `mammo-cbis-2` | MG | 11 | 33 (33 graded) | 22 | 58.6 MB (68 files, largest 5.22 MB) |
| **total** | | **256** | **697** | | **189.9 MB** (8199 files) |

Neutral titles are `Patient <code> · <scan>` with codes EA to NV (codes before EA belong to the earlier packs). Study and series
descriptions, role notes and display notes name neither the dataset nor the finding (checked at build time by `build_r4.LEAK`).

## Sources and licences (checked 29 October 2026)

| source | licence | where checked | access |
|---|---|---|---|
| Breast-Lesions-USG (BrEaST), TCIA, doi:10.7937/9wkk-q141 | CC BY 4.0 | https://www.cancerimagingarchive.net/collection/breast-lesions-usg/ lists "CC BY 4.0" (https://creativecommons.org/licenses/by/4.0/) for both files | images-and-masks ZIP and clinical XLSX linked on the page; no login, registration or agreement (TCIA data usage policy: cite) |
| ISLES 2022, Zenodo record 7153326, doi:10.5281/zenodo.7153326 | CC BY 4.0 | Zenodo API https://zenodo.org/api/records/7153326: `license.id = cc-by-4.0`, `access_right = open` | ISLES-2022.zip read member by member over HTTP Range; no login |
| NIH ChestX-ray14, NIH Clinical Center, https://nihcc.app.box.com/v/ChestXray-NIHCC | NIH: unrestricted use (link the site, acknowledge the NIH Clinical Center, cite CVPR 2017) | dataset FAQ (FAQ_CHESTXRAY.pdf on the official share), Q04: "The usage of the data set is unrestricted." | boxes and PNGs read from the unmodified ZIPs on the public Hugging Face mirror `alkzar90/NIH-Chest-X-ray-dataset` (official archive links 404), as in round 1; no login |
| GRAZPEDWRI-DX, figshare doi:10.6084/m9.figshare.14825193.v2 | CC BY 4.0 | figshare API https://api.figshare.com/v2/articles/14825193: `license.name = CC BY 4.0`, `is_embargoed = false` | dataset.csv, annotations and images_partN.zip (HTTP Range) from figshare; no login |
| CBIS-DDSM, TCIA, doi:10.7937/K9/TCIA.2016.7O02S9CY | CC BY 3.0 | https://www.cancerimagingarchive.net/collection/cbis-ddsm/ lists "CC BY 3.0"; every downloaded series row from the NBIA API carries `LicenseName: Creative Commons Attribution 3.0 Unported License` | NBIA REST API v1 `getImage`, anonymous |

Each pack's `sources` entry holds the URL, DOI, licence text, licence URL, citation and access note. `scripts/build/commercialContent.ts`
keeps all five (none is non-commercial); `npm run build` reports the same 6 excluded RICORD subjects as before.

## Selection, review and every dropped case

### `us-breast-2`

- **Rule:** Breast-Lesions-USG cases not used before, benign or malignant (not normal), one lesion mask per image (no 'other' masks), proven by biopsy or follow-up, not a scar/implant/duct finding or a risk lesion (LCIS, ALH); stratified 45 malignant (biopsy), 35 benign (biopsy), 20 benign (follow-up), round-robin over diagnoses.
- **Review:** All 99 built cases drawn with the radiologist's outline (full image, zoom for the smallest) and checked by eye. Kept: 98 patients.
- **Dropped (2):**
  - radiologist's interpretation 'simple cyst', but recorded as irregular with no posterior enhancement, which does not meet the simple-cyst criteria the lessons teach; ambiguous (1): 57
  - pathology 'simple cyst' disagrees with the radiologist's description (complex cyst, heterogeneous echoes); ambiguous (1): 142
- **Kept by outcome:** malignant (biopsy) 45, benign (biopsy) 34, benign (follow-up) 19.

### `stroke-mri-2`

- **Rule:** ISLES 2022 cases not used before with a lesion of at least 2 ml on the 2 mm DWI grid (131 of 250), 50 taken at even steps across the range of lesion volumes.
- **Review:** All 50 DWI and 50 ADC outlines drawn on the slice with the largest outlined area and checked by eye against the bright DWI signal. ADC units differ between centres (mm2/s, 10^-3 and 10^-6 mm2/s): the unit is read from the brain's median ADC and every case is stored in 10^-6 mm2/s. The ADC question is only asked where the median ADC in the mask is at most 0.8 x the rest of the brain; the side question only where at least 99% of the mask lies on one side of the local brain midline and its median distance from it is 10 mm or more. Kept: 50 patients.
- **Dropped:** none after review.

### `cxr-findings-2`

- **Rule:** NIH ChestX-ray14 PA films of adults (18-90) with a radiologist box whose label is also in the report labels, one film per patient, patients of cxr-findings excluded. Pass A ranked like round 1 (fewest other labels, box area capped), 104 candidates; pass B ranked by box area (up to a quarter of the film), 92 candidates.
- **Review:** Every one of the 196 candidates drawn with its boxes (full film and zoom; contrast-equalised crops for subtle pneumothoraces, effusions and nodules) and kept only where the boxed finding is clearly visible: 67 kept. Kept: 67 patients.
- **Dropped (129):**
  - boxed finding not clearly visible on review of the 1024 px film (full view and zoom); too subtle to teach from here (87): 00000147_001, 00001688_000, 00002176_005, 00002350_001, 00002578_000, 00002583_014, 00003391_001, 00003948_001, 00005089_014, 00005567_025, 00005869_001, 00006851_034, 00007034_016, 00007124_008, 00008841_044, 00009166_004, 00009403_006, 00009437_008, 00009669_003, 00010071_008, 00010936_016, 00011450_000, 00011827_003, 00012174_000, 00012592_005, 00013674_000, 00013751_003, 00014149_018, 00014197_010, 00014346_010, 00014731_028, 00014795_002, 00014822_039, 00015141_002, 00016064_010, 00016291_002, 00016417_008, 00016429_015, 00016937_014, 00017137_016, 00017670_005, 00017747_008, 00018253_017, 00018366_010, 00018984_000, 00019766_023, 00019892_003, 00019917_004, 00020065_008, 00020146_005, 00020774_000, 00020845_002, 00021374_000, 00021381_013, 00021748_000, 00021896_003, 00022572_087, 00022611_001, 00023075_033, 00023156_001, 00023178_002, 00023283_019, 00025228_005, 00025368_018, 00025529_018, 00025707_015, 00025962_000, 00026261_001, 00026319_000, 00026392_005, 00026695_000, 00027817_001, 00027937_004, 00028012_001, 00028027_000, 00028628_008, 00028698_001, 00028861_009, 00028924_009, 00029075_013, 00029105_015, 00029532_005, 00029807_003, 00030039_008, 00030434_000, 00030634_000, 00030635_001
  - the box covers most of a lung or spans both lungs: not a focal finding to locate (17): 00002980_000, 00003803_010, 00003945_004, 00006821_002, 00008814_010, 00010277_000, 00010625_014, 00013911_021, 00014607_007, 00015069_001, 00018496_006, 00020857_008, 00022883_002, 00027028_017, 00027833_022, 00028208_005, 00029464_015
  - heart size borderline by eye (cardiothoracic ratio near 0.5): not a clear example of cardiomegaly (7): 00002704_029, 00004342_020, 00004461_000, 00005827_000, 00006912_007, 00010381_000, 00027464_033
  - rejected in round 1 for the same reason (pneumonia too faint to teach with), see external.py (3): 00007444_003, 00008727_009, 00013272_005
  - very low-contrast film: heart borders cannot be judged (2): 00023176_017, 00030279_000
  - pneumothorax box at the left base over the hemidiaphragm and stomach bubble; no pleural line identifiable (1): 00014083_023
  - rejected in round 1 for the same reason (effusion box on the lateral wall, no visible fluid), see external.py (1): 00020751_003
  - not a standard upright PA film (patient imaged lying on the side) although labelled PA (1): 00009683_005
  - rejected in round 1 for the same reason (mass box over half the lower chest), see external.py (1): 00018623_001
  - mass box over the dome of the right hemidiaphragm: the mass cannot be told from the diaphragm (1): 00027697_001
  - rejected in round 1 for the same reason (nodule box over the breast/nipple shadow), see external.py (1): 00018814_000
  - rejected in round 1 for the same reason (retrocardiac, not visible at this size), see external.py (1): 00016487_002
  - mass box over the upper mediastinum: no discrete lung mass identifiable (1): 00017257_001
  - several overlapping boxes (infiltrate, mass, pneumothorax) on a complex film (1): 00012376_010
  - mass and infiltrate boxes overlap on the same area (1): 00021201_010
  - mass box behind the heart over a rounded opacity with an air-fluid level (could be a hiatal hernia): ambiguous (1): 00014551_010
  - unexplained air-fluid level at the left base next to the boxed effusion; too complex for a located-finding case (1): 00011269_019
  - very low-contrast film with several overlapping boxes (1): 00029808_003
- **Kept by finding:** Cardiomegaly 17, Pneumonia 11, Pleural effusion 10, Pneumothorax 8, Atelectasis 7, Lung mass 7, Lung nodule 7.

### `peds-wrist-2`

- **Rule:** GRAZPEDWRI-DX initial-trauma studies with one frontal and one lateral image, the same single distal-radius AO/OTA code on both (23r-E/2.1, 23r-M/2.1 or 23r-M/3.1), one fracture box per image, no cast, metal, osteopenia or 'diagnosis uncertain'; 10 per code evenly spaced over the patient numbers. Salter-Harris I (23r-E/1, 9 studies) left out as too subtle to grade.
- **Review:** All 60 radiographs drawn with the fracture box and checked by eye: every box lies on the distal radius on both views. Kept: 30 patients.
- **Dropped:** none after review.
- **Kept by type:** Salter-Harris II fracture of the distal radius 10, Incomplete (torus/buckle or greenstick) fracture of the distal radius 10, Complete metaphyseal fracture of the distal radius 10.

### `mammo-cbis-2`

- **Rule:** CBIS-DDSM training-set breasts with CC and MLO, a single abnormality (id 1 only) with the same descriptors on both views, subtlety 4-5; 4 irregular spiculated malignant masses, 3 oval circumscribed benign masses, 2 pleomorphic clustered and 1 fine linear branching malignant calcifications, 1 lucent-centered and 1 coarse benign calcifications; women of mammo-cbis and the films rejected in round 3 excluded.
- **Review:** Chest-wall side of every film checked against the recorded laterality (build_mammo asserts it), then all 22 kept outlines drawn on the films and checked by eye. Kept: 11 patients.
- **Dropped (1):**
  - right breast, but the chest wall is on the left edge of both films (mirrored scan?): the orientation cannot be trusted, so the hanging would be wrong (1): P_00023

## Tasks

- `cxr-findings-2`: find the finding (radiologist box; other boxes on the film are optional targets) and, where no other offered
  finding is among the report labels, name the main finding (39 of 67).
- `us-breast-2`: find the lesion (radiologist outline), shape and margin, echo pattern and posterior features (the radiologist's
  BI-RADS descriptors), benign or malignant (biopsy, or benign on follow-up).
- `stroke-mri-2`: find the restricted diffusion (expert-approved mask on DWI, ADC optional); ADC dark? only where the median ADC
  in the mask is at most 0.8 x the rest of the brain (36 of 50); which side? only where at least 99% of the mask is on one side
  of the local brain midline, 10 mm or more from it (20 of 50).
- `peds-wrist-2`: find the fracture on both views (radiologist boxes) and its type (AO/OTA code).
- `mammo-cbis-2`: find the finding on both views (outline), margin (masses) or calcification form, and pathology.

## New case ids (for case-of-the-week releases)

### `us-breast-2` (98)

| case id | neutral title | teaches |
|---|---|---|
| `us-breast-case005` | Patient EA · Breast ultrasound | Encapsulated papillary carcinoma with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case008` | Patient EB · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case010` | Patient EC · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case011` | Patient ED · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case012` | Patient EE · Breast ultrasound | Invasive carcinoma of no special type (NST) with invasive micropapillary carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case026` | Patient EF · Breast ultrasound | Tubular carcinoma with cribriform carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case027` | Patient EG · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case032` | Patient EH · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case034` | Patient EI · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case035` | Patient EJ · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case046` | Patient EK · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case050` | Patient EL · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case053` | Patient EM · Breast ultrasound | Invasive lobular carcinoma with lobular carcinoma in situ (LCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case055` | Patient EN · Breast ultrasound | Invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case058` | Patient EO · Breast ultrasound | Ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case063` | Patient EP · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case067` | Patient EQ · Breast ultrasound | Cribriform carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case072` | Patient ER · Breast ultrasound | Ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case075` | Patient ES · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case079` | Patient ET · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case082` | Patient EU · Breast ultrasound | Mucinous carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case087` | Patient EV · Breast ultrasound | Ductal carcinoma in situ (DCIS) with invasive carcinoma of no special type (NST) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case088` | Patient EW · Breast ultrasound | Tubular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case094` | Patient EX · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case101` | Patient EY · Breast ultrasound | Mucinous carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case102` | Patient EZ · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case106` | Patient FA · Breast ultrasound | Cribriform carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case109` | Patient FB · Breast ultrasound | Invasive micropapillary carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case111` | Patient FC · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case113` | Patient FD · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case117` | Patient FE · Breast ultrasound | Lymphoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case125` | Patient FF · Breast ultrasound | Invasive lobular carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case132` | Patient FG · Breast ultrasound | Ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case133` | Patient FH · Breast ultrasound | Invasive micropapillary carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case150` | Patient FI · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case172` | Patient FJ · Breast ultrasound | Invasive carcinoma of no special type (NST) with sebaceous carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case176` | Patient FK · Breast ultrasound | Metaplastic carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case199` | Patient FL · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case206` | Patient FM · Breast ultrasound | Mucinous carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case212` | Patient FN · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case225` | Patient FO · Breast ultrasound | Invasive carcinoma of no special type (NST) with apocrine carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case230` | Patient FP · Breast ultrasound | Invasive carcinoma of no special type (NST) with mucinous carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case249` | Patient FQ · Breast ultrasound | Invasive papillary carcinoma with encapsulated papillary carcinoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case254` | Patient FR · Breast ultrasound | Invasive carcinoma of no special type (NST) with ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case255` | Patient FS · Breast ultrasound | Ductal carcinoma in situ (DCIS) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case002` | Patient FT · Breast ultrasound | Intramammary lymph node on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case006` | Patient FU · Breast ultrasound | Fibrosclerosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case009` | Patient FV · Breast ultrasound | Fibrosclerosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case014` | Patient FW · Breast ultrasound | Fibrosclerosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case016` | Patient FX · Breast ultrasound | Usual ductal hyperplasia (UDH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case018` | Patient FY · Breast ultrasound | Fibroadenoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case019` | Patient FZ · Breast ultrasound | Intraductal papilloma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case021` | Patient GA · Breast ultrasound | Fibroadenoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case023` | Patient GB · Breast ultrasound | Benign mammary dysplasia on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case024` | Patient GC · Breast ultrasound | Fibroadenoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case031` | Patient GD · Breast ultrasound | Lactating adenoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case037` | Patient GE · Breast ultrasound | Fibroadenoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case041` | Patient GF · Breast ultrasound | Benign mammary dysplasia on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case042` | Patient GG · Breast ultrasound | Intraductal papilloma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case044` | Patient GH · Breast ultrasound | Benign mammary dysplasia on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case047` | Patient GI · Breast ultrasound | Pseudoangiomatous stromal hyperplasia (PASH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case051` | Patient GJ · Breast ultrasound | Complex sclerosing lesion on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case056` | Patient GK · Breast ultrasound | Phyllodes tumor on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case069` | Patient GL · Breast ultrasound | Benign mammary dysplasia on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case071` | Patient GM · Breast ultrasound | Hamartoma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case077` | Patient GN · Breast ultrasound | Fibroadenoma with phyllodes tumor on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case078` | Patient GO · Breast ultrasound | Phyllodes tumor on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case081` | Patient GP · Breast ultrasound | Fibrocystic change on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case093` | Patient GQ · Breast ultrasound | Pseudoangiomatous stromal hyperplasia (PASH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case115` | Patient GR · Breast ultrasound | Fat necrosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case119` | Patient GS · Breast ultrasound | Usual ductal hyperplasia (UDH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case120` | Patient GT · Breast ultrasound | Intraductal papilloma with usual ductal hyperplasia (UDH) with adenosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case129` | Patient GU · Breast ultrasound | Usual ductal hyperplasia (UDH) with fibrosclerosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case143` | Patient GV · Breast ultrasound | Intraductal papilloma on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case162` | Patient GW · Breast ultrasound | Mastitis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case168` | Patient GX · Breast ultrasound | Usual ductal hyperplasia (UDH) with fibrocystic change on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case179` | Patient GY · Breast ultrasound | Pseudoangiomatous stromal hyperplasia (PASH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case182` | Patient GZ · Breast ultrasound | Benign mammary dysplasia with usual ductal hyperplasia (UDH) on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case229` | Patient HA · Breast ultrasound | Fibroadenosis on breast ultrasound (biopsy-proven; radiologist outline) |
| `us-breast-case004` | Patient HB · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case028` | Patient HC · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case029` | Patient HD · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case030` | Patient HE · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case052` | Patient HF · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case065` | Patient HG · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case091` | Patient HH · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case096` | Patient HI · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case097` | Patient HJ · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case108` | Patient HK · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case118` | Patient HL · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case136` | Patient HM · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case167` | Patient HN · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case175` | Patient HO · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case196` | Patient HP · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case216` | Patient HQ · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case222` | Patient HR · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case235` | Patient HS · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |
| `us-breast-case240` | Patient HT · Breast ultrasound | Benign breast lesion on ultrasound (stable on follow-up; radiologist outline) |

### `stroke-mri-2` (50)

| case id | neutral title | teaches |
|---|---|---|
| `mr-diffusion-0004` | Patient HU · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0075` | Patient HV · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0142` | Patient HW · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0214` | Patient HX · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0051` | Patient HY · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0124` | Patient HZ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0058` | Patient IA · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0157` | Patient IB · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0068` | Patient IC · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0126` | Patient ID · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0108` | Patient IE · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0094` | Patient IF · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0145` | Patient IG · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0041` | Patient IH · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0163` | Patient II · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0172` | Patient IJ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0063` | Patient IK · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0114` | Patient IL · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0027` | Patient IM · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0242` | Patient IN · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0097` | Patient IO · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0029` | Patient IP · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0110` | Patient IQ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, small lesion (expert-approved lesion mask) |
| `mr-diffusion-0040` | Patient IR · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0235` | Patient IS · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0218` | Patient IT · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0156` | Patient IU · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0178` | Patient IV · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0017` | Patient IW · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0021` | Patient IX · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0247` | Patient IY · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0180` | Patient IZ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0055` | Patient JA · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0179` | Patient JB · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0120` | Patient JC · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0043` | Patient JD · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0231` | Patient JE · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0125` | Patient JF · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0107` | Patient JG · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0086` | Patient JH · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0217` | Patient JI · MRI brain, diffusion | Ischemic stroke on diffusion MRI, moderate lesion (expert-approved lesion mask) |
| `mr-diffusion-0211` | Patient JJ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0019` | Patient JK · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0104` | Patient JL · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0123` | Patient JM · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0083` | Patient JN · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0081` | Patient JO · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0140` | Patient JP · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0062` | Patient JQ · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |
| `mr-diffusion-0023` | Patient JR · MRI brain, diffusion | Ischemic stroke on diffusion MRI, large lesion (expert-approved lesion mask) |

### `cxr-findings-2` (67)

| case id | neutral title | teaches |
|---|---|---|
| `cxr-00018055-005` | Patient JS · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00020318-022` | Patient JT · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00021782-028` | Patient JU · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00025954-025` | Patient JV · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00028876-027` | Patient JW · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00021181-002` | Patient JX · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00014015-003` | Patient JY · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00026136-002` | Patient JZ · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00020810-003` | Patient KA · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00018762-002` | Patient KB · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00012291-008` | Patient KC · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00009619-000` | Patient KD · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00010481-021` | Patient KE · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00016490-011` | Patient KF · Chest radiograph PA | Atelectasis on a PA chest radiograph (radiologist box) |
| `cxr-00001369-000` | Patient KG · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00004344-013` | Patient KH · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00004534-001` | Patient KI · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00005532-000` | Patient KJ · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00007043-000` | Patient KK · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00008399-007` | Patient KL · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00009745-000` | Patient KM · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00011322-002` | Patient KN · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00018101-012` | Patient KO · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00012270-005` | Patient KP · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00010815-006` | Patient KQ · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00022726-002` | Patient KR · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00012892-010` | Patient KS · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00001555-002` | Patient KT · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00020393-001` | Patient KU · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00013951-001` | Patient KV · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00013885-000` | Patient KW · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00010103-014` | Patient KX · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00015583-000` | Patient KY · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00010610-003` | Patient KZ · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00011583-000` | Patient LA · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00013391-005` | Patient LB · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00007471-003` | Patient LC · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00019124-006` | Patient LD · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00027278-007` | Patient LE · Chest radiograph PA | Pneumothorax on a PA chest radiograph (radiologist box) |
| `cxr-00015078-013` | Patient LF · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00026753-008` | Patient LG · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00014738-000` | Patient LH · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00003072-028` | Patient LI · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00027875-005` | Patient LJ · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00023093-007` | Patient LK · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00020405-041` | Patient LL · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00020000-000` | Patient LM · Chest radiograph PA | Pleural effusion on a PA chest radiograph (radiologist box) |
| `cxr-00000756-001` | Patient LN · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00016414-000` | Patient LO · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00021443-000` | Patient LP · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00018693-004` | Patient LQ · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00012686-003` | Patient LR · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00022215-012` | Patient LS · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00019861-010` | Patient LT · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00008339-010` | Patient LU · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00009705-000` | Patient LV · Chest radiograph PA | Cardiomegaly on a PA chest radiograph (radiologist box) |
| `cxr-00021179-011` | Patient LW · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00020124-003` | Patient LX · Chest radiograph PA | Lung mass on a PA chest radiograph (radiologist box) |
| `cxr-00004911-018` | Patient LY · Chest radiograph PA | Lung nodule on a PA chest radiograph (radiologist box) |
| `cxr-00017952-008` | Patient LZ · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00021818-026` | Patient MA · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00012576-004` | Patient MB · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00003064-035` | Patient MC · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00015090-006` | Patient MD · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00009507-004` | Patient ME · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00021670-004` | Patient MF · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |
| `cxr-00011136-002` | Patient MG · Chest radiograph PA | Pneumonia on a PA chest radiograph (radiologist box) |

### `peds-wrist-2` (30)

| case id | neutral title | teaches |
|---|---|---|
| `xr-wrist-child-0040` | Patient MH · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-0646` | Patient MI · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-1789` | Patient MJ · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-2262` | Patient MK · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-2813` | Patient ML · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-3391` | Patient MM · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4206` | Patient MN · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4537` | Patient MO · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-5647` | Patient MP · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-5980` | Patient MQ · Wrist radiographs, child | Salter-Harris II fracture of the distal radius (radiologist box) |
| `xr-wrist-child-0006` | Patient MR · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-0835` | Patient MS · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-1398` | Patient MT · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-2161` | Patient MU · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-2848` | Patient MV · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-3386` | Patient MW · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4026` | Patient MX · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4721` | Patient MY · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-5393` | Patient MZ · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-6079` | Patient NA · Wrist radiographs, child | Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box) |
| `xr-wrist-child-0177` | Patient NB · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-1241` | Patient NC · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-1668` | Patient ND · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-2157` | Patient NE · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-3065` | Patient NF · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-3582` | Patient NG · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4169` | Patient NH · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-4851` | Patient NI · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-5382` | Patient NJ · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |
| `xr-wrist-child-6093` | Patient NK · Wrist radiographs, child | Complete metaphyseal fracture of the distal radius (radiologist box) |

### `mammo-cbis-2` (11)

| case id | neutral title | teaches |
|---|---|---|
| `mg-p00732` | Patient NL · Mammogram, left breast, CC and MLO | Mass on CC and MLO mammograms (malignant at pathology; mass outline) |
| `mg-p01356` | Patient NM · Mammogram, left breast, CC and MLO | Mass on CC and MLO mammograms (malignant at pathology; mass outline) |
| `mg-p01780` | Patient NN · Mammogram, left breast, CC and MLO | Mass on CC and MLO mammograms (malignant at pathology; mass outline) |
| `mg-p00018` | Patient NO · Mammogram, right breast, CC and MLO | Mass on CC and MLO mammograms (benign at pathology; mass outline) |
| `mg-p00781` | Patient NP · Mammogram, right breast, CC and MLO | Mass on CC and MLO mammograms (benign at pathology; mass outline) |
| `mg-p01739` | Patient NQ · Mammogram, right breast, CC and MLO | Mass on CC and MLO mammograms (benign at pathology; mass outline) |
| `mg-p00014` | Patient NR · Mammogram, left breast, CC and MLO | Calcifications on CC and MLO mammograms (malignant at pathology; DDSM region outline) |
| `mg-p02489` | Patient NS · Mammogram, right breast, CC and MLO | Calcifications on CC and MLO mammograms (malignant at pathology; DDSM region outline) |
| `mg-p00992` | Patient NT · Mammogram, right breast, CC and MLO | Calcifications on CC and MLO mammograms (malignant at pathology; DDSM region outline) |
| `mg-p00506` | Patient NU · Mammogram, right breast, CC and MLO | Calcifications on CC and MLO mammograms (benign at pathology; DDSM region outline) |
| `mg-p00456` | Patient NV · Mammogram, right breast, CC and MLO | Calcifications on CC and MLO mammograms (benign at pathology; DDSM region outline) |

