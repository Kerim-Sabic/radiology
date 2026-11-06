# Anatomy and case expansion: MRI, ultrasound, brain arteries and veins

_Plan written 6 November 2026 before any build; the report at the top is updated after each round._

## Report

### Viewer round (6 November 2026): one view alone, two-view radiographs, chest-film anatomy, angiograms, finding analysis

**1. One view alone (every multi-view layout).** A corner button on each view, a double-click on its title or the U key
shows that view over the whole image area; Esc (or the button again) goes back. The other views are never resized or
remounted: they keep their cell, slice, zoom, pan and window, stay invisible but live, and keep following the linked
planes and crosshairs (tested: a point shown in the axial view alone moves the hidden sagittal plane). A switcher above
the image (Axial / Coronal / Sagittal / 3D, Frontal / Lateral, R CC …, All) picks the view; on phones it is always
there and one view at a time is the default, so every view of every layout is reachable (before, phones hid views 3-4
of Four-up and two of the three MPR planes). The old "enlarge with a strip" mode is replaced.

**2. Radiographs with two views.** A hanging protocol in the viewer (packs untouched): when the study has two or more
radiograph views, the case opens two-up, frontal left and lateral right. The view comes from ViewPosition, else the
image's PatientOrientation (rows left-right = frontal, front-back = lateral), else an unambiguous description; when one
is unknown the stored order is kept. The 6 "PA & LATERAL" series stored as one series now give each image its own panel
(pinned), so the arrows no longer flip between views; a mark keeps its own image's SOP (tested) and the grader compares
it only with that image's targets (unit test: a lateral mark is never credited with the PA target at the same pixel). A
task that names a view ("Open the lateral radiograph") puts the focus on that panel. Phones: Frontal / Lateral in the
switcher. Try: `chest-pairs-lidc-idri-0217` (PA & lateral in one series), `xr-wrist-child-0040` (wrist frontal +
lateral), `chest-pairs-covid-19-ar-16406502` task "lateral".

**3. Anatomy on both views, as far as the evidence allows.**
- Frontal chest films: new layer `anatomy-atlas-xr` (3.5 MB): **1,617 outlines on 126 of the 130 frontal films** of
  `cxr-findings`, `-2`, `-3` (the same chest-film model and QC as the CT atlas's radiographs; every film looked at, 16
  sheets). These films' headers do not record the patient's side (no PatientOrientation), so lungs, hila, clavicles and
  scapulae are named by their place on the image ("Lung, image left") instead of being dropped; heart, aorta,
  mediastinum, trachea and spine as usual. The model's "diaphragm" covers everything below the domes (liver and stomach
  included) and is not published; one film with a gas-filled structure in the right lower chest is left out, two hearts
  and one pair of hila are dropped. 3 films were not read as frontal chests by the model.
- Lateral chest (7 films) and wrists (151 films, frontal and lateral): **not outlined.** The only open lateral-chest
  model (CXAS in torchxrayvision; weights CC BY-NC-SA 4.0) was trained on CT projections, is not validated on real
  laterals and its weights need unrestricted unpickling; no paediatric wrist model exists (the only bone masks for this
  dataset, DenseSeg, are frontal-only machine labels with no stated licence; FleXray merges the carpals and fails on
  lateral wrists). See Needs Kerim 6-7.
- "Find it on the lateral too": the 74 wrist studies with a fracture already require it on both views (both are expert
  boxes); the two-up hanging now shows both views together. No chest source localises a finding on both views.

**4. Angiograms (`brain-mra`, `pe-cta`).** CT angiograms are recognised (CTA, CTPA, angiography in the series name)
besides time-of-flight MRA. MPR on an angiogram opens as a MIP slab (20 mm MRA, 10 mm CTA) with a toolbar switch
(MIP / Thin slice) and a 5-40 mm slider; any marking tool puts the views on the thin slice and the slab returns with a
viewing tool, so a mark is never placed on a projection. 3D: a Spin button turns the view slowly (one turn in 24 s;
a click stops it); CTPA opens 3D with the pulmonary-artery rendering. Names: hovering names a structure in 2D and 3D,
and a click now keeps its name on screen. Isolating one artery works as for the other structures (Anatomy tab, 3D
Structures). The CTPA cases already carry AI outlines of the pulmonary trunk, right and left pulmonary arteries and
lobar arteries (CT atlas); segmental arteries: no open model, not drawn. The CTA Circle-of-Willis round stays planned.

