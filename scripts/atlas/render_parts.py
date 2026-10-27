"""Render coronal + sagittal projections of the derived aorta / colon parts for visual verification (owner rule D).

  python scripts/atlas/render_parts.py case [case ...]

Rasterises the PUBLISHED contour files (WORK/<case>/contours/<part>.json, i.e. exactly what the pack will contain) back
onto the slice grid, then draws a coronal and a sagittal maximum-intensity-like projection of the CT (soft-tissue
window) with each part's projected footprint outlined in its own colour. Output: WORK/<case>/parts_png/parts.png
(scratch only, never shipped). Patient right is on the image left (radiological convention); head at the top.
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.draw import polygon as fill_polygon

from common import WORK, load_json

COLORS = {"aorta_ascending": (255, 60, 60), "aorta_arch": (255, 200, 0), "aorta_descending_thoracic": (0, 200, 255),
          "aorta_abdominal": (180, 0, 255), "colon_ascending": (0, 255, 0), "colon_transverse": (255, 128, 0),
          "colon_descending": (0, 128, 255), "colon_sigmoid": (255, 0, 200), "rectum": (255, 255, 255)}


def main(argv):
    for case in argv[1:]:
        d = WORK / case
        ct = np.asanyarray(nib.load(str(d / "ct.nii.gz")).dataobj).astype(np.float32)
        info = load_json(d / "info.json")
        k_of = {s["sopInstanceUid"]: s["k"] for s in load_json(d / "slices.json")}
        C, R, K = ct.shape
        masks = {}
        for name in COLORS:
            p = d / "contours" / f"{name}.json"
            if not p.exists():
                continue
            m = np.zeros(ct.shape, bool)
            for pl in load_json(p)["planes"]:
                k = k_of[pl["sopInstanceUid"]]
                sl = np.zeros((R, C), bool)
                for ring in pl["polygons"] + pl.get("holes", []):
                    a = np.asarray(ring, float)
                    rr, cc = fill_polygon(a[:, 1], a[:, 0], (R, C))
                    sl[rr, cc] ^= True
                m[:, :, k] = sl.T
            masks[name] = m
        if not masks:
            print(f"{case}: no parts")
            continue
        sx, sy, sz = info["pixelSpacing"][1], info["pixelSpacing"][0], info["sliceStepMm"]
        win = lambda a: (np.clip((a + 160) / 400.0, 0, 1) * 255).astype(np.uint8)
        tiles = []
        for axis, (h_sp, name) in ((1, (sx, "coronal")), (0, (sy, "sagittal"))):
            proj = np.clip(ct, -200, 400).mean(axis=axis)  # (other, K)
            img = (255 * (proj - proj.min()) / max(proj.max() - proj.min(), 1)).astype(np.uint8).T[::-1]
            scale = sz / h_sp
            H = int(img.shape[0] * scale)
            im = Image.fromarray(img).convert("RGB").resize((img.shape[1], H))
            dr = ImageDraw.Draw(im)
            for nme, m in masks.items():
                fp = m.any(axis=axis).T[::-1]
                edge = fp & ~ndi.binary_erosion(fp)
                rr, cc = np.nonzero(edge)
                for r, c in zip(rr, cc):
                    dr.point((c, int(r * scale)), fill=COLORS[nme])
            dr.text((4, 4), f"{case} {name}", fill=(255, 255, 0))
            tiles.append(im)
        W = sum(t.width for t in tiles)
        H = max(t.height for t in tiles)
        M = Image.new("RGB", (W, H + 14 * len(masks)))
        x = 0
        for t in tiles:
            M.paste(t, (x, 0))
            x += t.width
        dr = ImageDraw.Draw(M)
        for i, nme in enumerate(masks):
            dr.text((4, H + 14 * i), nme, fill=COLORS[nme])
        (d / "parts_png").mkdir(exist_ok=True)
        M.save(d / "parts_png" / "parts.png")
        print(f"{case}: {sorted(masks)}")


if __name__ == "__main__":
    main(sys.argv)
