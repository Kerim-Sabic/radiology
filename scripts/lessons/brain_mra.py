"""Lessons for the brain-mra pack: intracranial aneurysms and the Circle of Willis on time-of-flight MR angiography.

  python scripts/lessons/brain_mra.py

Every graded answer comes from the datasets' own annotations as stored in the built pack.json:
  * aneurysm patients (Lausanne cohort): the radiologist's voxel-wise aneurysm outlines (findings task; the number of
    aneurysms; the size band from the outline's largest diameter, asked only when it is at least 1 mm from a cut-off);
  * controls (TopCoW): the challenge's manual artery labels (labelled-points task) and its record of which segments are
    seen (variant questions), read from each target's provenance note.
Where an aneurysm sits was read on the images during this pack's review (scripts/lessons/brain_mra_review.json); it is
said in the explanation as such and never graded - the dataset does not record the artery of origin. Controls are not in
Assess: their artery labels were drawn by trained annotators rather than radiologists. Neutral titles continue the
"Patient <code>" codes after the last code in use. Earlier lessons are not touched.
"""
from __future__ import annotations

import json
import re
import sys
from itertools import product
from pathlib import Path
from string import ascii_uppercase

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS, Pack, hint, write_lessons  # noqa: E402
from conditions import anchors  # noqa: E402

PACK_ID = "brain-mra"
_RN = Path(__file__).with_name("brain_mra_review.json")
REVIEW: dict[str, dict] = json.loads(_RN.read_text(encoding="utf-8")) if _RN.exists() else {}


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

ANEURYSM_NOTES = (
    "A saccular (berry) aneurysm is a rounded outpouching of an artery wall, usually at a branching point of the Circle of Willis: "
    "the anterior communicating artery, the internal carotid artery at the origin of the posterior communicating artery, the middle "
    "cerebral artery bifurcation and the tip of the basilar artery. On time-of-flight MR angiography flowing blood is bright, so an "
    "aneurysm is a bright bulge attached to an artery. Scroll the thin source images first, then use a thick-slab MIP or the 3D view "
    "and check each branching point on both sides: a small aneurysm hides behind overlapping arteries on a single projection. Do not "
    "call a vessel loop or the funnel-shaped origin of a posterior communicating artery (an infundibulum, under 3 mm, with the artery "
    "leaving its apex) an aneurysm. Size and site decide the risk of rupture, and a ruptured aneurysm is the usual cause of "
    "non-traumatic subarachnoid haemorrhage (Learning Radiology, Ch. 26)."
)
COW_NOTES = (
    "The Circle of Willis joins the two internal carotid arteries (front) and the basilar artery (back). Each internal carotid "
    "artery ends by dividing into the anterior cerebral artery (its first part, A1, runs medially to the anterior communicating "
    "artery; A2 runs up between the hemispheres) and the middle cerebral artery (M1 runs laterally to its division into M2 branches "
    "in the Sylvian fissure). The basilar artery ends by dividing into the two posterior cerebral arteries (P1 up to the posterior "
    "communicating artery, P2 beyond it, around the midbrain). The posterior communicating arteries link each internal carotid "
    "artery to its posterior cerebral artery. A complete circle is found in only a minority of people: a communicating artery or an "
    "A1/P1 segment is often too small to see. On a time-of-flight MRA a segment that is not seen may be absent or simply too small "
    "(slow flow), so call it 'not seen' rather than 'absent'."
)
NAMES = {
    "basilar_artery": ("Basilar artery", ["Basilar", "BA"]),
    "internal_carotid_artery_right": ("Right internal carotid artery", ["Right ICA", "R ICA", "Right internal carotid", "Right carotid"]),
    "internal_carotid_artery_left": ("Left internal carotid artery", ["Left ICA", "L ICA", "Left internal carotid", "Left carotid"]),
    "middle_cerebral_artery_right": ("Right middle cerebral artery", ["Right MCA", "R MCA", "Right M1"]),
    "middle_cerebral_artery_left": ("Left middle cerebral artery", ["Left MCA", "L MCA", "Left M1"]),
    "anterior_cerebral_artery_right": ("Right anterior cerebral artery", ["Right ACA", "R ACA", "Right A1", "Right A2"]),
    "anterior_cerebral_artery_left": ("Left anterior cerebral artery", ["Left ACA", "L ACA", "Left A1", "Left A2"]),
    "posterior_cerebral_artery_right": ("Right posterior cerebral artery", ["Right PCA", "R PCA", "Right P1", "Right P2"]),
    "posterior_cerebral_artery_left": ("Left posterior cerebral artery", ["Left PCA", "L PCA", "Left P1", "Left P2"]),
    "anterior_communicating_artery": ("Anterior communicating artery", ["Acom", "ACoA", "AComm"]),
    "posterior_communicating_artery_right": ("Right posterior communicating artery", ["Right Pcom", "R Pcom", "Right PCoA"]),
    "posterior_communicating_artery_left": ("Left posterior communicating artery", ["Left Pcom", "L Pcom", "Left PCoA"]),
}
REQUIRED = ["basilar_artery", "internal_carotid_artery_right", "internal_carotid_artery_left", "middle_cerebral_artery_right",
            "middle_cerebral_artery_left", "anterior_cerebral_artery_right", "anterior_cerebral_artery_left",
            "posterior_cerebral_artery_right", "posterior_cerebral_artery_left"]


