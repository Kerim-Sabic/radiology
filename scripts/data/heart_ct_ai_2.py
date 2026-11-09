"""AI drafts for the heart-ct-2 pack: the same licence-free MONAI bundle path as round one (scripts/data/heart_ct_ai.py, imported, unchanged).

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/data/heart_ct_ai_2.py <gpu> <case> [case ...]

Writes work/heart-ct-2/<case>/ai_chambers.nii.gz + ai_run.json. No licensed TotalSegmentator task is run here, and no licence or
configuration file is read.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import heart_ct_ai as ai  # noqa: E402
import torch  # noqa: E402

ai.WORK = ai.DATA / "work" / "heart-ct-2"

if __name__ == "__main__":
    device = torch.device(f"cuda:{int(sys.argv[1])}")
    net = ai.load_net(device)
    for c in sys.argv[2:]:
        r = ai.run(c, net, device)
        print(c, r["seconds"], "s", r["voxels"], flush=True)