**5. Finding analysis (Kerim's request: tumour size and what goes with it, for every case).** Once the reference may be
seen (Learn, Review, after submitting; never in Assess or an exam before the answer), the Task tab measures every
finding the dataset's experts outlined on the case: longest diameter × widest extent across it on the image where it is
largest, how many images it spans and its extent across slices, its volume (cross-sectional series) or its area on the
film (radiographs, flagged when the pixel size is not corrected for magnification), and where its centre lies in the
anatomy layer ("in the right frontal lobe; next to the right lateral ventricle (3.2 mm) - from the AI anatomy layer,
not reviewed"), with a button to its largest image. Applies to gliomas, schwannomas, infarcts, aneurysms, nodules,
emboli, fractures and every other expert outline. Never used for grading.

### Round 2 (6 November 2026): brain anatomy on MRI

**Shipped**
- The MRI anatomy layer (`anatomy-atlas-mr`, now 31.2 MB) adds **2,497 brain-structure outlines on 90 brain MRI series**
  of 85 patients: 82 diffusion studies (ISLES 2022, `stroke-mri*`), 6 glioma series (ReMIND, `expansion` and `neuro-msk`:
  T1 after contrast, T2, FLAIR) and 2 vestibular-schwannoma series (`ct-tumors`: T1 after contrast, T2). Frontal,
  parietal, temporal and occipital lobes, insula, cingulate gyrus, precentral/postcentral (the central sulcus between
  them) and superior temporal gyri, lateral ventricles with temporal horns, third and fourth ventricles, caudate,
  putamen, globus pallidus, thalamus, hippocampus, amygdala, brainstem and cerebellar hemispheres. All unreviewed AI
  drafts in the atlas layer, credited to Horalix, never graded.
- Model: GOUHFI 2.0 (Apache-2.0), contrast- and resolution-agnostic, run on the two RTX 5080s; images that are not
  skull-stripped were masked first with the brain class of TotalSegmentator `total_mr` (open, no key).
- **Accuracy** on 20 brains labelled by hand (OASIS-TRT-20 of Mindboggle-101: DKT cortex by hand, CC BY 4.0;
  subcortical structures by hand by Neuromorphometrics, CC BY-NC-ND 4.0, used only to measure; the model's authors kept
  these brains for testing only). Median Dice at 1 mm: lobes (cortex) 0.86-0.93, insula 0.89, cingulate 0.84, precentral
  0.88, postcentral 0.84, superior temporal 0.88, thalamus 0.88, caudate 0.86, putamen 0.87, pallidum 0.84, hippocampus
  0.81, amygdala 0.69, lateral ventricle 0.81, third ventricle 0.70, fourth 0.80, brainstem 0.88, cerebellum 0.93; no left/
  right swap in 20 brains. With the T1 taken to 2 mm first (as the diffusion grids) most structures keep 89-97 % of the
  Dice the grid itself allows (the manual labels taken to 2 mm and back): e.g. thalamus 0.84, putamen 0.82, cerebellum
  0.90, brainstem 0.86.
- QC: CSF signal by sequence (ventricles dark on T1/FLAIR/DWI, bright on T2/ADC), side of a midline plane fitted to the
  third ventricle, anatomical order, size and fragments, outline-vs-mask Dice >= 0.9; **tumour rule**: nothing within
  10 mm of a tumour outlined by the dataset's experts is shown, on every series of that patient (glioma: 12-24 of 37
  structures removed; schwannoma: left temporal lobe, hippocampus, cerebellum and brainstem removed); **validation
  rule**: on grids coarser than 1.5 mm, structures below Dice 0.65 or below 85 % of the grid's ceiling at 2 mm are not
  shown (third ventricle, amygdala, postcentral gyrus on the diffusion series). Every published series was looked at
  (4 views each; the large infarcts, the rotated head and the tumour series again at higher resolution); one old infarct
  cavity's ragged right parietal and occipital lobes were dropped.
- GPU and CPU agree: the brain model on one case differs in 128 of 179,950 voxels (Dice per label >= 0.99) with the same
  QC outcome; the brain mask in 76 of 915,054 voxels.
- Viewer: one colour per lobe and nucleus, notes for every structure (what it looks like, what is next to it, the
  pitfall), Ch 20 checklist items for the MRI brain; unit tests and a Playwright test on a diffusion MRI.
- A bug found on the way: the tumour rule read the schwannoma outlines (stored in patient millimetres) as pixels; fixed
  before anything was published.

**Dropped or not done, and why**
- SynthSeg 2.0: its weights ship only inside FreeSurfer, whose licence is accepted by downloading (Needs Kerim 4).
- ADC maps: the outlines are on the DWI of the same acquisition (same grid); both would exceed the 45 MB budget.
- Thin gyri on 2 mm diffusion grids: most fail the outline check and are not shown there.
- `total_mr` on the thigh, prostate and other body MRIs: not in this round (next).
- The lobes' white matter is assigned to the nearest lobe cortex; the validation measures the cortex part only (the
  manual maps have no white-matter label).

