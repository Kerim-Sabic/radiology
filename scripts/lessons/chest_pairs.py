"""Authored lessons for the `chest-pairs` pack (same-patient radiograph + CT).
Run: python scripts/lessons/chest_pairs.py
"""
from common import Pack, anchor, frontal_cxr_tasks, hint, oral_exam_task, write_lessons
from objectives import objective_anchors, objectives_for

P = Pack("chest-pairs")
cases, tasks = [], []

A_NODULE = anchor(118, "98", "ch10", note="Solitary nodule/mass in the lung")
A_NODULE_SIGNS = anchor(120, "100", "ch10", note="Signs of a benign versus malignant nodule")
A_LUNG_CT = anchor(33, "18", "ch02", note="Normal CT anatomy of the lungs; lung windows")
A_AIRSPACE = anchor(49, "34", "ch04", note="Characteristics of airspace disease")
A_COVID = anchor(88, "73", "ch08", figure="Fig 8.9", note="COVID-19 pneumonia")
A_FRONTAL = anchor(26, "11", "ch02", note="The normal frontal chest radiograph")
A_LATERAL = anchor(29, "14", "ch02", figure="Fig 2.5", note="The normal lateral chest radiograph")
A_AP_MAGNIFY = anchor(36, "21", "ch02", note="AP vs PA heart magnification")

NODULE_RUBRIC = [
    {"id": "loc", "text": "Gave the lobe or zone and the side of each nodule", "weight": "essential", "category": "location"},
    {"id": "size", "text": "Estimated size (longest diameter) — use the length tool on the CT", "weight": "essential", "category": "finding"},
    {"id": "margin", "text": "Described the margin (smooth, lobulated or spiculated)", "weight": "essential", "category": "pattern"},
    {"id": "density", "text": "Described density (solid, part-solid, ground-glass) and any calcification or fat", "weight": "supportive", "category": "pattern"},
    {"id": "count", "text": "Kept searching after the first nodule and reported every nodule found", "weight": "essential", "category": "finding"},
    {"id": "mgmt", "text": "Recognised that benign vs malignant cannot be decided from one CT alone (prior imaging/growth matter)", "weight": "supportive", "category": "limitation"},
]

