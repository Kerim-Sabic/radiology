# Content inventory

_Generated 2026-10-28 by `scripts/report/content-report.mjs` from the installed files. Counts are distinct real patients/studies/series — not slices, not repeated questions, not planned sources._

## Totals

| | count |
|---|---|
| Distinct patients with usable cases | **51** |
| Teaching cases | 51 |
| Image-based tasks | **220** |
| Studies | 71 |
| Series (all packs) | 81 |
| DICOM instances | 6696 |
| Reference targets | 3986 |

### Tasks by scoring basis

| basis | tasks |
|---|---|
| auto-checked choice | 26 |
| self-review (checklist) | 96 |
| spatial · AI draft by Horalix / dataset auto-label reference (self-review until user review) | 15 |
| spatial · source manual reference | 83 |

### Tasks by type

| type | tasks |
|---|---|
| choose window | 7 |
| compare appearances | 9 |
| correlate modalities | 12 |
| describe finding | 55 |
| differential | 17 |
| find structure | 76 |
| locate finding | 10 |
| navigate level | 24 |
| whole study | 10 |

### Reference targets by provenance

| provenance | targets |
|---|---|
| ai_draft | 3715 |
| source_automated | 3 |
| source_manual | 268 |

## Packs

| pack | distribution | binaries here | subjects | series | instances | bytes (index) | cases | tasks |
|---|---|---|---|---|---|---|---|---|
| starter | repo | yes | 3 | 4 | 152 | 32.0 MB | 3 | 13 |
| chest-pairs | fetch_script | yes | 6 | 16 | 807 | 201.9 MB | 6 | 33 |
| ct-mri-pairs | fetch_script | yes | 2 | 6 | 462 | 59.8 MB | 2 | 10 |
| body | fetch_script | yes | 4 | 4 | 485 | 83.1 MB | 4 | 13 |
| neuro-msk | fetch_script | yes | 3 | 5 | 523 | 54.8 MB | 3 | 8 |
| expansion | fetch_script | yes | 12 | 17 | 1892 | 263.1 MB | 12 | 39 |
| vessel-drafts | repo | yes | 0 | 0 | 0 | 1.1 MB | 0 | 15 |
| anatomy-atlas | repo | yes | 0 | 0 | 0 | 59.1 MB | 0 | 0 |
| more-ct-xr | fetch_script | yes | 21 | 29 | 2375 | 488.6 MB | 21 | 89 |

## Patients and cases

| case | neutral title | subject (source namespace) | modalities | tasks |
|---|---|---|---|---|
| `starter-ct-chest-01` | Patient A · CT chest | `tcia:LCTSC:LCTSC-Train-S1-012` | CT | 7 |
| `starter-cxr-01` | Patient B · Chest radiograph + CT localizer | `tcia:COVID-19-AR:COVID-19-AR-16406503` | CR+CT | 4 |
| `starter-mr-prostate-01` | Patient C · MRI pelvis (axial) | `tcia:PROSTATEx:ProstateX-0004` | MR | 2 |
| `chest-pairs-lidc-idri-0078` | Patient D · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0078` | CT+CR | 7 |
| `chest-pairs-lidc-idri-0217` | Patient E · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0217` | CT+DX | 7 |
| `chest-pairs-lidc-idri-0053` | Patient F · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0053` | CT+DX | 10 |
| `chest-pairs-covid-19-ar-16434363` | Patient G · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16434363` | DX+CT | 8 |
| `chest-pairs-covid-19-ar-16406502` | Patient H · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16406502` | CT+DX | 5 |
| `chest-pairs-covid-19-ar-16434411` | Patient I · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16434411` | CT+DX | 8 |
| `ctmri-sts-033` | Patient N · MRI + CT of an extremity | `tcia:Soft-tissue-Sarcoma:STS_033` | CT+MR | 5 |
| `ctmri-sts-042` | Patient O · MRI + CT of an extremity | `tcia:Soft-tissue-Sarcoma:STS_042` | MR+CT | 5 |
| `body-lctsc-train-s2-003` | Patient J · CT chest | `tcia:LCTSC:LCTSC-Train-S2-003` | CT | 4 |
| `body-lctsc-train-s3-006` | Patient K · CT chest | `tcia:LCTSC:LCTSC-Train-S3-006` | CT | 4 |
| `body-covid-19-ar-16406498` | Patient L · CT chest | `tcia:COVID-19-AR:COVID-19-AR-16406498` | CT | 4 |
| `body-kits-00015` | Patient M · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00015` | CT | 4 |
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
| `exp-kits-00045` | Patient Z · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00045` | CT | 2 |
| `exp-kits-00204` | Patient BA · CT abdomen (contrast) | `tcia:C4KC-KiTS:KiTS-00204` | CT | 2 |
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
| `more-covid-19-ar-16445122` | Patient AK · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16445122` | CT+DX | 5 |
| `more-covid-19-ar-16445138` | Patient AL · Chest radiograph + CT chest | `tcia:COVID-19-AR:COVID-19-AR-16445138` | DX+CT | 5 |
| `more-covid-19-ar-16424076` | Patient AM · Chest radiograph + CT chest, abdomen and pelvis | `tcia:COVID-19-AR:COVID-19-AR-16424076` | DX+CT | 5 |
| `more-covid-19-ar-16434369` | Patient AN · Chest radiograph + CT chest, abdomen and pelvis | `tcia:COVID-19-AR:COVID-19-AR-16434369` | DX+CT | 5 |
| `more-lidc-idri-0282` | Patient AO · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0282` | CT+DX | 5 |
| `more-lidc-idri-0289` | Patient AP · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0289` | CT+DX | 5 |
| `more-lidc-idri-0018` | Patient AQ · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0018` | DX+CT | 5 |
| `more-lidc-idri-0149` | Patient AR · Chest radiograph + CT chest | `tcia:LIDC-IDRI:LIDC-IDRI-0149` | DX+CT | 5 |
| `more-lctsc-train-s1-007` | Patient AS · CT chest | `tcia:LCTSC:LCTSC-Train-S1-007` | CT | 2 |
| `more-lctsc-train-s2-004` | Patient AT · CT chest | `tcia:LCTSC:LCTSC-Train-S2-004` | CT | 2 |
| `more-lctsc-test-s3-202` | Patient AU · CT chest | `tcia:LCTSC:LCTSC-Test-S3-202` | CT | 2 |

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

- `1.2.840.10008.1.2.4.80`: 66 series
- `1.2.840.10008.1.2`: 5 series
- `1.2.840.10008.1.2.4.90`: 3 series
- `1.2.840.10008.1.2.5`: 1 series
- `1.2.840.10008.1.2.4.70`: 6 series

MONOCHROME1 series: 1. Volume (MPR) eligible series: 52. Scouts/localizers: 3.
