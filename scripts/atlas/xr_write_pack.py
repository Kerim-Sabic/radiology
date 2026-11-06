"""Radiograph anatomy layer, round 3: public/packs/anatomy-atlas-xr (the CT atlas is at its 80 MB budget, and existing
packs are never rebuilt, so the radiographs of later packs get their own pack with the same contract).

  RADIOLOGY_ATLAS_PACKS=cxr-findings,cxr-findings-2,cxr-findings-3 RADIOLOGY_ATLAS_WORK=C:/Users/kerim/radiology-data/work/atlas-xr \\
    $XRV scripts/atlas/cxr_segment.py                    # frontal chest films -> WORK/cxr/<case>/
  ... $XRV scripts/atlas/xr_render.py                     # sheets for the visual check -> WORK/cxr_sheets/
  ... $XRV scripts/atlas/xr_write_pack.py [--no-index]    # pack + docs/data/anatomy-atlas-xr-report.md + index entry

Same rules as the CT atlas's radiograph part (write_pack.py): largest region, area against the typical size of the
structure (a fragment under 20 % of it is dropped), inside the thorax box, left/right only where PatientOrientation
lets the side be checked, outline-vs-model Dice; plus a visual check of every film (WORK/xr_visual_check.json): a film
that was not looked at is not published. Every target: layer atlas, ai_draft, unreviewed, target_only, source Horalix.
"""
from __future__ import annotations

import shutil
import sys
from datetime import datetime, timezone
from statistics import median

import qc_rules as Q
from common import PACKS_DIR, REPO, SOURCE_PACKS, WORK, category, dump_json, load_json, series_index, slug, source_manifests
from write_pack import METHOD, REVIEW, SOURCE, check_geometry, cxr_note

PACK_ID = "anatomy-atlas-xr"
VERSION = "0.1.0"
OUT = PACKS_DIR / PACK_ID
REPORT = REPO / "docs" / "data" / "anatomy-atlas-xr-report.md"
LIMIT_BYTES = 30_000_000
# Paired structures on films whose side is not recorded: one class without a side (notes and colours key on it).
SIDELESS = {"clavicula": "clavicle"}


