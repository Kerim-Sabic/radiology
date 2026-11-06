"""Stream a `docker save` tar.gz from a URL and extract only the algorithm files (no Docker needed, nothing big saved).

  python docker_weights.py <url> <out_dir>

Lists every file of every layer into <out_dir>/_listing.tsv; extracts files outside system / site-packages folders and any
model-weight-like file (.pth .pt .ckpt .pkl .model .json .py .yml .yaml .sh .txt .md) into <out_dir>/layers/<layer>/...
"""
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

url, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
SKIP = re.compile(r"^(usr/|lib/|lib64/|bin/|sbin/|etc/|var/|proc/|sys/|dev/|run/|tmp/|boot/|srv/|mnt/|media/)|site-packages/|dist-packages/|/conda/pkgs/|\.cache/pip")
KEEP_EXT = re.compile(r"\.(pth|pt|ckpt|pkl|model|json|py|yml|yaml|sh|txt|md|onnx|npz|h5)$", re.I)
listing = open(out / "_listing.tsv", "w", encoding="utf-8")
req = urllib.request.Request(url, headers={"User-Agent": "radiology-data-pipeline"})
with urllib.request.urlopen(req) as resp:
    outer = tarfile.open(fileobj=resp, mode="r|gz")
    for m in outer:
        listing.write(f"OUTER\t{m.size}\t{m.name}\n")
        if not m.isfile():
            continue
        f = outer.extractfile(m)
        if m.name.endswith((".json",)) and m.size < 5_000_000:
            (out / "outer").mkdir(exist_ok=True)
            (out / "outer" / m.name.replace("/", "_")).write_bytes(f.read())
            continue
        try:
            inner = tarfile.open(fileobj=f, mode="r|*")
        except tarfile.ReadError:
            continue
        layer = m.name.replace("/", "_")
        for im in inner:
            listing.write(f"{layer}\t{im.size}\t{im.name}\n")
            if not im.isfile():
                continue
            name = im.name
            keep = (not SKIP.search(name)) or (KEEP_EXT.search(name) and im.size > 1_000_000 and "site-packages" not in name)
            if keep and im.size < 4_000_000_000:
                dst = out / "layers" / layer / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                src = inner.extractfile(im)
                with open(dst, "wb") as g:
                    while True:
                        b = src.read(1 << 22)
                        if not b:
                            break
                        g.write(b)
        listing.flush()
listing.close()
print("done")
