"""Lessons for the condition packs: cxr-findings (NIH radiographs), pe-cta (FUMPE), ct-findings and ct-tumors (TCIA),
fx-radiographs (FracAtlas), stroke-mri (ISLES 2022), us-cases (Breast-Lesions-USG, HC18), mammo-cbis (CBIS-DDSM) and
peds-msk (GRAZPEDWRI-DX, Digital Knee X-ray Images).

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


# ------------------------------------------------------------------ tumors on CT and MRI (TCIA, round 2)
LUNG_CA_NOTES = ("Bronchogenic carcinoma shows itself in several ways: a solitary nodule or mass (often with spiculated or lobulated "
                 "margins), a central mass with collapse of the lung beyond an obstructed bronchus, hilar or mediastinal enlargement from "
                 "nodes, or direct invasion of the chest wall, mediastinum or vertebrae. On CT read the lungs on a lung window and the "
                 "mediastinum on a soft-tissue window; describe the size, the lobe, the margins, contact with the pleura, fissures and "
                 "vessels, and look for nodes, effusion and bone lesions. Imaging cannot tell the cell type; the biopsy does.")
HCC_NOTES = ("Hepatocellular carcinoma usually arises in a cirrhotic liver. On multiphase CT its typical behavior is arterial-phase "
             "hyperenhancement (brighter than the liver) with washout on later phases (darker than the liver), often with an enhancing "
             "capsule. Large tumors are heterogeneous and may invade the portal or hepatic veins. Compare every phase; a metastasis is "
             "usually darker than the liver on the portal venous phase, and a hemangioma fills in from the periphery.")
VS_NOTES = ("A vestibular schwannoma (acoustic neuroma) arises from the vestibular nerve in the internal auditory canal and grows into "
            "the cerebellopontine angle. It is extra-axial: CSF clefts and vessels separate it from the brainstem and cerebellum. On "
            "contrast T1 it enhances strongly, often like an ice-cream cone with the cone in the internal auditory canal; on "
            "high-resolution T2 it is a dark filling defect in the bright CSF. The main alternative at the cerebellopontine angle is a "
            "meningioma, which is broad-based on the dura, may have a dural tail and rarely enters the canal.")
STROKE_NOTES = ("In an acute ischemic stroke the cells swell (cytotoxic edema) within minutes, which restricts the motion of water. "
                "Diffusion-weighted MRI shows this early as a bright area in an arterial territory, long before CT changes; the ADC map "
                "confirms true restriction when the same area is dark. Bright on DWI but not dark on ADC is 'T2 shine-through', not "
                "restriction. Name the territory (anterior, middle or posterior cerebral artery, or a watershed or lacunar pattern) and "
                "look for hemorrhage on the other sequences.")


def tumor_lessons() -> None:
    pack = Pack("ct-tumors")
    cases, tasks = [], []
    # lung cancer, one patient per histology
    hist_name = {"A": "adenocarcinoma", "B": "small cell carcinoma", "E": "large cell carcinoma", "G": "squamous cell carcinoma"}
    anc = anchors("ch10-o05")
    for folder in ("A0010", "G0007", "B0022", "E0004"):
        subj = pack.subject(f"Lung_Dx-{folder}")
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = pack.target(f"lung-dx-{folder.lower()}_lung-cancer")
        cid = f"lung-dx-{folder.lower()}"
        hist = hist_name[folder[0]]
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"CT chest · Lung-PET-CT-Dx {folder}",
            "learnTitle": f"Lung cancer ({hist}) on chest CT (radiologists' box)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": "Adult with a lung cancer later confirmed by biopsy.",
            "contextSource": "Collection description (Lung-PET-CT-Dx: patients with biopsy-confirmed lung cancer; histology from the patient ID).",
            "difficulty": "typical", "objectiveIds": ["ch10-o05"], "bookAnchors": anc,
            "referenceSummary": (f"The tumor is boxed on every slice where the dataset's thoracic radiologists marked it ({t['provenanceDetail']['note'].split(';')[0]}). "
                                 f"Histology: {hist}. Nodes, metastases and other findings are not marked."),
            "learnNotes": LUNG_CA_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the lung tumor",
            "prompt": "Read both lungs and the hila on a lung window, slice by slice. Mark the main abnormality (point or box), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": "Lung"},
            "targets": [{"targetId": t["id"], "name": "Lung tumor", "required": True}],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 2.5,
                        "inPlaneToleranceMm": 5, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Compare the two lungs zone by zone, and look hard at the hila and next to the spine and the heart."),
                      hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": t["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": LUNG_CA_NOTES + " The reference is the radiologists' box, a rectangle around the tumor on each slice; a mark inside it within one slice counts.",
            "bookAnchors": anc, "objectiveIds": ["ch10-o05"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        tasks.append(oral_exam_task(cid, [se["uid"]], se["uid"], "the cell type needs a biopsy",
                                    "pneumonia or a collapsed segment", anc, ["ch10-o05"], window="Lung"))
    # hepatocellular carcinoma
    anc = anchors("ch17-o08")
    for pid in ("HCC_010", "HCC_003"):
        subj = pack.subject(pid)
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        slug_ = pid.lower().replace("_", "-")
        t = pack.target(f"{slug_}_hepatocellular-carcinoma")
        cid = f"hcc-{slug_.split('-')[1]}"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"CT abdomen, liver protocol · HCC-TACE-Seg {pid.split('_')[1]}",
            "learnTitle": "Hepatocellular carcinoma on contrast CT (tumor and liver segmented)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["abdomen"],
            "clinicalContext": "Adult with confirmed hepatocellular carcinoma, before transarterial chemoembolization.",
            "contextSource": "Collection description (HCC-TACE-Seg: confirmed HCC, baseline CT before the first TACE).",
            "difficulty": "typical", "objectiveIds": ["ch17-o08"], "bookAnchors": anc,
            "referenceSummary": ("The tumor, the liver and the abdominal aorta were segmented semi-automatically and clinically curated "
                                 "(HCC-TACE-Seg). Only the contrast phase the segmentation was drawn on is installed, so the washout on "
                                 "later phases cannot be shown here."),
            "learnNotes": HCC_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the liver tumor",
            "prompt": "Read the liver slice by slice on a soft-tissue window. Mark the tumor (point or box), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": "Soft tissue"},
            "targets": [{"targetId": t["id"], "name": "Hepatocellular carcinoma", "required": True}],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 2.5,
                        "inPlaneToleranceMm": 3, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Compare the texture and brightness of each part of the liver; the tumor enhances differently from the liver around it."),
                      hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": t["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": HCC_NOTES,
            "bookAnchors": anc, "objectiveIds": ["ch17-o08"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        tasks.append(oral_exam_task(cid, [se["uid"]], se["uid"], "washout needs the later phases, which are not installed",
                                    "a liver metastasis", anc, ["ch17-o08"], window="Soft tissue"))
    # vestibular schwannoma
    anc = anchors("ch26-o11")
    subj = pack.subject("VS-SEG-001")
    t1 = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"] and "t1" in s["description"].lower())
    t2 = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"] and "t2" in s["description"].lower())
    tt1, tt2 = pack.target("vs-seg-001_cet1-vestibular-schwannoma"), pack.target("vs-seg-001_hrt2-vestibular-schwannoma")
    cid = "vs-seg-001"
    cases.append({
        "id": cid, "packId": pack.id, "neutralTitle": "MRI brain, posterior fossa · VS-SEG 001",
        "learnTitle": "Vestibular schwannoma on contrast T1 and high-resolution T2 (manual contour)",
        "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": t1["uid"], "region": ["head"],
        "clinicalContext": "Adult treated with Gamma Knife radiosurgery for a vestibular schwannoma.",
        "contextSource": "Collection description (Vestibular-Schwannoma-SEG: patients treated with Gamma Knife radiosurgery).",
        "difficulty": "typical", "objectiveIds": ["ch26-o11"], "bookAnchors": anc,
        "referenceSummary": ("The tumor was contoured manually on every axial slice by the treating neurosurgeon and physicist, on both "
                             "sequences (Gamma Knife planning). The cochlea and planning structures are not shown."),
        "learnNotes": VS_NOTES,
    })
    tasks.append({
        "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the posterior fossa mass",
        "prompt": "Read the posterior fossa on the contrast T1 series: brainstem, cerebellum and both cerebellopontine angles. Mark any mass (point or box), or state that you find none.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [t1["uid"], t2["uid"]],
        "start": {"seriesUid": t1["uid"], "slice": "middle", "windowPreset": None},
        "targets": [{"targetId": tt1["id"], "name": "Vestibular schwannoma", "required": True},
                    {"targetId": tt2["id"], "name": "Vestibular schwannoma (T2)", "required": False}],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1.5,
                    "inPlaneToleranceMm": 2, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Compare the two cerebellopontine angles, just behind the petrous bones, and follow each internal auditory canal."),
                  hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tt1["id"]}),
                  hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": VS_NOTES,
        "bookAnchors": anc, "objectiveIds": ["ch26-o11"], "skillDimensions": ["finding_localization", "interpretation"],
        "allowUncertain": True,
    })
    tasks.append({
        "id": f"{cid}:axial", "caseId": cid, "type": "differential", "title": "Inside or outside the brain?",
        "prompt": "Is this mass intra-axial (within the brain) or extra-axial (outside the brain, in the cerebellopontine angle)?",
        "modes": ["learn", "practice"], "seriesUids": [t1["uid"], t2["uid"]],
        "start": {"seriesUid": t2["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "extra", "text": "Extra-axial", "correct": True,
             "why": "It sits in the cerebellopontine angle cistern, separated from the brainstem and cerebellum by CSF, and extends into the internal auditory canal."},
            {"id": "intra", "text": "Intra-axial", "correct": False,
             "why": "An intra-axial mass would be surrounded by brain tissue and expand it from within; here CSF separates the mass from the brain."}]},
        "scoring": "authoritative",
        "hints": [hint(1, "On the T2 series look for bright CSF between the mass and the brainstem or cerebellum.")],
        "explanation": "Extra-axial masses displace the brain and are separated from it by CSF clefts and vessels; the commonest at the cerebellopontine angle are vestibular schwannoma and meningioma.",
        "bookAnchors": anc, "objectiveIds": ["ch26-o11"], "skillDimensions": ["interpretation"], "allowUncertain": True,
    })
    write_lessons(pack, "1.0.0", cases, tasks)


def stroke_lessons() -> None:
    pack = Pack("stroke-mri")
    cases, tasks = [], []
    anc = anchors("ch26-o08")
    for subj in pack.manifest["subjects"]:
        sers = [s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]]
        dwi = next(s for s in sers if s["description"].startswith("DWI"))
        adc = next(s for s in sers if s["description"].startswith("ADC"))
        tdwi = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == dwi["uid"])
        tadc = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == adc["uid"])
        num = subj["sourceSubjectId"].split("strokecase")[1]
        cid = f"stroke-isles-{num}"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"MRI brain, diffusion · ISLES 2022 case {int(num)}",
            "learnTitle": "Ischemic stroke on diffusion MRI (expert-approved lesion mask)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": dwi["uid"], "region": ["head"],
            "clinicalContext": "Adult with an ischemic stroke.",
            "contextSource": "Dataset description (ISLES 2022: MRI of acute to subacute ischemic stroke).",
            "difficulty": "typical", "objectiveIds": ["ch26-o08"], "bookAnchors": anc,
            "referenceSummary": ("The ischemic lesion was outlined with a model's help, corrected by trained annotators and a neuroradiologist "
                                 "in training, and approved by an attending neuroradiologist (ISLES 2022). The images are skull-stripped and "
                                 "resliced to 2 mm by the dataset authors; time since onset is not given."),
            "learnNotes": STROKE_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the restricted diffusion",
            "prompt": "Read the diffusion-weighted images from the skull base to the vertex. Mark the abnormal area (point or box), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [dwi["uid"], adc["uid"]],
            "start": {"seriesUid": dwi["uid"], "slice": "middle", "windowPreset": None},
            "targets": [{"targetId": tdwi["id"], "name": "Ischemic lesion", "required": True},
                        {"targetId": tadc["id"], "name": "Ischemic lesion (ADC)", "required": False}],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 2,
                        "inPlaneToleranceMm": 3, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Look for a bright area on DWI that keeps to an arterial territory, and compare the two hemispheres."),
                      hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tdwi["id"]}),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": STROKE_NOTES,
            "bookAnchors": anc, "objectiveIds": ["ch26-o08"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        tasks.append({
            "id": f"{cid}:adc", "caseId": cid, "type": "differential", "title": "Is it true restriction?",
            "prompt": "Find the bright lesion on DWI, then look at the same place on the ADC map. How does it look on ADC?",
            "modes": ["learn", "practice"], "seriesUids": [dwi["uid"], adc["uid"]],
            "start": {"seriesUid": adc["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "dark", "text": "Dark (low ADC): true restricted diffusion", "correct": True,
                 "why": "Water motion is restricted in the swollen cells of an acute infarct, so the ADC is low and the map is dark."},
                {"id": "bright", "text": "Bright (high ADC)", "correct": False,
                 "why": "A bright ADC means water moves more freely (e.g. CSF or old tissue loss), the opposite of restriction."},
                {"id": "same", "text": "The same as normal brain", "correct": False,
                 "why": "Then the DWI brightness would be T2 shine-through rather than restriction."}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Use the linked views: double-click the lesion on DWI and the ADC view goes to the same place.")],
            "explanation": STROKE_NOTES,
            "bookAnchors": anc, "objectiveIds": ["ch26-o08"], "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ ultrasound (round 3): breast lesions and the fetal head
BREAST_US_NOTES = ("Breast ultrasound first answers one question: cyst or solid? A simple cyst is anechoic (black, no internal echoes), "
                   "circumscribed with a thin sharp back wall, and has posterior acoustic enhancement (brighter tissue behind it, because "
                   "fluid lets the sound through). Anything that fails these criteria is treated as solid or complicated. A solid mass is "
                   "described like a mammographic one: shape (oval, round, irregular), orientation, margin (circumscribed or not: "
                   "indistinct, angular, microlobulated, spiculated), echo pattern and posterior features. An oval, circumscribed mass "
                   "parallel to the skin favors a benign tumor such as a fibroadenoma; an irregular, spiculated or angular hypoechoic "
                   "mass with posterior shadowing is suspicious for carcinoma. Ultrasound shows the features; the biopsy gives the diagnosis.")
FETAL_HEAD_NOTES = ("Fetal growth is followed with standard measurements on standard planes. The head is measured on an axial plane through "
                    "the thalami and the cavum septi pellucidi, with the skull outline symmetric and smooth. Bone reflects most of the sound, "
                    "so the skull is a bright (echogenic) oval; the brain inside is darker. Head circumference is the perimeter of an ellipse "
                    "placed on the outer edge of the skull: approximately pi x (BPD + OFD) / 2, where BPD (biparietal diameter) and OFD "
                    "(occipitofrontal diameter) are the short and long axes. Measurements on an ultrasound image are only true distances when "
                    "the image carries its pixel size, as these images do.")
BREAST_US_DX = {"Invasive carcinoma of no special type (NST)": "carcinoma", "Fibroadenoma": "fibroadenoma", "not applicable": "cyst"}


def _us_descriptors(note: str) -> dict:
    """The radiologist's BI-RADS descriptors as stored in the target note by build_external.py."""
    out = {}
    for part in note.rstrip(".").split("; "):
        for key in ("BI-RADS", "shape", "margin", "echogenicity", "posterior features"):
            if part.startswith(key + " "):
                out[key.split()[0]] = part[len(key) + 1:]
    return out