**Licences:** GOUHFI 2.0 Apache-2.0 (Fortin et al., arXiv:2601.09006); TotalSegmentator `total_mr` Apache-2.0
(Wasserthal et al.); Mindboggle-101 cortex labels CC BY 4.0 and OASIS-TRT-20 whole-brain labels CC BY-NC-ND 4.0 (Klein &
Tourville 2012), used for validation only and not redistributed.

### Round 1 (6 November 2026): brain MR angiography, the Circle of Willis and aneurysms

**Shipped**
- New image pack **`brain-mra`** (19 time-of-flight MRAs, 211.7 MB, JPEG-LS lossless, `validate_pack.py` PASS on all
  2,874 images): 13 patients with 16 unruptured aneurysms outlined voxel by voxel by a radiologist and double-checked by a
  senior neuroradiologist (Lausanne TOF-MRA cohort, CC0) - Acom, basilar tip, ICA siphon and terminus, MCA division,
  pericallosal, one giant partly thrombosed cavernous ICA aneurysm - and 6 people without an aneurysm whose Circle of Willis
  the TopCoW annotators labelled artery by artery (two complete circles, a fetal-type PCA on each side, Acom not seen, left
  A1 not seen). 34 tasks: "Find the aneurysm(s)" (13, in Assess, graded only on the expert outlines), "How many
  aneurysms?" (3), size band (where the outline's diameter is at least 1 mm from 5 or 10 mm), "Name the arteries of the
  Circle of Willis" (6, labelled points on the expert labels) and a variant question per control (answers from the expert
  segment record). Controls are Learn/Practice only (their labels were drawn by trained annotators, not radiologists).
  Where each aneurysm sits was read on the images and is said in the explanation, never graded.
- New AI layer **`anatomy-atlas-mr`** (0.95 MB): 148 artery outlines on the 13 patient MRAs - basilar artery, both ICAs,
  MCAs (M1/M2 where the division is in view), ACAs (A1/A2 at the Acom), Acom, Pcoms, PCAs (P1/P2 at the Pcom), third A2 -
  from the TopCoW 2024 winning model, after vessel-tree, side, contact and TOF-signal QC and a visual check of every case.
  The expert labels are shown on the controls instead. The aneurysm sac is left out of every artery outline.
- Accuracy on the 24 expert-labelled MRAs the model never saw (Dice inside the expert box, median): basilar 0.96, ICAs
  0.96, MCAs 0.94, PCAs 0.93-0.94, ACAs 0.93, Acom 0.76, Pcoms 0.67-0.79; label confusion median 0. In 2 of 40 MRAs the
  network swapped left and right wholesale; the side rule removed those arteries (none in the published series).
