"""Invasive coronary angiograms with lesion boxes (`cadica-xca`): the CADICA dataset (Mendeley Data p9bpx9ctcv, CC BY 4.0).

  python scripts/data/cadica.py select    # survey every lesion/non-lesion video, choose frames, write selection.json (+ overlay sheets)
  python scripts/data/cadica.py sheets    # draw the chosen frames with their boxes, 12 per sheet, for the by-eye review
  python scripts/data/cadica.py build     # write public/packs/cadica-xca (+ docs/data/cadica-xca-build-qc.json, index entry)
  python scripts/data/cadica.py index     # refresh the index entry after the lessons are written

Source: CADICA.zip version 5 of the open Mendeley Data record (sha256 checked against the record's file listing), extracted to
RADIOLOGY_CADICA_DIR (default C:/Users/kerim/radiology-data/cadica/x/CADICA). Raw data is untrusted: this script only reads PNG and
text files from it, and nothing from it is committed.

What CADICA is: 42 patients of one hospital (Malaga), Siemens Artis Zee, DICOM videos at 10 frames/s converted to 512 x 512 8-bit PNG.
"Selected" videos are the ones the medical team judged readable; `selectedFrames.txt` lists the key frames with enough contrast.
Lesions are labelled on key frames of lesion videos as a bounding box [x, y, w, h] plus a category giving the degree of narrowing
(p0_20 <20%, p20_50 20-49%, p50_70 50-69%, p70_90 70-89%, p90_98 90-98%, p99 99%, p100 total occlusion). The boxes are boxes
around the narrowing, not outlines, and they are loose and not exact from frame to frame. Frames of "non-lesion" videos carry no label.
Each chosen frame becomes one case (one image) wrapped unchanged as DICOM Secondary Capture, Modality XA.
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

CAD = Path(os.environ.get("RADIOLOGY_CADICA_DIR", "C:/Users/kerim/radiology-data/cadica/x/CADICA"))
SEL_DIR = CAD / "selectedVideos"
PACK_ID = "cadica-xca"
SELECTION = CAD.parent / "selection.json"
SHEETS = CAD.parent / "sheets"
ZIP_SHA256 = "ac945f946d076ac426975b9096d030df0b5a00ff5ac2c284eb5747b43dbad97b"

ORDER = ["p0_20", "p20_50", "p50_70", "p70_90", "p90_98", "p99", "p100"]
RANGE = {"p0_20": "less than 20%", "p20_50": "20-49%", "p50_70": "50-69%", "p70_90": "70-89%", "p90_98": "90-98%", "p99": "99%", "p100": "100% (total occlusion)"}
SIGNIFICANT = {"p50_70", "p70_90", "p90_98", "p99", "p100"}  # 50% or more
BAND = {"p50_70": "b1", "p70_90": "b2", "p90_98": "b3", "p99": "b4", "p100": "b4"}
QUOTA = {"b1": 10, "b2": 12, "b3": 12, "b4": 8}
N_MILD, N_NEG = 6, 12

SOURCE = {
    "id": "mendeley:CADICA",
    "name": "CADICA: a new dataset for coronary artery disease (invasive coronary angiography videos with lesion bounding boxes)",
    "url": "https://data.mendeley.com/datasets/p9bpx9ctcv/5",
    "doi": "10.17632/p9bpx9ctcv.5",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "citation": ("Jimenez-Partinen A, Molina-Cabello MA, Thurnhofer-Hemsi K, Palomo E, Rodriguez-Capitan J, Molina-Ramos AI, Jimenez-Navarro M. "
                 "CADICA: a new dataset for coronary artery disease detection by using invasive coronary angiography. Expert Systems 41(12), "
                 "e13708 (2024). doi:10.1111/exsy.13708. Data: Mendeley Data, doi:10.17632/p9bpx9ctcv.5 (earlier versions .1 and .2)."),
    "accessNote": (f"CADICA.zip of version 5 (3,076,112,179 bytes) downloaded without login or agreement from the open Mendeley Data record "
                   f"p9bpx9ctcv; sha256 {ZIP_SHA256} equals the record's file listing. Frames, lesion boxes, lists of lesion and non-lesion videos and "
                   "CADICAprojections.json read as distributed. The dataset owners (Universidad de Malaga) are credited as the licence requires "
                   "and have agreed to the use."),
}
LEAK = __import__("re").compile(b4.LEAK.pattern + r"|CADICA|Mendeley|Malaga|M\u00e1laga|Virgen|(?i:stenos|occlu|plaque|atheroscl|narrowing|lesion|ischemi)")

# ---------------------------------------------------------------------- review
# Reviewed on overlay sheets (box drawn on the frame, 12 per sheet): "p<patient>_v<video>_<frame>" -> reason.
DROPPED: dict[str, str] = {
    "p3_v4_00028": "non-lesion frame with poor vessel filling and heavy mottle: too little contrast to read as a normal example",
}


def frame_path(p: str, v: str, f: str) -> Path:
    return SEL_DIR / p / v / "input" / f"{f}.png"


def load_gray(path: Path) -> np.ndarray:
    from PIL import Image
    im = Image.open(path)
    a = np.ascontiguousarray(np.asarray(im.convert("L"), dtype=np.uint8))
    assert a.shape == (512, 512), (path, a.shape)
    return a


def read_boxes(p: str, v: str, f: str) -> list[tuple[int, int, int, int, str]]:
    out = []
    gt = SEL_DIR / p / v / "groundtruth" / f"{f}.txt"
    if gt.exists():
        for line in gt.read_text(encoding="utf-8").splitlines():
            t = line.split()
            if len(t) == 5:
                assert t[4] in ORDER, (gt, line)
                out.append((int(t[0]), int(t[1]), int(t[2]), int(t[3]), t[4]))
    return out


def contrast(a: np.ndarray, box: tuple[int, int, int, int] | None = None) -> float:
    """How well filled with contrast the frame (or the box region) is: spread between the dark vessel column and the background."""
    if box:
        x, y, w, h = box
        a = a[max(0, y):y + h, max(0, x):x + w]
    if a.size == 0:
        return 0.0
    return float(np.percentile(a, 92) - np.percentile(a, 6))


def survey() -> dict:
    """Every selected video: vessel group, key frames, boxes. Nothing is dropped here."""
    proj = json.loads((SEL_DIR / "CADICAprojections.json").read_text(encoding="utf-8"))
    group = {v: ("right" if k == "videosRCA" else "left") for k, vs in proj.items() for v in vs}
    vids = []
    for pdir in sorted((d for d in SEL_DIR.iterdir() if d.is_dir()), key=lambda d: int(d.name[1:])):
        p = pdir.name
        les = set((pdir / "lesionVideos.txt").read_text().split())
        non = set((pdir / "nonlesionVideos.txt").read_text().split())
        for v in sorted(les | non, key=lambda s: int(s[1:])):
            sf = pdir / v / f"{p}_{v}_selectedFrames.txt"
            frames = sf.read_text().split() if sf.exists() else []
            vids.append({"p": p, "v": v, "lesion": v in les, "group": group.get(f"{p}_{v}"), "frames": frames})
    return {"videos": vids}


def worst(boxes) -> str | None:
    return max((b[4] for b in boxes), key=ORDER.index) if boxes else None


def pick_frame(vid: dict, want_significant: bool | None) -> dict | None:
    """Best frame of a video: the labelled key frame whose box region carries the most contrast (lesion visible); for
    non-lesion videos the key frame with the best-filled vessels. want_significant True/False restricts to frames whose
    worst box is / is not 50% or more; frames carrying a mix of significant and mild boxes are skipped for 'significant'
    unless nothing else exists (a mild box that is not a target would be unmarked on the reveal)."""
    best = None
    for f in vid["frames"]:
        a = load_gray(frame_path(vid["p"], vid["v"], f))
        boxes = read_boxes(vid["p"], vid["v"], f)
        if vid["lesion"]:
            if not boxes:
                continue
            w = worst(boxes)
            sig = w in SIGNIFICANT
            if want_significant is not None and sig != want_significant:
                continue
            mixed = sig and any(b[4] not in SIGNIFICANT for b in boxes)
            area = max(b[2] * b[3] for b in boxes)
            if area > 160 * 160 or area < 12 * 12:  # an implausibly huge or tiny box is not a clear teaching frame
                continue
            sc = max(contrast(a, b[:4]) for b in boxes if (b[4] in SIGNIFICANT) == sig) - (30 if mixed else 0)
        else:
            if want_significant is not None:
                continue
            boxes, sc = [], contrast(a)
        if best is None or sc > best["score"]:
            best = {"p": vid["p"], "v": vid["v"], "f": f, "group": vid["group"], "boxes": boxes, "score": round(sc, 1),
                    "worst": worst(boxes), "lesionVideo": vid["lesion"]}
    return best


def select() -> list[dict]:
    sv = survey()
    vids = [v for v in sv["videos"] if v["group"]]
    rng = lambda s: hashlib.md5(s.encode()).hexdigest()  # noqa: E731  deterministic tie-breaking
    cand = {"b1": [], "b2": [], "b3": [], "b4": [], "mild": [], "neg": []}
    for vid in vids:
        if vid["lesion"]:
            fr = pick_frame(vid, True)
            if fr and f"{fr['p']}_{fr['v']}_{fr['f']}" not in DROPPED:
                cand[BAND[fr["worst"]]].append(fr)
            fr = pick_frame(vid, False)
            if fr and f"{fr['p']}_{fr['v']}_{fr['f']}" not in DROPPED:
                cand["mild"].append(fr)
        else:
            fr = pick_frame(vid, None)
            if fr and f"{fr['p']}_{fr['v']}_{fr['f']}" not in DROPPED:
                cand["neg"].append(fr)
    used_p = collections.Counter()
    chosen: list[dict] = []

    def take(key: str, n: int, cap: int) -> None:
        pool = cand[key]
        got = 0
        # fewest cases of the same patient first; one vessel group per patient before a second video of the same group
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
    for b, n in QUOTA.items():
        take(b, n, 2)
    take("mild", N_MILD, 2)
    take("neg", N_NEG, 2)
    chosen.sort(key=lambda r: (int(r["p"][1:]), int(r["v"][1:]), r["f"]))
    for r in chosen:
        a = load_gray(frame_path(r["p"], r["v"], r["f"]))
        r["sha256"] = hashlib.sha256(a.tobytes()).hexdigest()
    SELECTION.write_text(json.dumps({"zipSha256": ZIP_SHA256, "dropped": DROPPED, "pool": {k: len(v) for k, v in cand.items()}, "cases": chosen}, indent=1), encoding="utf-8")
    c = collections.Counter(r["kind"] for r in chosen)
    log(f"selected {len(chosen)} {dict(c)}; patients {len({r['p'] for r in chosen})}; left {sum(r['group'] == 'left' for r in chosen)} right {sum(r['group'] == 'right' for r in chosen)}")
    return chosen


def sheets() -> None:
    from PIL import Image, ImageDraw
    sel = json.loads(SELECTION.read_text(encoding="utf-8"))["cases"]
    SHEETS.mkdir(exist_ok=True)
    for n in range(0, len(sel), 12):
        sh = Image.new("RGB", (4 * 512, 3 * 512))
        for i, r in enumerate(sel[n:n + 12]):
            im = Image.fromarray(load_gray(frame_path(r["p"], r["v"], r["f"]))).convert("RGB")
            d = ImageDraw.Draw(im)
            for x, y, w, h, c in r["boxes"]:
                d.rectangle([x, y, x + w, y + h], outline=(255, 60, 60) if c in SIGNIFICANT else (255, 200, 0), width=2)
                d.text((x, max(0, y - 11)), c, fill=(255, 255, 0))
            d.text((6, 6), f"{r['p']}_{r['v']}_{r['f'][-5:]} {r['kind']} {r['group']}", fill=(0, 255, 0))
            sh.paste(im, ((i % 4) * 512, (i // 4) * 512))
        sh.resize((2048, 1536)).save(SHEETS / f"sheet{n // 12:02d}.png")
    log(f"wrote {(len(sel) + 11) // 12} sheets to {SHEETS}")


# ---------------------------------------------------------------------- build
def code_of(r: dict) -> str:
    return "ICA-" + r["sha256"][:8].upper()


def build_cadica() -> tuple[list, list, list, dict]:
    sel = json.loads(SELECTION.read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for r in sel["cases"]:
        a = load_gray(frame_path(r["p"], r["v"], r["f"]))
        fid = f"{r['p']}_{r['v']}_{r['f'].rsplit('_', 1)[1]}"
        stem = f"c{r['sha256'][:12]}"
        ds = wrap_2d(a, tag="cadica", stem=stem, study_key=stem, modality="XA", sop_class=SC_SOP_CLASS, patient_id=code_of(r),
                     study_desc="Coronary angiography", series_desc="Coronary angiogram, single frame", series_number=1,
                     attrs={"BodyPartExamined": "HEART",
                            "DerivationDescription": (f"Frame {r['f']} of video {r['p']}/{r['v']} of the CADICA dataset (Mendeley Data 10.17632/p9bpx9ctcv.5): 512 x 512 "
                                                      "8-bit PNG made by the dataset authors from the source angiogram (DICOM video, 10 frames/s); wrapped unchanged "
                                                      "as DICOM Secondary Capture.")})
        skey = f"{SOURCE['id']}:{fid}"
        sr = bx._place(build_series([bx.to_item(ds, f"{stem}.png")], {"region": "heart", "role": "diagnostic",
                                                                        "roleNote": "Single contrast-filled frame of an invasive coronary angiogram (PNG) wrapped as DICOM."}, skey),
                       ("One contrast-filled frame of an invasive coronary angiogram, 8-bit, 512 x 512 px as distributed. The projection angle and "
                        "the pixel size are not given, so distances are not measurable and no orientation letters are shown."))
        results.append((sr, skey, {"sourceId": SOURCE["id"], "holdout": f"{SOURCE['id']}:{r['p']}",
                                   "linkage": (f"Frame {r['f']} of video {r['v']} of dataset patient {r['p']} (42 patients). Several frames of this pack may come from the "
                                               f"same patient; they share the hold-out group {SOURCE['id']}:{r['p']}.")}))
        sop = str(ds.SOPInstanceUID)
        for n, (x, y, w, h, c) in enumerate(r["boxes"], 1):
            tid = f"cadica-{stem[1:11]}_lesion-{n}"
            targets.append({
                "id": tid, "label": "Coronary narrowing (expert box)" if c in SIGNIFICANT else "Milder coronary narrowing (expert box)", "classId": "finding:coronary_stenosis",
                "seriesUid": sr.uid, "geometryType": "box", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"mendeley:CADICA (selectedVideos/{r['p']}/{r['v']}/groundtruth/{r['f']}.txt, row {n}; frame {r['f']}.png)",
                    "method": ("Bounding box [x, y, w, h] drawn around the lesion by the team of cardiologists of the dataset (assisted by computer scientists), "
                               f"with the degree of narrowing as a category ({c}: {RANGE[c]}). It is a rectangle around the narrowing, not an outline of it; "
                               "converted to image_px [col0, row0, col1, row1] with (0,0) at the centre of the first pixel (shift of -0.5 px). "
                               "The dataset states neither the number of annotators nor an agreement figure."),
                    "note": f"Category {c} ({RANGE[c]} narrowing); box {w} x {h} px.",
                },
                "completeness": "target_only", "assessedClasses": ["finding:coronary_stenosis"],
                "unassessedNote": ("Only the boxes the dataset's cardiologists drew on this frame are referenced. Lesions they did not box, lesions in other "
                                   "projections and the exact margins of the narrowing are not; a real narrowing without a box here is not an error."),
                "review": dict(REVIEW),
                "teachingNote": f"The cardiologists' box around a narrowing of {RANGE[c]} of the lumen; it marks where, not the outline.",
            })
            geoms.append({"geometryType": "box", "space": "image_px",
                          "boxes": [{"sopInstanceUid": sop, "frame": 1, "box": [x - 0.5, y - 0.5, x + w - 0.5, y + h - 0.5]}]})
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
    "title": "Coronary angiography: find the narrowing, with and without one",
    "description": ("Invasive coronary angiograms (single contrast-filled frames, 512 x 512 px), one case per image, left and right coronary systems. "
                    "Most frames carry a box drawn by cardiologists around a narrowing of 50% or more, with the degree of narrowing as a category; "
                    "some frames show only milder irregularities and some come from runs with no lesion at all. The boxes are rectangles around the narrowing, "
                    "not outlines. No pixel size or projection angle is distributed."),
    "sources": [SOURCE], "builder": _check_leak(build_cadica), "budget": 60_000_000,
}


def qc_record() -> None:
    path = bx.DOCS_DIR / f"{PACK_ID}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / PACK_ID / "pack.json").read_text(encoding="utf-8"))
    sel = json.loads(SELECTION.read_text(encoding="utf-8"))
    data["qcReview"] = {
        "tool": "scripts/data/cadica.py sheets (chosen frames drawn with their boxes) and scripts/data/qc_render.py cadica-xca (decodes the packed DICOM and draws every target)",
        "selectionRule": ("Per video the labelled key frame whose box region carries the most contrast; at most 2 cases per patient; quotas by the worst category on the frame "
                          f"({QUOTA}), {N_MILD} frames with only milder lesions and {N_NEG} frames of non-lesion videos."),
        "pool": sel["pool"], "kept": len(man["subjects"]), "dropped": DROPPED,
        "leakCheck": "study/series descriptions, role and display notes and PatientID checked against LEAK (dataset names, diagnoses) at build",
    }
    bx.dump_json(data, path)


def index() -> None:
    bx.index([PACK_ID])
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] == PACK_ID:
            e["note"] = e["note"].replace("scripts/data/external.py + build_external.py", "scripts/data/cadica.py; lessons scripts/lessons/cadica.py")
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
