# Coordinate contract

One contract for every annotation, learner mark and reference. Implemented in `src/lib/geometry.ts` and tested in `tests/geometry.test.ts`.

## Patient space
- DICOM patient coordinates, **millimetres, LPS**: +x = patient Left, +y = Posterior, +z = Superior (Head).
- NIfTI-derived masks (RAS) are converted to LPS during offline preparation (x and y negated); the conversion and any resampling are recorded in the target's `provenanceDetail.method`. Matching array shapes is never taken as proof of alignment — the vessel pipeline checks voxel centres against DICOM IPP/IOP (residual ≤ 3.1e-05 mm) and left/right centroids.

## Image space ("contract pixels")
- `[column, row]`, zero-based, **continuous**, with `(0,0)` = the **centre** of the first transmitted pixel (the same point as ImagePositionPatient).
- Always stored with the SOP Instance UID (+ 1-based frame) and the source rows/columns.
- `ImageOrientationPatient[0..2]` = direction of increasing column; `[3..5]` = direction of increasing row. `PixelSpacing = [row spacing, column spacing]`.
- patient = IPP + col·colSpacing·rowDir + row·rowSpacing·colDir.

## Cornerstone boundary
Cornerstone image coordinates put `(0,0)` at the top-left **corner** of the first pixel, so `cs = contract + 0.5`. Conversions happen only through `csToContract` / `contractToCs`. Learner marks are captured from annotation world points and converted to contract pixels on their referenced image; canvas pixels are never stored.

## Projection radiographs
Radiographs usually have no IOP/IPP. Their marks are stored only in contract pixels on the SOP instance (`worldLps: null`). Side letters come from each image's `PatientOrientation`; if absent or invalid the viewer says “Orientation not recorded in file”. `ImagerPixelSpacing` is detector-plane spacing, not patient-calibrated, so distances are labelled uncalibrated.

## Slice ordering and MPR safety
Slices are sorted by IPP projected on the IOP normal (never filename or InstanceNumber). Duplicate positions, gaps, non-uniform spacing, mixed orientation and in-plane drift (gantry tilt) make a series ineligible for MPR; it then stays in stack view rather than being reformatted with distortion. Axial stacks are *displayed* head→feet; grading uses SOP UIDs and geometry, not display order.
