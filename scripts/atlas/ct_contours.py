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

RULES_VERSION = 12
CHAMBERS = {44: "heart_myocardium", 45: "heart_atrium_left", 46: "heart_ventricle_left", 47: "heart_atrium_right",
            48: "heart_ventricle_right"}
CHAMBER_VOLUME_ML = {"heart_atrium_right": (20, 250), "heart_atrium_left": (20, 250), "heart_ventricle_right": (40, 350),
                     "heart_ventricle_left": (40, 350), "heart_myocardium": (60, 400)}  # adult; children: lower bound / 5
LOBE_ARTERY = {"lung_upper_lobe_right": "pulmonary_arteries_right_upper_lobe", "lung_middle_lobe_right": "pulmonary_arteries_right_middle_lobe",
               "lung_lower_lobe_right": "pulmonary_arteries_right_lower_lobe", "lung_upper_lobe_left": "pulmonary_arteries_left_upper_lobe",
               "lung_lower_lobe_left": "pulmonary_arteries_left_lower_lobe"}
PA_DP_TOL_PX = 0.5  # finer outlines for the pulmonary trunk / arteries
MIN_VOLUME_ML = 0.3
LAT_MIN_AREA_MM2 = 5.0
CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
FULL2 = np.ones((3, 3), bool)
FULL3 = np.ones((3, 3, 3), bool)
SYMMETRIC_ONLY_3D = {("spleen", "liver"), ("stomach", "liver"), ("aorta", "inferior_vena_cava"),
                     ("heart_atrium_left", "heart_atrium_right"), ("heart_ventricle_left", "heart_ventricle_right")}
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


def carina_cut(trachea, geo):
    """The trachea ends at the carina, but the whole-body "trachea" class runs on into the first centimetres of both main
    bronchi. Cut it at the highest slice where its outline is two airways (each >= 15 mm2, centres >= 10 mm apart, one
    on either side of the trachea's centre on the slice above): that slice and every slice below it is returned as the
    sub-carinal part, which is never published as trachea."""
    px_mm2 = float(geo.ps[0]) * float(geo.ps[1])
    prev_x = None
    for k in sorted(np.unique(np.nonzero(trachea)[2]), key=lambda k: -geo.slice_z(k)):  # head first
        lab, n = ndi.label(trachea[:, :, k], structure=FULL2)
        comps = []
        for c in range(1, n + 1):
            ij = np.argwhere(lab == c)
            if len(ij) * px_mm2 >= 15.0:
                x, y, _ = geo.lps(ij[:, 0], ij[:, 1], np.full(len(ij), k))
                comps.append((len(ij), float(x.mean()), float(y.mean())))
        comps.sort(key=lambda c: -c[0])
        if len(comps) >= 2 and prev_x is not None:
            (_, x1, y1), (_, x2, y2) = comps[:2]
            if np.hypot(x1 - x2, y1 - y2) >= 10.0 and (x1 - prev_x) * (x2 - prev_x) < 0:
                z_cut = geo.slice_z(k)
                below = trachea & (geo.z <= z_cut + 1e-3)[None, None, :]
                kept = trachea & ~below
                # above the carina the trachea is one tube: a separate airway beside it on a slice (e.g. where an
                # upper-lobe bronchus starts) is not trachea and is left unlabelled
                stray = np.zeros_like(trachea)
                for kk in np.unique(np.nonzero(kept)[2]):
                    lab2, n2 = ndi.label(kept[:, :, kk], structure=FULL2)
                    if n2 > 1:
                        big = 1 + int(np.argmax(np.bincount(lab2.ravel())[1:]))
                        stray[:, :, kk] = (lab2 > 0) & (lab2 != big)
                return kept & ~stray, below, {"carinaSliceK": int(k), "firstSubCarinalZ": round(z_cut, 2),
                                              "subCarinalSlices": int(len(np.unique(np.nonzero(below)[2]))),
                                              "strayVoxelsAboveCarina": int(stray.sum())}
        if len(comps) == 1:
            ij = np.argwhere(trachea[:, :, k])
            prev_x = float(geo.lps(ij[:, 0], ij[:, 1], np.full(len(ij), k))[0].mean())
    return trachea, np.zeros_like(trachea), {"carinaSliceK": None, "note": "no two-airway slice below a single trachea"}


