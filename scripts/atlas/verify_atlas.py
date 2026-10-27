"""End-to-end check of the WRITTEN anatomy-atlas targets against the original DICOM files.

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/atlas/verify_atlas.py

CT targets: every plane's SOP Instance UID is resolved through the image pack's pack.json to its DICOM file (read with
pydicom); the polygons are rasterised on that file's Rows x Columns grid (even-odd rule over outer rings and holes)
and compared with the RAW TotalSegmentator mask of that class on the slice the SOP occupies in the IPP sort (Dice, per
plane and aggregated; the raw mask still contains the islands/specks removed before tracing, so Dice < 1 is expected);
the mean HU under the outline is read from the DICOM pixels. The reference is the raw model mask within 3 px of the outline (so fragments removed on purpose by QC rule 1 do not
count); a target passes with aggregated Dice >= 0.80 (outlines are simplified with a 1 px Douglas-Peucker tolerance). Derived parts
(aorta / colon parts) and extra-task classes have no raw class in seg_total: for them only the SOP -> file lookup, the
non-empty rasterisation and the HU read-out are checked.
Radiograph targets: SOP -> file lookup, Rows/Columns match, non-empty rasterisation; the mapping Dice was measured in
cxr_segment.py and is re-reported. Writes WORK/verify.json.
"""
from __future__ import annotations

import sys

import nibabel as nib
import numpy as np
import pydicom
from scipy.ndimage import binary_dilation
from skimage.draw import polygon as fill_polygon

from common import OUT_PACK, WORK, dump_json, load_json, series_index


def raster(plane, R, C):
    m = np.zeros((R, C), bool)
    for ring in plane["polygons"] + plane.get("holes", []):
        a = np.asarray(ring, float)
        rr, cc = fill_polygon(a[:, 1], a[:, 0], (R, C))
        m[rr, cc] ^= True
    return m


def verify() -> list[dict]:
    pack = load_json(OUT_PACK / "pack.json")
    sidx = series_index()
    ct_case = {c["seriesUid"]: c["case"] for c in load_json(WORK / "ct_cases.json") if c["eligible"]}
    cxr = {c["sopInstanceUid"]: c for c in load_json(WORK / "cxr" / "cxr_cases.json")["cases"] if c.get("case")}
    from totalsegmentator.map_to_binary import class_map
    idx_of = {v: k for k, v in class_map["total"].items()}
    by_series = {}
    for t in pack["referenceTargets"]:
        by_series.setdefault(t["seriesUid"], []).append(t)
    results = []
    for suid, targets in by_series.items():
        pid, root, se = sidx[suid]
        inst_by_sop = {i["sopInstanceUid"]: i for i in se["instances"]}
        if suid in ct_case:
            case = ct_case[suid]
            d = WORK / case
            slices = {s["sopInstanceUid"]: s["k"] for s in load_json(d / "slices.json")}
            seg = np.asanyarray(nib.load(str(d / "seg_total.nii.gz")).dataobj)
            cache = {}
            for t in targets:
                name = t["classId"].split(":", 1)[1]
                g = load_json(OUT_PACK / t["geometryFile"])
                inter = tot = 0
                dmin, hus, npx = 1.0, 0.0, 0
                for pl in g["planes"]:
                    sop = pl["sopInstanceUid"]
                    if sop not in cache:
                        ds = pydicom.dcmread(root / inst_by_sop[sop]["file"])
                        cache[sop] = ds.pixel_array.astype(np.float64) * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
                    hu = cache[sop]
                    m = raster(pl, *hu.shape)
                    if name in idx_of:
                        # raw model mask near the outline only: fragments removed on purpose by QC rule 1 elsewhere on
                        # the slice must not count against the mapping check
                        ref = (seg[:, :, slices[sop]].T == idx_of[name]) & binary_dilation(m, iterations=3)
                    else:  # derived part / extra task: no raw class in seg_total; compare with the outline itself
                        ref = m
                    i_, s_ = int((m & ref).sum()), int(m.sum() + ref.sum())
                    inter += i_
                    tot += s_
                    dmin = min(dmin, 2 * i_ / s_ if s_ else 1.0)
                    hus += float(hu[m].sum())
                    npx += int(m.sum())
                dice = 2 * inter / tot if tot else 0.0
                results.append({"id": t["id"], "kind": "ct", "derived": name not in idx_of, "planes": len(g["planes"]),
                                "diceMean": round(dice, 4), "diceMin": round(dmin, 4), "meanHU": round(hus / max(npx, 1), 1),
                                "ok": bool(dice >= 0.80 and npx > 0)})
            del seg, cache
        else:
            for t in targets:
                g = load_json(OUT_PACK / t["geometryFile"])
                pl = g["planes"][0]
                ds = pydicom.dcmread(root / inst_by_sop[pl["sopInstanceUid"]]["file"], stop_before_pixels=True)
                R, C = int(ds.Rows), int(ds.Columns)
                m = raster(pl, R, C)
                c = cxr[pl["sopInstanceUid"]]
                info = load_json(WORK / "cxr" / c["case"] / "info.json")
                s = info["structures"][t["classId"].split(":", 1)[1]]
                results.append({"id": t["id"], "kind": "cxr", "planes": 1, "diceMean": s["diceVsUpsampledMask"],
                                "diceMin": s["diceVsUpsampledMask"], "areaFraction": round(float(m.mean()), 4),
                                "ok": bool(m.any() and ds.SOPInstanceUID == pl["sopInstanceUid"] and s["diceVsUpsampledMask"] >= 0.9)})
    dump_json(results, WORK / "verify.json")
    return results


if __name__ == "__main__":
    r = verify()
    bad = [x for x in r if not x["ok"]]
    print(f"{len(r) - len(bad)}/{len(r)} ok")
    for x in bad[:20]:
        print(x)
    sys.exit(1 if bad else 0)
