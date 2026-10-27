"""Atlas step CT-3: map every segmented class back onto the ORIGINAL CT slices, derive sub-parts, trace image_px
contours, apply QC.

  python scripts/atlas/ct_contours.py [--force] [case ...]

Inputs per case (WORK/<case>/): ct.nii.gz + slices.json (ct_convert.py), seg_total.nii.gz (task "total", multilabel)
and, only where it was run, seg_lungvessels.nii.gz (open task "lung_vessels") from which the extrapulmonary main bronchi
and the pulmonary arteries are derived.

Mapping (unchanged approach): segmentation grid must equal ct.nii.gz (shape + affine; else nearest-neighbour resample,
recorded); NIfTI slice k <-> SOP Instance UID via the IPP sort in slices.json; mask[:, :, k].T is the (row, col) image of
that SOP; skimage.measure.find_contours(level 0.5) on a zero-padded copy -> [col, row] image_px (pixel-centre
convention); Douglas-Peucker CT_DP_TOL_PX (1 px).

Sub-parts (subparts.py): aorta -> ascending / arch / descending thoracic / abdominal; colon -> caecum+ascending /
transverse / descending / sigmoid / rectum (only when the colon gives one clean path). Parts are QC'd like any other
structure, plus an anatomical-order check (ascending anterior + right of descending, arch above both, abdominal below
thoracic descending).

QC (qc_rules.py), recorded per structure in structures.json, applied in this order:
  rule 0  alignment: NIfTI affine (RAS->LPS) vs DICOM IPP/IOP/PixelSpacing for sampled voxels < 0.5 mm
  rule 1  fragments: largest 3D component only (MULTIPART exceptions), extra components >= 5 % of the volume; rings and
          holes < 10 mm2 dropped per slice; structures left with < 0.3 ml or < 2 slices dropped
  rule 2  density: median HU of the published voxels within the class range (contrast study = DICOM ContrastBolusAgent
          present and not "without", or aorta median >= 150 HU)
  rule 4  laterality / anatomical order (pairs, ribs vs midline per slice, lateral structures vs midline, vertebral
          order, aortic part order)
  rule 3  coverage / typical volume needs all cases: applied in write_pack.py from the truncation evidence recorded here.
"""
from __future__ import annotations

import sys
import time

import nibabel as nib
import numpy as np
import SimpleITK as sitk
from scipy import ndimage as ndi
from skimage import measure

import qc_rules as Q
import subparts
from common import (CT_DP_TOL_PX, MIN_RING_AREA_PX2, RAS_TO_LPS, WORK, category, dicom_pixel_to_lps, dump_json,
                    dump_json_compact, laterality_pairs, load_json, ring_area, slice_normal)

RULES_VERSION = 4
MIN_VOLUME_ML = 0.3
LAT_MIN_AREA_MM2 = 5.0
CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
FULL2 = np.ones((3, 3), bool)
FULL3 = np.ones((3, 3, 3), bool)
SYMMETRIC_ONLY_3D = {("spleen", "liver"), ("stomach", "liver"), ("aorta", "inferior_vena_cava")}
NO_CONTRAST_WORDS = ("W/O", "WITHOUT", "NONE", "NON-CONTRAST", "NO CONTRAST")
LUNG_LOBES = ("lung_upper_lobe_left", "lung_lower_lobe_left", "lung_upper_lobe_right", "lung_middle_lobe_right", "lung_lower_lobe_right")


class Geo:
    """LPS geometry of the original slice grid (slices are collinear along n, checked in ct_convert.py)."""

    def __init__(self, slices, iop, ps, step):
        self.ipp0 = np.array(slices[0]["ipp"], float)
        self.X, self.Y = np.array(iop[:3], float), np.array(iop[3:], float)
        self.n = slice_normal(iop)
        self.ps, self.step = ps, step
        self.spacing = (float(ps[1]), float(ps[0]), float(step))
        self.z = np.array([s["ipp"][2] for s in slices], float)

    def lps(self, i, j, k):
        i, j, k = (np.asarray(v, float) for v in (i, j, k))
        p = (self.ipp0[None] + np.multiply.outer(i, self.X * self.ps[1]) + np.multiply.outer(j, self.Y * self.ps[0])
             + np.multiply.outer(k, self.n * self.step))
        return p[..., 0], p[..., 1], p[..., 2]

    def slice_z(self, k):
        return float(self.z[int(k)])

    def scan_bottom_z(self):
        return float(self.z.min())


