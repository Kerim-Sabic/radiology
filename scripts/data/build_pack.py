"""Build one learning pack from raw TCIA downloads.

  python scripts/data/build_pack.py <packId>

Reads scripts/data/selection.json, the raw zips under RADIOLOGY_RAW_DIR (fetched by
`packs.py fetch <packId>`), and writes public/packs/<packId>/{pack.json, dicom/, thumbs/,
targets/} plus docs/data/<packId>-build-qc.json. lessons.json is never touched.
"""
from __future__ import annotations

import datetime as dt
import io
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pydicom

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tcia  # noqa: E402
from annotations import (SeriesGeom, convert_cbis_mask, convert_lidc, convert_ricord_labels,  # noqa: E402
                         convert_rtstruct, convert_seg)
from common import (DOCS_DIR, PACKS_DIR, SELECTION, dicom_date, dump_json, load_json,  # noqa: E402
                    slug)
from inventory import build_series, encode_and_place, load_items, thumbnail_png  # noqa: E402

SCHEMA_VERSION = 1
LIDC_XML_URL = "https://www.cancerimagingarchive.net/wp-content/uploads/LIDC-XML-only.zip"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def lidc_xml_path() -> Path:
    return tcia.RAW_ROOT / "LIDC-IDRI" / "_annotations" / "LIDC-XML-only.zip"


def subject_key(src: dict, patient_id: str) -> str:
    return f"tcia:{src['collection']}:{patient_id}"


def raw_zip(collection: str, patient_id: str, uid: str) -> tuple[Path, dict]:
    zp, mp = tcia.raw_paths(collection, patient_id, uid)
    if not zp.exists() or not mp.exists():
        raise SystemExit(f"missing raw download for {collection}/{patient_id}/{uid}; run: python scripts/data/packs.py fetch <packId>")
    return zp, load_json(mp)


def source_ref(sid: str, src: dict, license_rows: list[dict]) -> dict:
    lic = sorted({(r.get("LicenseName") or "", r.get("LicenseURI") or "") for r in license_rows if r})
    if len(lic) > 1:
        log(f"  WARNING: multiple licenses for {sid}: {lic}")
    lic_name, lic_url = lic[0] if lic else (src.get("license", "unknown"), src.get("licenseUrl"))
    return {
        "id": sid,
        "name": src["name"],
        "url": src.get("url") or f"https://doi.org/{src['doi']}",
        "doi": src.get("doi"),
        "license": lic_name or src.get("license", "unknown"),
        "licenseUrl": lic_url or src.get("licenseUrl"),
        "citation": src["citation"],
        "accessNote": src.get("accessNote", "Retrieved anonymously from the TCIA NBIA REST API v1 (getSeries/getImage) at "
                                            "services.cancerimagingarchive.net/nbia-api/services/v1; license as reported by the API (LicenseName)."),
    }


def date_policy(src: dict, datasets: list[pydicom.Dataset]) -> tuple[str, bool | None, str]:
    """Return (dateShifted, consistentWithinPatient, evidence) from DICOM de-identification codes,
    falling back to the source-level policy in selection.json."""
    codes = set()
    for ds in datasets:
        for it in ds.get("DeidentificationMethodCodeSequence", []):
            codes.add(str(it.get("CodeValue")))
    pol = src.get("dates", {})
    if pol.get("override"):
        return pol["shifted"], pol.get("consistent"), pol["note"]
    if "113107" in codes:
        return "yes", True, ("DICOM DeidentificationMethodCodeSequence includes 113107 'Retain Longitudinal Temporal Information "
                             "Modified Dates Option': dates were shifted during de-identification with intervals preserved.")
    if "113106" in codes:
        return "no", True, "DICOM DeidentificationMethodCodeSequence includes 113106 'Retain Longitudinal Temporal Information Full Dates Option'."
    return pol.get("shifted", "unknown"), pol.get("consistent"), pol.get("note", "No de-identification date option recorded in the DICOM headers.")


