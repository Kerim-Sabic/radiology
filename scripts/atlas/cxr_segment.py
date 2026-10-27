"""Atlas step CXR: anatomy outlines on every FRONTAL chest radiograph (CR/DX) of the image packs.

  C:/Users/kerim/radiology-data/venv-xrv/Scripts/python.exe scripts/atlas/cxr_segment.py [case ...]

Model: torchxrayvision (PyPI) `xrv.baseline_models.chestx_det.PSPNet` - ChestX-Det PSPNet, 14 structures, official
weights pspnet_chestxray_best_model_4.pth downloaded by torchxrayvision from its GitHub release v1
(cache: DATA_ROOT/xrv-cache).

Frontal selection (per instance): ViewPosition PA/AP -> frontal, LL/RL/LATERAL -> lateral; else PatientOrientation
row direction L/R -> frontal, A/P -> lateral; else SeriesDescription/ProtocolName containing PA/AP -> frontal,
LAT -> lateral; else "unknown" -> processed, and accepted only if the model finds both lungs (each >= 3 % of the
image) on the expected sides.

Preprocessing (recorded per image): stored pixels -> Modality LUT (pydicom apply_modality_lut) -> stored VOI
(apply_voi_lut, first window / VOI LUT; if the stored VOI saturates >= 90 % of pixels it is ignored and a
0.5-99.5 percentile window is used instead) -> scaled to [0,1] by the VOI output range -> inverted if MONOCHROME1
(or Presentation LUT Shape INVERSE) -> flipped to standard display if PatientOrientation says the column axis points
to patient Right or the row axis to Head -> zero-padded symmetrically to a square S x S (pad_top = (S-R)//2,
pad_left = (S-C)//2; no cropping, so the whole image is seen) -> skimage resize to 512 x 512 (order 1,
anti-aliasing) -> x*2048-1024 (torchxrayvision range) -> model -> sigmoid.

Mapping back (exact, pixel-centre convention of skimage/torch align_corners=False): a 512-grid coordinate m maps
to padded coordinate p = (m + 0.5) * S / 512 - 0.5, then col = p_c - pad_left, row = p_r - pad_top, then the
display flips are undone. Contours are traced with skimage.measure.find_contours(prob, 0.5) on the zero-padded
512 probability map, mapped vertex-by-vertex, clamped to the image, simplified with Douglas-Peucker DP_TOL_PX
(original pixels); rings < 16 model px^2 or < MIN_RING_AREA_PX2 are dropped; nesting parity decides holes.
QC: Dice between the rasterised polygons and the bilinear-upsampled probability map thresholded at 0.5 on the
original grid; laterality (left structures on the patient-left side, heart centroid left of the spine centroid);
polarity guard (lungs darker than the projected spine).
Writes WORK/cxr/<case>/contours/<name>.json, info.json and WORK/cxr/cxr_cases.json.
"""
from __future__ import annotations

import sys
import time

import numpy as np
import pydicom
import torch
import torch.nn.functional as F
from pydicom.pixels import apply_modality_lut, apply_voi_lut
from scipy import ndimage as ndi
from skimage import measure
from skimage.draw import polygon as fill_polygon
from skimage.transform import resize

import qc_rules as Q
from common import DATA_ROOT, DP_TOL_PX, MIN_RING_AREA_PX2, WORK, dump_json, dump_json_compact, ring_area, source_manifests, subject_short

XRV_NAMES = {
    "Left Clavicle": "clavicula_left", "Right Clavicle": "clavicula_right", "Left Scapula": "scapula_left",
    "Right Scapula": "scapula_right", "Left Lung": "lung_left", "Right Lung": "lung_right",
    "Left Hilus Pulmonis": "hilum_left", "Right Hilus Pulmonis": "hilum_right", "Heart": "heart", "Aorta": "aorta",
    "Facies Diaphragmatica": "diaphragm", "Mediastinum": "mediastinum", "Weasand": "trachea", "Spine": "spine",
}
LR_PAIRS = [("lung_left", "lung_right"), ("clavicula_left", "clavicula_right"), ("scapula_left", "scapula_right"),
            ("hilum_left", "hilum_right")]
