"""Lessons for the `more-ct-xr` pack: more CT and radiograph patients built from the same task
templates as the earlier packs, plus children's CTs in which experts outlined every organ.
Run: python scripts/lessons/more_ct_xr.py
"""
import json

from common import PACKS, Pack, anchor, frontal_cxr_tasks, hint, oral_exam_task, write_lessons
from objectives import objective_anchors, objectives_for

P = Pack("more-ct-xr")
cases, tasks = [], []
letters = iter([f"A{c}" for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"])
A_CT_CONVENTION = anchor(32, "17", "ch02", note="Viewing convention for chest CT")
A_LOW_CARDIAC = anchor(42, "27", "ch03", note="High and low cardiac levels")
A_NODULE = anchor(118, "98", "ch10", note="Solitary nodule/mass in the lung")
A_NODULE_SIGNS = anchor(120, "100", "ch10", note="Signs of a benign versus malignant nodule")
A_LUNG_CT = anchor(33, "18", "ch02", note="Normal CT anatomy of the lungs; lung windows")
A_AIRSPACE = anchor(49, "34", "ch04", note="Characteristics of airspace disease")
A_COVID = anchor(88, "73", "ch08", figure="Fig 8.9", note="COVID-19 pneumonia")
A_AP_MAGNIFY = anchor(36, "21", "ch02", note="AP vs PA heart magnification")
CXR_OBJ = {"tech": ["ch02-o01"], "borders": ["ch03-o02"], "ctr": ["ch03-o01"]}


def subjects(source: str):
    return [s for s in P.manifest["subjects"] if s["sourceId"] == f"tcia:{source}"]


def preset(series, name):
    return next((w["label"] for w in series["windowPresets"] if w["label"].lower().startswith(name.lower())), None)


def slab(series):
    return round((series["geometry"]["sliceSpacing"] or 3.0) / 2 + 0.2, 2)


def geometry(tid):
    return json.loads((PACKS / P.id / P.targets[tid]["geometryFile"]).read_text(encoding="utf-8"))


def find_task(case_id, ct, tid, key, name, prompt, tol, anchors, objectives, window, modes=("learn", "practice", "assess")):
    return {
        "id": f"{case_id}:{key}", "caseId": case_id, "type": "find_structure", "title": f"Find the {name.lower()}", "prompt": prompt,
        "modes": list(modes), "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": window},
        "targets": [{"targetId": tid, "name": name, "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": slab(ct), "inPlaneToleranceMm": tol}, "scoring": "authoritative",
        "hints": [hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tid}), hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "Graded against the expert outline from the source dataset; a point outside it is reported with its distance.",
        "bookAnchors": anchors, "objectiveIds": objectives, "skillDimensions": ["anatomy"], "allowUncertain": True,
    }


def labelled_task(case_id, ct, key, title, prompt, items, anchors, objectives, window, hints_, tol=2.5):
    return {
        "id": f"{case_id}:{key}", "caseId": case_id, "type": "find_structure", "title": title, "prompt": prompt,
        "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": window},
        "targets": [{"targetId": t, "name": n, "required": True} for t, n in items],
        "grading": {"kind": "labelled_points", "slabToleranceMm": slab(ct), "inPlaneToleranceMm": tol, "levelTargetId": None, "requireLabels": True},
        "scoring": "authoritative", "hints": [hint(1, h) for h in hints_] + [hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "One-to-one matching against the expert outlines; identity and side are graded separately from position.",
        "bookAnchors": anchors, "objectiveIds": objectives, "skillDimensions": ["anatomy", "orientation"], "allowUncertain": True,
    }


# ------------------------------------------------------------------ Pediatric-CT-SEG: every organ outlined by experts
A_ABD_LIVER = objective_anchors("ch13-o03", 1)
A_ABD_PANC = objective_anchors("ch13-o04", 1)
A_ABD_BOWEL = objective_anchors("ch13-o06", 1)
for subj in subjects("Pediatric-CT-SEG"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    have = {t["id"].split("_", 1)[1]: t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"]}
    age = int((subj.get("ageAtFirstStudy") or "0Y")[:-1])
    region = "chest, abdomen and pelvis" if "thymus" in have else "abdomen and pelvis"
    case_id = f"more-{sid.lower()}"
    letter = next(letters)
    soft = preset(ct, "soft")
    cases.append({
        "id": case_id, "packId": P.id, "neutralTitle": f"Patient {letter} · CT {region} (child, {age} y)",
        "learnTitle": f"Paediatric CT with every organ outlined by experts ({sid})", "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["chest", "abdomen", "pelvis"] if "thymus" in have else ["abdomen", "pelvis"], "clinicalContext": f"Child aged {age} years (DICOM header).", "contextSource": "DICOM PatientAge",
        "difficulty": "typical", "objectiveIds": objectives_for("abdomen_ct_anatomy") + (objectives_for("thymus") if "thymus" in have else []),
        "bookAnchors": A_ABD_LIVER + A_ABD_PANC + A_ABD_BOWEL,
        "referenceSummary": f"Expert organ contours from the Pediatric-CT-SEG collection: {len(have)} structures (organs, bowel, glands, femoral heads, all bones). Every organ in the field of view is outlined, so this is a complete anatomy study.",
        "learnNotes": "Turn on Anatomy and click each structure to see it alone; then switch to Practice and find them without labels. Children have less fat, so organs sit closer together than in adults.",
    })
    tasks.append({
        "id": f"{case_id}:tour", "caseId": case_id, "type": "find_structure", "title": "Anatomy tour: every organ, one by one",
        "prompt": "Open the Anatomy tab and click each structure in turn: the viewer jumps to it and shows it alone. For each one, say which neighbours touch it, then scroll to its top and bottom.",
        "modes": ["learn"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "middle", "windowPreset": soft},
        "targets": [], "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
        "hints": [hint(1, "Use ‹ and › in the banner on the image to step through the structures in order.")],
        "explanation": "Seeing each organ alone, then in context, builds the 3D map you need before looking for disease.",
        "rubric": [
            {"id": "all", "text": "Visited every structure in the list", "weight": "essential", "category": "location"},
            {"id": "neigh", "text": "Named the neighbours of the liver, pancreas, kidneys and bladder", "weight": "essential", "category": "location"},
            {"id": "extent", "text": "Found the top and bottom slice of at least three organs", "weight": "supportive", "category": "finding"},
        ],
        "bookAnchors": A_ABD_LIVER + A_ABD_PANC, "objectiveIds": objectives_for("abdomen_ct_anatomy"), "skillDimensions": ["anatomy"], "allowUncertain": True,
    })
    solid = [(k, n) for k, n in [("liver", "Liver"), ("spleen", "Spleen"), ("right-kidney", "Right kidney"), ("left-kidney", "Left kidney"), ("pancreas", "Pancreas"), ("gallbladder", "Gallbladder")] if k in have]
    if len(solid) >= 5:
        tasks.append(labelled_task(case_id, ct, "solid-organs", "Name the solid organs",
                                   "With named arrows, mark: " + ", ".join(n.lower() for _, n in solid) + ".",
                                   [(have[k], n) for k, n in solid], A_ABD_LIVER + A_ABD_PANC, objectives_for("abdomen_ct_anatomy"), soft,
                                   ["Soft-tissue window. The liver is on the patient's right — the left of the screen.", "The pancreas lies in front of the splenic vein; the gallbladder hangs under the liver."]))
    if "pancreas" in have:
        tasks.append(find_task(case_id, ct, have["pancreas"], "pancreas", "Pancreas", "Find the pancreas and place one point inside it. Then trace it from head to tail.", 2.0, A_ABD_PANC, objectives_for("pancreas_ct"), soft))
    adrenals = [(k, n) for k, n in [("right-adrenal-gland", "Right adrenal gland"), ("left-adrenal-gland", "Left adrenal gland")] if k in have]
    if len(adrenals) == 2:
        tasks.append(labelled_task(case_id, ct, "adrenals", "Find both adrenal glands", "Mark the right and left adrenal glands with named arrows.",
                                   [(have[k], n) for k, n in adrenals], A_ABD_PANC, objectives_for("abdomen_ct_anatomy"), soft,
                                   ["They sit above and in front of the upper poles of the kidneys; the right one is behind the IVC."], tol=2.0))
    bowel = [(k, n) for k, n in [("stomach", "Stomach"), ("duodenum", "Duodenum"), ("small-intestine", "Small bowel"), ("large-intestine", "Large bowel (colon)"), ("rectum", "Rectum")] if k in have]
    if len(bowel) >= 4:
        tasks.append(labelled_task(case_id, ct, "bowel", "Follow the bowel", "Mark each part of the gut with a named arrow: " + ", ".join(n.lower() for _, n in bowel) + ".",
                                   [(have[k], n) for k, n in bowel], A_ABD_BOWEL, objectives_for("bowel_ct"), soft,
                                   ["The duodenum curves around the head of the pancreas.", "The colon frames the abdomen; small bowel loops sit centrally."]))
    pelvis = [(k, n) for k, n in [("urinary-bladder", "Urinary bladder"), ("prostate", "Prostate"), ("uterus-and-cervix", "Uterus and cervix"), ("right-femoral-head", "Right femoral head"), ("left-femoral-head", "Left femoral head")] if k in have]
    if len(pelvis) >= 3:
        tasks.append(labelled_task(case_id, ct, "pelvis", "Pelvic anatomy", "Mark with named arrows: " + ", ".join(n.lower() for _, n in pelvis) + ".",
                                   [(have[k], n) for k, n in pelvis], A_ABD_BOWEL, objectives_for("abdomen_ct_anatomy"), soft,
                                   ["The bladder is the fluid-filled structure behind the pubic bones; the femoral heads sit in the acetabula."]))
    if "thymus" in have:
        tasks.append(find_task(case_id, ct, have["thymus"], "thymus", "Thymus",
                               "In this young child, find the thymus in the anterior mediastinum and place one point inside it. It is normal at this age — the reason a child's mediastinum can look wide on a radiograph.",
                               2.5, objective_anchors("ch27-o06", 1), objectives_for("thymus"), preset(ct, "mediastinum") or soft))

# ------------------------------------------------------------------ RICORD: chest radiograph classification by three expert reader groups
RICORD_CLASS = {
    "Typical Appearance": ("typical", "Typical: multifocal, bilateral, peripheral and lower-zone predominant opacities."),
    "Indeterminate Appearance": ("indeterminate", "Indeterminate: opacities present but without the typical distribution (e.g. unilateral, central or upper-zone)."),
    "Atypical Appearance": ("atypical", "Atypical: findings that point elsewhere — lobar consolidation, a solitary nodule or mass, cavitation, pleural effusion or pneumothorax."),
    "Negative for Pneumonia": ("negative", "Negative: no lung opacity."),
}
SEVERITY = {"mild": "Mild (1–2 lung zones)", "moderate": "Moderate (3–4 lung zones)", "severe": "Severe (more than 4 lung zones)"}
for subj in subjects("MIDRC-RICORD-1C"):
    sid = subj["sourceSubjectId"]
    xr = next(s for s in P.manifest["series"] if s["subjectKey"] == subj["key"])
    labs = [set(geometry(t["id"])["labels"]) for t in P.manifest["referenceTargets"] if t["seriesUid"] == xr["uid"]]
    agreed = set.intersection(*labs) if labs else set()
    cls = next((RICORD_CLASS[k] for k in RICORD_CLASS if k in agreed), None)
    sev = next((k for k in SEVERITY for lab in agreed if lab.lower().startswith(k)), None)
    if not cls:
        continue
    case_id = f"more-{sid.lower()}"
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": P.id, "neutralTitle": f"Patient {letter} · Chest radiograph",
        "learnTitle": f"COVID-19 chest radiograph classified by three expert reader groups ({sid})", "subjectKey": subj["key"], "studyUids": [xr["studyUid"]], "primarySeriesUid": xr["uid"],
        "region": ["chest"], "clinicalContext": "Adult with positive COVID-19 testing (source collection description). The category depends on the image, not on the test.",
        "contextSource": "TCIA MIDRC-RICORD-1C collection description", "difficulty": "typical",
        "objectiveIds": objectives_for("covid_cxr"), "bookAnchors": [A_COVID, A_AIRSPACE],
        "referenceSummary": f"Study-level labels from three independent expert reader groups (RICORD), who agreed on: {', '.join(sorted(agreed))}. There are no outlines, so position is self-reviewed.",
        "learnNotes": "Describe distribution first (side, zone, central vs peripheral), then classify. The category is a pattern statement, not a diagnosis.",
    })
    tasks.append({
        "id": f"{case_id}:classify", "caseId": case_id, "type": "describe_finding", "title": "Classify the radiograph",
        "prompt": "Read the radiograph and choose the category the expert readers would assign for COVID-19 pneumonia.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [xr["uid"]], "start": {"seriesUid": xr["uid"], "slice": "first", "windowPreset": None},
        "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": k, "text": text.split(":")[0], "correct": k == cls[0], "why": text} for k, text in [v for v in RICORD_CLASS.values()]
        ]}, "scoring": "authoritative",
        "hints": [hint(1, "Divide each lung into upper, middle and lower zones and inner and outer halves; where are the opacities?")],
        "explanation": f"All three reader groups chose this category. {cls[1]}",
        "bookAnchors": [A_COVID, A_AIRSPACE], "objectiveIds": objectives_for("covid_cxr"), "skillDimensions": ["interpretation"], "allowUncertain": True,
    })
    if sev:
        tasks.append({
            "id": f"{case_id}:extent", "caseId": case_id, "type": "describe_finding", "title": "How much lung is involved?",
            "prompt": "Count the lung zones with opacity (three per lung) and choose the extent.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [xr["uid"]], "start": {"seriesUid": xr["uid"], "slice": "first", "windowPreset": None},
            "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": k, "text": v, "correct": k == sev, "why": f"{v}. The readers counted zones on the frontal film."} for k, v in SEVERITY.items()
            ]}, "scoring": "authoritative",
            "hints": [hint(1, "Zones: upper, middle and lower on each side — six in total.")],
            "explanation": "Extent is counted in zones; it tracks severity and change over time better than a single word.",
            "bookAnchors": [A_COVID], "objectiveIds": objectives_for("covid_cxr")[:1], "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
    tasks.extend(frontal_cxr_tasks(case_id, xr, "AP", objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), CXR_OBJ)[:1])

