"""Authored lessons for the `body` pack: two more LCTSC chest CTs (unseen-patient anatomy
practice), a contrast chest CT, and an arterial-phase kidney CT with tumour segmentation.
Run: python scripts/lessons/body.py
"""
from common import Pack, anchor, hint, oral_exam_task, write_lessons
from objectives import objectives_for, objective_anchors

P = Pack("body")
cases, tasks = [], []
A_CT_CONVENTION = anchor(32, "17", "ch02", note="Viewing convention for chest CT")
A_CARDIAC_CT = anchor(39, "24", "ch03", note="Normal cardiac CT anatomy levels")
A_LOW_CARDIAC = anchor(42, "27", "ch03", note="High and low cardiac levels")


def lctsc_case(sid: str, letter: str):
    subj = P.subject(sid)
    ct = P.series_where(subj["key"], modality="CT", role="diagnostic")
    tid = lambda n: f"{sid.lower()}_{n}"  # noqa: E731
    have = {t["id"] for t in P.manifest["referenceTargets"]}
    case_id = f"body-{sid.lower()}"
    note = " This series is an average-intensity projection of a 4D (respiratory-phase) CT — a radiotherapy planning reconstruction." if "Ave-IP" in ct["description"] else ""
    cases.append({
        "id": case_id, "packId": "body",
        "neutralTitle": f"Patient {letter} · CT chest",
        "learnTitle": f"Chest CT anatomy with source organ contours ({sid})",
        "subjectKey": subj["key"], "studyUids": [ct["studyUid"]], "primarySeriesUid": ct["uid"],
        "region": ["chest"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
        "objectiveIds": objectives_for("ct_chest_anatomy"),
        "bookAnchors": [A_CT_CONVENTION, A_CARDIAC_CT],
        "referenceSummary": "Source radiotherapy organ-at-risk contours (LCTSC) for heart, both lungs, esophagus and spinal cord only. Nothing else has been reviewed." + note,
        "learnNotes": "A different patient from the starter CT: repeat the same anatomy skills here without the hints you used before. Contours are radiotherapy definitions, not exact anatomical boundaries." + note,
    })
    spec = [
        ("heart", "Find the heart", "Navigate to the heart and place one point inside it.", [("heart", "Heart")], 3.0, "heart_ct"),
        ("esophagus", "Find the esophagus", "Find the esophagus on any axial slice and mark its centre.", [("esophagus", "Esophagus")], 2.5, "ct_chest_anatomy"),
        ("cord", "Find the spinal cord", "Mark the spinal cord (canal contents, not the vertebral body).", [("spinal-cord", "Spinal cord")], 2.0, "ct_chest_anatomy"),
    ]
    slab = round((ct["geometry"]["sliceSpacing"] or 3.0) / 2 + 0.2, 2)
    for key, title, prompt, targets, tol, topic in spec:
        if not all(tid(t) in have for t, _ in targets):
            continue
        tasks.append({
            "id": f"{case_id}:{key}", "caseId": case_id, "type": "find_structure", "title": title, "prompt": prompt,
            "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]],
            "start": {"seriesUid": ct["uid"], "slice": "first", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": tid(t), "name": n, "required": True} for t, n in targets],
            "grading": {"kind": "point_in_target", "slabToleranceMm": slab, "inPlaneToleranceMm": tol},
            "scoring": "authoritative",
            "hints": [hint(1, "Orient first (edge letters), then choose the mediastinal window."), hint(3, "Jumping to a slice with the reference contour.", {"type": "jumpToTarget", "targetId": tid(targets[0][0])}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": "Same structure, different patient: the anatomy keeps its relationships even when body habitus, scan range and reconstruction differ.",
            "bookAnchors": [A_LOW_CARDIAC if key == "heart" else A_CT_CONVENTION],
            "objectiveIds": objectives_for(topic), "skillDimensions": ["anatomy"], "allowUncertain": True,
        })
    if tid("left-lung") in have and tid("right-lung") in have:
        tasks.append({
            "id": f"{case_id}:lungs-sides", "caseId": case_id, "type": "find_structure",
            "title": "Right lung versus left lung", "prompt": "Place a named arrow in the patient's RIGHT lung and one in the LEFT lung.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [ct["uid"]],
            "start": {"seriesUid": ct["uid"], "slice": "middle", "windowPreset": "Lung"},
            "targets": [{"targetId": tid("right-lung"), "name": "Right lung", "required": True}, {"targetId": tid("left-lung"), "name": "Left lung", "required": True}],
            "grading": {"kind": "labelled_points", "slabToleranceMm": slab, "inPlaneToleranceMm": 2, "levelTargetId": None, "requireLabels": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Read the edge letters: 'L' marks the patient's left."), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": "Laterality is graded separately from position, so a correctly placed but mis-named arrow shows up as a side error.",
            "bookAnchors": [A_CT_CONVENTION], "objectiveIds": objectives_for("orientation_ct"), "skillDimensions": ["orientation", "anatomy"], "allowUncertain": True,
        })


lctsc_case("LCTSC-Train-S2-003", "J")
lctsc_case("LCTSC-Train-S3-006", "K")

# ------------------------------------------------------------------ contrast chest CT (no targets yet; vessel drafts may attach)
subj = P.subject("COVID-19-AR-16406498")
ctc = P.series_where(subj["key"], modality="CT", role="diagnostic")
case_id = "body-covid-19-ar-16406498"
cases.append({
    "id": case_id, "packId": "body", "neutralTitle": "Patient L · CT chest",
    "learnTitle": "Contrast-enhanced chest CT", "subjectKey": subj["key"], "studyUids": [ctc["studyUid"]], "primarySeriesUid": ctc["uid"],
    "region": ["chest"], "clinicalContext": "Adult from a research cohort of patients with positive COVID-19 testing (source collection description).",
    "contextSource": "TCIA COVID-19-AR collection description", "difficulty": "typical",
    "objectiveIds": objectives_for("five_vessel"), "bookAnchors": objective_anchors("ch03-o04", 2),
    "referenceSummary": "No source anatomical or finding reference. Use it for orientation, windowing and vessel identification with self-review.",
    "learnNotes": "IV contrast (recorded in ContrastBolusAgent) makes the great vessels bright on a mediastinal window, which is what the book's CT levels show. Scroll from the thoracic inlet down through the aortic arch to the heart.",
})
tasks.append({
    "id": f"{case_id}:contrast", "caseId": case_id, "type": "choose_window", "title": "Was IV contrast given?",
    "prompt": "Look at the aorta and pulmonary arteries in a mediastinal window. Was intravenous contrast given?",
    "modes": ["learn", "practice", "assess"], "seriesUids": [ctc["uid"]],
    "start": {"seriesUid": ctc["uid"], "slice": "middle", "windowPreset": "Mediastinum"}, "targets": [],
    "grading": {"kind": "choice", "multiple": False, "options": [
        {"id": "yes", "text": "Yes — the vessels are brighter than muscle", "correct": True, "why": "Enhancing vessels are much denser than blood on a non-contrast scan; the DICOM header also records a contrast agent."},
        {"id": "no", "text": "No — blood and muscle look similar", "correct": False, "why": "That describes a non-contrast scan. Measure the aorta with the pixel readout: enhanced blood is well above ~50 HU."},
    ]},
    "scoring": "authoritative",
    "hints": [hint(1, "Hover the aorta and read the HU value in the bottom-left corner; compare it with the chest wall muscle.")],
    "explanation": "Unenhanced blood measures roughly 30–50 HU; with IV contrast the arteries and veins become markedly brighter, depending on timing. Knowing the phase is the first step before calling a vessel abnormal.",
    "bookAnchors": objective_anchors("ch03-o04", 1) + [anchor(18, "3", "ch01", note="CT numbers")],
    "objectiveIds": objectives_for("windowing"), "skillDimensions": ["navigation_windowing", "interpretation"], "allowUncertain": True,
})

# ------------------------------------------------------------------ KiTS kidney CT
subj = P.subject("KiTS-00015")
kct = P.series_where(subj["key"], modality="CT", role="diagnostic")
case_id = "body-kits-00015"
K = lambda n: f"kits-00015_{n}"  # noqa: E731
cases.append({
    "id": case_id, "packId": "body", "neutralTitle": "Patient M · CT abdomen (contrast)",
    "learnTitle": "Arterial-phase CT with kidney and renal tumour segmentation", "subjectKey": subj["key"], "studyUids": [kct["studyUid"]], "primarySeriesUid": kct["uid"],
    "region": ["abdomen"], "clinicalContext": None, "contextSource": None, "difficulty": "typical",
    "objectiveIds": objectives_for("kidney_ct") + objectives_for("renal_mass") + objectives_for("contrast_phase"),
    "bookAnchors": objective_anchors("ch13-o05", 1) + objective_anchors("ch17-o10", 2) + objective_anchors("ch13-o01", 1),
    "referenceSummary": "C4KC-KiTS manual segmentation of the kidneys and of a renal tumour on this arterial-phase series. Other organs and findings are not referenced. The cohort consists of patients who underwent nephrectomy for renal tumours, but the segmentation label is the reference here, not a diagnosis for every structure.",
    "learnNotes": "In the arterial (corticomedullary) phase the renal cortex enhances strongly while the medulla is still darker. A mass is recognised by a contour bulge and by enhancement that differs from normal parenchyma. Use coronal MPR to see the kidney's full length.",
})
tasks += [
    {
        "id": f"{case_id}:phase", "caseId": case_id, "type": "choose_window", "title": "Which contrast phase?",
        "prompt": "Look at the aorta and the kidneys. Which contrast phase best describes this series?",
        "modes": ["learn", "practice", "assess"], "seriesUids": [kct["uid"]], "start": {"seriesUid": kct["uid"], "slice": "middle", "windowPreset": "Soft tissue"}, "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "arterial", "text": "Arterial / corticomedullary", "correct": True, "why": "Very bright aorta and a cortex brighter than the medulla — corticomedullary differentiation."},
            {"id": "portal", "text": "Portal venous", "correct": False, "why": "In the portal venous phase the kidneys enhance more uniformly (nephrographic) and the portal vein is bright."},
            {"id": "delayed", "text": "Delayed / excretory", "correct": False, "why": "Contrast would be in the collecting systems and ureters."},
            {"id": "none", "text": "Unenhanced", "correct": False, "why": "Vessels would be no brighter than muscle."},
        ]},
        "scoring": "authoritative", "hints": [hint(1, "Compare the renal cortex and medulla: is there a two-tone appearance?")],
        "explanation": "Recognising the phase tells you what 'normal' enhancement should look like before you call a lesion. This series is labelled arterial by the source.",
        "bookAnchors": objective_anchors("ch13-o01", 2), "objectiveIds": objectives_for("contrast_phase"), "skillDimensions": ["interpretation", "navigation_windowing"], "allowUncertain": True,
    },
    {
        "id": f"{case_id}:kidneys", "caseId": case_id, "type": "find_structure", "title": "Find the kidneys",
        "prompt": "Mark the right kidney and the left kidney with named arrows.",
        "modes": ["learn", "practice"], "seriesUids": [kct["uid"]], "start": {"seriesUid": kct["uid"], "slice": "first", "windowPreset": "Soft tissue"},
        "targets": [{"targetId": K("kidneys"), "name": "Kidney", "acceptedNames": ["Right kidney", "Left kidney", "Kidney"], "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 1.7, "inPlaneToleranceMm": 3},
        "scoring": "authoritative",
        "hints": [hint(1, "The kidneys are retroperitoneal, either side of the spine, around L1–L2."), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": "The source segmentation labels both kidneys as one class, so this task checks localisation; side is checked by your own reading of the edge letters.",
        "bookAnchors": objective_anchors("ch13-o05", 2), "objectiveIds": objectives_for("kidney_ct"), "skillDimensions": ["anatomy"], "allowUncertain": True,
    },
    {
        "id": f"{case_id}:mass", "caseId": case_id, "type": "locate_finding", "title": "Find the renal mass",
        "prompt": "Examine both kidneys through their full length. Mark any focal abnormality you find (point or box), or state that you find none.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [kct["uid"]], "start": {"seriesUid": kct["uid"], "slice": "first", "windowPreset": "Soft tissue"},
        "targets": [{"targetId": K("renal-tumour-mass"), "name": "Renal mass", "required": True}],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1.7, "inPlaneToleranceMm": 3, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Follow each kidney's outline slice by slice; look for a bulge or a region whose enhancement differs from the cortex."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": K("renal-tumour-mass")}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": "A solid renal mass typically distorts the renal contour and enhances differently from the cortex; simple cysts are water density and do not enhance. A box drawn around the mass is also scored for overlap (≥30%) so you can see how well you outlined it.",
        "rubric": [
            {"id": "side", "text": "Side and pole (upper/inter/lower) of the mass", "weight": "essential", "category": "location"},
            {"id": "size", "text": "Size in centimetres", "weight": "essential", "category": "finding"},
            {"id": "enh", "text": "Enhancement compared with normal cortex; solid vs cystic", "weight": "essential", "category": "pattern"},
            {"id": "ext", "text": "Checked renal vein, IVC, nodes and the other kidney", "weight": "supportive", "category": "associated_sign"},
        ],
        "bookAnchors": objective_anchors("ch17-o10", 2), "objectiveIds": objectives_for("renal_mass"), "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
    },
]
tasks.append(oral_exam_task(case_id, [kct["uid"]], kct["uid"], "histology needs tissue; one arterial phase limits characterisation", "a complex renal cyst", objective_anchors("ch17-o10", 2), objectives_for("renal_mass"), window="Soft tissue"))

write_lessons(P, "1.0.0", cases, tasks)
