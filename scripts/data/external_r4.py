"""Round 4: more patients from the open sources already in use, fetched into RADIOLOGY_RAW_DIR.

  python scripts/data/external_r4.py breast        # Breast-Lesions-USG: more biopsy/follow-up-proven lesions (local ZIP)
  python scripts/data/external_r4.py isles-survey  # ISLES 2022: lesion masks of every case (small), for selection
  python scripts/data/external_r4.py isles         # ISLES 2022: DWI, ADC, mask and sidecars of the selected cases
  python scripts/data/external_r4.py nih           # NIH ChestX-ray14: more PA films with a radiologist box
  python scripts/data/external_r4.py graz          # GRAZPEDWRI-DX: more children's wrist fractures (both views)
  python scripts/data/external_r4.py cbis          # CBIS-DDSM: more mammograms (CC and MLO of one breast)

Same rules as external.py (whose round 1-3 selection files are left untouched): every source is open (CC BY / NIH
unrestricted, no login or agreement), each selection is written to `selection-r4.json` with the sha256 of every file,
and patients already used by an earlier pack are never picked again. Selection is by rule (below); cases dropped after
the QC overlay review are listed with the reason in the *_R4_DROPPED tables and are skipped by the builder.
"""
from __future__ import annotations

import csv
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from external import (BREAST_CASES, BREAST_DIR, CBIS_BREASTS, CBIS_DIR, GRAZ_DIR, GRAZ_STEMS, ISLES_DIR,  # noqa: E402
                      ISLES_ZIP, NIH_DIR, RAW, sha256)
from remote_zip import open_remote  # noqa: E402

PACKS_DIR = Path(__file__).resolve().parents[2] / "public" / "packs"


R4_PACK_IDS = {"us-breast-2", "stroke-mri-2", "cxr-findings-2", "peds-wrist-2", "mammo-cbis-2"}


def _used_subjects(prefix: str) -> set[str]:
    """Source subject ids of `prefix` already in an earlier (round 1-3) pack, so round 4 never repeats a patient; the
    round-4 packs themselves are ignored so that a rebuild selects the same cases again."""
    out = set()
    for man in PACKS_DIR.glob("*/pack.json"):
        if man.parent.name in R4_PACK_IDS:
            continue
        for s in json.loads(man.read_text(encoding="utf-8"))["subjects"]:
            if s["key"].startswith(prefix):
                out.add(s["key"][len(prefix):])
    return out


# ====================================================================== Breast-Lesions-USG
# Stratified so that every diagnosis in the dataset is represented before the common ones repeat: malignant (biopsy),
# benign (biopsy) and benign (stable on follow-up), each round-robin over its diagnoses in CaseID order.
BREAST_R4_QUOTA = {("malignant", "confirmed by biopsy"): 45, ("benign", "confirmed by biopsy"): 35, ("benign", "confirmed by follow-up care"): 20}
BREAST_R4_NOT_MASS = ("Breast scar", "Implant rupture", "Mammary duct ectasia", "Duct filled with thick fluid")
BREAST_R4_RISK_LESION = ("Lobular carcinoma in situ (LCIS)", "Atypical lobular hyperplasia (ALH)")
# Dropped after the overlay review: case -> reason (kept out of the build).
BREAST_R4_DROPPED: dict[int, str] = {
    57: ("radiologist's interpretation 'simple cyst', but recorded as irregular with no posterior enhancement, which does not "
         "meet the simple-cyst criteria the lessons teach; ambiguous"),
    142: "pathology 'simple cyst' disagrees with the radiologist's description (complex cyst, heterogeneous echoes); ambiguous",
}


def breast_r4_candidates():
    import pandas as pd
    d = pd.read_excel(BREAST_DIR / "clinical.xlsx")
    used = set(BREAST_CASES)
    out = []
    for _, r in d.iterrows():
        cid = int(r.CaseID)
        # one lesion per image (no second mask), proven by biopsy or follow-up, not a normal scan, not used before
        if cid in used or r.Classification not in ("benign", "malignant") or isinstance(r.Mask_other_filename, str):
            continue
        if r.Verification not in ("confirmed by biopsy", "confirmed by follow-up care"):
            continue
        # not a mass (scar, implant, duct) or a risk lesion whose benign/malignant label would teach the wrong thing
        if any(k in str(r.Interpretation) for k in BREAST_R4_NOT_MASS) or str(r.Diagnosis) in BREAST_R4_RISK_LESION:
            continue
        out.append(r)
    return out


