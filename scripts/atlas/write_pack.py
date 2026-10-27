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
VERSION = "0.2.0"
REVIEW = {"status": "unreviewed", "reviewer": None, "at": None, "note": None}
SOURCE = "Horalix"
METHOD = "AI draft by Horalix \u2014 automatic segmentation, not reviewed by a radiologist"
LIMIT_BYTES = 60_000_000
RULE_NAMES = {0: "mapping/alignment", 1: "fragments / too small", 2: "density (HU)", 3: "coverage / volume",
              4: "laterality / anatomical order", 5: "CXR area / thorax box / side"}
TRUNC_DROP_FRACTION = 0.20
VOLUME_MAX_FACTOR = 4.0
NO_VOLUME_CHECK = ("kidney_cyst_",)


def is_pediatric(subject_key: str) -> bool:
    return "Pediatric" in subject_key


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
        parts.append(oc["check"])
    parts.append("partially imaged (cut at the scan edge)" if r.get("partial") else "complete in the field of view")
    if r.get("volumeRef"):
        parts.append(f"{r['volumeMl']:.0f} ml vs typical {r['volumeRef']:.0f} ml")
    return "Unreviewed AI proposal. QC passed: " + "; ".join(parts) + "."


def cxr_note(name, s, info):
    side = info["qc"]["sideFromHeader"]
    lr = ("left/right checked against PatientOrientation " + "\\".join(info["patientOrientation"]) if side
          else "side not verifiable from header (no PatientOrientation); heart-left-of-spine check passed")
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
                elif not tr and n_ref[n] >= 3 and (r["volumeMl"] < TRUNC_DROP_FRACTION * ref or r["volumeMl"] > VOLUME_MAX_FACTOR * ref):
                    r["status"], r["rule"] = f"dropped: implausible volume {r['volumeMl']:.1f} ml (typical {ref:.0f} ml)", 3

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
                "id": tid, "label": Q.clean_label(name) + (" (partially imaged)" if r["partial"] else ""),
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
    from verify_atlas import verify
    ver = verify()
    bad = [v for v in ver if not v["ok"]]
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
      f"{'below' if total < LIMIT_BYTES else 'ABOVE'} the 60 MB repo budget. Douglas-Peucker {CT_DP_TOL_PX:g} px on CT (raised from "
      f"0.5 px to stay under the budget; borders move at most 1 pixel) and {DP_TOL_PX:g} px on radiographs; minified JSON.")
    w("- Structures dropped by QC rule: " + ", ".join(f"{m} rule {k} ({RULE_NAMES[k]}): {v}" for (m, k), v in sorted(rules.items())) + ".")
    nv = sum(1 for v in ver if v["ok"])
    w(f"- End-to-end verification against the DICOM files (`verify_atlas.py`): {nv}/{len(ver)} targets pass; geometry problems {len(problems)}.")
    w("")
    w("## Tools (kept out of the pack by owner decision)")
    w("")
    w(f"- CT: TotalSegmentator {rep['totalsegmentator_version']} task `total` (all 117 classes; open task, no licence key), "
      f"full-resolution models, nnU-Net {rep['nnunetv2_version']}, torch {rep['torch_version']} on CPU; licence of each task checked "
      "with the tool's own `--list-tasks` / `registry.requires_license` (only licence-free tasks used). Code Apache-2.0; weights from "
      "the TotalSegmentator GitHub releases. Citation: Wasserthal J et al., Radiol Artif Intell 2023;5(5):e230024.")
    w("- Open task `lung_vessels` (airways, lung arteries/veins) was timed on one CT: 478 s on CPU while two other "
      "segmentations ran (about 4–5 min alone). Running it on all ~40 CTs was judged not reasonable on CPU, so it was kept "
      "only for that CT (`ar-16434411`: main bronchi and pulmonary arteries); `liver_segments` (open) was skipped for the same reason.")
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
    w("- Rule 2 density (median HU): ribs/vertebrae/flat bones ≥ 150, humerus/femur ≥ 100 (fatty marrow cavity — deliberate "
      "class-specific deviation from the 150 HU example), lung lobes/trachea/main bronchi ≤ −300, soft-tissue organs and "
      "muscles −50…250, vessels/kidneys/heart −50…250 (−50…450 in contrast studies). Hollow organs with gas or "
      "faeces (stomach, bowel, colon parts, bladder, oesophagus) and costal cartilage are not density-checked. Note: veins "
      "carrying undiluted contrast (often > 600 HU) are dropped by this rule.")
    w(f"- Rule 3 coverage: a structure reaching the first/last slice (≥ 10 % of its largest slice area there) or the image edge is "
      f"labelled \"(partially imaged)\"; it is dropped if < 20 % of the typical volume (median of complete adult instances in this "
      f"dataset). Complete structures with ≥ 3 reference instances are dropped if < 20 % or > {VOLUME_MAX_FACTOR:g}× typical. "
      "Paediatric CTs are not compared with adult volumes.")
    w("- Rule 4 order: every left/right pair per shared slice and by 3D centroid; ribs per slice on the correct side of the "
      "midline (spinal cord, else vertebrae); lateral organs/bones/muscles by 3D centroid; vertebrae C1→S1 strictly "
      "craniocaudal (outliers dropped); aortic parts (ascending anterior + right of descending, arch above both, abdominal below "
      "thoracic) and colon parts (ascending right of descending).")
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
