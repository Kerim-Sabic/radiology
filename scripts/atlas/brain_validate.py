"""Validation of the brain anatomy layer against manual labels: the 20 OASIS-TRT-20 brains of Mindboggle-101.

  venv-gpu python scripts/atlas/brain_validate.py run [--shard=i/n] [--res=1|2]   (CUDA_VISIBLE_DEVICES=0 / 1, one queue per GPU)
  venv-gpu python scripts/atlas/brain_validate.py analyse                        -> work/brain-validate/validation-summary.json

Data (outside the repo, never committed): C:/Users/kerim/radiology-data/downloads/mindboggle
  OASIS-TRT-20_volumes/<subj>/t1weighted_brain.nii.gz           (Harvard Dataverse file 3392553, CC BY 4.0)
  OASIS-TRT-20_DKT31_CMA_labels_v2/<subj>_DKT31_CMA_labels.nii.gz (file 2806916): cortex labelled by hand with the DKT31
      protocol (Klein & Tourville 2012) and non-cortical structures labelled by hand by Neuromorphometrics (CMA protocol),
      in each brain's own space; CC BY-NC-ND 4.0 (only read here; nothing derived is published).
The brain model's authors used OASIS-TRT-20 only as a test set (Fortin et al., arXiv:2601.09006, section 2.1.1), so these
brains were never seen in training.

Same code as the published layer: brain_segment.segment() and mr_brain_contours.build_structures() + largest part (rule 1).
`--res=2` resamples the T1 to 2 mm (as the ISLES DWI/ADC grids), segments it, and compares on the 1 mm grid of the labels
(nearest neighbour), so the numbers include the loss from the coarse grid.
Lobes: the manual labels have no white-matter label, so lobes are compared on their cortex (the DKT parcels of the lobe);
the white matter added to a lobe in the layer (nearest cortex) is not validated. Cerebellum: the manual vermis (labels
630-632) is not part of either hemisphere there, so vermis voxels are left out of both sides before comparing.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

from mr_brain_contours import CINGULATE, DKT, GYRI, LOBES, build_structures, largest

DATA = Path("C:/Users/kerim/radiology-data/downloads/mindboggle")
OUT = Path("C:/Users/kerim/radiology-data/work/brain-validate")
SUBJECTS = [f"OASIS-TRT-20-{i}" for i in range(1, 21)]
# FreeSurfer / CMA label numbers of the manual maps
FS = {"lateral_ventricle": ((4, 5), (43, 44)), "thalamus": ((10,), (49,)), "caudate_nucleus": ((11,), (50,)), "putamen": ((12,), (51,)),
      "globus_pallidus": ((13,), (52,)), "hippocampus": ((17,), (53,)), "amygdala": ((18,), (54,)), "cerebellum": ((6, 7, 8), (45, 46, 47))}
VERMIS = (630, 631, 632)
MID = {"third_ventricle": (14,), "fourth_ventricle": (15,), "brainstem": (16,)}
DKT_FS = {"caudalanteriorcingulate": 2, "caudalmiddlefrontal": 3, "cuneus": 5, "entorhinal": 6, "fusiform": 7, "inferiorparietal": 8,
          "inferiortemporal": 9, "isthmuscingulate": 10, "lateraloccipital": 11, "lateralorbitofrontal": 12, "lingual": 13,
          "medialorbitofrontal": 14, "middletemporal": 15, "parahippocampal": 16, "paracentral": 17, "parsopercularis": 18,
          "parsorbitalis": 19, "parstriangularis": 20, "pericalcarine": 21, "postcentral": 22, "posteriorcingulate": 23, "precentral": 24,
          "precuneus": 25, "rostralanteriorcingulate": 26, "rostralmiddlefrontal": 27, "superiorfrontal": 28, "superiorparietal": 29,
          "superiortemporal": 30, "supramarginal": 31, "transversetemporal": 34, "insula": 35}
assert set(DKT_FS) == set(DKT)


def expert_structures(lab: np.ndarray) -> dict[str, np.ndarray]:
    out = {}
    for side, base in (("left", 1000), ("right", 2000)):
        k = 0 if side == "left" else 1
        ids = lambda names: [base + DKT_FS[n] for n in names]  # noqa: E731
        for lb, names in LOBES.items():
            out[f"{lb}_lobe_{side}"] = np.isin(lab, ids(names))
        out[f"insula_{side}"] = np.isin(lab, ids(["insula"]))
        out[f"cingulate_gyrus_{side}"] = np.isin(lab, ids(CINGULATE))
        for g, names in GYRI.items():
            out[f"{g}_{side}"] = np.isin(lab, ids(names))
        for name, pair in FS.items():
            out[f"{name}_{side}"] = np.isin(lab, pair[k])
    for name, v in MID.items():
        out[name] = np.isin(lab, v)
    return out


def ours_cortex_lobes(parc: np.ndarray) -> dict[str, np.ndarray]:
    from mr_brain_contours import parcel_ids
    return {f"{lb}_lobe_{side}": np.isin(parc, parcel_ids(names, side)) for side in ("left", "right") for lb, names in LOBES.items()}


def run(argv):
    import SimpleITK as sitk
    from brain_segment import load_models, segment
    shard = next((a.split("=")[1] for a in argv if a.startswith("--shard=")), "0/1")
    i, n = map(int, shard.split("/"))
    res = int(next((a.split("=")[1] for a in argv if a.startswith("--res=")), "1"))
    models = load_models("cuda:0")
    for subj in SUBJECTS[i::n]:
        od = OUT / f"res{res}" / subj
        if (od / "seg_parc.nii.gz").exists():
            continue
        od.mkdir(parents=True, exist_ok=True)
        src = DATA / "OASIS-TRT-20_volumes" / subj / "t1weighted_brain.nii.gz"
        if res != 1:
            img = sitk.ReadImage(str(src))
            sp = img.GetSpacing()
            size = [int(round(img.GetSize()[k] * sp[k] / res)) for k in range(3)]
            low = sitk.Resample(img, size, sitk.Transform(), sitk.sitkLinear, img.GetOrigin(), (float(res),) * 3, img.GetDirection(), 0.0,
                                sitk.sitkFloat32)
            src = od / "t1_low.nii.gz"
            sitk.WriteImage(low, str(src))
        r = segment(src, od, "cuda:0", models)
        print(subj, res, r.get("seconds"), flush=True)


def to_label_grid(path: Path, ref: nib.Nifti1Image) -> np.ndarray:
    """A label map resampled (nearest neighbour) onto the grid of `ref`."""
    from scipy.ndimage import map_coordinates
    img = nib.load(str(path))
    a = np.asarray(img.dataobj)
    if img.shape == ref.shape and np.allclose(img.affine, ref.affine, atol=1e-3):
        return a.astype(np.int16)
    ijk = np.indices(ref.shape).reshape(3, -1)
    xyz = ref.affine @ np.vstack([ijk, np.ones(ijk.shape[1])])
    src = np.linalg.inv(img.affine) @ xyz
    return map_coordinates(a, src[:3], order=0, mode="constant", cval=0).reshape(ref.shape).astype(np.int16)


def dice(a, b):
    s = a.sum() + b.sum()
    return float(2 * (a & b).sum() / s) if s else float("nan")


def analyse():
    summary = {}
    for res_dir in sorted(OUT.glob("res*")):
        rows = {}
        for subj in SUBJECTS:
            od = res_dir / subj
            if not (od / "seg_parc.nii.gz").exists():
                continue
            ref = nib.load(str(DATA / "OASIS-TRT-20_DKT31_CMA_labels_v2" / f"{subj}_DKT31_CMA_labels.nii.gz"))
            lab = np.asarray(ref.dataobj).astype(np.int32)
            seg = to_label_grid(od / "seg_brain.nii.gz", ref)
            parc = to_label_grid(od / "seg_parc.nii.gz", ref)
            zooms = ref.header.get_zooms()[:3]
            ours = build_structures(seg, parc, zooms)
            ours.update(ours_cortex_lobes(parc))
            exp = expert_structures(lab)
            verm = np.isin(lab, VERMIS)
            for cid, e in exp.items():
                o = largest(ours[cid]) if ours[cid].any() else ours[cid]
                if cid.startswith("cerebellum"):
                    o, e = o & ~verm, e & ~verm
                rows.setdefault(cid, []).append(dice(o, e))
            # side check: each lateral structure overlaps its own side's expert label more than the other side's
            for cid in [c for c in exp if c.endswith("_left")]:
                other = cid[:-5] + "_right"
                o = ours[cid]
                rows.setdefault("_swapped", []).append(int(dice(o, exp[other]) > dice(o, exp[cid])))
        def group(cid):
            return cid.rsplit("_", 1)[0] if cid.endswith(("_left", "_right")) else cid
        per = {}
        for cid, v in rows.items():
            if cid.startswith("_"):
                continue
            per.setdefault(group(cid), []).extend(v)
        summary[res_dir.name] = {
            "subjects": len({s for s in SUBJECTS if (res_dir / s / "seg_parc.nii.gz").exists()}),
            "diceMedian": {k: round(float(np.nanmedian(v)), 3) for k, v in per.items()},
            "diceP10": {k: round(float(np.nanpercentile(v, 10)), 3) for k, v in per.items()},
            "diceMin": {k: round(float(np.nanmin(v)), 3) for k, v in per.items()},
            "sideSwaps": int(sum(rows.get("_swapped", []))),
            "perStructure": {k: [round(x, 4) for x in v] for k, v in rows.items() if not k.startswith("_")},
        }
        print(res_dir.name, summary[res_dir.name]["subjects"], json.dumps(summary[res_dir.name]["diceMedian"]))
    # Ceiling of a 2 mm grid: the manual labels themselves taken to 2 mm (nearest) and back, scored on the 1 mm labels.
    if (OUT / "res2").exists():
        import SimpleITK as sitk
        rows = {}
        for subj in SUBJECTS:
            f = DATA / "OASIS-TRT-20_DKT31_CMA_labels_v2" / f"{subj}_DKT31_CMA_labels.nii.gz"
            img = sitk.ReadImage(str(f))
            sp = img.GetSpacing()
            size = [int(round(img.GetSize()[k] * sp[k] / 2)) for k in range(3)]
            low = sitk.Resample(img, size, sitk.Transform(), sitk.sitkNearestNeighbor, img.GetOrigin(), (2.0,) * 3, img.GetDirection(), 0, img.GetPixelID())
            back = sitk.GetArrayFromImage(sitk.Resample(low, img, sitk.Transform(), sitk.sitkNearestNeighbor, 0)).transpose(2, 1, 0)
            lab = sitk.GetArrayFromImage(img).transpose(2, 1, 0)
            e1, e2 = expert_structures(lab), expert_structures(back)
            verm = np.isin(lab, VERMIS)
            for cid in e1:
                a, b = e1[cid], e2[cid]
                if cid.startswith("cerebellum"):
                    a, b = a & ~verm, b & ~verm
                rows.setdefault(cid.rsplit("_", 1)[0] if cid.endswith(("_left", "_right")) else cid, []).append(dice(a, b))
        summary["res2Ceiling"] = {"subjects": len(SUBJECTS), "diceMedian": {k: round(float(np.median(v)), 3) for k, v in rows.items()},
                                  "diceP10": {k: round(float(np.percentile(v, 10)), 3) for k, v in rows.items()},
                                  "diceMin": {k: round(float(np.min(v)), 3) for k, v in rows.items()}, "sideSwaps": 0, "perStructure": {}}
        print("res2Ceiling", json.dumps(summary["res2Ceiling"]["diceMedian"]))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "validation-summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(sys.argv[2:])
    else:
        analyse()
