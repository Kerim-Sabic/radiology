"""Lessons for the `expansion` pack: more distinct patients for unseen-patient practice, built
from the same task templates as the earlier packs. Run: python scripts/lessons/expansion.py
"""
from common import Pack, anchor, frontal_cxr_tasks, hint, oral_exam_task, write_lessons
from objectives import objective_anchors, objectives_for

P = Pack("expansion")
cases, tasks = [], []
letters = iter(list("STUVWXYZ") + [f"B{c}" for c in "ABCDEFGH"])  # BA.. so they never repeat A–Z or the more-ct-xr AA.. names
A_CT_CONVENTION = anchor(32, "17", "ch02", note="Viewing convention for chest CT")
A_LOW_CARDIAC = anchor(42, "27", "ch03", note="High and low cardiac levels")
A_NODULE = anchor(118, "98", "ch10", note="Solitary nodule/mass in the lung")
A_NODULE_SIGNS = anchor(120, "100", "ch10", note="Signs of a benign versus malignant nodule")
A_LUNG_CT = anchor(33, "18", "ch02", note="Normal CT anatomy of the lungs; lung windows")


def subjects(source: str):
    return [s for s in P.manifest["subjects"] if s["sourceId"] == f"tcia:{source}"]


def preset(series, name):
    return next((w["label"] for w in series["windowPresets"] if w["label"].lower().startswith(name.lower())), None)


# ------------------------------------------------------------------ LCTSC anatomy (unseen patients)
for subj in subjects("LCTSC"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    tid = lambda n, sid=sid: f"{sid.lower()}_{n}"  # noqa: E731
    have = {t["id"] for t in P.manifest["referenceTargets"]}
    case_id = f"exp-{sid.lower()}"
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": "expansion", "neutralTitle": f"Patient {letter} · CT chest",
        "learnTitle": f"Chest CT anatomy with source organ contours ({sid})", "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["chest"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("ct_chest_anatomy"), "bookAnchors": [A_CT_CONVENTION],
        "referenceSummary": "Source radiotherapy organ-at-risk contours (LCTSC): heart, both lungs, esophagus, spinal cord only.",
        "learnNotes": "Another unseen patient: repeat the anatomy skills without hints first. Contours follow radiotherapy definitions.",
    })
    slab = round((ct["geometry"]["sliceSpacing"] or 3.0) / 2 + 0.2, 2)
    if all(tid(x) in have for x in ("heart", "esophagus", "spinal-cord", "left-lung", "right-lung")):
        tasks.append({
            "id": f"{case_id}:five-structures", "caseId": case_id, "type": "find_structure", "title": "Name five structures",
            "prompt": "With named arrows, mark: heart, esophagus, spinal cord, right lung and left lung (any slices).",
            "modes": ["practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": tid(t), "name": n, "required": True} for t, n in [("heart", "Heart"), ("esophagus", "Esophagus"), ("spinal-cord", "Spinal cord"), ("right-lung", "Right lung"), ("left-lung", "Left lung")]],
            "grading": {"kind": "labelled_points", "slabToleranceMm": slab, "inPlaneToleranceMm": 2.5, "levelTargetId": None, "requireLabels": True},
            "scoring": "authoritative", "hints": [hint(1, "Mediastinal window for heart, esophagus and cord; lung window for the lungs."), hint(5, "Reveal.", {"type": "reveal"})],
            "explanation": "One-to-one matching; identity and side are graded separately from position.",
            "bookAnchors": [A_CT_CONVENTION, A_LOW_CARDIAC], "objectiveIds": objectives_for("ct_chest_anatomy") + objectives_for("heart_ct")[:1],
            "skillDimensions": ["anatomy", "orientation"], "allowUncertain": True,
        })
    for key, title, prompt, t, tol, topic in [
        ("heart", "Find the heart", "Navigate to the heart and place one point inside it.", "heart", 3.0, "heart_ct"),
        ("esophagus", "Find the esophagus", "Mark the centre of the esophagus on any axial slice.", "esophagus", 2.5, "ct_chest_anatomy"),
    ]:
        if tid(t) not in have:
            continue
        tasks.append({
            "id": f"{case_id}:{key}", "caseId": case_id, "type": "find_structure", "title": title, "prompt": prompt,
            "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": tid(t), "name": title.replace("Find the ", "").capitalize(), "required": True}],
            "grading": {"kind": "point_in_target", "slabToleranceMm": slab, "inPlaneToleranceMm": tol}, "scoring": "authoritative",
            "hints": [hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tid(t)}), hint(5, "Reveal.", {"type": "reveal"})],
            "explanation": "Same structure, a different patient.", "bookAnchors": [A_LOW_CARDIAC if key == "heart" else A_CT_CONVENTION],
            "objectiveIds": objectives_for(topic), "skillDimensions": ["anatomy"], "allowUncertain": True,
        })

