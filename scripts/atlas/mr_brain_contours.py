"""Atlas step MR-3b: brain anatomy (GOUHFI 2.0 maps) -> structures -> QC -> per-slice image_px contours.

  venv-gpu python scripts/atlas/mr_brain_contours.py [case ...]

Inputs: WORK_MR/<head>/seg_brain.nii.gz + seg_parc.nii.gz (mr_run_brain.py) on the grid of mr.nii.gz; every series of
the same subject and grid (brain_from.json) gets the same structures traced on its own SOPs.

Structures (plain names; side = the patient's):
  lobes      frontal / parietal / temporal / occipital: their DKT cortex parcels plus the cerebral white matter of that
             hemisphere nearest to them (a filled lobe, as atlases draw it); insular cortex; cingulate gyrus
  gyri       precentral, postcentral (the central sulcus lies between them), superior temporal
  deep       lateral ventricle (with its temporal horn), third and fourth ventricles, caudate nucleus, putamen, globus
             pallidus, thalamus, hippocampus, amygdala, brainstem, cerebellar hemisphere (cortex + white matter)
QC, recorded per structure in brain_structures.json:
  rule 0  mapping: maps on the mr.nii.gz grid; NIfTI affine vs DICOM IPP/IOP/PixelSpacing of sampled voxels < 0.5 mm;
          published outline re-rasterised vs mask, Dice >= 0.9
  rule 1  fragments / size: largest 26-connected part; < 0.3 ml (0.1 ml for small nuclei) or < 2 slices dropped
  rule 2  signal by sequence instead of HU: the lateral ventricles must be darker than the white matter where CSF is dark
          (T1, T1 after contrast, FLAIR, DWI) and brighter where it is bright (T2, ADC); otherwise the case's ventricles are
          dropped. Sequence from the series description and parameters (as the app's sequence guide).
  rule 3  coverage: a structure on the first or last slice (>= 10 % of its largest area there) or touching the image edge is
          "(partially imaged)"
  trace    Douglas-Peucker 1 px for the lobes (as the CT atlas), 0.35 px for every smaller structure
  rule 4  side and order: every left/right structure on its side of the mid-sagittal plane (fitted to the third ventricle,
          so a turned or tilted head is followed): centroid on its side and >= 90 % of its voxels (60 % for structures
          against the falx or septum - cingulate, lateral ventricles, frontal, parietal and occipital lobes, cerebellum,
          thalamus - because the plane drifts far from the third ventricle; a swapped side gives far less); pairs in order; thalamus above the brainstem, lateral ventricles above the thalamus,
          cerebellum behind the brainstem and below the thalamus, frontal lobe in front of the occipital lobe, temporal lobe
          below the parietal lobe; a structure failing a check is dropped
  rule 5  tumours: any structure within 10 mm of a tumour outlined by the dataset's experts (glioma, vestibular
          schwannoma; carried over in patient coordinates from any series of the same frame of reference) is not shown
"""
from __future__ import annotations

import re
import sys

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

from common import RAS_TO_LPS, dicom_pixel_to_lps, dump_json, dump_json_compact, load_json
from mr_common import WORK_MR
from mr_contours import trace_dice, trace_slice

RULES_VERSION = 1
SEG = {"WM": (1, 20), "CTX": (2, 21), "LV": (3, 22), "ILV": (4, 23), "CBWM": (5, 24), "CBC": (6, 25), "THAL": (7, 26), "CAUD": (8, 27),
       "PUT": (9, 28), "PALL": (10, 29), "HIPPO": (14, 30), "AMYG": (15, 31)}
V3, V4, BSTEM = 11, 12, 13
DKT = ["caudalanteriorcingulate", "caudalmiddlefrontal", "cuneus", "entorhinal", "fusiform", "inferiorparietal", "inferiortemporal",
       "isthmuscingulate", "lateraloccipital", "lateralorbitofrontal", "lingual", "medialorbitofrontal", "middletemporal",
       "parahippocampal", "paracentral", "parsopercularis", "parsorbitalis", "parstriangularis", "pericalcarine", "postcentral",
       "posteriorcingulate", "precentral", "precuneus", "rostralanteriorcingulate", "rostralmiddlefrontal", "superiorfrontal",
       "superiorparietal", "superiortemporal", "supramarginal", "transversetemporal", "insula"]
