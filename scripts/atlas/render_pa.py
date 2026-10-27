"""Render the published pulmonary-artery parts (and their neighbours) for visual verification.

  python scripts/atlas/render_pa.py case [case ...]

For each case: two axial CT slices (soft-tissue window) at the bifurcation level and 12 mm below it, with the
published outlines of the pulmonary trunk, right / left pulmonary artery, ascending aorta, SVC, heart and left main
bronchus, plus a coronal projection with the three PA parts. Optionally `--veins` renders the SVC / brachiocephalic
veins on their densest slice instead (contrast-streak check). Output: WORK/<case>/pa_png/*.png (scratch only).
Image left = patient right (radiological convention).
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw
from skimage.draw import polygon as fill_polygon

from common import WORK, load_json

COL = {"pulmonary_trunk": (255, 0, 255), "pulmonary_artery_right": (0, 255, 0), "pulmonary_artery_left": (0, 160, 255),
       "aorta_ascending": (255, 60, 60), "superior_vena_cava": (255, 255, 0), "heart": (255, 255, 255),
       "main_bronchus_left": (0, 255, 255), "brachiocephalic_vein_left": (255, 160, 0), "brachiocephalic_vein_right": (180, 255, 120),
       "heart_atrium_right": (0, 200, 255), "heart_atrium_left": (255, 120, 0), "heart_ventricle_right": (60, 255, 60),
       "heart_ventricle_left": (255, 40, 40), "heart_myocardium": (255, 255, 0), "aorta": (200, 200, 200)}


def planes_by_k(case, name, k_of):
    p = WORK / case / "contours" / f"{name}.json"
    if not p.exists():
        return {}
    out = {}
    for pl in load_json(p)["planes"]:
        out[k_of[pl["sopInstanceUid"]]] = pl
    return out


def draw_axial(ct, k, case, names, k_of, window=(-160, 240)):
    sl = ct[:, :, k].T.astype(float)
    img = np.clip((sl - window[0]) / (window[1] - window[0]), 0, 1) * 255
    im = Image.fromarray(img.astype(np.uint8)).convert("RGB")
    dr = ImageDraw.Draw(im)
    for n in names:
        pl = planes_by_k(case, n, k_of).get(k)
        if not pl:
            continue
        for ring in pl["polygons"]:
            dr.line([(x + 0.5, y + 0.5) for x, y in ring], fill=COL[n], width=1)
    return im


def main(argv):
    veins = "--veins" in argv
    chambers = "--chambers" in argv
    for case in [a for a in argv[1:] if not a.startswith("--")]:
        d = WORK / case
        ct = np.asanyarray(nib.load(str(d / "ct.nii.gz")).dataobj)
        slices = load_json(d / "slices.json")
        k_of = {s["sopInstanceUid"]: s["k"] for s in slices}
        z = np.array([s["ipp"][2] for s in slices])
        st = load_json(d / "structures.json")
        (d / "pa_png").mkdir(exist_ok=True)
        if chambers:
            names = ["heart_atrium_right", "heart_atrium_left", "heart_ventricle_right", "heart_ventricle_left", "heart_myocardium",
                     "aorta_ascending", "superior_vena_cava", "pulmonary_trunk"]
            ks = sorted({k for n in names[:5] for k in planes_by_k(case, n, k_of)})
            if not ks:
                print(case, "no chambers published")
                continue
            hi_k, lo_k = ks[int(0.75 * (len(ks) - 1))], ks[int(0.3 * (len(ks) - 1))]
            tiles = [draw_axial(ct, k, case, names, k_of, window=(-160, 440)).crop((96, 64, 416, 384)) for k in (hi_k, lo_k)]
            M = Image.new("RGB", (640, 320))
            M.paste(tiles[0], (0, 0))
            M.paste(tiles[1], (320, 0))
            ImageDraw.Draw(M).text((4, 4), f"{case} high / low cardiac level", fill=(255, 255, 0))
            M.save(d / "pa_png" / "chambers.png")
            print(case, "chambers.png", hi_k, lo_k)
            continue
        if veins:
            names = ["superior_vena_cava", "brachiocephalic_vein_left", "brachiocephalic_vein_right", "aorta_ascending"]
            tiles = []
            for n in names[:3]:
                S = st["structures"].get(n)
                if not S or S["status"] != "ok":
                    continue
                pk = planes_by_k(case, n, k_of)
                k = sorted(pk)[len(pk) // 2]
                tiles.append(draw_axial(ct, k, case, names, k_of, window=(-160, 840)).crop((96, 64, 416, 384)))
            if tiles:
                M = Image.new("RGB", (320 * len(tiles), 320))
                for i, t in enumerate(tiles):
                    M.paste(t, (320 * i, 0))
                M.save(d / "pa_png" / "veins.png")
                print(case, "veins.png")
            continue
        info = st.get("subpartsPA", {})
        if "bifurcationLps" not in info:
            print(case, "no PA parts:", info.get("reason"))
            continue
        zb = info["bifurcationLps"][2]
        kb = int(np.argmin(np.abs(z - zb)))
        kl = int(np.argmin(np.abs(z - (zb - 12))))
        names = ["heart", "aorta_ascending", "superior_vena_cava", "main_bronchus_left", "pulmonary_trunk",
                 "pulmonary_artery_right", "pulmonary_artery_left"]
        tiles = [draw_axial(ct, k, case, names, k_of).crop((96, 64, 416, 384)) for k in (kb, kl)]
        # coronal footprint of the three parts
        C, R, K = ct.shape
        proj = np.clip(ct, -200, 400).mean(axis=1).T[::-1]
        proj = (255 * (proj - proj.min()) / max(np.ptp(proj), 1)).astype(np.uint8)
        info_ct = load_json(d / "info.json")
        scale = info_ct["sliceStepMm"] / info_ct["pixelSpacing"][1]
        cor = Image.fromarray(proj).convert("RGB").resize((C, int(K * scale)))
        dr = ImageDraw.Draw(cor)
        for n in ("pulmonary_trunk", "pulmonary_artery_right", "pulmonary_artery_left", "aorta_ascending"):
            pk = planes_by_k(case, n, k_of)
            for k, pl in pk.items():
                fp = np.zeros(C, bool)
                for ring in pl["polygons"]:
                    a = np.asarray(ring)
                    rr, cc = fill_polygon(a[:, 1], a[:, 0], (R, C))
                    fp[cc] = True
                xs = np.nonzero(fp)[0]
                yrow = int((K - 1 - k) * scale)
                for x in (xs.min(), xs.max()) if len(xs) else ():
                    dr.rectangle((x - 1, yrow - 1, x + 1, yrow + 1), fill=COL[n])
        cor = cor.crop((96, 0, 416, cor.height)).resize((320, int(cor.height * 320 / 320)))
        H = max(320, cor.height)
        M = Image.new("RGB", (960, H))
        M.paste(tiles[0], (0, 0))
        M.paste(tiles[1], (320, 0))
        M.paste(cor, (640, 0))
        ImageDraw.Draw(M).text((4, 4), f"{case} bifurcation z={zb:.0f}", fill=(255, 255, 0))
        M.save(d / "pa_png" / "pa.png")
        print(case, "pa.png", {n: st["structures"].get(n, {}).get("status") for n in ("pulmonary_trunk", "pulmonary_artery_right", "pulmonary_artery_left")})


if __name__ == "__main__":
    main(sys.argv)
