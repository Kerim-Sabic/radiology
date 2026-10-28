"""Book-practice tasks: practice for Learning Radiology (5th ed.) objectives on cases that are already installed.

  python scripts/lessons/book_practice.py

Writes public/packs/book-practice/{pack.json,lessons.json} (a lessons-only pack: no images, no targets of its own;
every task points at a case, series and reference target of another pack) and appends its entry to
public/packs/index.json if it is missing.

Rules (accuracy first):
  * A task is written only where installed labels or the image header support its answer: expert outlines and
    boxes, anatomy outlines (AI drafts by Horalix — graded as self-review until the learner reviews them),
    the DICOM geometry (orientation), the sequence and contrast recorded in the header (MRI T1, oral contrast).
  * Choice answers are physics or convention the book teaches (T1-bright fat, enhancement, orientation, the
    words for bright and dark), never a diagnosis the source does not state.
  * Book anchors are the objective's verified anchors from public/content/curriculum.v1.json.
  * Only cases whose source licence allows commercial use are used (no non-commercial sources).
  * Selection is deterministic (sorted subject keys), so a rebuild gives the same file.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "public" / "packs"
OUT = PACKS / "book-practice"
PACK_ID = "book-practice"

CUR = json.loads((ROOT / "public" / "content" / "curriculum.v1.json").read_text(encoding="utf-8"))
OBJ = {o["id"]: (u["id"], o) for u in CUR["units"] for o in u["objectives"]}

# Oral contrast is in the header of these studies AND was checked on the images (contrast-filled bowel visible).
ORAL_CONTRAST_VERIFIED: set[str] = set()


def load():
    series, targets, subjects, sources, cases, tasks = {}, {}, {}, {}, {}, []
    for d in sorted(PACKS.iterdir()):
        if not (d / "pack.json").exists() or d.name == PACK_ID:
            continue
        p = json.loads((d / "pack.json").read_text(encoding="utf-8"))
        for s in p["sources"]:
            sources[s["id"]] = s
        for s in p["subjects"]:
            subjects[s["key"]] = s
        for s in p["series"]:
            series[s["uid"]] = {**s, "_pack": d.name}
        for t in p["referenceTargets"]:
            targets[t["id"]] = {**t, "_pack": d.name}
        if (d / "lessons.json").exists():
            l = json.loads((d / "lessons.json").read_text(encoding="utf-8"))
            for c in l["cases"]:
                cases[c["id"]] = c
            tasks += l["tasks"]
    return series, targets, subjects, sources, cases, tasks


SERIES, TARGETS, SUBJECTS, SOURCES, CASES, EXISTING = load()


def permitted(subject_key: str) -> bool:
    src = SOURCES.get(SUBJECTS.get(subject_key, {}).get("sourceId", ""), {})
    lic = f"{src.get('license', '')} {src.get('licenseUrl', '')}"
    return bool(src) and not re.search(r"non.?commercial|by-nc", lic, re.I)


def geometry_ok(t) -> bool:
    f = PACKS / t["_pack"] / t["geometryFile"]
    if not f.exists():
        return False
    g = json.loads(f.read_text(encoding="utf-8"))
    return bool(g.get("planes") or g.get("boxes"))


def series_targets(uid: str) -> dict[str, dict]:
    out = {}
    for t in TARGETS.values():
        if t["seriesUid"] == uid and t["classId"] not in out and geometry_ok(t):
            out[t["classId"]] = t
    return out


def case_of(series_uid: str):
    s = SERIES[series_uid]
    found = [c for c in CASES.values() if c["subjectKey"] == s["subjectKey"] and s["studyUid"] in c["studyUids"]]
    found.sort(key=lambda c: (c["primarySeriesUid"] != series_uid, c["id"]))
    return found[0] if found else None


def anchors(*objective_ids: str):
    out, seen = [], set()
    for oid in objective_ids:
        unit, o = OBJ[oid]
        for a in o["anchors"]:
            key = (a["physical"], a.get("figureId"), a.get("sectionId"))
            if key in seen:
                continue
            seen.add(key)
            out.append({"physical": a["physical"], "printed": a["printed"], "chapterId": unit, "figureId": a.get("figureId"), "sectionId": a.get("sectionId")})
    return out


def is_ct(s):
    return s["modality"] == "CT" and s["role"] == "diagnostic"


def is_frontal_xr(s):
    return s["modality"] in ("CR", "DX") and s["role"] != "scout" and str(s["acquisition"].get("ViewPosition") or "").upper() in ("PA", "AP")


def ok_subject(s):
    return permitted(s["subjectKey"]) and case_of(s["uid"]) is not None


USED: dict[str, int] = {}  # tasks already given to each patient: spread the practice over different patients


def pick(pred, n: int):
    """n series of different patients matching pred, preferring patients with the fewest book-practice tasks so far."""
    chosen, subjects = [], set()
    for s in sorted(SERIES.values(), key=lambda x: (USED.get(x["subjectKey"], 0), x["subjectKey"], x["uid"])):
        if s["subjectKey"] in subjects or not ok_subject(s) or not pred(s):
            continue
        chosen.append(s)
        subjects.add(s["subjectKey"])
        if len(chosen) == n:
            break
    for s in chosen:
        USED[s["subjectKey"]] = USED.get(s["subjectKey"], 0) + 1
    return chosen


def task(case, s, slug, **kw):
    g = kw.get("grading")
    if g and g["kind"] == "choice":
        # A fixed order per task (rebuilds stay identical) that does not always put the answer first.
        opts = g["options"]
        k = sum(map(ord, f"{case['id']}:{slug}")) % len(opts)
        g["options"] = opts[k:] + opts[:k]
    t = {
        "id": f"{case['id']}:bp-{slug}",
        "caseId": case["id"],
        "seriesUids": [s["uid"]],
        "start": {"seriesUid": s["uid"], "slice": "middle", "windowPreset": None},
        "targets": [],
        "hints": [],
        "allowUncertain": True,
    }
    t.update(kw)
    t["hints"] = t["hints"] + [{"level": 5, "text": "Reveal the reference and the explanation.", "action": {"type": "reveal"}}]
    return t


def choice(options, correct_id):
    return {
        "kind": "choice",
        "multiple": False,
        "options": [{"id": oid, "text": text, "correct": oid == correct_id, "why": why} for oid, text, why in options],
    }


def target_ref(t, name, accepted=None):
    r = {"targetId": t["id"], "name": name, "required": True}
    if accepted:
        r["acceptedNames"] = accepted
    return r


LOBES = [
    ("anatomy:lung_upper_lobe_right", "Right upper lobe", ["RUL", "Right upper lobe"]),
    ("anatomy:lung_middle_lobe_right", "Right middle lobe", ["RML", "Right middle lobe", "Middle lobe"]),
    ("anatomy:lung_lower_lobe_right", "Right lower lobe", ["RLL", "Right lower lobe"]),
    ("anatomy:lung_upper_lobe_left", "Left upper lobe", ["LUL", "Left upper lobe"]),
    ("anatomy:lung_lower_lobe_left", "Left lower lobe", ["LLL", "Left lower lobe"]),
]
AI_NOTE = "The outlines are AI drafts by Horalix that no radiologist has reviewed: the answer is self-reviewed until you review the reference in Author."


def build():
    tasks = []

    # ---------------------------------------------------------------- ch02-o06: fissures and lobes on CT
    for s in pick(lambda s: is_ct(s) and all(k in series_targets(s["uid"]) for k, _, _ in LOBES), 3):
        st, c = series_targets(s["uid"]), case_of(s["uid"])
        tasks.append(task(c, s, "lobes",
            type="find_structure",
            title="Name the five lobes and the fissures between them",
            prompt="In the lung window, place a named arrow in each lobe: right upper, right middle, right lower, left upper and left lower lobe. Use the coronal and sagittal views (MPR) to see the fissures that separate them.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": "Lung"},
            targets=[target_ref(st[k], n, acc) for k, n, acc in LOBES],
            grading={"kind": "labelled_points", "slabToleranceMm": 2.5, "inPlaneToleranceMm": 2.5, "levelTargetId": None, "requireLabels": True},
            scoring="exploratory_self_review",
            hints=[
                {"level": 1, "text": "The major (oblique) fissures separate the lower lobes behind from the upper lobes — and on the right the middle lobe — in front."},
                {"level": 2, "text": "The minor (horizontal) fissure separates the right upper from the right middle lobe. It lies almost in the axial plane, so on axial CT it shows as a vessel-poor zone rather than a line. The left lung has no middle lobe: the lingula belongs to the left upper lobe."},
            ],
            explanation="Fissures define the lobes: the major fissures run obliquely from high posteriorly to low anteriorly, so on low axial slices most of the lung is lower lobe; the minor fissure marks the top of the right middle lobe. Knowing where the fissures normally lie is what later shows volume loss when they move. " + AI_NOTE,
            bookAnchors=anchors("ch02-o06"),
            objectiveIds=["ch02-o06"],
            skillDimensions=["anatomy", "navigation_windowing"],
        ))

    # ---------------------------------------------------------------- ch03-o05: main pulmonary artery level and AP window
    def has_mpa(s):
        st = series_targets(s["uid"])
        return is_ct(s) and "anatomy:aorta_arch" in st and "anatomy:pulmonary_trunk" in st and bool(s["acquisition"].get("ContrastBolusAgent"))

    for s in pick(has_mpa, 3):
        st, c = series_targets(s["uid"]), case_of(s["uid"])
        tasks.append(task(c, s, "ap-window",
            type="navigate_level",
            title="The aortopulmonary window: aortic arch above, main pulmonary artery below",
            prompt="In the soft-tissue window, place a named arrow on the aortic arch, then scroll down and place one on the main pulmonary artery (pulmonary trunk). The fat between them is the aortopulmonary window.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": "Soft tissue"},
            targets=[
                target_ref(st["anatomy:aorta_arch"], "Aortic arch", ["Aortic arch", "Arch of the aorta", "Aorta arch"]),
                target_ref(st["anatomy:pulmonary_trunk"], "Main pulmonary artery", ["Main pulmonary artery", "Pulmonary trunk", "MPA"]),
            ],
            grading={"kind": "labelled_points", "slabToleranceMm": 2.5, "inPlaneToleranceMm": 2.5, "levelTargetId": None, "requireLabels": True},
            scoring="exploratory_self_review",
            hints=[
                {"level": 1, "text": "The arch is the highest part of the aorta, crossing from front-right to back-left above the heart."},
                {"level": 2, "text": "The pulmonary trunk leaves the right ventricle in front of and to the left of the ascending aorta and divides into the right and left pulmonary arteries a little below the arch."},
            ],
            explanation="Below the aortic arch and above the pulmonary artery lies the aortopulmonary window, normally filled with fat and a few small nodes. Enlarged nodes there are a common, easily missed finding, so look at this level on every chest CT. " + AI_NOTE,
            bookAnchors=anchors("ch03-o05"),
            objectiveIds=["ch03-o05"],
            skillDimensions=["anatomy", "navigation_windowing"],
        ))

    # ---------------------------------------------------------------- ch12-o05: costal cartilage, a benign calcification
    for s in pick(lambda s: is_ct(s) and "anatomy:costal_cartilages" in series_targets(s["uid"]), 2):
        st, c = series_targets(s["uid"]), case_of(s["uid"])
        tasks.append(task(c, s, "costal-cartilage",
            type="find_structure",
            title="Costal cartilage: a normal calcification",
            prompt="In the bone window, find the costal cartilages — the front ends of the ribs where they meet the sternum — and click one.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": "Bone"},
            targets=[target_ref(st["anatomy:costal_cartilages"], "Costal cartilage", ["Costal cartilage", "Costal cartilages"])],
            grading={"kind": "point_in_target", "slabToleranceMm": 2.5, "inPlaneToleranceMm": 2.5},
            scoring="exploratory_self_review",
            hints=[{"level": 1, "text": "Follow a rib forward: it becomes cartilage before it reaches the sternum. With age the cartilage calcifies, often in streaks along its edges."}],
            explanation="Calcified costal cartilage is a normal finding that increases with age. Like phleboliths in the pelvic veins, it is a benign calcification you should recognize so that it is not mistaken for disease — phleboliths are small, round and often have a lucent centre, while a stone lies along the course of the ureter or in the kidney or bladder. " + AI_NOTE,
            bookAnchors=anchors("ch12-o05"),
            objectiveIds=["ch12-o05"],
            skillDimensions=["anatomy", "interpretation"],
        ))

    # ---------------------------------------------------------------- ch03-o03 + appB-o01: heart and aortic knob on the frontal radiograph
    for s in pick(lambda s: is_frontal_xr(s) and "anatomy:aorta" in series_targets(s["uid"]) and "anatomy:heart" in series_targets(s["uid"]), 3):
        st, c = series_targets(s["uid"]), case_of(s["uid"])
        tasks.append(task(c, s, "contours",
            type="find_structure",
            title="Cardiac and aortic contours on the frontal radiograph",
            prompt="Place a named arrow on the aortic knob and one on the heart (the cardiac silhouette). Then trace the borders: on the right the superior vena cava and right atrium; on the left the aortic knob, the main pulmonary artery segment and the left ventricle.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": None},
            targets=[
                target_ref(st["anatomy:aorta"], "Aortic knob", ["Aortic knob", "Aorta", "Aortic arch", "Knob"]),
                target_ref(st["anatomy:heart"], "Heart", ["Heart", "Cardiac silhouette"]),
            ],
            grading={"kind": "labelled_points", "slabToleranceMm": 1.0, "inPlaneToleranceMm": 3.0, "levelTargetId": None, "requireLabels": True},
            scoring="exploratory_self_review",
            hints=[{"level": 1, "text": "The aortic knob is the rounded bulge at the top of the left border of the mediastinum, a little below the left clavicle."}],
            explanation="From top to bottom the left border is made by the aortic knob, the main pulmonary artery segment and the left ventricle; the right border by the superior vena cava and the right atrium. A knob that is too large or an ascending aorta bulging to the right beyond the right heart border are clues to hypertension or aortic stenosis. " + AI_NOTE,
            bookAnchors=anchors("appB-o01", "ch03-o03"),
            objectiveIds=["appB-o01", "ch03-o03"],
            skillDimensions=["anatomy", "interpretation"],
        ))

    # ---------------------------------------------------------------- appB-o07: the ABCs on films the radiologist marked as cardiomegaly
    def cardiomegaly(s):
        return is_frontal_xr(s) and "finding:cardiomegaly" in series_targets(s["uid"])

    for s in pick(cardiomegaly, 3):
        st, c = series_targets(s["uid"]), case_of(s["uid"])
        tasks.append(task(c, s, "abc-heart",
            type="whole_study",
            title="Apply the ABCs of heart disease",
            prompt="Read the heart on this PA film step by step: heart size first (cardiothoracic ratio), then A, B, C and D as the book teaches. Write what you find at each step, then compare with the checklist.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": None},
            targets=[target_ref(st["finding:cardiomegaly"], "Enlarged cardiac silhouette")],
            grading={"kind": "self_review"},
            scoring="exploratory_self_review",
            rubric=[
                {"id": "size", "text": "Heart size first: the cardiothoracic ratio on a PA film — over 50% is enlarged. The radiologist marked this cardiac silhouette as enlarged.", "weight": "essential", "category": "finding"},
                {"id": "a", "text": "A — is the left atrium enlarged? Look for a straightened or convex left heart border and a double density on the right heart border.", "weight": "essential", "category": "pattern"},
                {"id": "b", "text": "B — is the main pulmonary artery segment big or bulbous? Draw the tangent from the left ventricular apex to the aortic knob and see whether it bulges beyond it.", "weight": "supportive", "category": "pattern"},
                {"id": "c", "text": "C — is that segment concave (well inside the tangent)? If so, judge the aorta: ascending only, or ascending, knob and descending all prominent.", "weight": "supportive", "category": "pattern"},
                {"id": "d", "text": "D — is it a dilated, delta-shaped heart (very large, smooth, projecting almost equally to both sides)? Think of cardiomyopathy and pericardial effusion.", "weight": "supportive", "category": "differential"},
                {"id": "vessels", "text": "Pulmonary vessels where the steps call for it: the right descending pulmonary artery, then flow from apex to base and from hilum to periphery.", "weight": "supportive", "category": "associated_sign"},
                {"id": "limits", "text": "Only the enlarged heart is labelled in this dataset; the A–D answers are your own reading.", "weight": "supportive", "category": "limitation"},
            ],
            hints=[{"level": 1, "text": "Measure the widest heart against the widest inner chest on this PA film; then work through A, B, C, D in that order."}],
            explanation="The book's system asks the questions in a fixed order after judging heart size: A, is the left atrium enlarged; B, is the main pulmonary artery big; C, is it concave; D, is the heart dilated or delta-shaped. Each answer points to a group of causes and tells you whether the pulmonary vessels or the aorta help next. This film's label (from the source dataset) confirms only that the heart is enlarged.",
            bookAnchors=anchors("appB-o07"),
            objectiveIds=["appB-o07"],
            skillDimensions=["interpretation", "reporting"],
        ))

    # ---------------------------------------------------------------- ch01-o01: the five densities on a chest radiograph
    for s in pick(lambda s: is_frontal_xr(s) and SERIES[s["uid"]]["_pack"] in ("chest-pairs", "expansion"), 2):
        c = case_of(s["uid"])
        tasks.append(task(c, s, "densities",
            type="describe_finding",
            title="The five radiographic densities",
            prompt="Place an arrow on one example of each density on this chest radiograph — air, fat, soft tissue or fluid, bone or calcium, and metal if any is present — then compare with the checklist.",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": None},
            grading={"kind": "self_review"},
            scoring="exploratory_self_review",
            rubric=[
                {"id": "air", "text": "Air (blackest): the trachea and the lungs.", "weight": "essential", "category": "finding"},
                {"id": "fat", "text": "Fat (dark grey): the soft tissues of the chest wall, axillae and shoulders — darker than muscle.", "weight": "essential", "category": "finding"},
                {"id": "soft", "text": "Soft tissue or fluid (light grey): the heart, the diaphragm and the muscles.", "weight": "essential", "category": "finding"},
                {"id": "bone", "text": "Bone or calcium (white): the ribs, clavicles and spine.", "weight": "essential", "category": "finding"},
                {"id": "metal", "text": "Metal (brightest white), if present: ECG leads, wires, clips or jewelry. A film without metal is normal.", "weight": "supportive", "category": "finding"},
            ],
            explanation="A radiograph can separate only five densities. The denser a material, the more x-rays it absorbs and the whiter it looks; and an edge is visible only where two different densities meet — which is why the heart border disappears when the lung beside it fills with fluid.",
            bookAnchors=anchors("ch01-o01"),
            objectiveIds=["ch01-o01"],
            skillDimensions=["interpretation"],
        ))

    # ---------------------------------------------------------------- appD-o01: orientation (geometry from the DICOM header)
    def standard_axial(s):
        iop = s["geometry"].get("iop") or []
        return is_ct(s) and len(iop) == 6 and all(abs(a - b) < 0.05 for a, b in zip(iop, [1, 0, 0, 0, 1, 0]))

    right_side = [
        ("left", "On the left of the screen", "Images are displayed as if you face the patient (axial CT viewed from the feet), so the patient's right is on your left."),
        ("right", "On the right of the screen", "That would be the patient's left side."),
        ("top", "At the top of the screen", "The top of an axial image is the front (anterior) of the patient."),
        ("bottom", "At the bottom of the screen", "The bottom of an axial image is the back (posterior) of the patient."),
    ]
    for s in pick(standard_axial, 1):
        c = case_of(s["uid"])
        tasks.append(task(c, s, "orientation-ct",
            type="describe_finding",
            title="Which side is the patient's right on axial CT?",
            prompt="On this axial CT, where is the patient's right side?",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": "Soft tissue"},
            grading=choice(right_side, "left"),
            scoring="authoritative",
            hints=[{"level": 1, "text": "Find the liver: it lies on the patient's right."}],
            explanation="By convention axial CT is viewed from the patient's feet, and frontal radiographs as if you stand facing the patient: in both, the patient's right is on the viewer's left and anterior is at the top of an axial image. The letters at the edges of the viewer come from the image geometry recorded in the file.",
            bookAnchors=anchors("appD-o01"),
            objectiveIds=["appD-o01"],
            skillDimensions=["orientation"],
        ))

    def standard_frontal(s):
        po = str(s["acquisition"].get("PatientOrientation") or "")
        # Upright PA films (clearer anatomy for the hint) with the standard recorded orientation.
        return is_frontal_xr(s) and str(s["acquisition"].get("ViewPosition") or "").upper() == "PA" and po.replace("\\\\", "\\") == "L\\F"

    xr_side = [
        ("left", "On the left of the screen", "A frontal radiograph is displayed as if you face the patient, so the patient's right is on your left."),
        ("right", "On the right of the screen", "That is the patient's left — check the side marker and the heart, which points to the patient's left."),
        ("top", "At the top", "The top is the patient's head."),
        ("cannot", "It cannot be told", "The file records the orientation (the edge letters come from it), and the anatomy agrees: the heart apex points to the patient's left."),
    ]
    for s in pick(standard_frontal, 1):
        c = case_of(s["uid"])
        tasks.append(task(c, s, "orientation-xr",
            type="describe_finding",
            title="Which side is the patient's right on a frontal radiograph?",
            prompt="On this frontal chest radiograph, where is the patient's right side?",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": None},
            grading=choice(xr_side, "left"),
            scoring="authoritative",
            hints=[{"level": 1, "text": "The apex of the heart and the aortic knob are on the patient's left."}],
            explanation="Frontal radiographs are displayed as if the viewer faces the patient — whether the beam went PA or AP — so the patient's right is on the viewer's left. Always confirm with the side marker or the recorded orientation, and with the anatomy (heart apex and aortic knob to the left, liver to the right).",
            bookAnchors=anchors("appD-o01"),
            objectiveIds=["appD-o01"],
            skillDimensions=["orientation"],
        ))

    # ---------------------------------------------------------------- appD-o02: the words for bright and dark
    words_ct = [
        ("hyperdense", "Hyperdense (high attenuation)", "CT describes brightness as density or attenuation: bone is hyperdense."),
        ("hyperintense", "Hyperintense", "Intensity is the MRI word (signal intensity)."),
        ("hyperechoic", "Hyperechoic", "Echogenicity is the ultrasound word."),
        ("radiolucent", "Radiolucent", "Lucent means dark on a radiograph; bone is the opposite."),
    ]
    for s in pick(lambda s: is_ct(s) and standard_axial(s), 1):
        c = case_of(s["uid"])
        tasks.append(task(c, s, "words-ct",
            type="describe_finding",
            title="The CT word for bright",
            prompt="Bone is bright on this CT. Which description uses the right word for CT?",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": "Bone"},
            grading=choice(words_ct, "hyperdense"),
            scoring="authoritative",
            explanation="Each modality has its own words because each forms the image differently: radiographs speak of opacity and lucency, CT of density or attenuation (hyperdense, hypodense), MRI of signal intensity (hyperintense, hypointense) and ultrasound of echogenicity (hyperechoic, hypoechoic, anechoic).",
            bookAnchors=anchors("appD-o02"),
            objectiveIds=["appD-o02"],
            skillDimensions=["reporting"],
        ))

    words_mr = [
        ("hyperintense", "Hyperintense (high signal)", "MRI brightness is signal intensity: the lesion is hyperintense on diffusion-weighted imaging."),
        ("hyperdense", "Hyperdense", "Density is the CT word."),
        ("hyperechoic", "Hyperechoic", "Echogenicity is the ultrasound word."),
        ("radiopaque", "Radiopaque", "Opaque is the radiograph word."),
    ]
    for s in sorted(SERIES.values(), key=lambda x: x["uid"]):
        if s["modality"] != "MR" or not re.search(r"\bDWI\b", s["description"]) or not ok_subject(s):
            continue
        st = series_targets(s["uid"])
        les = next((t for k, t in st.items() if k.startswith("finding:") and t["provenance"] == "source_manual"), None)
        if not les:
            continue
        c = case_of(s["uid"])
        tasks.append(task(c, s, "words-mr",
            type="describe_finding",
            title="The MRI word for bright",
            prompt="Find the bright area on this diffusion-weighted MRI. Which description uses the right word for MRI?",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": None},
            targets=[target_ref(les, "Bright lesion")],
            grading=choice(words_mr, "hyperintense"),
            scoring="authoritative",
            explanation="MRI describes brightness as signal intensity: bright is hyperintense, dark hypointense. CT uses density (hyperdense), radiographs opacity and lucency, ultrasound echogenicity (hyperechoic). The outlined lesion is the source dataset's expert-approved mask.",
            bookAnchors=anchors("appD-o02"),
            objectiveIds=["appD-o02"],
            skillDimensions=["reporting"],
        ))
        break

    words_xr = [
        ("opaque", "Radiopaque (an opacity)", "On radiographs white is opaque (an opacity) and black lucent: bone is radiopaque."),
        ("lucent", "Radiolucent (a lucency)", "Lucent means dark, like air in the lungs."),
        ("hyperintense", "Hyperintense", "Intensity is the MRI word."),
        ("hyperechoic", "Hyperechoic", "Echogenicity is the ultrasound word."),
    ]
    for s in pick(lambda s: is_frontal_xr(s) and SERIES[s["uid"]]["_pack"] in ("chest-pairs", "expansion"), 1):
        c = case_of(s["uid"])
        tasks.append(task(c, s, "words-xr",
            type="describe_finding",
            title="The radiograph word for white",
            prompt="The ribs and clavicles are white on this radiograph. Which word fits a radiograph?",
            modes=["learn", "practice"],
            start={"seriesUid": s["uid"], "slice": "first", "windowPreset": None},
            grading=choice(words_xr, "opaque"),
            scoring="authoritative",
            explanation="Radiographs speak of opacity (white, radiopaque) and lucency (black, radiolucent). CT uses density, MRI signal intensity and ultrasound echogenicity.",
            bookAnchors=anchors("appD-o02"),
            objectiveIds=["appD-o02"],
            skillDimensions=["reporting"],
        ))

    # ---------------------------------------------------------------- ch20-o04: fat is bright on T1
    t1_fat = [
        ("fat", "Subcutaneous fat", "Fat has a short T1, so it is bright on T1-weighted images without fat suppression."),
        ("muscle", "Muscle", "Muscle is intermediate (grey) on T1."),
        ("fluid", "Fluid (edema or joint fluid)", "Fluid has a long T1 and is dark on T1; it is bright on T2."),
        ("cortex", "Cortical bone", "Cortical bone has almost no signal and is black on every sequence."),
    ]
    for s in sorted(SERIES.values(), key=lambda x: (x["subjectKey"], x["uid"])):
        d = s["description"]
        if s["modality"] != "MR" or s["_pack"] != "ct-mri-pairs" or not re.search(r"\bT1\b", d) or re.search(r"fat ?sat|\bFS\b|post|gad|\+C|contrast", d, re.I):
            continue
        if not ok_subject(s):
            continue
        c = case_of(s["uid"])
        tasks.append(task(c, s, "t1-fat",
            type="compare_appearances",
            title="What is bright on T1?",
            prompt="This is a T1-weighted MRI without fat suppression. Which tissue is the brightest?",
            modes=["learn", "practice", "assess"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": None},
            grading=choice(t1_fat, "fat"),
            scoring="authoritative",
            hints=[{"level": 1, "text": "Compare the layer just under the skin with the muscle and with any fluid."}],
            explanation="Only a few substances shorten T1 and look bright on T1-weighted images: fat, gadolinium contrast, some blood products (methemoglobin) and melanin. Fluid is dark on T1 and bright on T2 — the quickest way to tell the two sequences apart is to look at fat and fluid.",
            bookAnchors=anchors("ch20-o04"),
            objectiveIds=["ch20-o04"],
            skillDimensions=["interpretation"],
        ))

    # ---------------------------------------------------------------- ch20-o05: gadolinium enhancement (contrast-enhanced T1)
    enh = [
        ("bright", "Brighter than the brain — it enhances", "The mass takes up gadolinium, which shortens T1: it is bright on the contrast-enhanced T1."),
        ("dark", "Darker than the brain", "Enhancing tissue is bright, not dark, on post-contrast T1."),
        ("same", "The same as the brain", "Look again: the mass stands out against the brainstem and cerebellum."),
        ("none", "It cannot be seen", "The mass is clearly visible at the outlined level."),
    ]
    for s in sorted(SERIES.values(), key=lambda x: x["uid"]):
        if s["modality"] != "MR" or s["_pack"] != "ct-tumors" or not re.search(r"t1", s["description"], re.I) or not ok_subject(s):
            continue
        st = series_targets(s["uid"])
        vs = st.get("finding:vestibular_schwannoma")
        if not vs or vs["provenance"] != "source_manual":
            continue
        c = case_of(s["uid"])
        tasks.append(task(c, s, "enhancement",
            type="compare_appearances",
            title="Gadolinium enhancement",
            prompt="This T1-weighted image was taken after gadolinium. How does the mass at the cerebellopontine angle compare with the brain?",
            modes=["learn", "practice", "assess"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": None},
            targets=[target_ref(vs, "Enhancing mass")],
            grading=choice(enh, "bright"),
            scoring="authoritative",
            hints=[{"level": 1, "text": "Scroll to the level of the internal auditory canals."}],
            explanation="Gadolinium shortens T1, so tissue that takes it up turns bright on post-contrast T1 images. In the brain, enhancement means the blood-brain barrier is absent or broken — as in extra-axial tumors such as this vestibular schwannoma, which enhances strongly. There is no pre-contrast T1 in this study; the outline is the treating team's expert contour.",
            bookAnchors=anchors("ch20-o05"),
            objectiveIds=["ch20-o05"],
            skillDimensions=["interpretation"],
        ))

    # ---------------------------------------------------------------- ch13-o02: oral contrast in bowel loops (header + checked on the images)
    for s in sorted(SERIES.values(), key=lambda x: x["uid"]):
        if s["uid"] not in ORAL_CONTRAST_VERIFIED or not ok_subject(s):
            continue
        c = case_of(s["uid"])
        oral = [
            ("oral", "Positive oral contrast in the bowel lumen", "The study was done with oral contrast (recorded in the image header), which fills the stomach and bowel and turns their lumen white."),
            ("wall", "Calcification of the bowel wall", "The bright material fills the lumen of the loops, not a thin rim in the wall."),
            ("blood", "Fresh blood in the bowel", "Blood is only slightly denser than soft tissue — far less bright than oral contrast."),
            ("clips", "Surgical clips", "Clips are small and very dense with streak artifact, not loop-shaped."),
        ]
        tasks.append(task(c, s, "oral-contrast",
            type="describe_finding",
            title="Oral contrast in bowel loops",
            prompt="Scroll through the abdomen. What is the white material filling many of the bowel loops?",
            modes=["learn", "practice", "assess"],
            start={"seriesUid": s["uid"], "slice": "middle", "windowPreset": "Soft tissue"},
            grading=choice(oral, "oral"),
            scoring="authoritative",
            explanation="Positive oral contrast makes the bowel lumen white, so bowel loops can be told apart from masses, abscesses and lymph nodes, and leaks can be seen. Follow the opacified loops from the stomach to the colon to see how far the contrast has travelled.",
            bookAnchors=anchors("ch13-o02"),
            objectiveIds=["ch13-o02"],
            skillDimensions=["interpretation"],
        ))
    return tasks


def main():
    tasks = build()
    existing_ids = {t["id"] for t in EXISTING}
    tasks = [t for t in tasks if t["id"] not in existing_ids]
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pack = {
        "schemaVersion": 1,
        "packId": PACK_ID,
        "version": "0.1.0",
        "title": "Book practice: tasks for Learning Radiology objectives on installed cases",
        "description": "Practice tasks tied to Learning Radiology (5th ed.) objectives, written on cases of the other packs. Contains no images or targets of its own: every task points at a case, series and reference target of another pack. Anatomy outlines used here are AI drafts by Horalix (self-review until reviewed); findings are the source datasets' expert labels; orientation, sequence and contrast answers come from the image headers.",
        "generatedAt": now,
        "generator": "scripts/lessons/book_practice.py",
        "sources": [],
        "subjects": [],
        "studies": [],
        "series": [],
        "spatialLinks": [],
        "referenceTargets": [],
    }
    lessons = {"schemaVersion": 1, "packId": PACK_ID, "version": "0.1.0", "cases": [], "tasks": tasks}
    (OUT / "pack.json").write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT / "lessons.json").write_text(json.dumps(lessons, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.iterdir())
    # Re-read the index right before writing; only append this pack's entry (another tool may append too).
    idx_path = PACKS / "index.json"
    raw = idx_path.read_text(encoding="utf-8")
    idx = json.loads(raw)
    entry = {
        "id": PACK_ID,
        "title": "Book practice: tasks for Learning Radiology objectives",
        "manifest": f"{PACK_ID}/pack.json",
        "lessons": f"{PACK_ID}/lessons.json",
        "bytes": size,
        "distribution": "repo",
        "note": f"{len(tasks)} practice tasks on installed cases; no images. Rebuild with scripts/lessons/book_practice.py.",
    }
    ids = [e["id"] for e in idx["packs"]]
    if PACK_ID in ids:
        idx["packs"][ids.index(PACK_ID)] = entry
    else:
        idx["packs"].append(entry)
    idx_path.write_text(json.dumps(idx, indent=1, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""), encoding="utf-8")
    by_obj = {}
    for t in tasks:
        for o in t["objectiveIds"]:
            by_obj[o] = by_obj.get(o, 0) + 1
    print(f"{len(tasks)} tasks; objectives: {by_obj}")


if __name__ == "__main__":
    main()