def main(argv):
    assert WORK.name == "atlas-xr", f"RADIOLOGY_ATLAS_WORK must point at the atlas-xr work folder, not {WORK}"
    sidx = series_index()
    tdir = OUT / "targets"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True)
    visual = load_json(WORK / "xr_visual_check.json") if (WORK / "xr_visual_check.json").exists() else {}
    cx = load_json(WORK / "cxr" / "cxr_cases.json")
    sizes = {}
    for c in cx["cases"]:
        if c.get("case") and c.get("accepted"):
            for name, s in load_json(WORK / "cxr" / c["case"] / "info.json")["structures"].items():
                if s["status"] == "ok" and s.get("areaFraction"):
                    sizes.setdefault(name, []).append(s["areaFraction"])
    typical = {n: float(median(v)) for n, v in sizes.items() if len(v) >= 5}
    refs, rows, problems = [], [], []
    for c in cx["cases"]:
        row = {**c, "published": [], "dropped": {}}
        rows.append(row)
        if not c.get("case") or not c["accepted"]:
            continue
        d = WORK / "cxr" / c["case"]
        info = load_json(d / "info.json")
        vis = visual.get(c["case"])
        row["visual"] = vis.get("verdict") if vis else "not inspected"
        se = sidx[c["seriesUid"]][2]
        for name, s in info["structures"].items():
            if s["status"] == "ok" and name in typical and s.get("areaFraction", 1) < 0.2 * typical[name]:
                s["status"] = f"dropped: fragment ({s['areaFraction']:.4f} of the image vs typical {typical[name]:.4f})"
            if s["status"] == "ok" and not vis:
                s["status"] = "not published: film not visually checked"
            if s["status"] == "ok" and (name in vis.get("drop", []) or vis.get("dropAll")):
                s["status"] = f"dropped: visual check ({vis.get('why', {}).get(name, vis.get('verdict'))})"
            if s["status"] != "ok":
                row["dropped"][Q.clean_label(name)] = s["status"]
                continue
            tid = f"atx-{c['case']}-{slug(name)}"
            g = load_json(d / "contours" / f"{name}.json")
            err = check_geometry(g, se)
            if err:
                problems.append((tid, err))
                continue
            shutil.copyfile(d / "contours" / f"{name}.json", tdir / f"{tid}.json")
            cls, label, note = f"anatomy:{name}", Q.clean_label(name), cxr_note(name, s, info)
            if not info["qc"]["sideFromHeader"] and ("_left" in name or "_right" in name):
                # The file does not record the patient's side (no PatientOrientation): the structure is named by its place
                # on the image, never as the patient's left or right.
                base = name.rsplit("_", 1)[0]
                xs = [q[0] for pl in g["planes"] for ring in pl["polygons"] for q in ring]
                on = "left" if sum(xs) / len(xs) < se["geometry"]["columns"] / 2 else "right"
                cls = f"anatomy:{SIDELESS.get(base, base)}"
                label = f"{Q.clean_label(base + '_left').replace('Left ', '').replace(' left', '').strip().capitalize()}, image {on}"
                note = (f"Unreviewed AI proposal. QC passed: largest region kept; area {100 * s['areaFraction']:.1f}% of the image; "
                        f"inside the thorax box; outline matches the model output (Dice {s['diceVsUpsampledMask']:.3f}). This film's file "
                        "does not record the patient's side (no PatientOrientation), so the structure is named by its place on the "
                        "image; a PA film is shown by convention with the patient's right on the image left.")
            refs.append({
                "id": tid, "label": label, "classId": cls, "seriesUid": c["seriesUid"],
                "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": SOURCE, "method": METHOD, "note": note},
                "completeness": "target_only", "assessedClasses": [cls],
                "unassessedNote": "Atlas outline of this structure only (radiograph projection); not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": category(name),
            })
            row["published"].append(label)
    assert not problems, problems
    used = sorted({sidx[r["seriesUid"]][0] for r in refs})
    sources = [{"id": "horalix", "name": "Horalix (horalix.com)", "url": "https://horalix.com", "doi": None,
                "license": "AI-generated drafts for this app; the segmentation tools and their licences are listed in docs/data/anatomy-atlas-xr-report.md",
                "citation": "Thanks to Horalix.com, every structure in the anatomy layer is marked. The outlines are AI, not reviewed by a radiologist.",
                "accessNote": "Unreviewed AI drafts; never used for grading."}]
    seen = {"horalix"}
    for pid, _, m in source_manifests():
        if pid in used:
            for s in m["sources"]:
                if s["id"] not in seen:
                    seen.add(s["id"])
                    sources.append(s)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"schemaVersion": 1, "packId": PACK_ID, "version": VERSION, "title": "Anatomy atlas, radiographs (AI)",
                "description": ("Anatomy outlines for the Learn-mode anatomy layer (layer 'atlas') on the frontal chest radiographs of "
                                f"{', '.join(used)}: lungs, heart, aorta, mediastinum, trachea, spine, hila, clavicles and "
                                "scapulae (paired structures named by their place on the image where the file does not record the side), after automatic QC and a visual check of every film. Not reviewed by a radiologist; never used "
                                "for grading. No images: targets reference those packs' series and SOP UIDs."),
                "generatedAt": now, "generator": "scripts/atlas/xr_write_pack.py", "sources": sources, "subjects": [], "studies": [],
                "series": [], "spatialLinks": [], "referenceTargets": refs}
    dump_json(manifest, OUT / "pack.json")
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    assert total < LIMIT_BYTES, total
    write_report(rows, refs, total, now, cx["meta"], typical, used)
    if "--no-index" not in argv:
        idx_path = PACKS_DIR / "index.json"
        idx = load_json(idx_path)
        entry = {"id": PACK_ID, "title": manifest["title"], "manifest": f"{PACK_ID}/pack.json", "lessons": None, "bytes": total,
                 "distribution": "repo",
                 "note": (f"AI anatomy layer for radiographs (unreviewed): {len(refs)} outlines on {len({r['seriesUid'] for r in refs})} "
                          f"frontal chest radiographs, automatic QC and a visual check applied. No images; requires {', '.join(used)}.")}
        idx["packs"] = [entry if e["id"] == PACK_ID else e for e in idx["packs"]]
        if not any(e["id"] == PACK_ID for e in idx["packs"]):
            idx["packs"].append(entry)
        dump_json(idx, idx_path)
    print(f"{PACK_ID}: {len(refs)} targets on {len({r['seriesUid'] for r in refs})} films, {total / 1e6:.2f} MB")


