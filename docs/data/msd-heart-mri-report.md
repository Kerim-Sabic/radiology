# Cardiac MRI: the left atrium (`msd-heart-mri`)

Built by `scripts/data/msd_heart.py` (docs/data/msd-heart-mri-cases.json has the per-case facts); lessons by `scripts/lessons/msd_heart.py`.

## Source and licence (re-verified 2026-11-09)
- Medical Segmentation Decathlon, Task02_Heart, King's College London (originally the Left Atrial Segmentation Challenge 2013). Nature Communications 2022;13:4128, doi 10.1038/s41467-022-30695-9.
- Licence **CC BY-SA 4.0**: written in the task's own `dataset.json` (`"licence":"CC-BY-SA 4.0"`, release 1.0 04/05/2018, reference "King's College London") and on https://registry.opendata.aws/msd/ ("CC-BY-SA 4.0 International"; that page links the CC BY 4.0 URL by mistake, the dataset's own file and the Decathlon say BY-SA). The derived DICOM is shared under the same licence; attribution is in `pack.json` sources and on the credits page. The owner states he has permission.
- Access: anonymous, no account or agreement. `Task02_Heart.tar` (455,721,472 bytes) from the public AWS Open Data bucket `msd-for-monai` (`curl` of https://msd-for-monai.s3.us-west-2.amazonaws.com/Task02_Heart.tar). Only `imagesTr`/`labelsTr` (20 cases with labels) used; the 10 test cases have no labels.
- Acquisition (Decathlon paper, Methods): 1.5 T Philips Achieva, free breathing with respiratory and ECG gating, one cardiac phase, 3D whole heart. The paper says 1.25 x 1.25 x 2.7 mm; the files themselves are 1.25 x 1.25 x 1.37 mm (320 x 320 x 90-130), which is what the pack uses.

## Labels
One label, 1 = left atrium. The paper: "The left atrium appendage, mitral plane, and portal vein [pulmonary vein] end points were segmented by an expert using an automated tool followed by manual correction." So the label is the atrial blood pool with the appendage and the stumps of the pulmonary veins, the lower border being the mitral plane; the atrial wall is not separated. Provenance is therefore `source_automated` (semi-automatic, expert-corrected, not drawn from scratch), stated in each target's `provenanceDetail`. Lesson tasks are `exploratory_self_review`.

## Orientation (the NIfTI affine has none)
The affine is a bare `diag(1.25, 1.25, 1.37)` with zero origin, and the volumes are sagittal acquisitions: array axis 0 = posterior -> anterior, axis 1 = inferior -> superior, axis 2 = left -> right. Established by eye on every case: the spine is behind, the aortic arch and neck vessels at the high end of axis 1 and the abdomen at the low end, and on axial reformats the descending aorta lies to the patient's left of the spine, the heart's apex points left and the venae cavae / right-sided pulmonary veins are on the right. Mapping (x = axis 2 = R, y = axis 0 = A, z = axis 1 = S) is a proper rotation (determinant +1), so nothing is mirrored. All 19 built cases were rendered from the DICOM with their outline and looked at: the outline sits behind the aortic root, in front of the descending aorta, with the right pulmonary veins entering on the image's left, in every case.

## Build
Axial reformat without resampling (native voxels, 1.37 x 1.25 mm in plane), every second slice (2.5 mm), cropped to 25 mm above and below the labelled atrium and in plane to the body; signal values are whole numbers and stored exactly as unsigned 16-bit; JPEG-LS lossless. 19 cases, 929 slices, 968 files, 22.7 MB (budget 60 MB / 1,500 files). Identity: blank PatientName, PatientID `CMR-<hash>`, StudyDescription "Cardiac MRI", neutral lesson titles `Patient <code> · Cardiac MRI`; dataset names and "atrium" are checked against a leak pattern at build time. Lessons: 19 cases, 38 tasks (find the left atrium, plus one position question each).

## Dropped
- `la_026`: voxel-for-voxel the same image as `la_005` (correlation 1.0, every voxel equal; the labels differ, 115 vs 125 ml). Kept `la_005`.
- Nothing else; no case failed the by-eye check.
