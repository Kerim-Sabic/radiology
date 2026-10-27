"""Atlas final step: apply rule 3 (coverage / typical volume) across all CTs, assemble
public/packs/anatomy-atlas/pack.json + targets/*.json, verify, write docs/data/anatomy-atlas-report.md, and merge the
pack's entry into public/packs/index.json (by id; other packs untouched).

  C:/Users/kerim/radiology-data/venv-ts/Scripts/python.exe scripts/atlas/write_pack.py [--no-index]

Pack content rules (owner): every target has layer "atlas", provenance "ai_draft", review unreviewed, completeness
target_only, a category, a plain anatomical label, provenanceDetail.source "Horalix", method "AI draft by Horalix -
automatic segmentation, not reviewed by a radiologist", and its QC result in provenanceDetail.note. Tool / model names
and versions appear only in this script and in the report, never in pack labels or methods. lessons.json in the pack
folder is never written. Targets reference series / SOP UIDs of the image packs; the pack itself has no images.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone

import qc_rules as Q
from common import (CT_DP_TOL_PX, DP_TOL_PX, OUT_PACK, PACKS_DIR, REPORT_MD, WORK, category, dump_json, load_json, series_index, slug,
                    source_manifests)

PACK_ID = "anatomy-atlas"
VERSION = "0.3.0"
REVIEW = {"status": "unreviewed", "reviewer": None, "at": None, "note": None}
SOURCE = "Horalix"
METHOD = "AI draft by Horalix \u2014 automatic segmentation, not reviewed by a radiologist"
LIMIT_BYTES = 80_000_000  # owner: up to 80 MB is fine for the repo
RULE_NAMES = {0: "mapping/alignment", 1: "fragments / too small", 2: "density (HU)", 3: "coverage / volume",
              4: "laterality / anatomical order / side verification", 5: "CXR area / thorax box / side", 6: "heart-chamber QC"}
TRUNC_DROP_FRACTION = 0.20
VOLUME_MAX_FACTOR = 4.0
NO_VOLUME_CHECK = ("kidney_cyst_",)


def is_pediatric(subject_key: str) -> bool:
    return "Pediatric" in subject_key


# The right main bronchus drops at most ~2.5 cm before the upper-lobe bronchus leaves it (less in children); an outline
# reaching further below the carina also covers the bronchus intermedius and is named for both.
RIGHT_MAIN_BRONCHUS_MAX_DROP_MM = {"adult": 25.0, "child": 15.0}


def structure_label(name: str, r: dict, c: dict) -> str:
    label = Q.clean_label(name)
    car = (c["st"].get("carina") or {}).get("firstSubCarinalZ")
    if name == "main_bronchus_right" and car is not None and r.get("kRange"):
        z = {s["k"]: s["ipp"][2] for s in load_json(WORK / c["case"] / "slices.json")}
        drop = car - min(z[k] for k in range(r["kRange"][0], r["kRange"][1] + 1) if k in z)
        r["belowCarinaMm"] = round(drop, 1)
        if drop > RIGHT_MAIN_BRONCHUS_MAX_DROP_MM["child" if is_pediatric(c["subjectKey"]) else "adult"]:
            label = "Right main bronchus and bronchus intermedius"
    return label


def check_geometry(g, se):
    sops = {i["sopInstanceUid"] for i in se["instances"]}
    rows, cols = se["geometry"]["rows"], se["geometry"]["columns"]
    for pl in g["planes"]:
        if pl["sopInstanceUid"] not in sops:
            return "SOP not in series"
        for ring in pl["polygons"] + pl.get("holes", []):
            if len(ring) < 4 or ring[0] != ring[-1]:
                return "ring not closed"
            for c, r in ring:
                if not (-0.5 <= c <= cols - 0.5 and -0.5 <= r <= rows - 0.5):
                    return f"point outside image ({c},{r})"
    return None


def ct_note(name, r):
    parts = []
    if r["components"] > r["componentsKept"]:
        parts.append(f"{r['componentsKept']} of {r['components']} 3D parts kept ({r['fragmentsRemovedMl']} ml fragments removed)")
    else:
        parts.append("single 3D part")
    d = r.get("density")
    if d and d["group"] != "not checked":
        parts.append(f"median {r['medianHU']:.0f} HU ({d['group']} {d['range']})")
    lc = r.get("lateralityChecks") or []
    if lc:
        parts.append("left/right ok vs " + ", ".join(Q.clean_label(c["vs"]) for c in lc[:2]))
    if r.get("midlineCheck"):
        parts.append("midline side ok")
    if r.get("vertebralOrder"):
        parts.append("vertebral order ok")
    for oc in r.get("orderChecks") or []:
        txt = oc["check"]
        for raw in ("aorta_descending_thoracic", "aorta_ascending", "aorta_arch", "aorta_abdominal"):
            txt = txt.replace(raw, Q.clean_label(raw).lower())
        parts.append(txt + " ok")
    parts.append("partially imaged (cut at the scan edge)" if r.get("partial") else "complete in the field of view")
    if r.get("volumeRef"):
        parts.append(f"{r['volumeMl']:.0f} ml vs typical {r['volumeRef']:.0f} ml")
    return "Unreviewed AI proposal. QC passed: " + "; ".join(parts) + "."


def cxr_note(name, s, info):
    side = info["qc"]["sideFromHeader"]
    lr = ("left/right checked against PatientOrientation " + "\\".join(info["patientOrientation"]) if side
          else "midline structure; heart-left-of-spine check passed")
    return (f"Unreviewed AI proposal. QC passed: largest region kept; area {100 * s['areaFraction']:.1f}% of the image; "
            f"inside the thorax box; {lr}; outline matches the model output (Dice {s['diceVsUpsampledMask']:.3f}).")


def main(argv):
    sidx = series_index()
    tdir = OUT_PACK / "targets"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True)
    refs, problems = [], []

    # ---------------- CT: load all, rule 3 references
    ct_cases = []
    for c in load_json(WORK / "ct_cases.json"):
        d = WORK / c["case"]
        row = {**c}
        if c["eligible"] and (d / "structures.json").exists():
            row["st"] = load_json(d / "structures.json")
            row["info"] = load_json(d / "info.json")
            row["tsRuntime"] = load_json(d / "ts_report.json")["runtime_seconds"]
            row["tsReport"] = load_json(d / "ts_report.json")
        ct_cases.append(row)
    # visual verification of derived parts (render_parts.py PNGs inspected by the pipeline operator; see report)
    vis_path = WORK / "parts_visual_check.json"
    visual = load_json(vis_path) if vis_path.exists() else {}
    for c in ct_cases:
        v = visual.get(c["case"])
        if "st" in c and v:
            for n in v.get("drop", []):
                r = c["st"]["structures"].get(n)
                if r and r["status"] == "ok":
                    r["status"], r["rule"] = f"dropped: visual check ({v.get('why', {}).get(n, 'looked wrong')})", 4
    vols = {}
    for c in ct_cases:
        if "st" not in c or is_pediatric(c["subjectKey"]):
            continue
        for n, r in c["st"]["structures"].items():
            if r["status"] == "ok" and not r.get("truncation", {}).get("truncated", True):
                vols.setdefault(n, []).append(r["volumeMl"])
    typical = {n: sorted(v)[len(v) // 2] for n, v in vols.items()}
    n_ref = {n: len(v) for n, v in vols.items()}
    for c in ct_cases:
        if "st" not in c:
            continue
        ped = is_pediatric(c["subjectKey"])
        for n, r in c["st"]["structures"].items():
            if r["status"] != "ok":
                continue
            tr = r.get("truncation", {}).get("truncated", False)
            r["partial"] = bool(tr)
            ref = typical.get(n)
            if ref and not ped and not n.startswith(NO_VOLUME_CHECK):
                r["volumeRef"] = ref
                if tr and r["volumeMl"] < TRUNC_DROP_FRACTION * ref:
                    r["status"], r["rule"] = f"dropped: cut off at the scan edge and only {r['volumeMl']:.1f} ml (< 20 % of typical {ref:.0f} ml)", 3
                elif not tr and n_ref[n] >= 3 and r["volumeMl"] < TRUNC_DROP_FRACTION * ref:
                    # only implausibly SMALL complete structures are dropped (fragment-like mislabels); large ones are
                    # kept because enlargement is often real pathology (e.g. splenomegaly, distended gallbladder)
                    r["status"], r["rule"] = f"dropped: implausibly small {r['volumeMl']:.1f} ml (typical {ref:.0f} ml)", 3

    for c in ct_cases:
        c["written"] = 0
        if "st" not in c:
            continue
        se = sidx[c["seriesUid"]][2]
        d = WORK / c["case"]
        for name, r in c["st"]["structures"].items():
            if r["status"] != "ok":
                continue
            tid = f"at-{c['case']}-{slug(name)}"
            g = load_json(d / "contours" / f"{name}.json")
            err = check_geometry(g, se)
            if err:
                problems.append((tid, err))
                r["status"], r["rule"] = f"dropped: geometry check ({err})", 0
                continue
            shutil.copyfile(d / "contours" / f"{name}.json", tdir / f"{tid}.json")
            refs.append({
                "id": tid, "label": structure_label(name, r, c) + (" (partially imaged)" if r["partial"] else ""),
                "classId": f"anatomy:{name}", "seriesUid": c["seriesUid"], "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": SOURCE, "method": METHOD, "note": ct_note(name, r)},
                "completeness": "target_only", "assessedClasses": [f"anatomy:{name}"],
                "unassessedNote": "Atlas outline of this structure only; not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": category(name),
            })
            c["written"] += 1

    # ---------------- CXR
    cx = load_json(WORK / "cxr" / "cxr_cases.json")
    xmeta, cxr_cases = cx["meta"], []
    for c in cx["cases"]:
        row = {**c, "written": 0}
        cxr_cases.append(row)
        if not c.get("case"):
            continue
        d = WORK / "cxr" / c["case"]
        info = load_json(d / "info.json")
        row["info"] = info
        if not c["accepted"]:
            continue
        se = sidx[c["seriesUid"]][2]
        for name, s in info["structures"].items():
            if s["status"] == "ok" and not info["qc"]["sideFromHeader"] and ("_left" in name or "_right" in name):
                # accuracy rule (27 Oct): the side of a left/right structure must be verifiable from the header
                s["status"], s["rule"] = "dropped: side not verifiable (no PatientOrientation in the DICOM header)", 5
            if s["status"] != "ok":
                continue
            tid = f"at-{c['case']}-{slug(name)}"
            g = load_json(d / "contours" / f"{name}.json")
            err = check_geometry(g, se)
            if err:
                problems.append((tid, err))
                s["status"], s["rule"] = f"dropped: geometry check ({err})", 0
                continue
            shutil.copyfile(d / "contours" / f"{name}.json", tdir / f"{tid}.json")
            refs.append({
                "id": tid, "label": Q.clean_label(name), "classId": f"anatomy:{name}", "seriesUid": c["seriesUid"],
                "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": SOURCE, "method": METHOD, "note": cxr_note(name, s, info)},
                "completeness": "target_only", "assessedClasses": [f"anatomy:{name}"],
                "unassessedNote": "Atlas outline of this structure only (radiograph projection); not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": category(name),
            })
            row["written"] += 1

    used_packs = sorted({sidx[r["seriesUid"]][0] for r in refs})
    sources = [{"id": "horalix", "name": "Horalix", "url": "docs/data/anatomy-atlas-report.md", "doi": None,
                "license": "AI-generated drafts for this app; the segmentation tools and their licences are listed in docs/data/anatomy-atlas-report.md",
                "citation": METHOD, "accessNote": "Unreviewed AI drafts; never used for grading."}]
    seen = set()
    for _, _, m in source_manifests():
        for s in m["sources"]:
            if s["id"] not in seen and any(sidx[r["seriesUid"]][2]["subjectKey"].startswith(s["id"] + ":") for r in refs):
                seen.add(s["id"])
                sources.append(s)
    manifest = {
        "schemaVersion": 1, "packId": PACK_ID, "version": VERSION, "title": "Anatomy atlas (AI draft by Horalix)",
        "description": ("Whole-anatomy outlines for the Learn-mode anatomy layer (layer 'atlas'): AI drafts by Horalix on every CT series "
                        f"and every frontal chest radiograph of the {', '.join(used_packs)} packs, after automatic QC. Not reviewed "
                        "by a radiologist; never used for grading. No images: targets reference those packs' series and SOP UIDs."),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "scripts/atlas/write_pack.py",
        "sources": sources, "subjects": [], "studies": [], "series": [], "spatialLinks": [], "referenceTargets": refs,
    }
    with open(OUT_PACK / "pack.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, separators=(",", ":"), ensure_ascii=False)
    total = sum(p.stat().st_size for p in [OUT_PACK / "pack.json", *tdir.glob("*.json")])
    from verify_atlas import laterality_check, verify
    ver = verify()
    bad = [v for v in ver if not v["ok"]]
    lat_n, lat_fail = laterality_check()
    dump_json({"pairsChecked": lat_n, "failures": lat_fail}, WORK / "laterality_check.json")
    bad += [{"laterality": f} for f in lat_fail]
    n_ct = sum(1 for c in ct_cases if c.get("written"))
    n_x = sum(1 for c in cxr_cases if c.get("written"))
    entry = {"id": PACK_ID, "title": "Anatomy atlas (AI draft by Horalix)", "manifest": f"{PACK_ID}/pack.json",
             "lessons": None, "bytes": total, "distribution": "repo" if total < LIMIT_BYTES else "fetch_script",
             "note": (f"AI draft by Horalix (unreviewed) anatomy layer: {len(refs)} structure outlines on {n_ct} CT series and "
                      f"{n_x} frontal chest radiographs, automatic QC applied. No images; requires {', '.join(used_packs)}.")}
    write_report(manifest, ct_cases, cxr_cases, xmeta, total, ver, problems, used_packs, typical, n_ref, visual)
    dump_json(entry, WORK / "index_entry.json")
    if "--no-index" not in argv and not bad:
        idx_path = PACKS_DIR / "index.json"
        idx = load_json(idx_path)
        packs = [p for p in idx["packs"] if p["id"] != PACK_ID]
        pos = next((i for i, p in enumerate(idx["packs"]) if p["id"] == PACK_ID), len(packs))
        packs.insert(pos, entry)
        idx["packs"] = packs
        dump_json(idx, idx_path)
    print(f"{len(refs)} targets, {total / 1e6:.1f} MB, verification failures: {len(bad)}, geometry problems: {len(problems)}")
    print(json.dumps(entry, indent=1))
    if bad:
        for b in bad[:20]:
            print(b)
        sys.exit(1)


def write_report(manifest, ct_cases, cxr_cases, xmeta, total, ver, problems, used_packs, typical, n_ref, visual):
    L = []
    w = L.append
    rep = next(c["tsReport"] for c in ct_cases if "tsReport" in c)
    w("# Anatomy atlas: AI whole-anatomy outlines (unreviewed drafts)")
    w("")
    w(f"_Generated by `scripts/atlas/write_pack.py` at {manifest['generatedAt']}; regenerate with the pipeline in "
      "`scripts/atlas/README.md`. Do not edit by hand._")
    w("")
    w("> Every target in `public/packs/anatomy-atlas/` is an **unreviewed machine proposal**: provenance `ai_draft`, review "
      "`unreviewed`, completeness `target_only`, `layer: \"atlas\"`. In the pack they are branded \"AI draft by Horalix\" "
      "(owner decision); the tools that produced them are listed below. Never used for grading.")
    w("")
    cats, rules = {}, {}
    for t in manifest["referenceTargets"]:
        cats[t["category"]] = cats.get(t["category"], 0) + 1
    for c in ct_cases:
        for n, r in c.get("st", {}).get("structures", {}).items():
            if r["status"] != "ok" and r.get("rule") is not None:
                rules[("CT", r["rule"])] = rules.get(("CT", r["rule"]), 0) + 1
    for c in cxr_cases:
        for n, s in (c.get("info") or {}).get("structures", {}).items():
            if s["status"] != "ok" and s.get("rule") is not None:
                rules[("CXR", s["rule"])] = rules.get(("CXR", s["rule"]), 0) + 1
    w("## Summary")
    w("")
    w(f"- **{len(manifest['referenceTargets'])} targets** on {sum(1 for c in ct_cases if c.get('written'))} CT series and "
      f"{sum(1 for c in cxr_cases if c.get('written'))} frontal chest radiographs (packs: {', '.join(used_packs)}).")
    w(f"- By category: " + ", ".join(f"{k} {v}" for k, v in sorted(cats.items())) + ".")
    w(f"- Size **{total / 1e6:.1f} MB** (pack.json {(OUT_PACK / 'pack.json').stat().st_size / 1e6:.2f} MB + targets), "
      f"{'below' if total < LIMIT_BYTES else 'ABOVE'} the 80 MB repo budget. Douglas-Peucker {CT_DP_TOL_PX:g} px on CT (borders move "
      f"at most 1 pixel), 0.5 px for the pulmonary trunk / arteries and {DP_TOL_PX:g} px on radiographs; minified JSON.")
    w("- Structures dropped by QC rule: " + ", ".join(f"{m} rule {k} ({RULE_NAMES[k]}): {v}" for (m, k), v in sorted(rules.items())) + ".")
    nv = sum(1 for v in ver if v["ok"])
    w(f"- End-to-end verification against the DICOM files (`verify_atlas.py`): {nv}/{len(ver)} targets pass; geometry problems {len(problems)}.")
    lc = load_json(WORK / "laterality_check.json") if (WORK / "laterality_check.json").exists() else None
    if lc:
        w(f"- Pack-level laterality (published outlines → LPS, every left/right pair on the same series): {lc['pairsChecked']} pairs, "
          f"{len(lc['failures'])} on the wrong side.")
    w("")
    w("## Tools (kept out of the pack by owner decision)")
    w("")
    w(f"- CT: TotalSegmentator {rep['totalsegmentator_version']} task `total` (all 117 classes; open task, no licence key), "
      f"full-resolution models, nnU-Net {rep['nnunetv2_version']}, torch {rep['torch_version']} on CPU; licence of each task checked "
      "with the tool's own `--list-tasks` / `registry.requires_license` (only licence-free tasks used). Code Apache-2.0; weights from "
      "the TotalSegmentator GitHub releases. Citation: Wasserthal J et al., Radiol Artif Intell 2023;5(5):e230024.")
    lv_runs = [c for c in ct_cases if (WORK / c["case"] / "ts_report_lungvessels.json").exists()]
    w(f"- Open task `lung_vessels` (Dataset117: airways, lung arteries, lung veins; licence-free per `registry.requires_license`) "
      f"run on {len(lv_runs)} CTs with heart and lungs in the field of view (CPU, about 5 min per CT, the task crops to the lungs "
      "itself). It provides the left / right main bronchi and the mediastinal pulmonary arteries that are split into trunk / right / "
      "left (below). `liver_segments` (open) was not run.")
    carinas = [c for c in ct_cases if "st" in c and (c["st"].get("carina") or {}).get("carinaSliceK") is not None]
    w(f"- Carina rule (rules v11): the whole-body trachea class runs on into the first centimetres of both main bronchi. On "
      f"{len(carinas)} CTs the trachea is cut at the highest slice where its outline is two airways (each ≥ 15 mm², centres ≥ 10 mm "
      "apart, one either side of the trachea's centre on the slice above); that slice and everything below it is never "
      "published as trachea but offered to the main bronchi (airway outside the lobes, assigned by side of the carina; a piece "
      "reaching across the carina is not published). The right outline is named \"Right main bronchus and bronchus "
      "intermedius\" when it reaches more than 25 mm (children 15 mm) below the carina.")
    w(f"- Radiographs: torchxrayvision {xmeta['torchxrayvision']} `baseline_models.chestx_det.PSPNet` (ChestX-Det, 14 structures), "
      "weights from the torchxrayvision GitHub release v1, torch CPU. Library Apache-2.0; the ChestX-Det training-data licence was "
      "not verified for commercial use — check before any commercial distribution.")
    w("- pydicom 3.0.2 (+python-gdcm), SimpleITK 2.5.6, nibabel 5.4.2, scikit-image 0.26.0, scipy 1.18.1, Python 3.12.10; "
      "isolated venvs under `C:/Users/kerim/radiology-data/`, packages from PyPI, usage statistics disabled.")
    w("")
    w("## QC rules")
    w("")
    w("- Rule 0 mapping: CT voxels mapped to LPS through the NIfTI affine vs the DICOM IPP/IOP/PixelSpacing of the matched SOP "
      "(< 0.5 mm); radiographs: rasterised outline vs bilinear-upsampled model output on the original grid (Dice ≥ 0.9).")
    w("- Rule 1 fragments: largest 3D component only (lung lobes ≤ 2, colon ≤ 4, small bowel ≤ 8, duodenum/portal-splenic ≤ 2, "
      "pulmonary veins ≤ 4; extra parts ≥ 5 % of the volume); costal cartilages keep every part ≥ 0.5 ml (≈20 separate "
      "cartilages by anatomy); CT rings/holes < 10 mm² dropped; < 0.3 ml or < 2 slices → dropped. CXR: largest region "
      "(diaphragm ≤ 2), rings < 0.2 % and structures < 0.1 % of the image dropped.")
    w("- Rule 2 density (median HU), owner decisions of 27 Oct: ribs / vertebrae / sternum / sacrum ≥ 100, humerus / femur ≥ 100 "
      "(fatty marrow), scapula / clavicle / hip bone / skull ≥ 150; lung lobes / trachea / main bronchi ≤ −300; soft-tissue organs "
      "and muscles −50…250; SVC, brachiocephalic veins and pulmonary trunk / arteries −50…3000 in contrast studies (undiluted "
      "contrast), −50…250 otherwise; other vessels / kidneys / heart −50…250 (−50…450 with contrast). Hollow organs with gas or "
      "faeces and costal cartilage are not density-checked.")
    w(f"- Rule 3 coverage: a structure reaching the first/last slice (≥ 10 % of its largest slice area there) or the image edge is "
      f"labelled \"(partially imaged)\"; it is dropped if < 20 % of the typical volume (median of complete adult instances in this "
      f"dataset). Complete structures with ≥ 3 reference instances are dropped if < 20 % of typical (no upper limit: enlargement "
      f"is often real pathology). "
      "Paediatric CTs are not compared with adult volumes.")
    w("- Rule 4 order: every left/right pair per shared slice and by 3D centroid (LPS +x = patient left); ribs per slice on the "
      "correct side of the midline (spinal cord, else vertebrae); lateral organs/bones/muscles by 3D centroid; vertebrae C1→S1 "
      "strictly craniocaudal (outliers dropped); aortic parts (ascending anterior + right of descending, arch above both, abdominal "
      "below thoracic); pulmonary parts (trunk left of and not posterior to the ascending aorta and below the arch; right PA "
      "posterior to the ascending aorta and the SVC and right of the trunk; left PA left of the trunk and above the left main "
      "bronchus); colon parts (ascending right of descending); visual checks of rendered parts.")
    w("- Rule 5 (CXR): structure centroid inside the lung bounding box expanded by 25 %; left/right pairs and heart-left-of-spine "
      "checked; when PatientOrientation is absent the note says the side is not verifiable from the header.")
    w("")
    w("## Sub-parts")
    w("")
    w("Aorta → ascending / arch / descending thoracic / abdominal by the two-component rule per axial slice; colon → caecum and "
      "ascending / transverse / descending / sigmoid / rectum by a 3D skeleton walk, only when the whole colon is in the field of "
      "view and one dominant path exists. Visual verification (coronal + sagittal projections with parts coloured) is recorded "
      "below per study.")
    w("")
    w("| case | aorta parts | colon parts / reason | visual check (coronal + sagittal render) |")
    w("|---|---|---|---|")
    for c in ct_cases:
        st = c.get("st")
        if not st:
            continue
        ap = sorted(n for n, r in st["structures"].items() if n.startswith("aorta_") and r["status"] == "ok")
        cp = sorted(n for n, r in st["structures"].items() if (n.startswith("colon_") or n == "rectum") and r["status"] == "ok")
        ainfo = st.get("subparts", {}).get("aorta", {})
        cinfo = st.get("subparts", {}).get("colon", {})
        w(f"| `{c['case']}` | {', '.join(Q.clean_label(n) for n in ap) or '— ' + str(ainfo.get('note', 'no aorta'))} | "
          f"{', '.join(Q.clean_label(n) for n in cp) or '— ' + str(cinfo.get('reason', 'no colon'))} | "
          f"{visual.get(c['case'], {}).get('result', 'not rendered')} |")
    w("")
    w("## Pulmonary trunk and arteries")
    w("")
    w("Source: the licence-free lung-vessel segmentation (lung arteries) restricted to voxels OUTSIDE the lung lobes, i.e. the "
      "mediastinal pulmonary arteries up to the hila; the intrapulmonary branching tree is not published (no clean part labels). "
      "Split: 3D skeleton on a 1.5 mm grid; the most anterior skeleton end is the root (pulmonary valve / outflow), the most right "
      "and most left points are the hilar ends; the shortest paths root→right and root→left share the trunk, the last shared node "
      "is the bifurcation; every voxel takes the label of its nearest path node. Requirements: ≥ 80 % of the skeleton in one piece, "
      "trunk and branches ≥ 10 mm (6 mm in children), bifurcation above the root, hilar ends either side of it. Then the usual QC "
      "(single component, density, laterality, order checks above). Outlines use a 0.5 px simplification.")
    w("")
    w("| case | trunk | right PA | left PA | reason if missing | heart voxels removed (ml) | heart top above highest valve (mm) | visual check |")
    w("|---|---|---|---|---|---|---|---|")
    pa_vis = load_json(WORK / "pa_visual_check.json") if (WORK / "pa_visual_check.json").exists() else {}
    for c in ct_cases:
        st = c.get("st")
        if not st:
            continue
        S = st["structures"]
        mark = lambda n: ("yes" if S.get(n, {}).get("status") == "ok" else ("dropped: " + S[n]["status"].replace("dropped: ", "") if n in S else "—"))
        info = st.get("subpartsPA", {})
        h = st.get("heartSubtraction", {})
        w(f"| `{c['case']}` | {mark('pulmonary_trunk')} | {mark('pulmonary_artery_right')} | {mark('pulmonary_artery_left')} | "
          f"{info.get('reason', '')} | {h.get('voxelsRemoved', '—')} ({h.get('mlRemoved', '—')}) | {h.get('topAboveHighestValveMm', '—')} | "
          f"{pa_vis.get(c['case'], 'not rendered')} |")
    w("")
    w("Heart: for every AI heart the mediastinal pulmonary arteries (trunk + right + left, i.e. everything the lung-artery mask "
      "labels outside the lungs — the heart class also covered the proximal right and left pulmonary arteries), the ascending "
      "aorta and the SVC, each dilated by one voxel, are subtracted before tracing, so no point of those vessels is also \"Heart\". "
      "\"Heart top above highest valve\" = highest heart slice minus the lowest slice of the pulmonary trunk / ascending aorta "
      "(valve level); the remaining few centimetres are left atrium / appendage roof beside the trunk.")
    w("")
    ov_path = WORK / "expert_heart_overlap.json"
    if ov_path.exists():
        w("Expert heart contours (never modified) vs the new AI pulmonary parts — area of each AI part lying inside the expert heart "
          "outline on the same slices (the smaller AI outline wins on hover):")
        w("")
        w("| case | expert target | trunk inside expert heart | right PA inside | left PA inside |")
        w("|---|---|---|---|---|")
        fmt = lambda v: "—" if not v else f"{100 * v['fractionInside']:.0f} % ({v['insideExpertHeartMm2']} of {v['areaMm2']} mm²)"
        for r in load_json(ov_path):
            w(f"| `{r['case']}` | `{r['expertTarget']}` | {fmt(r['parts'].get('pulmonary_trunk'))} | "
              f"{fmt(r['parts'].get('pulmonary_artery_right'))} | {fmt(r['parts'].get('pulmonary_artery_left'))} |")
        w("")
    prev_path = WORK / "prev_status_v4.json"
    if prev_path.exists():
        prev = load_json(prev_path)
        restored = {}
        for c in ct_cases:
            st = c.get("st")
            if not st:
                continue
            for n, r in st["structures"].items():
                pr = prev.get(c["case"], {}).get(n)
                if pr and pr.get("rule") == 2 and r["status"] == "ok":
                    key = ("rib" if n.startswith("rib_") else "vertebra" if n.startswith("vertebrae_") else
                           "vein" if n in ("superior_vena_cava", "brachiocephalic_vein_left", "brachiocephalic_vein_right") else
                           "sternum / sacrum" if n in ("sternum", "sacrum") else "other")
                    restored.setdefault(key, []).append(f"{c['case']}: {Q.clean_label(n)}")
        w("Restored by the 27 Oct density decisions (dropped by rule 2 in the previous build, published now): " +
          "; ".join(f"{k} {len(v)}" for k, v in sorted(restored.items())) + ".")
        w("")
    vv = load_json(WORK / "vein_visual_check.json") if (WORK / "vein_visual_check.json").exists() else {}
    if vv:
        w("Visual check of restored dense-contrast veins (axial slice, wide window): " +
          "; ".join(f"`{k}`: {v}" for k, v in vv.items()) + ".")
        w("")
    w("Intrapulmonary arteries: the lung-vessel task labels arteries and veins as separate classes, so arterial voxels inside the "
      "lungs are assigned to the lobe they lie in (lobe masks of the whole-body segmentation) and published per lobe as "
      "\"... lobe arteries (lobar and segmental)\" — only branches connected to the mediastinal pulmonary arteries (1-voxel gaps "
      "bridged), 0.5 px outlines, rings < 10 mm² dropped (smaller sub-segmental branches are not shown). QC: 100 % inside the lobe by "
      "construction, left/right pair and midline side, median HU −300…3000 (contrast) / −300…250 (partial volume with aerated "
      "lung). The interlobar arteries are NOT separated (no reliable landmark); individual segmental arteries are not named.")
    w("")
    w("## Heart chambers")
    w("")
    w("Model: MONAI model-zoo bundle `wholeBody_ct_segmentation` v0.1.9 (SegResNet, 1.5 mm weights `model.pt`), licence "
      "Apache-2.0 (bundle LICENSE) — trained on the TotalSegmentator dataset, Zenodo record 6802614, CC-BY-4.0 (checked via the "
      "Zenodo API on 27 Oct 2026); both allow commercial use with attribution. Inference on CPU inside the whole-heart box + 30 mm "
      "(10–25 s per CT), preprocessing exactly as the bundle's `inference.json`, result resampled nearest-neighbour onto the CT grid. "
      "Published only when the study is contrast-enhanced AND both ventricles have median ≥ 150 HU and ≥ myocardium + 50 HU. "
      "Per-chamber QC (all must pass): one main component; ≥ 90 % inside the whole-heart mask (+2 voxels); volume (adult RA/LA "
      "20–250 ml, RV/LV 40–350 ml, LV myocardium 60–400 ml; children: lower bound ÷ 5); no overlap > 5 % with another chamber; "
      "RV most anterior; LA most posterior and anterior to the oesophagus and descending aorta, connected to the left atrial "
      "appendage; RA right of the LA and touching the SVC/IVC; LV left of the RV and RA; myocardium covering ≥ 50 % of the LV "
      "surface; density (blood pool −50…3000 HU, myocardium −50…250 HU).")
    w("")
    w("| case | contrast study | opacified blood pool (LV / RV / myocardium median HU) | published | dropped (reason) | visual check |")
    w("|---|---|---|---|---|---|")
    ch_vis = load_json(WORK / "chamber_visual_check.json") if (WORK / "chamber_visual_check.json").exists() else {}
    for c in ct_cases:
        st = c.get("st")
        if not st:
            continue
        ch = st.get("chambers", {})
        med = ch.get("medianHU") or {}
        mh = f"{med.get('heart_ventricle_left')} / {med.get('heart_ventricle_right')} / {med.get('heart_myocardium')}" if med else "—"
        pub = [Q.clean_label(n) for n in ch.get("published", []) if st["structures"].get(n, {}).get("status") == "ok"]
        dropped = {Q.clean_label(n): r["status"].replace("dropped: ", "") for n, r in st["structures"].items()
                   if n.startswith("heart_") and n != "heart" and r["status"] != "ok"}
        w(f"| `{c['case']}` | {st.get('contrast', {}).get('contrastStudy')} | {'yes' if ch.get('opacifiedBloodPool') else 'no'} ({mh}) | "
          f"{', '.join(pub) or '— ' + str(ch.get('reason', ''))[:160]} | {'; '.join(f'{k}: {v}' for k, v in dropped.items()) or '—'} | "
          f"{ch_vis.get(c['case'], 'not rendered')} |")
    w("")
    pc = WORK / "point_check.json"
    if pc.exists():
        w("Point-in-polygon check on Patient I (COVID-19-AR-16434411) — what the viewer's hover reports:")
        w("")
        for r in load_json(pc):
            w(f"- SOP …{r['sop'][-6:]}: point {r.get('point')} falls in {r.get('pointFallsIn')} → hover shows "
              f"**{r.get('hoverWouldShow')}**. Structures on this slice: {', '.join(r['structuresOnSlice'])}.")
        w("")
    w("## Per study")
    w("")
    w("| case | pack | patient id | modality | written | by category | dropped by QC (rule: structures) |")
    w("|---|---|---|---|---|---|---|")
    for c in ct_cases:
        st = c.get("st")
        if not st:
            w(f"| `{c['case']}` | {c['packId']} | {c['subjectKey'].split(':')[-1]} | CT | 0 | — | {c.get('reason', 'not processed')} |")
            continue
        okn = [n for n, r in st["structures"].items() if r["status"] == "ok"]
        bycat = {}
        for n in okn:
            bycat[category(n)] = bycat.get(category(n), 0) + 1
        drops = {}
        for n, r in st["structures"].items():
            if r["status"] != "ok":
                drops.setdefault(r.get("rule"), []).append(f"{Q.clean_label(n)} ({r['status'].replace('dropped: ', '')})")
        dtxt = "<br>".join(f"rule {k}: " + "; ".join(v) for k, v in sorted(drops.items(), key=lambda kv: (kv[0] is None, kv[0]))) or "—"
        w(f"| `{c['case']}` | {c['packId']} | {c['subjectKey'].split(':')[-1]} | CT ({c['info']['shape_ijk'][2]} slices) | {len(okn)} | "
          f"{', '.join(f'{k} {v}' for k, v in sorted(bycat.items()))} | {dtxt} |")
    for c in cxr_cases:
        i = c.get("info")
        if not c.get("case"):
            w(f"| — | {c['packId']} | {c['subjectKey'].split(':')[-1]} | CR/DX lateral | 0 | — | skipped (lateral view) |")
            continue
        okn = [n for n, s in i["structures"].items() if s["status"] == "ok"] if c["accepted"] else []
        bycat = {}
        for n in okn:
            bycat[category(n)] = bycat.get(category(n), 0) + 1
        drops = [f"rule {s.get('rule')}: {Q.clean_label(n)} ({s['status'].replace('dropped: ', '')})" for n, s in i["structures"].items() if s["status"] != "ok"]
        if not c["accepted"]:
            drops = [c["reason"]]
        w(f"| `{c['case']}` | {c['packId']} | {c['subjectKey'].split(':')[-1]} | {i['modality']} frontal | {len(okn)} | "
          f"{', '.join(f'{k} {v}' for k, v in sorted(bycat.items()))} | {'<br>'.join(drops) or '—'} |")
    w("")
    w("## Radiograph preprocessing per image")
    w("")
    w("| case | view evidence | photometric | VOI handling | flip | pad (top, left) / square | side from header |")
    w("|---|---|---|---|---|---|---|")
    for c in cxr_cases:
        i = c.get("info")
        if not i:
            continue
        t = i["transform"]
        w(f"| `{c['case']}` | {c['viewEvidence']} | {i['photometric']} | {i['voi']} | "
          f"{'H' if t['flipH'] else ''}{'V' if t['flipV'] else ''}{'none' if not (t['flipH'] or t['flipV']) else ''} | "
          f"({t['padTop']}, {t['padLeft']}) / {t['square']} | {i['qc']['sideFromHeader']} |")
    w("")
    w("Mapping back: 512-grid coordinate m → original pixel (m + 0.5)·S/512 − 0.5 − pad (pixel-centre convention, as skimage "
      "resize / torch `align_corners=False`), flips undone; vertices in the padding clamped to the image edge.")
    w("")
    w("## Known limitations")
    w("")
    w("- Unreviewed machine outlines: rib/vertebra numbering can be off by one level, bowel loops can be confused, structures at "
      "the edge of the field of view are partial. QC catches flips, slice mix-ups, gross mislabels and fragments, not subtle "
      "boundary errors.")
    w("- Radiograph outlines are projection regions at the model's 512-pixel resolution (about 4–6 original pixels per edge).")
    if problems:
        w(f"- Geometry problems (not written): {problems}")
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(sys.argv)