LOBES = {
    "frontal": ["superiorfrontal", "rostralmiddlefrontal", "caudalmiddlefrontal", "parsopercularis", "parstriangularis", "parsorbitalis",
                "lateralorbitofrontal", "medialorbitofrontal", "precentral", "paracentral"],
    "parietal": ["superiorparietal", "inferiorparietal", "supramarginal", "postcentral", "precuneus"],
    "temporal": ["superiortemporal", "middletemporal", "inferiortemporal", "transversetemporal", "fusiform", "entorhinal", "parahippocampal"],
    "occipital": ["lateraloccipital", "lingual", "cuneus", "pericalcarine"],
}
CINGULATE = ["rostralanteriorcingulate", "caudalanteriorcingulate", "posteriorcingulate", "isthmuscingulate"]
GYRI = {"precentral_gyrus": ["precentral"], "postcentral_gyrus": ["postcentral"], "superior_temporal_gyrus": ["superiortemporal"]}
LABEL = {"frontal_lobe": "frontal lobe", "parietal_lobe": "parietal lobe", "temporal_lobe": "temporal lobe", "occipital_lobe": "occipital lobe",
         "insula": "insular cortex (insula)", "cingulate_gyrus": "cingulate gyrus", "precentral_gyrus": "precentral gyrus (motor cortex)",
         "postcentral_gyrus": "postcentral gyrus (sensory cortex)", "superior_temporal_gyrus": "superior temporal gyrus",
         "lateral_ventricle": "lateral ventricle", "caudate_nucleus": "caudate nucleus", "putamen": "putamen",
         "globus_pallidus": "globus pallidus", "thalamus": "thalamus", "hippocampus": "hippocampus", "amygdala": "amygdala",
         "cerebellum": "cerebellar hemisphere"}
MIDLINE = {"third_ventricle": "Third ventricle", "fourth_ventricle": "Fourth ventricle", "brainstem": "Brainstem"}
SMALL = {"amygdala", "globus_pallidus", "fourth_ventricle", "third_ventricle", "hippocampus"}
# Structures that lie against the falx or the septum pellucidum: the plane fitted to the small third ventricle drifts by a few
# millimetres far from it, so they need 60 % (a swapped side gives far less); leaks across the midline are checked by eye.
SIDE_SHARE = {s: 0.6 for s in ("cingulate_gyrus", "lateral_ventricle", "frontal_lobe", "parietal_lobe", "occipital_lobe", "cerebellum", "thalamus")}
CSF_BRIGHT = re.compile(r"\bADC\b|apparent diffusion|\bT2\b|T2[_ ]|t2_|BLADE|CISS|ci3d", re.I)
CSF_DARK = re.compile(r"\bDWI\b|diffusion|\bT1\b|T1[_ ]|t1_|mpr|FLAIR|\bTOF\b|time-of-flight", re.I)


def parcel_ids(names: list[str], side: str) -> list[int]:
    off = 1 if side == "left" else 32
    return [off + DKT.index(n) for n in names]


