"""Circle-of-Willis artery segmentation on TOF-MRA (13 classes), with the TopCoW 2024 winning model (team CLAIM).

  C:/Users/kerim/radiology-data/venv-gpu/Scripts/python.exe scripts/vessels/cow_segment.py <in.nii.gz> <out.nii.gz> [--device=cuda:0|cpu]

OFFLINE tooling; the output is an unreviewed AI draft. The network and its weights are the team's (nnU-Net v2 ResEnc-M,
Skeleton Recall loss, no mirroring, five folds; Zenodo record 15665435, Team_CLAIM_topcow_seg.tar.gz). Inference here:

  1. the image is reoriented to LPS+ (the challenge's convention: the network's left/right classes follow the array axes);
  2. locate: one model (fold 0, final checkpoint) on the whole volume. On whole heads it also paints scattered vessels, and
     it may break the circle into pieces, so candidate groups are formed after bridging 2 mm gaps, kept only if they hold
     >= 4 arteries and lie within 25 mm of the head's left-right centre, and ranked by the number of arteries, then size
     (the team located the circle with a YOLO detector instead; its weights can only be loaded by unpickling arbitrary
     objects, so it is not used);
  3. segment: all five folds with the best and with the final checkpoints on the candidate's box padded by 15 mm; the two
     softmax maps are averaged (the team's ensemble), argmax, class 13 -> 15 (3rd A2, the challenge's label value). A crop
     is accepted when the result holds the basilar artery and both internal carotid arteries (>= 100 voxels each) and at
     least 8 arteries; otherwise the next candidate is tried (up to 3; the best attempt is kept and flagged);
  4. the crop is pasted into the full LPS volume and mapped back to the input grid (a pure axis permutation/flip; checked).

Checkpoints are read with torch.load(weights_only=True); only numpy scalar/dtype constructors are allow-listed. The
trainer class adds only training-time behaviour, so the network is built from plans.json with nnU-Net's own
build_network_architecture and no code from the image is imported.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import torch
from scipy import ndimage as ndi

WEIGHTS = Path(os.environ.get("RADIOLOGY_COW_WEIGHTS", "C:/Users/kerim/radiology-data/weights/topcow-claim/resources"))
MODEL = WEIGHTS / "ID_6_SUBMISSION_nnUNetTrainerSkeletonRecall_NoMirroring__nnUNetResEncUNetMPlans__3d_fullres"
LABELS = {1: "BA", 2: "R-PCA", 3: "L-PCA", 4: "R-ICA", 5: "R-MCA", 6: "L-ICA", 7: "L-MCA", 8: "R-Pcom", 9: "L-Pcom", 10: "Acom",
          11: "R-ACA", 12: "L-ACA", 15: "3rd-A2"}
PAD_MM = 15.0
SAFE = [np._core.multiarray.scalar, np.dtype, type(np.dtype(np.float64)), type(np.dtype(np.float32)), type(np.dtype(np.int64))]


def _load(path: Path) -> dict:
    with torch.serialization.safe_globals(SAFE):
        return torch.load(path, map_location="cpu", weights_only=True)


def predictor(checkpoint: str, device: torch.device, folds=(0, 1, 2, 3, 4)):
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    from nnunetv2.training.nnUNetTrainer.nnUNetTrainer import nnUNetTrainer
    from nnunetv2.utilities.label_handling.label_handling import determine_num_input_channels
    from nnunetv2.utilities.plans_handling.plans_handler import PlansManager
    plans = json.loads((MODEL / "plans.json").read_text())
    dataset_json = json.loads((MODEL / "dataset.json").read_text())
    pm = PlansManager(plans)
    cm = pm.get_configuration("3d_fullres")
    params, trainer_name = [], None
    for f in folds:
        ck = _load(MODEL / f"fold_{f}" / checkpoint)
        params.append(ck["network_weights"])
        trainer_name = ck["trainer_name"]
    n_in = determine_num_input_channels(pm, cm, dataset_json)
    net = nnUNetTrainer.build_network_architecture(pm, cm, n_in, pm.get_label_manager(dataset_json).num_segmentation_heads,
                                                   enable_deep_supervision=False)
    p = nnUNetPredictor(tile_step_size=0.5, use_gaussian=True, use_mirroring=False, perform_everything_on_device=device.type == "cuda",
                        device=device, verbose=False, verbose_preprocessing=False, allow_tqdm=False)
    p.manual_initialization(net, pm, cm, params, dataset_json, trainer_name, None)
    return p


def load_models(device: str) -> dict:
    dev = torch.device(device)
    return {"locate": predictor("checkpoint_final.pth", dev, folds=(0,)),
            "best": predictor("checkpoint_best.pth", dev), "final": predictor("checkpoint_final.pth", dev)}


def _probs(p, arr_xyz: np.ndarray, spacing_xyz) -> np.ndarray:
    data = arr_xyz.transpose(2, 1, 0)[None].astype(np.float32)  # (c, z, y, x), as SimpleITKIO gives it
    props = {"spacing": [float(spacing_xyz[2]), float(spacing_xyz[1]), float(spacing_xyz[0])]}
    _, prob = p.predict_single_npy_array(data, props, None, None, True)
    return prob.astype(np.float32)  # (classes, z, y, x)


MAX_TRIES = 3
MIDLINE_MM = 25.0


def candidates(loc_lab: np.ndarray, arr: np.ndarray, sp) -> list[dict]:
    """Groups of first-pass labels that could be the circle, best first. Gaps of up to 2 mm are bridged (the first pass
    often breaks the circle into pieces); a group must hold >= 4 different arteries (>= 30 voxels each) and lie within
    MIDLINE_MM of the head's left-right centre; ranked by the number of arteries, then size."""
    sp = np.asarray(sp, float)
    head = arr > 0.1 * np.percentile(arr, 99.5)
    mid = float(np.argwhere(head)[:, 0].mean())
    merged = ndi.binary_dilation(loc_lab > 0, iterations=int(np.ceil(2.0 / sp.min())))
    lab, n = ndi.label(merged, structure=np.ones((3, 3, 3), bool))
    out = []
    for k, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None:
            continue
        m = (lab[sl] == k) & (loc_lab[sl] > 0)
        size = int(m.sum())
        if size < 200:
            continue
        _, cnt = np.unique(loc_lab[sl][m], return_counts=True)
        labels = int((cnt >= 30).sum())
        ijk = np.argwhere(m) + np.array([s.start for s in sl])
        off = abs(float(ijk[:, 0].mean()) - mid) * sp[0]
        if labels >= 4 and off < MIDLINE_MM:
            out.append({"labels": labels, "voxels": size, "offsetMm": round(off, 1), "lo": ijk.min(0), "hi": ijk.max(0)})
    out.sort(key=lambda c: (-c["labels"], -c["voxels"]))
    return out


