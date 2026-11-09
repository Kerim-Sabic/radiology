"""Range reads from the TotalSegmentator CT v3.0.0 zip (Zenodo record 22688904), one connection, rate-limit aware.

Opened once per batch: the central directory is cached in RAW/TotalSegmentator-v3/index.json (name, header offset,
compressed size, stored size, method), then members are cut straight out of the zip by byte range (nii.gz files are
stored, not deflated, inside the zip), checked with the CRC-32 of the zip entry.
"""
from __future__ import annotations

import json
import os
import struct
import sys
import time
import zlib
from pathlib import Path

import requests

RECORD = 22688904
URL = f"https://zenodo.org/api/records/{RECORD}/files/Totalsegmentator_dataset_v300.zip/content"
RAW = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw")) / "TotalSegmentator-v3"
INDEX = RAW / "index.json"


class Ranged:
    def __init__(self, url: str = URL):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "radiology-study-pack-builder/1.0"
        self.url, self.size, self.bytes, self.calls = url, 0, 0, 0
        r = self._get(0, 0, first=True)
        self.size = int(r.headers["Content-Range"].split("/")[-1])

    def _get(self, a: int, b: int, first: bool = False):
        for attempt in range(12):
            r = self.s.get(self.url, headers={"Range": f"bytes={a}-{b}"}, allow_redirects=True, timeout=180, stream=False)
            self.calls += 1
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", "60")) + 2
                print(f"[zenodo] rate limited, waiting {wait}s", file=sys.stderr, flush=True)
                time.sleep(wait)
                continue
            if r.status_code == 206:
                if first:
                    self.url = r.url
                self.bytes += len(r.content)
                return r
            time.sleep(3 + attempt * 2)
        raise RuntimeError(f"range {a}-{b} failed ({r.status_code})")

    def read(self, a: int, n: int, chunk: int = 48 << 20) -> bytes:
        out, end = [], a + n
        while a < end:
            b = min(end, a + chunk) - 1
            out.append(self._get(a, b).content)
            a = b + 1
        return b"".join(out)


def build_index(rz: Ranged) -> list[dict]:
    tail = rz.read(rz.size - (1 << 16), 1 << 16)
    i = tail.rfind(b"PK\x06\x07")  # zip64 EOCD locator
    assert i >= 0, "not a zip64 archive?"
    z64_off = struct.unpack("<Q", tail[i + 8:i + 16])[0]
    rec = rz.read(z64_off, 56)
    assert rec[:4] == b"PK\x06\x06"
    n_entries, cd_size, cd_off = struct.unpack("<QQQ", rec[32:56])
    cd = rz.read(cd_off, cd_size)
    out, p = [], 0
    while p < len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        (_, _, _, flag, method, _, _, crc, csize, usize, nlen, elen, clen, _, _, _, hoff) = struct.unpack("<4sHHHHHHIIIHHHHHII", cd[p:p + 46])
        name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
        extra = cd[p + 46 + nlen:p + 46 + nlen + elen]
        q = 0
        while q + 4 <= len(extra):
            tag, sz = struct.unpack("<HH", extra[q:q + 4])
            if tag == 1:
                f = extra[q + 4:q + 4 + sz]
                k = 0
                if usize == 0xFFFFFFFF:
                    usize = struct.unpack("<Q", f[k:k + 8])[0]; k += 8
                if csize == 0xFFFFFFFF:
                    csize = struct.unpack("<Q", f[k:k + 8])[0]; k += 8
                if hoff == 0xFFFFFFFF:
                    hoff = struct.unpack("<Q", f[k:k + 8])[0]; k += 8
            q += 4 + sz
        out.append({"n": name, "o": hoff, "c": csize, "u": usize, "m": method, "crc": crc})
        p += 46 + nlen + elen + clen
    assert len(out) == n_entries, (len(out), n_entries)
    return out


def load_index(rz: Ranged | None = None) -> list[dict]:
    if INDEX.exists():
        return json.loads(INDEX.read_text())
    RAW.mkdir(parents=True, exist_ok=True)
    rz = rz or Ranged()
    idx = build_index(rz)
    INDEX.write_text(json.dumps(idx))
    print(f"[zenodo] index: {len(idx)} entries, {rz.bytes / 1e6:.1f} MB, {rz.calls} calls", file=sys.stderr)
    return idx


def member_bytes(rz: Ranged, e: dict, prefetched: tuple[int, bytes] | None = None) -> bytes:
    """Stored/deflated member data of index entry e (local header skipped), CRC-checked."""
    def rd(a, n):
        if prefetched and prefetched[0] <= a and a + n <= prefetched[0] + len(prefetched[1]):
            return prefetched[1][a - prefetched[0]:a - prefetched[0] + n]
        return rz.read(a, n)
    h = rd(e["o"], 30)
    assert h[:4] == b"PK\x03\x04"
    nlen, elen = struct.unpack("<HH", h[26:30])
    data = rd(e["o"] + 30 + nlen + elen, e["c"])
    if e["m"] == 8:
        data = zlib.decompress(data, -15)
    else:
        assert e["m"] == 0
    assert zlib.crc32(data) & 0xFFFFFFFF == e["crc"], e["n"]
    return data