# ------------------------------------------------------------------ LIDC nodules + radiograph
CXR_OBJ = {"tech": ["ch02-o01"], "borders": ["ch03-o02"], "ctr": ["ch03-o01"]}
for subj in subjects("LIDC-IDRI"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    xrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] in ("CR", "DX")]
    nods = sorted(t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"] and t["classId"] == "finding:lung_nodule")
    if not nods:
        continue
    case_id = f"exp-{sid.lower()}"
    lung = preset(ct, "lung")
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": "expansion", "neutralTitle": f"Patient {letter} · {'Chest radiograph + ' if xrs else ''}CT chest",
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
        desc = f"{x['description']} {x['acquisition'].get('ViewPosition') or ''}".lower()
        if "lat" in desc or x["acquisition"].get("ViewPosition") == "LL":
            continue
        tasks.extend(frontal_cxr_tasks(case_id, x, "AP" if " ap" in f" {desc}" else "PA", objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), CXR_OBJ))
        break

# ------------------------------------------------------------------ KiTS
for subj in subjects("C4KC-KiTS"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT")
    k = sid.lower()
    case_id = f"exp-{k}"
    tumour = next((t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"] and t["classId"] == "finding:renal_tumor"), None)
    if not tumour:
        continue
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": "expansion", "neutralTitle": f"Patient {letter} · CT abdomen (contrast)",
        "learnTitle": f"Arterial-phase CT with kidney and renal tumour segmentation ({sid})", "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["abdomen"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("renal_mass") + objectives_for("kidney_ct"), "bookAnchors": objective_anchors("ch17-o10", 2),
        "referenceSummary": "C4KC-KiTS manual kidney and tumour segmentation on the arterial phase; nothing else referenced.",
        "learnNotes": "Follow each kidney through its whole length; compare the two sides at each level.",
    })
    tasks.append({
        "id": f"{case_id}:mass", "caseId": case_id, "type": "locate_finding", "title": "Find the renal mass",
        "prompt": "Examine both kidneys through their full length and mark any focal abnormality, or state that you find none. Name the side.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": preset(ct, "soft")},
        "targets": [{"targetId": tumour, "name": "Renal mass", "required": True}],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": round(ct["geometry"]["sliceSpacing"] / 2 + 0.2, 2), "inPlaneToleranceMm": 3, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Compare left and right kidneys at each level."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tumour}), hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "A different patient with the same skill: contour bulge and abnormal enhancement relative to the cortex.",
        "bookAnchors": objective_anchors("ch17-o10", 2), "objectiveIds": objectives_for("renal_mass"), "skillDimensions": ["finding_localization", "orientation"], "allowUncertain": True,
    })
    tasks.append(oral_exam_task(case_id, [ct["uid"]], ct["uid"], "histology needs tissue; one phase limits characterisation", "a complex renal cyst", objective_anchors("ch17-o10", 2), objectives_for("renal_mass"), window=preset(ct, "soft")))

