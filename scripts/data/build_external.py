"""Build learning packs from the non-TCIA downloads made by external.py.

  python scripts/data/build_external.py cxr-findings   # NIH ChestX-ray14 radiographs with radiologist boxes
  python scripts/data/build_external.py pe-cta         # FUMPE CT pulmonary angiograms with radiologist PE masks
  python scripts/data/build_external.py us-cases | mammo-cbis | peds-msk   # round 3: ultrasound, mammography, children/knee

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
    """Deterministic 2.25 UID from the source identifiers (rebuilds give the same UIDs). pydicom's generate_uid(prefix=None)
    ignores entropy_srcs and returns a random UUID, so the UID is derived from a SHA-256 of the identifiers instead."""
    import hashlib
    h = hashlib.sha256("".join(["radiology-study-packs", *parts]).encode()).hexdigest()
    return f"2.25.{int(h[:32], 16)}"


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


def build_nih(selection: str = "selection.json", skip: dict | None = None) -> tuple[list, list, list, dict]:
    sel = json.loads((RAW / "NIH-ChestXray14" / "_meta" / selection).read_text(encoding="utf-8"))
    results, targets, geoms, notes = [], [], [], {}
    for c in sel:
        if skip and c["image"] in skip:
            continue
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


# ====================================================================== ISLES 2022 (stroke MRI, NIfTI -> DICOM)
ISLES_SOURCE = {
    "id": "zenodo:ISLES-2022",
    "name": "ISLES 2022: a multi-center magnetic resonance imaging stroke lesion segmentation dataset",
    "url": "https://doi.org/10.5281/zenodo.7153326",
    "doi": "10.5281/zenodo.7153326",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Hernandez Petzsche MR, de la Rosa E, Hanning U, et al. ISLES 2022: A multi-center magnetic resonance imaging stroke "
                 "lesion segmentation dataset. Sci Data. 2022;9:762. doi:10.1038/s41597-022-01875-5. Data: Zenodo "
                 "doi:10.5281/zenodo.7153326"),
    "accessNote": ("ISLES-2022.zip (Zenodo record 7153326, open access, licence cc-by-4.0 per the Zenodo API) read member by member "
                   "over HTTP Range (CRC-32 checked); DWI, ADC, lesion mask and JSON sidecars of the selected cases only."),
}
MR_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.4"  # MR Image Storage
ISLES_WHY = {
    "sub-strokecase0057": "Large ischemic lesion (about 59 ml in the mask, one dominant component).",
    "sub-strokecase0015": "Moderate ischemic lesion (about 13 ml in the mask, one dominant component).",
}


def _isles_grid(img):
    """Pixel grid in DICOM convention from a NIfTI affine: columns run to the patient's left and rows run posterior when the
    voxel axes allow it (flip i/j otherwise); returns flips, row/column direction cosines (LPS), spacings and an IPP function."""
    lps = np.diag([-1.0, -1.0, 1.0, 1.0]) @ img.affine
    ui, uj, uk = lps[:3, 0], lps[:3, 1], lps[:3, 2]
    ni, nj, nk = img.shape[:3]
    fi, fj = ui[0] < 0, uj[1] < 0
    rowdir = (-ui if fi else ui) / np.linalg.norm(ui)  # direction of increasing column
    coldir = (-uj if fj else uj) / np.linalg.norm(uj)  # direction of increasing row
    i0, j0 = (ni - 1 if fi else 0), (nj - 1 if fj else 0)

    def ipp(k):
        return (lps @ np.array([i0, j0, k, 1.0]))[:3]

    return fi, fj, rowdir, coldir, (float(np.linalg.norm(uj)), float(np.linalg.norm(ui))), float(np.linalg.norm(uk)), ipp


def _isles_slice(a3, k, fi, fj):
    m = a3[:, :, k]
    if fi:
        m = m[::-1, :]
    if fj:
        m = m[:, ::-1]
    return np.ascontiguousarray(m.T)  # rows = j, columns = i


def isles_series(case: dict, kind: str, img, data: np.ndarray, sidecar: dict, frame_uid: str, adc_per_mm2s: float = 1.0) -> list[Item]:
    """adc_per_mm2s: how many of the distributed ADC units make 1 mm2/s (1 for mm2/s, 1e3 for 10^-3 mm2/s, 1e6 for 10^-6 mm2/s);
    the ISLES 2022 centres store ADC in different units, so round-4 cases pass the unit found from the brain's median ADC."""
    fi, fj, rowdir, coldir, ps, step, ipp = _isles_grid(img)
    study, series = uid_for("isles", case["case"], "study"), uid_for("isles", case["case"], kind, "series")
    if kind == "dwi":
        px = np.round(np.clip(data, 0, None)).astype(np.uint16)
        bval = sidecar.get("DiffusionBValue")
        desc = f"DWI trace, b={int(bval)} (ISLES 2022, converted from NIfTI)" if bval else "DWI trace (ISLES 2022, converted from NIfTI)"
        wc, ww = float(np.percentile(px[px > 0], 99.5)) / 2, float(np.percentile(px[px > 0], 99.5))
        deriv = "DWI trace as distributed (float), clipped at 0 and rounded to integer signal values; arbitrary units."
    else:
        px = np.round(np.clip(data / adc_per_mm2s, 0, None) * 1e6).astype(np.uint16)
        desc = "ADC map, 10^-6 mm2/s (ISLES 2022, converted from NIfTI)"
        wc, ww = 1000.0, 2000.0
        unit = {1.0: "mm2/s", 1e3: "10^-3 mm2/s", 1e6: "10^-6 mm2/s"}[adc_per_mm2s]
        deriv = f"ADC as distributed in {unit} (float), clipped at 0 and stored in units of 10^-6 mm2/s (integer)."
    items = []
    for k in range(data.shape[2]):
        a = _isles_slice(px, k, fi, fj)
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = MR_SOP_CLASS
        meta.MediaStorageSOPInstanceUID = uid_for("isles", case["case"], kind, str(k))
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = Dataset()
        ds.file_meta = meta
        ds.SpecificCharacterSet = "ISO_IR 100"
        ds.SOPClassUID = MR_SOP_CLASS
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame_uid
        ds.PositionReferenceIndicator = ""
        ds.Modality = "MR"
        ds.ImageType = ["DERIVED", "SECONDARY", "DIFFUSION" if kind == "dwi" else "ADC"]
        ds.PatientID = f"ISLES22-{case['case'].split('-')[1]}"
        ds.PatientName = ""
        if sidecar.get("PatientSex"):
            ds.PatientSex = sidecar["PatientSex"]
        if sidecar.get("PatientAge"):
            ds.PatientAge = sidecar["PatientAge"]
        ds.StudyID = case["case"][-12:]
        ds.StudyDescription = "MRI brain, stroke (ISLES 2022)"
        ds.SeriesDescription = desc
        ds.SeriesNumber = 1 if kind == "dwi" else 2
        ds.InstanceNumber = k + 1
        ds.BodyPartExamined = "BRAIN"
        for kw in ("Manufacturer", "ManufacturerModelName", "MagneticFieldStrength", "RepetitionTime", "EchoTime", "ScanningSequence",
                   "SequenceVariant", "MRAcquisitionType"):
            v = sidecar.get(kw)
            if v not in (None, ""):
                setattr(ds, kw, round(v, 3) if isinstance(v, float) else v)
        if "ScanningSequence" not in ds:
            ds.ScanningSequence = "EP"
        if "SequenceVariant" not in ds:
            ds.SequenceVariant = "NONE"
        ds.ScanOptions = ""
        if "MRAcquisitionType" not in ds:
            ds.MRAcquisitionType = "2D"
        ds.SliceThickness = round(step, 3)
        ds.SpacingBetweenSlices = round(step, 3)
        ds.ImagePositionPatient = [round(float(v), 4) for v in ipp(k)]
        ds.ImageOrientationPatient = [round(float(v), 6) for v in (*rowdir, *coldir)]
        ds.PixelSpacing = [round(ps[0], 6), round(ps[1], 6)]
        ds.DerivationDescription = (f"{case['files'][kind]['member']} (sha256 {case['files'][kind]['sha256'][:16]}...) converted to DICOM: "
                                    f"{deriv} Geometry from the NIfTI affine (RAS -> LPS); voxel axes flipped only so that columns run "
                                    "to the patient's left and rows run posterior. Skull-stripped and resliced by the dataset authors.")
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = a.shape
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.WindowCenter = round(wc, 1)
        ds.WindowWidth = round(max(ww, 1.0), 1)
        ds.PixelData = a.tobytes()
        items.append(to_item(ds, f"{kind}-{k:03d}.dcm"))
    return items


