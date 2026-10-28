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

## Round 2 (28 October 2026, evening): tumors and stroke

The app is now sold (membership), so round 2 uses only data whose licence allows commercial use with attribution (all CC BY 4.0
here); the build's commercial filter (`scripts/build/commercialContent.ts`) keeps every subject below. Nothing needed a login or an
agreement. Two packs: `ct-tumors` (TCIA, through `packs.py` / `build_pack.py`) and `stroke-mri` (`external.py isles` +
`build_external.py`). Both pass `validate_pack.py` (0 errors, 0 warnings), the zod contract and the unit tests; lessons by
`scripts/lessons/conditions.py` (`tumor_lessons`, `stroke_lessons`).

| pack | what | patients | finding classIds | size |
|---|---|---|---|---|
| `ct-tumors` | lung cancer CT with radiologists' boxes; HCC CT with curated SEG; vestibular schwannoma MRI with manual RT contour | 7 | `finding:lung_cancer` (4), `finding:hepatocellular_carcinoma` (2), `finding:vestibular_schwannoma` (1, two sequences) | 113.1 MB |
| `stroke-mri` | ISLES 2022 DWI + ADC with expert-approved lesion masks (NIfTI converted to DICOM) | 2 | `finding:ischemic_stroke` | 1.6 MB |

Lessons: 9 cases, 18 tasks (locate tasks scored against the reference, oral-exam self-review, an intra-/extra-axial choice for the
schwannoma and a DWI/ADC restriction choice for stroke). Book anchors only through curriculum objectives with verified anchors:
lung cancer ch10-o05, HCC ch17-o08 (HCC section p. 194 / PDF 214), vestibular schwannoma ch26-o11 (p. 343 / PDF 363), stroke
ch26-o08 (pp. 334–336 / PDF 354–356). The condition search gains *Hepatocellular carcinoma* and *Vestibular schwannoma* and finds
the new cases under *Lung cancer* and *Ischemic stroke*.

### Lung-PET-CT-Dx (`ct-tumors`, lung cancer)
- **Licence:** CC BY 4.0 (images, annotation XML and clinical data, per the collection page and the NBIA API).
  doi:10.7937/TCIA.2020.NNC2-0461 (Li et al. 2020).
- **Annotations:** PASCAL VOC boxes drawn in LabelImg by one of five academic thoracic radiologists and verified by the other four
  (collection description). `Lung-PET-CT-Dx-Annotations-XML-Files-rev12222020.zip` (sha256 74578564508a2c52…) from
  cancerimagingarchive.net; one XML per image, named by its SOP Instance UID. New annotation kind `voc_boxes`
  (`annotations.convert_voc_boxes`): pixel-corner boxes → image_px with the pixel-centre convention (−0.5 px); the XML image size
  must equal the series matrix and the box label must equal the patient's histology letter, or the build stops.
- **Histology:** from the first letter of the patient ID (A adenocarcinoma, B small cell, E large cell, G squamous), per the
  collection description. One patient per histology.
- **Series choice:** each patient's tumor is boxed on several reconstructions; the CT series with the most boxes that fits the budget
  was taken, and only boxes on that series are used (the others are counted in the target note). On every chosen series the boxed
  images are consecutive.

| patient | histology | CT series | boxes / images | raw zip sha256 |
|---|---|---|---|---|
| Lung_Dx-A0010 | adenocarcinoma | 5mm, 51 images | 9 (3 more on other series) | d63340320fdff3f6… |
| Lung_Dx-G0007 | squamous cell carcinoma | 5mm, 50 images | 14 (11 more) | 696bec9a6e66e56f… |
| Lung_Dx-B0022 | small cell carcinoma | ThoraxRoutine 5.0 B70f, 55 images | 19 (10 more) | ff21cf07730a511e… |
| Lung_Dx-E0004 | large cell carcinoma | ThoraxRoutine 5.0 B70f, 55 images | 13 (6 more) | 20714fcc6a538950… |

### HCC-TACE-Seg (`ct-tumors`, hepatocellular carcinoma)
- **Licence:** CC BY 4.0. doi:10.7937/TCIA.5FNA-0924 (Moawad et al. 2021). 105 patients with confirmed HCC; baseline CT 1–12 weeks
  before the first TACE.
