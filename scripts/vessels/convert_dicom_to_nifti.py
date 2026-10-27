"""Step 1: pick eligible contrast-enhanced chest CTs from the image packs (chest-pairs, body) and convert each
DICOM series to NIfTI on the ORIGINAL slice grid (no resampling).

  python scripts/vessels/convert_dicom_to_nifti.py            # all CT diagnostic series in SOURCE_PACKS (chest-pairs, body)
  python scripts/vessels/convert_dicom_to_nifti.py ar-16434363 # one case

Conversion (explicit, so mask voxels map 1:1 back to DICOM pixels):
  * every instance listed in the source pack's pack.json is read with pydicom (JPEG-LS via python-gdcm);
    SOPInstanceUID / SeriesInstanceUID / IPP are checked against pack.json;
  * HU = stored * RescaleSlope + RescaleIntercept (per instance), stored as int16;
  * slices sorted by IPP . n with n = IOP[0:3] x IOP[3:6]; spacing must be uniform (<=0.01 mm) and
    IPPs collinear along n (no shear/tilt), otherwise the case is rejected;
  * SimpleITK image: index (i, j, k) = (column, row, sorted slice); origin = IPP of sorted slice 0
    (LPS mm, centre of first pixel); spacing = (PixelSpacing[1], PixelSpacing[0], slice step);
    direction columns = (IOP[0:3], IOP[3:6], n). SimpleITK holds LPS physical space.
  * sitk.WriteImage(.nii.gz): ITK's NIfTI writer stores qform/sform in RAS by negating the first two
    rows (x, y) of the LPS affine. Voxel index order is unchanged. Verified by reading back with
    nibabel: affine_RAS == diag(-1,-1,1,1) @ affine_LPS.

Writes WORK/<case>/ct.nii.gz, slices.json (k -> sopInstanceUid, IPP, ...) and eligibility.json.
"""
from __future__ import annotations

import sys
import time

import nibabel as nib
import numpy as np
import pydicom
import SimpleITK as sitk

from common import (RAS_TO_LPS, WORK, case_dir, case_short, dump_json, slice_normal, source_manifests)

NO_CONTRAST = ("W/O", "WO ", "WITHOUT", "NONE", "NON-CONTRAST", "NONCONTRAST", "NO CONTRAST", "W/O_IV")


def contrast_status(ds) -> tuple[bool, str]:
    agent = str(getattr(ds, "ContrastBolusAgent", "") or "").strip()
    route = str(getattr(ds, "ContrastBolusRoute", "") or "").strip()
    study = str(getattr(ds, "StudyDescription", "") or "").strip()
    desc = f"ContrastBolusAgent={agent!r}, ContrastBolusRoute={route!r}, StudyDescription={study!r}"
    if not agent:
        return False, desc + " -> no ContrastBolusAgent"
    up = (agent + " " + study + " ").upper()
    if any(tok in up for tok in NO_CONTRAST):
        return False, desc + " -> agent/study text says without contrast"
    if "ORAL" in agent.upper() and "IV" not in agent.upper() and "OPTIRAY" not in agent.upper() and "IV" not in route.upper():
        return False, desc + " -> oral contrast only"
    return True, desc


