# Condition packs: more patients for the conditions in the book

Four packs added on 28 October 2026 so that the condition search finds real patients for more of the conditions taught in
*Learning Radiology* (5th ed.). Every finding is located on the image by the source dataset's experts (box, outline or mask);
nothing was marked by us. Built with `scripts/data/external.py` + `build_external.py` (non-TCIA sources) and
`scripts/data/packs.py` (TCIA), lessons with `scripts/lessons/conditions.py`. All four pass `validate_pack.py` (files re-read,
re-hashed, decoded, every target mapped to a real SOP within the image bounds), the zod contract (`zod_check.mjs`) and
`tests/catalog.test.ts`.

| pack | what | cases | finding classIds | size |
|---|---|---|---|---|
| `cxr-findings` | PA chest radiographs, NIH ChestX-ray14, radiologist bounding boxes | 23 | `finding:pneumothorax` (4), `finding:pleural_effusion` (4), `finding:atelectasis` (3), `finding:cardiomegaly` (3), `finding:lung_mass` (3), `finding:lung_nodule` (3), `finding:pneumonia` (3) | 9.6 MB |
| `pe-cta` | CT pulmonary angiograms, FUMPE, radiologists' embolus masks | 2 | `finding:pulmonary_embolism` | 77.8 MB |
| `ct-findings` | TCIA contrast CT with DICOM SEG of the findings | 3 | `finding:liver_metastasis` (3 lesions, 1 patient), `finding:mediastinal_lymphadenopathy` (2 patients) | 25.2 MB |
| `fx-radiographs` | MSK radiographs, FracAtlas, expert fracture outlines | 5 | `finding:fracture` | 9.3 MB |

Total added to `public/packs`: about 122 MB, 686 files, largest file 2.7 MB. Lessons: 33 cases, 58 tasks. Every task links
only to curriculum objectives and uses those objectives' verified book anchors (pneumothorax ch24-o03/o04, effusion
ch07-o01/o02, atelectasis ch06-o01/o02, cardiomegaly ch11-o01/o02, mass ch10-o05, nodule ch10-o04, pneumonia ch08-o01/o02,
pulmonary embolism ch10-o07, liver metastases ch17-o08, mediastinal adenopathy ch10-o03, fracture ch23-o01/o03).

## Sources, licences and exact files

### NIH ChestX-ray14 (`cxr-findings`)
- **Licence:** "The usage of the data set is unrestricted", provided the original download site is linked, the NIH Clinical Center is acknowledged and the CVPR 2017 paper is cited. This is the dataset FAQ, Q04, in `FAQ_CHESTXRAY.pdf` on the official share.
- **Citation:** Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases. IEEE CVPR 2017:2097-2106.
- **Official site:** https://nihcc.app.box.com/v/ChestXray-NIHCC. `Data_Entry_2017_v2020.csv` (sha256 `c69a6dac…`) and the FAQ were downloaded from there.
- **Mirror used for the boxes and images:** the official `nihcc.box.com/shared/static/*.gz` archive links now return 404. So `BBox_List_2017.csv` (984 boxes, the official count; sha256 `0bbfea9d…`) and the 23 PNGs were read from the unmodified `images_0NN.zip` files on the public, ungated Hugging Face mirror `alkzar90/NIH-Chest-X-ray-dataset`, one ZIP member at a time over HTTP Range (`scripts/data/remote_zip.py`; each member CRC-32 checked).
- **Boxes:** drawn by a board-certified radiologist (ChestX-ray8 localisation set) → `source_manual`.
- **Report labels:** the image-level labels are NLP-mined from the reports (about 90% accurate per the authors). They are shown as context only, never scored.
- **Selection:** PA view, age 18–90, the box label also among the report labels, one image per patient. The best-ranked candidates were drawn with their boxes and reviewed by eye, and kept only when the boxed abnormality is clearly visible.
  - **Dropped:**
    - an effusion box on the lateral wall with no visible fluid;
    - a nodule box over the breast/nipple shadow;
    - a retrocardiac nodule too faint at this size;
    - a mass box covering half the lower chest;
    - three faint pneumonias.
  - **Infiltrate:** no image passed, because the report label is "Infiltration" and never matched the box label.