- **Segmentation:** "Semiautomatic segmentation of liver, tumor, and blood vessels created using AMIRA was manually clinically
  curated" (collection page); the SEG records SegmentAlgorithmType SEMIAUTOMATIC → `source_manual` as for KiTS.
- **One phase only:** the image series holds three contrast phases; the SEG references one of them, and only those instances are kept
  (`sops` in the selection; 77 of 172 and 95 of 190 images), which gives a regular volume.
- **Kept:** Mass (shown as *Hepatocellular carcinoma*), Liver, Abdominal aorta. **Left out:** the *Portal vein* segment (description
  "vessels"): on this phase it outlines scattered intrahepatic branches that could not be confirmed as portal venous.

| patient | series (kept / original images) | SEG sha256 | image zip sha256 |
|---|---|---|---|
| HCC_010 | Recon 2: LIVER 3 PHASE (AP), 77 / 172 | e34386587108cdc3… | 27d8bd865b390d6c… |
| HCC_003 | Recon 2: LIVER 3 PHASE (AP), 95 / 190 | 6edf30fd2b1cca53… | 5fc392a7c814f7ca… |

### Vestibular-Schwannoma-SEG (`ct-tumors`, acoustic neuroma)
- **Licence:** CC BY 4.0. doi:10.7937/TCIA.9YTJ-5Q73 (Shapey et al. 2021).
- **Contours:** "manually segmented in consensus by the treating neurosurgeon and physicist using both the ceT1 and hrT2 images"
  (Gamma Knife planning, every axial slice). ROI *TV* (target volume = tumor) is used; *Cochlea*, *Vol2016* and *\*Skull* are not.
- **VS-SEG-001:** contrast T1 MPRAGE (120 images, zip sha256 ebb25babd157544b…, RTSTRUCT 4c57f7569e46e7ff…) and high-resolution
  T2 CISS (80 images, zip 75a4d9063a9d4b1f…, RTSTRUCT 956328392d4b3f1f…). The side is not stated in any label; the viewer's
  orientation letters show it.

### ISLES 2022 (`stroke-mri`, ischemic stroke)
- **Licence:** CC BY 4.0, Zenodo record 7153326 (open access; licence `cc-by-4.0` from the Zenodo API). Hernandez Petzsche et al.,
  Sci Data 2022;9:762.
- **Masks:** a DWI-trained U-Net pre-segmentation, corrected by trained annotators (DWI, ADC and FLAIR reviewed), revised by a
  neuroradiologist in training and approved by one of three attending neuroradiologists with more than 10 years of stroke imaging
  experience (paper). The mask is on the DWI/ADC grid.
- **Files** (`ISLES-2022.zip` read member by member over HTTP Range, CRC-32 checked):

| case | DWI sha256 | ADC sha256 | mask sha256 | lesion | DWI b-value (sidecar) |
|---|---|---|---|---|---|
| sub-strokecase0057 | 24c6b14602202355… | b7671737c425e3e1… | 1671fe47287c6fcb… | 59 ml, 40 slices | 800 |
| sub-strokecase0015 | eb03b126533c423d… | 282329bb4ab5adf0… | 854c546651870615… | 13 ml, 19 slices | 1000 |

- **Conversion** (`build_external.build_isles`): the images are the dataset's skull-stripped NIfTI on a 2 mm grid. Each slice
  becomes an MR Image Storage instance; IOP, IPP and pixel spacing come from the NIfTI affine (RAS → LPS); the voxel axes are
  flipped only so that columns run to the patient's left and rows run posterior. DWI is stored as rounded signal (arbitrary units),
  ADC in 10⁻⁶ mm²/s; negative interpolation values are clipped to 0. DWI and ADC share one study and frame of reference, so the
  viewer links them. Case 0055 was downloaded as a spare and not used.
- **Selection:** cases with one dominant lesion of moderate to large size among the first 60 masks; reviewed with the outline drawn
  on DWI and ADC (bright on DWI, dark on ADC, outline on the lesion).

### Fix in `build_external.uid_for`
`pydicom.generate_uid(prefix=None, entropy_srcs=…)` ignores `entropy_srcs` and returns a random UUID UID, so the "deterministic"
UIDs of round 1 were random per call (a rebuild would change them; in `stroke-mri` the DWI and ADC series first landed in two
different studies). `uid_for` now hashes its inputs (SHA-256 → 2.25 UID). The round-1 packs were not rebuilt and keep their stored
UIDs; rebuilding them now would give new, stable UIDs (and the anatomy layer of `pe-cta` would then need rebuilding too).

