"""QC sheets for the heart-ct-2 pack (round one's sheet drawing, scripts/data/heart_ct_qc.py, reused unchanged).

  python scripts/data/heart_ct_qc_2.py <outDir> [case ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import heart_ct_qc as q  # noqa: E402
from common import PACKS_DIR  # noqa: E402

if __name__ == "__main__":
    out = Path(sys.argv[1])
    only = set(sys.argv[2:])
    out.mkdir(parents=True, exist_ok=True)
    pack = PACKS_DIR / "heart-ct-2"
    man = json.loads((pack / "pack.json").read_text(encoding="utf-8"))
    qp = Path(r"C:\Users\kerim\radiology-data\work\heart-ct-2\build-qc.json")
    qc = json.loads(qp.read_text()) if qp.exists() else {}
    for se in man["series"]:
        cid = se["subjectKey"].split(":")[-1]
        if only and cid not in only:
            continue
        q.sheet(pack, man, se, qc.get(cid), out / f"{cid}.png")
        print(cid, flush=True)
