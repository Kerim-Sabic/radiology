"""Read single members of a large remote ZIP over HTTP Range requests (no full download).

  python scripts/data/remote_zip.py list <url> [pattern]
  python scripts/data/remote_zip.py get <url> <member> <out_file>

Used for public archives where only a few cases are needed (NIH ChestX-ray14 mirror zips of ~2 GB,
Seg-CQ500 on Zenodo). The member bytes are exactly those of the archive (zipfile checks each CRC-32).
"""
from __future__ import annotations

import io
import re
import sys
import zipfile
from pathlib import Path

import requests


class HttpRangeFile(io.RawIOBase):
    """Seekable, read-only file object backed by HTTP Range requests (with a small read-ahead cache)."""

    def __init__(self, url: str, block: int = 1 << 20):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "radiology-study-pack-builder/1.0"
        r = self.s.get(url, headers={"Range": "bytes=0-0"}, allow_redirects=True, timeout=60)
        if r.status_code != 206:
            raise RuntimeError(f"server does not honour Range requests ({r.status_code}) for {url}")
        self.url = r.url  # follow redirects once; signed CDN URLs stay valid for the session
        self.size = int(r.headers["Content-Range"].split("/")[-1])
        self.pos = 0
        self.block = block
        self.cache: tuple[int, bytes] = (-1, b"")
        self.fetched = 0

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _range(self, a: int, b: int) -> bytes:
        for attempt in range(5):
            try:
                r = self.s.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
                if r.status_code in (403, 410) and attempt == 0:
                    raise RuntimeError("signed URL expired")
                r.raise_for_status()
                self.fetched += len(r.content)
                return r.content
            except Exception:  # noqa: BLE001
                if attempt == 4:
                    raise
        return b""

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n)
        c0, cb = self.cache
        if c0 <= self.pos and end <= c0 + len(cb):
            out = cb[self.pos - c0:end - c0]
        elif n >= self.block:
            out = self._range(self.pos, end - 1)
        else:
            a = self.pos
            b = min(self.size, a + self.block) - 1
            cb = self._range(a, b)
            self.cache = (a, cb)
            out = cb[: end - a]
        self.pos += len(out)
        return out

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def open_remote(url: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(HttpRangeFile(url), buffer_size=1 << 16))


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, url = sys.argv[1], sys.argv[2]
    zf = open_remote(url)
    if cmd == "list":
        pat = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
        for i in zf.infolist():
            if not pat or pat.search(i.filename):
                print(f"{i.file_size:>12} {i.filename}")
    elif cmd == "get":
        out = Path(sys.argv[4])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(zf.read(sys.argv[3]))
        print(f"{out} {out.stat().st_size} bytes")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