def build_structures(seg: np.ndarray, parc: np.ndarray, zooms) -> dict[str, np.ndarray]:
    out = {}
    for side, s in (("left", 0), ("right", 1)):
        wm = seg == SEG["WM"][s]
        lobe_ctx = {lb: np.isin(parc, parcel_ids(names, side)) for lb, names in LOBES.items()}
        # white matter nearest to each lobe's cortex (feature transform of the union of lobe parcels)
        lab = np.zeros(seg.shape, np.int8)
        for k, lb in enumerate(LOBES, start=1):
            lab[lobe_ctx[lb]] = k
        if (lab > 0).any() and wm.any():
            _, idx = ndi.distance_transform_edt(lab == 0, sampling=zooms, return_indices=True)
            nearest = lab[tuple(idx)]
        else:
            nearest = np.zeros_like(lab)
        for k, lb in enumerate(LOBES, start=1):
            out[f"{lb}_lobe_{side}"] = lobe_ctx[lb] | (wm & (nearest == k))
        out[f"insula_{side}"] = np.isin(parc, parcel_ids(["insula"], side))
        out[f"cingulate_gyrus_{side}"] = np.isin(parc, parcel_ids(CINGULATE, side))
        for g, names in GYRI.items():
            out[f"{g}_{side}"] = np.isin(parc, parcel_ids(names, side))
        out[f"lateral_ventricle_{side}"] = np.isin(seg, (SEG["LV"][s], SEG["ILV"][s]))
        for name, key in (("caudate_nucleus", "CAUD"), ("putamen", "PUT"), ("globus_pallidus", "PALL"), ("thalamus", "THAL"),
                          ("hippocampus", "HIPPO"), ("amygdala", "AMYG")):
            out[f"{name}_{side}"] = seg == SEG[key][s]
        out[f"cerebellum_{side}"] = np.isin(seg, (SEG["CBWM"][s], SEG["CBC"][s]))
    out["third_ventricle"] = seg == V3
    out["fourth_ventricle"] = seg == V4
    out["brainstem"] = seg == BSTEM
    return out


TUMOUR_MARGIN_MM = 10.0
TUMOUR_CLASSES = re.compile(r"^finding:(glioma|vestibular_schwannoma|meningioma|metastas|tumou?r|brain_tumou?r)")


def tumour_points(info: dict):
    """LPS points (pixel centres inside the outlines) of every expert tumour outline on a series of the same subject and frame
    of reference as this series, from the image packs; None when there is none."""
    from skimage.draw import polygon
    from common import PACKS_DIR
    from mr_common import MR_SOURCE_PACKS
    me = None
    mans = [load_json(PACKS_DIR / p / "pack.json") for p in MR_SOURCE_PACKS if (PACKS_DIR / p / "pack.json").exists()]
    series = {s["uid"]: (m["packId"], s) for m in mans for s in m["series"]}
    me = series[info["seriesUid"]][1]
    pts = []
    for m in mans:
        for t in m["referenceTargets"]:
            if not TUMOUR_CLASSES.match(t["classId"]) or t["provenance"] != "source_manual":
                continue
            pid, se = series[t["seriesUid"]]
            if se["subjectKey"] != me["subjectKey"] or not se["frameOfReferenceUid"] or se["frameOfReferenceUid"] != me["frameOfReferenceUid"]:
                continue
            g = load_json(PACKS_DIR / pid / t["geometryFile"])
            ipp = {i["sopInstanceUid"]: np.asarray(i["ipp"], float) for i in se["instances"]}
            iop = np.asarray(se["geometry"]["iop"], float)
            ps = se["geometry"]["pixelSpacing"]
            for pl in g["planes"]:
                for ring in pl["polygons"]:
                    r = np.asarray(ring, float)
                    if g["space"] == "patient_lps_mm":  # mm on the plane -> [column, row] of that instance
                        dlt = r[:, :3] - ipp[pl["sopInstanceUid"]]
                        r = np.c_[dlt @ iop[:3] / ps[1], dlt @ iop[3:] / ps[0]]
                    rr, cc = polygon(r[:, 1], r[:, 0], shape=(se["geometry"]["rows"], se["geometry"]["columns"]))
                    cols = np.r_[cc, r[:, 0]]
                    rows = np.r_[rr, r[:, 1]]
                    pts.append(ipp[pl["sopInstanceUid"]] + np.outer(cols * ps[1], iop[:3]) + np.outer(rows * ps[0], iop[3:]))
    return np.concatenate(pts) if pts else None


def label_of(cid: str) -> str:
    if cid in MIDLINE:
        return MIDLINE[cid]
    base, side = cid.rsplit("_", 1)
    return f"{side.capitalize()} {LABEL[base]}"


def largest(m):
    lab, n = ndi.label(m, structure=np.ones((3, 3, 3), bool))
    return m if n <= 1 else lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))


