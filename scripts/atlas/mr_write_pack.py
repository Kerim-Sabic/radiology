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
LIMIT_BYTES = 45_000_000
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
    rows_brain = []
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
    # ---- brain anatomy (GOUHFI 2.0) on the brain MRIs
    bvisual = load_json(WORK_MR / "brain_visual_check.json") if (WORK_MR / "brain_visual_check.json").exists() else {}
    coarse_fail = coarse_failures()
    brows = []
    for c in load_json(WORK_MR / "mr_cases.json"):
        d = WORK_MR / c["case"]
        if not (c["eligible"] and not c["tof"] and (d / "brain_structures.json").exists()):
            continue
        st = load_json(d / "brain_structures.json")
        pid, se = series[st["seriesUid"]]
        head = st["segmentedOn"]
        vis = bvisual.get(head, {})
        brow = {"case": c["case"], "pack": pid, "segmentedOn": head, "published": [], "dropped": {}, "csf": st["checks"].get("csfSignal"),
                "visual": vis.get("verdict", "not inspected")}
        if se["description"].upper().startswith("ADC"):
            brow["note"] = "ADC map: outlines shown on its DWI partner (same grid) only"
            brows.append(brow)
            continue
        if not vis:
            brow["note"] = "not published: not visually checked"
            brows.append(brow)
            continue
        g0 = se["geometry"]
        coarse = max([*g0["pixelSpacing"], g0.get("sliceSpacing") or 0]) > COARSE_MM
        for cid, s in sorted(st["structures"].items()):
            if s["status"] != "ok":
                brow["dropped"][s["label"]] = s["status"]
                continue
            group = cid.rsplit("_", 1)[0] if cid.endswith(("_left", "_right")) else cid
            if coarse and group in coarse_fail:
                brow["dropped"][s["label"]] = f"dropped: rule 6, {coarse_fail[group]}"
                continue
            if cid in vis.get("drop", []) or vis.get("dropAll"):
                brow["dropped"][s["label"]] = f"dropped: visual check ({vis.get('why', {}).get(cid, vis.get('verdict', 'looked wrong'))})"
                continue
            g = load_json(d / "brain_geom" / f"{cid}.json")
            bad = check_geometry(g, se)
            if bad:
                problems.append((c["case"], cid, bad))
                continue
            tid = f"atmr-{c['case']}-{cid.replace('_', '-')}"
            dump_json_compact(g, tdir / f"{tid}.json")
            parts = [f"{s['volumeMl']:.1f} ml in one connected part"]
            if s.get("sideShare") is not None:
                parts.append(f"{100 * s['sideShare']:.0f}% on its side of the midline")
            if st["checks"].get("csfSignal") and cid.endswith(("ventricle_left", "ventricle_right")) or cid in ("third_ventricle", "fourth_ventricle"):
                cs = st["checks"].get("csfSignal") or {}
                if cs.get("expected"):
                    parts.append(f"ventricles {cs['expected']} against white matter as expected on this sequence")
            parts.append("partially imaged (cut at the scan edge)" if s.get("partial") else "complete in the field of view")
            parts.append("outline matches the mask (Dice %.3f)" % s["traceDice"])
            if head != c["case"]:
                parts.append("segmented on the ADC map of the same acquisition")
            refs.append({
                "id": tid, "label": s["label"], "classId": f"anatomy:{cid}", "seriesUid": se["uid"], "geometryType": "contour_set",
                "geometryFile": f"targets/{tid}.json", "provenance": "ai_draft",
                "provenanceDetail": {"source": SOURCE, "method": METHOD, "note": "Unreviewed AI proposal. QC passed: " + "; ".join(parts) + "."},
                "completeness": "target_only", "assessedClasses": [f"anatomy:{cid}"],
                "unassessedNote": "Atlas outline of this structure only; not reviewed; never used for grading.",
                "review": dict(REVIEW), "layer": "atlas", "category": "organ",
            })
            brow["published"].append(s["label"])
        brows.append(brow)
    rows_brain[:] = brows
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
                                "of Willis on the time-of-flight MR angiograms (A1/A2, P1/P2 and M1/M2 where the junction is seen) and "
                                "the brain's lobes, central-sulcus gyri, ventricles, deep grey nuclei, hippocampus, amygdala, brainstem and "
                                "cerebellum on the brain MRIs of " + ", ".join(MR_SOURCE_PACKS) + ", after automatic QC and a visual "
                                "check of every case. "
                                "Not reviewed by a radiologist; never used for grading. No images: targets reference those packs' series "
                                "and SOP UIDs."),
                "generatedAt": now, "generator": "scripts/atlas/mr_write_pack.py", "sources": sources, "subjects": [], "studies": [],
                "series": [], "spatialLinks": [], "referenceTargets": refs}
    dump_json(manifest, OUT_PACK_MR / "pack.json")
    total = sum(p.stat().st_size for p in OUT_PACK_MR.rglob("*") if p.is_file())
    assert total < LIMIT_BYTES, total
    write_report(rows, refs, total, now, rows_brain)
    if "--no-index" not in argv:
        idx_path = PACKS_DIR / "index.json"
        idx = load_json(idx_path)
        entry = {"id": PACK_ID, "title": manifest["title"], "manifest": f"{PACK_ID}/pack.json", "lessons": None, "bytes": total,
                 "distribution": "repo",
                 "note": (f"AI anatomy layer for MRI (unreviewed): {len(refs)} outlines (Circle-of-Willis arteries on MR angiograms, brain "
                          f"structures on brain MRIs) on {len({r['seriesUid'] for r in refs})} MR series, automatic QC and a visual check "
                          f"applied. No images; requires {', '.join(MR_SOURCE_PACKS)}.")}
        idx["packs"] = [entry if e["id"] == PACK_ID else e for e in idx["packs"]]
        if not any(e["id"] == PACK_ID for e in idx["packs"]):
            idx["packs"].append(entry)
        dump_json(idx, idx_path)
    print(f"{PACK_ID}: {len(refs)} targets on {len({r['seriesUid'] for r in refs})} series, {total / 1e6:.2f} MB")


