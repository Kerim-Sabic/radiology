"""Atlas step CT-1: convert every diagnostic CT series of the image packs to NIfTI on its ORIGINAL slice grid.

  python scripts/atlas/ct_convert.py [case ...]

Same explicit conversion as scripts/vessels/convert_dicom_to_nifti.py (pydicom read of every instance listed in the
pack, HU int16, slices sorted by IPP . n, SimpleITK image with origin = first IPP, spacing = (PixelSpacing[1],
PixelSpacing[0], step), direction = (IOP row cosine, IOP column cosine, n); ITK's NIfTI writer stores RAS = x,y
negated; read back with nibabel and checked) but WITHOUT a contrast requirement. Series are rejected only for
geometry that cannot be represented as a regular grid (non-uniform spacing, IPPs not collinear along n = gantry
tilt, varying IOP / matrix, multi-frame). Scouts and vendor reformats (role != diagnostic) and MR/MG are skipped.
Writes WORK/<case>/ct.nii.gz, slices.json, info.json and WORK/ct_cases.json.
"""
from __future__ import annotations

import sys
import time

import nibabel as nib
import numpy as np
import pydicom
import SimpleITK as sitk

from common import RAS_TO_LPS, WORK, dump_json, load_json, slice_normal, source_manifests, subject_short


def case_ids():
    """Stable case id per CT series: subject short name, suffixed with the series UID tail if a subject has >1 CT."""
    rows = []
    for pid, root, m in source_manifests():
        for se in m["series"]:
            if se["modality"] == "CT" and se["role"] == "diagnostic":
                rows.append((pid, root, se))
    count = {}
    for _, _, se in rows:
        k = subject_short(se["subjectKey"])
        count[k] = count.get(k, 0) + 1
    out = []
    for pid, root, se in rows:
        k = subject_short(se["subjectKey"])
        out.append((k if count[k] == 1 else f"{k}-{se['uid'][-6:]}", pid, root, se))
    return out