# ------------------------------------------------------------------ LIDC-IDRI: nodules + radiograph pairs
LIDC = [("LIDC-IDRI-0078", "D"), ("LIDC-IDRI-0217", "E"), ("LIDC-IDRI-0053", "F")]
for sid, letter in LIDC:
    subj = P.subject(sid)
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    xr = next(s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] in ("CR", "DX"))
    nods = sorted(t["id"] for t in P.manifest["referenceTargets"] if t["seriesUid"] == ct["uid"] and t["classId"] == "finding:lung_nodule")
    if not nods:
        continue
    short = sid.lower()
    case_id = f"chest-pairs-{short}"
    lung = next((w["label"] for w in ct["windowPresets"] if w["label"].lower().startswith("lung")), None)
    cases.append({
        "id": case_id,
        "packId": "chest-pairs",
        "neutralTitle": f"Patient {letter} · Chest radiograph + CT chest",
        "learnTitle": f"Lung nodules on CT with the same patient's radiograph ({sid})",
        "subjectKey": subj["key"],
        "studyUids": [ct["studyUid"], xr["studyUid"]],
        "primarySeriesUid": ct["uid"],
        "region": ["chest"],
        "clinicalContext": None,
        "contextSource": None,
        "difficulty": "typical",
        "objectiveIds": objectives_for("lung_nodule"),
        "bookAnchors": [A_NODULE, A_NODULE_SIGNS, A_LUNG_CT],
        "referenceSummary": (
            f"{len(nods)} nodule(s) ≥3 mm outlined by multiple LIDC-IDRI readers (each reader's outline kept separately). "
            "LIDC references cover reader-marked nodules only — other findings and nodules <3 mm are not referenced, so unmatched marks are not counted as false positives. "
            "Reader malignancy ratings are subjective suspicion scores, not diagnoses. The radiograph has no localized reference; the CT annotations do not map onto it automatically. "
            "Study dates are de-identified placeholders, so the interval between radiograph and CT is unknown."
        ),
        "learnNotes": (
            "Search both lungs from apex to base in a lung window and keep going after the first finding. Nodules are round and do not branch; vessels branch and can be followed from slice to slice. "
            "Use the MPR layout to check that a 'nodule' is spherical rather than a vessel seen end-on.\n\n"
            "The outlines come from up to four LIDC readers and often disagree at the edges — compare them rather than treating one as exact truth. "
            "Then look at the same patient's radiograph: decide whether the CT nodules are visible there at all."
        ),
    })
    tasks.append({
        "id": f"{case_id}:search",
        "caseId": case_id,
        "type": "whole_study",
        "title": "Search the CT for lung nodules",
        "prompt": "Search both lungs on the CT and mark every lung nodule you find (point or box). The number of nodules is not disclosed. If you find none, say so.",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [ct["uid"]],
        "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": lung},
        "targets": [{"targetId": n, "name": f"Nodule {i + 1}", "required": True} for i, n in enumerate(nods)],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": None, "slabToleranceMm": 2.0, "inPlaneToleranceMm": 3.0, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [
            hint(1, "Use the lung window and scroll slowly through each lung separately, apex to base."),
            hint(2, "A nodule appears and disappears over a few slices without connecting to a branching vessel. Compare left and right at each level."),
            hint(3, "Jumping to a slice that contains one of the referenced nodules.", {"type": "jumpToTarget", "targetId": nods[0]}),
            hint(5, "Reveal the reference outlines.", {"type": "reveal"}),
        ],
        "explanation": (
            "Every referenced nodule is matched one-to-one to your marks; a mark inside any reader's outline (or within 3 mm of it on a slice within 2 mm) counts as detection. "
            "Missed nodules are listed. Marks elsewhere are 'unscored' because LIDC only references reader-marked nodules ≥3 mm — they are not proof of a false positive."
        ),
        "bookAnchors": [A_NODULE, A_LUNG_CT],
        "objectiveIds": objectives_for("lung_nodule"),
        "skillDimensions": ["finding_localization", "navigation_windowing"],
        "allowUncertain": True,
    })
    tasks.append({
        "id": f"{case_id}:describe",
        "caseId": case_id,
        "type": "describe_finding",
        "title": "Describe the nodules",
        "prompt": "Describe each nodule you found: location, size, margin and density, then give a brief impression.",
        "modes": ["learn", "practice"],
        "seriesUids": [ct["uid"]],
        "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": lung},
        "targets": [],
        "grading": {"kind": "self_review"},
        "scoring": "exploratory_self_review",
        "hints": [hint(1, "Measure the longest axis with the Length tool (L) on the slice where the nodule is largest.")],
        "explanation": "The book's approach: margins, calcification pattern and growth over time are the most useful features; a single CT cannot settle benign versus malignant. LIDC reader ratings for these nodules are shown in the Case tab after submission as suspicion scores, not diagnoses.",
        "rubric": NODULE_RUBRIC,
        "bookAnchors": [A_NODULE_SIGNS, A_NODULE],
        "objectiveIds": objectives_for("lung_nodule"),
        "skillDimensions": ["reporting", "interpretation"],
        "allowUncertain": True,
    })
    tasks.append({
        "id": f"{case_id}:xr-correlate",
        "caseId": case_id,
        "type": "correlate_modalities",
        "title": "Can you see the CT nodules on the radiograph?",
        "prompt": "Open the radiograph first (two-up layout helps). Mark where you think a nodule projects, or note that none is visible. Then compare with the CT.",
        "modes": ["learn", "practice"],
        "seriesUids": [xr["uid"], ct["uid"]],
        "start": {"seriesUid": xr["uid"], "slice": "first", "windowPreset": None},
        "targets": [],
        "grading": {"kind": "self_review"},
        "scoring": "exploratory_self_review",
        "hints": [hint(1, "Look through the heart, the hila and below the diaphragm domes — common hiding places on a frontal film."), hint(2, "On CT, note each nodule's lobe and how far it is from the chest wall; then estimate where it would project on the frontal view.")],
        "explanation": "A radiograph is a projection: one CT voxel has no unique radiograph pixel, so the app does not auto-map CT annotations onto the X-ray. Small or overlapped nodules are often invisible on radiographs — finding that out on a real pair is the point of this exercise. The interval between these two studies is unknown.",
        "rubric": [
            {"id": "search", "text": "Searched the radiograph systematically before looking at the CT", "weight": "essential", "category": "finding"},
            {"id": "decision", "text": "Committed to visible / not visible for each CT nodule", "weight": "essential", "category": "finding"},
            {"id": "why", "text": "Explained why a nodule might not be seen (size, overlap with heart/hila/diaphragm/bone)", "weight": "supportive", "category": "limitation"},
            {"id": "interval", "text": "Did not assume the two studies were taken on the same day", "weight": "supportive", "category": "limitation"},
        ],
        "bookAnchors": [A_NODULE, A_FRONTAL],
        "objectiveIds": objectives_for("lung_nodule"),
        "skillDimensions": ["cross_modality", "finding_localization"],
        "allowUncertain": True,
    })
    tasks.append(oral_exam_task(case_id, [ct["uid"], xr["uid"]], ct["uid"], "growth over time cannot be judged from one study", "a pulmonary vessel seen end-on or a granuloma", [A_NODULE_SIGNS, A_NODULE], objectives_for("lung_nodule"), window=lung))