def process(head: str, forced: dict | None = None) -> dict:
    d = WORK_MR / head
    info = load_json(d / "info.json")
    img = nib.load(str(d / "mr.nii.gz"))
    sig = np.asanyarray(img.dataobj).astype(np.float32)
    seg = np.asanyarray(nib.load(str(d / "seg_brain.nii.gz")).dataobj).astype(np.int16)
    parc = np.asanyarray(nib.load(str(d / "seg_parc.nii.gz")).dataobj).astype(np.int16)
    zooms = np.asarray(img.header.get_zooms()[:3], float)
    vox_ml = float(np.prod(zooms)) / 1000.0
    A = img.affine
    lps = lambda ijk: (RAS_TO_LPS @ A @ np.c_[ijk, np.ones(len(ijk))].T).T[:, :3]  # noqa: E731
    structs = {k: largest(v) for k, v in build_structures(seg, parc, zooms).items() if v.any()}
    out = {"case": head, "rulesVersion": RULES_VERSION, "structures": {}, "checks": {}}
    st = {}
    for cid, m in structs.items():
        ijk = np.argwhere(m)
        w = lps(ijk)
        r = {"voxels": int(m.sum()), "volumeMl": round(m.sum() * vox_ml, 2), "centroid": [round(float(c), 1) for c in w.mean(0)],
             "slices": int(len(np.unique(ijk[:, 2]))), "status": "ok", "rule": None}
        minml = 0.1 if any(cid.startswith(s) for s in SMALL) else 0.3
        if r["volumeMl"] < minml or r["slices"] < 2:
            r["status"], r["rule"] = f"dropped: {r['volumeMl']} ml on {r['slices']} slices (too small)", 1
        K = img.shape[2]
        per_k = np.bincount(ijk[:, 2], minlength=K)
        edge = (ijk[:, 0] == 0) | (ijk[:, 1] == 0) | (ijk[:, 0] == img.shape[0] - 1) | (ijk[:, 1] == img.shape[1] - 1)
        r["partial"] = bool(per_k[0] >= 0.1 * per_k.max() or per_k[K - 1] >= 0.1 * per_k.max() or edge.sum() >= 5)
        st[cid] = r
    ok = lambda c: c in st and st[c]["status"] == "ok"  # noqa: E731
    # rule 2: CSF signal by sequence
    desc = info["description"]
    vent = np.isin(seg, (3, 22))
    wm = np.isin(seg, (1, 20))
    if vent.sum() > 50 and wm.sum() > 50:
        mv, mw = float(np.median(sig[vent])), float(np.median(sig[wm]))
        bright = bool(CSF_BRIGHT.search(desc)) and not re.search(r"FLAIR", desc, re.I)
        dark = bool(CSF_DARK.search(desc)) and not bright
        expect = "bright" if bright else "dark" if dark else None
        good = expect is None or (mv > mw if expect == "bright" else mv < mw)
        out["checks"]["csfSignal"] = {"ventricleMedian": round(mv, 1), "whiteMatterMedian": round(mw, 1), "expected": expect, "ok": good}
        if not good:
            for c in ("lateral_ventricle_left", "lateral_ventricle_right", "third_ventricle", "fourth_ventricle"):
                if ok(c):
                    st[c]["status"], st[c]["rule"] = f"dropped: ventricles not {expect} against white matter on this sequence", 2
    # rule 4: midline, sides and order
    mid_parts = [structs[c] for c in ("brainstem", "third_ventricle") if ok(c)]
    if not mid_parts:
        out["error"] = "no midline reference (brainstem / third ventricle)"
        for r in st.values():
            if r["status"] == "ok":
                r["status"], r["rule"] = "dropped: no midline reference", 4
    else:
        # Mid-sagittal plane: the third ventricle is a thin midline slit, so its least-variance axis is the plane's normal
        # (this follows a head that is turned or tilted in the scanner); without a usable third ventricle, a plane
        # x = centroid of brainstem + third ventricle.
        c0 = lps(np.argwhere(np.logical_or.reduce(mid_parts))).mean(0)
        normal, how = np.array([1.0, 0.0, 0.0]), "x = centroid of brainstem and third ventricle"
        if ok("third_ventricle"):
            p3 = lps(np.argwhere(structs["third_ventricle"]))
            if len(p3) >= 30:
                ev, evec = np.linalg.eigh(np.cov((p3 - p3.mean(0)).T))
                n = evec[:, 0] * (1 if evec[0, 0] >= 0 else -1)
                if ev[0] < 0.25 * ev[1] and abs(n[0]) > 0.8:  # thin, and roughly left-right
                    normal, c0, how = n, p3.mean(0), "plane fitted to the third ventricle"
        out["checks"]["midline"] = {"method": how, "normal": [round(float(v), 3) for v in normal], "point": [round(float(v), 1) for v in c0]}
        for cid, r in st.items():
            if r["status"] != "ok" or not cid.endswith(("_left", "_right")):
                continue
            sd = (lps(np.argwhere(structs[cid])) - c0) @ normal  # > 0: patient's left
            share = float(np.mean(sd > 0)) if cid.endswith("_left") else float(np.mean(sd < 0))
            r["sideShare"] = round(share, 3)
            need = SIDE_SHARE.get(cid.rsplit("_", 1)[0], 0.9)
            cen_ok = float(np.mean(sd)) > 0 if cid.endswith("_left") else float(np.mean(sd)) < 0
            if share < need or not cen_ok:
                r["status"], r["rule"] = f"dropped: {100 * share:.0f}% of it on its side of the midline (needs {100 * need:.0f}%)", 4
        cz = lambda c: st[c]["centroid"]  # noqa: E731
        order = [("thalamus_{s}", "above", "brainstem"), ("lateral_ventricle_{s}", "above", "thalamus_{s}"),
                 ("cerebellum_{s}", "behind", "brainstem"), ("cerebellum_{s}", "below", "thalamus_{s}"),
                 ("frontal_lobe_{s}", "infront", "occipital_lobe_{s}"), ("temporal_lobe_{s}", "below", "parietal_lobe_{s}")]
        for s in ("left", "right"):
            for a, rel, b in order:
                a, b = a.format(s=s), b.format(s=s)
                if not (ok(a) and ok(b)):
                    continue
                pa, pb = cz(a), cz(b)
                good = {"above": pa[2] > pb[2], "below": pa[2] < pb[2], "behind": pa[1] > pb[1], "infront": pa[1] < pb[1]}[rel]
                out["checks"][f"{a} {rel} {b}"] = good
                if not good:
                    st[a]["status"], st[a]["rule"] = f"dropped: not {rel} the {label_of(b).lower()}", 4
        for base in [k.rsplit("_", 1)[0] for k in st if k.endswith("_left")]:
            l, r_ = f"{base}_left", f"{base}_right"
            if ok(l) and ok(r_) and not st[l]["centroid"][0] > st[r_]["centroid"][0]:
                st[l]["status"] = st[r_]["status"] = "dropped: left and right in the wrong order"
                st[l]["rule"] = st[r_]["rule"] = 4
    # rule 5: next to a tumour the anatomy is pushed aside and cannot be checked; any structure within TUMOUR_MARGIN_MM of a
    # tumour outlined by the dataset's experts (on any series of the same frame of reference) is not shown
    tum = tumour_points(info)
    if tum is not None:
        from scipy.spatial import cKDTree
        tree = cKDTree(tum)
        out["checks"]["tumourPoints"] = int(len(tum))
        for cid, r in st.items():
            if r["status"] != "ok":
                continue
            pts = lps(np.argwhere(structs[cid]))
            dmin = float(tree.query(pts, k=1, distance_upper_bound=TUMOUR_MARGIN_MM + 1)[0].min())
            if dmin <= TUMOUR_MARGIN_MM:
                r["status"], r["rule"] = f"dropped: within {TUMOUR_MARGIN_MM:.0f} mm of the tumour outlined by the experts (anatomy displaced)", 5
    for cid, why in (forced or {}).items():
        if cid in st and st[cid]["status"] == "ok":
            st[cid]["status"], st[cid]["rule"] = why, 5
    out["tumourDropped"] = sorted(c for c, r in st.items() if r.get("rule") == 5)
    # tracing on every series of this grid
    partners = [head] + [r["case"] for r in load_json(WORK_MR / "mr_cases.json")
                         if (WORK_MR / r["case"] / "brain_from.json").exists() and load_json(WORK_MR / r["case"] / "brain_from.json")["from"] == head]
    for case in partners:
        dc = WORK_MR / case
        slices = load_json(dc / "slices.json")
        cinfo = load_json(dc / "info.json")
        rng = np.random.default_rng(1)
        gdir = dc / "brain_geom"
        gdir.mkdir(exist_ok=True)
        for p in gdir.glob("*.json"):
            p.unlink()
        recs = {}
        for cid, r in st.items():
            rec = dict(r)
            if r["status"] == "ok":
                m = structs[cid]
                ijk = np.argwhere(m)
                sel = ijk[rng.choice(len(ijk), size=min(40, len(ijk)), replace=False)]
                rec["alignmentMaxResidualMm"] = round(max(float(np.linalg.norm((RAS_TO_LPS @ A @ np.array([i, j, k, 1.0]))[:3]
                                                       - dicom_pixel_to_lps(slices[k]["ipp"], cinfo["iop"], cinfo["pixelSpacing"], col=float(i), row=float(j))))
                                                       for i, j, k in sel), 6)
                planes = []
                for k in np.unique(ijk[:, 2]):
                    polys, holes = trace_slice(m[:, :, k].T, 1.0 if "_lobe_" in cid else 0.35)
                    if polys:
                        pl = {"sopInstanceUid": slices[int(k)]["sopInstanceUid"], "frame": 1, "polygons": polys}
                        if holes:
                            pl["holes"] = holes
                        planes.append(pl)
                rec["planes"] = len(planes)
                rec["traceDice"] = round(trace_dice(planes, m, slices), 4)
                if rec["alignmentMaxResidualMm"] >= 0.5:
                    rec["status"], rec["rule"] = "dropped: alignment residual >= 0.5 mm", 0
                elif rec["traceDice"] < 0.9:
                    rec["status"], rec["rule"] = f"dropped: outline differs from the mask (Dice {rec['traceDice']:.2f})", 0
                else:
                    dump_json_compact({"geometryType": "contour_set", "space": "image_px", "planes": planes}, gdir / f"{cid}.json")
            rec["label"] = label_of(cid) + (" (partially imaged)" if r.get("partial") else "")
            recs[cid] = rec
        dump_json({**out, "segmentedOn": head, "seriesUid": cinfo["seriesUid"], "structures": recs}, dc / "brain_structures.json")
    return {"case": head, "ok": sum(1 for r in st.values() if r["status"] == "ok"), "dropped": {k: r["status"] for k, r in st.items() if r["status"] != "ok"},
            "partners": partners[1:], "checks": out["checks"].get("csfSignal")}