def convert(se: dict, pack_id: str, pack_root) -> dict:
    case = case_short(se["subjectKey"])
    out = case_dir(case)
    out.mkdir(parents=True, exist_ok=True)
    rec = {"case": case, "packId": pack_id, "subjectKey": se["subjectKey"], "seriesUid": se["uid"], "description": se["description"]}
    t0 = time.time()

    first = pydicom.dcmread(pack_root / se["instances"][0]["file"], stop_before_pixels=True)
    ok, why = contrast_status(first)
    rec["contrast"] = {"enhanced": ok, "evidence": why}
    itype = [str(x).upper() for x in getattr(first, "ImageType", [])]
    rec["imageType"] = itype
    rec["patientPosition"] = str(getattr(first, "PatientPosition", ""))
    if not ok:
        rec["eligible"] = False
        rec["reason"] = "not contrast-enhanced: " + why
        dump_json(rec, out / "eligibility.json")
        return rec
    if "ORIGINAL" not in itype or "AXIAL" not in itype:
        rec["eligible"] = False
        rec["reason"] = f"not an original axial series (ImageType={itype})"
        dump_json(rec, out / "eligibility.json")
        return rec

    slices = []
    iop0 = ps0 = shape0 = None
    for inst in se["instances"]:
        ds = pydicom.dcmread(pack_root / inst["file"])
        assert ds.SOPInstanceUID == inst["sopInstanceUid"], "SOP UID mismatch vs pack.json"
        assert ds.SeriesInstanceUID == se["uid"], "Series UID mismatch vs pack.json"
        ipp = [float(v) for v in ds.ImagePositionPatient]
        iop = [float(v) for v in ds.ImageOrientationPatient]
        ps = [float(v) for v in ds.PixelSpacing]
        assert np.allclose(ipp, inst["ipp"], atol=1e-3), f"IPP mismatch vs pack.json {ipp} {inst['ipp']}"
        if iop0 is None:
            iop0, ps0, shape0 = iop, ps, (int(ds.Rows), int(ds.Columns))
        assert np.allclose(iop, iop0, atol=1e-4), "IOP varies within series"
        assert np.allclose(ps, ps0, atol=1e-6), "PixelSpacing varies within series"
        assert (int(ds.Rows), int(ds.Columns)) == shape0, "matrix size varies within series"
        assert int(getattr(ds, "NumberOfFrames", 1) or 1) == 1, "multi-frame not supported"
        arr = ds.pixel_array.astype(np.float64) * float(getattr(ds, "RescaleSlope", 1.0)) + float(getattr(ds, "RescaleIntercept", 0.0))
        slices.append({"sop": ds.SOPInstanceUID, "file": inst["file"], "ipp": ipp, "instanceNumber": inst["instanceNumber"],
                       "hu": np.clip(np.rint(arr), -32768, 32767).astype(np.int16)})

    n = slice_normal(iop0)
    proj = np.array([np.dot(s["ipp"], n) for s in slices])
    order = np.argsort(proj)
    steps = np.diff(proj[order])
    step = float(np.median(steps))
    rec["sliceStepMm"] = step
    rec["sliceStepRange"] = [float(steps.min()), float(steps.max())]
    if np.max(np.abs(steps - step)) > 0.01 or step <= 0:
        rec["eligible"] = False
        rec["reason"] = f"non-uniform slice spacing {rec['sliceStepRange']}"
        dump_json(rec, out / "eligibility.json")
        return rec
    ipp_sorted = np.array([slices[i]["ipp"] for i in order])
    shear = ipp_sorted - ipp_sorted[0] - np.outer(proj[order] - proj[order][0], n)
    rec["ippOffAxisMaxMm"] = float(np.abs(shear).max())
    if rec["ippOffAxisMaxMm"] > 0.01:
        rec["eligible"] = False
        rec["reason"] = "IPPs not collinear along the slice normal (tilt/shear)"
        dump_json(rec, out / "eligibility.json")
        return rec
    rec["packOrderIsAscendingProjection"] = bool(np.all(order == np.arange(len(order))))

    vol = np.stack([slices[i]["hu"] for i in order])  # [k, row, col]
    img = sitk.GetImageFromArray(vol)  # sitk index (x=col, y=row, z=k)
    img.SetSpacing((float(ps0[1]), float(ps0[0]), step))
    img.SetOrigin(tuple(float(v) for v in ipp_sorted[0]))
    X, Y = np.array(iop0[:3]), np.array(iop0[3:])
    D = np.column_stack([X, Y, n])
    img.SetDirection(tuple(float(v) for v in D.flatten()))  # row-major 3x3
    nii = out / "ct.nii.gz"
    sitk.WriteImage(img, str(nii), useCompression=True)

    # read back with nibabel and verify the LPS<->RAS handling
    A_lps = np.eye(4)
    A_lps[:3, :3] = D @ np.diag([ps0[1], ps0[0], step])
    A_lps[:3, 3] = ipp_sorted[0]
    nimg = nib.load(str(nii))
    A_ras = nimg.affine
    rec["niftiAffineRAS"] = A_ras.tolist()
    rec["niftiVsDicomAffineMaxAbsDiff"] = float(np.abs(RAS_TO_LPS @ A_ras - A_lps).max())
    data = np.asanyarray(nimg.dataobj)
    rng = np.random.default_rng(0)
    idx = rng.integers([0, 0, 0], data.shape, size=(50, 3))
    rec["niftiVoxelOrderCheck"] = bool(all(data[i, j, k] == vol[k, j, i] for i, j, k in idx))
    assert rec["niftiVsDicomAffineMaxAbsDiff"] < 1e-3 and rec["niftiVoxelOrderCheck"], "NIfTI write/read-back mismatch"

    rec["shape_ijk"] = list(data.shape)
    rec["pixelSpacing"] = ps0
    rec["iop"] = iop0
    rec["normal"] = n.tolist()
    rec["projRangeMm"] = [float(proj.min()), float(proj.max())]
    rec["huP99_5"] = float(np.percentile(vol, 99.5))
    rec["eligible"] = True
    rec["reason"] = "contrast-enhanced original axial series; coverage of the superior mediastinum is confirmed after segmentation (see qc.json)"
    rec["convertSeconds"] = round(time.time() - t0, 1)
    rec["conversion"] = ("pydicom read of every pack instance (python-gdcm for JPEG-LS), HU=stored*slope+intercept -> int16, "
                         "sorted by IPP.n, SimpleITK image (origin=IPP of first sorted slice, spacing=(PixelSpacing[1],PixelSpacing[0],step), "
                         "direction=(IOP row cosine, IOP column cosine, n)) written with sitk.WriteImage to NIfTI-1 .nii.gz "
                         "(ITK converts LPS->RAS by negating x,y in qform/sform); read back with nibabel and checked.")
    dump_json([{"k": int(k), "sopInstanceUid": slices[i]["sop"], "file": slices[i]["file"], "ipp": slices[i]["ipp"],
                "proj": float(proj[i]), "instanceNumber": slices[i]["instanceNumber"]} for k, i in enumerate(order)],
              out / "slices.json")
    dump_json(rec, out / "eligibility.json")
    return rec


def main(argv):
    want = set(argv[1:])
    results = []
    for pack_id, root, m in source_manifests():
        for se in m["series"]:
            if se["modality"] != "CT" or se["role"] != "diagnostic":
                continue
            case = case_short(se["subjectKey"])
            if want and case not in want:
                continue
            r = convert(se, pack_id, root)
            print(f"{pack_id:12s} {case:22s} eligible={r['eligible']}  {r.get('reason')}")
            results.append({k: r.get(k) for k in ("case", "packId", "subjectKey", "seriesUid", "description", "eligible", "reason", "contrast")})
    if not want:
        dump_json(results, WORK / "eligibility.json")


if __name__ == "__main__":
    main(sys.argv)
