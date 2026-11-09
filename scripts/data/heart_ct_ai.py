"""AI drafts for the heart-ct pack: heart chambers, myocardium and pulmonary arteries on every chosen CT, one worker per GPU.

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/data/heart_ct_ai.py <gpu> <case> [case ...]

Model: MONAI model-zoo bundle `wholeBody_ct_segmentation` v0.1.9 (SegResNet, 1.5 mm weights models/model.pt, Apache-2.0),
trained on the TotalSegmentator CT dataset v1 (CC BY 4.0); classes 44 myocardium, 45 left atrium, 46 left ventricle,
47 right atrium, 48 right ventricle, 49 pulmonary artery. Preprocessing as in the bundle's configs/inference.json
(RAS, 1.5 mm - the dataset CTs already are - NormalizeIntensity over the non-zero voxels of the WHOLE volume, ScaleIntensity
to [-1, 1]); sliding-window inference (96^3, overlap 0.25, gaussian) inside the heart's bounding box + 30 mm, argmax.
Output: WORK/<case>/ai_chambers.nii.gz, cut to the crop of WORK/<case>/prep.json, plus WORK/<case>/ai_run.json.

Not run: TotalSegmentator's licensed tasks `heartchambers_highres` and `coronary_arteries`. On 2026-11-09 the tool's own offline
licence check (totalsegmentator.config.has_valid_license_offline, which never returns the number) reported "missing_license" for
the configuration in totalseg-home, and the tool refuses both tasks without it. No workaround was made. `licence_ok()` below is that
check; once a licence number has been entered with the tool's own `totalseg_set_license`, the two tasks can be run with
`TotalSegmentator -i ct_crop.nii.gz -o <dir> -ta <task> --device gpu` on WORK/<case>/ct_crop.nii.gz.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import torch

DATA = Path(os.environ.get("RADIOLOGY_DATA_DIR", r"C:\Users\kerim\radiology-data"))
WORK = DATA / "work" / "heart-ct"
RAW = DATA / "raw" / "TotalSegmentator-v3"
BUNDLE = DATA / "monai-bundles" / "wholeBody_ct_segmentation"
VENV = DATA / "venv-ts"
HOME = DATA / "totalseg-home"
LABELS = {44: "heart_myocardium", 45: "heart_atrium_left", 46: "heart_ventricle_left", 47: "heart_atrium_right",
          48: "heart_ventricle_right", 49: "pulmonary_artery"}


def load_net(device):
    from monai.networks.nets import SegResNet
    net = SegResNet(spatial_dims=3, in_channels=1, out_channels=105, init_filters=32, blocks_down=[1, 2, 2, 4],
                    blocks_up=[1, 1, 1], dropout_prob=0.2).to(device)
    net.load_state_dict(torch.load(BUNDLE / "models" / "model.pt", map_location=device, weights_only=True))
    return net.eval()


def run(case: str, net, device) -> dict:
    from monai.inferers import sliding_window_inference
    t0 = time.time()
    im = nib.load(str(RAW / case / "ct.nii.gz"))
    assert nib.aff2axcodes(im.affine) == ("R", "A", "S") and np.allclose(im.header.get_zooms()[:3], 1.5), (case, nib.aff2axcodes(im.affine))
    ct = np.asarray(im.dataobj).astype(np.float32)
    heart = np.asarray(nib.load(str(RAW / case / "segmentations" / "heart.nii.gz")).dataobj) > 0
    nz = ct != 0
    x = ct.copy()
    x[nz] = (ct[nz] - ct[nz].mean()) / max(float(ct[nz].std()), 1e-6)
    x = (x - x.min()) / max(float(x.max() - x.min()), 1e-6) * 2.0 - 1.0
    idx = np.argwhere(heart)
    lo = np.maximum(idx.min(0) - 20, 0)
    hi = np.minimum(idx.max(0) + 21, np.array(heart.shape))
    crop = torch.from_numpy(x[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]])[None, None].to(device)
    with torch.no_grad():
        logits = sliding_window_inference(crop, roi_size=(96, 96, 96), sw_batch_size=4, predictor=net, overlap=0.25, mode="gaussian",
                                          padding_mode="replicate")
        lab = torch.argmax(torch.softmax(logits, 1), 1)[0].cpu().numpy().astype(np.uint8)
    full = np.zeros(heart.shape, np.uint8)
    full[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = np.where(np.isin(lab, list(LABELS)), lab, 0)
    c = json.loads((WORK / case / "prep.json").read_text())["crop"]
    sub = full[c["i0"]:c["i1"] + 1, c["j0"]:c["j1"] + 1, c["k0"]:c["k1"] + 1]
    cim = nib.load(str(WORK / case / "ct_crop.nii.gz"))
    nib.save(nib.Nifti1Image(sub, cim.affine), str(WORK / case / "ai_chambers.nii.gz"))
    rec = {"case": case, "device": torch.cuda.get_device_name(device), "seconds": round(time.time() - t0, 1),
           "boxVoxels": [int(v) for v in (hi - lo)], "voxels": {LABELS[k]: int((sub == k).sum()) for k in LABELS}}
    (WORK / case / "ai_run.json").write_text(json.dumps(rec, indent=1))
    return rec


def licence_ok() -> bool:
    env = dict(os.environ, TOTALSEG_HOME_DIR=str(HOME))
    p = subprocess.run([str(VENV / "Scripts" / "python.exe"), "-c",
                        "from totalsegmentator.config import has_valid_license_offline as h; print(h()[0])"],
                       env=env, capture_output=True, text=True)
    return p.stdout.strip() == "yes"


if __name__ == "__main__":
    gpu = int(sys.argv[1])
    device = torch.device(f"cuda:{gpu}")
    net = load_net(device)
    for c in sys.argv[2:]:
        r = run(c, net, device)
        print(c, r["seconds"], "s", r["voxels"], flush=True)
