"""Report how much of the AI pulmonary trunk / pulmonary arteries lies inside EXPERT heart contours (LCTSC RT structures,
Pediatric-CT-SEG expert masks). Expert contours are never modified; on hover the smaller trunk outline wins.

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/atlas/expert_heart_overlap.py

For every source_manual target with classId anatomy:heart in the image packs: the expert polygons of each SOP are
converted to image_px (patient_lps_mm -> column/row with the instance's IPP/IOP/PixelSpacing from pack.json) and
rasterised; the published AI outlines (WORK/<case>/contours/pulmonary_*.json) are rasterised on the same SOPs, and the
area of each part inside the expert heart is summed. Writes WORK/expert_heart_overlap.json.
"""
from __future__ import annotations

import numpy as np
from skimage.draw import polygon as fill_polygon

from common import WORK, dump_json, load_json, source_manifests

PARTS = ("pulmonary_trunk", "pulmonary_artery_right", "pulmonary_artery_left")


def raster(rings, R, C):
    m = np.zeros((R, C), bool)
    for ring in rings:
        a = np.asarray(ring, float)
        rr, cc = fill_polygon(a[:, 1], a[:, 0], (R, C))
        m[rr, cc] ^= True
    return m


def main():
    cases = {c["seriesUid"]: c["case"] for c in load_json(WORK / "ct_cases.json") if c["eligible"]}
    results = []
    for pid, root, m in source_manifests():
        series = {s["uid"]: s for s in m["series"]}
        for t in m["referenceTargets"]:
            if t["provenance"] != "source_manual" or t["classId"] != "anatomy:heart" or t["seriesUid"] not in cases:
                continue
            se = series[t["seriesUid"]]
            g = load_json(root / t["geometryFile"])
            R, C = se["geometry"]["rows"], se["geometry"]["columns"]
            ps = se["geometry"]["pixelSpacing"]
            iop = np.array(se["geometry"]["iop"], float)
            X, Y = iop[:3], iop[3:]
            ipp = {i["sopInstanceUid"]: np.array(i["ipp"], float) for i in se["instances"]}
            expert = {}
            for pl in g["planes"]:
                rings = []
                for ring in pl["polygons"]:
                    a = np.asarray(ring, float)
                    if g["space"] == "patient_lps_mm":
                        d = a - ipp[pl["sopInstanceUid"]]
                        a = np.column_stack([d @ X / ps[1], d @ Y / ps[0]])
                    rings.append(a)
                expert[pl["sopInstanceUid"]] = raster(rings, R, C)
            case = cases[t["seriesUid"]]
            row = {"case": case, "pack": pid, "expertTarget": t["id"], "parts": {}}
            for part in PARTS:
                p = WORK / case / "contours" / f"{part}.json"
                if not p.exists():
                    row["parts"][part] = None
                    continue
                inside = total = 0
                for pl in load_json(p)["planes"]:
                    a = raster(pl["polygons"], R, C)
                    total += int(a.sum())
                    if pl["sopInstanceUid"] in expert:
                        inside += int((a & expert[pl["sopInstanceUid"]]).sum())
                row["parts"][part] = {"areaMm2": round(total * ps[0] * ps[1]), "insideExpertHeartMm2": round(inside * ps[0] * ps[1]),
                                      "fractionInside": round(inside / total, 3) if total else None}
            results.append(row)
            print(case, {k: (v["fractionInside"] if v else None) for k, v in row["parts"].items()})
    dump_json(results, WORK / "expert_heart_overlap.json")


if __name__ == "__main__":
    main()