def main(argv):
    want = [a for a in argv[1:] if not a.startswith("--")]
    heads = sorted({p.parent.name for p in WORK_MR.glob("*/seg_brain.nii.gz")})
    done = {}
    for h in heads:
        if want and h not in want:
            continue
        r = process(h)
        done[h] = r
        print(f"{h}: {r['ok']} ok, partners {r['partners']}, csf {r['checks']}, dropped {r['dropped']}", flush=True)
    # rule 5 across a patient's series: structures removed next to the tumour on one series are removed on all of them
    subj = {r["case"]: r["subjectKey"] for r in load_json(WORK_MR / "mr_cases.json")}
    by_subject = {}
    for h in heads:
        by_subject.setdefault(subj.get(h), []).append(h)
    for s_key, hs in by_subject.items():
        forced = {}
        for h in hs:
            st = load_json(WORK_MR / h / "brain_structures.json")
            for cid in st.get("tumourDropped", []):
                forced[cid] = (f"dropped: within {TUMOUR_MARGIN_MM:.0f} mm of the tumour outlined by the experts on another series of this "
                               "patient (anatomy displaced)")
        for h in hs:
            st = load_json(WORK_MR / h / "brain_structures.json")
            missing = {c: w for c, w in forced.items() if st["structures"].get(c, {}).get("status") == "ok"}
            if missing and (not want or h in want):
                r = process(h, missing)
                print(f"{h}: tumour drops carried over from another series of the patient: {sorted(missing)}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