def build_isles() -> tuple[list, list, list, dict]:
    import nibabel as nib
    sel = json.loads((RAW / "ISLES-2022" / "selection.json").read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for case in sel:
        if case["case"] not in ISLES_WHY:
            continue
        imgs = {k: nib.load(RAW / case["files"][k]["file"]) for k in ("dwi", "adc", "msk")}
        shapes = {k: v.shape[:3] for k, v in imgs.items()}
        assert len(set(shapes.values())) == 1, shapes
        assert all(np.allclose(imgs["dwi"].affine, v.affine, atol=1e-4) for v in imgs.values()), "DWI/ADC/mask on different grids"
        mask = np.asarray(imgs["msk"].dataobj) > 0
        side = json.loads((RAW / case["files"]["dwi_json"]["file"]).read_text(encoding="utf-8"))
        frame_uid = uid_for("isles", case["case"], "frame")
        skey = f"zenodo:ISLES-2022:{case['case']}"
        fi, fj, *_ = _isles_grid(imgs["dwi"])
        for kind in ("dwi", "adc"):
            items = isles_series(case, kind, imgs[kind], np.asarray(imgs[kind].dataobj, dtype=np.float64), side, frame_uid)
            sr = build_series(items, {"region": "head", "role": "diagnostic",
                                      "roleNote": ("Diffusion-weighted MRI" if kind == "dwi" else "Apparent diffusion coefficient map") +
                                                  " of an ischemic stroke (ISLES 2022), converted from NIfTI to DICOM."}, skey)
            encode_and_place(sr, "jpegls")
            sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
            sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
            sr.record["displayNote"] = ("Converted from the dataset's NIfTI (skull-stripped, resliced to 2 mm by the dataset authors): the "
                                        "orientation comes from the NIfTI affine. " + ("Signal in arbitrary units." if kind == "dwi" else
                                        "ADC in 10^-6 mm2/s (normal brain is roughly 700-900; acute infarcts are lower)."))
            results.append((sr, skey, {}))
            sop_by_k = {int(it.name.split("-")[1][:3]): str(it.ds.SOPInstanceUID) for it in items}
            planes = []
            for k in range(mask.shape[2]):
                m = _isles_slice(mask, k, fi, fj)
                if not m.any():
                    continue
                rings = _mask_to_rings(m)
                if not rings:
                    continue
                hole = split_holes(rings) if len(rings) > 1 else [False]
                pl = {"sopInstanceUid": sop_by_k[k], "frame": 1,
                      "polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
                hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
                if hs:
                    pl["holes"] = hs
                if pl["polygons"]:
                    planes.append(pl)
            order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
            planes.sort(key=lambda p: order[p["sopInstanceUid"]])
            tid = f"isles-{case['case'].split('-')[1]}_{kind}_ischemic-stroke"
            vol = float(mask.sum() * np.prod(imgs["msk"].header.get_zooms()[:3]) / 1000)
            targets.append({
                "id": tid, "label": "Ischemic stroke lesion (ISLES 2022 expert-approved mask)", "classId": "finding:ischemic_stroke",
                "seriesUid": sr.uid, "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"zenodo:ISLES-2022 ({case['files']['msk']['member']}, sha256 {case['files']['msk']['sha256'][:16]}...)",
                    "method": ("Hybrid human-algorithm annotation (Hernandez Petzsche et al. 2022): a DWI-trained U-Net pre-segmentation corrected "
                               "by trained annotators (DWI, ADC and FLAIR reviewed), revised by a neuroradiologist in training and approved by "
                               "an attending neuroradiologist with more than 10 years of stroke imaging experience. The mask is on the DWI/ADC grid; "
                               "traced per slice with skimage find_contours (0.5) into image_px [col, row]."),
                    "note": f"{len(planes)} slices with lesion; mask volume {vol:.1f} ml.",
                },
                "completeness": "target_only",
                "assessedClasses": ["finding:ischemic_stroke"],
                "unassessedNote": ("Only the ischemic lesion is referenced; the vessel occlusion, older lesions and other findings are not "
                                   "outlined. The dataset does not give the time since onset or the affected arterial territory."),
                "review": dict(REVIEW),
                "teachingNote": ISLES_WHY[case["case"]] + (" Restricted diffusion: dark on the ADC map, bright on DWI." if kind == "adc"
                                                           else " Restricted diffusion: bright on DWI; check that it is dark on the ADC map."),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
            log(f"[stroke-mri] {case['case']} {kind}: {len(items)} images, {len(planes)} slices with lesion")
    return results, targets, geoms, {}



# ====================================================================== round 3: ultrasound, mammography, pediatric and MSK
US_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.6.1"  # Ultrasound Image Storage


def _gray(a: np.ndarray, name: str, tint_ok: bool = False) -> np.ndarray:
    """RGB(A) PNGs whose colour channels are identical become one grey channel (alpha ignored: transparent pixels are black).
    A tinted grey-scale image (a scanner colour map, no colour-flow data) becomes luma (ITU-R BT.601) only with tint_ok."""
    if a.ndim == 3:
        if not (np.array_equal(a[..., 0], a[..., 1]) and np.array_equal(a[..., 0], a[..., 2])):
            assert tint_ok, f"{name}: colour image"
            return np.ascontiguousarray(np.clip(np.round(a[..., :3].astype(np.float64) @ [0.299, 0.587, 0.114]), 0, 255).astype(np.uint8))
        a = a[..., 0]
    return np.ascontiguousarray(a)


def _window(a: np.ndarray) -> tuple[float, float]:
    """Default display window from the image histogram (1st to 99.5th percentile of the non-background pixels)."""
    v = a[a > a.min()] if (a > a.min()).any() else a
    lo, hi = np.percentile(v, [1, 99.5])
    return round(float(lo + hi) / 2, 1), round(float(max(1.0, hi - lo)), 1)


def wrap_2d(a: np.ndarray, *, tag: str, stem: str, study_key: str, modality: str, sop_class: str, patient_id: str,
            study_desc: str, series_desc: str, series_number: int, attrs: dict) -> Dataset:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop_class
    meta.MediaStorageSOPInstanceUID = uid_for(tag, stem, "sop")
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = uid_for(tag, study_key, "study")
    ds.SeriesInstanceUID = uid_for(tag, stem, "series")
    ds.Modality = modality
    if sop_class == SC_SOP_CLASS:
        ds.ConversionType = "WSD"
    ds.ImageType = ["DERIVED", "SECONDARY"]
    ds.PatientID = patient_id
    ds.PatientName = ""
    ds.StudyID = study_key[:16]
    ds.StudyDescription = study_desc
    ds.SeriesDescription = series_desc
    ds.SeriesNumber = series_number
    ds.InstanceNumber = 1
    for k, v in attrs.items():
        setattr(ds, k, v)
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows, ds.Columns = a.shape
    bits = 8 if a.dtype == np.uint8 else 16
    ds.BitsAllocated = bits
    ds.BitsStored = bits
    ds.HighBit = bits - 1
    ds.PixelRepresentation = 0
    if bits == 8:  # 8-bit PNGs are already display images (ultrasound, knee crops): show them as distributed
        ds.WindowCenter, ds.WindowWidth = 127.5, 256
        ds.WindowCenterWidthExplanation = "Full 8-bit range (the image is already display-processed)"
    else:
        ds.WindowCenter, ds.WindowWidth = _window(a)
        ds.WindowCenterWidthExplanation = "Default window from the image histogram"
    ds.PixelData = a.tobytes()
    return ds


def _us_regions(rows: int, cols: int, mm: float) -> list:
    """One 2D tissue region over the whole image with its physical pixel size (DICOM wants cm), so distances are true mm."""
    r = Dataset()
    r.RegionSpatialFormat = 1
    r.RegionDataType = 1
    r.RegionFlags = 0
    r.RegionLocationMinX0, r.RegionLocationMinY0 = 0, 0
    r.RegionLocationMaxX1, r.RegionLocationMaxY1 = cols - 1, rows - 1
    r.PhysicalUnitsXDirection, r.PhysicalUnitsYDirection = 3, 3
    r.PhysicalDeltaX, r.PhysicalDeltaY = mm / 10.0, mm / 10.0
    return [r]


def _rings_px(mask: np.ndarray) -> dict:
    rings = _mask_to_rings(mask)
    hole = split_holes(rings) if len(rings) > 1 else [False] * len(rings)
    out = {"polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
    hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
    if hs:
        out["holes"] = hs
    return out


def _contour_target(tid: str, label: str, cid: str, sr, sop: str, mask: np.ndarray, detail: dict, teaching: str, unassessed: str):
    pl = {"sopInstanceUid": sop, "frame": 1, **_rings_px(mask)}
    assert pl["polygons"], tid
    t = {"id": tid, "label": label, "classId": cid, "seriesUid": sr.uid, "geometryType": "contour_set",
         "geometryFile": f"targets/{tid}.json", "provenance": "source_manual", "provenanceDetail": detail,
         "completeness": "target_only", "assessedClasses": [cid], "unassessedNote": unassessed, "review": dict(REVIEW),
         "teachingNote": teaching}
    return t, {"geometryType": "contour_set", "space": "image_px", "planes": [pl]}


def _place(sr, note: str):
    encode_and_place(sr, "jpegls")
    sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
    sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
    sr.record["displayNote"] = note
    return sr


# ---------------------------------------------------------------------- Breast-Lesions-USG
BREAST_SOURCE = {
    "id": "tcia:Breast-Lesions-USG",
    "name": "Breast-Lesions-USG (BrEaST): a curated breast ultrasound dataset with benign, malignant and normal cases",
    "url": "https://doi.org/10.7937/9wkk-q141",
    "doi": "10.7937/9wkk-q141",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Pawłowska A, Ćwierz-Pieńkowska A, Domalik A, et al. Curated benchmark dataset for ultrasound based breast lesion "
                 "analysis. Sci Data. 2024;11:148. doi:10.1038/s41597-024-02984-z. Data: The Cancer Imaging Archive, "
                 "doi:10.7937/9wkk-q141"),
    "accessNote": "Images-and-masks ZIP and clinical XLSX downloaded anonymously from the TCIA collection page (Dec-15-2023 release).",
}
HC18_SOURCE = {
    "id": "zenodo:HC18",
    "name": "HC18: automated measurement of fetal head circumference using 2D ultrasound images",
    "url": "https://doi.org/10.5281/zenodo.1327317",
    "doi": "10.5281/zenodo.1327317",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("van den Heuvel TLA, de Bruijn D, de Korte CL, van Ginneken B. Automated measurement of fetal head circumference using "
                 "2D ultrasound images. PLoS One. 2018;13(8):e0200412. doi:10.1371/journal.pone.0200412. Data: Zenodo "
                 "doi:10.5281/zenodo.1327317 (v2)"),
    "accessNote": "training_set.zip read member by member (HTTP Range, CRC-32 checked) and training_set_pixel_size_and_HC.csv from Zenodo; open access.",
}


def build_us() -> tuple[list, list, list, dict]:
    from PIL import Image
    from scipy import ndimage
    results, targets, geoms = [], [], []
    sel = json.loads((RAW / "BrEaST" / "selection.json").read_text(encoding="utf-8"))
    for c in sel["cases"]:
        r = c["row"]
        stem = f"case{int(c['case']):03d}"
        rgba = np.asarray(Image.open(RAW / c["files"]["image"]["file"]))
        tinted = rgba.ndim == 3 and not (np.array_equal(rgba[..., 0], rgba[..., 1]) and np.array_equal(rgba[..., 0], rgba[..., 2]))
        a = _gray(rgba, stem, tint_ok=True).astype(np.uint8)
        m = _gray(np.asarray(Image.open(RAW / c["files"]["tumor"]["file"])), stem + "_tumor") > 127
        assert m.shape == a.shape, stem
        mm = float(r["Pixel_size"]) * 10.0  # the XLSX data dictionary: "pixel size of the image in centimeters"
        ds = wrap_2d(a, tag="breast-usg", stem=stem, study_key=stem, modality="US", sop_class=US_SOP_CLASS,
                     patient_id=f"BrEaST-{stem}", study_desc="Breast ultrasound", series_desc="Breast ultrasound, B-mode",
                     series_number=1, attrs={"PixelSpacing": [round(mm, 8), round(mm, 8)], "BodyPartExamined": "BREAST",
                                             "SequenceOfUltrasoundRegions": _us_regions(*a.shape, mm),
                                             **({"PatientAge": f"{int(r['Age']):03d}Y"} if str(r["Age"]).isdigit() else {}),
                                             "DerivationDescription": (f"{r['Image_filename']} from Breast-Lesions-USG (cropped B-mode PNG as "
                                                                       "distributed); wrapped as DICOM with the pixel size from the clinical XLSX."
                                                                       + (" The PNG is grey-scale with a slight colour tint (no colour-flow "
                                                                          "data); stored as luma (ITU-R BT.601)." if tinted else ""))})
        skey = f"tcia:Breast-Lesions-USG:{stem}"
        sr = _place(build_series([to_item(ds, stem + ".png")], {"region": "breast", "role": "diagnostic",
                                                                "roleNote": "Breast ultrasound image (Breast-Lesions-USG PNG) wrapped as DICOM."}, skey),
                    ("Cropped B-mode image from Breast-Lesions-USG with the pixel size given by the dataset (true distances in mm); "
                               "no orientation tag, so no orientation letters are shown."))
        cyst = r["Interpretation"] == "Simple cyst"
        if cyst:
            cid, lab = "finding:breast_cyst", "Breast cyst: simple cyst (radiologist outline)"
        else:
            dx = "invasive carcinoma of no special type" if r["Diagnosis"].startswith("Invasive carcinoma") else r["Diagnosis"].lower()
            cid, lab = "finding:breast_mass", f"Breast mass: {dx}, biopsy-proven (radiologist outline)"
        tid = f"breast-usg-{stem}_{'cyst' if cyst else 'mass'}"
        t, g = _contour_target(
            tid, lab, cid, sr, str(ds.SOPInstanceUID), m,
            {"source": "tcia:Breast-Lesions-USG (images_and_masks, clinical XLSX)",
             "method": ("Freehand outline of the lesion by a radiologist experienced in breast ultrasound, who also gave the BI-RADS "
                        f"descriptors (TCIA collection description; Pawłowska et al. 2024); {r['Mask_tumor_filename']} traced into image_px [col, row]."),
             "note": (f"BI-RADS {r['BIRADS']}; shape {r['Shape']}; margin {r['Margin']}; echogenicity {r['Echogenicity']}; posterior "
                      f"features {r['Posterior_features']}; {r['Verification']}; diagnosis: {r['Diagnosis']}.")},
            ("Simple cyst on follow-up: anechoic, circumscribed" + (", with posterior acoustic enhancement." if r["Posterior_features"] == "enhancement" else ".")
             if cyst else f"{r['Diagnosis']} ({r['Verification']}): {r['Shape']}, margin {r['Margin']}, posterior features {r['Posterior_features']}."),
            "Only the lesion is outlined; skin, glandular tissue and other lesions are not referenced.")
        targets.append(t)
        geoms.append(g)
        results.append((sr, skey, {"sourceId": BREAST_SOURCE["id"], "row": r,
                                   "linkage": f"Case {stem} of Breast-Lesions-USG, which has one scan per patient (256 scans, 256 patients)."}))
    # HC18: all three images share one hold-out group (the dataset gives no mother/pregnancy identifiers).
    for c in json.loads((RAW / "HC18" / "selection.json").read_text(encoding="utf-8")):
        stem = c["image"].rsplit(".", 1)[0]
        a = _gray(np.asarray(Image.open(RAW / c["files"]["image"]["file"])), stem).astype(np.uint8)
        line = _gray(np.asarray(Image.open(RAW / c["files"]["annotation"]["file"])), stem + "_ann") > 127
        head = ndimage.binary_fill_holes(line)
        assert head.sum() > line.sum() * 5, f"{stem}: ellipse did not close"
        mm = c["pixelSizeMm"]
        ds = wrap_2d(a, tag="hc18", stem=stem, study_key=stem, modality="US", sop_class=US_SOP_CLASS, patient_id=f"HC18-{stem}",
                     study_desc="Obstetric ultrasound", series_desc="Fetal head, standard plane for head circumference", series_number=1,
                     attrs={"PixelSpacing": [round(mm, 7), round(mm, 7)], "SequenceOfUltrasoundRegions": _us_regions(*a.shape, mm),
                            "DerivationDescription": f"{c['image']} from the HC18 training set (800x540 PNG); wrapped as DICOM with the stated pixel size."})
        skey = f"zenodo:HC18:{stem}"
        sr = _place(build_series([to_item(ds, c["image"])], {"region": "pelvis", "role": "diagnostic",
                                                             "roleNote": "Obstetric ultrasound image (HC18 PNG) wrapped as DICOM."}, skey),
                    ("Fetal head on the standard plane, from the HC18 dataset with the pixel size it gives (true distances in mm). "
                               "The black box at a corner hides the scanner's text in the source."))
        tid = f"hc18-{stem.lower().replace('_', '-')}_fetal-head"
        t, g = _contour_target(
            tid, "Fetal head (sonographer's ellipse)", "anatomy:fetal_head", sr, str(ds.SOPInstanceUID), head,
            {"source": "zenodo:HC18 (training_set, *_Annotation.png)",
             "method": ("Head circumference annotated as an ellipse by a trained sonographer (van den Heuvel et al. 2018; HC18 challenge "
                        "page); the annotation image draws the ellipse outline, filled and traced into image_px [col, row]."),
             "note": f"Head circumference measured by the sonographer: {c['hcMm']:.1f} mm (pixel size {mm:.4f} mm)."},
            f"The sonographer's ellipse around the outer skull; the head circumference on this image is {c['hcMm']:.0f} mm.",
            "Only the fetal head outline is referenced; the rest of the fetus, placenta and amniotic fluid are not.")
        targets.append(t)
        geoms.append(g)
        results.append((sr, skey, {"sourceId": HC18_SOURCE["id"], "holdout": "zenodo:HC18:training-set", "hcMm": c["hcMm"],
                                   "linkage": (f"HC18 image {stem}; the dataset gives no patient identifiers, so images may come from the same "
                                               "pregnancy: all HC18 images here share one hold-out group.")}))
    return results, targets, geoms, {}


# ---------------------------------------------------------------------- CBIS-DDSM mammography
CBIS_SOURCE = {
    "id": "tcia:CBIS-DDSM",
    "name": "CBIS-DDSM: Curated Breast Imaging Subset of DDSM",
    "url": "https://doi.org/10.7937/K9/TCIA.2016.7O02S9CY",
    "doi": "10.7937/K9/TCIA.2016.7O02S9CY",
    "license": "Creative Commons Attribution 3.0 Unported License",
    "licenseUrl": "http://creativecommons.org/licenses/by/3.0/",
    "citation": ("Sawyer Lee R, Gimenez F, Hoogi A, Rubin D. Curated Breast Imaging Subset of DDSM [Data set]. The Cancer Imaging Archive. "
                 "2016. doi:10.7937/K9/TCIA.2016.7O02S9CY. Lee RS, Gimenez F, Hoogi A, Miyake KK, Gorovoy M, Rubin DL. A curated "
                 "mammography data set for use in computer-aided detection and diagnosis research. Sci Data. 2017;4:170177."),
    "accessNote": "Full mammograms and ROI mask series retrieved anonymously from the TCIA NBIA REST API v1 (getImage); case description CSVs from the collection page.",
}
# DICOM PatientOrientation for each view as hung (chest wall towards the middle, film marker on the axillary side at the top):
# checked per film from the pixels (chest-wall side) and the burned-in film marker.
MG_ORIENT = {("LEFT", "CC"): ["A", "R"], ("RIGHT", "CC"): ["P", "L"], ("LEFT", "MLO"): ["A", "F"], ("RIGHT", "MLO"): ["P", "F"]}


def _half(a: np.ndarray) -> np.ndarray:
    h, w = (a.shape[0] // 2) * 2, (a.shape[1] // 2) * 2
    return a[:h, :w].reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))


def build_mammo(selection: str = "selection.json", skip: dict | None = None) -> tuple[list, list, list, dict]:
    import zipfile
    results, targets, geoms = [], [], []
    sel = json.loads((RAW / "CBIS-DDSM" / selection).read_text(encoding="utf-8"))
    for r in sel:
        if skip and r["patient_id"] in skip:
            continue
        side, view, pid = r["left or right breast"], r["image view"], r["patient_id"]
        zf = zipfile.ZipFile(RAW / r["fullZip"])
        src = pydicom.dcmread(io.BytesIO(zf.read([n for n in zf.namelist() if n.endswith(".dcm")][0])))
        assert src.PhotometricInterpretation == "MONOCHROME2" and int(src.PixelRepresentation) == 0, (pid, side, view)
        zr = zipfile.ZipFile(RAW / r["roiZip"])
        masks = [pydicom.dcmread(io.BytesIO(zr.read(n))) for n in zr.namelist() if n.endswith(".dcm")]
        roi = [m for m in masks if m.Rows == src.Rows and m.Columns == src.Columns]
        assert len(roi) == 1, (pid, side, view)
        full = src.pixel_array
        # chest wall where the tissue touches the image edge: must match the side's standard hanging
        h, w = full.shape
        band, thr = slice(int(h * 0.3), int(h * 0.7)), np.percentile(full, 60)
        chest_left = (full[band, : int(w * 0.03)] > thr).mean() > (full[band, -int(w * 0.03):] > thr).mean()
        assert chest_left == (side == "LEFT"), (pid, side, view, "unexpected chest-wall side")
        a = np.round(_half(full.astype(np.float64))).astype(np.uint16)
        m = _half(roi[0].pixel_array > 0) >= 0.5
        stem = f"{pid}_{side}_{view}"
        calc = r["csv"].startswith("calc")
        ds = wrap_2d(a, tag="cbis-ddsm", stem=stem, study_key=pid, modality="MG", sop_class=SC_SOP_CLASS, patient_id=f"CBIS-DDSM-{pid}",
                     study_desc="Mammography (CBIS-DDSM)", series_desc=f"{'Left' if side == 'LEFT' else 'Right'} {view}",
                     series_number={"RIGHT": 1, "LEFT": 3}[side] + (0 if view == "CC" else 1),
                     attrs={"ImageLaterality": side[0], "Laterality": side[0], "ViewPosition": view, "PatientOrientation": MG_ORIENT[(side, view)],
                            "BodyPartExamined": "BREAST",
                            "DerivationDescription": ("CBIS-DDSM full mammogram (digitised film, 16-bit), downsampled 2x2 by averaging for the web; "
                                                      "ImageLaterality, ViewPosition and PatientOrientation set from the case description and the film.")})
        skey = f"tcia:CBIS-DDSM:{pid}"
        sr = _place(build_series([to_item(ds, stem + ".dcm")], {"region": "breast", "role": "diagnostic",
                                                                "roleNote": f"Screening-film mammogram, {side.lower()} {view} view (CBIS-DDSM)."}, skey),
                    ("Digitised screen-film mammogram from CBIS-DDSM, downsampled 2x2 for the web. No pixel spacing in the source "
                               "(distances are not measurable). The burned-in film marker shows the side and view."))
        if calc:
            cid = "finding:breast_calcifications"
            lab = f"Breast calcifications: {r['calc type'].lower().replace('_', ' ')}, {str(r['calc distribution']).lower().replace('nan', 'distribution not given').replace('n/a', 'distribution not given')} ({r['pathology'].replace('_', ' ').lower()}; DDSM region outline)"
            method = "Region outline of the calcifications from the original DDSM annotation (not re-segmented in CBIS-DDSM); ROI mask downsampled 2x2 and traced."
        else:
            cid = "finding:breast_mass"
            lab = f"Breast mass: {r['mass shape'].lower().replace('_', ' ')}, {r['mass margins'].lower().replace('_', ' ')} margin ({r['pathology'].replace('_', ' ').lower()}; outline)"
            method = "Mass outline re-segmented in CBIS-DDSM from the original DDSM contour (level set); ROI mask downsampled 2x2 and traced."
        tid = f"cbis-{pid.lower().replace('_', '')}-{side.lower()}-{view.lower()}_{'calc' if calc else 'mass'}"
        t, g = _contour_target(
            tid, lab, cid, sr, str(ds.SOPInstanceUID), m,
            {"source": f"tcia:CBIS-DDSM ({r['csv']}.csv, ROI mask series)", "method": method,
             "note": (f"{pid} {side} {view}: BI-RADS assessment {r['assessment']}, pathology {r['pathology']}, subtlety {r['subtlety']}, "
                      f"breast density {r.get('breast_density') or r.get('breast density')}.")},
            ("Calcifications outlined as a region; look at their form (round, coarse, vascular vs fine pleomorphic or linear) and how they are distributed."
             if calc else "The mass outline; describe its shape, margin and density, and find it on both views."),
            "Only this finding is outlined; the rest of the breast and the other breast are not referenced.")
        targets.append(t)
        geoms.append(g)
        results.append((sr, skey, {"sourceId": CBIS_SOURCE["id"], "row": r,
                                   "linkage": f"CBIS-DDSM patient {pid}; all views of this woman are one study in this pack."}))
    return results, targets, geoms, {}


# ---------------------------------------------------------------------- GRAZPEDWRI-DX pediatric wrists + knee osteoarthritis grades
GRAZ_SOURCE = {
    "id": "figshare:GRAZPEDWRI-DX",
    "name": "GRAZPEDWRI-DX: a pediatric wrist trauma X-ray dataset",
    "url": "https://doi.org/10.6084/m9.figshare.14825193.v2",
    "doi": "10.6084/m9.figshare.14825193.v2",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Nagy E, Janisch M, Hržić F, Sorantin E, Tschauner S. A pediatric wrist trauma X-ray dataset (GRAZPEDWRI-DX) for machine "
                 "learning. Sci Data. 2022;9:222. doi:10.1038/s41597-022-01328-z. Data: figshare doi:10.6084/m9.figshare.14825193.v2"),
    "accessNote": "dataset.csv and folder_structure.zip (annotations) from figshare; the selected 16-bit PNGs read member by member (HTTP Range, CRC-32 checked) from images_partN.zip. No login.",
}
KNEE_SOURCE = {
    "id": "mendeley:Digital-Knee-X-ray",
    "name": "Digital Knee X-ray Images (Kellgren-Lawrence grades by two medical experts)",
    "url": "https://doi.org/10.17632/t9ndx37v5h.1",
    "doi": "10.17632/t9ndx37v5h.1",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": "Gornale S, Patravali P. Digital Knee X-ray Images. Mendeley Data, V1, 2020. doi:10.17632/t9ndx37v5h.1",
    "accessNote": "MedicalExpert-I.rar and MedicalExpert-II.rar downloaded from Mendeley Data; images matched between the two experts by pixel hash.",
}
GRAZ_PATIENTS = {  # patient: (AO PCCF code, teaching type), chosen by eye with the radiologist's box drawn on both views
    "3390": ("23r-E/2.1", "physeal"), "3853": ("23r-E/2.1", "physeal"), "0030": ("23r-M/2.1", "incomplete"), "0071": ("23r-M/2.1", "incomplete"),
}
KNEE_PICKS = {"0Normal": "NormalG0 (10).png", "2Mild": "MildG2 (102).png", "4Severe": "SevereG4 (101).png"}
KL_TEXT = {"0Normal": "Kellgren-Lawrence grade 0 (normal)", "1Doubtful": "Kellgren-Lawrence grade 1 (doubtful)", "2Mild": "Kellgren-Lawrence grade 2 (mild)",
           "3Moderate": "Kellgren-Lawrence grade 3 (moderate)", "4Severe": "Kellgren-Lawrence grade 4 (severe)"}


def build_peds_msk() -> tuple[list, list, list, dict]:
    import csv as _csv
    import zipfile
    from PIL import Image
    results, targets, geoms = [], [], []
    meta = RAW / "GRAZPEDWRI-DX" / "_meta"
    rows = {r["filestem"]: r for r in _csv.DictReader(open(meta / "dataset.csv", encoding="utf-8-sig"))}
    ann = zipfile.ZipFile(meta / "folder_structure.zip")
    for c in json.loads((RAW / "GRAZPEDWRI-DX" / "selection.json").read_text(encoding="utf-8")):
        stem = c["stem"]
        pid, r = stem[:4], rows[stem]
        ao, kind = GRAZ_PATIENTS[pid]
        assert r["ao_classification"] == ao and r["fracture_visible"] == "1" and r["initial_exam"] == "1", stem
        a = np.asarray(Image.open(RAW / c["file"]))
        assert a.ndim == 2 and a.dtype == np.uint16, stem
        a = np.ascontiguousarray(a)
        lat = "frontal" if r["projection"] == "1" else "lateral"
        a_json = json.loads(ann.read(f"supervisely/wrist/ann/{stem}.json"))
        tags = {t if isinstance(t, str) else t["name"] for t in a_json["tags"]}
        assert f"side_{'left' if r['laterality'] == 'L' else 'right'}" in tags, stem
        ds = wrap_2d(a, tag="grazpedwri", stem=stem, study_key=f"{pid}-{r['study_number']}", modality="DX", sop_class=SC_SOP_CLASS,
                     patient_id=f"GRAZPEDWRI-{int(pid):04d}", study_desc="Wrist radiographs (child)",
                     series_desc=f"{'Left' if r['laterality'] == 'L' else 'Right'} wrist, {lat}", series_number=1 if lat == "frontal" else 2,
                     attrs={"ImagerPixelSpacing": [float(r["pixel_spacing"]), float(r["pixel_spacing"])], "ImageLaterality": r["laterality"],
                            "BodyPartExamined": "WRIST", "PatientSex": r["gender"], "PatientAge": f"{int(float(r['age'])):03d}Y",
                            **({"ViewPosition": "AP"} if "projection_ap" in tags else {}),  # only the AP tag maps to a DICOM view
                            "DerivationDescription": (f"{stem}.png from GRAZPEDWRI-DX (16-bit PNG made by the dataset authors from the "
                                                      "DICOM); pixel spacing from dataset.csv (detector plane).")})
        skey = f"figshare:GRAZPEDWRI-DX:{int(pid)}"
        sr = _place(build_series([to_item(ds, stem + ".png")], {"region": "extremity", "role": "diagnostic",
                                                                "roleNote": f"Pediatric wrist radiograph, {lat} view (GRAZPEDWRI-DX)."}, skey),
                    ("Pediatric wrist radiograph from GRAZPEDWRI-DX (16-bit). Pixel spacing is at the detector, not corrected for "
                                  "magnification; no orientation tag, so read the side from the burned-in marker."))
        boxes = [o for o in a_json["objects"] if o["classTitle"] == "fracture"]
        assert len(boxes) == 1, stem
        (x0, y0), (x1, y1) = boxes[0]["points"]["exterior"]
        cid = "finding:physeal_fracture" if kind == "physeal" else "finding:incomplete_fracture"
        lab = ("Fracture: distal radius, Salter-Harris type II (radiologist box)" if kind == "physeal"
               else "Fracture: distal radius, incomplete (torus/buckle or greenstick; radiologist box)")
        tid = f"grazpedwri-{stem[:4]}-{lat}_fracture"
        targets.append({
            "id": tid, "label": lab, "classId": cid, "seriesUid": sr.uid, "geometryType": "box", "geometryFile": f"targets/{tid}.json",
            "provenance": "source_manual",
            "provenanceDetail": {"source": "figshare:GRAZPEDWRI-DX (folder_structure.zip, supervisely annotations; dataset.csv)",
                                 "method": ("Fracture box from the dataset's annotations, which pediatric radiologists reviewed at least twice "
                                            "(Nagy et al. 2022); converted from pixel-corner to pixel-centre coordinates (-0.5 px). The fracture "
                                            "type in the label is read from the AO/OTA pediatric code in dataset.csv (E/2 = Salter-Harris II; "
                                            "M/2 = incomplete, torus/buckle or greenstick)."),
                                 "note": f"AO/OTA pediatric code {ao} (dataset.csv); age {r['age']} y, {r['gender']}, side {r['laterality']}."},
            "completeness": "target_only", "assessedClasses": [cid],
            "unassessedNote": "Only the fracture is boxed; the ulna, carpal bones and soft tissues are not referenced.", "review": dict(REVIEW),
            "teachingNote": ("Salter-Harris II: the fracture runs along the growth plate and out through the metaphysis (AO PCCF E/2)."
                             if kind == "physeal" else "Incomplete metaphyseal fracture (AO PCCF M/2: torus/buckle or greenstick): look for a bulge, kink or break of one cortex."),
        })
        geoms.append({"geometryType": "box", "space": "image_px",
                      "boxes": [{"sopInstanceUid": str(ds.SOPInstanceUID), "frame": 1, "box": [x0 - 0.5, y0 - 0.5, x1 - 0.5, y1 - 0.5]}]})
        results.append((sr, skey, {"sourceId": GRAZ_SOURCE["id"], "ao": ao, "kind": kind,
                                   "linkage": f"GRAZPEDWRI-DX patient_id {int(pid)}, study {r['study_number']} (dataset.csv); frontal and lateral views of one study."}))
    # Knee: image-level grades of the two experts (they agree on every image used); no location, so no outline.
    match = json.loads((RAW / "Knee-KL-Gornale" / "match.json").read_text(encoding="utf-8"))
    for grade, fname in KNEE_PICKS.items():
        h, v = next((h, v) for h, v in match.items() if v["gI"] == grade and v["I"].replace(chr(92), "/").endswith(f"{grade}/{fname}"))
        assert v["gII"] == grade
        a = _gray(np.asarray(Image.open(RAW / "Knee-KL-Gornale" / v["I"])), fname).astype(np.uint8)
        stem = f"knee-{grade.lower()}-{h[:8]}"
        ds = wrap_2d(a, tag="knee-kl", stem=stem, study_key=stem, modality="DX", sop_class=SC_SOP_CLASS, patient_id=f"KneeKL-{h[:8]}",
                     study_desc="Knee radiograph", series_desc="Knee joint (cropped)", series_number=1,
                     attrs={"BodyPartExamined": "KNEE", "DerivationDescription": f"{fname} from Digital Knee X-ray Images (8-bit, {a.shape[1]}x{a.shape[0]} crop of the joint as distributed)."})
        skey = f"mendeley:Digital-Knee-X-ray:{h[:12]}"
        sr = _place(build_series([to_item(ds, stem + ".png")], {"region": "extremity", "role": "diagnostic",
                                                                "roleNote": "Knee radiograph cropped to the joint (Digital Knee X-ray Images)."}, skey),
                    (f"Small crop of the knee joint ({a.shape[1]}x{a.shape[0]} px) as distributed; no pixel spacing, no side or "
                                  "orientation in the source."))
        for expert in ("I", "II"):
            tid = f"knee-kl-{h[:8]}_expert-{expert.lower()}"
            targets.append({
                "id": tid, "label": f"Osteoarthritis grade, medical expert {expert}", "classId": "label:knee_kl_grade", "seriesUid": sr.uid,
                "geometryType": "image_label", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {"source": f"mendeley:Digital-Knee-X-ray (MedicalExpert-{expert}.rar)",
                                     "method": "Kellgren-Lawrence grade given to the whole image by the expert (folder name); no location.",
                                     "note": f"Both experts graded this image {KL_TEXT[grade]}."},
                "completeness": "target_only", "assessedClasses": ["label:knee_kl_grade"],
                "unassessedNote": "An image-level grade only: no part of the image is marked.", "review": dict(REVIEW),
            })
            geoms.append({"geometryType": "image_label", "sopInstanceUids": [str(ds.SOPInstanceUID)], "labels": [KL_TEXT[grade]]})
        results.append((sr, skey, {"sourceId": KNEE_SOURCE["id"], "holdout": "mendeley:Digital-Knee-X-ray", "grade": grade,
                                   "linkage": (f"Knee image {fname} (image hash {h[:12]}); the dataset gives no patient identifiers, so images "
                                               "may come from the same person: all knee images here share one hold-out group.")}))
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
    "stroke-mri": {
        "title": "Stroke MRI: ischemic lesions on DWI and ADC with expert-approved masks",
        "description": ("Two brain MRIs of ischemic stroke from ISLES 2022 (diffusion-weighted images and ADC maps), each with the lesion mask "
                        "approved by an attending neuroradiologist. Converted from the dataset's NIfTI (skull-stripped, 2 mm) to DICOM with "
                        "the geometry taken from the NIfTI affine; DWI and ADC share one frame of reference."),
        "source": ISLES_SOURCE, "builder": build_isles, "budget": 20_000_000,
    },
    "fx-radiographs": {
        "title": "Fracture radiographs: wrist, ankle, shoulder, knee and hip with expert outlines",
        "description": ("Five musculoskeletal radiographs from FracAtlas, each with one fracture outlined by the dataset's annotators "
                        "(two expert radiologists and an orthopedist): distal forearm/wrist, ankle, proximal humerus, proximal tibia and "
                        "proximal femur. Full-resolution 8-bit JPEGs as distributed; no pixel spacing or orientation tag in the source."),
        "source": FRAC_SOURCE, "builder": build_frac, "budget": 40_000_000,
    },
    "us-cases": {
        "title": "Ultrasound: breast lesions and the fetal head",
        "description": ("Nine ultrasound images with true pixel size. Six breast ultrasound images from Breast-Lesions-USG, each lesion "
                        "outlined by a radiologist experienced in breast ultrasound: two biopsy-proven invasive carcinomas, two "
                        "biopsy-proven fibroadenomas and two simple cysts confirmed on follow-up. Three fetal head images on the standard "
                        "plane from HC18 with the sonographer's head-circumference ellipse. Images are the datasets' cropped 8-bit PNGs; no "
                        "orientation tag."),
        "sources": [BREAST_SOURCE, HC18_SOURCE], "builder": build_us, "budget": 15_000_000,
    },
    "mammo-cbis": {
        "title": "Mammography: masses and calcifications on CC and MLO views",
        "description": ("Twelve screen-film mammograms (CBIS-DDSM, digitised film) from five women: both views (CC and MLO) of six breasts, "
                        "one woman with all four views. Masses (benign and malignant, the mass outline) and calcifications (malignant "
                        "and benign, the region outline) with BI-RADS assessment and pathology as the dataset gives them. Downsampled "
                        "2x2 for the web; no pixel spacing. ImageLaterality, ViewPosition and PatientOrientation are set for hanging."),
        "sources": [CBIS_SOURCE], "builder": build_mammo, "budget": 80_000_000,
    },
    "peds-msk": {
        "title": "Children's wrist fractures and knee osteoarthritis grades",
        "description": ("Eight wrist radiographs (frontal and lateral) of four children from GRAZPEDWRI-DX with the fracture boxed: two "
                        "Salter-Harris II fractures of the distal radius and two incomplete (torus/buckle or greenstick) distal radius "
                        "fractures, as coded in the dataset. Three knee radiographs (small crops of the joint) from Digital Knee X-ray "
                        "Images with the Kellgren-Lawrence grade both experts gave (0, 2 and 4); grade only, no location."),
        "sources": [GRAZ_SOURCE, KNEE_SOURCE], "builder": build_peds_msk, "budget": 30_000_000,
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
        sources = cfg.get("sources") or [cfg["source"]]
        src = next(x for x in sources if x["id"] == info.get("sourceId")) if isinstance(info, dict) and info.get("sourceId") else sources[0]
        sub = subjects.setdefault(skey, {
            "key": skey, "sourceId": src["id"], "sourceSubjectId": skey.split(":", 2)[2],
            "linkageEvidence": ((info.get("linkage") if isinstance(info, dict) else None)
                                or (f"Source patient identifier {skey.split(':', 2)[2]} within {src['name']}; "
                                    "one study per subject in this pack.")),
            "holdoutGroup": (info.get("holdout") if isinstance(info, dict) and info.get("holdout") else skey), "sex": (str(ds.PatientSex) if ds.get("PatientSex") else None),
            "ageAtFirstStudy": (str(ds.PatientAge) if ds.get("PatientAge") else None), "studyUids": []})
        if st["uid"] not in sub["studyUids"]:  # one entry per study, even when it holds several series (DWI + ADC)
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
        "sources": cfg.get("sources") or [cfg["source"]], "subjects": list(subjects.values()), "studies": list(studies.values()),
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


def index(only: list[str] | None = None) -> None:
    """Upsert this script's packs (or just `only`) into public/packs/index.json; entries it does not own are kept as read."""
    from common import load_json
    idx_path = PACKS_DIR / "index.json"
    data = load_json(idx_path)
    for pid in only or PACKS:
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
        index([sys.argv[1]])
    else:
        raise SystemExit(__doc__)