def edges_of(t: dict) -> dict:
    m = re.search(r"\(TopCoW expert edge labels, 1 = present\): ([^.]+)\.", t["provenanceDetail"]["note"])
    return {k: int(v) for k, v in re.findall(r"([\w-]+) (\d)", m.group(1))}


def feret_mm(pack: Pack, t: dict) -> float:
    """Largest diameter of an outline in patient space (all slices), from the target geometry and the series geometry."""
    se = pack.series[t["seriesUid"]]
    g = json.loads((PACKS / pack.id / t["geometryFile"]).read_text(encoding="utf-8"))
    iop = np.asarray(se["geometry"]["iop"], float)
    ps = se["geometry"]["pixelSpacing"]
    ipp = {i["sopInstanceUid"]: np.asarray(i["ipp"], float) for i in se["instances"]}
    pts = []
    for pl in g["planes"]:
        for ring in pl["polygons"]:
            r = np.asarray(ring, float)
            pts.append(ipp[pl["sopInstanceUid"]] + np.outer(r[:, 0] * ps[1], iop[:3]) + np.outer(r[:, 1] * ps[0], iop[3:]))
    p = np.concatenate(pts)
    d = np.sqrt(((p[:, None, :] - p[None, :, :]) ** 2).sum(-1))
    return float(d.max())


def size_band(mm: float):
    """('small' < 5 mm, 'medium' 5-10 mm, 'large' > 10 mm), or None within 1 mm of a cut-off."""
    if min(abs(mm - 5.0), abs(mm - 10.0)) < 1.0:
        return None
    return "small" if mm < 5 else "medium" if mm <= 10 else "large"