def ts_class_map(task="total"):
    from totalsegmentator.map_to_binary import class_map
    return class_map[task]


def trace(mask2d):
    padded = np.pad(mask2d.astype(np.float32), 1)
    cs = measure.find_contours(padded, 0.5, fully_connected="low")
    if not cs:
        return None
    c = max(cs, key=len) - 1.0
    if not np.allclose(c[0], c[-1]):
        c = np.vstack([c, c[:1]])
    s = measure.approximate_polygon(c, tolerance=CT_DP_TOL_PX)
    if len(s) < 4:
        return None
    ring = [[float(p[1]), float(p[0])] for p in s]
    return ring if ring_area(ring) >= MIN_RING_AREA_PX2 else None


def slice_polys(m2, col0, row0, min_px):
    """4-connected components >= min_px (10 mm2) -> outer rings + holes (>= min_px) in full-image [col,row]."""
    lab, n = ndi.label(m2, structure=CROSS)
    polys, holes, kept = [], [], np.zeros_like(m2)
    if n == 0:
        return polys, holes, kept
    sizes = np.bincount(lab.ravel())
    objs = ndi.find_objects(lab)
    for ci in range(1, n + 1):
        if sizes[ci] < min_px:
            continue
        sl = objs[ci - 1]
        comp = lab[sl] == ci
        filled = ndi.binary_fill_holes(comp, structure=FULL2)
        hl, nh = ndi.label(filled & ~comp, structure=FULL2)
        hsz = np.bincount(hl.ravel())
        comp = comp | np.isin(hl, [h for h in range(1, nh + 1) if hsz[h] < min_px])  # holes < 10 mm2 filled
        ring = trace(filled)
        if ring is None:
            continue
        kept[sl] |= comp
        polys.append([[x + col0 + sl[1].start, y + row0 + sl[0].start] for x, y in ring])
        for hi in range(1, nh + 1):
            if hsz[hi] >= min_px:
                r = trace(hl == hi)
                if r is not None:
                    holes.append([[x + col0 + sl[1].start, y + row0 + sl[0].start] for x, y in r])
    return polys, holes, kept


