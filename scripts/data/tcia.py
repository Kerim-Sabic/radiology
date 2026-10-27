"""Minimal anonymous client for the TCIA NBIA REST API (v1).

Only official TCIA routes are used:
  https://services.cancerimagingarchive.net/nbia-api/services/v1/<endpoint>

Raw downloads are stored OUTSIDE the repo (default C:/Users/kerim/radiology-data/raw,
override with RADIOLOGY_RAW_DIR) as the zip returned by getImage, plus a JSON
sidecar recording the getSeries row, getSeriesSize result, zip sha256 and the
verified member count. The pack builder reads DICOM members straight from the zip
(no extraction to disk), which halves the raw disk footprint.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Iterator

import requests

BASE = "https://services.cancerimagingarchive.net/nbia-api/services/v1"
RAW_ROOT = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw"))
USER_AGENT = "radiology-learning-pack-builder/1 (+personal educational use; python-requests)"

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        s.headers["User-Agent"] = USER_AGENT
        _session = s
    return _session


def log(*a: Any) -> None:
    print(*a, file=sys.stderr, flush=True)


def get_json(endpoint: str, retries: int = 5, timeout: float = 120, **params: Any) -> Any:
    """GET an NBIA endpoint returning JSON, with retry/backoff. Empty body -> []."""
    url = f"{BASE}/{endpoint}"
    params = {k: v for k, v in params.items() if v is not None}
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = session().get(url, params=params, timeout=timeout)
            if r.status_code == 200:
                if not r.content.strip():
                    return []
                return r.json()
            if r.status_code in (204,):
                return []
            last = RuntimeError(f"HTTP {r.status_code} for {r.url}: {r.text[:200]}")
            if 400 <= r.status_code < 500 and r.status_code != 429:
                raise last
        except (requests.ConnectionError, requests.Timeout, ValueError) as e:
            last = e
        time.sleep(min(60, 2 ** attempt * 2))
    raise RuntimeError(f"{endpoint} failed after {retries} attempts: {last}")


def get_series(collection: str | None = None, patient_id: str | None = None,
               study_uid: str | None = None, modality: str | None = None,
               series_uid: str | None = None) -> list[dict]:
    return get_json("getSeries", Collection=collection, PatientID=patient_id,
                    StudyInstanceUID=study_uid, Modality=modality,
                    SeriesInstanceUID=series_uid)


def get_patient(collection: str) -> list[dict]:
    return get_json("getPatient", Collection=collection)


def get_patient_study(collection: str | None = None, patient_id: str | None = None,
                      study_uid: str | None = None) -> list[dict]:
    return get_json("getPatientStudy", Collection=collection, PatientID=patient_id,
                    StudyInstanceUID=study_uid)


def get_series_size(series_uid: str) -> dict:
    res = get_json("getSeriesSize", SeriesInstanceUID=series_uid)
    if isinstance(res, list):
        res = res[0] if res else {}
    return {"TotalSizeInBytes": float(res.get("TotalSizeInBytes", 0)),
            "ObjectCount": int(float(res.get("ObjectCount", 0)))}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_paths(collection: str, patient_id: str, series_uid: str) -> tuple[Path, Path]:
    d = RAW_ROOT / collection / patient_id
    return d / f"{series_uid}.zip", d / f"{series_uid}.json"


def _dicom_members(zf: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    out = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename.lower()
        if name.endswith(".dcm"):
            out.append(info)
            continue
        # Some NBIA zips carry DICOM without extension; sniff the DICM preamble.
        if not name.endswith((".txt", ".xml", ".json", ".csv", ".pdf", "license")):
            with zf.open(info) as fh:
                head = fh.read(132)
            if len(head) == 132 and head[128:132] == b"DICM":
                out.append(info)
    return out


def verify_zip(zip_path: Path, expected_count: int | None) -> tuple[bool, str, int]:
    try:
        with zipfile.ZipFile(zip_path) as zf:
            bad = zf.testzip()
            if bad is not None:
                return False, f"corrupt member {bad}", 0
            n = len(_dicom_members(zf))
    except zipfile.BadZipFile as e:
        return False, f"bad zip: {e}", 0
    if expected_count is not None and n != expected_count:
        return False, f"member count {n} != getSeriesSize ObjectCount {expected_count}", n
    return True, "ok", n


def download_series(collection: str, patient_id: str, series_uid: str,
                    series_row: dict | None = None, retries: int = 4) -> Path:
    """Resumable download of one series via getImage. Skips when the zip exists and
    its sha256 matches the sidecar (and the sidecar recorded a verified count)."""
    zip_path, meta_path = raw_paths(collection, patient_id, series_uid)
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("verified") and meta.get("sha256") == sha256_file(zip_path):
            log(f"  [skip] {series_uid} already present, sha256 ok")
            return zip_path
        log(f"  [redo] {series_uid}: sidecar/sha mismatch")
    size = get_series_size(series_uid)
    if series_row is None:
        rows = get_series(series_uid=series_uid)
        series_row = rows[0] if rows else {}
    tmp = zip_path.with_suffix(".part")
    last = None
    for attempt in range(retries):
        try:
            with session().get(f"{BASE}/getImage", params={"SeriesInstanceUID": series_uid},
                               stream=True, timeout=(30, 600)) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            ok, why, n = verify_zip(tmp, size["ObjectCount"] or None)
            if not ok:
                raise RuntimeError(why)
            os.replace(tmp, zip_path)
            meta = {
                "collection": collection, "patientId": patient_id, "seriesInstanceUid": series_uid,
                "source": f"{BASE}/getImage?SeriesInstanceUID={series_uid}",
                "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "zipBytes": zip_path.stat().st_size, "sha256": sha256_file(zip_path),
                "dicomMembers": n, "seriesSize": size, "seriesRow": series_row, "verified": True,
            }
            meta_path.write_text(json.dumps(meta, indent=1))
            log(f"  [ok] {series_uid}: {n} DICOM, {meta['zipBytes']/1e6:.1f} MB zip")
            return zip_path
        except Exception as e:  # noqa: BLE001
            last = e
            log(f"  [retry {attempt+1}] {series_uid}: {e}")
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError(f"download failed for {series_uid}: {last}")


def iter_zip_dicom_bytes(zip_path: Path) -> Iterator[tuple[str, bytes]]:
    with zipfile.ZipFile(zip_path) as zf:
        for info in _dicom_members(zf):
            yield info.filename, zf.read(info)


def read_zip_datasets(zip_path: Path, stop_before_pixels: bool = False):
    import pydicom
    for name, data in iter_zip_dicom_bytes(zip_path):
        ds = pydicom.dcmread(io.BytesIO(data), stop_before_pixels=stop_before_pixels)
        yield name, data, ds


if __name__ == "__main__":
    # tiny CLI for exploration: python tcia.py getSeries Collection=LCTSC PatientID=...
    ep = sys.argv[1]
    kw = dict(a.split("=", 1) for a in sys.argv[2:])
    print(json.dumps(get_json(ep, **kw), indent=1))
