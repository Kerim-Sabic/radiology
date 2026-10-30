# Content inventory

_Generated 2026-10-30 by `scripts/report/content-report.mjs` from the installed files. Counts are distinct real patients/studies/series — not slices, not repeated questions, not planned sources._

## Totals

| | count |
|---|---|
| Distinct patients with usable cases | **370** |
| Teaching cases | 370 |
| Image-based tasks | **1060** |
| Studies | 390 |
| Series (all packs) | 505 |
| DICOM instances | 15696 |
| Reference targets | 5097 |

### Tasks by scoring basis

| basis | tasks |
|---|---|
| auto-checked choice | 525 |
| self-review (checklist) | 120 |
| spatial · AI outline / dataset auto-label reference (self-review until user review) | 15 |
| spatial · source manual reference | 400 |

### Tasks by type

| type | tasks |
|---|---|
| choose window | 7 |
| compare appearances | 12 |
| correlate modalities | 12 |
| describe finding | 301 |
| differential | 277 |
| find structure | 90 |
| locate finding | 321 |
| navigate level | 27 |
| whole study | 13 |

### Reference targets by provenance

| provenance | targets |
|---|---|
| ai_draft | 4383 |
| source_automated | 3 |
| source_manual | 711 |

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
| anatomy-atlas | repo | yes | 0 | 0 | 0 | 72.2 MB | 0 | 0 |
| more-ct-xr | repo | yes | 21 | 29 | 2375 | 488.6 MB | 21 | 89 |
| cxr-findings | repo | yes | 23 | 23 | 23 | 9.2 MB | 23 | 45 |
| pe-cta | repo | yes | 2 | 2 | 434 | 74.9 MB | 2 | 4 |
| ct-findings | repo | yes | 3 | 3 | 146 | 24.2 MB | 3 | 4 |
| fx-radiographs | repo | yes | 5 | 5 | 5 | 9.0 MB | 5 | 5 |
| stroke-mri | repo | yes | 2 | 4 | 290 | 1.6 MB | 2 | 4 |
| ct-tumors | repo | yes | 7 | 8 | 583 | 107.9 MB | 7 | 14 |
| book-practice | repo | yes | 0 | 0 | 0 | 0.1 MB | 0 | 24 |
| us-cases | repo | yes | 9 | 9 | 9 | 1.6 MB | 9 | 24 |
| mammo-cbis | repo | yes | 5 | 12 | 12 | 31.4 MB | 5 | 8 |
| peds-msk | repo | yes | 7 | 11 | 11 | 7.5 MB | 7 | 11 |
| us-breast-2 | repo | yes | 98 | 98 | 98 | 17.6 MB | 98 | 392 |
| peds-wrist-2 | repo | yes | 30 | 60 | 60 | 43.3 MB | 30 | 60 |
| cxr-findings-2 | repo | yes | 67 | 67 | 67 | 27.2 MB | 67 | 106 |
| stroke-mri-2 | repo | yes | 50 | 100 | 7240 | 37.1 MB | 50 | 106 |
| mammo-cbis-2 | repo | yes | 11 | 22 | 22 | 55.9 MB | 11 | 33 |

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
| `cxr-00003400-003` | Patient BE · Chest radiograph PA | `nih:ChestX-ray14:3400` | DX | 2 |
| `cxr-00010767-016` | Patient BF · Chest radiograph PA | `nih:ChestX-ray14:10767` | DX | 2 |
| `cxr-00011355-011` | Patient BG · Chest radiograph PA | `nih:ChestX-ray14:11355` | DX | 2 |
| `cxr-00013209-018` | Patient BH · Chest radiograph PA | `nih:ChestX-ray14:13209` | DX | 2 |
| `cxr-00001437-012` | Patient BI · Chest radiograph PA | `nih:ChestX-ray14:1437` | DX | 2 |
| `cxr-00013337-000` | Patient BJ · Chest radiograph PA | `nih:ChestX-ray14:13337` | DX | 2 |
| `cxr-00023058-004` | Patient BK · Chest radiograph PA | `nih:ChestX-ray14:23058` | DX | 2 |
| `cxr-00029894-000` | Patient BL · Chest radiograph PA | `nih:ChestX-ray14:29894` | DX | 2 |
| `cxr-00012299-002` | Patient BM · Chest radiograph PA | `nih:ChestX-ray14:12299` | DX | 2 |
| `cxr-00016267-000` | Patient BN · Chest radiograph PA | `nih:ChestX-ray14:16267` | DX | 2 |
| `cxr-00030674-000` | Patient BO · Chest radiograph PA | `nih:ChestX-ray14:30674` | DX | 2 |
| `cxr-00000377-004` | Patient BP · Chest radiograph PA | `nih:ChestX-ray14:377` | DX | 3 |
| `cxr-00000661-000` | Patient BQ · Chest radiograph PA | `nih:ChestX-ray14:661` | DX | 3 |
| `cxr-00000845-000` | Patient BR · Chest radiograph PA | `nih:ChestX-ray14:845` | DX | 3 |
| `cxr-00001075-024` | Patient BS · Chest radiograph PA | `nih:ChestX-ray14:1075` | DX | 2 |
| `cxr-00011157-001` | Patient BT · Chest radiograph PA | `nih:ChestX-ray14:11157` | DX | 2 |
| `cxr-00022192-003` | Patient BU · Chest radiograph PA | `nih:ChestX-ray14:22192` | DX | 2 |
| `cxr-00020274-021` | Patient BV · Chest radiograph PA | `nih:ChestX-ray14:20274` | DX | 2 |
| `cxr-00012374-000` | Patient BW · Chest radiograph PA | `nih:ChestX-ray14:12374` | DX | 2 |
| `cxr-00013673-001` | Patient BX · Chest radiograph PA | `nih:ChestX-ray14:13673` | DX | 2 |
| `cxr-00001933-000` | Patient BY · Chest radiograph PA | `nih:ChestX-ray14:1933` | DX | 2 |
| `cxr-00003894-005` | Patient BZ · Chest radiograph PA | `nih:ChestX-ray14:3894` | DX | 1 |
| `cxr-00014294-011` | Patient CA · Chest radiograph PA | `nih:ChestX-ray14:14294` | DX | 2 |
| `pe-pat005` | Patient CB · CT chest with contrast | `figshare:FUMPE:PAT005` | CT | 3 |
| `pe-pat021` | Patient CC · CT chest with contrast | `figshare:FUMPE:PAT021` | CT | 3 |
| `ct-crlm-1140` | Patient CD · CT chest, abdomen and pelvis (contrast) | `tcia:Colorectal-Liver-Metastases:CRLM-CT-1140` | CT | 2 |
| `ct-lnq-0230` | Patient CE · CT chest with contrast | `tcia:Mediastinal-Lymph-Node-SEG:case_0230` | CT | 1 |
| `ct-lnq-0837` | Patient CF · CT chest with contrast | `tcia:Mediastinal-Lymph-Node-SEG:case_0837` | CT | 1 |
| `fx-img0000019` | Patient CG · Radiograph, wrist and distal forearm | `figshare:FracAtlas:IMG0000019` | DX | 1 |
| `fx-img0000151` | Patient CH · Radiograph, ankle | `figshare:FracAtlas:IMG0000151` | DX | 1 |
| `fx-img0002302` | Patient CI · Radiograph, shoulder and proximal humerus | `figshare:FracAtlas:IMG0002302` | DX | 1 |
| `fx-img0002308` | Patient CJ · Radiograph, knee and proximal tibia | `figshare:FracAtlas:IMG0002308` | DX | 1 |
| `fx-img0002337` | Patient CK · Radiograph, hip and proximal femur | `figshare:FracAtlas:IMG0002337` | DX | 1 |
| `stroke-isles-0015` | Patient CL · MRI brain | `zenodo:ISLES-2022:sub-strokecase0015` | MR | 3 |
| `stroke-isles-0057` | Patient CM · MRI brain | `zenodo:ISLES-2022:sub-strokecase0057` | MR | 2 |
| `lung-dx-a0010` | Patient CN · CT chest | `tcia:Lung-PET-CT-Dx:Lung_Dx-A0010` | CT | 2 |
| `lung-dx-g0007` | Patient CO · CT chest | `tcia:Lung-PET-CT-Dx:Lung_Dx-G0007` | CT | 2 |
| `lung-dx-b0022` | Patient CP · CT chest | `tcia:Lung-PET-CT-Dx:Lung_Dx-B0022` | CT | 2 |
| `lung-dx-e0004` | Patient CQ · CT chest | `tcia:Lung-PET-CT-Dx:Lung_Dx-E0004` | CT | 2 |
| `hcc-010` | Patient CR · CT abdomen (contrast) | `tcia:HCC-TACE-Seg:HCC_010` | CT | 2 |
| `hcc-003` | Patient CS · CT abdomen (contrast) | `tcia:HCC-TACE-Seg:HCC_003` | CT | 2 |
| `vs-seg-001` | Patient CT · MRI brain | `tcia:Vestibular-Schwannoma-SEG:VS-SEG-001` | MR | 3 |
| `us-breast-case007` | Patient CU · Breast ultrasound | `tcia:Breast-Lesions-USG:case007` | US | 3 |
| `us-breast-case013` | Patient CV · Breast ultrasound | `tcia:Breast-Lesions-USG:case013` | US | 3 |
| `us-breast-case068` | Patient CW · Breast ultrasound | `tcia:Breast-Lesions-USG:case068` | US | 3 |
| `us-breast-case025` | Patient CX · Breast ultrasound | `tcia:Breast-Lesions-USG:case025` | US | 3 |
| `us-breast-case048` | Patient CY · Breast ultrasound | `tcia:Breast-Lesions-USG:case048` | US | 3 |
| `us-breast-case237` | Patient CZ · Breast ultrasound | `tcia:Breast-Lesions-USG:case237` | US | 3 |
| `us-fetal-head-113` | Patient DA · Obstetric ultrasound | `zenodo:HC18:113_HC` | US | 2 |
| `us-fetal-head-365` | Patient DB · Obstetric ultrasound | `zenodo:HC18:365_HC` | US | 2 |
| `us-fetal-head-687` | Patient DC · Obstetric ultrasound | `zenodo:HC18:687_HC` | US | 2 |
| `mg-cbis-p00021` | Patient DD · Mammogram, both breasts, CC and MLO | `tcia:CBIS-DDSM:P_00021` | MG | 2 |
| `mg-cbis-p00039` | Patient DE · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00039` | MG | 2 |
| `mg-cbis-p00051` | Patient DF · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_00051` | MG | 2 |
| `mg-cbis-p00307` | Patient DG · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_00307` | MG | 1 |
| `mg-cbis-p00425` | Patient DH · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00425` | MG | 1 |
| `peds-wrist-3390` | Patient DI · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3390` | DX | 2 |
| `peds-wrist-3853` | Patient DJ · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3853` | DX | 2 |
| `peds-wrist-0030` | Patient DK · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:30` | DX | 2 |
| `peds-wrist-0071` | Patient DL · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:71` | DX | 2 |
| `knee-kl-196c5239` | Patient DM · Knee radiograph | `mendeley:Digital-Knee-X-ray:196c52391d8a` | DX | 1 |
| `knee-kl-0b79036f` | Patient DN · Knee radiograph | `mendeley:Digital-Knee-X-ray:0b79036fc768` | DX | 1 |
| `knee-kl-bbbd048a` | Patient DO · Knee radiograph | `mendeley:Digital-Knee-X-ray:bbbd048a1720` | DX | 1 |
| `us-breast-case005` | Patient EA · Breast ultrasound | `tcia:Breast-Lesions-USG:case005` | US | 4 |
| `us-breast-case008` | Patient EB · Breast ultrasound | `tcia:Breast-Lesions-USG:case008` | US | 4 |
| `us-breast-case010` | Patient EC · Breast ultrasound | `tcia:Breast-Lesions-USG:case010` | US | 4 |
| `us-breast-case011` | Patient ED · Breast ultrasound | `tcia:Breast-Lesions-USG:case011` | US | 4 |
| `us-breast-case012` | Patient EE · Breast ultrasound | `tcia:Breast-Lesions-USG:case012` | US | 4 |
| `us-breast-case026` | Patient EF · Breast ultrasound | `tcia:Breast-Lesions-USG:case026` | US | 4 |
| `us-breast-case027` | Patient EG · Breast ultrasound | `tcia:Breast-Lesions-USG:case027` | US | 4 |
| `us-breast-case032` | Patient EH · Breast ultrasound | `tcia:Breast-Lesions-USG:case032` | US | 4 |
| `us-breast-case034` | Patient EI · Breast ultrasound | `tcia:Breast-Lesions-USG:case034` | US | 4 |
| `us-breast-case035` | Patient EJ · Breast ultrasound | `tcia:Breast-Lesions-USG:case035` | US | 4 |
| `us-breast-case046` | Patient EK · Breast ultrasound | `tcia:Breast-Lesions-USG:case046` | US | 4 |
| `us-breast-case050` | Patient EL · Breast ultrasound | `tcia:Breast-Lesions-USG:case050` | US | 4 |
| `us-breast-case053` | Patient EM · Breast ultrasound | `tcia:Breast-Lesions-USG:case053` | US | 4 |
| `us-breast-case055` | Patient EN · Breast ultrasound | `tcia:Breast-Lesions-USG:case055` | US | 4 |
| `us-breast-case058` | Patient EO · Breast ultrasound | `tcia:Breast-Lesions-USG:case058` | US | 4 |
| `us-breast-case063` | Patient EP · Breast ultrasound | `tcia:Breast-Lesions-USG:case063` | US | 4 |
| `us-breast-case067` | Patient EQ · Breast ultrasound | `tcia:Breast-Lesions-USG:case067` | US | 4 |
| `us-breast-case072` | Patient ER · Breast ultrasound | `tcia:Breast-Lesions-USG:case072` | US | 4 |
| `us-breast-case075` | Patient ES · Breast ultrasound | `tcia:Breast-Lesions-USG:case075` | US | 4 |
| `us-breast-case079` | Patient ET · Breast ultrasound | `tcia:Breast-Lesions-USG:case079` | US | 4 |
| `us-breast-case082` | Patient EU · Breast ultrasound | `tcia:Breast-Lesions-USG:case082` | US | 4 |
| `us-breast-case087` | Patient EV · Breast ultrasound | `tcia:Breast-Lesions-USG:case087` | US | 4 |
| `us-breast-case088` | Patient EW · Breast ultrasound | `tcia:Breast-Lesions-USG:case088` | US | 4 |
| `us-breast-case094` | Patient EX · Breast ultrasound | `tcia:Breast-Lesions-USG:case094` | US | 4 |
| `us-breast-case101` | Patient EY · Breast ultrasound | `tcia:Breast-Lesions-USG:case101` | US | 4 |
| `us-breast-case102` | Patient EZ · Breast ultrasound | `tcia:Breast-Lesions-USG:case102` | US | 4 |
| `us-breast-case106` | Patient FA · Breast ultrasound | `tcia:Breast-Lesions-USG:case106` | US | 4 |
| `us-breast-case109` | Patient FB · Breast ultrasound | `tcia:Breast-Lesions-USG:case109` | US | 4 |
| `us-breast-case111` | Patient FC · Breast ultrasound | `tcia:Breast-Lesions-USG:case111` | US | 4 |
| `us-breast-case113` | Patient FD · Breast ultrasound | `tcia:Breast-Lesions-USG:case113` | US | 4 |
| `us-breast-case117` | Patient FE · Breast ultrasound | `tcia:Breast-Lesions-USG:case117` | US | 4 |
| `us-breast-case125` | Patient FF · Breast ultrasound | `tcia:Breast-Lesions-USG:case125` | US | 4 |
| `us-breast-case132` | Patient FG · Breast ultrasound | `tcia:Breast-Lesions-USG:case132` | US | 4 |
| `us-breast-case133` | Patient FH · Breast ultrasound | `tcia:Breast-Lesions-USG:case133` | US | 4 |
| `us-breast-case150` | Patient FI · Breast ultrasound | `tcia:Breast-Lesions-USG:case150` | US | 4 |
| `us-breast-case172` | Patient FJ · Breast ultrasound | `tcia:Breast-Lesions-USG:case172` | US | 4 |
| `us-breast-case176` | Patient FK · Breast ultrasound | `tcia:Breast-Lesions-USG:case176` | US | 4 |
| `us-breast-case199` | Patient FL · Breast ultrasound | `tcia:Breast-Lesions-USG:case199` | US | 4 |
| `us-breast-case206` | Patient FM · Breast ultrasound | `tcia:Breast-Lesions-USG:case206` | US | 4 |
| `us-breast-case212` | Patient FN · Breast ultrasound | `tcia:Breast-Lesions-USG:case212` | US | 4 |
| `us-breast-case225` | Patient FO · Breast ultrasound | `tcia:Breast-Lesions-USG:case225` | US | 4 |
| `us-breast-case230` | Patient FP · Breast ultrasound | `tcia:Breast-Lesions-USG:case230` | US | 4 |
| `us-breast-case249` | Patient FQ · Breast ultrasound | `tcia:Breast-Lesions-USG:case249` | US | 4 |
| `us-breast-case254` | Patient FR · Breast ultrasound | `tcia:Breast-Lesions-USG:case254` | US | 4 |
| `us-breast-case255` | Patient FS · Breast ultrasound | `tcia:Breast-Lesions-USG:case255` | US | 4 |
| `us-breast-case002` | Patient FT · Breast ultrasound | `tcia:Breast-Lesions-USG:case002` | US | 4 |
| `us-breast-case006` | Patient FU · Breast ultrasound | `tcia:Breast-Lesions-USG:case006` | US | 4 |
| `us-breast-case009` | Patient FV · Breast ultrasound | `tcia:Breast-Lesions-USG:case009` | US | 4 |
| `us-breast-case014` | Patient FW · Breast ultrasound | `tcia:Breast-Lesions-USG:case014` | US | 4 |
| `us-breast-case016` | Patient FX · Breast ultrasound | `tcia:Breast-Lesions-USG:case016` | US | 4 |
| `us-breast-case018` | Patient FY · Breast ultrasound | `tcia:Breast-Lesions-USG:case018` | US | 4 |
| `us-breast-case019` | Patient FZ · Breast ultrasound | `tcia:Breast-Lesions-USG:case019` | US | 4 |
| `us-breast-case021` | Patient GA · Breast ultrasound | `tcia:Breast-Lesions-USG:case021` | US | 4 |
| `us-breast-case023` | Patient GB · Breast ultrasound | `tcia:Breast-Lesions-USG:case023` | US | 4 |
| `us-breast-case024` | Patient GC · Breast ultrasound | `tcia:Breast-Lesions-USG:case024` | US | 4 |
| `us-breast-case031` | Patient GD · Breast ultrasound | `tcia:Breast-Lesions-USG:case031` | US | 4 |
| `us-breast-case037` | Patient GE · Breast ultrasound | `tcia:Breast-Lesions-USG:case037` | US | 4 |
| `us-breast-case041` | Patient GF · Breast ultrasound | `tcia:Breast-Lesions-USG:case041` | US | 4 |
| `us-breast-case042` | Patient GG · Breast ultrasound | `tcia:Breast-Lesions-USG:case042` | US | 4 |
| `us-breast-case044` | Patient GH · Breast ultrasound | `tcia:Breast-Lesions-USG:case044` | US | 4 |
| `us-breast-case047` | Patient GI · Breast ultrasound | `tcia:Breast-Lesions-USG:case047` | US | 4 |
| `us-breast-case051` | Patient GJ · Breast ultrasound | `tcia:Breast-Lesions-USG:case051` | US | 4 |
| `us-breast-case056` | Patient GK · Breast ultrasound | `tcia:Breast-Lesions-USG:case056` | US | 4 |
| `us-breast-case069` | Patient GL · Breast ultrasound | `tcia:Breast-Lesions-USG:case069` | US | 4 |
| `us-breast-case071` | Patient GM · Breast ultrasound | `tcia:Breast-Lesions-USG:case071` | US | 4 |
| `us-breast-case077` | Patient GN · Breast ultrasound | `tcia:Breast-Lesions-USG:case077` | US | 4 |
| `us-breast-case078` | Patient GO · Breast ultrasound | `tcia:Breast-Lesions-USG:case078` | US | 4 |
| `us-breast-case081` | Patient GP · Breast ultrasound | `tcia:Breast-Lesions-USG:case081` | US | 4 |
| `us-breast-case093` | Patient GQ · Breast ultrasound | `tcia:Breast-Lesions-USG:case093` | US | 4 |
| `us-breast-case115` | Patient GR · Breast ultrasound | `tcia:Breast-Lesions-USG:case115` | US | 4 |
| `us-breast-case119` | Patient GS · Breast ultrasound | `tcia:Breast-Lesions-USG:case119` | US | 4 |
| `us-breast-case120` | Patient GT · Breast ultrasound | `tcia:Breast-Lesions-USG:case120` | US | 4 |
| `us-breast-case129` | Patient GU · Breast ultrasound | `tcia:Breast-Lesions-USG:case129` | US | 4 |
| `us-breast-case143` | Patient GV · Breast ultrasound | `tcia:Breast-Lesions-USG:case143` | US | 4 |
| `us-breast-case162` | Patient GW · Breast ultrasound | `tcia:Breast-Lesions-USG:case162` | US | 4 |
| `us-breast-case168` | Patient GX · Breast ultrasound | `tcia:Breast-Lesions-USG:case168` | US | 4 |
| `us-breast-case179` | Patient GY · Breast ultrasound | `tcia:Breast-Lesions-USG:case179` | US | 4 |
| `us-breast-case182` | Patient GZ · Breast ultrasound | `tcia:Breast-Lesions-USG:case182` | US | 4 |
| `us-breast-case229` | Patient HA · Breast ultrasound | `tcia:Breast-Lesions-USG:case229` | US | 4 |
| `us-breast-case004` | Patient HB · Breast ultrasound | `tcia:Breast-Lesions-USG:case004` | US | 4 |
| `us-breast-case028` | Patient HC · Breast ultrasound | `tcia:Breast-Lesions-USG:case028` | US | 4 |
| `us-breast-case029` | Patient HD · Breast ultrasound | `tcia:Breast-Lesions-USG:case029` | US | 4 |
| `us-breast-case030` | Patient HE · Breast ultrasound | `tcia:Breast-Lesions-USG:case030` | US | 4 |
| `us-breast-case052` | Patient HF · Breast ultrasound | `tcia:Breast-Lesions-USG:case052` | US | 4 |
| `us-breast-case065` | Patient HG · Breast ultrasound | `tcia:Breast-Lesions-USG:case065` | US | 4 |
| `us-breast-case091` | Patient HH · Breast ultrasound | `tcia:Breast-Lesions-USG:case091` | US | 4 |
| `us-breast-case096` | Patient HI · Breast ultrasound | `tcia:Breast-Lesions-USG:case096` | US | 4 |
| `us-breast-case097` | Patient HJ · Breast ultrasound | `tcia:Breast-Lesions-USG:case097` | US | 4 |
| `us-breast-case108` | Patient HK · Breast ultrasound | `tcia:Breast-Lesions-USG:case108` | US | 4 |
| `us-breast-case118` | Patient HL · Breast ultrasound | `tcia:Breast-Lesions-USG:case118` | US | 4 |
| `us-breast-case136` | Patient HM · Breast ultrasound | `tcia:Breast-Lesions-USG:case136` | US | 4 |
| `us-breast-case167` | Patient HN · Breast ultrasound | `tcia:Breast-Lesions-USG:case167` | US | 4 |
| `us-breast-case175` | Patient HO · Breast ultrasound | `tcia:Breast-Lesions-USG:case175` | US | 4 |
| `us-breast-case196` | Patient HP · Breast ultrasound | `tcia:Breast-Lesions-USG:case196` | US | 4 |
| `us-breast-case216` | Patient HQ · Breast ultrasound | `tcia:Breast-Lesions-USG:case216` | US | 4 |
| `us-breast-case222` | Patient HR · Breast ultrasound | `tcia:Breast-Lesions-USG:case222` | US | 4 |
| `us-breast-case235` | Patient HS · Breast ultrasound | `tcia:Breast-Lesions-USG:case235` | US | 4 |
| `us-breast-case240` | Patient HT · Breast ultrasound | `tcia:Breast-Lesions-USG:case240` | US | 4 |
| `xr-wrist-child-0040` | Patient MH · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:40` | DX | 2 |
| `xr-wrist-child-0646` | Patient MI · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:646` | DX | 2 |
| `xr-wrist-child-1789` | Patient MJ · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:1789` | DX | 2 |
| `xr-wrist-child-2262` | Patient MK · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:2262` | DX | 2 |
| `xr-wrist-child-2813` | Patient ML · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:2813` | DX | 2 |
| `xr-wrist-child-3391` | Patient MM · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3391` | DX | 2 |
| `xr-wrist-child-4206` | Patient MN · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4206` | DX | 2 |
| `xr-wrist-child-4537` | Patient MO · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4537` | DX | 2 |
| `xr-wrist-child-5647` | Patient MP · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:5647` | DX | 2 |
| `xr-wrist-child-5980` | Patient MQ · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:5980` | DX | 2 |
| `xr-wrist-child-0006` | Patient MR · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:6` | DX | 2 |
| `xr-wrist-child-0835` | Patient MS · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:835` | DX | 2 |
| `xr-wrist-child-1398` | Patient MT · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:1398` | DX | 2 |
| `xr-wrist-child-2161` | Patient MU · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:2161` | DX | 2 |
| `xr-wrist-child-2848` | Patient MV · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:2848` | DX | 2 |
| `xr-wrist-child-3386` | Patient MW · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3386` | DX | 2 |
| `xr-wrist-child-4026` | Patient MX · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4026` | DX | 2 |
| `xr-wrist-child-4721` | Patient MY · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4721` | DX | 2 |
| `xr-wrist-child-5393` | Patient MZ · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:5393` | DX | 2 |
| `xr-wrist-child-6079` | Patient NA · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:6079` | DX | 2 |
| `xr-wrist-child-0177` | Patient NB · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:177` | DX | 2 |
| `xr-wrist-child-1241` | Patient NC · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:1241` | DX | 2 |
| `xr-wrist-child-1668` | Patient ND · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:1668` | DX | 2 |
| `xr-wrist-child-2157` | Patient NE · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:2157` | DX | 2 |
| `xr-wrist-child-3065` | Patient NF · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3065` | DX | 2 |
| `xr-wrist-child-3582` | Patient NG · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:3582` | DX | 2 |
| `xr-wrist-child-4169` | Patient NH · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4169` | DX | 2 |
| `xr-wrist-child-4851` | Patient NI · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:4851` | DX | 2 |
| `xr-wrist-child-5382` | Patient NJ · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:5382` | DX | 2 |
| `xr-wrist-child-6093` | Patient NK · Wrist radiographs, child | `figshare:GRAZPEDWRI-DX:6093` | DX | 2 |
| `cxr-00018055-005` | Patient JS · Chest radiograph PA | `nih:ChestX-ray14:18055` | DX | 2 |
| `cxr-00020318-022` | Patient JT · Chest radiograph PA | `nih:ChestX-ray14:20318` | DX | 2 |
| `cxr-00021782-028` | Patient JU · Chest radiograph PA | `nih:ChestX-ray14:21782` | DX | 2 |
| `cxr-00025954-025` | Patient JV · Chest radiograph PA | `nih:ChestX-ray14:25954` | DX | 2 |
| `cxr-00028876-027` | Patient JW · Chest radiograph PA | `nih:ChestX-ray14:28876` | DX | 2 |
| `cxr-00021181-002` | Patient JX · Chest radiograph PA | `nih:ChestX-ray14:21181` | DX | 2 |
| `cxr-00014015-003` | Patient JY · Chest radiograph PA | `nih:ChestX-ray14:14015` | DX | 2 |
| `cxr-00026136-002` | Patient JZ · Chest radiograph PA | `nih:ChestX-ray14:26136` | DX | 2 |
| `cxr-00020810-003` | Patient KA · Chest radiograph PA | `nih:ChestX-ray14:20810` | DX | 2 |
| `cxr-00018762-002` | Patient KB · Chest radiograph PA | `nih:ChestX-ray14:18762` | DX | 2 |
| `cxr-00012291-008` | Patient KC · Chest radiograph PA | `nih:ChestX-ray14:12291` | DX | 2 |
| `cxr-00009619-000` | Patient KD · Chest radiograph PA | `nih:ChestX-ray14:9619` | DX | 2 |
| `cxr-00010481-021` | Patient KE · Chest radiograph PA | `nih:ChestX-ray14:10481` | DX | 2 |
| `cxr-00016490-011` | Patient KF · Chest radiograph PA | `nih:ChestX-ray14:16490` | DX | 2 |
| `cxr-00001369-000` | Patient KG · Chest radiograph PA | `nih:ChestX-ray14:1369` | DX | 2 |
| `cxr-00004344-013` | Patient KH · Chest radiograph PA | `nih:ChestX-ray14:4344` | DX | 2 |
| `cxr-00004534-001` | Patient KI · Chest radiograph PA | `nih:ChestX-ray14:4534` | DX | 2 |
| `cxr-00005532-000` | Patient KJ · Chest radiograph PA | `nih:ChestX-ray14:5532` | DX | 2 |
| `cxr-00007043-000` | Patient KK · Chest radiograph PA | `nih:ChestX-ray14:7043` | DX | 2 |
| `cxr-00008399-007` | Patient KL · Chest radiograph PA | `nih:ChestX-ray14:8399` | DX | 2 |
| `cxr-00009745-000` | Patient KM · Chest radiograph PA | `nih:ChestX-ray14:9745` | DX | 2 |
| `cxr-00011322-002` | Patient KN · Chest radiograph PA | `nih:ChestX-ray14:11322` | DX | 2 |
| `cxr-00018101-012` | Patient KO · Chest radiograph PA | `nih:ChestX-ray14:18101` | DX | 2 |
| `cxr-00012270-005` | Patient KP · Chest radiograph PA | `nih:ChestX-ray14:12270` | DX | 2 |
| `cxr-00010815-006` | Patient KQ · Chest radiograph PA | `nih:ChestX-ray14:10815` | DX | 1 |
| `cxr-00022726-002` | Patient KR · Chest radiograph PA | `nih:ChestX-ray14:22726` | DX | 1 |
| `cxr-00012892-010` | Patient KS · Chest radiograph PA | `nih:ChestX-ray14:12892` | DX | 1 |
| `cxr-00001555-002` | Patient KT · Chest radiograph PA | `nih:ChestX-ray14:1555` | DX | 2 |
| `cxr-00020393-001` | Patient KU · Chest radiograph PA | `nih:ChestX-ray14:20393` | DX | 2 |
| `cxr-00013951-001` | Patient KV · Chest radiograph PA | `nih:ChestX-ray14:13951` | DX | 2 |
| `cxr-00013885-000` | Patient KW · Chest radiograph PA | `nih:ChestX-ray14:13885` | DX | 2 |
| `cxr-00010103-014` | Patient KX · Chest radiograph PA | `nih:ChestX-ray14:10103` | DX | 2 |
| `cxr-00015583-000` | Patient KY · Chest radiograph PA | `nih:ChestX-ray14:15583` | DX | 2 |
| `cxr-00010610-003` | Patient KZ · Chest radiograph PA | `nih:ChestX-ray14:10610` | DX | 2 |
| `cxr-00011583-000` | Patient LA · Chest radiograph PA | `nih:ChestX-ray14:11583` | DX | 2 |
| `cxr-00013391-005` | Patient LB · Chest radiograph PA | `nih:ChestX-ray14:13391` | DX | 2 |
| `cxr-00007471-003` | Patient LC · Chest radiograph PA | `nih:ChestX-ray14:7471` | DX | 1 |
| `cxr-00019124-006` | Patient LD · Chest radiograph PA | `nih:ChestX-ray14:19124` | DX | 1 |
| `cxr-00027278-007` | Patient LE · Chest radiograph PA | `nih:ChestX-ray14:27278` | DX | 1 |
| `cxr-00015078-013` | Patient LF · Chest radiograph PA | `nih:ChestX-ray14:15078` | DX | 1 |
| `cxr-00026753-008` | Patient LG · Chest radiograph PA | `nih:ChestX-ray14:26753` | DX | 1 |
| `cxr-00014738-000` | Patient LH · Chest radiograph PA | `nih:ChestX-ray14:14738` | DX | 1 |
| `cxr-00003072-028` | Patient LI · Chest radiograph PA | `nih:ChestX-ray14:3072` | DX | 1 |
| `cxr-00027875-005` | Patient LJ · Chest radiograph PA | `nih:ChestX-ray14:27875` | DX | 1 |
| `cxr-00023093-007` | Patient LK · Chest radiograph PA | `nih:ChestX-ray14:23093` | DX | 1 |
| `cxr-00020405-041` | Patient LL · Chest radiograph PA | `nih:ChestX-ray14:20405` | DX | 2 |
| `cxr-00020000-000` | Patient LM · Chest radiograph PA | `nih:ChestX-ray14:20000` | DX | 1 |
| `cxr-00000756-001` | Patient LN · Chest radiograph PA | `nih:ChestX-ray14:756` | DX | 1 |
| `cxr-00016414-000` | Patient LO · Chest radiograph PA | `nih:ChestX-ray14:16414` | DX | 2 |
| `cxr-00021443-000` | Patient LP · Chest radiograph PA | `nih:ChestX-ray14:21443` | DX | 2 |
| `cxr-00018693-004` | Patient LQ · Chest radiograph PA | `nih:ChestX-ray14:18693` | DX | 1 |
| `cxr-00012686-003` | Patient LR · Chest radiograph PA | `nih:ChestX-ray14:12686` | DX | 1 |
| `cxr-00022215-012` | Patient LS · Chest radiograph PA | `nih:ChestX-ray14:22215` | DX | 1 |
| `cxr-00019861-010` | Patient LT · Chest radiograph PA | `nih:ChestX-ray14:19861` | DX | 1 |
| `cxr-00008339-010` | Patient LU · Chest radiograph PA | `nih:ChestX-ray14:8339` | DX | 2 |
| `cxr-00009705-000` | Patient LV · Chest radiograph PA | `nih:ChestX-ray14:9705` | DX | 1 |
| `cxr-00021179-011` | Patient LW · Chest radiograph PA | `nih:ChestX-ray14:21179` | DX | 1 |
| `cxr-00020124-003` | Patient LX · Chest radiograph PA | `nih:ChestX-ray14:20124` | DX | 1 |
| `cxr-00004911-018` | Patient LY · Chest radiograph PA | `nih:ChestX-ray14:4911` | DX | 1 |
| `cxr-00017952-008` | Patient LZ · Chest radiograph PA | `nih:ChestX-ray14:17952` | DX | 1 |
| `cxr-00021818-026` | Patient MA · Chest radiograph PA | `nih:ChestX-ray14:21818` | DX | 2 |
| `cxr-00012576-004` | Patient MB · Chest radiograph PA | `nih:ChestX-ray14:12576` | DX | 1 |
| `cxr-00003064-035` | Patient MC · Chest radiograph PA | `nih:ChestX-ray14:3064` | DX | 1 |
| `cxr-00015090-006` | Patient MD · Chest radiograph PA | `nih:ChestX-ray14:15090` | DX | 1 |
| `cxr-00009507-004` | Patient ME · Chest radiograph PA | `nih:ChestX-ray14:9507` | DX | 2 |
| `cxr-00021670-004` | Patient MF · Chest radiograph PA | `nih:ChestX-ray14:21670` | DX | 1 |
| `cxr-00011136-002` | Patient MG · Chest radiograph PA | `nih:ChestX-ray14:11136` | DX | 1 |
| `mr-diffusion-0004` | Patient HU · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0004` | MR | 2 |
| `mr-diffusion-0075` | Patient HV · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0075` | MR | 1 |
| `mr-diffusion-0142` | Patient HW · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0142` | MR | 2 |
| `mr-diffusion-0214` | Patient HX · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0214` | MR | 2 |
| `mr-diffusion-0051` | Patient HY · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0051` | MR | 2 |
| `mr-diffusion-0124` | Patient HZ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0124` | MR | 3 |
| `mr-diffusion-0058` | Patient IA · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0058` | MR | 1 |
| `mr-diffusion-0157` | Patient IB · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0157` | MR | 2 |
| `mr-diffusion-0068` | Patient IC · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0068` | MR | 2 |
| `mr-diffusion-0126` | Patient ID · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0126` | MR | 2 |
| `mr-diffusion-0108` | Patient IE · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0108` | MR | 1 |
| `mr-diffusion-0094` | Patient IF · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0094` | MR | 2 |
| `mr-diffusion-0145` | Patient IG · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0145` | MR | 3 |
| `mr-diffusion-0041` | Patient IH · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0041` | MR | 1 |
| `mr-diffusion-0163` | Patient II · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0163` | MR | 3 |
| `mr-diffusion-0172` | Patient IJ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0172` | MR | 2 |
| `mr-diffusion-0063` | Patient IK · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0063` | MR | 3 |
| `mr-diffusion-0114` | Patient IL · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0114` | MR | 3 |
| `mr-diffusion-0027` | Patient IM · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0027` | MR | 2 |
| `mr-diffusion-0242` | Patient IN · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0242` | MR | 2 |
| `mr-diffusion-0097` | Patient IO · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0097` | MR | 2 |
| `mr-diffusion-0029` | Patient IP · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0029` | MR | 2 |
| `mr-diffusion-0110` | Patient IQ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0110` | MR | 2 |
| `mr-diffusion-0040` | Patient IR · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0040` | MR | 2 |
| `mr-diffusion-0235` | Patient IS · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0235` | MR | 2 |
| `mr-diffusion-0218` | Patient IT · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0218` | MR | 2 |
| `mr-diffusion-0156` | Patient IU · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0156` | MR | 2 |
| `mr-diffusion-0178` | Patient IV · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0178` | MR | 2 |
| `mr-diffusion-0017` | Patient IW · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0017` | MR | 1 |
| `mr-diffusion-0021` | Patient IX · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0021` | MR | 2 |
| `mr-diffusion-0247` | Patient IY · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0247` | MR | 3 |
| `mr-diffusion-0180` | Patient IZ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0180` | MR | 2 |
| `mr-diffusion-0055` | Patient JA · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0055` | MR | 2 |
| `mr-diffusion-0179` | Patient JB · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0179` | MR | 3 |
| `mr-diffusion-0120` | Patient JC · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0120` | MR | 3 |
| `mr-diffusion-0043` | Patient JD · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0043` | MR | 3 |
| `mr-diffusion-0231` | Patient JE · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0231` | MR | 2 |
| `mr-diffusion-0125` | Patient JF · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0125` | MR | 3 |
| `mr-diffusion-0107` | Patient JG · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0107` | MR | 2 |
| `mr-diffusion-0086` | Patient JH · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0086` | MR | 2 |
| `mr-diffusion-0217` | Patient JI · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0217` | MR | 2 |
| `mr-diffusion-0211` | Patient JJ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0211` | MR | 3 |
| `mr-diffusion-0019` | Patient JK · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0019` | MR | 2 |
| `mr-diffusion-0104` | Patient JL · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0104` | MR | 2 |
| `mr-diffusion-0123` | Patient JM · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0123` | MR | 3 |
| `mr-diffusion-0083` | Patient JN · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0083` | MR | 2 |
| `mr-diffusion-0081` | Patient JO · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0081` | MR | 3 |
| `mr-diffusion-0140` | Patient JP · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0140` | MR | 1 |
| `mr-diffusion-0062` | Patient JQ · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0062` | MR | 2 |
| `mr-diffusion-0023` | Patient JR · MRI brain, diffusion | `zenodo:ISLES-2022:sub-strokecase0023` | MR | 1 |
| `mg-p00732` | Patient NL · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_00732` | MG | 3 |
| `mg-p01356` | Patient NM · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_01356` | MG | 3 |
| `mg-p01780` | Patient NN · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_01780` | MG | 3 |
| `mg-p00018` | Patient NO · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00018` | MG | 3 |
| `mg-p00781` | Patient NP · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00781` | MG | 3 |
| `mg-p01739` | Patient NQ · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_01739` | MG | 3 |
| `mg-p00014` | Patient NR · Mammogram, left breast, CC and MLO | `tcia:CBIS-DDSM:P_00014` | MG | 3 |
| `mg-p02489` | Patient NS · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_02489` | MG | 3 |
| `mg-p00992` | Patient NT · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00992` | MG | 3 |
| `mg-p00506` | Patient NU · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00506` | MG | 3 |
| `mg-p00456` | Patient NV · Mammogram, right breast, CC and MLO | `tcia:CBIS-DDSM:P_00456` | MG | 3 |

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

- `1.2.840.10008.1.2.4.80`: 490 series
- `1.2.840.10008.1.2`: 5 series
- `1.2.840.10008.1.2.4.90`: 3 series
- `1.2.840.10008.1.2.5`: 1 series
- `1.2.840.10008.1.2.4.70`: 6 series

MONOCHROME1 series: 1. Volume (MPR) eligible series: 169. Scouts/localizers: 3.