- **Format:** 8-bit 1024 px PNG wrapped unchanged as DICOM Secondary Capture (Modality DX, ViewPosition PA), then JPEG-LS lossless.
  - **No pixel spacing:** the resampling geometry is not recorded. Tolerances are therefore in pixels.
  - **No PatientOrientation:** the app says "Orientation not recorded in file", and labels never state a side.

| image | box label | view | age/sex | report labels | mirror zip | sha256 |
|---|---|---|---|---|---|---|
| 00003400_003 | Pneumothorax | PA | 25 F | Pneumothorax | images_002 | f30038a331e2e0ee… |
| 00010767_016 | Pneumothorax | PA | 57 M | Pneumothorax | images_005 | 48760fe8bee0679f… |
| 00011355_011 | Pneumothorax | PA | 34 M | Pneumothorax | images_005 | 662fcc30d99c09ea… |
| 00013209_018 | Pneumothorax | PA | 74 F | Pneumothorax | images_006 | dc96f26e77ff0022… |
| 00001437_012 | Effusion | PA | 30 F | Effusion | images_002 | efc8ececaecdeecf… |
| 00013337_000 | Effusion | PA | 65 M | Effusion | images_006 | 45bda5997bd20858… |
| 00023058_004 | Effusion | PA | 52 M | Effusion | images_010 | 0d7d96470efc8633… |
| 00029894_000 | Effusion | PA | 55 F | Effusion | images_012 | 0d6ac29fdc94eb54… |
| 00012299_002 | Atelectasis | PA | 22 M | Atelectasis | images_006 | 4eca57574b8ca119… |
| 00016267_000 | Atelectasis | PA | 57 M | Atelectasis | images_008 | b7db267c649dc416… |
| 00030674_000 | Atelectasis | PA | 79 M | Atelectasis | images_012 | c80608920fb107c6… |
| 00000377_004 | Cardiomegaly | PA | 57 F | Cardiomegaly | images_001 | 2875e39a9c150388… |
| 00000661_000 | Cardiomegaly | PA | 57 M | Cardiomegaly | images_001 | b881d71138612e9b… |
| 00000845_000 | Cardiomegaly | PA | 65 F | Cardiomegaly | images_001 | 2fe75c5058fac4a6… |
| 00001075_024 | Mass | PA | 59 F | Mass | images_001 | fedd4d3237e173b2… |
| 00011157_001 | Mass | PA | 23 M | Mass | images_005 | e00396af8bc3800a… |
| 00022192_003 | Mass | PA | 73 M | Mass | images_010 | bf6eb6698583b69c… |
| 00020274_021 | Nodule | PA | 52 F | Nodule | images_009 | 1ce66f2023b43890… |
| 00012374_000 | Nodule | PA | 34 M | Nodule | images_006 | 0c98a12a4a4cce13… |
| 00013673_001 | Nodule | PA | 46 M | Nodule | images_006 | 125a04b3deab7153… |
| 00001933_000 | Pneumonia | PA | 40 F | Consolidation, Pneumonia | images_002 | 0d84f4907203f34f… |
| 00003894_005 | Pneumonia | PA | 79 M | Nodule, Pneumonia | images_002 | 9aa126c934f295da… |
| 00014294_011 | Pneumonia | PA | 37 M | Pneumonia | images_007 | 9e78db64344bfba8… |

00003894_005 has no "name the main finding" question, because "nodule" is also among its report labels.

### FUMPE (`pe-cta`)
- **Licence:** CC BY 4.0, per figshare collection 4107803, doi:10.6084/m9.figshare.c.4107803.v1. Downloaded anonymously; md5 checked against the figshare API.
- **Citation:** Masoudi M, Pourreza HR, Saadatmand-Tarzjan M, Eftekhari N, Zargar FS, Rad MP. A new dataset of computed-tomography angiography images for computer-aided detection of pulmonary embolism. Sci Data. 2018;5:180180. doi:10.1038/sdata.2018.180.
- **Files:**
  - `PAT005.rar`: 47,072,995 B, md5 ff7cd3d4…
  - `PAT021.rar`: 44,329,982 B, md5 b460e84e…
  - `Ground Truth.rar`: sha256 b31649d0…, read from `label-edited/PATnnn.mat`.