def us_lessons() -> None:
    pack = Pack("us-cases")
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        sid = subj["sourceSubjectId"]
        if subj["key"].startswith("tcia:Breast-Lesions-USG:"):
            d = _us_descriptors(t["provenanceDetail"]["note"])
            dx = BREAST_US_DX[t["provenanceDetail"]["note"].rsplit("diagnosis: ", 1)[1].rstrip(".")]
            num = int(sid[len("case"):])
            cid = f"us-breast-{sid}"
            anc = anchors("ch29-o06", "ch18-o01")
            name = {"cyst": "Simple cyst", "fibroadenoma": "Fibroadenoma", "carcinoma": "Invasive carcinoma"}[dx]
            proof = "confirmed on follow-up" if dx == "cyst" else "proven by biopsy"
            age = subj["ageAtFirstStudy"]
            cases.append({
                "id": cid, "packId": pack.id, "neutralTitle": f"Breast ultrasound · Breast-Lesions-USG case {num}",
                "learnTitle": f"{name} on breast ultrasound ({proof}; radiologist outline)",
                "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["breast"],
                "clinicalContext": f"Patient aged {int(age[:3])} years." if age else None,
                "contextSource": "Patient age from the dataset's clinical data." if age else None,
                "difficulty": "typical", "objectiveIds": ["ch29-o06", "ch18-o01"], "bookAnchors": anc,
                "referenceSummary": (f"The lesion is outlined freehand by a radiologist experienced in breast ultrasound, who also recorded "
                                     f"its BI-RADS descriptors (Breast-Lesions-USG): shape {d['shape']}, margin {d['margin']}, echo pattern "
                                     f"{d['echogenicity']}, posterior features {d['posterior']}, BI-RADS {d['BI-RADS']}. Diagnosis {proof}. "
                                     "The image is the dataset's cropped B-mode frame with its true pixel size; no Doppler, no orientation."),
                "learnNotes": BREAST_US_NOTES,
            })
            tasks.append({
                "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the lesion",
                "prompt": "Look through this breast ultrasound image. Mark the lesion (point, box or outline), or state that you find none.",
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
                "targets": [{"targetId": t["id"], "name": "Breast lesion", "required": True}],
                "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                            "inPlaneToleranceMm": 3, "allowNoFinding": True},
                "scoring": "authoritative",
                "hints": [hint(1, "Skin is at the top of the image; look below the skin and fat for a focal area that differs from the surrounding tissue."),
                          hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": BREAST_US_NOTES + " The image carries its pixel size, so the tolerance is a true 3 mm.",
                "bookAnchors": anc, "objectiveIds": ["ch29-o06", "ch18-o01"], "skillDimensions": ["finding_localization", "interpretation"],
                "allowUncertain": True,
            })
            tasks.append({
                "id": f"{cid}:cyst", "caseId": cid, "type": "differential", "title": "Cyst or solid?",
                "prompt": "Look at the lesion's echoes, walls and the tissue behind it. Is it a simple cyst or a solid mass?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "cyst", "text": "Simple cyst", "correct": dx == "cyst",
                     "why": "A simple cyst is anechoic, circumscribed with a thin back wall, and shows posterior acoustic enhancement."},
                    {"id": "solid", "text": "Solid mass", "correct": dx != "cyst",
                     "why": "Internal echoes (hypoechoic or heterogeneous rather than anechoic) mean solid tissue, whatever the margin."}]},
                "scoring": "authoritative",
                "hints": [hint(1, "Compare the inside of the lesion with the black of fluid, and look at the tissue just deep to it.")],
                "explanation": (f"The radiologist recorded the echo pattern as {d['echogenicity']} and posterior features as "
                                f"{d['posterior']}; this lesion is a {name.lower()} ({proof}). " + BREAST_US_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch29-o06", "ch18-o01"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
            echo, post = d["echogenicity"], d["posterior"]
            options = [("anechoic", "Anechoic (no internal echoes)", echo == "anechoic"), ("hypoechoic", "Hypoechoic (darker than fat)", echo == "hypoechoic"),
                       ("heterogeneous", "Heterogeneous echo pattern", echo == "heterogeneous"), ("hyperechoic", "Hyperechoic (brighter than fat)", echo == "hyperechoic"),
                       ("enh", "Posterior acoustic enhancement", post == "enhancement"), ("shad", "Posterior acoustic shadowing", post == "shadowing"),
                       ("nopost", "No posterior features", post == "no")]
            assert sum(c for _, _, c in options) == 2, (sid, echo, post)
            tasks.append({
                "id": f"{cid}:echo", "caseId": cid, "type": "describe_finding", "title": "Describe the echoes",
                "prompt": "Describe the lesion in ultrasound terms: choose its echo pattern and what happens to the sound behind it (two answers).",
                "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": True, "options": [
                    {"id": oid, "text": text, "correct": ok,
                     "why": ("The radiologist's descriptor for this lesion." if ok else "Not the radiologist's descriptor for this lesion.")}
                    for oid, text, ok in options]},
                "scoring": "authoritative",
                "hints": [hint(1, "Echo pattern is judged against the subcutaneous fat; posterior features are judged in the tissue directly deep to the lesion.")],
                "explanation": (f"The radiologist described this lesion as {echo} with posterior features: {post}. Anechoic means no echoes "
                                "(fluid). Posterior acoustic enhancement is brighter tissue behind something that lets sound through easily, "
                                "typical of fluid; posterior shadowing is a dark band behind something that absorbs or reflects the sound, "
                                "such as a dense fibrotic cancer, calcification or bone."),
                "bookAnchors": anc, "objectiveIds": ["ch18-o01", "ch29-o06"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        else:
            hc = float(t["provenanceDetail"]["note"].split(": ", 1)[1].split(" mm", 1)[0])
            cid = f"us-fetal-head-{sid.split('_')[0]}"
            anc = anchors("ch18-o01") + [
                {"physical": 237, "printed": "217", "chapterId": "ch18", "figureId": None, "sectionId": "ch18-s29"},
                {"physical": 238, "printed": "218", "chapterId": "ch18", "figureId": None, "sectionId": "ch18-s31"},
            ]
            cases.append({
                "id": cid, "packId": pack.id, "neutralTitle": f"Obstetric ultrasound · HC18 image {sid.split('_')[0]}",
                "learnTitle": "Fetal head on the standard plane for head circumference (sonographer's ellipse)",
                "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["pelvis"],
                "clinicalContext": None, "contextSource": None, "difficulty": "intro", "objectiveIds": ["ch18-o01"], "bookAnchors": anc,
                "referenceSummary": (f"The ellipse on the outer skull was placed by a trained sonographer (HC18); the head circumference it gives "
                                     f"is {hc:.1f} mm. The image carries its true pixel size. Gestational age is not given by the dataset."),
                "learnNotes": FETAL_HEAD_NOTES,
            })
            tasks.append({
                "id": f"{cid}:head", "caseId": cid, "type": "find_structure", "title": "Find the fetal head",
                "prompt": "Mark the fetal head (inside the skull outline).",
                "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
                "targets": [{"targetId": t["id"], "name": "Fetal head", "required": True}],
                "grading": {"kind": "point_in_target", "slabToleranceMm": 1, "inPlaneToleranceMm": 2},
                "scoring": "authoritative",
                "hints": [hint(1, "Bone reflects most of the sound: look for a bright, smooth oval ring."),
                          hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": FETAL_HEAD_NOTES,
                "bookAnchors": anc, "objectiveIds": ["ch18-o01"], "skillDimensions": ["anatomy"], "allowUncertain": True,
            })
            bins = [(0, 100, "Under 100 mm"), (100, 200, "100 to 200 mm"), (200, 300, "200 to 300 mm"), (300, 10_000, "Over 300 mm")]
            assert all(abs(hc - b) > 10 for lo, hi, _ in bins for b in (lo, hi) if 0 < b < 10_000), (sid, hc)  # no answer near a bin edge
            tasks.append({
                "id": f"{cid}:hc", "caseId": cid, "type": "describe_finding", "title": "Measure the head circumference",
                "prompt": ("Measure the biparietal diameter (short axis, outer to outer edge of the skull) and the occipitofrontal diameter "
                           "(long axis) with the length tool. Head circumference is about pi x (BPD + OFD) / 2. Which range is it in?"),
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": f"b{i}", "text": text, "correct": lo <= hc < hi,
                     "why": (f"The sonographer's ellipse gives {hc:.0f} mm." if lo <= hc < hi else "Not the range of the sonographer's measurement.")}
                    for i, (lo, hi, text) in enumerate(bins)]},
                "scoring": "authoritative",
                "hints": [hint(1, "Measure on the outer edge of the bright skull, not the inner edge; the image's pixel size makes the ruler read true millimetres.")],
                "explanation": (f"The sonographer's head circumference on this image is {hc:.1f} mm. " + FETAL_HEAD_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch18-o01"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ mammography (round 3): masses and calcifications on CC and MLO
MAMMO_NOTES = ("A screening mammogram has two views of each breast: craniocaudal (CC, from above) and mediolateral oblique (MLO, at an "
               "angle, with the pectoral muscle along the back of the breast). Hang the two breasts mirror-image, chest walls to the "
               "middle, and compare left with right. A real finding should be found on both views; on the MLO a lesion lies at about "
               "the same distance from the nipple as on the CC. Describe a mass by its shape (oval, round, irregular), margin "
               "(circumscribed, obscured, microlobulated, indistinct, spiculated) and density: irregular, spiculated and dense favors "
               "cancer; oval, circumscribed and low density favors a benign lesion. Calcifications are described by form (round, coarse, "
               "rod-like and vascular are typically benign; fine pleomorphic and fine linear are suspicious) and distribution (diffuse, "
               "regional, grouped, linear, segmental).")


def mammo_lessons() -> None:
    pack = Pack("mammo-cbis")
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        sers = sorted((s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]), key=lambda s: s["number"])
        tgts = [t for s in sers for t in pack.manifest["referenceTargets"] if t["seriesUid"] == s["uid"]]
        pid = subj["sourceSubjectId"]
        calc = tgts[0]["classId"] == "finding:breast_calcifications"
        objs = ["ch29-o05", "ch29-o01"] if calc else ["ch29-o03", "ch29-o01"]
        anc = anchors(*objs)
        sides = sorted({s["acquisition"]["ImageLaterality"] for s in sers})
        views = "both breasts, CC and MLO" if len(sides) == 2 else f"{'left' if sides == ['L'] else 'right'} breast, CC and MLO"
        what = tgts[0]["label"].split(": ", 1)[1]
        notes = tgts[0]["provenanceDetail"]["note"]
        path = "malignant" if "MALIGNANT" in notes else "benign"
        cid = f"mg-cbis-{pid.lower().replace('_', '')}"
        cc = next(s for s in sers if s["acquisition"]["ViewPosition"] == "CC")
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Mammogram, {views} · CBIS-DDSM {pid}",
            "learnTitle": (f"{'Calcifications' if calc else 'Mass'} on CC and MLO mammograms ({path} at pathology; "
                           f"{'DDSM region outline' if calc else 'mass outline'})"),
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": cc["uid"], "region": ["breast"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": objs, "bookAnchors": anc,
            "referenceSummary": (f"{'Calcifications' if calc else 'Mass'} outlined on every view ({what}); BI-RADS assessment and pathology "
                                 "as given in the CBIS-DDSM case description. "
                                 + ("Calcification outlines are the original DDSM regions, drawn around the group, not around each particle. "
                                    if calc else "Mass outlines were refined in CBIS-DDSM from the original DDSM contours. ")
                                 + "Digitised screen-film mammograms, downsampled 2x2; no pixel spacing, so distances are not measurable."),
            "learnNotes": MAMMO_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": f"Find the {'calcifications' if calc else 'mass'} on both views",
            "prompt": "Read every view, comparing the two breasts. Mark the abnormality on each view where you see it (point, box or outline), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
            "start": {"seriesUid": cc["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": "Breast calcifications" if calc else "Breast mass", "required": True} for t in tgts],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                        "inPlaneToleranceMm": 30, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Hang the CC views and the MLO views mirror-image and compare left with right, quadrant by quadrant."),
                      hint(2, "Found it on one view? On the other view it lies at about the same distance from the nipple."),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": MAMMO_NOTES + " These films have no pixel spacing, so the tolerance is counted in pixels.",
            "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
        })
        if not calc:
            margin = what.split(", ", 1)[1].split(" margin", 1)[0]
            shape = what.split(",", 1)[0]
            assert margin in ("circumscribed", "spiculated") and shape in ("oval", "irregular"), what
            tasks.append({
                "id": f"{cid}:margin", "caseId": cid, "type": "describe_finding", "title": "Describe the mass margin",
                "prompt": "Zoom in on the mass on both views. How would you describe its margin?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
                "start": {"seriesUid": cc["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": m, "text": m.capitalize(), "correct": m == margin, "why": why} for m, why in (
                        ("circumscribed", "Sharp, well-defined edge over most of the outline: favors a benign lesion."),
                        ("obscured", "Edge hidden by overlapping normal tissue."),
                        ("microlobulated", "Small undulations of the edge."),
                        ("indistinct", "Poorly defined edge, suggesting infiltration."),
                        ("spiculated", "Lines radiating from the edge: the most suspicious margin."))]},
                "scoring": "authoritative",
                "hints": [hint(1, "Follow the edge of the mass all the way round; spicules are thin lines that radiate out from it.")],
                "explanation": (f"The case description gives shape {shape} and margin {margin}; pathology {path} (BI-RADS assessment and "
                                "pathology from CBIS-DDSM). " + MAMMO_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch29-o03"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ children's wrist fractures and knee osteoarthritis grades (round 3)
PEDS_FX_NOTES = ("Children's bones bend and buckle before they break, and the growth plate (physis) is weaker than the ligaments around "
                 "it. A torus (buckle) fracture is a bulge or kink of the cortex where the metaphysis was compressed; a greenstick "
                 "fracture breaks one cortex and bends the other. Salter-Harris fractures involve the growth plate: type I runs through "
                 "the plate alone, type II (the commonest) runs along the plate and out through the metaphysis, leaving a metaphyseal "
                 "corner fragment; types III and IV cross the epiphysis into the joint, and type V is a crush of the plate. Types I and "
                 "II usually heal well; the higher types risk early fusion of the plate and growth disturbance. Always read two views.")
KNEE_OA_NOTES = ("Osteoarthritis narrows the joint space unevenly (in the knee usually the medial compartment, which bears most weight) "
                 "and makes bone: subchondral sclerosis and osteophytes at the joint margins, sometimes with subchondral cysts. The "
                 "Kellgren-Lawrence scale grades it on a radiograph: 0 none; 1 doubtful narrowing and possible small osteophytes; 2 "
                 "definite osteophytes with possible narrowing; 3 moderate multiple osteophytes, definite narrowing, some sclerosis; 4 "
                 "large osteophytes, marked narrowing, severe sclerosis and deformed bone ends. Grade 2 or more is usually taken as "
                 "definite osteoarthritis.")


def peds_msk_lessons() -> None:
    pack = Pack("peds-msk")
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        sers = sorted((s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]), key=lambda s: s["number"])
        if subj["key"].startswith("figshare:GRAZPEDWRI-DX:"):
            tgts = [t for s in sers for t in pack.manifest["referenceTargets"] if t["seriesUid"] == s["uid"]]
            sh2 = tgts[0]["classId"] == "finding:physeal_fracture"
            objs = ["ch27-o07", "ch23-o01"] if sh2 else ["ch23-o01"]
            anc = anchors(*objs)
            side = "left" if sers[0]["acquisition"]["ImageLaterality"] == "L" else "right"
            age = int(subj["ageAtFirstStudy"][:3])
            cid = f"peds-wrist-{int(subj['sourceSubjectId']):04d}"
            cases.append({
                "id": cid, "packId": pack.id, "neutralTitle": f"Wrist radiographs, child · GRAZPEDWRI-DX {int(subj['sourceSubjectId']):04d}",
                "learnTitle": ("Salter-Harris II fracture of the distal radius (radiologist box)" if sh2
                               else "Incomplete (torus/buckle or greenstick) fracture of the distal radius (radiologist box)"),
                "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": sers[0]["uid"], "region": ["extremity"],
                "clinicalContext": f"{'Girl' if subj['sex'] == 'F' else 'Boy'}, {age} years, {side} wrist injury.",
                "contextSource": "Age, sex and side from the dataset (GRAZPEDWRI-DX dataset.csv); trauma from the dataset description.",
                "difficulty": "typical" if sh2 else "subtle", "objectiveIds": objs, "bookAnchors": anc,
                "referenceSummary": ("The fracture is boxed on both views in the dataset's annotations, which pediatric radiologists reviewed "
                                     f"(GRAZPEDWRI-DX). The fracture type comes from the AO/OTA pediatric code in the dataset "
                                     f"({tgts[0]['provenanceDetail']['note'].split(' (', 1)[0].rsplit(' ', 1)[1]}). Nothing else is referenced."),
                "learnNotes": PEDS_FX_NOTES,
            })
            tasks.append({
                "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the fracture on both views",
                "prompt": "Trace the cortex of the radius and ulna and look at the growth plates on both views. Mark any fracture you find (point or box), or state that you find none.",
                "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
                "start": {"seriesUid": sers[0]["uid"], "slice": "first", "windowPreset": None},
                "targets": [{"targetId": t["id"], "name": "Fracture", "required": True} for t in tgts],
                "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                            "inPlaneToleranceMm": 8, "allowNoFinding": True},
                "scoring": "authoritative",
                "hints": [hint(1, "Follow both cortices of the distal radius on each view: look for a bulge, a kink, a step or a widened growth plate."),
                          hint(5, "Reveal the reference answer.", {"type": "reveal"})],
                "explanation": PEDS_FX_NOTES + " Pixel spacing here is measured at the detector, so distances are slightly magnified.",
                "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
            })
            tasks.append({
                "id": f"{cid}:type", "caseId": cid, "type": "differential", "title": "What kind of fracture?",
                "prompt": "Look at where the fracture is in relation to the growth plate, and whether one or both cortices are broken. Which describes it best?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
                "start": {"seriesUid": sers[0]["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "sh1", "text": "Salter-Harris I: through the growth plate only", "correct": False,
                     "why": "Type I separates the epiphysis along the plate with no metaphyseal or epiphyseal fragment; it may only widen the plate."},
                    {"id": "sh2", "text": "Salter-Harris II: along the growth plate and out through the metaphysis", "correct": sh2,
                     "why": "Type II leaves a corner fragment of metaphysis attached to the displaced epiphysis."},
                    {"id": "incomplete", "text": "Incomplete metaphyseal fracture: torus (buckle) or greenstick", "correct": not sh2,
                     "why": "A bulge or kink of the cortex, or a break of one cortex only, in the metaphysis, with the growth plate spared."},
                    {"id": "complete", "text": "Complete metaphyseal fracture through both cortices", "correct": False,
                     "why": "A complete fracture crosses the whole bone, with a line through both cortices."}]},
                "scoring": "authoritative",
                "hints": [hint(1, "Find the growth plate first, then decide whether the fracture line reaches it.")],
                "explanation": ("The dataset codes this fracture as " + ("AO/OTA E/2: a Salter-Harris II fracture. " if sh2 else
                                "AO/OTA M/2: an incomplete metaphyseal fracture (torus/buckle or greenstick; the code does not separate them). ")
                                + PEDS_FX_NOTES),
                "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        else:
            se = sers[0]
            tg = [t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]]
            note = tg[0]["provenanceDetail"]["note"]
            grade = int(note.split("grade ", 1)[1][0])
            objs = ["ch21-o08", "ch21-o07"]
            anc = anchors(*objs)
            cid = f"knee-kl-{subj['sourceSubjectId'][:8]}"
            cases.append({
                "id": cid, "packId": pack.id, "neutralTitle": f"Knee radiograph · Digital Knee X-ray {subj['sourceSubjectId'][:8]}",
                "learnTitle": f"Knee: Kellgren-Lawrence grade {grade} (graded by two experts; not outlined)",
                "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["extremity"],
                "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": objs, "bookAnchors": anc,
                "referenceSummary": (f"Two medical experts each graded this image Kellgren-Lawrence {grade} (Digital Knee X-ray Images). The "
                                     "grade is for the whole image: no osteophyte, narrowing or sclerosis is marked. Small crop of the joint as "
                                     "distributed; no pixel spacing, side or view in the source."),
                "learnNotes": KNEE_OA_NOTES,
            })
            tasks.append({
                "id": f"{cid}:grade", "caseId": cid, "type": "differential", "title": "Grade the osteoarthritis",
                "prompt": "Look at the joint space, the joint margins and the bone under the cartilage. Which Kellgren-Lawrence grade fits best?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
                "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": f"kl{g}", "text": text, "correct": g == grade, "why": why} for g, text, why in (
                        (0, "Grade 0: no features of osteoarthritis", "Normal joint space and margins."),
                        (1, "Grade 1: doubtful", "Doubtful narrowing, possible tiny osteophytes."),
                        (2, "Grade 2: mild", "Definite osteophytes, joint space possibly narrowed."),
                        (3, "Grade 3: moderate", "Multiple osteophytes, definite narrowing, some sclerosis."),
                        (4, "Grade 4: severe", "Large osteophytes, marked narrowing, severe sclerosis, deformed bone ends."))]},
                "scoring": "authoritative",
                "hints": [hint(1, "Compare the medial and lateral joint spaces, then look at the tibial spines and the joint margins for osteophytes.")],
                "explanation": (f"Both experts graded this image {grade}. The grade is image-level: the dataset does not mark where the "
                                "osteophytes or narrowing are. " + KNEE_OA_NOTES),
                "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    cxr_lessons()
    pe_lessons()
    ct_lessons()
    fx_lessons()
    tumor_lessons()
    stroke_lessons()
    us_lessons()
    mammo_lessons()
    peds_msk_lessons()