def build(pack_id: str) -> dict:
    sel = load_json(SELECTION)
    cfg = sel["packs"][pack_id]
    sources = sel["sources"]
    out_dir = PACKS_DIR / pack_id
    t0 = dt.datetime.now(dt.timezone.utc)
    series_results = []  # SeriesResult
    annotations = []  # (subject entry, series entry)
    subj_datasets = defaultdict(list)
    license_rows = defaultdict(list)
    subjects_cfg = cfg["subjects"]
    for subj in subjects_cfg:
        src = sources[subj["sourceId"]]
        coll = src["collection"]
        pid = subj["patientId"]
        skey = subject_key(src, pid)
        for se in subj["series"]:
            if se["kind"] in ("rtstruct", "seg", "cbis_mask"):
                annotations.append((subj, se))
                zp, meta = raw_zip(coll, se.get("maskPatientId", pid), se["uid"])
                license_rows[se.get("sourceId", subj["sourceId"])].append(meta.get("seriesRow"))
                continue
            if se["kind"] in ("lidc_xml", "ricord_labels"):
                annotations.append((subj, se))
                continue
            zp, meta = raw_zip(coll, pid, se["uid"])
            license_rows[subj["sourceId"]].append(meta.get("seriesRow"))
            log(f"[{pack_id}] {skey} series ...{se['uid'][-12:]} ({se.get('note', '')})")
            items = load_items(tcia.iter_zip_dicom_bytes(zp))
            if se.get("sops"):
                keep = set(se["sops"])
                items = [it for it in items if str(it.ds.SOPInstanceUID) in keep]
            sr = build_series(items, se, skey)
            encode_and_place(sr, se.get("encode", "jpegls"))
            sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
            sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
            if se.get("displayNote"):
                sr.record["displayNote"] = se["displayNote"]
            elif sr.record["geometry"]["photometric"] == "MONOCHROME1":
                sr.record["displayNote"] = ("MONOCHROME1: the lowest stored value is displayed WHITE. Kept in its original transfer "
                                            "syntax as a rendering fixture; the viewer must honour PhotometricInterpretation.")
            g = sr.record["geometry"]
            if (sr.record["modality"] in ("DX", "CR", "MG") or sr.record["role"] == "scout") and "PatientOrientation" not in sr.record["acquisition"]:
                sr.record["displayNote"] = (sr.record.get("displayNote", "") + " PatientOrientation is absent from the header: "
                                            "no orientation letters can be derived from the file.").strip()
            if "mixed matrix size within series" in g["volumeIssues"]:
                dims = sorted({(int(it.ds.Columns), int(it.ds.Rows)) for it in sr.sorted_items})
                sr.record["displayNote"] = (sr.record.get("displayNote", "") + f" Instances differ in matrix size (columns x rows: {dims}); "
                                            "geometry.rows/columns describe the first instance only.").strip()
            if str(sr.record["acquisition"].get("PatientOrientation", "")).startswith("varies"):
                sr.record["displayNote"] = (sr.record.get("displayNote", "") + " PatientOrientation differs between the instances of this "
                                            "series (e.g. frontal vs lateral view): read it per instance from each DICOM header.").strip()
            if sr.record["modality"] in ("DX", "CR") and not g["spacingCalibrated"]:
                extra = (f" Spacing is {g['pixelSpacingSource']} {g['pixelSpacing']} mm without PixelSpacingCalibrationType: "
                         "distances are at the detector plane (not corrected for magnification) and must not be presented as calibrated patient measurements.")
                sr.record["displayNote"] = (sr.record.get("displayNote", "") + extra).strip()
            series_results.append(sr)
            subj_datasets[skey].append(sr.sorted_items[0].ds)
            # release pixel caches we no longer need (keep datasets for thumbnails/geometry)
    geoms = {sr.uid: SeriesGeom(sr) for sr in series_results}
    # ------------------------------------------------ annotations
    targets, target_geoms, ann_qc = [], [], []
    for subj, se in annotations:
        src = sources[subj["sourceId"]]
        asrc_id = se.get("sourceId", subj["sourceId"])
        asrc = sources[asrc_id]
        ctx = {
            "subjectSlug": subj.get("slug") or slug(subj["patientId"]),
            "sourceLabel": f"{asrc_id} ({asrc['name']}, doi:{asrc.get('doi')})",
            "teachingNote": se.get("teachingNote", ""),
            "labelSuffix": se.get("labelSuffix"),
            "unassessedNote": se.get("unassessedNote"),
            "roiClass": {k: tuple(v) for k, v in se.get("roiClass", {}).items()},
            "segClass": {k: tuple(v) for k, v in se.get("segClass", {}).items()},
            "defaultRoiPrefix": se.get("defaultRoiPrefix", "structure"),
            "idPrefix": se.get("idPrefix", ""),
            "referencedSeriesUid": se.get("referencedSeriesUid"),
            "layer": se.get("layer"),
            "roiCategory": se.get("roiCategory"),
            "teachingNoteExtra": se.get("teachingNoteExtra", ""),
        }
        ctx = {k: v for k, v in ctx.items() if v is not None}
        if se["kind"] == "ricord_labels":
            zp_ = tcia.RAW_ROOT / src["collection"] / "_metadata" / se["file"]["name"]
            t, g, q = convert_ricord_labels(zp_, load_json(zp_.with_suffix(".json")), geoms, se["studyUid"], ctx)
            q["kind"] = "ricord_labels"
        elif se["kind"] == "cbis_mask":
            import csv
            cpath = tcia.RAW_ROOT / src["collection"] / "_metadata" / se["csv"]["file"]
            cmeta = load_json(cpath.with_suffix(".json"))
            with open(cpath, newline="", encoding="utf-8") as fh:
                rows = list(csv.DictReader(fh))
            want = se["csv"]
            row = [r for r in rows if r["patient_id"] == want["patient_id"] and r["left or right breast"] == want["side"]
                   and r["image view"] == want["view"] and r["abnormality id"] == str(want["abnormalityId"])]
            if len(row) != 1:
                raise SystemExit(f"CBIS CSV row not unique: {len(row)}")
            zp, meta = raw_zip(src["collection"], se["maskPatientId"], se["uid"])
            mask_items = [(n, pydicom.dcmread(io.BytesIO(b))) for n, b in tcia.iter_zip_dicom_bytes(zp)]
            t, g, q = convert_cbis_mask(mask_items, geoms, se["imageSeriesUid"], row[0], {"file": se["csv"]["file"], **cmeta},
                                        se["uid"], ctx)
            q["kind"] = "cbis_mask"
        elif se["kind"] == "lidc_xml":
            xp = lidc_xml_path()
            xmeta = load_json(xp.with_suffix(".json"))
            t, g, q = convert_lidc(xp, xmeta, geoms, se["seriesUid"], ctx)
            q["kind"] = "lidc_xml"
        else:
            zp, meta = raw_zip(src["collection"], subj["patientId"], se["uid"])
            raws = list(tcia.iter_zip_dicom_bytes(zp))
            assert len(raws) == 1, f"expected one {se['kind']} object, got {len(raws)}"
            if se["kind"] == "rtstruct":
                t, g, q = convert_rtstruct(raws[0][1], geoms, ctx)
            else:
                t, g, q = convert_seg(raws[0][1], geoms, ctx)
            q["kind"] = se["kind"]
            q["annotationSeriesUid"] = se["uid"]
            if se.get("onlySegments"):
                keep = set(se["onlySegments"])
                pairs = [(a, b) for a, b in zip(t, g) if a["classId"] in keep]
                t, g = [p[0] for p in pairs], [p[1] for p in pairs]
        for a, b in zip(t, g):
            if not (b.get("planes") if b["geometryType"] == "contour_set" else (b.get("sopInstanceUids") and b.get("labels"))):
                log(f"  WARNING: target {a['id']} has no planes; dropped")
                q.setdefault("droppedEmpty", []).append(a["id"])
                continue
            targets.append(a)
            target_geoms.append(b)
        q["subject"] = subject_key(src, subj["patientId"])
        ann_qc.append(q)
    ids = [t["id"] for t in targets]
    assert len(ids) == len(set(ids)), f"duplicate target ids: {ids}"
    # ------------------------------------------------ studies & subjects
    studies = {}
    for sr in series_results:
        ds = sr.sorted_items[0].ds
        st = studies.setdefault(sr.record["studyUid"], {
            "uid": sr.record["studyUid"], "subjectKey": sr.record["subjectKey"],
            "description": str(ds.get("StudyDescription", "") or ""),
            "modalities": [], "date": dicom_date(ds.get("StudyDate")),
            "dateShifted": "unknown", "relativeDays": None, "timingNote": "", "seriesUids": [],
            "_ds": [],
        })
        if sr.record["modality"] not in st["modalities"]:
            st["modalities"].append(sr.record["modality"])
        st["seriesUids"].append(sr.uid)
        st["_ds"].append(ds)
    subj_out = []
    for subj in subjects_cfg:
        src = sources[subj["sourceId"]]
        skey = subject_key(src, subj["patientId"])
        sts = sorted([s for s in studies.values() if s["subjectKey"] == skey], key=lambda s: (s["date"] or "", s["uid"]))
        if not sts:
            continue
        pols = [date_policy(src, s["_ds"]) for s in sts]
        consistent = all(p[1] for p in pols) and all(s["date"] for s in sts)
        d0 = min(dt.date.fromisoformat(s["date"]) for s in sts) if consistent else None
        for s, (shifted, cons, ev) in zip(sts, pols):
            s["dateShifted"] = shifted
            if consistent and d0 is not None:
                s["relativeDays"] = (dt.date.fromisoformat(s["date"]) - d0).days
                s["timingNote"] = (f"{ev} Day {s['relativeDays']} relative to this subject's earliest study in this pack; "
                                   "absolute dates are not real calendar dates.")
            else:
                s["timingNote"] = ev + (" Relative timing between this subject's studies cannot be established from the distributed dates."
                                        if len(sts) > 1 else "")
        first = sts[0]["_ds"][0]
        subj_out.append({
            "key": skey,
            "sourceId": subj["sourceId"],
            "sourceSubjectId": subj["patientId"],
            "linkageEvidence": (f"TCIA PatientID {subj['patientId']} within collection {src['collection']} (source subject mapping); "
                                f"every series retrieved via getSeries?Collection={src['collection']}&PatientID={subj['patientId']} and "
                                "PatientID re-checked in each DICOM header."),
            "holdoutGroup": subj.get("holdoutGroup", skey),
            "sex": (str(first.get("PatientSex")) if first.get("PatientSex") else None),
            "ageAtFirstStudy": (str(first.get("PatientAge")) if first.get("PatientAge") else None),
            "studyUids": [s["uid"] for s in sts],
        })
        for sr in series_results:
            if sr.record["subjectKey"] == skey:
                for it in sr.sorted_items:
                    assert str(it.ds.PatientID) == subj["patientId"], f"PatientID mismatch in {sr.uid}"
    # ------------------------------------------------ spatial links
    links = []
    by_subj = defaultdict(list)
    for sr in series_results:
        by_subj[sr.record["subjectKey"]].append(sr)
    declared = {(l["a"], l["b"]): l for l in cfg.get("links", [])}
    for skey, srs in by_subj.items():
        for i in range(len(srs)):
            for j in range(i + 1, len(srs)):
                a, b = srs[i], srs[j]
                ra, rb = a.record, b.record
                dec = declared.get((a.uid, b.uid)) or declared.get((b.uid, a.uid))
                if dec:
                    kind, ev = dec["kind"], dec["evidence"]
                elif ra["frameOfReferenceUid"] and ra["frameOfReferenceUid"] == rb["frameOfReferenceUid"]:
                    acq_a = (a.sorted_items[0].ds.get("AcquisitionDate"), a.sorted_items[0].ds.get("AcquisitionTime"))
                    acq_b = (b.sorted_items[0].ds.get("AcquisitionDate"), b.sorted_items[0].ds.get("AcquisitionTime"))
                    tomo = all(r["role"] in ("diagnostic", "vendor_reformat") and r["modality"] == ra["modality"] for r in (ra, rb))
                    if tomo and acq_a[1] and acq_a == acq_b:
                        kind = "same_volume"
                        ev = (f"Same FrameOfReferenceUID {ra['frameOfReferenceUid']} and identical AcquisitionDate/AcquisitionTime "
                              f"{acq_a[0]}/{acq_a[1]} in both series (same acquisition, different reconstruction/reformat).")
                    else:
                        kind = "common_frame"
                        ev = (f"Same FrameOfReferenceUID {ra['frameOfReferenceUid']} (shared patient coordinate system); "
                              "not shown to be the same acquisition.")
                else:
                    kind = "independent"
                    ev = (f"Same patient: TCIA PatientID {skey.split(':', 2)[2]} within collection {skey.split(':')[1]} "
                          f"(source subject mapping). Not in a shared frame of reference ({ra['modality']} FrameOfReferenceUID: "
                          f"{ra['frameOfReferenceUid'] or 'none'}; {rb['modality']} FrameOfReferenceUID: {rb['frameOfReferenceUid'] or 'none'}); "
                          "no registration is provided or implied.")
                links.append({"id": f"link-{a.short}-{b.short}", "kind": kind, "seriesA": a.uid, "seriesB": b.uid,
                              "evidence": ev, "transform": None})
    # ------------------------------------------------ write
    if out_dir.exists():
        for sub in ("dicom", "thumbs", "targets"):
            shutil.rmtree(out_dir / sub, ignore_errors=True)
        (out_dir / "pack.json").unlink(missing_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    for sr in series_results:
        for rel, data in sr.outputs:
            p = out_dir / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        tp = out_dir / sr.record["thumbnail"]
        tp.parent.mkdir(parents=True, exist_ok=True)
        tp.write_bytes(sr.thumb)
    for t, g in zip(targets, target_geoms):
        dump_json(g, out_dir / t["geometryFile"], indent=None)
    used_sources = {s["sourceId"] for s in subjects_cfg} | {se.get("sourceId", s["sourceId"]) for s, se in annotations}
    if any(se["kind"] == "lidc_xml" for _, se in annotations):
        used_sources.add("tcia:LIDC-IDRI")
    srcs = [source_ref(sid, sources[sid], license_rows.get(sid, [])) for sid in sorted(used_sources)]
    order = {s["key"]: i for i, s in enumerate(subj_out)}
    role_rank = {"diagnostic": 0, "vendor_reformat": 1, "derived_secondary": 2, "scout": 3, "other": 4}
    series_results.sort(key=lambda sr: (order.get(sr.record["subjectKey"], 99), studies[sr.record["studyUid"]]["date"] or "",
                                        role_rank[sr.record["role"]], sr.record["number"] or 0))
    for s in studies.values():
        s.pop("_ds", None)
    import highdicom
    gen = (f"scripts/data/build_pack.py (python {sys.version.split()[0]}, pydicom {pydicom.__version__}, "
           f"highdicom {highdicom.__version__}, numpy {np.__version__})")
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "packId": pack_id,
        "version": cfg["version"],
        "title": cfg["title"],
        "description": cfg["description"],
        "generatedAt": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": gen,
        "sources": srcs,
        "subjects": subj_out,
        "studies": sorted(studies.values(), key=lambda s: (order.get(s["subjectKey"], 99), s["date"] or "")),
        "series": [sr.record for sr in series_results],
        "spatialLinks": links,
        "referenceTargets": targets,
    }
    dump_json(manifest, out_dir / "pack.json")
    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.is_file() and p.name != "lessons.json")
    qc = {
        "packId": pack_id, "generatedAt": manifest["generatedAt"], "packBytesExcludingLessons": total,
        "budgetBytes": cfg.get("budgetBytes"),
        "series": [{"uid": sr.uid, "short": sr.short, "modality": sr.modality, "role": sr.record["role"],
                    "instances": len(sr.sorted_items), "sortMethod": sr.qc.get("method"),
                    "issues": sr.record["geometry"]["volumeIssues"], "encodeStatus": sr.qc.get("encodeStatus"),
                    "maxStackShearDeg": sr.qc.get("maxStackShearDeg"), "maxSpacingDeviation": sr.qc.get("maxSpacingDeviation"),
                    "bytes": sr.record["bytes"], "rawBytes": sum(len(it.raw) for it in sr.sorted_items)}
                   for sr in series_results],
        "annotations": ann_qc,
    }
    dump_json(qc, DOCS_DIR / f"{pack_id}-build-qc.json")
    log(f"[{pack_id}] wrote {len(series_results)} series, {len(targets)} targets, {total/1e6:.1f} MB "
        f"(budget {cfg.get('budgetBytes', 0)/1e6:.0f} MB)")
    if cfg.get("budgetBytes") and total > cfg["budgetBytes"]:
        raise SystemExit(f"pack {pack_id} exceeds budget: {total} > {cfg['budgetBytes']}")
    return manifest


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    build(sys.argv[1])
