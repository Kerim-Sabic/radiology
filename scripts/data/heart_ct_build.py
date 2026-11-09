"""Heart and great-vessel CT pack (`heart-ct`): build public/packs/heart-ct from the chosen cases.

  python scripts/data/heart_ct_build.py build     # DICOM (JPEG-LS), dataset outlines, AI outlines, pack.json, index entry

Run after `heart_ct.py screen / pick / fetch / prep` and `heart_ct_ai.py` (see heart_ct.py). Every text the reading room
shows is checked against LEAK (no dataset names, no diagnosis words); provenance stays in pack.json and in the targets.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import build_r4 as b4  # noqa: E402  (neutral-text wrappers, _rings_planes)
import heart_ct as h  # noqa: E402
from annotations import REVIEW  # noqa: E402
from build_external import build_series, log  # noqa: E402

WORK, RAW = h.WORK, h.RAW
PACK_ID = "heart-ct"
CT_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.2"
STEP = 2  # every second 1.5 mm slice -> 3 mm
ZENODO_SOURCE = {
    "id": "zenodo:TotalSegmentator-CT-v3",
    "name": "TotalSegmentator CT dataset v3.0.0 (1,939 CT images with 117 segmented structures; University Hospital Basel)",
    "url": "https://doi.org/10.5281/zenodo.22688904",
    "doi": "10.5281/zenodo.22688904",
    "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Wasserthal J, Breit HC, Meyer MT, Pradella M, Cyriac J, Yang S, Bach M, Segeroth M. TotalSegmentator: robust segmentation of 104 "
                 "anatomical structures in CT images. Radiology: Artificial Intelligence. 2023;5(5):e230024. doi:10.1148/ryai.230024. Dataset: "
                 "Wasserthal J et al., Dataset with segmentations of 117 important anatomical structures in 1939 CT images (version 3.0.0), "
                 "Zenodo, doi:10.5281/zenodo.22688904."),
    "accessNote": ("Totalsegmentator_dataset_v300.zip (37.4 GB, Zenodo record 22688904; licence and file name read from "
                   "https://zenodo.org/api/records/22688904 on 2026-11-09) read with HTTP range requests: meta.csv, and for each chosen case "
                   "ct.nii.gz and the segmentation masks named in each target; every member checked against its zip CRC-32."),
}
HORALIX_SOURCE = {
    "id": "horalix",
    "name": "Horalix (horalix.com)",
    "url": "https://horalix.com",
    "doi": None,
    "license": "AI-generated drafts for this app; the segmentation tool and its licence are listed in docs/data/heart-ct-report.md",
    "citation": "Thanks to Horalix.com, the heart chamber and pulmonary artery outlines are marked. The outlines are AI, not reviewed by a radiologist.",
    "accessNote": "Unreviewed AI drafts; never used for grading.",
}
LABEL = {
    "heart": "Heart", "aorta": "Aorta", "atrial_appendage_left": "Left atrial appendage", "pulmonary_vein": "Pulmonary veins",
    "superior_vena_cava": "Superior vena cava", "inferior_vena_cava": "Inferior vena cava", "brachiocephalic_trunk": "Brachiocephalic trunk",
    "brachiocephalic_vein_left": "Left brachiocephalic vein", "brachiocephalic_vein_right": "Right brachiocephalic vein",
    "common_carotid_artery_left": "Left common carotid artery", "common_carotid_artery_right": "Right common carotid artery",
    "subclavian_artery_left": "Left subclavian artery", "subclavian_artery_right": "Right subclavian artery",
    "heart_myocardium": "Left ventricular myocardium", "heart_atrium_left": "Left atrium", "heart_ventricle_left": "Left ventricle",
    "heart_atrium_right": "Right atrium", "heart_ventricle_right": "Right ventricle", "pulmonary_artery": "Pulmonary arteries",
}
# (patient-left structure, patient-right structure): the left one must have the larger LPS x
PAIRS = [("common_carotid_artery_left", "common_carotid_artery_right"), ("subclavian_artery_left", "subclavian_artery_right"),
         ("brachiocephalic_vein_left", "brachiocephalic_vein_right"), ("subclavian_artery_left", "brachiocephalic_trunk"),
         ("common_carotid_artery_left", "brachiocephalic_trunk")]
MULTIPART = {"pulmonary_vein": 4, "brachiocephalic_vein_left": 2, "brachiocephalic_vein_right": 2}
AI_ML = {"heart_atrium_right": (20, 250), "heart_atrium_left": (20, 250), "heart_ventricle_right": (40, 350), "heart_ventricle_left": (40, 350),
         "heart_myocardium": (60, 400), "pulmonary_artery": (15, 160)}
AI_IDS = {44: "heart_myocardium", 45: "heart_atrium_left", 46: "heart_ventricle_left", 47: "heart_atrium_right", 48: "heart_ventricle_right",
          49: "pulmonary_artery"}
LEAK = re.compile(b4.LEAK.pattern + r"|TotalSeg|Zenodo|Basel|Wasserthal|(?i:aneurysm|dissect|embol|vascular|coronary|angiograph|valve|atrium|artrium|myocard)")
CONVERT_NOTE = ("Converted to DICOM from the dataset's NIfTI (1.5 mm isotropic): chest only (from above the aortic arch to below the heart), every "
                "second slice kept (3 mm), Hounsfield units clipped to -1024..3071 and stored as unsigned 12-bit values with Rescale Intercept "
                "-1024. Geometry from the NIfTI affine (RAS -> LPS); voxel axes flipped only so that columns run to the patient's left and rows "
                "run posterior.")


def code_of(cid: str) -> str:
    return "HCT-" + hashlib.sha256(("heart-ct" + cid).encode()).hexdigest()[:8].upper()


def sha256(p: Path) -> str:
    d = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            d.update(b)
    return d.hexdigest()


def sel_info(cid: str) -> dict:
    scr = json.loads((WORK / "screen.json").read_text())[cid]
    prep = json.loads((WORK / cid / "prep.json").read_text())
    return {**scr, **prep}


def ct_items(cid: str, info: dict, sub: np.ndarray, img, frame_uid: str) -> list:
    fi, fj, rowdir, coldir, ps, step, ipp = bx._isles_grid(img)
    study, series = bx.uid_for(PACK_ID, cid, "study"), bx.uid_for(PACK_ID, cid, "ct", "series")
    items = []
    for kk in range(sub.shape[2]):
        a = (np.clip(bx._isles_slice(sub, kk, fi, fj).astype(np.int32), -1024, 3071) + 1024).astype(np.uint16)
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CT_SOP_CLASS
        meta.MediaStorageSOPInstanceUID = bx.uid_for(PACK_ID, cid, "ct", str(kk))
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = Dataset()
        ds.file_meta = meta
        ds.SpecificCharacterSet = "ISO_IR 100"
        ds.SOPClassUID = CT_SOP_CLASS
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame_uid
        ds.PositionReferenceIndicator = ""
        ds.Modality = "CT"
        ds.ImageType = ["DERIVED", "SECONDARY", "AXIAL"]
        ds.PatientID = code_of(cid)
        ds.PatientName = ""
        ds.StudyID = ds.PatientID[-8:]
        if info.get("gender") in ("m", "f"):
            ds.PatientSex = info["gender"].upper()
        ds.PatientAge = f"{int(info['age']):03d}Y"
        ds.StudyDescription = "CT chest"
        ds.SeriesDescription = "CT chest, axial, 3 mm"
        ds.SeriesNumber = 1
        ds.InstanceNumber = kk + 1
        ds.BodyPartExamined = "CHEST"
        man = str(info.get("manufacturer") or "")
        if man in ("siemens", "ge", "philips"):
            ds.Manufacturer = {"siemens": "SIEMENS", "ge": "GE MEDICAL SYSTEMS", "philips": "Philips"}[man]
        if str(info.get("scanner")) not in ("nan", "None", ""):
            ds.ManufacturerModelName = str(info["scanner"])
        try:
            ds.KVP = str(int(float(info["kvp"])))
        except (ValueError, TypeError, KeyError):
            pass
        ds.SliceThickness = round(step, 3)
        ds.SpacingBetweenSlices = round(step, 3)
        ds.ImagePositionPatient = [round(float(v), 4) for v in ipp(kk)]
        ds.ImageOrientationPatient = [round(float(v), 6) for v in (*rowdir, *coldir)]
        ds.PixelSpacing = [round(ps[0], 6), round(ps[1], 6)]
        ds.DerivationDescription = CONVERT_NOTE
        ds.RescaleIntercept = "-1024"
        ds.RescaleSlope = "1"
        ds.RescaleType = "HU"
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = a.shape
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
        ds.WindowCenter, ds.WindowWidth = 40, 400
        ds.PixelData = a.tobytes()
        items.append(bx.to_item(ds, f"ct-{kk:03d}.dcm"))
    return items


def largest(mask: np.ndarray, keep: int = 1, min_frac: float = 0.05):
    from scipy import ndimage as ndi
    lab, n = ndi.label(mask, structure=np.ones((3, 3, 3), bool))
    if n <= 1:
        return mask, n
    sizes = np.bincount(lab.ravel())[1:]
    order = np.argsort(sizes)[::-1]
    keepers = [int(i) + 1 for r, i in enumerate(order) if r < keep and (r == 0 or sizes[i] >= min_frac * sizes.sum())]
    return np.isin(lab, keepers), n


def lps_centroid(mask: np.ndarray, affine: np.ndarray) -> np.ndarray:
    ijk = np.argwhere(mask).mean(0)
    ras = (affine @ np.array([*ijk, 1.0]))[:3]
    return np.array([-ras[0], -ras[1], ras[2]])


def mask_planes(mask3: np.ndarray, fi, fj, sr, items) -> list[dict]:
    sop = {int(it.name.split("-")[1][:3]): str(it.ds.SOPInstanceUID) for it in items}
    order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
    planes = []
    for kk in range(mask3.shape[2]):
        if mask3[:, :, kk].any():
            pl = b4._rings_planes(bx._isles_slice(mask3, kk, fi, fj), sop[kk])
            if pl:
                planes.append(pl)
    planes.sort(key=lambda p: order[p["sopInstanceUid"]])
    return planes


def build_case(cid: str, qc_log: dict):
    import nibabel as nib
    from scipy import ndimage as ndi
    info = sel_info(cid)
    c = info["crop"]
    im = nib.load(str(RAW / cid / "ct.nii.gz"))
    sl = (slice(c["i0"], c["i1"] + 1), slice(c["j0"], c["j1"] + 1), slice(c["k0"], c["k1"] + 1, STEP))
    ct = np.asarray(im.dataobj)[sl]
    aff = im.affine.copy()
    aff[:3, 3] = (im.affine @ np.array([c["i0"], c["j0"], c["k0"], 1.0]))[:3]
    aff[:3, 2] *= STEP
    simg = nib.Nifti1Image(ct, aff)
    fi, fj, *_ = bx._isles_grid(simg)
    skey = f"{ZENODO_SOURCE['id']}:{cid}"
    items = ct_items(cid, info, ct, simg, bx.uid_for(PACK_ID, cid, "frame"))
    sr = build_series(items, {"region": "chest", "role": "diagnostic", "roleNote": "Axial CT of the chest, converted from NIfTI to DICOM."}, skey)
    bx._place(sr, ("Chest only, every second 1.5 mm slice (3 mm), converted from the dataset's NIfTI: the orientation comes from the NIfTI "
                   "affine. Scroll the stack and use the mediastinal window (about 40 / 400) for the heart and vessels."))
    rec = {"series": sr.uid, "case": cid, "slices": len(items), "contrast": info["contrast"], "aortaHu": info["aortaMedianHuAtHeart"],
           "expert": {}, "ai": {}}
    targets, geoms, masks = [], [], {}
    # ---------------------------------------------------------------- dataset labels (source_automated)
    for cls in h.EXPERT:
        m = np.asarray(nib.load(str(RAW / cid / "segmentations" / f"{cls}.nii.gz")).dataobj)[sl] > 0
        if not m.any():
            rec["expert"][cls] = "not in the cropped chest"
            continue
        m, ncomp = largest(m, MULTIPART.get(cls, 1))
        masks[cls] = m
        rec["expert"][cls] = {"parts": int(ncomp), "mlInCrop": round(float(m.sum()) * 1.5 * 1.5 * 3.0 / 1000.0, 1)}
    bad = set()
    for l, r in PAIRS:
        if l in masks and r in masks and not lps_centroid(masks[l], aff)[0] > lps_centroid(masks[r], aff)[0]:
            bad |= {l, r}
            rec["expert"][l] = rec["expert"][r] = f"dropped: left/right order fails ({l} vs {r})"
    for cls in bad:
        masks.pop(cls, None)
    for cls, m in masks.items():
        planes = mask_planes(m, fi, fj, sr, items)
        tid = f"hct-{cid}-{cls.replace('_', '-')}"
        hu = float(np.median(ct[m]))
        rec["expert"][cls]["medianHu"] = round(hu, 1)
        targets.append({
            "id": tid, "label": LABEL[cls], "classId": f"anatomy:{cls}", "seriesUid": sr.uid, "geometryType": "contour_set",
            "geometryFile": f"targets/{tid}.json", "provenance": "source_automated",
            "provenanceDetail": {
                "source": (f"zenodo:22688904 (Totalsegmentator_dataset_v300.zip, {cid}/segmentations/{cls}.nii.gz, "
                           f"sha256 {sha256(RAW / cid / 'segmentations' / (cls + '.nii.gz'))[:16]}...)"),
                "method": ("Segmentation distributed with the TotalSegmentator CT dataset. Its authors describe the labels as made with public "
                           "segmentation models or an iteratively retrained nnU-Net and then manually reviewed and corrected where necessary, "
                           "supervised by two radiologists with 3 and 6 years of body-imaging experience (Wasserthal et al. 2023); version 3.0.0 "
                           "refined many labels. Model-assisted and radiologist-verified, not drawn from scratch; this pack has not reviewed "
                           "them again. Mask on the CT grid, cut to the chest slices kept here, largest connected part(s) only, traced per slice "
                           "with skimage find_contours (0.5) into image_px [col, row]."),
                "note": f"{len(planes)} slices; {rec['expert'][cls]['parts']} connected part(s) in the crop; median {hu:.0f} HU.",
            },
            "completeness": "target_only", "assessedClasses": [f"anatomy:{cls}"],
            "unassessedNote": "Dataset label of this one structure only; no other structure and no finding is referenced.",
            "review": dict(REVIEW), "category": "organ" if cls == "heart" else "vessel",
        })
        geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
    # ---------------------------------------------------------------- AI drafts: heart chambers and pulmonary arteries
    ai_p = WORK / cid / "ai_chambers.nii.gz"
    if ai_p.exists() and info["contrast"] and "heart" in masks:
        lab = np.asarray(nib.load(str(ai_p)).dataobj)[:, :, ::STEP]
        heart = np.asarray(nib.load(str(RAW / cid / "segmentations" / "heart.nii.gz")).dataobj)[sl] > 0
        hd = ndi.binary_dilation(heart, iterations=2)
        ai = {}
        for k, cls in AI_IDS.items():
            m, ncomp = largest(lab == k, 1, 0.0)
            if not m.any():
                rec["ai"][cls] = "no output"
                continue
            ml = float(m.sum()) * 1.5 * 1.5 * 3.0 / 1000.0
            lo, hi = AI_ML[cls]
            inside = None if cls == "pulmonary_artery" else float((m & hd).sum() / m.sum())
            hu = float(np.median(ct[m]))
            why = []
            if not lo <= ml <= hi:
                why.append(f"volume {ml:.0f} ml outside {lo}-{hi}")
            if inside is not None and inside < 0.9:
                why.append(f"only {inside * 100:.0f}% inside the heart")
            if cls in ("heart_atrium_left", "heart_atrium_right", "heart_ventricle_left", "heart_ventricle_right") and hu < 120:
                why.append(f"blood pool {hu:.0f} HU (< 120)")
            if cls == "pulmonary_artery" and hu < 60:
                why.append(f"{hu:.0f} HU (< 60)")
            if cls == "heart_myocardium" and not -50 <= hu <= 250:
                why.append(f"{hu:.0f} HU outside -50..250")
            ai[cls] = {"mask": m, "ml": ml, "inside": inside, "hu": hu, "why": why}
        if "heart_myocardium" in ai:  # a chamber must be clearly brighter than the muscle, or the two cannot be told apart
            myo = ai["heart_myocardium"]["hu"]
            for cls in ("heart_atrium_left", "heart_atrium_right", "heart_ventricle_left", "heart_ventricle_right"):
                if cls in ai and ai[cls]["hu"] < myo + 40:
                    ai[cls]["why"].append(f"blood pool {ai[cls]['hu']:.0f} HU not 40 above the muscle ({myo:.0f} HU)")
        cen = {k: lps_centroid(v["mask"], aff) for k, v in ai.items()}

        def order(a, b, axis, text):
            if a in cen and b in cen and not cen[a][axis] > cen[b][axis]:
                ai[a]["why"].append(text)
                ai[b]["why"].append(text)

        # LPS: x grows to the patient's left, y grows posterior
        order("heart_atrium_left", "heart_atrium_right", 0, "left atrium not left of the right atrium")
        order("heart_ventricle_left", "heart_ventricle_right", 0, "left ventricle not left of the right ventricle")
        order("heart_ventricle_left", "heart_atrium_right", 0, "left ventricle not left of the right atrium")
        order("heart_atrium_left", "heart_ventricle_right", 1, "left atrium not behind the right ventricle")
        order("heart_ventricle_left", "heart_ventricle_right", 1, "left ventricle not behind the right ventricle")
        if "pulmonary_artery" in cen and "aorta" in masks and "heart" in masks:
            ca = lps_centroid(masks["aorta"], aff)
            if cen["pulmonary_artery"][1] > ca[1] + 40 or cen["pulmonary_artery"][2] > lps_centroid(masks["heart"], aff)[2] + 90:
                ai["pulmonary_artery"]["why"].append("pulmonary artery not in front of / near the top of the heart")
        for cls, v in ai.items():
            if v["why"]:
                rec["ai"][cls] = "dropped: " + "; ".join(v["why"])
                continue
            planes = mask_planes(v["mask"], fi, fj, sr, items)
            tid = f"hct-{cid}-ai-{cls.replace('_', '-')}"
            rec["ai"][cls] = {"mlInCrop": round(v["ml"], 1), "medianHu": round(v["hu"], 1),
                              "insideHeartPct": None if v["inside"] is None else round(v["inside"] * 100, 1)}
            targets.append({
                "id": tid, "label": LABEL[cls], "classId": f"anatomy:{cls}", "seriesUid": sr.uid, "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": "Horalix", "method": "AI — automatic segmentation, not reviewed by a radiologist",
                                     "note": (f"Unreviewed AI proposal. QC passed: one connected part; volume {v['ml']:.0f} ml in the plausible range; "
                                              f"median {v['hu']:.0f} HU; left/right and front/back order checked against the other chambers; "
                                              + ("" if v["inside"] is None else f"{v['inside'] * 100:.0f}% inside the heart outline; ")
                                              + "checked by eye on overlay sheets.")},
                "completeness": "target_only", "assessedClasses": [f"anatomy:{cls}"],
                "unassessedNote": "Atlas outline of this structure only; not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": "vessel",
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
    elif not info["contrast"]:
        rec["ai"]["_all"] = "chamber model not run: no clear contrast injection (blood and heart muscle cannot be told apart)"
    else:
        rec["ai"]["_all"] = "model produced no usable output"
    qc_log[cid] = rec
    return sr, skey, targets, geoms


def build_heart_ct():
    sel = json.loads((WORK / "selection.json").read_text())
    drop = json.loads((WORK / "dropped.json").read_text()) if (WORK / "dropped.json").exists() else {}
    qc_log: dict = {}
    results, targets, geoms = [], [], []
    for cid in sel:
        if cid in drop:
            continue
        sr, skey, t, g = build_case(cid, qc_log)
        results.append((sr, skey, {"sourceId": ZENODO_SOURCE["id"]}))
        targets += t
        geoms += g
        log(f"[{PACK_ID}] {cid}: {len(sr.sorted_items)} slices, {len(t)} outlines ({sum(1 for x in t if x['provenance'] == 'ai_draft')} AI)")
    (WORK / "build-qc.json").write_text(json.dumps(qc_log, indent=1))
    facts = {}
    for cid in qc_log:
        i = sel_info(cid)
        facts[cid] = {"institute": i["institute"], "manufacturer": i["manufacturer"], "scanner": i["scanner"], "kvp": i["kvp"], "age": i["age"],
                      "sex": i["gender"], "studyType": i["studyType"], "metaPathology": i["pathology"], "metaPathologyLocation": i["pathologyLocation"],
                      "contrast": i["contrast"], "aortaMedianHuAtHeart": i["aortaMedianHuAtHeart"], "ivcMedianHu": i["ivcMedianHu"],
                      "aortaMaxInscribedDiameterMm": i["aortaMaxInscribedDiameterMm"], "cropShape1p5mm": i["cropShape"], **qc_log[cid]}
    bx.dump_json(facts, bx.DOCS_DIR / "heart-ct-cases.json")
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
    "title": "Heart and great vessels on chest CT: heart, aorta, pulmonary veins and vena cavae",
    "description": ("Chest CTs of adults from the TotalSegmentator CT dataset v3.0.0 (University Hospital Basel and other hospitals), cropped from "
                    "above the aortic arch to below the heart at 3 mm: contrast-enhanced and non-contrast, heart-gated and routine chest studies, "
                    "with the dataset's own outlines of the heart, aorta, left atrial appendage, pulmonary veins, venae cavae and arch branches, "
                    "and unreviewed AI outlines of the four chambers, the left ventricular muscle and the pulmonary arteries on the contrast studies."),
    "sources": [ZENODO_SOURCE, HORALIX_SOURCE], "builder": _check_leak(build_heart_ct), "budget": 260_000_000,
}


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/heart_ct.py + heart_ct_build.py; lessons scripts/lessons/heart_ct.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "build":
        bx.build(PACK_ID)
        index()
    elif cmd[0] == "index":
        index()
    else:
        raise SystemExit(__doc__)