- Two RTX 5080s in use (venv `venv-gpu`, torch 2.11.0+cu128, one queue per GPU, about 1 minute per MRA); the CPU run of
  the same code on one case gave the same crop, 41 of 26,551 voxels different and the same QC outcome.
- Viewer: time-of-flight is recognised as its own sequence (it was read as T1), MR angiograms open the 3D view with the
  angiography rendering, one colour per artery of the circle, teaching notes for the 12 arteries, a Ch 26 "Brain arteries
  on MR angiography" checklist; unit tests and three Playwright tests on the new modality.
- Coverage: Ch 26-o09 (subarachnoid haemorrhage and aneurysm) now has 34 tasks on 19 patients.

**Dropped or not done, and why**
- "Which artery does it arise from?": no expert location label in the Lausanne release (the RSNA set has one; item 4).
- 23 more voxel-wise aneurysm subjects: their MRAs are on 0.23-0.29 mm grids (about four times the size, and resampling
  would be needed). The 246 sphere-labelled subjects: the outline is only a sphere around the sac.
- Venous sinuses: flowing venous blood is suppressed on TOF, and no licence-free named-sinus model exists (item 4).
- Vertebral arteries and distal branches: not in the model's labels; not drawn.
- M1/M2: split only where the division is inside the labelled region (most MCA labels end near it).
- The team's YOLO locator was replaced (its weights can only be loaded with unrestricted unpickling).

**Licences:** Lausanne cohort CC0; TopCoW labels and the model trained on them - "Open use. Must provide the source. Use
for commercial purposes requires permission of the data owner." (item 1); IXI CC BY-SA 3.0; nnU-Net Apache-2.0.

**Next:** round 2 (MRI anatomy layer: GOUHFI 2.0 vs SynthSeg 2.0 on the brain MRIs, `total_mr` on the thigh and pelvis),
round 3 (ultrasound: fetal planes; CAMUS after item 2), then the CTA Circle of Willis (CTA_ISLES2024_TUM).

## Needs Kerim

Nothing below blocks the work that is running; each item is a decision or a sign-up only Kerim can make.

1. **TopCoW terms (recorded, not blocking).** Kerim confirmed on 6 November that any licence may be used, so the
   TopCoW labels and the model trained on them are used, with the source and citation in the pack and credits. Their
   terms are "Open use. Must provide the source. Use for commercial purposes requires permission of the data owner"
   (OpenData Swiss, University of Zurich); if Kerim wants that permission in writing for the paid product, the contact is
   the TopCoW organisers (Kaiyuan Yang, Bjoern Menze). The pack records the terms word for word.
2. **The paid build still removes non-commercial sources.** `scripts/build/commercialContent.ts` (run by every
   production build) strips any subject whose source licence says "non-commercial" or "BY-NC" (today: the RICORD
   radiographs in `more-ct-xr`). That predates the any-licence rule of 6 November. It is not changed here because it
   would also change what existing members see; until Kerim decides, a pack built from a BY-NC source (e.g. CAMUS echo)
   would sit in the repository but not reach production, so round 3 prefers sources with commercial-use licences.
3. **Share-alike sources.** IXI (CC BY-SA 3.0) and CAMUS (CC BY-NC-SA 4.0) require derived packs to carry the same licence.
   The packs record it; the repository is public, so the derived DICOM is redistributed under those terms.
