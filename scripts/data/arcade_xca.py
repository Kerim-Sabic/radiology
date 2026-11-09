"""Invasive coronary angiograms with expert annotations (`arcade-xca`): the ARCADE dataset (Zenodo 10.5281/zenodo.10390295, CC0).

  python scripts/data/arcade_xca.py select    # merge the two ARCADE tasks by image content, review rule, write selection.json
  python scripts/data/arcade_xca.py build     # write public/packs/arcade-xca (+ docs/data/arcade-xca-build-qc.json, index entry)
  python scripts/data/arcade_xca.py index     # refresh the index entry after the lessons are written

Source: arcade.zip from the open Zenodo record (MD5 checked against the record), extracted to RADIOLOGY_RAW_DIR/arcade/x/arcade.
ARCADE has two tasks, each with its own 1,200 train/val and 300 test frames: `syntax` (the 26 SYNTAX vessel segments outlined
as polygons) and `stenosis` (a region around each narrowing of 50% or more). The same frame can occur in both tasks under
different file names (123 byte-identical pairs, all in the test split); only those frames carry BOTH annotations, so only they are
used, one case per image, never a duplicate. Every candidate was drawn with both annotations (overlay sheets) and checked by eye;
cases whose stenosis region sits beside the vessel, whose segments cannot be followed or whose view is cluttered are dropped
(DROPPED). The 8-bit 512 x 512 PNGs (converted from DICOM by the dataset authors) are wrapped unchanged as DICOM Secondary Capture
with Modality XA. Nothing the reading room shows names the dataset or the finding (LEAK check).
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import build_r4 as b4  # noqa: E402  (neutral-text wrappers; LEAK)
from annotations import REVIEW  # noqa: E402
from build_external import SC_SOP_CLASS, build_series, log, wrap_2d  # noqa: E402

RAW = bx.RAW
ARC = RAW / "arcade" / "x" / "arcade"
PACK_ID = "arcade-xca"
SELECTION = RAW / "arcade" / "selection.json"
N_RCA, N_LEFT = 26, 34  # cases per coronary system, taken at even steps through the reviewed pool (file budget)

SOURCE = {
    "id": "zenodo:ARCADE",
    "name": "ARCADE: x-ray angiography images with SYNTAX vessel-segment and stenosis annotations (Research Institute of Cardiology and Internal Diseases, Almaty)",
    "url": "https://zenodo.org/records/10390295",
    "doi": "10.5281/zenodo.10390295",
    "license": "CC0 1.0 (public domain dedication)",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "citation": ("Popov M, Amanturdieva A, Zhaksylyk N, Alkanov A, Saniyazbekov A, Aimyshev T, Ismailov E, Bulegenov A, Kuzhukeyev A, "
                 "Kulanbayeva A, Kalzhanov A, Temirgaliyev N, Kuzhukeyeva A, Zhakenov A, Ruziyev G, Moldagaliyev D, Tleulesov B, "
                 "Kussainov I, Moldagulova A, Zhumabayev A. Dataset for Automatic Region-based Coronary Artery Disease Diagnostics "
                 "Using X-Ray Angiography Images. Scientific Data 11, 20 (2024). doi:10.1038/s41597-023-02871-z. "
                 "Data: Zenodo doi:10.5281/zenodo.10390295."),
    "accessNote": ("arcade.zip (451,573,813 bytes) downloaded without login or agreement from the open Zenodo record 10390295 "
                   "(https://zenodo.org/api/records/10390295/files/arcade.zip/content); MD5 c5b1973ade06f7dff210f878161e1a76 "
                   "checked against the record. Images and COCO annotations of the `syntax` and `stenosis` folders read as distributed."),
}

# SYNTAX segment number -> (class id suffix, display name). Names follow the SYNTAX score segment definitions.
SEG: dict[str, tuple[str, str]] = {
    "1": ("coronary_rca_proximal", "Right coronary artery, proximal"),
    "2": ("coronary_rca_mid", "Right coronary artery, mid"),
    "3": ("coronary_rca_distal", "Right coronary artery, distal"),
    "4": ("coronary_pda_rca", "Posterior descending artery (from the right coronary artery)"),
    "16": ("coronary_rca_posterolateral", "Posterolateral branch of the right coronary artery"),
    "16a": ("coronary_rca_posterolateral_a", "Posterolateral branch of the right coronary artery, first branch"),
    "16b": ("coronary_rca_posterolateral_b", "Posterolateral branch of the right coronary artery, second branch"),
    "16c": ("coronary_rca_posterolateral_c", "Posterolateral branch of the right coronary artery, third branch"),
    "5": ("coronary_main_stem", "Left main coronary artery"),
    "6": ("coronary_lad_proximal", "Left anterior descending artery, proximal"),
    "7": ("coronary_lad_mid", "Left anterior descending artery, mid"),
    "8": ("coronary_lad_apical", "Left anterior descending artery, distal (apical)"),
    "9": ("coronary_diagonal_1", "First diagonal branch"),
    "9a": ("coronary_diagonal_1a", "First diagonal branch, side branch"),
    "10": ("coronary_diagonal_2", "Second diagonal branch"),
    "10a": ("coronary_diagonal_2a", "Second diagonal branch, side branch"),
    "11": ("coronary_lcx_proximal", "Left circumflex artery, proximal"),
    "12": ("coronary_intermediate", "Intermediate (anterolateral) branch"),
    "12a": ("coronary_marginal_1", "First obtuse marginal branch"),
    "12b": ("coronary_marginal_2", "Second obtuse marginal branch"),
    "13": ("coronary_lcx_distal", "Left circumflex artery, distal"),
    "14": ("coronary_lcx_posterolateral", "Left posterolateral branch"),
    "14a": ("coronary_lcx_posterolateral_a", "Left posterolateral branch, first side branch"),
    "14b": ("coronary_lcx_posterolateral_b", "Left posterolateral branch, second side branch"),
    "15": ("coronary_pda_lcx", "Posterior descending artery (from the left circumflex artery)"),
}
RIGHT = {"1", "2", "3", "4", "16", "16a", "16b", "16c"}
LEAK = __import__("re").compile(b4.LEAK.pattern + r"|ARCADE|Zenodo|SYNTAX|Kazakh|Almaty|(?i:stenos|occlu|plaque|atheroscl|narrowing|lesion|ischemi)")

# ---------------------------------------------------------------------- review
# Reviewed on overlay sheets (both annotations drawn on the frame, 12 per sheet in md5 order): md5 prefix of the image -> reason.
DROPPED: dict[str, str] = {
    "0768f61c1f16": "stenosis region sits beside the vessel, not on it",
    "15010fd0bef6": "very low contrast: segments cannot be followed by eye",
    "1a9f8e359bf0": "very low contrast, overexposed corner: segments cannot be followed by eye",
    "2aa24fd98583": "left main bifurcation drawn over itself on a tilted view; segment boundaries ambiguous",
    "329fc7d596f9": "stenosis region offset from the vessel",
    "72aea66c71f7": "stenosis region offset from the vessel",
    "803db52b1af4": "vessel segments do not match the visible anatomy (labels cannot be told apart)",
    "862b948daf7e": "very small, low-contrast branches; segments not distinct",
    "8f5b792470d1": "second stenosis region lies off the vessel",
    "9903dab50fca": "sternal wires over the left coronary tree make the segments hard to follow",
    "9ac1af86ccd0": "left main and proximal vessels overlap, boundaries unclear",
    "9af050d8b1c0": "stenosis regions float away from the vessels",
    "9d4789f1ab73": "sternal wires and clutter over the right coronary artery",
    "a585fed4064f": "stenosis region offset from the vessel",
    "a6bf1228aa8e": "stenosis regions not on a visible vessel",
    "b1f1d2a040c2": "outlines do not follow a clear vessel",
    "c6ef19e5edb0": "left main trifurcation overlaps itself; segment boundaries ambiguous",
    "cd24c996eb0d": "stenosis region spans the left main and an unlabelled area",
    "d75188a4e813": "extra stenosis region off the vessel",
    "dde6e91d0860": "overlapping left main outlines on a very small tree",
    "de1993e28e00": "stenosis region on a vessel with no segment outline",
}


def _poly(seg: list) -> list[tuple[float, float]]:
    assert len(seg) == 1, "one polygon per annotation expected"
    p = seg[0]
    assert len(p) >= 6 and len(p) % 2 == 0
    return list(zip(p[0::2], p[1::2]))


def _mask(poly) -> np.ndarray:
    from PIL import Image, ImageDraw
    m = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(m).polygon(poly, fill=1)
    return np.array(m) > 0


def survey() -> list[dict]:
    """Every distinct image (by file content) of both tasks with its annotations; nothing is dropped here."""
    rows: dict[str, dict] = {}
    for task in ("syntax", "stenosis"):
        for split in ("train", "val", "test"):
            d = json.loads((ARC / task / split / "annotations" / f"{split}.json").read_text(encoding="utf-8"))
            cats = {c["id"]: c["name"] for c in d["categories"]}
            ann = collections.defaultdict(list)
            for a in d["annotations"]:
                ann[a["image_id"]].append(a)
            for im in d["images"]:
                assert (im["width"], im["height"]) == (512, 512)
                p = ARC / task / split / "images" / im["file_name"]
                raw = p.read_bytes()
                h = hashlib.md5(raw).hexdigest()
                r = rows.setdefault(h, {"md5": h, "sha256": hashlib.sha256(raw).hexdigest(), "syntax": [], "stenosis": []})
                r[task].append({"split": split, "file": f"{task}/{split}/images/{im['file_name']}", "ann": f"{task}/{split}/annotations/{split}.json",
                                "anns": [{"cat": cats[a["category_id"]], "id": a["id"], "seg": a["segmentation"]} for a in ann[im["id"]]]})
    return list(rows.values())


def candidates(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if len(r["syntax"]) != 1 or len(r["stenosis"]) != 1:  # present once in each task: the same frame, annotated twice
            continue
        sy, st = r["syntax"][0], r["stenosis"][0]
        if not sy["anns"] or not st["anns"]:
            continue
        ok = True
        for a in sy["anns"] + st["anns"]:
            try:
                poly = _poly(a["seg"])
            except AssertionError:
                ok = False
                break
            xs, ys = zip(*poly)
            if min(xs) < -1 or min(ys) < -1 or max(xs) > 513 or max(ys) > 513 or not _mask(poly).any():
                ok = False
                break
        if ok and all(a["cat"] in SEG for a in sy["anns"]):
            out.append(r)
    return sorted(out, key=lambda r: r["md5"])


def system_of(r: dict) -> str:
    cats = {a["cat"] for a in r["syntax"][0]["anns"]}
    return "right" if cats <= RIGHT else "left"


def select() -> list[dict]:
    rows = survey()
    pool = [r for r in candidates(rows) if r["md5"][:12] not in DROPPED]
    chosen = []
    for system, n in (("right", N_RCA), ("left", N_LEFT)):
        grp = [r for r in pool if system_of(r) == system]
        idx = sorted({round(i * (len(grp) - 1) / max(1, n - 1)) for i in range(min(n, len(grp)))})
        chosen += [grp[i] for i in idx]
    chosen.sort(key=lambda r: r["md5"])
    for r in chosen:
        segs = [(a["cat"], _mask(_poly(a["seg"]))) for a in r["syntax"][0]["anns"]]
        r["stenosisSegments"] = []
        for a in r["stenosis"][0]["anns"]:
            m = _mask(_poly(a["seg"]))
            ov = sorted(((float((m & sm).sum() / max(1, m.sum())), c) for c, sm in segs), reverse=True)
            r["stenosisSegments"].append({"id": a["id"], "area": int(m.sum()), "best": ov[0][1], "bestOverlap": round(ov[0][0], 2),
                                          "second": ov[1][1] if len(ov) > 1 else None, "secondOverlap": round(ov[1][0], 2) if len(ov) > 1 else 0.0})
    SELECTION.write_text(json.dumps({"datasetMd5": "c5b1973ade06f7dff210f878161e1a76", "pool": len(pool), "dropped": DROPPED, "cases": chosen}, indent=1),
                         encoding="utf-8")
    tf = sum(2 + len(r["syntax"][0]["anns"]) + len(r["stenosis"][0]["anns"]) for r in chosen)
    log(f"{len(rows)} distinct images; {sum(1 for r in rows if r['syntax'] and r['stenosis'])} in both tasks; pool {len(pool)}; "
        f"selected {len(chosen)} ({sum(system_of(r) == 'right' for r in chosen)} right, {sum(system_of(r) == 'left' for r in chosen)} left); ~{tf} files")
    return chosen


# ---------------------------------------------------------------------- build
def code_of(md5: str) -> str:
    return "XCA-" + md5[:8].upper()


def _ring(poly) -> list[list[float]]:
    return [[round(x - 0.5, 2), round(y - 0.5, 2)] for x, y in poly]  # COCO pixel-corner -> pixel-centre convention


def build_arcade() -> tuple[list, list, list, dict]:
    from PIL import Image
    sel = json.loads(SELECTION.read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for r in sel["cases"]:
        h = r["md5"]
        sy, st = r["syntax"][0], r["stenosis"][0]
        im = Image.open(ARC / sy["file"])
        a = np.ascontiguousarray(np.asarray(im.convert("L"), dtype=np.uint8))
        assert im.mode == "L" and a.shape == (512, 512), (h, im.mode)
        stem = f"x{h[:12]}"
        ds = wrap_2d(a, tag="arcade", stem=stem, study_key=stem, modality="XA", sop_class=SC_SOP_CLASS, patient_id=code_of(h),
                     study_desc="Coronary angiography", series_desc="Coronary angiogram, single frame", series_number=1,
                     attrs={"BodyPartExamined": "HEART",
                            "DerivationDescription": (f"{sy['file']} of the ARCADE dataset (Zenodo 10.5281/zenodo.10390295): 512 x 512 8-bit PNG "
                                                      "made by the dataset authors from the source angiogram (DICOM metadata removed by them); "
                                                      f"wrapped unchanged as DICOM Secondary Capture. The same frame is {st['file']} in the "
                                                      f"stenosis task (sha256 {r['sha256'][:16]}...).")})
        skey = f"{SOURCE['id']}:{h[:12]}"
        sr = bx._place(build_series([bx.to_item(ds, f"{h[:12]}.png")], {"region": "heart", "role": "diagnostic",
                                                                         "roleNote": "Single contrast-filled frame of an invasive coronary angiogram (PNG) wrapped as DICOM."}, skey),
                       ("One contrast-filled frame of an invasive coronary angiogram, 8-bit, 512 x 512 px as distributed. The projection angle and "
                        "the pixel size are not given, so distances are not measurable and no orientation letters are shown."))
        results.append((sr, skey, {"sourceId": SOURCE["id"],
                                   "linkage": (f"Frame {sy['file']} (also {st['file']}; image sha256 {r['sha256'][:12]}). The dataset publishes no patient identifiers "
                                               "(1,500 patients for 3,000 frames over both tasks, up to 12 frames per patient), so another image of this pack may "
                                               "come from the same patient; each image is its own hold-out group.")}))
        sop = str(ds.SOPInstanceUID)
        by_cat: dict[str, list] = collections.defaultdict(list)
        for an in sy["anns"]:
            by_cat[an["cat"]].append(an)
        for cat, ans in by_cat.items():
            suffix, name = SEG[cat]
            tid = f"arcade-{h[:10]}_seg-{cat}"
            targets.append({
                "id": tid, "label": f"{name} (segment {cat})", "classId": f"anatomy:{suffix}", "seriesUid": sr.uid, "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "source_manual", "category": "vessel",
                "provenanceDetail": {
                    "source": f"zenodo:ARCADE ({sy['ann']}, annotation id {', '.join(str(x['id']) for x in ans)}; image {sy['file']})",
                    "method": ("Vessel segment outlined as a polygon in CVAT by interventional cardiologists following the SYNTAX score segment "
                               "definitions (segments 1-16c); each image had one initial annotator and was cross-validated by two senior doctors, "
                               "with the consensus as the final label (Popov et al. 2024). The polygon is as distributed, converted from pixel-corner "
                               "to pixel-centre coordinates (-0.5 px) into image_px [col, row]."),
                    "note": (f"SYNTAX segment {cat}. The paper reports a mean Dice agreement between annotators of 0.73-0.90, with most disagreement "
                             "at segment borders and on small vessels."),
                },
                "completeness": "target_only", "assessedClasses": [f"anatomy:{suffix}"],
                "unassessedNote": ("Only the SYNTAX segments the experts outlined are referenced; the paper notes the masks cover roughly 60-80% of the "
                                   "visible vessels, so a visible branch without an outline is not an error."),
                "review": dict(REVIEW),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px",
                          "planes": [{"sopInstanceUid": sop, "frame": 1, "polygons": [_ring(_poly(x["seg"])) for x in ans]}]})
        for n, (an, ss) in enumerate(zip(st["anns"], r["stenosisSegments"]), 1):
            tid = f"arcade-{h[:10]}_stenosis-{n}"
            where = f" Most of the region lies in {SEG[ss['best']][1].lower()} (SYNTAX segment {ss['best']})." if ss["bestOverlap"] >= 0.5 else ""
            targets.append({
                "id": tid, "label": "Coronary narrowing (expert region)", "classId": "finding:coronary_stenosis",
                "seriesUid": sr.uid, "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"zenodo:ARCADE ({st['ann']}, annotation id {an['id']}; image {st['file']})",
                    "method": ("Region containing a stenotic lesion outlined as a polygon in CVAT by interventional cardiologists (one initial annotator, "
                               "cross-validation by two senior doctors, consensus as the final label). A stenosis is a narrowing of 50% or more of the "
                               "lumen in a vessel of at least 1.5 mm, following the SYNTAX criteria, judged with the angiography system's "
                               "quantitative coronary analysis software and by eye (Popov et al. 2024). The polygon is as distributed, converted from "
                               "pixel-corner to pixel-centre coordinates (-0.5 px) into image_px [col, row]."),
                    "note": (f"Region area {ss['area']} px; best-overlapping SYNTAX segment {ss['best']} ({round(100 * ss['bestOverlap'])}% of the region)"
                             + (f", next {ss['second']} ({round(100 * ss['secondOverlap'])}%)" if ss["second"] else "") + "."),
                },
                "completeness": "target_only", "assessedClasses": ["finding:coronary_stenosis"],
                "unassessedNote": ("Only narrowings of 50% or more that the experts marked are referenced. Milder narrowings, occlusions beyond the region, "
                                   "small branches and the haemodynamic significance are not; a real narrowing without a region here is not an error."),
                "review": dict(REVIEW),
                "teachingNote": ("The experts' region around a narrowing of 50% or more of the lumen." + where),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px",
                          "planes": [{"sopInstanceUid": sop, "frame": 1, "polygons": [_ring(_poly(an["seg"]))]}]})
    log(f"[{PACK_ID}] {len(results)} frames, {len(targets)} targets")
    return results, targets, geoms, {}


def _check_leak(builder):
    def run():
        results, targets, geoms, extra = builder()
        for sr, _, _ in results:
            ds = sr.sorted_items[0].ds
            shown = [sr.record.get("description") or "", sr.record.get("roleNote") or "", sr.record.get("displayNote") or "",
                     str(ds.get("StudyDescription", "")), str(ds.get("SeriesDescription", "")), str(ds.get("PatientID", ""))]
            bad = [s for s in shown if LEAK.search(s)]
            assert not bad, (sr.uid, bad)
        return results, targets, geoms, extra
    return run


bx.PACKS[PACK_ID] = {
    "title": "Coronary angiography: vessel segments and narrowings marked by cardiologists",
    "description": ("Invasive coronary angiograms (single contrast-filled frames, 512 x 512 px) from the ARCADE dataset, one case per image, each with "
                    "the SYNTAX vessel segments outlined by interventional cardiologists and the narrowings of 50% or more marked as regions "
                    "(one initial annotator, cross-validated by two senior doctors). Right and left coronary systems in many projections. "
                    "No pixel size or projection angle is distributed."),
    "sources": [SOURCE], "builder": _check_leak(build_arcade), "budget": 60_000_000,
}


def qc_record() -> None:
    path = bx.DOCS_DIR / f"{PACK_ID}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / PACK_ID / "pack.json").read_text(encoding="utf-8"))
    sel = json.loads(SELECTION.read_text(encoding="utf-8"))
    data["qcReview"] = {
        "tool": "scripts/data/qc_render.py arcade-xca <outDir> (decodes the packed DICOM and draws every target) plus the pre-build overlay sheets of both annotations",
        "selectionRule": ("ARCADE frames present in BOTH tasks (same image content under two file names; the only frames with segment outlines and "
                          f"stenosis regions together; 123 distinct frames, all in the test split), every one drawn and reviewed ({sel['pool']} kept after "
                          f"review); {N_RCA} right-coronary and {N_LEFT} left-coronary frames taken at even steps through the md5-ordered pool to keep the "
                          "pack within its file budget."),
        "review": "Every candidate drawn with its segment outlines and stenosis regions on the frame and checked by eye.",
        "kept": len(man["subjects"]), "dropped": DROPPED,
        "leakCheck": "study/series descriptions, role and display notes and PatientID checked against LEAK (dataset names, diagnoses) at build",
    }
    bx.dump_json(data, path)


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/arcade_xca.py; lessons scripts/lessons/arcade_xca.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "select":
        select()
    elif cmd[0] == "build":
        bx.build(PACK_ID)
        qc_record()
        index()
    elif cmd[0] == "index":
        qc_record()
        index()
    else:
        raise SystemExit(__doc__)
