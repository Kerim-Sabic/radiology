"""Visual check of the published brain outlines: four views per series (axial at the basal ganglia, axial high through the
central sulcus, axial through the posterior fossa, coronal through the thalami), drawn from the traced geometry files
(what the viewer shows), radiological orientation (patient's right on the image left), colours as the viewer's.

  venv-gpu python scripts/atlas/mr_render_brain.py [--dpi=N] [case ...]   -> WORK_MR/<case>/brain_png/brain.png
  venv-gpu python scripts/atlas/mr_render_brain.py --sheets     -> WORK_MR/brain_sheets/sheet_NN.png (6 series per sheet)

Record what was seen in WORK_MR/brain_visual_check.json ({segmented case: {"verdict": ..., "drop": [class ids]}}).
"""
from __future__ import annotations

import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import SimpleITK as sitk  # noqa: E402
from PIL import Image  # noqa: E402
from skimage import measure  # noqa: E402

from common import load_json  # noqa: E402
from mr_common import WORK_MR  # noqa: E402
from mr_render_cow import rasterize, to_lps  # noqa: E402

COLOR = {"frontal_lobe": "#fda4af", "parietal_lobe": "#fcd34d", "temporal_lobe": "#86efac", "occipital_lobe": "#a5b4fc", "insula": "#c4b5fd",
         "cingulate": "#f0abfc", "precentral": "#f43f5e", "postcentral": "#f59e0b", "superior_temporal": "#22c55e", "lateral_ventricle": "#38bdf8",
         "third_ventricle": "#38bdf8", "fourth_ventricle": "#38bdf8", "caudate": "#a78bfa", "putamen": "#fb7185", "globus_pallidus": "#d9f99d",
         "thalamus": "#2dd4bf", "hippocampus": "#fde68a", "amygdala": "#fdba74", "brainstem": "#e879f9", "cerebellum": "#93c5fd"}


def color(cid):
    return next((v for k, v in COLOR.items() if cid.startswith(k)), "#94a3b8")


def render(case: str, dpi: int = 60):
    d = WORK_MR / case
    st = load_json(d / "brain_structures.json")
    slices = load_json(d / "slices.json")
    img = sitk.ReadImage(str(d / "mr.nii.gz"))
    sig = sitk.GetArrayFromImage(img).transpose(2, 1, 0)
    v = to_lps(sig, img)
    sp = np.asarray(sitk.DICOMOrient(img, "LPS").GetSpacing())
    masks = {}
    for cid, s in st["structures"].items():
        f = d / "brain_geom" / f"{cid}.json"
        if s["status"] == "ok" and f.exists():
            masks[cid] = to_lps(rasterize(load_json(f), slices, sig.shape).astype(np.uint8), img) > 0
    if not masks:
        return None
    def zc(names):
        pts = [np.argwhere(masks[n]) for n in names if n in masks]
        return int(np.median(np.concatenate(pts)[:, 2])) if pts else v.shape[2] // 2
    z_bg = zc(["thalamus_left", "thalamus_right", "putamen_left", "putamen_right"])
    z_hi = zc(["precentral_gyrus_left", "precentral_gyrus_right"]) if any(k.startswith("precentral") for k in masks) else min(v.shape[2] - 1, z_bg + int(30 / sp[2]))
    z_pf = zc(["fourth_ventricle", "cerebellum_left", "cerebellum_right"])
    th = [np.argwhere(masks[n]) for n in ("thalamus_left", "thalamus_right") if n in masks]
    y_c = int(np.median(np.concatenate(th)[:, 1])) if th else v.shape[1] // 2
    views = [("axial, basal ganglia", 2, z_bg), ("axial, high", 2, z_hi), ("axial, posterior fossa", 2, z_pf), ("coronal, thalami", 1, y_c)]
    fig, axs = plt.subplots(1, 4, figsize=(16, 4.4))
    brain = np.logical_or.reduce(list(masks.values()))
    vmax = np.percentile(v[brain], 99.5)
    for ax, (name, axis, k) in zip(axs, views):
        sl = [slice(None)] * 3
        sl[axis] = k
        im = v[tuple(sl)]
        im, asp = (im.T, sp[1] / sp[0]) if axis == 2 else (im.T[::-1], sp[2] / sp[0])
        ax.imshow(im, cmap="gray", vmin=0, vmax=vmax, aspect=asp)
        for cid, m in masks.items():
            pm = m[tuple(sl)]
            pm = pm.T if axis == 2 else pm.T[::-1]
            for c in measure.find_contours(pm.astype(float), 0.5):
                ax.plot(c[:, 1], c[:, 0], "-", color=color(cid), lw=0.7)
        ax.set_title(name, fontsize=8)
        ax.text(0.01, 0.5, "R", color="w", transform=ax.transAxes, fontsize=10)
        ax.axis("off")
    dropped = [c for c, s in st["structures"].items() if s["status"] != "ok"]
    fig.suptitle(f"{case} ({load_json(d / 'info.json')['description'][:40]}): {len(masks)} shown; dropped by QC: {', '.join(dropped) or 'none'}", fontsize=8)
    (d / "brain_png").mkdir(exist_ok=True)
    out = d / "brain_png" / "brain.png"
    fig.savefig(out, dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    return out


def published_cases():
    """The series whose outlines are published: every brain series except ISLES ADC maps (shown on the DWI partner)."""
    out = []
    for r in load_json(WORK_MR / "mr_cases.json"):
        d = WORK_MR / r["case"]
        if r["eligible"] and not r["tof"] and (d / "brain_structures.json").exists() and not r["description"].upper().startswith("ADC"):
            out.append(r["case"])
    return sorted(out)


def sheets():
    outdir = WORK_MR / "brain_sheets"
    outdir.mkdir(exist_ok=True)
    pngs = [p for p in (render(c) for c in published_cases()) if p]
    for i in range(0, len(pngs), 6):
        ims = [Image.open(p) for p in pngs[i:i + 6]]
        w, h = max(im.width for im in ims), sum(im.height for im in ims)
        sheet = Image.new("RGB", (w, h), "white")
        y = 0
        for im in ims:
            sheet.paste(im, (0, y))
            y += im.height
        sheet.save(outdir / f"sheet_{i // 6:02d}.png")
    print(f"{len(pngs)} series on {(len(pngs) + 5) // 6} sheets in {outdir}")


if __name__ == "__main__":
    if "--sheets" in sys.argv:
        sheets()
    else:
        dpi = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--dpi=")), 60))
        for c in [a for a in sys.argv[1:] if not a.startswith("--")]:
            print(render(c, dpi))
