"""Geometric sub-parts of whole-structure masks (aorta, colon), computed on the ORIGINAL CT voxel grid.

All masks are boolean arrays indexed (i = DICOM column, j = DICOM row, k = sorted slice), i.e. NIfTI order.
`geo` supplies per-slice LPS geometry: geo.lps(i, j, k) -> (x, y, z) for arrays of voxel indices.

Aorta (owner rule): per axial slice, components of the aorta mask >= 20 mm2. Slices with exactly two components form
the "two-component zone": the component that is BOTH anterior (smaller LPS y) and right (smaller LPS x) is the
ascending aorta, the other the descending aorta (a slice where anterior and right disagree is ambiguous and left
unassigned). Single-component slices above the highest two-component slice are the arch; single-component slices below
the lowest two-component slice are descending. Descending is split into thoracic / abdominal at the inferior endplate
of T12 (lowest LPS z of the T12 mask), else at the lowest slice containing lung. Without a two-component zone only the
abdominal aorta below T12 is labelled (certain); everything else is left to the whole-aorta label.

Colon (owner rule): only if the colon does not touch the first/last slice (caecum-to-rectum course fully imaged),
hip-bone and sacrum masks exist, and the largest 3D component holds >= 85 % of the colon voxels. Its 3D skeleton (Lee) on a
~2.5 mm isotropic grid gives a graph; the longest shortest path must contain >= 60 % of the skeleton voxels (one
dominant path). Walking from the right-sided end (caecum): ascending until the hepatic flexure (highest right-sided
path point), transverse until the splenic flexure (highest left-sided point), descending until the iliac crest (top of
the hip-bone masks), sigmoid below, rectum = the terminal path points below the S3 level (40 % down the S1+sacrum
height) within 30 mm of the midline. Every check that fails returns no parts (the whole "Colon" label stays).
Each colon voxel takes the segment of its nearest path point.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

FULL3 = np.ones((3, 3, 3), bool)


def aorta_parts(aorta, geo, px_area, t12=None, lung=None):
    K = aorta.shape[2]
    zk = np.array([geo.slice_z(k) for k in range(K)])
    labels = np.zeros(aorta.shape, np.uint8)  # 1 asc, 2 arch, 3 desc (split later), 0 unassigned
    ncomp = {}
    comps_by_k = {}
    min_px = int(np.ceil(20.0 / px_area))
    for k in range(K):
        m2 = aorta[:, :, k]
        if not m2.any():
            continue
        lab, n = ndi.label(m2, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool))
        sizes = np.bincount(lab.ravel())[1:]
        big = [i + 1 for i, s in enumerate(sizes) if s >= min_px]
        ncomp[k] = len(big)
        comps_by_k[k] = (lab, big)
    two = [k for k, n in ncomp.items() if n == 2]
    info = {"twoComponentSlices": len(two), "ambiguousSlices": 0}
    if two:
        z_top2, z_bot2 = max(zk[k] for k in two), min(zk[k] for k in two)
        for k in two:
            lab, big = comps_by_k[k]
            cents = []
            for c in big:
                ii, jj = np.nonzero(lab == c)
                x, y, _ = geo.lps(ii, jj, np.full(ii.shape, k))
                cents.append((c, float(x.mean()), float(y.mean())))
            a, b = cents
            ant = a if a[2] < b[2] else b
            rgt = a if a[1] < b[1] else b
            if ant[0] != rgt[0]:
                info["ambiguousSlices"] += 1
                continue
            desc = b if ant is a else a
            labels[:, :, k][lab == ant[0]] = 1
            labels[:, :, k][lab == desc[0]] = 3
        for k, n in ncomp.items():
            if n == 1 and zk[k] > z_top2:
                lab, big = comps_by_k[k]
                labels[:, :, k][lab == big[0]] = 2
            elif n == 1 and zk[k] < z_bot2:
                lab, big = comps_by_k[k]
                labels[:, :, k][lab == big[0]] = 3
            elif n not in (0, 2):
                info["ambiguousSlices"] += 1
    # thoracic / abdominal split
    split_z, split_src = None, None
    if t12 is not None and t12.any():
        split_z, split_src = float(min(zk[k] for k in np.unique(np.nonzero(t12)[2]))), "T12 inferior endplate"
    elif lung is not None and lung.any():
        split_z, split_src = float(min(zk[k] for k in np.unique(np.nonzero(lung)[2]))), "lowest slice with lung"
    info["descendingSplit"] = {"z": split_z, "source": split_src}
    parts = {}
    if two:
        parts["aorta_ascending"] = labels == 1
        parts["aorta_arch"] = labels == 2
        if split_z is not None:
            zmask = (zk >= split_z)[None, None, :]
            parts["aorta_descending_thoracic"] = (labels == 3) & zmask
            parts["aorta_abdominal"] = (labels == 3) & ~zmask
        else:
            info["note"] = "no T12 / lung reference: descending aorta not split, not labelled"
    elif split_z is not None and split_src == "T12 inferior endplate":
        # no two-component zone: only the part below T12 is certain
        below = np.zeros(K, bool)
        for k, n in ncomp.items():
            if n == 1 and zk[k] < split_z:
                below[k] = True
        parts["aorta_abdominal"] = aorta & below[None, None, :]
        info["note"] = "no two-component zone in the field of view: only the abdominal aorta below T12 is labelled"
    else:
        info["note"] = "no two-component zone and no T12: no aortic parts labelled"
    return {k: v for k, v in parts.items() if v.any()}, info


def colon_parts(colon_raw, geo, midline_x, hips=None, sacrum=None):
    """colon_raw: raw colon mask (before fragment clean-up). Returns (parts dict, info)."""
    info = {}
    lab, n = ndi.label(colon_raw, structure=FULL3)
    if n == 0:
        return {}, {"reason": "no colon"}
    sizes = np.bincount(lab.ravel())[1:]
    frac = float(sizes.max() / sizes.sum())
    info["largestComponentFraction"] = round(frac, 3)
    if frac < 0.85:
        return {}, {**info, "reason": "colon mask fragmented (largest component < 85 %)"}
    if midline_x is None:
        return {}, {**info, "reason": "no midline reference"}
    # the whole large bowel must be in the field of view: caecum and rectum are the anchors of the walk
    kb = int(np.argmin(geo.z))
    kt = int(np.argmax(geo.z))
    if colon_raw[:, :, kb].any() or colon_raw[:, :, kt].any():
        return {}, {**info, "reason": "colon cut by the scan edge: caecum-to-rectum course not fully imaged"}
    if hips is None or not hips.any() or sacrum is None or not sacrum.any():
        return {}, {**info, "reason": "pelvis landmarks (hip bones, sacrum) not available"}
    main = lab == (int(np.argmax(sizes)) + 1)
    bb = ndi.find_objects(main.astype(np.uint8))[0]
    crop = main[bb]
    sp = geo.spacing  # (col mm, row mm, slice mm)
    factor = [s / 2.5 for s in sp]
    small = ndi.zoom(crop.astype(np.uint8), factor, order=0) > 0
    from skimage.morphology import skeletonize
    sk = skeletonize(small)
    pts = np.argwhere(sk)
    if len(pts) < 20:
        return {}, {**info, "reason": "skeleton too small"}
    # 26-neighbour graph with Euclidean edge weights
    index = -np.ones(sk.shape, np.int64)
    index[tuple(pts.T)] = np.arange(len(pts))
    rows, cols, w = [], [], []
    for d in np.argwhere(FULL3) - 1:
        if not d.any():
            continue
        q = pts + d
        ok = np.all((q >= 0) & (q < sk.shape), axis=1)
        nb = index[tuple(q[ok].T)]
        good = nb >= 0
        rows.append(np.nonzero(ok)[0][good])
        cols.append(nb[good])
        w.append(np.full(good.sum(), float(np.linalg.norm(d * 2.5))))
    G = coo_matrix((np.concatenate(w), (np.concatenate(rows), np.concatenate(cols))), shape=(len(pts), len(pts))).tocsr()
    ncc, cc = connected_components(G, directed=False)
    big = np.argmax(np.bincount(cc))
    nodes = np.nonzero(cc == big)[0]
    d0 = dijkstra(G, indices=nodes[0])
    a = nodes[np.argmax(np.where(np.isfinite(d0[nodes]), d0[nodes], -1))]
    da, pred = dijkstra(G, indices=a, return_predecessors=True)
    b = nodes[np.argmax(np.where(np.isfinite(da[nodes]), da[nodes], -1))]
    path = [b]
    while path[-1] != a:
        path.append(pred[path[-1]])
    path = np.array(path[::-1])
    info["pathFractionOfSkeleton"] = round(len(path) / len(pts), 3)
    if len(path) < 0.6 * len(pts):
        return {}, {**info, "reason": "no single dominant path through the colon skeleton"}
    # path points back to original voxel indices -> LPS
    orig = pts[path] / np.array(factor) + np.array([s.start for s in bb])
    x, y, z = geo.lps(orig[:, 0], orig[:, 1], orig[:, 2])
    # orient: start at the right-sided end
    if x[-1] < x[0]:
        x, y, z, orig = x[::-1], y[::-1], z[::-1], orig[::-1]
    if not x[0] < midline_x:
        return {}, {**info, "reason": "no right-sided (caecal) end"}
    right = np.nonzero(x < midline_x)[0]
    left = np.nonzero(x > midline_x)[0]
    if not len(right) or not len(left):
        return {}, {**info, "reason": "path does not cross the midline"}
    h = int(right[np.argmax(z[right])])
    s = int(left[np.argmax(z[left])])
    info.update(hepaticFlexureZ=round(float(z[h]), 1), splenicFlexureZ=round(float(z[s]), 1))
    if not (0 < h < s < len(z) - 1):
        return {}, {**info, "reason": "flexures not in caecum -> hepatic -> splenic order"}
    if not (z[0] < z[h]):
        return {}, {**info, "reason": "caecal end not below the hepatic flexure"}
    seg = np.zeros(len(z), np.uint8)  # 1 asc, 2 transverse, 3 desc, 4 sigmoid, 5 rectum
    seg[:h + 1] = 1
    seg[h + 1:s + 1] = 2
    seg[s + 1:] = 3
    if np.mean(x[:h + 1] < midline_x) < 0.8:
        return {}, {**info, "reason": "ascending segment not right-sided"}
    if not (np.any(x[h:s + 1] < midline_x) and np.any(x[h:s + 1] > midline_x)):
        return {}, {**info, "reason": "transverse segment does not cross the midline"}
    crest = None
    if hips is not None and hips.any():
        crest = float(max(geo.slice_z(k) for k in np.unique(np.nonzero(hips)[2])))
    info["iliacCrestZ"] = crest
    tail = np.arange(s + 1, len(z))
    if crest is not None and len(tail) and np.any(z[tail] < crest):
        d_end = int(tail[np.argmax(z[tail] < crest)])
        seg[d_end:] = 4
        if np.mean(x[s + 1:d_end] > midline_x) < 0.8:
            return {}, {**info, "reason": "descending segment not left-sided"}
        if sacrum is not None and sacrum.any():
            ks = np.unique(np.nonzero(sacrum)[2])
            ztop, zbot = max(geo.slice_z(k) for k in ks), min(geo.slice_z(k) for k in ks)
            z_s3 = ztop - 0.4 * (ztop - zbot)
            info["s3LevelZ"] = round(float(z_s3), 1)
            r = len(z) - 1
            while r > d_end and z[r] < z_s3 and abs(x[r] - midline_x) < 30:
                r -= 1
            if r < len(z) - 1:
                seg[r + 1:] = 5
            else:
                info["rectum"] = "path end not below S3 in the posterior midline: rectum not labelled"
        else:
            info["sigmoidRectum"] = "no sacrum mask: sigmoid and rectum not separated"
            seg[d_end:] = 0
    else:
        info["pelvis"] = "colon path does not reach below the iliac crest (or no hip masks): no sigmoid / rectum"
        if crest is None and z[-1] - geo.scan_bottom_z() > 10.0:
            # neither anchored at the iliac crest nor cut by the lower scan edge: end of the descending colon unknown
            seg[s + 1:] = 0
            info["descending"] = "not labelled (no iliac-crest reference and the path does not run to the scan edge)"
    # assign every voxel of the main component to its nearest path point
    from scipy.spatial import cKDTree
    vi = np.argwhere(main)
    vx, vy, vz = geo.lps(vi[:, 0], vi[:, 1], vi[:, 2])
    tree = cKDTree(np.column_stack([x, y, z]))
    _, nn = tree.query(np.column_stack([vx, vy, vz]))
    lab_v = seg[nn]
    names = {1: "colon_ascending", 2: "colon_transverse", 3: "colon_descending", 4: "colon_sigmoid", 5: "rectum"}
    parts = {}
    for code, nme in names.items():
        sel = vi[lab_v == code]
        if len(sel):
            m = np.zeros(main.shape, bool)
            m[tuple(sel.T)] = True
            parts[nme] = m
    info["segmentsLabelled"] = sorted(parts)
    return parts, info