class Case:
    def __init__(self, case):
        self.case = case
        self.d = WORK / case
        self.info = load_json(self.d / "info.json")
        self.slices = load_json(self.d / "slices.json")
        self.iop, self.ps = self.info["iop"], self.info["pixelSpacing"]
        ct_img = nib.load(str(self.d / "ct.nii.gz"))
        self.A_ct = ct_img.affine
        self.ct = np.asanyarray(ct_img.dataobj)
        self.K = self.ct.shape[2]
        self.px_area = float(self.ps[0]) * float(self.ps[1])
        self.vox_ml = self.px_area * float(self.info["sliceStepMm"]) / 1000.0
        self.min_px = int(np.ceil(Q.CT_MIN_RING_MM2 / self.px_area))
        self.geo = Geo(self.slices, self.iop, self.ps, self.info["sliceStepMm"])
        self.rng = np.random.default_rng(1)

    def measure(self, name, crop, bb, kind, A_seg, want_full=False):
        """Rule 0/1 + contours + statistics for one structure given its (cropped) raw mask."""
        lab, n = ndi.label(crop, structure=FULL3)
        sizes = np.bincount(lab.ravel())[1:] * self.vox_ml
        total_ml = float(sizes.sum())
        order = list(np.argsort(-sizes))
        if name == "costal_cartilages":
            keep = [i for i in order if sizes[i] >= Q.COSTAL_MIN_ML] or order[:1]
        else:
            maxk = Q.MULTIPART.get(name, 1)
            keep = order[:1] + [i for i in order[1:maxk] if sizes[i] >= Q.FRAGMENT_MIN_FRACTION * total_ml]
        cleaned = np.isin(lab, [i + 1 for i in keep])
        rec = {"source": kind, "category": category(name), "rawVolumeMl": round(total_ml, 2), "components": int(n),
               "componentsKept": len(keep), "fragmentsRemovedMl": round(total_ml - float(sizes[keep].sum()), 2)}
        i0, j0, k0 = bb[0].start, bb[1].start, bb[2].start
        ijk = np.argwhere(cleaned)
        sel = ijk[self.rng.choice(len(ijk), size=min(100, len(ijk)), replace=False)]
        res_mm = []
        for i, j, k in sel:
            gi, gj, gk = i + i0, j + j0, k + k0
            p_n = (RAS_TO_LPS @ A_seg @ np.array([gi, gj, gk, 1.0]))[:3]
            p_d = dicom_pixel_to_lps(self.slices[gk]["ipp"], self.iop, self.ps, col=float(gi), row=float(gj))
            res_mm.append(float(np.linalg.norm(p_n - p_d)))
        rec["alignmentMaxResidualMm"] = max(res_mm)
        planes, per_slice, hu_vals = [], {}, []
        sx = sy = sz = 0.0
        cnt = edge_px = 0
        ct, R, C = self.ct, self.ct.shape[1], self.ct.shape[0]
        for kk in range(cleaned.shape[2]):
            m2 = cleaned[:, :, kk].T
            if not m2.any():
                continue
            k = kk + k0
            polys, holes, kept = slice_polys(m2, i0, j0, self.min_px)
            if not polys:
                continue
            rows, cols = np.nonzero(kept)
            rows_g, cols_g = rows + j0, cols + i0
            x, y, z = self.geo.lps(cols_g, rows_g, np.full(cols_g.shape, k))
            per_slice[k] = {"areaMm2": len(rows) * self.px_area, "cx": float(x.mean())}
            sx, sy, sz, cnt = sx + float(x.sum()), sy + float(y.sum()), sz + float(z.sum()), cnt + len(rows)
            edge_px += int(np.sum((rows_g == 0) | (cols_g == 0) | (rows_g == R - 1) | (cols_g == C - 1)))
            hu_vals.append(ct[cols_g, rows_g, k].astype(np.int16))
            pl = {"sopInstanceUid": self.slices[k]["sopInstanceUid"], "frame": 1, "polygons": polys}
            if holes:
                pl["holes"] = holes
            planes.append(pl)
        rec["volumeMl"] = round(cnt * self.vox_ml, 2)
        rec["planes"] = len(planes)
        rec["kRange"] = [min(per_slice), max(per_slice)] if per_slice else None
        rec["medianHU"] = float(np.median(np.concatenate(hu_vals))) if hu_vals else None
        rec["centroid"] = [sx / cnt, sy / cnt, sz / cnt] if cnt else None
        rec["centroidX"] = sx / cnt if cnt else None
        rec["centroidZ"] = sz / cnt if cnt else None
        if per_slice:
            amax = max(v["areaMm2"] for v in per_slice.values())
            first = per_slice.get(0, {}).get("areaMm2", 0.0) / amax
            last = per_slice.get(self.K - 1, {}).get("areaMm2", 0.0) / amax
            rec["truncation"] = {"firstSliceAreaFraction": round(first, 3), "lastSliceAreaFraction": round(last, 3),
                                 "inPlaneEdgePixels": edge_px, "truncated": bool(first >= 0.10 or last >= 0.10 or edge_px >= 5)}
        rec["status"], rec["rule"] = "ok", None
        if rec["alignmentMaxResidualMm"] >= 0.5:
            rec["status"], rec["rule"] = "dropped: alignment residual >= 0.5 mm", 0
        elif rec["volumeMl"] < MIN_VOLUME_ML or len(planes) < 2:
            rec["status"], rec["rule"] = f"dropped: fragment only ({rec['volumeMl']} ml on {len(planes)} slices)", 1
        geom = {"geometryType": "contour_set", "space": "image_px", "planes": planes} if planes else None
        full = None
        if want_full:
            full = np.zeros(self.ct.shape, bool)
            full[bb] = cleaned
        return rec, geom, per_slice, full


