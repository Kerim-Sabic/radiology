"""Atlas step MR-2a: Circle-of-Willis arteries on every converted TOF-MRA (GPU queue).

  set CUDA_VISIBLE_DEVICES=0 & venv-gpu python scripts/atlas/mr_run_cow.py --shard=0/2 [--force] [case ...]
  set CUDA_VISIBLE_DEVICES=1 & venv-gpu python scripts/atlas/mr_run_cow.py --shard=1/2 [--force] [case ...]

One queue per GPU: each process takes every n-th TOF case (--shard=i/n), loads the eleven checkpoints once
(scripts/vessels/cow_segment.py) and writes WORK_MR/<case>/seg_cow_raw.nii.gz + cow_run.json. --device=cpu runs the same
code on the CPU (the CPU/GPU spot check).
"""
from __future__ import annotations

import sys
from pathlib import Path

from common import REPO, dump_json, load_json
from mr_common import WORK_MR

sys.path.insert(0, str(REPO / "scripts" / "vessels"))
import cow_segment  # noqa: E402


def main(argv):
    force = "--force" in argv
    shard = next((a.split("=", 1)[1] for a in argv if a.startswith("--shard=")), "0/1")
    device = next((a.split("=", 1)[1] for a in argv if a.startswith("--device=")), "cuda:0")
    out_name = next((a.split("=", 1)[1] for a in argv if a.startswith("--out=")), "seg_cow_raw.nii.gz")
    i, n = (int(x) for x in shard.split("/"))
    want = [a for a in argv[1:] if not a.startswith("--")]
    cases = [r["case"] for r in load_json(WORK_MR / "mr_cases.json") if r["eligible"] and r["tof"]]
    cases = [c for c in cases if not want or c in want]
    mine = [c for k, c in enumerate(cases) if k % n == i]
    models = None
    for c in mine:
        dst = WORK_MR / c / out_name
        if dst.exists() and not force:
            print(f"{c}: done, skip", flush=True)
            continue
        models = models or cow_segment.load_models(device)
        info = cow_segment.segment(WORK_MR / c / "mr.nii.gz", dst, device, models)
        dump_json(info, WORK_MR / c / out_name.replace(".nii.gz", ".json"))
        print(f"{c}: {info['seconds']} s, {info['voxelsPerClass']}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