# ------------------------------------------------------------------ COVID-19-AR: radiograph/CT pairs (no finding references)
COVID = [("COVID-19-AR-16434363", "G"), ("COVID-19-AR-16406502", "H"), ("COVID-19-AR-16434411", "I")]
for sid, letter in COVID:
    subj = P.subject(sid)
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    xrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["modality"] in ("CR", "DX")]
    scouts = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"] and s["role"] == "scout"]
    st_ct = P.studies[ct["studyUid"]]
    st_xr = P.studies[xrs[0]["studyUid"]]
    interval = abs((st_ct["relativeDays"] or 0) - (st_xr["relativeDays"] or 0)) if st_ct["relativeDays"] is not None and st_xr["relativeDays"] is not None else None
    when = "the same day" if interval == 0 else (f"{interval} day(s) apart" if interval is not None else "at an unknown interval")
    case_id = f"chest-pairs-{sid.lower()}"
    frontal = next((s for s in xrs if "lat" not in (s["description"] or "").lower()), xrs[0])
    soft = next((w["label"] for w in ct["windowPresets"] if w["label"].lower().startswith("lung")), None)
    cases.append({
        "id": case_id,
        "packId": "chest-pairs",
        "neutralTitle": f"Patient {letter} · Chest radiograph + CT chest",
        "learnTitle": f"Same-patient chest radiograph and CT ({st_xr['description']} / {st_ct['description']})",
        "subjectKey": subj["key"],
        "studyUids": sorted({ct["studyUid"], *[s["studyUid"] for s in xrs], *[s["studyUid"] for s in scouts]}),
        "primarySeriesUid": frontal["uid"],
        "region": ["chest"],
        "clinicalContext": "Adult from a research cohort of patients with positive COVID-19 testing (source collection description). The cohort label is not a finding on these images.",
        "contextSource": "TCIA COVID-19-AR collection description",
        "difficulty": "typical",
        "objectiveIds": objectives_for("airspace_pattern") + objectives_for("cxr_systematic"),
        "bookAnchors": [A_AIRSPACE, A_COVID, A_FRONTAL],
        "referenceSummary": f"No finding-level reference is available for these studies — tasks are self-reviewed against source-linked checklists. Radiograph and CT were obtained {when} (de-identified dates, intervals preserved).",
        "learnNotes": (
            f"Read the radiograph first, then the CT ({when}). Describe what is actually there: an image from this cohort may be normal. "
            "On the radiograph, describe opacities by side, zone, pattern (airspace vs interstitial) and distribution; on CT, separate ground-glass from consolidation and peripheral from central. "
            "Then decide what the CT adds."
        ),
    })
    tasks.append({
        "id": f"{case_id}:correlate",
        "caseId": case_id,
        "type": "correlate_modalities",
        "title": "Radiograph first, then CT",
        "prompt": f"Read the frontal radiograph and describe the lungs. Then read the CT ({when}) and say what it confirms, adds or contradicts.",
        "modes": ["learn", "practice"],
        "seriesUids": [frontal["uid"], ct["uid"]] + [s["uid"] for s in xrs if s["uid"] != frontal["uid"]],
        "start": {"seriesUid": frontal["uid"], "slice": "first", "windowPreset": None},
        "targets": [],
        "grading": {"kind": "self_review"},
        "scoring": "exploratory_self_review",
        "hints": [hint(1, "Technique first: AP portable or PA? Heart size is not reliable on AP films."), hint(2, "For each opacity: side, zone (upper/mid/lower), central vs peripheral, airspace vs interstitial.")],
        "explanation": "There is no expert finding reference here; compare your description with the checklist and the linked book pages. Bilateral, peripheral, lower-zone opacities are typical of COVID-19 pneumonia in the book, but this image must be judged on what it shows.",
        "rubric": [
            {"id": "tech", "text": "Stated projection/technique and its limits", "weight": "essential", "category": "limitation"},
            {"id": "lungs", "text": "Described both lungs by zone, including whether they are clear", "weight": "essential", "category": "finding"},
            {"id": "pattern", "text": "Named the pattern (airspace vs interstitial) and distribution for any opacity", "weight": "essential", "category": "pattern"},
            {"id": "ct", "text": "On CT, separated ground-glass from consolidation and described distribution", "weight": "essential", "category": "pattern"},
            {"id": "adds", "text": "Said what the CT adds that the radiograph could not show", "weight": "supportive", "category": "finding"},
            {"id": "impr", "text": "Gave a concise impression with a short differential where appropriate", "weight": "essential", "category": "impression"},
        ],
        "bookAnchors": [A_AIRSPACE, A_COVID, A_AP_MAGNIFY],
        "objectiveIds": objectives_for("airspace_pattern"),
        "skillDimensions": ["cross_modality", "interpretation", "reporting"],
        "allowUncertain": True,
    })
    if scouts:
        sc = scouts[0]
        tasks.append({
            "id": f"{case_id}:scout",
            "caseId": case_id,
            "type": "compare_appearances",
            "title": "Diagnostic radiograph or CT scout?",
            "prompt": "Two frontal projection images exist for this patient. Which one is the diagnostic chest radiograph?",
            "modes": ["learn", "practice", "assess"],
            "seriesUids": [frontal["uid"], sc["uid"]],
            "start": {"seriesUid": sc["uid"], "slice": "first", "windowPreset": None},
            "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "xr", "text": f"The {frontal['modality']} image (study '{st_xr['description']}')", "correct": True, "why": f"Modality {frontal['modality']}: a radiographic acquisition — the diagnostic X-ray."},
                {"id": "scout", "text": f"The 'locator' image (study '{st_ct['description']}')", "correct": False, "why": "Modality CT: the CT scanner's low-dose localizer used to plan slices. Not a diagnostic radiograph."},
            ]},
            "scoring": "authoritative",
            "hints": [hint(1, "Read the modality and description in the viewport corners.")],
            "explanation": "A CT scout is a planning projection acquired by the CT gantry. It must not be reported as, or paired as, a chest radiograph.",
            "bookAnchors": [anchor(16, "2", "ch01", note="Imaging modalities")],
            "objectiveIds": objectives_for("modalities"),
            "skillDimensions": ["orientation", "cross_modality"],
            "allowUncertain": True,
        })
    lat = next((s for s in xrs if "lat" in (s["description"] or "").lower()), None)
    if lat:
        tasks.append({
            "id": f"{case_id}:lateral",
            "caseId": case_id,
            "type": "compare_appearances",
            "title": "Read the lateral view",
            "prompt": "Open the lateral radiograph. Check the retrosternal clear space, the hila, the fissures, the thoracic spine and the posterior costophrenic sulci, then describe them.",
            "modes": ["learn", "practice"],
            "seriesUids": [lat["uid"], frontal["uid"]],
            "start": {"seriesUid": lat["uid"], "slice": "first", "windowPreset": None},
            "targets": [],
            "grading": {"kind": "self_review"},
            "scoring": "exploratory_self_review",
            "hints": [hint(1, "The spine should get darker (more lucent) from top to bottom; if it doesn't, look for something projecting over the lower spine.")],
            "explanation": "The book's five key areas on the lateral view are a reliable checklist. Use the frontal view beside it to localize anything you find.",
            "rubric": [
                {"id": "rs", "text": "Retrosternal clear space assessed", "weight": "essential", "category": "finding"},
                {"id": "hila", "text": "Hilar region assessed", "weight": "essential", "category": "finding"},
                {"id": "fiss", "text": "Fissures identified or noted as not visible", "weight": "supportive", "category": "finding"},
                {"id": "spine", "text": "Thoracic spine lucency gradient assessed", "weight": "essential", "category": "finding"},
                {"id": "sulci", "text": "Posterior costophrenic sulci assessed", "weight": "essential", "category": "finding"},
            ],
            "bookAnchors": [A_LATERAL],
            "objectiveIds": objectives_for("cxr_lateral"),
            "skillDimensions": ["orientation", "reporting"],
            "allowUncertain": True,
        })

# ------------------------------------------------------------------ frontal radiograph skills on every patient that has one
CXR_OBJ = {"tech": objectives_for("cxr_systematic")[:1], "borders": ["ch03-o02"], "ctr": ["ch03-o01"]}
for c in list(cases):
    for s in P.manifest["series"]:
        if s["subjectKey"] != c["subjectKey"] or s["modality"] not in ("CR", "DX"):
            continue
        desc = (s["description"] or "") + " " + str(s["acquisition"].get("ViewPosition") or "")
        if "lat" in desc.lower() or s["acquisition"].get("ViewPosition") == "LL":
            continue
        proj = "AP" if " AP" in f" {desc}" or "PORTABLE" in P.studies[s["studyUid"]]["description"].upper() else "PA"
        tasks.extend(frontal_cxr_tasks(c["id"], s, proj, objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), CXR_OBJ))
        break

write_lessons(P, "1.0.0", cases, tasks)
