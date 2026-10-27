"""Give every AI-draft reference in a pack the learner-facing wording "AI draft by Horalix".

Usage: python scripts/data/brand_ai_drafts.py <pack-id> [<pack-id> ...]

Rewrites, for referenceTargets with provenance 'ai_draft' only:
  * label            -> plain anatomical name (provenance suffixes such as "(AI)" removed; the app shows the tag)
  * unassessedNote   -> one consistent sentence
  * provenanceDetail -> source "Horalix", method "AI draft by Horalix - ..."
and the same wording in lessons.json text. Technical build details stay in docs/data/<pack>-report.md and the
generator scripts. Expert and dataset-supplied labels are never touched. Idempotent.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BY = "AI draft by Horalix"
METHOD = f"{BY} — automatic segmentation, not reviewed by a radiologist"
SUFFIX = re.compile(r"\s*\((AI|AI draft|AI-derived draft|AI, unreviewed)\)\s*$", re.I)
TEXT = [
    ("from AI-drafted vessel masks", f"from vessel masks ({BY})"),
    ("from the AI-drafted vessel masks", f"from the vessel masks ({BY})"),
    ("(Draft interval from AI masks.)", f"(Draft interval — {BY}.)"),
]


def brand(pack_id: str) -> None:
    pdir = ROOT / "public" / "packs" / pack_id
    mp = pdir / "pack.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    n = 0
    for t in m.get("referenceTargets", []):
        if t.get("provenance") != "ai_draft":
            continue
        t["label"] = SUFFIX.sub("", t["label"]).strip()
        radiograph = "radiograph" in t.get("unassessedNote", "") or "projection" in t.get("unassessedNote", "")
        if t.get("layer") == "atlas":
            t["unassessedNote"] = (f"{BY}: outline of this structure only"
                                   f"{' (projection radiograph)' if radiograph else ''}; not reviewed by a radiologist; never used for grading.")
        t["provenanceDetail"] = {**t["provenanceDetail"], "source": "Horalix", "method": METHOD}
        n += 1
    compact = not mp.read_text(encoding="utf-8").startswith("{\n")  # keep the file's existing layout
    out = json.dumps(m, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(m, ensure_ascii=False, indent=1)
    mp.write_text(out + "\n", encoding="utf-8")
    lp = pdir / "lessons.json"
    if lp.exists():
        s = lp.read_text(encoding="utf-8")
        for a, b in TEXT:
            s = s.replace(a, b)
        lp.write_text(s, encoding="utf-8")
    print(f"{pack_id}: {n} AI-draft targets branded")


if __name__ == "__main__":
    for pid in sys.argv[1:]:
        brand(pid)