# ------------------------------------------------------------------ COVID-19-AR: same-day radiograph + CT
for subj in subjects("COVID-19-AR"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    xrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] in ("CR", "DX")]
    st_ct = P.studies[ct["studyUid"]]
    pe = "PE" in (st_ct["description"] or "").upper().split()  # a word, not the "PE" in "PELVIS"
    case_id = f"more-{sid.lower()}"
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": P.id, "neutralTitle": f"Patient {letter} · Chest radiograph + CT {'chest' if pe else 'chest, abdomen and pelvis'}",
        "learnTitle": f"Same-day portable radiograph and {'CT pulmonary angiogram' if pe else 'venous-phase CT'} ({sid})", "subjectKey": subj["key"],
        "studyUids": sorted({ct["studyUid"], *[x["studyUid"] for x in xrs]}), "primarySeriesUid": xrs[0]["uid"],
        "region": ["chest"] if pe else ["chest", "abdomen"], "clinicalContext": "Adult from a research cohort of patients with positive COVID-19 testing (source collection description). The cohort label is not a finding on these images.",
        "contextSource": "TCIA COVID-19-AR collection description", "difficulty": "typical",
        "objectiveIds": objectives_for("airspace_pattern") + objectives_for("ct_phase"), "bookAnchors": [A_AIRSPACE, A_COVID, A_AP_MAGNIFY],
        "referenceSummary": "No finding-level reference — tasks are self-reviewed against checklists, except the contrast-phase question, which is answered from the study description in the source data. Radiograph and CT on the same day.",
        "learnNotes": "Read the radiograph first, then the CT, and say what the CT adds.",
    })
    tasks.append({
        "id": f"{case_id}:correlate", "caseId": case_id, "type": "correlate_modalities", "title": "Radiograph first, then CT",
        "prompt": "Read the portable radiograph and describe the lungs. Then read the same-day CT and say what it confirms, adds or contradicts.",
        "modes": ["learn", "practice"], "seriesUids": [xrs[0]["uid"], ct["uid"]], "start": {"seriesUid": xrs[0]["uid"], "slice": "first", "windowPreset": None},
        "targets": [], "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
        "hints": [hint(1, "AP portable film: heart size is not reliable."), hint(2, "For each opacity: side, zone, central vs peripheral, airspace vs interstitial.")],
        "explanation": "There is no expert finding reference here; compare your description with the checklist and the linked book pages.",
        "rubric": [
            {"id": "tech", "text": "Stated projection/technique and its limits", "weight": "essential", "category": "limitation"},
            {"id": "lungs", "text": "Described both lungs by zone, including whether they are clear", "weight": "essential", "category": "finding"},
            {"id": "ct", "text": "On CT, separated ground-glass from consolidation and described distribution", "weight": "essential", "category": "pattern"},
            {"id": "adds", "text": "Said what the CT adds that the radiograph could not show", "weight": "supportive", "category": "finding"},
        ],
        "bookAnchors": [A_AIRSPACE, A_COVID], "objectiveIds": objectives_for("airspace_pattern"), "skillDimensions": ["cross_modality", "interpretation"], "allowUncertain": True,
    })
    tasks.append({
        "id": f"{case_id}:phase", "caseId": case_id, "type": "choose_window", "title": "Which contrast phase is this CT?",
        "prompt": "Compare the brightness of the pulmonary arteries, the aorta and (if included) the portal vein and kidneys. Which phase was this CT timed for?",
        "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "middle", "windowPreset": preset(ct, "mediastinum")},
        "targets": [], "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "pa", "text": "Pulmonary arterial (CT pulmonary angiogram)", "correct": pe, "why": "The pulmonary arteries are brighter than the aorta: contrast was timed for the pulmonary arteries, to look for emboli."},
            {"id": "venous", "text": "Portal venous", "correct": not pe, "why": "Arteries and veins are similarly enhanced and the liver and portal vein are bright: a venous-phase body CT."},
            {"id": "none", "text": "No IV contrast", "correct": False, "why": "The vessels are clearly brighter than muscle, so contrast was given."},
        ]}, "scoring": "authoritative",
        "hints": [hint(1, "Hover the main pulmonary artery and the aorta and compare the HU values.")],
        "explanation": f"The source study is described as '{st_ct['description']}'. Knowing the phase tells you which vessels you can judge.",
        "bookAnchors": objective_anchors("ch13-o01", 1), "objectiveIds": objectives_for("ct_phase"), "skillDimensions": ["navigation_windowing"], "allowUncertain": True,
    })
    tasks.extend(frontal_cxr_tasks(case_id, xrs[0], "AP", objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), CXR_OBJ))

