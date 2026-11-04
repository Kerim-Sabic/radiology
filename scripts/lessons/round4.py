"""Lessons for the round-4 packs: cxr-findings-2 (NIH radiologist boxes), us-breast-2 (Breast-Lesions-USG), stroke-mri-2
(ISLES 2022), peds-wrist-2 (GRAZPEDWRI-DX) and mammo-cbis-2 (CBIS-DDSM).

  python scripts/lessons/round4.py

Same task designs as scripts/lessons/conditions.py (whose teaching notes and book anchors are reused); every answer is read
from the source's expert annotation or clinical data as stored in the built pack.json, never typed by hand. Round 1-3
lessons are not touched. Neutral titles follow the "Patient <code> · <modality and region>" convention with codes from
EA upwards (codes before EA belong to the earlier packs); they never name the dataset, an image number or the finding.
"""
from __future__ import annotations

import json
import re
import sys
from itertools import product
from pathlib import Path
from string import ascii_uppercase

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS, Pack, hint, write_lessons  # noqa: E402
from conditions import (BREAST_US_NOTES, CXR, MAMMO_NOTES, NIH_LABEL_TO_OPTION, OPTIONS, PEDS_FX_NOTES, STROKE_NOTES,  # noqa: E402
                        anchors)

R4_ORDER = ["us-breast-2", "stroke-mri-2", "cxr-findings-2", "peds-wrist-2", "mammo-cbis-2"]


def _codes():
    for a, b in product(ascii_uppercase[4:], ascii_uppercase):  # EA, EB, ... EZ, FA, ...
        yield a + b


CODES = _codes()


def _poly_area(p) -> float:
    return 0.5 * abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p))))


def _geom(pack: Pack, t: dict) -> dict:
    return json.loads((PACKS / pack.id / t["geometryFile"]).read_text(encoding="utf-8"))


# ------------------------------------------------------------------ chest radiographs (NIH radiologist boxes)
# Images with more than one box where the case's finding is not the first box in the dataset's list.
CXR_MAIN = {"00013391_005": "finding:pneumonia", "00015090_006": "finding:pneumonia"}
CXR_NAME = {**{k: v["name"] for k, v in CXR.items()}, "finding:infiltrate": "Lung opacity (dataset label: infiltration)"}
# How a finding is named in the reference summary, after "around" (the dataset's "infiltration" is not a finding a reader names).
CXR_AROUND = {**{k: v["name"].lower() for k, v in CXR.items()}, "finding:infiltrate": "a lung opacity labelled infiltration"}
# How the radiologist's box is named in the "name the finding" explanation; the others read "a <name>. <why>".
CXR_BOXED = {"finding:atelectasis": "an area of atelectasis", "finding:cardiomegaly": "an enlarged cardiac silhouette (cardiomegaly)",
             "finding:lung_nodule": "a lung nodule", "finding:pneumonia": "an area of pneumonia"}


