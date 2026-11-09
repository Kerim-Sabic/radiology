"""Lessons for the arcade-xca pack: invasive coronary angiograms with the SYNTAX vessel segments and the narrowings
(50% or more) marked by interventional cardiologists (ARCADE dataset).

  python scripts/lessons/arcade_xca.py

Every graded answer comes from the dataset's own annotations as stored in the built pack.json:
  * "mark the narrowing": the experts' stenosis regions (findings task, graded by the centre of the mark falling inside);
  * "find segment X": the SYNTAX segment polygons (one point inside the named vessel segment);
  * "which coronary system" and "which segment is the narrowing in": read from the segment labels and from the overlap of the
    stenosis region with them (asked only when one segment clearly holds the region).
The dataset's labels do not cover every visible vessel or every narrowing (its paper says so), which each explanation says.
Teaching text is our own. Neutral titles continue the "Patient <code>" codes after the last code in use. This pack has no
chapter in the course book, so cases and tasks carry no book anchors. Earlier lessons are not touched.
"""
from __future__ import annotations

import json
import re
import sys
from itertools import product
from pathlib import Path
from string import ascii_uppercase

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS, Pack, hint, write_lessons  # noqa: E402

PACK_ID = "arcade-xca"


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
    for a, b in product(ascii_uppercase[4:], ascii_uppercase):
        if a + b not in used:
            yield a + b
    for p in product(ascii_uppercase, repeat=3):
        if "".join(p) not in used:
            yield "".join(p)


CODES = _codes()

STENOSIS_NOTES = (
    "A coronary stenosis is a narrowing of the lumen of an artery, most often from atherosclerotic plaque in the wall. An invasive "
    "angiogram shows only the lumen, filled with contrast, so a stenosis appears as a place where the bright column of contrast "
    "becomes narrower than the normal vessel next to it: a short pinch, a long tapering, or an irregular edge. Its degree is the "
    "percentage loss of diameter against that normal reference. The experts of this dataset marked regions with a narrowing of 50% "
    "or more in vessels at least 1.5 mm wide, judged with the angiography system's measuring software and by eye. Whether a "
    "narrowing limits blood flow also depends on its length, its place and the territory it supplies, which a single frame cannot "
    "tell you. Pitfalls: a vessel seen end-on or overlapped by another vessel hides or imitates a narrowing, so every artery is "
    "looked at in several projections; the catheter tip and the spine can cover the first centimetres of a vessel; and slow "
    "filling or poor mixing of contrast can make a normal vessel look pinched. The dataset does not label every visible narrowing "
    "or every vessel, so a narrowing you can see without a marked region is not necessarily a mistake. This is teaching material, "
    "not a diagnosis."
)
SYSTEM_NOTES = (
    "Two arteries arise from the aortic root. The right coronary artery is usually a single long vessel that runs down the right side of "
    "the heart and curves under it to the back wall; it gives the posterior descending artery and, in most people, the "
    "posterolateral branches. The left main artery is a short trunk that divides into the left anterior descending artery (down the "
    "front of the heart towards the apex, with diagonal branches) and the left circumflex artery (round the left side, with obtuse "
    "marginal branches); sometimes a third, intermediate branch arises between them. The SYNTAX score numbers the segments 1-4 and "
    "16-16c for the right system and 5-15 for the left; the numbers are what cardiologists use to say where a narrowing is."
)
SEG_ORDER = ["5", "6", "1", "2", "3", "7", "11", "13", "4", "8", "16"]  # the commonest segments, in teaching order
ASSESS_SEG = {"1", "5", "6"}  # clear anatomical landmarks; borders between the others are only approximate


def parse_seg(t: dict) -> tuple[str, str]:
    m = re.match(r"(.+) \(segment (\S+)\)$", t["label"])
    return m.group(2), m.group(1)


