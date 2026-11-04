# Round 5: more patients from the open sources already in use

Six packs added on 3 November 2026, built exactly like round 4 (docs/data/round4-data.md): every new patient is a different person from every earlier pack, every graded answer comes from the source dataset's expert annotation or clinical data, and nothing graded was marked by us. Fetch: `scripts/data/external_r5.py`; build: `scripts/data/build_r5.py` (the round-4 builders with the round-5 selections); lessons: `scripts/lessons/round5.py` (the round-4 task designs, after `scripts/lessons/round4.py` was brought in line with the audited round-4 lessons: run on the round-4 packs it now writes them word for word except the few notes the audit added by eye). All six pass `validate_pack.py` and the zod contract; `tests/round5Content.test.ts` re-derives every graded answer from pack.json.

| pack | modality | patients | tasks | reference targets | size |
|---|---|---|---|---|---|
| `us-breast-3` | US | 112 | 448 (448 graded) | 112 | 21.3 MB (338 files) |
| `stroke-mri-3` | MR | 30 | 67 (67 graded) | 60 | 23.4 MB (4404 files) |
| `cxr-findings-3` | DX | 40 | 53 (53 graded) | 45 | 16.7 MB (127 files) |
| `peds-wrist-3` | DX | 40 | 80 (80 graded) | 80 | 56.9 MB (242 files) |
| `fx-radiographs-2` | DX | 12 | 12 (12 graded) | 12 | 0.8 MB (38 files) |
| `mammo-cbis-3` | MG | 13 | 39 (39 graded) | 26 | 65.0 MB (80 files) |
| **total** | | **247** | **699** | | **184.1 MB** (5229 files) |

Sources and licences are those of round 4 (Breast-Lesions-USG CC BY 4.0, ISLES 2022 CC BY 4.0, NIH ChestX-ray14 unrestricted, GRAZPEDWRI-DX CC BY 4.0, CBIS-DDSM CC BY 3.0) plus FracAtlas (CC BY 4.0, figshare article 22363012), already used by `fx-radiographs`. FracAtlas gives no patient identifiers and numbers the images of one person together, so `fx-radiographs-2` takes at most one image per block of 100 image numbers and counts the block as the subject: the patient count can only be an undercount.

## Selection, review and every dropped case

### `us-breast-3`

- **Rule:** Breast-Lesions-USG cases used in no earlier pack that meet the round-4 rule (benign or malignant, one lesion mask, proven by biopsy or follow-up, not a scar/implant/duct finding or a risk lesion): all of them.
- **Review:** Every built case drawn with the radiologist's outline and checked by eye. Kept: 112 patients.
- **Dropped (3):**
  - echo pattern recorded as hyperechoic, but the lesion is clearly darker than the fat around it: a correct reader would be marked wrong (1): 152
  - recorded as heterogeneous with an angular margin and no posterior features, but the image shows an evenly dark, sharply outlined round nodule with a dark band behind it (1): 193
  - echo pattern recorded as isoechoic, but the nodule is clearly darker than the fat around it: a correct reader would be marked wrong (1): 204

### `stroke-mri-3`

- **Rule:** ISLES 2022 cases used in no earlier pack with a lesion of at least 2 ml on the 2 mm DWI grid, 30 taken at even steps across the range of lesion volumes.
- **Review:** Every DWI and ADC outline drawn on the slice with the largest outlined area and checked by eye. Kept: 30 patients.
- **Dropped:** none after review.

### `cxr-findings-3`

