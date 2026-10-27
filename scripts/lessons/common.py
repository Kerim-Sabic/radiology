"""Helpers for authoring lessons.json from a built pack.json.

Lessons are hand-written teaching content; this module only resolves UIDs from the pack
manifest (so nothing is typed by hand twice) and refuses to emit tasks that reference
series/targets that do not exist or belong to another subject.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "public" / "packs"


class Pack:
    def __init__(self, pack_id: str):
        self.id = pack_id
        self.manifest = json.loads((PACKS / pack_id / "pack.json").read_text(encoding="utf-8"))
        self.series = {s["uid"]: s for s in self.manifest["series"]}
        self.targets = {t["id"]: t for t in self.manifest["referenceTargets"]}
        self.studies = {s["uid"]: s for s in self.manifest["studies"]}

    def subject(self, source_subject_id: str) -> dict:
        for s in self.manifest["subjects"]:
            if s["sourceSubjectId"] == source_subject_id:
                return s
        raise KeyError(source_subject_id)

    def series_where(self, subject_key: str, **match) -> dict:
        found = [s for s in self.manifest["series"] if s["subjectKey"] == subject_key and all(_m(s, k, v) for k, v in match.items())]
        if len(found) != 1:
            raise ValueError(f"expected one series for {subject_key} {match}, found {len(found)}")
        return found[0]

    def target(self, tid: str) -> dict:
        if tid not in self.targets:
            raise KeyError(f"target {tid} not in pack {self.id}")
        return self.targets[tid]


def _m(series: dict, key: str, value) -> bool:
    if key == "desc_contains":
        return value.lower() in (series.get("description") or "").lower()
    return series.get(key) == value


def anchor(physical: int, printed: str, chapter: str, figure: str | None = None, section: str | None = None, note: str | None = None) -> dict:
    a = {"physical": physical, "printed": printed, "chapterId": chapter, "figureId": figure, "sectionId": section}
    if note:
        a["note"] = note
    return a


def hint(level: int, text: str, action: dict | None = None) -> dict:
    h = {"level": level, "text": text}
    if action:
        h["action"] = action
    return h


def write_lessons(pack: Pack, version: str, cases: list[dict], tasks: list[dict]) -> Path:
    case_ids = {c["id"] for c in cases}
    for c in cases:
        subj = c["subjectKey"]
        for st in c["studyUids"]:
            if st not in pack.studies or pack.studies[st]["subjectKey"] != subj:
                raise ValueError(f"case {c['id']}: study {st} not of subject {subj}")
    for t in tasks:
        assert t["caseId"] in case_ids, t["id"]
        kase = next(c for c in cases if c["id"] == t["caseId"])
        for su in t["seriesUids"] + [t["start"]["seriesUid"]]:
            if su not in pack.series or pack.series[su]["subjectKey"] != kase["subjectKey"]:
                raise ValueError(f"task {t['id']}: series {su} missing or from another subject")
        for tt in t["targets"]:
            pack.target(tt["targetId"])
            if pack.targets[tt["targetId"]]["seriesUid"] not in t["seriesUids"]:
                raise ValueError(f"task {t['id']}: target {tt['targetId']} is on a series the task does not offer")
        if t["scoring"] == "authoritative":
            bad = [tt["targetId"] for tt in t["targets"] if pack.targets[tt["targetId"]]["provenance"] not in ("source_manual",)]
            if bad:
                raise ValueError(f"task {t['id']}: authoritative scoring needs source_manual targets, got drafts {bad}")
    out = {"schemaVersion": 1, "packId": pack.id, "version": version, "cases": cases, "tasks": tasks}
    path = PACKS / pack.id / "lessons.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}: {len(cases)} cases, {len(tasks)} tasks", file=sys.stderr)
    return path


def oral_exam_task(case_id: str, series_uids: list[str], start_uid: str, topic: str, closest_alternative: str, anchors: list[dict], objective_ids: list[str], window: str | None = None) -> dict:
    """Resident-style oral exam on a study with a referenced finding: show, describe, defend, contrast."""
    return {
        "id": f"{case_id}:oral",
        "caseId": case_id,
        "type": "differential",
        "title": "Oral exam: show it, describe it, defend it",
        "prompt": (
            "As if presenting to an examiner: (1) show the key finding with an arrow, (2) describe it in one sentence (location, size, pattern), "
            f"(3) give your leading interpretation with the image evidence for it, and (4) explain why {closest_alternative} is less likely."
        ),
        "modes": ["learn", "practice"],
        "seriesUids": series_uids,
        "start": {"seriesUid": start_uid, "slice": "first", "windowPreset": window},
        "targets": [],
        "grading": {"kind": "self_review"},
        "scoring": "exploratory_self_review",
        "hints": [hint(1, f"Keep it to four sentences. Examiners reward a clear search pattern and an honest statement of what the images cannot tell you ({topic}).")],
        "explanation": "There is no automatic grader for free-text reasoning. Compare your answer with the checklist and the linked book pages.",
        "rubric": [
            {"id": "show", "text": "Showed the finding on the right series and slice", "weight": "essential", "category": "finding"},
            {"id": "desc", "text": "One-sentence description with location, size and pattern", "weight": "essential", "category": "pattern"},
            {"id": "lead", "text": "Leading interpretation supported by named image features", "weight": "essential", "category": "impression"},
            {"id": "alt", "text": f"Closest alternative ({closest_alternative}) addressed with opposing evidence", "weight": "essential", "category": "differential"},
            {"id": "limit", "text": "Stated what needs comparison, other sequences/phases, or clinical information", "weight": "supportive", "category": "limitation"},
        ],
        "bookAnchors": anchors,
        "objectiveIds": objective_ids,
        "skillDimensions": ["interpretation", "reporting"],
        "allowUncertain": True,
    }


def frontal_cxr_tasks(case_id: str, xr: dict, projection: str, anchors_borders: list[dict], anchors_ctr: list[dict], anchors_tech: list[dict], obj: dict) -> list[dict]:
    """Self-reviewed skills on a real frontal chest radiograph (no finding reference exists for these images)."""
    ap = projection.upper().startswith("AP")
    start = {"seriesUid": xr["uid"], "slice": "first", "windowPreset": None}
    return [
        {
            "id": f"{case_id}:technique", "caseId": case_id, "type": "describe_finding", "title": "Judge the technical quality",
            "prompt": "Before reading the lungs, assess this frontal radiograph's technique: projection, inspiration (count posterior ribs), rotation (spinous processes vs clavicle heads) and penetration.",
            "modes": ["learn", "practice"], "seriesUids": [xr["uid"]], "start": start, "targets": [],
            "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
            "hints": [hint(1, "A good inspiration shows about 9–10 posterior ribs above the diaphragm; rotation shifts the spinous processes away from the midpoint between the clavicle heads.")],
            "explanation": "Technique changes appearances: poor inspiration crowds the bases and widens the heart; rotation distorts the mediastinum; AP projection magnifies the heart.",
            "rubric": [
                {"id": "proj", "text": f"Projection stated ({'AP — heart size not reliable' if ap else 'PA or as recorded'})", "weight": "essential", "category": "limitation"},
                {"id": "insp", "text": "Inspiration judged by counting posterior ribs", "weight": "essential", "category": "finding"},
                {"id": "rot", "text": "Rotation judged with spinous processes and clavicle heads", "weight": "essential", "category": "finding"},
                {"id": "pen", "text": "Penetration judged (spine visible through the heart?)", "weight": "supportive", "category": "finding"},
            ],
            "bookAnchors": anchors_tech, "objectiveIds": obj["tech"], "skillDimensions": ["orientation"], "allowUncertain": True,
        },
        {
            "id": f"{case_id}:borders", "caseId": case_id, "type": "find_structure", "title": "Trace the cardiomediastinal borders",
            "prompt": "Place named arrows on each segment of the right and left cardiomediastinal borders (e.g. SVC, right atrium, aortic knob, main pulmonary artery, left ventricle) and say whether any segment looks abnormal.",
            "modes": ["learn", "practice"], "seriesUids": [xr["uid"]], "start": start, "targets": [],
            "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
            "hints": [hint(1, "Right border, top to bottom: SVC, then right atrium. Left border: aortic knob, main pulmonary artery, then left ventricle.")],
            "explanation": "No anatomical reference outlines exist for this radiograph, so compare your arrows with the book's figure of the normal contours and self-review.",
            "rubric": [
                {"id": "right", "text": "Right border: SVC and right atrium identified", "weight": "essential", "category": "location"},
                {"id": "left", "text": "Left border: aortic knob, main pulmonary artery and left ventricle identified", "weight": "essential", "category": "location"},
                {"id": "abn", "text": "Commented on whether any segment bulges or is effaced", "weight": "supportive", "category": "finding"},
            ],
            "bookAnchors": anchors_borders, "objectiveIds": obj["borders"], "skillDimensions": ["anatomy"], "allowUncertain": True,
        },
        {
            "id": f"{case_id}:ctr", "caseId": case_id, "type": "describe_finding", "title": "Measure the cardiothoracic ratio",
            "prompt": "Use the Length tool (L) to measure the widest heart diameter and the widest inner thoracic diameter, then state the ratio and whether this projection allows a judgement of heart size.",
            "modes": ["learn", "practice"], "seriesUids": [xr["uid"]], "start": start, "targets": [],
            "grading": {"kind": "self_review"}, "scoring": "exploratory_self_review",
            "hints": [hint(1, "Measure the heart from its rightmost to leftmost point; the thorax at its widest inner rib margins, usually at the domes of the diaphragm.")],
            "explanation": "The ratio is a heuristic for PA films; on AP films the heart is magnified, so an apparently large ratio is not reliable. Detector-plane pixel spacing is not patient-calibrated, but a ratio cancels that scale.",
            "rubric": [
                {"id": "meas", "text": "Both widths measured at the right places", "weight": "essential", "category": "finding"},
                {"id": "ratio", "text": "Ratio stated", "weight": "essential", "category": "finding"},
                {"id": "proj", "text": f"Projection caveat stated ({'AP: magnified' if ap else 'PA: usable'})", "weight": "essential", "category": "limitation"},
            ],
            "bookAnchors": anchors_ctr, "objectiveIds": obj["ctr"], "skillDimensions": ["anatomy", "interpretation"], "allowUncertain": True,
        },
    ]
