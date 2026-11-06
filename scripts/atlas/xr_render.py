"""Visual check of the radiograph anatomy layer: every accepted film with the outlines that passed QC, colours per
structure, 8 films per sheet.

  RADIOLOGY_ATLAS_PACKS=... RADIOLOGY_ATLAS_WORK=.../atlas-xr $XRV scripts/atlas/xr_render.py   -> WORK/cxr_sheets/sheet_NN.png

Record what was seen in WORK/xr_visual_check.json ({case: {"verdict": ..., "drop": [structure names], "why": {...}}}).
"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pydicom  # noqa: E402
from PIL import Image  # noqa: E402

from common import WORK, load_json, series_index  # noqa: E402
from cxr_segment import CXR_WORK, display_image  # noqa: E402

COLORS = {"lung_left": "#60a5fa", "lung_right": "#3b82f6", "heart": "#f43f5e", "aorta": "#fb923c", "trachea": "#a3e635",
          "spine": "#e5e7eb", "diaphragm": "#22d3ee", "mediastinum": "#c084fc", "clavicula_left": "#facc15", "clavicula_right": "#eab308",
          "scapula_left": "#fdba74", "scapula_right": "#f97316", "hilum_left": "#f472b6", "hilum_right": "#ec4899"}


def render(case: str, ax):
    d = CXR_WORK / case
    info = load_json(d / "info.json")
    sidx = series_index()
    pid, root, se = sidx[info["seriesUid"]]
    inst = next(i for i in se["instances"] if i["sopInstanceUid"] == info["sopInstanceUid"])
    ds = pydicom.dcmread(root / inst["file"])
    img = display_image(ds)[0]
    ax.imshow(img, cmap="gray")
    shown = []
    for name, s in info["structures"].items():
        if s["status"] != "ok":
            continue
        g = load_json(d / "contours" / f"{name}.json")
        for pl in g["planes"]:
            for ring in pl["polygons"]:
                r = np.asarray(ring)
                ax.plot(r[:, 0], r[:, 1], "-", color=COLORS.get(name, "#94a3b8"), lw=0.8)
        shown.append(name)
    dropped = [n for n, s in info["structures"].items() if s["status"] != "ok"]
    ax.set_title(f"{case} ({pid}) {len(shown)} ok; dropped: {', '.join(dropped) or 'none'}", fontsize=6)
    ax.axis("off")


def main():
    cases = [c["case"] for c in load_json(CXR_WORK / "cxr_cases.json")["cases"] if c.get("case") and c.get("accepted")]
    out = WORK / "cxr_sheets"
    out.mkdir(parents=True, exist_ok=True)
    for i in range(0, len(cases), 8):
        fig, axs = plt.subplots(2, 4, figsize=(16, 9))
        for ax, c in zip(axs.ravel(), cases[i:i + 8]):
            render(c, ax)
        for ax in axs.ravel()[len(cases[i:i + 8]):]:
            ax.axis("off")
        fig.tight_layout()
        fig.savefig(out / f"sheet_{i // 8:02d}.png", dpi=70)
        plt.close(fig)
    print(len(cases), "films on", (len(cases) + 7) // 8, "sheets in", out)


if __name__ == "__main__":
    main()
