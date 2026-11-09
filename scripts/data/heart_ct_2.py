"""Second round of heart and great-vessel chest CTs (`heart-ct-2`): TotalSegmentator CT dataset v3.0.0 (Zenodo 22688904, CC BY 4.0).

  python scripts/data/heart_ct_2.py screen   # fetch each new candidate's segmentation block, test field of view -> work/heart-ct-2/screen.json
  python scripts/data/heart_ct_2.py pick     # choose the round's cases from the screens of both rounds -> work/heart-ct-2/selection.json
  python scripts/data/heart_ct_2.py fetch    # download the chosen CTs
  python scripts/data/heart_ct_2.py prep     # crop (as round one) -> work/heart-ct-2/<case>/ct_crop.nii.gz + prep.json

Round one (`heart-ct`: scripts/data/heart_ct.py, heart_ct_build.py, heart_ct_ai.py, unchanged) is imported for the readers, the field-of-view
rule, the crop and the build. Differences: (a) screening covers cases round one never screened (every Philips chest study, other
hospitals' chest-abdomen studies, ...), including the dataset's pathology tag `unclear` for Philips cases (all of them carry it; it means the
table does not say, so nothing about disease is claimed for them); (b) selection favours other hospitals/scanners and heart-gated
and contrast-enhanced studies, and takes no case that round one packed. Work files live in RADIOLOGY_DATA_DIR/work/heart-ct-2.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import heart_ct as h  # noqa: E402  (round one; not modified)
import heart_ct_zip as hz  # noqa: E402

WORK2 = h.DATA / "work" / "heart-ct-2"
h.WORK = WORK2  # prep_one, fetch and the screens write below the round-two work folder (module global read at call time)
log = h.log


def candidates_df():
    df = h.meta()
    df["study_type"] = df.study_type.fillna("")
    done = set(json.loads((h.DATA / "work" / "heart-ct" / "screen.json").read_text()))
    chest = [t for t in df.study_type.unique() if any(k in t for k in ("chest", "thx", "heart", "polytrauma", "aort", "coronar", "artrium"))]
    base = df.study_type.isin(chest) & (df.age >= 18) & ~df.image_id.isin(done)
    other_hospital = df.institute != "J"
    philips = df.manufacturer.isin(["philips", "toshiba"])
    # round one skipped `bleeding` and `unclear`; `unclear` is admitted for Philips/Toshiba cases only (the table gives no pathology at all there)
    ok_path = (~df.pathology.isin(["bleeding", "unclear"])) | (philips & (df.pathology == "unclear"))
    return df[base & ok_path & (other_hospital | philips)]


def screen(workers: int = 8):
    import itertools
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    idx = hz.load_index()
    ce = h.case_entries(idx)
    df = candidates_df()
    out_p = WORK2 / "screen.json"
    res = json.loads(out_p.read_text()) if out_p.exists() else {}
    names = [f"segmentations/{c}.nii.gz" for c in h.NEED]
    todo = [r for r in df.itertuples() if r.image_id not in res]
    log(f"{len(df)} new candidates, {len(todo)} to screen")
    rzs = [hz.Ranged() for _ in range(workers)]
    lock, counter = threading.Lock(), itertools.count()

    def job(i, r):
        return h._screen_one(r, ce[r.image_id], rzs[i % workers], names)

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


GATED = ("ct heart", "ct aortic valve", "ct artrium", "ct coronary arteries", "ct heart-thorakale aorta")


def _pool():
    """Eligible cases of both screens (field of view, all five structures) that round one did not pack."""
    packed = set(json.loads((h.DATA / "work" / "heart-ct" / "selection.json").read_text()))
    res = {}
    for p in (h.DATA / "work" / "heart-ct" / "screen.json", WORK2 / "screen.json"):
        for k, r in json.loads(p.read_text()).items():
            if k not in packed and h.eligible(r):
                res[k] = r
    return res


def pick(seed: int = 11):
    ok = _pool()
    rng = np.random.default_rng(seed)
    chosen: list[str] = []

    def take(name, n, pred):
        pool = sorted(k for k, r in ok.items() if k not in chosen and pred(r))
        got = [str(c) for c in rng.choice(pool, size=min(n, len(pool)), replace=False)] if pool else []
        chosen.extend(got)
        log(f"{name}: {len(got)} of {len(pool)}")

    plain = lambda r: r["pathology"] in ("no_pathology", "unclear")  # noqa: E731
    # other scanners and hospitals first (round one had no Philips case and 3 other hospitals)
    take("Philips E (Ingenuity)", 7, lambda r: r["manufacturer"] == "philips" and r["institute"] == "E")
    take("Philips B (IQon spectral)", 5, lambda r: r["manufacturer"] == "philips" and r["institute"] == "B")
    take("GE A", 5, lambda r: r["manufacturer"] == "ge" and plain(r))
    take("Siemens A", 3, lambda r: r["institute"] == "A" and r["manufacturer"] == "siemens" and plain(r))
    take("Siemens C", 5, lambda r: r["institute"] == "C" and plain(r))
    take("Siemens K", 4, lambda r: r["institute"] == "K" and plain(r))
    # a few cases whose table tag names a thoracic finding (tag only; nothing about it is labelled or claimed in the pack)
    take("tag tumor+thorax, other hospital", 3, lambda r: r["institute"] != "J" and r["pathology"] == "tumor" and r["pathologyLocation"] == "thorax")
    take("tag inflammation+thorax, other hospital", 1, lambda r: r["institute"] != "J" and r["pathology"] == "inflammation" and r["pathologyLocation"] == "thorax")
    # heart-gated / dedicated cardiac studies of the main hospital not used in round one, vascular tag first
    take("J gated, vascular tag", 8, lambda r: r["institute"] == "J" and r["studyType"] in GATED and r["pathology"] == "vascular")
    take("J gated, no pathology", 4, lambda r: r["institute"] == "J" and r["studyType"] in GATED and r["pathology"] == "no_pathology")
    (WORK2 / "candidates.json").write_text(json.dumps(chosen))
    log(len(chosen), "candidates")
    for c in chosen:
        r = ok[c]
        log(c, r["institute"], r["studyType"], r["manufacturer"], r["scanner"], r["pathology"], r["pathologyLocation"], r["age"], r["gender"])


def fetch(workers: int = 6):
    from concurrent.futures import ThreadPoolExecutor
    idx = hz.load_index()
    ce = h.case_entries(idx)
    ids = json.loads((WORK2 / "candidates.json").read_text())
    rzs = [hz.Ranged() for _ in range(workers)]

    def job(i, cid):
        if (h.RAW / cid / "ct.nii.gz").exists() and (h.RAW / cid / "segmentations" / "heart.nii.gz").exists():
            return cid
        h.fetch_block(rzs[i % workers], ce[cid], {"ct.nii.gz"} | {f"segmentations/{c}.nii.gz" for c in h.NEED}, h.RAW / cid)
        log(cid, "ct", sum(z.bytes for z in rzs) // 1_000_000, "MB")
        return cid

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(lambda a: job(*a), enumerate(ids)))


def prep():
    ids = json.loads((WORK2 / "candidates.json").read_text())
    for cid in ids:
        if not (h.RAW / cid / "ct.nii.gz").exists():
            log(cid, "no CT yet")
            continue
        r = h.prep_one(cid)  # writes below h.WORK (= WORK2)
        log(cid, r["cropShape"], "aortaHU", r["aortaMedianHuAtHeart"], "contrast" if r["contrast"] else "NON", "aortaD", r["aortaMaxInscribedDiameterMm"])


if __name__ == "__main__":
    WORK2.mkdir(parents=True, exist_ok=True)
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
