"""Shared helpers for the pack pipeline (paths, JSON, DICOM value coercion, geometry)."""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np

REPO = Path(__file__).resolve().parents[2]
PACKS_DIR = REPO / "public" / "packs"
DOCS_DIR = REPO / "docs" / "data"
SELECTION = Path(__file__).resolve().parent / "selection.json"

UID_NAMES = {
    "1.2.840.10008.1.2": "Implicit VR Little Endian",
    "1.2.840.10008.1.2.1": "Explicit VR Little Endian",
    "1.2.840.10008.1.2.1.99": "Deflated Explicit VR Little Endian",
    "1.2.840.10008.1.2.2": "Explicit VR Big Endian",
    "1.2.840.10008.1.2.4.50": "JPEG Baseline (lossy)",
    "1.2.840.10008.1.2.4.57": "JPEG Lossless P14",
    "1.2.840.10008.1.2.4.70": "JPEG Lossless SV1",
    "1.2.840.10008.1.2.4.80": "JPEG-LS Lossless",
    "1.2.840.10008.1.2.4.81": "JPEG-LS Near-Lossless (lossy)",
    "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
    "1.2.840.10008.1.2.4.91": "JPEG 2000 (possibly lossy)",
    "1.2.840.10008.1.2.5": "RLE Lossless",
}
LOSSY_TS = {"1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51", "1.2.840.10008.1.2.4.81",
            "1.2.840.10008.1.2.4.91"}


def load_json(p: Path) -> Any:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def dump_json(obj: Any, p: Path, indent: int | None = 1) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, indent=indent, ensure_ascii=False, allow_nan=False)
    p.write_text(txt + "\n", encoding="utf-8")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def series_short_id(modality: str, series_uid: str) -> str:
    return f"{modality.lower()}-{hashlib.sha1(series_uid.encode()).hexdigest()[:10]}"


def slug(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s.strip().lower()).strip("-")
    return s or "x"


def dicom_date(v: Any) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    if len(s) >= 8 and s[:8].isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return None


def jsonable(v: Any) -> str | float | int | list[str] | None:
    """Coerce a pydicom element value into the acquisition record value union."""
    from pydicom.multival import MultiValue
    from pydicom.valuerep import DSfloat, IS, PersonName
    if v is None:
        return None
    if isinstance(v, (MultiValue, list, tuple)):
        return [str(x) for x in v]
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (DSfloat, float)):
        f = float(v)
        return f if math.isfinite(f) else str(v)
    if isinstance(v, (IS, int, np.integer)):
        return int(v)
    if isinstance(v, PersonName):
        return str(v)
    if isinstance(v, bytes):
        return None
    s = str(v).strip()
    return s if s != "" else None


def fnum(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------- geometry ----------------

def basis(iop) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r = np.asarray([float(x) for x in iop[:3]])
    c = np.asarray([float(x) for x in iop[3:6]])
    n = np.cross(r, c)
    nn = np.linalg.norm(n)
    return r, c, (n / nn if nn else n)


def patient_to_px(p, ipp, iop, ps) -> tuple[float, float, float]:
    """LPS mm -> (col, row, out_of_plane_mm). ps = PixelSpacing [row_spacing, col_spacing]."""
    r, c, n = basis(iop)
    d = np.asarray(p, float) - np.asarray(ipp, float)
    return float(d @ r / float(ps[1])), float(d @ c / float(ps[0])), float(d @ n)


def px_to_patient(col: float, row: float, ipp, iop, ps) -> np.ndarray:
    r, c, _ = basis(iop)
    return np.asarray(ipp, float) + col * float(ps[1]) * r + row * float(ps[0]) * c


def r2(x: float, nd: int = 2) -> float:
    v = round(float(x), nd)
    return 0.0 if v == 0 else v