def breast_r4_select() -> list[int]:
    by_stratum: dict[tuple, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for r in breast_r4_candidates():
        key = (r.Classification, r.Verification)
        dx = r.Diagnosis if r.Verification == "confirmed by biopsy" else r.Interpretation
        by_stratum[key][dx].append(int(r.CaseID))
    chosen = []
    for key, n in BREAST_R4_QUOTA.items():
        groups = [sorted(v) for _, v in sorted(by_stratum[key].items(), key=lambda kv: (-len(kv[1]), kv[0]))]
        picked: list[int] = []
        i = 0
        while len(picked) < n and any(i < len(g) for g in groups):
            for g in groups:
                if i < len(g) and len(picked) < n:
                    picked.append(g[i])
            i += 1
        chosen += sorted(picked)
    return chosen


def breast_fetch_r4() -> None:
    import pandas as pd
    d = pd.read_excel(BREAST_DIR / "clinical.xlsx")
    z = zipfile.ZipFile(BREAST_DIR / "images_and_masks.zip")
    out = BREAST_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for cid in breast_r4_select():
        row = {k: (None if (isinstance(v, float) and v != v) else (v.item() if hasattr(v, "item") else v))
               for k, v in d[d.CaseID == cid].iloc[0].to_dict().items()}
        files = {}
        for kind, fname in (("image", row["Image_filename"]), ("tumor", row["Mask_tumor_filename"])):
            dst = out / fname
            if not dst.exists():
                dst.write_bytes(z.read(f"BrEaST-Lesions_USG-images_and_masks/{fname}"))  # CRC-32 checked by zipfile
            files[kind] = {"file": str(dst.relative_to(RAW)), "sha256": sha256(dst)}
        chosen.append({"case": cid, "row": row, "files": files})
    (BREAST_DIR / "selection-r4.json").write_text(json.dumps({"zipSha256": sha256(BREAST_DIR / "images_and_masks.zip"),
                                                                "cases": chosen}, indent=1, default=str), encoding="utf-8")
    print(len(chosen), "BrEaST cases")


# ====================================================================== ISLES 2022
ISLES_USED = {"sub-strokecase0015", "sub-strokecase0057"}
ISLES_R4_N = 50
ISLES_R4_DROPPED: dict[str, str] = {}


def _isles_member(sub: str, kind: str) -> str:
    if kind == "msk":
        return f"ISLES-2022/derivatives/{sub}/ses-0001/{sub}_ses-0001_msk.nii.gz"
    return f"ISLES-2022/{sub}/ses-0001/dwi/{sub}_ses-0001_{kind}"


class _Polite:
    """Zenodo answers 429 to bursts of Range requests: pause between members and back off (re-opening the archive) on errors."""

    def __init__(self, url: str):
        self.url, self.zf = url, open_remote(url)

    def read(self, member: str) -> bytes:
        import time
        for attempt in range(8):
            try:
                time.sleep(0.5)
                return self.zf.read(member)  # CRC-32 checked by zipfile
            except KeyError:
                raise
            except Exception as e:  # noqa: BLE001
                wait = 30 * (attempt + 1)
                print(f"  {member}: {type(e).__name__} {e}; retrying in {wait} s", flush=True)
                time.sleep(wait)
                self.zf = open_remote(self.url)
        raise RuntimeError(f"could not read {member}")

    def namelist(self) -> list[str]:
        return self.zf.namelist()


def isles_survey() -> None:
    """Every case's lesion mask (a few kB each): volume, slices and connected components, for the selection rule."""
    import nibabel as nib
    from scipy import ndimage
    zf = _Polite(ISLES_ZIP)
    subs = sorted({n.split("/")[2] for n in zf.namelist() if n.startswith("ISLES-2022/derivatives/sub-strokecase") and n.endswith("_msk.nii.gz")})
    mdir = ISLES_DIR / "_masks"
    mdir.mkdir(parents=True, exist_ok=True)
    rows = []
    for sub in subs:
        dst = mdir / f"{sub}_ses-0001_msk.nii.gz"
        if not dst.exists():
            dst.write_bytes(zf.read(_isles_member(sub, "msk")))
        img = nib.load(dst)
        m = np.asarray(img.dataobj) > 0
        lab, n = ndimage.label(m)
        sizes = sorted(ndimage.sum(m, lab, range(1, n + 1)), reverse=True) if n else []
        vox = float(np.prod(img.header.get_zooms()[:3]))
        rows.append({"case": sub, "shape": list(m.shape), "voxelMl": vox / 1000, "volumeMl": float(m.sum() * vox / 1000),
                     "components": int(n), "largestMl": float(sizes[0] * vox / 1000) if sizes else 0.0, "sha256": sha256(dst)})
    (ISLES_DIR / "survey-r4.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print(len(rows), "masks surveyed")


def isles_r4_select() -> list[str]:
    """Lesion of at least 2 ml (visible on 2 mm images), on the 2 mm DWI grid like the round-2 cases, spread over the
    range of sizes: the candidates sorted by volume and taken at even steps."""
    rows = json.loads((ISLES_DIR / "survey-r4.json").read_text(encoding="utf-8"))
    cands = [r for r in rows if r["case"] not in ISLES_USED and r["volumeMl"] >= 2.0 and abs(r["voxelMl"] - 0.008) < 1e-4]
    cands.sort(key=lambda r: (r["volumeMl"], r["case"]))
    n = min(ISLES_R4_N + len(ISLES_R4_DROPPED), len(cands))
    idx = sorted({round(i * (len(cands) - 1) / max(1, n - 1)) for i in range(n)})
    return [cands[i]["case"] for i in idx if cands[i]["case"] not in ISLES_R4_DROPPED]


def isles_fetch_r4() -> None:
    zf = _Polite(ISLES_ZIP)
    names = set(zf.namelist())
    chosen = []
    for sub in isles_r4_select():
        out = ISLES_DIR / sub
        out.mkdir(parents=True, exist_ok=True)
        files = {}
        for kind, member in (("dwi", _isles_member(sub, "dwi.nii.gz")), ("dwi_json", _isles_member(sub, "dwi.json")),
                             ("adc", _isles_member(sub, "adc.nii.gz")), ("adc_json", _isles_member(sub, "adc.json")),
                             ("msk", _isles_member(sub, "msk"))):
            if member not in names and kind.endswith("_json"):
                continue  # about 100 of the 250 cases come without JSON sidecars; the builder then omits the scanner attributes
            dst = out / member.rsplit("/", 1)[-1]
            if not dst.exists():
                dst.write_bytes(zf.read(member))
            files[kind] = {"file": str(dst.relative_to(RAW)), "member": member, "sha256": sha256(dst)}
        chosen.append({"case": sub, "files": files})
        print(sub, "ok", flush=True)
    (ISLES_DIR / "selection-r4.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== NIH ChestX-ray14 (radiologist boxes)
# Candidates per label, ranked like external.nih_select (PA, adult, the box label also in the report labels, fewest other
# labels, a box that is not tiny, one film per patient, patients of earlier packs excluded); every candidate is drawn
# with its box and kept only where the boxed finding is clearly visible (NIH_R4_DROPPED lists the rest with the reason).
# Pass A ranks like round 1 (fewest other labels first, box area capped); pass B, for findings that are conspicuous when
# large, ranks by box area (largest first) among boxes up to a quarter of the film, so that big effusions, consolidations,
# collapses and masses are reviewed. Images already in pass A are not repeated.
NIH_R4_CANDIDATES = {"Pneumothorax": 18, "Effusion": 16, "Atelectasis": 14, "Cardiomegaly": 14, "Mass": 16, "Nodule": 14, "Pneumonia": 12}
NIH_R4_CANDIDATES_B = {"Pneumothorax": 12, "Effusion": 20, "Atelectasis": 12, "Cardiomegaly": 12, "Mass": 12, "Nodule": 10, "Pneumonia": 14}
_NOT_SEEN = "boxed finding not clearly visible on review of the 1024 px film (full view and zoom); too subtle to teach from here"
_ROUND1 = "rejected in round 1 for the same reason ({}), see external.py"
_TOO_BIG = "the box covers most of a lung or spans both lungs: not a focal finding to locate"
_BORDERLINE_HEART = "heart size borderline by eye (cardiothoracic ratio near 0.5): not a clear example of cardiomegaly"
NIH_R4_DROPPED: dict[str, str] = {
    # pass A, pneumothorax
    **{k: _NOT_SEEN for k in ("00016937_014.png", "00021896_003.png", "00028861_009.png", "00029075_013.png", "00028924_009.png",
                              "00010936_016.png", "00017747_008.png", "00002176_005.png", "00019892_003.png", "00009166_004.png",
                              "00010071_008.png", "00021748_000.png")},
    "00014083_023.png": "pneumothorax box at the left base over the hemidiaphragm and stomach bubble; no pleural line identifiable",
    # pass A, effusion
    "00020751_003.png": _ROUND1.format("effusion box on the lateral wall, no visible fluid"),
    **{k: _NOT_SEEN for k in ("00023283_019.png", "00030634_000.png", "00016291_002.png", "00021381_013.png", "00007034_016.png",
                              "00002583_014.png", "00009437_008.png", "00012174_000.png", "00014149_018.png", "00014346_010.png")},
    "00027028_017.png": _TOO_BIG, "00003803_010.png": _TOO_BIG,
    "00009683_005.png": "not a standard upright PA film (patient imaged lying on the side) although labelled PA",
    # pass A, atelectasis
    **{k: _NOT_SEEN for k in ("00014795_002.png", "00006851_034.png", "00030434_000.png", "00000147_001.png", "00023156_001.png",
                              "00002350_001.png", "00019917_004.png")},
    # pass A, cardiomegaly
    **{k: _BORDERLINE_HEART for k in ("00002704_029.png", "00004342_020.png", "00004461_000.png", "00005827_000.png", "00006912_007.png",
                                      "00010381_000.png")},
    # pass A, mass
    "00018623_001.png": _ROUND1.format("mass box over half the lower chest"),
    **{k: _NOT_SEEN for k in ("00026261_001.png", "00020065_008.png", "00028698_001.png", "00023075_033.png", "00018366_010.png",
                              "00026695_000.png")},
    "00006821_002.png": _TOO_BIG, "00013911_021.png": _TOO_BIG, "00027833_022.png": _TOO_BIG,
    "00027697_001.png": "mass box over the dome of the right hemidiaphragm: the mass cannot be told from the diaphragm",
    # pass A, nodule
    "00018814_000.png": _ROUND1.format("nodule box over the breast/nipple shadow"),
    "00016487_002.png": _ROUND1.format("retrocardiac, not visible at this size"),
    **{k: _NOT_SEEN for k in ("00012592_005.png", "00002578_000.png", "00009403_006.png", "00020774_000.png", "00015141_002.png",
                              "00013674_000.png")},
    # pass A, pneumonia
    "00007444_003.png": _ROUND1.format("pneumonia too faint to teach with"),
    "00008727_009.png": _ROUND1.format("pneumonia too faint to teach with"),
    "00013272_005.png": _ROUND1.format("pneumonia too faint to teach with"),
    **{k: _NOT_SEEN for k in ("00020845_002.png", "00005567_025.png", "00003391_001.png", "00005869_001.png")},
    "00002980_000.png": _TOO_BIG, "00015069_001.png": _TOO_BIG,    # pass B (largest boxes first)
    "00016429_015.png": _NOT_SEEN,
    "00017137_016.png": _NOT_SEEN,
    "00014822_039.png": _NOT_SEEN,
    "00029807_003.png": _NOT_SEEN,
    "00025368_018.png": _NOT_SEEN,
    "00026392_005.png": _NOT_SEEN,
    "00020146_005.png": _NOT_SEEN,
    "00028628_008.png": _NOT_SEEN,
    "00008841_044.png": _NOT_SEEN,
    "00030039_008.png": _NOT_SEEN,
    "00005089_014.png": _NOT_SEEN,
    "00029532_005.png": _NOT_SEEN,
    "00016417_008.png": _NOT_SEEN,
    "00025529_018.png": _NOT_SEEN,
    "00022572_087.png": _NOT_SEEN,
    "00018253_017.png": _NOT_SEEN,
    "00011827_003.png": _NOT_SEEN,
    "00027817_001.png": _NOT_SEEN,
    "00008814_010.png": _TOO_BIG,
    "00022611_001.png": _NOT_SEEN,
    "00019766_023.png": _NOT_SEEN,
    "00029464_015.png": _TOO_BIG,
    "00018496_006.png": _TOO_BIG,
    "00014607_007.png": _TOO_BIG,
    "00020857_008.png": _TOO_BIG,
    "00022883_002.png": _TOO_BIG,
    "00010625_014.png": _TOO_BIG,
    "00025228_005.png": _NOT_SEEN,
    "00028012_001.png": _NOT_SEEN,
    "00009669_003.png": _NOT_SEEN,
    "00007124_008.png": _NOT_SEEN,
    "00030635_001.png": _NOT_SEEN,
    "00003945_004.png": _TOO_BIG,
    "00030279_000.png": 'very low-contrast film: heart borders cannot be judged',
    "00023176_017.png": 'very low-contrast film: heart borders cannot be judged',
    "00027464_033.png": _BORDERLINE_HEART,
    "00010277_000.png": _TOO_BIG,
    "00017257_001.png": 'mass box over the upper mediastinum: no discrete lung mass identifiable',
    "00012376_010.png": 'several overlapping boxes (infiltrate, mass, pneumothorax) on a complex film',
    "00021201_010.png": 'mass and infiltrate boxes overlap on the same area',
    "00014551_010.png": 'mass box behind the heart over a rounded opacity with an air-fluid level (could be a hiatal hernia): ambiguous',
    "00011269_019.png": 'unexplained air-fluid level at the left base next to the boxed effusion; too complex for a located-finding case',
    "00017670_005.png": _NOT_SEEN,
    "00028027_000.png": _NOT_SEEN,
    "00014731_028.png": _NOT_SEEN,
    "00029105_015.png": _NOT_SEEN,
    "00001688_000.png": _NOT_SEEN,
    "00003948_001.png": _NOT_SEEN,
    "00021374_000.png": _NOT_SEEN,
    "00027937_004.png": _NOT_SEEN,
    "00026319_000.png": _NOT_SEEN,
    "00011450_000.png": _NOT_SEEN,
    "00018984_000.png": _NOT_SEEN,
    "00013751_003.png": _NOT_SEEN,
    "00025707_015.png": _NOT_SEEN,
    "00028208_005.png": _TOO_BIG,
    "00023178_002.png": _NOT_SEEN,
    "00014197_010.png": _NOT_SEEN,
    "00029808_003.png": 'very low-contrast film with several overlapping boxes',
    "00025962_000.png": _NOT_SEEN,
    "00016064_010.png": _NOT_SEEN,
}


def nih_r4_candidates() -> list[dict]:
    meta = NIH_DIR / "_meta"
    boxes = list(csv.reader(open(meta / "BBox_List_2017.csv", newline="")))[1:]
    entry = {r["Image Index"]: r for r in csv.DictReader(open(meta / "Data_Entry_2017_v2020.csv", newline=""))}
    by_image = defaultdict(list)
    for r in boxes:
        by_image[r[0]].append({"label": r[1], "xywh": [float(v) for v in r[2:6]]})
    patients = {str(int(p)) for p in _used_subjects("nih:ChestX-ray14:")}
    chosen = []
    for pass_, want in (("A", NIH_R4_CANDIDATES), ("B", NIH_R4_CANDIDATES_B)):
        for label, n in want.items():
            cands = []
            for img, bs in by_image.items():
                e = entry.get(img)
                if not e or not any(b["label"] == label for b in bs):
                    continue
                labels = e["Finding Labels"].split("|")
                if e["View Position"] != "PA" or not 18 <= int(e["Patient Age"]) <= 90 or label not in labels:
                    continue
                extra = [x for x in labels if x not in (label, "No Finding")]
                b = next(b for b in bs if b["label"] == label)
                area = b["xywh"][2] * b["xywh"][3]
                if pass_ == "A":
                    cands.append(((len(extra), -min(area, 200 * 200), img), img, e))
                elif area <= 0.25 * 1024 * 1024:
                    cands.append(((-area, img), img, e))
            cands.sort()
            got = 0
            for _, img, e in cands:
                if got >= n:
                    break
                if str(int(e["Patient ID"])) in patients:
                    continue
                patients.add(str(int(e["Patient ID"])))
                chosen.append({"image": img, "forLabel": label, "pass": pass_, "boxes": by_image[img], "entry": e})
                got += 1
    return chosen


def nih_fetch_r4() -> None:
    meta = NIH_DIR / "_meta"
    where = {k: tuple(v) for k, v in json.loads((meta / "zip_index.json").read_text()).items()}
    out = NIH_DIR / "images"
    out.mkdir(parents=True, exist_ok=True)
    zips: dict[str, object] = {}
    chosen = nih_r4_candidates()
    for c in chosen:
        url, member = where[c["image"]]
        p = out / c["image"]
        if not p.exists():
            zf = zips.setdefault(url, open_remote(url))
            p.write_bytes(zf.read(member))  # zipfile verifies the member's CRC-32
        c.update({"file": str(p.relative_to(RAW)), "sha256": sha256(p), "mirrorUrl": url, "member": member})
        print(c["forLabel"].ljust(13), c["image"], c["entry"]["Patient Age"], c["entry"]["Finding Labels"], flush=True)
    (meta / "selection-r4.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== GRAZPEDWRI-DX (children's wrists)
# Initial-trauma studies with exactly one frontal and one lateral image, both coded with the same single distal-radius
# AO/OTA pediatric code, one radiologist fracture box per image, and no cast, metal, osteopenia or "diagnosis uncertain"
# tag; per code, studies evenly spaced over the patient numbers. One study per patient; earlier packs' patients excluded.
GRAZ_R4_CODES = {"23r-E/2.1": 10, "23r-M/2.1": 10, "23r-M/3.1": 10}  # Salter-Harris I (E/1) left out: too subtle to grade
GRAZ_R4_DROPPED: dict[str, str] = {}


def graz_r4_studies() -> list[list[dict]]:
    meta = GRAZ_DIR / "_meta"
    rows = list(csv.DictReader(open(meta / "dataset.csv", encoding="utf-8-sig")))
    ann = zipfile.ZipFile(meta / "folder_structure.zip")
    used = {str(int(p)) for p in _used_subjects("figshare:GRAZPEDWRI-DX:")} | {str(int(s[:4])) for s in GRAZ_STEMS}
    studies = defaultdict(list)
    for r in rows:
        studies[(int(r["patient_id"]), int(r["study_number"]))].append(r)
    by_code: dict[str, list] = defaultdict(list)
    seen = set()
    for (pid, sn), v in sorted(studies.items()):
        if str(pid) in used or pid in seen or len(v) != 2 or sorted(r["projection"] for r in v) != ["1", "2"]:
            continue
        if not all(r["initial_exam"] == "1" and r["fracture_visible"] == "1" and r["ao_classification"] in GRAZ_R4_CODES
                   and not r["diagnosis_uncertain"] and not r["metal"] and not r["cast"] and not r["osteopenia"] for r in v):
            continue
        if len({r["ao_classification"] for r in v}) != 1:
            continue
        if any(len([o for o in json.loads(ann.read(f"supervisely/wrist/ann/{r['filestem']}.json"))["objects"]
                    if o["classTitle"] == "fracture"]) != 1 for r in v):
            continue
        seen.add(pid)
        by_code[v[0]["ao_classification"]].append(sorted(v, key=lambda r: r["projection"]))
    out = []
    for code, n in GRAZ_R4_CODES.items():
        c = by_code[code]
        idx = sorted({round(i * (len(c) - 1) / max(1, n - 1)) for i in range(min(n, len(c)))})
        out += [c[i] for i in idx]
    return out


def graz_fetch_r4() -> None:
    idx = json.loads((GRAZ_DIR / "_meta" / "zip_index.json").read_text(encoding="utf-8"))
    out = GRAZ_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for study in graz_r4_studies():
        for r in study:
            stem = r["filestem"]
            url, member = idx[stem]
            dst = out / f"{stem}.png"
            for attempt in range(4):  # figshare's signed S3 URLs expire after 10 s: a fresh archive handle per image
                if dst.exists():
                    break
                try:
                    dst.write_bytes(open_remote(url).read(member))  # CRC-32 checked by zipfile
                except requests.HTTPError as e:
                    print("  retry", stem, e.response.status_code, flush=True)
            chosen.append({"stem": stem, "file": str(dst.relative_to(RAW)), "sha256": sha256(dst), "zipUrl": url, "member": member})
            print(stem, r["ao_classification"], dst.stat().st_size, flush=True)
    (GRAZ_DIR / "selection-r4.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== CBIS-DDSM (mammography)
# One breast per woman with both views (CC and MLO), a single abnormality (abnormality id 1 on both views, no other
# abnormality in that breast), subtlety 4-5 and the same descriptors on both views, in typical teaching groups; per group
# the breasts are evenly spaced over the patient numbers. Women of the round-3 pack and the films rejected then are excluded.
CBIS_R4_GROUPS = [  # (csv, descriptors on both views, pathology values, number of women)
    ("mass_case_description_train_set", ("IRREGULAR", "SPICULATED"), ("MALIGNANT",), 4),
    ("mass_case_description_train_set", ("OVAL", "CIRCUMSCRIBED"), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 3),
    ("calc_case_description_train_set", ("PLEOMORPHIC", "CLUSTERED"), ("MALIGNANT",), 2),
    ("calc_case_description_train_set", ("FINE_LINEAR_BRANCHING", None), ("MALIGNANT",), 1),
    ("calc_case_description_train_set", ("LUCENT_CENTER", None), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 1),
    ("calc_case_description_train_set", ("COARSE", None), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 1),
]
CBIS_R4_EXCLUDE = {"P_00063", "P_00480", "P_00674"}  # rejected in round 3 (see external.py)
CBIS_R4_DROPPED: dict[str, str] = {
    "P_00023": ("right breast, but the chest wall is on the left edge of both films (mirrored scan?): the orientation cannot be "
                "trusted, so the hanging would be wrong"),
}


def cbis_r4_breasts() -> list[list[dict]]:
    used = {pid for _, pid, _ in CBIS_BREASTS} | CBIS_R4_EXCLUDE
    out, taken = [], set()
    for csv_name, (a, b), paths, n in CBIS_R4_GROUPS:
        rows = list(csv.DictReader(open(CBIS_DIR / "_meta" / f"{csv_name}.csv", newline="")))
        per_breast = defaultdict(list)
        all_ab = defaultdict(set)
        for r in rows:
            per_breast[(r["patient_id"], r["left or right breast"])].append(r)
            all_ab[(r["patient_id"], r["left or right breast"])].add(r["abnormality id"])
        cands = []
        for (pid, side), v in sorted(per_breast.items()):
            if pid in used or pid in taken or sorted(r["image view"] for r in v) != ["CC", "MLO"] or all_ab[(pid, side)] != {"1"}:
                continue
            if any(int(r["subtlety"]) < 4 or r["pathology"] not in paths for r in v):
                continue
            k1, k2 = ("mass shape", "mass margins") if csv_name.startswith("mass") else ("calc type", "calc distribution")
            if any(r[k1] != a or (b is not None and r[k2] != b) for r in v) or len({r[k2] for r in v}) != 1:
                continue
            cands.append([{**r, "csv": csv_name} for r in sorted(v, key=lambda r: r["image view"])])
        idx = sorted({round(i * (len(cands) - 1) / max(1, n - 1)) for i in range(min(n, len(cands)))})
        for i in idx:
            out.append(cands[i])
            taken.add(cands[i][0]["patient_id"])
    return out


def cbis_fetch_r4() -> None:
    import tcia
    chosen = []
    for breast in cbis_r4_breasts():
        for r in breast:
            full_pid, full_series = r["image file path"].split("/")[0], r["image file path"].split("/")[2]
            roi_pid, roi_series = r["ROI mask file path"].split("/")[0], r["ROI mask file path"].strip().split("/")[2]
            zf = tcia.download_series("CBIS-DDSM", full_pid, full_series)
            zr = tcia.download_series("CBIS-DDSM", roi_pid, roi_series)
            chosen.append({**r, "fullZip": str(zf.relative_to(RAW)), "roiZip": str(zr.relative_to(RAW))})
            print(r["patient_id"], r["left or right breast"], r["image view"], r["pathology"], flush=True)
    (CBIS_DIR / "selection-r4.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    fn = {"breast": breast_fetch_r4, "isles-survey": isles_survey, "isles": isles_fetch_r4, "nih": nih_fetch_r4, "graz": graz_fetch_r4,
          "cbis": cbis_fetch_r4}.get(what)
    if not fn:
        raise SystemExit(__doc__)
    fn()
