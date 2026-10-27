"""Atlas step CT-2: TotalSegmentator task "total" with ALL 117 classes (no --roi_subset) on every converted CT.

  python scripts/atlas/ct_run_totalseg.py [--fast] [--body_seg] [--force] [case ...]

--body_seg (used for every case segmented after the first six): TotalSegmentator first runs its 6 mm body model and
crops the CT to the body before the 1.5 mm models, then pastes the result back into the full grid - only air around
the patient is skipped, roughly halving CPU time.

CLI from the TotalSegmentator venv: `TotalSegmentator -i ct.nii.gz -o seg_total.nii.gz --ml --task total --device cpu
--report ts_report.json` (multilabel output: voxel value = class index of class_map["total"] in
totalsegmentator/map_to_binary.py). TOTALSEG_HOME_DIR = DATA_ROOT/totalseg-home with send_usage_stats false.
Writes WORK/<case>/seg_total.nii.gz, ts_report.json, run.json. Cases already segmented are skipped unless --force.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

from common import TOTALSEG_HOME, VENV_TS, WORK, dump_json, load_json


def ensure_config():
    TOTALSEG_HOME.mkdir(parents=True, exist_ok=True)
    cfg = TOTALSEG_HOME / "config.json"
    c = load_json(cfg) if cfg.exists() else {"totalseg_id": "totalseg_local_offline", "prediction_counter": 0}
    c["send_usage_stats"] = False
    with open(cfg, "w") as f:
        json.dump(c, f, indent=4)


def run(case: str, fast: bool, body_seg: bool) -> dict:
    d = WORK / case
    cmd = [str(VENV_TS / "Scripts" / "TotalSegmentator.exe"), "-i", str(d / "ct.nii.gz"), "-o", str(d / "seg_total.nii.gz"),
           "--ml", "--task", "total", "--device", "cpu", "--report", str(d / "ts_report.json")]
    if fast:
        cmd.append("--fast")
    if body_seg:
        cmd.append("--body_seg")  # crop to the body first (removes surrounding air only; same models)
    env = dict(os.environ, TOTALSEG_HOME_DIR=str(TOTALSEG_HOME), PYTHONIOENCODING="utf-8")
    t0 = time.time()
    p = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    rec = {"case": case, "cmd": cmd, "returncode": p.returncode, "wallSeconds": round(time.time() - t0, 1), "fast": fast,
           "stdoutTail": p.stdout[-3000:], "stderrTail": p.stderr[-3000:]}
    dump_json(rec, d / "run.json")
    return rec


def main(argv):
    fast, force, body = "--fast" in argv, "--force" in argv, "--body_seg" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")] or [r["case"] for r in load_json(WORK / "ct_cases.json") if r["eligible"]]
    ensure_config()
    for c in cases:
        if not force and (WORK / c / "seg_total.nii.gz").exists() and (WORK / c / "ts_report.json").exists():
            print(f"{c}: already segmented, skip")
            continue
        r = run(c, fast, body)
        print(f"{c}: rc={r['returncode']} {r['wallSeconds']}s", flush=True)
        if r["returncode"] != 0:
            print(r["stderrTail"][-1500:])


if __name__ == "__main__":
    main(sys.argv)
