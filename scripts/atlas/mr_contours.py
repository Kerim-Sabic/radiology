"""Atlas step MR-3: Circle-of-Willis masks -> QC -> per-slice image_px contours on the ORIGINAL TOF slices.

  venv-gpu python scripts/atlas/mr_contours.py [case ...]

Input per case (WORK_MR/<case>/): mr.nii.gz + slices.json (mr_convert.py), seg_cow_raw.nii.gz (mr_run_cow.py).
QC, recorded per structure in cow_structures.json:
  rule 0  mapping: segmentation grid identical to mr.nii.gz; NIfTI affine (RAS->LPS) vs DICOM IPP/IOP/PixelSpacing of the
          matched SOP for sampled voxels < 0.5 mm (oblique grids included)
  rule 1  fragments: largest 26-connected part per artery inside the teaching box (scripts/vessels/cow_post.py); < 3 mm3 dropped
  rule 2  TOF signal (instead of HU): the median signal inside an artery must reach TOF_MIN_SIGNAL of the head's bright end
          (flowing blood is bright on TOF), calibrated on the expert masks of the 40 TopCoW MRAs (docs/data report)
  rule 4  side and order: lateral arteries on their side of the midline (>= 90 % of voxels), right ACA right of the left ACA;
          contacts between arteries (cow_post.py) - a communicating artery that does not join both ends is not shown
  parts   A1/A2, P1/P2, M1/M2 where the junction exists (cow_post.py); parts replace their whole artery
Contours: mask[:, :, k].T is the (row, col) image of SOP slices[k]; skimage find_contours (0.5) on a zero-padded copy,
Douglas-Peucker 0.35 px (below half a pixel: the rasterised outline keeps the same pixels), components < 2 px dropped.
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
import SimpleITK as sitk
from scipy import ndimage as ndi
from skimage import measure

from common import RAS_TO_LPS, REPO, dicom_pixel_to_lps, dump_json, dump_json_compact, load_json, ring_area
from mr_common import SMALL_VESSELS, WORK_MR, cow_class_id, cow_label

sys.path.insert(0, str(REPO / "scripts" / "vessels"))
import cow_post as P  # noqa: E402

RULES_VERSION = 1
DP_TOL_PX = 0.35
MIN_COMPONENT_PX = 2
# Rule 2 thresholds on q = (median signal in the artery - head median) / (head 99.5th percentile - head median), set from the
# expert masks of the 40 TopCoW MRAs (scripts/vessels/cow_validate.py): lowest expert value 1.03 for the main arteries and
# 0.57 for the communicating arteries / third A2, minus a margin.
TOF_MIN_SIGNAL = {"large": 0.80, "small": 0.40}


def tof_q(sig: np.ndarray, mask: np.ndarray, head: np.ndarray) -> float:
    h50, h995 = np.percentile(sig[head], [50, 99.5])
    return float((np.median(sig[mask]) - h50) / max(h995 - h50, 1e-6))


def head_mask(sig: np.ndarray) -> np.ndarray:
    """Voxels of the head (signal above a tenth of the 99.5th percentile, largest part, holes filled per slice)."""
    t = 0.1 * np.percentile(sig, 99.5)
    m = sig > t
    lab, n = ndi.label(m)
    if n > 1:
        m = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
    for k in range(m.shape[2]):
        m[:, :, k] = ndi.binary_fill_holes(m[:, :, k])
    return m


def trace_slice(m2: np.ndarray) -> tuple[list, list]:
    lab, n = ndi.label(m2, structure=np.ones((3, 3), bool))
    polys, holes = [], []
    for c in range(1, n + 1):
        comp = lab == c
        if comp.sum() < MIN_COMPONENT_PX:
            continue
        filled = ndi.binary_fill_holes(comp)
        for ring_src, dst in ((filled, polys), (filled & ~comp, holes)):
            if not ring_src.any():
                continue
            hl, nh = ndi.label(ring_src) if dst is holes else (ring_src.astype(int), 1)
            for h in range(1, nh + 1):
                part = hl == h
                if dst is holes and part.sum() < MIN_COMPONENT_PX:
                    continue
                cs = measure.find_contours(np.pad(part.astype(np.float32), 1), 0.5, fully_connected="low")
                if not cs:
                    continue
                cc = max(cs, key=len) - 1.0
                if not np.allclose(cc[0], cc[-1]):
                    cc = np.vstack([cc, cc[:1]])
                s = measure.approximate_polygon(cc, tolerance=DP_TOL_PX)
                if len(s) < 4:
                    continue
                ring = [[round(float(p[1]), 2), round(float(p[0]), 2)] for p in s]
                if ring_area(ring) > 0.5:
                    dst.append(ring)
    return polys, holes


def rasterize_planes(planes: list, shape, slices: list) -> np.ndarray:
    """Pixels whose centres lie inside the outline (even-odd with holes), on the (x, y, z) = (col, row, k) grid."""
    from skimage.draw import polygon
    k_of = {s["sopInstanceUid"]: s["k"] for s in slices}
    m = np.zeros(shape, bool)
    for pl in planes:
        k = k_of[pl["sopInstanceUid"]]
        sl = np.zeros((shape[1], shape[0]), bool)
        for ring in pl["polygons"] + pl.get("holes", []):
            r = np.asarray(ring, float)
            rr, cc = polygon(r[:, 1], r[:, 0], shape=sl.shape)
            sl[rr, cc] ^= True
        m[:, :, k] |= sl.T
    return m


def trace_dice(planes: list, mask: np.ndarray, slices: list) -> float:
    r = rasterize_planes(planes, mask.shape, slices)
    return float(2 * (r & mask).sum() / max(r.sum() + mask.sum(), 1))


def expert_findings(info: dict, slices: list, shape) -> np.ndarray | None:
    """Union of the expert aneurysm outlines of this series (image pack targets), rasterised on the (col, row, k) grid."""
    from common import PACKS_DIR
    pack = load_json(PACKS_DIR / info["packId"] / "pack.json")
    tg = [t for t in pack["referenceTargets"] if t["seriesUid"] == info["seriesUid"] and t["classId"] == "finding:intracranial_aneurysm"]
    if not tg:
        return None
    m = np.zeros(shape, bool)
    for t in tg:
        m |= rasterize_planes(load_json(PACKS_DIR / info["packId"] / t["geometryFile"])["planes"], shape, slices)
    return m


def process(case: str) -> dict:
    d = WORK_MR / case
    info = load_json(d / "info.json")
    slices = load_json(d / "slices.json")
    img_nib = nib.load(str(d / "mr.nii.gz"))
    seg_nib = nib.load(str(d / "seg_cow_raw.nii.gz"))
    out = {"case": case, "rulesVersion": RULES_VERSION, "seriesUid": info["seriesUid"],
           "gridIdentical": bool(seg_nib.shape == img_nib.shape and np.allclose(seg_nib.affine, img_nib.affine, atol=1e-3))}
    assert out["gridIdentical"], f"{case}: segmentation not on the image grid"
    sig = np.asanyarray(img_nib.dataobj).astype(np.float32)
    seg = np.asanyarray(seg_nib.dataobj).astype(np.int16)
    img_sitk = sitk.ReadImage(str(d / "mr.nii.gz"))  # same grid; index (x, y, z) = (col, row, slice k)
    res, qc = P.postprocess(seg, img_sitk)
    out["post"] = qc
    # An aneurysm is not part of its parent artery: the sac outlined by the experts (dilated by one voxel) is left out of
    # every AI artery, so no artery outline claims it.
    sac = expert_findings(info, slices, sig.shape)
    if sac is not None:
        sac = ndi.binary_dilation(sac, structure=np.ones((3, 3, 3), bool))
        removed = {}
        for name, mask in res.get("classes", {}).items():
            n0 = int(mask.sum())
            mask &= ~sac
            if n0 - int(mask.sum()):
                removed[name] = n0 - int(mask.sum())
            for part in res["parts"].get(name, {}).values():
                if isinstance(part, np.ndarray):
                    part &= ~sac
        out["aneurysmVoxelsRemoved"] = removed
    head = head_mask(sig)
    # rule 0 on sampled voxels of every kept class
    rng = np.random.default_rng(1)
    A = img_nib.affine
    ps, iop = info["pixelSpacing"], info["iop"]
    structures = []
    items = []
    for name, mask in res.get("classes", {}).items():
        if name in res["parts"]:
            for part in ("A1", "A2", "P1", "P2", "M1", "M2"):
                if part in res["parts"][name]:
                    items.append((name, part, res["parts"][name][part]))
        else:
            items.append((name, None, mask))
    for name, part, mask in items:
        cid, label = cow_class_id(name, part), cow_label(name, part)
        if not mask.any():
            structures.append({"name": name, "part": part, "classId": f"anatomy:{cid}", "label": label,
                               "status": "dropped: nothing left once the aneurysm sac is left out", "rule": 1})
            continue
        rec = {"name": name, "part": part, "classId": f"anatomy:{cid}", "label": label, "voxels": int(mask.sum()),
               "volumeMm3": round(float(mask.sum() * np.prod(img_nib.header.get_zooms()[:3])), 1)}
        ijk = np.argwhere(mask)
        sel = ijk[rng.choice(len(ijk), size=min(60, len(ijk)), replace=False)]
        rec["alignmentMaxResidualMm"] = max(float(np.linalg.norm((RAS_TO_LPS @ A @ np.array([i, j, k, 1.0]))[:3]
                                                                  - dicom_pixel_to_lps(slices[k]["ipp"], iop, ps, col=float(i), row=float(j))))
                                            for i, j, k in sel)
        q = tof_q(sig, mask, head)
        grp = "small" if name in SMALL_VESSELS else "large"
        rec["tofSignal"] = {"q": round(q, 3), "group": grp, "min": TOF_MIN_SIGNAL[grp]}
        planes = []
        for k in np.unique(ijk[:, 2]):
            polys, holes = trace_slice(mask[:, :, k].T)
            if polys:
                pl = {"sopInstanceUid": slices[int(k)]["sopInstanceUid"], "frame": 1, "polygons": polys}
                if holes:
                    pl["holes"] = holes
                planes.append(pl)
        rec["planes"] = len(planes)
        rec["traceDice"] = round(trace_dice(planes, mask, slices), 4)
        rec["status"], rec["rule"] = "ok", None
        if rec["traceDice"] < 0.9:
            rec["status"], rec["rule"] = f"dropped: published outline differs from the mask (Dice {rec['traceDice']:.2f})", 0
        elif rec["alignmentMaxResidualMm"] >= 0.5:
            rec["status"], rec["rule"] = "dropped: alignment residual >= 0.5 mm", 0
        elif len(planes) < 2:
            rec["status"], rec["rule"] = f"dropped: on {len(planes)} slice(s) only", 1
        elif q < TOF_MIN_SIGNAL[grp]:
            rec["status"], rec["rule"] = f"dropped: TOF signal too low for flowing blood (q {q:.2f} < {TOF_MIN_SIGNAL[grp]})", 2
        if rec["status"] == "ok":
            dump_json_compact({"geometryType": "contour_set", "space": "image_px", "planes": planes},
                              d / "cow_geom" / f"{cid}.json")
        structures.append(rec)
    for n, why in qc.get("dropped", {}).items():
        structures.append({"name": n, "part": None, "classId": f"anatomy:{P.CLASS_ID[n]}", "label": cow_label(n),
                           "status": f"dropped: {why}", "rule": 1 if "part" in why or "box" in why else 4})
    out["structures"] = structures
    dump_json(out, d / "cow_structures.json")
    return out


def main(argv):
    want = [a for a in argv[1:] if not a.startswith("--")]
    cases = [r["case"] for r in load_json(WORK_MR / "mr_cases.json") if r["eligible"] and r["tof"]]
    for c in cases:
        if want and c not in want:
            continue
        if not (WORK_MR / c / "seg_cow_raw.nii.gz").exists():
            print(f"{c}: not segmented yet")
            continue
        o = process(c)
        ok = [s["label"] for s in o["structures"] if s["status"] == "ok"]
        bad = {s["label"]: s["status"] for s in o["structures"] if s["status"] != "ok"}
        print(f"{c}: {len(ok)} ok; dropped {bad}; notSplit {o['post'].get('notSplit')}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