4. **Sign-ups only Kerim can accept** (not used until he does):
   - RSNA Intracranial Aneurysm Detection (RSNA-ICA, 2025): 4,000+ CTA/MRA series with radiologist aneurysm points and the
     artery of origin (13 locations), 178 with vessel masks. Controlled access through MIRA / Kaggle rules, non-commercial,
     **no redistribution** - it could never be committed to this public repository, only served from protected storage.
     It is the only source found that would support "Which artery does it arise from?" graded on expert labels.
   - ADAM aneurysm challenge (TOF-MRA, voxel masks): registration.
   - TotalSegmentator licensed tasks (free key for non-commercial use, paid licence for commercial use): `brain_structures`
     (CT: lobes, deep nuclei, ventricles, **venous sinuses** as one class), `thigh_shoulder_muscles_mr`,
     `appendicular_bones_mr`. Request at https://backend.totalsegmentator.com/license-academic/ (or the commercial form).
   - Open Kidney Ultrasound Data Set (514 images, two expert sonographers, CC BY-NC-SA): Qualtrics request form.
   - SynthSeg 2.0 weights: the link in its README is dead; they now ship only inside FreeSurfer, whose licence says that
     downloading it constitutes acceptance of the FreeSurfer Software License Agreement. Not downloaded; round 2 uses
     GOUHFI 2.0 (Apache-2.0) instead. If Kerim accepts the FreeSurfer licence, SynthSeg can be compared.
   - EchoNet-Dynamic / Stanford AIMI ultrasound sets: research-use agreement.
5. **Disk.** C: has about 20 GB free now (40 GB at the start). Downloads are selective (only the cases built) and model weights are extracted from the
   docker images while streaming, without saving the images. More space would allow more cases per round.
6. **Lateral chest outlines (decision).** CXAS (Seibold et al., PAX-Ray++; in torchxrayvision as
   `chestx_anatomy.UNetResNet50`) is the only open model that segments lateral chest radiographs (heart, lungs, trachea,
   aorta, sternum, spine). Its weights are CC BY-NC-SA 4.0 (non-commercial, share-alike: item 2 applies) and are a
   pickle that must be loaded with unrestricted unpickling; it is trained on CT projections, not real laterals. With
   only 7 lateral films in the packs it was not run. If Kerim wants it, it would be run with a visual check of every
   film and only the robust classes shown.
7. **Wrist bone outlines (decision / author contact).** No paediatric wrist anatomy model exists. The DenseSeg masks for
   GRAZPEDWRI-DX (Lübeck; radius, ulna, epiphyses, each carpal, MC I-V; frontal only) have no stated licence: if Kerim
   asks the authors (github.com/MDL-UzL/DenseSeg) for permission, a frontal model could be trained here on the two GPUs
   and validated on their 64 radiologist-drawn masks. RAM-W600/H1200 (adult wrists, CC BY-NC-SA) are gated on Hugging
   Face (account + conditions). Laterals would need hand-corrected labels.

## Constraints that shaped the plan

- Packs are committed to a **public** repository and deployed from git (1.9 GB today). New packs are kept small: native
  resolution, lossless JPEG-LS, only the cases that teach something, a size budget per pack.
- `anatomy-atlas` is at 77 MB of its 80 MB budget, so MRI and vessel outlines go into a **new atlas pack
  `anatomy-atlas-mr`** with the same contract (layer `atlas`, `ai_draft`, `unreviewed`, `target_only`, source "Horalix").
- Findings and graded anatomy come only from the datasets' own manual annotations. AI outlines are never graded against.
- Existing packs' lessons are not touched. New cases are new packs with their own lessons script and review notes.
- GPUs: `C:/Users/kerim/radiology-data/venv-gpu` (Python 3.12, torch 2.11.0+cu128, TotalSegmentator 2.18.0, nnU-Net 2.8.1),
  both RTX 5080 (sm_120) visible; one queue per GPU.

## Candidate models, by target

Licence status of every TotalSegmentator task was read from the installed tool (`totalsegmentator.registry.requires_license`).

