"""Build the round-4 packs (more patients from sources already in use) from the selections made by external_r4.py.

  python scripts/data/build_r4.py <packId>     # one of R4_PACKS below; also upserts public/packs/index.json
  python scripts/data/build_r4.py all
  python scripts/data/build_r4.py index        # refresh the index entries (and QC review notes) after writing the lessons

The packs go through the same code path as build_external.py (wrap_2d / build_series / encode_and_place, mask tracing,
build() writing pack.json, the build-QC JSON and the index entry); this module only adds the round-4 builders and
registers them in build_external.PACKS. Round 1-3 packs are not touched.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
from annotations import REVIEW, _mask_to_rings, split_holes  # noqa: E402
from build_external import (BREAST_SOURCE, CBIS_SOURCE, GRAZ_SOURCE, ISLES_SOURCE, NIH_SOURCE, RAW, SC_SOP_CLASS, US_SOP_CLASS,  # noqa: E402
                            _contour_target, _gray, _place, _us_regions, build_series, log, to_item, wrap_2d)
from external_r4 import BREAST_R4_DROPPED, CBIS_R4_DROPPED, GRAZ_R4_CODES, GRAZ_R4_DROPPED, ISLES_R4_DROPPED, NIH_R4_DROPPED  # noqa: E402

# ---------------------------------------------------------------------- no hints in what the reading room shows
# Study and series descriptions, role notes and display notes are shown while the learner answers, so they must name
# neither the dataset (which hints at the diagnosis) nor the finding. The shared round 1-3 helpers write dataset names
# into them; round 4 rewrites them here, in the DICOM headers (before encoding) and in the series records, and refuses to
# write a pack where any of them still matches LEAK. Provenance stays in pack.json sources, subjects and targets, and in
# the DICOM DerivationDescription.
_NEUTRAL = [
    (re.compile(r"\s*\((?:NIH ChestX-ray14|ISLES 2022|GRAZPEDWRI-DX|CBIS-DDSM|Breast-Lesions-USG)[^)]*\)"), ""),
    (re.compile(r"8-bit PNG release of NIH ChestX-ray14"), "8-bit PNG release"),
    (re.compile(r"\(Breast-Lesions-USG PNG\)"), "(PNG)"),
    (re.compile(r" of an ischemic stroke"), ""),
    (re.compile(r"^MRI brain, stroke$"), "MRI brain"),
    (re.compile(r" from (?:NIH ChestX-ray14|Breast-Lesions-USG|GRAZPEDWRI-DX)"), ""),
    (re.compile(r" from CBIS-DDSM,"), ","),
    (re.compile(r"; acute infarcts are lower"), ""),
]
LEAK = re.compile(r"NIH|ChestX|ISLES|GRAZ|CBIS|DDSM|Breast-Lesions|BrEaST|FracAtlas|HC18|"  # dataset names, case as written
                  r"(?i:stroke|infarct|fractur|carcinoma|cancer|tumou?r|pneumo|effusion|atelecta|cardiomegal|nodule|\bmass|cyst|"
                  r"malignan|benign|ischemi|calcification)")


def _neutral(text: str) -> str:
    for pat, rep in _NEUTRAL:
        text = pat.sub(rep, text)
    return text


def _neutral_item(ds, name):
    for kw in ("StudyDescription", "SeriesDescription"):
        if kw in ds:
            setattr(ds, kw, _neutral(str(ds.get(kw))))
    return _orig_to_item(ds, name)


_orig_to_item = bx.to_item
bx.to_item = _neutral_item  # used by the shared builders (build_nih, isles_series, build_mammo) during a round-4 build
to_item = _neutral_item


def _neutral_records(builder):
    """Wrap a pack builder: neutral role/display notes, then check every text the reading room shows."""
    def run():
        results, targets, geoms, extra = builder()
        for sr, _, _ in results:
            for k in ("roleNote", "displayNote"):
                if sr.record.get(k):
                    sr.record[k] = _neutral(sr.record[k])
            ds = sr.sorted_items[0].ds
            shown = [sr.record.get("description") or "", sr.record.get("roleNote") or "", sr.record.get("displayNote") or "",
                     str(ds.get("StudyDescription", "")), str(ds.get("SeriesDescription", "")),
                     *(str(v) for k, v in (sr.record.get("acquisition") or {}).items() if k in ("SeriesDescription", "StudyDescription"))]
            bad = [s for s in shown if LEAK.search(s)]
            assert not bad, (sr.uid, bad)
        return results, targets, geoms, extra
    return run


def _rings_planes(mask2d: np.ndarray, sop: str) -> dict | None:
    rings = _mask_to_rings(mask2d)
    if not rings:
        return None
    hole = split_holes(rings) if len(rings) > 1 else [False]
    pl = {"sopInstanceUid": sop, "frame": 1,
          "polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
    hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
    if hs:
        pl["holes"] = hs
    return pl if pl["polygons"] else None


# ====================================================================== Breast-Lesions-USG, round 4
def _dx_text(s: str) -> str:
    """'Invasive carcinoma of no special type (NST)&Ductal carcinoma in situ (DCIS)' -> lower-case parts joined by 'and'."""
    parts = [p.strip() for p in str(s).split("&") if p.strip()]
    return " and ".join(p[0].lower() + p[1:] if not p[:2].isupper() else p for p in parts)


def _interp_text(s: str) -> str:
    parts = [p.strip() for p in str(s).split("&") if p.strip() and p.strip() != "Suspicion of malignancy"]
    return " or ".join(p[0].lower() + p[1:] for p in parts)


def build_breast_r4() -> tuple[list, list, list, dict]:
    from PIL import Image
    results, targets, geoms = [], [], []
    sel = json.loads((RAW / "BrEaST" / "selection-r4.json").read_text(encoding="utf-8"))
    for c in sel["cases"]:
        if c["case"] in BREAST_R4_DROPPED:
            continue
        r = c["row"]
        stem = f"case{int(c['case']):03d}"
        rgba = np.asarray(Image.open(RAW / c["files"]["image"]["file"]))
        tinted = rgba.ndim == 3 and not (np.array_equal(rgba[..., 0], rgba[..., 1]) and np.array_equal(rgba[..., 0], rgba[..., 2]))
        a = _gray(rgba, stem, tint_ok=True).astype(np.uint8)
        m = _gray(np.asarray(Image.open(RAW / c["files"]["tumor"]["file"])), stem + "_tumor") > 127
        assert m.shape == a.shape and m.any(), stem
        mm = float(r["Pixel_size"]) * 10.0  # the XLSX data dictionary: "pixel size of the image in centimeters"
        ds = wrap_2d(a, tag="breast-usg", stem=stem, study_key=stem, modality="US", sop_class=US_SOP_CLASS,
                     patient_id=f"BrEaST-{stem}", study_desc="Breast ultrasound", series_desc="Breast ultrasound, B-mode",
                     series_number=1, attrs={"PixelSpacing": [round(mm, 8), round(mm, 8)], "BodyPartExamined": "BREAST",
                                             "SequenceOfUltrasoundRegions": _us_regions(*a.shape, mm),
                                             **({"PatientAge": f"{int(r['Age']):03d}Y"} if str(r["Age"]).isdigit() else {}),
                                             "DerivationDescription": (f"{r['Image_filename']} from Breast-Lesions-USG (cropped B-mode PNG as "
                                                                       "distributed); wrapped as DICOM with the pixel size from the clinical XLSX."
                                                                       + (" The PNG is grey-scale with a slight colour tint (no colour-flow "
                                                                          "data); stored as luma (ITU-R BT.601)." if tinted else ""))})
        skey = f"tcia:Breast-Lesions-USG:{stem}"
        sr = _place(build_series([to_item(ds, stem + ".png")], {"region": "breast", "role": "diagnostic",
                                                                "roleNote": "Breast ultrasound image (Breast-Lesions-USG PNG) wrapped as DICOM."}, skey),
                    ("Cropped B-mode image from Breast-Lesions-USG with the pixel size given by the dataset (true distances in mm); "
                     "no orientation tag, so no orientation letters are shown."))
        biopsy = r["Verification"] == "confirmed by biopsy"
        proof = "biopsy-proven" if biopsy else "benign on follow-up"
        cyst = r["Interpretation"] == "Simple cyst" and not biopsy
        if cyst:
            cid, lab = "finding:breast_cyst", "Breast cyst: simple cyst (radiologist outline; benign on follow-up)"
        elif biopsy:
            cid, lab = "finding:breast_mass", f"Breast mass: {_dx_text(r['Diagnosis'])}, {r['Classification']} ({proof}; radiologist outline)"
        else:
            cid, lab = "finding:breast_mass", f"Breast mass: benign on follow-up (radiologist's impression: {_interp_text(r['Interpretation'])}; radiologist outline)"
        tid = f"breast-usg-{stem}_{'cyst' if cyst else 'mass'}"
        t, g = _contour_target(
            tid, lab, cid, sr, str(ds.SOPInstanceUID), m,
            {"source": "tcia:Breast-Lesions-USG (images_and_masks, clinical XLSX)",
             "method": ("Freehand outline of the lesion by a radiologist experienced in breast ultrasound, who also gave the BI-RADS "
                        f"descriptors (TCIA collection description; Pawłowska et al. 2024); {r['Mask_tumor_filename']} traced into image_px [col, row]."),
             "note": (f"BI-RADS {r['BIRADS']}; shape {r['Shape']}; margin {r['Margin']}; echogenicity {r['Echogenicity']}; posterior "
                      f"features {r['Posterior_features']}; halo {r['Halo']}; calcifications {r['Calcifications']}; signs {r['Signs']}; "
                      f"classification {r['Classification']}; {r['Verification']}; interpretation: {r['Interpretation']}; "
                      f"diagnosis: {r['Diagnosis']}.")},
            (f"{'Biopsy' if biopsy else 'Follow-up'}: {lab.split(': ', 1)[1].rsplit(' (', 1)[0]}. Radiologist's descriptors: {r['Shape']}, "
             f"margin {r['Margin']}, {r['Echogenicity']}, posterior features {r['Posterior_features']}."),
            "Only the lesion is outlined; skin, glandular tissue and any other finding are not referenced.")
        targets.append(t)
        geoms.append(g)
        results.append((sr, skey, {"sourceId": BREAST_SOURCE["id"],
                                   "linkage": f"Case {stem} of Breast-Lesions-USG, which has one scan per patient (256 scans, 256 patients)."}))
    log(f"[us-breast-2] {len(results)} cases")
    return results, targets, geoms, {}


# ====================================================================== ISLES 2022, round 4
def _isles_side(mask: np.ndarray, brain: np.ndarray, affine: np.ndarray) -> dict:
    """Side of the lesion from the mask: each lesion voxel against the midpoint of the brain's extent along its own
    left-right line (same row and slice), in patient LPS (+x = patient left). Returns the share of lesion voxels on the
    left and the median distance from that local midline."""
    lps = np.diag([-1.0, -1.0, 1.0, 1.0]) @ affine
    ii, jj, kk = np.nonzero(mask)
    left = dist = nleft = None
    xs = []
    for i, j, k in zip(ii, jj, kk):
        # the voxel axis that runs most left-right
        ax = int(np.argmax(np.abs(lps[0, :3])))
        line = [slice(None)] * 3
        line[(ax + 1) % 3] = (i, j, k)[(ax + 1) % 3]
        line[(ax + 2) % 3] = (i, j, k)[(ax + 2) % 3]
        idx = np.nonzero(brain[tuple(line)])[0]
        if len(idx) < 10:
            continue
        p = np.array([i, j, k, 1.0])
        lo, hi = p.copy(), p.copy()
        lo[ax], hi[ax] = idx.min(), idx.max()
        mid = ((lps @ lo)[0] + (lps @ hi)[0]) / 2
        xs.append((lps @ p)[0] - mid)
    xs = np.array(xs)
    if len(xs):
        left = float((xs > 0).mean())
        nleft = int((xs > 0).sum())
        dist = float(np.median(np.abs(xs)))
    return {"leftShare": left, "leftVoxels": nleft if len(xs) else None, "medianMidlineMm": dist, "voxels": int(len(xs))}


def build_isles_r4() -> tuple[list, list, list, dict]:
    import nibabel as nib
    sel = json.loads((RAW / "ISLES-2022" / "selection-r4.json").read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for case in sel:
        if case["case"] in ISLES_R4_DROPPED:
            continue
        imgs = {k: nib.load(RAW / case["files"][k]["file"]) for k in ("dwi", "adc", "msk")}
        shapes = {k: v.shape[:3] for k, v in imgs.items()}
        assert len(set(shapes.values())) == 1, (case["case"], shapes)
        assert all(np.allclose(imgs["dwi"].affine, v.affine, atol=1e-4) for v in imgs.values()), f"{case['case']}: DWI/ADC/mask on different grids"
        mask = np.asarray(imgs["msk"].dataobj) > 0
        dwi = np.asarray(imgs["dwi"].dataobj, dtype=np.float64)
        adc = np.asarray(imgs["adc"].dataobj, dtype=np.float64)
        brain = (dwi > 0) & (adc > 0)
        vol = float(mask.sum() * np.prod(imgs["msk"].header.get_zooms()[:3]) / 1000)
        from scipy import ndimage
        _, ncomp = ndimage.label(mask)
        # The centres store ADC in mm2/s, 10^-3 mm2/s or 10^-6 mm2/s: normal brain is about 0.0008 mm2/s, so the brain's
        # median tells the unit unambiguously (the ranges below are three orders of magnitude apart).
        med = float(np.median(adc[brain & ~mask]))
        unit = 1.0 if 1e-4 < med < 5e-3 else 1e3 if 0.1 < med < 5 else 1e6 if 100 < med < 5000 else None
        assert unit is not None, (case["case"], med)
        assert float(adc.max()) / unit * 1e6 < 65535, (case["case"], "ADC outside the 16-bit range")
        adc_lesion = float(np.median(adc[mask & brain])) / unit * 1e6
        adc_brain = med / unit * 1e6
        adc_low = adc_lesion <= 0.8 * adc_brain
        side = _isles_side(mask, brain, imgs["dwi"].affine)
        one_sided = side["leftShare"] is not None and side["medianMidlineMm"] >= 10 and (side["leftShare"] >= 0.99 or side["leftShare"] <= 0.01)
        side_txt = ("left" if side["leftShare"] >= 0.99 else "right") if one_sided else "not one-sided"
        side_json = json.loads((RAW / case["files"]["dwi_json"]["file"]).read_text(encoding="utf-8")) if "dwi_json" in case["files"] else {}
        frame_uid = bx.uid_for("isles", case["case"], "frame")
        skey = f"zenodo:ISLES-2022:{case['case']}"
        fi, fj, *_ = bx._isles_grid(imgs["dwi"])
        for kind in ("dwi", "adc"):
            data = dwi if kind == "dwi" else adc
            items = bx.isles_series(case, kind, imgs[kind], data, side_json, frame_uid, adc_per_mm2s=unit)
            sr = build_series(items, {"region": "head", "role": "diagnostic",
                                      "roleNote": ("Diffusion-weighted MRI" if kind == "dwi" else "Apparent diffusion coefficient map") +
                                                  " of an ischemic stroke (ISLES 2022), converted from NIfTI to DICOM."}, skey)
            _place(sr, ("Converted from the dataset's NIfTI (skull-stripped, resliced to 2 mm by the dataset authors): the "
                        "orientation comes from the NIfTI affine. " + ("Signal in arbitrary units." if kind == "dwi" else
                        "ADC in 10^-6 mm2/s (normal brain is roughly 700-900; acute infarcts are lower).")))
            results.append((sr, skey, {}))
            sop_by_k = {int(it.name.split("-")[1][:3]): str(it.ds.SOPInstanceUID) for it in items}
            planes = []
            for k in range(mask.shape[2]):
                m = bx._isles_slice(mask, k, fi, fj)
                if m.any():
                    pl = _rings_planes(m, sop_by_k[k])
                    if pl:
                        planes.append(pl)
            order = {str(it.ds.SOPInstanceUID): i for i, it in enumerate(sr.sorted_items)}
            planes.sort(key=lambda p: order[p["sopInstanceUid"]])
            num = case["case"].split("-")[1]
            tid = f"isles-{num}_{kind}_ischemic-stroke"
            targets.append({
                "id": tid, "label": "Ischemic stroke lesion (ISLES 2022 expert-approved mask)", "classId": "finding:ischemic_stroke",
                "seriesUid": sr.uid, "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
                "provenanceDetail": {
                    "source": f"zenodo:ISLES-2022 ({case['files']['msk']['member']}, sha256 {case['files']['msk']['sha256'][:16]}...)",
                    "method": ("Hybrid human-algorithm annotation (Hernandez Petzsche et al. 2022): a DWI-trained U-Net pre-segmentation corrected "
                               "by trained annotators (DWI, ADC and FLAIR reviewed), revised by a neuroradiologist in training and approved by "
                               "an attending neuroradiologist with more than 10 years of stroke imaging experience. The mask is on the DWI/ADC grid; "
                               "traced per slice with skimage find_contours (0.5) into image_px [col, row]."),
                    "note": (f"{len(planes)} slices with lesion; mask volume {vol:.1f} ml; {ncomp} connected part(s); median ADC in the mask "
                             f"{adc_lesion:.0f} vs {adc_brain:.0f} x10^-6 mm2/s in the rest of the brain (low ADC {'yes' if adc_low else 'no'}; "
                             f"ADC distributed in {({1.0: 'mm2/s', 1e3: '10^-3 mm2/s', 1e6: '10^-6 mm2/s'})[unit]}); side {side_txt} "
                             f"(lesion voxels left of the local brain midline: {side['leftVoxels']} of {side['voxels']}, median "
                             f"{side['medianMidlineMm']:.1f} mm from it)."),
                },
                "completeness": "target_only",
                "assessedClasses": ["finding:ischemic_stroke"],
                "unassessedNote": ("Only the ischemic lesion is referenced; the vessel occlusion, older lesions and other findings are not "
                                   "outlined. The dataset does not give the time since onset or the affected arterial territory."),
                "review": dict(REVIEW),
                "teachingNote": (f"Ischemic lesion of about {vol:.0f} ml in the mask" + (f" ({ncomp} separate parts)." if ncomp > 1 else ".")
                                 + ((" Restricted diffusion: dark on the ADC map, bright on DWI." if kind == "adc"
                                     else " Restricted diffusion: bright on DWI; check that it is dark on the ADC map.") if adc_low else
                                    (f" Here the median ADC inside the outline ({adc_lesion:.0f}) is not clearly below the rest of the brain "
                                     f"({adc_brain:.0f} x10^-6 mm2/s), so do not expect it to stand out as dark on the ADC map."))),
            })
            geoms.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        log(f"[stroke-mri-2] {case['case']}: {vol:.1f} ml, {ncomp} part(s), ADC {adc_lesion:.0f}/{adc_brain:.0f} unit {unit:g} low {adc_low}, side {side_txt} {side}")
    return results, targets, geoms, {}


R4_PACKS = {
    "us-breast-2": {
        "title": "Breast ultrasound: more lesions proven by biopsy or follow-up",
        "description": ("Breast ultrasound images from Breast-Lesions-USG (one patient each), every lesion outlined freehand by a radiologist "
                        "experienced in breast ultrasound who also recorded its BI-RADS descriptors: malignant lesions proven by biopsy "
                        "(invasive carcinoma of no special type, lobular, mucinous, micropapillary, DCIS and rarer types), benign lesions "
                        "proven by biopsy, and benign lesions confirmed on follow-up. Chosen by rule (one lesion per image, every diagnosis "
                        "represented) and checked by eye with the outline drawn. Cropped 8-bit B-mode frames with their true pixel size."),
        "sources": [BREAST_SOURCE], "builder": build_breast_r4, "budget": 40_000_000,
    },
    "stroke-mri-2": {
        "title": "Stroke MRI: more ischemic lesions on DWI and ADC with expert-approved masks",
        "description": ("Brain MRIs of ischemic stroke from ISLES 2022 (diffusion-weighted images and ADC maps), each with the lesion mask "
                        "approved by an attending neuroradiologist; lesions from about 2 ml to large territorial infarcts, chosen by rule "
                        "across the range of lesion sizes. Converted from the dataset's NIfTI (skull-stripped, 2 mm) to DICOM with the "
                        "geometry taken from the NIfTI affine; DWI and ADC share one frame of reference."),
        "sources": [ISLES_SOURCE], "builder": build_isles_r4, "budget": 80_000_000,
    },
    "cxr-findings-2": {
        "title": "Chest radiograph findings: more pneumothorax, effusion, collapse, big heart, mass, nodule and pneumonia",
        "description": ("Frontal (PA) chest radiographs of adults from NIH ChestX-ray14, one film per patient and none from the first "
                        "chest-findings pack, each with the bounding box a board-certified radiologist drew around the finding. Candidates "
                        "were ranked by rule (box label also in the report labels, fewest other labels, a box that is not tiny) and every "
                        "one was drawn with its box and kept only where the boxed finding is clearly visible. The images are the dataset's "
                        "8-bit 1024 px release: no pixel spacing and no orientation tag."),
        "source": NIH_SOURCE, "builder": lambda: build_nih_r4(), "budget": 60_000_000,
    },
    "peds-wrist-2": {
        "title": "Children's wrist fractures: more Salter-Harris II, torus/greenstick and complete fractures",
        "description": ("Wrist radiographs (frontal and lateral of one initial trauma study) of children from GRAZPEDWRI-DX, the fracture boxed "
                        "on both views in annotations reviewed by pediatric radiologists. One distal radius fracture per child, typed by the "
                        "dataset's AO/OTA pediatric code: Salter-Harris II (E/2), incomplete metaphyseal, torus/buckle or greenstick (M/2), "
                        "and complete metaphyseal (M/3). Studies with a cast, metal, osteopenia or an uncertain diagnosis were excluded."),
        "sources": [GRAZ_SOURCE], "builder": lambda: build_graz_r4(), "budget": 80_000_000,
    },
    "mammo-cbis-2": {
        "title": "Mammography: more masses and calcifications on CC and MLO views",
        "description": ("Screen-film mammograms (CBIS-DDSM, digitised film): the CC and MLO views of one breast of each woman, with a single "
                        "abnormality outlined on both views. Spiculated malignant and circumscribed benign masses (the mass outline), and "
                        "calcifications from fine pleomorphic and fine linear branching (malignant) to lucent-centered and coarse (benign; "
                        "the region outline), with BI-RADS assessment and pathology as the dataset gives them. Chosen by rule (subtlety 4-5, "
                        "same descriptors on both views) and checked by eye with the outline drawn. Downsampled 2x2 for the web; no pixel "
                        "spacing. ImageLaterality, ViewPosition and PatientOrientation are set for hanging."),
        "sources": [CBIS_SOURCE], "builder": lambda: bx.build_mammo("selection-r4.json", skip=CBIS_R4_DROPPED), "budget": 90_000_000,
    },
}


# ====================================================================== NIH ChestX-ray14, round 4
def build_nih_r4() -> tuple[list, list, list, dict]:
    """Same conversion and box targets as the round-1 cxr-findings pack (build_external.build_nih), on the round-4 selection."""
    out = bx.build_nih("selection-r4.json", skip=NIH_R4_DROPPED)
    log(f"[cxr-findings-2] {len(out[0])} radiographs, {len(out[1])} boxes")
    return out


# ====================================================================== GRAZPEDWRI-DX, round 4
GRAZ_KIND = {  # AO/OTA pediatric code -> (classId, label, teaching note)
    "23r-E/2.1": ("finding:physeal_fracture", "Fracture: distal radius, Salter-Harris type II (radiologist box)",
                  "Salter-Harris II: the fracture runs along the growth plate and out through the metaphysis (AO PCCF E/2)."),
    "23r-M/2.1": ("finding:incomplete_fracture", "Fracture: distal radius, incomplete (torus/buckle or greenstick; radiologist box)",
                  "Incomplete metaphyseal fracture (AO PCCF M/2: torus/buckle or greenstick): look for a bulge, kink or break of one cortex."),
    "23r-M/3.1": ("finding:complete_fracture", "Fracture: distal radius, complete metaphyseal (radiologist box)",
                  "Complete metaphyseal fracture (AO PCCF M/3): the line crosses the whole radius, through both cortices, with the growth plate spared."),
}


def build_graz_r4() -> tuple[list, list, list, dict]:
    import csv as _csv
    import zipfile
    from PIL import Image
    results, targets, geoms = [], [], []
    meta = RAW / "GRAZPEDWRI-DX" / "_meta"
    rows = {r["filestem"]: r for r in _csv.DictReader(open(meta / "dataset.csv", encoding="utf-8-sig"))}
    ann = zipfile.ZipFile(meta / "folder_structure.zip")
    for c in json.loads((RAW / "GRAZPEDWRI-DX" / "selection-r4.json").read_text(encoding="utf-8")):
        stem = c["stem"]
        pid, r = stem[:4], rows[stem]
        if str(int(pid)) in GRAZ_R4_DROPPED:
            continue
        ao = r["ao_classification"]
        assert ao in GRAZ_R4_CODES and r["fracture_visible"] == "1" and r["initial_exam"] == "1", stem
        cid, lab, teach = GRAZ_KIND[ao]
        a = np.asarray(Image.open(RAW / c["file"]))
        assert a.ndim == 2 and a.dtype == np.uint16, stem
        a = np.ascontiguousarray(a)
        lat = "frontal" if r["projection"] == "1" else "lateral"
        a_json = json.loads(ann.read(f"supervisely/wrist/ann/{stem}.json"))
        tags = {t if isinstance(t, str) else t["name"] for t in a_json["tags"]}
        assert f"side_{'left' if r['laterality'] == 'L' else 'right'}" in tags, stem
        ds = wrap_2d(a, tag="grazpedwri", stem=stem, study_key=f"{pid}-{r['study_number']}", modality="DX", sop_class=SC_SOP_CLASS,
                     patient_id=f"GRAZPEDWRI-{int(pid):04d}", study_desc="Wrist radiographs (child)",
                     series_desc=f"{'Left' if r['laterality'] == 'L' else 'Right'} wrist, {lat}", series_number=1 if lat == "frontal" else 2,
                     attrs={"ImagerPixelSpacing": [float(r["pixel_spacing"]), float(r["pixel_spacing"])], "ImageLaterality": r["laterality"],
                            "BodyPartExamined": "WRIST", "PatientSex": r["gender"], "PatientAge": f"{int(float(r['age'])):03d}Y",
                            **({"ViewPosition": "AP"} if "projection_ap" in tags else {}),
                            "DerivationDescription": (f"{stem}.png from GRAZPEDWRI-DX (16-bit PNG made by the dataset authors from the "
                                                      "DICOM); pixel spacing from dataset.csv (detector plane).")})
        skey = f"figshare:GRAZPEDWRI-DX:{int(pid)}"
        sr = _place(build_series([to_item(ds, stem + ".png")], {"region": "extremity", "role": "diagnostic",
                                                                "roleNote": f"Pediatric wrist radiograph, {lat} view (GRAZPEDWRI-DX)."}, skey),
                    ("Pediatric wrist radiograph from GRAZPEDWRI-DX (16-bit). Pixel spacing is at the detector, not corrected for "
                     "magnification; no orientation tag, so read the side from the burned-in marker."))
        boxes = [o for o in a_json["objects"] if o["classTitle"] == "fracture"]
        assert len(boxes) == 1, stem
        (x0, y0), (x1, y1) = boxes[0]["points"]["exterior"]
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        tid = f"grazpedwri-{stem[:4]}-{lat}_fracture"
        targets.append({
            "id": tid, "label": lab, "classId": cid, "seriesUid": sr.uid, "geometryType": "box", "geometryFile": f"targets/{tid}.json",
            "provenance": "source_manual",
            "provenanceDetail": {"source": "figshare:GRAZPEDWRI-DX (folder_structure.zip, supervisely annotations; dataset.csv)",
                                 "method": ("Fracture box from the dataset's annotations, which pediatric radiologists reviewed at least twice "
                                            "(Nagy et al. 2022); converted from pixel-corner to pixel-centre coordinates (-0.5 px). The fracture "
                                            "type in the label is read from the AO/OTA pediatric code in dataset.csv (E/2 = Salter-Harris II; "
                                            "M/2 = incomplete, torus/buckle or greenstick; M/3 = complete metaphyseal)."),
                                 "note": f"AO/OTA pediatric code {ao} (dataset.csv); age {r['age']} y, {r['gender']}, side {r['laterality']}."},
            "completeness": "target_only", "assessedClasses": [cid],
            "unassessedNote": "Only the fracture is boxed; the ulna, carpal bones and soft tissues are not referenced.", "review": dict(REVIEW),
            "teachingNote": teach,
        })
        geoms.append({"geometryType": "box", "space": "image_px",
                      "boxes": [{"sopInstanceUid": str(ds.SOPInstanceUID), "frame": 1, "box": [x0 - 0.5, y0 - 0.5, x1 - 0.5, y1 - 0.5]}]})
        results.append((sr, skey, {"sourceId": GRAZ_SOURCE["id"], "ao": ao,
                                   "linkage": f"GRAZPEDWRI-DX patient_id {int(pid)}, study {r['study_number']} (dataset.csv); frontal and lateral views of one study."}))
    log(f"[peds-wrist-2] {len(results)} radiographs")
    return results, targets, geoms, {}


for _cfg in R4_PACKS.values():
    _cfg["builder"] = _neutral_records(_cfg["builder"])
bx.PACKS.update(R4_PACKS)


QC_TOOL = ("scripts/data/qc_render.py <packId> <outDir> [--crop]: decodes the packed DICOM and draws every reference target on it "
           "(contour sets on the image with the largest outlined area), so a shifted, flipped or misplaced outline would show")
R4_QC = {
    "us-breast-2": {
        "selectionRule": ("Breast-Lesions-USG cases not used before, benign or malignant (not normal), one lesion mask per image (no "
                          "'other' masks), proven by biopsy or follow-up, not a scar/implant/duct finding or a risk lesion (LCIS, ALH); "
                          "stratified 45 malignant (biopsy), 35 benign (biopsy), 20 benign (follow-up), round-robin over diagnoses."),
        "review": "All 99 built cases drawn with the radiologist's outline (full image, zoom for the smallest) and checked by eye.",
        "dropped": BREAST_R4_DROPPED,
    },
    "stroke-mri-2": {
        "selectionRule": ("ISLES 2022 cases not used before with a lesion of at least 2 ml on the 2 mm DWI grid (131 of 250), 50 taken "
                          "at even steps across the range of lesion volumes."),
        "review": ("All 50 DWI and 50 ADC outlines drawn on the slice with the largest outlined area and checked by eye against the "
                   "bright DWI signal. ADC units differ between centres (mm2/s, 10^-3 and 10^-6 mm2/s): the unit is read from the brain's "
                   "median ADC and every case is stored in 10^-6 mm2/s. The ADC question is only asked where the median ADC in the mask "
                   "is at most 0.8 x the rest of the brain; the side question only where at least 99% of the mask lies on one side of "
                   "the local brain midline and its median distance from it is 10 mm or more."),
        "dropped": ISLES_R4_DROPPED,
    },
    "cxr-findings-2": {
        "selectionRule": ("NIH ChestX-ray14 PA films of adults (18-90) with a radiologist box whose label is also in the report labels, "
                          "one film per patient, patients of cxr-findings excluded. Pass A ranked like round 1 (fewest other labels, "
                          "box area capped), 104 candidates; pass B ranked by box area (up to a quarter of the film), 92 candidates."),
        "review": ("Every one of the 196 candidates drawn with its boxes (full film and zoom; contrast-equalised crops for subtle "
                   "pneumothoraces, effusions and nodules) and kept only where the boxed finding is clearly visible: 67 kept."),
        "dropped": NIH_R4_DROPPED,
    },
    "peds-wrist-2": {
        "selectionRule": ("GRAZPEDWRI-DX initial-trauma studies with one frontal and one lateral image, the same single distal-radius "
                          "AO/OTA code on both (23r-E/2.1, 23r-M/2.1 or 23r-M/3.1), one fracture box per image, no cast, metal, "
                          "osteopenia or 'diagnosis uncertain'; 10 per code evenly spaced over the patient numbers. Salter-Harris I "
                          "(23r-E/1, 9 studies) left out as too subtle to grade."),
        "review": "All 60 radiographs drawn with the fracture box and checked by eye: every box lies on the distal radius on both views.",
        "dropped": GRAZ_R4_DROPPED,
    },
    "mammo-cbis-2": {
        "selectionRule": ("CBIS-DDSM training-set breasts with CC and MLO, a single abnormality (id 1 only) with the same descriptors on "
                          "both views, subtlety 4-5; 4 irregular spiculated malignant masses, 3 oval circumscribed benign masses, 2 "
                          "pleomorphic clustered and 1 fine linear branching malignant calcifications, 1 lucent-centered and 1 coarse "
                          "benign calcifications; women of mammo-cbis and the films rejected in round 3 excluded."),
        "review": ("Chest-wall side of every film checked against the recorded laterality (build_mammo asserts it), then all 22 kept "
                   "outlines drawn on the films and checked by eye."),
        "dropped": CBIS_R4_DROPPED,
    },
}


def qc_record(pid: str) -> None:
    """Add the selection rule and the overlay review (with every dropped case and why) to docs/data/<pid>-build-qc.json."""
    path = bx.DOCS_DIR / f"{pid}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / pid / "pack.json").read_text(encoding="utf-8"))
    q = R4_QC[pid]
    data["qcReview"] = {"tool": QC_TOOL, "selectionRule": q["selectionRule"], "review": q["review"],
                        "kept": len(man["subjects"]), "dropped": {str(k): v for k, v in q["dropped"].items()},
                        "leakCheck": "study/series descriptions, role and display notes checked against LEAK (dataset names, diagnoses) at build"}
    bx.dump_json(data, path)


def index(pids: list[str]) -> None:
    """Upsert the index entries (bytes include lessons.json, so run again after scripts/lessons/round4.py)."""
    bx.index(pids)
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] in pids:
            e["note"] = e["note"].replace("external.py + build_external.py", "external_r4.py + build_r4.py; lessons scripts/lessons/round4.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    if sys.argv[1:] == ["index"]:
        index(list(R4_PACKS))
        for pid in R4_PACKS:
            qc_record(pid)
        raise SystemExit(0)
    which = sys.argv[1:] if sys.argv[1:] != ["all"] else list(R4_PACKS)
    if not which or any(p not in R4_PACKS for p in which):
        raise SystemExit(__doc__)
    for pid in which:
        bx.build(pid)
        qc_record(pid)
        index([pid])
