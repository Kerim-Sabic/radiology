"""Round 5: more patients from the open sources already in use, fetched into RADIOLOGY_RAW_DIR.

  python scripts/data/external_r5.py breast   # Breast-Lesions-USG: every remaining lesion that meets the round-4 rule
  python scripts/data/external_r5.py isles    # ISLES 2022: 30 more strokes of at least 2 ml (DWI, ADC, mask, sidecars)
  python scripts/data/external_r5.py nih      # NIH ChestX-ray14: every remaining PA film with a radiologist box (for review)
  python scripts/data/external_r5.py graz     # GRAZPEDWRI-DX: 40 more children's wrist fractures (both views)
  python scripts/data/external_r5.py frac     # FracAtlas: adult fractures, one image per block of 100 image numbers
  python scripts/data/external_r5.py cbis     # CBIS-DDSM: 16 more women (CC and MLO of one breast)

Same sources, licences and rules as external_r4.py (every source open, CC BY / NIH unrestricted, no login or agreement),
with every patient of rounds 1-4 excluded. Each selection is written to `selection-r5.json` next to the round-4 one, which
is left untouched; cases dropped after the overlay review are listed with the reason in the *_R5_DROPPED tables and are
skipped by the builder (build_r5.py).
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import external_r4 as r4  # noqa: E402
from external import BREAST_DIR, FRAC_DIR, FRAC_ZIP, GRAZ_DIR, ISLES_DIR, ISLES_ZIP, NIH_DIR, RAW, sha256  # noqa: E402
from remote_zip import open_remote  # noqa: E402

R5_PACK_IDS = {"us-breast-3", "stroke-mri-3", "cxr-findings-3", "peds-wrist-3", "fx-radiographs-2", "mammo-cbis-3"}
# Patients of every earlier pack (rounds 1-4) are excluded; the round-5 packs themselves are ignored so that a rebuild
# selects the same cases again.
r4.R4_PACK_IDS = R5_PACK_IDS


def _r4_selected(path: Path, key: str) -> set:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data["cases"] if isinstance(data, dict) and "cases" in data else data
    return {r[key] for r in rows}


# ====================================================================== Breast-Lesions-USG
# The round-4 rule (one lesion mask, proven by biopsy or follow-up, not a scar/implant/duct finding or a risk lesion), on
# every case not used before: no quota, every remaining candidate is built and checked by eye.
BREAST_R5_DROPPED: dict[int, str] = {
    152: "echo pattern recorded as hyperechoic, but the lesion is clearly darker than the fat around it: a correct reader would be marked wrong",
    193: "recorded as heterogeneous with an angular margin and no posterior features, but the image shows an evenly dark, sharply outlined round nodule with a dark band behind it",
    204: "echo pattern recorded as isoechoic, but the nodule is clearly darker than the fat around it: a correct reader would be marked wrong",
}


def breast_r5_select() -> list[int]:
    taken = _r4_selected(BREAST_DIR / "selection-r4.json", "case") | set(r4.BREAST_R4_DROPPED)
    return sorted(int(r.CaseID) for r in r4.breast_r4_candidates() if int(r.CaseID) not in taken)


def breast_fetch_r5() -> None:
    import zipfile

    import pandas as pd
    d = pd.read_excel(BREAST_DIR / "clinical.xlsx")
    z = zipfile.ZipFile(BREAST_DIR / "images_and_masks.zip")
    out = BREAST_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for cid in breast_r5_select():
        row = {k: (None if (isinstance(v, float) and v != v) else (v.item() if hasattr(v, "item") else v))
               for k, v in d[d.CaseID == cid].iloc[0].to_dict().items()}
        files = {}
        for kind, fname in (("image", row["Image_filename"]), ("tumor", row["Mask_tumor_filename"])):
            dst = out / fname
            if not dst.exists():
                dst.write_bytes(z.read(f"BrEaST-Lesions_USG-images_and_masks/{fname}"))  # CRC-32 checked by zipfile
            files[kind] = {"file": str(dst.relative_to(RAW)), "sha256": sha256(dst)}
        chosen.append({"case": cid, "row": row, "files": files})
    (BREAST_DIR / "selection-r5.json").write_text(json.dumps({"zipSha256": sha256(BREAST_DIR / "images_and_masks.zip"),
                                                                "cases": chosen}, indent=1, default=str), encoding="utf-8")
    print(len(chosen), "BrEaST cases")


# ====================================================================== ISLES 2022
# The round-4 rule (a lesion of at least 2 ml on the 2 mm DWI grid) on the cases not used before, 30 taken at even steps
# across the range of lesion volumes.
ISLES_R5_N = 30
ISLES_R5_DROPPED: dict[str, str] = {}


def isles_r5_select() -> list[str]:
    rows = json.loads((ISLES_DIR / "survey-r4.json").read_text(encoding="utf-8"))
    taken = r4.ISLES_USED | _r4_selected(ISLES_DIR / "selection-r4.json", "case")
    cands = [r for r in rows if r["case"] not in taken and r["volumeMl"] >= 2.0 and abs(r["voxelMl"] - 0.008) < 1e-4]
    cands.sort(key=lambda r: (r["volumeMl"], r["case"]))
    n = min(ISLES_R5_N + len(ISLES_R5_DROPPED), len(cands))
    idx = sorted({round(i * (len(cands) - 1) / max(1, n - 1)) for i in range(n)})
    return [cands[i]["case"] for i in idx if cands[i]["case"] not in ISLES_R5_DROPPED]


def isles_fetch_r5() -> None:
    zf = r4._Polite(ISLES_ZIP)
    names = set(zf.namelist())
    chosen = []
    for sub in isles_r5_select():
        out = ISLES_DIR / sub
        out.mkdir(parents=True, exist_ok=True)
        files = {}
        for kind, member in (("dwi", r4._isles_member(sub, "dwi.nii.gz")), ("dwi_json", r4._isles_member(sub, "dwi.json")),
                             ("adc", r4._isles_member(sub, "adc.nii.gz")), ("adc_json", r4._isles_member(sub, "adc.json")),
                             ("msk", r4._isles_member(sub, "msk"))):
            if member not in names and kind.endswith("_json"):
                continue
            dst = out / member.rsplit("/", 1)[-1]
            if not dst.exists():
                dst.write_bytes(zf.read(member))
            files[kind] = {"file": str(dst.relative_to(RAW)), "member": member, "sha256": sha256(dst)}
        chosen.append({"case": sub, "files": files})
        print(sub, "ok", flush=True)
    (ISLES_DIR / "selection-r5.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== NIH ChestX-ray14 (radiologist boxes)
# Every PA film of an adult (18-90) with a radiologist box whose label is also in the report labels, one film per patient,
# not a patient of an earlier pack and not a film reviewed in rounds 1 or 4. Every candidate is drawn with its boxes and kept
# only where the boxed finding is clearly visible (NIH_R5_DROPPED lists the rest with the reason).
NIH_LABEL_ORDER = ["Pneumothorax", "Effusion", "Mass", "Nodule", "Cardiomegaly", "Pneumonia", "Atelectasis"]
NIH_R5_DROPPED: dict[str, str] = {
    **{k: "boxed finding not clearly visible on review of the 1024 px film (full view and zoom); too subtle to teach from here" for k in (
        "00000072_000.png", "00000211_010.png", "00000457_004.png", "00000468_033.png", "00000643_002.png", "00000865_006.png",
        "00001320_003.png", "00001673_016.png", "00002176_007.png", "00003787_003.png", "00004296_000.png", "00004968_003.png",
        "00006751_000.png", "00007557_026.png", "00008547_001.png", "00008716_000.png", "00009229_007.png", "00009403_002.png",
        "00009889_018.png", "00010652_000.png", "00010936_011.png", "00011576_000.png", "00012045_019.png", "00012415_002.png",
        "00012636_000.png", "00012637_000.png", "00014198_000.png", "00014447_004.png", "00014626_017.png", "00014976_003.png",
        "00015649_000.png", "00015794_000.png", "00015831_008.png", "00017151_003.png", "00017255_001.png", "00018419_001.png",
        "00019495_004.png", "00021007_000.png", "00021700_010.png", "00021860_002.png", "00021862_004.png", "00022021_002.png",
        "00022178_000.png", "00025228_007.png", "00025270_000.png", "00025662_006.png", "00026769_010.png", "00026810_001.png",
        "00027094_003.png", "00027758_004.png", "00027927_009.png", "00028383_002.png", "00028620_000.png", "00028628_020.png",
        "00030260_005.png",
    )},
    **{k: "heart size borderline by eye (cardiothoracic ratio near 0.5): not a clear example of cardiomegaly" for k in (
        "00004342_023.png", "00011557_003.png", "00012793_000.png", "00020986_000.png", "00022706_001.png", "00025747_000.png",
        "00026087_000.png", "00027685_003.png", "00027797_000.png",
    )},
    **{k: "not a focal finding to locate: diffuse opacities in both lungs" for k in (
        "00010959_010.png", "00013051_000.png",
    )},
    **{k: "the box covers most of a lung or spans both lungs: not a focal finding to locate" for k in (
        "00021772_011.png", "00022084_000.png",
    )},
    **{k: "too subtle on a very low-contrast film" for k in (
        "00028625_000.png", "00029579_005.png",
    )},
    "00000344_003.png": "boxed finding not clearly visible on a low-contrast film with several tubes and a large unboxed opacity",
    "00001170_046.png": "unexplained air-fluid level next to the finding on a complex post-sternotomy film",
    "00001248_038.png": "unexplained air-fluid level just below the box; complex film",
    "00002106_000.png": "expiration film with an air-fluid level inside the box and a large other opacity; complex film",
    "00002290_001.png": "nodule box over the breast shadow; too subtle",
    "00004547_003.png": "nodule box over a rib; too subtle",
    "00004893_085.png": "not a standard upright PA film (AP appearance, low lung volumes)",
    "00007882_001.png": "the box covers only the edge of a larger opacity, and diffuse unboxed nodules: a correct mark could be graded wrong",
    "00008386_000.png": "nodule box on a rib margin: could be a rib or cartilage density",
    "00008841_025.png": "complex film with several tubes and lines and an air-fluid level",
    "00009342_000.png": "not a standard upright PA film; the opacity extends beyond the box",
    "00010125_004.png": "mass box on an opacity of about 2 cm over ribs: 'nodule' would be the better answer",
    "00010770_000.png": "too subtle (could be the normal minor fissure)",
    "00011831_008.png": "boxed finding not clearly visible on a complex film with a drain and subcutaneous emphysema",
    "00011857_001.png": "overlapping boxes, with a gastric air-fluid level inside the effusion box",
    "00012094_040.png": "complex film with many lines, subcutaneous emphysema and a large air-fluid level",
    "00012376_011.png": "complex film: one lung largely opaque with a drain",
    "00012670_000.png": "heart borders blurred by basal opacity: heart size cannot be judged",
    "00013111_069.png": "complex film with a drain, subcutaneous emphysema and lines; the finding is hard to judge",
    "00013118_008.png": "the boxed finding looks like a small rounded opacity, not recognisable atelectasis: misleading",
    "00013471_002.png": "basal pneumothorax too subtle on a complex film with tubes and lines",
    "00013911_000.png": "pleural-based lesion over a rib that could be pleural thickening; complex film",
    "00013977_005.png": "effusion barely blunting the angle while an unboxed mass dominates the film",
    "00013991_000.png": "ill-defined opacity of about 3 cm: mass, nodule or infiltrate cannot be decided",
    "00014095_003.png": "subtle linear atelectasis while a larger unboxed opacity would be marked as the main abnormality",
    "00014280_000.png": "extensive unboxed disease in the other lung dominates the small boxed nodule",
    "00014663_013.png": "diffuse nodular opacities in both lungs: not a focal finding to locate",
    "00014706_007.png": "heart size borderline and its borders poorly defined",
    "00014778_000.png": "nodule faint over ribs; too subtle",
    "00014870_004.png": "boxed atelectasis cannot be told from post-operative change at a clipped base",
    "00015300_000.png": "mass box inside an overlapping atelectasis box on a rotated, hazy film",
    "00015792_005.png": "the boxed nodule is one of many in both lungs: a correct mark could be graded wrong",
    "00016009_008.png": "not a standard PA film, with a gastric air-fluid level in the box",
    "00016587_069.png": "an unboxed hilar mass is more conspicuous than the boxed nodule",
    "00016606_000.png": "low-volume, probably AP film: heart size cannot be judged",
    "00016837_002.png": "overlapping effusion and atelectasis boxes; small effusion",
    "00016964_011.png": "minimal blunting with a gastric air-fluid level beside the box; too subtle",
    "00016987_022.png": "not a standard PA film (AP, leads, catheter); complex",
    "00016990_000.png": "low-contrast, low-volume film: heart size cannot be judged",
    "00017028_000.png": "faint nodule on a rib crossing; too subtle",
    "00017346_000.png": "tiny density at the lung edge that may not be in the lung; too subtle",
    "00017582_003.png": "effusion barely visible on a complex film",
    "00018102_001.png": "large unboxed masses in both lungs dominate the tiny effusion box: misleading",
    "00018366_000.png": "faint nodule in the breast shadow; too subtle",
    "00018496_007.png": "apical pleural line cannot be told from rib edges; unboxed effusion and a catheter compete",
    "00018865_008.png": "pneumothorax not clearly seen on a film with chest tubes and surgical emphysema",
    "00018980_002.png": "not a standard upright PA film; the boxed finding is not clearly an effusion",
    "00019013_002.png": "an unboxed hilar mass and other opacities compete with the small boxed nodule",
    "00019154_002.png": "the boxed band could be scarring or a vessel; a large cardiac silhouette competes",
    "00019313_000.png": "faint opacity of about 3 cm: too subtle, and mass or nodule cannot be decided",
    "00019373_036.png": "complex AP film with chest tubes and extensive opacity",
    "00019706_014.png": "unexplained air-fluid level inside the box, with a chest tube: misleading",
    "00019767_016.png": "effusion not clearly identifiable among other right-sided changes",
    "00020332_000.png": "the boxed nodule may be a nipple shadow (a similar density at the same level on the other side)",
    "00020564_000.png": "subtle effusion while the unboxed enlarged heart dominates",
    "00020671_010.png": "badly rotated, non-standard film with a collapsed lung and catheters",
    "00020819_002.png": "heart borders obscured: heart size cannot be judged",
    "00021024_022.png": "the opacity cannot be told apart from the left heart border; too subtle",
    "00021458_000.png": "the boxed opacity is not distinct from coarse opacities in both lungs",
    "00021711_014.png": "too subtle on a complex film (volume loss, pleural thickening, clips)",
    "00021796_000.png": "the boxed opacity cannot be told apart from the raised right hemidiaphragm; rotated film",
    "00021840_016.png": "the effusion box overlaps an infiltrate box; small effusion",
    "00021972_001.png": "air-fluid level at the base next to the finding, with a drain and clips: too complex for a located-finding case",
    "00022155_008.png": "too subtle on a post-operative film with wires and tubes",
    "00022237_002.png": "mass box over the right heart border and hilum: the mass cannot be told from them",
    "00022707_003.png": "too subtle on a complex film",
    "00022837_005.png": "not a standard upright PA film (badly tilted portable-type film with lines and leads)",
    "00022977_000.png": "tilted, rotated film; the nodule is faint among surgical clips",
    "00023089_004.png": "modest boxed opacity while an enlarged heart is neither boxed nor labelled: misleading",
    "00023168_000.png": "mass box over the dome of the right hemidiaphragm: the mass cannot be told from the diaphragm",
    "00025368_033.png": "too subtle; bullous emphysema confounds the pneumothorax",
    "00025521_003.png": "too subtle; unexplained gas under the right hemidiaphragm",
    "00026196_001.png": "small mass box at the hilum where the mass cannot be told from it; second box just below",
    "00026398_000.png": "nodule box over ribs; too subtle",
    "00026586_009.png": "too subtle on a complex film (chest tube, clips, subcutaneous emphysema)",
    "00026886_004.png": "complex post-operative film with clips and a device over the boxed area",
    "00026889_000.png": "heart borders hidden by opacities; the box covers much of both lungs",
    "00026983_001.png": "nodule box over the first rib and costal cartilage (bone pseudo-nodule)",
    "00028640_008.png": "low-contrast film with heavy breast overlap: the effusion cannot be judged",
    "00029259_027.png": "too subtle pleural line, with a drain and a fluid level",
    "00029631_006.png": "complex post-operative film where the finding is not distinct",
    "00029647_002.png": "very low-contrast film with poor inspiration: heart size cannot be judged",
    "00029906_000.png": "heart borders hidden by lung opacities; size borderline",
    "00029909_003.png": "too subtle; the apical lucency could be a bulla",
    "00030413_003.png": "nodule box over crossing ribs; too subtle",
    "00030606_006.png": "complex film with chest tubes, subcutaneous emphysema and an air-fluid level",
}


def nih_r5_candidates() -> list[dict]:
    meta = NIH_DIR / "_meta"
    boxes = list(csv.reader(open(meta / "BBox_List_2017.csv", newline="")))[1:]
    entry = {r["Image Index"]: r for r in csv.DictReader(open(meta / "Data_Entry_2017_v2020.csv", newline=""))}
    by_image = defaultdict(list)
    for r in boxes:
        by_image[r[0]].append({"label": r[1], "xywh": [float(v) for v in r[2:6]]})
    patients = {str(int(p)) for p in r4._used_subjects("nih:ChestX-ray14:")}
    reviewed = _r4_selected(meta / "selection.json", "image") | _r4_selected(meta / "selection-r4.json", "image")
    out = []
    for img in sorted(by_image):
        e = entry.get(img)
        if not e or img in reviewed or e["View Position"] != "PA" or not 18 <= int(e["Patient Age"]) <= 90:
            continue
        labels = e["Finding Labels"].split("|")
        boxed = [b["label"] for b in by_image[img] if b["label"] in labels]
        label = next((x for x in NIH_LABEL_ORDER if x in boxed), None)
        if not label or str(int(e["Patient ID"])) in patients:
            continue
        patients.add(str(int(e["Patient ID"])))
        out.append({"image": img, "forLabel": label, "pass": "R5", "boxes": by_image[img], "entry": e})
    return out


def nih_fetch_r5() -> None:
    meta = NIH_DIR / "_meta"
    where = {k: tuple(v) for k, v in json.loads((meta / "zip_index.json").read_text()).items()}
    out = NIH_DIR / "images"
    out.mkdir(parents=True, exist_ok=True)
    zips: dict[str, object] = {}
    chosen = nih_r5_candidates()
    for c in chosen:
        url, member = where[c["image"]]
        p = out / c["image"]
        if not p.exists():
            zf = zips.setdefault(url, open_remote(url))
            p.write_bytes(zf.read(member))  # zipfile verifies the member's CRC-32
        c.update({"file": str(p.relative_to(RAW)), "sha256": sha256(p), "mirrorUrl": url, "member": member})
        print(c["forLabel"].ljust(13), c["image"], c["entry"]["Patient Age"], c["entry"]["Finding Labels"], flush=True)
    (meta / "selection-r5.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== GRAZPEDWRI-DX (children's wrists)
# The round-4 rule (initial trauma, one frontal and one lateral image with the same single distal-radius code, one
# fracture box per image, no cast, metal, osteopenia or uncertain diagnosis), patients of rounds 1-4 excluded.
GRAZ_R5_CODES = {"23r-E/2.1": 12, "23r-M/2.1": 14, "23r-M/3.1": 14}
GRAZ_R5_DROPPED: dict[str, str] = {}


def graz_fetch_r5() -> None:
    from external import GRAZ_STEMS
    r4.GRAZ_R4_CODES.clear()
    r4.GRAZ_R4_CODES.update(GRAZ_R5_CODES)
    used4 = {s.split("_")[0] for s in _r4_selected(GRAZ_DIR / "selection-r4.json", "stem")} | {s[:4] for s in GRAZ_STEMS}
    idx = json.loads((GRAZ_DIR / "_meta" / "zip_index.json").read_text(encoding="utf-8"))
    out = GRAZ_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for study in r4.graz_r4_studies():
        assert all(r["filestem"][:4] not in used4 for r in study), study
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
    (GRAZ_DIR / "selection-r5.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== FracAtlas (adult fractures)
# FracAtlas gives no patient identifiers, and images of one person are numbered together, so at most one image is taken
# from each block of 100 image numbers (and none from the blocks of the round-1 images); the block is the subject, so the
# patient count can only be an undercount. Rule: fractured, a single fracture annotation, no hardware, one view, not part
# of a multi-scan set, one body region; per block the image is the first candidate of the region least represented so far.
FRAC_R5_DROPPED: dict[str, str] = {
    "IMG0000206.jpg": "severe erosive or arthritic change of the carpus: the outlined fracture cannot be told apart from it",
    "IMG0000319.jpg": "low-resolution film: the outlined fracture is not clearly visible",
    "IMG0000480.jpg": "low-resolution film: the outlined fracture is not clearly visible",
    "IMG0000599.jpg": "probably the same wrist as IMG0000600 on another view (consecutive numbers across a block boundary): one image per person",
    "IMG0000702.jpg": "low-resolution film: the outlined fracture is not clearly visible",
    "IMG0000801.jpg": "low-resolution film: the outlined fracture is not clearly visible",
    "IMG0001007.jpg": "low-resolution film: the outlined fracture is not clearly visible",
    "IMG0001191.jpg": "amputation stump: the outline is on the end of the stump with no clear fracture",
    "IMG0001200.jpg": "skeletally immature, or no fracture distinct from the growth-plate scar",
    "IMG0001350.jpg": "the outlined fracture is not clearly visible",
    "IMG0001546.jpg": "child (open growth plates): the pack is for adults",
    "IMG0001639.jpg": "cast, splint or hardware on the limb",
    "IMG0001738.jpg": "cast, splint or hardware on the limb",
    "IMG0001870.jpg": "the outlined fracture is not clearly visible",
    "IMG0002406.jpg": "child (open growth plates): the pack is for adults",
    "IMG0002620.jpg": "child (open growth plates): the pack is for adults",
    "IMG0002840.jpg": "child (open growth plates): the pack is for adults",
    "IMG0002945.jpg": "child (open growth plates): the pack is for adults",
    "IMG0003020.jpg": "cast, splint or hardware on the limb",
    "IMG0003254.jpg": "cast, splint or hardware on the limb",
    "IMG0003619.jpg": "child (open growth plates): the pack is for adults",
    "IMG0003703.jpg": "cast, splint or hardware on the limb",
    "IMG0003803.jpg": "the outlined fracture is not clearly visible",
    "IMG0004007.jpg": "child (open growth plates): the pack is for adults",
    "IMG0004116.jpg": "child (open growth plates): the pack is for adults",
    "IMG0004206.jpg": "the outlined fracture is faint and a dense object over the carpus would mislead",
    "IMG0004320.jpg": "cast, splint or hardware on the limb",
}
FRAC_R5_USED_BLOCKS = {0, 1, 23}  # round 1: IMG00000xx, IMG00001xx, IMG00023xx


def frac_r5_candidates() -> list[dict]:
    meta = FRAC_DIR / "_meta"
    rows = list(csv.DictReader(open(meta / "dataset.csv", newline="")))
    coco = json.loads((meta / "COCO_fracture_masks.json").read_text(encoding="utf-8"))
    ann = defaultdict(list)
    for a in coco["annotations"]:
        ann[a["image_id"]].append(a)
    by_name = {im["file_name"]: im for im in coco["images"]}
    out = []
    for r in rows:
        views = [v for v in ("frontal", "lateral", "oblique") if r[v] == "1"]
        regions = [k for k in ("hand", "leg", "hip", "shoulder") if r[k] == "1"]
        if not (r["fractured"] == "1" and r["fracture_count"] == "1" and r["hardware"] == "0" and r["multiscan"] == "0"
                and r["mixed"] == "0" and len(views) == 1 and len(regions) == 1):
            continue
        im = by_name.get(r["image_id"])
        if not im or len(ann[im["id"]]) != 1:
            continue
        out.append({"image": r["image_id"], "region": regions[0], "view": views[0], "row": r, "coco_image": im,
                    "annotation": ann[im["id"]][0], "block": int(r["image_id"][3:10]) // 100})
    return out


def frac_r5_select() -> list[dict]:
    by_block = defaultdict(list)
    for c in frac_r5_candidates():
        if c["block"] not in FRAC_R5_USED_BLOCKS:
            by_block[c["block"]].append(c)
    counts: dict[str, int] = defaultdict(int)
    chosen = []
    for b in sorted(by_block):
        cands = sorted(by_block[b], key=lambda c: (counts[c["region"]], c["image"]))
        c = cands[0]
        counts[c["region"]] += 1
        chosen.append(c)
    return chosen


def frac_fetch_r5() -> None:
    zf = open_remote(FRAC_ZIP)
    out = FRAC_DIR / "images"
    out.mkdir(exist_ok=True)
    chosen = []
    for c in frac_r5_select():
        p = out / c["image"]
        if not p.exists():
            p.write_bytes(zf.read(f"FracAtlas/images/Fractured/{c['image']}"))  # CRC-32 checked by zipfile
        c.update({"file": str(p.relative_to(RAW)), "sha256": sha256(p)})
        chosen.append(c)
        print(c["block"], c["region"], c["view"], c["image"], flush=True)
    (FRAC_DIR / "_meta" / "selection-r5.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


# ====================================================================== CBIS-DDSM (mammography)
# The round-4 rule (one breast per woman with CC and MLO, a single abnormality with the same descriptors on both views,
# subtlety 4-5) and the round-4 teaching groups, women of rounds 3 and 4 and the films rejected then excluded.
CBIS_R5_GROUPS = [
    ("mass_case_description_train_set", ("IRREGULAR", "SPICULATED"), ("MALIGNANT",), 5),
    ("mass_case_description_train_set", ("OVAL", "CIRCUMSCRIBED"), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 4),
    ("calc_case_description_train_set", ("PLEOMORPHIC", "CLUSTERED"), ("MALIGNANT",), 3),
    ("calc_case_description_train_set", ("FINE_LINEAR_BRANCHING", None), ("MALIGNANT",), 2),
    ("calc_case_description_train_set", ("LUCENT_CENTER", None), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 1),
    ("calc_case_description_train_set", ("COARSE", None), ("BENIGN", "BENIGN_WITHOUT_CALLBACK"), 1),
]
_MIRRORED = ("the chest wall is on the edge of both films opposite to the recorded side (mirrored scan?): the orientation cannot "
             "be trusted, so the hanging would be wrong")
CBIS_R5_DROPPED: dict[str, str] = {"P_00034": "right breast, but " + _MIRRORED, "P_00406": "right breast, but " + _MIRRORED,
                                   "P_00995": "left breast, but " + _MIRRORED}


def cbis_r5_breasts() -> list[list[dict]]:
    from external import CBIS_DIR
    r4.CBIS_R4_EXCLUDE.update(set(r4.CBIS_R4_DROPPED) | _r4_selected(CBIS_DIR / "selection-r4.json", "patient_id"))
    r4.CBIS_R4_GROUPS[:] = CBIS_R5_GROUPS
    return r4.cbis_r4_breasts()


def cbis_fetch_r5() -> None:
    import tcia
    from external import CBIS_DIR
    chosen = []
    for breast in cbis_r5_breasts():
        for r in breast:
            full_pid, full_series = r["image file path"].split("/")[0], r["image file path"].split("/")[2]
            roi_pid, roi_series = r["ROI mask file path"].split("/")[0], r["ROI mask file path"].strip().split("/")[2]
            zf = tcia.download_series("CBIS-DDSM", full_pid, full_series)
            zr = tcia.download_series("CBIS-DDSM", roi_pid, roi_series)
            chosen.append({**r, "fullZip": str(zf.relative_to(RAW)), "roiZip": str(zr.relative_to(RAW))})
            print(r["patient_id"], r["left or right breast"], r["image view"], r["pathology"], flush=True)
    (CBIS_DIR / "selection-r5.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    fn = {"breast": breast_fetch_r5, "isles": isles_fetch_r5, "nih": nih_fetch_r5, "graz": graz_fetch_r5, "frac": frac_fetch_r5,
          "cbis": cbis_fetch_r5}.get(what)
    if not fn:
        raise SystemExit(__doc__)
    fn()