| target | candidate | gives | licence | decision |
|---|---|---|---|---|
| Brain MRI anatomy (any sequence) | **SynthSeg 2.0** (Billot et al. 2023), `--parc` | 33 structures: cortex/white matter per hemisphere, lateral/3rd/4th ventricles, thalamus, caudate, putamen, pallidum, hippocampus, amygdala, accumbens, ventral DC, brainstem, cerebellum; with `--parc` 68 Desikan-Killiany cortical gyri | code Apache-2.0; weights from the authors' UCL share (and FreeSurfer); contrast- and resolution-agnostic (works on DWI/ADC, FLAIR, T2, T1, CT) | **use** (round 2): the only option that works on the 2 mm DWI/ADC, 6 mm T2/FLAIR and 1 mm T1 series already in the packs; lobes are grouped from the gyri |
| Brain MRI anatomy (any sequence) | **GOUHFI 2.0** (Fortin et al. 2025; Zenodo 17920473) | SynthSeg-style domain-randomised nnU-Net: subcortical structures and a separate cortical-parcellation model | Apache-2.0, open download (7.4 GB per model zip) | strong alternative to SynthSeg, PyTorch on the GPUs; SynthSeg's README weight link is dead (404 on 6 Nov), its weights now only ship inside FreeSurfer. Round 2 compares the two on a few series and keeps the better |
| Brain MRI anatomy (T1 only) | FastSurfer (VINN) | DKT gyri + subcortical, GPU | Apache-2.0 | not used: needs a T1-weighted 1 mm scan; most series are not |
| Brain CT anatomy | TotalSegmentator `brain_structures` | lobes, nuclei, ventricles, sinuses | **licensed** | needs the key (item 3) |
| Ventricle parts on CT | TotalSegmentator `ventricle_parts` | frontal/occipital/temporal horns, body, trigone, 3rd, 4th | open | later, on head CTs (none in the packs today) |
| Body / MSK MRI | TotalSegmentator `total_mr` | 50 classes (organs, femur, hip, gluteal and psoas muscles, vertebrae as one class, brain) | open | **use** (round 2) on the thigh sarcoma MRIs and the prostate MRI |
| Spine MRI levels | TotalSegmentator `vertebrae_mr` | C1-S1 numbered | open | later (no spine MRI in the packs) |
| Intracranial arteries, TOF-MRA | **TopCoW 2024 winning model** (team CLAIM, Charite Berlin: nnU-Net ResEnc-M + Skeleton Recall), from the organisers' Zenodo docker release 15665435 | 13 classes: basilar, L/R PCA, L/R ICA, L/R MCA, L/R Pcom, Acom, L/R ACA, 3rd A2 | TopCoW terms (item 1) | **use** (round 1); weights extracted from the docker image, run with nnU-Net on GPU |
| Intracranial arteries, CTA | same docker family (CLAIM/DKFZ/UZH run on both) | same | same | later: no head CTA in the packs yet |
| Aneurysm detection, TOF | TotalSegmentator `brain_aneurysm` | one class | open | **not used for anything graded**; not needed (expert masks exist) |
| Neck vessels on CT | TotalSegmentator `headneck_bones_vessels` | ICA, internal jugular veins (+ hyoid, larynx…) | open | later, on CTs that cover the neck |
| Venous sinuses | no licence-free named-sinus model found; `brain_structures` lumps all sinuses into one CT class | - | licensed | not in round 1; see "Later" |
| Binary vessels TOF | VesselBoost, COSTA, TopCoW binary models | vessels, unnamed | various | not needed: the multiclass model names the vessels |
| Ultrasound anatomy | no general model with a usable licence; **expert masks** exist (CAMUS heart, HC18 fetal head, BrEaST breast) | - | - | outlines on ultrasound come from expert masks only |

## Candidate datasets

"May grade" = the annotation the task is graded on. "Viewer" = what the app can show after the usual conversion
(NIfTI to DICOM MR as for ISLES; PNG to DICOM Secondary Capture / Ultrasound as for BrEaST).

