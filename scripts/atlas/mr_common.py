"""Shared paths and names for the MRI part of the anatomy atlas (-> public/packs/anatomy-atlas-mr).

OFFLINE tooling. Every output is an unreviewed AI draft (provenance "ai_draft", layer "atlas"). The CT atlas
(`anatomy-atlas`) is at its size budget, so MRI outlines get their own pack with the same contract.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from common import DATA_ROOT, PACKS_DIR, REPO, load_json, subject_short

WORK_MR = Path(os.environ.get("RADIOLOGY_ATLAS_MR_WORK", DATA_ROOT / "work" / "atlas-mr"))
OUT_PACK_MR = PACKS_DIR / "anatomy-atlas-mr"
REPORT_MR = REPO / "docs" / "data" / "anatomy-atlas-mr-report.md"
VENV_GPU = Path(os.environ.get("RADIOLOGY_GPU_VENV", DATA_ROOT / "venv-gpu"))

# Image packs whose MRI series get outlines (round 1: the TOF angiograms; round 2: the brain MRIs).
MR_SOURCE_PACKS = ["brain-mra", "neuro-msk", "expansion", "ct-tumors", "stroke-mri", "stroke-mri-2", "stroke-mri-3"]

# Arteries of the Circle of Willis (cow_post names -> class id and label). Sub-segments replace their whole artery.
COW_LABEL = {
    "BA": "Basilar artery",
    "R-ICA": "Right internal carotid artery (intracranial)", "L-ICA": "Left internal carotid artery (intracranial)",
    "R-MCA": "Right middle cerebral artery", "L-MCA": "Left middle cerebral artery",
    "R-ACA": "Right anterior cerebral artery", "L-ACA": "Left anterior cerebral artery",
    "R-PCA": "Right posterior cerebral artery", "L-PCA": "Left posterior cerebral artery",
    "R-Pcom": "Right posterior communicating artery", "L-Pcom": "Left posterior communicating artery",
    "Acom": "Anterior communicating artery", "3rd-A2": "Third A2 (median artery of the corpus callosum)",
}
PART_LABEL = {
    "A1": "{side} anterior cerebral artery, A1 segment", "A2": "{side} anterior cerebral artery, A2 segment",
    "P1": "{side} posterior cerebral artery, P1 segment", "P2": "{side} posterior cerebral artery, P2 segment",
    "M1": "{side} middle cerebral artery, M1 segment", "M2": "{side} middle cerebral artery, M2 branches",
}
SMALL_VESSELS = {"R-Pcom", "L-Pcom", "Acom", "3rd-A2"}


def mr_series():
    """(pack id, pack root, series) for every diagnostic MR series of MR_SOURCE_PACKS."""
    out = []
    for pid in MR_SOURCE_PACKS:
        root = PACKS_DIR / pid
        if not (root / "pack.json").exists():
            continue
        m = load_json(root / "pack.json")
        for se in m["series"]:
            if se["modality"] == "MR" and se["role"] == "diagnostic":
                out.append((pid, root, se))
    return out


def case_ids():
    rows = mr_series()
    count = {}
    for _, _, se in rows:
        k = subject_short(se["subjectKey"])
        count[k] = count.get(k, 0) + 1
    out = []
    for pid, root, se in rows:
        k = subject_short(se["subjectKey"])
        out.append((k if count[k] == 1 else f"{k}-{se['uid'][-6:]}", pid, root, se))
    return out


def is_tof(se: dict) -> bool:
    acq = se.get("acquisition") or {}
    text = " ".join(str(v) for v in (se.get("description"), acq.get("SeriesDescription"), acq.get("SequenceVariant"), acq.get("ImageType")))
    return bool(re.search(r"time.of.flight|\bTOF\b|angio", text, re.I))


def cow_class_id(name: str, part: str | None = None) -> str:
    import sys
    sys.path.insert(0, str(REPO / "scripts" / "vessels"))
    import cow_post as P
    if part is None:
        return P.CLASS_ID[name]
    base = name.split("-", 1)[1]
    side = "right" if name.startswith("R-") else "left"
    return f"{P.PART_ID[(base, part)]}_{side}"


def cow_label(name: str, part: str | None = None) -> str:
    if part is None:
        return COW_LABEL[name]
    return PART_LABEL[part].format(side="Right" if name.startswith("R-") else "Left")
