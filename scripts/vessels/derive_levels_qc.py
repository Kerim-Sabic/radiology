"""Step 4: QC (contrast, coverage, laterality) and derivation of the five-vessel / aortic-arch slice intervals.

  python scripts/vessels/derive_levels_qc.py [--fast] [--png] [case ...]

Inputs: WORK/<case>/structures[_fast].json + masks (seg[_fast]/) + slices.json. Output: WORK/<case>/qc[_fast].json
(and with --png, WORK/<case>/qc_png/*.png overlays for visual spot checks; never shipped in the pack).

Rules (all on ORIGINAL axial slices; "present" = >= MIN_AREA_MM2 of mask after speck removal):
  * contrast: mean HU inside the aorta mask must be >= 150 (enhanced blood pool); otherwise the case is rejected.
  * laterality: for every pair in LATERALITY_PAIRS and every slice where both are present, the LPS x of the
    left structure's centroid must exceed the right one's (LPS +x = patient left). Any wrong slice fails the pair
    and both structures of the pair are dropped (conservative).
  * aortic arch top = the most superior slice carrying ANY aorta mask (after speck removal, no area threshold;
    conservative: a partial-volume cap of the arch counts). TotalSegmentator labels the arch branches as
    separate classes, so this is the first slice where the arch appears when scrolling caudally.
  * five-vessel slices = slices strictly ABOVE the arch top on which all five structures (both brachiocephalic
    veins, brachiocephalic trunk, left common carotid, left subclavian) are present (>= MIN_AREA_MM2 each) as
    separate cross-sections, i.e. five distinct, mutually exclusive labelled regions (TotalSegmentator labels
    never overlap) none of which is joined to the aorta (absent above the arch top by definition). Wall-to-wall
    contact between two of them (no visible fat plane, common at the arterial origins) is recorded in
    "contacts" but does not exclude a slice. The interval is the contiguous run of such slices nearest the arch.
  * coverage: the series must extend >= 15 mm above the arch top and contain >= 1 five-vessel slice.
  * aortic-arch interval (optional, only if robust): from the most superior slice with aorta >= MIN_AREA_MM2
    caudally, the slices on which the aorta forms a single major cross-section (at most one component
    >= 100 mm^2; small fragments at branch origins are ignored), ending before the first slice where it splits
    into ascending + descending parts (exactly two components each >= 100 mm^2); accepted only if at least
    one slice of the run spans the tracheal centroid in x (arch crossing the midline) and the run is <= 45 mm.
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

from common import (FIVE_VESSELS, LATERALITY_PAIRS, MIN_AREA_MM2, WORK, case_dir, dump_json, load_json)

CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
SEPARATION_PAIRS = [
    ("brachiocephalic_trunk", "common_carotid_artery_left"),
    ("brachiocephalic_trunk", "subclavian_artery_left"),
    ("common_carotid_artery_left", "subclavian_artery_left"),
    ("brachiocephalic_vein_left", "brachiocephalic_vein_right"),
]
ARCH_MAJOR_MM2 = 100.0
LEFT_SIDE = {"brachiocephalic_vein_left", "common_carotid_artery_left", "subclavian_artery_left"}
RIGHT_SIDE = {"brachiocephalic_vein_right", "common_carotid_artery_right", "subclavian_artery_right"}


def runs_of(ks):
    ks = sorted(ks)
    out, cur = [], []
    for k in ks:
        if cur and k != cur[-1] + 1:
            out.append(cur)
            cur = []
        cur.append(k)
    if cur:
        out.append(cur)
    return out


def process(case: str, fast: bool, png: bool) -> dict:
    d = case_dir(case)
    sfx = "_fast" if fast else ""
    st = load_json(d / f"structures{sfx}.json")["structures"]
    slices = load_json(d / "slices.json")
    elig = load_json(d / "eligibility.json")
    K = len(slices)
    proj = [s["proj"] for s in slices]
    pres = {c: {s["k"]: s for s in r.get("slices", []) if s["areaMm2"] >= MIN_AREA_MM2} for c, r in st.items()}
    qc = {"case": case, "fast": fast, "seriesUid": elig["seriesUid"], "subjectKey": elig["subjectKey"],
          "normal": elig["normal"], "sliceStepMm": elig["sliceStepMm"], "nSlices": K}

    # ---- contrast (measured) ----
    qc["meanHU"] = {c: (round(r["meanHU"], 1) if "meanHU" in r else None) for c, r in st.items()}
    aorta_hu = st.get("aorta", {}).get("meanHU")
    qc["contrastConfirmed"] = bool(aorta_hu is not None and aorta_hu >= 150)

    # ---- laterality ----
    lat, failed = [], set()
    for L, R in LATERALITY_PAIRS:
        shared = sorted(set(pres.get(L, {})) & set(pres.get(R, {})))
        margins = [pres[L][k]["centroidLps"][0] - pres[R][k]["centroidLps"][0] for k in shared]
        wrong = [k for k, m in zip(shared, margins) if m <= 0]
        lat.append({"left": L, "right": R, "sharedSlices": len(shared), "wrongSlices": wrong,
                    "minMarginMm": round(min(margins), 1) if margins else None,
                    "medianMarginMm": round(float(np.median(margins)), 1) if margins else None,
                    "pass": len(wrong) == 0})
        if wrong:
            failed |= {L, R}
    # informational: side of the tracheal centroid on shared slices
    mid = {}
    tr = pres.get("trachea", {})
    for c in sorted(LEFT_SIDE | RIGHT_SIDE):
        shared = sorted(set(pres.get(c, {})) & set(tr))
        if not shared:
            mid[c] = None
            continue
        sign = 1 if c in LEFT_SIDE else -1
        ok = sum(1 for k in shared if sign * (pres[c][k]["centroidLps"][0] - tr[k]["centroidLps"][0]) > 0)
        mid[c] = {"sharedSlices": len(shared), "onExpectedSideOfTrachea": ok}
    qc["laterality"] = lat
    qc["midlineInfo"] = mid
    qc["failedStructures"] = sorted(failed)

    # ---- arch top / coverage ----
    aorta_any = sorted(s["k"] for s in st.get("aorta", {}).get("slices", []))
    aorta_ks = sorted(pres.get("aorta", {}))
    if not aorta_ks:
        qc["coverage"] = {"ok": False, "reason": "no aorta segmented"}
        dump_json(qc, d / f"qc{sfx}.json")
        return qc
    arch_top = aorta_any[-1]
    qc["archTop"] = {"k": arch_top, "sop": slices[arch_top]["sopInstanceUid"], "proj": proj[arch_top],
                     "areaMm2": next(s["areaMm2"] for s in st["aorta"]["slices"] if s["k"] == arch_top),
                     "kWithAortaAtLeastMinArea": aorta_ks[-1]}

    # ---- five-vessel slices ----
    seg = d / f"seg{sfx}"
    masks = {}
    for c in FIVE_VESSELS:
        p = seg / f"{c}.nii.gz"
        masks[c] = (np.asanyarray(nib.load(str(p)).dataobj) > 0) if p.exists() else None
    cand, rejected, contacts = [], [], {}
    for k in range(arch_top + 1, K):
        missing = [c for c in FIVE_VESSELS if k not in pres.get(c, {}) or c in failed]
        if missing:
            rejected.append({"k": k, "proj": proj[k], "missing": missing})
            continue
        for a, b in SEPARATION_PAIRS:
            ma, mb = masks[a][:, :, k], masks[b][:, :, k]
            if (ndi.binary_dilation(ma, structure=CROSS) & mb).any():
                contacts.setdefault(k, []).append(f"{a}~{b}")
        cand.append(k)
    runs = runs_of(cand)
    chosen = runs[0] if runs else []
    top_margin = proj[K - 1] - proj[arch_top]
    qc["coverage"] = {"ok": bool(top_margin >= 15 and chosen), "mmAboveArchTop": round(top_margin, 1),
                      "seriesProjRange": [proj[0], proj[K - 1]]}
    qc["fiveVessel"] = {
        "qualifyingSlices": cand, "runs": runs, "chosenRun": chosen,
        "sopInstanceUids": [slices[k]["sopInstanceUid"] for k in chosen],
        "range": [min(proj[k] for k in chosen), max(proj[k] for k in chosen)] if chosen else None,
        "rejectedAboveArch": rejected,
        "contacts": {str(k): v for k, v in contacts.items()},
        "areasMm2": {c: [pres[c][k]["areaMm2"] for k in chosen] for c in FIVE_VESSELS} if chosen else None,
    }

    # ---- aortic arch interval (optional) ----
    arch = {"robust": False}
    run = []
    split = None
    for k in range(aorta_ks[-1], -1, -1):
        rec = pres["aorta"].get(k)
        if rec is None:
            break
        major = [a for a in rec["componentAreasMm2"] if a >= ARCH_MAJOR_MM2]
        if len(major) <= 1:
            run.append(k)
            continue
        split = {"k": k, "componentAreasMm2": major}
        break
    spans = []
    for k in run:
        if k in tr:
            x0, x1 = pres["aorta"][k]["xExtentLps"]
            spans.append(bool(x0 < tr[k]["centroidLps"][0] < x1))
    length = (proj[run[0]] - proj[run[-1]] + elig["sliceStepMm"]) if run else 0
    arch.update({"slices": sorted(run), "split": split, "spansTrachealMidline": spans, "lengthMm": round(length, 1)})
    if run and split and len(split["componentAreasMm2"]) == 2 and any(spans) and length <= 45:
        arch["robust"] = True
        arch["sopInstanceUids"] = [slices[k]["sopInstanceUid"] for k in sorted(run)]
        arch["range"] = [min(proj[k] for k in run), max(proj[k] for k in run)]
    qc["aorticArch"] = arch

    if png:
        render_pngs(case, sfx, chosen, arch.get("slices", []), slices)
    dump_json(qc, d / f"qc{sfx}.json")
    return qc


def render_pngs(case, sfx, five_ks, arch_ks, slices):
    from PIL import Image, ImageDraw
    d = case_dir(case)
    ct = np.asanyarray(nib.load(str(d / "ct.nii.gz")).dataobj)
    colours = {"brachiocephalic_vein_left": (0, 160, 255), "brachiocephalic_vein_right": (0, 255, 255),
               "brachiocephalic_trunk": (255, 60, 60), "common_carotid_artery_left": (255, 160, 0),
               "subclavian_artery_left": (255, 0, 255), "common_carotid_artery_right": (255, 255, 0),
               "subclavian_artery_right": (160, 255, 0), "aorta": (255, 255, 255), "superior_vena_cava": (0, 120, 255),
               "trachea": (120, 120, 120), "esophagus": (0, 200, 0)}
    contours = {c: load_json(p) for c in colours if (p := d / f"contours{sfx}" / f"{c}.json").exists()}
    out = d / f"qc_png{sfx}"
    out.mkdir(exist_ok=True)
    ks = sorted(set(five_ks) | set(arch_ks[:2]) | ({max(five_ks) + 1, min(five_ks) - 1} if five_ks else set()))
    for k in ks:
        if not (0 <= k < ct.shape[2]):
            continue
        img = np.clip((ct[:, :, k].T.astype(float) - (40 - 200)) / 400.0, 0, 1) * 255
        im = Image.fromarray(img.astype(np.uint8)).convert("RGB").resize((1024, 1024))
        dr = ImageDraw.Draw(im)
        sop = slices[k]["sopInstanceUid"]
        for c, g in contours.items():
            for pl in g["planes"]:
                if pl["sopInstanceUid"] != sop:
                    continue
                for poly in pl["polygons"]:
                    dr.line([((x + 0.5) * 2, (y + 0.5) * 2) for x, y in poly], fill=colours[c], width=2)
        tag = "five" if k in five_ks else ("arch" if k in arch_ks else "adj")
        dr.text((10, 10), f"{case} k={k} z={slices[k]['proj']:.1f} {tag}  (image left = patient right)", fill=(255, 255, 0))
        im.save(out / f"k{k:03d}_{tag}.png")


def main(argv):
    fast = "--fast" in argv
    png = "--png" in argv
    cases = [a for a in argv[1:] if not a.startswith("--")]
    if not cases:
        cases = [r["case"] for r in load_json(WORK / "eligibility.json") if r["eligible"]]
    for c in cases:
        q = process(c, fast, png)
        fv = q.get("fiveVessel", {})
        print(f"{c}: contrast={q['contrastConfirmed']} aortaHU={q['meanHU'].get('aorta')} coverage={q.get('coverage')} "
              f"failed={q['failedStructures']}")
        print(f"   archTop={q.get('archTop', {}).get('k')} five-vessel runs={fv.get('runs')} chosen={fv.get('chosenRun')} range={fv.get('range')}")
        print(f"   arch={ {k: q.get('aorticArch', {}).get(k) for k in ('robust', 'slices', 'split', 'spansTrachealMidline', 'lengthMm')} }")
        for l in q["laterality"]:
            print(f"   lat {l['left']:28s} > {l['right']:28s} shared={l['sharedSlices']:3d} wrong={l['wrongSlices']} minMargin={l['minMarginMm']}")


if __name__ == "__main__":
    main(sys.argv)
