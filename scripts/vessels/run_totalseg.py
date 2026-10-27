"""Step 2: run TotalSegmentator (task "total", restricted with --roi_subset) on each eligible case.

  python scripts/vessels/run_totalseg.py [--fast] [case ...]

* Uses the TotalSegmentator CLI from the isolated venv (VENV/Scripts/TotalSegmentator.exe).
* TOTALSEG_HOME_DIR points at DATA_ROOT/totalseg-home. Its config.json is created by this script
  (if absent) with "send_usage_stats": false so no run statistics are posted anywhere; the model
  weights are downloaded by TotalSegmentator itself from its official GitHub release URLs on first use.
* Default = full-resolution 1.5 mm models (with --roi_subset TotalSegmentator first runs its low-res
  model to crop to the requested structures, then only the needed 1.5 mm sub-models). --fast = 3 mm model.
* Output: WORK/<case>/seg[_fast]/<class>.nii.gz (one binary mask per class, written by TotalSegmentator
  in the geometry of the input NIfTI), WORK/<case>/ts_report[_fast].json (TotalSegmentator --report) and
  WORK/<case>/run[_fast].json (command, wall time, stdout tail).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

from common import ROI_SUBSET, TASK, TOTALSEG_HOME, VENV, WORK, case_dir, dump_json, load_json


def ensure_config():
    TOTALSEG_HOME.mkdir(parents=True, exist_ok=True)
    cfg = TOTALSEG_HOME / "config.json"
    if cfg.exists():
        c = load_json(cfg)
    else:
        c = {"totalseg_id": "totalseg_local_offline", "prediction_counter": 0}
    c["send_usage_stats"] = False
    with open(cfg, "w") as f:
        json.dump(c, f, indent=4)


def run(case: str, fast: bool) -> dict:
    d = case_dir(case)
    suffix = "_fast" if fast else ""
    seg = d / f"seg{suffix}"
    seg.mkdir(exist_ok=True)
    exe = VENV / "Scripts" / "TotalSegmentator.exe"
    cmd = [str(exe), "-i", str(d / "ct.nii.gz"), "-o", str(seg), "--task", TASK, "--roi_subset", *ROI_SUBSET,
           "--device", "cpu", "--report", str(d / f"ts_report{suffix}.json")]
    if fast:
        cmd.append("--fast")
    env = dict(os.environ, TOTALSEG_HOME_DIR=str(TOTALSEG_HOME), PYTHONIOENCODING="utf-8")
    t0 = time.time()
    p = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    dt = time.time() - t0
    rec = {"case": case, "cmd": cmd, "returncode": p.returncode, "wallSeconds": round(dt, 1), "fast": fast,
           "stdoutTail": p.stdout[-3000:], "stderrTail": p.stderr[-3000:]}
    dump_json(rec, d / f"run{suffix}.json")
    return rec


def main(argv):
    fast = "--fast" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")]
    if not cases:
        cases = [r["case"] for r in load_json(WORK / "eligibility.json") if r["eligible"]]
    ensure_config()
    for c in cases:
        r = run(c, fast)
        print(f"{c}: rc={r['returncode']} {r['wallSeconds']}s")
        if r["returncode"] != 0:
            print(r["stderrTail"][-1500:])


if __name__ == "__main__":
    main(sys.argv)
