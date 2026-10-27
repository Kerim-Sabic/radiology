"""Step 3: map every TotalSegmentator mask back onto the ORIGINAL DICOM slices and trace contours.

  python scripts/vessels/masks_to_contours.py [--fast] [case ...]

For each class mask (WORK/<case>/seg[_fast]/<class>.nii.gz):
  * if its voxel grid (shape + affine) equals ct.nii.gz (tolerance 1e-3 mm) it is used as-is; otherwise it is
    resampled onto the CT grid with SimpleITK nearest-neighbour (recorded per class as "resampled").
  * NIfTI voxel (i, j, k) = (DICOM column, DICOM row, sorted slice k); slice k -> SOP Instance UID from slices.json
    (built by IPP sorting in convert_dicom_to_nifti.py; re-verified here by matching each NIfTI slice centre
    to the nearest DICOM IPP along the normal).
  * per slice: 4-connected 2D components; components < MIN_COMPONENT_PX pixels are dropped; each component's
    hole-filled outline and its holes are traced with skimage.measure.find_contours(level=0.5) on a 1-pixel
    zero-padded array. find_contours returns (row, col) in pixel-centre index units -> stored as [col, row]
    (image_px: (0,0) = centre of first pixel, the same convention as the array indices). Rings are closed
    (first point repeated) and simplified with approximate_polygon(tolerance=SIMPLIFY_TOL_PX).
  * alignment QC: up to 400 random mask voxel centres per class are mapped to LPS twice — via the mask's NIfTI
    affine (RAS) converted with diag(-1,-1,1) and via the DICOM formula IPP + col*dc*X + row*dr*Y of the
    matched instance — and the Euclidean residuals are recorded.

Writes WORK/<case>/structures[_fast].json (per-slice areas, centroids, component counts, residuals) and
WORK/<case>/contours[_fast]/<class>.json (contour_set planes in image_px).
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
import SimpleITK as sitk
from scipy import ndimage as ndi
from skimage import measure

from common import (MIN_COMPONENT_PX, RAS_TO_LPS, ROI_SUBSET, SIMPLIFY_TOL_PX, WORK, case_dir, dicom_pixel_to_lps,
                    dump_json, dump_json_compact, load_json)

CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
FULL = np.ones((3, 3), bool)


def trace(mask2d: np.ndarray) -> list[list[float]]:
    """Longest closed iso-0.5 contour of a binary (row, col) mask, as [[col, row], ...] closed ring."""
    padded = np.pad(mask2d.astype(np.float32), 1)
    cs = measure.find_contours(padded, 0.5, fully_connected="low")
    if not cs:
        return []
    c = max(cs, key=len) - 1.0  # undo padding
    if not np.allclose(c[0], c[-1]):
        c = np.vstack([c, c[:1]])
    s = measure.approximate_polygon(c, tolerance=SIMPLIFY_TOL_PX)
    if len(s) < 4:
        s = c
    return [[round(float(p[1]), 2), round(float(p[0]), 2)] for p in s]


def polygons_for_slice(m2: np.ndarray):
    lab, n = ndi.label(m2, structure=CROSS)
    polys, holes, kept = [], [], np.zeros_like(m2)
    for ci in range(1, n + 1):
        comp = lab == ci
        if comp.sum() < MIN_COMPONENT_PX:
            continue
        kept |= comp
        filled = ndi.binary_fill_holes(comp, structure=FULL)
        ring = trace(filled)
        if ring:
            polys.append(ring)
        hl, nh = ndi.label(filled & ~comp, structure=FULL)
        for hi in range(1, nh + 1):
            h = hl == hi
            if h.sum() >= MIN_COMPONENT_PX:
                r = trace(h)
                if r:
                    holes.append(r)
    return polys, holes, kept


def process(case: str, fast: bool) -> dict:
    d = case_dir(case)
    sfx = "_fast" if fast else ""
    seg = d / f"seg{sfx}"
    elig = load_json(d / "eligibility.json")
    slices = load_json(d / "slices.json")
    iop, ps, normal = elig["iop"], elig["pixelSpacing"], np.array(elig["normal"])
    ct_nii = nib.load(str(d / "ct.nii.gz"))
    A_ct = ct_nii.affine
    ct = np.asanyarray(ct_nii.dataobj)  # (i=col, j=row, k)
    shape = ct.shape
    px_area = float(ps[0]) * float(ps[1])

    # slice k -> SOP UID re-verification from the CT affine
    slice_match = []
    for s in slices:
        centre = (RAS_TO_LPS @ A_ct @ np.array([0, 0, s["k"], 1.0]))[:3]
        resid = float(np.linalg.norm(centre - np.array(s["ipp"])))
        slice_match.append(resid)

    out = {"case": case, "fast": fast, "sliceIppMatchMaxResidualMm": max(slice_match), "structures": {}}
    rng = np.random.default_rng(42)
    for cls in ROI_SUBSET:
        p = seg / f"{cls}.nii.gz"
        rec = {"file": str(p)}
        if not p.exists():
            rec["status"] = "missing_output"
            out["structures"][cls] = rec
            continue
        mimg = nib.load(str(p))
        same = mimg.shape == shape and np.allclose(mimg.affine, A_ct, atol=1e-3)
        rec["maskShape"] = list(mimg.shape)
        rec["maskVsCtAffineMaxAbsDiff"] = float(np.abs(mimg.affine - A_ct).max()) if mimg.shape == shape else None
        if same:
            mask = np.asanyarray(mimg.dataobj) > 0
            A_mask = mimg.affine
            rec["resampled"] = False
        else:
            ref = sitk.ReadImage(str(d / "ct.nii.gz"))
            mov = sitk.ReadImage(str(p))
            res = sitk.Resample(mov, ref, sitk.Transform(), sitk.sitkNearestNeighbor, 0, mov.GetPixelID())
            mask = sitk.GetArrayFromImage(res).transpose(2, 1, 0) > 0
            A_mask = A_ct
            rec["resampled"] = True
        nvox = int(mask.sum())
        rec["voxels"] = nvox
        if nvox == 0:
            rec["status"] = "empty"
            out["structures"][cls] = rec
            continue

        # alignment QC (mask voxel centres -> LPS via NIfTI affine vs via DICOM IPP/IOP/PixelSpacing)
        ijk = np.argwhere(mask)
        sel = ijk[rng.choice(len(ijk), size=min(400, len(ijk)), replace=False)]
        res_mm = []
        for i, j, k in sel:
            lps_nifti = (RAS_TO_LPS @ A_mask @ np.array([i, j, k, 1.0]))[:3]
            lps_dicom = dicom_pixel_to_lps(slices[k]["ipp"], iop, ps, col=i, row=j)
            res_mm.append(float(np.linalg.norm(lps_nifti - lps_dicom)))
        rec["alignment"] = {"samples": len(res_mm), "maxResidualMm": max(res_mm), "meanResidualMm": float(np.mean(res_mm))}
        rec["meanHU"] = float(ct[mask].mean())

        planes, per_slice = [], []
        kept_total = 0
        for k in range(shape[2]):
            sl = mask[:, :, k]
            if not sl.any():
                continue
            m2 = sl.T  # (row, col)
            polys, holes, kept = polygons_for_slice(m2)
            npx = int(kept.sum())
            if npx == 0 or not polys:
                continue
            kept_total += npx
            rows, cols = np.nonzero(kept)
            cen = dicom_pixel_to_lps(slices[k]["ipp"], iop, ps, col=cols.mean(), row=rows.mean())
            xs_lps = slices[k]["ipp"][0] + cols * float(ps[1]) * iop[0] + rows * float(ps[0]) * iop[3]
            lab, ncomp = ndi.label(kept, structure=CROSS)
            comp_areas = sorted((np.bincount(lab.ravel())[1:] * px_area).round(1).tolist(), reverse=True)
            plane = {"sopInstanceUid": slices[k]["sopInstanceUid"], "frame": 1, "polygons": polys}
            if holes:
                plane["holes"] = holes
            planes.append(plane)
            per_slice.append({"k": k, "sop": slices[k]["sopInstanceUid"], "proj": slices[k]["proj"],
                              "areaMm2": round(npx * px_area, 1), "components": int(ncomp), "componentAreasMm2": comp_areas,
                              "centroidLps": [round(float(v), 2) for v in cen],
                              "xExtentLps": [round(float(min(xs_lps)), 2), round(float(max(xs_lps)), 2)],
                              "nPolygons": len(polys), "nHoles": len(holes)})
        rec["status"] = "ok" if planes else "empty_after_speck_removal"
        rec["voxelsKept"] = kept_total
        rec["volumeMl"] = round(kept_total * px_area * float(elig["sliceStepMm"]) / 1000.0, 2)
        rec["slices"] = per_slice
        rec["kRange"] = [per_slice[0]["k"], per_slice[-1]["k"]] if per_slice else None
        out["structures"][cls] = rec
        if planes:
            dump_json_compact({"geometryType": "contour_set", "space": "image_px", "planes": planes},
                              d / f"contours{sfx}" / f"{cls}.json")
    dump_json(out, d / f"structures{sfx}.json")
    return out


def main(argv):
    fast = "--fast" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")]
    if not cases:
        cases = [r["case"] for r in load_json(WORK / "eligibility.json") if r["eligible"]]
    for c in cases:
        o = process(c, fast)
        print(f"{c}: slice/IPP max residual {o['sliceIppMatchMaxResidualMm']:.2e} mm")
        for cls, r in o["structures"].items():
            a = r.get("alignment", {})
            print(f"   {cls:28s} {r['status']:10s} resampled={r.get('resampled')} vox={r.get('voxels')} "
                  f"k={r.get('kRange')} meanHU={r.get('meanHU', float('nan')):.0f} maxRes={a.get('maxResidualMm', float('nan')):.2e}")


if __name__ == "__main__":
    main(sys.argv)
