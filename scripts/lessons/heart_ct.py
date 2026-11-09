"""Lessons for the heart-ct pack: the heart and great vessels on 36 chest CTs (TotalSegmentator CT dataset v3.0.0).

  python scripts/lessons/heart_ct.py

What is graded, and against what:
  * Naming the great vessels (aorta, venae cavae, pulmonary veins, left atrial appendage, arch branches, brachiocephalic veins):
    the dataset's own outlines, which are model-assisted and radiologist-verified (provenance `source_automated`). They are
    not drawn from scratch by a radiologist, so these tasks are `exploratory_self_review`: the app compares the learner's marks
    with the outline and says so, but the score is not presented as authoritative.
  * Naming the four chambers: only unreviewed AI outlines exist (layer `atlas`, never graded). The chamber task is a self-review
    with a rubric; the AI outlines are offered as a late hint and are labelled as AI.
  * Contrast: the learner decides from the image; the answer comes from the median HU of the dataset's aorta outline at the
    heart's levels (>= 150 HU enhanced; <= 60 HU unenhanced; cases in between are not asked).
  * Aorta size: from the largest circle that fits inside the dataset's aorta outline (mm), asked only when it is at least 1.5 mm
    from a cut-off. It is a measurement drill, not a diagnosis; no finding is named.
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

ROOT = Path(__file__).resolve().parents[2]
PACK_ID = "heart-ct"
FACTS = json.loads((ROOT / "docs" / "data" / "heart-ct-cases.json").read_text(encoding="utf-8"))


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

VESSEL_NOTES = (
    "On an axial chest CT the great vessels keep the same order from patient right to left and front to back, so name them by "
    "where they sit rather than by how bright they are. The ascending aorta is the round vessel in the middle of the heart's upper "
    "part; the descending aorta is the round vessel in front of the spine on the left. The superior vena cava lies to the right of the "
    "ascending aorta and drains into the right atrium; the inferior vena cava enters the right atrium from below, next to the liver. "
    "The four pulmonary veins run from the lungs into the back of the left atrium, and the small ear-shaped left atrial appendage "
    "sits beside the pulmonary trunk on the left. After an injection of contrast the arteries are brightest in the arterial phase; "
    "veins and the right heart fill later, so a vein can be dark on the same slice as a bright aorta (Learning Radiology, Ch. 3)."
)
ARCH_NOTES = (
    "Scroll from the thoracic inlet down to the arch. Above the arch the two brachiocephalic veins are the most anterior vessels (the "
    "left one crosses in front of the arteries to join the right and form the superior vena cava). Behind them the three branches of "
    "the aortic arch line up from patient right to left: the brachiocephalic trunk (innominate artery), the left common carotid artery "
    "and the left subclavian artery. The trunk divides into the right common carotid and right subclavian arteries behind the right "
    "sternoclavicular joint. Scroll rather than judge one slice: a lymph node or an unopacified vein is easily mistaken for a vessel "
    "on a single image (Learning Radiology, Ch. 3)."
)
CHAMBER_NOTES = (
    "Four chambers on an axial slice at the level of the ventricles: the right ventricle is the most anterior chamber, directly behind "
    "the sternum; the right atrium forms the right border of the heart; the left atrium is the most posterior chamber, in front of the "
    "esophagus and descending aorta, with the pulmonary veins entering its back corners; the left ventricle lies to the left, with the "
    "thickest wall. The interventricular septum separates the ventricles. The aortic root sits in the middle, between the chambers. "
    "With contrast, the blood is bright and the muscle grey; without it, blood and muscle are almost the same density and the "
    "chambers cannot be told apart (Learning Radiology, Ch. 3)."
)
CONTRAST_NOTES = (
    "Look at the blood inside the aorta and the heart. Unenhanced blood is about as dense as soft tissue (roughly 30 to 50 HU, "
    "similar to muscle). After an intravenous injection the aorta fills first and is often 250 HU or more in the arterial phase, while the "
    "veins and the right heart stay darker; later (the venous phase) the veins are brighter and the aorta is dimmer. Contrast is what "
    "lets you see the chambers, the vessel walls and filling defects; an unenhanced CT is still useful for calcium, the size of "
    "the heart and the aorta, and fat (Learning Radiology, Ch. 13)."
)
AORTA_NOTES = (
    "Measure the aorta across the vessel, perpendicular to its long axis, from the outer wall to the outer wall. In adults the "
    "ascending aorta is normally up to about 35 to 40 mm and the descending thoracic aorta up to about 25 to 30 mm; the "
    "figures rise with age, body size and sex, and a vessel that is much wider than normal is called an aneurysm. The number "
    "matters less than the change over time, so reports always compare with earlier scans. On a tortuous aorta a plane that "
    "cuts the vessel obliquely overestimates its width (Learning Radiology, Ch. 11)."
)

SIDES = {"left": "Left", "right": "Right"}
NAMES = {
    "aorta": ("Aorta", ["Aorta", "Ascending aorta", "Descending aorta", "Aortic arch", "Thoracic aorta"]),
    "superior_vena_cava": ("Superior vena cava", ["SVC", "Superior vena cava"]),
    "inferior_vena_cava": ("Inferior vena cava", ["IVC", "Inferior vena cava"]),
    "pulmonary_vein": ("Pulmonary veins", ["Pulmonary vein", "Pulmonary veins", "Left pulmonary vein", "Right pulmonary vein"]),
    "atrial_appendage_left": ("Left atrial appendage", ["Left atrial appendage", "LAA", "Atrial appendage"]),
    "brachiocephalic_trunk": ("Brachiocephalic trunk", ["Brachiocephalic artery", "Brachiocephalic trunk", "Innominate artery"]),
    "common_carotid_artery_left": ("Left common carotid artery", ["Left common carotid artery", "Left carotid", "L common carotid", "Left CCA"]),
    "subclavian_artery_left": ("Left subclavian artery", ["Left subclavian artery", "Left subclavian", "L subclavian"]),
    "brachiocephalic_vein_left": ("Left brachiocephalic vein", ["Left brachiocephalic vein", "Left innominate vein", "L brachiocephalic vein"]),
    "brachiocephalic_vein_right": ("Right brachiocephalic vein", ["Right brachiocephalic vein", "Right innominate vein", "R brachiocephalic vein"]),
}
HEART_VESSELS = ["aorta", "superior_vena_cava", "inferior_vena_cava", "pulmonary_vein", "atrial_appendage_left"]
ARCH_VESSELS = ["brachiocephalic_vein_right", "brachiocephalic_vein_left", "brachiocephalic_trunk", "common_carotid_artery_left", "subclavian_artery_left"]
CHAMBER_AI = ["heart_atrium_right", "heart_ventricle_right", "heart_atrium_left", "heart_ventricle_left"]
CHAMBER_QUESTIONS = [
    ("anterior", "Which chamber is the most anterior (closest to the sternum)?", "heart_ventricle_right", "the right ventricle",
     "The right ventricle is the most anterior chamber of the heart, directly behind the sternum, which is why it is the chamber most at risk in a blunt chest injury."),
    ("posterior", "Which chamber is the most posterior (closest to the esophagus and the spine)?", "heart_atrium_left", "the left atrium",
     "The left atrium is the most posterior chamber; it lies in front of the esophagus, so a large left atrium can indent the esophagus and push up the left main bronchus."),
    ("thickwall", "Which chamber has the thickest wall?", "heart_ventricle_left", "the left ventricle",
     "The left ventricle pumps against the pressure of the whole body and has a muscle wall about three times as thick as the right ventricle."),
]
CHAMBER_WRONG = {"heart_ventricle_right": "the right ventricle", "heart_atrium_left": "the left atrium", "heart_ventricle_left": "the left ventricle",
                 "heart_atrium_right": "the right atrium"}


def facts_band(mm: float):
    """('small' < 35 mm, 'mid' 35-45, 'large' > 45), or None within 1.5 mm of a cut-off."""
    if min(abs(mm - 35.0), abs(mm - 45.0)) < 1.5:
        return None
    return "small" if mm < 35 else "mid" if mm <= 45 else "large"


def main() -> None:
    pack = Pack(PACK_ID)
    cases, tasks = [], []
    chamber_case_no = 0
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        sid = subj["sourceSubjectId"]
        f = FACTS[sid]
        tg = {t["classId"].split(":", 1)[1] + (":ai" if t["provenance"] == "ai_draft" else ""): t for t in pack.manifest["referenceTargets"]
              if t["seriesUid"] == se["uid"]}
        code = next(CODES)
        cid = f"hct-{sid}"
        hu = f["aortaMedianHuAtHeart"]
        dia = f["aortaMaxInscribedDiameterMm"]
        enhanced = hu >= 150
        unenh = hu <= 60
        ai_chambers = [c for c in CHAMBER_AI if f"{c}:ai" in tg]
        has_myo = "heart_myocardium:ai" in tg
        dilated = dia >= 42 and f["metaPathology"] == "vascular" and "thorax" in f["metaPathologyLocation"]
        gated = f["studyType"] in ("ct heart", "ct aortic valve", "ct artrium", "ct coronary arteries")
        if dilated:
            title = f"Chest CT with a widened aorta (about {dia:.0f} mm at its widest on the outline)"
            diff, obj_main = "typical", "ch11-o08"
        elif unenh:
            title = "Unenhanced chest CT: the heart and vessels without contrast"
            diff, obj_main = "subtle", "ch03-o06"
        elif not enhanced:
            title = "Chest CT with faint contrast: the heart and vessels"
            diff, obj_main = "subtle", "ch03-o06"
        elif len(ai_chambers) >= 4:
            title = ("Heart-gated" if gated else "Contrast-enhanced") + " chest CT: the four chambers and the great vessels"
            diff, obj_main = "intro", "ch03-o06"
        else:
            title = "Contrast-enhanced chest CT: the great vessels and the heart"
            diff, obj_main = "typical", "ch03-o04"
        n_expert = sum(1 for k in tg if not k.endswith(":ai"))
        n_ai = sum(1 for k in tg if k.endswith(":ai"))
        sex = {"m": "man", "f": "woman"}.get(f.get("sex"), "adult")
        age = int(f["age"])
        enh_txt = (f"The aorta measures about {hu:.0f} HU at the heart's levels, so this scan was enhanced with intravenous contrast "
                   f"(the inferior vena cava, {f['ivcMedianHu']:.0f} HU, is {'much less' if f['ivcMedianHu'] < hu - 100 else 'less'} dense: an early phase)." if enhanced else
                   f"The aorta measures about {hu:.0f} HU at the heart's levels: {'no contrast injection' if unenh else 'at most faint, late contrast'}, so "
                   "blood and heart muscle have almost the same density and the chambers cannot be separated.")
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Chest CT", "learnTitle": title,
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": f"{age}-year-old {sex}; chest CT.",
            "contextSource": "Dataset table (age, sex, scanner); no clinical history is distributed.",
            "difficulty": diff, "objectiveIds": [obj_main], "bookAnchors": anchors(obj_main),
            "referenceSummary": (f"{n_expert} structure outlines come from the dataset's own segmentation (heart, aorta, pulmonary veins, venae cavae, "
                                 "left atrial appendage and the arch branches that lie in the cropped chest): model-assisted and verified by "
                                 "radiologists, not drawn from scratch and not re-reviewed here. "
                                 + (f"{n_ai} further outlines (heart chambers, left ventricular muscle, pulmonary arteries) are unreviewed AI drafts that "
                                    "pass automatic checks; they are never graded. " if n_ai else "No AI outlines were kept for this scan. ")
                                 + enh_txt + f" Scanner: {f['manufacturer']} {f['scanner']}, {f['kvp']} kV."),
            "learnNotes": (VESSEL_NOTES + " " + (CHAMBER_NOTES + " " if ai_chambers else "") + (AORTA_NOTES + " " if dilated else "") + CONTRAST_NOTES),
        })
        ser = [se["uid"]]
        start = {"seriesUid": se["uid"], "slice": "middle", "windowPreset": "Mediastinum"}
        base = {"caseId": cid, "modes": ["learn", "practice"], "seriesUids": ser, "start": start, "scoring": "exploratory_self_review", "allowUncertain": True}

        def labelled(task_id, kind, title_, prompt, classes, hints_, expl, objs, dims, required):
            tt = []
            for c in classes:
                if c in tg and not tg[c]["provenance"] == "ai_draft":
                    name, acc = NAMES[c]
                    tt.append({"targetId": tg[c]["id"], "name": name, "acceptedNames": acc, "required": c in required})
            if len(tt) < 3:
                return
            tasks.append({
                **base, "id": f"{cid}:{task_id}", "type": "find_structure", "title": title_, "prompt": prompt, "targets": tt,
                "grading": {"kind": "labelled_points", "slabToleranceMm": 3.0, "inPlaneToleranceMm": 2.0, "levelTargetId": None, "requireLabels": True},
                "hints": hints_ + [hint(4, "Showing the dataset's outlines of these structures.", {"type": "showRegion", "targetIds": [t["targetId"] for t in tt]}),
                                   hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": expl, "bookAnchors": anchors(*objs), "objectiveIds": objs, "skillDimensions": dims,
            })

        labelled("vessels", "vessels", "Name the vessels at the heart",
                 ("Scroll through the heart and place a named mark in each of: the aorta, the superior vena cava, the inferior vena cava and "
                  "the pulmonary veins" + (", and the left atrial appendage if you can find it" if "atrial_appendage_left" in tg else "") + "."),
                 HEART_VESSELS,
                 [hint(1, "Start at the level of the pulmonary trunk and scroll down: the ascending aorta is the large round vessel in the middle, "
                          "the descending aorta the round vessel in front of the spine."),
                  hint(2, "The superior vena cava lies to the right of the ascending aorta; the inferior vena cava appears just above the liver, "
                          "beside the right atrium; the pulmonary veins run into the back of the left atrium.")],
                 VESSEL_NOTES + (" The marks are checked against the dataset's outlines, which are model-assisted and radiologist-verified but not "
                                 "drawn by a radiologist from scratch, so treat the result as a guide, not a score."),
                 ["ch03-o06"], ["anatomy", "navigation_windowing"], {"aorta", "superior_vena_cava", "inferior_vena_cava", "pulmonary_vein"})
        arch_present = sum(1 for c in ARCH_VESSELS if c in tg)
        if arch_present >= 4:
            labelled("arch", "arch", "Name the arch branches and the brachiocephalic veins",
                     ("Scroll up from the heart to just above the aortic arch. Place a named mark in each of: the right and left brachiocephalic veins, "
                      "the brachiocephalic trunk (innominate artery), the left common carotid artery and the left subclavian artery."),
                     ARCH_VESSELS,
                     [hint(1, "Find the top of the aortic arch, then scroll up a few slices into the thoracic inlet."),
                      hint(2, "The veins are the most anterior vessels (the left one crosses to the right); behind them the three arch branches line up "
                              "from patient right to left: brachiocephalic trunk, left common carotid, left subclavian.")],
                     ARCH_NOTES + " The marks are checked against the dataset's outlines (model-assisted, radiologist-verified).",
                     ["ch03-o04"], ["anatomy", "navigation_windowing"], {c for c in ARCH_VESSELS if c in tg})
        # ------------------------------------------------------------ chambers (AI outlines are the late hint only)
        if len(ai_chambers) >= 4 and has_myo:
            chamber_case_no += 1
            ai_ids = [tg[f"{c}:ai"]["id"] for c in CHAMBER_AI] + [tg["heart_myocardium:ai"]["id"]]
            tasks.append({
                **base, "id": f"{cid}:chambers", "type": "find_structure", "title": "Name the four chambers",
                "prompt": ("On the slices through the ventricles, point to and name each of the four chambers: right atrium, right ventricle, left atrium "
                           "and left ventricle. Then say where the thickest wall is."),
                "targets": [], "grading": {"kind": "self_review"},
                "hints": [hint(1, "Find the slice where all four chambers and the aortic root are visible. The right ventricle is the most anterior chamber, "
                                  "the left atrium the most posterior."),
                          hint(2, "The right atrium forms the right border of the heart and receives the superior and inferior venae cavae; the pulmonary veins "
                                  "enter the left atrium from behind."),
                          hint(4, "Showing unreviewed AI outlines of the chambers and the left ventricular muscle (drafts, not a reference).",
                               {"type": "showRegion", "targetIds": ai_ids}),
                          hint(5, "Reveal the explanation.", {"type": "reveal"})],
                "explanation": CHAMBER_NOTES + " The chamber outlines offered as a hint are AI drafts that passed automatic checks; they are not reviewed by a radiologist.",
                "rubric": [
                    {"id": "rv", "text": "Right ventricle named as the most anterior chamber, behind the sternum", "weight": "essential", "category": "location"},
                    {"id": "ra", "text": "Right atrium named on the right heart border, joined by the venae cavae", "weight": "essential", "category": "location"},
                    {"id": "la", "text": "Left atrium named as the most posterior chamber, with the pulmonary veins entering it", "weight": "essential", "category": "location"},
                    {"id": "lv", "text": "Left ventricle named on the left, with the thickest wall", "weight": "essential", "category": "location"},
                    {"id": "contrast", "text": "Noted that bright blood and grey muscle are only separable because of contrast", "weight": "supportive", "category": "limitation"}],
                "bookAnchors": anchors("ch03-o06"), "objectiveIds": ["ch03-o06"], "skillDimensions": ["anatomy", "navigation_windowing"],
            })
            qkey, qtitle, qcls, qname, qwhy = CHAMBER_QUESTIONS[chamber_case_no % len(CHAMBER_QUESTIONS)]
            opts = [{"id": c, "text": CHAMBER_WRONG[c].capitalize(), "correct": c == qcls,
                     "why": qwhy if c == qcls else f"Not {CHAMBER_WRONG[c]}: {qwhy}"} for c in CHAMBER_AI]
            tasks.append({
                **base, "id": f"{cid}:chamber-{qkey}", "type": "describe_finding", "title": qtitle.rstrip("?"), "prompt": qtitle,
                "targets": [], "grading": {"kind": "choice", "multiple": False, "options": opts},
                "hints": [hint(1, "Scroll to the level of the ventricles and look at where each chamber sits relative to the sternum, the spine and the aortic root.")],
                "explanation": qwhy + " " + CHAMBER_NOTES, "bookAnchors": anchors("ch03-o06"), "objectiveIds": ["ch03-o06"],
                "skillDimensions": ["anatomy"],
            })
        # ------------------------------------------------------------ contrast (only where the answer is clear)
        if enhanced or unenh:
            tasks.append({
                **base, "id": f"{cid}:contrast", "type": "describe_finding", "title": "Was contrast given?",
                "prompt": "Look at the blood in the aorta and in the heart. Was this CT done with intravenous contrast?",
                "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "yes", "text": "Yes: the blood is much brighter than the muscle", "correct": enhanced,
                     "why": (f"The aorta measures about {hu:.0f} HU at the heart, far above the 30 to 50 HU of unenhanced blood." if enhanced else
                             f"The aorta measures only about {hu:.0f} HU: no contrast.")},
                    {"id": "no", "text": "No: the blood and the heart muscle have the same density", "correct": unenh,
                     "why": (f"The aorta measures about {hu:.0f} HU, the density of unenhanced blood." if unenh else
                             f"The aorta measures about {hu:.0f} HU, which is enhanced blood.")}]},
                "hints": [hint(1, "Compare the density of the blood in the aorta with the density of a muscle or the heart wall. Use the probe or ROI tool to read HU.")],
                "explanation": CONTRAST_NOTES + f" Here the aorta is about {hu:.0f} HU (median of the dataset's aorta outline at the heart's levels).",
                "bookAnchors": anchors("ch13-o01"), "objectiveIds": ["ch13-o01"], "skillDimensions": ["navigation_windowing", "interpretation"],
            })
        # ------------------------------------------------------------ aorta size drill
        band = facts_band(dia)
        want = dilated or f["metaPathology"] == "vascular" and dia >= 40 or sid in ("s0738", "s0980", "s0811")
        if band and want:
            def why(b):
                return f"The largest circle that fits inside the dataset's aorta outline measures {dia:.0f} mm."
            tasks.append({
                **base, "id": f"{cid}:aorta-size", "type": "describe_finding", "title": "How wide is the aorta at its widest?",
                "prompt": ("Scroll the whole thoracic aorta and measure it across at its widest, perpendicular to its long axis (use the ruler). "
                           "Which group is the widest part in?"),
                "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "small", "text": "Under 35 mm", "correct": band == "small", "why": why("small")},
                    {"id": "mid", "text": "35 to 45 mm", "correct": band == "mid", "why": why("mid")},
                    {"id": "large", "text": "Over 45 mm", "correct": band == "large", "why": why("large")}]},
                "hints": [hint(1, "Check the ascending aorta, the arch and the descending aorta; the widest part may not be where you first look. Measure at right angles to the vessel.")],
                "explanation": (AORTA_NOTES + f" The widest part here measures about {dia:.0f} mm (the largest circle inside the dataset's outline, so an oblique cut does not inflate it)."),
                "bookAnchors": anchors("ch11-o08"), "objectiveIds": ["ch11-o08"], "skillDimensions": ["interpretation", "reporting"],
            })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    main()
