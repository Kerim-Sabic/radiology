"""Second AI layer for the heart-ct pack: heart chambers (higher resolution) and coronary arteries, ADDED to the built pack.

  python scripts/data/heart_ct_ai2.py check   <case>      # rebuild the first AI layer's outline of one structure and compare with the pack
  python scripts/data/heart_ct_ai2.py qc                  # QC every case's TotalSegmentator output -> work/heart-ct/_ts/qc2.json
  python scripts/data/heart_ct_ai2.py add                 # write targets/*.json and pack.json entries; the first AI layer's outline of the same structure is replaced

Input: work/heart-ct/_ts/<case>/hc/*.nii.gz and cor/coronary_arteries.nii.gz, made by `TotalSegmentator -i ct_crop.nii.gz -ta
heartchambers_highres | coronary_arteries` (the licensed tasks; see docs/data/heart-ct-report.md). The output grid equals
work/heart-ct/<case>/ct_crop.nii.gz, so the outlines are traced exactly as the first AI layer's (every second slice, same
pixel grid, same SOP instance UIDs), without rebuilding any DICOM. Only pack.json (new referenceTargets) and new files in
targets/ change; lessons are edited by hand in lessons.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import heart_ct as h  # noqa: E402
import heart_ct_build as hb  # noqa: E402
from annotations import REVIEW  # noqa: E402
from common import PACKS_DIR, dump_json  # noqa: E402

WORK, RAW = h.WORK, h.RAW
TS = WORK / "_ts"
PACK = PACKS_DIR / "heart-ct"
STEP = hb.STEP
VOXML = 1.5 * 1.5 * 3.0 / 1000.0
CHAMBERS = ["heart_atrium_left", "heart_atrium_right", "heart_ventricle_left", "heart_ventricle_right", "heart_myocardium", "pulmonary_artery"]
TAG = "ai2"


def load_case(cid: str):
    import nibabel as nib
    info = hb.sel_info(cid)
    c = info["crop"]
    im = nib.load(str(RAW / cid / "ct.nii.gz"))
    sl = (slice(c["i0"], c["i1"] + 1), slice(c["j0"], c["j1"] + 1), slice(c["k0"], c["k1"] + 1, STEP))
    ct = np.asarray(im.dataobj)[sl]
    aff = im.affine.copy()
    aff[:3, 3] = (im.affine @ np.array([c["i0"], c["j0"], c["k0"], 1.0]))[:3]
    aff[:3, 2] *= STEP
    simg = nib.Nifti1Image(ct, aff)
    fi, fj, *_ = bx._isles_grid(simg)
    heart = np.asarray(nib.load(str(RAW / cid / "segmentations" / "heart.nii.gz")).dataobj)[sl] > 0
    return info, ct, aff, fi, fj, heart, sl


def coronary_mask(a: np.ndarray, heart: np.ndarray):
    """Connected parts of the coronary output, kept only when they lie in the heart's neighbourhood (9 mm around its outline, parts under 15 voxels dropped)."""
    from scipy import ndimage as ndi
    a = (a > 0) & ndi.binary_dilation(heart, iterations=6)  # coronary arteries run in the fat within about 9 mm of the heart outline
    lab, n = ndi.label(a, structure=np.ones((3, 3, 3), bool))
    keep = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
    keep = [i for sz, i in sorted(keep, reverse=True)[:6] if sz >= 15]
    return np.isin(lab, keep), n, len(keep)


def planes_of(cid: str, mask3: np.ndarray, fi, fj) -> list[dict]:
    from build_r4 import _rings_planes
    out = []
    for kk in range(mask3.shape[2]):
        if mask3[:, :, kk].any():
            pl = _rings_planes(bx._isles_slice(mask3, kk, fi, fj), bx.uid_for(hb.PACK_ID, cid, "ct", str(kk)))
            if pl:
                out.append(pl)
    return out


def read_ts(cid: str, rel: str, sl):
    import nibabel as nib
    p = TS / cid / rel
    if not p.exists():
        return None
    return np.asarray(nib.load(str(p)).dataobj)[:, :, ::STEP]


