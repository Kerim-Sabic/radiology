"""Second round of invasive coronary angiograms (`arcade-xca-2`): more frames of the ARCADE dataset (Zenodo 10.5281/zenodo.10390295, CC0).

  python scripts/data/arcade_xca_2.py select   # list the round's cases (writes RADIOLOGY_RAW_DIR/arcade/selection2.json)
  python scripts/data/arcade_xca_2.py build    # write public/packs/arcade-xca-2 (+ docs/data/arcade-xca-2-build-qc.json, index entry)
  python scripts/data/arcade_xca_2.py index    # refresh the index entry after the lessons are written

Nothing of the first round (`arcade-xca`, scripts/data/arcade_xca.py) is touched; its functions and tables are imported. Two kinds of case:
  A. the frames present in BOTH ARCADE tasks (segment outlines + narrowing regions) that passed the first round's review but
     were not packed there (the 42 left over: 10 right, 32 left coronary frames);
  B. frames present only in the `syntax` task (segment outlines, no narrowing regions), drawn on overlay sheets and reviewed by
     eye; kept for "find the segment" and "which coronary system" tasks, thinned to even steps in md5 order within each system
     (file budget). Frames of the `stenosis` task without segment outlines are not used.
Image bytes, polygons and provenance wording are as in round one.
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arcade_xca as ax  # noqa: E402  (round one: tables, survey, polygon helpers; not modified)
import build_external as bx  # noqa: E402
from annotations import REVIEW  # noqa: E402
from build_external import build_series, log, wrap_2d, SC_SOP_CLASS  # noqa: E402

PACK_ID = "arcade-xca-2"
SELECTION2 = ax.RAW / "arcade" / "selection2.json"
N_SO_RIGHT, N_SO_LEFT = 28, 42  # syntax-only frames kept per system after review (file budget)

# Syntax-only frames drawn on overlay sheets (96 sampled at even steps through the md5-ordered pool of frames with at least four distinct
# segments: 36 right, 60 left) and dropped after review, by image md5 prefix.
DROPPED2: dict[str, str] = {
    "0f585b72ecb4": "outlines continue beyond any visible vessel; very faint distal segments",
    "3b2345345da0": "only three small left-system segments, no main stem or anterior descending artery to anchor them",
    "6386ffcdac37": "left main region is a tangle of overlapping outlines; segment boundaries ambiguous",
    "8d21f26575fc": "cluttered left main region, tiny overlapping outlines",
    "b75f685a7424": "outlines drawn over overlapping branches in a cluttered view",
    "ccf8691ba10b": "segment outline runs through empty background beside the visible vessel",
    "d857662fac16": "overlapping branches; segment outlines cannot be told apart",
    "e26cc74ca5af": "tangle of overlapping circumflex and diagonal outlines",
    "edf694ebf122": "left main outlines do not follow a clear vessel",
    "fff8c16a2a9c": "outline in empty background from the left main; segment boundaries not credible",
}


def _valid(r: dict) -> bool:
    anns = r["syntax"][0]["anns"]
    if not anns or not all(a["cat"] in ax.SEG for a in anns):
        return False
    for a in anns:
        try:
            p = ax._poly(a["seg"])
        except AssertionError:
            return False
        xs, ys = zip(*p)
        if min(xs) < -1 or min(ys) < -1 or max(xs) > 513 or max(ys) > 513 or not ax._mask(p).any():
            return False
    return True


def _step(g: list, n: int) -> list:
    if len(g) <= n:
        return list(g)
    return [g[i] for i in sorted({round(i * (len(g) - 1) / (n - 1)) for i in range(n)})]


def select() -> list[dict]:
    rows = ax.survey()
    used = {s["sourceSubjectId"] for s in json.loads((bx.PACKS_DIR / "arcade-xca" / "pack.json").read_text(encoding="utf-8"))["subjects"]}
    # A: reviewed round-one pool, not packed in round one
    a = [r for r in ax.candidates(rows) if r["md5"][:12] not in ax.DROPPED and r["md5"][:12] not in used]
    # B: syntax-only frames
    so = sorted((r for r in rows if r["syntax"] and not r["stenosis"] and len(r["syntax"]) == 1 and r["syntax"][0]["anns"] and _valid(r)),
                key=lambda r: r["md5"])
    so = [r for r in so if len({x["cat"] for x in r["syntax"][0]["anns"]}) >= 4]
    sample = _step([r for r in so if ax.system_of(r) == "right"], 36) + _step([r for r in so if ax.system_of(r) == "left"], 60)
    sample = [r for r in sample if r["md5"][:12] not in DROPPED2]
    b = []
    for system, n in (("right", N_SO_RIGHT), ("left", N_SO_LEFT)):
        b += _step([r for r in sample if ax.system_of(r) == system], n)
    b.sort(key=lambda r: r["md5"])
    chosen = sorted(a + b, key=lambda r: r["md5"])
    for r in chosen:
        segs = [(c["cat"], ax._mask(ax._poly(c["seg"]))) for c in r["syntax"][0]["anns"]]
        r["kind"] = "both" if r["stenosis"] else "syntax"
        r["stenosisSegments"] = []
        for an in (r["stenosis"][0]["anns"] if r["stenosis"] else []):
            m = ax._mask(ax._poly(an["seg"]))
            ov = sorted(((float((m & sm).sum() / max(1, m.sum())), c) for c, sm in segs), reverse=True)
            r["stenosisSegments"].append({"id": an["id"], "area": int(m.sum()), "best": ov[0][1], "bestOverlap": round(ov[0][0], 2),
                                          "second": ov[1][1] if len(ov) > 1 else None, "secondOverlap": round(ov[1][0], 2) if len(ov) > 1 else 0.0})
    SELECTION2.write_text(json.dumps({"datasetMd5": "c5b1973ade06f7dff210f878161e1a76", "caseA": len(a), "caseB": len(b), "dropped": DROPPED2,
                                      "cases": chosen}, indent=1), encoding="utf-8")
    log(f"A (both tasks, left over from round one): {len(a)} ({sum(ax.system_of(r) == 'right' for r in a)} right); "
        f"B (segment outlines only): {len(b)} ({sum(ax.system_of(r) == 'right' for r in b)} right); {len(so)} syntax-only frames pass the polygon check")
    return chosen


def build_arcade2() -> tuple[list, list, list, dict]:
    from PIL import Image
    sel = json.loads(SELECTION2.read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for r in sel["cases"]:
        h = r["md5"]
        sy = r["syntax"][0]
        st = r["stenosis"][0] if r["stenosis"] else None
        im = Image.open(ax.ARC / sy["file"])
        if im.mode != "L":  # some files are stored as RGB; accepted only when the three channels are identical (pure grey)
            rgb = np.asarray(im.convert("RGB"))
            assert (rgb[..., 0] == rgb[..., 1]).all() and (rgb[..., 0] == rgb[..., 2]).all(), (h, im.mode, "colour image")
        a = np.ascontiguousarray(np.asarray(im.convert("L"), dtype=np.uint8))
        assert a.shape == (512, 512), (h, im.mode)
        stem = f"x{h[:12]}"
        also = (f" The same frame is {st['file']} in the stenosis task (sha256 {r['sha256'][:16]}...)." if st else
                f" (sha256 {r['sha256'][:16]}...).")
        ds = wrap_2d(a, tag="arcade", stem=stem, study_key=stem, modality="XA", sop_class=SC_SOP_CLASS, patient_id=ax.code_of(h),
                     study_desc="Coronary angiography", series_desc="Coronary angiogram, single frame", series_number=1,
                     attrs={"BodyPartExamined": "HEART",
                            "DerivationDescription": (f"{sy['file']} of the ARCADE dataset (Zenodo 10.5281/zenodo.10390295): 512 x 512 8-bit PNG "
                                                      "made by the dataset authors from the source angiogram (DICOM metadata removed by them); "
                                                      "wrapped unchanged as DICOM Secondary Capture." + also)})
        skey = f"{ax.SOURCE['id']}:{h[:12]}"
        sr = bx._place(build_series([bx.to_item(ds, f"{h[:12]}.png")], {"region": "heart", "role": "diagnostic",
                                                                         "roleNote": "Single contrast-filled frame of an invasive coronary angiogram (PNG) wrapped as DICOM."}, skey),
                       ("One contrast-filled frame of an invasive coronary angiogram, 8-bit, 512 x 512 px as distributed. The projection angle and "
                        "the pixel size are not given, so distances are not measurable and no orientation letters are shown."))
        results.append((sr, skey, {"sourceId": ax.SOURCE["id"],
                                   "linkage": (f"Frame {sy['file']}" + (f" (also {st['file']}; " if st else " (") + f"image sha256 {r['sha256'][:12]}). "
                                               "The dataset publishes no patient identifiers (1,500 patients for 3,000 frames over both tasks, up to 12 frames per patient), "
                                               "so another image of this pack or of the first round may come from the same patient; each image is its own hold-out group.")}))
        sop = str(ds.SOPInstanceUID)
        by_cat: dict[str, list] = collections.defaultdict(list)
        for an in sy["anns"]:
            by_cat[an["cat"]].append(an)
        for cat, ans in by_cat.items():
            suffix, name = ax.SEG[cat]
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
                          "planes": [{"sopInstanceUid": sop, "frame": 1, "polygons": [ax._ring(ax._poly(x["seg"])) for x in ans]}]})
        if st:
            for n, (an, ss) in enumerate(zip(st["anns"], r["stenosisSegments"]), 1):
                tid = f"arcade-{h[:10]}_stenosis-{n}"
                where = f" Most of the region lies in {ax.SEG[ss['best']][1].lower()} (SYNTAX segment {ss['best']})." if ss["bestOverlap"] >= 0.5 else ""
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
                              "planes": [{"sopInstanceUid": sop, "frame": 1, "polygons": [ax._ring(ax._poly(an["seg"]))]}]})
    log(f"[{PACK_ID}] {len(results)} frames, {len(targets)} targets")
    return results, targets, geoms, {}


SOURCE = dict(ax.SOURCE)
bx.PACKS[PACK_ID] = {
    "title": "Coronary angiography, second set: vessel segments and narrowings marked by cardiologists",
    "description": ("More invasive coronary angiograms (single contrast-filled frames, 512 x 512 px) from the ARCADE dataset, one case per image, each with "
                    "the SYNTAX vessel segments outlined by interventional cardiologists (one initial annotator, cross-validated by two senior doctors); "
                    "on part of the frames the narrowings of 50% or more are marked as regions as well. Right and left coronary systems in many "
                    "projections. No pixel size or projection angle is distributed."),
    "sources": [SOURCE], "builder": ax._check_leak(build_arcade2), "budget": 25_000_000,
}


def qc_record() -> None:
    path = bx.DOCS_DIR / f"{PACK_ID}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / PACK_ID / "pack.json").read_text(encoding="utf-8"))
    sel = json.loads(SELECTION2.read_text(encoding="utf-8"))
    data["qcReview"] = {
        "tool": "scripts/data/qc_render.py arcade-xca-2 <outDir> (decodes the packed DICOM and draws every target) plus pre-build overlay sheets for the segment-only frames",
        "selectionRule": (f"A: {sel['caseA']} frames in both ARCADE tasks that passed round one's review and were not packed there. "
                          f"B: {sel['caseB']} syntax-only frames, taken at even steps through the md5-ordered pool of frames with at least four segments "
                          f"(36 right / 60 left drawn and reviewed by eye), then thinned to {N_SO_RIGHT} right / {N_SO_LEFT} left for the file budget."),
        "kept": len(man["subjects"]), "droppedAfterReview": DROPPED2,
        "leakCheck": "study/series descriptions, role and display notes and PatientID checked against LEAK (dataset names, diagnoses) at build",
    }
    bx.dump_json(data, path)


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/arcade_xca_2.py; lessons scripts/lessons/arcade_xca_2.py")
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
