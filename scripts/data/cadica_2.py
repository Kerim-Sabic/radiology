"""Second round of coronary angiogram frames with lesion boxes (`cadica-xca-2`): the CADICA dataset, version 5 (Mendeley Data p9bpx9ctcv, CC BY 4.0).

  python scripts/data/cadica_2.py select    # choose frames not used in `cadica-xca`, write selection2.json (+ overlay sheets)
  python scripts/data/cadica_2.py sheets    # draw the chosen frames with their boxes, 12 per sheet, for the by-eye review
  python scripts/data/cadica_2.py build     # write public/packs/cadica-xca-2 (+ docs/data/cadica-xca-2-build-qc.json, index entry)
  python scripts/data/cadica_2.py index     # refresh the index entry after the lessons are written

Round one (`scripts/data/cadica.py`, unchanged and imported for the dataset readers, labels and wording) took one frame from each of 58 videos.
This round uses only videos that round one did not use, so no frame and no video repeats; the same patients may appear again (the dataset
has only 42), in another vessel or another run. Selection differs from round one in three ways: every frame of the 99-100% band that passes
the filter is taken (round one had only 6 of them), that band's box-size filter is relaxed (box area 8 x 8 to 220 x 220 px instead of 12 x 12
to 160 x 160), and at most 2 frames per patient in this round.
"""
from __future__ import annotations

import collections
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import cadica as cd  # noqa: E402  (round one; not modified)
from annotations import REVIEW  # noqa: E402
from build_external import build_series, log, wrap_2d  # noqa: E402

PACK_ID = "cadica-xca-2"
SELECTION2 = cd.CAD.parent / "selection2.json"
SHEETS2 = cd.CAD.parent / "sheets2"
QUOTA = {"b1": 10, "b2": 12, "b3": 12, "b4": 99}  # b4 (99-100%): every candidate
N_MILD, N_NEG = 6, 8
DROPPED: dict[str, str] = {  # by-eye review of the 63 chosen frames: boxes sit on arteries in all; two near-duplicates removed
    "p25_v8_00040": "near-duplicate of p25_v7_00043 (same patient, same view, same box)",
    "p32_v8_00021": "near-duplicate of p32_v5_00035 (same patient, same view, same box)",
}


def _used_videos() -> set[tuple[str, str]]:
    m = json.loads((bx.PACKS_DIR / "cadica-xca" / "pack.json").read_text(encoding="utf-8"))
    out = set()
    for s in m["subjects"]:
        p, v, _ = s["sourceSubjectId"].split("_")
        out.add((p, v))
    return out


def pick_frame(vid: dict, want_significant: bool | None, relax: bool = False, only_b4: bool = False) -> dict | None:
    lo, hi = (8 * 8, 220 * 220) if relax else (12 * 12, 160 * 160)
    best = None
    for f in vid["frames"]:
        a = cd.load_gray(cd.frame_path(vid["p"], vid["v"], f))
        boxes = cd.read_boxes(vid["p"], vid["v"], f)
        if vid["lesion"]:
            if not boxes:
                continue
            w = cd.worst(boxes)
            sig = w in cd.SIGNIFICANT
            if want_significant is not None and sig != want_significant:
                continue
            if only_b4 and w not in ("p99", "p100"):
                continue
            mixed = sig and any(b[4] not in cd.SIGNIFICANT for b in boxes)
            area = max(b[2] * b[3] for b in boxes)
            if area > hi or area < lo:
                continue
            sc = max(cd.contrast(a, b[:4]) for b in boxes if (b[4] in cd.SIGNIFICANT) == sig) - (30 if mixed else 0)
        else:
            if want_significant is not None:
                continue
            boxes, sc = [], cd.contrast(a)
        if best is None or sc > best["score"]:
            best = {"p": vid["p"], "v": vid["v"], "f": f, "group": vid["group"], "boxes": boxes, "score": round(sc, 1),
                    "worst": cd.worst(boxes), "lesionVideo": vid["lesion"]}
    return best