def process(case: str) -> dict:
    t0 = time.time()
    cs = Case(case)
    d = cs.d
    seg_img = nib.load(str(d / "seg_total.nii.gz"))
    out = {"case": case, "rulesVersion": RULES_VERSION,
           "gridIdentical": bool(seg_img.shape == cs.ct.shape and np.allclose(seg_img.affine, cs.A_ct, atol=1e-3))}
    if out["gridIdentical"]:
        seg = np.asanyarray(seg_img.dataobj).astype(np.int16)
        A_seg = seg_img.affine
    else:
        res = sitk.Resample(sitk.ReadImage(str(d / "seg_total.nii.gz")), sitk.ReadImage(str(d / "ct.nii.gz")),
                            sitk.Transform(), sitk.sitkNearestNeighbor, 0)
        seg = sitk.GetArrayFromImage(res).transpose(2, 1, 0).astype(np.int16)
        A_seg = cs.A_ct
    out["sliceIppMatchMaxResidualMm"] = max(float(np.linalg.norm((RAS_TO_LPS @ cs.A_ct @ [0, 0, s["k"], 1.0])[:3] - np.array(s["ipp"])))
                                            for s in cs.slices)
    cmap = ts_class_map()
    idx_of = {v: k for k, v in cmap.items()}
    st, geoms, per_slice_all, fulls = {}, {}, {}, {}
    keep_full = {"aorta", "colon", "vertebrae_T12", "hip_left", "hip_right", "sacrum", "vertebrae_S1", *LUNG_LOBES}
    objs = ndi.find_objects(seg)
    for idx, name in cmap.items():
        if idx > len(objs) or objs[idx - 1] is None:
            continue
        bb = objs[idx - 1]
        rec, geom, ps_, full = cs.measure(name, seg[bb] == idx, bb, "total", A_seg, want_full=name in keep_full)
        st[name], per_slice_all[name] = rec, ps_
        if geom:
            geoms[name] = geom
        if name in keep_full:
            fulls[name] = full
    colon_raw = seg == idx_of["colon"] if "colon" in st else None

    # ---- extras from the open lung_vessels task (only where it was run)
    out["extrasDerived"] = []
    pl = d / "seg_lungvessels.nii.gz"
    if pl.exists() and (d / "ts_report_lungvessels.json").exists():
        img = nib.load(str(pl))
        if img.shape == cs.ct.shape and np.allclose(img.affine, cs.A_ct, atol=1e-3):
            lv = np.asanyarray(img.dataobj)
            lvm = {v: k for k, v in ts_class_map("lung_vessels").items()}
            extra = {"pulmonary_artery": lv == lvm["lung_arteries"]}
            lobes = np.isin(seg, [idx_of[n] for n in LUNG_LOBES])
            trachea = seg == idx_of["trachea"]
            outside = (lv == lvm["lung_airways"]) & ~ndi.binary_dilation(trachea, iterations=1) & ~lobes
            lab, n = ndi.label(outside, structure=FULL3)
            if n >= 2 and trachea.any():
                sizes = np.bincount(lab.ravel())[1:]
                tx = cs.geo.lps(*np.argwhere(trachea).T)[0].mean()
                for comp in np.argsort(-sizes)[:2] + 1:
                    m = lab == comp
                    cx = cs.geo.lps(*np.argwhere(m).T)[0].mean()
                    extra["main_bronchus_left" if cx > tx else "main_bronchus_right"] = m
            for name, m in extra.items():
                if m.any():
                    bb = ndi.find_objects(m.astype(np.uint8))[0]
                    rec, geom, ps_, _ = cs.measure(name, m[bb], bb, "extra", A_seg)
                    st[name], per_slice_all[name] = rec, ps_
                    if geom:
                        geoms[name] = geom
                    out["extrasDerived"].append(name)

    ok = lambda n: n in st and st[n]["status"] == "ok"

    # ---- derived sub-parts
    parts_info = {}
    if ok("aorta"):
        lung = None
        lobes_ok = [fulls[n] for n in LUNG_LOBES if n in fulls and ok(n)]
        if lobes_ok:
            lung = np.logical_or.reduce(lobes_ok)
        t12 = fulls.get("vertebrae_T12") if ok("vertebrae_T12") else None
        parts, info = subparts.aorta_parts(fulls["aorta"], cs.geo, cs.px_area, t12=t12, lung=lung)
        parts_info["aorta"] = info
        for name, m in parts.items():
            bb = ndi.find_objects(m.astype(np.uint8))[0]
            rec, geom, ps_, _ = cs.measure(name, m[bb], bb, "derived:aorta", A_seg)
            st[name], per_slice_all[name] = rec, ps_
            if geom:
                geoms[name] = geom
    # midline per slice from the spinal cord, else vertebrae (also used by rule 4)
    mid = {}
    sc = per_slice_all.get("spinal_cord", {}) if ok("spinal_cord") else {}
    vert_names = [n for n in Q.VERTEBRA_ORDER if ok(n)]
    for k in range(cs.K):
        if k in sc and sc[k]["areaMm2"] >= LAT_MIN_AREA_MM2:
            mid[k] = sc[k]["cx"]
        else:
            vs = [per_slice_all[v][k]["cx"] for v in vert_names if k in per_slice_all[v]]
            if vs:
                mid[k] = float(np.mean(vs))
    mid_global = float(np.median(list(mid.values()))) if mid else None
    out["midline"] = {"slicesWithMidline": len(mid), "globalX": mid_global}
    if ok("colon") and colon_raw is not None:
        hips = None
        hl = [fulls[n] for n in ("hip_left", "hip_right") if n in fulls and ok(n)]
        if hl:
            hips = np.logical_or.reduce(hl)
        sac = [fulls[n] for n in ("sacrum", "vertebrae_S1") if n in fulls and ok(n)]
        sacrum = np.logical_or.reduce(sac) if sac else None
        parts, info = subparts.colon_parts(colon_raw, cs.geo, mid_global, hips=hips, sacrum=sacrum)
        parts_info["colon"] = info
        for name, m in parts.items():
            bb = ndi.find_objects(m.astype(np.uint8))[0]
            rec, geom, ps_, _ = cs.measure(name, m[bb], bb, "derived:colon", A_seg)
            st[name], per_slice_all[name] = rec, ps_
            if geom:
                geoms[name] = geom
    out["subparts"] = parts_info

    # ---- rule 2: density
    agent = (cs.info.get("contrastBolusAgent") or "").upper()
    header_contrast = bool(agent) and not any(w in agent for w in NO_CONTRAST_WORDS)
    aorta_med = st.get("aorta", {}).get("medianHU")
    contrast = header_contrast or (aorta_med is not None and aorta_med >= 150)
    out["contrast"] = {"header": cs.info.get("contrastBolusAgent"), "aortaMedianHU": aorta_med, "contrastStudy": contrast}
    for name, rec in st.items():
        if rec["status"] != "ok" or rec["medianHU"] is None:
            continue
        group, good, rng_txt = Q.density_rule(name, rec["medianHU"], contrast)
        rec["density"] = {"group": group, "range": rng_txt, "pass": bool(good)}
        if not good:
            rec["status"], rec["rule"] = f"dropped: median {rec['medianHU']:.0f} HU outside {rng_txt} for {group}", 2

    # ---- rule 4: laterality and anatomical order
    lat = []
    for L, R in laterality_pairs([n for n in st if ok(n)]):
        a, b = st[L], st[R]
        three_d_ok = a["centroidX"] > b["centroidX"]
        if (L, R) in SYMMETRIC_ONLY_3D:
            shared, wrong = [], []
        else:
            pa, pb = per_slice_all[L], per_slice_all[R]
            shared = [k for k in pa if k in pb and pa[k]["areaMm2"] >= LAT_MIN_AREA_MM2 and pb[k]["areaMm2"] >= LAT_MIN_AREA_MM2]
            wrong = [k for k in shared if pa[k]["cx"] <= pb[k]["cx"]]
        passed = three_d_ok and not wrong
        lat.append({"left": L, "right": R, "sharedSlices": len(shared), "wrongSlices": wrong,
                    "centroidMarginMm": round(a["centroidX"] - b["centroidX"], 1), "pass": passed})
        for n_ in (L, R):
            st[n_].setdefault("lateralityChecks", []).append({"vs": R if n_ == L else L, "slices": len(shared), "pass": passed})
    for l in lat:
        if not l["pass"]:
            for n_ in (l["left"], l["right"]):
                if ok(n_):
                    st[n_]["status"], st[n_]["rule"] = f"dropped: left/right order vs {l['right'] if n_ == l['left'] else l['left']}", 4
    for name in [n for n in st if ok(n)]:
        side = Q.side_of(name)
        if side is None or mid_global is None:
            continue
        sgn = 1 if side == "left" else -1
        if Q.RIB.match(name):
            ks = [k for k, v in per_slice_all[name].items() if v["areaMm2"] >= LAT_MIN_AREA_MM2]
            wrong = [k for k in ks if sgn * (per_slice_all[name][k]["cx"] - mid.get(k, mid_global)) <= 0]
            st[name]["midlineCheck"] = {"slices": len(ks), "wrong": len(wrong), "pass": not wrong}
            if wrong:
                st[name]["status"], st[name]["rule"] = f"dropped: on the wrong side of the midline on {len(wrong)} slice(s)", 4
        elif Q.MIDLINE_LATERAL.match(name):
            good = sgn * (st[name]["centroidX"] - mid_global) > 0
            st[name]["midlineCheck"] = {"slices": None, "wrong": 0 if good else 1, "pass": bool(good)}
            if not good:
                st[name]["status"], st[name]["rule"] = "dropped: centroid on the wrong side of the midline", 4
    vz = [(n, st[n]["centroidZ"]) for n in Q.VERTEBRA_ORDER if ok(n)]
    keep_v = Q.longest_decreasing(vz)
    for n_, z in vz:
        st[n_]["vertebralOrder"] = {"pass": n_ in keep_v}
        if n_ not in keep_v:
            st[n_]["status"], st[n_]["rule"] = "dropped: vertebral level out of craniocaudal order", 4
    # aortic parts: ascending anterior + right of descending thoracic; arch above both; abdominal below thoracic
    c = lambda n: st[n]["centroid"]
    checks = []
    if ok("aorta_ascending") and ok("aorta_descending_thoracic"):
        good = c("aorta_ascending")[1] < c("aorta_descending_thoracic")[1] and c("aorta_ascending")[0] < c("aorta_descending_thoracic")[0]
        checks.append((("aorta_ascending", "aorta_descending_thoracic"), good, "ascending anterior and right of descending"))
    if ok("aorta_arch"):
        for other in ("aorta_ascending", "aorta_descending_thoracic"):
            if ok(other):
                checks.append((("aorta_arch",), c("aorta_arch")[2] > c(other)[2], f"arch above {other}"))
    if ok("aorta_abdominal") and ok("aorta_descending_thoracic"):
        checks.append((("aorta_abdominal",), c("aorta_abdominal")[2] < c("aorta_descending_thoracic")[2], "abdominal below thoracic"))
    if ok("colon_ascending") and ok("colon_descending"):
        checks.append((("colon_ascending", "colon_descending"), c("colon_ascending")[0] < c("colon_descending")[0], "ascending colon right of descending"))
    for names, good, why in checks:
        for n_ in names:
            st[n_].setdefault("orderChecks", []).append({"check": why, "pass": bool(good)})
            if not good and ok(n_):
                st[n_]["status"], st[n_]["rule"] = f"dropped: anatomical order ({why})", 4

    cdir = d / "contours"
    if cdir.exists():
        for p in cdir.glob("*.json"):
            p.unlink()
    for name, rec in st.items():
        if rec["status"] == "ok" and name in geoms:
            dump_json_compact(geoms[name], cdir / f"{name}.json")
            rec["bytes"] = (cdir / f"{name}.json").stat().st_size
    resid = [r["alignmentMaxResidualMm"] for r in st.values()]
    out.update({"structures": st, "laterality": lat, "alignmentMaxResidualMm": max(resid) if resid else None,
                "seconds": round(time.time() - t0, 1)})
    dump_json(out, d / "structures.json")
    return out