def main() -> None:
    pack = Pack(PACK_ID)
    cases, tasks = [], []
    anc = anchors("ch26-o09")
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        tg = [t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]]
        sid = subj["sourceSubjectId"]
        rv = REVIEW.get(sid, {})
        code = next(CODES)
        aneurysms = [t for t in tg if t["classId"] == "finding:intracranial_aneurysm"]
        if aneurysms:
            cid = f"mra-aneurysm-{sid.split('-')[1]}"
            sizes = {t["id"]: feret_mm(pack, t) for t in aneurysms}
            biggest = max(sizes.values())
            n = len(aneurysms)
            diff = "intro" if biggest >= 10 else "typical" if biggest >= 4 else "subtle"
            cases.append({
                "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · MR angiography, head",
                "learnTitle": ("Two intracranial aneurysms" if n == 2 else "Intracranial aneurysm") + " on time-of-flight MR angiography (expert outline)",
                "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["head"],
                "clinicalContext": "Adult referred for MR angiography of the head.",
                "contextSource": "Dataset description (time-of-flight MR angiography at a university hospital); no clinical history is distributed.",
                "difficulty": diff, "objectiveIds": ["ch26-o09"], "bookAnchors": anc,
                "referenceSummary": (f"{'Each aneurysm' if n > 1 else 'The aneurysm'} was outlined voxel by voxel on the axial images by a "
                                     "radiologist with two years of neuroimaging experience and double-checked by a senior neuroradiologist "
                                     "(over 15 years). Ruptured, treated and fully thrombosed aneurysms were not part of the cohort. "
                                     "The arteries are not outlined by the dataset, and it does not record which artery the aneurysm "
                                     "arises from." + (" " + rv["also"] if rv.get("also") else "")),
                "learnNotes": ANEURYSM_NOTES,
            })
            where = rv.get("where", {})
            req = {t["id"]: (n == 1 or sizes[t["id"]] >= 4.0) for t in aneurysms}
            located = " ".join(where[t["id"]] for t in aneurysms if t["id"] in where)
            extra = (f" In this patient: {located} (read on the images when this pack was reviewed; the dataset records only the outline)."
                     if located else "")
            if n > 1 and not all(req.values()):
                extra += " The smaller aneurysm is under 4 mm and is not required, but finding it counts."
            tasks.append({
                "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the aneurysm" + ("s" if n > 1 else ""),
                "prompt": ("Read this MR angiogram of the head: the source images and a thick-slab MIP. Mark every aneurysm you find "
                           "(point or box), or state that you find none."),
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None},
                "targets": [{"targetId": t["id"], "name": "Aneurysm", "required": req[t["id"]]} for t in aneurysms],
                "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1.5,
                            "inPlaneToleranceMm": 2.0, "allowNoFinding": True},
                "scoring": "authoritative",
                "hints": [hint(1, "Check each branching point of the Circle of Willis on both sides: the anterior communicating artery, "
                                  "each internal carotid artery at the posterior communicating origin and its end, each middle "
                                  "cerebral artery division, and the tip of the basilar artery."),
                          hint(2, "A 20-30 mm MIP slab through the circle shows the arteries as on a catheter angiogram; scroll it "
                                  "up and down so overlapping arteries separate."),
                          hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": max(sizes, key=sizes.get)}),
                          hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": ANEURYSM_NOTES + extra,
                "bookAnchors": anc, "objectiveIds": ["ch26-o09"], "skillDimensions": ["finding_localization", "navigation_windowing"],
                "allowUncertain": True,
            })
            if n > 1:
                tasks.append({
                    "id": f"{cid}:count", "caseId": cid, "type": "describe_finding", "title": "How many aneurysms?",
                    "prompt": "After reading the whole angiogram: how many aneurysms does this patient have?",
                    "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                    "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
                    "grading": {"kind": "choice", "multiple": False, "options": [
                        {"id": str(k), "text": f"{k}" if k < 3 else "3 or more", "correct": k == n,
                         "why": f"The radiologists outlined {n} aneurysms on this angiogram."} for k in (1, 2, 3)]},
                    "scoring": "authoritative",
                    "hints": [hint(1, "Once you have found one aneurysm, keep looking: about one patient in five with an aneurysm has more than one.")],
                    "explanation": ("Multiple aneurysms are common (roughly 20% of patients), so finding one should not end the search "
                                    "(satisfaction of search). " + ANEURYSM_NOTES),
                    "bookAnchors": anc, "objectiveIds": ["ch26-o09"], "skillDimensions": ["interpretation"], "allowUncertain": True,
                })
            main_id = max(sizes, key=sizes.get)
            band = size_band(sizes[main_id])
            if band and "size" not in rv.get("dropTasks", []):
                tasks.append({
                    "id": f"{cid}:size", "caseId": cid, "type": "describe_finding",
                    "title": "How large is the aneurysm?" if n == 1 else "How large is the larger aneurysm?",
                    "prompt": ("Measure the " + ("aneurysm" if n == 1 else "larger aneurysm") + " at its widest (use the ruler on the "
                               "slice and the MIP). Which size group is it in?"),
                    "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                    "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
                    "grading": {"kind": "choice", "multiple": False, "options": [
                        {"id": "small", "text": "Under 5 mm", "correct": band == "small", "why": ""},
                        {"id": "medium", "text": "5 to 10 mm", "correct": band == "medium", "why": ""},
                        {"id": "large", "text": "Over 10 mm", "correct": band == "large", "why": ""}]},
                    "scoring": "authoritative",
                    "hints": [hint(1, "Measure the sac itself, from the neck to the dome, in the plane where it looks widest.")],
                    "explanation": (f"The expert outline is {sizes[main_id]:.1f} mm across at its widest (measured between the outline's "
                                    "farthest points in 3D, so it includes the neck). Size is one of the strongest predictors of rupture "
                                    "(with site, growth and the patient's history), and it decides between follow-up imaging and "
                                    "treatment. " + ANEURYSM_NOTES),
                    "bookAnchors": anc, "objectiveIds": ["ch26-o09"], "skillDimensions": ["interpretation", "reporting"], "allowUncertain": True,
                })
                for o in tasks[-1]["grading"]["options"]:
                    o["why"] = (f"The expert outline measures {sizes[main_id]:.1f} mm at its widest." if o["correct"] else
                                f"The expert outline measures {sizes[main_id]:.1f} mm at its widest.")
            continue

        # ---------------------------------------------------------------- controls with expert artery labels
        by_cls = {t["classId"].split(":", 1)[1]: t for t in tg}
        e = edges_of(next(iter(by_cls.values())))
        cid = f"mra-cow-{sid.lower()}"
        variant = rv.get("variant") or "complete"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · MR angiography, head",
            "learnTitle": {"complete": "Complete Circle of Willis on MR angiography (expert labels)",
                           "fetal-right": "Circle of Willis: fetal-type right posterior cerebral artery (expert labels)",
                           "fetal-left": "Circle of Willis: fetal-type left posterior cerebral artery (expert labels)",
                           "no-acom": "Circle of Willis: anterior communicating artery not seen (expert labels)",
                           "no-left-a1": "Circle of Willis: left A1 segment not seen (expert labels)"}[variant],
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["head"],
            "clinicalContext": "Adult; MR angiography of the head.",
            "contextSource": "Dataset description (people without an aneurysm); no clinical history is distributed.",
            "difficulty": "normal_comparison", "objectiveIds": ["ch26-o09"], "bookAnchors": anc,
            "referenceSummary": ("Each artery of the Circle of Willis is labelled by the TopCoW challenge annotators (research staff trained "
                                 "by clinical experts, uncertain cases decided with neuroradiologists), who also recorded which "
                                 "communicating segments are seen. The labels cover the circle and the first part of each artery; "
                                 "veins and branches beyond are not labelled." + (" " + rv["also"] if rv.get("also") else "")),
            "learnNotes": COW_NOTES,
        })
        targets = []
        for cls in REQUIRED + ["anterior_communicating_artery", "posterior_communicating_artery_right", "posterior_communicating_artery_left"]:
            if cls in by_cls:
                name, acc = NAMES[cls]
                targets.append({"targetId": by_cls[cls]["id"], "name": name, "acceptedNames": [name, *acc], "required": cls in REQUIRED})
        tasks.append({
            "id": f"{cid}:arteries", "caseId": cid, "type": "find_structure", "title": "Name the arteries of the Circle of Willis",
            "prompt": ("Place a named mark in each of: the basilar artery, and on both sides the internal carotid, middle cerebral, anterior "
                       "cerebral and posterior cerebral arteries. Mark the communicating arteries too if you can see them."),
            "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None}, "targets": targets,
            "grading": {"kind": "labelled_points", "slabToleranceMm": 1.5, "inPlaneToleranceMm": 1.5, "levelTargetId": None, "requireLabels": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Find the basilar artery in front of the brainstem, then follow it up to where it divides into the two "
                              "posterior cerebral arteries."),
                      hint(2, "Each internal carotid artery climbs beside the sella and divides into a middle cerebral artery (lateral) "
                              "and an anterior cerebral artery (medial, forwards)."),
                      hint(3, "Showing the labelled arteries.", {"type": "showRegion", "targetIds": [t["targetId"] for t in targets]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": COW_NOTES,
            "bookAnchors": anc, "objectiveIds": ["ch26-o09"], "skillDimensions": ["anatomy", "navigation_windowing"], "allowUncertain": True,
        })
        q = variant_question(variant, e)
        if q:
            tasks.append({
                "id": f"{cid}:variant", "caseId": cid, "type": "describe_finding", "title": q["title"], "prompt": q["prompt"],
                "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": q["options"]}, "scoring": "authoritative",
                "hints": [hint(1, "Use a thick MIP slab through the circle and follow each artery from its origin.")],
                "explanation": q["explain"] + " " + COW_NOTES,
                "bookAnchors": anc, "objectiveIds": ["ch26-o09"], "skillDimensions": ["anatomy", "interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


def variant_question(variant: str, e: dict) -> dict | None:
    """Choice question on the circle's variant; every answer is checked against the expert edge labels."""
    if variant in ("fetal-right", "fetal-left"):
        s, S = ("R", "right") if variant == "fetal-right" else ("L", "left")
        assert e[f"{s}-P1"] == 0 and e[f"{s}-Pcom"] == 1, (variant, e)
        return {"title": f"Where does the {S} posterior cerebral artery fill from?",
                "prompt": f"Follow the {S} posterior cerebral artery back from behind the midbrain. Where does its blood come from?",
                "options": [
                    {"id": "fetal", "text": f"From the {S} internal carotid artery, through a large posterior communicating artery", "correct": True,
                     "why": f"The {S} P1 segment is not seen and the {S} posterior communicating artery is: a fetal-type posterior cerebral artery."},
                    {"id": "basilar", "text": "From the basilar artery, through its P1 segment", "correct": False,
                     "why": f"The expert labels record no {S} P1 segment on this angiogram."},
                    {"id": "both", "text": "Equally from both", "correct": False,
                     "why": f"Only the posterior communicating route is seen on the {S}."}],
                "explain": (f"Fetal-type posterior cerebral artery: the {S} PCA fills from the internal carotid artery through a posterior "
                            "communicating artery as large as the PCA, and the P1 segment from the basilar artery is absent or too small "
                            "to see. It is a common normal variant (about one person in five on one side); it matters because a carotid "
                            "occlusion or a carotid procedure then also affects that occipital lobe.")}
    if variant == "no-acom":
        assert e["Acom"] == 0, e
        return {"title": "Is there an anterior communicating artery?",
                "prompt": "Look between the two A1 segments, just above the optic chiasm. Is an anterior communicating artery seen?",
                "options": [
                    {"id": "no", "text": "Not seen on this MRA (absent, or too small for the angiogram to show)", "correct": True,
                     "why": "The expert labels record no anterior communicating artery on this angiogram."},
                    {"id": "yes", "text": "Yes, it joins the two anterior cerebral arteries", "correct": False,
                     "why": "No vessel joining the two ACAs is seen here."},
                    {"id": "double", "text": "There are two of them", "correct": False, "why": "No communicating artery is seen here."}],
                "explain": ("A missing or hypoplastic anterior communicating artery is a common variant; without it the two anterior "
                            "circulations cannot support each other if one internal carotid artery is narrowed or blocked.")}
    if variant == "no-left-a1":
        assert e["L-A1"] == 0 and e["R-A1"] == 1 and e["Acom"] == 1, e
        return {"title": "Follow both anterior cerebral arteries back",
                "prompt": "Follow both anterior cerebral arteries down from between the hemispheres to their origins. What do you find?",
                "options": [
                    {"id": "noleft", "text": "The left A1 is not seen: both A2 segments fill from the right A1 through the anterior communicating artery",
                     "correct": True, "why": "The expert labels record no left A1 segment, with a right A1 and an anterior communicating artery."},
                    {"id": "noright", "text": "The right A1 is not seen", "correct": False, "why": "The right A1 segment is labelled by the experts."},
                    {"id": "both", "text": "Both A1 segments are present and similar", "correct": False, "why": "The left A1 segment is not seen."}],
                "explain": ("An absent or hypoplastic A1 is a common variant. Both anterior cerebral territories then depend on one "
                            "internal carotid artery, and the anterior communicating artery carries more flow - one reason aneurysms "
                            "form there more often in this anatomy.")}
    if variant == "complete":
        assert all(e[k] == 1 for k in ("L-A1", "R-A1", "Acom", "L-Pcom", "R-Pcom", "L-P1", "R-P1")), e
        return {"title": "Is this Circle of Willis complete?",
                "prompt": "Check each segment of the circle: both A1s, the anterior communicating artery, both posterior communicating arteries and both P1s.",
                "options": [
                    {"id": "complete", "text": "Yes: every segment is seen", "correct": True,
                     "why": "The expert labels record both A1s, the anterior communicating artery, both posterior communicating arteries and both P1s."},
                    {"id": "nopcom", "text": "No: the posterior communicating arteries are not seen", "correct": False,
                     "why": "Both posterior communicating arteries are labelled on this angiogram."},
                    {"id": "noacom", "text": "No: the anterior communicating artery is not seen", "correct": False,
                     "why": "The anterior communicating artery is labelled on this angiogram."}],
                "explain": "A complete circle, with every communicating segment seen, is found in only a minority of people."}
    return None


if __name__ == "__main__":
    main()