def convert(case, pack_id, root, se) -> dict:
    out = WORK / case
    out.mkdir(parents=True, exist_ok=True)
    rec = {"case": case, "packId": pack_id, "subjectKey": se["subjectKey"], "seriesUid": se["uid"],
           "description": se["description"], "bodyPart": se.get("bodyPart")}
    t0 = time.time()
    slices, iop0, ps0, shape0 = [], None, None, None
    try:
        for inst in se["instances"]:
            ds = pydicom.dcmread(root / inst["file"])
            assert ds.SOPInstanceUID == inst["sopInstanceUid"] and ds.SeriesInstanceUID == se["uid"], "UID mismatch vs pack.json"
            assert int(getattr(ds, "NumberOfFrames", 1) or 1) == 1, "multi-frame"
            ipp = [float(v) for v in ds.ImagePositionPatient]
            iop = [float(v) for v in ds.ImageOrientationPatient]
            ps = [float(v) for v in ds.PixelSpacing]
            if iop0 is None:
                iop0, ps0, shape0 = iop, ps, (int(ds.Rows), int(ds.Columns))
                rec["patientPosition"] = str(getattr(ds, "PatientPosition", ""))
                rec["imageType"] = [str(x) for x in getattr(ds, "ImageType", [])]
                rec["kernel"] = str(getattr(ds, "ConvolutionKernel", "") or "")
                rec["contrastBolusAgent"] = str(getattr(ds, "ContrastBolusAgent", "") or "")
            assert np.allclose(iop, iop0, atol=1e-4), "IOP varies"
            assert np.allclose(ps, ps0, atol=1e-6), "PixelSpacing varies"
            assert (int(ds.Rows), int(ds.Columns)) == shape0, "matrix varies"
            arr = ds.pixel_array.astype(np.float64) * float(getattr(ds, "RescaleSlope", 1.0)) + float(getattr(ds, "RescaleIntercept", 0.0))
            slices.append({"sop": ds.SOPInstanceUID, "file": inst["file"], "ipp": ipp,
                           "hu": np.clip(np.rint(arr), -32768, 32767).astype(np.int16)})
    except AssertionError as e:
        rec.update(eligible=False, reason=f"geometry: {e}")
        dump_json(rec, out / "info.json")
        return rec
    n = slice_normal(iop0)
    proj = np.array([np.dot(s["ipp"], n) for s in slices])
    order = np.argsort(proj)
    steps = np.diff(proj[order])
    step = float(np.median(steps))
    rec["sliceStepMm"] = step
    if len(slices) < 10 or step <= 0 or np.max(np.abs(steps - step)) > 0.01:
        rec.update(eligible=False, reason=f"non-uniform / too few slices (n={len(slices)}, steps {steps.min():.3f}-{steps.max():.3f})")
        dump_json(rec, out / "info.json")
        return rec
    ipp_sorted = np.array([slices[i]["ipp"] for i in order])
    off = np.abs(ipp_sorted - ipp_sorted[0] - np.outer(proj[order] - proj[order][0], n)).max()
    if off > 0.01:
        rec.update(eligible=False, reason=f"IPPs not collinear along the slice normal (tilt), max offset {off:.3f} mm")
        dump_json(rec, out / "info.json")
        return rec
    vol = np.stack([slices[i]["hu"] for i in order])
    img = sitk.GetImageFromArray(vol)
    img.SetSpacing((float(ps0[1]), float(ps0[0]), step))
    img.SetOrigin(tuple(float(v) for v in ipp_sorted[0]))
    D = np.column_stack([np.array(iop0[:3]), np.array(iop0[3:]), n])
    img.SetDirection(tuple(float(v) for v in D.flatten()))
    sitk.WriteImage(img, str(out / "ct.nii.gz"), useCompression=True)
    A_lps = np.eye(4)
    A_lps[:3, :3] = D @ np.diag([ps0[1], ps0[0], step])
    A_lps[:3, 3] = ipp_sorted[0]
    nimg = nib.load(str(out / "ct.nii.gz"))
    rec["niftiVsDicomAffineMaxAbsDiff"] = float(np.abs(RAS_TO_LPS @ nimg.affine - A_lps).max())
    data = np.asanyarray(nimg.dataobj)
    idx = np.random.default_rng(0).integers([0, 0, 0], data.shape, size=(50, 3))
    rec["niftiVoxelOrderCheck"] = bool(all(data[i, j, k] == vol[k, j, i] for i, j, k in idx))
    assert rec["niftiVsDicomAffineMaxAbsDiff"] < 1e-3 and rec["niftiVoxelOrderCheck"], "NIfTI read-back mismatch"
    rec.update(eligible=True, reason="regular axial grid", shape_ijk=list(data.shape), pixelSpacing=ps0, iop=iop0,
               normal=n.tolist(), projRangeMm=[float(proj.min()), float(proj.max())], convertSeconds=round(time.time() - t0, 1),
               rows=shape0[0], columns=shape0[1])
    dump_json([{"k": int(k), "sopInstanceUid": slices[i]["sop"], "file": slices[i]["file"], "ipp": slices[i]["ipp"],
                "proj": float(proj[i])} for k, i in enumerate(order)], out / "slices.json")
    dump_json(rec, out / "info.json")
    return rec


def main(argv):
    want = set(argv[1:])
    allrec = load_json(WORK / "ct_cases.json") if (WORK / "ct_cases.json").exists() else []
    by_case = {r["case"]: r for r in allrec}
    for case, pid, root, se in case_ids():
        if want and case not in want:
            continue
        if not want and case in by_case and (WORK / case / "ct.nii.gz").exists():
            continue  # already converted (re-run explicitly to redo)
        r = convert(case, pid, root, se)
        by_case[case] = {k: r.get(k) for k in ("case", "packId", "subjectKey", "seriesUid", "description", "eligible", "reason")}
        print(f"{pid:12s} {case:24s} eligible={r['eligible']} {r.get('reason')} {r.get('shape_ijk')}")
    dump_json(sorted(by_case.values(), key=lambda r: r["case"]), WORK / "ct_cases.json")


if __name__ == "__main__":
    main(sys.argv)
