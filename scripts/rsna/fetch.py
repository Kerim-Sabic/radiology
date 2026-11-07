"""Read single files out of the RSNA-ICA release zip without downloading it whole.

The MIRA release is one ~356 GB Zip64 archive whose members are stored uncompressed, behind a personal download link.
With HTTP Range requests, Python's zipfile can read the central directory and then any member's bytes directly, so
this machine (about 45 GB free) fetches one batch of series at a time into
C:\\Users\\kerim\\radiology-data\\rsna-ica\\raw\\, the next step crops them, and the raw batch is deleted.

Nothing this script writes goes into the repository: every path is under RSNA_HOME (outside the repo and OneDrive).
The download link is personal (RSNA's agreement): it is read from RSNA_HOME/ACCESS.txt or RSNA_ZIP_URL and never
printed or logged.

    python scripts/rsna/fetch.py list                 # member index -> RSNA_HOME/index/members.json
    python scripts/rsna/fetch.py labels               # dataset.csv, dataset_localizers.csv -> RSNA_HOME/labels/
    python scripts/rsna/fetch.py series --batch 40    # next 40 series not yet done -> RSNA_HOME/raw/<uid>/
    python scripts/rsna/fetch.py series --uids a,b    # these series

Local test: RSNA_ZIP_URL=file:///path/to/test.zip
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

RSNA_HOME = Path(os.environ.get('RSNA_HOME', r'C:\Users\kerim\radiology-data\rsna-ica'))
BLOCK = 1 << 20  # 1 MB range reads, cached


def zip_url() -> str:
    url = os.environ.get('RSNA_ZIP_URL')
    if not url:
        access = RSNA_HOME / 'ACCESS.txt'
        if not access.exists():
            sys.exit('No download link: put it in RSNA_HOME/ACCESS.txt (Kerim, REQUESTS R-1) or RSNA_ZIP_URL.')
        url = access.read_text(encoding='utf-8').strip().splitlines()[0].strip()
    return url


class RangeFile(io.RawIOBase):
    """A read-only, seekable view of a remote file through HTTP Range requests (or a local file:// path)."""

    def __init__(self, url: str):
        self.url = url
        self.local = open(url[len('file:///'):] if url.startswith('file:///') else url[len('file://'):], 'rb') if url.startswith('file://') else None
        self.pos = 0
        self.cache: dict[int, bytes] = {}
        if self.local:
            self.size = os.fstat(self.local.fileno()).st_size
        else:
            req = urllib.request.Request(url, method='GET', headers={'Range': 'bytes=0-0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                total = r.headers.get('Content-Range', '').split('/')[-1]
                if r.status != 206 or not total.isdigit():
                    sys.exit('The download link does not support range requests; a full download would not fit on disk.')
                self.size = int(total)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        self.pos = offset if whence == io.SEEK_SET else self.pos + offset if whence == io.SEEK_CUR else self.size + offset
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self.cache:
            start, end = i * BLOCK, min(self.size, (i + 1) * BLOCK) - 1
            if self.local:
                self.local.seek(start)
                data = self.local.read(end - start + 1)
            else:
                for attempt in range(5):
                    try:
                        req = urllib.request.Request(self.url, headers={'Range': f'bytes={start}-{end}'})
                        with urllib.request.urlopen(req, timeout=120) as r:
                            data = r.read()
                        break
                    except OSError:
                        if attempt == 4:
                            raise
            if len(self.cache) > 256:
                self.cache.pop(next(iter(self.cache)))
            self.cache[i] = data
        return self.cache[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            i, off = divmod(self.pos, BLOCK)
            chunk = self._block(i)[off:off + n]
            if not chunk:
                break
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def open_zip() -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(RangeFile(zip_url()), buffer_size=BLOCK))


def series_of(name: str) -> str | None:
    """`.../series/<SeriesInstanceUID>/<SOPInstanceUID>.dcm` -> the series UID."""
    parts = name.replace('\\', '/').split('/')
    return parts[parts.index('series') + 1] if 'series' in parts and len(parts) > parts.index('series') + 2 and name.endswith('.dcm') else None


def cmd_list(z: zipfile.ZipFile):
    (RSNA_HOME / 'index').mkdir(parents=True, exist_ok=True)
    members = [{'name': i.filename, 'size': i.file_size, 'stored': i.compress_type == zipfile.ZIP_STORED} for i in z.infolist()]
    series: dict[str, int] = {}
    for m in members:
        s = series_of(m['name'])
        if s:
            series[s] = series.get(s, 0) + m['size']
    (RSNA_HOME / 'index' / 'members.json').write_text(json.dumps({'members': members, 'series_bytes': series}), encoding='utf-8')
    print(f'{len(members)} members, {len(series)} series, {sum(series.values()) / 1e9:.1f} GB of DICOM')


def cmd_labels(z: zipfile.ZipFile):
    out = RSNA_HOME / 'labels'
    out.mkdir(parents=True, exist_ok=True)
    for info in z.infolist():
        base = info.filename.rsplit('/', 1)[-1]
        if base.endswith('.csv') or (info.filename.count('/') <= 2 and base.endswith(('.nii', '.nii.gz')) and 'segmentations' in info.filename):
            target = out / info.filename.replace('/', '__')
            with z.open(info) as src, open(target, 'wb') as dst:
                shutil.copyfileobj(src, dst)
            print('labels:', target.name)


def cmd_series(z: zipfile.ZipFile, uids: list[str] | None, batch: int):
    done_file = RSNA_HOME / 'index' / 'done.txt'
    done = set(done_file.read_text().split()) if done_file.exists() else set()
    by_series: dict[str, list[zipfile.ZipInfo]] = {}
    for info in z.infolist():
        s = series_of(info.filename)
        if s:
            by_series.setdefault(s, []).append(info)
    todo = uids or [s for s in sorted(by_series) if s not in done][:batch]
    free = shutil.disk_usage(RSNA_HOME).free
    need = sum(i.file_size for s in todo for i in by_series.get(s, []))
    if need > free - 15e9:
        sys.exit(f'Not enough disk: this batch needs {need / 1e9:.1f} GB and fewer than 15 GB would stay free.')
    for s in todo:
        target = RSNA_HOME / 'raw' / s
        target.mkdir(parents=True, exist_ok=True)
        for info in by_series.get(s, []):
            with z.open(info) as src, open(target / info.filename.rsplit('/', 1)[-1], 'wb') as dst:
                shutil.copyfileobj(src, dst, BLOCK)
        print('series', s, len(by_series.get(s, [])), 'files')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['list', 'labels', 'series'])
    ap.add_argument('--batch', type=int, default=40)
    ap.add_argument('--uids', default='')
    a = ap.parse_args()
    RSNA_HOME.mkdir(parents=True, exist_ok=True)
    with open_zip() as z:
        if a.cmd == 'list':
            cmd_list(z)
        elif a.cmd == 'labels':
            cmd_labels(z)
        else:
            cmd_series(z, [u for u in a.uids.split(',') if u] or None, a.batch)


if __name__ == '__main__':
    main()