def check(cid: str):
    """The first layer's outline rebuilt with this module's grid must equal the stored geometry."""
    import nibabel as nib
    info, ct, aff, fi, fj, heart, sl = load_case(cid)
    lab = np.asarray(nib.load(str(WORK / cid / "ai_chambers.nii.gz")).dataobj)[:, :, ::STEP]
    m, _ = hb.largest(lab == 45, 1, 0.0)
    mine = planes_of(cid, m, fi, fj)
    old = json.loads((PACK / "targets" / f"hct-{cid}-ai-heart-atrium-left.json").read_text(encoding="utf-8"))["planes"]
    print("same:", mine == old, len(mine), len(old))


def qc():
    from scipy import ndimage as ndi
    out = {}
    sel = json.loads((WORK / "selection.json").read_text())
    drop = json.loads((WORK / "dropped.json").read_text()) if (WORK / "dropped.json").exists() else {}
    for cid in sel:
        if cid in drop:
            continue
        info, ct, aff, fi, fj, heart, sl = load_case(cid)
        hd = ndi.binary_dilation(heart, iterations=2)
        hd_wide = ndi.binary_dilation(heart, iterations=8)  # 12 mm for the coronary tree
        rec = {"contrast": info["contrast"], "chambers": {}, "coronary": None}
        ai = {}
        for cls in CHAMBERS:
            a = read_ts(cid, f"hc/{cls}.nii.gz", sl)
            if a is None:
                continue
            m, n = hb.largest((a > 0) if cls == "pulmonary_artery" else ((a > 0) & hd), 1, 0.0)  # stray strands outside the heart are cut away
            if not m.any():
                rec["chambers"][cls] = "no output"
                continue
            ml = float(m.sum()) * VOXML
            lo, hi = hb.AI_ML[cls]
            inside = None if cls == "pulmonary_artery" else float(((a > 0) & hd).sum() / (a > 0).sum())
            hu = float(np.median(ct[m]))
            why = []
            if not lo <= ml <= hi:
                why.append(f"volume {ml:.0f} ml outside {lo}-{hi}")
            if inside is not None and inside < 0.9:
                why.append(f"only {inside * 100:.0f}% inside the heart")
            if not -50 <= hu <= 900:
                why.append(f"median {hu:.0f} HU outside -50..900")
            ai[cls] = {"mask": m, "ml": ml, "hu": hu, "inside": inside, "why": why}
        cen = {k: hb.lps_centroid(v["mask"], aff) for k, v in ai.items()}

        def order(a, b, axis, text):
            if a in cen and b in cen and not cen[a][axis] > cen[b][axis]:
                ai[a]["why"].append(text)
                ai[b]["why"].append(text)

        order("heart_atrium_left", "heart_atrium_right", 0, "left atrium not left of the right atrium")
        order("heart_ventricle_left", "heart_ventricle_right", 0, "left ventricle not left of the right ventricle")
        order("heart_ventricle_left", "heart_atrium_right", 0, "left ventricle not left of the right atrium")
        order("heart_atrium_left", "heart_ventricle_right", 1, "left atrium not behind the right ventricle")
        order("heart_ventricle_left", "heart_ventricle_right", 1, "left ventricle not behind the right ventricle")
        for cls, v in ai.items():
            rec["chambers"][cls] = {"ml": round(v["ml"], 1), "hu": round(v["hu"], 1),
                                    "inside": None if v["inside"] is None else round(v["inside"] * 100, 1), "why": v["why"]}
        a = read_ts(cid, "cor/coronary_arteries.nii.gz", sl)
        if a is not None:
            m, n, nkeep = coronary_mask(a, heart)
            why = []
            if not m.any():
                why.append("no output")
            else:
                ml = float(m.sum()) * VOXML
                hu = float(np.median(ct[m]))
                lab, k = ndi.label(m, structure=np.ones((3, 3, 3), bool))
                longest = 0.0
                for i in range(1, k + 1):
                    ix = np.argwhere(lab == i) * np.array([1.5, 1.5, 3.0])
                    longest = max(longest, float(np.linalg.norm(ix.max(0) - ix.min(0))))
                if not 1.0 <= ml <= 14:
                    why.append(f"volume {ml:.1f} ml outside 1-14")
                if longest < 45:
                    why.append(f"longest connected part {longest:.0f} mm (< 45)")
                if not 80 <= hu <= 900:
                    why.append(f"median {hu:.0f} HU outside 80-900")
                rec["coronary"] = {"ml": round(ml, 2), "parts": nkeep, "partsAll": int(n), "longestMm": round(longest), "hu": round(hu, 1), "why": why}
            if not m.any():
                rec["coronary"] = {"why": why}
        out[cid] = rec
    (TS / "qc2.json").write_text(json.dumps(out, indent=1))
    for cid, r in out.items():
        bad = {k: v["why"] for k, v in r["chambers"].items() if isinstance(v, dict) and v["why"]}
        print(cid, "contrast" if r["contrast"] else "plain", "chamberFails:", bad, "| coronary:", r["coronary"])


