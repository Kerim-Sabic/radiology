"""Shared paths, class metadata and geometry helpers for the anatomy-atlas pipeline.

OFFLINE tooling. Every output is an unreviewed AI draft (provenance "ai_draft", layer "atlas").
Run CT scripts with the TotalSegmentator venv and CXR scripts with the torchxrayvision venv (see README.md).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
PACKS_DIR = REPO / "public" / "packs"
OUT_PACK = PACKS_DIR / "anatomy-atlas"
REPORT_MD = REPO / "docs" / "data" / "anatomy-atlas-report.md"

DATA_ROOT = Path(os.environ.get("RADIOLOGY_DATA_DIR", "C:/Users/kerim/radiology-data"))
WORK = Path(os.environ.get("RADIOLOGY_ATLAS_WORK", DATA_ROOT / "work" / "atlas"))
VENV_TS = Path(os.environ.get("RADIOLOGY_TS_VENV", DATA_ROOT / "venv-ts"))
TOTALSEG_HOME = Path(os.environ.get("TOTALSEG_HOME_DIR", DATA_ROOT / "totalseg-home"))

# Image packs scanned (in this order). more-ct-xr is picked up automatically once it is built.
SOURCE_PACKS = ["starter", "chest-pairs", "body", "expansion", "ct-mri-pairs", "neuro-msk", "more-ct-xr"]

# Geometry simplification / filtering (shared by CT and CXR)
DP_TOL_PX = 0.5          # Douglas-Peucker tolerance (skimage.measure.approximate_polygon), image pixels (radiographs)
CT_DP_TOL_PX = 1.0       # CT: raised from 0.5 to 1.0 px to keep the pack < 60 MB (borders move <= 1 pixel)
MIN_RING_AREA_PX2 = 6.0  # rings (outer or hole) with smaller shoelace area are dropped
MIN_COMPONENT_PX = 6     # 2D connected components smaller than this are dropped before tracing


def load_json(p: Path):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump_json(obj, p: Path, indent=1):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False)
        f.write("\n")


def _compact(o):
    if isinstance(o, float):
        r = round(o, 2)
        return int(r) if r == int(r) else r
    if isinstance(o, list):
        return [_compact(v) for v in o]
    if isinstance(o, dict):
        return {k: _compact(v) for k, v in o.items()}
    return o


def dump_json_compact(obj, p: Path):
    """Minified JSON; floats rounded to 0.01 and written as ints when integral (coordinates are mostly k/2)."""
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(_compact(obj), f, separators=(",", ":"), ensure_ascii=False)


def source_manifests():
    out = []
    for pid in SOURCE_PACKS:
        root = PACKS_DIR / pid
        if (root / "pack.json").exists():
            out.append((pid, root, load_json(root / "pack.json")))
    return out


def series_index():
    return {se["uid"]: (pid, root, se) for pid, root, m in source_manifests() for se in m["series"]}


def subject_short(subject_key: str) -> str:
    sid = subject_key.split(":")[-1]
    coll = subject_key.split(":")[1] if subject_key.count(":") >= 2 else ""
    m = re.match(r"COVID-19-AR-(\d+)$", sid)
    if m:
        return f"ar-{m.group(1)}"
    m = re.match(r"LIDC-IDRI-(\d+)$", sid)
    if m:
        return f"lidc-{m.group(1)}"
    if coll == "Spine-Mets-CT-SEG":
        return f"spinemets-{sid}"
    s = re.sub(r"[^a-z0-9]+", "-", sid.lower()).strip("-")
    return s


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def slice_normal(iop) -> np.ndarray:
    r = np.asarray(iop[:3], float)
    c = np.asarray(iop[3:], float)
    n = np.cross(r, c)
    return n / np.linalg.norm(n)


def dicom_pixel_to_lps(ipp, iop, pixel_spacing, col, row):
    """P = IPP + col*PixelSpacing[1]*IOP[0:3] + row*PixelSpacing[0]*IOP[3:6]; (0,0) = centre of first pixel."""
    ipp = np.asarray(ipp, float)
    X = np.asarray(iop[:3], float)
    Y = np.asarray(iop[3:], float)
    return ipp + np.multiply.outer(col, float(pixel_spacing[1]) * X) + np.multiply.outer(row, float(pixel_spacing[0]) * Y)


RAS_TO_LPS = np.diag([-1.0, -1.0, 1.0, 1.0])


def ring_area(ring) -> float:
    a = np.asarray(ring, float)
    x, y = a[:, 0], a[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


# ---------------------------------------------------------------- class metadata
SPECIAL_LABELS = {
    "esophagus": "Esophagus", "trachea": "Trachea", "thyroid_gland": "Thyroid gland", "small_bowel": "Small bowel",
    "urinary_bladder": "Urinary bladder", "costal_cartilages": "Costal cartilages", "spinal_cord": "Spinal cord",
    "pulmonary_vein": "Pulmonary veins", "portal_vein_and_splenic_vein": "Portal and splenic veins",
    "brachiocephalic_trunk": "Brachiocephalic trunk", "superior_vena_cava": "Superior vena cava",
    "inferior_vena_cava": "Inferior vena cava", "sacrum": "Sacrum", "skull": "Skull", "sternum": "Sternum",
    # chest radiograph classes
    "lung_left": "Left lung", "lung_right": "Right lung", "hilum_left": "Left hilum", "hilum_right": "Right hilum",
    "diaphragm": "Diaphragm (domes)", "mediastinum": "Mediastinum", "spine": "Spine",
}
WORD = {"clavicula": "clavicle", "hip": "hip bone", "iliac_vena": "common iliac vein", "iliac_artery": "common iliac artery",
        "autochthon": "autochthonous back muscles (erector spinae)", "kidney_cyst": "kidney cyst",
        "atrial_appendage": "atrial appendage", "adrenal_gland": "adrenal gland",
        "common_carotid_artery": "common carotid artery", "subclavian_artery": "subclavian artery",
        "brachiocephalic_vein": "brachiocephalic vein", "gluteus_maximus": "gluteus maximus",
        "gluteus_medius": "gluteus medius", "gluteus_minimus": "gluteus minimus"}
LOBE = {"lung_upper_lobe": "upper lobe", "lung_middle_lobe": "middle lobe", "lung_lower_lobe": "lower lobe"}


def human_label(name: str) -> str:
    if name in SPECIAL_LABELS:
        return SPECIAL_LABELS[name]
    m = re.match(r"rib_(left|right)_(\d+)$", name)
    if m:
        return f"Rib {m.group(2)} {m.group(1)}"
    m = re.match(r"vertebrae_([CTLS]\d+)$", name)
    if m:
        return f"{m.group(1)} vertebra"
    m = re.match(r"(.+)_(left|right)$", name)
    if m:
        base, side = m.group(1), m.group(2)
        if base in LOBE:
            return f"{side.capitalize()} {LOBE[base]}"
        return f"{side.capitalize()} {WORD.get(base, base.replace('_', ' '))}"
    return name.replace("_", " ").capitalize()


BONE_RE = re.compile(r"^(vertebrae_|rib_|sacrum$|sternum$|costal_cartilages$|humerus_|scapula_|clavicula_|femur_|hip_|skull$|spine$)")
VESSEL = {"aorta", "aorta_ascending", "aorta_arch", "aorta_descending_thoracic", "aorta_abdominal", "pulmonary_artery", "pulmonary_vein", "brachiocephalic_trunk", "superior_vena_cava", "inferior_vena_cava",
          "portal_vein_and_splenic_vein"}
VESSEL_RE = re.compile(r"^(subclavian_artery_|common_carotid_artery_|brachiocephalic_vein_|iliac_artery_|iliac_vena_)")
MUSCLE_RE = re.compile(r"^(gluteus_|autochthon_|iliopsoas_|diaphragm$)")
GLAND = {"thyroid_gland", "adrenal_gland_left", "adrenal_gland_right", "prostate"}
AIRWAY = {"trachea", "main_bronchus_left", "main_bronchus_right"}
OTHER = {"kidney_cyst_left", "kidney_cyst_right", "spinal_cord", "mediastinum", "hilum_left", "hilum_right"}


def category(name: str) -> str:
    if BONE_RE.match(name):
        return "bone"
    if name in VESSEL or VESSEL_RE.match(name):
        return "vessel"
    if MUSCLE_RE.match(name):
        return "muscle"
    if name in GLAND:
        return "gland"
    if name in AIRWAY:
        return "airway"
    if name in OTHER:
        return "other"
    return "organ"


def laterality_pairs(names) -> list[tuple[str, str]]:
    """(left, right) pairs among the given class names, plus unpaired organs with a fixed side."""
    s = set(names)
    pairs = []
    for n in sorted(s):
        if "left" in n:
            r = n.replace("left", "right")
            if r in s:
                pairs.append((n, r))
    for l, r in [("spleen", "liver"), ("aorta", "inferior_vena_cava"), ("stomach", "liver")]:
        if l in s and r in s:
            pairs.append((l, r))
    return pairs