def spine_numbering(st, per_slice_all, geoms, cs, ok):
    """Vertebral numbering check (audit 28 Oct). Each vertebra C3-L5 is compared with the median of up to two fully imaged
    levels above and two below. A level that holds two vertebral bodies (volume > 1.6x and slices > 1.3x the reference),
    an interior level that is only a slab or fragment (volume < 0.45x; not cut by the scan edge), or a level that is only
    the posterior arch (it never reaches 12 mm in front of the spinal cord; a vertebral body reaches 19-67 mm) means the
    numbering from there down cannot be trusted: that level, every vertebra below it and, from a thoracic level T(k), ribs
    k-12 on both sides are not published. Independently, a rib outline that never comes within 75 mm of the spinal cord
    is a fragment of a rib and is not published."""
    order = [n for n in Q.VERTEBRA_ORDER if ok(n) and n not in ("vertebrae_C1", "vertebrae_C2", "vertebrae_S1")]
    pos = {n: Q.VERTEBRA_ORDER.index(n) for n in order}
    full = [n for n in order if not st[n].get("truncation", {}).get("truncated")]
    nslices = lambda n: st[n]["kRange"][1] - st[n]["kRange"][0] + 1
    cord = per_slice_all.get("spinal_cord", {}) if ok("spinal_cord") else {}
    metrics, first_bad, why = {}, None, None
    for n in order:
        near = [m for m in full if m != n and abs(pos[m] - pos[n]) <= 2]
        above = any(pos[m] == pos[n] - 1 for m in full)
        below = any(pos[m] == pos[n] + 1 for m in full) or (n == "vertebrae_L5" and (ok("vertebrae_S1") or ok("sacrum")))
        reasons, mt = [], {}
        if near:
            v_ref = float(np.median([st[m]["volumeMl"] for m in near]))
            s_ref = float(np.median([nslices(m) for m in near]))
            mt.update(volumeRatio=round(st[n]["volumeMl"] / v_ref, 2), sliceRatio=round(nslices(n) / s_ref, 2))
            if n in full and mt["volumeRatio"] > 1.6 and mt["sliceRatio"] > 1.3:
                reasons.append(f"{st[n]['volumeMl']:.0f} ml over {nslices(n)} slices vs {v_ref:.0f} ml / {s_ref:.0f} nearby (two bodies)")
            if above and below and n in full and mt["volumeRatio"] < 0.45:
                reasons.append(f"{st[n]['volumeMl']:.0f} ml vs {v_ref:.0f} ml nearby (slab or fragment)")
        # a level cut by the scan edge may show only its arch: only fully imaged levels are tested
        ks = [k for k in per_slice_all.get(n, {}) if k in cord] if n in full else []
        if ks:
            reach = max(cord[k]["cy"] - per_slice_all[n][k]["ymin"] for k in ks)  # LPS +y is posterior
            mt["reachInFrontOfCordMm"] = round(reach, 1)
            if reach < 12.0:
                reasons.append(f"reaches only {reach:.0f} mm in front of the spinal cord (posterior arch only)")
        metrics[n] = mt
        if reasons and first_bad is None:
            first_bad, why = n, reasons
    info = {"checked": len(order), "metrics": metrics, "firstDoubtfulLevel": first_bad, "reasons": why, "dropped": []}
    if first_bad:
        for n in Q.VERTEBRA_ORDER[Q.VERTEBRA_ORDER.index(first_bad):]:
            if ok(n):
                st[n]["status"], st[n]["rule"] = f"dropped: vertebral numbering doubtful from {Q.clean_label(first_bad)} down ({'; '.join(why)})", 4
                info["dropped"].append(n)
        if first_bad.startswith("vertebrae_T"):
            k0 = int(first_bad[len("vertebrae_T"):])
            for side in ("left", "right"):
                for r in range(k0, 13):
                    n = f"rib_{side}_{r}"
                    if ok(n):
                        st[n]["status"], st[n]["rule"] = f"dropped: rib numbering doubtful below {Q.clean_label(first_bad)}", 4
                        info["dropped"].append(n)
    # ribs that never reach the spine
    if cord:
        k_of = {s_["sopInstanceUid"]: s_["k"] for s_ in cs.slices}
        cks = np.array(sorted(cord))
        # (a rib cut by the scan edge may legitimately show only its front: those are not tested)
        for n in [x for x in st if x.startswith("rib_") and ok(x) and x in geoms and not st[x].get("truncation", {}).get("truncated")]:
            best = np.inf
            for pl in geoms[n]["planes"]:
                k = k_of.get(pl["sopInstanceUid"])
                if k is None:
                    continue
                kc = int(cks[np.argmin(np.abs(cks - k))])
                for ring in pl["polygons"]:
                    r_ = np.asarray(ring, float)
                    x, y, _ = cs.geo.lps(r_[:, 0], r_[:, 1], np.full(len(r_), k))
                    best = min(best, float(np.min(np.hypot(x - cord[kc]["cx"], y - cord[kc]["cy"]))))
            st[n]["nearestToCordMm"] = None if not np.isfinite(best) else round(best, 1)
            if best > 75.0:
                st[n]["status"], st[n]["rule"] = f"dropped: rib outline never reaches the spine ({best:.0f} mm from the cord; fragment)", 4
                info["dropped"].append(n)
    return info