def masks_for(cid: str, rec: dict):
    """The masks that passed (by the qc record) -> {cls: mask}; chambers and the single coronary mask."""
    from scipy import ndimage as ndi
    info, ct, aff, fi, fj, heart, sl = load_case(cid)
    res = {}
    for cls in CHAMBERS:
        r = rec["chambers"].get(cls)
        if isinstance(r, dict) and not r["why"]:
            from scipy import ndimage as ndi
            a = read_ts(cid, f"hc/{cls}.nii.gz", sl) > 0
            m, _ = hb.largest(a if cls == "pulmonary_artery" else (a & ndi.binary_dilation(heart, iterations=2)), 1, 0.0)
            res[cls] = m
    c = rec.get("coronary")
    if c and not c.get("why"):
        a = read_ts(cid, "cor/coronary_arteries.nii.gz", sl)
        res["coronary_arteries"], _, _ = coronary_mask(a, heart)
    return res, ct, aff, fi, fj


def add(allowed: dict):
    """allowed: {case: [classes]} chosen after the eye check. Writes targets/<id>.json and appends to pack.json referenceTargets."""
    qc_all = json.loads((TS / "qc2.json").read_text())
    pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
    have = {t["id"] for t in pack["referenceTargets"]}
    sample = next(t for t in pack["referenceTargets"] if t["provenance"] == "ai_draft")
    added = removed = 0
    for cid, classes in allowed.items():
        rec = qc_all[cid]
        res, ct, aff, fi, fj = masks_for(cid, rec)
        series = next(t["seriesUid"] for t in pack["referenceTargets"] if t["id"].startswith(f"hct-{cid}-"))
        for cls in classes:
            m = res.get(cls)
            if m is None:
                continue
            tid = f"hct-{cid}-{TAG}-{cls.replace('_', '-')}"
            if tid in have:
                continue
            planes = planes_of(cid, m, fi, fj)
            ml = float(m.sum()) * VOXML
            hu = float(np.median(ct[m]))
            cor = cls == "coronary_arteries"
            t = {
                "id": tid, "label": "Coronary arteries" if cor else hb.LABEL[cls], "classId": f"anatomy:{cls}", "seriesUid": series,
                "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {
                    "source": "Horalix", "method": sample["provenanceDetail"]["method"],
                    "note": (f"Unreviewed AI proposal (second AI layer, higher-resolution heart model). QC passed: volume {ml:.1f} ml in the plausible "
                             f"range; median {hu:.0f} HU; " + ("thin connected branches near the heart, not in lung or bone; " if cor else
                             "left/right and front/back order checked against the other chambers; inside the heart outline; ")
                             + "checked by eye on overlay sheets."),
                },
                "completeness": "target_only", "assessedClasses": [f"anatomy:{cls}"],
                "unassessedNote": "Atlas outline of this structure only; not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": "vessel",
            }
            (PACK / "targets" / f"{tid}.json").write_text(
                json.dumps({"geometryType": "contour_set", "space": "image_px", "planes": planes}, ensure_ascii=False) + "\n", encoding="utf-8")
            pack["referenceTargets"].append(t)
            added += 1
            old = f"hct-{cid}-ai-{cls.replace('_', '-')}"  # the first AI layer's outline of the same structure is replaced (no double outlines)
            if old in have:
                pack["referenceTargets"] = [x for x in pack["referenceTargets"] if x["id"] != old]
                (PACK / "targets" / f"{old}.json").unlink(missing_ok=True)
                removed += 1
    dump_json(pack, PACK / "pack.json")
    print("added", added, "replaced", removed)

def allowed_all() -> dict:
    qc_all = json.loads((TS / "qc2.json").read_text())
    out = {}
    for cid, r in qc_all.items():
        cl = [c for c, v in r["chambers"].items() if isinstance(v, dict) and not v["why"]]
        if r.get("coronary") and not r["coronary"].get("why"):
            cl.append("coronary_arteries")
        out[cid] = cl
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "check":
        check(sys.argv[2])
    elif cmd == "qc":
        qc()
    elif cmd == "add":
        add(allowed_all())