- **Rule:** NIH ChestX-ray14 PA films of adults (18-90) with a radiologist box whose label is also in the report labels, one film per patient, no patient of an earlier pack and no film reviewed in rounds 1 or 4.
- **Review:** Every candidate drawn with its boxes (full film and zoom) and kept only where the boxed finding is clearly visible. Kept: 40 patients.
- **Dropped (156):**
  - boxed finding not clearly visible on review of the 1024 px film (full view and zoom); too subtle to teach from here (55): 00000072_000.png, 00000211_010.png, 00000457_004.png, 00000468_033.png, 00000643_002.png, 00000865_006.png, 00001320_003.png, 00001673_016.png, 00002176_007.png, 00003787_003.png, 00004296_000.png, 00004968_003.png, 00006751_000.png, 00007557_026.png, 00008547_001.png, 00008716_000.png, 00009229_007.png, 00009403_002.png, 00009889_018.png, 00010652_000.png, 00010936_011.png, 00011576_000.png, 00012045_019.png, 00012415_002.png, 00012636_000.png, 00012637_000.png, 00014198_000.png, 00014447_004.png, 00014626_017.png, 00014976_003.png, 00015649_000.png, 00015794_000.png, 00015831_008.png, 00017151_003.png, 00017255_001.png, 00018419_001.png, 00019495_004.png, 00021007_000.png, 00021700_010.png, 00021860_002.png, 00021862_004.png, 00022021_002.png, 00022178_000.png, 00025228_007.png, 00025270_000.png, 00025662_006.png, 00026769_010.png, 00026810_001.png, 00027094_003.png, 00027758_004.png, 00027927_009.png, 00028383_002.png, 00028620_000.png, 00028628_020.png, 00030260_005.png
  - heart size borderline by eye (cardiothoracic ratio near 0.5): not a clear example of cardiomegaly (9): 00004342_023.png, 00011557_003.png, 00012793_000.png, 00020986_000.png, 00022706_001.png, 00025747_000.png, 00026087_000.png, 00027685_003.png, 00027797_000.png
  - not a focal finding to locate: diffuse opacities in both lungs (2): 00010959_010.png, 00013051_000.png
  - the box covers most of a lung or spans both lungs: not a focal finding to locate (2): 00021772_011.png, 00022084_000.png
  - too subtle on a very low-contrast film (2): 00028625_000.png, 00029579_005.png
  - boxed finding not clearly visible on a low-contrast film with several tubes and a large unboxed opacity (1): 00000344_003.png
  - unexplained air-fluid level next to the finding on a complex post-sternotomy film (1): 00001170_046.png
  - unexplained air-fluid level just below the box; complex film (1): 00001248_038.png
  - expiration film with an air-fluid level inside the box and a large other opacity; complex film (1): 00002106_000.png
  - nodule box over the breast shadow; too subtle (1): 00002290_001.png
  - nodule box over a rib; too subtle (1): 00004547_003.png
  - not a standard upright PA film (AP appearance, low lung volumes) (1): 00004893_085.png
  - the box covers only the edge of a larger opacity, and diffuse unboxed nodules: a correct mark could be graded wrong (1): 00007882_001.png
  - nodule box on a rib margin: could be a rib or cartilage density (1): 00008386_000.png
  - complex film with several tubes and lines and an air-fluid level (1): 00008841_025.png
  - not a standard upright PA film; the opacity extends beyond the box (1): 00009342_000.png
  - mass box on an opacity of about 2 cm over ribs: 'nodule' would be the better answer (1): 00010125_004.png
  - too subtle (could be the normal minor fissure) (1): 00010770_000.png
  - boxed finding not clearly visible on a complex film with a drain and subcutaneous emphysema (1): 00011831_008.png
  - overlapping boxes, with a gastric air-fluid level inside the effusion box (1): 00011857_001.png
  - complex film with many lines, subcutaneous emphysema and a large air-fluid level (1): 00012094_040.png
  - complex film: one lung largely opaque with a drain (1): 00012376_011.png
  - heart borders blurred by basal opacity: heart size cannot be judged (1): 00012670_000.png
  - complex film with a drain, subcutaneous emphysema and lines; the finding is hard to judge (1): 00013111_069.png
  - the boxed finding looks like a small rounded opacity, not recognisable atelectasis: misleading (1): 00013118_008.png
  - basal pneumothorax too subtle on a complex film with tubes and lines (1): 00013471_002.png
  - pleural-based lesion over a rib that could be pleural thickening; complex film (1): 00013911_000.png
  - effusion barely blunting the angle while an unboxed mass dominates the film (1): 00013977_005.png
  - ill-defined opacity of about 3 cm: mass, nodule or infiltrate cannot be decided (1): 00013991_000.png
  - subtle linear atelectasis while a larger unboxed opacity would be marked as the main abnormality (1): 00014095_003.png
  - extensive unboxed disease in the other lung dominates the small boxed nodule (1): 00014280_000.png
  - diffuse nodular opacities in both lungs: not a focal finding to locate (1): 00014663_013.png
  - heart size borderline and its borders poorly defined (1): 00014706_007.png
  - nodule faint over ribs; too subtle (1): 00014778_000.png
  - boxed atelectasis cannot be told from post-operative change at a clipped base (1): 00014870_004.png
  - mass box inside an overlapping atelectasis box on a rotated, hazy film (1): 00015300_000.png
  - the boxed nodule is one of many in both lungs: a correct mark could be graded wrong (1): 00015792_005.png
  - not a standard PA film, with a gastric air-fluid level in the box (1): 00016009_008.png
  - an unboxed hilar mass is more conspicuous than the boxed nodule (1): 00016587_069.png
  - low-volume, probably AP film: heart size cannot be judged (1): 00016606_000.png
  - overlapping effusion and atelectasis boxes; small effusion (1): 00016837_002.png
  - minimal blunting with a gastric air-fluid level beside the box; too subtle (1): 00016964_011.png
  - not a standard PA film (AP, leads, catheter); complex (1): 00016987_022.png
  - low-contrast, low-volume film: heart size cannot be judged (1): 00016990_000.png
  - faint nodule on a rib crossing; too subtle (1): 00017028_000.png
  - tiny density at the lung edge that may not be in the lung; too subtle (1): 00017346_000.png
  - effusion barely visible on a complex film (1): 00017582_003.png
  - large unboxed masses in both lungs dominate the tiny effusion box: misleading (1): 00018102_001.png
  - faint nodule in the breast shadow; too subtle (1): 00018366_000.png
  - apical pleural line cannot be told from rib edges; unboxed effusion and a catheter compete (1): 00018496_007.png
  - pneumothorax not clearly seen on a film with chest tubes and surgical emphysema (1): 00018865_008.png
  - not a standard upright PA film; the boxed finding is not clearly an effusion (1): 00018980_002.png
  - an unboxed hilar mass and other opacities compete with the small boxed nodule (1): 00019013_002.png
  - the boxed band could be scarring or a vessel; a large cardiac silhouette competes (1): 00019154_002.png
  - faint opacity of about 3 cm: too subtle, and mass or nodule cannot be decided (1): 00019313_000.png
  - complex AP film with chest tubes and extensive opacity (1): 00019373_036.png
  - unexplained air-fluid level inside the box, with a chest tube: misleading (1): 00019706_014.png
  - effusion not clearly identifiable among other right-sided changes (1): 00019767_016.png
  - the boxed nodule may be a nipple shadow (a similar density at the same level on the other side) (1): 00020332_000.png
  - subtle effusion while the unboxed enlarged heart dominates (1): 00020564_000.png
  - badly rotated, non-standard film with a collapsed lung and catheters (1): 00020671_010.png
  - heart borders obscured: heart size cannot be judged (1): 00020819_002.png
  - the opacity cannot be told apart from the left heart border; too subtle (1): 00021024_022.png
  - the boxed opacity is not distinct from coarse opacities in both lungs (1): 00021458_000.png
  - too subtle on a complex film (volume loss, pleural thickening, clips) (1): 00021711_014.png
  - the boxed opacity cannot be told apart from the raised right hemidiaphragm; rotated film (1): 00021796_000.png
  - the effusion box overlaps an infiltrate box; small effusion (1): 00021840_016.png
  - air-fluid level at the base next to the finding, with a drain and clips: too complex for a located-finding case (1): 00021972_001.png
  - too subtle on a post-operative film with wires and tubes (1): 00022155_008.png
  - mass box over the right heart border and hilum: the mass cannot be told from them (1): 00022237_002.png
  - too subtle on a complex film (1): 00022707_003.png
  - not a standard upright PA film (badly tilted portable-type film with lines and leads) (1): 00022837_005.png
  - tilted, rotated film; the nodule is faint among surgical clips (1): 00022977_000.png
  - modest boxed opacity while an enlarged heart is neither boxed nor labelled: misleading (1): 00023089_004.png
  - mass box over the dome of the right hemidiaphragm: the mass cannot be told from the diaphragm (1): 00023168_000.png
  - too subtle; bullous emphysema confounds the pneumothorax (1): 00025368_033.png
  - too subtle; unexplained gas under the right hemidiaphragm (1): 00025521_003.png
  - small mass box at the hilum where the mass cannot be told from it; second box just below (1): 00026196_001.png
  - nodule box over ribs; too subtle (1): 00026398_000.png
  - too subtle on a complex film (chest tube, clips, subcutaneous emphysema) (1): 00026586_009.png
  - complex post-operative film with clips and a device over the boxed area (1): 00026886_004.png
  - heart borders hidden by opacities; the box covers much of both lungs (1): 00026889_000.png
  - nodule box over the first rib and costal cartilage (bone pseudo-nodule) (1): 00026983_001.png
  - low-contrast film with heavy breast overlap: the effusion cannot be judged (1): 00028640_008.png
  - too subtle pleural line, with a drain and a fluid level (1): 00029259_027.png
  - complex post-operative film where the finding is not distinct (1): 00029631_006.png
  - very low-contrast film with poor inspiration: heart size cannot be judged (1): 00029647_002.png
  - heart borders hidden by lung opacities; size borderline (1): 00029906_000.png
  - too subtle; the apical lucency could be a bulla (1): 00029909_003.png
  - nodule box over crossing ribs; too subtle (1): 00030413_003.png
  - complex film with chest tubes, subcutaneous emphysema and an air-fluid level (1): 00030606_006.png

