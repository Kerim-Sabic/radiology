"""Atlas step CT-2c: heart chambers from a licence-free model, contrast-enhanced chest CTs only.

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/atlas/ct_heart_chambers.py [--force] [case ...]

Model: MONAI model-zoo bundle "wholeBody_ct_segmentation" v0.1.9 (SegResNet, 104 TotalSegmentator-v1 classes, 1.5 mm
"highres" weights models/model.pt), downloaded with monai.bundle.download(source="github") into
DATA_ROOT/monai-bundles. Licences (checked 2026-10-27): bundle (code + weights) Apache-2.0 (bundle LICENSE file);
training data = TotalSegmentator dataset, Zenodo record 6802614, CC-BY-4.0 (Zenodo API "license": {"id": "cc-by-4.0"}).
Both allow commercial use with attribution. Classes used: 44 heart_myocardium, 45 heart_atrium_left, 46 heart_ventricle_left,
47 heart_atrium_right, 48 heart_ventricle_right (49 pulmonary_artery is NOT used: the licence-free lung-vessel task is
the pulmonary-artery source).

Preprocessing exactly as the bundle's configs/inference.json (LoadImage, channel first, Orientation RAS, Spacing 1.5 mm
bilinear, NormalizeIntensity nonzero, ScaleIntensity [-1, 1]) on the WHOLE volume; inference (sliding window 96^3,
overlap 0.25, gaussian, replicate padding, softmax + argmax) only inside the bounding box of the whole-heart mask of
seg_total plus a 30 mm margin to keep CPU time small. The prediction (1.5 mm RAS grid) is resampled to the original CT
grid with SimpleITK nearest neighbour. Output WORK/<case>/seg_chambers.nii.gz (labels 44-48 only) + chambers_run.json.
Cases: structures.json says contrast study and has a heart.
"""
from __future__ import annotations

import sys
import time

import nibabel as nib
import numpy as np
import SimpleITK as sitk
import torch

from common import DATA_ROOT, WORK, dump_json, load_json

BUNDLE = DATA_ROOT / "monai-bundles" / "wholeBody_ct_segmentation"
CHAMBER_LABELS = {44: "heart_myocardium", 45: "heart_atrium_left", 46: "heart_ventricle_left", 47: "heart_atrium_right",
                  48: "heart_ventricle_right"}


def contrast_cases():
    out = []
    for r in load_json(WORK / "ct_cases.json"):
        p = WORK / r["case"] / "structures.json"
        if r["eligible"] and p.exists():
            o = load_json(p)
            if o.get("contrast", {}).get("contrastStudy") and "heart" in o["structures"]:
                out.append(r["case"])
    return out


def run(case, net, device):
    from monai.inferers import sliding_window_inference
    from monai.transforms import (Compose, EnsureChannelFirstd, LoadImaged, NormalizeIntensityd, Orientationd,
                                  ScaleIntensityd, Spacingd)
    from totalsegmentator.map_to_binary import class_map
    d = WORK / case
    t0 = time.time()
    seg_img = nib.load(str(d / "seg_total.nii.gz"))
    heart_idx = {v: k for k, v in class_map["total"].items()}["heart"]
    heart = (np.asanyarray(seg_img.dataobj) == heart_idx).astype(np.uint8)
    nib.save(nib.Nifti1Image(heart, seg_img.affine), str(d / "_heart_ts.nii.gz"))
    pre = Compose([LoadImaged(keys=["image", "heart"]), EnsureChannelFirstd(keys=["image", "heart"]),
                   Orientationd(keys=["image", "heart"], axcodes="RAS"),
                   Spacingd(keys=["image", "heart"], pixdim=[1.5, 1.5, 1.5], mode=["bilinear", "nearest"]),
                   NormalizeIntensityd(keys="image", nonzero=True), ScaleIntensityd(keys="image", minv=-1.0, maxv=1.0)])
    data = pre({"image": str(d / "ct.nii.gz"), "heart": str(d / "_heart_ts.nii.gz")})
    img, hm = data["image"], data["heart"][0] > 0.5
    idx = np.argwhere(hm.numpy())
    lo = np.maximum(idx.min(0) - 20, 0)
    hi = np.minimum(idx.max(0) + 21, np.array(hm.shape))
    crop = img[:, lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]][None].float()
    with torch.no_grad():
        logits = sliding_window_inference(crop.as_tensor() if hasattr(crop, "as_tensor") else crop, roi_size=(96, 96, 96),
                                          sw_batch_size=1, predictor=net, overlap=0.25, mode="gaussian", padding_mode="replicate")
    lab = torch.argmax(torch.softmax(logits, 1), 1)[0].numpy().astype(np.uint8)
    full = np.zeros(hm.shape, np.uint8)
    keep = np.isin(lab, list(CHAMBER_LABELS))
    full[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = np.where(keep, lab, 0)
    affine = np.asarray(img.affine)
    nib.save(nib.Nifti1Image(full, affine), str(d / "_chambers_1p5.nii.gz"))
    res = sitk.Resample(sitk.ReadImage(str(d / "_chambers_1p5.nii.gz")), sitk.ReadImage(str(d / "ct.nii.gz")),
                        sitk.Transform(), sitk.sitkNearestNeighbor, 0)
    sitk.WriteImage(res, str(d / "seg_chambers.nii.gz"), useCompression=True)
    (d / "_heart_ts.nii.gz").unlink()
    rec = {"case": case, "seconds": round(time.time() - t0, 1), "cropVoxels": [int(v) for v in (hi - lo)],
           "labelsFound": {CHAMBER_LABELS[k]: int((full == k).sum()) for k in CHAMBER_LABELS},
           "model": "MONAI wholeBody_ct_segmentation v0.1.9 model.pt (1.5 mm)", "device": str(device)}
    dump_json(rec, d / "chambers_run.json")
    return rec


def main(argv):
    from monai.networks.nets import SegResNet
    force = "--force" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")] or contrast_cases()
    device = torch.device("cpu")
    net = SegResNet(spatial_dims=3, in_channels=1, out_channels=105, init_filters=32, blocks_down=[1, 2, 2, 4],
                    blocks_up=[1, 1, 1], dropout_prob=0.2).to(device)
    net.load_state_dict(torch.load(BUNDLE / "models" / "model.pt", map_location=device, weights_only=True))
    net.eval()
    for c in cases:
        if not force and (WORK / c / "seg_chambers.nii.gz").exists():
            print(f"{c}: done, skip")
            continue
        r = run(c, net, device)
        print(f"{c}: {r['seconds']} s, crop {r['cropVoxels']}, {r['labelsFound']}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
