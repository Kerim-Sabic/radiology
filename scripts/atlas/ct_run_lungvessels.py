"""Atlas step CT-2b: licence-free TotalSegmentator task "lung_vessels" (airways, lung arteries, lung veins) on every CT
whose field of view contains the heart and lungs.

  python scripts/atlas/ct_run_lungvessels.py [--force] [case ...]

The task's licence status is checked programmatically (totalsegmentator.registry.requires_license) and the run is
refused if it ever becomes a licensed task. TotalSegmentator crops to the lungs itself (task config "crop" = the five
lobes, robust 3 mm crop model, +20 voxel margin), so the mediastinal pulmonary arteries and main bronchi between the lungs
are inside the processed region. Output: WORK/<case>/seg_lungvessels.nii.gz (multilabel: 1 lung_airways,
2 lung_airways_wall, 3 lung_arteries, 4 lung_veins), ts_report_lungvessels.json, run_lungvessels.json.
Default case list: CTs with >= 100 ml heart and >= 300 ml lung in seg_total (from structures.json).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

from common import TOTALSEG_HOME, VENV_TS, WORK, dump_json, load_json

TASK = "lung_vessels"


def eligible_cases():
    out = []
    for r in load_json(WORK / "ct_cases.json"):
        p = WORK / r["case"] / "structures.json"
        if not r["eligible"] or not p.exists():
            continue
        S = load_json(p)["structures"]
        lung = sum(v["rawVolumeMl"] for n, v in S.items() if n.startswith("lung_") and "lobe" in n)
        heart = S.get("heart", {}).get("rawVolumeMl", 0)
        if heart >= 100 and lung >= 300:
            out.append(r["case"])
    return out


def main(argv):
    from totalsegmentator.registry import requires_license
    if requires_license(TASK):
        raise SystemExit(f"task {TASK} requires a licence - not used")
    force = "--force" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")] or eligible_cases()
    cfg = TOTALSEG_HOME / "config.json"
    c = load_json(cfg) if cfg.exists() else {"totalseg_id": "totalseg_local_offline", "prediction_counter": 0}
    c["send_usage_stats"] = False
    TOTALSEG_HOME.mkdir(parents=True, exist_ok=True)
    with open(cfg, "w") as f:
        json.dump(c, f, indent=4)
    for case in cases:
        d = WORK / case
        if not force and (d / "seg_lungvessels.nii.gz").exists() and (d / "ts_report_lungvessels.json").exists():
            print(f"{case}: already done, skip")
            continue
        cmd = [str(VENV_TS / "Scripts" / "TotalSegmentator.exe"), "-i", str(d / "ct.nii.gz"), "-o", str(d / "seg_lungvessels.nii.gz"),
               "--ml", "--task", TASK, "--device", "cpu", "--report", str(d / "ts_report_lungvessels.json")]
        env = dict(os.environ, TOTALSEG_HOME_DIR=str(TOTALSEG_HOME), PYTHONIOENCODING="utf-8")
        t0 = time.time()
        p = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        rec = {"case": case, "cmd": cmd, "returncode": p.returncode, "wallSeconds": round(time.time() - t0, 1),
               "stdoutTail": p.stdout[-2000:], "stderrTail": p.stderr[-2000:]}
        dump_json(rec, d / "run_lungvessels.json")
        print(f"{case}: rc={p.returncode} {rec['wallSeconds']}s", flush=True)


if __name__ == "__main__":
    main(sys.argv)
