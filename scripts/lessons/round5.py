"""Lessons for the round-5 packs: cxr-findings-3 (NIH radiologist boxes), us-breast-3 (Breast-Lesions-USG), stroke-mri-3
(ISLES 2022), peds-wrist-3 (GRAZPEDWRI-DX), fx-radiographs-2 (FracAtlas) and mammo-cbis-3 (CBIS-DDSM).

  python scripts/lessons/round5.py

The round-4 task designs (scripts/lessons/round4.py), which were brought in line with the audited round-4 lessons of 30 October
first: run on the round-4 packs, round4.py now writes their lessons word for word except for the few case-specific notes the
audit added by eye. Every answer is read from the source's expert annotation or clinical data as stored in the built pack.json.
Earlier lessons are not touched. Neutral titles continue the "Patient <code>" codes after the last code in use; case-specific
notes from the overlay review (also visible, not outlined; questions kept out of Assess) are applied from REVIEW_NOTES.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import round4 as r4  # noqa: E402
from common import PACKS, Pack, hint, write_lessons  # noqa: E402
from conditions import FX_NOTES, anchors  # noqa: E402

NIH_CLASS = {"Pneumothorax": "finding:pneumothorax", "Effusion": "finding:pleural_effusion", "Atelectasis": "finding:atelectasis",
             "Cardiomegaly": "finding:cardiomegaly", "Mass": "finding:lung_mass", "Nodule": "finding:lung_nodule",
             "Pneumonia": "finding:pneumonia"}


def _used_codes() -> set[str]:
    out = set()
    for lj in PACKS.glob("*/lessons.json"):
        if lj.parent.name in ROUND5:
            continue
        for c in json.loads(lj.read_text(encoding="utf-8"))["cases"]:
            m = re.match(r"Patient (\w+) ·", c.get("neutralTitle") or "")
            if m:
                out.add(m.group(1))
    return out


ROUND5 = ["us-breast-3", "stroke-mri-3", "cxr-findings-3", "peds-wrist-3", "fx-radiographs-2", "mammo-cbis-3"]
_USED = _used_codes()


def _r5_codes():
    """The unused two-letter codes after round 4's, then three letters (AAA, AAB, ...) once they run out."""
    from itertools import product
    from string import ascii_uppercase
    yield from (c for c in r4._codes() if c not in _USED)
    yield from ("".join(p) for p in product(ascii_uppercase, repeat=3) if "".join(p) not in _USED)


r4.CODES = _r5_codes()

# The main finding of each round-5 chest film is the label it was selected for (external_r5.nih_r5_candidates).
def _cxr_main() -> None:
    import os
    raw = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw"))
    sel = raw / "NIH-ChestXray14" / "_meta" / "selection-r5.json"
    if sel.exists():
        for c in json.loads(sel.read_text(encoding="utf-8")):
            r4.CXR_MAIN[c["image"].rsplit(".", 1)[0]] = NIH_CLASS[c["forLabel"]]


# ------------------------------------------------------------------ adult fractures (FracAtlas), as the audited fx-radiographs lessons
def fx_lessons(pack_id: str = "fx-radiographs-2") -> None:
    pack = Pack(pack_id)
    cases, tasks = [], []
    anc = anchors("ch23-o01", "ch23-o03")
    for subj in pack.manifest["subjects"]:
        se = next(s for s in pack.manifest["series"] if s["subjectKey"] == subj["key"])
        t = next(t for t in pack.manifest["referenceTargets"] if t["seriesUid"] == se["uid"])
        stem = t["id"][len("fracatlas-"):].rsplit("_", 1)[0]
        where = pack.studies[subj["studyUids"][0]]["description"].split(", ", 1)[1]
        view = se["description"].split(" ", 1)[0].lower()
        cid = f"fx-{stem}"
        code = next(r4.CODES)
        cases.append({
            "id": cid, "packId": pack.id, "neutralTitle": f"Patient {code} · Radiograph, {where}",
            "learnTitle": f"Fracture: {where} (expert outline)",
            "subjectKey": subj["key"], "studyUids": subj["studyUids"], "primarySeriesUid": se["uid"],
            "region": ["pelvis", "extremity"] if "hip" in where or "pelvis" in where else ["extremity"],
            "clinicalContext": None, "contextSource": None, "difficulty": "typical", "objectiveIds": ["ch23-o01", "ch23-o03"],
            "bookAnchors": anc,
            "referenceSummary": ("One fracture outlined by the FracAtlas annotators (two expert radiologists and an orthopedist). Only one view "
                                 f"({view}) of this injury is installed, and alignment, joint involvement and soft tissues are not referenced."),
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
            "bookAnchors": anc,
            "rubric": [
                {"id": "bone", "text": "Named the bone and the part (proximal, shaft, distal; into the joint or not)", "weight": "essential", "category": "location"},
                {"id": "line", "text": "Described the fracture line (transverse, oblique, spiral, comminuted)", "weight": "essential", "category": "pattern"},
                {"id": "disp", "text": "Described displacement and angulation of the distal fragment", "weight": "supportive", "category": "finding"},
                {"id": "view", "text": "Asked for a second view at 90 degrees", "weight": "supportive", "category": "limitation"}],
            "objectiveIds": ["ch23-o01", "ch23-o03"], "skillDimensions": ["finding_localization", "reporting"], "allowUncertain": True,
        })
    write_lessons(pack, "1.0.0", cases, tasks)


