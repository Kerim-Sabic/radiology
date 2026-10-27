"""Shared paths, constants and geometry helpers for the vessel-draft pipeline.

Everything here is OFFLINE tooling. Outputs are unreviewed AI drafts (provenance
"ai_draft"); nothing in this folder claims human review.

Run every script with the isolated TotalSegmentator venv interpreter, e.g.
  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/vessels/<script>.py
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
PACKS_DIR = REPO / "public" / "packs"
CHEST_PACK = PACKS_DIR / "chest-pairs"
# Image packs scanned for candidate CTs (targets resolve across packs by series UID in the app).
SOURCE_PACKS = ["chest-pairs", "body"]
OUT_PACK = REPO / "public" / "packs" / "vessel-drafts"
REPORT_MD = REPO / "docs" / "data" / "vessel-drafts-report.md"

# Scratch space lives OUTSIDE OneDrive / the repo (large NIfTI volumes and masks).
DATA_ROOT = Path(os.environ.get("RADIOLOGY_DATA_DIR", "C:/Users/kerim/radiology-data"))
WORK = Path(os.environ.get("RADIOLOGY_VESSELS_WORK", DATA_ROOT / "work" / "vessels"))
VENV = Path(os.environ.get("RADIOLOGY_TS_VENV", DATA_ROOT / "venv-ts"))
TOTALSEG_HOME = Path(os.environ.get("TOTALSEG_HOME_DIR", DATA_ROOT / "totalseg-home"))

TASK = "total"  # TotalSegmentator v2 "total" task (open weights, no licence needed)

# Classes requested with --roi_subset. Names verified against
# totalsegmentator/map_to_binary.py class_map["total"] of the installed version.
# ("pulmonary_artery" is NOT a class of the v2 "total" task; it only exists in the
# licence-restricted "heartchambers_highres" task, so it is not requested.)
ROI_SUBSET = [
    "brachiocephalic_vein_left",
    "brachiocephalic_vein_right",
    "brachiocephalic_trunk",
    "common_carotid_artery_left",
    "common_carotid_artery_right",
    "subclavian_artery_left",
    "subclavian_artery_right",
    "aorta",
    "superior_vena_cava",
    "trachea",
    "esophagus",
]

FIVE_VESSELS = [
    "brachiocephalic_vein_right",
    "brachiocephalic_vein_left",
    "brachiocephalic_trunk",
    "common_carotid_artery_left",
    "subclavian_artery_left",
]

LABELS = {
    "brachiocephalic_vein_left": "Left brachiocephalic vein",
    "brachiocephalic_vein_right": "Right brachiocephalic vein",
    "brachiocephalic_trunk": "Brachiocephalic (innominate) artery",
    "common_carotid_artery_left": "Left common carotid artery",
    "common_carotid_artery_right": "Right common carotid artery",
    "subclavian_artery_left": "Left subclavian artery",
    "subclavian_artery_right": "Right subclavian artery",
    "aorta": "Aorta",
    "superior_vena_cava": "Superior vena cava",
    "trachea": "Trachea",
    "esophagus": "Oesophagus",
}

# Laterality pairs checked slice-by-slice: (structure expected on patient LEFT, structure expected on patient RIGHT).
# LPS x increases towards patient left, so centroid_x(left) must exceed centroid_x(right) on every shared slice.
LATERALITY_PAIRS = [
    ("brachiocephalic_vein_left", "brachiocephalic_vein_right"),
    ("subclavian_artery_left", "brachiocephalic_trunk"),
    ("common_carotid_artery_left", "brachiocephalic_trunk"),
    ("common_carotid_artery_left", "common_carotid_artery_right"),
    ("subclavian_artery_left", "subclavian_artery_right"),
    ("subclavian_artery_left", "common_carotid_artery_right"),
    ("common_carotid_artery_left", "subclavian_artery_right"),
]

MIN_AREA_MM2 = 10.0  # a structure counts as "present" on a slice only with >= 10 mm^2 of mask
MIN_COMPONENT_PX = 4  # 2D connected components smaller than this are dropped from contours (specks)
SIMPLIFY_TOL_PX = 0.35  # skimage.measure.approximate_polygon tolerance (pixels)


def case_short(subject_key: str) -> str:
    sid = subject_key.split(":")[-1]
    m = re.match(r"COVID-19-AR-(\d+)$", sid)
    if m:
        return f"ar-{m.group(1)}"
    m = re.match(r"LIDC-IDRI-(\d+)$", sid)
    if m:
        return f"lidc-{m.group(1)}"
    return re.sub(r"[^a-z0-9]+", "-", sid.lower()).strip("-")


def slug(name: str) -> str:
    return name.replace("_", "-")


def load_json(p: Path):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump_json(obj, p: Path, indent=1):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False)
        f.write("\n")


def dump_json_compact(obj, p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")


def chest_manifest():
    return load_json(CHEST_PACK / "pack.json")


def source_manifests():
    """[(packId, packRoot, manifest)] for every SOURCE_PACKS pack that is built on disk."""
    out = []
    for pid in SOURCE_PACKS:
        root = PACKS_DIR / pid
        if (root / "pack.json").exists():
            out.append((pid, root, load_json(root / "pack.json")))
    return out


def series_index():
    """series UID -> (packId, packRoot, series dict) across SOURCE_PACKS."""
    return {se["uid"]: (pid, root, se) for pid, root, m in source_manifests() for se in m["series"]}


def case_dir(case: str) -> Path:
    return WORK / case


def slice_normal(iop) -> np.ndarray:
    r = np.asarray(iop[:3], float)
    c = np.asarray(iop[3:], float)
    n = np.cross(r, c)
    return n / np.linalg.norm(n)


def dicom_pixel_to_lps(ipp, iop, pixel_spacing, col, row) -> np.ndarray:
    """DICOM PS3.3 C.7.6.2.1.1: P = IPP + col*dc*X + row*dr*Y, where X = IOP[0:3] (row direction,
    i.e. increasing column index), Y = IOP[3:6] (column direction, increasing row index),
    dc = PixelSpacing[1] (column spacing), dr = PixelSpacing[0] (row spacing). (0,0) = centre of first pixel."""
    ipp = np.asarray(ipp, float)
    X = np.asarray(iop[:3], float)
    Y = np.asarray(iop[3:], float)
    return ipp + col * float(pixel_spacing[1]) * X + row * float(pixel_spacing[0]) * Y


RAS_TO_LPS = np.diag([-1.0, -1.0, 1.0, 1.0])