def cxr_lessons(pack_id: str = "cxr-findings-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        tgts = [t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"]]
        stem_ = tgts[0]["id"][len("nih-"):].rsplit("_", 1)[0]  # e.g. 00003400_003
        main_cls = CXR_MAIN.get(stem_) or next(t["classId"] for t in tgts if t["classId"] != "finding:infiltrate")
        main = next(t for t in tgts if t["classId"] == main_cls)
        info = CXR[main["classId"]]
        nlp = main["unassessedNote"].rsplit(": ", 1)[-1].rstrip(".")
        cid = f"cxr-{stem_.replace('_', '-')}"
        anc = anchors(*info["objectives"])
        code = next(CODES)
        others = [t for t in tgts if t is not main]
        cases.append({
            "id": cid, "packId": pack.id,
            "neutralTitle": f"Patient {code} · Chest radiograph PA",
            "learnTitle": f"{info['name']} on a PA chest radiograph (radiologist box)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["chest"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": info["objectives"], "bookAnchors": anc,
            "referenceSummary": (f"One box drawn by a board-certified radiologist around the {info['name'].lower()}"
                                 + (f", and {len(others)} more around " + ", ".join(CXR_AROUND[t['classId']] for t in others) if others else "")
                                 + f" (NIH ChestX-ray14). The labels mined from this film's report are: {nlp} (about 90% accurate, per "
                                 "the dataset authors). Nothing else on the film is outlined."),
            "learnNotes": info["notes"],
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": f"Find the {info['name'].lower()}",
            "prompt": "Read this frontal chest radiograph systematically. Box the main abnormality (or mark it with a point), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": CXR_NAME[t["classId"]], "required": t is main} for t in tgts],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                        "inPlaneToleranceMm": 15, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, info["hint"]), hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": (info["notes"] + " The reference is the radiologist's box, a rectangle around the finding rather than an outline; "
                            "this image has no pixel spacing, so the tolerance is counted in pixels."
                            + (" The other boxes on this film are extra findings: marking them is not counted against you." if others else "")),
            "bookAnchors": anc, "objectiveIds": info["objectives"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        # "Name the main finding" only where no other offered answer is also among the report labels.
        rest = {NIH_LABEL_TO_OPTION[x] for x in nlp.split("|") if x in NIH_LABEL_TO_OPTION} - {info["option"]}
        if not rest:
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
                "explanation": ((f"The radiologist boxed {CXR_BOXED[main_cls]}: {info['why'][0].lower() + info['why'][1:]}" if main_cls in CXR_BOXED
                                 else f"The radiologist boxed a {info['name'].lower()}. {info['why']}") + " The answer comes from the radiologist's box and "
                                "the report labels for this film; other findings may also be present."),
                "bookAnchors": anc, "objectiveIds": info["objectives"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ breast ultrasound (Breast-Lesions-USG)
def _note_fields(note: str) -> dict:
    """The radiologist's descriptors and the outcome as stored in the target note by build_r4.py."""
    out = {}
    for part in note.rstrip(".").split("; "):
        for key in ("BI-RADS", "shape", "margin", "echogenicity", "posterior features", "halo", "calcifications", "signs", "classification"):
            if part.startswith(key + " "):
                out[key] = part[len(key) + 1:]
        if part.startswith("confirmed by "):
            out["verification"] = part
        for key in ("interpretation", "diagnosis"):
            if part.startswith(key + ": "):
                out[key] = part[len(key) + 2:]
    return out


def _dx(s: str) -> str:
    """'Invasive carcinoma of no special type (NST)&Ductal carcinoma in situ (DCIS)' -> 'invasive carcinoma of no special type
    (NST) with ductal carcinoma in situ (DCIS)' (the dataset joins the pathology findings of one lesion with '&')."""
    parts = [p.strip() for p in s.split("&")]
    parts = [p[0].lower() + p[1:] if not p[:2].isupper() else p for p in parts]
    return parts[0] if len(parts) == 1 else parts[0] + " with " + " and ".join(parts[1:])


def _amp(s: str) -> str:
    parts = [p.strip() for p in s.split("&")]
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


ECHO = [("anechoic", "Anechoic (no internal echoes)"), ("hypoechoic", "Hypoechoic (darker than fat)"),
        ("isoechoic", "Isoechoic (like fat)"), ("hyperechoic", "Hyperechoic (brighter than fat)"),
        ("heterogeneous", "Heterogeneous echo pattern"), ("complex cystic/solid", "Complex cystic and solid")]
POST = [("enhancement", "Posterior acoustic enhancement"), ("shadowing", "Posterior acoustic shadowing"),
        ("combined", "Combined enhancement and shadowing"), ("no", "No posterior features")]


def us_lessons(pack_id: str = "us-breast-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        sid = subj["sourceSubjectId"]
        d = _note_fields(t["provenanceDetail"]["note"])
        biopsy = d["verification"] == "confirmed by biopsy"
        malignant = d["classification"] == "malignant"
        assert d["classification"] in ("benign", "malignant") and d["verification"] in ("confirmed by biopsy", "confirmed by follow-up care"), sid
        what = _dx(d["diagnosis"]) if biopsy else "benign lesion"
        cid = f"us-breast-{sid}"
        anc = anchors("ch29-o06", "ch18-o01")
        g = _geom(pack, t)
        area = sum(_poly_area(p) for p in g["planes"][0]["polygons"]) / (se["geometry"]["rows"] * se["geometry"]["columns"])
        age = subj["ageAtFirstStudy"]
        ctx = []
        if age:
            ctx.append(f"Patient aged {int(age[:3])} years.")
        if "palpable" in d.get("signs", ""):
            ctx.append("Palpable lump.")
        code = next(CODES)
        margin_txt = d["margin"].replace("not circumscribed - ", "not circumscribed (").replace("&", ", ") + (")" if d["margin"].startswith("not") else "")
        post_desc = {"no": "no posterior features", "combined": "combined posterior features (enhancement and shadowing)"}.get(
            d["posterior features"], f"posterior features {d['posterior features']}")
        desc = (f"shape {d['shape']}, margin {margin_txt}, echo pattern {d['echogenicity']}, {post_desc}, "
                f"BI-RADS {d['BI-RADS']}")
        outcome = (f"Biopsy: {what} ({d['classification']})" if biopsy else
                   f"Benign: confirmed on follow-up, without biopsy (the radiologist's impression: {_amp(d['interpretation']).lower()})")
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Breast ultrasound",
            "learnTitle": (f"{what[0].upper() + what[1:]} on breast ultrasound (biopsy-proven; radiologist outline)" if biopsy
                           else "Benign breast lesion on ultrasound (confirmed on follow-up; radiologist outline)"),
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"], "region": ["breast"],
            "clinicalContext": " ".join(ctx) or None,
            "contextSource": "Age and clinical signs from the dataset's clinical data." if ctx else None,
            "difficulty": "subtle" if area < 0.01 else "typical", "objectiveIds": ["ch29-o06", "ch18-o01"], "bookAnchors": anc,
            "referenceSummary": (f"The lesion is outlined freehand by a radiologist experienced in breast ultrasound, who also recorded its "
                                 f"BI-RADS descriptors (Breast-Lesions-USG): {desc}. {outcome}. The image is the dataset's cropped B-mode "
                                 "frame with its true pixel size; no Doppler, no orientation."),
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
        circ = d["margin"] == "circumscribed"
        assert d["shape"] in ("oval", "round", "irregular") and (circ or d["margin"].startswith("not circumscribed")), (sid, d)
        tasks.append({
            "id": f"{cid}:shape", "caseId": cid, "type": "describe_finding", "title": "Describe shape and margin",
            "prompt": "Describe the lesion with the BI-RADS ultrasound terms: choose its shape and whether its margin is circumscribed (two answers).",
            "modes": ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": True, "options": [
                {"id": "oval", "text": "Oval (elliptical, may have up to three gentle lobulations)", "correct": d["shape"] == "oval",
                 "why": "The radiologist's shape for this lesion." if d["shape"] == "oval" else "Not the radiologist's shape for this lesion."},
                {"id": "round", "text": "Round", "correct": d["shape"] == "round",
                 "why": "The radiologist's shape for this lesion." if d["shape"] == "round" else "Not the radiologist's shape for this lesion."},
                {"id": "irregular", "text": "Irregular (neither oval nor round)", "correct": d["shape"] == "irregular",
                 "why": "The radiologist's shape for this lesion." if d["shape"] == "irregular" else "Not the radiologist's shape for this lesion."},
                {"id": "circ", "text": "Circumscribed margin (sharp all the way round)", "correct": circ,
                 "why": "The radiologist called the margin circumscribed." if circ else f"The radiologist called the margin {margin_txt}."},
                {"id": "notcirc", "text": "Not circumscribed (indistinct, angular, microlobulated or spiculated)", "correct": not circ,
                 "why": f"The radiologist called the margin {margin_txt}." if not circ else "The radiologist called the margin circumscribed."}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Follow the edge all the way round: any part that is blurred, angular, finely lobulated or spiky makes the margin 'not circumscribed'.")],
            "explanation": (f"The radiologist described this lesion as {d['shape']} with "
                            + ("a circumscribed margin" if circ else f"a margin that is {margin_txt}") + ". An oval, circumscribed mass "
                            "parallel to the skin favors a benign lesion; an irregular shape or a margin that is not circumscribed is a "
                            "suspicious feature. " + outcome + "."),
            "bookAnchors": anc, "objectiveIds": ["ch29-o06"], "skillDimensions": ["interpretation", "reporting"], "allowUncertain": True,
        })
        echo, post = d["echogenicity"], d["posterior features"]
        opts = [(f"e-{i}", text, echo == key) for i, (key, text) in enumerate(ECHO)] + [(f"p-{i}", text, post == key) for i, (key, text) in enumerate(POST)]
        assert sum(c for _, _, c in opts) == 2, (sid, echo, post)
        tasks.append({
            "id": f"{cid}:echo", "caseId": cid, "type": "describe_finding", "title": "Describe the echoes",
            "prompt": "Describe the lesion in ultrasound terms: choose its echo pattern and what happens to the sound behind it (two answers).",
            "modes": ["learn", "practice"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": True, "options": [
                {"id": oid, "text": text, "correct": ok,
                 "why": ("The radiologist's descriptor for this lesion." if ok else "Not the radiologist's descriptor for this lesion.")}
                for oid, text, ok in opts]},
            "scoring": "authoritative",
            "hints": [hint(1, "Echo pattern is judged against the subcutaneous fat; posterior features are judged in the tissue directly deep to the lesion.")],
            "explanation": (f"The radiologist described this lesion as {echo.replace('cystic/solid', 'cystic and solid')} with "
                            + {"no": "no posterior features", "combined": "combined posterior features (enhancement and shadowing)"}.get(post, f"posterior features: {post}")
                            + ". Anechoic means no echoes "
                            "(fluid). Posterior acoustic enhancement is brighter tissue behind something that lets sound through easily, "
                            "typical of fluid; posterior shadowing is a dark band behind something that absorbs or reflects the sound, "
                            "such as a dense fibrotic cancer, calcification or bone."),
            "bookAnchors": anc, "objectiveIds": ["ch18-o01", "ch29-o06"], "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
        # Not for Assess or the exams where the image cannot settle the outcome: BI-RADS 4B (10-50% chance of cancer by
        # definition), or an outcome that contradicts the radiologist's own category (4A or lower but malignant, 4C/5 but benign).
        birads = d["BI-RADS"].lower()
        b4 = birads == "4b"
        contradicts = (malignant and birads in ("2", "3", "4a")) or (not malignant and birads in ("4c", "5"))
        tasks.append({
            "id": f"{cid}:outcome", "caseId": cid, "type": "differential", "title": "Benign or malignant?",
            "prompt": ("Weigh the lesion's shape, margin, orientation, echoes and posterior features. This lesion was later "
                       "either biopsied or followed up. Was it benign or malignant?"),
            "modes": ["learn", "practice"] if b4 or contradicts else ["learn", "practice", "assess"], "seriesUids": [se["uid"]],
            "start": {"seriesUid": se["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "benign", "text": "Benign", "correct": not malignant,
                 "why": ("Benign on " + ("biopsy" if biopsy else "follow-up") + ".") if not malignant else "Biopsy showed a malignant lesion."},
                {"id": "malignant", "text": "Malignant", "correct": malignant,
                 "why": "Biopsy showed a malignant lesion." if malignant else ("Benign on " + ("biopsy" if biopsy else "follow-up") + ".")}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Suspicious features: irregular shape, a margin that is not circumscribed, taller-than-wide orientation, posterior shadowing. None of them proves cancer.")],
            "explanation": (f"{outcome}. The radiologist's descriptors were: {desc}. Imaging grades the suspicion (BI-RADS); only the biopsy, "
                            "or stability over time for a probably benign lesion, settles it, so expect benign lesions that look worrying "
                            "and the occasional cancer that looks bland."
                            + (" This lesion was given BI-RADS 4B (moderate suspicion: roughly 10 to 50% chance of cancer), so the outcome "
                               "cannot be told from the image alone; that is why this question is for learning and practice, not for Assess "
                               "or the exams." if b4 else "")),
            "bookAnchors": anc, "objectiveIds": ["ch29-o06"], "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ stroke MRI (ISLES 2022)
def _stroke_fields(note: str) -> dict:
    m = re.search(r"mask volume ([\d.]+) ml; (\d+) connected.*?median ADC in the mask (\d+) vs (\d+) x10\^-6 mm2/s .*?\(low ADC (yes|no);.*?side (left|right|not one-sided)", note)
    assert m, note
    return {"vol": float(m.group(1)), "parts": int(m.group(2)), "adcLesion": int(m.group(3)), "adcBrain": int(m.group(4)),
            "low": m.group(5) == "yes", "side": m.group(6)}


def stroke_lessons(pack_id: str = "stroke-mri-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    anc = anchors("ch26-o08")
    for subj in pack.manifest["subjects"]:
        sers = [s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]]
        dwi = next(s for s in sers if s["description"].startswith("DWI"))
        adc = next(s for s in sers if s["description"].startswith("ADC"))
        tdwi = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == dwi["uid"])
        tadc = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == adc["uid"])
        f = _stroke_fields(tdwi["provenanceDetail"]["note"])
        num = subj["sourceSubjectId"].split("strokecase")[1]
        cid = f"mr-diffusion-{num}"
        code = next(CODES)
        who = {"M": "Man", "F": "Woman"}.get(subj.get("sex") or "", "Adult")
        age = subj.get("ageAtFirstStudy")
        ctx = f"{who}{f' aged {int(age[:3])}' if age and age[:3].isdigit() else ''} with sudden neurological symptoms."
        size = "large" if f["vol"] >= 50 else "moderate" if f["vol"] >= 10 else "small"
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · MRI brain, diffusion",
            "learnTitle": f"Ischemic stroke on diffusion MRI, {size} lesion (expert-approved lesion mask)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": dwi["uid"], "region": ["head"],
            "clinicalContext": ctx,
            "contextSource": ("Dataset description (ISLES 2022: MRI of acute to subacute ischemic stroke)"
                              + ("; age and sex from the dataset's JSON sidecar." if (subj.get("sex") or age) else ".")),
            "difficulty": "subtle" if f["vol"] < 5 else "typical", "objectiveIds": ["ch26-o08"], "bookAnchors": anc,
            "referenceSummary": (f"The ischemic lesion (about {f['vol']:.0f} ml in the mask, {f['parts']} separate part{'s' if f['parts'] > 1 else ''}) "
                                 "was outlined with a model's help, corrected by trained annotators and a neuroradiologist in training, and "
                                 "approved by an attending neuroradiologist (ISLES 2022). The images are skull-stripped and resliced to 2 mm "
                                 "by the dataset authors; time since onset is not given."),
            "learnNotes": STROKE_NOTES,
        })
        ratio = float(f["adcLesion"]) / float(f["adcBrain"])
        high = not f["low"] and ratio > 1.1  # T2 shine-through
        same = not f["low"] and not high and ratio >= 0.97
        extra = ("" if f["low"] else
                 (f" In this patient the ADC inside the outline is higher than in the rest of the brain (median {f['adcLesion']} against "
                  f"{f['adcBrain']} x10^-6 mm2/s): the DWI brightness here is T2 shine-through, not restricted diffusion, which fits an "
                  "infarct that is no longer acute (the ADC rises again from about one to two weeks after onset); the time since onset is "
                  "not given. Find the lesion on the DWI, and check the ADC before calling a DWI lesion acute.") if high else
                 (f" In this patient the median ADC inside the outline ({f['adcLesion']}) is about the same as in the rest of the brain "
                  f"({f['adcBrain']} x10^-6 mm2/s), so much of the DWI brightness is not restricted diffusion. Find the lesion on the DWI; "
                  "the time since onset is not given.") if same else
                 (f" In this patient the median ADC inside the outline ({f['adcLesion']}) is not clearly below the rest of the brain "
                  f"({f['adcBrain']} x10^-6 mm2/s), so rely on the DWI. Partial volume in a small or thin lesion on these 2 mm images, or a "
                  "later stage when the ADC has begun to return towards normal (pseudonormalisation, from about one week after onset), can "
                  "explain this; the time since onset is not given."))
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": "Find the restricted diffusion" if f["low"] else "Find the bright lesion on DWI",
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
            "explanation": STROKE_NOTES + extra,
            "bookAnchors": anc, "objectiveIds": ["ch26-o08"], "skillDimensions": ["finding_localization", "interpretation"],
            "allowUncertain": True,
        })
        if f["low"]:
            tasks.append({
                "id": f"{cid}:adc", "caseId": cid, "type": "differential", "title": "Is it true restriction?",
                "prompt": "Find the bright lesion on DWI, then look at the same place on the ADC map. How does it look on ADC?",
                "modes": ["learn", "practice"], "seriesUids": [dwi["uid"], adc["uid"]],
                "start": {"seriesUid": adc["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "dark", "text": "Dark (low ADC): true restricted diffusion", "correct": True,
                     "why": f"The median ADC inside the outline is {f['adcLesion']} against {f['adcBrain']} x10^-6 mm2/s in the rest of the brain."},
                    {"id": "bright", "text": "Bright (high ADC)", "correct": False,
                     "why": "A bright ADC means water moves more freely (e.g. CSF or old tissue loss), the opposite of restriction."},
                    {"id": "same", "text": "The same as normal brain", "correct": False,
                     "why": "Then the DWI brightness would be T2 shine-through rather than restriction."}]},
                "scoring": "authoritative",
                "hints": [hint(1, "Use the linked views: double-click the lesion on DWI and the ADC view goes to the same place.")],
                "explanation": (f"The ADC map is dark where the outline is: median {f['adcLesion']} against {f['adcBrain']} x10^-6 mm2/s in the "
                                "rest of the brain (measured inside the expert mask). " + STROKE_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch26-o08"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        if f["side"] in ("left", "right"):
            tasks.append({
                "id": f"{cid}:side", "caseId": cid, "type": "describe_finding", "title": "Which side of the brain?",
                "prompt": "Find the lesion and use the orientation letters on the image. Which side of the patient's brain is it in?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [dwi["uid"], adc["uid"]],
                "start": {"seriesUid": dwi["uid"], "slice": "middle", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": "right", "text": "Right hemisphere", "correct": f["side"] == "right",
                     "why": "The whole outlined lesion lies in the patient's right half of the brain." if f["side"] == "right" else "The outlined lesion lies in the patient's left half."},
                    {"id": "left", "text": "Left hemisphere", "correct": f["side"] == "left",
                     "why": "The whole outlined lesion lies in the patient's left half of the brain." if f["side"] == "left" else "The outlined lesion lies in the patient's right half."},
                    {"id": "both", "text": "Both sides", "correct": False,
                     "why": f"{_share_text(tdwi)} of the outline is on the patient's {f['side']} side of the midline."}]},
                "scoring": "authoritative",
                "hints": [hint(1, "Axial images are shown as if you face the patient: the patient's right is on your left. Check the R and L letters.")],
                "explanation": (f"{_share_text(tdwi)} of the expert mask lies on the patient's {f['side']} side of the brain's midline (median about "
                                f"{_side_mm(tdwi):.0f} mm from it). Side matters clinically: a stroke in one cerebral hemisphere causes "
                                "weakness, numbness or visual-field loss on the opposite side of the body, and a left hemisphere stroke in a "
                                "right-handed patient often affects language."),
                "bookAnchors": anc, "objectiveIds": ["ch26-o08"], "skillDimensions": ["orientation", "finding_localization"], "allowUncertain": True,
            })
    write_lessons(pack, "1.0.0", cases, tasks)


def _share_text(t: dict) -> str:
    m = re.search(r"left of the local brain midline: (\d+) of (\d+)", t["provenanceDetail"]["note"])
    nleft, n = int(m.group(1)), int(m.group(2))
    share = max(nleft, n - nleft) / n
    return "All" if nleft in (0, n) else f"{int(share * 1000) / 10:.1f}%"  # rounded down: never shows 100% for a part


def _side_mm(t: dict) -> float:
    return float(re.search(r"median ([\d.]+) mm from it", t["provenanceDetail"]["note"]).group(1))


# ------------------------------------------------------------------ children's wrist fractures (GRAZPEDWRI-DX)
FX_TYPE = {
    "finding:physeal_fracture": ("sh2", "Salter-Harris II fracture of the distal radius", "AO/OTA E/2: a Salter-Harris II fracture."),
    "finding:incomplete_fracture": ("incomplete", "Incomplete (torus/buckle or greenstick) fracture of the distal radius",
                                    "AO/OTA M/2: an incomplete metaphyseal fracture (torus/buckle or greenstick; the code does not separate them)."),
    "finding:complete_fracture": ("complete", "Complete metaphyseal fracture of the distal radius",
                                  "AO/OTA M/3: a complete metaphyseal fracture, through both cortices, with the growth plate spared."),
}


def wrist_lessons(pack_id: str = "peds-wrist-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        sers = sorted((s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]), key=lambda s: s["number"])
        tgts = [t for s in sers for t in pack.manifest["referenceTargets"] if t["seriesUid"] == s["uid"]]
        cls = {t["classId"] for t in tgts}
        assert len(cls) == 1 and len(tgts) == 2, subj["key"]
        key, title, coded = FX_TYPE[cls.pop()]
        objs = ["ch27-o07", "ch23-o01"] if key == "sh2" else ["ch23-o01"]
        anc = anchors(*objs)
        side = "left" if sers[0]["acquisition"]["ImageLaterality"] == "L" else "right"
        age = int(subj["ageAtFirstStudy"][:3])
        pid = int(subj["sourceSubjectId"])
        cid = f"xr-wrist-child-{pid:04d}"
        code = next(CODES)
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Wrist radiographs, child",
            "learnTitle": f"{title} (radiologist box)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": sers[0]["uid"], "region": ["extremity"],
            "clinicalContext": f"{'Girl' if subj['sex'] == 'F' else 'Boy'}, {age} years, {side} wrist injury.",
            "contextSource": "Age, sex and side from the dataset (GRAZPEDWRI-DX dataset.csv); trauma from the dataset description.",
            "difficulty": "subtle" if key == "incomplete" else "typical", "objectiveIds": objs, "bookAnchors": anc,
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
            "hints": [hint(1, "Follow both cortices of the radius and the ulna on each view: look for a bulge, a kink, a step or a widened growth plate."),
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
                {"id": "sh2", "text": "Salter-Harris II: along the growth plate and out through the metaphysis", "correct": key == "sh2",
                 "why": "Type II leaves a corner fragment of metaphysis attached to the displaced epiphysis."},
                {"id": "incomplete", "text": "Incomplete metaphyseal fracture: torus (buckle) or greenstick", "correct": key == "incomplete",
                 "why": "A bulge or kink of the cortex, or a break of one cortex only, in the metaphysis, with the growth plate spared."},
                {"id": "complete", "text": "Complete metaphyseal fracture through both cortices", "correct": key == "complete",
                 "why": "A complete fracture crosses the whole bone, with a line through both cortices."}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Find the growth plate first, then decide whether the fracture line reaches it.")],
            "explanation": "The dataset codes this fracture as " + coded + " " + PEDS_FX_NOTES,
            "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ mammography (CBIS-DDSM)
CALC_FORM = [("PLEOMORPHIC", "Fine pleomorphic (varying shapes and sizes)", "suspicious"),
             ("FINE_LINEAR_BRANCHING", "Fine linear or fine linear branching", "suspicious"),
             ("AMORPHOUS", "Amorphous (too small and hazy to give a shape)", "suspicious"),
             ("PUNCTATE", "Punctate (tiny round dots)", "benign (round, smaller than 0.5 mm)"),
             ("LUCENT_CENTER", "Lucent-centered (rim with a dark centre)", "benign"),
             ("COARSE", "Coarse or 'popcorn'", "benign"),
             ("VASCULAR", "Vascular (parallel tracks along a vessel)", "benign")]


_bwc_why = "CBIS-DDSM records this finding as benign without callback: read as benign and not recalled, so it was not biopsied."


def mammo_lessons(pack_id: str = "mammo-cbis-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    for subj in pack.manifest["subjects"]:
        sers = sorted((s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"]), key=lambda s: s["number"])
        tgts = [t for s in sers for t in pack.manifest["referenceTargets"] if t["seriesUid"] == s["uid"]]
        pid = subj["sourceSubjectId"]
        calc = tgts[0]["classId"] == "finding:breast_calcifications"
        objs = ["ch29-o05", "ch29-o01"] if calc else ["ch29-o03", "ch29-o01"]
        anc = anchors(*objs)
        sides = sorted({s["acquisition"]["ImageLaterality"] for s in sers})
        assert len(sides) == 1
        side = "left" if sides == ["L"] else "right"
        what = tgts[0]["label"].split(": ", 1)[1]
        notes = tgts[0]["provenanceDetail"]["note"]
        path = "malignant" if "MALIGNANT" in notes else "benign"
        bwc = "BENIGN_WITHOUT_CALLBACK" in notes  # read as benign and not recalled: no biopsy, no pathology
        no_dist = "distribution not given" in what
        birads = re.search(r"BI-RADS assessment (\d)", notes).group(1)
        cid = f"mg-{pid.lower().replace('_', '')}"
        cc = next(s for s in sers if s["acquisition"]["ViewPosition"] == "CC")
        code = next(CODES)
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Mammogram, {side} breast, CC and MLO",
            "learnTitle": (f"{'Calcifications' if calc else 'Mass'} on CC and MLO mammograms ("
                           + ("benign without callback, not biopsied" if bwc else f"{path} at pathology") + "; "
                           + f"{'DDSM region outline' if calc else 'mass outline'})"),
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": cc["uid"], "region": ["breast"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": objs, "bookAnchors": anc,
            "referenceSummary": (f"{'Calcifications' if calc else 'Mass'} outlined on both views ({what}); BI-RADS assessment {birads} and "
                                 + ("outcome" if bwc else "pathology") + " as given in the CBIS-DDSM case description. "
                                 + ("Calcification outlines are the original DDSM regions, drawn around the group, not around each particle. "
                                    if calc else "Mass outlines were refined in CBIS-DDSM from the original DDSM contours. ")
                                 + "Digitised screen-film mammograms, downsampled 2x2; no pixel spacing, so distances are not measurable."),
            "learnNotes": MAMMO_NOTES,
        })
        tasks.append({
            "id": f"{cid}:locate", "caseId": cid, "type": "locate_finding", "title": f"Find the {'calcifications' if calc else 'mass'} on both views",
            "prompt": "Read both views of this breast. Mark the abnormality on each view where you see it (point, box or outline), or state that you find none.",
            "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
            "start": {"seriesUid": cc["uid"], "slice": "first", "windowPreset": None},
            "targets": [{"targetId": t["id"], "name": "Breast calcifications" if calc else "Breast mass", "required": True} for t in tgts],
            "grading": {"kind": "findings", "matchRule": "center_in_target", "iouThreshold": 0.3, "slabToleranceMm": 1,
                        "inPlaneToleranceMm": 30, "allowNoFinding": True},
            "scoring": "authoritative",
            "hints": [hint(1, "Read the CC and the MLO quadrant by quadrant; a real finding is usually seen on both views."),
                      hint(2, "Found it on one view? On the other view it lies at about the same distance from the nipple."),
                      hint(5, "Reveal the reference answer.", {"type": "reveal"})],
            "explanation": MAMMO_NOTES + " These films have no pixel spacing, so the tolerance is counted in pixels.",
            "bookAnchors": anc, "objectiveIds": objs, "skillDimensions": ["finding_localization", "interpretation"], "allowUncertain": True,
        })
        if calc:
            form = next(k for k, _, _ in CALC_FORM if what.upper().replace(" ", "_").startswith(k))
            tasks.append({
                "id": f"{cid}:form", "caseId": cid, "type": "describe_finding", "title": "Describe the calcifications",
                "prompt": "Zoom in on the calcifications on both views. Which form describes them best?",
                "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
                "start": {"seriesUid": cc["uid"], "slice": "first", "windowPreset": None}, "targets": [],
                "grading": {"kind": "choice", "multiple": False, "options": [
                    {"id": k.lower(), "text": text, "correct": k == form, "why": f"Typically {kind}."} for k, text, kind in CALC_FORM]},
                "scoring": "authoritative",
                "hints": [hint(1, "Use the magnifier: look at the size, shape and uniformity of the individual particles, not the outline of the group.")],
                "explanation": (f"The case description gives the calcification type as {what.split(',', 1)[0]} ("
                                + ("benign without callback, i.e. read as benign and not recalled for biopsy; " if bwc else f"{path} at pathology, ")
                                + f"BI-RADS assessment {birads}). " + MAMMO_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch29-o05"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        else:
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
                        ("circumscribed", "Sharp, well-defined edge over at least 75% of the outline (the rest may be obscured): favors a benign lesion."),
                        ("obscured", "Edge hidden by overlapping normal tissue."),
                        ("microlobulated", "Small undulations of the edge."),
                        ("indistinct", "Poorly defined edge, suggesting infiltration."),
                        ("spiculated", "Lines radiating from the edge: the most suspicious margin."))]},
                "scoring": "authoritative",
                "hints": [hint(1, "Follow the edge of the mass all the way round; spicules are thin lines that radiate out from it.")],
                "explanation": (f"The case description gives shape {shape} and margin {margin}; pathology {path} (BI-RADS assessment "
                                f"{birads}). " + MAMMO_NOTES),
                "bookAnchors": anc, "objectiveIds": ["ch29-o03"], "skillDimensions": ["interpretation"], "allowUncertain": True,
            })
        tasks.append({
            "id": f"{cid}:pathology", "caseId": cid, "type": "differential", "title": "Benign or malignant?",
            "prompt": (f"From the {('form of the calcifications' if no_dist else 'form and distribution of the calcifications') if calc else 'shape, margin and density of the mass'}, "
                       + ("was this finding benign or malignant?" if bwc else "was this finding benign or malignant at pathology?")),
            "modes": ["learn", "practice", "assess"], "seriesUids": [s["uid"] for s in sers],
            "start": {"seriesUid": cc["uid"], "slice": "first", "windowPreset": None}, "targets": [],
            "grading": {"kind": "choice", "multiple": False, "options": [
                {"id": "benign", "text": "Benign", "correct": path == "benign",
                 "why": _bwc_why if bwc else "The CBIS-DDSM pathology for this finding is benign." if path == "benign" else "The CBIS-DDSM pathology for this finding is malignant."},
                {"id": "malignant", "text": "Malignant", "correct": path == "malignant",
                 "why": _bwc_why if bwc else "The CBIS-DDSM pathology for this finding is malignant." if path == "malignant" else "The CBIS-DDSM pathology for this finding is benign."}]},
            "scoring": "authoritative",
            "hints": [hint(1, "Irregular, spiculated masses and fine pleomorphic or fine linear branching calcifications are classic suspicious patterns.")],
            "explanation": (("Benign without callback (read as benign and not recalled, so not biopsied)" if bwc else f"Pathology {path}")
                            + f", as given in the CBIS-DDSM case description ({what}; BI-RADS assessment {birads}). " + MAMMO_NOTES),
            "bookAnchors": anc, "objectiveIds": objs[:1], "skillDimensions": ["interpretation"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


if __name__ == "__main__":
    for pid, fn in (("us-breast-2", us_lessons), ("stroke-mri-2", stroke_lessons), ("cxr-findings-2", cxr_lessons),
                    ("peds-wrist-2", wrist_lessons), ("mammo-cbis-2", mammo_lessons)):
        if (PACKS / pid / "pack.json").exists():
            fn()
        else:
            print(f"skip {pid}: pack not built", file=sys.stderr)
