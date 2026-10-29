"""QC overlays from a BUILT pack: decode the packed DICOM and draw each reference target on it, tiled into contact sheets.

  python scripts/data/qc_render.py <packId> <outDir> [--per-sheet 12] [--tile 420] [--only id1,id2] [--crop]

What is drawn is read back from public/packs/<packId> (pack.json, target geometry, DICOM files), so the sheets show
exactly what the app will show: if an outline is shifted, flipped or on the wrong image, it is visible here. For a
contour set on a stack, the image with the largest outlined area is drawn. --crop adds a second tile zoomed on the
target. Output: <outDir>/<packId>-NN.png and <outDir>/<packId>-index.json (tile -> target id).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS_DIR  # noqa: E402


def _window(ds, a: np.ndarray) -> np.ndarray:
    a = a.astype(np.float64)
    wc, ww = ds.get("WindowCenter"), ds.get("WindowWidth")
    if wc is not None and ww is not None:
        wc = float(wc[0] if isinstance(wc, pydicom.multival.MultiValue) else wc)
        ww = float(ww[0] if isinstance(ww, pydicom.multival.MultiValue) else ww)
        lo, hi = wc - ww / 2, wc + ww / 2
    else:
        lo, hi = np.percentile(a, [1, 99.5])
    out = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1) * 255
    if str(ds.get("PhotometricInterpretation", "")) == "MONOCHROME1":
        out = 255 - out
    return out.astype(np.uint8)


def _poly_area(p) -> float:
    p = np.asarray(p, dtype=float)
    return 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1))) if len(p) >= 3 else 0.0


def render_target(pack_dir: Path, man: dict, t: dict, tile: int, crop: bool) -> list[Image.Image]:
    se = next(s for s in man["series"] if s["uid"] == t["seriesUid"])
    by_sop = {i["sopInstanceUid"]: i for i in se["instances"]}
    g = json.loads((pack_dir / t["geometryFile"]).read_text(encoding="utf-8"))
    if g["geometryType"] == "contour_set":
        plane = max(g["planes"], key=lambda p: sum(_poly_area(q) for q in p["polygons"]))
        sop, shapes = plane["sopInstanceUid"], [("poly", q) for q in plane["polygons"]] + [("hole", q) for q in plane.get("holes", [])]
    elif g["geometryType"] == "box":
        b = g["boxes"][0]
        sop, shapes = b["sopInstanceUid"], [("box", bb["box"]) for bb in g["boxes"] if bb["sopInstanceUid"] == b["sopInstanceUid"]]
    elif g["geometryType"] == "image_label":
        sop, shapes = g["sopInstanceUids"][0], []
    else:
        raise ValueError(g["geometryType"])
    ds = pydicom.dcmread(pack_dir / by_sop[sop]["file"])
    a = _window(ds, ds.pixel_array)
    im = Image.fromarray(a).convert("RGB")
    h, w = a.shape
    pts = [p for _, s in shapes for p in (s if _ != "box" else [s[:2], s[2:]])]
    out = []
    views = [(0, 0, w, h)]
    if crop and pts:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        half = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.2 + 30
        views.append((max(0, cx - half), max(0, cy - half), min(w, cx + half), min(h, cy + half)))
    for (x0, y0, x1, y1) in views:
        scale = tile / max(x1 - x0, y1 - y0)
        v = im.crop((int(x0), int(y0), int(x1), int(y1))).resize((max(1, int((x1 - x0) * scale)), max(1, int((y1 - y0) * scale))), Image.LANCZOS)
        d = ImageDraw.Draw(v)
        for kind, s in shapes:
            f = lambda p: ((p[0] + 0.5 - x0) * scale, (p[1] + 0.5 - y0) * scale)  # noqa: E731  pixel centre -> canvas
            if kind == "box":
                d.rectangle([f(s[:2]), f(s[2:])], outline=(255, 40, 40), width=2)
            else:
                d.line([f(p) for p in s] + [f(s[0])], fill=(255, 40, 40) if kind == "poly" else (40, 160, 255), width=1)
        canvas = Image.new("RGB", (tile, tile + 16), (20, 20, 20))
        canvas.paste(v, (0, 16))
        ImageDraw.Draw(canvas).text((3, 2), t["id"][:60], fill=(255, 255, 0))
        out.append(canvas)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("out")
    ap.add_argument("--per-sheet", type=int, default=12)
    ap.add_argument("--tile", type=int, default=420)
    ap.add_argument("--only", default="")
    ap.add_argument("--crop", action="store_true")
    ap.add_argument("--cols", type=int, default=4)
    a = ap.parse_args()
    pack_dir = PACKS_DIR / a.pack
    man = json.loads((pack_dir / "pack.json").read_text(encoding="utf-8"))
    only = set(filter(None, a.only.split(",")))
    tiles, names = [], []
    for t in man["referenceTargets"]:
        if only and t["id"] not in only and not any(o in t["id"] for o in only):
            continue
        for k, im in enumerate(render_target(pack_dir, man, t, a.tile, a.crop)):
            tiles.append(im)
            names.append(t["id"] + ("" if k == 0 else " (zoom)"))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index = {}
    for s in range(0, len(tiles), a.per_sheet):
        chunk = tiles[s:s + a.per_sheet]
        cols = min(a.cols, len(chunk))
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * a.tile, rows * (a.tile + 16)), (0, 0, 0))
        for i, im in enumerate(chunk):
            sheet.paste(im, ((i % cols) * a.tile, (i // cols) * (a.tile + 16)))
        name = f"{a.pack}-{s // a.per_sheet:02d}.png"
        sheet.save(out / name)
        index[name] = names[s:s + a.per_sheet]
    (out / f"{a.pack}-index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"{len(tiles)} tiles in {len(index)} sheets -> {out}")


if __name__ == "__main__":
    main()