def ts_class_map(task="total"):
    from totalsegmentator.map_to_binary import class_map
    return class_map[task]


def trace(mask2d, tol=None):
    padded = np.pad(mask2d.astype(np.float32), 1)
    cs = measure.find_contours(padded, 0.5, fully_connected="low")
    if not cs:
        return None
    c = max(cs, key=len) - 1.0
    if not np.allclose(c[0], c[-1]):
        c = np.vstack([c, c[:1]])
    s = measure.approximate_polygon(c, tolerance=CT_DP_TOL_PX if tol is None else tol)
    if len(s) < 4:
        return None
    ring = [[float(p[1]), float(p[0])] for p in s]
    return ring if ring_area(ring) >= MIN_RING_AREA_PX2 else None


def slice_polys(m2, col0, row0, min_px, tol=None):
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
        ring = trace(filled, tol)
        if ring is None:
            continue
        kept[sl] |= comp
        polys.append([[x + col0 + sl[1].start, y + row0 + sl[0].start] for x, y in ring])
        for hi in range(1, nh + 1):
            if hsz[hi] >= min_px:
                r = trace(hl == hi, tol)
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

    def measure(self, name, crop, bb, kind, A_seg, want_full=False, tol=None, keep_all=False):
        """Rule 0/1 + contours + statistics for one structure given its (cropped) raw mask."""
        lab, n = ndi.label(crop, structure=FULL3)
        sizes = np.bincount(lab.ravel())[1:] * self.vox_ml
        total_ml = float(sizes.sum())
        order = list(np.argsort(-sizes))
        if keep_all:  # connectivity already enforced by the caller (intrapulmonary arterial trees)
            keep = order
        elif name == "costal_cartilages":
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
            polys, holes, kept = slice_polys(m2, i0, j0, self.min_px, tol)
            if not polys:
                continue
            rows, cols = np.nonzero(kept)
            rows_g, cols_g = rows + j0, cols + i0
            x, y, z = self.geo.lps(cols_g, rows_g, np.full(cols_g.shape, k))
            per_slice[k] = {"areaMm2": len(rows) * self.px_area, "cx": float(x.mean()), "cy": float(y.mean()), "ymin": float(y.min())}
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
            def full_at(edge, nxt):  # still a full cross-section on the scan's first/last slice -> it continues beyond
                a_, b_ = per_slice.get(edge, {}).get("areaMm2", 0.0), per_slice.get(nxt, {}).get("areaMm2", 0.0)
                return a_ >= 20.0 and b_ > 0 and a_ >= 0.6 * b_
            edge_full = bool(full_at(0, 1) or full_at(self.K - 1, self.K - 2))
            rec["truncation"] = {"firstSliceAreaFraction": round(first, 3), "lastSliceAreaFraction": round(last, 3),
                                 "inPlaneEdgePixels": edge_px, "fullCrossSectionAtScanEdge": edge_full,
                                 "truncated": bool(first >= 0.10 or last >= 0.10 or edge_px >= 5 or edge_full)}
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
    keep_full = {"aorta", "colon", "vertebrae_T12", "hip_left", "hip_right", "sacrum", "vertebrae_S1", "superior_vena_cava",
                 "inferior_vena_cava", "esophagus", "atrial_appendage_left", *LUNG_LOBES}
    # the trachea ends at the carina; its sub-carinal part is offered to the main bronchi below (never kept as trachea)
    sub_carinal = None
    if "trachea" in idx_of and (seg == idx_of["trachea"]).any():
        tr = seg == idx_of["trachea"]
        kept, sub_carinal, out["carina"] = carina_cut(tr, cs.geo)
        seg[tr & ~kept] = 0
    objs = ndi.find_objects(seg)
    for idx, name in cmap.items():
        if idx > len(objs) or objs[idx - 1] is None:
            continue
        bb = objs[idx - 1]
        if name == "heart":
            continue  # measured after the pulmonary trunk / ascending aorta / SVC have been subtracted (see below)
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
            extra = {}
            lobes = np.isin(seg, [idx_of[n] for n in LUNG_LOBES])
            trachea = seg == idx_of["trachea"]
            outside = (lv == lvm["lung_airways"]) & ~ndi.binary_dilation(trachea, iterations=1) & ~lobes
            if sub_carinal is not None:
                outside |= sub_carinal & ~lobes
            lab, n = ndi.label(outside, structure=FULL3)
            if n >= 1 and trachea.any():
                # main bronchi = airway pieces outside the trachea and the lungs that START at the carina (top within
                # 15 mm of the lowest tracheal slice) and lie below it; the largest such piece on each side of the carina
                tk = np.unique(np.nonzero(trachea)[2])
                tz = np.array([cs.geo.slice_z(k) for k in tk])
                k_car = tk[np.argmin(tz)]
                z_car = float(tz.min())
                low = np.argwhere(trachea[:, :, k_car])
                x_car = float(cs.geo.lps(low[:, 0], low[:, 1], np.full(len(low), k_car))[0].mean())
                sizes = np.bincount(lab.ravel())[1:]
                best = {}
                for comp in np.argsort(-sizes) + 1:
                    m = lab == comp
                    vox = np.argwhere(m)
                    x, y, z = cs.geo.lps(vox[:, 0], vox[:, 1], vox[:, 2])
                    if z.max() > z_car + 15.0 or z.mean() >= z_car:
                        continue
                    if 0.1 < float(np.mean(x > x_car)) < 0.9:
                        continue  # a piece reaching across the carina: its side is not certain, so it is not published
                    side = "main_bronchus_left" if x.mean() > x_car else "main_bronchus_right"
                    if side not in best:
                        best[side] = m
                    if len(best) == 2:
                        break
                extra.update(best)
            for name, m in extra.items():
                if m.any():
                    bb = ndi.find_objects(m.astype(np.uint8))[0]
                    rec, geom, ps_, _ = cs.measure(name, m[bb], bb, "extra", A_seg)
                    st[name], per_slice_all[name] = rec, ps_
                    if geom:
                        geoms[name] = geom
                    out["extrasDerived"].append(name)
            # pulmonary arteries: mediastinal part only (outside the lung lobes = up to the hila), split at the bifurcation
            central = (lv == lvm["lung_arteries"]) & ~lobes
            fulls["_central_pa"] = central  # subtracted from the heart even if the split into parts fails
            ped = "Pediatric" in cs.info.get("subjectKey", "")
            parts, info = subparts.pa_parts(central, cs.geo, pediatric=ped)
            out.setdefault("subpartsPA", info)
            # intrapulmonary arteries (the source labels arteries and veins as separate classes): every arterial voxel
            # inside a lobe is assigned to that lobe; only branches connected to the mediastinal pulmonary arteries
            # (1-voxel gaps bridged) are kept
            art = lv == lvm["lung_arteries"]
            intra = art & lobes
            info["intrapulmonaryArteriesMl"] = round(float(intra.sum()) * cs.vox_ml, 1)
            if central.any() and intra.any():
                both = central | intra
                bridged = ndi.binary_dilation(both, structure=FULL3)
                lab_b, nb = ndi.label(bridged, structure=FULL3)
                hit = np.unique(lab_b[central & (lab_b > 0)])
                conn = np.isin(lab_b, hit) & intra
                info["intrapulmonaryConnectedFraction"] = round(float(conn.sum() / max(intra.sum(), 1)), 3)
                info["intrapulmonaryInterlobar"] = "not separated (no reliable landmark for the interlobar segments)"
                for lobe_name, art_name in LOBE_ARTERY.items():
                    g = conn & (seg == idx_of[lobe_name])
                    if not g.any():
                        continue
                    bb = ndi.find_objects(g.astype(np.uint8))[0]
                    rec, geom, ps_, _ = cs.measure(art_name, g[bb], bb, "derived:pulmonary_artery", A_seg,
                                                   tol=PA_DP_TOL_PX, keep_all=True)
                    raw_lobe = seg == idx_of[lobe_name]
                    rec["insideLobeFraction"] = round(float((g & raw_lobe).sum() / g.sum()), 3)
                    rec["connectedToCentral"] = True
                    st[art_name], per_slice_all[art_name] = rec, ps_
                    if geom:
                        geoms[art_name] = geom
                    out["extrasDerived"].append(art_name)
            for name, m in parts.items():
                bb = ndi.find_objects(m.astype(np.uint8))[0]
                rec, geom, ps_, full = cs.measure(name, m[bb], bb, "derived:pulmonary_artery", A_seg,
                                                  want_full=name == "pulmonary_trunk", tol=PA_DP_TOL_PX)
                st[name], per_slice_all[name] = rec, ps_
                if geom:
                    geoms[name] = geom
                if full is not None:
                    fulls[name] = full
                out["extrasDerived"].append(name)
        else:
            out["subpartsPA"] = {"reason": "lung-vessel segmentation not on the CT grid"}
    else:
        out["subpartsPA"] = {"reason": "lung-vessel segmentation not run (no chest field of view)"}

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
            rec, geom, ps_, full = cs.measure(name, m[bb], bb, "derived:aorta", A_seg,
                                              want_full=name in ("aorta_ascending", "aorta_descending_thoracic"))
            st[name], per_slice_all[name] = rec, ps_
            if geom:
                geoms[name] = geom
            if full is not None:
                fulls[name] = full
    # ---- heart minus (pulmonary trunk + ascending aorta + SVC, each dilated by one voxel)
    if "heart" in idx_of and np.any(seg == idx_of["heart"]):
        heart = seg == idx_of["heart"]
        # the "heart" class of the segmentation also covers the pulmonary trunk and the proximal right / left pulmonary
        # arteries; subtract the whole mediastinal pulmonary-artery mask, the ascending aorta and the SVC
        names = [n for n in ("aorta_ascending", "superior_vena_cava") if n in fulls and ok(n)]
        sub = [fulls[n] for n in names]
        if "_central_pa" in fulls and fulls["_central_pa"].any():
            sub.append(fulls["_central_pa"])
            names.insert(0, "mediastinal pulmonary arteries (trunk + right + left)")
        removed = 0
        hinfo = {"subtracted": names}
        if sub:
            vessels = ndi.binary_dilation(np.logical_or.reduce(sub), structure=FULL3)
            removed = int((heart & vessels).sum())
            heart = heart & ~vessels
        hinfo["voxelsRemoved"] = removed
        hinfo["mlRemoved"] = round(removed * cs.vox_ml, 1)
        if heart.any():
            bb = ndi.find_objects(heart.astype(np.uint8))[0]
            rec, geom, ps_, _ = cs.measure("heart", heart[bb], bb, "total", A_seg)
            st["heart"], per_slice_all["heart"] = rec, ps_
            if geom:
                geoms["heart"] = geom
            top = float(max(cs.geo.slice_z(k) for k in np.unique(np.nonzero(heart)[2])))
            valves = {}
            for n_, key in (("pulmonary_trunk", "pulmonaryValveZ"), ("aorta_ascending", "aorticValveZ")):
                if n_ in fulls and ok(n_):
                    valves[key] = float(min(cs.geo.slice_z(k) for k in np.unique(np.nonzero(fulls[n_])[2])))
            hinfo.update(topZ=top, **valves)
            if valves:
                hinfo["topAboveHighestValveMm"] = round(top - max(valves.values()), 1)
        out["heartSubtraction"] = hinfo
    # ---- heart chambers (licence-free chamber model; contrast studies with an opacified blood pool only)
    chamber_checks = {}
    pch = d / "seg_chambers.nii.gz"
    out["chambers"] = {"published": [], "reason": "chamber model not run (non-contrast study or no heart)"}
    if pch.exists() and "heart" in idx_of:
        cimg = nib.load(str(pch))
        if cimg.shape != cs.ct.shape or not np.allclose(cimg.affine, cs.A_ct, atol=1e-3):
            out["chambers"]["reason"] = "chamber segmentation not on the CT grid"
        else:
            chm = np.asanyarray(cimg.dataobj)
            raw = {name: chm == lab_ for lab_, name in CHAMBERS.items()}
            med = {n: (float(np.median(cs.ct[m])) if m.any() else None) for n, m in raw.items()}
            agent = (cs.info.get("contrastBolusAgent") or "").upper()
            contrast_hdr = bool(agent) and not any(w in agent for w in NO_CONTRAST_WORDS)
            contrast_meas = st.get("aorta", {}).get("medianHU") is not None and st["aorta"]["medianHU"] >= 150
            vent = [med[n] for n in ("heart_ventricle_left", "heart_ventricle_right") if med[n] is not None]
            gate = bool((contrast_hdr or contrast_meas) and len(vent) == 2 and min(vent) >= 150 and med["heart_myocardium"] is not None
                        and min(vent) >= med["heart_myocardium"] + 50)
            out["chambers"] = {"published": [], "medianHU": {k: v for k, v in med.items()}, "opacifiedBloodPool": gate}
            if not gate:
                out["chambers"]["reason"] = ("blood pool not opacified: ventricles' median HU must be >= 150 and >= myocardium + 50 "
                                             f"(LV {med['heart_ventricle_left']}, RV {med['heart_ventricle_right']}, myocardium {med['heart_myocardium']})")
            else:
                heart_raw_dil = ndi.binary_dilation(seg == idx_of["heart"], structure=FULL3, iterations=2)
                # Pixels that a chamber and a vessel from another model both claim (pulmonary trunk vs right ventricle at
                # the valve, IVC vs right atrium, appendage vs muscle) are contested: neither label is certain there, so
                # neither keeps them (owner rule: if not sure, do not mark).
                any_chamber = np.logical_or.reduce(list(raw.values()))
                contested = {}
                for n_ in ("pulmonary_trunk", "inferior_vena_cava", "superior_vena_cava", "atrial_appendage_left", "aorta_ascending"):
                    if n_ not in fulls or not ok(n_):
                        continue
                    ov = fulls[n_] & any_chamber
                    if not ov.any():
                        continue
                    contested[n_] = round(float(ov.sum()) * cs.vox_ml, 2)
                    for cn in raw:
                        raw[cn] = raw[cn] & ~ov
                    rest = fulls[n_] & ~ov
                    if not rest.any():
                        st[n_]["status"], st[n_]["rule"] = "dropped: entirely contested with the heart chambers", 6
                        continue
                    bb = ndi.find_objects(rest.astype(np.uint8))[0]
                    src_ = "derived:pulmonary_artery" if n_ == "pulmonary_trunk" else "derived:aorta" if n_.startswith("aorta_") else "total"
                    rec, geom, ps_, full = cs.measure(n_, rest[bb], bb, src_, A_seg, want_full=True,
                                                      tol=PA_DP_TOL_PX if n_ == "pulmonary_trunk" else None)
                    rec["contestedWithChambersMl"] = contested[n_]
                    st[n_], per_slice_all[n_] = rec, ps_
                    if geom:
                        geoms[n_] = geom
                    fulls[n_] = full
                out["chambers"]["contestedRemovedMl"] = contested
                chf = {}
                for name, m in raw.items():
                    if not m.any():
                        continue
                    bb = ndi.find_objects(m.astype(np.uint8))[0]
                    rec, geom, ps_, full = cs.measure(name, m[bb], bb, "chamber model", A_seg, want_full=True)
                    st[name], per_slice_all[name] = rec, ps_
                    if geom:
                        geoms[name] = geom
                    chf[name] = full
                ped = "Pediatric" in cs.info.get("subjectKey", "")
                cen = {n: st[n]["centroid"] for n in chf if st[n].get("centroid")}
                yof = lambda n: cen[n][1]
                xof = lambda n: cen[n][0]

                def mean_y_in_slices(mask_full, ref_full):
                    ks = np.unique(np.nonzero(ref_full)[2])
                    sub = mask_full[:, :, ks]
                    if not sub.any():
                        return None
                    ii, jj, kk = np.nonzero(sub)
                    return float(cs.geo.lps(ii, jj, ks[kk])[1].mean())

                def touch(a, b, it=2):
                    return bool((ndi.binary_dilation(a, structure=FULL3, iterations=it) & b).any())

                for n, m in chf.items():
                    ch = []
                    lo, hi = CHAMBER_VOLUME_ML[n]
                    if ped:
                        lo = lo / 5.0
                    v = st[n]["volumeMl"]
                    ch.append(("plausible volume", lo <= v <= hi, f"{v:.0f} ml in [{lo:g}, {hi:g}]"))
                    inside = float((m & heart_raw_dil).sum() / max(m.sum(), 1))
                    ch.append(("inside / touching the whole-heart mask", inside >= 0.9, f"{100 * inside:.0f} % inside"))
                    others = [o for o in chf if o != n]
                    ov = max((float((m & chf[o]).sum() / max(m.sum(), 1)) for o in others), default=0.0)
                    ch.append(("overlap with other chambers <= 5 %", ov <= 0.05, f"{100 * ov:.1f} %"))
                    four = [o for o in ("heart_atrium_right", "heart_atrium_left", "heart_ventricle_right", "heart_ventricle_left") if o in cen]
                    if n == "heart_ventricle_right":
                        ch.append(("most anterior chamber", len(four) == 4 and all(yof(n) < yof(o) for o in four if o != n), ""))
                    if n == "heart_atrium_left":
                        ch.append(("most posterior chamber", len(four) == 4 and all(yof(n) > yof(o) for o in four if o != n), ""))
                        for ref in ("esophagus", "aorta_descending_thoracic"):
                            if ref in fulls and ok(ref):
                                ry = mean_y_in_slices(fulls[ref], m)
                                ch.append((f"anterior to the {ref.replace('_', ' ')}", ry is not None and yof(n) < ry, ""))
                        if "atrial_appendage_left" in fulls and ok("atrial_appendage_left"):
                            ch.append(("left atrial appendage connects", touch(fulls["atrial_appendage_left"], m), ""))
                    if n == "heart_atrium_right":
                        ch.append(("right of the left atrium", "heart_atrium_left" in cen and xof(n) < xof("heart_atrium_left"), ""))
                        veins = [fulls[v_] for v_ in ("superior_vena_cava", "inferior_vena_cava") if v_ in fulls and ok(v_)]
                        ch.append(("receives the SVC / IVC", bool(veins) and any(touch(m, v_) for v_ in veins), ""))
                    if n == "heart_ventricle_left":
                        ch.append(("left of the right ventricle and right atrium",
                                   all(o in cen and xof(n) > xof(o) for o in ("heart_ventricle_right", "heart_atrium_right")), ""))
                    if n in ("heart_ventricle_left", "heart_myocardium") and "heart_ventricle_left" in chf and "heart_myocardium" in chf:
                        lv = chf["heart_ventricle_left"]
                        surf = lv & ~ndi.binary_erosion(lv, structure=FULL3)
                        near = ndi.binary_dilation(chf["heart_myocardium"], structure=FULL3, iterations=2)
                        frac = float((surf & near).sum() / max(surf.sum(), 1))
                        ch.append(("myocardium wraps the left ventricle", frac >= 0.5, f"{100 * frac:.0f} % of the LV surface"))
                    chamber_checks[n] = [{"check": a, "pass": bool(b), "detail": c} for a, b, c in ch]
                    st[n]["chamberChecks"] = chamber_checks[n]
                    failed = [a for a, b, c in ch if not b]
                    if failed and st[n]["status"] == "ok":
                        st[n]["status"], st[n]["rule"] = "dropped: heart-chamber QC (" + "; ".join(failed) + ")", 6
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
    # accuracy rule (owner, 27 Oct): a left/right structure whose side could not be verified by any check is not published
    for name in [n for n in st if ok(n)]:
        if Q.side_of(name) is None:
            continue
        verified = any(c_["pass"] for c_ in st[name].get("lateralityChecks", [])) or st[name].get("midlineCheck", {}).get("pass")
        if not verified:
            st[name]["status"], st[name]["rule"] = "dropped: side could not be verified (no left/right partner and no midline check)", 4
    vz = [(n, st[n]["centroidZ"]) for n in Q.VERTEBRA_ORDER if ok(n)]
    keep_v = Q.longest_decreasing(vz)
    for n_, z in vz:
        st[n_]["vertebralOrder"] = {"pass": n_ in keep_v}
        if n_ not in keep_v:
            st[n_]["status"], st[n_]["rule"] = "dropped: vertebral level out of craniocaudal order", 4
    out["spineNumbering"] = spine_numbering(st, per_slice_all, geoms, cs, ok)
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
    if ok("pulmonary_trunk") and ok("aorta_ascending"):
        t, a = c("pulmonary_trunk"), c("aorta_ascending")
        checks.append((("pulmonary_trunk",), t[0] > a[0] and t[1] <= a[1] + 10.0, "trunk anterior-left of the ascending aorta"))
    if ok("pulmonary_trunk") and ok("aorta_arch"):
        checks.append((("pulmonary_trunk",), c("pulmonary_trunk")[2] < c("aorta_arch")[2], "trunk below the aortic arch"))
    if ok("pulmonary_artery_right"):
        r_ = c("pulmonary_artery_right")
        if ok("aorta_ascending"):
            checks.append((("pulmonary_artery_right",), r_[1] > c("aorta_ascending")[1], "right PA posterior to the ascending aorta"))
        if ok("superior_vena_cava"):
            checks.append((("pulmonary_artery_right",), r_[1] > c("superior_vena_cava")[1], "right PA posterior to the SVC"))
        if ok("pulmonary_trunk"):
            checks.append((("pulmonary_artery_right",), r_[0] < c("pulmonary_trunk")[0], "right PA to the right of the trunk"))
    if ok("pulmonary_artery_left"):
        l_ = c("pulmonary_artery_left")
        if ok("pulmonary_trunk"):
            checks.append((("pulmonary_artery_left",), l_[0] > c("pulmonary_trunk")[0], "left PA to the left of the trunk"))
        if ok("main_bronchus_left"):
            # the left PA arches OVER the left main bronchus: its highest slice lies above the bronchus' centre
            top = max(cs.geo.slice_z(k) for k in st["pulmonary_artery_left"]["kRange"])
            checks.append((("pulmonary_artery_left",), top > c("main_bronchus_left")[2], "left PA arching above the left main bronchus"))
    if ok("colon_ascending") and ok("colon_descending"):
        checks.append((("colon_ascending", "colon_descending"), c("colon_ascending")[0] < c("colon_descending")[0], "ascending colon right of descending"))
    for names, good, why in checks:
        for n_ in names:
            st[n_].setdefault("orderChecks", []).append({"check": why, "pass": bool(good)})
            if not good and ok(n_):
                st[n_]["status"], st[n_]["rule"] = f"dropped: anatomical order ({why})", 4
    # parts derived from one split stand or fall together: one failed order check -> the split is not trusted
    for group in (("aorta_ascending", "aorta_arch", "aorta_descending_thoracic", "aorta_abdominal"),
                  ("pulmonary_trunk", "pulmonary_artery_right", "pulmonary_artery_left"),
                  ("colon_ascending", "colon_transverse", "colon_descending", "colon_sigmoid", "rectum")):
        if any(n_ in st and st[n_].get("rule") == 4 and "anatomical order" in st[n_]["status"] for n_ in group):
            for n_ in group:
                if ok(n_):
                    st[n_]["status"], st[n_]["rule"] = "dropped: another part of the same split failed an anatomical-order check", 4

    cdir = d / "contours"
    if cdir.exists():
        for p in cdir.glob("*.json"):
            p.unlink()
    for name, rec in st.items():
        if rec["status"] == "ok" and name in geoms:
            dump_json_compact(geoms[name], cdir / f"{name}.json")
            rec["bytes"] = (cdir / f"{name}.json").stat().st_size
    resid = [r["alignmentMaxResidualMm"] for r in st.values()]
    if out.get("chambers", {}).get("opacifiedBloodPool"):
        out["chambers"]["published"] = sorted(n for n in CHAMBERS.values() if ok(n))
        out["chambers"]["dropped"] = {n: st[n]["status"] for n in CHAMBERS.values() if n in st and not ok(n)}
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
    newest = max(p.stat().st_mtime for p in [d / "seg_total.nii.gz", d / "seg_lungvessels.nii.gz", d / "seg_chambers.nii.gz"] if p.exists())
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
