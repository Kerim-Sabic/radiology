"""Atlas step MR-2b: brain anatomy (GOUHFI 2.0) on every converted brain MRI series (GPU queue).

  set CUDA_VISIBLE_DEVICES=0 & venv-gpu python scripts/atlas/mr_run_brain.py --shard=0/2 [--force] [case ...]
  set CUDA_VISIBLE_DEVICES=1 & venv-gpu python scripts/atlas/mr_run_brain.py --shard=1/2 [--force] [case ...]

* Series of one subject on the same voxel grid (ISLES DWI + ADC) are segmented once, on the ADC map (cerebrospinal fluid
  is brightest there, so the ventricles and sulci separate best); the result is shared by every series of that grid.
* Images that are not skull-stripped (background not zero) are first masked with the brain class of TotalSegmentator's
  licence-free `total_mr` task (`--device gpu`, own TOTALSEG_HOME_DIR per GPU, shared weights), dilated by 2 mm; the
  authors recommend brain extraction before GOUHFI.
Writes WORK_MR/<case>/seg_brain.nii.gz, seg_parc.nii.gz, brain_run.json (and brain_mask.nii.gz where a mask was made);
grid partners get a `brain_from.json` pointing at the segmented case.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

from common import DATA_ROOT, dump_json, load_json
from mr_common import WORK_MR

import brain_segment  # noqa: E402

TS_WEIGHTS = DATA_ROOT / "totalseg-home" / "nnunet" / "results"


def groups() -> list[list[dict]]:
    """Brain series grouped by subject and identical voxel grid; the first of each group is the one segmented."""
    rows = [r for r in load_json(WORK_MR / "mr_cases.json") if r["eligible"] and not r["tof"]]
    by = {}
    for r in rows:
        img = nib.load(str(WORK_MR / r["case"] / "mr.nii.gz"))
        key = (r["subjectKey"], img.shape, tuple(np.round(img.affine, 3).ravel()))
        by.setdefault(key, []).append(r)
    out = []
    for g in by.values():
        g.sort(key=lambda r: (not r["description"].upper().startswith("ADC"), r["case"]))
        out.append(g)
    return sorted(out, key=lambda g: g[0]["case"])


def skull_stripped(a: np.ndarray) -> bool:
    """ISLES images are distributed skull-stripped: exact zeros outside the brain on most of the volume."""
    return float(np.mean(a == 0)) > 0.35


def brain_mask(case: str, gpu_home: Path) -> Path:
    """TotalSegmentator CLI (`--task total_mr --roi_subset brain --device gpu`), largest part, dilated by 2 mm."""
    import subprocess
    d = WORK_MR / case
    out = d / "brain_mask.nii.gz"
    if out.exists():
        return out
    gpu_home.mkdir(parents=True, exist_ok=True)
    cfg = gpu_home / "config.json"
    c = json.loads(cfg.read_text()) if cfg.exists() else {"totalseg_id": "totalseg_local_offline", "prediction_counter": 0}
    c["send_usage_stats"] = False
    cfg.write_text(json.dumps(c))
    env = dict(os.environ, TOTALSEG_HOME_DIR=str(gpu_home), TOTALSEG_WEIGHTS_PATH=str(TS_WEIGHTS), PYTHONIOENCODING="utf-8")
    exe = Path(sys.executable).parent / "TotalSegmentator.exe"
    cmd = [str(exe), "-i", str(d / "mr.nii.gz"), "-o", str(d / "ts_brain"), "--task", "total_mr", "--roi_subset", "brain", "--device", "gpu"]
    p = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"TotalSegmentator failed for {case}: {p.stderr[-1500:]}")
    m = nib.load(str(d / "ts_brain" / "brain.nii.gz"))
    a = np.asanyarray(m.dataobj) > 0
    lab, n = ndi.label(a)
    if n > 1:
        a = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
    zooms = np.asarray(m.header.get_zooms()[:3], float)
    a = ndi.binary_dilation(a, iterations=max(1, int(round(2.0 / zooms.min()))))
    nib.save(nib.Nifti1Image(a.astype(np.uint8), m.affine), str(out))
    return out


def main(argv):
    force = "--force" in argv
    shard = next((a.split("=", 1)[1] for a in argv if a.startswith("--shard=")), "0/1")
    device = next((a.split("=", 1)[1] for a in argv if a.startswith("--device=")), "cuda:0")
    i, n = (int(x) for x in shard.split("/"))
    want = [a for a in argv[1:] if not a.startswith("--")]
    gpu_home = DATA_ROOT / f"totalseg-home-gpu{i}"
    models = None
    for k, g in enumerate(groups()):
        if k % n != i or (want and not any(r["case"] in want for r in g)):
            continue
        head = g[0]["case"]
        d = WORK_MR / head
        if (d / "seg_brain.nii.gz").exists() and not force:
            continue
        img = nib.load(str(d / "mr.nii.gz"))
        a = np.asanyarray(img.dataobj).astype(np.float32)
        if ("--stripped-only" in argv and not skull_stripped(a)) or ("--unstripped-only" in argv and skull_stripped(a)):
            continue
        src = d / "mr.nii.gz"
        note = "skull-stripped by the dataset"
        if not skull_stripped(a):
            mask = np.asanyarray(nib.load(str(brain_mask(head, gpu_home))).dataobj) > 0
            nib.save(nib.Nifti1Image(np.where(mask, a, 0).astype(np.float32), img.affine), str(d / "mr_brain.nii.gz"))
            src, note = d / "mr_brain.nii.gz", "masked with the total_mr brain class (dilated 2 mm)"
        models = models or brain_segment.load_models(device)
        info = brain_segment.segment(src, d, device, models)
        info.update(brainMask=note, sharedWith=[r["case"] for r in g[1:]])
        dump_json(info, d / "brain_run.json")
        for r in g[1:]:
            dump_json({"from": head, "reason": "same subject and voxel grid"}, WORK_MR / r["case"] / "brain_from.json")
        print(f"{head}: {info['seconds']} s, {note}, shared with {info['sharedWith']}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
