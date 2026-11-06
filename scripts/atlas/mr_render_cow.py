"""Visual check of the Circle-of-Willis outlines: axial and coronal thick-slab MIPs with every published artery outlined.

  venv-gpu python scripts/atlas/mr_render_cow.py [case ...]   -> WORK_MR/<case>/cow_png/cow.png

Radiological convention (patient's right on the image left; anterior up on the axial MIP, superior up on the coronal).
Each artery outline is the projection of its published mask in the colour the viewer uses; the expert aneurysm outline
(brain-mra targets) is yellow; for series with expert artery labels the right column shows those. Record what was seen
in WORK_MR/cow_visual_check.json ({case: {"verdict": ..., "drop": [class ids], "why": {...}}}).
"""
from __future__ import annotations

import json
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import SimpleITK as sitk  # noqa: E402
from skimage import measure  # noqa: E402

from common import PACKS_DIR, load_json  # noqa: E402
from mr_common import WORK_MR  # noqa: E402

COLOR = {"basilar": "#ef4444", "internal_carotid": "#be123c", "middle_cerebral_artery_m1": "#fb923c", "middle_cerebral_artery_m2": "#c2410c",
         "middle_cerebral": "#f97316", "anterior_cerebral_artery_a1": "#34d399", "anterior_cerebral_artery_a2": "#047857",
         "anterior_cerebral": "#10b981", "anterior_communicating": "#84cc16", "third_a2": "#0d9488",
         "posterior_cerebral_artery_p1": "#c084fc", "posterior_cerebral_artery_p2": "#7e22ce", "posterior_cerebral": "#a855f7",
         "posterior_communicating": "#ec4899"}


def color(cid: str) -> str:
    for k, v in COLOR.items():
        if cid.startswith(k):
            return v
    return "#94a3b8"


def rasterize(geom: dict, slices: list, shape) -> np.ndarray:
    from skimage.draw import polygon
    k_of = {s["sopInstanceUid"]: s["k"] for s in slices}
    m = np.zeros(shape, bool)
    for pl in geom["planes"]:
        k = k_of[pl["sopInstanceUid"]]
        for ring in pl["polygons"]:
            r = np.asarray(ring)
            rr, cc = polygon(r[:, 1], r[:, 0], shape=(shape[1], shape[0]))
            m[cc, rr, k] = True
        for ring in pl.get("holes", []):
            r = np.asarray(ring)
            rr, cc = polygon(r[:, 1], r[:, 0], shape=(shape[1], shape[0]))
            m[cc, rr, k] = False
    return m


def to_lps(arr_xyz: np.ndarray, img) -> np.ndarray:
    im = sitk.GetImageFromArray(arr_xyz.transpose(2, 1, 0).astype(np.float32))
    im.CopyInformation(img)
    return sitk.GetArrayFromImage(sitk.DICOMOrient(im, "LPS")).transpose(2, 1, 0)


def render(case: str) -> None:
    d = WORK_MR / case
    info = load_json(d / "info.json")
    slices = load_json(d / "slices.json")
    st = load_json(d / "cow_structures.json")
    img = sitk.ReadImage(str(d / "mr.nii.gz"))
    sig = sitk.GetArrayFromImage(img).transpose(2, 1, 0)
    shape = sig.shape
    masks = {}
    for s in st["structures"]:
        if s["status"] == "ok":
            cid = s["classId"].split(":", 1)[1]
            masks[cid] = to_lps(rasterize(load_json(d / "cow_geom" / f"{cid}.json"), slices, shape).astype(np.uint8), img) > 0
    pack = load_json(PACKS_DIR / info["packId"] / "pack.json")
    expert, aneurysm = {}, None
    for t in pack["referenceTargets"]:
        if t["seriesUid"] != info["seriesUid"]:
            continue
        g = load_json(PACKS_DIR / info["packId"] / t["geometryFile"])
        m = to_lps(rasterize(g, slices, shape).astype(np.uint8), img) > 0
        if t["classId"] == "finding:intracranial_aneurysm":
            aneurysm = m if aneurysm is None else (aneurysm | m)
        else:
            expert[t["classId"].split(":", 1)[1]] = m
    v = to_lps(sig, img)
    allm = np.zeros(v.shape, bool)
    for m in list(masks.values()) + list(expert.values()):
        allm |= m
    if aneurysm is not None:
        allm |= aneurysm
    ijk = np.argwhere(allm)
    lo, hi = ijk.min(0), ijk.max(0) + 1
    pad = 12
    lo, hi = np.maximum(lo - pad, 0), np.minimum(hi + pad, v.shape)
    sl = tuple(slice(a, b) for a, b in zip(lo, hi))
    vv = v[sl]
    vmax = np.percentile(vv, 99.8)
    cols = 2 if expert else 1
    fig, axs = plt.subplots(2, cols, figsize=(7 * cols, 12), squeeze=False)
    sp = np.asarray(sitk.DICOMOrient(img, "LPS").GetSpacing())
    for col, (title, ms) in enumerate([("AI outlines (published)", masks)] + ([("Expert labels (TopCoW)", expert)] if expert else [])):
        for row, (axis, name) in enumerate(((2, "axial MIP (anterior up)"), (1, "coronal MIP (superior up)"))):
            ax = axs[row][col]
            mip = vv.max(axis)  # axial: (x, y); coronal: (x, z)
            img2 = mip.T if axis == 2 else mip.T[::-1]
            asp = sp[1] / sp[0] if axis == 2 else sp[2] / sp[0]
            ax.imshow(img2, cmap="gray", vmin=0, vmax=vmax, aspect=asp, interpolation="lanczos")
            for cid, m in sorted(ms.items()):
                pm = m[sl].any(axis)
                pm = pm.T if axis == 2 else pm.T[::-1]
                for c in measure.find_contours(pm.astype(float), 0.5):
                    ax.plot(c[:, 1], c[:, 0], "-", color=color(cid), lw=0.9)
            if aneurysm is not None:
                pm = aneurysm[sl].any(axis)
                pm = pm.T if axis == 2 else pm.T[::-1]
                for c in measure.find_contours(pm.astype(float), 0.5):
                    ax.plot(c[:, 1], c[:, 0], "-", color="#facc15", lw=1.6)
            ax.text(0.01, 0.5, "R", color="w", transform=ax.transAxes, fontsize=14, va="center")
            ax.text(0.97, 0.5, "L", color="w", transform=ax.transAxes, fontsize=14, va="center")
            ax.set_title(f"{title}: {name}", fontsize=9)
            ax.axis("off")
    handles = [plt.Line2D([], [], color=color(c), lw=3, label=c) for c in sorted(set(masks) | set(expert))]
    fig.legend(handles=handles, loc="lower center", ncol=4, fontsize=7)
    fig.suptitle(f"{case}: {info['description']}", fontsize=10)
    (d / "cow_png").mkdir(exist_ok=True)
    fig.savefig(d / "cow_png" / "cow.png", dpi=80, bbox_inches="tight")
    plt.close(fig)


def main(argv):
    want = [a for a in argv[1:] if not a.startswith("--")]
    for r in load_json(WORK_MR / "mr_cases.json"):
        if r["tof"] and r["eligible"] and (not want or r["case"] in want) and (WORK_MR / r["case"] / "cow_structures.json").exists():
            render(r["case"])
            print(r["case"], "rendered", flush=True)


if __name__ == "__main__":
    main(sys.argv)
