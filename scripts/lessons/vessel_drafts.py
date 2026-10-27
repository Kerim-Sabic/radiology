"""Flagship "find the five-vessel level" exercise (Learning Radiology 5th ed., Ch3, PDF 39 / p.24,
Fig 3.5 on PDF 40 / p.25) on five different patients' contrast chest CTs.

References are UNREVIEWED AI drafts (TotalSegmentator, scripts/vessels). Tasks are declared
`authoritative`, but the grader demotes them to draft comparison + self-review until the learner
records their own review in the Author screen. Run: python scripts/lessons/vessel_drafts.py
"""
import json
import sys

from common import PACKS, ROOT, hint
from objectives import objectives_for, objective_anchors

V = json.loads((PACKS / "vessel-drafts" / "pack.json").read_text(encoding="utf-8"))
targets = {t["id"]: t for t in V["referenceTargets"]}
series_owner = {}
cases_by_series = {}
for pid in ("chest-pairs", "body"):
    pk = json.loads((PACKS / pid / "pack.json").read_text(encoding="utf-8"))
    ls = json.loads((PACKS / pid / "lessons.json").read_text(encoding="utf-8"))
    for s in pk["series"]:
        series_owner[s["uid"]] = s
    for c in ls["cases"]:
        for st in c["studyUids"]:
            for s in pk["series"]:
                if s["studyUid"] == st:
                    cases_by_series.setdefault(s["uid"], c)

