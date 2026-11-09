"""Heart and great-vessel CT pack (`heart-ct`): chest CTs from the TotalSegmentator CT dataset v3.0.0 (Zenodo 22688904).

  python scripts/data/heart_ct.py screen     # fetch each candidate's segmentation block, test field of view, write work/screen.json
  python scripts/data/heart_ct.py pick       # choose the cases (selection.json) from the screen
  python scripts/data/heart_ct.py fetch      # download the chosen CTs (+ the vessel masks)
  python scripts/data/heart_ct.py prep       # crop each CT to the thorax (NIfTI for the models + crop.json)
  python scripts/data/heart_ct.py build      # write public/packs/heart-ct (DICOM, expert and AI outlines)

Everything outside the repository lives in RADIOLOGY_DATA_DIR (default C:/Users/kerim/radiology-data):
raw/TotalSegmentator-v3 (downloaded members) and work/heart-ct (crops, model output, QC sheets).
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import heart_ct_zip as hz  # noqa: E402

DATA = Path(os.environ.get("RADIOLOGY_DATA_DIR", r"C:\Users\kerim\radiology-data"))
WORK = DATA / "work" / "heart-ct"
RAW = hz.RAW
PREFIX = "Totalsegmentator_dataset_v300/"

# vessel and heart classes of the dataset's own segmentations that the pack uses (expert layer) + context for QC
EXPERT = ["heart", "aorta", "atrial_appendage_left", "pulmonary_vein", "superior_vena_cava", "inferior_vena_cava",
          "brachiocephalic_trunk", "brachiocephalic_vein_left", "brachiocephalic_vein_right",
          "common_carotid_artery_left", "common_carotid_artery_right", "subclavian_artery_left", "subclavian_artery_right"]
CONTEXT = ["lung_upper_lobe_left", "lung_lower_lobe_left", "lung_upper_lobe_right", "lung_middle_lobe_right", "lung_lower_lobe_right",
           "trachea", "esophagus", "sternum", "vertebrae_T4", "vertebrae_T8", "vertebrae_T12", "spinal_cord"]
NEED = EXPERT + CONTEXT
REQUIRED = ["heart", "aorta", "pulmonary_vein", "superior_vena_cava", "inferior_vena_cava"]

PRIMARY_TYPES = ["ct heart", "ct aortic valve", "ct heart-thorakale aorta", "ct artrium", "ct coronary arteries", "ct angiography chest",
                 "ct angiography chest-abdomen-pelvis", "ct angiography neck-thx-abd-pelvis-leg"]
SECONDARY_TYPES = ["ct chest", "ct chest-chest", "ct chest-neck"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def meta():
    import pandas as pd
    return pd.read_csv(RAW / "meta.csv", sep=";", encoding="utf-8-sig")


def case_entries(idx):
    out = {}
    for e in idx:
        p = e["n"].split("/")
        if len(p) >= 3 and p[1].startswith("s") and not e["n"].endswith("/"):
            out.setdefault(p[1], []).append(e)
    return out


def fetch_block(rz, entries, names, dest: Path):
    """Download the named members of one case with one ranged read over their span (CRC checked), write them under dest."""
    want = [e for e in entries if e["n"].split("/", 2)[2] in names]
    if not want:
        return []
    a = min(e["o"] for e in want)
    b = max(e["o"] + 30 + 4096 + e["c"] for e in want)
    blob = rz.read(a, min(b, rz.size) - a)
    got = []
    for e in want:
        rel = e["n"].split("/", 2)[2]
        p = dest / rel
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(hz.member_bytes(rz, e, (a, blob)))
        got.append(rel)
    return got


def _screen_one(r, ents, rz, names):
    import nibabel as nib
    cid = r.image_id
    fetch_block(rz, ents, set(names), RAW / cid)
    rec = {"id": cid, "age": float(r.age), "gender": None if str(r.gender) == "nan" else r.gender, "institute": r.institute,
           "studyType": r.study_type, "manufacturer": r.manufacturer, "scanner": str(r.scanner_model), "kvp": str(r.kvp),
           "kernel": str(r.convolution_kernel), "sliceThickness": str(r.slice_thickness), "pathology": str(r.pathology),
           "pathologyLocation": str(r.pathology_location), "split": r.split}
    vox, bbox, shape, zooms = {}, {}, None, None
    for c in NEED:
        p = RAW / cid / "segmentations" / f"{c}.nii.gz"
        if not p.exists():
            continue
        im = nib.load(str(p))
        shape, zooms = im.shape, [round(float(z), 3) for z in im.header.get_zooms()[:3]]
        m = np.asarray(im.dataobj) > 0
        vox[c] = int(m.sum())
        if vox[c]:
            ijk = np.argwhere(m)
            bbox[c] = [ijk.min(0).tolist(), ijk.max(0).tolist()]
    rec.update(shape=shape, zooms=zooms, voxels=vox, bbox=bbox)
    return rec


def screen(workers: int = 8):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    idx = hz.load_index()
    ce = case_entries(idx)
    df = meta()
    df = df[df.study_type.isin(PRIMARY_TYPES + SECONDARY_TYPES) & ~df.pathology.isin(["bleeding", "unclear"]) & (df.age >= 18)]
    out_p = WORK / "screen.json"
    res = json.loads(out_p.read_text()) if out_p.exists() else {}
    names = [f"segmentations/{c}.nii.gz" for c in NEED]
    todo = [r for r in df.itertuples() if r.image_id not in res]
    log(f"{len(df)} candidates, {len(todo)} to screen")
    rzs = [hz.Ranged() for _ in range(workers)]
    import itertools, threading
    lock, counter = threading.Lock(), itertools.count()

    def job(i, r):
        return _screen_one(r, ce[r.image_id], rzs[i % workers], names)

    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(job, i, r): r.image_id for i, r in enumerate(todo)}
        for f in as_completed(futs):
            res[futs[f]] = f.result()
            n = next(counter)
            if n % 10 == 0:
                with lock:
                    out_p.write_text(json.dumps(res))
                log(f"[{n + 1}/{len(todo)}] {futs[f]} {sum(z.bytes for z in rzs) / 1e6:.0f} MB {sum(z.calls for z in rzs)} calls")
    out_p.write_text(json.dumps(res))


GROUPS = [  # (study type, pathology filter, how many candidates); non-J institutes are all taken separately
    ("ct heart", "no_pathology", 4), ("ct heart", "vascular", 2), ("ct artrium", "no_pathology", 3), ("ct aortic valve", "no_pathology", 4),
    ("ct coronary arteries", None, 1), ("ct heart-thorakale aorta", "no_pathology", 3), ("ct heart-thorakale aorta", "vascular", 5),
    ("ct angiography chest", "no_pathology", 3), ("ct angiography chest", "vascular", 3), ("ct angiography neck-thx-abd-pelvis-leg", "no_pathology", 3),
    ("ct chest", "no_pathology", 4), ("ct chest-neck", "no_pathology", 4), ("ct chest-chest", "no_pathology", 2),
]
# other institutes: any study type, but not a thoracic tumour or inflammation (the case is about the heart and vessels)
NONJ_SKIP_PATH = {"tumor", "inflammation", "trauma"}


def eligible(r: dict) -> bool:
    v = r["voxels"]
    if not all(v.get(c, 0) > 0 for c in REQUIRED):
        return False
    sh = r["shape"]
    lo, hi = r["bbox"]["heart"]
    marg = [lo[0], lo[1], lo[2], sh[0] - 1 - hi[0], sh[1] - 1 - hi[1], sh[2] - 1 - hi[2]]
    ml = v["heart"] * float(np.prod(r["zooms"])) / 1000
    return min(marg[:2] + marg[3:5]) >= 3 and min(marg[2], marg[5]) >= 4 and 150 < ml < 1200


def pick(seed: int = 7):
    res = json.loads((WORK / "screen.json").read_text())
    ok = {k: r for k, r in res.items() if eligible(r)}
    rng = np.random.default_rng(seed)
    chosen = []
    for r in sorted(ok.values(), key=lambda r: r["id"]):
        if r["institute"] != "J" and r["pathology"] not in NONJ_SKIP_PATH:
            chosen.append(r["id"])
    for st, path, n in GROUPS:
        pool = sorted(r["id"] for r in ok.values() if r["institute"] == "J" and r["studyType"] == st and (path is None or r["pathology"] == path))
        pool = [c for c in pool if c not in chosen]
        chosen += [str(c) for c in rng.choice(pool, size=min(n, len(pool)), replace=False)]
    chosen.append("s1162")  # a second GE scanner with no thoracic finding recorded (its tumour is in the extremity)
    (WORK / "candidates.json").write_text(json.dumps(chosen))
    log(len(chosen), "candidates")
    for c in chosen:
        r = ok[c]
        log(c, r["institute"], r["studyType"], r["manufacturer"], r["pathology"], r["pathologyLocation"], r["age"], r["gender"])



def fetch(workers: int = 6):
    from concurrent.futures import ThreadPoolExecutor
    idx = hz.load_index()
    ce = case_entries(idx)
    ids = json.loads((WORK / "candidates.json").read_text())
    rzs = [hz.Ranged() for _ in range(workers)]

    def job(i, cid):
        if (RAW / cid / "ct.nii.gz").exists():
            return cid
        fetch_block(rzs[i % workers], ce[cid], {"ct.nii.gz"}, RAW / cid)
        log(cid, "ct", sum(z.bytes for z in rzs) // 1_000_000, "MB")
        return cid

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(lambda a: job(*a), enumerate(ids)))



def _load(cid: str, name: str):
    import nibabel as nib
    return nib.load(str(RAW / cid / name))


def _mask(cid: str, cls: str):
    p = RAW / cid / "segmentations" / f"{cls}.nii.gz"
    if not p.exists():
        return None
    return np.asarray(_load(cid, f"segmentations/{cls}.nii.gz").dataobj) > 0


def zrange(m):
    if m is None or not m.any():
        return None
    k = np.nonzero(m.any(axis=(0, 1)))[0]
    return int(k.min()), int(k.max())


def prep_one(cid: str) -> dict:
    """Measure contrast and the aorta, choose the crop (thorax: above the arch to below the heart), write the NIfTI the models read."""
    import nibabel as nib
    from scipy import ndimage as ndi
    im = _load(cid, "ct.nii.gz")
    ct = np.asarray(im.dataobj)
    heart, aorta = _mask(cid, "heart"), _mask(cid, "aorta")
    zh, za = zrange(heart), zrange(aorta)
    tops = [za[1]]
    for c in ("brachiocephalic_trunk", "brachiocephalic_vein_left", "brachiocephalic_vein_right", "subclavian_artery_left", "common_carotid_artery_left"):
        z = zrange(_mask(cid, c))
        if z:
            tops.append(z[1])
    top = min(max(tops), za[1] + 20) + 4
    bot = zh[0] - 8
    k0, k1 = max(bot, 0), min(top, ct.shape[2] - 1)
    # in-plane: body outline over the crop
    sub = ct[:, :, k0:k1 + 1] > -300
    proj = ndi.binary_fill_holes(sub.mean(axis=2) > 0.3)
    lab, n = ndi.label(proj)
    biggest = lab == (1 + int(np.argmax(ndi.sum(proj, lab, range(1, n + 1)))))
    ii, jj = np.nonzero(biggest)
    i0, i1, j0, j1 = max(ii.min() - 6, 0), min(ii.max() + 6, ct.shape[0] - 1), max(jj.min() - 6, 0), min(jj.max() + 6, ct.shape[1] - 1)
    # always keep the heart and the aorta inside
    hi = np.argwhere(heart)
    i0, i1 = min(i0, hi[:, 0].min() - 4), max(i1, hi[:, 0].max() + 4)
    j0, j1 = min(j0, hi[:, 1].min() - 4), max(j1, hi[:, 1].max() + 4)
    i0, j0 = max(i0, 0), max(j0, 0)
    i1, j1 = min(i1, ct.shape[0] - 1), min(j1, ct.shape[1] - 1)
    # contrast: aorta (heart levels) and left-sided pulmonary veins/atrium region are bright after an injection
    sl = np.zeros_like(aorta)
    sl[:, :, zh[0]:zh[1] + 1] = aorta[:, :, zh[0]:zh[1] + 1]
    ao_hu = float(np.median(ct[sl])) if sl.any() else float(np.median(ct[aorta]))
    ve_hu = float(np.median(ct[_mask(cid, "inferior_vena_cava") & (np.arange(ct.shape[2]) <= zh[1])[None, None, :]] if True else 0))
    dist = ndi.distance_transform_edt(aorta, sampling=1.5)
    asc = float(dist.max() * 2)
    out = {"id": cid, "crop": {"i0": int(i0), "i1": int(i1), "j0": int(j0), "j1": int(j1), "k0": int(k0), "k1": int(k1)},
           "cropShape": [int(i1 - i0 + 1), int(j1 - j0 + 1), int(k1 - k0 + 1)], "aortaMedianHuAtHeart": round(ao_hu, 1),
           "ivcMedianHu": round(ve_hu, 1), "contrast": bool(ao_hu >= 150), "aortaMaxInscribedDiameterMm": round(asc, 1),
           "heartZ": list(zh), "aortaZ": list(za), "volumeShape": list(ct.shape)}
    d = WORK / cid
    d.mkdir(parents=True, exist_ok=True)
    aff = im.affine.copy()
    aff[:3, 3] = (aff @ np.array([i0, j0, k0, 1.0]))[:3]
    nib.save(nib.Nifti1Image(ct[i0:i1 + 1, j0:j1 + 1, k0:k1 + 1].astype(np.int16), aff), str(d / "ct_crop.nii.gz"))
    (d / "prep.json").write_text(json.dumps(out, indent=1))
    return out


def prep():
    ids = json.loads((WORK / "candidates.json").read_text())
    rows = []
    for cid in ids:
        if not (RAW / cid / "ct.nii.gz").exists():
            log(cid, "no CT yet")
            continue
        r = prep_one(cid)
        rows.append(r)
        log(cid, r["cropShape"], "aortaHU", r["aortaMedianHuAtHeart"], "contrast" if r["contrast"] else "NON", "aortaD", r["aortaMaxInscribedDiameterMm"])



if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "screen":
        screen()
    elif cmd == "pick":
        pick()
    elif cmd == "fetch":
        fetch()
    elif cmd == "prep":
        prep()
    else:
        raise SystemExit(__doc__)
