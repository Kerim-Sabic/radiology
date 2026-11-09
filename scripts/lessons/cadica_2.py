"""Lessons for the cadica-xca-2 pack (second round; copy of scripts/lessons/cadica.py, which is not modified): invasive coronary angiogram frames with lesion boxes drawn by cardiologists (CADICA dataset).

  python scripts/lessons/cadica.py

Every graded answer comes from the dataset's own boxes as stored in the built pack.json (lessons.json is the source of truth after
this one run; edit it directly):
  * "Find the narrowing": boxes of the categories 50-69% and above are required, milder boxes (under 50%) are accepted but not required;
    a frame with no required box is a "no narrowing of 50% or more" frame (graded correct when nothing is marked). Graded by the centre of
    the mark falling inside the box. The boxes are rectangles around a narrowing, not outlines, and are loose.
  * "Is there a narrowing of 50% or more?": yes where a box of 50-69% or more exists on the frame; no on frames of non-lesion videos and on
    frames carrying only milder boxes. Limitation said in the explanation: one projection only, the dataset boxes only what its cardiologists saw.
  * "How tight is the tightest narrowing?": the highest category among the frame's boxes, grouped in four bands.
  * "Which coronary artery was injected?": from the dataset's own list of left and right coronary videos (CADICAprojections.json).
Teaching text is our own. Neutral titles "Patient <code> · Coronary angiogram" use codes from XAA on, after the codes in use. The pack has no
chapter in the course book, so cases and tasks carry no book anchors.
"""
from __future__ import annotations

import json
import os
import re
import sys
from itertools import product
from pathlib import Path
from string import ascii_uppercase

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS, Pack, hint, write_lessons  # noqa: E402

PACK_ID = "cadica-xca-2"
SELECTION = Path(os.environ.get("RADIOLOGY_CADICA_SELECTION", "C:/Users/kerim/radiology-data/cadica/x/selection2.json"))
ORDER = ["p0_20", "p20_50", "p50_70", "p70_90", "p90_98", "p99", "p100"]
SIG = {"p50_70", "p70_90", "p90_98", "p99", "p100"}
BAND_OF = {"p0_20": "lt50", "p20_50": "lt50", "p50_70": "b50", "p70_90": "b70", "p90_98": "b90", "p99": "b90", "p100": "b90"}
BAND_TEXT = {"lt50": "Under 50%", "b50": "50 to 69%", "b70": "70 to 89%", "b90": "90% or more, up to total occlusion"}


def _used_codes() -> set[str]:
    out = set()
    for lj in PACKS.glob("*/lessons.json"):
        if lj.parent.name == PACK_ID:
            continue
        for c in json.loads(lj.read_text(encoding="utf-8"))["cases"]:
            m = re.match(r"Patient (\w+) ·", c.get("neutralTitle") or "")
            if m:
                out.add(m.group(1))
    return out


def _codes():
    used = _used_codes()
    for p in product(ascii_uppercase, repeat=3):
        c = "".join(p)
        if c >= "XAA" and c not in used:
            yield c


CODES = _codes()

STENOSIS_NOTES = (
    "A coronary stenosis is a narrowing of the lumen of an artery, most often from atherosclerotic plaque in the wall. An invasive "
    "angiogram shows only the lumen, filled with contrast, so a stenosis appears where the dark column of contrast becomes narrower than the "
    "normal vessel next to it: a short pinch, a long tapering, or an irregular edge. Its degree is the percentage loss of diameter against that "
    "normal reference; a narrowing of 70% or more is generally treated as obstructive and one of 50 to 69% as intermediate, where the picture alone "
    "predicts poorly whether blood flow is limited. Whether a narrowing limits flow also depends on its length, its place and the territory it "
    "supplies, which a single frame cannot tell you. A 99% narrowing leaves a hair-thin channel; in a total occlusion the vessel stops and may be "
    "filled further on from other arteries. Pitfalls: a vessel seen end-on or overlapped by another vessel hides or imitates a narrowing, so every "
    "artery is looked at in several projections; the catheter tip, the spine and the diaphragm can cover part of a vessel; and slow filling or poor "
    "mixing of contrast can make a normal vessel look pinched. This is teaching material, not a diagnosis."
)
BOX_NOTES = (
    "In this pack each narrowing is marked by a box that the dataset's cardiologists drew around it, with the degree of narrowing as a category. "
    "A box says where the narrowing is, not where its edges are: it is loose, it is often larger than the narrowing, and the same lesion's box "
    "changes size from frame to frame. A mark is graded correct when it falls inside the box. The dataset states neither how many cardiologists "
    "labelled it nor how well they agreed, gives no pixel size and no projection angle, so nothing here can be measured in millimetres."
)
SYSTEM_NOTES = (
    "Two arteries arise from the aortic root. The right coronary artery is usually a single long vessel that runs down the right side of the heart and "
    "curves under it to the back wall. The left main artery is a short trunk that divides into the left anterior descending artery (down the front of "
    "the heart towards the apex, with diagonal branches) and the left circumflex artery (round the left side, with obtuse marginal branches); sometimes "
    "a third, intermediate branch arises between them."
)


