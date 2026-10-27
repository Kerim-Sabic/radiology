"""Point-in-polygon check on specific slices of the PUBLISHED atlas (what the viewer's hover would report).

  python scripts/atlas/point_check.py <seriesUid> <sop:structure> [<sop:structure> ...]

For each "sop:structure" pair: lists every atlas outline present on that SOP, takes the area centroid of `structure`'s
outline on that SOP and reports every outline containing that point (even-odd rule over polygons and holes), smallest
area first - the viewer names the smallest outline under the cursor. Writes WORK/point_check.json.
"""
from __future__ import annotations

import sys

import numpy as np
from skimage.measure import points_in_poly

from common import OUT_PACK, WORK, dump_json, load_json


def area(rings):
    tot = 0.0
    for r in rings:
        a = np.asarray(r, float)
        tot += 0.5 * abs(np.dot(a[:, 0], np.roll(a[:, 1], -1)) - np.dot(a[:, 1], np.roll(a[:, 0], -1)))
    return tot


def contains(plane, pt):
    n = sum(bool(points_in_poly([pt], np.asarray(r, float))[0]) for r in plane["polygons"] + plane.get("holes", []))
    return n % 2 == 1


def main(argv):
    if argv[1] == "--work":  # check the scratch contours of one case before the pack is written
        import qc_rules as Q
        case, pairs = argv[2], [a.split(":", 1) for a in argv[3:]]
        files = sorted((WORK / case / "contours").glob("*.json"))
        targets = [{"id": f.stem, "classId": f"anatomy:{f.stem}", "label": Q.clean_label(f.stem)} for f in files]
        geo = {f.stem: load_json(f) for f in files}
    else:
        series, pairs = argv[1], [a.split(":", 1) for a in argv[2:]]
        pack = load_json(OUT_PACK / "pack.json")
        targets = [t for t in pack["referenceTargets"] if t["seriesUid"] == series]
        geo = {t["id"]: load_json(OUT_PACK / t["geometryFile"]) for t in targets}
    out = []
    for sop, structure in pairs:
        present = {}
        for t in targets:
            for pl in geo[t["id"]]["planes"]:
                if pl["sopInstanceUid"] == sop:
                    present[t["classId"]] = (t["label"], pl)
        rec = {"sop": sop, "structuresOnSlice": sorted(v[0] for v in present.values())}
        key = f"anatomy:{structure}"
        if key in present:
            pl = present[key][1]
            pts = np.concatenate([np.asarray(r, float)[:-1] for r in pl["polygons"]])
            big = max(pl["polygons"], key=lambda r: area([r]))
            a = np.asarray(big, float)[:-1]
            pt = a.mean(axis=0)
            if not contains(pl, pt):  # fall back to the vertex-mean of all rings
                pt = pts.mean(axis=0)
            hits = sorted(((area(p_["polygons"]), lbl) for lbl, p_ in present.values() if contains(p_, pt)))
            rec.update(point=[round(float(v), 1) for v in pt], pointFallsIn=[h[1] for h in hits],
                       hoverWouldShow=hits[0][1] if hits else None)
        else:
            rec["note"] = f"{structure} not present on this slice"
        out.append(rec)
        print(rec)
    dump_json(out, WORK / "point_check.json")


if __name__ == "__main__":
    main(sys.argv)
