"""Fetch a small, documented selection from public non-TCIA datasets into RADIOLOGY_RAW_DIR.

  python scripts/data/external.py nih      # NIH ChestX-ray14: images that carry a radiologist bounding box
  python scripts/data/external.py fumpe    # FUMPE: CT pulmonary angiograms with radiologist PE masks
  python scripts/data/external.py breast-us | hc18 | cbis | grazpedwri | knee   # round 3: ultrasound, mammography, pediatric, knee

Every download gets a JSON sidecar (source URL, licence, sha256, selection reason). Nothing here is
written into the repository; build_external.py turns the raw files into packs.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_zip import open_remote  # noqa: E402

RAW = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw"))
BSDTAR = r"C:\Windows\System32\tar.exe"  # libarchive: reads RAR

# ------------------------------------------------------------------ NIH ChestX-ray14
NIH_DIR = RAW / "NIH-ChestXray14"
NIH_BOX = "https://nihcc.app.box.com/index.php?rm=box_download_shared_file&vanity_name=ChestXray-NIHCC&file_id=f_{}"
NIH_DATA_ENTRY_ID = "219760887468"  # Data_Entry_2017_v2020.csv on the official NIH Box share
NIH_MIRROR = "https://huggingface.co/datasets/alkzar90/NIH-Chest-X-ray-dataset/resolve/main/data"
# Radiologist boxes per condition we want, and how many different patients each.
NIH_WANT = {"Pneumothorax": 4, "Effusion": 3, "Atelectasis": 3, "Cardiomegaly": 3, "Mass": 3, "Nodule": 3, "Pneumonia": 3, "Infiltrate": 2}
# Cardiomegaly can only be judged on a PA film; for the others PA is preferred and AP accepted.
NIH_PA_ONLY = {"Cardiomegaly"}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# Final picks: ranked candidates (PA, adult, box label also in the report labels, distinct patients) were drawn
# with their boxes and reviewed by eye; kept only where the boxed abnormality is clearly visible on the image.
# Dropped after review: 00020751_003 (effusion box on the lateral wall, no visible fluid), 00018814_000 (nodule box
# over the breast/nipple shadow), 00016487_002 (retrocardiac, not visible at this size), 00018623_001 (mass box over
# half the lower chest), 00007444_003 / 00008727_009 / 00013272_005 (pneumonia too faint to teach with).
NIH_CURATED = {
    "Pneumothorax": ["00003400_003.png", "00010767_016.png", "00011355_011.png", "00013209_018.png"],
    "Effusion": ["00001437_012.png", "00013337_000.png", "00023058_004.png", "00029894_000.png"],
    "Atelectasis": ["00012299_002.png", "00016267_000.png", "00030674_000.png"],
    "Cardiomegaly": ["00000377_004.png", "00000661_000.png", "00000845_000.png"],
    "Mass": ["00001075_024.png", "00011157_001.png", "00022192_003.png"],
    "Nodule": ["00020274_021.png", "00012374_000.png", "00013673_001.png"],
    "Pneumonia": ["00001933_000.png", "00003894_005.png", "00014294_011.png"],
}


def nih_curated() -> list[dict]:
    meta = NIH_DIR / "_meta"
    boxes = list(csv.reader(open(meta / "BBox_List_2017.csv", newline="")))[1:]
    entry = {r["Image Index"]: r for r in csv.DictReader(open(meta / "Data_Entry_2017_v2020.csv", newline=""))}
    by_image = defaultdict(list)
    for r in boxes:
        by_image[r[0]].append({"label": r[1], "xywh": list(map(float, r[2:6]))})
    out, patients = [], set()
    for label, imgs in NIH_CURATED.items():
        for img in imgs:
            e = entry[img]
            assert any(b["label"] == label for b in by_image[img]) and label in e["Finding Labels"].split("|"), img
            assert e["Patient ID"] not in patients, f"patient used twice: {img}"
            patients.add(e["Patient ID"])
            out.append({"image": img, "forLabel": label, "boxes": by_image[img], "entry": e})
    return out


def nih_select() -> list[dict]:
    meta = NIH_DIR / "_meta"
    boxes = list(csv.reader(open(meta / "BBox_List_2017.csv", newline="")))[1:]
    entry = {r["Image Index"]: r for r in csv.DictReader(open(meta / "Data_Entry_2017_v2020.csv", newline=""))}
    by_image = defaultdict(list)
    for r in boxes:
        x, y, w, h = map(float, r[2:6])
        by_image[r[0]].append({"label": r[1], "xywh": [x, y, w, h]})
    chosen, patients = [], set()
    for label, n in NIH_WANT.items():
        cands = []
        for img, bs in by_image.items():
            if not any(b["label"] == label for b in bs):
                continue
            e = entry.get(img)
            if not e:
                continue
            age = int(e["Patient Age"])
            labels = e["Finding Labels"].split("|")
            view = e["View Position"]
            if not 18 <= age <= 90 or label not in labels or e["Patient ID"] in patients:
                continue
            if label in NIH_PA_ONLY and view != "PA":
                continue
            extra = [l for l in labels if l not in (label, "No Finding")]
            b = next(b for b in bs if b["label"] == label)
            area = b["xywh"][2] * b["xywh"][3]
            # cleanest teaching examples first: PA, few other labels, a box that is not tiny
            score = (0 if view == "PA" else 1, len(extra), -min(area, 200 * 200), img)
            cands.append((score, img, e))
        cands.sort()
        got = 0
        for _, img, e in cands:
            if got >= n:
                break
            if e["Patient ID"] in patients:
                continue
            patients.add(e["Patient ID"])
            chosen.append({"image": img, "forLabel": label, "boxes": by_image[img], "entry": e})
            got += 1
    return chosen


def nih_fetch() -> None:
    meta = NIH_DIR / "_meta"
    meta.mkdir(parents=True, exist_ok=True)
    if not (meta / "Data_Entry_2017_v2020.csv").exists():
        r = requests.get(NIH_BOX.format(NIH_DATA_ENTRY_ID), timeout=300)
        r.raise_for_status()
        (meta / "Data_Entry_2017_v2020.csv").write_bytes(r.content)
    if not (meta / "BBox_List_2017.csv").exists():
        r = requests.get(f"{NIH_MIRROR}/BBox_List_2017.csv", timeout=300)
        r.raise_for_status()
        (meta / "BBox_List_2017.csv").write_bytes(r.content)
    chosen = nih_curated()
    want = {c["image"] for c in chosen}
    index = meta / "zip_index.json"  # member name -> (mirror zip, member), from each zip's central directory
    where: dict[str, tuple[str, str]] = {k: tuple(v) for k, v in json.loads(index.read_text()).items() if k in want} if index.exists() else {}
    for k in range(1, 13 if len(where) < len(want) else 1):
        url = f"{NIH_MIRROR}/images/images_{k:03d}.zip"
        zf = open_remote(url)
        for info in zf.infolist():
            name = info.filename.rsplit("/", 1)[-1]
            if name in want:
                where[name] = (url, info.filename)
        if len(where) == len(want):
            break
    out = NIH_DIR / "images"
    out.mkdir(parents=True, exist_ok=True)
    zips: dict[str, object] = {}
    for c in chosen:
        url, member = where[c["image"]]
        p = out / c["image"]
        cand = NIH_DIR / "candidates" / c["image"]
        if not p.exists() and cand.exists():
            p.write_bytes(cand.read_bytes())
        if not p.exists():
            zf = zips.setdefault(url, open_remote(url))
            p.write_bytes(zf.read(member))  # zipfile verifies the member's CRC-32
        c.update({"file": str(p.relative_to(RAW)), "sha256": sha256(p), "mirrorUrl": url, "member": member})
        print(c["forLabel"].ljust(13), c["image"], c["entry"]["View Position"], c["entry"]["Patient Age"], c["entry"]["Finding Labels"])
    (meta / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ FUMPE
FUMPE_DIR = RAW / "FUMPE"
FUMPE_ARTICLES = {"PAT005": 6265379, "PAT021": 6265574, "PAT026": 6265592}
FUMPE_GT_ARTICLE = 6265721


def figshare_files(article: int) -> tuple[dict, list[dict]]:
    d = requests.get(f"https://api.figshare.com/v2/articles/{article}", timeout=60).json()
    return d, d["files"]


def fumpe_fetch(patients: list[str]) -> None:
    for pid in patients:
        d, files = figshare_files(FUMPE_ARTICLES[pid])
        dest = FUMPE_DIR / pid
        dest.mkdir(parents=True, exist_ok=True)
        f = files[0]
        rar = dest / f["name"]
        if not rar.exists() or rar.stat().st_size != f["size"]:
            with requests.get(f["download_url"], stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(rar, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
        assert hashlib.md5(rar.read_bytes()).hexdigest() == f["computed_md5"], f"md5 mismatch for {rar}"
        ex = dest / "extracted"
        if not ex.exists():
            ex.mkdir()
            subprocess.run([BSDTAR, "-xf", str(rar), "-C", str(ex)], check=True)
        (dest / "source.json").write_text(json.dumps({
            "article": FUMPE_ARTICLES[pid], "title": d["title"], "doi": d.get("doi"), "license": d["license"],
            "file": f["name"], "size": f["size"], "md5": f["computed_md5"], "downloadUrl": f["download_url"],
        }, indent=1), encoding="utf-8")
        print(pid, rar.stat().st_size, "bytes; extracted to", ex)


# ------------------------------------------------------------------ FracAtlas
FRAC_DIR = RAW / "FracAtlas"
FRAC_ZIP = "https://ndownloader.figshare.com/files/65518038"  # FracAtlas.zip, figshare article 22363012 (v7), CC BY 4.0
FRAC_REGIONS = ["hand", "leg", "hip", "shoulder"]


def frac_candidates() -> list[dict]:
    """Fractured, single fracture, no hardware, single frontal view, not part of a multi-scan set."""
    meta = FRAC_DIR / "_meta"
    rows = list(csv.DictReader(open(meta / "dataset.csv", newline="")))
    coco = json.loads((meta / "COCO_fracture_masks.json").read_text(encoding="utf-8"))
    ann = defaultdict(list)
    for a in coco["annotations"]:
        ann[a["image_id"]].append(a)
    by_name = {im["file_name"]: im for im in coco["images"]}
    out = []
    for r in rows:
        if not (r["fractured"] == "1" and r["fracture_count"] == "1" and r["hardware"] == "0" and r["multiscan"] == "0"
                and r["frontal"] == "1" and r["lateral"] == "0" and r["oblique"] == "0" and r["mixed"] == "0"):
            continue
        im = by_name.get(r["image_id"])
        if not im or len(ann[im["id"]]) != 1:
            continue
        region = next((k for k in FRAC_REGIONS if r[k] == "1"), None)
        out.append({"image": r["image_id"], "region": region, "row": r, "coco_image": im, "annotation": ann[im["id"]][0]})
    return out


def frac_fetch(names: list[str]) -> None:
    meta = FRAC_DIR / "_meta"
    meta.mkdir(parents=True, exist_ok=True)
    zf = open_remote(FRAC_ZIP)
    for m in ("FracAtlas/dataset.csv", "FracAtlas/Annotations/COCO JSON/COCO_fracture_masks.json"):
        dst = meta / m.rsplit("/", 1)[-1]
        if not dst.exists():
            dst.write_bytes(zf.read(m))
    cands = {c["image"]: c for c in frac_candidates()}
    out = FRAC_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for n in names:
        c = cands[n]
        p = out / n
        if not p.exists():
            p.write_bytes(zf.read(f"FracAtlas/images/Fractured/{n}"))  # CRC-32 checked by zipfile
        c.update({"file": str(p.relative_to(RAW)), "sha256": sha256(p)})
        chosen.append(c)
        print(c["region"], n)
    (meta / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ ISLES 2022 (stroke MRI)
ISLES_DIR = RAW / "ISLES-2022"
ISLES_ZIP = "https://zenodo.org/records/7153326/files/ISLES-2022.zip?download=1"  # Zenodo record 7153326, CC BY 4.0, open access


def isles_fetch(cases: list[str]) -> None:
    """DWI (b=1000), ADC, the lesion mask (all on one 2 mm grid) and the JSON sidecars of the given cases, read member by member."""
    zf = open_remote(ISLES_ZIP)
    chosen = []
    for c in cases:
        sub = f"sub-strokecase{int(c):04d}"
        out = ISLES_DIR / sub
        out.mkdir(parents=True, exist_ok=True)
        files = {}
        for kind, member in (("dwi", f"ISLES-2022/{sub}/ses-0001/dwi/{sub}_ses-0001_dwi.nii.gz"),
                             ("dwi_json", f"ISLES-2022/{sub}/ses-0001/dwi/{sub}_ses-0001_dwi.json"),
                             ("adc", f"ISLES-2022/{sub}/ses-0001/dwi/{sub}_ses-0001_adc.nii.gz"),
                             ("adc_json", f"ISLES-2022/{sub}/ses-0001/dwi/{sub}_ses-0001_adc.json"),
                             ("msk", f"ISLES-2022/derivatives/{sub}/ses-0001/{sub}_ses-0001_msk.nii.gz")):
            dst = out / member.rsplit("/", 1)[-1]
            if not dst.exists():
                dst.write_bytes(zf.read(member))  # CRC-32 checked by zipfile
            files[kind] = {"file": str(dst.relative_to(RAW)), "member": member, "sha256": sha256(dst)}
        chosen.append({"case": sub, "files": files})
        print(sub, "ok")
    (ISLES_DIR / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")



# ------------------------------------------------------------------ Breast-Lesions-USG (TCIA, PNG + masks, CC BY 4.0)
BREAST_DIR = RAW / "BrEaST"
BREAST_ZIP = "https://www.cancerimagingarchive.net/wp-content/uploads/BrEaST-Lesions_USG-images_and_masks-Dec-15-2023.zip"
BREAST_XLSX = "https://www.cancerimagingarchive.net/wp-content/uploads/BrEaST-Lesions-USG-clinical-data-Dec-15-2023.xlsx"
# Chosen by eye with the radiologist's mask drawn (all verified by biopsy or follow-up per the source):
# 7, 13 invasive carcinoma NST (irregular, spiculated/angular, shadowing, BI-RADS 5); 68, 25 fibroadenoma (oval, circumscribed);
# 48, 237 simple cyst (anechoic, posterior enhancement in 48). Each case is a different patient (one scan per patient in BrEaST).
BREAST_CASES = [7, 13, 68, 25, 48, 237]


def breast_fetch() -> None:
    import zipfile
    import pandas as pd
    BREAST_DIR.mkdir(parents=True, exist_ok=True)
    for url, name in ((BREAST_ZIP, "images_and_masks.zip"), (BREAST_XLSX, "clinical.xlsx")):
        p = BREAST_DIR / name
        if not p.exists():
            r = requests.get(url, timeout=600)
            r.raise_for_status()
            p.write_bytes(r.content)
    d = pd.read_excel(BREAST_DIR / "clinical.xlsx")
    z = zipfile.ZipFile(BREAST_DIR / "images_and_masks.zip")
    out = BREAST_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for cid in BREAST_CASES:
        row = {k: (None if (isinstance(v, float) and v != v) else (v.item() if hasattr(v, "item") else v)) for k, v in d[d.CaseID == cid].iloc[0].to_dict().items()}
        files = {}
        for kind, fname in (("image", row["Image_filename"]), ("tumor", row["Mask_tumor_filename"])):
            dst = out / fname
            if not dst.exists():
                dst.write_bytes(z.read(f"BrEaST-Lesions_USG-images_and_masks/{fname}"))  # CRC-32 checked by zipfile
            files[kind] = {"file": str(dst.relative_to(RAW)), "sha256": sha256(dst)}
        chosen.append({"case": cid, "row": row, "files": files})
        print(cid, row["Diagnosis"], row["BIRADS"])
    (BREAST_DIR / "selection.json").write_text(json.dumps({"zip": BREAST_ZIP, "zipSha256": sha256(BREAST_DIR / "images_and_masks.zip"),
                                                            "xlsx": BREAST_XLSX, "cases": chosen}, indent=1, default=str), encoding="utf-8")


# ------------------------------------------------------------------ HC18 fetal head circumference (Zenodo 1327317, CC BY 4.0)
HC18_DIR = RAW / "HC18"
HC18_ZIP = "https://zenodo.org/records/1327317/files/training_set.zip?download=1"
HC18_CSV = "https://zenodo.org/records/1327317/files/training_set_pixel_size_and_HC.csv?download=1"
# Three heads across gestation, chosen by eye with the sonographer's ellipse drawn (it follows the outer skull).
HC18_IMAGES = ["113_HC.png", "365_HC.png", "687_HC.png"]


def hc18_fetch() -> None:
    HC18_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = HC18_DIR / "training_set_pixel_size_and_HC.csv"
    if not csv_path.exists():
        r = requests.get(HC18_CSV, timeout=120)
        r.raise_for_status()
        csv_path.write_bytes(r.content)
    meta = {r["filename"]: r for r in csv.DictReader(open(csv_path, newline=""))}
    zf = open_remote(HC18_ZIP)
    out = HC18_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for f in HC18_IMAGES:
        files = {}
        for kind, name in (("image", f), ("annotation", f.replace(".png", "_Annotation.png"))):
            dst = out / name
            if not dst.exists():
                dst.write_bytes(zf.read(f"training_set/{name}"))  # CRC-32 checked by zipfile
            files[kind] = {"file": str(dst.relative_to(RAW)), "sha256": sha256(dst)}
        chosen.append({"image": f, "pixelSizeMm": float(meta[f]["pixel size(mm)"]), "hcMm": float(meta[f]["head circumference (mm)"]), "files": files})
        print(f, meta[f]["pixel size(mm)"], meta[f]["head circumference (mm)"])
    (HC18_DIR / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ CBIS-DDSM (TCIA NBIA, CC BY 3.0)
CBIS_DIR = RAW / "CBIS-DDSM"
CBIS_CSV = "https://www.cancerimagingarchive.net/wp-content/uploads/{}.csv"
# (csv, patient, breast): both views (CC and MLO) of each breast, one abnormality per view, chosen from the description
# CSVs for obvious, typical examples and then checked by eye with the ROI drawn. P_00021 has both breasts (a full 4-view set).
CBIS_BREASTS = [
    ("mass_case_description_train_set", "P_00021", "LEFT"), ("mass_case_description_train_set", "P_00021", "RIGHT"),
    ("mass_case_description_train_set", "P_00039", "RIGHT"), ("mass_case_description_train_set", "P_00051", "LEFT"),
    ("calc_case_description_train_set", "P_00307", "LEFT"), ("calc_case_description_train_set", "P_00425", "RIGHT"),
]
# Rejected after looking at the films: P_00063 (its CC film marker reads "R CC EXT", not a standard CC view), P_00480
# (the LCC film marker is mirrored/reversed, so the image orientation cannot be trusted) and P_00674 (the outlined
# calcification is a single small dot, too small to teach from at web resolution).


def cbis_rows() -> list[dict]:
    out = []
    for csv_name, pid, side in CBIS_BREASTS:
        rows = [r for r in csv.DictReader(open(CBIS_DIR / "_meta" / f"{csv_name}.csv", newline=""))
                if r["patient_id"] == pid and r["left or right breast"] == side]
        assert sorted(r["image view"] for r in rows) == ["CC", "MLO"], (pid, side, [r["image view"] for r in rows])
        out += [{**r, "csv": csv_name} for r in rows]
    return out


def cbis_fetch() -> None:
    import tcia
    meta = CBIS_DIR / "_meta"
    meta.mkdir(parents=True, exist_ok=True)
    for name in ("mass_case_description_train_set", "calc_case_description_train_set"):
        if not (meta / f"{name}.csv").exists():
            r = requests.get(CBIS_CSV.format(name), timeout=120)
            r.raise_for_status()
            (meta / f"{name}.csv").write_bytes(r.content)
    chosen = []
    for r in cbis_rows():
        full_pid, full_series = r["image file path"].split("/")[0], r["image file path"].split("/")[2]
        roi_pid, roi_series = r["ROI mask file path"].split("/")[0], r["ROI mask file path"].strip().split("/")[2]
        zf = tcia.download_series("CBIS-DDSM", full_pid, full_series)
        zr = tcia.download_series("CBIS-DDSM", roi_pid, roi_series)
        chosen.append({**r, "fullZip": str(zf.relative_to(RAW)), "roiZip": str(zr.relative_to(RAW))})
        print(r["patient_id"], r["left or right breast"], r["image view"], r.get("pathology"))
    (CBIS_DIR / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ GRAZPEDWRI-DX (figshare, CC BY 4.0)
GRAZ_DIR = RAW / "GRAZPEDWRI-DX"
GRAZ_ARTICLE = 14825193
# Both views (frontal 1, lateral 2) of the first study of four children, chosen from dataset.csv (one fracture box, AO
# PCCF 23r-E/2.1 = Salter-Harris II or 23r-M/2.1 = incomplete metaphyseal) and then checked by eye with the box drawn.
GRAZ_STEMS = [
    "3390_0758877097_01_WRI-L1_F013", "3390_0758877130_01_WRI-L2_F013", "3853_1028283544_01_WRI-L1_M014", "3853_1028283630_01_WRI-L2_M014",
    "0030_0853281724_01_WRI-L1_F008", "0030_0853281744_01_WRI-L2_F008", "0071_0678614107_01_WRI-R1_F009", "0071_0678614151_01_WRI-R2_F009",
]


def graz_fetch() -> None:
    meta = GRAZ_DIR / "_meta"
    meta.mkdir(parents=True, exist_ok=True)
    d, files = figshare_files(GRAZ_ARTICLE)
    (meta / "article.json").write_text(json.dumps(d, indent=1), encoding="utf-8")
    by_name = {f["name"]: f for f in files}
    for name in ("dataset.csv", "folder_structure.zip"):  # folder_structure.zip holds the annotations
        f = by_name[name]
        if not (meta / name).exists() or (meta / name).stat().st_size != f["size"]:
            r = requests.get(f["download_url"], timeout=600)
            r.raise_for_status()
            (meta / name).write_bytes(r.content)
        assert hashlib.md5((meta / name).read_bytes()).hexdigest() == f["computed_md5"], name
    idx_path = meta / "zip_index.json"  # image stem -> (images_partN.zip URL, member); central directories only
    if not idx_path.exists():
        idx = {}
        for name in sorted(n for n in by_name if n.startswith("images_part")):
            url = by_name[name]["download_url"]
            for m in open_remote(url).namelist():
                if m.endswith(".png"):
                    idx[m.rsplit("/", 1)[-1][:-4]] = [url, m]
        idx_path.write_text(json.dumps(idx), encoding="utf-8")
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    out = GRAZ_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for stem in GRAZ_STEMS:
        url, member = idx[stem]
        dst = out / f"{stem}.png"
        if not dst.exists():
            dst.write_bytes(open_remote(url).read(member))  # CRC-32 checked by zipfile
        chosen.append({"stem": stem, "file": str(dst.relative_to(RAW)), "sha256": sha256(dst), "zipUrl": url, "member": member})
        print(stem, dst.stat().st_size)
    (GRAZ_DIR / "selection.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ Digital Knee X-ray Images (Mendeley Data, CC BY 4.0)
KNEE_DIR = RAW / "Knee-KL-Gornale"
KNEE_API = "https://data.mendeley.com/public-api/datasets/t9ndx37v5h"


def knee_fetch() -> None:
    """Both experts' archives; match.json pairs the same image across them by pixel hash with each expert's grade folder."""
    import numpy as np
    from PIL import Image
    KNEE_DIR.mkdir(parents=True, exist_ok=True)
    d = requests.get(KNEE_API, timeout=60).json()
    assert d["data_licence"]["short_name"] == "CC BY 4.0", d["data_licence"]
    for f in d["files"]:
        rar = KNEE_DIR / f["filename"]
        if not rar.exists() or sha256(rar) != f["content_details"]["sha256_hash"]:
            with requests.get(f["content_details"]["download_url"], stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(rar, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
        assert sha256(rar) == f["content_details"]["sha256_hash"], rar
        if not (KNEE_DIR / rar.stem).exists():
            subprocess.run([BSDTAR, "-xf", str(rar), "-C", str(KNEE_DIR)], check=True)
    seen: dict[str, dict] = {}
    for expert in ("I", "II"):
        for p in sorted((KNEE_DIR / f"MedicalExpert-{expert}").glob("*/*.png")):
            a = np.asarray(Image.open(p))
            h = hashlib.sha256(a.tobytes() + str(a.shape).encode()).hexdigest()
            e = seen.setdefault(h, {"shape": list(a.shape)})
            e[expert], e[f"g{expert}"] = str(p.relative_to(KNEE_DIR)), p.parent.name
    match = {h: e for h, e in seen.items() if "I" in e and "II" in e}
    (KNEE_DIR / "match.json").write_text(json.dumps(match), encoding="utf-8")
    print(len(match), "images in both archives;", sum(e["gI"] == e["gII"] for e in match.values()), "with the same grade")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    if what in ("breast-us", "hc18", "cbis", "grazpedwri", "knee"):
        {"breast-us": breast_fetch, "hc18": hc18_fetch, "cbis": cbis_fetch, "grazpedwri": graz_fetch, "knee": knee_fetch}[what]()
        raise SystemExit(0)
    if what == "isles":
        isles_fetch(sys.argv[2:])
        raise SystemExit(0)
    if what == "nih":
        nih_fetch()
    elif what == "fracatlas":
        frac_fetch(sys.argv[2:])
    elif what == "fumpe":
        fumpe_fetch(sys.argv[2:] or list(FUMPE_ARTICLES))
    else:
        raise SystemExit(__doc__)