def select() -> list[dict]:
    used = _used_videos()
    vids = [v for v in cd.survey()["videos"] if v["group"] and (v["p"], v["v"]) not in used]
    rng = lambda s: hashlib.md5(s.encode()).hexdigest()  # noqa: E731
    cand = {"b1": [], "b2": [], "b3": [], "b4": [], "mild": [], "neg": []}
    for vid in vids:
        if vid["lesion"]:
            fr4 = pick_frame(vid, True, relax=True, only_b4=True)  # 99-100% frames: relaxed size filter
            if fr4 and fr4["f"] not in DROPPED:
                fr4["relaxed"] = max(b[2] * b[3] for b in fr4["boxes"]) > 160 * 160 or max(b[2] * b[3] for b in fr4["boxes"]) < 12 * 12
                cand["b4"].append(fr4)
            else:
                fr = pick_frame(vid, True)
                if fr and fr["f"] not in DROPPED:
                    fr["relaxed"] = False
                    cand[cd.BAND[fr["worst"]]].append(fr)
            fr = pick_frame(vid, False)
            if fr and fr["f"] not in DROPPED:
                cand["mild"].append(fr)
        else:
            fr = pick_frame(vid, None)
            if fr and fr["f"] not in DROPPED:
                cand["neg"].append(fr)
    used_p = collections.Counter()
    chosen: list[dict] = []

    def take(key: str, n: int, cap: int) -> None:
        pool, got = cand[key], 0
        while got < n:
            pool.sort(key=lambda r: (used_p[r["p"]], sum(1 for c in chosen if c["p"] == r["p"] and c["group"] == r["group"]), rng(f"{r['p']}{r['v']}{r['f']}")))
            pick = next((r for r in pool if used_p[r["p"]] < cap), None)
            if not pick:
                break
            pool.remove(pick)
            used_p[pick["p"]] += 1
            pick["kind"] = key
            chosen.append(pick)
            got += 1
    take("b4", QUOTA["b4"], 3)  # every 99-100% frame first (cap 3 per patient for this rare band)
    for b in ("b1", "b2", "b3"):
        take(b, QUOTA[b], 2)
    take("mild", N_MILD, 2)
    take("neg", N_NEG, 2)
    chosen.sort(key=lambda r: (int(r["p"][1:]), int(r["v"][1:]), r["f"]))
    for r in chosen:
        r["sha256"] = hashlib.sha256(cd.load_gray(cd.frame_path(r["p"], r["v"], r["f"])).tobytes()).hexdigest()
    pool = {k: len(v) + sum(1 for c in chosen if c["kind"] == k) for k, v in cand.items()}
    SELECTION2.write_text(json.dumps({"zipSha256": cd.ZIP_SHA256, "dropped": DROPPED, "pool": pool, "usedVideos": len(used), "cases": chosen}, indent=1), encoding="utf-8")
    c = collections.Counter(r["kind"] for r in chosen)
    log(f"pool {pool}; selected {len(chosen)} {dict(c)}; relaxed {sum(r.get('relaxed', False) for r in chosen)}; patients {len({r['p'] for r in chosen})}; "
        f"left {sum(r['group'] == 'left' for r in chosen)} right {sum(r['group'] == 'right' for r in chosen)}")
    return chosen


