"""Topic → curriculum objective IDs (public/content/curriculum.v1.json).

The mapping is explicit and reviewed by hand; every ID is checked against the curriculum so a
lesson can never cite an objective that does not exist.
"""
import json
from pathlib import Path

CURRICULUM = Path(__file__).resolve().parents[2] / "public" / "content" / "curriculum.v1.json"

TOPICS: dict[str, list[str]] = {
    "orientation_ct": ["ch01-o03", "ch02-o07"],
    "windowing": ["ch01-o02"],
    "ct_chest_anatomy": ["ch02-o07"],
    "heart_ct": ["ch03-o06", "ch02-o07"],
    "five_vessel": ["ch03-o04"],
    "modalities": ["ch01-o07"],
    "cxr_systematic": ["ch02-o01", "ch02-o02"],
    "cxr_lateral": ["ch02-o04"],
    "mri_weighting": ["ch20-o01"],
    "lung_nodule": ["ch10-o04"],
    "airspace_pattern": ["ch04-o01", "ch04-o03", "ch08-o05"],
    "contrast_phase": ["ch13-o01"],
    "kidney_ct": ["ch13-o05"],
    "renal_mass": ["ch17-o10"],
    "fat_suppression": ["ch20-o02"],
    "edema_mri": ["ch20-o03"],
    "gadolinium": ["ch20-o05", "ch20-o04"],
    "brain_mri": ["ch26-o02"],
    "brain_tumour": ["ch26-o11"],
    "spine_anatomy": ["ch22-o01"],
    "mammo_mass": ["ch29-o03", "ch29-o01"],
    "abdomen_ct_anatomy": ["ch13-o03", "ch13-o04", "ch13-o06"],
    "pancreas_ct": ["ch13-o04"],
    "bowel_ct": ["ch13-o06"],
    "ct_phase": ["ch13-o01"],
    "thymus": ["ch27-o06"],
    "covid_cxr": ["ch08-o05", "ch08-o02"],
}

_known: set[str] | None = None


def _ids() -> set[str]:
    global _known
    if _known is None:
        if CURRICULUM.exists():
            data = json.loads(CURRICULUM.read_text(encoding="utf-8"))
            _known = {o["id"] for u in data["units"] for o in u["objectives"]}
        else:
            _known = set()
    return _known


def objectives_for(topic: str) -> list[str]:
    ids = TOPICS.get(topic, [])
    missing = [i for i in ids if i not in _ids()]
    if missing:
        raise KeyError(f"topic {topic}: objective ids not in curriculum: {missing}")
    return ids


def objective_anchors(objective_id: str, limit: int = 2) -> list[dict]:
    """Book anchors recorded (and verified against page text) for an objective in the curriculum."""
    data = json.loads(CURRICULUM.read_text(encoding="utf-8"))
    for u in data["units"]:
        for o in u["objectives"]:
            if o["id"] == objective_id:
                out = []
                for a in o["anchors"][:limit]:
                    out.append({"physical": a["physical"], "printed": a["printed"], "chapterId": u["id"], "figureId": a.get("figureId"), "sectionId": a.get("sectionId")})
                return out
    raise KeyError(objective_id)
