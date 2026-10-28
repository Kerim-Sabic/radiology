"""Post-process the published vessel-drafts pack with the anatomy atlas's accuracy rules (audit 28 Oct 2026).

  python scripts/vessels/postprocess.py

Idempotent; edits public/packs/vessel-drafts/pack.json and its targets only:
  * trachea ends at the carina: the highest slice where the trachea outline is two airways (each >= 15 mm2, centres
    >= 10 mm apart) and every slice below it are removed (the whole-body trachea class runs into the main bronchi);
  * "(partially imaged)": an outline cut by the scan (full cross-section on the series' first or last slice: >= 20 mm2
    and >= 60 % of the next slice, or touching the image edge) gets the suffix, as in the atlas;
  * one name for the brachiocephalic trunk in every pack ("Brachiocephalic trunk (innominate artery)").
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "public" / "packs"
PACK = PACKS / "vessel-drafts"
NAMES = {"anatomy:brachiocephalic_trunk": "Brachiocephalic trunk (innominate artery)"}
SUFFIX = " (partially imaged)"


def area(ring) -> float:
    a = np.asarray(ring, float)
    return 0.5 * abs(float(np.dot(a[:, 0], np.roll(a[:, 1], -1)) - np.dot(a[:, 1], np.roll(a[:, 0], -1))))


def series_geometry() -> dict:
    out = {}
    for f in PACKS.glob("*/pack.json"):
        if f.parent.name == "vessel-drafts":
            continue
        for s in json.loads(f.read_text(encoding="utf-8")).get("series", []):
            g = s["geometry"]
            iop = np.asarray(g.get("iop") or [1, 0, 0, 0, 1, 0], float)
            n = np.cross(iop[:3], iop[3:])
            z = {i["sopInstanceUid"]: float(np.dot(n, i["ipp"])) for i in s["instances"] if i.get("ipp")}
            out[s["uid"]] = {"z": z, "ps": g["pixelSpacing"], "rows": g["rows"], "cols": g["columns"]}
    return out


def main() -> None:
    geo = series_geometry()
    manifest = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
    log = []
    for t in manifest["referenceTargets"]:
        if t.get("geometryType") != "contour_set" or t["seriesUid"] not in geo:
            continue
        sg = geo[t["seriesUid"]]
        mm2 = sg["ps"][0] * sg["ps"][1]
        f = PACK / t["geometryFile"]
        g = json.loads(f.read_text(encoding="utf-8"))
        planes = sorted(g["planes"], key=lambda pl: -sg["z"].get(pl["sopInstanceUid"], 0.0))  # head first
        if t["classId"] == "anatomy:trachea":
            for i, pl in enumerate(planes):
                big = [r for r in pl["polygons"] if area(r) * mm2 >= 15.0]
                if len(big) >= 2:
                    c = sorted(big, key=lambda r: -area(r))[:2]
                    (x1, y1), (x2, y2) = (np.asarray(r, float).mean(0) * [sg["ps"][1], sg["ps"][0]] for r in c)
                    if np.hypot(x1 - x2, y1 - y2) >= 10.0:
                        removed = len(planes) - i
                        planes = planes[:i]
                        log.append(f"{t['id']}: trachea cut at the carina ({removed} slice(s) below removed)")
                        break
            g["planes"] = planes
            f.write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")
        # cut by the scan edge?
        zs = sorted(sg["z"].values(), reverse=True)
        top, bottom = zs[0], zs[-1]
        by_z = {round(sg["z"][pl["sopInstanceUid"]], 3): sum(area(r) for r in pl["polygons"]) * mm2 for pl in planes}

        def full_at(edge, nxt):
            a, b = by_z.get(round(edge, 3), 0.0), by_z.get(round(nxt, 3), 0.0)
            return a >= 20.0 and b > 0 and a >= 0.6 * b

        edge_px = any(
            min(p[0] for p in r) <= 0 or min(p[1] for p in r) <= 0 or max(p[0] for p in r) >= sg["cols"] - 1 or max(p[1] for p in r) >= sg["rows"] - 1
            for pl in planes for r in pl["polygons"]
        )
        partial = bool(planes) and (full_at(top, zs[1]) or full_at(bottom, zs[-2]) or edge_px)
        label = NAMES.get(t["classId"], t["label"].replace(SUFFIX, ""))
        label = label + SUFFIX if partial else label
        if label != t["label"]:
            log.append(f"{t['id']}: '{t['label']}' -> '{label}'")
            t["label"] = label
    (PACK / "pack.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n".join(log) or "no changes")


if __name__ == "__main__":
    main()