def parse_sten(t: dict) -> dict:
    m = re.search(r"area (\d+) px; best-overlapping SYNTAX segment (\S+) \((\d+)% of the region\)(?:, next (\S+) \((\d+)%\))?", t["provenanceDetail"]["note"])
    return {"area": int(m.group(1)), "best": m.group(2), "bestOv": int(m.group(3)) / 100, "second": m.group(4), "secondOv": int(m.group(5)) / 100 if m.group(5) else 0.0}


def main() -> None:
    pack = Pack(PACK_ID)
    cases, tasks = [], []
    used = {}
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        tg = [t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]]
        segs = {}
        for t in tg:
            if t["classId"].startswith("anatomy:"):
                n, name = parse_seg(t)
                segs[n] = (t["id"], name)
        stens = [(t, parse_sten(t)) for t in tg if t["classId"] == "finding:coronary_stenosis"]
        h = subj["sourceSubjectId"]
        cid = f"xca-{h[:10]}"
        right = set(segs) <= {"1", "2", "3", "4", "16", "16a", "16b", "16c"}
        system = "right" if right else "left"
        biggest = max(s["area"] for _, s in stens)
        n = len(stens)
        clean = [(t, s) for t, s in stens if s["bestOv"] >= 0.6 and s["secondOv"] <= 0.25]
        one = clean[0] if n == 1 and clean else None
        if one:
            title = f"Narrowing of the {segs[one[1]['best']][1][0].lower() + segs[one[1]['best']][1][1:]} (expert-marked region)"
        else:
            title = f"Narrowing{'s' if n > 1 else ''} of the {system} coronary system (expert-marked region)"
        diff = "intro" if n == 1 and biggest >= 2400 else "subtle" if biggest < 1000 else "typical"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {next(CODES)} · Coronary angiogram", "learnTitle": title,
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["heart"],
            "clinicalContext": "Patient having invasive coronary angiography.",
            "contextSource": "Dataset description (one hospital's catheterisation laboratory); no individual history is distributed.",
            "difficulty": diff, "objectiveIds": [], "bookAnchors": [],
            "referenceSummary": (f"The SYNTAX vessel segments ({len(segs)} outlined here) and {'the narrowing' if n == 1 else f'{n} narrowings'} of 50% or more were marked "
                                 "as polygons in CVAT by interventional cardiologists: one initial annotator for each image, cross-validated by two senior "
                                 "doctors, with the consensus as the label. The paper reports that the segment masks cover roughly 60-80% of the visible vessels and "
                                 "that annotators disagreed mostly at segment borders and on small vessels. The projection angle is not distributed."),
            "learnNotes": SYSTEM_NOTES + " " + STENOSIS_NOTES,
        })
        names = {t["id"]: "Narrowing" for t, _ in stens}
        tasks.append({
            "id": f"{cid}:stenosis", "caseId": cid, "type": "locate_finding", "title": "Find the narrowing" + ("s" if n > 1 else ""),
            "prompt": ("Read this coronary angiogram. Mark every narrowing of an artery of 50% or more that you find (point or box), or state that "
                       "you find none."),
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": names[t["id"]], "required": True} for t, _ in stens],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1, "inPlaneToleranceMm": 8,
                        "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Follow each artery from the catheter outwards and compare the width of the contrast column with the normal vessel beside it."),
                      hint(2, "Look for a short pinch, a long tapering or an irregular edge, in the main arteries first and then the larger branches."),
                      hint(3, "Jumping to the experts' region.", {"type": "jumpToTarget", "targetId": max(stens, key=lambda x: x[1]["area"])[0]["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": STENOSIS_NOTES + (" On this frame " + ("the region is " if n == 1 else "the regions are ") +
                                              "the experts' marking; counting is in image pixels because no pixel size is distributed."),
            "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
        })
        # segments: up to three of the commonest, the least used so far first
        present = [s for s in SEG_ORDER if s in segs]
        present.sort(key=lambda s: (used.get(s, 0), SEG_ORDER.index(s)))
        for s in sorted(present[:3], key=SEG_ORDER.index):
            used[s] = used.get(s, 0) + 1
            tid, name = segs[s]
            tasks.append({
                "id": f"{cid}:seg{s}", "caseId": cid, "type": "find_structure", "title": f"Find the {name[0].lower() + name[1:]} (segment {s})",
                "prompt": f"Place a mark inside the {name[0].lower() + name[1:]} (SYNTAX segment {s}).",
                "modes": ["learn", "practice"] + (["assess"] if s in ASSESS_SEG else []), "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
                "targets": [{"targetId": tid, "name": name, "required": True}],
                "grading": {"kind": "point_in_target", "slabToleranceMm": 1, "inPlaneToleranceMm": 6}, "scoring": "authoritative",
                "hints": [hint(1, ("Start at the catheter and find the vessel that arises from the aortic root, then follow it to the named part."
                                   if s in {"1", "5", "6"} else "Follow the vessel from its origin at the catheter and count the branches until you reach the named part.")),
                          hint(3, "Jumping to the segment.", {"type": "jumpToTarget", "targetId": tid}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": ("Graded against the cardiologists' SYNTAX segment outline: a mark inside it (or within 6 pixels of its edge) is correct. The borders "
                                "between neighbouring segments are drawn by convention at branches and bends and are only approximate, and no pixel size is distributed, "
                                "so the tolerance is in image pixels. " + SYSTEM_NOTES),
                "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["anatomy"], "allowUncertain": True,
            })
        # which coronary system
        tasks.append({
            "id": f"{cid}:system", "caseId": cid, "type": "describe_finding", "title": "Which coronary artery was injected?",
            "prompt": "Look at which vessels are filled with contrast and where the catheter tip lies. Which coronary system is shown?",
            "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "right", "text": "The right coronary artery and its branches", "correct": right,
                 "why": ("The experts outlined segments of the right system (1-4 and 16) on this frame." if right else
                         "The experts outlined segments of the left system on this frame, not the right coronary artery.")},
                {"id": "left", "text": "The left main artery with the left anterior descending and circumflex arteries", "correct": not right,
                 "why": ("The experts outlined the left main artery and its branches on this frame." if not right else
                         "The experts outlined segments of the right system on this frame.")},
                {"id": "both", "text": "Both systems, filled to the same extent", "correct": False,
                 "why": "Only one system is outlined on this frame; the other one is not filled enough to be segmented."}]},
            "scoring": "authoritative",
            "hints": [hint(1, "The right coronary artery is one long vessel that curves down the right side of the heart; the left main artery divides into two or three vessels.")],
            "explanation": SYSTEM_NOTES, "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["anatomy", "interpretation"], "allowUncertain": True,
        })
        # which segment holds the narrowing (only when one segment clearly does)
        if one:
            t, s = one
            best = s["best"]
            others = [k for k in segs if k not in (best, s["second"])]
            if len(others) >= 2:
                pick = sorted(others, key=lambda k: (abs(len(k) - len(best)), k))[:2]
                opts = sorted([best, *pick], key=lambda k: (int(re.match(r"\d+", k).group()), k))
                tasks.append({
                    "id": f"{cid}:where", "caseId": cid, "type": "describe_finding", "title": "In which segment is the narrowing?",
                    "prompt": "The marked narrowing lies in one SYNTAX segment. Which one?",
                    "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                    "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                    "grading": {"kind": "choice", "multiple": False, "options": [
                        {"id": k, "text": f"{segs[k][1]} (segment {k})", "correct": k == best,
                         "why": (f"{round(s['bestOv'] * 100)}% of the experts' narrowing region lies inside this segment." if k == best else
                                 "The experts' narrowing region does not lie in this segment.")} for k in opts]},
                    "scoring": "authoritative",
                    "hints": [hint(1, "Find the narrowing first, then follow the vessel back to its origin and name the part it sits in.")],
                    "explanation": ("Cardiologists describe a narrowing by its SYNTAX segment, because the segment says which myocardium depends on the vessel beyond it. "
                                    "The region was read against the segment outlines: most of it lies inside the segment named. " + SYSTEM_NOTES),
                    "bookAnchors": [], "objectiveIds": [], "skillDimensions": ["anatomy", "interpretation"], "allowUncertain": True,
                })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    main()