- **Masks:** two radiologists with a semi-automated tool → `source_manual`.
  - **Mask-to-slice mapping:** mask slice k belongs to file D(k+1). This was checked three ways: equal counts, monotonic ImagePositionPatient, and an overlay showing the masks inside the opacified pulmonary arteries.
  - **PAT005:** saddle embolus across the pulmonary artery bifurcation.
  - **PAT021:** right pulmonary artery embolus. A large right pleural effusion is also visible but not outlined.
  - **PAT026 dropped:** 221 images but only 213 mask slices, so the mapping is ambiguous.
- **Header repairs before packing (pixel data unchanged):**
  - placeholder StudyInstanceUID/SeriesInstanceUID "0" replaced by derived 2.25 UIDs;
  - date attributes "0" and the PatientBirthDate removed;
  - PatientAge "000Y" removed;
  - "0" Manufacturer, InstitutionName and AccessionNumber cleared;
  - PatientID set to `FUMPE-PATnnn`.

  These repairs are recorded in each series' displayNote.

### TCIA (`ct-findings`, through the existing pipeline, `scripts/data/selection.json`)
- **Colorectal-Liver-Metastases:** CC BY 4.0, doi:10.7937/QXK2-QG03 (Simpson et al. 2023).
  - **CRLM-CT-1140:** CT, 30 images, 7.5 mm (zip sha256 368c9152…). SEG with manual segments (zip sha256 b1f354f5…).
  - **Kept:** liver, portal vein and Tumor_1–3 (shown as "Liver metastasis 1–3").
  - **Excluded:** "Liver Remnant" (the surgical-planning segment) and the hepatic veins (the app has no teaching note for that class yet, and every labelled structure must have one).
  - **Why this patient:** of the six smallest series, this one has three tumours of different sizes. The SEGs of all six were read before choosing.
- **Mediastinal-Lymph-Node-SEG (LNQ2023):** CC BY 4.0, doi:10.7937/QVAZ-JA09 (Idris et al. 2024).
  - **Cases:** case_0230 (59 images, zip sha256 b122d8c8…) and case_0837 (57 images, zip sha256 62fde6f4…). Both are "Fully Annotated": all nodes judged abnormal (estimated short axis > 1 cm) are segmented. The challenge paper warns that this estimate is error-prone near 1 cm, and the case text says so.

### FracAtlas (`fx-radiographs`)
- **Licence:** CC BY 4.0, figshare doi:10.6084/m9.figshare.22363012.v7.
- **Citation:** Abedeen I, Rahman MA, Prottyasha FZ, Ahmed T, Chowdhury TM, Shatabda S. FracAtlas. Sci Data. 2023;10:521. doi:10.1038/s41597-023-02432-4.
- **Annotations:** annotated manually "with the help of 2 expert radiologists and an orthopedist" → `source_manual`.
- **Files:** read member-by-member from `FracAtlas.zip`:
  - `COCO_fracture_masks.json`, sha256 e749d5aa…;
  - `dataset.csv`, sha256 cd2c5f7b….
- **Selection:**
  - **Filters:** fractured, one fracture, no hardware, a single frontal view, not part of a multi-scan set, and full resolution (2304×2880). Many candidates are 373×454 thumbnails and were rejected.
  - **Kept:** IMG0000019 (wrist and distal forearm), IMG0000151 (ankle), IMG0002302 (proximal humerus), IMG0002308 (proximal tibia) and IMG0002337 (proximal femur).
  - **Possible same patient:** FracAtlas has no patient IDs, and neighbouring numbers can be one person (IMG0002302–2306 are one shoulder). So the three IMG00023xx images share one holdout group.
- **Format:** the JPEG is decoded to 8-bit grayscale and stored without further loss, with `LossyImageCompression=01` because the source is JPEG. There is no pixel spacing and no orientation tag.

## Book conditions: located cases before and after