BRAIN_VALIDATION = WORK_MR.parent / "brain-validate" / "validation-summary.json"
# Rule 6 (validation): on grids coarser than COARSE_MM, a structure is shown only if, on the manual-label validation brains
# taken to 2 mm, its median Dice is at least COARSE_MIN_DICE and at least COARSE_MIN_SHARE of what a 2 mm grid allows (the
# manual labels themselves taken to 2 mm and back).
COARSE_MM, COARSE_MIN_DICE, COARSE_MIN_SHARE = 1.5, 0.65, 0.85


def coarse_failures() -> dict[str, str]:
    assert BRAIN_VALIDATION.exists(), "run brain_validate.py first: rule 6 needs the validation"
    v = load_json(BRAIN_VALIDATION)
    out = {}
    for g, d in v["res2"]["diceMedian"].items():
        c = v["res2Ceiling"]["diceMedian"][g]
        if d < COARSE_MIN_DICE or d < COARSE_MIN_SHARE * c:
            out[g] = (f"not shown on grids coarser than {COARSE_MM} mm (validation at 2 mm: Dice {d:.2f}, {100 * d / c:.0f} % of what "
                      f"the grid allows; needs {COARSE_MIN_DICE} and {100 * COARSE_MIN_SHARE:.0f} %)")
    return out


