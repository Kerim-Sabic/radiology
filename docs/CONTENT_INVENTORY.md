# Content inventory

_Generated 2026-10-28 by `scripts/report/content-report.mjs` from the installed files. Counts are distinct real patients/studies/series — not slices, not repeated questions, not planned sources._

## Totals

| | count |
|---|---|
| Distinct patients with usable cases | **93** |
| Teaching cases | 93 |
| Image-based tasks | **320** |
| Studies | 113 |
| Series (all packs) | 126 |
| DICOM instances | 8177 |
| Reference targets | 4798 |

### Tasks by scoring basis

| basis | tasks |
|---|---|
| auto-checked choice | 59 |
| self-review (checklist) | 120 |
| spatial · AI draft by Horalix / dataset auto-label reference (self-review until user review) | 15 |
| spatial · source manual reference | 126 |

### Tasks by type

| type | tasks |
|---|---|
| choose window | 7 |
| compare appearances | 12 |
| correlate modalities | 12 |
| describe finding | 62 |
| differential | 50 |
| find structure | 87 |
| locate finding | 50 |
| navigate level | 27 |
| whole study | 13 |

### Reference targets by provenance

| provenance | targets |
|---|---|
| ai_draft | 4474 |
| source_automated | 3 |
| source_manual | 321 |

## Packs

| pack | distribution | binaries here | subjects | series | instances | bytes (index) | cases | tasks |
|---|---|---|---|---|---|---|---|---|
| starter | repo | yes | 3 | 4 | 152 | 32.0 MB | 3 | 13 |
| chest-pairs | repo | yes | 6 | 16 | 807 | 201.9 MB | 6 | 33 |
| ct-mri-pairs | repo | yes | 2 | 6 | 462 | 59.8 MB | 2 | 10 |
| body | repo | yes | 4 | 4 | 485 | 83.1 MB | 4 | 13 |
| neuro-msk | repo | yes | 3 | 5 | 523 | 54.8 MB | 3 | 8 |
| expansion | repo | yes | 12 | 17 | 1892 | 263.1 MB | 12 | 39 |
| vessel-drafts | repo | yes | 0 | 0 | 0 | 1.1 MB | 0 | 15 |
| anatomy-atlas | repo | yes | 0 | 0 | 0 | 73.6 MB | 0 | 0 |
| more-ct-xr | repo | yes | 21 | 29 | 2375 | 488.6 MB | 21 | 89 |
| cxr-findings | repo | yes | 23 | 23 | 23 | 9.2 MB | 23 | 45 |
| pe-cta | repo | yes | 2 | 2 | 434 | 74.9 MB | 2 | 4 |
| ct-findings | repo | yes | 3 | 3 | 146 | 24.2 MB | 3 | 4 |
| fx-radiographs | repo | yes | 5 | 5 | 5 | 9.0 MB | 5 | 5 |
| stroke-mri | repo | yes | 2 | 4 | 290 | 1.6 MB | 2 | 4 |
| ct-tumors | repo | yes | 7 | 8 | 583 | 107.9 MB | 7 | 14 |
| book-practice | repo | yes | 0 | 0 | 0 | 0.1 MB | 0 | 24 |

## Patients and cases

