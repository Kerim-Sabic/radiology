"""Lessons for the msd-heart-mri pack: the left atrium on 3D whole-heart cardiac MRI (Medical Segmentation Decathlon, Task02_Heart).

  python scripts/lessons/msd_heart.py

What is graded, and against what:
  * Find and name the left atrium: the dataset's own outline (left atrium with the appendage, the mitral plane and the pulmonary vein
    end points; segmented by an expert with an automated tool and manually corrected, provenance `source_automated`). It is not
    drawn from scratch, so the task is `exploratory_self_review`: the app compares the learner's mark with the outline and says so,
    but the score is not presented as authoritative.
  * Position questions (what lies in front of the left atrium, which chamber is most posterior, what drains into it): textbook
    anatomy that the images show on every case; they are self-review choice questions, not derived from the labels, and no finding
    or diagnosis is named.
Neutral titles continue the "Patient <code>" codes after the last code in use. Earlier lessons are not touched.
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
from conditions import anchors  # noqa: E402

PACK_ID = "msd-heart-mri"
OBJ = "ch03-o06"


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

LA_NOTES = (
    "The left atrium is the most posterior chamber of the heart. On an axial slice at the level of the aortic root it lies in the "
    "middle, directly behind the aortic root and in front of the descending aorta, the esophagus and the spine. Pulmonary veins enter "
    "it at its back corners: the two right veins pass behind the right atrium, the two left veins run in front of the descending "
    "aorta. The left atrial appendage is a small ear-shaped pouch that curves forward beside the pulmonary trunk on the left, and "
    "the mitral valve opens from the lower front of the atrium into the left ventricle. On this 3D whole-heart MRI the blood is "
    "bright, the heart muscle grey and the lungs dark, so scroll from the aortic root down to the four-chamber level and follow the "
    "bright pool behind the aorta (Learning Radiology, Ch. 3)."
)
OUTLINE_NOTE = (
    "The dataset's outline contains the blood pool of the atrium with its appendage and the stumps of the pulmonary veins; the "
    "atrial wall is not separated and the mitral valve plane is the lower border."
)
QUESTIONS = [
    ("in-front", "What lies directly in front of the left atrium at the level of the aortic root?",
     [("root", "The aortic root", True, "The aortic root sits in the middle of the heart directly in front of the left atrium."),
      ("spine", "The spine", False, "The spine is behind the left atrium, separated from it by the esophagus and the descending aorta."),
      ("liver", "The liver", False, "The liver lies below the heart; it is not in contact with the left atrium."),
      ("lung", "The right lung", False, "The right lung lies beside the heart, not in front of the left atrium.")],
     "At the level of the aortic root, the left atrium lies directly behind the aorta; it is the most posterior chamber."),
    ("enter", "Which vessels drain into the left atrium?",
     [("pv", "The pulmonary veins (usually four)", True, "Oxygenated blood comes back from the lungs through the pulmonary veins into the left atrium."),
      ("pa", "The pulmonary arteries", False, "The pulmonary arteries leave the right ventricle and carry blood to the lungs."),
      ("cava", "The superior and inferior venae cavae", False, "The venae cavae drain into the right atrium."),
      ("ao", "The aorta", False, "The aorta leaves the left ventricle; it does not drain into the left atrium.")],
     "The left atrium receives oxygenated blood from the lungs through the pulmonary veins, which enter at its back corners."),
    ("posterior", "Which of the four chambers is the most posterior, closest to the esophagus and the spine?",
     [("la", "The left atrium", True, "The left atrium lies behind the other chambers, in front of the esophagus."),
      ("ra", "The right atrium", False, "The right atrium forms the right border of the heart."),
      ("rv", "The right ventricle", False, "The right ventricle is the most anterior chamber, behind the sternum."),
      ("lv", "The left ventricle", False, "The left ventricle lies to the left and in front of the left atrium.")],
     "The left atrium is the most posterior chamber, which is why a large left atrium can indent the esophagus."),
]


def main() -> None:
    pack = Pack(PACK_ID)
    cases, tasks = [], []
    for n, subj in enumerate(pack.manifest["subjects"]):
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        tg = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        sid = subj["sourceSubjectId"]
        cid = f"msdh-{sid.replace('_', '-')}"
        code = next(CODES)
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Cardiac MRI",
            "learnTitle": "Cardiac MRI: the left atrium behind the aortic root",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": "Adult; 3D whole-heart MRI.",
            "contextSource": "Dataset description (whole-heart MRI of adults at a university hospital); no clinical history, age or sex is distributed.",
            "difficulty": "intro", "objectiveIds": [OBJ], "bookAnchors": anchors(OBJ),
            "referenceSummary": ("The left atrium is outlined by the dataset (King's College London, Medical Segmentation Decathlon): an expert "
                                 "segmented the left atrium, its appendage, the mitral plane and the pulmonary vein end points with an automated "
                                 "tool and then corrected the result by hand. It is semi-automatic and expert-corrected, not drawn from scratch, "
                                 "and has not been re-reviewed here. " + OUTLINE_NOTE + " The other chambers and vessels are not outlined. "
                                 "Scanner: 1.5 T, free breathing with ECG and respiratory gating, one cardiac phase; images acquired at 1.25 mm "
                                 "and shown as axial slices every 2.5 mm."),
            "learnNotes": LA_NOTES,
        })
        base = {"caseId": cid, "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None}, "scoring": "exploratory_self_review",
                "allowUncertain": True}
        tasks.append({
            **base, "id": f"{cid}:left-atrium", "type": "find_structure", "title": "Find the left atrium",
            "prompt": "Scroll the axial images from the aortic root down to the four-chamber level and place a named mark in the left atrium.",
            "targets": [{"targetId": tg["id"], "name": "Left atrium", "acceptedNames": ["Left atrium", "LA", "L atrium"], "required": True}],
            "grading": {"kind": "labelled_points", "slabToleranceMm": 3.0, "inPlaneToleranceMm": 2.0, "levelTargetId": None, "requireLabels": True},
            "hints": [hint(1, "Find the round aortic root in the middle of the heart; the left atrium is the large bright chamber directly behind it."),
                      hint(2, "Behind the left atrium lie the descending aorta (round, left of the spine) and the esophagus. The pulmonary veins enter its back corners."),
                      hint(4, "Showing the dataset's outline of the left atrium (semi-automatic, corrected by an expert).",
                           {"type": "showRegion", "targetIds": [tg["id"]]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": (LA_NOTES + " The mark is compared with the dataset's outline, which is semi-automatic and expert-corrected, so treat "
                            "the result as a guide, not a score. " + OUTLINE_NOTE),
            "bookAnchors": anchors(OBJ), "objectiveIds": [OBJ], "skillDimensions": ["anatomy", "navigation_windowing"],
        })
        qkey, qtitle, opts, why = QUESTIONS[n % len(QUESTIONS)]
        tasks.append({
            **base, "id": f"{cid}:{qkey}", "type": "describe_finding", "title": qtitle.rstrip("?"), "prompt": qtitle,
            "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": i, "text": t, "correct": ok, "why": w} for i, t, ok, w in opts]},
            "hints": [hint(1, "Scroll to the level of the aortic root and look at what is in front of and behind the large bright chamber at the back of the heart.")],
            "explanation": why + " " + LA_NOTES, "bookAnchors": anchors(OBJ), "objectiveIds": [OBJ], "skillDimensions": ["anatomy"],
        })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    main()