# ------------------------------------------------------------------ LIDC: nodules on CT + PA/lateral radiograph
for subj in subjects("LIDC-IDRI"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    xrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] in ("CR", "DX")]
    nods = sorted(t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"] and t["classId"] == "finding:lung_nodule")
    if not nods:
        continue
    case_id = f"more-{sid.lower()}"
    lung = preset(ct, "lung")
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": P.id, "neutralTitle": f"Patient {letter} · {'Chest radiograph + ' if xrs else ''}CT chest",
        "learnTitle": f"Lung nodules on CT ({sid})", "subjectKey": subj["key"], "studyUids": sorted({ct["studyUid"], *[x["studyUid"] for x in xrs]}), "primarySeriesUid": ct["uid"],
        "region": ["chest"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("lung_nodule"), "bookAnchors": [A_NODULE, A_NODULE_SIGNS, A_LUNG_CT],
        "referenceSummary": f"{len(nods)} nodule(s) ≥3 mm outlined by multiple LIDC-IDRI readers. Only reader-marked nodules are referenced; unmatched marks are unscored. Radiograph/CT interval unknown (placeholder dates).",
        "learnNotes": "Search both lungs apex to base in a lung window; confirm candidates are round on MPR rather than branching vessels.",
    })
    tasks.append({
        "id": f"{case_id}:search", "caseId": case_id, "type": "whole_study", "title": "Search the CT for lung nodules",
        "prompt": "Search both lungs and mark every lung nodule you find (point or box). The number is not disclosed. If you find none, say so.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": lung},
        "targets": [{"targetId": n, "name": f"Nodule {i + 1}", "required": True} for i, n in enumerate(nods)],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": None, "slabToleranceMm": 2.0, "inPlaneToleranceMm": 3.0, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Lung window; scroll each lung separately."), hint(3, "Jumping to a slice with one referenced nodule.", {"type": "jumpToTarget", "targetId": nods[0]}), hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "Detection is matched one-to-one against reader outlines; keep searching after the first nodule.",
        "bookAnchors": [A_NODULE, A_LUNG_CT], "objectiveIds": objectives_for("lung_nodule"), "skillDimensions": ["finding_localization", "navigation_windowing"], "allowUncertain": True,
    })
    tasks.append(oral_exam_task(case_id, [ct["uid"]] + [x["uid"] for x in xrs], ct["uid"], "growth over time cannot be judged from one study", "a pulmonary vessel seen end-on or a granuloma", [A_NODULE_SIGNS, A_NODULE], objectives_for("lung_nodule"), window=lung))
    for x in xrs:
        tasks.extend(frontal_cxr_tasks(case_id, x, "PA", objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), CXR_OBJ))
        break

