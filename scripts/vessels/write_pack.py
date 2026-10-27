"""Step 5: write public/packs/vessel-drafts/pack.json + targets/*.json and docs/data/vessel-drafts-report.md.

  python scripts/vessels/write_pack.py [--fast]

Only cases whose QC passed (contrast confirmed, coverage ok) are written; structures that failed laterality
or came out empty are dropped. Every target is provenance "ai_draft", completeness "target_only",
review {status: "unreviewed", ...}. The pack carries NO series/subjects/studies: targets point at the
series UIDs and SOP Instance UIDs of the image packs in SOURCE_PACKS (the app indexes targets across packs).
lessons.json in the pack folder is NOT written or touched by this script.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from datetime import datetime, timezone

from common import (FIVE_VESSELS, LABELS, MIN_AREA_MM2, MIN_COMPONENT_PX, OUT_PACK, REPORT_MD, ROI_SUBSET, SIMPLIFY_TOL_PX, WORK,
                    case_dir, dump_json, dump_json_compact, load_json, series_index, slug, source_manifests)

PACK_ID = "vessel-drafts"
VERSION = "0.1.0"
REVIEW = {"status": "unreviewed", "reviewer": None, "at": None, "note": None}
NOTE = "unreviewed AI proposal"
# Owner decision (2026-10-27): user-visible pack fields carry the Horalix brand only; tool and model names stay in this
# script and in docs/data/vessel-drafts-report.md.
BRAND_SOURCE = "Horalix"
BRAND_METHOD = "AI draft by Horalix \u2014 automatic segmentation, not reviewed by a radiologist"
HORALIX_SOURCE = {"id": "horalix", "name": "Horalix", "url": "docs/data/vessel-drafts-report.md", "doi": None,
                  "license": "AI-generated drafts for this app; the segmentation tools and their licences are listed in docs/data/vessel-drafts-report.md",
                  "citation": BRAND_METHOD, "accessNote": "Unreviewed AI drafts."}


def ts_source(report: dict) -> dict:
    return {
        "id": "totalsegmentator",
        "name": f"TotalSegmentator {report['totalsegmentator_version']} (task '{report['task']}', nnU-Net {report['nnunetv2_version']})",
        "url": "https://github.com/wasserth/TotalSegmentator",
        "doi": "10.1148/ryai.230024",
        "license": "Apache License 2.0 (TotalSegmentator code); the 'total' task is an open task (no licence key required); "
                   "weights downloaded by TotalSegmentator from its GitHub release v2.0.0-weights",
        "licenseUrl": "https://www.apache.org/licenses/LICENSE-2.0",
        "citation": "Wasserthal J, Breit HC, Meyer MT, Pradella M, Hinck D, Sauter AW, Heye T, Boll DT, Cyriac J, Yang S, "
                    "Bach M, Segeroth M. TotalSegmentator: Robust Segmentation of 104 Anatomic Structures in CT Images. "
                    "Radiology: Artificial Intelligence 2023;5(5):e230024. https://doi.org/10.1148/ryai.230024",
        "accessNote": "Run offline on CPU from an isolated Python venv (PyPI install); usage statistics disabled "
                      "(send_usage_stats=false). Outputs are machine proposals, not ground truth.",
    }


def check_geometry(g: dict, series: dict) -> list[str]:
    errs = []
    sops = {i["sopInstanceUid"] for i in series["instances"]}
    rows, cols = series["geometry"]["rows"], series["geometry"]["columns"]
    for pl in g["planes"]:
        if pl["sopInstanceUid"] not in sops:
            errs.append(f"SOP {pl['sopInstanceUid']} not in series")
        for ring in pl["polygons"] + pl.get("holes", []):
            if len(ring) < 4 or ring[0] != ring[-1]:
                errs.append("ring not closed / too short")
            for c, r in ring:
                if not (-0.5 <= c <= cols - 0.5 and -0.5 <= r <= rows - 0.5):
                    errs.append(f"point outside image {c},{r}")
                    break
    return errs


def main(argv):
    fast = "--fast" in argv
    sfx = "_fast" if fast else ""
    series_by_uid = {uid: v[2] for uid, v in series_index().items()}
    elig_all = load_json(WORK / "eligibility.json")

    targets_dir = OUT_PACK / "targets"
    if targets_dir.exists():
        shutil.rmtree(targets_dir)
    targets_dir.mkdir(parents=True)

    refs, cases_summary, ts_report = [], [], None
    for e in elig_all:
        case = e["case"]
        cs = {"case": case, "packId": e.get("packId"), "subjectKey": e["subjectKey"], "seriesUid": e["seriesUid"], "description": e["description"],
              "eligible": e["eligible"], "reason": e["reason"], "contrastEvidence": e["contrast"]["evidence"]}
        cases_summary.append(cs)
        if not e["eligible"]:
            cs["written"] = False
            continue
        d = case_dir(case)
        elig = load_json(d / "eligibility.json")
        run = load_json(d / f"run{sfx}.json")
        rep = load_json(d / f"ts_report{sfx}.json")
        ts_report = ts_report or rep
        st = load_json(d / f"structures{sfx}.json")
        qc = load_json(d / f"qc{sfx}.json")
        cs.update({"elig": elig, "run": {k: run[k] for k in ("wallSeconds", "fast", "returncode")}, "tsRuntime": rep["runtime_seconds"],
                   "structures": st, "qc": qc, "targets": [], "dropped": []})
        if not qc["contrastConfirmed"] or not qc["coverage"]["ok"]:
            cs["written"] = False
            cs["reason"] = f"QC failed: contrastConfirmed={qc['contrastConfirmed']} coverage={qc['coverage']}"
            continue
        cs["written"] = True
        series = series_by_uid[e["seriesUid"]]
        model = f"TotalSegmentator {rep['totalsegmentator_version']}, task {rep['task']}"
        mode = "--fast 3 mm model" if rep["fast"] else "full-resolution 1.5 mm models (organs + cardiac sub-models, after the 6 mm crop model)"
        max_res = max(r["alignment"]["maxResidualMm"] for r in st["structures"].values() if "alignment" in r)
        resampled = sorted(c for c, r in st["structures"].items() if r.get("resampled"))
        method_common = (
            f"{e['packId']} series {e['seriesUid']} ({elig['shape_ijk'][2]} original axial instances) read with pydicom and "
            f"written to NIfTI on the ORIGINAL slice grid with SimpleITK (origin = IPP of first slice, direction = IOP cosines + "
            f"normal, LPS; ITK's NIfTI writer stores RAS = diag(-1,-1,1) x LPS, checked by nibabel read-back, max affine "
            f"difference {elig['niftiVsDicomAffineMaxAbsDiff']:.1e} mm). TotalSegmentator --roi_subset on CPU, {mode}; "
            + (f"masks resampled nearest-neighbour onto the CT grid for: {', '.join(resampled)}; " if resampled else
               "masks returned on the input grid (shape and affine identical, no resampling); ")
            + f"NIfTI slice k matched to its SOP Instance UID by IPP (max residual {st['sliceIppMatchMaxResidualMm']:.1e} mm). "
        )
        for cls in ROI_SUBSET:
            r = st["structures"].get(cls, {})
            if r.get("status") != "ok":
                cs["dropped"].append({"structure": cls, "why": r.get("status", "missing")})
                continue
            if cls in qc["failedStructures"]:
                cs["dropped"].append({"structure": cls, "why": "laterality check failed"})
                continue
            tid = f"vd-{case}-{slug(cls)}"
            g = load_json(d / f"contours{sfx}" / f"{cls}.json")
            errs = check_geometry(g, series)
            if errs:
                cs["dropped"].append({"structure": cls, "why": "geometry check failed: " + "; ".join(errs[:3])})
                continue
            dump_json_compact(g, targets_dir / f"{tid}.json")
            ks = [s["k"] for s in r["slices"]]
            method = method_common + (
                f"Per original slice, 4-connected mask components >= {MIN_COMPONENT_PX} px traced with "
                f"skimage.measure.find_contours(level 0.5) on a zero-padded mask, (row,col) -> image_px [col,row] "
                f"(0,0 = centre of first pixel), closed rings simplified with approximate_polygon({SIMPLIFY_TOL_PX} px); "
                f"enclosed gaps stored as holes. Alignment check (NIfTI affine vs DICOM IPP/IOP/PixelSpacing) on "
                f"{r['alignment']['samples']} mask voxels: max residual {r['alignment']['maxResidualMm']:.1e} mm. "
                f"{len(ks)} planes; mean CT value in mask {r['meanHU']:.0f} HU."
            )
            refs.append({
                "id": tid,
                "label": f"{LABELS[cls]} (AI draft)",
                "classId": f"anatomy:{cls}",
                "seriesUid": e["seriesUid"],
                "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json",
                "provenance": "ai_draft",
                "provenanceDetail": {"source": BRAND_SOURCE, "method": BRAND_METHOD, "note": NOTE},
                "completeness": "target_only",
                "assessedClasses": [f"anatomy:{cls}"],
                "unassessedNote": "Machine proposal for this one structure only, on the slices where the model found it; "
                                  "all other anatomy and any findings on this series are unassessed. Not reviewed by a human.",
                "review": dict(REVIEW),
            })
            cs["targets"].append({"id": tid, "structure": cls, "planes": len(ks), "kRange": [min(ks), max(ks)]})

        n = qc["normal"]
        fv = qc["fiveVessel"]
        at = qc["archTop"]
        if fv["chosenRun"]:
            tid = f"vd-{case}-level-five-vessel"
            contacts = {k: v for k, v in fv["contacts"].items() if int(k) in fv["chosenRun"]}
            derivation = (
                "AI-derived draft (unreviewed). Rule: contiguous original axial slices lying ABOVE the superior-most slice "
                f"carrying any AI aorta mask (arch top: instance {at['sop']}, IPP.n = {at['proj']:.2f} mm) on which "
                "all five structures - right and left brachiocephalic veins, brachiocephalic trunk, left common carotid artery, "
                f"left subclavian artery - are each present (>= {MIN_AREA_MM2:.0f} mm2 of mask) as distinct labelled "
                "cross-sections; the run nearest the arch is used. Range = [min, max] of IPP . normal over these slices "
                "(normal = IOP row x column cosines). "
                + (f"Wall contact without a visible gap between labels on: {contacts}. " if contacts else "")
                + (f"Other qualifying runs (slice indices): {fv['runs'][1:]}. " if len(fv["runs"]) > 1 else "")
                + "AI draft by Horalix; QC: laterality checks passed for the five structures."
            )
            g = {"geometryType": "slice_interval", "space": "patient_lps_mm", "normal": n, "range": fv["range"],
                 "sopInstanceUids": fv["sopInstanceUids"], "derivation": derivation}
            dump_json(g, targets_dir / f"{tid}.json")
            refs.append({
                "id": tid,
                "label": "Five-vessel level (AI-derived draft)",
                "classId": "level:five_vessel",
                "seriesUid": e["seriesUid"],
                "geometryType": "slice_interval",
                "geometryFile": f"targets/{tid}.json",
                "provenance": "ai_draft",
                "provenanceDetail": {"source": BRAND_SOURCE, "method": BRAND_METHOD, "note": NOTE},
                "completeness": "target_only",
                "assessedClasses": ["level:five_vessel"],
                "unassessedNote": "Only the axial level is proposed; individual vessel outlines are separate targets. Not reviewed by a human.",
                "review": dict(REVIEW),
            })
            cs["targets"].append({"id": tid, "structure": "level:five_vessel", "planes": len(fv["chosenRun"]), "kRange": [min(fv["chosenRun"]), max(fv["chosenRun"])]})
        arch = qc["aorticArch"]
        if arch.get("robust"):
            tid = f"vd-{case}-level-aortic-arch"
            derivation = (
                "AI-derived draft (unreviewed). Rule: starting at the most superior slice with >= "
                f"{MIN_AREA_MM2:.0f} mm2 of AI aorta mask and moving caudally, the contiguous original axial slices on which "
                "the aorta is a single cross-section (one component), ending before the first slice where it splits into ascending "
                f"and descending parts (here two components of {arch['split']['componentAreasMm2']} mm2 at slice index {arch['split']['k']}). "
                "Accepted because at least one slice spans the tracheal centroid in x (arch crossing the midline) and the run is "
                f"{arch['lengthMm']} mm long (<= 45 mm). Range = [min, max] of IPP . normal. AI draft by Horalix."
            )
            g = {"geometryType": "slice_interval", "space": "patient_lps_mm", "normal": n, "range": arch["range"],
                 "sopInstanceUids": arch["sopInstanceUids"], "derivation": derivation}
            dump_json(g, targets_dir / f"{tid}.json")
            refs.append({
                "id": tid,
                "label": "Aortic arch level (AI-derived draft)",
                "classId": "level:aortic_arch",
                "seriesUid": e["seriesUid"],
                "geometryType": "slice_interval",
                "geometryFile": f"targets/{tid}.json",
                "provenance": "ai_draft",
                "provenanceDetail": {"source": BRAND_SOURCE, "method": BRAND_METHOD, "note": NOTE},
                "completeness": "target_only",
                "assessedClasses": ["level:aortic_arch"],
                "unassessedNote": "Only the axial level is proposed. Not reviewed by a human.",
                "review": dict(REVIEW),
            })
            cs["targets"].append({"id": tid, "structure": "level:aortic_arch", "planes": len(arch["slices"]), "kRange": [min(arch["slices"]), max(arch["slices"])]})

    tcia_sources, seen = [], set()
    for _, _, m in source_manifests():
        for s in m["sources"]:
            if s["id"] not in seen and any(c.get("written") and c["subjectKey"].startswith(s["id"] + ":") for c in cases_summary):
                seen.add(s["id"])
                tcia_sources.append(s)
    used_packs = sorted({c["packId"] for c in cases_summary if c.get("written")})
    manifest = {
        "schemaVersion": 1,
        "packId": PACK_ID,
        "version": VERSION,
        "title": "Vessel drafts: AI-proposed great-vessel outlines and levels (unreviewed)",
        "description": (
            "UNREVIEWED AI DRAFTS by Horalix for the five great vessels of the superior mediastinum "
            "(both brachiocephalic veins, brachiocephalic trunk, left common carotid, left subclavian) plus context "
            "structures, and AI-derived five-vessel / aortic-arch slice intervals, on contrast-enhanced chest CTs of the "
            f"{' and '.join(used_packs)} pack(s). Contains no images: every target references series and SOP Instance UIDs "
            "of those packs. "
            "Nothing here has been checked by a radiologist."),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "scripts/vessels/write_pack.py",
        "sources": [HORALIX_SOURCE] + tcia_sources,
        "subjects": [],
        "studies": [],
        "series": [],
        "spatialLinks": [],
        "referenceTargets": refs,
    }
    dump_json(manifest, OUT_PACK / "pack.json")
    pack_bytes = sum(p.stat().st_size for p in [OUT_PACK / "pack.json", *targets_dir.glob("*.json")])
    dump_json({"cases": [{k: v for k, v in c.items() if k not in ("structures", "elig")} for c in cases_summary],
               "packBytesExcludingLessons": pack_bytes}, WORK / f"pack_summary{sfx}.json")
    from verify_targets import verify  # end-to-end check of the files just written against the DICOM files
    ver = {r["id"]: r for r in verify(fast)}
    bad = [i for i, r in ver.items() if not r["ok"]]
    if bad:
        raise SystemExit(f"end-to-end verification failed for {bad}")
    write_report(cases_summary, ts_report, manifest, pack_bytes, used_packs, ver)
    print(f"wrote {len(refs)} targets, pack bytes (pack.json + targets) = {pack_bytes}; verification ok for {len(ver)}")
    print(json.dumps(index_entry(manifest, pack_bytes, used_packs), indent=1))


def index_entry(manifest, pack_bytes, used_packs):
    n_c = sum(1 for t in manifest["referenceTargets"] if t["geometryType"] == "contour_set")
    n_l = sum(1 for t in manifest["referenceTargets"] if t["geometryType"] == "slice_interval")
    series = {t["seriesUid"] for t in manifest["referenceTargets"]}
    return {"id": PACK_ID, "title": "Vessel drafts: AI-proposed great vessels (unreviewed)", "manifest": f"{PACK_ID}/pack.json",
            "lessons": None, "bytes": pack_bytes, "distribution": "repo",
            "note": (f"AI draft by Horalix (unreviewed) on {len(series)} contrast chest CT series: {n_c} vessel/structure "
                     f"contour sets + {n_l} slice-interval levels. No images; requires the {' and '.join(used_packs)} pack(s).")}


def fmt_mm(v):
    return f"{v:.1f}"


def write_report(cases, rep, manifest, pack_bytes, used_packs, ver):
    L = []
    w = L.append
    w("# Vessel drafts: TotalSegmentator great-vessel proposals (UNREVIEWED AI DRAFTS)")
    w("")
    w(f"_Report regenerated {manifest['generatedAt']}._")
    w("")
    w("_Generated by `scripts/vessels/write_pack.py` from the QC files in the scratch work directory; re-run the "
      "pipeline in `scripts/vessels/README.md` to regenerate. Do not edit by hand._")
    w("")
    w("> **Every outline and level in `public/packs/vessel-drafts/` is an unreviewed machine proposal** "
      "(provenance `ai_draft`, review status `unreviewed`, completeness `target_only`). No radiologist or other human has "
      "checked them. They are practice targets for the five-vessel exercise, not ground truth.")
    w("")
    w("## Summary")
    w("")
    w("| case | pack | five-vessel level (slices, k, IPP.n mm) | aortic-arch level | structures written | laterality | max alignment residual |")
    w("|---|---|---|---|---|---|---|")
    for c in cases:
        if not c.get("written"):
            continue
        q = c["qc"]
        fv, arch = q["fiveVessel"], q["aorticArch"]
        ch = fv["chosenRun"]
        five = (f"{len(ch)} (k{ch[0]}–{ch[-1]}), [{fmt_mm(fv['range'][0])}, {fmt_mm(fv['range'][1])}]" if ch else "none")
        ar = (f"{len(arch['slices'])} (k{arch['slices'][0]}–{arch['slices'][-1]}), [{fmt_mm(arch['range'][0])}, {fmt_mm(arch['range'][1])}]"
              if arch.get("robust") else "not robust, not written")
        nstruct = sum(1 for t in c["targets"] if not t["structure"].startswith("level:"))
        lat_ok = all(l["pass"] for l in q["laterality"])
        nshared = sum(l["sharedSlices"] for l in q["laterality"])
        res = max(r["alignment"]["maxResidualMm"] for r in c["structures"]["structures"].values() if "alignment" in r)
        w(f"| `{c['case']}` | {c['packId']} | {five} | {ar} | {nstruct}/{len(ROI_SUBSET)} | "
          f"{'all pass' if lat_ok else 'FAIL'} ({nshared} slice comparisons) | {res:.1e} mm |")
    w("")
    w("## Tools and versions")
    w("")
    w(f"- TotalSegmentator **{rep['totalsegmentator_version']}**, task **`{rep['task']}`** (open task, no licence key), "
      f"nnU-Net v2 {rep['nnunetv2_version']}, torch {rep['torch_version']}, device `{rep['device']}`, "
      f"{'`--fast` (3 mm)' if rep['fast'] else 'full-resolution models (not `--fast`)'}, `--roi_subset` = "
      + ", ".join(f"`{c}`" for c in rep["roi_subset"]) + ".")
    w("- Models used by that configuration (weights fetched by TotalSegmentator from "
      "`https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/`): "
      "`Dataset298_TotalSegmentator_total_6mm_1559subj` (rough segmentation for ROI cropping), "
      "`Dataset291_TotalSegmentator_part1_organs_1559subj` (trachea, oesophagus), "
      "`Dataset293_TotalSegmentator_part3_cardiac_1559subj` (aorta, arch branches, brachiocephalic veins, SVC). "
      "First run also downloaded the other `total` parts (292, 294, 295), unused here.")
    w("- `pulmonary_artery` is **not** a class of the v2 `total` task in this version (only in the licence-restricted "
      "`heartchambers_highres` task), so no pulmonary-artery outline was produced.")
    w("- Python 3.12.10 venv `C:/Users/kerim/radiology-data/venv-ts` (outside OneDrive), packages from PyPI; "
      "pydicom 3.0.2 (+ python-gdcm 3.2.6 for JPEG-LS), SimpleITK 2.5.6, nibabel 5.4.2, scikit-image 0.26.0, scipy 1.18.1. "
      "`TOTALSEG_HOME_DIR=C:/Users/kerim/radiology-data/totalseg-home`, `send_usage_stats=false`.")
    w("- Hardware: 2x RTX 5080 present (`nvidia-smi`), but the PyPI torch wheel for Windows is CPU-only; everything ran on CPU "
      "(32 logical cores).")
    w("")
    w("## Case selection")
    w("")
    w("Every CT series with role `diagnostic` in the image packs `chest-pairs` and `body` was screened (DICOM headers "
      "re-read from the files, not just pack metadata).")
    w("")
    w("| case | pack | subject | series | used | reason / contrast evidence |")
    w("|---|---|---|---|---|---|")
    for c in cases:
        why = c["reason"] if not c["eligible"] or not c.get("written") else c["contrastEvidence"]
        w(f"| `{c['case']}` | {c.get('packId')} | `{c['subjectKey']}` | {c['description'] or '(no description)'} `…{c['seriesUid'][-12:]}` | "
          f"{'yes' if c['eligible'] and c.get('written') else 'no'} | {why} |")
    w("")
    w("Coverage of the thoracic inlet / superior mediastinum is checked numerically after segmentation (series must extend "
      ">= 15 mm above the arch top and contain >= 1 five-vessel slice) and was spot-checked visually (coronal previews of the "
      "chest-pairs CTs before running; contour overlays on the arch / five-vessel slices of every written case, kept in the "
      "scratch folder only). Contrast is confirmed twice: DICOM header text, then mean HU >= 150 inside the aorta mask.")
    w("")
    w("## Conversion and LPS/RAS handling")
    w("")
    w("- Every instance listed in the source pack's `pack.json` is read with pydicom; SOP/Series UIDs and IPP are checked "
      "against pack.json; HU = stored x slope + intercept (int16). Slices are sorted by IPP . n (n = IOP row x column "
      "cosine); spacing must be uniform (<= 0.01 mm) and IPPs collinear along n.")
    w("- A SimpleITK image is built with index (i, j, k) = (DICOM column, DICOM row, sorted slice), origin = IPP of the "
      "first sorted slice (centre of its first pixel, LPS mm), spacing = (PixelSpacing[1], PixelSpacing[0], slice step), "
      "direction columns = (IOP[0:3], IOP[3:6], n), and written with `sitk.WriteImage(..., .nii.gz)`. ITK keeps LPS "
      "internally and its NIfTI writer stores qform/sform in RAS (x and y negated); voxel order is unchanged. Read back "
      "with nibabel, `diag(-1,-1,1,1) @ affine_RAS` equals the DICOM-derived LPS affine (differences below).")
    w("- TotalSegmentator writes each class mask in the geometry of the input NIfTI. For every mask the shape and affine "
      "were compared with `ct.nii.gz`; a mismatch would trigger nearest-neighbour resampling with SimpleITK (it never did).")
    w("- Contours: per original slice (slice k -> SOP Instance UID via the IPP sort, re-verified from the affine), 4-connected "
      f"components >= {MIN_COMPONENT_PX} px, `skimage.measure.find_contours(mask, 0.5)` on a zero-padded array, "
      "(row, col) -> `[col, row]` image_px (pixel-centre convention, (0,0) = centre of the first pixel), closed rings, "
      f"`approximate_polygon` tolerance {SIMPLIFY_TOL_PX} px, enclosed gaps stored as `holes`.")
    w("")
    w("## Per-case results")
    for c in cases:
        if not c.get("eligible") or "qc" not in c:
            continue
        q, st, el = c["qc"], c["structures"], c["elig"]
        w("")
        w(f"### `{c['case']}` — {c['subjectKey']} (pack `{c.get('packId')}`)")
        w("")
        w(f"- Series `{c['seriesUid']}` ({c['description']}), {el['shape_ijk'][2]} slices x {el['shape_ijk'][0]}x{el['shape_ijk'][1]}, "
          f"pixel {el['pixelSpacing'][0]:.4f} mm, step {el['sliceStepMm']} mm, PatientPosition {el['patientPosition']}, "
          f"IPP . n from {fmt_mm(el['projRangeMm'][0])} to {fmt_mm(el['projRangeMm'][1])} mm.")
        w(f"- Run time: TotalSegmentator {c['tsRuntime']:.0f} s (wall {c['run']['wallSeconds']:.0f} s incl. start-up"
          f"{', first run incl. weight download' if c['case'] == 'ar-16434411' else ''}); conversion {el['convertSeconds']} s.")
        w(f"- Contrast confirmed from the data: mean HU in aorta mask {q['meanHU'].get('aorta')} "
          f"(SVC {q['meanHU'].get('superior_vena_cava')}, right BCV {q['meanHU'].get('brachiocephalic_vein_right')}, "
          f"left BCV {q['meanHU'].get('brachiocephalic_vein_left')}).")
        w(f"- Alignment: NIfTI vs DICOM affine max |diff| {el['niftiVsDicomAffineMaxAbsDiff']:.1e} mm; slice-centre vs IPP max residual "
          f"{st['sliceIppMatchMaxResidualMm']:.1e} mm; mask voxel centres (NIfTI affine RAS->LPS vs DICOM IPP/IOP/PixelSpacing) "
          f"max residual {max(r['alignment']['maxResidualMm'] for r in st['structures'].values() if 'alignment' in r):.1e} mm "
          f"over {sum(r['alignment']['samples'] for r in st['structures'].values() if 'alignment' in r)} sampled voxels. "
          f"Resampling needed: {'yes' if any(r.get('resampled') for r in st['structures'].values()) else 'no'}.")
        w(f"- Written: **{'yes' if c.get('written') else 'no'}**" + ("" if c.get("written") else f" — {c['reason']}"))
        w("")
        w("| structure | status | planes (k range) | volume ml | mean HU (mask) | DICOM re-check: mean HU / Dice min / centroid resid mm | target |")
        w("|---|---|---|---|---|---|---|")
        tmap = {t["structure"]: t for t in c.get("targets", [])}
        drop = {x["structure"]: x["why"] for x in c.get("dropped", [])}
        for cls in ROI_SUBSET:
            r = st["structures"].get(cls, {})
            t = tmap.get(cls)
            status = ("written" if t else f"dropped: {drop.get(cls, r.get('status'))}") if c.get("written") else \
                f"case not written ({r.get('status')})"
            kr = r.get("kRange")
            v = ver.get(t["id"]) if t else None
            vtxt = f"{v['meanHUFromDicom']:.0f} / {v['diceMin']:.3f} / {v['centroidResidualMaxMm']:.1e}" if v else "—"
            w(f"| {LABELS[cls]} | {status} | {len(r.get('slices', []))} ({kr[0]}–{kr[1]}) | {r.get('volumeMl', '')} | "
              f"{r.get('meanHU', float('nan')):.0f} | {vtxt} | {('`' + t['id'] + '`') if t else '—'} |" if kr else
              f"| {LABELS[cls]} | {status} | 0 | | | — | — |")
        w("")
        w("Laterality (LPS x of slice centroids; left must exceed right on every shared slice):")
        w("")
        w("| left structure | right structure | shared slices | wrong | min margin mm | median margin mm |")
        w("|---|---|---|---|---|---|")
        for l in q["laterality"]:
            w(f"| {LABELS[l['left']]} | {LABELS[l['right']]} | {l['sharedSlices']} | {len(l['wrongSlices'])} | "
              f"{l['minMarginMm']} | {l['medianMarginMm']} |")
        w("")
        fv, at, arch = q.get("fiveVessel", {}), q.get("archTop", {}), q.get("aorticArch", {})
        w(f"- Arch top (most superior slice with any aorta mask): k={at.get('k')}, IPP.n = {fmt_mm(at.get('proj', float('nan')))} mm "
          f"({at.get('areaMm2')} mm2 of mask there); series extends {q['coverage'].get('mmAboveArchTop')} mm above it.")
        if fv.get("chosenRun"):
            ch = fv["chosenRun"]
            w(f"- **Five-vessel level**: {len(ch)} slice(s), k {ch[0]}–{ch[-1]}, IPP.n range "
              f"[{fmt_mm(fv['range'][0])}, {fmt_mm(fv['range'][1])}] mm (thickness covered {len(ch) * el['sliceStepMm']:.1f} mm). "
              f"Areas mm2 per slice: " + "; ".join(f"{LABELS[k]} {v}" for k, v in fv["areasMm2"].items()) + ".")
            cts = {k: v for k, v in fv.get("contacts", {}).items() if int(k) in ch}
            if cts:
                w(f"  Wall contact (no visible gap between labels) on: {cts} — recorded, not excluded.")
            if len(fv["runs"]) > 1:
                w(f"  Other qualifying runs not used: {fv['runs'][1:]}.")
        else:
            w("- **Five-vessel level: none** — no slice above the arch top had all five structures present; no interval written.")
        above = [r for r in fv.get("rejectedAboveArch", [])][:6]
        if above:
            w(f"  First slices above the arch that did not qualify: " + "; ".join(f"k{r['k']} missing {', '.join(LABELS[m] for m in r['missing'])}" for r in above) + ".")
        if arch.get("robust"):
            w(f"- **Aortic-arch level** (optional, robust): {len(arch['slices'])} slices, k {arch['slices'][0]}–{arch['slices'][-1]}, "
              f"IPP.n [{fmt_mm(arch['range'][0])}, {fmt_mm(arch['range'][1])}] mm, length {arch['lengthMm']} mm; aorta splits into "
              f"{arch['split']['componentAreasMm2']} mm2 components at k{arch['split']['k']}.")
        elif c.get("written"):
            w(f"- Aortic-arch level: not written (rule not robust here: {({k: arch.get(k) for k in ('slices', 'split', 'spansTrachealMidline', 'lengthMm')})}).")
        else:
            w("- Aortic-arch level: not evaluated (case failed coverage).")
    w("")
    w("## Pack")
    w("")
    n_c = sum(1 for t in manifest["referenceTargets"] if t["geometryType"] == "contour_set")
    n_l = sum(1 for t in manifest["referenceTargets"] if t["geometryType"] == "slice_interval")
    trach = [v["meanHUFromDicom"] for i, v in ver.items() if i.endswith("-trachea")]
    five_slugs = tuple("-" + slug(c) for c in FIVE_VESSELS)
    vess = [v["meanHUFromDicom"] for i, v in ver.items() if i.endswith(five_slugs)]
    w(f"- `public/packs/vessel-drafts/pack.json` + `targets/`: {n_c} contour_set targets (image_px) and {n_l} slice_interval targets; "
      f"{pack_bytes / 1e3:.1f} kB (excluding any `lessons.json`, which this pipeline does not write).")
    w("- The manifest has empty `subjects/studies/series/spatialLinks`; every target references a series UID and SOP Instance "
      f"UIDs of the {' / '.join(used_packs)} pack(s), which must be loaded too (the app indexes targets across packs by series UID).")
    w("- Validated with `scripts/data/zod_check.mjs` (PackManifest + every TargetGeometry), with the geometry checks in "
      "`write_pack.py` (every SOP UID belongs to the referenced series, rings closed, all points inside the image) and "
      f"end-to-end by `verify_targets.py` on all {len(ver)} written targets: each plane's SOP UID is resolved to its DICOM file, "
      "the polygons are rasterised on that file's pixel grid, compared with the model mask (Dice) and their centroid mapped "
      "to LPS with the file's own IPP/IOP/PixelSpacing vs the mask centroid through the NIfTI affine; slice intervals list "
      "exactly the instances whose IPP . normal falls in range. A one-slice SOP mix-up would show as a residual equal to the "
      "slice step (2.5–3 mm); a row/column swap or flip as tens of mm. Read straight from the DICOM pixels, tracheal outlines "
      f"average {min(trach):.0f} to {max(trach):.0f} HU (air) and the five great-vessel outlines {min(vess):.0f} to {max(vess):.0f} HU "
      "(blood pool; the lower values are systemic arteries on pulmonary-angiogram timing and the vein on the non-injected "
      "side, the highest the vein carrying undiluted contrast), i.e. the outlines sit on the intended anatomy.")
    w("")
    w("## Known limitations")
    w("")
    w("- These are segmentation-model outputs on 2.5–3 mm slices; partial-volume and contrast-mixing artefacts (dense "
      "injection on one side, unopacified vein on the other) can shift or truncate vessel outlines, especially the "
      "left brachiocephalic vein and the origins of the arch branches.")
    w("- The five-vessel rule treats wall-to-wall contact between two labels as acceptable (distinct labels), because the "
      "arch branches commonly abut each other at 3 mm slice thickness; such contacts are listed above.")
    runs = {c["case"]: c["qc"]["fiveVessel"]["chosenRun"] for c in cases if c.get("written")}
    shortest = min(runs, key=lambda k: len(runs[k]))
    longest = max(runs, key=lambda k: len(runs[k]))
    w("- The five-vessel interval runs from the first slice above the arch to the last slice before the brachiocephalic "
      f"trunk divides or a brachiocephalic vein ends, so it ranges from {len(runs[shortest])} slice(s) (`{shortest}`) to "
      f"{len(runs[longest])} slices (`{longest}`); the single textbook 'five-vessel' image corresponds to somewhere inside it. "
      "A short interval usually means one brachiocephalic vein is labelled only just above the arch (e.g. an unopacified "
      "vein on the non-injected side).")
    w("- Series reconstructed with a sharp lung kernel have noisy mediastinal soft tissue (`lidc-0217`, kernel LUNG), and "
      "CT pulmonary angiograms (`CT PE CHEST` studies) enhance systemic arteries only moderately; outlines there are more "
      "uncertain.")
    w("- Context structures (aorta, SVC, trachea, oesophagus, right carotid/subclavian) are included as separate targets "
      "over their whole segmented extent; they were not part of the five-vessel rule except the aorta (arch top).")
    w("- Nothing was reviewed by a human. Before using any of this for assessment-grade scoring, a reviewer should "
      "check each outline and level and set `review` / `provenance` accordingly.")
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(sys.argv)