| book condition (chapter) | before | after |
|---|---|---|
| Pneumothorax (ch24) | none | 4 PA radiographs, radiologist box |
| Hemothorax (ch24) | none | **none**: no open, located dataset found |
| Pleural effusion (ch07) | none outlined | 4 PA radiographs, box (plus an unlabelled effusion on FUMPE PAT021) |
| Atelectasis (ch06) | none | 3 PA radiographs, box |
| Pneumonia / airspace disease (ch08) | COVID-19 cases (reader labels, CT without outlines) | + 3 PA radiographs with box |
| Solitary nodule (ch10) | LIDC CT nodules (28 outlines) | + 3 PA radiographs, box |
| Lung mass / bronchogenic carcinoma (ch10) | none | 3 PA radiographs, box ("mass"; diagnosis not given) |
| Middle mediastinal adenopathy (ch10, ch17) | none | 2 chest CTs, every abnormal node segmented |
| Pulmonary embolism (ch10) | none | 2 CT pulmonary angiograms, radiologists' masks |
| Cardiomegaly (ch11) | none | 3 PA radiographs, box |
| Liver metastases (ch17) | none | 1 CT, 3 lesions segmented |
| Renal mass (ch17) | KiTS tumours | unchanged |
| Fracture (ch23) | none | 5 radiographs (wrist, ankle, shoulder, knee, hip), expert outline |
| Soft-tissue sarcoma, glioma, breast mass | present | unchanged |
| Intracranial hemorrhage (ch26) | none | **none** (see skipped) |
| Stroke, hydrocephalus, MS (ch26) | none | none |
| COPD/emphysema, bronchiectasis, ILD, cavities (ch04, ch10) | none | none |
| Bowel obstruction, free air, appendicitis, stones (ch12–ch18) | none | none |
| Aortic aneurysm / dissection (ch11, ch24, ch28) | none | none |

## Skipped and why
- **CQ500 / Seg-CQ500** (intracranial hemorrhage). The Seg-CQ500 masks are CC BY 4.0, but the CT volumes are CQ500 data. Those carry CC BY-NC-SA 4.0 and Qure.ai's EULA, which forbids reproducing, modifying, creating derivative works from or publicly displaying site content without written consent. Nothing was downloaded beyond the archive's README, licence and `info.csv`. The fractional "IPH/SDH/…" values in `info.csv` are not reader labels, so they could not have served as subtype ground truth anyway.
- **PhysioNet CT-ICH** (hemorrhage): PhysioNet Restricted Health Data License, which needs a signed agreement.
- **Other restricted sources:** RSNA ICH/PE/abdominal-trauma (Kaggle competition rules), SIIM-ACR pneumothorax (Kaggle), CANDID-PTX, PadChest, VinDr, and the PTX-498 files on Zenodo, which are restricted.
- **Google Cloud copy of NIH ChestX-ray14:** the bucket needs authentication (HTTP 403).
- **Pretreat-MetsToBrain-Masks** (brain metastases): 0 series through the anonymous NBIA API v1.
- **Lung-PET-CT-Dx** (lung cancer CT, CC BY 4.0): its bounding boxes are a separate XML download. Not done in this pass.
- **HCC-TACE-Seg and CT Lymph Nodes** (both open, with SEG): not needed this time. They are the next candidates for HCC and abdominal nodes.
- **Hemothorax:** no public dataset with located hemothorax was found.

## Not verified
- **NIH images:**
  - **Image side:** from the burned-in markers the images are displayed in the usual PA convention, but that is not recorded in the file. No label states a side.
  - **Report labels:** they come from report text and can be wrong. The radiologist's box is the reference.
- **FracAtlas:**
  - **Ages:** not given. Some candidates looked paediatric (open growth plates); the five kept look adult, but that was judged by eye.
  - **Patient identity:** whether the three IMG00023xx images come from one person is unknown, hence the shared holdout group.
- **Outlines:** none was reviewed by a radiologist for this app. They are the source datasets' expert annotations, and are shown as such.

## Rebuild
```
python scripts/data/external.py nih
python scripts/data/external.py fumpe PAT005 PAT021
python scripts/data/external.py fracatlas IMG0000019.jpg IMG0000151.jpg IMG0002302.jpg IMG0002308.jpg IMG0002337.jpg
python scripts/data/build_external.py cxr-findings && python scripts/data/build_external.py pe-cta && python scripts/data/build_external.py fx-radiographs
python scripts/data/packs.py fetch ct-findings && python scripts/data/packs.py build ct-findings
python scripts/lessons/conditions.py
```
Raw downloads go to `RADIOLOGY_RAW_DIR` (default `C:/Users/kerim/radiology-data/raw`). The NIH selection is the curated list
`NIH_CURATED` in `external.py`, and the per-image review notes are next to it.
