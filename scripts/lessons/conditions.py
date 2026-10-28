"""Lessons for the condition packs: cxr-findings (NIH radiographs), pe-cta (FUMPE) and ct-findings (TCIA).

  python scripts/lessons/conditions.py

Teaching text is our own; book anchors are the curriculum's verified anchors of the objective each case trains.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Pack, hint, oral_exam_task, write_lessons  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CURRICULUM = json.loads((ROOT / "public" / "content" / "curriculum.v1.json").read_text(encoding="utf-8"))
OBJ = {o["id"]: o for u in CURRICULUM["units"] for o in u["objectives"]}


def anchors(*objective_ids: str) -> list[dict]:
    out, seen = [], set()
    for oid in objective_ids:
        for a in OBJ[oid]["anchors"]:
            key = (a["physical"], a.get("figureId"), a.get("sectionId"))
            if key in seen:
                continue
            seen.add(key)
            out.append({"physical": a["physical"], "printed": a["printed"], "chapterId": oid.split("-")[0],
                        "figureId": a.get("figureId"), "sectionId": a.get("sectionId")})
    return out


# ------------------------------------------------------------------ chest radiograph findings
CXR = {
    "finding:pneumothorax": {
        "name": "Pneumothorax", "objectives": ["ch24-o03", "ch24-o04"], "option": "ptx",
        "hint": "Follow the chest wall from apex to base on both sides; on an upright film air rises to the apex first.",
        "why": "A thin white visceral pleural line with no lung markings beyond it.",
        "notes": ("A pneumothorax is air between the lung and the chest wall. Look for the visceral pleural line: a thin white line parallel to "
                  "the chest wall with no lung markings beyond it. On an upright film air collects at the apex first. Mimics are skin folds "
                  "(lung markings continue past them and they often run beyond the rib cage) and the medial edge of the scapula. Check the "
                  "mediastinum: a shift away from the air suggests tension. A chest tube on the film tells you the air was already treated."),
    },
    "finding:pleural_effusion": {
        "name": "Pleural effusion", "objectives": ["ch07-o01", "ch07-o02"], "option": "eff",
        "hint": "Look at both costophrenic angles and the shape of each hemidiaphragm.",
        "why": "Blunted costophrenic angle or a meniscus that rises along the lateral chest wall.",
        "notes": ("Pleural fluid settles in the lowest part of the pleural space. On an upright PA film the first sign is blunting of the "
                  "lateral costophrenic angle (the lateral view shows smaller amounts in the posterior sulcus); larger effusions form a "
                  "meniscus that rises laterally and hide the hemidiaphragm. A large effusion pushes the mediastinum away; if it does not, "
                  "look for collapse of the lung underneath."),
    },
    "finding:atelectasis": {
        "name": "Atelectasis", "objectives": ["ch06-o01", "ch06-o02"], "option": "atel",
        "hint": "Look for signs of lost volume: displaced fissures, a raised hemidiaphragm, shift of the mediastinum or a hilum.",
        "why": "Increased density with signs of volume loss (fissure, hemidiaphragm, hilar or mediastinal shift).",
        "notes": ("Atelectasis is loss of lung volume. The airless lung becomes denser, and the signs of volume loss point to it: a displaced "
                  "fissure, a raised hemidiaphragm, shift of the hilum or mediastinum towards the collapse and crowded ribs. Thin horizontal "
                  "lines at the bases are plate-like (discoid) atelectasis, usually from shallow breathing."),
    },
    "finding:cardiomegaly": {
        "name": "Cardiomegaly", "objectives": ["ch11-o01", "ch11-o02"], "option": "cardio",
        "hint": "Measure the widest heart diameter against the widest inner chest diameter.",
        "why": "Cardiothoracic ratio over 0.5 on a PA film with a good inspiration.",
        "notes": ("On a PA film with a good inspiration the cardiothoracic ratio is the widest transverse diameter of the heart divided by the "
                  "widest inner diameter of the chest; more than 0.5 suggests an enlarged cardiac silhouette. AP and poorly inspired films "
                  "magnify the heart, so judge size on a PA film. A large silhouette can be chamber enlargement or pericardial fluid; the "
                  "radiograph alone cannot always tell them apart."),
    },
    "finding:lung_mass": {
        "name": "Lung mass", "objectives": ["ch10-o05"], "option": "mass",
        "hint": "Compare the two lungs zone by zone, including the hila and the areas behind the heart.",
        "why": "A discrete opacity larger than 3 cm.",
        "notes": ("A mass is a lung opacity larger than 3 cm (smaller ones are nodules). Describe its size, margins (smooth, lobulated or "
                  "spiculated), location and any cavitation, and look for what goes with it: hilar or mediastinal enlargement, an effusion, "
                  "rib destruction or collapse beyond it. In an adult a lung mass must be explained; the radiograph shows it but does not "
                  "give the diagnosis."),
    },
    "finding:lung_nodule": {
        "name": "Lung nodule", "objectives": ["ch10-o04"], "option": "nod",
        "hint": "Compare the lungs zone by zone, and look through the heart and below the domes of the diaphragm.",
        "why": "A round opacity up to 3 cm.",
        "notes": ("A nodule is a round opacity up to 3 cm. Search zone by zone and compare sides; check that it is really in the lung "
                  "(nipple shadows, bone islands and skin lesions mimic nodules). Old films tell you whether it is new or stable; the "
                  "calcification pattern and CT help to characterise it."),
    },
    "finding:pneumonia": {
        "name": "Pneumonia", "objectives": ["ch08-o01", "ch08-o02"], "option": "pna",
        "hint": "Look for a hazy or dense area that hides a border it touches (heart border, hemidiaphragm, aortic knob).",
        "why": "Airspace opacity, often with air bronchograms, filling part of a lobe; the silhouette sign localises it.",
        "notes": ("Pneumonia fills the air spaces: a fluffy or dense opacity with ill-defined edges, often with air bronchograms, filling a "
                  "segment or lobe. The silhouette sign localises it: a lost right heart border means right middle lobe, a lost left heart "
                  "border means lingula, a lost hemidiaphragm means a lower lobe. The film cannot tell pneumonia from other material filling "
                  "the air spaces (fluid, blood, aspiration); the clinical setting does."),
    },
}
OPTIONS = [("ptx", "Pneumothorax"), ("eff", "Pleural effusion"), ("atel", "Atelectasis"), ("cardio", "Cardiomegaly"),
           ("mass", "Lung mass"), ("nod", "Lung nodule"), ("pna", "Pneumonia")]
NIH_LABEL_TO_OPTION = {"Pneumothorax": "ptx", "Effusion": "eff", "Atelectasis": "atel", "Cardiomegaly": "cardio", "Mass": "mass",
                       "Nodule": "nod", "Pneumonia": "pna"}


def cxr_lessons() -> None:
    pack = Pack("cxr-findings")
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        tgts = [t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]]
        main = tgts[0]
        info = CXR[main["classId"]]
        stem = main["id"][len("nih-"):].rsplit("_", 1)[0].replace("_", "-")  # image name, e.g. 00003400-003
        nlp = main["unassessedNote"].rsplit(": ", 1)[-1].rstrip(".")
        cid = f"cxr-{stem}"
        anc = anchors(*info["objectives"])
        cases.append({
            "id": cid, "packId": pack.id,
            "neutralTitle": f"Chest radiograph PA · NIH {stem}",
            "learnTitle": f"{info['name']} on a PA chest radiograph (radiologist box)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": info["objectives"], "bookAnchors": anc,
            "referenceSummary": (f"One box drawn by a board-certified radiologist around the {info['name'].lower()} (NIH ChestX-ray14). "
                                 f"The labels mined from this film's report are: {nlp} (about 90% accurate, per the dataset authors). "
                                 "Nothing else on the film is outlined."),
            "learnNotes": info["notes"],
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": f"Find the {info['name'].lower()}",
            "prompt": "Read this frontal chest radiograph systematically. Box the main abnormality (or mark it with a point), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": CXR[t["classId"]]["name"], "required": t is main} for t in tgts],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                        "inPlaneToleranceMm": 15, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, info["hint"]), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": (info["notes"] + " The reference is the radiologist's box, a rectangle around the finding rather than an outline; "
                            "this image has no pixel spacing, so the tolerance is counted in pixels."),
            "bookAnchors": anc, "objectiveIds": info["objectives"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        # "What is the main finding?" only where no other offered answer is also among the report labels.
        others = {NIH_LABEL_TO_OPTION[l] for l in nlp.split("|") if l in NIH_LABEL_TO_OPTION} - {info["option"]}
        if not others:
            tasks.append({
                "id": f"{cid}:name", "caseId": cid, "type": "differential", "title": "Name the main finding",
                "prompt": "Which is the main finding on this radiograph?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": oid, "text": text, "correct": oid == info["option"],
                     "why": next(v["why"] for v in CXR.values() if v["option"] == oid)} for oid, text in OPTIONS]},
                "scoring": "authoritative",
                "hints": [hint(1, "Use a fixed order: lines and tubes, airway, lungs, pleura, heart and mediastinum, bones, below the diaphragm.")],
                "explanation": (f"The radiologist boxed a {info['name'].lower()}. {info['why']} The answer comes from the radiologist's box and "
                                "the report labels for this film; other findings may also be present."),
                "bookAnchors": anc, "objectiveIds": info["objectives"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ CT pulmonary angiography
PE_NOTES = ("On CT pulmonary angiography the pulmonary arteries are bright with contrast. An embolus is a filling defect: grey, unenhanced "
            "clot inside the white lumen, either with contrast around it or blocking the vessel. A saddle embolus straddles the "
            "bifurcation of the main pulmonary artery. Follow every pulmonary artery from the trunk out to the segmental branches on a "
            "wide window and in two planes. Then look at the consequences: a right ventricle larger than the left (right heart strain) "
            "and peripheral wedge-shaped opacities (infarcts).")


def pe_lessons() -> None:
    pack = Pack("pe-cta")
    cases, tasks = [], []
    anc = anchors("ch10-o07")
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        pid = subj["sourceSubjectId"]
        cid = f"pe-{pid.lower()}"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"CT chest with contrast · FUMPE {pid}",
            "learnTitle": "Pulmonary embolism on CT pulmonary angiography (radiologists' mask)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": ["ch10-o07"], "bookAnchors": anc,
            "referenceSummary": (f"The emboli were marked by two radiologists (FUMPE). {t['teachingNote']} Nothing else is outlined."),
            "learnNotes": PE_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the pulmonary embolus",
            "prompt": ("Review the pulmonary arteries from the main trunk to the segmental branches. Mark any filling defect you find "
                       "(point or box), or state that you find none."),
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": t["id"], "name": "Pulmonary embolus", "required": True}],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1.5,
                        "inPlaneToleranceMm": 3, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Start at the main pulmonary artery and follow the right and left pulmonary arteries outwards; clot is grey inside the white lumen."),
                      hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": t["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": PE_NOTES + " Any mark inside the radiologists' mask, on a slice within 1.5 mm, counts.",
            "bookAnchors": anc, "objectiveIds": ["ch10-o07"], "skillDimensions": ["finding_localization", "navigation_windowing"],
            "allowUncertain": True,
        })
        tasks.append(oral_exam_task(cid, [se["uid"]], se["uid"], "the clot's age and the heart's response need more than one look",
                                    "a flow artefact from poorly mixed contrast", anc, ["ch10-o07"], window="Mediastinum"))
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ CT findings (TCIA)
LIVER_NOTES = ("Metastases are the commonest malignant liver lesions. On portal venous phase CT, colorectal metastases are usually darker "
               "than the enhancing liver, round and often multiple, sometimes with an enhancing rim. Read every slice of the liver, "
               "including the dome and the tip of the right lobe; small lesions hide on thick slices. A simple cyst is water density with "
               "a sharp wall and no enhancement; a hemangioma enhances from the periphery in nodules.")
NODE_NOTES = ("On chest CT a mediastinal lymph node is usually called enlarged when its short axis is more than 1 cm (measured across "
              "its narrowest width on an axial slice). Search the stations in order: paratracheal, aortopulmonary window, subcarinal, "
              "hilar and paraesophageal. Use a mediastinal window, and follow each round structure from slice to slice: vessels "
              "connect to other vessels, nodes do not. Size alone does not tell benign from malignant.")


def ct_lessons() -> None:
    pack = Pack("ct-findings")
    cases, tasks = [], []
    # liver metastases
    subj = pack.subject("CRLM-CT-1140")
    se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
    mets = [pack.target(f"crlm-ct-1140_liver-metastasis-{i}") for i in (1, 2, 3)]
    anc = anchors("ch17-o08")
    cid = "ct-crlm-1140"
    cases.append({
        "id": cid, "packId": pack.id, "neutralTitle": "CT chest, abdomen and pelvis (contrast) · CRLM 1140",
        "learnTitle": "Liver metastases from colorectal cancer, with liver and vessel segmentations",
        "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["abdomen"],
        "clinicalContext": "Before planned liver surgery for colorectal cancer that has spread to the liver.",
        "contextSource": "Collection description (Colorectal-Liver-Metastases: patients who had resection of colorectal liver metastases).",
        "difficulty": "typical", "objectiveIds": ["ch17-o08", "ch13-o03"], "bookAnchors": anc + anchors("ch13-o03"),
        "referenceSummary": ("Radiologists segmented three liver tumours, the liver and the portal vein (Colorectal-Liver-Metastases). "
                             "The CT has 7.5 mm slices, so small lesions show on only one or two slices. Nothing outside the liver is outlined."),
        "learnNotes": LIVER_NOTES,
    })
    tasks.append({
        "id": f"{cid}:mets", "caseId": cid, "type": "locate_finding", "title": "Find the liver metastases",
        "prompt": "Read the liver slice by slice from the dome to the tip of the right lobe. Mark every focal lesion you find, or state that you find none.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
        "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": "Soft tissue"},
        "targets": [{"targetId": m["id"], "name": f"Liver metastasis {i}", "required": i != 2} for i, m in zip((1, 2, 3), mets)],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 4,
                    "inPlaneToleranceMm": 3, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Compare the density of every part of the liver with the rest; lesions are darker than the enhancing liver."),
                  hint(3, "Jumping to a slice with the largest lesion.", {"type": "jumpToTarget", "targetId": mets[2]["id"]}),
                  hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": LIVER_NOTES + " The smallest lesion is about 1 cm and shows on two slices; finding it is a bonus, not required.",
        "bookAnchors": anc, "objectiveIds": ["ch17-o08"], "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
    })
    pv = pack.target("crlm-ct-1140_portal-vein")
    tasks.append({
        "id": f"{cid}:portal", "caseId": cid, "type": "find_structure", "title": "Find the portal vein",
        "prompt": "Mark the portal vein (or one of its main branches in the liver) with a point.",
        "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
        "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": "Soft tissue"},
        "targets": [{"targetId": pv["id"], "name": "Portal vein", "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 4, "inPlaneToleranceMm": 2},
        "scoring": "authoritative",
        "hints": [hint(1, "The portal vein enters the liver at the porta hepatis, behind the pancreas neck; it divides into right and left branches.")],
        "explanation": "Knowing which vessel a lesion touches matters for surgery: the portal vein and its branches run with the bile ducts through the middle of each liver segment, the hepatic veins run between segments.",
        "bookAnchors": anchors("ch13-o03"), "objectiveIds": ["ch13-o03"], "skillDimensions": ["anatomy"], "allowUncertain": True,
    })
    # enlarged mediastinal lymph nodes
    for pid, cid in (("case_0230", "ct-lnq-0230"), ("case_0837", "ct-lnq-0837")):
        subj = pack.subject(pid)
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        anc = anchors("ch10-o03")
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"CT chest with contrast · LNQ {pid.split('_')[1]}",
            "learnTitle": "Enlarged mediastinal lymph nodes (every abnormal node segmented)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": "Chest CT during treatment for cancer.", "contextSource": "Collection description (Mediastinal-Lymph-Node-SEG).",
            "difficulty": "typical", "objectiveIds": ["ch10-o03"], "bookAnchors": anc,
            "referenceSummary": ("Expert annotators segmented every mediastinal lymph node they judged abnormal (estimated short axis over 1 cm; "
                                 "'Fully Annotated' LNQ2023 case). The underlying cancer is not given. Nothing else is outlined."),
            "learnNotes": NODE_NOTES,
        })
        tasks.append({
            "id": f"{cid}:node", "caseId": cid, "type": "find_structure", "title": "Find an enlarged mediastinal lymph node",
            "prompt": "Find an enlarged mediastinal lymph node and mark it with a point. Then measure its short axis with the length tool.",
            "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "middle", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": t["id"], "name": "Enlarged mediastinal lymph node", "required": True}],
            "grading": {"kind": "point_in_target", "slabToleranceMm": 2.5, "inPlaneToleranceMm": 2},
            "scoring": "authoritative",
            "hints": [hint(1, "Look around the trachea, below the carina (subcarinal) and in the aortopulmonary window."),
                      hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": t["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": NODE_NOTES,
            "bookAnchors": anc, "objectiveIds": ["ch10-o03"], "skillDimensions": ["finding_localization", "anatomy"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ fracture radiographs
FX_NOTES = ("An acute fracture is a break in the cortex: look for a lucent (dark) line, a step or angle in the cortical outline, or a "
            "denser band where fragments overlap. Trace the cortex of every bone on the film, including the edges of the image. Then "
            "describe it: which bone and where (proximal, shaft, distal, into the joint or not), the direction of the line, the number "
            "of fragments, and displacement and angulation of the distal fragment. Nutrient canals, growth plates and overlapping "
            "soft-tissue edges mimic fractures; a second view at 90 degrees is standard.")


def fx_lessons() -> None:
    pack = Pack("fx-radiographs")
    cases, tasks = [], []
    anc = anchors("ch23-o01", "ch23-o03")
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        stem = subj["sourceSubjectId"]
        where = pack.studies[subj["studyUids"][0]]["description"].split(", ", 1)[1]
        cid = f"fx-{stem.lower()}"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Radiograph, {where} · FracAtlas {stem}",
            "learnTitle": f"Fracture: {where} (expert outline)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["pelvis", "extremity"] if "hip" in where else ["extremity"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": ["ch23-o01", "ch23-o03"], "bookAnchors": anc,
            "referenceSummary": ("One fracture outlined by the FracAtlas annotators (two expert radiologists and an orthopedist). Only one view "
                                 "of this injury is installed, and alignment, joint involvement and soft tissues are not referenced."),
            "learnNotes": FX_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the fracture",
            "prompt": "Trace the cortex of every bone on this radiograph. Mark any fracture you find (point, box or outline), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": "Fracture", "required": True}],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                        "inPlaneToleranceMm": 20, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Follow each cortical line without a break; look hardest where bones are thin or where two bones overlap."),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": FX_NOTES + " This image has no pixel spacing, so the tolerance is counted in pixels.",
            "rubric": [
                {"id": "bone", "text": "Named the bone and the part (proximal, shaft, distal; into the joint or not)", "weight": "essential", "category": "location"},
                {"id": "line", "text": "Described the fracture line (transverse, oblique, spiral, comminuted)", "weight": "essential", "category": "pattern"},
                {"id": "disp", "text": "Described displacement and angulation of the distal fragment", "weight": "supportive", "category": "finding"},
                {"id": "view", "text": "Asked for a second view at 90 degrees", "weight": "supportive", "category": "limitation"},
            ],
            "bookAnchors": anc, "objectiveIds": ["ch23-o01", "ch23-o03"], "skillDimensions": ["finding_localization", "reporting"],
            "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    cxr_lessons()
    pe_lessons()
    ct_lessons()
    fx_lessons()
