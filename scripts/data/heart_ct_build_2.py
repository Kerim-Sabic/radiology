"""Second round of heart and great-vessel chest CTs (`heart-ct-2`): build public/packs/heart-ct-2.

  python scripts/data/heart_ct_build_2.py build     # DICOM (JPEG-LS), dataset outlines, AI outlines (MONAI path), pack.json, index entry
  python scripts/data/heart_ct_build_2.py index

Run after `heart_ct_2.py screen / pick / fetch / prep`, the choice of work/heart-ct-2/selection.json and `heart_ct_ai_2.py`.
Round one's builder (`heart_ct_build.py`) is imported and not modified; only its module settings (work folder, pack id) are pointed at round two
and its pack-facts file is written under another name (docs/data/heart-ct-2-cases.json), so round one's files are never touched.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import heart_ct as h  # noqa: E402
import heart_ct_2 as h2  # noqa: E402  (points heart_ct.WORK at work/heart-ct-2)
import heart_ct_build as hb  # noqa: E402
from build_external import log  # noqa: E402

PACK_ID = "heart-ct-2"
WORK2 = h2.WORK2
hb.WORK = WORK2
hb.PACK_ID = PACK_ID


def merge_screens() -> None:
    """The J cases come from round one's screen file; copy the chosen ones into round two's so that sel_info finds every case."""
    p = WORK2 / "screen.json"
    mine = json.loads(p.read_text())
    old = json.loads((h.DATA / "work" / "heart-ct" / "screen.json").read_text())
    for cid in json.loads((WORK2 / "selection.json").read_text()):
        if cid not in mine:
            mine[cid] = old[cid]
    p.write_text(json.dumps(mine))


def build_heart_ct2():
    merge_screens()
    sel = json.loads((WORK2 / "selection.json").read_text())
    drop = json.loads((WORK2 / "dropped.json").read_text()) if (WORK2 / "dropped.json").exists() else {}
    qc_log: dict = {}
    results, targets, geoms = [], [], []
    for cid in sel:
        if cid in drop:
            continue
        sr, skey, t, g = hb.build_case(cid, qc_log)
        results.append((sr, skey, {"sourceId": hb.ZENODO_SOURCE["id"]}))
        targets += t
        geoms += g
        log(f"[{PACK_ID}] {cid}: {len(sr.sorted_items)} slices, {len(t)} outlines ({sum(1 for x in t if x['provenance'] == 'ai_draft')} AI)")
    (WORK2 / "build-qc.json").write_text(json.dumps(qc_log, indent=1))
    facts = {}
    for cid in qc_log:
        i = hb.sel_info(cid)
        facts[cid] = {"institute": i["institute"], "manufacturer": i["manufacturer"], "scanner": i["scanner"], "kvp": i["kvp"], "age": i["age"],
                      "sex": i["gender"], "studyType": i["studyType"], "metaPathology": i["pathology"], "metaPathologyLocation": i["pathologyLocation"],
                      "contrast": i["contrast"], "aortaMedianHuAtHeart": i["aortaMedianHuAtHeart"], "ivcMedianHu": i["ivcMedianHu"],
                      "aortaMaxInscribedDiameterMm": i["aortaMaxInscribedDiameterMm"], "cropShape1p5mm": i["cropShape"], **qc_log[cid]}
    bx.dump_json(facts, bx.DOCS_DIR / "heart-ct-2-cases.json")
    return results, targets, geoms, {}


bx.PACKS[PACK_ID] = {
    "title": "Heart and great vessels on chest CT, second set: more scanners, hospitals and heart-gated studies",
    "description": ("More chest CTs of adults from the TotalSegmentator CT dataset v3.0.0 (several hospitals and three scanner makes, including Philips), "
                    "cropped from above the aortic arch to below the heart at 3 mm: heart-gated and routine studies, contrast-enhanced and not, "
                    "with the dataset's own outlines of the heart, aorta, left atrial appendage, pulmonary veins, venae cavae and arch branches, "
                    "and unreviewed AI outlines of the four chambers, the left ventricular muscle and the pulmonary arteries on the contrast studies."),
    "sources": [hb.ZENODO_SOURCE, hb.HORALIX_SOURCE], "builder": hb._check_leak(build_heart_ct2), "budget": 130_000_000,
}


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py",
                                          "scripts/data/heart_ct_2.py + heart_ct_build_2.py; lessons scripts/lessons/heart_ct_2.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "build":
        bx.build(PACK_ID)
        index()
    elif cmd[0] == "index":
        index()
    else:
        raise SystemExit(__doc__)
