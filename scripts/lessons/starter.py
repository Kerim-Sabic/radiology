"""Authored lessons for the `starter` pack. Run: python scripts/lessons/starter.py

Every task references real series/targets from public/packs/starter/pack.json. Explanations
are original teaching text; book anchors were checked against the 5th-edition PDF pages.
"""
from common import Pack, anchor, frontal_cxr_tasks, hint, write_lessons
from objectives import objective_anchors, objectives_for

P = Pack("starter")

# ------------------------------------------------------------------ chest CT (LCTSC)
ct_subj = P.subject("LCTSC-Train-S1-012")
CT = P.series_where(ct_subj["key"], modality="CT", role="diagnostic")
T = lambda name: f"lctsc-train-s1-012_{name}"  # noqa: E731

A_CT_CONVENTION = anchor(32, "17", "ch02", note="Normal CT anatomy of the chest: viewing convention")
A_CT_WINDOWS = anchor(33, "18", "ch02", note="Lung vs mediastinal windows")
A_CT_NUMBERS = anchor(18, "3", "ch01", note="CT numbers and the display window")
A_CARDIAC_CT = anchor(39, "24", "ch03", note="Normal cardiac CT anatomy levels")
A_LOW_CARDIAC = anchor(42, "27", "ch03", note="High and low cardiac levels")

ct_case = {
    "id": "starter-ct-chest-01",
    "packId": "starter",
    "neutralTitle": "Patient A · CT chest",
    "learnTitle": "Chest CT anatomy with source organ contours",
    "subjectKey": ct_subj["key"],
    "studyUids": [CT["studyUid"]],
    "primarySeriesUid": CT["uid"],
    "region": ["chest"],
    "clinicalContext": None,
    "contextSource": None,
    "difficulty": "intro",
    "objectiveIds": objectives_for("ct_chest_anatomy"),
    "bookAnchors": [A_CT_CONVENTION, A_CT_WINDOWS, A_CARDIAC_CT],
    "referenceSummary": "Source radiotherapy organ-at-risk contours (LCTSC) for heart, both lungs, esophagus and spinal cord. Only these structures are referenced; nothing else in the study has been reviewed, so the study is not labelled normal or abnormal.",
    "learnNotes": (
        "Axial CT is displayed as if you stand at the patient's feet looking up: the patient's right is on your left, anterior is at the top. "
        "Check the side letters at the image edges before naming any left/right structure.\n\n"
        "Window first, then search: the lung window (about W1500/L−600) shows vessels, fissures and airways; the mediastinal window (about W350/L50) shows the heart, great vessels, esophagus and nodes.\n\n"
        "The yellow outlines are radiotherapy planning contours drawn by the dataset's experts. They follow radiotherapy definitions — for example the heart contour can include the pericardium, and the spinal cord contour may follow the canal — so they are excellent for locating structures but are not always the exact anatomical boundary you would trace for a report."
    ),
}