### Gap table after round 2

| book condition (chapter) | after round 1 | after round 2 |
|---|---|---|
| Bronchogenic carcinoma (ch10) | 3 PA radiographs, box ("mass") | + 4 chest CTs, radiologists' boxes, histology known |
| Hepatocellular carcinoma (ch17) | none | 2 CTs, curated SEG of the tumor |
| Vestibular schwannoma (ch26) | none | 1 MRI (contrast T1 + T2), manual contour |
| Ischemic stroke (ch26) | none | 2 MRIs (DWI + ADC), expert-approved mask |
| Pancreatic adenocarcinoma (ch17) | none | **none**: MSD Task07 (CC BY-SA 4.0) is one 11 GB tar without random access; Pancreatic-CT-CBCT-SEG contours only normal organs |
| Colon cancer (ch14/16) | none | **none**: MSD Task10 is a 5.8 GB tar; no TCIA alternative with located tumors found |
| Lymphoma / abdominal nodes (ch17) | mediastinal nodes (LNQ) | unchanged: CT Lymph Nodes abdominal series are 400+ images (> 200 MB each) |
| Meningioma (ch26) | none | **none**: Meningioma-SEG-CLASS returns no series through the anonymous NBIA API |
| Brain metastases (ch26) | none | **none**: Brain-TR-GammaKnife and Pretreat-MetsToBrain-Masks return no series anonymously |
| Intracranial hemorrhage, hemorrhagic stroke (ch26) | none | **none**: no public, located, commercially licensed set (CQ500 EULA; PhysioNet CT-ICH agreement; RSNA Kaggle rules; BHSD derives from RSNA data) |
| Hemothorax, free air, bowel obstruction, stones, aortic aneurysm/dissection | none | **none**: no open, located dataset with a commercial licence found |

### Anatomy outlines on the new CTs (round 2)
The anatomy layer ("AI draft by Horalix", `anatomy-atlas`) now also covers the CTs of `pe-cta`, `ct-findings` and `ct-tumors`
(11 more series: 51 CT series in all). Same pipeline and QC rules (`RULES_VERSION` 12): carina cut, spine numbering, contested
pixels, partial-imaging labels, laterality and anatomical order, density and typical-volume rules. Result: 4,409 outlines (was
3,650; 762 new), 77.2 MB (below the 80 MB repo budget), 0 verification failures against the DICOM, 1,186 left/right pairs with 0 on
the wrong side.
- **QC drops on the new CTs** (examples): fluid-dense right middle and lower lobes and a contrast-filled IVC on FUMPE PAT021 (density
  rule); doubtful lumbar numbering from L3 down on CRLM-CT-1140 (spine rule); lung-density lobe arteries on several scans.