MULTI_CXR = {"diaphragm": 2}  # the two domes may be separate regions
CXR_WORK = WORK / "cxr"


def view_of(ds):
    vp = str(getattr(ds, "ViewPosition", "") or "").upper().strip()
    if vp in ("PA", "AP"):
        return "frontal", f"ViewPosition={vp}"
    if vp in ("LL", "RL", "LATERAL", "LAT"):
        return "lateral", f"ViewPosition={vp}"
    po = list(getattr(ds, "PatientOrientation", []) or [])
    if po and po[0]:
        if po[0][0] in "LR":
            return "frontal", f"PatientOrientation={po}"
        if po[0][0] in "AP":
            return "lateral", f"PatientOrientation={po}"
    txt = " ".join(str(getattr(ds, k, "") or "") for k in ("SeriesDescription", "ProtocolName")).upper()
    if "LAT" in txt:
        return "lateral", f"description {txt!r}"
    if " PA" in f" {txt}" or " AP" in f" {txt}":
        return "frontal", f"description {txt!r}"
    return "unknown", "no ViewPosition / PatientOrientation / descriptive text"


def display_image(ds):
    a = ds.pixel_array
    mo = apply_modality_lut(a, ds)
    if np.issubdtype(mo.dtype, np.floating) and np.all(np.mod(mo, 1) == 0):
        mo = mo.astype(np.int64)  # integral values: keep an integer array so a VOI LUT table lookup is exact
    note = []
    has_voi = "VOILUTSequence" in ds or "WindowCenter" in ds
    v = None
    if has_voi:
        v = apply_voi_lut(mo, ds, index=0).astype(np.float64)
        sat = max(np.mean(v <= v.min()), np.mean(v >= v.max())) if v.max() > v.min() else 1.0
        if sat >= 0.9:
            note.append(f"stored VOI (WC={getattr(ds, 'WindowCenter', None)}, WW={getattr(ds, 'WindowWidth', None)}) saturates "
                        f"{sat:.0%} of pixels -> ignored")
            v = None
        else:
            note.append("stored VOI applied (" + ("VOI LUT Sequence" if "VOILUTSequence" in ds else
                        f"window WC={ds.WindowCenter} WW={ds.WindowWidth}, first value used") + ")")
    if v is None:
        lo, hi = np.percentile(mo, [0.5, 99.5])
        v = np.clip(mo.astype(np.float64), lo, hi)
        note.append(f"percentile window [{lo:.0f}, {hi:.0f}] of modality values")
    x = (v - v.min()) / max(v.max() - v.min(), 1e-9)
    photo = str(ds.PhotometricInterpretation)
    plut = str(getattr(ds, "PresentationLUTShape", "") or "")
    if photo == "MONOCHROME1" or (photo == "MONOCHROME2" and plut == "INVERSE"):
        x = 1.0 - x
        note.append(f"inverted ({photo}, PresentationLUTShape={plut or 'absent'})")
    return x, "; ".join(note)


def map_back(rc512, S, pt, pl, R, C, flip_h, flip_v):
    p = (rc512 + 0.5) * (S / 512.0) - 0.5
    row = p[:, 0] - pt
    col = p[:, 1] - pl
    if flip_h:
        col = (C - 1) - col
    if flip_v:
        row = (R - 1) - row
    return row, col


