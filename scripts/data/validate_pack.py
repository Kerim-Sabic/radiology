"""Validate a built pack by re-reading every file, and write docs/data/<packId>-inventory.md.

  python scripts/data/validate_pack.py <packId>

Checks: pack.json against the app's zod contract (node + src/schema/content.ts, when node is
available); every instance file exists with the recorded bytes/sha256, parses, has the recorded
SOP/Series UID and transfer syntax, and its pixels decode to rows x columns (x frames); the stored
instance order equals the order re-derived from ImagePositionPatient projected on the IOP normal;
geometry fields agree with the headers; every target maps to existing SOPs/frames and lies within
image bounds (image_px) or on the referenced plane and inside the image (patient_lps_mm).
The inventory markdown is generated only from what was re-read here.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pydicom

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DOCS_DIR, PACKS_DIR, REPO, UID_NAMES, basis, load_json, patient_to_px, sha256_bytes  # noqa: E402

PLANE_TOL = 0.5


def zod_check(pack_dir: Path) -> tuple[bool | None, str]:
    node = shutil.which("node")
    if not node or not (REPO / "node_modules" / "zod").exists():
        return None, "zod check skipped (node or node_modules/zod not available)"
    idx = PACKS_DIR / "index.json"
    cmd = [node, "--experimental-strip-types", "--no-warnings", str(Path(__file__).parent / "zod_check.mjs"),
           str(pack_dir)] + ([str(idx)] if idx.exists() else [])
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, timeout=300)
    return r.returncode == 0, (r.stdout.strip() or r.stderr.strip())[:2000]


def fmt_bytes(n: int) -> str:
    return f"{n/1e6:.2f} MB" if n >= 1e5 else f"{n/1e3:.1f} kB"


def validate(pack_id: str) -> bool:
    pack_dir = PACKS_DIR / pack_id
    m = load_json(pack_dir / "pack.json")
    errors: list[str] = []
    warns: list[str] = []
    zok, zmsg = zod_check(pack_dir)
    if zok is False:
        errors.append(f"zod contract check failed: {zmsg}")
    elif zok is None:
        warns.append(zmsg)
    if m["packId"] != pack_id:
        errors.append(f"packId {m['packId']} != directory {pack_id}")
    subj_keys = {s["key"] for s in m["subjects"]}
    study_uids = {s["uid"] for s in m["studies"]}
    series_by_uid = {s["uid"]: s for s in m["series"]}
    referenced_files = set()
    file_info: dict[str, dict] = {}
    series_rows = []
    for s in m["series"]:
        if s["subjectKey"] not in subj_keys:
            errors.append(f"series {s['uid']} subjectKey not in subjects")
        if s["studyUid"] not in study_uids:
            errors.append(f"series {s['uid']} studyUid not in studies")
        g = s["geometry"]
        tss = Counter()
        ipps, iops, nums = [], [], []
        decoded_ok = 0
        total = 0
        rows_cols = set()
        photos = set()
        sops = []
        for inst in s["instances"]:
            p = pack_dir / inst["file"]
            referenced_files.add(p.resolve())
            if not p.exists():
                errors.append(f"missing file {inst['file']}")
                continue
            raw = p.read_bytes()
            total += len(raw)
            if len(raw) != inst["bytes"]:
                errors.append(f"{inst['file']}: bytes {len(raw)} != {inst['bytes']}")
            if sha256_bytes(raw) != inst["sha256"]:
                errors.append(f"{inst['file']}: sha256 mismatch")
            if not p.name.startswith(inst["sha256"][:16]):
                errors.append(f"{inst['file']}: filename is not the sha256 prefix")
            ds = pydicom.dcmread(io.BytesIO(raw))
            if str(ds.SOPInstanceUID) != inst["sopInstanceUid"]:
                errors.append(f"{inst['file']}: SOPInstanceUID mismatch")
            if str(ds.SeriesInstanceUID) != s["uid"]:
                errors.append(f"{inst['file']}: SeriesInstanceUID mismatch")
            if str(ds.StudyInstanceUID) != s["studyUid"]:
                errors.append(f"{inst['file']}: StudyInstanceUID mismatch")
            if str(ds.Modality) != s["modality"]:
                errors.append(f"{inst['file']}: Modality mismatch")
            ts = str(ds.file_meta.TransferSyntaxUID)
            tss[ts] += 1
            if ts not in s["encoding"]["transferSyntaxes"]:
                errors.append(f"{inst['file']}: transfer syntax {ts} not listed in encoding")
            try:
                a = ds.pixel_array
                fr = int(ds.get("NumberOfFrames") or 1)
                exp = (int(ds.Rows), int(ds.Columns)) if fr == 1 else (fr, int(ds.Rows), int(ds.Columns))
                if a.shape[: len(exp)] != exp:
                    errors.append(f"{inst['file']}: decoded shape {a.shape} != {exp}")
                elif fr != inst["frames"]:
                    errors.append(f"{inst['file']}: frames {fr} != {inst['frames']}")
                else:
                    decoded_ok += 1
            except Exception as e:  # noqa: BLE001
                errors.append(f"{inst['file']}: pixel decode failed: {type(e).__name__}: {e}")
            rows_cols.add((int(ds.Rows), int(ds.Columns)))
            photos.add(str(ds.PhotometricInterpretation))
            ipp = ds.get("ImagePositionPatient")
            ipps.append([float(x) for x in ipp] if ipp is not None else None)
            iop = ds.get("ImageOrientationPatient")
            iops.append([float(x) for x in iop] if iop is not None else None)
            nums.append(int(ds.InstanceNumber) if ds.get("InstanceNumber") not in (None, "") else None)
            sops.append(str(ds.SOPInstanceUID))
            if inst["ipp"] is not None and ipp is not None and np.abs(np.asarray(inst["ipp"]) - np.asarray(ipp, float)).max() > 1e-3:
                errors.append(f"{inst['file']}: ipp in manifest differs from header")
            file_info[inst["sopInstanceUid"]] = {"rows": int(ds.Rows), "cols": int(ds.Columns),
                                                 "frames": int(ds.get("NumberOfFrames") or 1),
                                                 "ipp": ipps[-1], "iop": iops[-1],
                                                 "ps": ([float(x) for x in ds.PixelSpacing] if "PixelSpacing" in ds else None)}
        if total != s["bytes"]:
            errors.append(f"series {s['uid']}: bytes {total} != recorded {s['bytes']}")
        if rows_cols and rows_cols != {(g["rows"], g["columns"])}:
            if len(rows_cols) > 1 and "mixed matrix size within series" in g["volumeIssues"] and (g["rows"], g["columns"]) in rows_cols:
                warns.append(f"series {s['uid']}: instances have different matrix sizes {sorted(rows_cols)} (declared in volumeIssues; "
                             "geometry rows/columns describe the first instance)")
            else:
                errors.append(f"series {s['uid']}: rows/cols {rows_cols} != geometry")
        if photos and photos != {g["photometric"]}:
            errors.append(f"series {s['uid']}: photometric {photos} != geometry {g['photometric']}")
        # re-derive order
        order_ok = None
        if all(x is not None for x in ipps) and all(x is not None for x in iops) and ipps:
            n = basis(iops[0])[2]
            proj = [float(np.asarray(x) @ n) for x in ipps]
            order_ok = all(proj[i] <= proj[i + 1] + 1e-6 for i in range(len(proj) - 1))
            if not order_ok:
                errors.append(f"series {s['uid']}: instance order is not ascending along the IOP normal")
            if len(proj) >= 2:
                d = np.diff(proj)
                med = float(np.median(d))
                if g["sliceSpacing"] is not None and abs(med - g["sliceSpacing"]) > 1e-3:
                    errors.append(f"series {s['uid']}: re-derived slice spacing {med:.4f} != {g['sliceSpacing']}")
        elif len(s["instances"]) > 1:
            numbers_ok = all(a is None or b is None or a <= b for a, b in zip(nums, nums[1:]))
            order_ok = numbers_ok
            if not numbers_ok:
                errors.append(f"series {s['uid']}: projection images not in InstanceNumber order")
        thumb = s.get("thumbnail")
        if thumb:
            referenced_files.add((pack_dir / thumb).resolve())
            if not (pack_dir / thumb).exists():
                errors.append(f"missing thumbnail {thumb}")
        if g["hu"] and s["modality"] != "CT":
            errors.append(f"series {s['uid']}: hu=true on {s['modality']}")
        if s["modality"] in ("DX", "CR") and g["spacingCalibrated"] and g["pixelSpacingSource"] != "PixelSpacing":
            errors.append(f"series {s['uid']}: projection spacing calibrated without PixelSpacing")
        series_rows.append({"s": s, "tss": tss, "decoded": decoded_ok, "orderOk": order_ok, "bytes": total})
    # targets
    target_rows = []
    for t in m["referenceTargets"]:
        p = pack_dir / t["geometryFile"]
        referenced_files.add(p.resolve())
        if t["seriesUid"] not in series_by_uid:
            errors.append(f"target {t['id']}: series not in pack")
            continue
        s = series_by_uid[t["seriesUid"]]
        sop_frames = {i["sopInstanceUid"]: i["frames"] for i in s["instances"]}
        if not p.exists():
            errors.append(f"target {t['id']}: missing {t['geometryFile']}")
            continue
        geo = load_json(p)
        if geo["geometryType"] != t["geometryType"]:
            errors.append(f"target {t['id']}: geometryType mismatch")
        npts = 0
        maxoff = 0.0
        oob = 0
        readers = set()
        planes = geo.get("planes", [])
        for pl in planes:
            sop = pl["sopInstanceUid"]
            if sop not in sop_frames:
                errors.append(f"target {t['id']}: SOP {sop} not in series")
                continue
            if pl["frame"] > sop_frames[sop]:
                errors.append(f"target {t['id']}: frame {pl['frame']} > {sop_frames[sop]}")
            fi = file_info[sop]
            if pl.get("reader"):
                readers.add(pl["reader"])
            for ring in pl["polygons"] + pl.get("holes", []):
                if len(ring) < 3:
                    errors.append(f"target {t['id']}: ring with <3 points")
                for pt in ring:
                    npts += 1
                    if geo["space"] == "image_px":
                        c, r = pt
                    else:
                        c, r, off = patient_to_px(pt, fi["ipp"], fi["iop"], fi["ps"])
                        maxoff = max(maxoff, abs(off))
                    if not (-0.5 <= c <= fi["cols"] - 0.5 and -0.5 <= r <= fi["rows"] - 0.5):
                        oob += 1
        if geo["geometryType"] == "image_label":
            for sop in geo.get("sopInstanceUids", []):
                if sop not in sop_frames:
                    errors.append(f"target {t['id']}: image_label SOP {sop} not in series")
            if not geo.get("sopInstanceUids") or not geo.get("labels"):
                errors.append(f"target {t['id']}: image_label without SOPs or labels")
            target_rows.append({"t": t, "space": "n/a", "planes": len(geo.get("sopInstanceUids", [])), "points": 0,
                                "maxOff": 0.0, "readers": [], "bytes": p.stat().st_size})
            continue
        if maxoff >= PLANE_TOL:
            errors.append(f"target {t['id']}: point {maxoff:.3f} mm off its referenced plane")
        if oob:
            errors.append(f"target {t['id']}: {oob} point(s) outside image bounds")
        if not planes:
            errors.append(f"target {t['id']}: no planes")
        target_rows.append({"t": t, "space": geo.get("space"), "planes": len(planes), "points": npts,
                            "maxOff": maxoff, "readers": sorted(readers), "bytes": p.stat().st_size})
    for l in m["spatialLinks"]:
        for k in ("seriesA", "seriesB"):
            if l[k] not in series_by_uid:
                errors.append(f"link {l['id']}: {k} not in pack")
        if l["kind"] in ("independent", "same_volume", "common_frame"):
            a, b = series_by_uid.get(l["seriesA"]), series_by_uid.get(l["seriesB"])
            if a and b and a["subjectKey"] != b["subjectKey"]:
                errors.append(f"link {l['id']}: links different subjects")
    # orphans
    for p in pack_dir.rglob("*"):
        if p.is_file() and p.name not in ("pack.json", "lessons.json") and p.resolve() not in referenced_files:
            errors.append(f"orphan file not referenced by pack.json: {p.relative_to(pack_dir)}")
    sizes = defaultdict(int)
    for p in pack_dir.rglob("*"):
        if p.is_file():
            top = p.relative_to(pack_dir).parts[0]
            sizes[top if len(p.relative_to(pack_dir).parts) > 1 else p.name] += p.stat().st_size
    ok = not errors
    write_inventory(pack_id, m, series_rows, target_rows, sizes, errors, warns, zok, zmsg)
    print(f"[validate {pack_id}] {'PASS' if ok else 'FAIL'}: {len(m['series'])} series, "
          f"{sum(len(s['instances']) for s in m['series'])} instances, {len(m['referenceTargets'])} targets, "
          f"{len(errors)} error(s), {len(warns)} warning(s)")
    for e in errors[:50]:
        print("  ERROR", e)
    for w in warns:
        print("  WARN", w)
    return ok


def write_inventory(pack_id, m, series_rows, target_rows, sizes, errors, warns, zok, zmsg):
    short = {r["s"]["uid"]: r["s"]["instances"][0]["file"].split("/")[1] if r["s"]["instances"] else "?" for r in series_rows}
    total = sum(sizes.values())
    L = []
    L.append(f"# Pack inventory: `{pack_id}`\n")
    L.append("_Generated by `scripts/data/validate_pack.py` from the files on disk (re-read, re-hashed, decoded); do not edit by hand._\n")
    L.append(f"- Title: {m['title']}")
    L.append(f"- Version {m['version']}, pack.json generatedAt {m['generatedAt']}; validated {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
    L.append(f"- Validation: **{'PASS' if not errors else 'FAIL'}** ({len(errors)} error(s), {len(warns)} warning(s)); zod contract check: "
             f"{'PASS' if zok else ('skipped' if zok is None else 'FAIL')}")
    n_inst = sum(len(r["s"]["instances"]) for r in series_rows)
    L.append(f"- Counts: {len(m['subjects'])} subjects, {len(m['studies'])} studies, {len(series_rows)} series, {n_inst} instances, "
             f"{len(target_rows)} reference targets, {len(m['spatialLinks'])} spatial links")
    L.append(f"- Bytes on disk: total {fmt_bytes(total)} — " + ", ".join(f"{k} {fmt_bytes(v)}" for k, v in sorted(sizes.items())))
    tsc = Counter()
    for r in series_rows:
        tsc.update(r["tss"])
    L.append("- Transfer syntaxes (instances): " + ", ".join(f"{UID_NAMES.get(k, k)} `{k}` x{v}" for k, v in sorted(tsc.items())))
    L.append("")
    L.append("## Sources\n")
    L.append("| id | name | DOI | license |")
    L.append("|---|---|---|---|")
    for s in m["sources"]:
        L.append(f"| `{s['id']}` | {s['name']} | {s.get('doi') or ''} | {s['license']} |")
    L.append("\n## Subjects\n")
    L.append("| subject key | sex | age at first study | studies | holdout group |")
    L.append("|---|---|---|---|---|")
    for s in m["subjects"]:
        L.append(f"| `{s['key']}` | {s.get('sex') or ''} | {s.get('ageAtFirstStudy') or ''} | {len(s['studyUids'])} | `{s['holdoutGroup']}` |")
    L.append("\n## Studies\n")
    L.append("| study UID (tail) | subject | description | date (as distributed) | shifted | rel. days | modalities | series |")
    L.append("|---|---|---|---|---|---|---|---|")
    for s in m["studies"]:
        L.append(f"| …{s['uid'][-16:]} | `{s['subjectKey'].split(':', 2)[2]}` | {s['description']} | {s['date'] or ''} | {s['dateShifted']} | "
                 f"{'' if s['relativeDays'] is None else s['relativeDays']} | {', '.join(s['modalities'])} | {len(s['seriesUids'])} |")
    L.append("\n## Series\n")
    L.append("| short id | subject | modality | role | description | instances (decoded) | matrix | pixel spacing mm (source, calibrated) | slice spacing mm (uniform) | volume eligible | photometric / bits | transfer syntax(es) read from files | re-encoded from | bytes |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in series_rows:
        s, g = r["s"], r["s"]["geometry"]
        ps = "" if not g["pixelSpacing"] else f"{g['pixelSpacing'][0]:.4g} x {g['pixelSpacing'][1]:.4g}"
        L.append(f"| `{short[s['uid']]}` | `{s['subjectKey'].split(':', 2)[2]}` | {s['modality']} | {s['role']} | {s['description']} | "
                 f"{len(s['instances'])} ({r['decoded']}) | {g['columns']}x{g['rows']} | {ps} ({g['pixelSpacingSource']}, {g['spacingCalibrated']}) | "
                 f"{'' if g['sliceSpacing'] is None else g['sliceSpacing']} ({g['sliceSpacingUniform']}) | {g['volumeEligible']}"
                 f"{'' if not g['volumeIssues'] else ' — ' + '; '.join(g['volumeIssues'])} | {g['photometric']} / {g['bitsStored']}"
                 f"{'s' if g['pixelRepresentation'] else 'u'} | " + ", ".join(f"{UID_NAMES.get(k, k)}" for k in r["tss"]) +
                 f" | {', '.join(UID_NAMES.get(k, k) for k in (s['encoding']['reencodedFrom'] or [])) or '—'} | {fmt_bytes(r['bytes'])} |")
    L.append("\nSeries UIDs: " + "; ".join(f"`{short[r['s']['uid']]}` = {r['s']['uid']}" for r in series_rows))
    if m["spatialLinks"]:
        L.append("\n## Spatial links\n")
        L.append("| kind | series A | series B | evidence |")
        L.append("|---|---|---|---|")
        for l in m["spatialLinks"]:
            L.append(f"| {l['kind']} | `{short.get(l['seriesA'], l['seriesA'])}` | `{short.get(l['seriesB'], l['seriesB'])}` | {l['evidence']} |")
    if target_rows:
        L.append("\n## Reference targets\n")
        L.append("| id | class | series | type / space | planes | points | readers | provenance | completeness | max off-plane mm |")
        L.append("|---|---|---|---|---|---|---|---|---|---|")
        for r in target_rows:
            t = r["t"]
            off = "" if r["space"] != "patient_lps_mm" else f"{r['maxOff']:.4f}"
            L.append(f"| `{t['id']}` | `{t['classId']}` | `{short.get(t['seriesUid'], '?')}` | {t['geometryType']} / {r['space']} | {r['planes']} | "
                     f"{r['points']} | {len(r['readers']) or ''} | {t['provenance']} | {t['completeness']} | {off} |")
        L.append("\nTarget sources: " + "; ".join(sorted({r['t']['provenanceDetail']['source'] for r in target_rows})))
    L.append("\n## Validation messages\n")
    if not errors and not warns:
        L.append("None.")
    for e in errors:
        L.append(f"- ERROR: {e}")
    for w in warns:
        L.append(f"- WARN: {w}")
    if zmsg:
        L.append(f"\nzod check output: `{zmsg[:500]}`")
    out = DOCS_DIR / f"{pack_id}-inventory.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    raise SystemExit(0 if validate(sys.argv[1]) else 1)