- **Visual checks** (recorded in the work folder's `*_visual_check.json`): pulmonary-artery split, aortic parts and heart chambers
  rendered and inspected on every new chest CT. On two non-contrast lung-cancer CTs the tumor sits against the hilum: Lung_Dx-G0007's
  right pulmonary artery (it ran behind the bronchus into the tumor region) and right upper lobe arteries, and Lung_Dx-E0004's left
  pulmonary artery and left lobe arteries (border against the mass not verifiable without contrast) are not shown.
- **Effect on the 40 earlier CTs:** the typical volumes used by the size rule are recomputed over all CTs, so three borderline
  outlines no longer pass (LIDC-0208 rib 12 left and right, cut off at the scan edge and now under 20 % of the typical size;
  Spine-Mets 13843 right brachiocephalic vein, 1.3 ml vs typical 7 ml). Nothing else on the earlier CTs changed.
- **Not added:** the NIH radiographs carry no orientation tag, so every left/right structure would be dropped by the radiograph side
  rule; they keep the expert boxes only.

### Also skipped in round 2
- **QIN LUNG CT** (CC BY 3.0): its SEGs are the outputs of three segmentation challenge algorithms ("alg01–03"), not expert outlines.
- **NSCLC Radiogenomics** (CC BY 3.0): the collection page does not say who made the tumor segmentations, and the DICOM SEGs code the
  segment as "Heart" (SegmentedPropertyType), so the label cannot be trusted without each case being checked by a radiologist.
- **Adrenal-ACC-Ki67-Seg** (CC BY 4.0, SEG of adrenocortical carcinoma): not a book section; left for later.

## Round 3 (28 October 2026, night): ultrasound, mammography, children's fractures, knee osteoarthritis

Same rules as round 2: only licences that allow commercial use with attribution (CC BY 4.0, CC BY 3.0 here), nothing behind a
login, an agreement or competition rules, no terms accepted. Fetch with `external.py breast-us | hc18 | cbis | grazpedwri | knee`,
build with `build_external.py us-cases | mammo-cbis | peds-msk` (one pack may now credit several sources: `PACKS[...]["sources"]`,
each subject keeps its own `sourceId`), lessons by `scripts/lessons/conditions.py` (`us_lessons`, `mammo_lessons`,
`peds_msk_lessons`). All three packs pass `validate_pack.py` (0 errors, 0 warnings) and the zod contract (manifest, targets,
lessons, index). Every image was looked at with its reference drawn before it was kept.

| pack | what | patients | reference classIds | size |
|---|---|---|---|---|
| `us-cases` | breast ultrasound (Breast-Lesions-USG) and fetal head (HC18), US Image Storage with true pixel size | 9 | `finding:breast_mass` (4: 2 invasive carcinoma NST, 2 fibroadenoma, all biopsy-proven), `finding:breast_cyst` (2, follow-up), `anatomy:fetal_head` (3) | 1.6 MB |
| `mammo-cbis` | screen-film mammograms (CBIS-DDSM), CC + MLO of each breast, one woman with all four views | 5 | `finding:breast_mass` (3 women, 8 views), `finding:breast_calcifications` (2 women, 4 views) | 32.9 MB |
| `peds-msk` | children's wrist radiographs, frontal + lateral (GRAZPEDWRI-DX); knee crops with Kellgren-Lawrence grades | 7 | `finding:physeal_fracture` (2 children, 4 views), `finding:incomplete_fracture` (2 children, 4 views), `label:knee_kl_grade` (3 knees × 2 experts) | 7.9 MB |

Lessons: 21 cases, 43 tasks. Ultrasound: find the lesion (true 3 mm tolerance), cyst or solid, describe the echoes (the
radiologist's BI-RADS echo pattern and posterior features); fetal head: find it, and measure the head circumference (range choice,
answer from the sonographer's ellipse). Mammography: find the finding on every view, and the mass margin. Children: find the
fracture on both views, and its type. Knee: choose the Kellgren-Lawrence grade (image-level grade only: **not located**, said in
the case and the task).

### Breast-Lesions-USG (`us-cases`, breast ultrasound)
- **Licence:** CC BY 4.0 (TCIA collection page). doi:10.7937/9wkk-q141; Pawłowska et al., Sci Data 2024;11:148. 256 scans from 256
  patients, so one case is one patient.
- **Outlines:** "each tumor was identified in the image via a freehand annotation and labeled according to BIRADS features" by "a
  radiologist experienced in breast ultrasound examination" (collection page). Diagnosis and verification (biopsy or follow-up)
  from the clinical XLSX. Pixel size from the XLSX ("pixel size of the image in centimeters", data dictionary) → `PixelSpacing`
  in mm plus a `SequenceOfUltrasoundRegions` region with the same physical delta (cm), so distances are calibrated.
- **Images:** the dataset's cropped B-mode PNGs, MONOCHROME2, shown at the full 8-bit range. case007 is grey with a slight colour
  tint (no colour-flow data) and is stored as luma (ITU-R BT.601), said in its `DerivationDescription`; case013's transparent
  border pixels are black. No orientation tag and no visible probe marker (the images are cropped).
- **Files:** `BrEaST-Lesions_USG-images_and_masks-Dec-15-2023.zip` (sha256 c32e49cdfa54042e…), clinical XLSX (89a8874496a6f1f9…).

| case | diagnosis (verification) | BI-RADS | pixel size (cm) | image sha256 | mask sha256 |
|---|---|---|---|---|---|
| 007 | invasive carcinoma NST (biopsy) | 5 | 0.0078125 | 375586b2a04ef1c7… | 7e037815da3521ce… |
| 013 | invasive carcinoma NST (biopsy) | 5 | 0.0078125 | 3efa460235db48ec… | 234396c265587f5b… |
| 068 | fibroadenoma (biopsy) | 3 | 0.006944444 | 37a160bb994d35c3… | a890318a4f7e749d… |
| 025 | fibroadenoma (biopsy) | 4a | 0.006462036 | 51729dbda0183136… | d6922056ec57a46b… |
| 048 | simple cyst (follow-up) | 2 | 0.00726979 | 12bb6d2127ed3b34… | 0cc68a0be1b8057a… |
| 237 | simple cyst (follow-up) | 2 | 0.006462036 | cbd7aa61b2363f4c… | d723cb21bca6c605… |

### HC18 (`us-cases`, fetal head)
- **Licence:** CC BY 4.0 (Zenodo record 1327317). van den Heuvel et al., PLoS One 2018;13:e0200412.
- **Reference:** the head circumference "was made by a trained sonographer" as an ellipse (challenge page); the training annotation
  PNG draws the ellipse outline, which is filled and traced. Pixel size and HC from `training_set_pixel_size_and_HC.csv`
  (1c08fa81c374c5f9…). The dataset gives no mother or pregnancy identifiers, so the three images share one hold-out group.
  Gestational age is not given.

| image | pixel size (mm) | HC (mm) | image sha256 | annotation sha256 |
|---|---|---|---|---|
| 113_HC | 0.0971 | 87.3 | 3ee13ebb4000f741… | 70fb5018a0866613… |
| 365_HC | 0.1453 | 174.8 | 1d931e85c173aaad… | 135901854c1e145f… |
| 687_HC | 0.1430 | 249.5 | 302b1607f4fa0b87… | 4782421b0ee27e34… |

### CBIS-DDSM (`mammo-cbis`)
- **Licence:** CC BY 3.0 (TCIA collection page). doi:10.7937/K9/TCIA.2016.7O02S9CY; Lee et al., Sci Data 2017;4:170177. Full
  mammograms and ROI mask series from the anonymous NBIA API; case description CSVs from the collection page.
- **Outlines:** masses were re-segmented in CBIS-DDSM, initialised from the original DDSM contours; calcifications keep the original
  DDSM region ("only for masses and not calcifications", collection page). Shape, margin, calcification type and distribution,
  BI-RADS assessment and pathology are copied from the CSV, nothing added.
- **Images:** 16-bit digitised film (MONOCHROME2, checked), downsampled 2 × 2 by averaging (ROI masks the same, ≥ 50 %); no pixel
  spacing (uncalibrated). Secondary Capture with `Modality` MG, `ImageLaterality` and `Laterality` (from the CSV side),
  `ViewPosition` CC/MLO (from the CSV view) and `PatientOrientation` LCC `A\R`, RCC `P\L`, LMLO `A\F`, RMLO `P\F`; the build
  asserts that the chest wall is on the expected image edge, and every film marker was read by eye. All views of one woman share
  one study; series numbers RCC 1, RMLO 2, LCC 3, LMLO 4. `series.acquisition` carries `ImageLaterality`, `Laterality`,
  `ViewPosition` and `PatientOrientation`.
- **Rejected after looking at the films:** P_00063 (CC marker reads "R CC EXT", not a standard CC), P_00480 (mirrored LCC marker),
  P_00674 (the outlined calcification is one small dot, not teachable at web resolution).

| patient | side | finding (CSV) | BI-RADS (CC / MLO) | pathology | full zip sha256 (CC / MLO) | ROI zip sha256 (CC / MLO) |
|---|---|---|---|---|---|---|
| P_00021 | left | mass, oval, circumscribed | 3 / 3 | benign | ed5ef049e83e6396… / 10f3fc865e50cf93… | 1b0467c5e587c7cd… / 357fb05e21168053… |
| P_00021 | right | mass, oval, circumscribed | 3 / 3 | benign | 8f6ddb871d9b6eab… / 7e51afed65e1151e… | 269c738c7367537a… / 2232da6b3eecec61… |
| P_00039 | right | mass, irregular, spiculated | 5 / 5 | malignant | 99afc0db5a6761e4… / 99372b781b085f3f… | 8bcb2d33deb48f5b… / fafbb05a471988f5… |
| P_00051 | left | mass, irregular, spiculated | 5 / 5 | malignant | 47ff9e6551aadfa1… / a7d526dc13244a49… | 78aa7b0cfc02a2a0… / f3b5c60e4bcb9592… |
| P_00307 | left | calcifications, pleomorphic, clustered | 5 / 4 | malignant | 89f0f0d04fc06dde… / 72a3792fcd65562a… | ba4580ad7b9b28cb… / 60d5a8cc37cd5fdc… |
| P_00425 | right | calcifications, coarse-pleomorphic, clustered | 2 / 2 | benign | dc1c94aae70ac799… / 720f63c7d5ab011a… | 039ef63145dcdcc9… / c1c7225b7312444a… |

### GRAZPEDWRI-DX (`peds-msk`, children's wrist fractures)
- **Licence:** CC BY 4.0 (figshare 14825193 v2). Nagy et al., Sci Data 2022;9:222: "All studies and their annotations were reviewed
  by experienced pediatric radiologists at least twice".
- **Reference:** the `fracture` rectangle of the Supervisely annotation (`folder_structure.zip`, eac47bc5dfc01c14…), pixel corners
  → pixel centres (−0.5 px). Age, sex, side, projection and AO/OTA pediatric code from `dataset.csv` (55a53cbe9673e5f2…); the
  annotation's `side_*` tag must agree. The fracture type in the label is read from the code: 23r-E/2.1 = Salter-Harris II of the
  distal radius, 23r-M/2.1 = incomplete metaphyseal fracture (torus/buckle or greenstick; the code does not separate them).
- **Images:** the dataset's 16-bit PNGs, read member by member from `images_partN.zip` (HTTP Range, CRC-32 checked).
  `ImagerPixelSpacing` 0.144 mm (detector plane, uncalibrated), `ImageLaterality` from the CSV, `ViewPosition` AP only where the
  annotation is tagged `projection_ap` (the lateral view has no DICOM view code here). Frontal and lateral of the first study of
  each child share one study.

| child | sex, age | side | AO/OTA | frontal sha256 | lateral sha256 |
|---|---|---|---|---|---|
| 3390 | F, 13.9 | L | 23r-E/2.1 (SH II) | c3f26daf4fab4e35… | 5e3272c1059c8c8f… |
| 3853 | M, 14.4 | L | 23r-E/2.1 (SH II) | 1fe8afeaf269f61a… | e0900285258ac9b2… |
| 0030 | F, 8.2 | L | 23r-M/2.1 (incomplete) | 49fc40781a67c456… | 7123bee956ac47eb… |
| 0071 | F, 9.6 | R | 23r-M/2.1 (incomplete) | 06006bc2d80f7690… | b0a72ce868583309… |

### Digital Knee X-ray Images (`peds-msk`, knee osteoarthritis grades)
- **Licence:** CC BY 4.0 (Mendeley Data t9ndx37v5h v1, `data_licence` from the public API). Gornale & Patravali 2020.
- **Reference:** each of two medical experts sorted every image into a Kellgren-Lawrence grade folder (`MedicalExpert-I.rar`
  ae315cd0527259cb…, `MedicalExpert-II.rar` 813585e02f5c3ad2…). Images are matched across the two archives by pixel hash
  (`match.json`: 1,579 in both, 1,569 with the same grade); only images both experts graded the same are used. Two `image_label`
  targets per image (`label:knee_kl_grade`), one per expert, so the condition search shows them as reader labels agreed by both.
- **Images:** 300 × 162 px 8-bit crops of the joint as distributed (grey RGB → one channel); no pixel spacing, side or view in the
  source. The three knees share one hold-out group (no patient identifiers).

| image | grade (both experts) | pixel hash |
|---|---|---|
| NormalG0 (10).png | 0 | 196c52391d8a… |
| MildG2 (102).png | 2 | 0b79036fc768… |
| SevereG4 (101).png | 4 | bbbd048a1720… |

### Conditions and book pages (round 3)
New conditions: *Breast cyst*, *Breast calcifications*, *Salter-Harris fracture*, *Torus or greenstick fracture*, *Pregnancy
ultrasound*. *Breast mass* now also finds the ultrasound masses and the new mammograms; *Fracture* also finds the children's
fractures; *Osteoarthritis* lists the knees graded 2 or more by both experts (reader labels, not outlined). Every book anchor is a
heading on that page in the section index, and the text was checked in the book: echogenicity and posterior enhancement/shadowing
(PDF 222), pregnancy and fetal growth (237–238), greenstick and torus fractures (303), Salter-Harris types and prognosis
(375–376; 309 points there), mass descriptors (408), calcifications (410), breast ultrasound cyst criteria and fibroadenoma (411),
cyst aspiration (413). The book does not mention the Kellgren-Lawrence scale; it is in our own signs only.

### Gap table after round 3

| book chapter | modality | cases before (with a located finding) | after |
|---|---|---|---|
| ch18 Ultrasound: abdomen and pelvis | US | 0 | 9 (6 breast lesions outlined; 3 fetal heads with the sonographer's ellipse) |
| ch19 Vascular, pediatric, point-of-care US | US | 0 | **0**: no open, commercial, located set found (see below) |
| ch21 Arthritis | XR | 0 | 3 knees, expert grade only (not located) |
| ch23 Skeletal trauma | XR | 5 (5) | 9 (9): + 4 children's wrists, both views |
| ch27 Pediatrics | XR | 0 | 2 (2): Salter-Harris II, both views |
| ch29 Breast imaging | MG | 1 (1) | 6 (6): 5 women, CC + MLO, one with all four views |
| ch29 Breast imaging | US | 0 | 6 (6) |

Curriculum objectives with a case: 58 → 64 of 274 (new: ch18-o01, ch21-o07, ch21-o08, ch27-o07, ch29-o05, ch29-o06).

### Skipped in round 3 and why
- **BUSI** (breast ultrasound): no licence on the dataset itself. **Pediatric pneumonia radiographs** (Kermany/Zhang, CC BY 4.0):
  image-level labels only, with known label noise; not located.
- **Abdominal plain films** (free air, obstruction, stones), **hemothorax**, **neonatal head and hip ultrasound, intussusception,
  pyloric stenosis, DVT, FAST**: no open dataset with a commercial licence and a located reference was found (free-air sets found
  were CT and CC BY-NC-SA).
- **Kaggle-hosted copies** of any set (competition rules or unclear licences) were not used.

### Not verified
- No radiologist reviewed these outlines for this app; they are the datasets' annotations, shown as such.
- The CBIS-DDSM calcification outlines are coarse DDSM regions around the group. At 2 × 2 downsampling P_00307's calcifications are
  faint on the MLO.
- `PatientOrientation` on the mammograms is derived from the chest-wall side and the film marker (the source has none); hanging was
  checked in the viewer on P_00021 (right breast on the left, CC above MLO, chest walls to the middle, letters A/P, R/L, H/F as
  expected). For a woman with one breast installed (e.g. P_00425) the mammography layout shows that breast's CC and MLO side by side.

## Rebuild
```
python scripts/data/external.py nih
python scripts/data/external.py fumpe PAT005 PAT021
python scripts/data/external.py fracatlas IMG0000019.jpg IMG0000151.jpg IMG0002302.jpg IMG0002308.jpg IMG0002337.jpg
python scripts/data/build_external.py cxr-findings && python scripts/data/build_external.py pe-cta && python scripts/data/build_external.py fx-radiographs
python scripts/data/packs.py fetch ct-findings && python scripts/data/packs.py build ct-findings
python scripts/data/packs.py fetch ct-tumors && python scripts/data/packs.py build ct-tumors
python scripts/data/external.py isles 15 57 && python scripts/data/build_external.py stroke-mri
python scripts/data/external.py breast-us && python scripts/data/external.py hc18 && python scripts/data/build_external.py us-cases
python scripts/data/external.py cbis && python scripts/data/build_external.py mammo-cbis
python scripts/data/external.py grazpedwri && python scripts/data/external.py knee && python scripts/data/build_external.py peds-msk
python scripts/lessons/conditions.py
```
Raw downloads go to `RADIOLOGY_RAW_DIR` (default `C:/Users/kerim/radiology-data/raw`). The NIH selection is the curated list
`NIH_CURATED` in `external.py`, and the per-image review notes are next to it.
