"""Cardiac MRI pack (`msd-heart-mri`): the left atrium on 20 whole-heart 3D MRIs (Medical Segmentation Decathlon, Task02_Heart).

  python scripts/data/msd_heart.py fetch     # download Task02_Heart.tar (455 MB, anonymous AWS Open Data) and unpack it into RAW
  python scripts/data/msd_heart.py build     # write public/packs/msd-heart-mri (+ docs/data/msd-heart-mri-build-qc.json, index entry)
  python scripts/data/msd_heart.py index

Source: Medical Segmentation Decathlon, Task02_Heart (King's College London, originally the Left Atrial Segmentation Challenge
2013), 20 training cases with labels; the 10 test cases have no labels and are not used. Licence CC BY-SA 4.0, as written in the
task's own dataset.json ("licence": "CC-BY-SA 4.0") and on https://registry.opendata.aws/msd/ ("CC-BY-SA 4.0 International").

The files are NIfTI with a bare diagonal affine (no orientation information) and are SAGITTAL acquisitions: array axis 0 runs
posterior -> anterior, axis 1 inferior -> superior and axis 2 left -> right (see docs/data/msd-heart-mri-report.md for how this was
established and checked by eye, case by case). The pack reads them into a right-handed RAS grid (x = axis 2, y = axis 0, z = axis 1)
without any resampling, so each DICOM axial image is a native-voxel reformat (pixel 1.37 x 1.25 mm, slice step 2 x 1.25 mm = 2.5 mm).
Cropping: z from 25 mm below to 25 mm above the labelled atrium, in plane to the body.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tarfile
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import build_r4 as b4  # noqa: E402
from annotations import REVIEW  # noqa: E402
from build_external import build_series, log  # noqa: E402

DATA = Path(os.environ.get("RADIOLOGY_DATA_DIR", r"C:\Users\kerim\radiology-data"))
RAW = DATA / "msd-heart"
TASK = RAW / "x" / "Task02_Heart"
PACK_ID = "msd-heart-mri"
MR_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.4"
URL = "https://msd-for-monai.s3.us-west-2.amazonaws.com/Task02_Heart.tar"
STEP = 2
MARGIN = 20  # raw slices (25 mm) above and below the labelled atrium

SOURCE = {
    "id": "msd:Task02_Heart",
    "name": "Medical Segmentation Decathlon, Task 02 Heart (left atrium; King's College London)",
    "url": "http://medicaldecathlon.com/",
    "doi": "10.1038/s41467-022-30695-9",
    "license": "CC BY-SA 4.0 (as written in the task's dataset.json and on the AWS Open Data registry page of the Decathlon)",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "citation": ("Antonelli M, Reinke A, Bakas S, et al. The Medical Segmentation Decathlon. Nature Communications. 2022;13:4128. "
                 "doi:10.1038/s41467-022-30695-9. Task data: King's College London, released through the Left Atrial Segmentation "
                 "Challenge (Tobon-Gomez C, et al. IEEE Trans Med Imaging 2015;34:1460-1473). Simpson AL, et al., arXiv:1902.09063."),
    "accessNote": ("Task02_Heart.tar (455,721,472 bytes) downloaded anonymously from the public AWS Open Data bucket msd-for-monai "
                   "(registry.opendata.aws/msd, no account); only imagesTr and labelsTr (20 cases with labels) are used. The licence "
                   "was read from the tar's dataset.json and the registry page on 2026-11-09. The derived DICOM is shared under the same "
                   "licence (CC BY-SA 4.0); changes: reformatted to axial DICOM, cropped and thinned to 2.5 mm, outlines traced per slice."),
}
# Dropped after review: la_026 is voxel-for-voxel the same image as la_005 (correlation 1.0 over the whole volume, all voxels equal;
# only the label differs, 115 vs 125 ml), so keeping both would show one patient twice.
DROPPED = {"la_026": "identical image to la_005 (same patient, different outline)"}
LEAK = re.compile(b4.LEAK.pattern + r"|Decathlon|MSD|King|KCL|LASC|Task02|Atrial Segmentation|(?i:atrium|atrial|fibrillation|ablation)")


def code_of(case: str) -> str:
    return "CMR-" + hashlib.sha256(("msd-heart-mri" + case).encode()).hexdigest()[:8].upper()


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fetch() -> None:
    import requests
    RAW.mkdir(parents=True, exist_ok=True)
    tar = RAW / "Task02_Heart.tar"
    if not tar.exists() or tar.stat().st_size != 455721472:
        with requests.get(URL, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(tar, "wb") as f:
                for c in r.iter_content(1 << 20):
                    f.write(c)
    (RAW / "x").mkdir(exist_ok=True)
    with tarfile.open(tar) as t:
        t.extractall(RAW / "x", filter="data")
    log("ok", tar.stat().st_size)


def cases() -> list[str]:
    meta = json.loads((TASK / "dataset.json").read_text(encoding="utf-8"))
    out = sorted(Path(e["image"]).name.replace(".nii.gz", "") for e in meta["training"])
    assert len(out) == 20 and meta["licence"] == "CC-BY-SA 4.0", meta.get("licence")
    return [c for c in out if c not in DROPPED]


def load(case: str):
    """(axial RAS volume [x, y, z] float, label volume, RAS affine) from the sagittal NIfTI; no resampling."""
    import nibabel as nib
    im, lb = nib.load(TASK / "imagesTr" / f"{case}.nii.gz"), nib.load(TASK / "labelsTr" / f"{case}.nii.gz")
    assert im.shape == lb.shape and np.allclose(im.affine, lb.affine)
    z = im.header.get_zooms()[:3]
    a = np.asarray(im.dataobj, dtype=np.float64)
    assert np.abs(a - np.round(a)).max() == 0 and a.min() >= 0 and a.max() < 65535, "signal is not whole numbers"
    m = np.asarray(lb.dataobj)
    assert set(np.unique(m)) <= {0, 1}
    # axis 0: posterior -> anterior (y), axis 1: inferior -> superior (z), axis 2: left -> right (x); proper rotation (det +1)
    vol = np.ascontiguousarray(a.transpose(2, 0, 1)).astype(np.uint16)
    lab = np.ascontiguousarray((m > 0).transpose(2, 0, 1))
    aff = np.diag([float(z[2]), float(z[0]), float(z[1]), 1.0])
    return vol, lab, aff


def crop_of(vol: np.ndarray, lab: np.ndarray) -> dict:
    zz = np.where(lab.any(axis=(0, 1)))[0]
    z0, z1 = max(0, int(zz.min()) - MARGIN), min(vol.shape[2] - 1, int(zz.max()) + MARGIN)
    slab = vol[:, :, z0:z1 + 1]
    body = slab.max(axis=2) > 0.06 * np.percentile(slab, 99.5)
    ys = np.where(body.any(axis=0))[0]
    ly = np.where(lab.any(axis=(0, 2)))[0]
    y0, y1 = max(0, min(int(ys.min()), int(ly.min()) - 40) - 6), min(vol.shape[1] - 1, max(int(ys.max()), int(ly.max()) + 40) + 6)
    return {"y0": y0, "y1": y1, "z0": z0, "z1": z1}


def mr_items(case: str, sub: np.ndarray, img, frame_uid: str, top: float) -> list:
    fi, fj, rowdir, coldir, ps, step, ipp = bx._isles_grid(img)
    study, series = bx.uid_for(PACK_ID, case, "study"), bx.uid_for(PACK_ID, case, "mr", "series")
    items = []
    for k in range(sub.shape[2]):
        a = bx._isles_slice(sub, k, fi, fj)
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = MR_SOP_CLASS
        meta.MediaStorageSOPInstanceUID = bx.uid_for(PACK_ID, case, "mr", str(k))
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = Dataset()
        ds.file_meta = meta
        ds.SpecificCharacterSet = "ISO_IR 100"
        ds.SOPClassUID = MR_SOP_CLASS
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame_uid
        ds.PositionReferenceIndicator = ""
        ds.Modality = "MR"
        ds.ImageType = ["DERIVED", "SECONDARY", "M"]
        ds.PatientID = code_of(case)
        ds.PatientName = ""
        ds.StudyID = ds.PatientID[-8:]
        ds.StudyDescription = "Cardiac MRI"
        ds.SeriesDescription = "3D whole-heart MRI, axial reformat, 2.5 mm"
        ds.SeriesNumber = 1
        ds.InstanceNumber = k + 1
        ds.BodyPartExamined = "HEART"
        ds.Manufacturer = "Philips Healthcare"
        ds.ManufacturerModelName = "Achieva"
        ds.MagneticFieldStrength = 1.5
        ds.ScanningSequence = "GR"
        ds.SequenceVariant = ["SP"]
        ds.ScanOptions = ""
        ds.MRAcquisitionType = "3D"
        ds.SliceThickness = round(step / STEP, 3)
        ds.SpacingBetweenSlices = round(step, 3)
        ds.ImagePositionPatient = [round(float(v), 4) for v in ipp(k)]
        ds.ImageOrientationPatient = [round(float(v), 6) for v in (*rowdir, *coldir)]
        ds.PixelSpacing = [round(ps[0], 6), round(ps[1], 6)]
        ds.DerivationDescription = (
            "3D whole-heart MRI (1.5 T, free breathing, ECG and respiratory gated, one cardiac phase) acquired as 1.25 mm sagittal "
            "images, read from the distributed NIfTI and reformatted to axial without resampling (native voxels, 1.37 x 1.25 mm in "
            "plane, 1.25 mm between slices); every second slice kept (2.5 mm), cropped to the chest around the heart. Signal values "
            "as distributed (whole numbers), stored unsigned 16-bit. The NIfTI affine carries no orientation, so the orientation "
            "was established from the anatomy (aorta, spine, liver, venae cavae).")
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = a.shape
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 0
        ds.WindowCenter, ds.WindowWidth = round(top / 2, 1), round(top, 1)
        ds.PixelData = a.astype(np.uint16).tobytes()
        items.append(bx.to_item(ds, f"mr-{k:03d}.dcm"))
    return items


def build_msd() -> tuple[list, list, list, dict]:
    import nibabel as nib
    results, targets, geoms, facts = [], [], [], {}
    for case in cases():
        vol, lab, aff = load(case)
        c = crop_of(vol, lab)
        sl = (slice(None), slice(c["y0"], c["y1"] + 1), slice(c["z0"], c["z1"] + 1, STEP))
        sub, msub = vol[sl], lab[sl]
        a2 = aff.copy()
        a2[:3, 3] = (aff @ np.array([0, c["y0"], c["z0"], 1.0]))[:3]
        a2[:3, 2] *= STEP
        img = nib.Nifti1Image(sub, a2)
        fi, fj, *_ = bx._isles_grid(img)
        top = float(np.percentile(sub, 99.5))
        skey = f"{SOURCE['id']}:{case}"
        items = mr_items(case, sub, img, bx.uid_for(PACK_ID, case, "frame"), top)
        sr = build_series(items, {"region": "chest", "role": "diagnostic", "roleNote": "Axial reformat of a 3D whole-heart MRI."}, skey)
        bx._place(sr, ("Axial reformat of a 3D whole-heart MRI (2.5 mm), cropped around the heart; the orientation was established from the "
                       "anatomy. Blood is bright and heart muscle grey; the lungs are dark."))
        results.append((sr, skey, {"sourceId": SOURCE["id"]}))
        sop = {int(it.name.split("-")[1][:3]): str(it.ds.SOPInstanceUID) for it in items}
        order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
        planes = []
        for k in range(msub.shape[2]):
            if msub[:, :, k].any():
                pl = b4._rings_planes(bx._isles_slice(msub, k, fi, fj), sop[k])
                if pl:
                    planes.append(pl)
        planes.sort(key=lambda p: order[p["sopInstanceUid"]])
        full = lab.sum() * 1.37 * 1.25 * 1.25 / 1000.0
        lf = TASK / "labelsTr" / f"{case}.nii.gz"
        tid = f"msdh-{case}-left-atrium"
        targets.append({
            "id": tid, "label": "Left atrium", "classId": "anatomy:heart_atrium_left", "seriesUid": sr.uid, "geometryType": "contour_set",
            "geometryFile": f"targets/{tid}.json", "provenance": "source_automated",
            "provenanceDetail": {
                "source": f"msd:Task02_Heart (labelsTr/{case}.nii.gz, sha256 {sha256(lf)[:16]}...)",
                "method": ("Segmentation distributed with the Medical Segmentation Decathlon heart task (King's College London, Left Atrial "
                           "Segmentation Challenge): the left atrium including the left atrial appendage, the mitral plane and the "
                           "pulmonary vein end points were segmented by an expert using an automated tool followed by manual correction "
                           "(Antonelli et al. 2022). Semi-automatic and expert-corrected, not drawn from scratch; this pack has not reviewed "
                           "it again. The mask is on the original sagittal grid, kept on the axial reformat's slices, traced per slice with "
                           "skimage find_contours (0.5) into image_px [col, row]."),
                "note": (f"{len(planes)} slices at 2.5 mm; the whole mask is {full:.0f} ml (the cropped slices keep all of it). The label "
                         "contains the blood pool of the atrium with the stumps of the pulmonary veins and the appendage; the atrial wall is "
                         "not separated."),
            },
            "completeness": "target_only", "assessedClasses": ["anatomy:heart_atrium_left"],
            "unassessedNote": "Dataset label of the left atrium only; the other chambers, the aorta and the pulmonary veins beyond their stumps are not outlined.",
            "review": dict(REVIEW), "category": "organ",
        })
        geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        facts[case] = {"series": sr.uid, "slices": len(items), "labelledSlices": len(planes), "atriumMl": round(float(full), 1), "crop": c,
                       "shape": [int(v) for v in sub.shape]}
        log(f"[{PACK_ID}] {case}: {len(items)} slices, {len(planes)} labelled, {full:.0f} ml, crop {c}")
    bx.dump_json(facts, bx.DOCS_DIR / f"{PACK_ID}-cases.json")
    return results, targets, geoms, {}


def _check_leak(builder):
    def run():
        results, targets, geoms, extra = builder()
        for sr, _, _ in results:
            ds = sr.sorted_items[0].ds
            shown = [sr.record.get("description") or "", sr.record.get("roleNote") or "", sr.record.get("displayNote") or "",
                     str(ds.get("StudyDescription", "")), str(ds.get("SeriesDescription", "")), str(ds.get("PatientID", ""))]
            bad = [s for s in shown if LEAK.search(s)]
            assert not bad, (sr.uid, bad)
        return results, targets, geoms, extra
    return run


bx.PACKS[PACK_ID] = {
    "title": "Cardiac MRI: the left atrium on 3D whole-heart MRI",
    "description": ("Nineteen 3D whole-heart MRIs (1.5 T, free breathing with ECG and respiratory gating, one cardiac phase) of adults, read "
                    "as axial images at 2.5 mm around the heart, each with an expert-corrected outline of the left atrium including its "
                    "appendage and the stumps of the pulmonary veins (Medical Segmentation Decathlon, King's College London)."),
    "sources": [SOURCE], "builder": _check_leak(build_msd), "budget": 60_000_000,
}


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/msd_heart.py; lessons scripts/lessons/msd_heart.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "fetch":
        fetch()
    elif cmd[0] == "build":
        bx.build(PACK_ID)
        index()
    elif cmd[0] == "index":
        index()
    else:
        raise SystemExit(__doc__)
