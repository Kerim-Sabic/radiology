"""Lessons for the second AI layer of the heart-ct pack (higher-resolution chambers + coronary arteries).

  python scripts/lessons/heart_ct_ai2.py

lessons.json is the source of truth: this script edits it in place and is idempotent (it never regenerates the pack's lessons).
It (1) points each case's chamber task at the new outlines (and adds the chamber task to the scans that had none), (2) adds a
self-review task 'Find the coronary arteries' on the scans whose coronary outline passed the checks, (3) updates the case
summaries and notes. Run after scripts/data/heart_ct_ai2.py add.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))
from common import PACKS_DIR, dump_json  # noqa: E402

PACK = PACKS_DIR / "heart-ct"
CH = ["heart_atrium_right", "heart_ventricle_right", "heart_atrium_left", "heart_ventricle_left", "heart_myocardium"]
CHAMBER_MARK = "Four chambers on an axial slice at the level of the ventricles"
CORONARY_NOTES = (
    "The coronary arteries are thin vessels, only 2 to 4 mm wide, that run in the fat of the grooves around the heart. The right "
    "coronary artery leaves the right side of the aortic root and runs in the groove between the right atrium and the right ventricle, "
    "then along the lower surface of the heart. The left main artery leaves the left side of the root and divides at once: the left "
    "anterior descending artery runs forward in the groove between the two ventricles towards the apex, and the circumflex artery "
    "runs back in the groove between the left atrium and the left ventricle. They are seen best on a contrast-enhanced scan that is "
    "timed to the heartbeat (heart-gated); on a routine chest CT they blur with the motion and a short piece is all that shows, so "
    "scroll slowly and follow the artery from slice to slice rather than judge it on one image."
)
CORONARY_EXPLANATION = (
    CORONARY_NOTES + " The outline offered as a hint is an unreviewed AI draft: it is one outline for the whole tree (it does not name the "
    "branches), it may miss small branches or include a small error, and it is not a reference."
)
PLAIN_TAIL = (" The AI chamber outlines on this scan are estimated from shape and position, because blood and heart muscle have almost the "
              "same density.")


def hint(level, text, action=None):
    h = {"level": level, "text": text}
    if action:
        h["action"] = action
    return h


def main() -> None:
    pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
    ids = {t["id"] for t in pack["referenceTargets"]}
    L = json.loads((PACK / "lessons.json").read_text(encoding="utf-8"))
    tasks = L["tasks"]
    by_id = {t["id"]: t for t in tasks}
    case_tasks: dict[str, list] = {}
    for t in tasks:
        case_tasks.setdefault(t["caseId"], []).append(t)
    changed = {"chamberHint": 0, "chamberNew": 0, "coronary": 0}
    new_tasks: list[tuple[str, dict]] = []
    for case in L["cases"]:
        cid = case["id"]
        code = cid.split("-", 1)[1]
        ai2 = [i for i in ids if i.startswith(f"{cid}-ai2-")]
        if not ai2:
            continue
        ch_ids = [f"{cid}-ai2-{c.replace('_', '-')}" for c in CH]
        have_ch = all(i in ids for i in ch_ids)
        cor_id = f"{cid}-ai2-coronary-arteries"
        have_cor = cor_id in ids
        plain = not (case["referenceSummary"].find("enhanced with intravenous contrast") >= 0)
        base_task = case_tasks[cid][0]
        base = {k: copy.deepcopy(base_task[k]) for k in ("caseId", "modes", "seriesUids", "start", "scoring", "allowUncertain")}
        # ------------------------------------------------------------ chambers task
        ct = by_id.get(f"{cid}:chambers")
        if ct and have_ch:
            for h in ct["hints"]:
                if h.get("action", {}).get("type") == "showRegion":
                    if h["action"]["targetIds"] != ch_ids:
                        h["action"]["targetIds"] = ch_ids
                        changed["chamberHint"] += 1
        elif have_ch and not ct:
            ref = by_id["hct-s0738:chambers"]
            t = {**base, **{k: copy.deepcopy(v) for k, v in ref.items() if k not in base}}
            t["id"] = f"{cid}:chambers"
            for h in t["hints"]:
                if h.get("action", {}).get("type") == "showRegion":
                    h["action"]["targetIds"] = ch_ids
                    if plain:
                        h["text"] = ("Showing unreviewed AI outlines of the chambers and the left ventricular muscle (drafts, not a reference). "
                                     "Blood and muscle look the same on this scan, so the boundaries are estimated from shape and position.")
            if plain:
                t["prompt"] += (" On this scan blood and heart muscle look almost the same, so use where each chamber sits (front, back, "
                                "left, right) rather than how bright it is.")
                for r in t["rubric"]:
                    if r["id"] == "contrast":
                        r["text"] = "Noted that without clear contrast the chambers cannot be separated by brightness, only by position and shape"
            new_tasks.append((cid, t))
            changed["chamberNew"] += 1
        # ------------------------------------------------------------ coronary task
        if have_cor and f"{cid}:coronary" not in by_id:
            ref = by_id["hct-s0738:chambers"]
            t = {**base, **{k: copy.deepcopy(ref[k]) for k in ("bookAnchors", "objectiveIds", "skillDimensions")}}
            t.update({
                "id": f"{cid}:coronary", "type": "find_structure", "title": "Find the coronary arteries",
                "prompt": ("Scroll through the heart and find the coronary arteries in the fat around it: the right coronary artery in the groove between "
                           "the right atrium and the right ventricle, and on the left the left anterior descending artery (in front, between the ventricles) "
                           "and the circumflex artery (behind, between the left atrium and the left ventricle). Say which artery you are following."),
                "targets": [], "grading": {"kind": "self_review"},
                "hints": [
                    hint(1, "Start at the aortic root and look for small round or tubular dots in the fat just outside the heart muscle, then follow them from slice to slice."),
                    hint(2, "The right coronary artery runs in the groove on the right of the heart, next to the right atrium; the left anterior descending artery runs down the front between the two ventricles."),
                    hint(4, "Showing an unreviewed AI outline of the coronary arteries (a draft that may miss branches or include small errors; not a reference).",
                         {"type": "showRegion", "targetIds": [cor_id]}),
                    hint(5, "Reveal the explanation.", {"type": "reveal"}),
                ],
                "explanation": CORONARY_EXPLANATION,
                "rubric": [
                    {"id": "rca", "text": "Right coronary artery followed in the groove on the right of the heart (between the right atrium and ventricle)", "weight": "essential", "category": "location"},
                    {"id": "lad", "text": "Left anterior descending artery followed down the groove between the ventricles at the front", "weight": "essential", "category": "location"},
                    {"id": "lcx", "text": "Circumflex artery followed in the groove behind, between the left atrium and the left ventricle", "weight": "supportive", "category": "location"},
                    {"id": "ai", "text": "Treated the AI outline as an unreviewed rough guide that does not name the branches", "weight": "supportive", "category": "limitation"},
                ],
            })
            new_tasks.append((cid, t))
            changed["coronary"] += 1
        # ------------------------------------------------------------ case text
        n_ai = len(ai2)
        kinds = "heart chambers, left ventricular muscle, pulmonary arteries" + (", coronary arteries" if have_cor else "")
        sent = (f"{n_ai} further outlines ({kinds}) are unreviewed AI drafts that pass automatic checks; they are never graded.")
        s = case["referenceSummary"]
        s = re.sub(r"\d+ further outlines \(heart chambers[^)]*\) are unreviewed AI drafts that pass automatic checks; they are never graded\.", sent, s)
        s = s.replace("No AI outlines were kept for this scan.", sent)
        if plain and PLAIN_TAIL not in s:
            s = s.replace("chambers cannot be separated.", "chambers cannot be separated by density." + PLAIN_TAIL, 1)
        case["referenceSummary"] = s
        if have_ch and CHAMBER_MARK not in case["learnNotes"]:
            case["learnNotes"] = case["learnNotes"].replace(
                " Look at the blood inside the aorta", " " + CHAMBER_NOTES_TEXT + " Look at the blood inside the aorta", 1)
        if have_cor and CORONARY_NOTES not in case["learnNotes"]:
            case["learnNotes"] += " " + CORONARY_NOTES
    # insert the new tasks after the last task of their case
    for cid, t in new_tasks:
        pos = max(i for i, x in enumerate(tasks) if x["caseId"] == cid)
        tasks.insert(pos + 1, t)
    dump_json(L, PACK / "lessons.json")
    print(changed)


CHAMBER_NOTES_TEXT = (
    "Four chambers on an axial slice at the level of the ventricles: the right ventricle is the most anterior chamber, directly behind "
    "the sternum; the right atrium forms the right border of the heart; the left atrium is the most posterior chamber, in front of the "
    "esophagus and descending aorta, with the pulmonary veins entering its back corners; the left ventricle lies to the left, with the "
    "thickest wall. The interventricular septum separates the ventricles. The aortic root sits in the middle, between the chambers. "
    "With contrast, the blood is bright and the muscle grey; without it, blood and muscle are almost the same density and the "
    "chambers cannot be told apart (Learning Radiology, Ch. 3)."
)

if __name__ == "__main__":
    main()