# ------------------------------------------------------------------ LCTSC: chest CT anatomy with organ-at-risk contours
for subj in subjects("LCTSC"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    tid = lambda n, sid=sid: f"{sid.lower()}_{n}"  # noqa: E731
    if not all(tid(x) in P.targets for x in ("heart", "esophagus", "spinal-cord", "left-lung", "right-lung")):
        continue
    case_id = f"more-{sid.lower()}"
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": P.id, "neutralTitle": f"Patient {letter} · CT chest",
        "learnTitle": f"Chest CT anatomy with source organ contours ({sid})", "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["chest"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("ct_chest_anatomy"), "bookAnchors": [A_CT_CONVENTION],
        "referenceSummary": "Source radiotherapy organ-at-risk contours (LCTSC): heart, both lungs, esophagus, spinal cord only.",
        "learnNotes": "Another unseen patient: repeat the anatomy skills without hints first. Contours follow radiotherapy definitions.",
    })
    tasks.append(labelled_task(case_id, ct, "five-structures", "Name five structures", "With named arrows, mark: heart, esophagus, spinal cord, right lung and left lung (any slices).",
                               [(tid(t), n) for t, n in [("heart", "Heart"), ("esophagus", "Esophagus"), ("spinal-cord", "Spinal cord"), ("right-lung", "Right lung"), ("left-lung", "Left lung")]],
                               [A_CT_CONVENTION, A_LOW_CARDIAC], objectives_for("ct_chest_anatomy") + objectives_for("heart_ct")[:1], "Mediastinum",
                               ["Mediastinal window for heart, esophagus and cord; lung window for the lungs."]))
    tasks.append(find_task(case_id, ct, tid("esophagus"), "esophagus", "Esophagus", "Mark the centre of the esophagus on any axial slice.", 2.5, [A_CT_CONVENTION], objectives_for("ct_chest_anatomy"), "Mediastinum"))

write_lessons(P, "1.0.0", cases, tasks)