# ------------------------------------------------------------------ notes from the overlay review, applied after generation
# case id -> {"also": sentence appended to the reference summary, "notAssess": [task suffixes kept to Learn/Practice],
#             "explain": {task suffix: sentence appended to the explanation}, "dropTasks": [task suffixes the image cannot
#             support]}; written in round5_review.json from the review.
_RN = Path(__file__).with_name("round5_review.json")
REVIEW_NOTES: dict[str, dict] = json.loads(_RN.read_text(encoding="utf-8")) if _RN.exists() else {}


def wrist_annotation_notes(pack_id: str = "peds-wrist-3") -> None:
    """The GRAZPEDWRI-DX annotations also mark a pronator quadratus sign or soft-tissue swelling on some images: say so in the
    reference summary (read from the radiologists' annotation of each view, never added by eye)."""
    import csv
    import os
    import zipfile
    raw = Path(os.environ.get("RADIOLOGY_RAW_DIR", r"C:\Users\kerim\radiology-data\raw")) / "GRAZPEDWRI-DX"
    rows = list(csv.DictReader(open(raw / "_meta" / "dataset.csv", encoding="utf-8-sig")))
    ann = zipfile.ZipFile(raw / "_meta" / "folder_structure.zip")
    stems = {Path(c["file"]).stem for c in json.loads((raw / "selection-r5.json").read_text(encoding="utf-8"))}
    by_pid = {}
    for r in rows:
        if r["filestem"] in stems:
            by_pid.setdefault(int(r["patient_id"]), []).append(r)
    path = PACKS / pack_id / "lessons.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for c in data["cases"]:
        pid = int(c["subjectKey"].split(":")[-1])
        parts = []
        for r in sorted(by_pid.get(pid, []), key=lambda r: r["projection"]):
            view = "frontal" if r["projection"] == "1" else "lateral"
            kinds = {o["classTitle"] for o in json.loads(ann.read(f"supervisely/wrist/ann/{r['filestem']}.json"))["objects"]}
            if "pronatorsign" in kinds:
                parts.append(f"a pronator quadratus sign on the {view} view (the fat line in front of the distal radius pushed forward "
                             "or blurred), an indirect sign of a distal forearm fracture")
            if "softtissue" in kinds:
                parts.append(f"soft-tissue swelling on the {view} view")
        if parts:
            c["referenceSummary"] = c["referenceSummary"].rstrip() + " The dataset's annotations also mark " + " and ".join(parts) + "."
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def apply_review(pack_id: str) -> None:
    path = PACKS / pack_id / "lessons.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for c in data["cases"]:
        n = REVIEW_NOTES.get(c["id"])
        if n and n.get("also"):
            c["referenceSummary"] = c["referenceSummary"].rstrip() + " " + n["also"]
    data["tasks"] = [t for t in data["tasks"] if t["id"].split(":", 1)[1] not in (REVIEW_NOTES.get(t["caseId"]) or {}).get("dropTasks", [])]
    for t in data["tasks"]:
        n = REVIEW_NOTES.get(t["caseId"]) or {}
        suffix = t["id"].split(":", 1)[1]
        if suffix in n.get("notAssess", []):
            t["modes"] = [m for m in t["modes"] if m != "assess"]
        if suffix in n.get("explain", {}):
            t["explanation"] = t["explanation"].rstrip() + " " + n["explain"][suffix]
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    _cxr_main()
    for pid, fn in (("us-breast-3", r4.us_lessons), ("stroke-mri-3", r4.stroke_lessons), ("cxr-findings-3", r4.cxr_lessons),
                    ("peds-wrist-3", r4.wrist_lessons), ("fx-radiographs-2", fx_lessons), ("mammo-cbis-3", r4.mammo_lessons)):
        if (PACKS / pid / "pack.json").exists():
            fn(pid)
            if pid == "peds-wrist-3":
                wrist_annotation_notes(pid)
            apply_review(pid)
        else:
            print(f"skip {pid}: pack not built", file=sys.stderr)