# ------------------------------------------------------------------ spine levels
for subj in subjects("Spine-Mets-CT-SEG"):
    sid = subj["sourceSubjectId"]
    ct = P.series_where(subj["key"], modality="CT")
    case_id = f"exp-spine-{sid}"
    levels = {t["id"].split("_")[1].split("-")[0]: t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"] and t["classId"].endswith("_vertebra")}
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": "expansion", "neutralTitle": f"Patient {letter} · CT torso (bone window)",
        "learnTitle": f"Counting vertebral levels on CT ({sid})", "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["spine"], "clinicalContext": "Adult in a spinal metastasis CT segmentation collection (source description).", "contextSource": "TCIA Spine-Mets-CT-SEG",
        "difficulty": "typical", "objectiveIds": objectives_for("spine_anatomy"), "bookAnchors": objective_anchors("ch22-o01", 2),
        "referenceSummary": f"Source manual vertebral body segmentations ({len(levels)} levels). Lesions are not referenced here.",
        "learnNotes": "Count from the last rib-bearing vertebra (usually T12) and check on the sagittal MPR.",
    })
    for lvl in ("l1", "l4", "t12"):
        if lvl not in levels:
            continue
        name = lvl.upper()
        tasks.append({
            "id": f"{case_id}:{lvl}", "caseId": case_id, "type": "navigate_level", "title": f"Find the {name} vertebral body",
            "prompt": f"Mark the {name} vertebral body. Say which landmark you counted from.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]], "start": {"seriesUid": ct["uid"], "slice": "middle", "windowPreset": preset(ct, "bone")},
            "targets": [{"targetId": levels[lvl], "name": name, "required": True}],
            "grading": {"kind": "point_in_target", "slabToleranceMm": round(ct["geometry"]["sliceSpacing"] / 2 + 0.2, 2), "inPlaneToleranceMm": 2}, "scoring": "authoritative",
            "hints": [hint(1, "Use the sagittal MPR."), hint(2, "Find the lowest rib-bearing vertebra."), hint(5, "Reveal.", {"type": "reveal"})],
            "explanation": "A mark in a neighbouring vertebra is reported as that level, so you see how many levels off you were.",
            "bookAnchors": objective_anchors("ch22-o01", 2), "objectiveIds": objectives_for("spine_anatomy"), "skillDimensions": ["anatomy", "navigation_windowing"], "allowUncertain": True,
        })

# ------------------------------------------------------------------ ReMIND
for subj in subjects("ReMIND"):
    sid = subj["sourceSubjectId"]
    mrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"]]
    t1c = next((s for s in mrs if "T1" in s["description"] and ("post" in s["description"].lower() or "gd" in s["description"].lower() or "+c" in s["description"].lower())), None)
    tumour = next((t["id"] for t in P.manifest["referenceTargets"] if t["classId"] == "finding:glioma" and t["provenance"] == "source_manual"), None)
    if not t1c or not tumour or P.targets[tumour]["seriesUid"] != t1c["uid"]:
        t1c = next((s for s in mrs if tumour and s["uid"] == P.targets[tumour]["seriesUid"]), None)
    if not t1c or not tumour:
        continue
    case_id = f"exp-{sid.lower()}"
    letter = next(letters)
    cases.append({
        "id": case_id, "packId": "expansion", "neutralTitle": f"Patient {letter} · MRI brain",
        "learnTitle": f"Brain tumour on MRI ({sid})", "subjectKey": subj["key"], "studyUids": sorted({s["studyUid"] for s in mrs}), "primarySeriesUid": t1c["uid"],
        "region": ["head"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("brain_tumour") + objectives_for("brain_mri"), "bookAnchors": objective_anchors("ch26-o11", 2),
        "referenceSummary": "Source manual tumour segmentation (ReMIND). Defaced images; placeholder dates.",
        "learnNotes": "Compare hemispheres level by level on every sequence; FLAIR for oedema, post-contrast T1 for enhancement.",
    })
    tasks.append({
        "id": f"{case_id}:find", "caseId": case_id, "type": "locate_finding", "title": "Find the abnormality",
        "prompt": "Search the brain and mark the centre of any abnormality, or state that there is none.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [t1c["uid"]], "start": {"seriesUid": t1c["uid"], "slice": "first", "windowPreset": None},
        "targets": [{"targetId": tumour, "name": "Tumour", "required": True}],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": None, "slabToleranceMm": max(1.0, round((t1c["geometry"]["sliceSpacing"] or 1) / 2 + 0.3, 2)), "inPlaneToleranceMm": 3, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Look for asymmetry and mass effect."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tumour}), hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "Mass effect, abnormal signal and enhancement locate the lesion; the reference is the source's manual segmentation.",
        "bookAnchors": objective_anchors("ch26-o11", 2), "objectiveIds": objectives_for("brain_tumour"), "skillDimensions": ["finding_localization"], "allowUncertain": True,
    })
    tasks.append(oral_exam_task(case_id, [s["uid"] for s in mrs], t1c["uid"], "MRI suggests but does not prove tumour type or grade", "a solitary metastasis or an abscess", objective_anchors("ch26-o11", 2), objectives_for("brain_tumour")))

write_lessons(P, "1.0.0", cases, tasks)