def process(case, pid, root, se, inst, model, view, why):
    t0 = time.time()
    ds = pydicom.dcmread(root / inst["file"])
    assert ds.SOPInstanceUID == inst["sopInstanceUid"]
    R, C = int(ds.Rows), int(ds.Columns)
    x, voi_note = display_image(ds)
    po = list(getattr(ds, "PatientOrientation", []) or [])
    flip_h = bool(po and po[0] and po[0][0] == "R")
    flip_v = bool(len(po) > 1 and po[1] and po[1][0] == "H")
    disp = x[:, ::-1] if flip_h else x
    disp = disp[::-1, :] if flip_v else disp
    S = max(R, C)
    pt, pl = (S - R) // 2, (S - C) // 2
    sq = np.zeros((S, S), np.float64)
    sq[pt:pt + R, pl:pl + C] = disp
    x512 = resize(sq, (512, 512), order=1, mode="constant", anti_aliasing=True, preserve_range=True)
    inp = torch.from_numpy((x512 * 2048.0 - 1024.0).astype(np.float32))[None, None]
    with torch.no_grad():
        probs = torch.sigmoid(model(inp))[0].numpy()  # (14, 512, 512)
    rec = {"case": case, "packId": pid, "subjectKey": se["subjectKey"], "seriesUid": se["uid"], "sopInstanceUid": inst["sopInstanceUid"],
           "modality": str(ds.Modality), "view": view, "viewEvidence": why, "rows": R, "columns": C,
           "photometric": str(ds.PhotometricInterpretation), "patientOrientation": po, "voi": voi_note,
           "transform": {"flipH": flip_h, "flipV": flip_v, "padTop": pt, "padLeft": pl, "square": S, "modelSize": 512,
                         "scale": S / 512.0, "mapping": "row = (m_r+0.5)*S/512-0.5-padTop, col = (m_c+0.5)*S/512-0.5-padLeft, then un-flip"},
           "structures": {}}
    out = CXR_WORK / case
    cdir = out / "contours"
    if cdir.exists():
        for p in cdir.glob("*.json"):
            p.unlink()
    img_area = float(R * C)
    min_ring = Q.CXR_MIN_RING_FRACTION * img_area
    cent, masks, geoms = {}, {}, {}
    for ci, tname in enumerate(model.targets):
        name = XRV_NAMES[tname]
        prob = probs[ci]
        # rule 1 (CXR): largest connected component on the model grid (diaphragm: up to 2 domes), extra parts >= 5 %
        lab, n = ndi.label(prob >= 0.5, structure=np.ones((3, 3), bool))
        if n == 0:
            rec["structures"][name] = {"model": tname, "status": "dropped: not found by the model", "rule": 1}
            continue
        sizes = np.bincount(lab.ravel())[1:]
        order = list(np.argsort(-sizes))
        keep = order[:1] + [i for i in order[1:MULTI_CXR.get(name, 1)] if sizes[i] >= Q.FRAGMENT_MIN_FRACTION * sizes.sum()]
        kept512 = np.isin(lab, [i + 1 for i in keep])
        pclean = np.where(ndi.binary_dilation(kept512, iterations=2), prob, 0.0)
        # reference mask on the original grid: bilinear upsample of the cleaned probabilities (align_corners=False)
        up = F.interpolate(torch.from_numpy(pclean.astype(np.float32))[None, None], size=(S, S), mode="bilinear",
                           align_corners=False)[0, 0].numpy()[pt:pt + R, pl:pl + C]
        if flip_h:
            up = up[:, ::-1]
        if flip_v:
            up = up[::-1, :]
        ref = up >= 0.5
        rings, clamped, small_rings = [], 0, 0
        for c in [c - 1.0 for c in measure.find_contours(np.pad(pclean, 1), 0.5)]:
            if len(c) < 4:
                continue
            row, col = map_back(c, S, pt, pl, R, C, flip_h, flip_v)
            row_c, col_c = np.clip(row, -0.5, R - 0.5), np.clip(col, -0.5, C - 0.5)
            clamped += int(np.sum((row_c != row) | (col_c != col)))
            pts = np.column_stack([row_c, col_c])
            if not np.allclose(pts[0], pts[-1]):
                pts = np.vstack([pts, pts[:1]])
            sp = measure.approximate_polygon(pts, tolerance=DP_TOL_PX)
            ring = [[float(q[1]), float(q[0])] for q in sp]
            if len(ring) >= 4 and ring_area(ring) >= max(MIN_RING_AREA_PX2, min_ring):
                rings.append(ring)
            else:
                small_rings += 1
        polys, holes = [], []
        for i, r in enumerate(rings):
            depth = sum(1 for j, o in enumerate(rings) if j != i and ring_area(o) > ring_area(r)
                        and measure.points_in_poly([r[0]], o)[0])
            (holes if depth % 2 else polys).append(r)
        srec = {"model": tname, "fragmentsRemoved": int(n - len(keep)), "ringsBelowMinArea": small_rings}
        rec["structures"][name] = srec
        if not polys:
            srec.update(status="dropped: only rings < 0.2 % of the image area", rule=1)
            continue
        m = np.zeros((R, C), bool)
        for r in polys + holes:
            a = np.asarray(r)
            rr, cc = fill_polygon(a[:, 1], a[:, 0], (R, C))
            m[rr, cc] ^= True
        dice = 2 * (m & ref).sum() / max(m.sum() + ref.sum(), 1)
        rows_, cols_ = np.nonzero(m)
        cent[name] = (float(cols_.mean()), float(rows_.mean()))
        masks[name] = m
        geoms[name] = {"geometryType": "contour_set", "space": "image_px",
                       "planes": [{"sopInstanceUid": inst["sopInstanceUid"], "frame": 1, "polygons": polys, **({"holes": holes} if holes else {})}]}
        srec.update(status="ok", rule=None, polygons=len(polys), holes=len(holes), areaFraction=round(float(m.mean()), 5),
                    diceVsUpsampledMask=round(float(dice), 4), meanDisplayIntensity=round(float(x[m].mean()), 3),
                    clampedVertices=clamped, centroidColRow=[round(v, 1) for v in cent[name]])
        if m.mean() < Q.CXR_MIN_AREA_FRACTION:
            srec.update(status="dropped: area < 0.1 % of the image", rule=1)
        elif dice < 0.9:
            srec.update(status="dropped: mapping check failed (Dice < 0.9)", rule=0)
    # thorax box (rule 5): union bounding box of both lungs, expanded by 25 % of its size on every side
    thorax = None
    if "lung_left" in masks and "lung_right" in masks:
        rr, cc = np.nonzero(masks["lung_left"] | masks["lung_right"])
        h, w = rr.max() - rr.min(), cc.max() - cc.min()
        thorax = [float(cc.min() - 0.25 * w), float(rr.min() - 0.25 * h), float(cc.max() + 0.25 * w), float(rr.max() + 0.25 * h)]
        for name, (cx, cy) in cent.items():
            s_ = rec["structures"][name]
            inside = thorax[0] <= cx <= thorax[2] and thorax[1] <= cy <= thorax[3]
            s_["insideThoraxBox"] = bool(inside)
            if s_["status"] == "ok" and not inside:
                s_.update(status="dropped: centroid outside the thorax box", rule=5)
    # laterality / anatomy QC (rules 4/5). patient-left is +col unless the stored image is flipped (then -col).
    header_side = bool(po and po[0] and po[0][0] in "LR")
    left_sign = -1 if flip_h else 1
    lat = []
    for L, Rn in LR_PAIRS:
        if L in cent and Rn in cent:
            margin = left_sign * (cent[L][0] - cent[Rn][0])
            lat.append({"left": L, "right": Rn, "marginPx": round(margin, 1), "pass": margin > 0})
    heart_ok = None
    if "heart" in cent and "spine" in cent:
        heart_ok = left_sign * (cent["heart"][0] - cent["spine"][0]) > 0
    lungs_dark = None  # polarity guard: aerated lung must be darker than the projected spine (catches a missed inversion)
    if "spine" in masks and ("lung_left" in masks or "lung_right" in masks):
        lm = np.zeros((R, C), bool)
        for n_ in ("lung_left", "lung_right"):
            if n_ in masks:
                lm |= masks[n_]
        lungs_dark = bool(x[lm & ~masks["spine"]].mean() < x[masks["spine"]].mean())
    frontal_ok = all(rec["structures"].get(n_, {}).get("areaFraction", 0) >= 0.03 for n_ in ("lung_left", "lung_right")) and \
        all(l["pass"] for l in lat if l["left"] == "lung_left")
    rec["qc"] = {"laterality": lat, "heartLeftOfSpine": heart_ok, "lungsDarkerThanSpine": lungs_dark,
                 "frontalByModel": bool(frontal_ok), "sideFromHeader": header_side, "thoraxBox": thorax}
    accept = (view == "frontal" or frontal_ok) and lungs_dark is not False and heart_ok is not False
    rec["accepted"] = bool(accept)
    rec["reason"] = "ok" if accept else f"rejected: view={view}, frontalByModel={frontal_ok}, lungsDark={lungs_dark}, heartLeft={heart_ok}"
    failed = {n_ for l in lat if not l["pass"] for n_ in (l["left"], l["right"])}
    for name, s_ in rec["structures"].items():
        if s_["status"] != "ok":
            continue
        if not accept:
            s_.update(status="dropped: image rejected", rule=5)
        elif name in failed:
            s_.update(status="dropped: left/right order", rule=4)
        else:
            dump_json_compact(geoms[name], cdir / f"{name}.json")
            s_["bytes"] = (cdir / f"{name}.json").stat().st_size
    rec["seconds"] = round(time.time() - t0, 1)
    dump_json(rec, out / "info.json")
    return rec


