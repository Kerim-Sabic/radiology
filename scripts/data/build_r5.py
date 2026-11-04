"""Build the round-5 packs (more patients from sources already in use) from the selections made by external_r5.py.

  python scripts/data/build_r5.py <packId>     # one of R5_PACKS below; also upserts public/packs/index.json
  python scripts/data/build_r5.py all
  python scripts/data/build_r5.py index        # refresh the index entries (and QC review notes) after writing the lessons

Same code path as round 4 (build_r4.py on top of build_external.py: wrap_2d / build_series / encode_and_place, mask tracing,
build() writing pack.json, the build-QC JSON and the index entry, and the check that nothing the reading room shows names the
dataset or the finding); only the selection files, the dropped tables and the pack ids differ. Earlier packs are not touched.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_external as bx  # noqa: E402
import build_r4 as b4  # noqa: E402  (registers the neutral-text wrappers the shared builders use)
from annotations import REVIEW  # noqa: E402
from build_external import (BREAST_SOURCE, CBIS_SOURCE, FRAC_SOURCE, GRAZ_SOURCE, ISLES_SOURCE, NIH_SOURCE, RAW, build_series,  # noqa: E402
                            encode_and_place, log, thumbnail_png)
from external_r5 import (BREAST_R5_DROPPED, CBIS_R5_DROPPED, FRAC_R5_DROPPED, GRAZ_R5_DROPPED, ISLES_R5_DROPPED,  # noqa: E402
                         NIH_R5_DROPPED)

# ====================================================================== FracAtlas, round 5
FRAC_BODY = {"hand": "HAND", "leg": "LEG", "hip": "HIP", "shoulder": "SHOULDER"}
# Where each radiograph is, read on the image during the overlay review (FracAtlas gives only hand/leg/hip/shoulder). It is
# shown as the scan description, so it names the body part, never the fracture.
FRAC_R5_WHERE: dict[str, str] = {
    "IMG0000600.jpg": "wrist and forearm",
    "IMG0001411.jpg": "wrist and hand",
    "IMG0001980.jpg": "foot",
    "IMG0002020.jpg": "wrist and hand",
    "IMG0002180.jpg": "pelvis",
    "IMG0002544.jpg": "pelvis",
    "IMG0002701.jpg": "pelvis",
    "IMG0003130.jpg": "lower leg",
    "IMG0003342.jpg": "hip and proximal femur",
    "IMG0003458.jpg": "lower leg and ankle",
    "IMG0003519.jpg": "ankle",
    "IMG0003926.jpg": "wrist and hand",
}


def build_frac_r5() -> tuple[list, list, list, dict]:
    sel = json.loads((RAW / "FracAtlas" / "_meta" / "selection-r5.json").read_text(encoding="utf-8"))
    results, targets, geoms = [], [], []
    for c in sel:
        if c["image"] in FRAC_R5_DROPPED:
            continue
        where = FRAC_R5_WHERE[c["image"]]
        bx.FRAC_WHERE[c["image"]] = where
        ds = bx.frac_dataset(c)
        stem = c["image"].rsplit(".", 1)[0]
        ds.SeriesDescription = f"{c['view'].capitalize()} view"
        ds.BodyPartExamined = FRAC_BODY[c["region"]]
        block = f"IMG{c['block']:05d}xx"
        skey = f"figshare:FracAtlas:{block}"
        sr = build_series([b4.to_item(ds, c["image"])], {"region": "extremity", "role": "diagnostic",
                                                         "roleNote": "Musculoskeletal radiograph (JPEG) wrapped as DICOM Secondary Capture."}, skey)
        encode_and_place(sr, "jpegls")
        sr.record["thumbnail"] = f"thumbs/{sr.short}.png"
        sr.thumb = thumbnail_png(sr.sorted_items, sr.record)
        sr.record["displayNote"] = (f"8-bit JPEG wrapped as DICOM, a small image as distributed ({int(ds.Columns)} x {int(ds.Rows)} px): no pixel "
                                    "spacing (distances are not measurable) and no orientation tag, so no orientation letters are shown; read "
                                    "the side from the burned-in marker if present.")
        results.append((sr, skey, {"sourceId": FRAC_SOURCE["id"],
                                   "linkage": (f"FracAtlas gives no patient identifiers and numbers the images of one person together, so "
                                               f"this pack takes at most one image from each block of 100 image numbers and treats the "
                                               f"block ({block}) as the subject: {c['image']}.")}))
        a = c["annotation"]
        polys = [[[round(x - 0.5, 2), round(y - 0.5, 2)] for x, y in zip(seg[0::2], seg[1::2])] for seg in a["segmentation"]]
        tid = f"fracatlas-{stem.lower()}_fracture"
        targets.append({
            "id": tid, "label": "Fracture (FracAtlas expert outline)", "classId": "finding:fracture", "seriesUid": sr.uid,
            "geometryType": "contour_set", "geometryFile": f"targets/{tid}.json", "provenance": "source_manual",
            "provenanceDetail": {
                "source": "figshare:FracAtlas (Annotations/COCO JSON/COCO_fracture_masks.json)",
                "method": ("Fracture polygon drawn manually in makesense.ai with the help of two expert radiologists and an orthopedist "
                           f"(Abedeen et al. 2023); COCO annotation id {a['id']}, converted from pixel-corner to pixel-centre coordinates (-0.5 px)."),
                "note": (f"COCO bbox {[round(v, 1) for v in a['bbox']]}; dataset.csv: {c['region']}, fracture_count 1, no hardware, "
                         f"{c['view']} view."),
            },
            "completeness": "target_only", "assessedClasses": ["finding:fracture"],
            "unassessedNote": "Only the fracture is outlined; alignment, joint involvement and soft tissues are not referenced.",
            "review": dict(REVIEW),
            "teachingNote": "The outline marks the fracture region drawn by the dataset's annotators; it is not a measurement of displacement.",
        })
        geoms.append({"geometryType": "contour_set", "space": "image_px",
                      "planes": [{"sopInstanceUid": str(ds.SOPInstanceUID), "frame": 1, "polygons": polys}]})
    log(f"[fx-radiographs-2] {len(results)} radiographs")
    return results, targets, geoms, {}


R5_PACKS = {
    "us-breast-3": {
        "title": "Breast ultrasound: a third set of lesions proven by biopsy or follow-up",
        "description": ("Breast ultrasound images from Breast-Lesions-USG (one patient each), every lesion outlined freehand by a radiologist "
                        "experienced in breast ultrasound who also recorded its BI-RADS descriptors, proven by biopsy or confirmed on "
                        "follow-up. Every remaining case of the dataset that meets the round-4 rule (one lesion per image, not a scar, "
                        "implant or duct finding, not a risk lesion), each checked by eye with the outline drawn. Cropped 8-bit B-mode "
                        "frames with their true pixel size."),
        "sources": [BREAST_SOURCE], "builder": lambda: b4.build_breast_r4("selection-r5.json", BREAST_R5_DROPPED, "us-breast-3"),
        "budget": 45_000_000,
    },
    "stroke-mri-3": {
        "title": "Stroke MRI: a third set of ischemic lesions on DWI and ADC with expert-approved masks",
        "description": ("Brain MRIs of ischemic stroke from ISLES 2022 (diffusion-weighted images and ADC maps), each with the lesion mask "
                        "approved by an attending neuroradiologist; lesions from about 2 ml to large territorial infarcts, chosen by rule "
                        "across the range of lesion sizes among the cases not used before. Converted from the dataset's NIfTI "
                        "(skull-stripped, 2 mm) to DICOM with the geometry taken from the NIfTI affine; DWI and ADC share one frame of reference."),
        "sources": [ISLES_SOURCE], "builder": lambda: b4.build_isles_r4("selection-r5.json", ISLES_R5_DROPPED, "stroke-mri-3"),
        "budget": 50_000_000,
    },
    "cxr-findings-3": {
        "title": "Chest radiograph findings: a third set of radiologist-boxed films",
        "description": ("Frontal (PA) chest radiographs of adults from NIH ChestX-ray14, one film per patient and none from the earlier "
                        "chest packs, each with the bounding box a board-certified radiologist drew around the finding. Every remaining "
                        "film that meets the rule (box label also in the report labels) was drawn with its box and kept only where the "
                        "boxed finding is clearly visible. The images are the dataset's 8-bit 1024 px release: no pixel spacing and no "
                        "orientation tag."),
        "source": NIH_SOURCE, "builder": lambda: bx.build_nih("selection-r5.json", skip=NIH_R5_DROPPED), "budget": 60_000_000,
    },
    "peds-wrist-3": {
        "title": "Children's wrist fractures: a third set of Salter-Harris II, torus/greenstick and complete fractures",
        "description": ("Wrist radiographs (frontal and lateral of one initial trauma study) of children from GRAZPEDWRI-DX, the fracture boxed "
                        "on both views in annotations reviewed by pediatric radiologists. One distal radius fracture per child, typed by the "
                        "dataset's AO/OTA pediatric code: Salter-Harris II (E/2), incomplete metaphyseal, torus/buckle or greenstick (M/2), "
                        "and complete metaphyseal (M/3). Studies with a cast, metal, osteopenia or an uncertain diagnosis were excluded."),
        "sources": [GRAZ_SOURCE], "builder": lambda: b4.build_graz_r4("selection-r5.json", GRAZ_R5_DROPPED, "peds-wrist-3"),
        "budget": 90_000_000,
    },
    "fx-radiographs-2": {
        "title": "Adult fractures: hands, feet, legs, hips and shoulders",
        "description": ("Radiographs of adults from FracAtlas with one fracture each, outlined by the dataset's annotators (two expert "
                        "radiologists and an orthopedist): one view per injury, no hardware. FracAtlas has no patient identifiers, so at most "
                        "one image is taken from each block of 100 image numbers. Each image was checked by eye with the outline drawn. "
                        "8-bit JPEGs as distributed: no pixel spacing."),
        "sources": [FRAC_SOURCE], "builder": build_frac_r5, "budget": 90_000_000,
    },
    "mammo-cbis-3": {
        "title": "Mammography: a third set of masses and calcifications on CC and MLO views",
        "description": ("Screen-film mammograms (CBIS-DDSM, digitised film): the CC and MLO views of one breast of each woman, with a single "
                        "abnormality outlined on both views. Spiculated malignant and circumscribed benign masses (the mass outline), and "
                        "calcifications from fine pleomorphic and fine linear branching (malignant) to lucent-centered and coarse (benign; "
                        "the region outline), with BI-RADS assessment and pathology as the dataset gives them. Chosen by the round-4 rule "
                        "(subtlety 4-5, the same descriptors on both views) among women not used before."),
        "sources": [CBIS_SOURCE], "builder": lambda: bx.build_mammo("selection-r5.json", skip=CBIS_R5_DROPPED), "budget": 110_000_000,
    },
}
for _cfg in R5_PACKS.values():
    _cfg["builder"] = b4._neutral_records(_cfg["builder"])
bx.PACKS.update(R5_PACKS)

R5_QC = {
    "us-breast-3": {"selectionRule": ("Breast-Lesions-USG cases used in no earlier pack that meet the round-4 rule (benign or malignant, one "
                                      "lesion mask, proven by biopsy or follow-up, not a scar/implant/duct finding or a risk lesion): all of them."),
                    "review": "Every built case drawn with the radiologist's outline and checked by eye.", "dropped": BREAST_R5_DROPPED},
    "stroke-mri-3": {"selectionRule": ("ISLES 2022 cases used in no earlier pack with a lesion of at least 2 ml on the 2 mm DWI grid, 30 taken "
                                       "at even steps across the range of lesion volumes."),
                     "review": "Every DWI and ADC outline drawn on the slice with the largest outlined area and checked by eye.",
                     "dropped": ISLES_R5_DROPPED},
    "cxr-findings-3": {"selectionRule": ("NIH ChestX-ray14 PA films of adults (18-90) with a radiologist box whose label is also in the report "
                                         "labels, one film per patient, no patient of an earlier pack and no film reviewed in rounds 1 or 4."),
                       "review": ("Every candidate drawn with its boxes (full film and zoom) and kept only where the boxed finding is clearly "
                                  "visible."), "dropped": NIH_R5_DROPPED},
    "peds-wrist-3": {"selectionRule": ("The round-4 rule (initial trauma, one frontal and one lateral image with the same single distal-radius "
                                       "AO/OTA code, one fracture box per image, no cast, metal, osteopenia or uncertain diagnosis), patients "
                                       "of rounds 1-4 excluded; 12 Salter-Harris II, 14 incomplete and 14 complete metaphyseal fractures."),
                     "review": "Every radiograph drawn with the fracture box and checked by eye.", "dropped": GRAZ_R5_DROPPED},
    "fx-radiographs-2": {"selectionRule": ("FracAtlas images with one fracture annotation, no hardware, one view, one body region, not part of "
                                           "a multi-scan set; one image per block of 100 image numbers (none from the round-1 blocks), the "
                                           "region least represented so far first."),
                         "review": "Every radiograph drawn with the fracture outline and checked by eye; the body part read on the image.",
                         "dropped": FRAC_R5_DROPPED},
    "mammo-cbis-3": {"selectionRule": ("CBIS-DDSM training-set breasts with CC and MLO, a single abnormality (id 1 only) with the same "
                                       "descriptors on both views, subtlety 4-5; 5 irregular spiculated malignant masses, 4 oval circumscribed "
                                       "benign masses, 3 pleomorphic clustered and 2 fine linear branching malignant calcifications, 1 "
                                       "lucent-centered and 1 coarse benign calcifications; women of mammo-cbis and mammo-cbis-2 and the films "
                                       "rejected then excluded."),
                     "review": ("Chest-wall side of every film checked against the recorded laterality (build_mammo asserts it), then every "
                                "outline drawn on the films and checked by eye."), "dropped": CBIS_R5_DROPPED},
}


def qc_record(pid: str) -> None:
    path = bx.DOCS_DIR / f"{pid}-build-qc.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    man = json.loads((bx.PACKS_DIR / pid / "pack.json").read_text(encoding="utf-8"))
    q = R5_QC[pid]
    data["qcReview"] = {"tool": b4.QC_TOOL, "selectionRule": q["selectionRule"], "review": q["review"],
                        "kept": len(man["subjects"]), "dropped": {str(k): v for k, v in q["dropped"].items()},
                        "leakCheck": "study/series descriptions, role and display notes checked against LEAK (dataset names, diagnoses) at build"}
    bx.dump_json(data, path)


def index(pids: list[str]) -> None:
    """Upsert the index entries (bytes include lessons.json, so run again after scripts/lessons/round5.py)."""
    bx.index(pids)
    idx = bx.PACKS_DIR / "index.json"
    data = json.loads(idx.read_text(encoding="utf-8"))
    for e in data["packs"]:
        if e["id"] in pids:
            e["note"] = e["note"].replace("external.py + build_external.py", "external_r5.py + build_r5.py; lessons scripts/lessons/round5.py")
    bx.dump_json(data, idx)


if __name__ == "__main__":
    if sys.argv[1:] == ["index"]:
        index(list(R5_PACKS))
        for pid in R5_PACKS:
            qc_record(pid)
        raise SystemExit(0)
    which = sys.argv[1:] if sys.argv[1:] != ["all"] else list(R5_PACKS)
    if not which or any(p not in R5_PACKS for p in which):
        raise SystemExit(__doc__)
    for pid in which:
        bx.build(pid)
        qc_record(pid)
        index([pid])
