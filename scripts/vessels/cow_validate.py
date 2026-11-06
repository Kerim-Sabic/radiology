"""Validate the Circle-of-Willis AI outlines (cow_segment.py + cow_post.py) against the TopCoW expert masks.

  set CUDA_VISIBLE_DEVICES=0 & venv-gpu python scripts/vessels/cow_validate.py run <work dir> <TopCoW extract dir> --shard=0/2
  set CUDA_VISIBLE_DEVICES=1 & venv-gpu python scripts/vessels/cow_validate.py run <work dir> <TopCoW extract dir> --shard=1/2
  venv-gpu python scripts/vessels/cow_validate.py analyse <work dir> <TopCoW extract dir> <out.json>

`run` segments the 40 TopCoW external-test MRAs (20 Lausanne controls, 20 IXI-HH; imagesTr, LPS) with exactly the atlas's
segment() into <work dir>/<site>/<stem>_ai.nii.gz. `analyse` applies the atlas post-processing and reports:
  * Dice per artery inside the expert ROI box (the challenge's evaluation region);
  * confusion: share of each AI artery's voxels that touch an expert voxel of a DIFFERENT artery and none of the same
    artery (a wrong name, not a different extent);
  * the AI's Acom / Pcom / 3rd-A2 shown (kept by QC) against the expert's "present" labels;
  * the TOF signal score q (mr_contours.tof_q) of the expert masks and of the AI masks, to set QC rule 2;
  * which cases were inside the model's training folds (listed in the model's validation folders).
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "atlas"))
import cow_post as P  # noqa: E402

FULL = np.ones((3, 3, 3), bool)
SMALL = {"R-Pcom", "L-Pcom", "Acom", "3rd-A2"}


def tof_q(sig, mask, head):
    h50, h995 = np.percentile(sig[head], [50, 99.5])
    return float((np.median(sig[mask]) - h50) / max(h995 - h50, 1e-6))


def head_mask(sig):
    t = 0.1 * np.percentile(sig, 99.5)
    m = sig > t
    lab, n = ndi.label(m)
    if n > 1:
        m = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
    for k in range(m.shape[2]):
        m[:, :, k] = ndi.binary_fill_holes(m[:, :, k])
    return m


def main(work: Path, topcow: Path, out: Path, trained: set[str]):
    rows = []
    for site in ("Lausanne", "IXI_HH"):
        for ai_f in sorted((work / site).glob("*_ai.nii.gz")):
            stem = ai_f.name[:-len("_ai.nii.gz")]
            key = stem.split("_")[0] if site == "Lausanne" else stem.split("-")[0]
            base = topcow / f"MRA_{site}"
            img_f = glob.glob(str(base / "imagesTr" / f"{stem}*"))[0]
            lab_f = glob.glob(str(base / "cow_seg_labelsTr" / f"{stem}*"))[0]
            t = open(glob.glob(str(base / "roi_loc_labelsTr" / f"{stem}*"))[0]).read()
            size = [int(v) for v in re.search(r"Size \(Voxels\):\s*([\d ]+)", t).group(1).split()]
            loc = [int(v) for v in re.search(r"Location \(Voxels\):\s*([\d ]+)", t).group(1).split()]
            edges = {k: int(v) for k, v in re.findall(r"([\w-]+):\s+(\d)", open(glob.glob(str(base / "antpos_edges_labelsTr" / f"{stem}*"))[0]).read())}
            img = sitk.ReadImage(img_f, sitk.sitkFloat32)
            sig = sitk.GetArrayFromImage(img).transpose(2, 1, 0)
            lab = sitk.GetArrayFromImage(sitk.ReadImage(lab_f)).transpose(2, 1, 0)
            raw = sitk.GetArrayFromImage(sitk.ReadImage(str(ai_f))).transpose(2, 1, 0)
            res, qc = P.postprocess(raw.astype(np.int16), img)
            ai = res.get("classes", {})
            roi = np.zeros(sig.shape, bool)
            roi[loc[0]:loc[0] + size[0], loc[1]:loc[1] + size[1], loc[2]:loc[2] + size[2]] = True
            head = head_mask(sig)
            r = {"case": stem, "site": site, "inTraining": key in trained, "dice": {}, "confusion": {}, "qExpert": {}, "qAi": {},
                 "dropped": qc.get("dropped", {}), "notSplit": qc.get("notSplit", {}), "parts": qc.get("parts", {}), "edges": edges}
            exp = {n: lab == v for v, n in P.NAMES.items() if (lab == v).any()}
            any_exp = lab > 0
            for n in sorted(set(exp) | set(ai)):
                x = ai.get(n, np.zeros(sig.shape, bool))
                y = exp.get(n, np.zeros(sig.shape, bool))
                xr, yr = x & roi, y & roi
                if xr.any() or yr.any():
                    r["dice"][n] = round(float(2 * (xr & yr).sum() / max(xr.sum() + yr.sum(), 1)), 3)
                if x.any():
                    near_same = ndi.binary_dilation(y, structure=FULL) if y.any() else np.zeros_like(y)
                    near_other = ndi.binary_dilation(any_exp & ~y, structure=FULL)
                    r["confusion"][n] = round(float((x & near_other & ~near_same).sum() / x.sum()), 3)
                    r["qAi"][n] = round(tof_q(sig, x, head), 3)
                if y.any():
                    r["qExpert"][n] = round(tof_q(sig, y, head), 3)
            r["shown"] = {e: (e in ai) for e in ("Acom", "R-Pcom", "L-Pcom", "3rd-A2")}
            r["expertPresent"] = {"Acom": edges["Acom"], "R-Pcom": edges["R-Pcom"], "L-Pcom": edges["L-Pcom"], "3rd-A2": edges["3rd-A2"]}
            rows.append(r)
            print(stem, r["inTraining"], {k: v for k, v in r["dice"].items()}, "conf>0.05:", {k: v for k, v in r["confusion"].items() if v > 0.05},
                  "dropped:", r["dropped"], flush=True)
    # summary
    summ = {}
    for subset, sel in (("unseen", [r for r in rows if not r["inTraining"]]), ("all", rows)):
        s = {"cases": len(sel), "dicePerArtery": {}, "confusionPerArtery": {}, "presence": {}}
        for n in P.NAMES.values():
            ds = [r["dice"][n] for r in sel if n in r["dice"]]
            cs = [r["confusion"][n] for r in sel if n in r["confusion"]]
            if ds:
                s["dicePerArtery"][n] = {"median": round(float(np.median(ds)), 3), "min": round(float(np.min(ds)), 3), "n": len(ds)}
            if cs:
                s["confusionPerArtery"][n] = {"median": round(float(np.median(cs)), 3), "max": round(float(np.max(cs)), 3)}
        for e in ("Acom", "R-Pcom", "L-Pcom", "3rd-A2"):
            tp = sum(1 for r in sel if r["shown"][e] and r["expertPresent"][e])
            fp = sum(1 for r in sel if r["shown"][e] and not r["expertPresent"][e])
            fn = sum(1 for r in sel if not r["shown"][e] and r["expertPresent"][e])
            tn = sum(1 for r in sel if not r["shown"][e] and not r["expertPresent"][e])
            s["presence"][e] = {"bothPresent": tp, "aiOnly": fp, "expertOnly": fn, "bothAbsent": tn}
        summ[subset] = s
    qe = {"large": [], "small": []}
    for r in rows:
        for n, q in r["qExpert"].items():
            qe["small" if n in SMALL else "large"].append(q)
    summ["qExpert"] = {g: {"min": round(float(np.min(v)), 3), "p01": round(float(np.percentile(v, 1)), 3), "median": round(float(np.median(v)), 3)}
                       for g, v in qe.items() if v}
    json.dump({"summary": summ, "cases": rows}, open(out, "w"), indent=1)
    print(json.dumps(summ, indent=1))


# Cases inside the model's training folds (named in the validation folders of the team's model, fold_*/validation).
TRAINED = set(("sub-000 sub-002 sub-006 sub-007 sub-015 sub-030 sub-033 sub-047 sub-100 sub-109 sub-116 sub-119 sub-134 sub-162 "
               "sub-164 sub-172 sub-175 sub-176 sub-183 sub-185 sub-339 sub-344 sub-353").split()
              + [f"IXI{n}" for n in (565, 566, 567, 572, 575, 577, 580, 587, 588, 591, 592, 595, 596, 597, 601, 603, 605, 607, 610, 611,
                                     613, 616, 617, 619, 622, 625, 626, 627, 629, 632, 633, 635, 636, 637, 638, 639, 640, 642, 643,
                                     646, 652, 653, 661, 662)])


def run(work: Path, topcow: Path, shard: str) -> None:
    import cow_segment
    i, n = (int(x) for x in shard.split("/"))
    todo = [(site, f) for site in ("Lausanne", "IXI_HH") for f in sorted((topcow / f"MRA_{site}" / "imagesTr").glob("*.nii.gz"))]
    models = None
    for k, (site, f) in enumerate(todo):
        if k % n != i:
            continue
        stem = f.name.split("_angio")[0].split("-MRA")[0] if site == "Lausanne" else f.name.split("-MRA")[0]
        dst = work / site / f"{stem}_ai.nii.gz"
        dst.parent.mkdir(parents=True, exist_ok=True)
        models = models or cow_segment.load_models("cuda:0")
        info = cow_segment.segment(f, dst, "cuda:0", models)
        print(stem, info["seconds"], info["crop"].get("locateCircleLabels"), flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(Path(sys.argv[2]), Path(sys.argv[3]), next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--shard=")), "0/1"))
    else:
        main(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), TRAINED)