def box_info(t: dict) -> dict:
    m = re.search(r"Category (\S+) \(", t["provenanceDetail"]["note"])
    return {"id": t["id"], "cat": m.group(1)}


def main() -> None:
    pack = Pack(PACK_ID)
    sel = {f"{r['p']}_{r['v']}_{r['f'].rsplit('_', 1)[1]}": r for r in json.loads(SELECTION.read_text(encoding="utf-8"))["cases"]}
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        r = sel[subj["sourceSubjectId"]]
        right = r["group"] == "right"
        tg = sorted((box_info(t) for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]), key=lambda b: b["id"])
        sig = [b for b in tg if b["cat"] in SIG]
        mild = [b for b in tg if b["cat"] not in SIG]
        worst = max((b["cat"] for b in tg), key=ORDER.index) if tg else None
        band = BAND_OF[worst] if worst else None
        cid = f"cadica-{subj['key'].rsplit(':', 1)[1].replace('_', '-')}"
        if sig:
            kind = "significant"
            title = f"Narrowing of {BAND_TEXT[band].lower()} of the {'right' if right else 'left'} coronary system (expert box)" if band != "b90" else \
                f"Severe narrowing or occlusion in the {'right' if right else 'left'} coronary system (expert box)"
            diff = "intro" if band == "b90" else "typical" if band == "b70" else "subtle"
            ref = (f"{len(tg)} box(es) were drawn by the dataset's cardiologists on this frame; the tightest narrowing is in the category {BAND_TEXT[band].lower()}. "
                   "The boxes are rectangles around a narrowing, not outlines.")
        elif mild:
            kind = "mild"
            title = f"Only mild irregularity of the {'right' if right else 'left'} coronary system (expert box, under 50%)"
            diff = "typical"
            ref = ("The dataset's cardiologists boxed only milder lesions (under 50%) on this frame; there is no narrowing of 50% or more to find here. "
                   "The boxes are rectangles around a lesion, not outlines.")
        else:
            kind = "none"
            title = f"No labelled narrowing in the {'right' if right else 'left'} coronary system"
            diff = "typical"
            ref = ("This frame comes from a run that the dataset lists as having no visible lesion; no box is drawn. Other runs of the same patient may show lesions.")
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {next(CODES)} · Coronary angiogram", "learnTitle": title,
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["heart"],
            "clinicalContext": "Patient having invasive coronary angiography.",
            "contextSource": "Dataset description (one hospital's catheterisation laboratory); individual histories are in the dataset's spreadsheet and are not used here.",
            "difficulty": diff, "objectiveIds": [], "bookAnchors": [],
            "referenceSummary": ref + " Single hospital, 42 patients; a single frame of a run filmed at 10 frames per second. The projection angle is not distributed.",
            "learnNotes": SYSTEM_NOTES + " " + STENOSIS_NOTES + " " + BOX_NOTES,
        })
        targets = [{"targetId": b["id"], "name": "Narrowing" if b["cat"] in SIG else "Milder narrowing", "required": b["cat"] in SIG} for b in tg]
        grading = {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1, "inPlaneToleranceMm": 8, "allowNoFinding": True}
        hints = [hint(1, "Follow each artery from the catheter outwards and compare the width of the contrast column with the normal vessel beside it."),
                 hint(2, "Look for a short pinch, a long tapering or an irregular edge, in the main arteries first and then the larger branches.")]
        if sig:
            top = max(sig, key=lambda b: ORDER.index(b["cat"]))
            hints.append(hint(3, "Jumping to the cardiologists' box.", {"type": "jumpToTarget", "targetId": top["id"]}))
        hints.append(hint(5, "Reveal the reference answer.", {"type": "reveal"}))
        expl = {"significant": "On this frame the box" + ("es are" if len(sig) > 1 else " is") + " the cardiologists' marking of the narrowing" + ("s" if len(sig) > 1 else "") +
                               (" (shown too: milder lesions they boxed, which need not be marked)." if mild else "."),
                "mild": "The only boxes on this frame mark lesions the cardiologists put under 50%; there is no narrowing of 50% or more here, so marking nothing is correct. Marking a mild lesion is accepted.",
                "none": "No lesion is labelled on this frame, so marking nothing is correct. A different projection of the same artery could still show a narrowing that this view hides."}[kind]
        tasks.append({
            "id": f"{cid}:find", "caseId": cid, "type": "locate_finding", "title": "Find the narrowing",
            "prompt": "Read this coronary angiogram. Mark every narrowing of an artery of 50% or more that you find (point or box), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
            "targets": targets, "grading": grading, "scoring": "authoritative", "hints": hints,
            "explanation": STENOSIS_NOTES + " " + expl + " " + BOX_NOTES,
            "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
        })
        yes = bool(sig)
        why_no = {"mild": "The cardiologists boxed only lesions they put under 50% on this frame.",
                  "none": "This frame comes from a run in which the dataset's cardiologists saw no lesion."}
        tasks.append({
            "id": f"{cid}:significant", "caseId": cid, "type": "describe_finding", "title": "Is there a significant narrowing in this angiogram?",
            "prompt": "Look at the filled arteries on this single frame. Is there a narrowing of an artery of 50% or more of its diameter?",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "yes", "text": "Yes, at least one narrowing of 50% or more", "correct": yes,
                 "why": ("The dataset's cardiologists boxed a narrowing of 50% or more on this frame." if yes else "No narrowing of 50% or more is boxed on this frame.")},
                {"id": "no", "text": "No narrowing of 50% or more on this frame", "correct": not yes,
                 "why": ("The dataset's cardiologists boxed a narrowing of 50% or more on this frame." if yes else why_no[kind])}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Scan every artery for a place where the contrast column gets clearly narrower than the vessel next to it.")],
            "explanation": ("The answer comes from the dataset's own labels for this frame. It is a statement about this one projection: an artery can look normal in one view "
                            "and narrowed in another, which is why several views are taken, and the dataset only boxes what its cardiologists saw. " + STENOSIS_NOTES),
            "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["interpretation", "finding_localization"], "allowUncertain": True,
        })
        if tg:
            tasks.append({
                "id": f"{cid}:severity", "caseId": cid, "type": "describe_finding", "title": "How tight is the tightest narrowing?",
                "prompt": "The cardiologists boxed one or more lesions on this frame. In which band is the degree of narrowing of the tightest one?",
                "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": k, "text": v, "correct": k == band,
                     "why": (f"The tightest box on this frame is in the category {v.lower()}." if k == band else "The tightest box on this frame is in a different band.")}
                    for k, v in BAND_TEXT.items()]},
                "scoring": "authoritative",
                "hints": [hint(1, "Compare the width of the contrast column at its narrowest point with the normal vessel just before it.")],
                "explanation": ("The degree of narrowing is the percentage loss of diameter against the normal reference vessel. The dataset gives it as a category per box "
                                "(under 20%, 20-49%, 50-69%, 70-89%, 90-98%, 99%, 100%), grouped into four bands here. Visual estimates vary a lot between observers, "
                                "above all for intermediate lesions of 40 to 70%, which is why the bands are wide. " + STENOSIS_NOTES),
                "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        tasks.append({
            "id": f"{cid}:system", "caseId": cid, "type": "describe_finding", "title": "Which coronary artery was injected?",
            "prompt": "Look at which vessels are filled with contrast and where the catheter tip lies. Which coronary system is shown?",
            "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "right", "text": "The right coronary artery and its branches", "correct": right,
                 "why": ("The dataset lists this run among its right coronary artery videos." if right else "The dataset lists this run among its left coronary artery videos.")},
                {"id": "left", "text": "The left main artery with the left anterior descending and circumflex arteries", "correct": not right,
                 "why": ("The dataset lists this run among its left coronary artery videos." if not right else "The dataset lists this run among its right coronary artery videos.")}]},
            "scoring": "authoritative",
            "hints": [hint(1, "The right coronary artery is one long vessel that curves down the right side of the heart; the left main artery divides into two or three vessels.")],
            "explanation": SYSTEM_NOTES, "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["anatomy", "interpretation"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    main()