| source | expert annotation (may grade) | size | route | licence | viewer | decision |
|---|---|---|---|---|---|---|
| **Lausanne TOF-MRA Aneurysm Cohort** (OpenNeuro ds003949; Di Noto et al., Neuroinformatics 2023) | manual aneurysm masks (198 aneurysms in 157 patients); T1w per subject; no artery-of-origin label | 284 subjects, ~28 MB per TOF | public S3, no login | **CC0** | NIfTI -> DICOM MR (3D TOF) | **round 1** |
| **TopCoW external test sets** (Zenodo 15692630): MRA_Lausanne (20 controls), MRA_IXI_HH (20) | manual 13-class Circle-of-Willis masks on the raw images + presence of Acom, A1, Pcom, P1, 3rd A2 per side | 1.3 GB + 0.5 GB | Zenodo, open | TopCoW terms; images CC0 (Lausanne) / CC BY-SA 3.0 (IXI) | NIfTI -> DICOM MR | **round 1** (normal anatomy and variants) |
| TopCoW 2024 training release | same labels, 125 MRA + 125 CTA | 10.5 GB | Zenodo, open | TopCoW terms | NIfTI | not downloaded (disk); the trained model already exists |
| CTA_ISLES2024_TUM (TopCoW) | CoW masks on 26 stroke CTAs | 2 GB | Zenodo, open | CC BY-NC | NIfTI | later: CTA Circle of Willis round |
| RSNA-ICA 2025 | radiologist aneurysm points + 13 artery locations; 178 vessel masks | 4,000+ series | MIRA controlled access | non-commercial, no redistribution | DICOM | needs Kerim; cannot be committed |
| ADAM 2020 | aneurysm voxel masks, TOF | 113 | registration | research | NIfTI | needs Kerim |
| IXI MRA (full) | none | 570 | direct | CC BY-SA 3.0 | NIfTI | only the 20 TopCoW-labelled ones |
| CQ500 head CT | radiologist reads (bleeds, fractures), no masks | 491 | web form | CC BY-NC-SA | DICOM | later, Ch 26 haemorrhage (form) |
| ISLES 2022 (in the packs) | stroke masks | - | done | CC BY 4.0 | done | MRI anatomy layer in round 2 |
| **CAMUS** echo (Leclerc et al., IEEE TMI 2019) | cardiologist outlines of LV cavity, LV myocardium, left atrium at end-diastole/-systole on apical 2- and 4-chamber views; view label | 500 patients, 3.8 GB | public Girder collection | CC BY-NC-SA 4.0 | NIfTI 2-D -> DICOM US | **round 3** |
| FETAL_PLANES_DB (Burgos-Artizzu et al. 2020) | expert plane labels (abdomen, brain, femur, thorax, cervix) and brain sub-plane | 12,400 images | Zenodo 3904280, open | CC BY 4.0 | PNG -> DICOM US | round 3 (plane-recognition drill) |
| HC18 (in the packs) | fetal head ellipse | - | done | CC BY 4.0 | done | expert fetal-head outline already shown |
| Open Kidney US | sonographer capsule/cortex/medulla/sinus | 514 | request form | CC BY-NC-SA | PNG | needs Kerim |
| Gallstones, hydronephrosis, DVT, FAST free fluid | **no open expert-labelled set found** (searched 6 Nov 2026) | - | - | - | - | not possible without new sources |
| Thyroid (DDTI, TN3K) | TI-RADS / nodule masks | 99-3,500 | direct / GitHub | unclear | PNG | later, after the licence is read |
| MSK / knee / prostate / liver MRI | see `docs/data/DATA_REPORT.md` for TCIA sets already screened | - | TCIA | various | DICOM | later rounds |

## Ranked build order (by student value)

1. **Round 1 - Brain MRA: the Circle of Willis and aneurysms** (Ch 26-o09 "subarachnoid haemorrhage and aneurysm", the
   uncovered Ch 26). New image pack `brain-mra`: Lausanne aneurysm patients with expert masks ("Find the aneurysm",
   graded on the mask), TopCoW-labelled controls with expert artery masks ("Name the arteries of the Circle of Willis",
   graded on the expert masks) and expert-labelled variant drills (absent Acom, fetal-type PCA, missing A1). AI artery
   outlines (13 classes, named sub-segments A1/A2, P1/P2, M1 where the junction is defined) on every TOF in the new atlas
   pack. "Which artery does it arise from?" is **not** offered: the Lausanne release has no expert location label (the
   RSNA set would, item 4).