def write_report(rows, refs, total, now, meta, typical, used):
    films = [r for r in rows if r.get("case")]
    pub = [r for r in films if r["published"]]
    L = ["# Anatomy atlas, radiographs: AI outlines (unreviewed drafts)\n",
         f"_Generated by `scripts/atlas/xr_write_pack.py` at {now}. Do not edit by hand._\n",
         "> Every target in `public/packs/anatomy-atlas-xr/` is an **unreviewed machine proposal** (`ai_draft`, `unreviewed`, "
         "`target_only`, layer `atlas`), credited to Horalix in the app; the tool is named only here. Never used for grading.\n",
         "## Summary\n",
         f"- {len(refs)} outlines on {len(pub)} frontal chest radiographs of {', '.join(used)}; {total / 1e6:.2f} MB.",
         f"- Films seen: {len(films)}; frontal accepted: {sum(1 for r in films if r['accepted'])}; skipped: "
         f"{sum(1 for r in rows if not r.get('accepted'))} (lateral views and films the model did not read as a frontal chest).", "",
         "## Tool\n",
         f"- torchxrayvision {meta.get('torchxrayvision')} (Apache-2.0), `chestx_det.PSPNet` (ChestX-Det, 14 structures; weights "
         "`pspnet_chestxray_best_model_4.pth` from the library's GitHub release v1), torch "
         f"{meta.get('torch')}. Same preprocessing, mapping back and QC as the CT atlas's radiographs "
         "(`scripts/atlas/cxr_segment.py`, documented there).", "",
         "## QC\n",
         "- Largest region per structure; inside the thorax box; area at least 20 % of the structure's typical share of the "
         "image (" + ", ".join(f"{k} {v:.3f}" for k, v in sorted(typical.items())) + "); heart left of the spine; outline vs "
         "model output Dice; a visual check of every film (`xr_render.py`, `WORK/xr_visual_check.json`). Where the DICOM header "
         "has no PatientOrientation (every film here), the side of a paired structure cannot be checked from the file, so lungs, "
         "hila, clavicles and scapulae are published without a side, named by their place on the image (\"Lung, image left\"); "
         "the model's 'diaphragm' region covers everything below the domes and is not published.", "",
         "## Per film\n", "| film | pack | published | dropped / not shown | visual check |", "|---|---|---|---|---|"]
    for r in films:
        dropped = "; ".join(f"{k}: {v}" for k, v in r["dropped"].items()) or (r.get("reason") or "-")
        L.append(f"| `{r['case']}` | {r['packId']} | {len(r['published'])} | {dropped} | {r.get('visual', '-')} |")
    L += ["", "## Not covered\n",
          "- Lateral chest radiographs and the wrist, hand, knee and other limb radiographs: see "
          "`docs/data/anatomy-expansion-plan.md` (round 3) for the models looked at and why they are not outlined.", ""]
    REPORT.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    assert SOURCE_PACKS != ["starter"], SOURCE_PACKS
    main(sys.argv)
