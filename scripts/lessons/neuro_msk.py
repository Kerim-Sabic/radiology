"""Authored lessons for `neuro-msk`: brain tumour MRI (ReMIND), spine CT with vertebral
labels (Spine-Mets-CT-SEG), and one mammogram with a mass ROI (CBIS-DDSM).
Run: python scripts/lessons/neuro_msk.py
"""
from common import Pack, hint, oral_exam_task, write_lessons
from objectives import objectives_for, objective_anchors

P = Pack("neuro-msk")
cases, tasks = [], []

# ------------------------------------------------------------------ ReMIND brain MRI
subj = P.subject("ReMIND-025")
mrs = [s for s in P.manifest["series"] if s["subjectKey"] == subj["key"]]
t1c = next(s for s in mrs if "T1_postcontrast" in s["description"])
flair = next(s for s in mrs if "FLAIR" in s["description"])
t2 = next(s for s in mrs if "T2_BLADE" in s["description"])
case_id = "neuro-remind-025"
cases.append({
    "id": case_id, "packId": "neuro-msk", "neutralTitle": "Patient P · MRI brain",
    "learnTitle": "Brain tumour on post-contrast T1, FLAIR and T2 (ReMIND-025)", "subjectKey": subj["key"],
    "studyUids": sorted({s["studyUid"] for s in mrs}), "primarySeriesUid": t1c["uid"], "region": ["head"],
    "clinicalContext": None, "contextSource": None, "difficulty": "typical",
    "objectiveIds": objectives_for("brain_mri") + objectives_for("brain_tumour") + objectives_for("gadolinium"),
    "bookAnchors": objective_anchors("ch26-o02", 1) + objective_anchors("ch26-o11", 1) + objective_anchors("ch20-o05", 1),
    "referenceSummary": "Source manual tumour segmentation on the post-contrast T1 (ReMIND). Ventricle and cerebrum labels are automated source labels — shown for exploration only, never used for scoring. Images are defaced and dates are placeholders.",
    "learnNotes": "Read each sequence for its job: FLAIR shows oedema and non-enhancing tumour bright with dark CSF; post-contrast T1 shows where the blood–brain barrier is disrupted; T2 shows CSF bright. Compare all three at the same level (two-up or four-up).",
})
tasks += [
    {
        "id": f"{case_id}:find", "caseId": case_id, "type": "locate_finding", "title": "Find the abnormality on post-contrast T1",
        "prompt": "Scroll through the post-contrast T1 volume (MPR helps) and mark the centre of any abnormality, or state that there is none.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [t1c["uid"]], "start": {"seriesUid": t1c["uid"], "slice": "first", "windowPreset": None},
        "targets": [{"targetId": "remind-025_glioma-tumour", "name": "Tumour", "required": True}],
        "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": None, "slabToleranceMm": 1.0, "inPlaneToleranceMm": 3, "allowNoFinding": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Compare the two hemispheres at every level; look for asymmetry, mass effect or abnormal signal."), hint(3, "Jumping to a slice with the reference.", {"type": "jumpToTarget", "targetId": "remind-025_glioma-tumour"}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": "A brain tumour is recognised by abnormal signal, mass effect (sulcal effacement, ventricular compression, midline shift) and, for many high-grade tumours, enhancement. The reference is the source's manual tumour segmentation.",
        "bookAnchors": objective_anchors("ch26-o11", 2), "objectiveIds": objectives_for("brain_tumour"), "skillDimensions": ["finding_localization"], "allowUncertain": True,
    },
    {
        "id": f"{case_id}:flair", "caseId": case_id, "type": "compare_appearances", "title": "Which series is FLAIR?",
        "prompt": "Compare the T2 and FLAIR series. On which one is CSF in the ventricles dark while oedema stays bright?",
        "modes": ["learn", "practice", "assess"], "seriesUids": [t2["uid"], flair["uid"]], "start": {"seriesUid": t2["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "flair", "text": "The FLAIR series", "correct": True, "why": "FLAIR nulls free water, so CSF is dark but oedema and most lesions remain bright."},
            {"id": "t2", "text": "The T2 series", "correct": False, "why": "On T2, CSF is bright — which can hide lesions next to ventricles and sulci."},
        ]},
        "scoring": "authoritative", "hints": [hint(1, "Look at the lateral ventricles on each series.")],
        "explanation": "FLAIR is a T2-weighted inversion-recovery sequence that suppresses CSF signal, making periventricular and cortical oedema easier to see.",
        "bookAnchors": objective_anchors("ch20-o03", 2), "objectiveIds": objectives_for("edema_mri") + objectives_for("brain_mri"), "skillDimensions": ["interpretation"], "allowUncertain": True,
    },
    {
        "id": f"{case_id}:describe", "caseId": case_id, "type": "describe_finding", "title": "Describe the lesion across sequences",
        "prompt": "Describe the lesion: location (lobe, side), size, signal on FLAIR/T2, enhancement, and mass effect. Give a short differential.",
        "modes": ["learn", "practice"], "seriesUids": [t1c["uid"], flair["uid"], t2["uid"]], "start": {"seriesUid": t1c["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
        "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
        "hints": [hint(1, "Use the four-up layout to see post-contrast T1, FLAIR and T2 at once.")],
        "explanation": "The source provides a tumour segmentation, not a histology label for this view, so the description is self-reviewed against the checklist and the book's brain tumour section.",
        "rubric": [
            {"id": "loc", "text": "Lobe, side and intra- vs extra-axial location", "weight": "essential", "category": "location"},
            {"id": "sig", "text": "Signal on FLAIR/T2 and the extent of surrounding oedema", "weight": "essential", "category": "pattern"},
            {"id": "enh", "text": "Enhancement pattern (none, solid, ring)", "weight": "essential", "category": "pattern"},
            {"id": "mass", "text": "Mass effect: sulcal effacement, ventricular compression, midline shift", "weight": "essential", "category": "associated_sign"},
            {"id": "ddx", "text": "Differential that fits the image features (e.g. primary glioma vs metastasis)", "weight": "supportive", "category": "differential"},
        ],
        "bookAnchors": objective_anchors("ch26-o11", 2), "objectiveIds": objectives_for("brain_tumour"), "skillDimensions": ["reporting", "interpretation"], "allowUncertain": True,
    },
]

tasks.append(oral_exam_task(case_id, [t1c["uid"], flair["uid"], t2["uid"]], t1c["uid"], "MRI suggests but does not prove tumour type or grade", "a solitary metastasis or an abscess", objective_anchors("ch26-o11", 2), objectives_for("brain_tumour")))

# ------------------------------------------------------------------ spine CT levels
subj = P.subject("13843")
sct = P.series_where(subj["key"], modality="CT")
case_id = "msk-spine-13843"
V = lambda lvl: f"spine-13843_{lvl}-vertebra"  # noqa: E731
cases.append({
    "id": case_id, "packId": "neuro-msk", "neutralTitle": "Patient Q · CT torso (bone window)",
    "learnTitle": "Counting vertebral levels on CT (T1–L5 labels)", "subjectKey": subj["key"], "studyUids": [sct["studyUid"]], "primarySeriesUid": sct["uid"],
    "region": ["spine"], "clinicalContext": "Adult in a spinal metastasis CT segmentation collection (source description).", "contextSource": "TCIA Spine-Mets-CT-SEG",
    "difficulty": "typical", "objectiveIds": objectives_for("spine_anatomy"), "bookAnchors": objective_anchors("ch22-o01", 2),
    "referenceSummary": "Source manual vertebral body segmentations T1–L5. Lesions are not referenced in this pack, so the tasks are about level identification only.",
    "learnNotes": "Count from a fixed landmark and say which you used: ribs articulate with T1–T12; the last rib-bearing vertebra is usually T12 and L1 is the first without ribs. The sagittal MPR shows the whole column at once; check your count on axial images.",
})
for lvl, name in [("l1", "L1"), ("t12", "T12"), ("l3", "L3")]:
    tasks.append({
        "id": f"{case_id}:{lvl}", "caseId": case_id, "type": "navigate_level", "title": f"Find the {name} vertebral body",
        "prompt": f"Mark the {name} vertebral body. Use the sagittal MPR to count, and note which landmark you counted from.",
        "modes": ["learn", "practice", "assess"], "seriesUids": [sct["uid"]], "start": {"seriesUid": sct["uid"], "slice": "middle", "windowPreset": "Bone"},
        "targets": [{"targetId": V(lvl), "name": name, "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 1.5, "inPlaneToleranceMm": 2},
        "scoring": "authoritative",
        "hints": [hint(1, "Open MPR (axial / coronal / sagittal) and work in the sagittal view."), hint(2, "Find the lowest vertebra with a rib attached; that is usually T12."), hint(4, "Showing the reference outline.", {"type": "showRegion", "targetIds": [V(lvl)]}), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": "Level errors are common; a mark in the neighbouring vertebra is reported as 'lies in the reference for T12/L2…' so you see by how many levels you were off. Transitional anatomy can change the count — always state your landmark.",
        "bookAnchors": objective_anchors("ch22-o01", 2), "objectiveIds": objectives_for("spine_anatomy"), "skillDimensions": ["anatomy", "navigation_windowing"], "allowUncertain": True,
    })

# ------------------------------------------------------------------ CBIS-DDSM mammogram
subj = next(s for s in P.manifest["subjects"] if s["sourceSubjectId"].startswith("Mass-Training_P_00001"))
mg = P.series_where(subj["key"], modality="MG")
case_id = "breast-cbis-p00001"
cases.append({
    "id": case_id, "packId": "neuro-msk", "neutralTitle": "Patient R · Mammogram (single view)",
    "learnTitle": "Mass on a left CC mammogram (CBIS-DDSM)", "subjectKey": subj["key"], "studyUids": [mg["studyUid"]], "primarySeriesUid": mg["uid"],
    "region": ["breast"], "clinicalContext": None, "contextSource": None, "difficulty": "exploratory",
    "objectiveIds": objectives_for("mammo_mass"), "bookAnchors": objective_anchors("ch29-o03", 2),
    "referenceSummary": "A digitised film mammogram (secondary capture, no pixel spacing — distances are not calibrated). The mass ROI comes from the CBIS-DDSM curation and is treated as an exploratory reference (self-review), not an authoritative key.",
    "learnNotes": "Describe a mass by shape, margin and density relative to the surrounding tissue. One view is not enough to localise a mass in 3D; a real work-up needs the MLO view.",
})
tasks.append({
    "id": f"{case_id}:mass", "caseId": case_id, "type": "locate_finding", "title": "Find and describe the mass",
    "prompt": "Search this mammogram, box any mass you find, and describe its shape, margin and density.",
    "modes": ["learn", "practice"], "seriesUids": [mg["uid"]], "start": {"seriesUid": mg["uid"], "slice": "first", "windowPreset": None},
    "targets": [{"targetId": "cbis-p00001-left-cc_mass-1", "name": "Mass", "required": True}],
    "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1, "inPlaneToleranceMm": 15, "allowNoFinding": True},
    "scoring": "exploratory_self_review",
    "hints": [hint(1, "Compare regions of glandular tissue; a mass has convex borders and is seen as a discrete density."), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
    "explanation": "Mass descriptors (shape, margin, density) carry most of the diagnostic weight in the book's approach. This ROI is a curated research annotation used here for comparison only; the image has no calibrated spacing, so tolerances are in pixels.",
    "rubric": [
        {"id": "shape", "text": "Shape (round, oval, irregular)", "weight": "essential", "category": "pattern"},
        {"id": "margin", "text": "Margin (circumscribed, obscured, indistinct, spiculated)", "weight": "essential", "category": "pattern"},
        {"id": "density", "text": "Density relative to glandular tissue", "weight": "supportive", "category": "pattern"},
        {"id": "views", "text": "Noted that a second view is needed to localise it", "weight": "supportive", "category": "limitation"},
    ],
    "bookAnchors": objective_anchors("ch29-o03", 2), "objectiveIds": objectives_for("mammo_mass"), "skillDimensions": ["finding_localization", "reporting"], "allowUncertain": True,
})

write_lessons(P, "1.0.0", cases, tasks)
