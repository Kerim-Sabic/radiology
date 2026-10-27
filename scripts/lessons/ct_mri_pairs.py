"""Authored lessons for `ct-mri-pairs` (Soft-tissue-Sarcoma: same-patient CT from PET/CT + MRI).
Run: python scripts/lessons/ct_mri_pairs.py
"""
from common import Pack, hint, oral_exam_task, write_lessons
from objectives import objectives_for, objective_anchors

P = Pack("ct-mri-pairs")
cases, tasks = [], []

SUBJECTS = [("STS_033", "N", "T2 Fatsat", "t2fs"), ("STS_042", "O", "AX IR", "stir")]
for sid, letter, fluid_desc, fluid_key in SUBJECTS:
    subj = P.subject(sid)
    k = sid.lower().replace("_", "-")
    ct = P.series_where(subj["key"], modality="CT")
    t1 = next(s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] == "MR" and "T1" in s["description"])
    fl = next(s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] == "MR" and fluid_desc.lower() in s["description"].lower())
    st_ct, st_mr = P.studies[ct["studyUid"]], P.studies[t1["studyUid"]]
    interval = abs((st_ct["relativeDays"] or 0) - (st_mr["relativeDays"] or 0)) if st_ct["relativeDays"] is not None and st_mr["relativeDays"] is not None else None
    when = "the same day" if interval == 0 else (f"{interval} days apart" if interval is not None else "at an unknown interval")
    fluid_name = "T2 fat-suppressed" if fluid_key == "t2fs" else "STIR (inversion recovery)"
    case_id = f"ctmri-{k}"
    tg = lambda seq, part: f"{k}_{seq}-gtv-{part}"  # noqa: E731
    cases.append({
        "id": case_id, "packId": "ct-mri-pairs",
        "neutralTitle": f"Patient {letter} · MRI + CT of an extremity",
        "learnTitle": f"Soft-tissue mass on MRI (T1, {fluid_name}) and CT, same patient ({sid})",
        "subjectKey": subj["key"], "studyUids": sorted({ct["studyUid"], t1["studyUid"], fl["studyUid"]}), "primarySeriesUid": t1["uid"],
        "region": ["extremity"], "clinicalContext": "Adult enrolled in a soft-tissue sarcoma imaging research collection (source description).",
        "contextSource": "TCIA Soft-tissue-Sarcoma collection description", "difficulty": "typical",
        "objectiveIds": objectives_for("fat_suppression") + objectives_for("edema_mri"),
        "bookAnchors": objective_anchors("ch20-o02", 1) + objective_anchors("ch20-o03", 1),
        "referenceSummary": (
            f"Radiotherapy contours from the source: gross tumour (mass) and a larger volume including surrounding oedema, provided separately on T1, {fluid_name} and CT. "
            f"MRI and CT were acquired {when}; the CT is the CT component of a PET/CT, not a dedicated diagnostic CT. The series are NOT registered — each panel has independent controls. "
            "Contours are radiotherapy target definitions, not a histological boundary."
        ),
        "learnNotes": (
            "T1 shows anatomy and fat (bright); the fluid-sensitive sequence (T2 fat-suppressed or STIR) makes oedema and most tumours bright while fat goes dark. "
            "Compare the same level across sequences with the two-up layout, then find the mass on CT, where soft-tissue contrast is much lower."
        ),
    })
    tasks += [
        {
            "id": f"{case_id}:find-t1", "caseId": case_id, "type": "locate_finding", "title": "Find the mass on T1",
            "prompt": "Scroll through the T1 series and mark the centre of the soft-tissue mass.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [t1["uid"]], "start": {"seriesUid": t1["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": tg("t1", "mass"), "name": "Mass", "required": True}],
            "grading": {"kind": "point_in_target", "slabToleranceMm": round(t1["geometry"]["sliceSpacing"] / 2 + 0.3, 1), "inPlaneToleranceMm": 4},
            "scoring": "authoritative",
            "hints": [hint(1, "Compare muscles compartment by compartment; look for one that is enlarged or has an abnormal internal signal."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tg("t1", "mass")}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": "On T1 a soft-tissue mass is often similar to or slightly different from muscle; its outline and mass effect give it away. T1 is also where fat (bright) is identified.",
            "bookAnchors": objective_anchors("ch20-o01", 1), "objectiveIds": objectives_for("mri_weighting"), "skillDimensions": ["finding_localization"], "allowUncertain": True,
        },
        {
            "id": f"{case_id}:fluid-seq", "caseId": case_id, "type": "compare_appearances", "title": "Which sequence shows oedema best?",
            "prompt": f"Compare the T1 series with the second MRI series in two-up layout. On which series is the abnormal tissue around the mass most conspicuous, and why?",
            "modes": ["learn", "practice", "assess"], "seriesUids": [t1["uid"], fl["uid"]], "start": {"seriesUid": fl["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "fluid", "text": f"The {fluid_name} series — fluid and oedema are bright and fat is suppressed", "correct": True, "why": "Fluid-sensitive sequences with fat suppression make water-rich tissue stand out against dark fat."},
                {"id": "t1", "text": "The T1 series — oedema is brightest on T1", "correct": False, "why": "Oedema is low to intermediate on T1; T1 is best for fat and anatomy."},
                {"id": "same", "text": "They look the same", "correct": False, "why": "Look at subcutaneous fat: bright on T1, dark on the fat-suppressed series — they are clearly different weightings."},
            ]},
            "scoring": "authoritative", "hints": [hint(1, "Check subcutaneous fat first: bright or dark on each series?")],
            "explanation": "Fat suppression removes the bright fat signal so that water-containing tissue (oedema, many tumours, fluid) is conspicuous. Echo/repetition times are missing from these headers, so weighting is judged from tissue appearance here.",
            "bookAnchors": objective_anchors("ch20-o02", 2) + objective_anchors("ch20-o03", 1),
            "objectiveIds": objectives_for("fat_suppression") + objectives_for("edema_mri"), "skillDimensions": ["interpretation", "cross_modality"], "allowUncertain": True,
        },
        {
            "id": f"{case_id}:oedema", "caseId": case_id, "type": "locate_finding", "title": "Mark the surrounding oedema",
            "prompt": f"On the {fluid_name} series, mark the oedema around the mass (not the mass itself) with a named arrow 'Oedema', and the mass with 'Mass'.",
            "modes": ["learn", "practice"], "seriesUids": [fl["uid"]], "start": {"seriesUid": fl["uid"], "slice": "middle", "windowPreset": None},
            "targets": [{"targetId": tg(fluid_key, "mass"), "name": "Mass", "required": True}, {"targetId": tg(fluid_key, "edema"), "name": "Oedema", "acceptedNames": ["Edema", "Oedema", "Peritumoral edema"], "required": True}],
            "grading": {"kind": "labelled_points", "slabToleranceMm": round(fl["geometry"]["sliceSpacing"] / 2 + 0.3, 1), "inPlaneToleranceMm": 3, "levelTargetId": None, "requireLabels": True},
            "scoring": "exploratory_self_review",
            "hints": [hint(1, "Oedema is the feathery bright signal spreading along fascial planes beyond the mass edge."), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": "The source 'oedema' contour includes the mass, so an arrow inside the mass also lands inside it — that is why this task is self-reviewed rather than auto-scored: compare your arrows with both outlines yourself.",
            "bookAnchors": objective_anchors("ch20-o03", 2), "objectiveIds": objectives_for("edema_mri"), "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
        },
        {
            "id": f"{case_id}:find-ct", "caseId": case_id, "type": "correlate_modalities", "title": "Find the same mass on CT",
            "prompt": f"Now find the same mass on the CT (acquired {when}, not registered to the MRI) and mark its centre.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"], t1["uid"]], "start": {"seriesUid": ct["uid"], "slice": "middle", "windowPreset": "Soft tissue"},
            "targets": [{"targetId": tg("ct", "mass"), "name": "Mass", "required": True}],
            "grading": {"kind": "point_in_target", "slabToleranceMm": round(ct["geometry"]["sliceSpacing"] / 2 + 0.3, 1), "inPlaneToleranceMm": 5},
            "scoring": "authoritative",
            "hints": [hint(1, "Use bony landmarks you saw on MRI (which bone, which compartment) to find the same level on CT; the slice numbers do not correspond."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": tg("ct", "mass")}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": "CT shows soft-tissue masses with less contrast than MRI; mass effect and fat-plane effacement help. The two studies are independent acquisitions, so navigation relies on anatomy, not on synchronised slices.",
            "bookAnchors": objective_anchors("ch20-o02", 1), "objectiveIds": objectives_for("fat_suppression"), "skillDimensions": ["cross_modality", "finding_localization"], "allowUncertain": True,
        },
    ]
    tasks.append(oral_exam_task(case_id, [t1["uid"], fl["uid"], ct["uid"]], t1["uid"], "imaging cannot give the histological grade", "a haematoma or a benign soft-tissue tumour such as a lipoma", objective_anchors("ch20-o02", 1) + objective_anchors("ch20-o03", 1), objectives_for("fat_suppression") + objectives_for("edema_mri")))

write_lessons(P, "1.0.0", cases, tasks)