| case | neutral title | subject (source namespace) | modalities | tasks |
|---|---|---|---|---|
| `starter-ct-chest-01` | Patient A · CT chest | `tcia:LCTSC:LCTSC-Train-S1-012` | CT | 7 |
| `starter-cxr-01` | Patient B · Chest radiograph + CT localizer | `tcia:COVID-19-AR:COVID-19-AR-16406503` | CR+CT | 4 |
| `starter-mr-prostate-01` | Patient C · MRI pelvis (axial) | `tcia:PROSTATEx:ProstateX-0004` | MR | 2 |
| `chest-pairs-lidc-idri-0078` | Patient D · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0078` | CT+CR | 7 |
| `chest-pairs-lidc-idri-0217` | Patient E · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0217` | CT+DX | 7 |
| `chest-pairs-lidc-idri-0053` | Patient F · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0053` | CT+DX | 10 |
| `chest-pairs-covid-19-ar-16434363` | Patient G · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16434363` | DX+CT | 10 |
| `chest-pairs-covid-19-ar-16406502` | Patient H · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16406502` | CT+DX | 8 |
| `chest-pairs-covid-19-ar-16434411` | Patient I · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16434411` | CT+DX | 10 |
| `ctmri-sts-033` | Patient N · MRI + CT of an extremity | `tcia:Soft-tissue-Sarcoma:STS_033` | CT+MR | 6 |
| `ctmri-sts-042` | Patient O · MRI + CT of an extremity | `tcia:Soft-tissue-Sarcoma:STS_042` | MR+CT | 6 |
| `body-lctsc-train-s2-003` | Patient J · CT chest | `tcia:LCTSC:LCTSC-Train-S2-003` | CT | 4 |
| `body-lctsc-train-s3-006` | Patient K · CT chest | `tcia:LCTSC:LCTSC-Train-S3-006` | CT | 4 |
| `body-covid-19-ar-16406498` | Patient L · CT chest | `tcia:COVID-19-AR:COVID-19-AR-16406498` | CT | 5 |
| `body-kits-00015` | Patient M · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00015` | CT | 5 |
| `neuro-remind-025` | Patient P · MRI brain | `tcia:ReMIND:ReMIND-025` | MR | 4 |
| `msk-spine-13843` | Patient Q · CT torso (bone window) | `tcia:Spine-Mets-CT-SEG:13843` | CT | 3 |
| `breast-cbis-p00001` | Patient R · Mammogram (single view) | `tcia:CBIS-DDSM:Mass-Training_P_00001_LEFT_CC` | MG | 1 |
| `exp-lctsc-train-s1-008` | Patient S · CT chest | `tcia:LCTSC:LCTSC-Train-S1-008` | CT | 3 |
| `exp-lctsc-test-s2-202` | Patient T · CT chest | `tcia:LCTSC:LCTSC-Test-S2-202` | CT | 3 |
| `exp-lctsc-train-s3-007` | Patient U · CT chest | `tcia:LCTSC:LCTSC-Train-S3-007` | CT | 3 |
| `exp-lctsc-train-s3-011` | Patient V · CT chest | `tcia:LCTSC:LCTSC-Train-S3-011` | CT | 3 |
| `exp-lidc-idri-0134` | Patient W · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0134` | CR+CT | 5 |
| `exp-lidc-idri-0208` | Patient X · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0208` | CT+DX | 5 |
| `exp-lidc-idri-0111` | Patient Y · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0111` | DX+CT | 5 |
| `exp-kits-00045` | Patient Z · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00045` | CT | 3 |
| `exp-kits-00204` | Patient BA · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00204` | CT | 3 |
| `exp-spine-13800` | Patient BB · CT torso (bone window) | `tcia:Spine-Mets-CT-SEG:13800` | CT | 3 |
| `exp-spine-14078` | Patient BC · CT torso (bone window) | `tcia:Spine-Mets-CT-SEG:14078` | CT | 3 |
| `exp-remind-014` | Patient BD · MRI brain | `tcia:ReMIND:ReMIND-014` | MR | 2 |
| `more-pediatric-ct-seg-40fefef6` | Patient AA · CT chest, abdomen and pelvis (child, 1 y) | `tcia:Pediatric-CT-SEG:Pediatric-CT-SEG-40FEFEF6` | CT | 7 |
| `more-pediatric-ct-seg-9d907991` | Patient AB · CT chest, abdomen and pelvis (child, 5 y) | `tcia:Pediatric-CT-SEG:Pediatric-CT-SEG-9D907991` | CT | 7 |
| `more-pediatric-ct-seg-397` | Patient AC · CT abdomen and pelvis (child, 12 y) | `tcia:Pediatric-CT-SEG:Pediatric-CT-SEG-397` | CT | 6 |
| `more-pediatric-ct-seg-3555a98f` | Patient AD · CT abdomen and pelvis (child, 15 y) | `tcia:Pediatric-CT-SEG:Pediatric-CT-SEG-3555A98F` | CT | 6 |
| `more-midrc-ricord-1c-419639-000214` | Patient AE · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-419639-000214` | DX | 3 |
| `more-midrc-ricord-1c-site2-000212` | Patient AF · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-SITE2-000212` | CR | 3 |
| `more-midrc-ricord-1c-site2-000202` | Patient AG · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-SITE2-000202` | CR | 2 |
| `more-midrc-ricord-1c-site2-000267` | Patient AH · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-SITE2-000267` | CR | 3 |
| `more-midrc-ricord-1c-419639-001571` | Patient AI · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-419639-001571` | DX | 3 |
| `more-midrc-ricord-1c-419639-001735` | Patient AJ · Chest radiograph | `tcia:MIDRC-RICORD-1C:MIDRC-RICORD-1C-419639-001735` | CR | 3 |
| `more-covid-19-ar-16445122` | Patient AK · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16445122` | CT+DX | 6 |
| `more-covid-19-ar-16445138` | Patient AL · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16445138` | DX+CT | 6 |
| `more-covid-19-ar-16424076` | Patient AM · Chest radiograph + CT chest, abdomen and pelvis | `tcia:COVID-19-AR:COVID-19-AR-16424076` | DX+CT | 6 |
| `more-covid-19-ar-16434369` | Patient AN · Chest radiograph + CT chest, abdomen and pelvis | `tcia:COVID-19-AR:COVID-19-AR-16434369` | DX+CT | 6 |
| `more-lidc-idri-0282` | Patient AO · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0282` | CT+DX | 5 |
| `more-lidc-idri-0289` | Patient AP · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0289` | CT+DX | 5 |
| `more-lidc-idri-0018` | Patient AQ · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0018` | DX+CT | 5 |
| `more-lidc-idri-0149` | Patient AR · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0149` | DX+CT | 5 |
| `more-lctsc-train-s1-007` | Patient AS · CT chest | `tcia:LCTSC:LCTSC-Train-S1-007` | CT | 2 |
| `more-lctsc-train-s2-004` | Patient AT · CT chest | `tcia:LCTSC:LCTSC-Train-S2-004` | CT | 2 |
| `more-lctsc-test-s3-202` | Patient AU · CT chest | `tcia:LCTSC:LCTSC-Test-S3-202` | CT | 2 |
| `cxr-00003400-003` | Chest radiograph PA · NIH 00003400-003 | `nih:ChestX-ray14:3400` | DX | 2 |
| `cxr-00010767-016` | Chest radiograph PA · NIH 00010767-016 | `nih:ChestX-ray14:10767` | DX | 2 |
| `cxr-00011355-011` | Chest radiograph PA · NIH 00011355-011 | `nih:ChestX-ray14:11355` | DX | 2 |
| `cxr-00013209-018` | Chest radiograph PA · NIH 00013209-018 | `nih:ChestX-ray14:13209` | DX | 2 |
| `cxr-00001437-012` | Chest radiograph PA · NIH 00001437-012 | `nih:ChestX-ray14:1437` | DX | 2 |
| `cxr-00013337-000` | Chest radiograph PA · NIH 00013337-000 | `nih:ChestX-ray14:13337` | DX | 2 |
| `cxr-00023058-004` | Chest radiograph PA · NIH 00023058-004 | `nih:ChestX-ray14:23058` | DX | 2 |
| `cxr-00029894-000` | Chest radiograph PA · NIH 00029894-000 | `nih:ChestX-ray14:29894` | DX | 2 |
| `cxr-00012299-002` | Chest radiograph PA · NIH 00012299-002 | `nih:ChestX-ray14:12299` | DX | 2 |
| `cxr-00016267-000` | Chest radiograph PA · NIH 00016267-000 | `nih:ChestX-ray14:16267` | DX | 2 |
| `cxr-00030674-000` | Chest radiograph PA · NIH 00030674-000 | `nih:ChestX-ray14:30674` | DX | 2 |
| `cxr-00000377-004` | Chest radiograph PA · NIH 00000377-004 | `nih:ChestX-ray14:377` | DX | 3 |
| `cxr-00000661-000` | Chest radiograph PA · NIH 00000661-000 | `nih:ChestX-ray14:661` | DX | 3 |
| `cxr-00000845-000` | Chest radiograph PA · NIH 00000845-000 | `nih:ChestX-ray14:845` | DX | 3 |
| `cxr-00001075-024` | Chest radiograph PA · NIH 00001075-024 | `nih:ChestX-ray14:1075` | DX | 2 |
| `cxr-00011157-001` | Chest radiograph PA · NIH 00011157-001 | `nih:ChestX-ray14:11157` | DX | 2 |
| `cxr-00022192-003` | Chest radiograph PA · NIH 00022192-003 | `nih:ChestX-ray14:22192` | DX | 2 |
| `cxr-00020274-021` | Chest radiograph PA · NIH 00020274-021 | `nih:ChestX-ray14:20274` | DX | 2 |
| `cxr-00012374-000` | Chest radiograph PA · NIH 00012374-000 | `nih:ChestX-ray14:12374` | DX | 2 |
| `cxr-00013673-001` | Chest radiograph PA · NIH 00013673-001 | `nih:ChestX-ray14:13673` | DX | 2 |
| `cxr-00001933-000` | Chest radiograph PA · NIH 00001933-000 | `nih:ChestX-ray14:1933` | DX | 2 |
| `cxr-00003894-005` | Chest radiograph PA · NIH 00003894-005 | `nih:ChestX-ray14:3894` | DX | 1 |
| `cxr-00014294-011` | Chest radiograph PA · NIH 00014294-011 | `nih:ChestX-ray14:14294` | DX | 2 |
| `pe-pat005` | CT chest with contrast · FUMPE PAT005 | `figshare:FUMPE:PAT005` | CT | 3 |
| `pe-pat021` | CT chest with contrast · FUMPE PAT021 | `figshare:FUMPE:PAT021` | CT | 3 |
| `ct-crlm-1140` | CT chest, abdomen and pelvis (contrast) · CRLM 1140 | `tcia:Colorectal-Liver-Metastases:CRLM-CT-1140` | CT | 2 |
| `ct-lnq-0230` | CT chest with contrast · LNQ 0230 | `tcia:Mediastinal-Lymph-Node-SEG:case_0230` | CT | 1 |
| `ct-lnq-0837` | CT chest with contrast · LNQ 0837 | `tcia:Mediastinal-Lymph-Node-SEG:case_0837` | CT | 1 |
| `fx-img0000019` | Radiograph, wrist and distal forearm · FracAtlas IMG0000019 | `figshare:FracAtlas:IMG0000019` | DX | 1 |
| `fx-img0000151` | Radiograph, ankle · FracAtlas IMG0000151 | `figshare:FracAtlas:IMG0000151` | DX | 1 |
| `fx-img0002302` | Radiograph, shoulder and proximal humerus · FracAtlas IMG0002302 | `figshare:FracAtlas:IMG0002302` | DX | 1 |
| `fx-img0002308` | Radiograph, knee and proximal tibia · FracAtlas IMG0002308 | `figshare:FracAtlas:IMG0002308` | DX | 1 |
| `fx-img0002337` | Radiograph, hip and proximal femur · FracAtlas IMG0002337 | `figshare:FracAtlas:IMG0002337` | DX | 1 |
| `stroke-isles-0015` | MRI brain, diffusion · ISLES 2022 case 15 | `zenodo:ISLES-2022:sub-strokecase0015` | MR | 3 |
| `stroke-isles-0057` | MRI brain, diffusion · ISLES 2022 case 57 | `zenodo:ISLES-2022:sub-strokecase0057` | MR | 2 |
| `lung-dx-a0010` | CT chest · Lung-PET-CT-Dx A0010 | `tcia:Lung-PET-CT-Dx:Lung_Dx-A0010` | CT | 2 |
| `lung-dx-g0007` | CT chest · Lung-PET-CT-Dx G0007 | `tcia:Lung-PET-CT-Dx:Lung_Dx-G0007` | CT | 2 |
| `lung-dx-b0022` | CT chest · Lung-PET-CT-Dx B0022 | `tcia:Lung-PET-CT-Dx:Lung_Dx-B0022` | CT | 2 |
| `lung-dx-e0004` | CT chest · Lung-PET-CT-Dx E0004 | `tcia:Lung-PET-CT-Dx:Lung_Dx-E0004` | CT | 2 |
| `hcc-010` | CT abdomen, liver protocol · HCC-TACE-Seg 010 | `tcia:HCC-TACE-Seg:HCC_010` | CT | 2 |
| `hcc-003` | CT abdomen, liver protocol · HCC-TACE-Seg 003 | `tcia:HCC-TACE-Seg:HCC_003` | CT | 2 |
| `vs-seg-001` | MRI brain, posterior fossa · VS-SEG 001 | `tcia:Vestibular-Schwannoma-SEG:VS-SEG-001` | MR | 3 |

## Same-patient multimodality comparisons

Only series from one source subject are combined; links are `independent` unless the files share a frame of reference. No registration is claimed.

| subject | studies (modality, relative day) | relationship |
|---|---|---|
| `tcia:COVID-19-AR:COVID-19-AR-16406503` | CR (day 0); CT (day 1) | Radiograph ↔ CT scout only (no diagnostic CT in pack) |
| `tcia:LIDC-IDRI:LIDC-IDRI-0078` | CT (day ?); CR (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0217` | CT (day ?); DX (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0053` | CT (day ?); DX (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16434363` | DX (day 0); CT (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16406502` | CT (day 3); DX (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16434411` | CT (day 0); DX (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:Soft-tissue-Sarcoma:STS_033` | CT (day 0); MR (day 0) | CT ↔ MRI |
| `tcia:Soft-tissue-Sarcoma:STS_042` | MR (day 0); CT (day 18) | CT ↔ MRI |
| `tcia:LIDC-IDRI:LIDC-IDRI-0134` | CR (day ?); CT (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0208` | CT (day ?); DX (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0111` | DX (day ?); CT (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16445122` | CT (day 0); DX (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16445138` | DX (day 0); CT (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16424076` | DX (day 0); CT (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:COVID-19-AR:COVID-19-AR-16434369` | DX (day 0); CT (day 0) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0282` | CT (day ?); DX (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0289` | CT (day ?); DX (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0018` | DX (day ?); CT (day ?) | Radiograph ↔ diagnostic CT |
| `tcia:LIDC-IDRI:LIDC-IDRI-0149` | DX (day ?); CT (day ?) | Radiograph ↔ diagnostic CT |

## Transfer syntaxes present

- `1.2.840.10008.1.2.4.80`: 111 series
- `1.2.840.10008.1.2`: 5 series
- `1.2.840.10008.1.2.4.90`: 3 series
- `1.2.840.10008.1.2.5`: 1 series
- `1.2.840.10008.1.2.4.70`: 6 series

MONOCHROME1 series: 1. Volume (MPR) eligible series: 69. Scouts/localizers: 3.