2. **Round 2 - MRI anatomy layer** on every MRI series already in the packs (neuro-msk, expansion, ct-tumors, stroke-mri 1-3,
   ct-mri-pairs, starter) and on the new TOF/T1: brain structures, lobes and gyri with the better of GOUHFI 2.0 and
   SynthSeg 2.0 on a few series; TotalSegmentator `total_mr` on the thigh and pelvis. Ch 20, Ch 26-o02 (normal brain MRI).
3. **Round 3 - Ultrasound**: fetal plane recognition from FETAL_PLANES_DB (CC BY 4.0, expert plane labels); CAMUS apical
   views with the cardiologists' outlines as the anatomy layer ("Which view is this?", "Find the left atrium") once Kerim
   decides on the paid-build filter (item 2: CAMUS is BY-NC-SA and would not reach production today). Ch 18-o01,
   Ch 19-o08 (partly).
4. Later: CTA Circle of Willis (CTA_ISLES2024_TUM with expert masks), venous sinuses (needs a model or Kerim's key),
   neck vessels on CT, CQ500 haemorrhage, thyroid nodules, kidney ultrasound after the request form.

## Round 1 design: `brain-mra`

- **Cases.** About 12 aneurysm patients chosen for teaching value (aneurysms of 3 mm and up at different sites, one
  patient with two), 6 TopCoW-labelled controls with clear variants, all at native resolution. Budget about 250 MB.
- **Conversion.** NIfTI -> DICOM MR as in `build_external.isles_series` (geometry from the NIfTI affine, RAS -> LPS,
  axes flipped only so that columns run to the patient's left and rows posterior), 3D TOF, MR Image Storage, JPEG-LS
  lossless; masks traced on exactly the same voxel grid. Every target verified against the DICOM by re-rasterising.
- **Expert targets.** Aneurysm masks -> `finding:intracranial_aneurysm` contour sets (`source_manual`); TopCoW masks ->
  `anatomy:<artery>` contour sets (`source_manual`, method states who drew them); TopCoW edge labels -> answers of the
  variant drills (choice grading, expert answer).
- **AI layer.** The TopCoW model on GPU on each TOF; QC: mapping (rule 0), fragments (rule 1), TOF intensity (arteries
  bright: median inside > 95th percentile of brain), left/right (rule 4: L/R ICA, MCA, ACA, PCA, Pcom by centroid; Acom
  and basilar near the midline), connectivity (each named artery touches the ones it should: ICA-MCA, ICA-ACA,
  BA-PCA, Pcom joins ICA and PCA, Acom joins both ACAs), sub-segments A1/A2 at the Acom junction, P1/P2 at the Pcom
  junction (only when that junction exists), and agreement with the expert masks where they exist (Dice per class
  recorded; a class below 0.5 Dice is dropped from that case and investigated). Every case rendered (axial MIP + coronal
  MIP with outlines) and looked at; result in `WORK/brain-mra/mra_visual_check.json`.
- **Viewer.** Group/colour rules for the new vessel and brain names; MR angiograms open the 3D panel with the angiography
  preset; tests.

## QC design for MRI (round 2)

Rule 0 mapping (NIfTI affine vs DICOM IPP/IOP for sampled voxels, < 0.5 mm, oblique series handled by the full
direction matrix, gantry-like shear rejected); rule 1 fragments as for CT; intensity sanity per sequence instead of HU
(CSF dark on T1 and FLAIR, bright on T2; ventricles darker/brighter than white matter accordingly; DWI/ADC: ventricles
high ADC); left/right order of every paired structure; vertical order (brainstem below thalamus below lateral ventricles;
cerebellum posterior-inferior); coverage (structures cut by the field of view labelled "(partially imaged)" or dropped);
visual check of every case.

## Later

- Venous sinuses: options are the licensed TotalSegmentator `brain_structures` (CT, one class) or an expert-labelled
  source; on the 3D contrast T1 series an atlas-guided method would need its own validation. Not shipped until one of
  those exists.
- CTA Circle of Willis and neck vessels; CQ500 head CT; thyroid and kidney ultrasound.
