"""Atlas MR final step: assemble public/packs/anatomy-atlas-mr (pack.json + targets/), verify it against the DICOM series of
the image packs, write docs/data/anatomy-atlas-mr-report.md and merge the pack's entry into public/packs/index.json.

  venv-gpu python scripts/atlas/mr_write_pack.py [--no-index]

Same contract as the CT atlas (write_pack.py): layer "atlas", provenance "ai_draft", review unreviewed, completeness
target_only, a category, a plain anatomical label, provenanceDetail.source "Horalix" and method "AI - automatic
segmentation, not reviewed by a radiologist"; the QC result is in provenanceDetail.note. Tool names appear only in the
scripts and the report. A series that carries expert artery labels (the TopCoW controls of brain-mra) gets no AI artery
outlines: the expert ones are shown there. Structures dropped by the visual check (WORK_MR/cow_visual_check.json) are not
published. lessons.json is never written.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone

from common import PACKS_DIR, dump_json, dump_json_compact, load_json
from mr_common import MR_SOURCE_PACKS, OUT_PACK_MR, REPORT_MR, WORK_MR

PACK_ID = "anatomy-atlas-mr"
VERSION = "0.1.0"
REVIEW = {"status": "unreviewed", "reviewer": None, "at": None, "note": None}
SOURCE = "Horalix"
METHOD = "AI — automatic segmentation, not reviewed by a radiologist"
LIMIT_BYTES = 40_000_000
VALIDATION = WORK_MR.parent / "cow-validate" / "validation-summary.json"


def note_for(s: dict, post: dict, removed: dict | None = None) -> str:
    parts = [f"largest connected part kept ({s['voxels']} voxels, {s['volumeMm3']:.0f} mm3)",
             f"bright flowing-blood signal (score {s['tofSignal']['q']:.2f}, minimum {s['tofSignal']['min']:.2f})"]
    if s["name"][:2] in ("R-", "L-"):
        parts.append(f"on the {'right' if s['name'][0] == 'R' else 'left'} of the midline")
    if s.get("part"):
        jm = post["parts"][s["name"]]["junctionMm"]
        where = {"A": "the anterior communicating artery", "P": "the posterior communicating artery", "M": "the first division of the artery"}
        parts.append(f"{s['part']} split at {where[s['part'][0]]} ({jm:.0f} mm from the origin)")
    if removed and removed.get(s["name"]):
        parts.append("the aneurysm outlined by the experts is left out of this artery")
    parts.append("outline matches the mask (Dice %.3f)" % s["traceDice"])
    parts.append("shown within the Circle-of-Willis region (about 3 cm around it)")
    return "Unreviewed AI proposal. QC passed: " + "; ".join(parts) + "."


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


def main(argv):
    packs = {pid: load_json(PACKS_DIR / pid / "pack.json") for pid in MR_SOURCE_PACKS if (PACKS_DIR / pid / "pack.json").exists()}
    series = {se["uid"]: (pid, se) for pid, m in packs.items() for se in m["series"]}
    expert_series = {t["seriesUid"] for m in packs.values() for t in m["referenceTargets"]
                     if t["classId"].startswith("anatomy:") and t["provenance"] == "source_manual"}
    visual = load_json(WORK_MR / "cow_visual_check.json") if (WORK_MR / "cow_visual_check.json").exists() else {}
    tdir = OUT_PACK_MR / "targets"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True)
    refs, rows, problems = [], [], []
    for c in load_json(WORK_MR / "mr_cases.json"):
        d = WORK_MR / c["case"]
        if not (c["eligible"] and c["tof"] and (d / "cow_structures.json").exists()):
            continue
        st = load_json(d / "cow_structures.json")
        pid, se = series[st["seriesUid"]]
        vis = visual.get(c["case"], {})
        row = {"case": c["case"], "pack": pid, "published": [], "dropped": {}, "notSplit": st["post"].get("notSplit", {}),
               "visual": vis.get("verdict", "not inspected"), "expertSeries": se["uid"] in expert_series, "structures": st["structures"]}
        for s in st["structures"]:
            cid = s["classId"].split(":", 1)[1]
            if s["status"] != "ok":
                row["dropped"][s["label"]] = s["status"]
                continue
            if se["uid"] in expert_series:
                row["dropped"][s["label"]] = "not published: expert labels of this artery are shown on this series"
                continue
            if cid in vis.get("drop", []):
                row["dropped"][s["label"]] = f"dropped: visual check ({vis.get('why', {}).get(cid, 'looked wrong')})"
                continue
            g = load_json(d / "cow_geom" / f"{cid}.json")
            bad = check_geometry(g, se)
            if bad:
                problems.append((c["case"], cid, bad))
                continue
            tid = f"atmr-{c['case']}-{cid.replace('_', '-')}"
            dump_json_compact(g, tdir / f"{tid}.json")
            refs.append({
                "id": tid, "label": s["label"], "classId": s["classId"], "seriesUid": se["uid"], "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": SOURCE, "method": METHOD, "note": note_for(s, st["post"], st.get("aneurysmVoxelsRemoved"))},
                "completeness": "target_only", "assessedClasses": [s["classId"]],
                "unassessedNote": "Atlas outline of this artery only, near the Circle of Willis; not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": "vessel",
            })
            row["published"].append(s["label"])
        rows.append(row)
    assert not problems, problems
    sources = [{"id": "horalix", "name": "Horalix (horalix.com)", "url": "https://horalix.com", "doi": None,
                "license": "AI-generated drafts for this app; the segmentation tools and their licences are listed in docs/data/anatomy-atlas-mr-report.md",
                "citation": "Thanks to Horalix.com, every structure in the anatomy layer is marked. The outlines are AI, not reviewed by a radiologist.",
                "accessNote": "Unreviewed AI drafts; never used for grading."}]
    seen = {"horalix"}
    for m in packs.values():
        for s in m["sources"]:
            if s["id"] not in seen:
                sources.append(s)
                seen.add(s["id"])
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"schemaVersion": 1, "packId": PACK_ID, "version": VERSION, "title": "Anatomy atlas, MRI (AI)",
                "description": ("Anatomy outlines for the Learn-mode anatomy layer (layer 'atlas') on MRI series: the arteries of the Circle "
                                "of Willis on the time-of-flight MR angiograms of " + ", ".join(MR_SOURCE_PACKS) + ", with A1/A2, P1/P2 "
                                "and M1/M2 segments where the junction is seen, after automatic QC and a visual check of every case. "
                                "Not reviewed by a radiologist; never used for grading. No images: targets reference those packs' series "
                                "and SOP UIDs."),
                "generatedAt": now, "generator": "scripts/atlas/mr_write_pack.py", "sources": sources, "subjects": [], "studies": [],
                "series": [], "spatialLinks": [], "referenceTargets": refs}
    dump_json(manifest, OUT_PACK_MR / "pack.json")
    total = sum(p.stat().st_size for p in OUT_PACK_MR.rglob("*") if p.is_file())
    assert total < LIMIT_BYTES, total
    write_report(rows, refs, total, now)
    if "--no-index" not in argv:
        idx_path = PACKS_DIR / "index.json"
        idx = load_json(idx_path)
        entry = {"id": PACK_ID, "title": manifest["title"], "manifest": f"{PACK_ID}/pack.json", "lessons": None, "bytes": total,
                 "distribution": "repo",
                 "note": (f"AI anatomy layer for MRI (unreviewed): {len(refs)} artery outlines on {len({r['seriesUid'] for r in refs})} MR "
                          f"angiography series, automatic QC and a visual check applied. No images; requires {', '.join(MR_SOURCE_PACKS)}.")}
        idx["packs"] = [entry if e["id"] == PACK_ID else e for e in idx["packs"]]
        if not any(e["id"] == PACK_ID for e in idx["packs"]):
            idx["packs"].append(entry)
        dump_json(idx, idx_path)
    print(f"{PACK_ID}: {len(refs)} targets on {len({r['seriesUid'] for r in refs})} series, {total / 1e6:.2f} MB")


def write_report(rows, refs, total, now):
    val = load_json(VALIDATION) if VALIDATION.exists() else None
    cpu = load_json(WORK_MR / "cpu_gpu_check.json") if (WORK_MR / "cpu_gpu_check.json").exists() else None
    L = [f"# Anatomy atlas, MRI: AI outlines (unreviewed drafts)\n",
         f"_Generated by `scripts/atlas/mr_write_pack.py` at {now}; regenerate with the MR steps in `scripts/atlas/README.md`. Do not edit by hand._\n",
         "> Every target in `public/packs/anatomy-atlas-mr/` is an **unreviewed machine proposal**: provenance `ai_draft`, review "
         "`unreviewed`, completeness `target_only`, `layer: \"atlas\"`. In the pack they are branded \"AI draft by Horalix\" (owner "
         "decision); the tools that produced them are listed below. Never used for grading.\n",
         "## Summary\n",
         f"- **{len(refs)} artery outlines** on {len({r['seriesUid'] for r in refs})} time-of-flight MR angiography series; "
         f"{total / 1e6:.2f} MB.",
         f"- Series with expert Circle-of-Willis labels (TopCoW controls in brain-mra) get no AI outlines: "
         f"{sum(1 for r in rows if r['expertSeries'])} series.", ""]
    L += ["## Tools (kept out of the pack by owner decision)\n",
          "- Circle-of-Willis arteries: the TopCoW 2024 winning model of team CLAIM (Charite Berlin; nnU-Net v2 ResEnc-M with the "
          "Skeleton Recall loss, five folds, best and final checkpoints averaged), weights extracted from the organisers' docker "
          "release (Zenodo record 15665435, `Team_CLAIM_topcow_seg.tar.gz`) and run with nnU-Net 2.8.1 / torch 2.11.0+cu128 on "
          "2x RTX 5080 (`scripts/vessels/cow_segment.py`). Checkpoints read with `torch.load(weights_only=True)`. The team's YOLO "
          "locator is not used (its weights need unrestricted unpickling); the circle is located by a first pass of one fold. "
          "Licence: the model is trained on TopCoW data, whose terms are \"Open use. Must provide the source. Use for commercial "
          "purposes requires permission of the data owner.\" (OpenData Swiss); the nnU-Net code is Apache-2.0. Citation: Yang K et al., "
          "Benchmarking the CoW with the TopCoW challenge, arXiv:2312.17670.",
          "- Post-processing and QC: `scripts/vessels/cow_post.py`, `scripts/atlas/mr_contours.py`.", ""]
    L += ["## QC rules\n",
          "- Rule 0 mapping: segmentation grid identical to the NIfTI made from the pack's DICOM (`mr_convert.py`, affine read-back "
          "< 1e-3 mm); sampled voxels NIfTI affine vs DICOM IPP/IOP/PixelSpacing < 0.5 mm (oblique series included); every "
          "published outline re-rasterised and compared with its mask (Dice >= 0.9).",
          "- Rule 1 fragments: labels are kept only inside a teaching box around the circle's landmarks (30 mm lateral to the "
          "carotid termini, 20 mm in front of the Acom, 35 mm behind the basilar top, 25 mm below it, 30 mm above); the largest "
          "connected part of each artery; parts under 3 mm3 or on fewer than 2 slices dropped.",
          "- Rule 2 TOF signal (instead of HU): median signal inside an artery, scored against the head (q = (median - head median) / "
          "(head 99.5th percentile - head median)), at least 0.80 for the main arteries and 0.40 for the communicating arteries and "
          "the third A2 (the lowest expert values were 1.03 and 0.57; calibration below).",
          "- Rule 4 side and contacts: lateral arteries on their side of the midline (centroid, and >= 90 % of voxels; 75 % for a PCA or Pcom, which start at the midline basilar tip); the right "
          "ACA right of the left ACA; each artery joins the ones it must (MCA and ACA their ICA or the Acom, PCA the basilar or its "
          "Pcom, a Pcom both its ICA and PCA, the Acom both ACAs, a third A2 the Acom); otherwise it is not shown.",
          "- Sub-segments: A1/A2 split at the Acom junction, P1/P2 at the Pcom junction (P1 must also reach the basilar), M1/M2 at the "
          "first division of the MCA into two branches of >= 6 mm; geodesic distances inside the mask; no junction, no split.",
          "- Visual check: axial and coronal MIPs of every case with every published outline (`mr_render_cow.py`), recorded in "
          "`WORK_MR/cow_visual_check.json`.", ""]
    if val:
        L += ["## Validation against expert labels (40 TopCoW external-test MRAs)\n",
              "The model was run on the 20 Lausanne and 20 IXI-HH MRAs of the TopCoW release with the same code, then post-processed "
              "like the atlas (`scripts/vessels/cow_validate.py`). Some of these cases were inside the model's training folds (named in "
              "its validation folders); the 'unseen' rows exclude them.\n"]
        for subset in ("unseen", "all"):
            s = val[subset]
            L.append(f"**{subset}** ({s['cases']} cases) - Dice inside the expert ROI (median, min) and confusion (share of AI voxels next "
                     "to a different expert artery and not to the same one; median, max):\n")
            L.append("| artery | Dice median | Dice min | n | confusion median | confusion max |")
            L.append("|---|---|---|---|---|---|")
            for n, dd in s["dicePerArtery"].items():
                cf = s["confusionPerArtery"].get(n, {})
                L.append(f"| {n} | {dd['median']} | {dd['min']} | {dd['n']} | {cf.get('median', '-')} | {cf.get('max', '-')} |")
            L.append("")
            L.append("Communicating arteries shown by the atlas vs seen by the experts: " + "; ".join(
                f"{e}: both {p['bothPresent']}, AI only {p['aiOnly']}, expert only {p['expertOnly']}, neither {p['bothAbsent']}"
                for e, p in s["presence"].items()) + ".\n")
        L.append(f"TOF signal score of the expert masks: {json.dumps(val['qExpert'])}.\n")
        full = VALIDATION.with_name("validation-full.json")
        if full.exists():
            rows_v = load_json(full)["cases"]
            swapped = [r for r in rows_v if sum("side check failed" in v for v in r["dropped"].values()) >= 3]
            L.append(f"On {len(swapped)} of the {len(rows_v)} MRAs ({sum(1 for r in swapped if not r['inTraining'])} of them unseen by the "
                     "model: " + ", ".join(f"`{r['case']}`" for r in swapped) + ") the network named the left and right arteries the "
                     "wrong way round; the side rule removed them, which is why some minimum Dice values are 0. Every published lateral "
                     "artery passed the side rule.\n")
    if cpu:
        L += ["## CPU / GPU spot check\n", f"{cpu['text']}\n"]
    L += ["## Per study\n", "| case | pack | published | dropped / not shown | sub-segments not split | visual check |", "|---|---|---|---|---|---|"]
    for r in rows:
        dropped = "; ".join(f"{k}: {v}" for k, v in r["dropped"].items()) or "-"
        ns = "; ".join(f"{k}: {v}" for k, v in r["notSplit"].items()) or "-"
        L.append(f"| `{r['case']}` | {r['pack']} | {', '.join(r['published']) or '-'} | {dropped} | {ns} | {r['visual']} |")
    L += ["", "## Known limitations\n",
          "- Unreviewed machine outlines. Small communicating arteries (Acom, Pcom) are the least reliable: the model may show a thin "
          "Pcom the experts called not seen, or miss one they saw (validation above). Variant questions are graded only on expert labels.",
          "- Only the arteries near the circle are outlined; the vertebral arteries, distal branches and the veins (dural sinuses are "
          "suppressed on TOF) are not.", ""]
    REPORT_MR.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
