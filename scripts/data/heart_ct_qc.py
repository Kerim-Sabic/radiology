"""QC sheets for the heart-ct pack, drawn from the BUILT pack (decoded DICOM + target geometry), one PNG per case.

  python scripts/data/heart_ct_qc.py <outDir> [case ...]

Each sheet: four axial slices (arch, upper heart, four-chamber level, lower heart), a coronal and a sagittal reformat of the
stack, every outline in a colour per structure (dataset outlines solid; AI outlines thick) with a legend. The reformats
rasterise the stored polygons, so they also prove that the outlines sit on the right slices.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image, ImageDraw
from skimage.draw import polygon as sk_polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PACKS_DIR  # noqa: E402

COL = {
    "heart": (255, 255, 0), "aorta": (255, 60, 60), "atrial_appendage_left": (255, 160, 0), "pulmonary_vein": (255, 120, 200),
    "superior_vena_cava": (60, 120, 255), "inferior_vena_cava": (0, 200, 255), "brachiocephalic_trunk": (255, 140, 140),
    "brachiocephalic_vein_left": (100, 160, 255), "brachiocephalic_vein_right": (60, 200, 255),
    "common_carotid_artery_left": (255, 200, 120), "common_carotid_artery_right": (255, 220, 160),
    "subclavian_artery_left": (255, 100, 40), "subclavian_artery_right": (220, 80, 80),
    "heart_myocardium": (0, 255, 120), "heart_atrium_left": (255, 0, 255), "heart_ventricle_left": (0, 255, 0),
    "heart_atrium_right": (0, 160, 255), "heart_ventricle_right": (255, 255, 255), "pulmonary_artery": (180, 120, 255),
}


def load_case(pack: Path, man: dict, se: dict):
    inst = se["instances"]
    vol = np.stack([pydicom.dcmread(pack / i["file"]).pixel_array.astype(np.int16) - 1024 for i in inst])  # z, row, col
    sop_z = {i["sopInstanceUid"]: z for z, i in enumerate(inst)}
    ts = [t for t in man["referenceTargets"] if t["seriesUid"] == se["uid"]]
    shapes, masks = {}, {}
    for t in ts:
        g = json.loads((pack / t["geometryFile"]).read_text(encoding="utf-8"))
        key = t["classId"].split(":", 1)[1]
        ai = t["provenance"] == "ai_draft"
        m = np.zeros(vol.shape, bool)
        for pl in g["planes"]:
            z = sop_z[pl["sopInstanceUid"]]
            shapes.setdefault((key, ai), {})[z] = (pl["polygons"], pl.get("holes", []))
            for poly in pl["polygons"]:
                p = np.asarray(poly)
                rr, cc = sk_polygon(p[:, 1], p[:, 0], m.shape[1:])
                m[z, rr, cc] = True
            for poly in pl.get("holes", []):
                p = np.asarray(poly)
                rr, cc = sk_polygon(p[:, 1], p[:, 0], m.shape[1:])
                m[z, rr, cc] = False
        masks[(key, ai)] = m
    return vol, shapes, masks


def win(a, c=40, w=400):
    return (np.clip((a.astype(np.float32) - (c - w / 2)) / w, 0, 1) * 255).astype(np.uint8)


def tile(img2d, overlays, size, aspect=1.0, zoom=None):
    """overlays: list of (key, ai, mask2d) rasterised masks; outlines are the mask borders."""
    from scipy import ndimage as ndi
    rgb = np.stack([win(img2d)] * 3, -1)
    for key, ai, m in overlays:
        if not m.any():
            continue
        edge = m & ~ndi.binary_erosion(m, iterations=2 if ai else 1)
        rgb[edge] = COL.get(key, (255, 0, 0))
    im = Image.fromarray(rgb)
    w, h = im.size
    im = im.resize((int(w * size / max(w, h * aspect)), int(h * aspect * size / max(w, h * aspect))), Image.NEAREST)
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2))
    return canvas


def sheet(pack: Path, man: dict, se: dict, case: dict | None, out: Path, size: int = 320):
    vol, shapes, masks = load_case(pack, man, se)
    nz, ny, nx = vol.shape
    zs = lambda key: sorted(z for (k, ai), d in shapes.items() if k == key for z in d)  # noqa: E731
    hz, az = zs("heart"), zs("aorta")
    # slice order is as stored: z index 0 is the first instance; find which end is cranial from the IPP
    ipp = [i["ipp"][2] for i in se["instances"]]
    cranial_last = ipp[-1] > ipp[0]
    def frac(f, a, b):  # f=0 -> cranial end of [a,b]
        return int(round(b - (b - a) * f)) if cranial_last else int(round(a + (b - a) * f))
    h0, h1 = (min(hz), max(hz)) if hz else (0, nz - 1)
    a0, a1 = (min(az), max(az)) if az else (0, nz - 1)
    arch = (a1 - 2) if cranial_last else (a0 + 2)
    levels = [("arch", arch), ("upper heart", frac(0.12, h0, h1)), ("four-chamber", frac(0.5, h0, h1)), ("lower heart", frac(0.85, h0, h1))]
    ov = lambda z: [(k, ai, m[z]) for (k, ai), m in masks.items()]  # noqa: E731
    tiles = [(f"{n} (z{z})", tile(vol[z], ov(z), size)) for n, z in levels]
    # reformats through the heart centroid
    hm = masks.get(("heart", False))
    if hm is not None and hm.any():
        zc, yc, xc = np.argwhere(hm).mean(0).astype(int)
    else:
        zc, yc, xc = nz // 2, ny // 2, nx // 2
    zstep = abs(se["geometry"].get("sliceSpacing") or 3.0) if isinstance(se.get("geometry"), dict) else 3.0
    asp = zstep / 1.5
    cor = vol[:, yc, :][::-1] if cranial_last else vol[:, yc, :]
    cm = [(k, ai, (m[:, yc, :][::-1] if cranial_last else m[:, yc, :])) for (k, ai), m in masks.items()]
    sag = vol[:, :, xc][::-1] if cranial_last else vol[:, :, xc]
    sm = [(k, ai, (m[:, :, xc][::-1] if cranial_last else m[:, :, xc])) for (k, ai), m in masks.items()]
    tiles.append(("coronal", tile(cor, cm, size, aspect=asp)))
    tiles.append(("sagittal", tile(sag, sm, size, aspect=asp)))
    cols, rows = 3, 2
    head = 40
    legend_h = 64
    img = Image.new("RGB", (cols * size, rows * (size + 16) + head + legend_h), (20, 20, 20))
    d = ImageDraw.Draw(img)
    note = ""
    if case:
        note = f"contrast={case['contrast']} aortaHU={case['aortaHu']}"
    d.text((6, 4), f"{se['subjectKey'].split(':')[-1]}  {len(se['instances'])} slices  {note}", fill=(255, 255, 0))
    for i, (name, t) in enumerate(tiles):
        x, y = (i % cols) * size, head + (i // cols) * (size + 16)
        img.paste(t, (x, y + 16))
        d.text((x + 4, y + 2), name, fill=(200, 200, 200))
    # legend
    present = sorted({(k, ai) for (k, ai) in masks})
    x, y = 6, head + rows * (size + 16) + 4
    for k, ai in present:
        d.rectangle([x, y + 2, x + 9, y + 11], fill=COL.get(k, (255, 0, 0)))
        txt = f"{k.replace('heart_', '').replace('_', ' ')}{' (AI)' if ai else ''}"
        d.text((x + 13, y), txt, fill=(220, 220, 220))
        x += 13 + 6 * len(txt) + 10
        if x > cols * size - 130:
            x, y = 6, y + 14
    img.save(out)


def main() -> None:
    out = Path(sys.argv[1])
    only = set(sys.argv[2:])
    out.mkdir(parents=True, exist_ok=True)
    pack = PACKS_DIR / "heart-ct"
    man = json.loads((pack / "pack.json").read_text(encoding="utf-8"))
    qc = {}
    qp = Path(r"C:\Users\kerim\radiology-data\work\heart-ct\build-qc.json")
    if qp.exists():
        qc = json.loads(qp.read_text())
    for se in man["series"]:
        cid = se["subjectKey"].split(":")[-1]
        if only and cid not in only:
            continue
        sheet(pack, man, se, qc.get(cid), out / f"{cid}.png")
        print(cid, flush=True)


if __name__ == "__main__":
    main()