FIVE = [
    ("brachiocephalic-vein-right", "Right brachiocephalic vein", ["Right brachiocephalic vein", "R brachiocephalic vein", "Right innominate vein"]),
    ("brachiocephalic-vein-left", "Left brachiocephalic vein", ["Left brachiocephalic vein", "L brachiocephalic vein", "Left innominate vein"]),
    ("brachiocephalic-trunk", "Brachiocephalic artery", ["Brachiocephalic artery", "Brachiocephalic trunk", "Innominate artery"]),
    ("common-carotid-artery-left", "Left common carotid artery", ["Left common carotid artery", "Left carotid", "L common carotid"]),
    ("subclavian-artery-left", "Left subclavian artery", ["Left subclavian artery", "L subclavian"]),
]
BOOK = objective_anchors("ch03-o04", 3)
OBJ = objectives_for("five_vessel")
tasks = []
subjects = sorted({tid.split("-level-")[0] for tid in targets if tid.endswith("-level-five-vessel")})
for prefix in subjects:
    level_id = f"{prefix}-level-five-vessel"
    arch_id = f"{prefix}-level-aortic-arch"
    series_uid = targets[level_id]["seriesUid"]
    kase = cases_by_series.get(series_uid)
    if not kase:
        print(f"skip {prefix}: no authored case owns series {series_uid}", file=sys.stderr)
        continue
    have = [v for v in FIVE if f"{prefix}-{v[0]}" in targets]
    if len(have) != 5:
        print(f"skip {prefix}: only {len(have)} of 5 vessels", file=sys.stderr)
        continue
    spacing = series_owner[series_uid]["geometry"]["sliceSpacing"] or 3.0
    base = f"{kase['id']}:five-vessel"
    tasks.append({
        "id": base,
        "caseId": kase["id"],
        "type": "navigate_level",
        "title": "Find and name the five great vessels",
        "prompt": (
            "Start at the top of the scan. Navigate to the superior mediastinum just above the aortic arch, then place a named arrow in each of: "
            "right brachiocephalic vein, left brachiocephalic vein, brachiocephalic artery, left common carotid artery, left subclavian artery."
        ),
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [series_uid],
        "start": {"seriesUid": series_uid, "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [{"targetId": f"{prefix}-{k}", "name": n, "acceptedNames": acc, "required": True} for k, n, acc in have],
        "grading": {"kind": "labelled_points", "slabToleranceMm": round(spacing / 2 + 0.2, 2), "inPlaneToleranceMm": 2.0, "levelTargetId": level_id, "requireLabels": True},
        "scoring": "authoritative",
        "hints": [
            hint(1, "Orientation: work in a mediastinal window, axial plane. The level you need is in the superior mediastinum, a little above the top of the aortic arch."),
            hint(2, "Relationships: the two brachiocephalic veins are the most anterior vessels (the left one crosses in front of the arteries); behind them the three arch branches line up from patient right to left — brachiocephalic artery, left common carotid, left subclavian."),
            hint(3, "Jumping into the accepted slice interval.", {"type": "jumpSliceInterval", "targetId": level_id}),
            hint(4, "Showing the draft vessel outlines.", {"type": "showRegion", "targetIds": [f"{prefix}-{k}" for k, _, _ in have]}),
            hint(5, "Reveal the reference, explanation and book figure.", {"type": "reveal"}),
        ],
        "explanation": (
            "At the five-vessel level the two brachiocephalic veins lie anteriorly and the three branches of the aortic arch lie behind them, right to left: brachiocephalic artery, "
            "left common carotid artery, left subclavian artery. The accepted level is a slice interval (here from vessel masks (AI draft by Horalix): all five present as separate cross-sections "
            "and above the arch), not one exact slice — patients differ. Level, vessel identity, side and position are graded separately; two arrows in one vessel count once. "
            "These outlines are unreviewed AI proposals: compare carefully, and record your own review in Author before trusting them as a key."
        ),
        "bookAnchors": BOOK,
        "objectiveIds": OBJ,
        "skillDimensions": ["anatomy", "navigation_windowing", "orientation"],
        "allowUncertain": True,
    })
    tasks.append({
        "id": f"{kase['id']}:five-vessel-level",
        "caseId": kase["id"],
        "type": "navigate_level",
        "title": "Navigate to the five-vessel level",
        "prompt": "Scroll from the top of the scan and stop on a slice at the five-vessel level. Then submit — your current slice is checked. Say which landmarks you used.",
        "modes": ["learn", "practice", "assess"],
        "seriesUids": [series_uid],
        "start": {"seriesUid": series_uid, "slice": "first", "windowPreset": "Mediastinum"},
        "targets": [{"targetId": level_id, "name": "Five-vessel level", "required": True}],
        "grading": {"kind": "slice_interval", "toleranceMm": round(spacing / 2, 2)},
        "scoring": "authoritative",
        "hints": [hint(1, "Find the top of the aortic arch first, then go a little superior."), hint(3, "Jumping into the accepted interval.", {"type": "jumpSliceInterval", "targetId": level_id}), hint(5, "Reveal.", {"type": "reveal"})],
        "explanation": "The feedback tells you how many millimetres superior or inferior you were. The accepted interval comes from the vessel masks (AI draft by Horalix) and is therefore a draft until you review it.",
        "rubric": [{"id": "landmarks", "text": "Named landmarks used: top of the aortic arch below, brachiocephalic veins anteriorly, three arch branches behind them", "weight": "essential", "category": "location"}],
        "bookAnchors": BOOK[:2],
        "objectiveIds": OBJ,
        "skillDimensions": ["navigation_windowing", "anatomy"],
        "allowUncertain": True,
    })
    if arch_id in targets:
        tasks.append({
            "id": f"{kase['id']}:aortic-arch-level",
            "caseId": kase["id"],
            "type": "navigate_level",
            "title": "Navigate to the aortic arch level",
            "prompt": "Find the level where the aortic arch crosses from anterior-right to posterior-left, stop there and submit.",
            "modes": ["learn", "practice"],
            "seriesUids": [series_uid],
            "start": {"seriesUid": series_uid, "slice": "first", "windowPreset": "Mediastinum"},
            "targets": [{"targetId": arch_id, "name": "Aortic arch level", "required": True}],
            "grading": {"kind": "slice_interval", "toleranceMm": round(spacing / 2, 2)},
            "scoring": "authoritative",
            "hints": [hint(1, "The arch is the curved tube connecting the ascending aorta (anterior) to the descending aorta (left of the spine)."), hint(3, "Jumping into the accepted interval.", {"type": "jumpSliceInterval", "targetId": arch_id}), hint(5, "Reveal.", {"type": "reveal"})],
            "explanation": "Just below the five-vessel level, the arch appears as one continuous curved vessel across the mediastinum. (Draft interval — AI draft by Horalix.)",
            "bookAnchors": [b for b in BOOK if b.get("figureId") in (None, "Fig 3.6")][:2] or BOOK[:1],
            "objectiveIds": OBJ,
            "skillDimensions": ["navigation_windowing", "anatomy"],
            "allowUncertain": True,
        })

out = {"schemaVersion": 1, "packId": "vessel-drafts", "version": "1.0.0", "cases": [], "tasks": tasks}
(PACKS / "vessel-drafts" / "lessons.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote public/packs/vessel-drafts/lessons.json: {len(tasks)} tasks on {len({t['caseId'] for t in tasks})} patients", file=sys.stderr)