def sheets() -> None:
    from PIL import Image, ImageDraw
    sel = json.loads(SELECTION2.read_text(encoding="utf-8"))["cases"]
    SHEETS2.mkdir(exist_ok=True)
    for n in range(0, len(sel), 12):
        sh = Image.new("RGB", (4 * 512, 3 * 512))
        for i, r in enumerate(sel[n:n + 12]):
            im = Image.fromarray(cd.load_gray(cd.frame_path(r["p"], r["v"], r["f"]))).convert("RGB")
            d = ImageDraw.Draw(im)
            for x, y, w, h, c in r["boxes"]:
                d.rectangle([x, y, x + w, y + h], outline=(255, 60, 60) if c in cd.SIGNIFICANT else (255, 200, 0), width=2)
                d.text((x, max(0, y - 11)), c, fill=(255, 255, 0))
            d.text((6, 6), f"{n + i} {r['p']}_{r['v']}_{r['f'][-5:]} {r['kind']} {r['group']}", fill=(0, 255, 0))
            sh.paste(im, ((i % 4) * 512, (i // 4) * 512))
        sh.resize((2048, 1536)).save(SHEETS2 / f"sheet{n // 12:02d}.png")
    log(f"wrote {(len(sel) + 11) // 12} sheets to {SHEETS2}")


def build_cadica2() -> tuple[list, list, list, dict]:
    sel = json.loads(SELECTION2.read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for r in sel["cases"]:
        a = cd.load_gray(cd.frame_path(r["p"], r["v"], r["f"]))
        fid = f"{r['p']}_{r['v']}_{r['f'].rsplit('_', 1)[1]}"
        stem = f"c{r['sha256'][:12]}"
        ds = wrap_2d(a, tag="cadica", stem=stem, study_key=stem, modality="XA", sop_class=cd.SC_SOP_CLASS, patient_id=cd.code_of(r),
                     study_desc="Coronary angiography", series_desc="Coronary angiogram, single frame", series_number=1,
                     attrs={"BodyPartExamined": "HEART",
                            "DerivationDescription": (f"Frame {r['f']} of video {r['p']}/{r['v']} of the CADICA dataset (Mendeley Data 10.17632/p9bpx9ctcv.5): 512 x 512 "
                                                      "8-bit PNG made by the dataset authors from the source angiogram (DICOM video, 10 frames/s); wrapped unchanged "
                                                      "as DICOM Secondary Capture.")})
        skey = f"{cd.SOURCE['id']}:{fid}"
        sr = bx._place(build_series([bx.to_item(ds, f"{stem}.png")], {"region": "heart", "role": "diagnostic",
                                                                        "roleNote": "Single contrast-filled frame of an invasive coronary angiogram (PNG) wrapped as DICOM."}, skey),
                       ("One contrast-filled frame of an invasive coronary angiogram, 8-bit, 512 x 512 px as distributed. The projection angle and "
                        "the pixel size are not given, so distances are not measurable and no orientation letters are shown."))
        results.append((sr, skey, {"sourceId": cd.SOURCE["id"], "holdout": f"{cd.SOURCE['id']}:{r['p']}",
                                   "linkage": (f"Frame {r['f']} of video {r['v']} of dataset patient {r['p']} (42 patients). Several frames of this pack and of the first "
                                               f"round may come from the same patient; they share the hold-out group {cd.SOURCE['id']}:{r['p']}.")}))
        sop = str(ds.SOPInstanceUID)
        for n, (x, y, w, h, c) in enumerate(r["boxes"], 1):
            tid = f"cadica-{stem[1:11]}_lesion-{n}"
            targets.append({
                "id": tid, "label": "Coronary narrowing (expert box)" if c in cd.SIGNIFICANT else "Milder coronary narrowing (expert box)", "classId": "finding:coronary_stenosis",
                "seriesUid": sr.uid, "geometryType": "box", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"mendeley:CADICA (selectedVideos/{r['p']}/{r['v']}/groundtruth/{r['f']}.txt, row {n}; frame {r['f']}.png)",
                    "method": ("Bounding box [x, y, w, h] drawn around the lesion by the team of cardiologists of the dataset (assisted by computer scientists), "
                               f"with the degree of narrowing as a category ({c}: {cd.RANGE[c]}). It is a rectangle around the narrowing, not an outline of it; "
                               "converted to image_px [col0, row0, col1, row1] with (0,0) at the centre of the first pixel (shift of -0.5 px). "
                               "The dataset states neither the number of annotators nor an agreement figure."),
                    "note": f"Category {c} ({cd.RANGE[c]} narrowing); box {w} x {h} px.",
                },
                "completeness": "target_only", "assessedClasses": ["finding:coronary_stenosis"],
                "unassessedNote": ("Only the boxes the dataset's cardiologists drew on this frame are referenced. Lesions they did not box, lesions in other "
                                   "projections and the exact margins of the narrowing are not; a real narrowing without a box here is not an error."),
                "review": dict(REVIEW),
                "teachingNote": f"The cardiologists' box around a narrowing of {cd.RANGE[c]} of the lumen; it marks where, not the outline.",
            })
            geoms.append({"geometryType": "box", "space": "image_px",
                          "boxes": [{"sopInstanceUid": sop, "frame": 1, "box": [x - 0.5, y - 0.5, x + w - 0.5, y + h - 0.5]}]})
    log(f"[{PACK_ID}] {len(results)} frames, {len(targets)} targets")
    return results, targets, geoms, {}


bx.PACKS[PACK_ID] = {
    "title": "Coronary angiography, second set: find the narrowing, with and without one",
    "description": ("More invasive coronary angiograms (single contrast-filled frames, 512 x 512 px), one case per image, left and right coronary systems, "
                    "taken from videos not used in the first set. Most frames carry a box drawn by cardiologists around a narrowing of 50% or more, with the "
                    "degree of narrowing as a category, with more very tight (99% and total occlusion) examples; some frames show only milder irregularities and "
                    "some come from runs with no lesion at all. The boxes are rectangles around the narrowing, not outlines. No pixel size or projection angle is distributed."),
    "sources": [cd.SOURCE], "builder": cd._check_leak(build_cadica2), "budget": 25_000_000,
}


def qc_record() -> None:
    path = bx.DOCS_DIR / f"{PACK_ID}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / PACK_ID / "pack.json").read_text(encoding="utf-8"))
    sel = json.loads(SELECTION2.read_text(encoding="utf-8"))
    data["qcReview"] = {
        "tool": "scripts/data/cadica_2.py sheets (chosen frames drawn with their boxes) and scripts/data/qc_render.py cadica-xca-2",
        "selectionRule": ("Only videos not used in cadica-xca; per video the labelled key frame whose box region carries the most contrast; every 99-100% frame "
                          f"that passes the relaxed size filter, quotas {QUOTA} for the other bands, {N_MILD} milder-only and {N_NEG} non-lesion frames; at most 2 per patient (3 for 99-100%)."),
        "pool": sel["pool"], "kept": len(man["subjects"]), "dropped": sel["dropped"],
        "leakCheck": "study/series descriptions, role and display notes and PatientID checked against LEAK (dataset names, diagnoses) at build",
    }
    bx.dump_json(data, path)


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/cadica_2.py; lessons scripts/lessons/cadica_2.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    cmd = sys.argv[1:] or [""]
    if cmd[0] == "select":
        select()
        sheets()
    elif cmd[0] == "sheets":
        sheets()
    elif cmd[0] == "build":
        bx.build(PACK_ID)
        qc_record()
        index()
    elif cmd[0] == "index":
        qc_record()
        index()
    else:
        raise SystemExit(__doc__)