def main(argv):
    import torchxrayvision as xrv
    want = set(argv[1:])
    model = xrv.baseline_models.chestx_det.PSPNet(cache_dir=str(DATA_ROOT / "xrv-cache"))
    meta = {"torchxrayvision": xrv.__version__, "torch": torch.__version__, "model": repr(model),
            "weights": model.weights_filename_local, "targets": list(model.targets)}
    rows = []
    for pid, root, m in source_manifests():
        for se in m["series"]:
            if se["modality"] not in ("CR", "DX") or se["role"] != "diagnostic":
                continue
            frontal = []
            for inst in se["instances"]:
                ds = pydicom.dcmread(root / inst["file"], stop_before_pixels=True)
                v, why = view_of(ds)
                if v == "lateral":
                    rows.append({"case": None, "packId": pid, "subjectKey": se["subjectKey"], "sopInstanceUid": inst["sopInstanceUid"],
                                 "view": v, "viewEvidence": why, "accepted": False, "reason": "lateral view skipped"})
                    continue
                frontal.append((inst, v, why))
            for n, (inst, v, why) in enumerate(frontal):
                case = f"{subject_short(se['subjectKey'])}-cxr" + (f"-{n + 1}" if len(frontal) > 1 else "")
                if want and case not in want:
                    continue
                r = process(case, pid, root, se, inst, model, v, why)
                ok = [k for k, s in r["structures"].items() if s["status"] == "ok"]
                print(f"{pid:12s} {case:22s} {v:8s} accepted={r['accepted']} {len(ok)}/14 ok  voi: {r['voi']}  "
                      f"minDice={min([s['diceVsUpsampledMask'] for s in r['structures'].values() if 'diceVsUpsampledMask' in s] or [0]):.3f} "
                      f"lat={[l['pass'] for l in r['qc']['laterality']]} heartLeft={r['qc']['heartLeftOfSpine']}", flush=True)
                rows.append({k: r[k] for k in ("case", "packId", "subjectKey", "seriesUid", "sopInstanceUid", "view", "viewEvidence", "accepted", "reason")})
    dump_json({"meta": meta, "cases": rows}, CXR_WORK / "cxr_cases.json")


if __name__ == "__main__":
    main(sys.argv)
