"""Step 6: end-to-end check of the WRITTEN pack targets against the original DICOM files.

  python scripts/vessels/verify_targets.py [--fast]

Independent of the NIfTI path used to make them, for every contour_set plane in public/packs/vessel-drafts:
  * the SOP Instance UID is looked up in the image packs' pack.json (chest-pairs, body) and that DICOM file is
    read with pydicom;
  * polygons (minus holes) are rasterised with skimage.draw.polygon in image_px (pixel centres inside -> 1);
  * Dice vs the TotalSegmentator mask slice (slice chosen via IPP sort / slices.json; same speck removal) measures
    what tracing + simplification changed;
  * the rasterised region's centroid is mapped to LPS with the DICOM file's own IPP/IOP/PixelSpacing and compared
    with the mask voxels' centroid mapped through the NIfTI affine (RAS -> LPS). A swapped row/column, a flipped
    axis or an off-by-one slice would show up as a residual of millimetres;
  * mean HU inside the polygon is read from the DICOM pixels (trachea must be air, enhanced vessels bright).
For every slice_interval: each listed SOP belongs to the series, its IPP . normal lies in range, and every
instance of the series whose IPP . normal lies in range is listed.
Writes WORK/verify[_fast].json.
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
import pydicom
from scipy import ndimage as ndi
from skimage.draw import polygon as fill_polygon

from common import (MIN_COMPONENT_PX, OUT_PACK, RAS_TO_LPS, WORK, case_dir, case_short, dicom_pixel_to_lps, dump_json, load_json,
                    series_index)


def rasterise(plane, rows, cols):
    m = np.zeros((rows, cols), bool)
    for ring in plane["polygons"]:
        a = np.asarray(ring, float)
        rr, cc = fill_polygon(a[:, 1], a[:, 0], (rows, cols))
        m[rr, cc] = True
    for ring in plane.get("holes", []):
        a = np.asarray(ring, float)
        rr, cc = fill_polygon(a[:, 1], a[:, 0], (rows, cols))
        m[rr, cc] = False
    return m


def verify(fast: bool = False) -> list[dict]:
    sfx = "_fast" if fast else ""
    pack = load_json(OUT_PACK / "pack.json")
    sidx = series_index()
    series = {uid: v[2] for uid, v in sidx.items()}
    inst_by_sop = {i["sopInstanceUid"]: (v[2], i, v[1]) for v in sidx.values() for i in v[2]["instances"]}
    dcm_cache, results = {}, []
    for t in pack["referenceTargets"]:
        se = series[t["seriesUid"]]
        case = case_short(se["subjectKey"])
        g = load_json(OUT_PACK / t["geometryFile"])
        if t["geometryType"] == "slice_interval":
            n = np.array(g["normal"])
            lo, hi = g["range"]
            in_range = {i["sopInstanceUid"] for i in se["instances"] if lo - 1e-3 <= float(np.dot(i["ipp"], n)) <= hi + 1e-3}
            listed = set(g["sopInstanceUids"])
            ok = listed == in_range and all(inst_by_sop[u][0]["uid"] == se["uid"] for u in listed)
            results.append({"id": t["id"], "type": "slice_interval", "ok": bool(ok), "slices": len(listed),
                            "rangeMm": [lo, hi], "unitNormal": bool(abs(np.linalg.norm(n) - 1) < 1e-6)})
            continue
        d = case_dir(case)
        slices = {s["sopInstanceUid"]: s for s in load_json(d / "slices.json")}
        cls = t["classId"].split(":", 1)[1]
        mimg = nib.load(str(d / f"seg{sfx}" / f"{cls}.nii.gz"))
        A = RAS_TO_LPS @ mimg.affine
        mask = np.asanyarray(mimg.dataobj) > 0
        dice, resid, hus = [], [], []
        for pl in g["planes"]:
            _, inst, root = inst_by_sop[pl["sopInstanceUid"]]
            if pl["sopInstanceUid"] not in dcm_cache:
                ds = pydicom.dcmread(root / inst["file"])
                hu = ds.pixel_array.astype(np.float64) * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
                dcm_cache[pl["sopInstanceUid"]] = (hu, [float(v) for v in ds.ImagePositionPatient],
                                                   [float(v) for v in ds.ImageOrientationPatient], [float(v) for v in ds.PixelSpacing])
            hu, ipp, iop, ps = dcm_cache[pl["sopInstanceUid"]]
            poly = rasterise(pl, hu.shape[0], hu.shape[1])
            k = slices[pl["sopInstanceUid"]]["k"]
            ref = mask[:, :, k].T.copy()
            lab, nl = ndi.label(ref, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
            sizes = np.bincount(lab.ravel())
            ref &= sizes[lab] >= MIN_COMPONENT_PX  # same speck removal as masks_to_contours.py
            inter = (poly & ref).sum()
            dice.append(2 * inter / (poly.sum() + ref.sum()))
            r, c = np.nonzero(poly)
            p_dicom = dicom_pixel_to_lps(ipp, iop, ps, col=c.mean(), row=r.mean())
            rr, cc = np.nonzero(ref)
            p_nifti = (A @ np.array([cc.mean(), rr.mean(), k, 1.0]))[:3]
            resid.append(float(np.linalg.norm(p_dicom - p_nifti)))
            hus.append(float(hu[poly].mean()))
        results.append({"id": t["id"], "type": "contour_set", "planes": len(g["planes"]),
                        "diceMean": round(float(np.mean(dice)), 4), "diceMin": round(float(np.min(dice)), 4),
                        "centroidResidualMaxMm": float(f"{max(resid):.2e}"), "centroidResidualMeanMm": float(f"{np.mean(resid):.2e}"),
                        "meanHUFromDicom": round(float(np.mean(hus)), 1),
                        "ok": bool(max(resid) < 0.5)})
    dump_json(results, WORK / f"verify{sfx}.json")
    return results


def main(argv):
    results = verify("--fast" in argv)
    bad = [r for r in results if not r["ok"]]
    for r in results:
        print(r)
    print(f"{len(results) - len(bad)}/{len(results)} targets ok")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv)