### `peds-wrist-3`

- **Rule:** The round-4 rule (initial trauma, one frontal and one lateral image with the same single distal-radius AO/OTA code, one fracture box per image, no cast, metal, osteopenia or uncertain diagnosis), patients of rounds 1-4 excluded; 12 Salter-Harris II, 14 incomplete and 14 complete metaphyseal fractures.
- **Review:** Every radiograph drawn with the fracture box and checked by eye. Kept: 40 patients.
- **Dropped:** none after review.

### `fx-radiographs-2`

- **Rule:** FracAtlas images with one fracture annotation, no hardware, one view, one body region, not part of a multi-scan set; one image per block of 100 image numbers (none from the round-1 blocks), the region least represented so far first.
- **Review:** Every radiograph drawn with the fracture outline and checked by eye; the body part read on the image. Kept: 12 patients.
- **Dropped (27):**
  - child (open growth plates): the pack is for adults (8): IMG0001546.jpg, IMG0002406.jpg, IMG0002620.jpg, IMG0002840.jpg, IMG0002945.jpg, IMG0003619.jpg, IMG0004007.jpg, IMG0004116.jpg
  - cast, splint or hardware on the limb (6): IMG0001639.jpg, IMG0001738.jpg, IMG0003020.jpg, IMG0003254.jpg, IMG0003703.jpg, IMG0004320.jpg
  - low-resolution film: the outlined fracture is not clearly visible (5): IMG0000319.jpg, IMG0000480.jpg, IMG0000702.jpg, IMG0000801.jpg, IMG0001007.jpg
  - the outlined fracture is not clearly visible (3): IMG0001350.jpg, IMG0001870.jpg, IMG0003803.jpg
  - severe erosive or arthritic change of the carpus: the outlined fracture cannot be told apart from it (1): IMG0000206.jpg
  - probably the same wrist as IMG0000600 on another view (consecutive numbers across a block boundary): one image per person (1): IMG0000599.jpg
  - amputation stump: the outline is on the end of the stump with no clear fracture (1): IMG0001191.jpg
  - skeletally immature, or no fracture distinct from the growth-plate scar (1): IMG0001200.jpg
  - the outlined fracture is faint and a dense object over the carpus would mislead (1): IMG0004206.jpg

### `mammo-cbis-3`

- **Rule:** CBIS-DDSM training-set breasts with CC and MLO, a single abnormality (id 1 only) with the same descriptors on both views, subtlety 4-5; 5 irregular spiculated malignant masses, 4 oval circumscribed benign masses, 3 pleomorphic clustered and 2 fine linear branching malignant calcifications, 1 lucent-centered and 1 coarse benign calcifications; women of mammo-cbis and mammo-cbis-2 and the films rejected then excluded.
- **Review:** Chest-wall side of every film checked against the recorded laterality (build_mammo asserts it), then every outline drawn on the films and checked by eye. Kept: 13 patients.
- **Dropped (3):**
  - right breast, but the chest wall is on the edge of both films opposite to the recorded side (mirrored scan?): the orientation cannot be trusted, so the hanging would be wrong (2): P_00034, P_00406
  - left breast, but the chest wall is on the edge of both films opposite to the recorded side (mirrored scan?): the orientation cannot be trusted, so the hanging would be wrong (1): P_00995