def up_to_date(d):
    s = d / "structures.json"
    if not s.exists():
        return False
    try:
        if load_json(s).get("rulesVersion") != RULES_VERSION:
            return False
    except Exception:
        return False
    newest = max(p.stat().st_mtime for p in [d / "seg_total.nii.gz", d / "seg_lungvessels.nii.gz"] if p.exists())
    return s.stat().st_mtime > newest


def main(argv):
    force = "--force" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")] or [r["case"] for r in load_json(WORK / "ct_cases.json") if r["eligible"]]
    for c in cases:
        d = WORK / c
        if not (d / "seg_total.nii.gz").exists() or not (d / "ts_report.json").exists() or \
                (d / "ts_report.json").stat().st_mtime < (d / "seg_total.nii.gz").stat().st_mtime:
            print(f"{c}: not segmented yet")
            continue
        if (d / "seg_lungvessels.nii.gz").exists() and not (d / "ts_report_lungvessels.json").exists():
            print(f"{c}: not segmented yet (lung_vessels running)")
            continue
        if not force and up_to_date(d):
            print(f"{c}: contours up to date")
            continue
        o = process(c)
        okn = [n for n, r in o["structures"].items() if r["status"] == "ok"]
        dropped = {n: (r["rule"], r["status"]) for n, r in o["structures"].items() if r["status"] != "ok"}
        kb = sum(r.get("bytes", 0) for r in o["structures"].values()) / 1e3
        sp = {k: (v.get("reason") or v.get("note") or sorted(n for n in o["structures"] if n.startswith(("aorta_", "colon_", "rectum"))))
              for k, v in o["subparts"].items()}
        print(f"{c}: {len(okn)} ok, {len(dropped)} dropped, {kb:.0f} kB, maxRes {o['alignmentMaxResidualMm']:.1e} mm, "
              f"contrast {o['contrast']['contrastStudy']}, extras {o['extrasDerived']}, parts {sp}, {o['seconds']} s", flush=True)
        for n, (rule, s) in dropped.items():
            print(f"     drop[{rule}] {n}: {s}")


if __name__ == "__main__":
    main(sys.argv)
