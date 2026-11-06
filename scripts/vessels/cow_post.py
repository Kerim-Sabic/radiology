"""Post-processing and QC of the Circle-of-Willis model output (cow_segment.py), shared by the validation and the atlas.

The network was trained on tight crops around the circle; far from it, it also paints other vessels with artery names
(seen on the 40 expert-labelled MRAs: correct inside the expert box, wrong-side labels outside). So:

  0. the circle's vessel tree (vessel_tree): the connected group holding the most arteries, plus nearby groups (the
     posterior circulation when a Pcom is missing); each artery is then its main piece inside the tree;
  1. landmarks: each ICA terminus (ICA voxels touching that side's MCA or ACA), the basilar top
     (basilar voxels touching a PCA, else its highest voxels) and the Acom (else the midpoint of the termini);
  2. a teaching box around them (TEACHING_BOX_MM: 30 mm lateral to the termini for the MCA bifurcation and proximal M2,
     20 mm in front of the Acom, 35 mm behind the basilar top for the P2 segments, 25 mm below the basilar top and
     30 mm above the termini/Acom); labels outside it are discarded;
  3. per class the largest 26-connected part inside the box (QC rule 1);
  4. side (rule 4): every lateral artery's centroid on its side of the midline (mean x of the two termini) with >= 90 %
     of its voxels there (75 % for a PCA or Pcom, which start at the midline basilar tip); R/L ACA centroids in order;
  5. contacts: MCA and ACA touch their ICA (an ACA may instead reach only the Acom: A1 not seen), PCA touches the basilar
     or its Pcom, a Pcom touches both its ICA and its PCA, the Acom both ACAs, a 3rd A2 the Acom; a class that fails is
     dropped (a Pcom or Acom that touches only one side is not shown);
  6. named sub-segments where the junction exists: A1/A2 at the Acom, P1/P2 at the Pcom (P1 also needs basilar contact),
     M1/M2 at the first division of the MCA centreline with two branches of >= 6 mm. Geodesic distances along the mask.
All in LPS physical coordinates of the image (any obliquity).
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

NAMES = {1: "BA", 2: "R-PCA", 3: "L-PCA", 4: "R-ICA", 5: "R-MCA", 6: "L-ICA", 7: "L-MCA", 8: "R-Pcom", 9: "L-Pcom", 10: "Acom",
         11: "R-ACA", 12: "L-ACA", 15: "3rd-A2"}
VAL = {v: k for k, v in NAMES.items()}
TEACHING_BOX_MM = {"lateral": 30.0, "anterior": 20.0, "posterior": 35.0, "below": 25.0, "above": 30.0}
FULL = np.ones((3, 3, 3), bool)
CLASS_ID = {"BA": "basilar_artery", "R-PCA": "posterior_cerebral_artery_right", "L-PCA": "posterior_cerebral_artery_left",
            "R-ICA": "internal_carotid_artery_right", "L-ICA": "internal_carotid_artery_left", "R-MCA": "middle_cerebral_artery_right",
            "L-MCA": "middle_cerebral_artery_left", "R-Pcom": "posterior_communicating_artery_right",
            "L-Pcom": "posterior_communicating_artery_left", "Acom": "anterior_communicating_artery",
            "R-ACA": "anterior_cerebral_artery_right", "L-ACA": "anterior_cerebral_artery_left", "3rd-A2": "third_a2"}
PART_ID = {("ACA", "A1"): "anterior_cerebral_artery_a1", ("ACA", "A2"): "anterior_cerebral_artery_a2",
           ("PCA", "P1"): "posterior_cerebral_artery_p1", ("PCA", "P2"): "posterior_cerebral_artery_p2",
           ("MCA", "M1"): "middle_cerebral_artery_m1", ("MCA", "M2"): "middle_cerebral_artery_m2"}


class Grid:
    """Voxel -> LPS mm for an (x, y, z)-ordered array of a SimpleITK image."""

    def __init__(self, img):
        self.D = np.asarray(img.GetDirection(), float).reshape(3, 3)
        self.sp = np.asarray(img.GetSpacing(), float)
        self.o = np.asarray(img.GetOrigin(), float)
        self.M = self.D * self.sp[None, :]

    def world(self, ijk):
        return np.asarray(ijk, float) @ self.M.T + self.o


def _touch(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Voxels of a within one voxel (26-neighbourhood) of b."""
    return a & ndi.binary_dilation(b, structure=FULL)


