"""Brain MR angiography pack (`brain-mra`): intracranial aneurysms and the Circle of Willis on 3D time-of-flight MRA.

  python scripts/data/brain_mra.py fetch      # download the selected TOF volumes and masks into RADIOLOGY_RAW_DIR
  python scripts/data/brain_mra.py build      # write public/packs/brain-mra (+ docs/data/brain-mra-build-qc.json, index entry)
  python scripts/data/brain_mra.py index      # refresh the index entry after the lessons are written

Sources (all read without login or agreement):
  * Lausanne TOF-MRA Aneurysm Cohort, OpenNeuro ds003949 (CC0): TOF-MRA of patients with unruptured aneurysms and the
    radiologist's aneurysm masks (derivatives/manual_masks). Only patients with VOXEL-WISE masks (drawn slice by slice,
    38 consecutive subjects of the release; the other masks are spheres) on a native ~0.5 mm grid are used.
  * TopCoW external test sets, Zenodo 15692630: 20 Lausanne controls and 20 IXI-HH MRAs with the challenge's manual
    13-class Circle-of-Willis masks mapped back to the raw images, and the presence of each communicating segment.

Conversion: NIfTI -> DICOM MR Image Storage on exactly the NIfTI voxel grid (geometry from the affine, RAS -> LPS; voxel
axes flipped only so that columns run to the patient's left and rows run posterior), JPEG-LS lossless. Masks are traced
on the same grid, slice by slice. Nothing the reading room shows names the dataset or the finding (LEAK check).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import build_r4 as b4  # noqa: E402  (neutral-text wrappers, _rings_planes)
from annotations import REVIEW  # noqa: E402
from build_external import build_series, log  # noqa: E402

RAW = bx.RAW
LTOF = RAW / "Lausanne-TOF"
TOPCOW = RAW / "TopCoW" / "x"
S3 = "https://s3.amazonaws.com/openneuro.org/ds003949"
PACK_ID = "brain-mra"
MR_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.4"

LAUSANNE_SOURCE = {
    "id": "openneuro:ds003949",
    "name": "Lausanne TOF-MRA Aneurysm Cohort (Lausanne University Hospital, CHUV)",
    "url": "https://openneuro.org/datasets/ds003949",
    "doi": "10.18112/openneuro.ds003949.v1.0.0",
    "license": "CC0 1.0 (public domain dedication)",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "citation": ("Di Noto T, Marie G, Tourbier S, Aleman-Gomez Y, Esteban O, Saliou G, Bach Cuadra M, Hagmann P, Richiardi J. Towards "
                 "automated brain aneurysm detection in TOF-MRA: open data, weak labels, and anatomical knowledge. Neuroinformatics. "
                 "2023;21:21-34. doi:10.1007/s12021-022-09597-0. Data: OpenNeuro doi:10.18112/openneuro.ds003949.v1.0.0"),
    "accessNote": ("TOF-MRA (anat/*_angio.nii.gz + JSON sidecar) and derivatives/manual_masks/*_desc-Lesion_*_mask.nii.gz of the selected "
                   "subjects downloaded anonymously from the public OpenNeuro S3 bucket (s3://openneuro.org/ds003949, version 1.0.0)."),
}
TOPCOW_SOURCE = {
    "id": "zenodo:TopCoW-external-MRA",
    "name": "TopCoW challenge: Circle of Willis annotations of external MRA test sets (Lausanne controls and IXI-HH)",
    "url": "https://doi.org/10.5281/zenodo.15692630",
    "doi": "10.5281/zenodo.15692630",
    "license": ("Circle-of-Willis labels: TopCoW data terms, as defined by OpenData Swiss: \"Open use. Must provide the source. Use for "
                "commercial purposes requires permission of the data owner.\" Images: CC0 1.0 (Lausanne cohort) and CC BY-SA 3.0 (IXI; "
                "the derived DICOM is shared under the same licence)."),
    "licenseUrl": "https://opendata.swiss/en/terms-of-use",
    "citation": ("Yang K, Musio F, Ma Y, Juchler N, Paetzold JC, Al-Maskari R, et al., Menze B. Benchmarking the CoW with the TopCoW "
                 "challenge: topology-aware anatomical segmentation of the Circle of Willis for CTA and MRA. arXiv:2312.17670. "
                 "Data: Zenodo doi:10.5281/zenodo.15692630. Images: Di Noto T et al., Neuroinformatics 2023 (Lausanne, CC0); "
                 "IXI dataset, brain-development.org (CC BY-SA 3.0)."),
    "accessNote": ("MRA_Lausanne.zip and MRA_IXI_HH.zip downloaded from the open Zenodo record 15692630 (MD5 checked against the record): "
                   "raw/raw_imgs (images as distributed by the original datasets), raw/cow_seg_labels_for_raw_imgs (the challenge's "
                   "masks mapped back to those images by the organisers) and antpos_edges_labelsTr (presence of each segment)."),
}

# ---------------------------------------------------------------------- selection
# Aneurysm patients: every subject of the release whose masks are voxel-wise (not spheres) and whose TOF is on a native
# 0.47-0.55 mm grid (no resampling), each reviewed with the outline drawn (work/brain-mra/review/*.png). Kept unless listed
# in DROPPED. The location words are what the reviewer saw on the images; the dataset records only the outline.
ANEURYSM = {
    "sub-454": "ses-20141123", "sub-458": "ses-20140915", "sub-466": "ses-20140901", "sub-470": "ses-20140807",
    "sub-472": "ses-20140705", "sub-473": "ses-20140701", "sub-476": "ses-20140519", "sub-480": "ses-20140208",
    "sub-484": "ses-20140116", "sub-485": "ses-20140131", "sub-486": "ses-20140121", "sub-488": "ses-20140107",
    "sub-489": "ses-20151226",
}
DROPPED: dict[str, str] = {}
# Controls with the TopCoW Circle-of-Willis masks: a complete circle from each site, and the variants the edge labels record.
CONTROLS = {
    "sub-002": ("Lausanne", "sub-002_ses-20110127", "complete circle"),
    "sub-000": ("Lausanne", "sub-000_ses-20110101", "right P1 not seen with a right Pcom (fetal-type right PCA); third A2"),
    "sub-345": ("Lausanne", "sub-345_ses-20121218", "left P1 not seen with a left Pcom (fetal-type left PCA)"),
    "sub-033": ("Lausanne", "sub-033_ses-20101021", "Acom not seen"),
    "IXI012": ("IXI_HH", "IXI012-HH-1211", "left A1 not seen"),
    "IXI013": ("IXI_HH", "IXI013-HH-1212", "complete circle"),
}
COW = {  # TopCoW label value -> (class id suffix, display name)
    1: ("basilar_artery", "Basilar artery"),
    2: ("posterior_cerebral_artery_right", "Right posterior cerebral artery"),
    3: ("posterior_cerebral_artery_left", "Left posterior cerebral artery"),
    4: ("internal_carotid_artery_right", "Right internal carotid artery (intracranial)"),
    5: ("middle_cerebral_artery_right", "Right middle cerebral artery"),
    6: ("internal_carotid_artery_left", "Left internal carotid artery (intracranial)"),
    7: ("middle_cerebral_artery_left", "Left middle cerebral artery"),
    8: ("posterior_communicating_artery_right", "Right posterior communicating artery"),
    9: ("posterior_communicating_artery_left", "Left posterior communicating artery"),
    10: ("anterior_communicating_artery", "Anterior communicating artery"),
    11: ("anterior_cerebral_artery_right", "Right anterior cerebral artery"),
    12: ("anterior_cerebral_artery_left", "Left anterior cerebral artery"),
    15: ("third_a2", "Third A2 (median artery of the corpus callosum)"),
}
EDGES = ("L-A1", "R-A1", "Acom", "3rd-A2", "L-Pcom", "R-Pcom", "L-P1", "R-P1")
LEAK = re.compile(b4.LEAK.pattern + r"|Lausanne|OpenNeuro|TopCoW|IXI|(?i:aneurysm|variant|fetal)")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def code_of(subject: str) -> str:
    """Neutral patient id for the DICOM header (no dataset name)."""
    return "BMRA-" + hashlib.sha256(subject.encode()).hexdigest()[:8].upper()


# ---------------------------------------------------------------------- fetch
def fetch() -> None:
    import requests
    (LTOF / "angio").mkdir(parents=True, exist_ok=True)
    (LTOF / "masks").mkdir(parents=True, exist_ok=True)
    keys = [k.strip() for k in (LTOF / "_meta" / "lesion_keys.txt").read_text().splitlines() if k.strip()]
    for sub, ses in ANEURYSM.items():
        for f in ("angio.nii.gz", "angio.json"):
            dst = LTOF / "angio" / f"{sub}_{ses}_{f}"
            if not dst.exists():
                r = requests.get(f"{S3}/{sub}/{ses}/anat/{sub}_{ses}_{f}", timeout=300)
                r.raise_for_status()
                dst.write_bytes(r.content)
        for k in keys:
            if f"/{sub}/{ses}/" in k:
                dst = LTOF / "masks" / k.rsplit("/", 1)[1]
                if not dst.exists():
                    r = requests.get(f"https://s3.amazonaws.com/openneuro.org/{k}", timeout=300)
                    r.raise_for_status()
                    dst.write_bytes(r.content)
        log(sub, "ok")


# ---------------------------------------------------------------------- NIfTI -> DICOM
def stored_values(img) -> tuple[np.ndarray, float, float, str]:
    """(unsigned 16-bit stored values, rescale slope, intercept, note) that reproduce the NIfTI signal exactly.
    Integer-valued images are stored as they are. Some Lausanne files hold int16 values with a linear scale (signal = a * v
    + b, read by nibabel); those keep their stored values (shifted by 32768 into the unsigned range) and the scale goes to
    the DICOM Rescale Slope/Intercept, so no signal level is rounded away."""
    signal = np.asarray(img.dataobj, dtype=np.float64)
    dev = np.abs(signal - np.round(signal))
    # The scanner's TOF signal is whole numbers; some files store it through a fine linear scale (steps of ~0.01), so
    # "whole" is tested at 0.02. If 99 % or more of the voxels are whole numbers, the image is stored as integers.
    if signal.min() > -0.5 and signal.max() < 65535 and float(np.mean(dev > 0.02)) < 0.01:
        n = int((dev > 0.02).sum())
        note = ("integer signal values as distributed" if n == 0 else
                f"signal values as distributed rounded to integers ({n} voxels, {100 * n / dev.size:.2f}%, were not whole numbers; "
                f"largest change {float(dev.max()):.2f} on a 0-{float(signal.max()):.0f} scale)")
        return np.round(signal).astype(np.uint16), 1.0, 0.0, note
    raw = np.asarray(img.dataobj.get_unscaled())
    assert raw.dtype == np.int16, raw.dtype
    u = raw.astype(np.int64) + 32768
    sel = np.random.default_rng(0).choice(u.size, size=min(u.size, 2_000_000), replace=False)
    a, b = np.polyfit(u.ravel()[sel].astype(np.float64), signal.ravel()[sel], 1)
    err = float(np.abs(a * u.astype(np.float64) + b - signal).max())
    assert err < 1e-6 * max(1.0, float(signal.max())), ("non-linear scale", err)
    return u.astype(np.uint16), float(a), float(b), (f"int16 values with a linear scale in the NIfTI (signal = {a:.9g} x stored + {b:.6g} "
                                                     "after shifting the stored values by 32768), kept exactly with that scale as the DICOM "
                                                     "Rescale Slope / Intercept")


def tof_series(case: str, subject: str, img, data: np.ndarray, sidecar: dict, frame_uid: str, src_note: str) -> list:
    fi, fj, rowdir, coldir, ps, step, ipp = bx._isles_grid(img)
    study, series = bx.uid_for("brain-mra", case, "study"), bx.uid_for("brain-mra", case, "tof", "series")
    px, slope, icpt, how = stored_values(img)
    assert float(np.abs(px * slope + icpt - data).max()) <= 0.5 + 1e-6, f"{case}: stored values do not reproduce the signal"
    sig = px * slope + icpt
    head = sig[sig > np.percentile(sig, 60)]
    top = float(np.percentile(head, 99.9))
    items = []
    for k in range(px.shape[2]):
        a = bx._isles_slice(px, k, fi, fj)
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = MR_SOP_CLASS
        meta.MediaStorageSOPInstanceUID = bx.uid_for("brain-mra", case, "tof", str(k))
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
        ds.PatientID = code_of(subject)
        ds.PatientName = ""
        ds.StudyID = ds.PatientID[-8:]
        ds.StudyDescription = "MRI brain, MR angiography"
        ds.SeriesDescription = "3D time-of-flight MR angiography"
        ds.SeriesNumber = 1
        ds.InstanceNumber = k + 1
        ds.BodyPartExamined = "HEAD"
        ds.AngioFlag = "Y"
        ds.ScanningSequence = "GR"
        ds.SequenceVariant = ["SP", "OSP"]
        ds.ScanOptions = ""
        ds.MRAcquisitionType = "3D"
        for kw, scale in (("Manufacturer", None), ("ManufacturersModelName", None), ("MagneticFieldStrength", 1), ("RepetitionTime", 1000),
                          ("EchoTime", 1000), ("FlipAngle", 1)):
            v = sidecar.get(kw)
            if v in (None, ""):
                continue
            name = "ManufacturerModelName" if kw == "ManufacturersModelName" else kw
            setattr(ds, name, round(float(v) * scale, 3) if scale else str(v))
        ds.SliceThickness = round(step, 3)
        ds.SpacingBetweenSlices = round(step, 3)
        ds.ImagePositionPatient = [round(float(v), 4) for v in ipp(k)]
        ds.ImageOrientationPatient = [round(float(v), 6) for v in (*rowdir, *coldir)]
        ds.PixelSpacing = [round(ps[0], 6), round(ps[1], 6)]
        ds.DerivationDescription = (f"{src_note} converted to DICOM: {how}, stored unsigned 16-bit. Geometry "
                                    "from the NIfTI affine (RAS -> LPS); voxel axes flipped only so that columns run to the patient's left "
                                    "and rows run posterior.")
        if slope != 1.0 or icpt != 0.0:
            ds.RescaleSlope = f"{slope:.10g}"
            ds.RescaleIntercept = f"{icpt:.8g}"
            ds.RescaleType = "US"
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = a.shape
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.WindowCenter = round(top / 2, 1)
        ds.WindowWidth = round(max(top, 1.0), 1)
        ds.PixelData = a.tobytes()
        items.append(b4.to_item(ds, f"tof-{k:03d}.dcm"))
    return items


def mask_planes(mask: np.ndarray, img, items) -> list[dict]:
    fi, fj, *_ = bx._isles_grid(img)
    sop_by_k = {int(it.name.split("-")[1][:3]): str(it.ds.SOPInstanceUID) for it in items}
    planes = []
    for k in range(mask.shape[2]):
        m = bx._isles_slice(mask, k, fi, fj)
        if m.any():
            pl = b4._rings_planes(m, sop_by_k[k])
            if pl:
                planes.append(pl)
    return planes


def _sort_planes(planes, sr):
    order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
    planes.sort(key=lambda p: order[p["sopInstanceUid"]])
    return planes


def _extent_mm(mask: np.ndarray, img) -> tuple[float, float]:
    """(volume ml, largest extent in mm along the voxel axes) of a binary mask."""
    z = np.asarray(img.header.get_zooms()[:3], float)
    ijk = np.argwhere(mask)
    ext = (ijk.max(0) - ijk.min(0) + 1) * z
    return float(mask.sum() * np.prod(z) / 1000.0), float(ext.max())


def _edges(case_dir: str, stem: str) -> dict:
    t = next((TOPCOW / f"MRA_{case_dir}" / "antpos_edges_labelsTr").glob(f"{stem}*.yml")).read_text()
    d = {k: int(v) for k, v in re.findall(r"([\w-]+):\s+(\d)", t)}
    assert set(EDGES) <= set(d), d
    return d


def build_brain_mra() -> tuple[list, list, list, dict]:
    import nibabel as nib
    from scipy import ndimage as ndi
    results, targets, geoms, meta = [], [], [], {"aneurysm": {}, "controls": {}}
    for sub, ses in ANEURYSM.items():
        if sub in DROPPED:
            continue
        f = LTOF / "angio" / f"{sub}_{ses}_angio.nii.gz"
        img = nib.load(f)
        data = np.asarray(img.dataobj, dtype=np.float64)
        side = json.loads((LTOF / "angio" / f"{sub}_{ses}_angio.json").read_text(encoding="utf-8"))
        skey = f"{LAUSANNE_SOURCE['id']}:{sub}"
        items = tof_series(sub, skey, img, data, side, bx.uid_for("brain-mra", sub, "frame"),
                           f"OpenNeuro ds003949 {sub}/{ses}/anat/{sub}_{ses}_angio.nii.gz (sha256 {sha256(f)[:16]}...)")
        sr = build_series(items, {"region": "head", "role": "diagnostic",
                                  "roleNote": "3D time-of-flight MR angiography of the head, converted from NIfTI to DICOM."}, skey)
        bx._place(sr, ("Converted from the dataset's NIfTI: the orientation comes from the NIfTI affine. Time-of-flight signal: flowing "
                       "arterial blood is bright, stationary tissue dark. Use a thick-slab MIP or the 3D view to follow the arteries."))
        results.append((sr, skey, {"sourceId": LAUSANNE_SOURCE["id"]}))
        lesions = []
        for m in sorted((LTOF / "masks").glob(f"{sub}_{ses}_desc-Lesion_*_mask.nii.gz")):
            mi = nib.load(m)
            assert mi.shape == img.shape and np.allclose(mi.affine, img.affine, atol=1e-4), f"{m.name}: not on the TOF grid"
            mask = np.asarray(mi.dataobj) > 0
            n = int(m.name.split("Lesion_")[1].split("_")[0])
            vol, ext = _extent_mm(mask, img)
            _, ncomp = ndi.label(mask)
            planes = _sort_planes(mask_planes(mask, img, items), sr)
            tid = f"ltof-{sub[4:]}_aneurysm-{n}"
            lesions.append({"n": n, "targetId": tid, "volumeMl": round(vol, 4), "extentMm": round(ext, 1), "parts": ncomp})
            targets.append({
                "id": tid, "label": "Intracranial aneurysm (expert outline)", "classId": "finding:intracranial_aneurysm",
                "seriesUid": sr.uid, "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"openneuro:ds003949 (derivatives/manual_masks/{sub}/{ses}/anat/{m.name}, sha256 {sha256(m)[:16]}...)",
                    "method": ("Voxel-wise outline drawn slice by slice in the axial plane (ITK-SNAP) by a radiologist with 2 years of "
                               "neuroimaging experience and double-checked by a senior neuroradiologist with over 15 years of experience "
                               "(Di Noto et al. 2023). The mask is on the TOF grid; traced per slice with skimage find_contours (0.5) "
                               "into image_px [col, row]."),
                    "note": f"{len(planes)} slices; mask volume {vol * 1000:.0f} mm3; largest extent {ext:.1f} mm; {ncomp} connected part(s).",
                },
                "completeness": "target_only", "assessedClasses": ["finding:intracranial_aneurysm"],
                "unassessedNote": ("Only the aneurysm sac is outlined. The parent artery, the neck and any other finding are not referenced; "
                                   "the dataset does not record which artery the aneurysm arises from."),
                "review": dict(REVIEW),
                "teachingNote": (f"Unruptured aneurysm, about {ext:.0f} mm across in the outline. On time-of-flight MRA the flowing blood in "
                                 "the sac is bright like the parent artery; slow or turbulent flow and thrombus can make parts of it less bright."),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        meta["aneurysm"][sub] = {"session": ses, "seriesUid": sr.uid, "lesions": lesions}
        log(f"[{PACK_ID}] {sub}: {len(items)} slices, {len(lesions)} aneurysm(s) {lesions}")

    for case, (site, stem, why) in CONTROLS.items():
        raw = TOPCOW / f"MRA_{site}" / "raw"
        f = next((raw / "raw_imgs").glob(f"{stem}*.nii.gz"))
        mf = next((raw / "cow_seg_labels_for_raw_imgs").glob(f"{stem}*.nii.gz"))
        img, mimg = nib.load(f), nib.load(mf)
        assert mimg.shape == img.shape and np.allclose(mimg.affine, img.affine, atol=1e-4), f"{case}: labels not on the image grid"
        data = np.asarray(img.dataobj, dtype=np.float64)
        lab = np.asarray(mimg.dataobj).astype(np.int16)
        assert set(np.unique(lab)) <= {0, *COW}, (case, np.unique(lab))
        edges = _edges(site, stem)
        if site == "Lausanne":
            skey = f"{TOPCOW_SOURCE['id']}:{case}"
            linkage = (f"Lausanne TOF-MRA cohort subject {case} (OpenNeuro ds003949, control group), as distributed with the TopCoW "
                       "labels; no aneurysm patient of this pack is the same subject.")
            side = {}
            sj = LTOF / "_meta" / f"{stem}_angio.json"
            if sj.exists():
                side = json.loads(sj.read_text(encoding="utf-8"))
            src = f"Lausanne cohort {stem}_angio.nii.gz as distributed in the TopCoW MRA_Lausanne.zip raw/raw_imgs (sha256 {sha256(f)[:16]}...)"
        else:
            skey = f"{TOPCOW_SOURCE['id']}:{case}"
            linkage = f"IXI subject {stem} (Hammersmith Hospital), as distributed with the TopCoW labels."
            side = {"Manufacturer": "Philips Medical Systems", "MagneticFieldStrength": 3}
            src = f"IXI {stem}-MRA.nii.gz as distributed in the TopCoW MRA_IXI_HH.zip raw/raw_imgs (sha256 {sha256(f)[:16]}...)"
        items = tof_series(case, skey, img, data, side, bx.uid_for("brain-mra", case, "frame"), src)
        sr = build_series(items, {"region": "head", "role": "diagnostic",
                                  "roleNote": "3D time-of-flight MR angiography of the head, converted from NIfTI to DICOM."}, skey)
        bx._place(sr, ("Converted from the dataset's NIfTI: the orientation comes from the NIfTI affine. Time-of-flight signal: flowing "
                       "arterial blood is bright, stationary tissue dark. Use a thick-slab MIP or the 3D view to follow the arteries."))
        results.append((sr, skey, {"sourceId": TOPCOW_SOURCE["id"], "linkage": linkage}))
        present = {}
        for v, (cls, name) in COW.items():
            mask = lab == v
            if not mask.any():
                continue
            planes = _sort_planes(mask_planes(mask, img, items), sr)
            vol, ext = _extent_mm(mask, img)
            tid = f"topcow-{case.lower()}_{cls.replace('_', '-')}"
            present[cls] = tid
            targets.append({
                "id": tid, "label": name, "classId": f"anatomy:{cls}", "seriesUid": sr.uid, "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"zenodo:15692630 ({mf.name}, sha256 {sha256(mf)[:16]}...; label {v})",
                    "method": ("Manual multiclass annotation of the Circle of Willis by the TopCoW challenge annotators (research staff "
                               "trained in Circle-of-Willis anatomy by clinical experts; uncertain cases decided with neuroradiologists, "
                               "neurologists and neurosurgeons), drawn in virtual reality and mapped back to the original image grid by the "
                               "organisers (Yang et al.). Traced per slice with skimage find_contours (0.5) into image_px [col, row]."),
                    "note": (f"{len(planes)} slices; {vol * 1000:.0f} mm3 in the mask. Segments seen on this MRA (TopCoW expert edge labels, "
                             f"1 = present): " + ", ".join(f"{e} {edges[e]}" for e in EDGES) + "."),
                },
                "completeness": "target_only", "assessedClasses": [f"anatomy:{cls}"],
                "unassessedNote": ("The labels cover the Circle of Willis and the proximal parts of its arteries; branches beyond it, the "
                                   "veins and the cervical arteries are not labelled."),
                "review": dict(REVIEW),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        meta["controls"][case] = {"site": site, "stem": stem, "why": why, "seriesUid": sr.uid, "edges": edges, "targets": present}
        log(f"[{PACK_ID}] {case}: {len(items)} slices, {len(present)} labelled arteries, edges {edges}")
    (bx.DOCS_DIR / f"{PACK_ID}-cases.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
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
    "title": "Brain MR angiography: the Circle of Willis and intracranial aneurysms",
    "description": ("3D time-of-flight MR angiograms of the head at native resolution. Thirteen patients with unruptured intracranial "
                    "aneurysms, each outlined voxel by voxel by a radiologist and double-checked by a senior neuroradiologist (Lausanne "
                    "TOF-MRA Aneurysm Cohort), and six people without aneurysms whose Circle of Willis was labelled artery by artery by "
                    "the TopCoW challenge annotators, chosen to show a complete circle and the common variants (fetal-type posterior "
                    "cerebral artery, missing A1 or anterior communicating artery). Converted from NIfTI with the geometry of the "
                    "NIfTI affine."),
    "sources": [LAUSANNE_SOURCE, TOPCOW_SOURCE], "builder": _check_leak(build_brain_mra), "budget": 230_000_000,
}


def qc_record() -> None:
    """The selection rule and review of this pack, added to docs/data/brain-mra-build-qc.json."""
    path = bx.DOCS_DIR / f"{PACK_ID}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / PACK_ID / "pack.json").read_text(encoding="utf-8"))
    data["qcReview"] = {
        "tool": ("scripts/data/brain_mra_review_renders.py (axial slice, 20 mm axial and coronal MIPs and a "
                 "whole-head MIP with the outline, from the NIfTI) and scripts/atlas/mr_render_cow.py (axial and coronal MIPs from the "
                 "pack's DICOM with every outline)"),
        "selectionRule": ("Aneurysm patients: every subject of the Lausanne release with voxel-wise (not spherical) aneurysm masks and a "
                          "native 0.47-0.55 mm TOF grid (13 of the 36 voxel-wise subjects; the others were reconstructed at 0.23-0.29 mm "
                          "and would need resampling). Controls: from the 40 TopCoW-labelled MRAs, two complete circles (one per "
                          "site) and one of each variant the expert edge labels record (fetal-type PCA on each side, Acom not seen, "
                          "left A1 not seen)."),
        "review": ("Every aneurysm outline drawn on the slice, the MIPs and the whole-head MIP and checked by eye to sit on a vascular "
                   "outpouching; every control's artery labels drawn on MIPs. Nothing dropped."),
        "kept": len(man["subjects"]), "dropped": DROPPED,
        "leakCheck": "series/study descriptions, role and display notes and PatientID checked against LEAK (dataset names, diagnoses) at build",
    }
    bx.dump_json(data, path)


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/brain_mra.py; lessons scripts/lessons/brain_mra.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "fetch":
        fetch()
    elif cmd[0] == "build":
        bx.build(PACK_ID)
        qc_record()
        index()
    elif cmd[0] == "index":
        qc_record()
        index()
    else:
        raise SystemExit(__doc__)
