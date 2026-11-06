"""Brain anatomy on MRI of any contrast and resolution with GOUHFI 2.0 (subcortical segmentation + DKT cortex parcellation).

  venv-gpu python scripts/atlas/brain_segment.py <in.nii.gz> <out_dir> [--device=cuda:0|cpu] [--no-parc]

OFFLINE tooling; outputs are unreviewed AI drafts. Model: GOUHFI 2.0 (Fortin et al., arXiv:2601.09006; Apache-2.0; Zenodo
17920473), nnU-Net v2 ResEnc-L trained on synthetic images (domain randomisation, as SynthSeg), fold 0 of each model.
Steps, as the authors' `run_gouhfi` (github.com/mafortin/GOUHFI, run_inference/gouhfi_inference_postpro_reo.py):
  1. conform: reorient to LIA and rescale intensities linearly from the 0.5th-99.5th percentiles to 0-255
     (data_utils/conform_images.py); brain extraction is left out (see the report: the models were run on the images as
     they are; ISLES images are already skull-stripped);
  2. segmentation model (Dataset020, 35 FreeSurfer-style labels), checkpoint_best;
  3. post-processing: per label, the largest 26-connected part (the authors' nnU-Net post-processing file is a pickle and
     is not loaded; it applies the same kind of largest-component rule);
  4. parcellation model (Dataset024, input = the two cortex labels 2 and 21 only, no normalisation) -> 62 DKT gyri;
  5. both maps reoriented back to the input grid (a pure axis permutation/flip; checked).
Checkpoints are read with torch.load(weights_only=True) (numpy scalar/dtype constructors allow-listed).
Writes <out_dir>/seg_brain.nii.gz, seg_parc.nii.gz and brain_run.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
from nibabel.orientations import apply_orientation, axcodes2ornt, inv_ornt_aff, io_orientation, ornt_transform
from scipy import ndimage as ndi

WEIGHTS = Path(os.environ.get("RADIOLOGY_GOUHFI_WEIGHTS", "C:/Users/kerim/radiology-data/weights/gouhfi"))
SEG_MODEL = WEIGHTS / "Dataset020_gouhfi_2p0n2" / "my_nnUNetTrainer_GOUHFI__plans-resencl-gouhfi-2p0n2__3d_fullres"
PARC_MODEL = WEIGHTS / "Dataset024_gouhfi_parc" / "my_trainer_gouhfi_parc__plans-resencl-3dlin-nonorm__3d_fullres"
SAFE = [np._core.multiarray.scalar, (np._core.multiarray.scalar, "numpy.core.multiarray.scalar"), np.dtype,
        type(np.dtype(np.float64)), type(np.dtype(np.float32)), type(np.dtype(np.int64))]


def predictor(model_dir: Path, device: torch.device, folds=(0,)):
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    from nnunetv2.training.nnUNetTrainer.nnUNetTrainer import nnUNetTrainer
    from nnunetv2.utilities.label_handling.label_handling import determine_num_input_channels
    from nnunetv2.utilities.plans_handling.plans_handler import PlansManager
    plans = json.loads((model_dir / "plans.json").read_text())
    dataset_json = json.loads((model_dir / "dataset.json").read_text())
    pm = PlansManager(plans)
    cm = pm.get_configuration("3d_fullres")
    params, trainer_name, mirror = [], None, None
    for f in folds:
        with torch.serialization.safe_globals(SAFE):
            ck = torch.load(model_dir / f"fold_{f}" / "checkpoint_best.pth", map_location="cpu", weights_only=True)
        params.append(ck["network_weights"])
        trainer_name, mirror = ck["trainer_name"], ck.get("inference_allowed_mirroring_axes")
    net = nnUNetTrainer.build_network_architecture(pm, cm, determine_num_input_channels(pm, cm, dataset_json),
                                                   pm.get_label_manager(dataset_json).num_segmentation_heads, enable_deep_supervision=False)
    p = nnUNetPredictor(tile_step_size=0.5, use_gaussian=True, use_mirroring=bool(mirror), perform_everything_on_device=device.type == "cuda",
                        device=device, verbose=False, verbose_preprocessing=False, allow_tqdm=False)
    p.manual_initialization(net, pm, cm, params, dataset_json, trainer_name, mirror)
    return p, dataset_json


def load_models(device: str) -> dict:
    dev = torch.device(device)
    return {"seg": predictor(SEG_MODEL, dev), "parc": predictor(PARC_MODEL, dev)}


def to_lia(img):
    data = np.asanyarray(img.dataobj).astype(np.float32)
    tr = ornt_transform(io_orientation(img.affine), axcodes2ornt(("L", "I", "A")))
    return apply_orientation(data, tr), img.affine @ inv_ornt_aff(tr, data.shape), tr


def from_lia(arr, img, tr):
    back = ornt_transform(axcodes2ornt(("L", "I", "A")), io_orientation(img.affine))
    out = apply_orientation(arr, back)
    assert out.shape == img.shape[:3], (out.shape, img.shape)
    return out


def rescale(a, lo_p=0.5, hi_p=99.5):
    lo, hi = np.percentile(a, [lo_p, hi_p])
    if hi <= lo:
        return np.zeros_like(a, np.float32)
    return ((np.clip(a, lo, hi) - lo) / (hi - lo) * 255.0).astype(np.float32)


def largest_per_label(seg: np.ndarray) -> np.ndarray:
    out = np.zeros_like(seg)
    for v in np.unique(seg):
        if v == 0:
            continue
        m = seg == v
        lab, n = ndi.label(m, structure=np.ones((3, 3, 3), bool))
        if n > 1:
            m = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
        out[m] = v
    return out


def _run(p, data_xyz, spacing_xyz):
    props = {"spacing": [float(spacing_xyz[2]), float(spacing_xyz[1]), float(spacing_xyz[0])]}
    seg = p.predict_single_npy_array(data_xyz.transpose(2, 1, 0)[None].astype(np.float32), props, None, None, False)
    return np.asarray(seg).transpose(2, 1, 0)


def segment(src: Path, out_dir: Path, device: str = "cuda:0", models: dict | None = None, parc: bool = True) -> dict:
    t0 = time.time()
    models = models or load_models(device)
    img = nib.load(str(src))
    lia, aff, tr = to_lia(img)
    sp = np.sqrt((aff[:3, :3] ** 2).sum(0))
    x = rescale(lia)
    seg = largest_per_label(_run(models["seg"][0], x, sp).astype(np.int16))
    out_dir.mkdir(parents=True, exist_ok=True)
    seg_back = from_lia(seg, img, tr).astype(np.int16)
    nib.save(nib.Nifti1Image(seg_back, img.affine), str(out_dir / "seg_brain.nii.gz"))
    info = {"input": str(src), "device": device, "segLabels": int(len(np.unique(seg)) - 1), "spacing": [round(float(v), 3) for v in sp]}
    if parc:
        ctx = np.where(np.isin(seg, (2, 21)), seg, 0).astype(np.float32)
        pc = largest_per_label(_run(models["parc"][0], ctx, sp).astype(np.int16))
        pc[~np.isin(seg, (2, 21))] = 0  # parcels only on the cortex of the segmentation
        nib.save(nib.Nifti1Image(from_lia(pc, img, tr).astype(np.int16), img.affine), str(out_dir / "seg_parc.nii.gz"))
        info["parcLabels"] = int(len(np.unique(pc)) - 1)
    info["seconds"] = round(time.time() - t0, 1)
    info["model"] = "GOUHFI 2.0 fold 0 (Dataset020 segmentation" + (", Dataset024 parcellation)" if parc else ")")
    (out_dir / "brain_run.json").write_text(json.dumps(info, indent=1))
    return info


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dev = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--device=")), "cuda:0")
    if len(args) != 2:
        raise SystemExit(__doc__)
    print(json.dumps(segment(Path(args[0]), Path(args[1]), dev, parc="--no-parc" not in sys.argv), indent=1))
