"""Build learning packs from the non-TCIA downloads made by external.py.

  python scripts/data/build_external.py cxr-findings   # NIH ChestX-ray14 radiographs with radiologist boxes
  python scripts/data/build_external.py pe-cta         # FUMPE CT pulmonary angiograms with radiologist PE masks

Same contract and helpers as build_pack.py (inventory.build_series / encode_and_place, annotations._mask_to_rings);
the difference is the source: PNG images are wrapped as DICOM Secondary Capture, FUMPE DICOM headers with
placeholder values are repaired (only the attributes listed in HEADER_FIXES; pixel data untouched).
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from annotations import REVIEW, _mask_to_rings, split_holes  # noqa: E402
from common import DOCS_DIR, PACKS_DIR, dump_json, px_to_patient  # noqa: E402
from inventory import Item, build_series, encode_and_place, thumbnail_png  # noqa: E402

RAW = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw"))
SCHEMA_VERSION = 1
SC_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.7"  # Secondary Capture Image Storage


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def uid_for(*parts: str) -> str:
    """Deterministic 2.25 UID from the source identifiers (rebuilds give the same UIDs)."""
    return generate_uid(prefix=None, entropy_srcs=["radiology-study-packs", *parts])


def to_item(ds: Dataset, name: str) -> Item:
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    raw = buf.getvalue()
    return Item(raw=raw, ds=pydicom.dcmread(io.BytesIO(raw)), name=name)


# ====================================================================== NIH ChestX-ray14
NIH_SOURCE = {
    "id": "nih:ChestX-ray14",
    "name": "NIH ChestX-ray14 (ChestX-ray8), NIH Clinical Center",
    "url": "https://nihcc.app.box.com/v/ChestXray-NIHCC",
    "doi": None,
    "license": "Unrestricted use; link to the original download site, acknowledge the NIH Clinical Center and cite the CVPR 2017 paper (dataset FAQ, Q04)",
    "licenseUrl": "https://nihcc.app.box.com/v/ChestXray-NIHCC",
    "citation": ("Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on "
                 "Weakly-Supervised Classification and Localization of Common Thorax Diseases. IEEE CVPR 2017:2097-2106. "
                 "Images courtesy of the NIH Clinical Center."),
    "accessNote": ("Data_Entry_2017_v2020.csv and FAQ from the official NIH Box share; BBox_List_2017.csv (984 radiologist boxes, identical "
                   "count to the official list) and the selected PNGs read member-by-member (HTTP Range, CRC-32 checked) from the "
                   "unmodified images_0NN.zip copies on the public Hugging Face mirror alkzar90/NIH-Chest-X-ray-dataset, because the "
                   "official Box archive links no longer resolve. No login or agreement involved."),
}
NIH_CLASS = {
    "Pneumothorax": ("finding:pneumothorax", "Pneumothorax"),
    "Effusion": ("finding:pleural_effusion", "Pleural effusion"),
    "Atelectasis": ("finding:atelectasis", "Atelectasis"),
    "Cardiomegaly": ("finding:cardiomegaly", "Cardiomegaly (enlarged cardiac silhouette)"),
    "Mass": ("finding:lung_mass", "Lung mass"),
    "Nodule": ("finding:lung_nodule", "Lung nodule"),
    "Pneumonia": ("finding:pneumonia", "Pneumonia"),
    "Infiltrate": ("finding:infiltrate", "Infiltrate"),
}


def nih_dataset(c: dict) -> Dataset:
    from PIL import Image
    e = c["entry"]
    im = Image.open(RAW / c["file"])
    a = np.asarray(im)
    if a.ndim == 3:  # a few PNGs are stored RGB(A) with identical channels
        assert np.array_equal(a[..., 0], a[..., 1]) and np.array_equal(a[..., 0], a[..., 2]), c["image"]
        a = a[..., 0]
    a = np.ascontiguousarray(a.astype(np.uint8))
    stem = c["image"].rsplit(".", 1)[0]
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = SC_SOP_CLASS
    meta.MediaStorageSOPInstanceUID = uid_for("nih", stem, "sop")
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = SC_SOP_CLASS
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = uid_for("nih", stem, "study")
    ds.SeriesInstanceUID = uid_for("nih", stem, "series")
    ds.Modality = "DX"
    ds.ConversionType = "WSD"
    ds.ImageType = ["DERIVED", "SECONDARY"]
    ds.PatientID = f"NIH-CXR14-{int(e['Patient ID']):05d}"
    ds.PatientName = ""
    ds.PatientSex = e["Patient Gender"] if "Patient Gender" in e else e["Patient Sex"]
    ds.PatientAge = f"{int(e['Patient Age']):03d}Y"
    ds.StudyID = stem
    ds.StudyDescription = "Chest radiograph"
    ds.SeriesDescription = f"Chest {e['View Position']} (NIH ChestX-ray14, 1024 px)"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    ds.ViewPosition = e["View Position"]
    ds.BodyPartExamined = "CHEST"
    ds.DerivationDescription = (f"{c['image']} from NIH ChestX-ray14: 8-bit 1024x1024 PNG made by the dataset authors from a "
                                f"{e['OriginalImage[Width']}x{e['Height]']} original (pixel spacing {e['OriginalImagePixelSpacing[x']} mm); "
                                "wrapped unchanged as DICOM Secondary Capture.")
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows, ds.Columns = a.shape
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.WindowCenter = 127.5
    ds.WindowWidth = 256
    ds.WindowCenterWidthExplanation = "Full 8-bit range (the PNG is already windowed)"
    ds.PixelData = a.tobytes()
    return ds


def build_nih() -> tuple[list, list, list, dict]:
    sel = json.loads((RAW / "NIH-ChestXray14" / "_meta" / "selection.json").read_text(encoding="utf-8"))
    results, targets, geoms, notes = [], [], [], {}
    for c in sel:
        ds = nih_dataset(c)
        skey = f"nih:ChestX-ray14:{int(c['entry']['Patient ID'])}"
        item = to_item(ds, c["image"])
        sr = build_series([item], {"region": "chest", "role": "diagnostic",
                                   "roleNote": "Frontal chest radiograph (8-bit PNG release of NIH ChestX-ray14) wrapped as DICOM Secondary Capture."}, skey)
        encode_and_place(sr, "jpegls")
        sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
        sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
        sr.record["displayNote"] = ("Downsampled 8-bit PNG from NIH ChestX-ray14 wrapped as DICOM: no pixel spacing (distances are not "
                                    "measurable) and no PatientOrientation in the source, so no orientation letters are shown. "
                                    "The radiologist's box is the reference; the image-level labels are mined from reports.")
        results.append((sr, skey, c))
        sop = str(ds.SOPInstanceUID)
        stem = c["image"].rsplit(".", 1)[0]
        for b in c["boxes"]:
            cid, lab = NIH_CLASS[b["label"]]
            x, y, w, h = b["xywh"]
            tid = f"nih-{stem}_{cid.split(':')[1].replace('_', '-')}"
            targets.append({
                "id": tid, "label": f"{lab} (NIH radiologist box)", "classId": cid, "seriesUid": sr.uid,
                "geometryType": "box", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": "nih:ChestX-ray14 (BBox_List_2017.csv)",
                    "method": ("Bounding box hand-drawn by a board-certified radiologist for the ChestX-ray8 localisation benchmark "
                               f"(label '{b['label']}'); converted from [x, y, w, h] with (0,0) at the image corner to image_px "
                               "[col0, row0, col1, row1] with (0,0) at the centre of the first pixel (shift of -0.5 px)."),
                    "note": f"BBox_List_2017.csv row for {c['image']}: {b['label']} {[round(v, 2) for v in b['xywh']]}",
                },
                "completeness": "target_only",
                "assessedClasses": [cid],
                "unassessedNote": ("Only the boxed finding is referenced. Other findings on this film are not outlined; the report-mined "
                                   f"labels for the image are: {c['entry']['Finding Labels']}."),
                "review": dict(REVIEW),
                "teachingNote": ("The box marks where the radiologist saw the finding; it is a rectangle around it, not an outline."),
            })
            geoms.append({"geometryType": "box", "space": "image_px",
                          "boxes": [{"sopInstanceUid": sop, "frame": 1, "box": [round(x - 0.5, 2), round(y - 0.5, 2), round(x + w - 0.5, 2), round(y + h - 0.5, 2)]}]})
        notes[sr.uid] = c
    return results, targets, geoms, notes


# ====================================================================== FUMPE
FUMPE_SOURCE = {
    "id": "figshare:FUMPE",
    "name": "FUMPE: Ferdowsi University of Mashhad's PE dataset (CT pulmonary angiography with PE masks)",
    "url": "https://doi.org/10.6084/m9.figshare.c.4107803.v1",
    "doi": "10.6084/m9.figshare.c.4107803.v1",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Masoudi M, Pourreza HR, Saadatmand-Tarzjan M, Eftekhari N, Zargar FS, Rad MP. A new dataset of computed-tomography "
                 "angiography images for computer-aided detection of pulmonary embolism. Sci Data. 2018;5:180180. "
                 "doi:10.1038/sdata.2018.180. Data: figshare collection doi:10.6084/m9.figshare.c.4107803.v1"),
    "accessNote": "Patient RAR archives and 'Ground Truth.rar' (label-edited/PATnnn.mat) downloaded anonymously from figshare (md5 checked against the figshare API).",
}
FUMPE_PATIENTS = {
    "PAT005": "Saddle embolus: the mask spans the main pulmonary artery bifurcation into both pulmonary arteries (checked by overlay).",
    "PAT021": "Large embolus in the right pulmonary artery (checked by overlay); a large right pleural effusion is also visible but not outlined.",
}
# Placeholder values in the distributed headers that are not valid DICOM; everything else is kept as distributed.
HEADER_FIXES = "StudyInstanceUID/SeriesInstanceUID '0' replaced by derived UIDs; date attributes '0' and PatientBirthDate removed; PatientAge '000Y' removed; Manufacturer/InstitutionName/StudyDescription/AccessionNumber '0' cleared; PatientID set"


def fumpe_items(pid: str) -> list[Item]:
    files = sorted((RAW / "FUMPE" / pid / "extracted").rglob("*.dcm"))
    items = []
    study, series = uid_for("fumpe", pid, "study"), uid_for("fumpe", pid, "series")
    for f in files:
        ds = pydicom.dcmread(f)
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
        for kw in ("StudyDate", "AcquisitionDate", "ContentDate", "InstanceCreationDate", "SeriesDate", "StudyTime", "AcquisitionTime",
                   "ContentTime", "PatientBirthDate"):
            if kw in ds:
                del ds[kw]
        if str(ds.get("PatientAge", "")) == "000Y":
            del ds["PatientAge"]
        for kw in ("Manufacturer", "InstitutionName", "AccessionNumber", "StudyID"):
            if str(ds.get(kw, "")) == "0":
                setattr(ds, kw, "")
        ds.StudyDescription = "CT pulmonary angiogram (FUMPE)"
        if not str(ds.get("SeriesDescription", "")):
            ds.SeriesDescription = "CTPA axial 1 mm"
        ds.PatientID = f"FUMPE-{pid}"
        ds.PatientName = ""
        items.append(to_item(ds, f.name))
    return items


def build_fumpe() -> tuple[list, list, list, dict]:
    import scipy.io as sio
    results, targets, geoms, notes = [], [], [], {}
    for pid, why in FUMPE_PATIENTS.items():
        items = fumpe_items(pid)
        names = [it.name for it in items]
        mask = sio.loadmat(RAW / "FUMPE" / "_gt" / "label-edited" / f"{pid}.mat")["Mask"]
        assert mask.shape == (512, 512, len(items)), (pid, mask.shape, len(items))  # one mask slice per file, in file-name order
        skey = f"figshare:FUMPE:{pid}"
        sr = build_series(items, {"region": "chest", "role": "diagnostic", "roleNote": "CT pulmonary angiogram (1 mm axial)."}, skey)
        encode_and_place(sr, "jpegls")
        sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
        sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
        sr.record["displayNote"] = f"Header repairs before packing (pixel data unchanged): {HEADER_FIXES}."
        g = sr.record["geometry"]
        by_name = {it.name: it for it in items}
        planes, centroid_pts = [], []
        for k, name in enumerate(names):
            m = mask[:, :, k] > 0
            if not m.any():
                continue
            ds = by_name[name].ds
            rings = _mask_to_rings(m)
            if not rings:
                continue
            hole = split_holes(rings) if len(rings) > 1 else [False]
            pl = {"sopInstanceUid": str(ds.SOPInstanceUID), "frame": 1,
                  "polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
            hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
            if hs:
                pl["holes"] = hs
            if pl["polygons"]:
                planes.append(pl)
                ipp = [float(x) for x in ds.ImagePositionPatient]
                centroid_pts += [px_to_patient(c, r, ipp, g["iop"], g["pixelSpacing"]) for ring in pl["polygons"] for c, r in ring]
        order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
        planes.sort(key=lambda p: order[p["sopInstanceUid"]])
        tid = f"fumpe-{pid.lower()}_pulmonary-embolism"
        targets.append({
            "id": tid, "label": "Pulmonary embolism (FUMPE radiologists' mask)", "classId": "finding:pulmonary_embolism",
            "seriesUid": sr.uid, "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
            "provenanceDetail": {
                "source": "figshare:FUMPE (Ground Truth.rar, label-edited)",
                "method": (f"label-edited/{pid}.mat 'Mask' (512x512x{len(items)}): two radiologists marked the emboli with a semi-automated "
                           "tool (Masoudi et al. 2018). Mask slice k belongs to file D(k+1) in name order, which is also ascending position "
                           "(checked: equal counts, monotonic ImagePositionPatient, overlay on the opacified pulmonary arteries). Traced with "
                           "skimage find_contours (0.5) and approximate_polygon (0.25 px) into image_px [col, row]."),
                "note": f"{len(planes)} slices with embolus; outline-vertex centroid (LPS mm) {[round(float(v), 1) for v in np.mean(centroid_pts, axis=0)]}.",
            },
            "completeness": "target_only",
            "assessedClasses": ["finding:pulmonary_embolism"],
            "unassessedNote": "Only the emboli are referenced; lungs, pleura, heart and other findings are unassessed.",
            "review": dict(REVIEW),
            "teachingNote": why,
        })
        geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        results.append((sr, skey, {"pid": pid, "why": why}))
        log(f"[pe-cta] {pid}: {len(items)} images, {len(planes)} slices with embolus")
    return results, targets, geoms, notes


# ====================================================================== FracAtlas
FRAC_SOURCE = {
    "id": "figshare:FracAtlas",
    "name": "FracAtlas: musculoskeletal radiographs with fracture annotations",
    "url": "https://doi.org/10.6084/m9.figshare.22363012.v7",
    "doi": "10.6084/m9.figshare.22363012.v7",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Abedeen I, Rahman MA, Prottyasha FZ, Ahmed T, Chowdhury TM, Shatabda S. FracAtlas: A Dataset for Fracture Classification, "
                 "Localization and Segmentation of Musculoskeletal Radiographs. Sci Data. 2023;10:521. doi:10.1038/s41597-023-02432-4. "
                 "Data: figshare doi:10.6084/m9.figshare.22363012.v7"),
    "accessNote": "FracAtlas.zip read member-by-member (HTTP Range, CRC-32 checked) from figshare; COCO_fracture_masks.json and dataset.csv from the same archive. No login.",
}
FRAC_BODY = {"hand": "HAND", "leg": "LEG", "hip": "HIP", "shoulder": "SHOULDER"}
FRAC_WHERE = {"IMG0000019.jpg": "wrist and distal forearm", "IMG0000151.jpg": "ankle", "IMG0002302.jpg": "shoulder and proximal humerus",
              "IMG0002308.jpg": "knee and proximal tibia", "IMG0002337.jpg": "hip and proximal femur"}
# FracAtlas gives no patient identifiers. Images numbered close together can be one person (IMG0002302-2306 are one shoulder),
# so the 23xx images share one holdout group: never "an unseen patient" for each other.
FRAC_HOLDOUT = {"IMG0002302.jpg": "figshare:FracAtlas:IMG00023xx", "IMG0002308.jpg": "figshare:FracAtlas:IMG00023xx",
                "IMG0002337.jpg": "figshare:FracAtlas:IMG00023xx"}


def frac_dataset(c: dict) -> Dataset:
    from PIL import Image
    im = Image.open(RAW / c["file"])
    assert im.mode == "L" and im.size == (c["coco_image"]["width"], c["coco_image"]["height"]), c["image"]
    a = np.ascontiguousarray(np.asarray(im, dtype=np.uint8))
    stem = c["image"].rsplit(".", 1)[0]
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = SC_SOP_CLASS
    meta.MediaStorageSOPInstanceUID = uid_for("fracatlas", stem, "sop")
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = SC_SOP_CLASS
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = uid_for("fracatlas", stem, "study")
    ds.SeriesInstanceUID = uid_for("fracatlas", stem, "series")
    ds.Modality = "DX"
    ds.ConversionType = "WSD"
    ds.ImageType = ["DERIVED", "SECONDARY"]
    ds.PatientID = f"FracAtlas-{stem}"
    ds.PatientName = ""
    ds.StudyID = stem
    ds.StudyDescription = f"Radiograph, {FRAC_WHERE[c['image']]}"
    ds.SeriesDescription = f"Frontal view (FracAtlas {stem})"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    ds.BodyPartExamined = FRAC_BODY[c["region"]]
    ds.LossyImageCompression = "01"
    ds.LossyImageCompressionMethod = "ISO_10918_1"
    ds.DerivationDescription = f"{c['image']} from FracAtlas (8-bit JPEG as distributed), decoded and stored without further loss."
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows, ds.Columns = a.shape
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.WindowCenter = 127.5
    ds.WindowWidth = 256
    ds.WindowCenterWidthExplanation = "Full 8-bit range (the JPEG is already windowed)"
    ds.PixelData = a.tobytes()
    return ds


def build_frac() -> tuple[list, list, list, dict]:
    sel = json.loads((RAW / "FracAtlas" / "_meta" / "selection.json").read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for c in sel:
        ds = frac_dataset(c)
        stem = c["image"].rsplit(".", 1)[0]
        skey = f"figshare:FracAtlas:{stem}"
        sr = build_series([to_item(ds, c["image"])], {"region": "extremity", "role": "diagnostic",
                                                      "roleNote": "Musculoskeletal radiograph (FracAtlas JPEG) wrapped as DICOM Secondary Capture."}, skey)
        encode_and_place(sr, "jpegls")
        sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
        sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
        sr.record["displayNote"] = ("8-bit JPEG from FracAtlas wrapped as DICOM: no pixel spacing (distances are not measurable) and no "
                                    "orientation tag, so no orientation letters are shown; read the side from the burned-in marker if present.")
        results.append((sr, skey, {"holdout": FRAC_HOLDOUT.get(c["image"])}))
        a = c["annotation"]
        polys = [[[round(x - 0.5, 2), round(y - 0.5, 2)] for x, y in zip(seg[0::2], seg[1::2])] for seg in a["segmentation"]]
        tid = f"fracatlas-{stem.lower()}_fracture"
        targets.append({
            "id": tid, "label": "Fracture (FracAtlas expert outline)", "classId": "finding:fracture", "seriesUid": sr.uid,
            "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
            "provenanceDetail": {
                "source": "figshare:FracAtlas (Annotations/COCO JSON/COCO_fracture_masks.json)",
                "method": ("Fracture polygon drawn manually in makesense.ai with the help of two expert radiologists and an orthopedist "
                           f"(Abedeen et al. 2023); COCO annotation id {a['id']}, converted from pixel-corner to pixel-centre coordinates (-0.5 px)."),
                "note": f"COCO bbox {[round(v, 1) for v in a['bbox']]}; dataset.csv: {c['region']}, fracture_count 1, no hardware, frontal view.",
            },
            "completeness": "target_only", "assessedClasses": ["finding:fracture"],
            "unassessedNote": "Only the fracture is outlined; alignment, joint involvement and soft tissues are not referenced.",
            "review": dict(REVIEW),
            "teachingNote": "The outline marks the fracture region drawn by the dataset's annotators; it is not a measurement of displacement.",
        })
        geoms.append({"geometryType": "contour_set", "space": "image_px",
                      "planes": [{"sopInstanceUid": str(ds.SOPInstanceUID), "frame": 1, "polygons": polys}]})
    return results, targets, geoms, {}


# ====================================================================== shared
PACKS = {
    "cxr-findings": {
        "title": "Chest radiograph findings: pneumothorax, effusion, collapse, big heart, mass, nodule, pneumonia",
        "description": ("23 frontal (PA) chest radiographs of 23 adults from NIH ChestX-ray14, each with the bounding box a board-certified "
                        "radiologist drew around the finding: pneumothorax (4), pleural effusion (4), atelectasis (3), cardiomegaly (3), "
                        "mass (3), nodule (3) and pneumonia (3). Chosen by eye from the radiologist-boxed images so that the boxed finding "
                        "is clearly visible. The images are the dataset's 8-bit 1024 px release: no pixel spacing and no orientation tag."),
        "source": NIH_SOURCE, "builder": build_nih, "budget": 40_000_000,
    },
    "pe-cta": {
        "title": "CT pulmonary angiography: pulmonary embolism with radiologist masks",
        "description": ("Two CT pulmonary angiograms (1 mm, contrast) from the FUMPE dataset with the emboli marked by two radiologists: a "
                        "saddle embolus and a large right pulmonary artery embolus. Headers had placeholder UIDs and dates, repaired "
                        "before packing; pixel data are unchanged."),
        "source": FUMPE_SOURCE, "builder": build_fumpe, "budget": 200_000_000,
    },
    "fx-radiographs": {
        "title": "Fracture radiographs: wrist, ankle, shoulder, knee and hip with expert outlines",
        "description": ("Five musculoskeletal radiographs from FracAtlas, each with one fracture outlined by the dataset's annotators "
                        "(two expert radiologists and an orthopedist): distal forearm/wrist, ankle, proximal humerus, proximal tibia and "
                        "proximal femur. Full-resolution 8-bit JPEGs as distributed; no pixel spacing or orientation tag in the source."),
        "source": FRAC_SOURCE, "builder": build_frac, "budget": 40_000_000,
    },
}


def build(pack_id: str) -> dict:
    cfg = PACKS[pack_id]
    t0 = dt.datetime.now(dt.timezone.utc)
    results, targets, geoms, _ = cfg["builder"]()
    out = PACKS_DIR / pack_id
    for sub in ("dicom", "thumbs", "targets"):
        shutil.rmtree(out / sub, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    studies, subjects = {}, {}
    for sr, skey, info in results:
        ds = sr.sorted_items[0].ds
        st = studies.setdefault(sr.record["studyUid"], {
            "uid": sr.record["studyUid"], "subjectKey": skey, "description": str(ds.get("StudyDescription", "") or ""),
            "modalities": [], "date": None, "dateShifted": "unknown", "relativeDays": None,
            "timingNote": "No study date is distributed with this dataset; timing relative to other studies cannot be derived.",
            "seriesUids": []})
        if sr.record["modality"] not in st["modalities"]:
            st["modalities"].append(sr.record["modality"])
        st["seriesUids"].append(sr.uid)
        src_id = cfg["source"]["id"]
        sub = subjects.setdefault(skey, {
            "key": skey, "sourceId": src_id, "sourceSubjectId": skey.split(":", 2)[2],
            "linkageEvidence": (f"Source patient identifier {skey.split(':', 2)[2]} within {cfg['source']['name']}; "
                                "one study per subject in this pack."),
            "holdoutGroup": (info.get("holdout") if isinstance(info, dict) and info.get("holdout") else skey), "sex": (str(ds.PatientSex) if ds.get("PatientSex") else None),
            "ageAtFirstStudy": (str(ds.PatientAge) if ds.get("PatientAge") else None), "studyUids": []})
        sub["studyUids"].append(st["uid"])
        for rel, data in sr.outputs:
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (out / sr.record["thumbnail"]).parent.mkdir(parents=True, exist_ok=True)
        (out / sr.record["thumbnail"]).write_bytes(sr.thumb)
    for t, g in zip(targets, geoms):
        dump_json(g, out / t["geometryFile"], indent=None)
    import highdicom
    manifest = {
        "schemaVersion": SCHEMA_VERSION, "packId": pack_id, "version": "1.0.0", "title": cfg["title"], "description": cfg["description"],
        "generatedAt": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": (f"scripts/data/build_external.py (python {sys.version.split()[0]}, pydicom {pydicom.__version__}, "
                      f"highdicom {highdicom.__version__}, numpy {np.__version__})"),
        "sources": [cfg["source"]], "subjects": list(subjects.values()), "studies": list(studies.values()),
        "series": [sr.record for sr, _, _ in results], "spatialLinks": [], "referenceTargets": targets,
    }
    dump_json(manifest, out / "pack.json")
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file() and p.name != "lessons.json")
    dump_json({"packId": pack_id, "generatedAt": manifest["generatedAt"], "packBytesExcludingLessons": total, "budgetBytes": cfg["budget"],
               "series": [{"uid": sr.uid, "short": sr.short, "modality": sr.modality, "instances": len(sr.sorted_items),
                           "sortMethod": sr.qc.get("method"), "issues": sr.record["geometry"]["volumeIssues"],
                           "encodeStatus": sr.qc.get("encodeStatus"), "bytes": sr.record["bytes"]} for sr, _, _ in results],
               "targets": [t["id"] for t in targets]}, DOCS_DIR / f"{pack_id}-build-qc.json")
    log(f"[{pack_id}] wrote {len(results)} series, {len(targets)} targets, {total / 1e6:.1f} MB")
    if total > cfg["budget"]:
        raise SystemExit(f"{pack_id} over budget: {total}")
    return manifest


def index() -> None:
    """Upsert this script's packs into public/packs/index.json (packs.py index keeps entries it does not own)."""
    from common import load_json
    idx_path = PACKS_DIR / "index.json"
    data = load_json(idx_path)
    for pid in PACKS:
        man = PACKS_DIR / pid / "pack.json"
        if not man.exists():
            continue
        m = load_json(man)
        total = sum(p.stat().st_size for p in (PACKS_DIR / pid).rglob("*") if p.is_file())
        dicom = sum(p.stat().st_size for p in (PACKS_DIR / pid / "dicom").rglob("*") if p.is_file())
        entry = {"id": pid, "title": m["title"], "manifest": f"{pid}/pack.json",
                 "lessons": f"{pid}/lessons.json" if (PACKS_DIR / pid / "lessons.json").exists() else None,
                 "bytes": total, "distribution": "repo",
                 "note": (f"{len(m['subjects'])} subjects, {len(m['studies'])} studies, {len(m['series'])} series, "
                          f"{sum(len(s['instances']) for s in m['series'])} instances, {len(m['referenceTargets'])} reference targets; "
                          f"DICOM {dicom / 1e6:.1f} MB. Committed to the repository; rebuild with scripts/data/external.py + build_external.py.")}
        data["packs"] = [entry if e["id"] == pid else e for e in data["packs"]]
        if not any(e["id"] == pid for e in data["packs"]):
            data["packs"].append(entry)
    dump_json(data, idx_path)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "index":
        index()
    elif len(sys.argv) == 2 and sys.argv[1] in PACKS:
        build(sys.argv[1])
        index()
    else:
        raise SystemExit(__doc__)