def write_report(rows, refs, total, now, brain_rows=()):
    val = load_json(VALIDATION) if VALIDATION.exists() else None
    cpu = load_json(WORK_MR / "cpu_gpu_check.json") if (WORK_MR / "cpu_gpu_check.json").exists() else None
    L = [f"# Anatomy atlas, MRI: AI outlines (unreviewed drafts)\n",
         f"_Generated by `scripts/atlas/mr_write_pack.py` at {now}; regenerate with the MR steps in `scripts/atlas/README.md`. Do not edit by hand._\n",
         "> Every target in `public/packs/anatomy-atlas-mr/` is an **unreviewed machine proposal**: provenance `ai_draft`, review "
         "`unreviewed`, completeness `target_only`, `layer: \"atlas\"`. In the pack they are branded \"AI draft by Horalix\" (owner "
         "decision); the tools that produced them are listed below. Never used for grading.\n",
         "## Summary\n",
         f"- **{sum(1 for r in refs if r['category'] == 'vessel')} artery outlines** on "
         f"{len({r['seriesUid'] for r in refs if r['category'] == 'vessel'})} time-of-flight MR angiography series and "
         f"**{sum(1 for r in refs if r['category'] == 'organ')} brain structure outlines** on "
         f"{len({r['seriesUid'] for r in refs if r['category'] == 'organ'})} brain MRI series; {total / 1e6:.2f} MB.",
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
    if brain_rows:
        pub = [r for r in brain_rows if r["published"]]
        L += ["", "## Brain anatomy on brain MRI\n",
              f"{sum(len(r['published']) for r in pub)} outlines on {len(pub)} series (ISLES diffusion studies: on the DWI series; the ADC "
              "map of the same acquisition was the input and shares the grid).\n",
              "- Tool: GOUHFI 2.0 (Fortin et al., arXiv:2601.09006; code and weights Apache-2.0, Zenodo 17920473), a contrast- and "
              "resolution-agnostic nnU-Net (ResEnc-L, domain randomisation as SynthSeg), fold 0 of the segmentation model (35 "
              "FreeSurfer-style labels) and of the cortex-parcellation model (62 DKT gyri), run on the two RTX 5080s "
              "(`scripts/atlas/brain_segment.py`, `mr_run_brain.py`). Images that are not skull-stripped were first masked with the brain "
              "class of TotalSegmentator's licence-free `total_mr` task (dilated 2 mm). SynthSeg 2.0 was the first choice; its "
              "weights are only distributed inside FreeSurfer, whose licence is accepted by downloading, so it was not used.",
              "- Structures: frontal, parietal, temporal and occipital lobes (cortex parcels plus the nearest white matter), insula, "
              "cingulate gyrus, precentral and postcentral gyri (the central sulcus between them) and superior temporal gyrus, lateral "
              "ventricles (with temporal horns), third and fourth ventricles, caudate, putamen, globus pallidus, thalamus, hippocampus, "
              "amygdala, brainstem, cerebellar hemispheres. Thin gyri on the 2 mm diffusion grids usually fail the outline check and are "
              "not shown there.",
              "- QC (`mr_brain_contours.py`): mapping and outline-vs-mask (rule 0), largest part and minimum size (rule 1), CSF signal by "
              "sequence instead of HU (rule 2: ventricles darker than white matter on T1, FLAIR and DWI, brighter on T2 and ADC), coverage "
              "(rule 3), side of the midline and anatomical order (rule 4), and next to a tumour outlined by the dataset's experts nothing "
              "within 10 mm is shown, on every series of that patient (rule 5: the anatomy there is displaced and cannot be checked); "
              f"on grids coarser than {COARSE_MM} mm (the diffusion series) a structure is shown only if its validation at 2 mm (below) "
              f"reaches Dice {COARSE_MIN_DICE} and {100 * COARSE_MIN_SHARE:.0f} % of what the grid allows (rule 6: "
              + (", ".join(sorted(coarse_failures())) or "none") + " not shown there); "
              "visual check of every case (`mr_render_brain.py`, `WORK_MR/brain_visual_check.json`).\n"]
        bval = load_json(BRAIN_VALIDATION) if BRAIN_VALIDATION.exists() else None
        if bval:
            L += ["### Validation against manual labels (20 OASIS-TRT-20 brains, Mindboggle-101)\n",
                  "The same code (`scripts/atlas/brain_validate.py`) on the 20 OASIS-TRT-20 T1 brains, whose cortex was labelled by hand "
                  "with the DKT protocol (Klein & Tourville 2012, CC BY 4.0) and whose non-cortical structures were labelled by hand by "
                  "Neuromorphometrics (CMA protocol; CC BY-NC-ND 4.0, used only to measure). The model's authors used these brains only as "
                  "a test set. Lobes are compared on their cortex (the manual maps have no white-matter label); vermis voxels are left "
                  "out of the cerebellar hemispheres. `res2` resamples the T1 to 2 mm first, like the diffusion grids, and is scored on the "
                  "1 mm manual labels. Dice per structure (left and right pooled), median and 10th percentile:\n",
                  "| structure | " + " | ".join(f"{k} median | {k} p10" for k in bval) + " |",
                  "|---|" + "---|---|" * len(bval)]
            for n in next(iter(bval.values()))["diceMedian"]:
                L.append(f"| {n} | " + " | ".join(f"{v['diceMedian'].get(n, '-')} | {v['diceP10'].get(n, '-')}" for v in bval.values()) + " |")
            L.append("")
            L.append("Side swaps (a left structure overlapping the right manual label more than the left): "
                     + ", ".join(f"{k} {v['sideSwaps']}" for k, v in bval.items()) + ".\n")
        bcpu = load_json(WORK_MR / "brain_cpu_gpu_check.json") if (WORK_MR / "brain_cpu_gpu_check.json").exists() else None
        if bcpu:
            L += ["### CPU / GPU spot check (brain)\n", f"{bcpu['text']}\n"]
        L += ["### Per series\n", "| series | pack | segmented on | published | dropped / not shown | CSF check | visual check |", "|---|---|---|---|---|---|---|"]
        for r in brain_rows:
            dropped = "; ".join(f"{k}: {v}" for k, v in r["dropped"].items()) or r.get("note", "-")
            cs = r.get("csf") or {}
            csf = f"{cs.get('expected')} {'ok' if cs.get('ok') else 'FAILED'}" if cs else "-"
            L.append(f"| `{r['case']}` | {r['pack']} | `{r['segmentedOn']}` | {len(r['published'])} | {dropped} | {csf} | {r['visual']} |")
    L += ["", "## Known limitations\n",
          "- Unreviewed machine outlines. Small communicating arteries (Acom, Pcom) are the least reliable: the model may show a thin "
          "Pcom the experts called not seen, or miss one they saw (validation above). Variant questions are graded only on expert labels.",
          "- Only the arteries near the circle are outlined; the vertebral arteries, distal branches and the veins (dural sinuses are "
          "suppressed on TOF) are not.",
          "- Brain outlines follow the scan as it is: tumours, infarcts and enlarged ventricles shift or deform them, and lobar borders "
          "come from the gyral pattern learned by the model, not from sulci traced by a radiologist.", ""]
    REPORT_MR.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