def _largest(m: np.ndarray) -> np.ndarray:
    lab, n = ndi.label(m, structure=FULL)
    if n <= 1:
        return m
    return lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))


def geodesic(mask: np.ndarray, seeds: np.ndarray, sp) -> np.ndarray:
    """Shortest path length (mm) inside a 26-connected mask from any seed voxel; inf where unreachable."""
    idx = np.argwhere(mask)
    n = len(idx)
    out = np.full(mask.shape, np.inf)
    if n == 0 or not seeds.any():
        return out
    lut = -np.ones(mask.shape, np.int64)
    lut[tuple(idx.T)] = np.arange(n)
    rows, cols, w = [], [], []
    sp = np.asarray(sp, float)
    for d in np.argwhere(np.ones((3, 3, 3))) - 1:
        if (d == 0).all():
            continue
        nb = idx + d
        ok = np.all((nb >= 0) & (nb < mask.shape), axis=1)
        j = np.full(n, -1)
        j[ok] = lut[tuple(nb[ok].T)]
        good = j >= 0
        rows.append(np.nonzero(good)[0])
        cols.append(j[good])
        w.append(np.full(good.sum(), float(np.linalg.norm(d * sp))))
    g = coo_matrix((np.concatenate(w), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsr()
    src = lut[tuple(np.argwhere(seeds & mask).T)]
    dist = dijkstra(g, indices=src, min_only=True)
    out[tuple(idx.T)] = dist
    return out


def _split_at(mask, origin_contact, junction_contact, sp, min_mm=(3.0, 5.0)):
    """Split a vessel mask at a junction: proximal = geodesic distance from origin <= the junction's, distal = beyond."""
    d = geodesic(mask, origin_contact, sp)
    dj = d[junction_contact & np.isfinite(d)]
    if not dj.size:
        return None, "junction not reachable from the origin inside the mask"
    d0 = float(dj.min())
    prox = mask & (d <= d0)
    dist = mask & (d > d0) & np.isfinite(d)
    if d0 < min_mm[0]:
        return None, f"proximal part only {d0:.1f} mm long"
    if not dist.any() or float(d[dist].max()) - d0 < min_mm[1]:
        return None, "distal part too short"
    return {"proximal": _largest(prox), "distal": _largest(dist), "junctionMm": round(d0, 1)}, None


def _mca_split(mca, ica_contact, sp, branch_mm=6.0):
    """M1/M2: first point along the MCA (from the ICA) where the mask divides into two branches of >= branch_mm."""
    d = geodesic(mca, ica_contact, sp)
    fin = np.isfinite(d)
    if not fin.any():
        return None, "MCA not connected to its ICA contact"
    dmax = float(d[fin].max())
    step = float(min(sp))
    for t in np.arange(3.0, dmax - branch_mm, step):
        beyond = mca & fin & (d > t)
        lab, n = ndi.label(beyond, structure=FULL)
        if n < 2:
            continue
        reach = []
        for c in range(1, n + 1):
            comp = lab == c
            reach.append(float(d[comp].max()) - t)
        big = [r for r in reach if r >= branch_mm]
        if len(big) >= 2:
            return {"proximal": _largest(mca & (d <= t)), "distal": mca & fin & (d > t), "junctionMm": round(t, 1)}, None
    return None, "no division into two branches of >= 6 mm"


def head_midline_x(img) -> float:
    """Left-right centre (LPS x, mm) of the head: mean x of the voxels brighter than a tenth of the 99.5th percentile."""
    import SimpleITK as sitk
    a = sitk.GetArrayFromImage(img).transpose(2, 1, 0)
    head = a > 0.1 * np.percentile(a, 99.5)
    lab, n = ndi.label(head)
    if n > 1:
        head = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
    ijk = np.argwhere(head)
    ijk = ijk[np.random.default_rng(0).choice(len(ijk), size=min(len(ijk), 200_000), replace=False)]
    return float(Grid(img).world(ijk)[:, 0].mean())


def vessel_tree(seg: np.ndarray, g: Grid, mid: float) -> tuple[np.ndarray, dict]:
    """Keep the circle's vessel tree: the connected group of labelled voxels that holds the most arteries (ties: the
    larger), plus every other group of >= 300 voxels with >= 2 arteries that lies within TREE_GAP_MM of it, within
    TREE_LATERAL_MM of the head's midline, and whose right- and left-named arteries (ICA, MCA, PCA, Pcom) lie on their
    own side of that midline. On whole heads the network also names vessels far from the circle; those groups are 40-60 mm
    away or carry wrong-side names. The posterior circulation is a separate group when a Pcom is missing, and is kept."""
    lab, n = ndi.label(seg > 0, structure=FULL)
    sizes = np.bincount(lab.ravel())
    info = {"groups": int(n), "headMidlineX": round(mid, 1)}
    if n == 0:
        return np.zeros(seg.shape, bool), info
    stats = {}
    for k, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None or sizes[k] < 50:
            continue
        mk = lab[sl] == k
        sub = seg[sl][mk]
        ijk = np.argwhere(mk) + np.array([s.start for s in sl])
        w = g.world(ijk)
        vals, cnt = np.unique(sub, return_counts=True)
        side_ok = True
        for v, c in zip(vals, cnt):
            name = NAMES.get(int(v), "")
            if c >= 30 and name[:2] in ("R-", "L-") and not name.endswith("ACA"):
                cx = float(w[sub == v, 0].mean())
                side_ok &= (cx < mid) if name[0] == "R" else (cx > mid)
        stats[k] = {"arteries": int((cnt >= 30).sum()), "voxels": int(sizes[k]), "cx": float(w[:, 0].mean()), "sideOk": bool(side_ok)}
    main = max(stats, key=lambda k: (stats[k]["arteries"], stats[k]["voxels"]))
    keep = lab == main
    dist = ndi.distance_transform_edt(~keep, sampling=g.sp)
    kept, rejected = [main], []
    for k, s in stats.items():
        if k == main or s["voxels"] < 300 or s["arteries"] < 2:
            continue
        gap = float(dist[lab == k].min())
        ok = gap <= TREE_GAP_MM and abs(s["cx"] - mid) <= TREE_LATERAL_MM and s["sideOk"]
        (kept if ok else rejected).append(k)
        if ok:
            keep |= lab == k
        else:
            rejected[-1] = {"voxels": s["voxels"], "gapMm": round(gap, 1), "offMidlineMm": round(s["cx"] - mid, 1), "sideOk": s["sideOk"]}
    info.update(mainGroup={"arteries": stats[main]["arteries"], "voxels": stats[main]["voxels"]}, groupsKept=len(kept),
                rejectedNearby=[r for r in rejected if r["gapMm"] <= 15], voxelsKept=int(keep.sum()),
                voxelsDropped=int((seg > 0).sum() - keep.sum()))
    return keep, info


TREE_GAP_MM = 10.0
TREE_LATERAL_MM = 35.0
SIDE_SHARE = {"ICA": 0.9, "MCA": 0.9, "PCA": 0.75, "Pcom": 0.75}


def postprocess(seg: np.ndarray, img) -> tuple[dict, dict]:
    """seg: raw label array in the (x, y, z) index order of img. Returns ({name: mask}, qc)."""
    g = Grid(img)
    sp = g.sp
    tree, tinfo = vessel_tree(seg, g, head_midline_x(img))
    m, pieces = {}, {}
    for v, n in NAMES.items():
        x = (seg == v) & tree
        if x.any():
            pieces[n] = x
            m[n] = _largest(x)  # each artery: its main piece inside the tree (rule 1)
    # An ICA may come out in two pieces (siphon and terminus): its terminus piece is kept too when the main piece does not
    # reach the MCA or ACA of its side.
    for s_ in "RL":
        n = f"{s_}-ICA"
        if n not in m:
            continue
        nb = np.zeros_like(m[n])
        for b in (f"{s_}-MCA", f"{s_}-ACA"):
            if b in m:
                nb |= m[b]
        if nb.any() and not _touch(m[n], nb).any():
            lab_i, k_i = ndi.label(pieces[n], structure=FULL)
            for c in range(1, k_i + 1):
                piece = lab_i == c
                if piece.sum() >= 30 and _touch(piece, nb).any():
                    m[n] = m[n] | piece
                    break
    qc = {"rawVoxels": {n: int((seg == v).sum()) for v, n in NAMES.items() if (seg == v).any()}, "tree": tinfo, "dropped": {},
          "parts": {}, "notSplit": {}}

    def cen(mask):
        return g.world(np.argwhere(mask)).mean(0)

    term = {}
    for s in "RL":
        ica = m.get(f"{s}-ICA")
        if ica is None:
            continue
        tip = np.zeros_like(ica)
        for b in (f"{s}-MCA", f"{s}-ACA"):
            if b in m:
                tip |= _touch(ica, m[b])
        if tip.any():
            term[s] = cen(_largest(tip))
    if len(term) < 2:
        qc["error"] = f"ICA termini found: {sorted(term)}"
        return {}, qc
    ba = m.get("BA")
    ba_top = None
    if ba is not None:
        tip = np.zeros_like(ba)
        for b in ("R-PCA", "L-PCA"):
            if b in m:
                tip |= _touch(ba, m[b])
        if tip.any():
            ba_top = cen(_largest(tip))
        else:
            w = g.world(np.argwhere(ba))
            ba_top = w[w[:, 2] >= np.percentile(w[:, 2], 95)].mean(0)
    acom = cen(m["Acom"]) if "Acom" in m else (term["R"] + term["L"]) / 2
    pts = np.array([term["R"], term["L"], acom] + ([ba_top] if ba_top is not None else []))
    mid_x = float((term["R"][0] + term["L"][0]) / 2)
    if ba is not None and abs(float(cen(ba)[0]) - mid_x) > 12.0:
        qc["warning"] = f"basilar artery {float(cen(ba)[0]) - mid_x:+.1f} mm from the midline between the carotid termini"
    B = TEACHING_BOX_MM
    box = {"x": [float(pts[:, 0].min() - B["lateral"]), float(pts[:, 0].max() + B["lateral"])],
           "y": [float(pts[:, 1].min() - B["anterior"]), float(pts[:, 1].max() + B["posterior"])],
           "z": [float(pts[:, 2].min() - B["below"]), float(pts[:, 2].max() + B["above"])]}
    qc["landmarks"] = {"termini": {k: [round(float(c), 1) for c in v] for k, v in term.items()},
                       "basilarTop": None if ba_top is None else [round(float(c), 1) for c in ba_top],
                       "acom": [round(float(c), 1) for c in acom], "midlineX": round(mid_x, 1), "box": {k: [round(a, 1), round(b, 1)] for k, (a, b) in box.items()}}
    # 2-3. inside the box, largest part
    out = {}
    for n, x in m.items():
        ijk = np.argwhere(x)
        w = g.world(ijk)
        inside = ((w[:, 0] >= box["x"][0]) & (w[:, 0] <= box["x"][1]) & (w[:, 1] >= box["y"][0]) & (w[:, 1] <= box["y"][1])
                  & (w[:, 2] >= box["z"][0]) & (w[:, 2] <= box["z"][1]))
        y = np.zeros_like(x)
        y[tuple(ijk[inside].T)] = True
        if not y.any():
            qc["dropped"][n] = "nothing inside the teaching box"
            continue
        lab, k = ndi.label(y, structure=FULL)
        big = _largest(y)
        if int(big.sum()) * float(np.prod(sp)) < 3.0:
            qc["dropped"][n] = f"largest part {int(big.sum())} voxels (< 3 mm3)"
            continue
        out[n] = big
        qc.setdefault("partsKept", {})[n] = {"components": int(k), "keptVoxels": int(big.sum()), "insideBoxVoxels": int(y.sum()),
                                             "outsideBoxVoxels": int(x.sum() - y.sum())}
    # 4. side
    for n in list(out):
        if n[:2] not in ("R-", "L-"):
            continue
        w = g.world(np.argwhere(out[n]))
        frac_ok = float(np.mean(w[:, 0] < mid_x)) if n[0] == "R" else float(np.mean(w[:, 0] > mid_x))
        c = float(w[:, 0].mean())
        side_ok = (c < mid_x) if n[0] == "R" else (c > mid_x)
        if n.endswith("ACA"):  # ACAs run near the midline: only their order is required (checked below)
            continue
        if not side_ok or frac_ok < SIDE_SHARE[n.split("-", 1)[1]]:
            qc["dropped"][n] = f"side check failed (centroid x {c:.1f} vs midline {mid_x:.1f}; {100 * frac_ok:.0f}% on its side)"
            out.pop(n)
    if "R-ACA" in out and "L-ACA" in out:
        if not cen(out["R-ACA"])[0] < cen(out["L-ACA"])[0]:
            qc["dropped"]["R-ACA"] = qc["dropped"]["L-ACA"] = "right ACA not to the right of the left ACA"
            out.pop("R-ACA")
            out.pop("L-ACA")
    # 5. contacts
    def touches(a, b):
        return a in out and b in out and bool(_touch(out[a], out[b]).any())
    rules = []
    for s in "RL":
        rules += [(f"{s}-MCA", [[f"{s}-ICA"]]), (f"{s}-ACA", [[f"{s}-ICA"], ["Acom"]]), (f"{s}-PCA", [["BA"], [f"{s}-Pcom"]]),
                  (f"{s}-Pcom", [[f"{s}-ICA", f"{s}-PCA"]])]
    rules += [("Acom", [["R-ACA", "L-ACA"]]), ("3rd-A2", [["Acom"]]), ("BA", [["R-PCA"], ["L-PCA"]])]
    changed = True
    while changed:
        changed = False
        for n, alts in rules:
            if n not in out:
                continue
            if not any(all(touches(n, b) for b in alt) for alt in alts):
                qc["dropped"][n] = "does not join " + " or ".join(" and ".join(alt) for alt in alts)
                out.pop(n)
                changed = True
    # 6. sub-segments
    parts = {}
    for s in "RL":
        aca, ica = out.get(f"{s}-ACA"), out.get(f"{s}-ICA")
        if aca is not None and ica is not None and "Acom" in out and touches(f"{s}-ACA", f"{s}-ICA") and touches(f"{s}-ACA", "Acom"):
            r, why = _split_at(aca, _touch(aca, ica), _touch(aca, out["Acom"]), sp)
            if r:
                parts[f"{s}-ACA"] = {"A1": r["proximal"], "A2": r["distal"], "junctionMm": r["junctionMm"]}
            else:
                qc["notSplit"][f"{s}-ACA"] = why
        elif aca is not None:
            qc["notSplit"][f"{s}-ACA"] = "no ICA and Acom junctions on this ACA"
        pca, pcom = out.get(f"{s}-PCA"), out.get(f"{s}-Pcom")
        if pca is not None and pcom is not None and "BA" in out and touches(f"{s}-PCA", "BA") and touches(f"{s}-PCA", f"{s}-Pcom"):
            r, why = _split_at(pca, _touch(pca, out["BA"]), _touch(pca, pcom), sp)
            if r:
                parts[f"{s}-PCA"] = {"P1": r["proximal"], "P2": r["distal"], "junctionMm": r["junctionMm"]}
            else:
                qc["notSplit"][f"{s}-PCA"] = why
        elif pca is not None:
            qc["notSplit"][f"{s}-PCA"] = "no basilar and Pcom junctions on this PCA"
        mca = out.get(f"{s}-MCA")
        if mca is not None and ica is not None:
            r, why = _mca_split(mca, _touch(mca, ica), sp)
            if r:
                parts[f"{s}-MCA"] = {"M1": r["proximal"], "M2": r["distal"], "junctionMm": r["junctionMm"]}
            else:
                qc["notSplit"][f"{s}-MCA"] = why
    qc["parts"] = {n: {"junctionMm": p["junctionMm"], **{k: int(v.sum()) for k, v in p.items() if k != "junctionMm"}} for n, p in parts.items()}
    qc["kept"] = sorted(out)
    return {"classes": out, "parts": parts}, qc