def segment(src: Path, dst: Path, device: str = "cuda:0", models: dict | None = None) -> dict:
    t0 = time.time()
    models = models or load_models(device)
    img = sitk.ReadImage(str(src), sitk.sitkFloat32)
    lps = sitk.DICOMOrient(img, "LPS")
    sp = lps.GetSpacing()
    arr = sitk.GetArrayFromImage(lps).transpose(2, 1, 0)  # (x, y, z) index order, x -> patient left
    # 1. locate: candidate groups of the first pass, best first
    loc_lab = _probs(models["locate"], arr, sp).argmax(0).transpose(2, 1, 0)
    cands = candidates(loc_lab, arr, sp)
    if not cands:
        raise RuntimeError(f"{src}: no Circle-of-Willis candidate found")
    pad = np.ceil(PAD_MM / np.asarray(sp)).astype(int)
    tried, chosen = [], None
    # 2. segment each candidate crop until the result holds the basilar artery and both internal carotid arteries
    for cand in cands[:MAX_TRIES]:
        lo = np.maximum(cand["lo"] - pad, 0)
        hi = np.minimum(cand["hi"] + pad + 1, arr.shape)
        sub = arr[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        prob = (_probs(models["best"], sub, sp) + _probs(models["final"], sub, sp)) / 2.0
        seg = prob.argmax(0).astype(np.uint8).transpose(2, 1, 0)
        seg[seg == 13] = 15
        vals, cnt = np.unique(seg[seg > 0], return_counts=True)
        counts = {int(v): int(c) for v, c in zip(vals, cnt)}
        ok = all(counts.get(v, 0) >= 100 for v in (1, 4, 6)) and sum(1 for c in counts.values() if c >= 30) >= 8
        rec = {"lo": lo.tolist(), "hi": hi.tolist(), "labels": cand["labels"], "voxels": cand["voxels"],
               "midlineOffsetMm": cand["offsetMm"], "accepted": bool(ok), "classesFound": sum(1 for c in counts.values() if c >= 30)}
        tried.append(rec)
        if chosen is None or (ok and not chosen[0]["accepted"]) or (not chosen[0]["accepted"] and rec["classesFound"] > chosen[0]["classesFound"]):
            chosen = (rec, seg, lo, hi)
        if ok:
            break
    crop, seg, lo, hi = chosen
    crop = {**crop, "candidates": len(cands), "tried": tried}
    full = np.zeros(arr.shape, np.uint8)
    full[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = seg
    out_lps = sitk.GetImageFromArray(full.transpose(2, 1, 0))
    out_lps.CopyInformation(lps)
    back = sitk.Resample(out_lps, img, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8)
    assert int((sitk.GetArrayFromImage(back) > 0).sum()) == int((full > 0).sum()), "orientation round trip lost voxels"
    dst.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(back, str(dst), useCompression=True)
    vals, cnt = np.unique(full[full > 0], return_counts=True)
    return {"input": str(src), "output": str(dst), "device": device, "crop": crop, "seconds": round(time.time() - t0, 1),
            "voxelsPerClass": {LABELS[int(v)]: int(c) for v, c in zip(vals, cnt)}, "model": MODEL.name,
            "ensemble": "5 folds x (checkpoint_best + checkpoint_final), softmax averaged; located with fold 0 final"}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dev = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--device=")), "cuda:0")
    if len(args) != 2:
        raise SystemExit(__doc__)
    print(json.dumps(segment(Path(args[0]), Path(args[1]), dev), indent=1))