ct_tasks = [
    {
        "id": "starter-ct-chest-01:orientation",
        "caseId": ct_case["id"],
        "type": "compare_appearances",
        "title": "Which side is the patient's left on axial CT?",
        "prompt": "Scroll through the study and look at the side letters. On these axial images, where is the patient's LEFT side displayed?",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "right", "text": "On the right side of the screen", "correct": True, "why": "Radiological convention: images are viewed from the feet, so the patient's left appears on your right (the edge letter 'L')."},
            {"id": "left", "text": "On the left side of the screen", "correct": False, "why": "That would be viewing from the head; standard axial display is from the feet."},
            {"id": "varies", "text": "It varies from slice to slice", "correct": False, "why": "Within one axial series the orientation is fixed by the acquisition geometry."},
        ]},
        "scoring": "authoritative",
        "hints": [hint(1, "Find the edge letters: L, R, A and P are derived from the image orientation stored in the DICOM file."), hint(2, "Where does the heart's apex point? It normally points to the patient's left.")],
        "explanation": "Axial CT and MRI are displayed as if looking up from the patient's feet: patient right on the viewer's left, anterior at the top. The edge letters here come from ImageOrientationPatient, not from the picture. The heart apex pointing toward the 'L' edge is a quick sanity check (unless the patient has situs anomalies).",
        "bookAnchors": [A_CT_CONVENTION],
        "objectiveIds": objectives_for("orientation_ct"),
        "skillDimensions": ["orientation"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:window",
        "caseId": ct_case["id"],
        "type": "choose_window",
        "title": "Choose the window for lung parenchyma",
        "prompt": "Try the window presets (Window menu or keys 1–4). Which preset lets you see pulmonary vessels and fissures inside the lungs?",
        "modes": ["learn", "practice"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "middle", "windowPreset": "Soft tissue"},
        "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "lung", "text": "Lung (W1500 / L−600)", "correct": True, "why": "A wide window centred near air density spreads the very low lung attenuations across the grey scale, so vessels and fissures become visible."},
            {"id": "soft", "text": "Soft tissue (W400 / L40)", "correct": False, "why": "Everything below about −160 HU is black, so the lungs look uniformly dark."},
            {"id": "bone", "text": "Bone (W1800 / L400)", "correct": False, "why": "Centred far above lung density; useful for cortex and trabeculae, not parenchyma."},
            {"id": "media", "text": "Mediastinum (W350 / L50)", "correct": False, "why": "Narrow and centred on soft tissue — good for the heart and vessels, not the lung."},
        ]},
        "scoring": "authoritative",
        "hints": [hint(1, "Air is about −1000 HU and lung parenchyma is close to it. Which preset is centred near that?")],
        "explanation": "The window decides which CT numbers are spread across the grey scale. Lung parenchyma lives near −900 to −500 HU; only a low-centred wide window separates it. Always review a chest CT in at least lung and mediastinal windows.",
        "bookAnchors": [A_CT_WINDOWS, A_CT_NUMBERS],
        "objectiveIds": objectives_for("windowing"),
        "skillDimensions": ["navigation_windowing"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:heart",
        "caseId": ct_case["id"],
        "type": "find_structure",
        "title": "Find the heart",
        "prompt": "Navigate to a level where the heart is visible and place one point inside it.",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [{"targetId": T("heart"), "name": "Heart", "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 1.6, "inPlaneToleranceMm": 3},
        "scoring": "authoritative",
        "hints": [
            hint(1, "The heart lies in the lower half of the chest, between the lungs, resting on the diaphragm. Start at the top and scroll downward."),
            hint(2, "Below the level of the main pulmonary artery the chambers appear: a large soft-tissue structure anterior to the esophagus and descending aorta, bulging toward the patient's left."),
            hint(3, "Jumping to a slice where the reference contour of the heart exists.", {"type": "jumpToTarget", "targetId": T("heart")}),
            hint(4, "Showing the heart outline.", {"type": "showRegion", "targetIds": [T("heart")]}),
            hint(5, "Reveal the reference answer.", {"type": "reveal"}),
        ],
        "explanation": "On axial CT the heart occupies the anterior middle mediastinum at the low cardiac levels, extending toward the patient's left. The reference is the dataset's radiotherapy heart contour; a mark anywhere inside it (or within 3 mm of its edge on a contoured slice) counts.",
        "bookAnchors": [A_LOW_CARDIAC, A_CARDIAC_CT],
        "objectiveIds": objectives_for("heart_ct"),
        "skillDimensions": ["anatomy", "navigation_windowing"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:lungs-sides",
        "caseId": ct_case["id"],
        "type": "find_structure",
        "title": "Right lung versus left lung",
        "prompt": "Use the Arrow tool (A). Place one arrow in the patient's RIGHT lung and one in the LEFT lung, naming each arrow.",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "middle", "windowPreset": "Lung"},
        "targets": [
            {"targetId": T("right-lung"), "name": "Right lung", "required": True},
            {"targetId": T("left-lung"), "name": "Left lung", "required": True},
        ],
        "grading": {"kind": "labelled_points", "slabToleranceMm": 1.6, "inPlaneToleranceMm": 2, "levelTargetId": None, "requireLabels": True},
        "scoring": "authoritative",
        "hints": [
            hint(1, "Read the edge letters first: the 'L' edge marks the patient's left."),
            hint(2, "The heart apex points to the patient's left; the lung on that side is the left lung."),
            hint(5, "Reveal the reference answer.", {"type": "reveal"}),
        ],
        "explanation": "With standard axial display the patient's right lung is on the viewer's left. Feedback grades side separately: a correctly placed point with the wrong side name is reported as a laterality error, not as a localisation error.",
        "bookAnchors": [A_CT_CONVENTION],
        "objectiveIds": objectives_for("orientation_ct"),
        "skillDimensions": ["orientation", "anatomy"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:esophagus",
        "caseId": ct_case["id"],
        "type": "find_structure",
        "title": "Find the esophagus",
        "prompt": "Find the esophagus on any axial slice of the chest and mark its centre.",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [{"targetId": T("esophagus"), "name": "Esophagus", "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 1.6, "inPlaneToleranceMm": 2.5},
        "scoring": "authoritative",
        "hints": [
            hint(1, "It is a posterior mediastinal tube running from the neck to the abdomen, close to the spine."),
            hint(2, "Look just anterior to the vertebral body and, in the lower chest, right of / anterior to the descending aorta. A small air bubble in its lumen is common."),
            hint(3, "Jumping to a slice with the esophagus contour.", {"type": "jumpToTarget", "targetId": T("esophagus")}),
            hint(5, "Reveal the reference answer.", {"type": "reveal"}),
        ],
        "explanation": "The esophagus is a small, often collapsed soft-tissue tube with or without an air bubble, lying in front of the spine and beside the descending aorta. Its small size is why the tolerance here is only 2.5 mm.",
        "bookAnchors": [A_CT_CONVENTION, A_CARDIAC_CT],
        "objectiveIds": objectives_for("ct_chest_anatomy"),
        "skillDimensions": ["anatomy"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:cord",
        "caseId": ct_case["id"],
        "type": "find_structure",
        "title": "Find the spinal cord",
        "prompt": "Mark the spinal cord (the contents of the spinal canal, not the vertebral body).",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "middle", "windowPreset": "Bone"},
        "targets": [{"targetId": T("spinal-cord"), "name": "Spinal cord", "required": True}],
        "grading": {"kind": "point_in_target", "slabToleranceMm": 1.6, "inPlaneToleranceMm": 2},
        "scoring": "authoritative",
        "hints": [
            hint(1, "Find the vertebral body, then look behind it for the ring of bone that forms the canal."),
            hint(2, "Switch to the soft-tissue window: the canal contents are soft-tissue density surrounded by bone."),
            hint(5, "Reveal the reference answer.", {"type": "reveal"}),
        ],
        "explanation": "The cord sits within the spinal canal, enclosed by the vertebral body anteriorly and the posterior elements. CT does not separate cord from CSF well; the radiotherapy contour marks the canal contents used as the cord organ-at-risk.",
        "bookAnchors": [A_CT_CONVENTION],
        "objectiveIds": objectives_for("ct_chest_anatomy"),
        "skillDimensions": ["anatomy"],
        "allowUncertain": True,
    },
    {
        "id": "starter-ct-chest-01:five-structures",
        "caseId": ct_case["id"],
        "type": "find_structure",
        "title": "Name five structures",
        "prompt": "With named arrows, mark: heart, esophagus, spinal cord, right lung and left lung. You may use different slices.",
        "modes": ["practice", "assess"],
        "seriesUids": [CT["uid"]],
        "start": {"seriesUid": CT["uid"], "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [
            {"targetId": T("heart"), "name": "Heart", "required": True},
            {"targetId": T("esophagus"), "name": "Esophagus", "required": True},
            {"targetId": T("spinal-cord"), "name": "Spinal cord", "required": True},
            {"targetId": T("right-lung"), "name": "Right lung", "required": True},
            {"targetId": T("left-lung"), "name": "Left lung", "required": True},
        ],
        "grading": {"kind": "labelled_points", "slabToleranceMm": 1.6, "inPlaneToleranceMm": 2.5, "levelTargetId": None, "requireLabels": True},
        "scoring": "authoritative",
        "hints": [hint(1, "Work systematically: mediastinal window for heart, esophagus and cord; lung window for the lungs."), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
        "explanation": "Each structure is matched one-to-one; two arrows in one structure count once, and a correctly placed but wrongly named arrow is reported separately from a misplaced one.",
        "bookAnchors": [A_CT_CONVENTION, A_CT_WINDOWS],
        "objectiveIds": objectives_for("ct_chest_anatomy"),
        "skillDimensions": ["anatomy", "orientation", "navigation_windowing"],
        "allowUncertain": True,
    },
]

# ------------------------------------------------------------------ radiograph vs CT scout (COVID-19-AR)
cr_subj = P.subject("COVID-19-AR-16406503")
CR = P.series_where(cr_subj["key"], modality="CR")
SCOUT = P.series_where(cr_subj["key"], role="scout")
A_FRONTAL = anchor(26, "11", "ch02", note="The normal frontal chest radiograph")
A_AP_MAGNIFY = anchor(36, "21", "ch02", note="AP vs PA: heart magnification")
A_HEART_CXR = anchor(37, "22", "ch03", note="Evaluating the heart on chest radiographs")
A_DENSITIES = anchor(16, "2", "ch01", note="Conventional radiography and the five basic densities")

cr_case = {
    "id": "starter-cxr-01",
    "packId": "starter",
    "neutralTitle": "Patient B · Chest radiograph + CT localizer",
    "learnTitle": "Portable AP chest radiograph vs CT scout (same patient)",
    "subjectKey": cr_subj["key"],
    "studyUids": [CR["studyUid"], SCOUT["studyUid"]],
    "primarySeriesUid": CR["uid"],
    "region": ["chest"],
    "clinicalContext": None,
    "contextSource": None,
    "difficulty": "intro",
    "objectiveIds": objectives_for("cxr_systematic"),
    "bookAnchors": [A_FRONTAL, A_AP_MAGNIFY, A_HEART_CXR],
    "referenceSummary": "No finding-level reference exists for this radiograph. Tasks are about technique and a systematic search, checked against a source-linked checklist (self-review). The patient is from the COVID-19-AR research collection; that cohort label is not a finding on this image.",
    "learnNotes": (
        "This patient has a portable AP chest radiograph and, one day later (dates shifted, interval preserved), a CT whose localizer ('scout') image is included here. "
        "A scout is a low-dose projection the CT scanner uses to plan slices — it is not a diagnostic chest radiograph and should not be read as one.\n\n"
        "The radiograph is stored as MONOCHROME1 (higher pixel values display darker); the viewer handles that so bone still appears white. "
        "No side marker is recorded in the file header, so the viewer shows 'orientation not recorded' rather than guessing."
    ),
}

cr_tasks = [
    {
        "id": "starter-cxr-01:scout-vs-cxr",
        "caseId": cr_case["id"],
        "type": "compare_appearances",
        "title": "Diagnostic radiograph or CT scout?",
        "prompt": "This patient has two frontal projection images (use the two-up layout or the series list). Which one is the diagnostic chest radiograph you would report?",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [CR["uid"], SCOUT["uid"]],
        "start": {"seriesUid": CR["uid"], "slice": "first", "windowPreset": None},
        "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "cr", "text": "The CR image from the study 'XR CHEST AP PORTABLE'", "correct": True, "why": "It is a radiographic acquisition (modality CR) with full detector resolution — the diagnostic chest X-ray."},
            {"id": "scout", "text": "The 'locator' image from the CT study", "correct": False, "why": "This is the CT localizer (scout): a low-dose planning projection with modality CT. It is useful for orientation but is not a diagnostic radiograph."},
        ]},
        "scoring": "authoritative",
        "hints": [hint(1, "Compare the modality and series description shown in each viewport's corner."), hint(2, "Which image was acquired by the CT scanner to plan its slices?")],
        "explanation": "CT scouts (localizer/topogram/scanogram) are acquired by the CT gantry for slice planning, at low dose and lower quality. They can show gross findings but are not a substitute for a chest radiograph. The app never counts a scout as an X-ray in same-patient comparisons.",
        "bookAnchors": [A_DENSITIES],
        "objectiveIds": objectives_for("modalities"),
        "skillDimensions": ["orientation", "cross_modality"],
        "allowUncertain": True,
    },
    {
        "id": "starter-cxr-01:systematic",
        "caseId": cr_case["id"],
        "type": "describe_finding",
        "title": "Systematic review of a portable AP chest radiograph",
        "prompt": "Review this chest radiograph systematically and write what you see. Mark anything you consider abnormal. There may or may not be an abnormality.",
        "modes": ["learn", "practice"],
        "seriesUids": [CR["uid"]],
        "start": {"seriesUid": CR["uid"], "slice": "first", "windowPreset": None},
        "targets": [],
        "grading": {"kind": "self_review"},
        "scoring": "exploratory_self_review",
        "hints": [hint(1, "Technique first: projection (AP vs PA), patient position, inspiration and rotation."), hint(2, "Then a fixed order: lines/tubes, lungs (apex to base, both sides), pleura and angles, heart and mediastinum, diaphragm, bones and soft tissues.")],
        "explanation": "There is no expert finding reference for this image, so judge your description against the checklist. An AP portable projection magnifies the heart, so heart size is not reliably assessed on it.",
        "rubric": [
            {"id": "tech", "text": "Identified the projection as AP (portable) and commented on its limitations", "weight": "essential", "category": "limitation"},
            {"id": "lines", "text": "Checked for lines, tubes and devices", "weight": "supportive", "category": "finding"},
            {"id": "lungs", "text": "Compared both lungs from apex to base", "weight": "essential", "category": "finding"},
            {"id": "pleura", "text": "Assessed pleura and costophrenic angles", "weight": "essential", "category": "finding"},
            {"id": "heart", "text": "Commented on heart and mediastinum, noting that AP magnifies the heart", "weight": "essential", "category": "finding"},
            {"id": "bones", "text": "Reviewed bones, diaphragm and soft tissues", "weight": "supportive", "category": "finding"},
            {"id": "impr", "text": "Gave a concise impression, or stated what cannot be assessed", "weight": "essential", "category": "impression"},
        ],
        "bookAnchors": [A_FRONTAL, A_AP_MAGNIFY, A_HEART_CXR],
        "objectiveIds": objectives_for("cxr_systematic"),
        "skillDimensions": ["reporting", "orientation"],
        "allowUncertain": True,
    },
]

# ------------------------------------------------------------------ prostate MRI zones (PROSTATEx)
mr_subj = P.subject("ProstateX-0004")
MR = P.series_where(mr_subj["key"], modality="MR")
Z = lambda name: f"prostatex-0004_{name}"  # noqa: E731
A_T1T2 = anchor(258, "238", "ch20", note="How to identify a T1- or T2-weighted image")
A_WATER = anchor(259, "239", "ch20", note="Water: dark on T1, bright on T2")

mr_case = {
    "id": "starter-mr-prostate-01",
    "packId": "starter",
    "neutralTitle": "Patient C · MRI pelvis (axial)",
    "learnTitle": "T2-weighted prostate MRI with zonal segmentation",
    "subjectKey": mr_subj["key"],
    "studyUids": [MR["studyUid"]],
    "primarySeriesUid": MR["uid"],
    "region": ["pelvis"],
    "clinicalContext": None,
    "contextSource": None,
    "difficulty": "intro",
    "objectiveIds": objectives_for("mri_weighting"),
    "bookAnchors": [A_T1T2, A_WATER],
    "referenceSummary": "Source manual zonal segmentation (PROSTATEx-Seg-Zones): peripheral zone, transition zone, prostatic urethra and anterior fibromuscular stroma. No lesion annotation is used here.",
    "learnNotes": (
        "MR intensities are relative signal, not Hounsfield units — there are no fixed windows; adjust brightness/contrast by eye.\n\n"
        "This axial T2-weighted series (TR 6840 ms, TE 104 ms at 3 T) shows fluid bright, e.g. urine in the bladder. "
        "Prostate zonal anatomy is beyond the book's scope; the book is linked for how to recognise T1 versus T2 weighting."
    ),
}

mr_tasks = [
    {
        "id": "starter-mr-prostate-01:weighting",
        "caseId": mr_case["id"],
        "type": "compare_appearances",
        "title": "T1 or T2?",
        "prompt": "Look at the image and the acquisition data in the viewport corner. Is this series T1-weighted or T2-weighted?",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [MR["uid"]],
        "start": {"seriesUid": MR["uid"], "slice": "middle", "windowPreset": None},
        "targets": [],
        "grading": {"kind": "choice", "multiple": False, "options": [
            {"id": "t2", "text": "T2-weighted", "correct": True, "why": "Long TR (6840 ms) and long TE (104 ms), and fluid such as urine is bright."},
            {"id": "t1", "text": "T1-weighted", "correct": False, "why": "T1 weighting uses short TR and short TE and shows simple fluid dark."},
            {"id": "ct", "text": "It cannot be told without contrast", "correct": False, "why": "Weighting is a property of TR/TE and tissue appearance; contrast is not needed."},
        ]},
        "scoring": "authoritative",
        "hints": [hint(1, "Find something that is almost pure water (the bladder) — bright or dark?"), hint(2, "Read TR and TE in the top-right corner of the viewport.")],
        "explanation": "Water is dark on T1-weighted and bright on T2-weighted images. Here urine is bright and the parameters are long TR / long TE, so the series is T2-weighted. Always confirm weighting from both appearance and parameters.",
        "bookAnchors": [A_T1T2, A_WATER],
        "objectiveIds": objectives_for("mri_weighting"),
        "skillDimensions": ["interpretation", "orientation"],
        "allowUncertain": True,
    },
    {
        "id": "starter-mr-prostate-01:pz-tz",
        "caseId": mr_case["id"],
        "type": "find_structure",
        "title": "Peripheral zone versus transition zone",
        "prompt": "Mark the peripheral zone and the transition zone of the prostate with named arrows (any slice).",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [MR["uid"]],
        "start": {"seriesUid": MR["uid"], "slice": "first", "windowPreset": None},
        "targets": [
            {"targetId": Z("prostate-peripheral-zone"), "name": "Peripheral zone", "required": True},
            {"targetId": Z("prostate-transition-zone"), "name": "Transition zone", "required": True},
        ],
        "grading": {"kind": "labelled_points", "slabToleranceMm": 2.3, "inPlaneToleranceMm": 1.5, "levelTargetId": None, "requireLabels": True},
        "scoring": "authoritative",
        "hints": [
            hint(1, "Find the prostate below the bladder, in front of the rectum."),
            hint(2, "On T2 the peripheral zone is the brighter crescent posteriorly and laterally; the transition zone is the more heterogeneous central/anterior region around the urethra."),
            hint(5, "Reveal the reference answer.", {"type": "reveal"}),
        ],
        "explanation": "On T2-weighted MRI the normal peripheral zone is relatively high signal and wraps posterolaterally; the transition zone surrounds the proximal urethra and is often nodular from benign hyperplasia. (Zonal anatomy is general knowledge beyond the book; it is used here to practise reading MR signal.)",
        "bookAnchors": [A_T1T2],
        "objectiveIds": objectives_for("mri_weighting"),
        "skillDimensions": ["anatomy"],
        "allowUncertain": True,
    },
]

cr_tasks += [t for t in frontal_cxr_tasks(cr_case["id"], CR, "AP", objective_anchors("ch03-o02", 2), objective_anchors("ch03-o01", 2), objective_anchors("ch02-o01", 2), {"tech": ["ch02-o01"], "borders": ["ch03-o02"], "ctr": ["ch03-o01"]}) if not t["id"].endswith(":technique")]

write_lessons(P, "1.0.0", [ct_case, cr_case, mr_case], ct_tasks + cr_tasks + mr_tasks)
