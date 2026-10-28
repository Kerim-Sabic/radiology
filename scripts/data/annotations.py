"""Annotation converters: DICOM RTSTRUCT, DICOM SEG and LIDC-IDRI XML -> ReferenceTarget + TargetGeometry.

All geometry comes from the source objects. Conventions (see src/schema/content.ts):
  * patient_lps_mm: DICOM patient coordinates (LPS, mm), rounded to 0.001 mm.
  * image_px: [column, row], zero-based, (0,0) = centre of the first transmitted pixel.
  * Rings are stored implicitly closed (the first vertex is NOT repeated at the end).
"""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from skimage import measure
from skimage.draw import polygon as fill_polygon

from common import basis, px_to_patient, patient_to_px, slug

PLANE_TOL_MM = 0.5

REVIEW = {"status": "unreviewed", "reviewer": None, "at": None, "note": None}

# Explicit class names for structures we know; anything else falls back to a slug.
ROI_CLASS = {
    "esophagus": ("anatomy:esophagus", "Esophagus"),
    "heart": ("anatomy:heart", "Heart"),
    "lung_l": ("anatomy:lung_left", "Left lung"),
    "lung_r": ("anatomy:lung_right", "Right lung"),
    "spinalcord": ("anatomy:spinal_cord", "Spinal cord"),
    "spinal_cord": ("anatomy:spinal_cord", "Spinal cord"),
}
SEG_CLASS = {
    "peripheral zone of prostate": ("anatomy:prostate_peripheral_zone", "Prostate peripheral zone"),
    "transition zone of prostate": ("anatomy:prostate_transition_zone", "Prostate transition zone"),
    "prostatic urethra": ("anatomy:prostatic_urethra", "Prostatic urethra"),
    "anterior fibromuscular stroma of prostate": ("anatomy:prostate_anterior_fibromuscular_stroma", "Anterior fibromuscular stroma"),
}


def _round3(a) -> list:
    return [[round(float(x), 3) + 0.0 for x in p] for p in a]


def _point_in_poly(pt2, poly2) -> bool:
    return bool(measure.points_in_poly(np.asarray([pt2]), np.asarray(poly2))[0])


def split_holes(polys2d: list[np.ndarray]) -> list[bool]:
    """Even-odd nesting: a ring contained in an odd number of other rings is a hole."""
    flags = []
    for i, p in enumerate(polys2d):
        depth = 0
        probe = p.mean(axis=0) if len(p) < 3 else p[0]
        for j, q in enumerate(polys2d):
            if i != j and len(q) >= 3 and _point_in_poly(probe, q):
                depth += 1
        flags.append(depth % 2 == 1)
    return flags


class SeriesGeom:
    """Geometry lookup for one built image series (sorted)."""

    def __init__(self, sr):
        self.uid = sr.uid
        self.rec = sr.record
        self.sops = [str(it.ds.SOPInstanceUID) for it in sr.sorted_items]
        self.index = {s: i for i, s in enumerate(self.sops)}
        g = sr.record["geometry"]
        self.rows, self.cols = g["rows"], g["columns"]
        self.ps = g["pixelSpacing"]
        self.iop = g["iop"]
        self.ipp = {}
        for it in sr.sorted_items:
            if "ImagePositionPatient" in it.ds:
                self.ipp[str(it.ds.SOPInstanceUID)] = [float(x) for x in it.ds.ImagePositionPatient]
        self.normal = basis(self.iop)[2] if self.iop else None
        self.proj = {s: float(np.asarray(p) @ self.normal) for s, p in self.ipp.items()} if self.iop else {}
        self.spacing = g["sliceSpacing"]

    def nearest_by_proj(self, d: float) -> tuple[str | None, float]:
        best, bd = None, 1e9
        for s, p in self.proj.items():
            if abs(p - d) < bd:
                best, bd = s, abs(p - d)
        return best, bd


# ---------------------------------------------------------------- RTSTRUCT

def convert_rtstruct(raw: bytes, geoms: dict[str, SeriesGeom], ctx: dict) -> tuple[list[dict], list[dict], dict]:
    ds = pydicom.dcmread(io.BytesIO(raw))
    ref_series = []
    for fr in ds.get("ReferencedFrameOfReferenceSequence", []):
        for st in fr.get("RTReferencedStudySequence", []):
            for se in st.get("RTReferencedSeriesSequence", []):
                ref_series.append(str(se.SeriesInstanceUID))
    target_series = [u for u in ref_series if u in geoms]
    if not target_series:
        raise RuntimeError(f"RTSTRUCT references series {ref_series}, none of which is in the pack")
    sg = geoms[target_series[0]]
    names = {str(r.ROINumber): str(r.ROIName) for r in ds.StructureSetROISequence}
    interp = {str(o.ReferencedROINumber): (str(o.get("RTROIInterpretedType") or ""), str(o.get("ROIInterpreter") or ""))
              for o in ds.get("RTROIObservationsSequence", [])}
    classes = {}
    for num, name in names.items():
        key = name.strip().lower().replace(" ", "_")
        cid, lab = ROI_CLASS.get(key, (ctx.get("roiClass", {}).get(name, (None, None))))
        if cid is None:
            cid, lab = f"{ctx.get('defaultRoiPrefix', 'structure')}:{slug(name).replace('-', '_')}", name
        classes[num] = (cid, lab)
    nonempty = {str(rc.ReferencedROINumber) for rc in ds.ROIContourSequence
                if any(str(c.get("ContourGeometricType", "")) == "CLOSED_PLANAR" for c in rc.get("ContourSequence", []))}
    classes_all = dict(classes)
    classes = {k: v for k, v in classes.items() if k in nonempty}
    assessed = sorted({c for c, _ in classes.values()})
    empty_rois = sorted(names[k] for k in classes_all if k not in nonempty)
    targets, geoms_out = [], []
    qc = {"rtstructSop": str(ds.SOPInstanceUID), "referencedSeries": sg.uid, "rois": [], "emptyRois": empty_rois}
    for rc in ds.ROIContourSequence:
        num = str(rc.ReferencedROINumber)
        name = names.get(num, f"ROI {num}")
        if num not in classes:
            qc["rois"].append({"roi": name, "targetId": None, "contours": 0, "planes": 0, "matchedBySop": 0, "matchedByZ": 0,
                               "maxResidualMm": None, "failures": [], "skipped": {}, "holes": 0, "empty": True})
            continue
        cid, lab = classes[num]
        planes: dict[str, list[np.ndarray]] = defaultdict(list)
        n_by_ref = n_by_z = 0
        skipped = defaultdict(int)
        resid = []
        fails = []
        for c in rc.get("ContourSequence", []):
            gt = str(c.get("ContourGeometricType", ""))
            pts = np.asarray([float(x) for x in c.ContourData]).reshape(-1, 3)
            if gt != "CLOSED_PLANAR" or len(pts) < 3:
                skipped[gt or "unknown"] += 1
                continue
            sop = None
            cis = c.get("ContourImageSequence")
            if cis:
                cand = str(cis[0].ReferencedSOPInstanceUID)
                if cand in sg.index:
                    sop = cand
                    n_by_ref += 1
            if sop is None:
                d = float((pts @ sg.normal).mean())
                cand, dist = sg.nearest_by_proj(d)
                if cand is not None and dist <= (sg.spacing or 1.0) / 2 + 1e-6:
                    sop = cand
                    n_by_z += 1
                else:
                    fails.append(f"no slice within half spacing for contour at n-projection {d:.2f}")
                    continue
            ipp = np.asarray(sg.ipp[sop])
            dist = np.abs((pts - ipp) @ sg.normal)
            resid.append(float(dist.max()))
            if dist.max() >= PLANE_TOL_MM:
                fails.append(f"contour on {sop[-12:]} max off-plane {dist.max():.3f} mm")
            planes[sop].append(pts)
        out_planes = []
        n_holes = 0
        for sop in sorted(planes, key=lambda s: sg.index[s]):
            rings = planes[sop]
            ipp = sg.ipp[sop]
            two_d = [np.asarray([patient_to_px(p, ipp, sg.iop, sg.ps)[:2] for p in r]) for r in rings]
            hole = split_holes(two_d) if len(rings) > 1 else [False]
            n_holes += sum(hole)
            pl = {"sopInstanceUid": sop, "frame": 1,
                  "polygons": [_round3(r) for r, h in zip(rings, hole) if not h]}
            hs = [_round3(r) for r, h in zip(rings, hole) if h]
            if hs:
                pl["holes"] = hs
            out_planes.append(pl)
        tid = f"{ctx['subjectSlug']}_{ctx.get('idPrefix', '')}{slug(lab)}"
        method = (f"DICOM RTSTRUCT ROIContourSequence (CLOSED_PLANAR) -> contour_set in patient_lps_mm. "
                  f"Plane matching: {n_by_ref} contour(s) by ContourImageSequence ReferencedSOPInstanceUID"
                  + (f", {n_by_z} by z-projection within half slice spacing (ReferencedSOPInstanceUID absent or not in series)" if n_by_z else "")
                  + f". Point-to-plane residual max {max(resid) if resid else float('nan'):.4f} mm over {len(resid)} contour(s) (tolerance {PLANE_TOL_MM} mm)."
                  + (f" Nested rings treated as holes by even-odd rule: {n_holes}." if n_holes else ""))
        it_type, interpreter = interp.get(num, ("", ""))
        note = (f"ROI '{name}' (ROINumber {num}); RTROIInterpretedType '{it_type or 'n/a'}'; StructureSetLabel "
                f"'{ds.get('StructureSetLabel', '')}'; RTSTRUCT SOPInstanceUID {ds.SOPInstanceUID}; Manufacturer "
                f"'{ds.get('Manufacturer', '')}'. Contours reference image series '{sg.rec['description']}' ({sg.rec['modality']}, "
                f"SeriesInstanceUID {sg.uid}) only. Coordinates rounded to 0.001 mm.")
        if skipped:
            note += f" Skipped non-closed contours: {dict(skipped)}."
        if fails:
            note += f" QC failures: {len(fails)}."
        if not out_planes:
            qc["rois"].append({"roi": name, "targetId": tid, "contours": 0, "planes": 0, "matchedBySop": 0, "matchedByZ": 0,
                               "maxResidualMm": None, "failures": fails, "skipped": dict(skipped), "holes": 0, "empty": True})
            continue
        targets.append({
            "id": tid,
            "label": f"{lab} ({ctx.get('labelSuffix', 'RT contour')})",
            "classId": cid,
            "seriesUid": sg.uid,
            "geometryType": "contour_set",
            "geometryFile": f"targets/{tid}.json",
            "provenance": "source_manual",
            "provenanceDetail": {"source": ctx["sourceLabel"], "method": method, "note": note},
            "completeness": "target_only",
            "assessedClasses": assessed,
            "unassessedNote": ctx.get("unassessedNote") or (
                "Only the structures delineated in this RT structure set are referenced ("
                + ", ".join(sorted(l for _, l in classes.values())) + "); all other anatomy and any pathology are unassessed."
                + (f" ROIs present in the structure set but without contours in this scan: {', '.join(empty_rois)}." if empty_rois else "")),
            "review": dict(REVIEW),
            "teachingNote": ctx["teachingNote"],
        })
        if ctx.get("layer"):
            targets[-1]["layer"] = ctx["layer"]
        if ctx.get("roiCategory"):
            targets[-1]["category"] = ctx["roiCategory"].get(name, "other")
        geoms_out.append({"geometryType": "contour_set", "space": "patient_lps_mm", "planes": out_planes})
        qc["rois"].append({"roi": name, "targetId": tid, "contours": len(resid), "planes": len(out_planes),
                           "matchedBySop": n_by_ref, "matchedByZ": n_by_z, "maxResidualMm": (max(resid) if resid else None),
                           "failures": fails, "skipped": dict(skipped), "holes": n_holes})
    return targets, geoms_out, qc


# ---------------------------------------------------------------- SEG

def _mask_to_rings(mask: np.ndarray, tol_px: float = 0.25) -> list[np.ndarray]:
    """Binary mask (rows, cols) -> list of rings as (col, row) arrays in pixel-centre coords."""
    padded = np.pad(mask.astype(np.uint8), 1)
    rings = []
    for c in measure.find_contours(padded, 0.5):
        c = c - 1.0  # undo padding; find_contours returns (row, col)
        c = measure.approximate_polygon(c, tolerance=tol_px)
        if len(c) >= 4 and np.allclose(c[0], c[-1]):
            c = c[:-1]
        if len(c) < 3:
            continue
        rings.append(np.stack([c[:, 1], c[:, 0]], axis=1))  # -> (col, row)
    return rings


def convert_seg(raw: bytes, geoms: dict[str, SeriesGeom], ctx: dict) -> tuple[list[dict], list[dict], dict]:
    import highdicom as hd
    seg = hd.seg.segread(io.BytesIO(raw))
    ref_series = [str(r.SeriesInstanceUID) for r in seg.get("ReferencedSeriesSequence", [])]
    target_series = [u for u in ref_series if u in geoms]
    ref_method = "ReferencedSeriesSequence"
    if not target_series and not ref_series and ctx.get("referencedSeriesUid") in geoms:
        cand = geoms[ctx["referencedSeriesUid"]]
        if str(seg.get("FrameOfReferenceUID", "")) != str(cand.rec.get("frameOfReferenceUid")):
            raise RuntimeError("SEG has no ReferencedSeriesSequence and its FrameOfReferenceUID differs from the declared series")
        target_series = [cand.uid]
        ref_method = (f"SEG has no ReferencedSeriesSequence; reference series taken from selection.json (SEG SeriesDescription "
                      f"'{seg.get('SeriesDescription', '')}') and verified by identical FrameOfReferenceUID")
    if not target_series:
        raise RuntimeError(f"SEG references series {ref_series}, none of which is in the pack")
    sg = geoms[target_series[0]]
    arr = seg.pixel_array
    nfr = int(seg.get("NumberOfFrames") or 1)
    if arr.ndim == 2:
        arr = arr[None]
    seg_type = str(seg.SegmentationType)
    if seg_type == "FRACTIONAL":
        maxv = float(seg.get("MaximumFractionalValue") or 255)
        arr = arr.astype(np.float32) / maxv >= 0.5
    else:
        arr = arr > 0
    sh = seg.SharedFunctionalGroupsSequence[0] if "SharedFunctionalGroupsSequence" in seg else None
    pf = seg.PerFrameFunctionalGroupsSequence

    def fg(i, kw):
        if kw in pf[i]:
            return pf[i].get(kw)[0]
        if sh is not None and kw in sh:
            return sh.get(kw)[0]
        return None

    segs = {int(s.SegmentNumber): s for s in seg.SegmentSequence}
    classes = {}
    for n, s in segs.items():
        label = str(s.SegmentLabel)
        prop = s.SegmentedPropertyTypeCodeSequence[0]
        cat = s.SegmentedPropertyCategoryCodeSequence[0]
        key = str(prop.CodeMeaning).strip().lower()
        if key in SEG_CLASS:
            cid, lab = SEG_CLASS[key]
        elif label in ctx.get("segClass", {}):
            cid, lab = ctx["segClass"][label]
        else:
            prefix = "anatomy" if "anatomical" in str(cat.CodeMeaning).lower() else "finding"
            cid, lab = f"{prefix}:{slug(str(prop.CodeMeaning)).replace('-', '_')}", label
        classes[n] = (cid, lab, prop, cat)
    assessed = sorted({c[0] for c in classes.values()})
    # pairwise overlap between segments on the same source plane (reported, never altered)
    frame_seg = {}
    for i in range(nfr):
        sid_i = int(fg(i, "SegmentIdentificationSequence").ReferencedSegmentNumber)
        pos_i = fg(i, "PlanePositionSequence")
        key_i = tuple(round(float(x), 2) for x in pos_i.ImagePositionPatient) if pos_i is not None else i
        frame_seg.setdefault(key_i, []).append((sid_i, i))
    overlap = defaultdict(int)
    for lst in frame_seg.values():
        for a_ in range(len(lst)):
            for b_ in range(a_ + 1, len(lst)):
                (sa, ia), (sb, ib) = lst[a_], lst[b_]
                n_ov = int(np.logical_and(arr[ia], arr[ib]).sum())
                if n_ov:
                    overlap[tuple(sorted((sa, sb)))] += n_ov
    per_seg: dict[int, dict[str, list[np.ndarray]]] = defaultdict(lambda: defaultdict(list))
    stats = defaultdict(lambda: {"frames": 0, "empty": 0, "byRef": 0, "byPos": 0, "offPlane": [], "unmatched": 0, "resampled": 0,
                                 "notNearest": 0})
    # pass 1: for frames matched by plane position only, keep the frame(s) nearest to each source slice
    best: dict[tuple[int, str], tuple[float, float, int]] = {}
    for i in range(nfr):
        if not arr[i].any() or fg(i, "DerivationImageSequence") is not None:
            continue
        pos = fg(i, "PlanePositionSequence")
        if pos is None:
            continue
        sid = int(fg(i, "SegmentIdentificationSequence").ReferencedSegmentNumber)
        proj = float(np.asarray([float(x) for x in pos.ImagePositionPatient]) @ sg.normal)
        cand, dist = sg.nearest_by_proj(proj)
        if cand is not None and dist <= (sg.spacing or 1.0) / 2:
            key = (round(dist, 3), proj, i)  # nearest frame; ties -> frame with the lower projection along the normal
            if (sid, cand) not in best or key < best[(sid, cand)]:
                best[(sid, cand)] = key
    for i in range(nfr):
        sid = int(fg(i, "SegmentIdentificationSequence").ReferencedSegmentNumber)
        st = stats[sid]
        st["frames"] += 1
        m = arr[i]
        if not m.any():
            st["empty"] += 1
            continue
        pos = fg(i, "PlanePositionSequence")
        ori = fg(i, "PlaneOrientationSequence")
        meas = fg(i, "PixelMeasuresSequence")
        seg_ipp = [float(x) for x in pos.ImagePositionPatient] if pos is not None else None
        seg_iop = [float(x) for x in ori.ImageOrientationPatient] if ori is not None else sg.iop
        seg_ps = [float(x) for x in meas.PixelSpacing] if meas is not None else sg.ps
        sop = None
        der = fg(i, "DerivationImageSequence")
        if der is not None:
            for src in der.get("SourceImageSequence", []):
                u = str(src.ReferencedSOPInstanceUID)
                if u in sg.index:
                    sop = u
                    st["byRef"] += 1
                    break
        if sop is None and seg_ipp is not None:
            cand, dist = sg.nearest_by_proj(float(np.asarray(seg_ipp) @ sg.normal))
            if cand is not None and dist <= (sg.spacing or 1.0) / 2:
                if best.get((sid, cand), (0, 0, i))[2] != i:
                    st["notNearest"] += 1
                    continue
                sop = cand
                st["byPos"] += 1
        if sop is None:
            st["unmatched"] += 1
            continue
        src_ipp = sg.ipp[sop]
        if seg_ipp is not None:
            st["offPlane"].append(abs(float((np.asarray(seg_ipp) - np.asarray(src_ipp)) @ sg.normal)))
        same_grid = (seg_ipp is not None and np.allclose(seg_ipp, src_ipp, atol=1e-3)
                     and np.allclose(seg_iop, sg.iop, atol=1e-4) and np.allclose(seg_ps, sg.ps, atol=1e-5)
                     and m.shape == (sg.rows, sg.cols))
        rings = _mask_to_rings(m)
        if not same_grid:
            st["resampled"] += 1
            conv = []
            for r in rings:
                pts = [px_to_patient(c, rr, seg_ipp, seg_iop, seg_ps) for c, rr in r]
                conv.append(np.asarray([patient_to_px(p, src_ipp, sg.iop, sg.ps)[:2] for p in pts]))
            rings = conv
        per_seg[sid][sop].extend(rings)
    targets, geoms_out = [], []
    qc = {"segSop": str(seg.SOPInstanceUID), "referencedSeries": sg.uid, "segmentationType": seg_type,
          "pairwiseOverlapPixels": {f"{a}-{b}": v for (a, b), v in overlap.items()},
          "contentCreator": str(seg.get("ContentCreatorName", "") or ""), "segments": []}
    algo_map = {"MANUAL": "source_manual", "SEMIAUTOMATIC": "source_manual", "AUTOMATIC": "source_automated"}
    for n in sorted(segs):
        s = segs[n]
        cid, lab, prop, cat = classes[n]
        algo = str(s.SegmentAlgorithmType)
        planes = []
        nh = 0
        for sop in sorted(per_seg[n], key=lambda x: sg.index[x]):
            rings = per_seg[n][sop]
            hole = split_holes(rings) if len(rings) > 1 else [False]
            nh += sum(hole)
            pl = {"sopInstanceUid": sop, "frame": 1,
                  "polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
            hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
            if hs:
                pl["holes"] = hs
            if pl["polygons"]:
                planes.append(pl)
        st = stats[n]
        allpts = [px_to_patient(c, r, sg.ipp[pl["sopInstanceUid"]], sg.iop, sg.ps)
                  for pl in planes for ring in pl["polygons"] for c, r in ring]
        centroid = [round(float(v), 1) for v in np.mean(allpts, axis=0)] if allpts else None
        tid = f"{ctx['subjectSlug']}_{ctx.get('idPrefix', '')}{slug(lab)}"
        method = (f"DICOM SEG ({seg_type}) read with highdicom; reference series via {ref_method}; frames mapped to source SOP via "
                  f"DerivationImageSequence/SourceImageSequence ({st['byRef']} frame(s))"
                  + (f" and PlanePositionSequence match to the nearest source slice within half the slice spacing ({st['byPos']})" if st["byPos"] else "")
                  + (f"; {st['notNearest']} frame(s) of a finer SEG slice grid not used because another frame is nearer to that source slice "
                     "(ties broken towards the lower projection on the slice normal); one SEG frame per source slice" if st["notNearest"] else "")
                  + f"; {st['unmatched']} unmatched, {st['empty']} empty frame(s). Masks traced with "
                  f"skimage.measure.find_contours(level 0.5, sub-pixel) and simplified with approximate_polygon(0.25 px); "
                  f"(row, col) converted to image_px [col, row] with (0,0) = centre of first pixel."
                  + (f" {st['resampled']} frame(s) on a different pixel grid were mapped through patient coordinates." if st["resampled"] else " SEG grid identical to the source image grid.")
                  + (f" Max SEG-frame to source-slice distance {max(st['offPlane']):.4f} mm." if st["offPlane"] else "")
                  + (f" Even-odd holes: {nh}." if nh else ""))
        note = (f"Segment {n} '{s.SegmentLabel}'; SegmentedPropertyType '{prop.CodeMeaning}' ({prop.CodingSchemeDesignator} {prop.CodeValue}); "
                f"category '{cat.CodeMeaning}'; SegmentAlgorithmType {algo}"
                + (f" ({s.get('SegmentAlgorithmName')})" if s.get("SegmentAlgorithmName") else "")
                + f"; SEG SOPInstanceUID {seg.SOPInstanceUID}; ContentCreatorName '{seg.get('ContentCreatorName', '')}'."
                + (" Overlap with other segments (pixels): " + ", ".join(
                    f"segment {b if a == n else a}: {v}" for (a, b), v in overlap.items() if n in (a, b)) + "."
                   if any(n in k for k in overlap) else " No pixel overlap with other segments of this SEG."))
        targets.append({
            "id": tid,
            "label": f"{lab} ({ctx.get('labelSuffix', 'SEG')})",
            "classId": cid,
            "seriesUid": sg.uid,
            "geometryType": "contour_set",
            "geometryFile": f"targets/{tid}.json",
            "provenance": algo_map.get(algo, "source_automated"),
            "provenanceDetail": {"source": ctx["sourceLabel"], "method": method, "note": note},
            "completeness": "target_only",
            "assessedClasses": assessed,
            "unassessedNote": ctx.get("unassessedNote") or (
                "Only the segments in this DICOM SEG are referenced (" + ", ".join(c[1] for c in classes.values())
                + "); all other anatomy and findings are unassessed."),
            "review": dict(REVIEW),
            "teachingNote": ctx["teachingNote"],
        })
        geoms_out.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        qc["segments"].append({"segment": n, "label": str(s.SegmentLabel), "targetId": tid, "algorithmType": algo,
                               "planes": len(planes), "framesTotal": st["frames"], "emptyFrames": st["empty"],
                               "byRef": st["byRef"], "byPos": st["byPos"], "unmatched": st["unmatched"], "notNearest": st["notNearest"],
                               "maxFrameToSliceMm": (max(st["offPlane"]) if st["offPlane"] else None),
                               "resampledFrames": st["resampled"], "holes": nh, "outlineVertexCentroidLps": centroid})
    return targets, geoms_out, qc


# ---------------------------------------------------------------- LIDC XML

NS = "{http://www.nih.gov}"


def find_lidc_xml(zip_path: Path, series_uid: str) -> tuple[str, bytes]:
    hits = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".xml"):
                continue
            data = zf.read(name)
            if series_uid.encode() in data:
                hits.append((name, data))
    if not hits:
        raise RuntimeError(f"no LIDC XML mentions series {series_uid}")
    # prefer the CT read message whose header SeriesInstanceUid matches exactly
    for name, data in hits:
        root = ET.fromstring(data)
        h = root.find(f"{NS}ResponseHeader")
        if h is not None and (h.findtext(f"{NS}SeriesInstanceUid") or "").strip() == series_uid:
            return name, data
    return hits[0]


def parse_lidc(data: bytes) -> list[dict]:
    root = ET.fromstring(data)
    sessions = []
    for si, rs in enumerate(root.findall(f"{NS}readingSession")):
        rid = (rs.findtext(f"{NS}servicingRadiologistID") or "").strip()
        anns = []
        for nod in rs.findall(f"{NS}unblindedReadNodule"):
            nid = (nod.findtext(f"{NS}noduleID") or "").strip()
            ch = nod.find(f"{NS}characteristics")
            chars = {}
            if ch is not None:
                for e in ch:
                    tag = e.tag.replace(NS, "")
                    try:
                        chars[tag] = int((e.text or "").strip())
                    except ValueError:
                        pass
            rois = []
            for roi in nod.findall(f"{NS}roi"):
                pts = [(int(float(em.findtext(f"{NS}xCoord"))), int(float(em.findtext(f"{NS}yCoord"))))
                       for em in roi.findall(f"{NS}edgeMap")]
                rois.append({
                    "sop": (roi.findtext(f"{NS}imageSOP_UID") or "").strip(),
                    "z": float(roi.findtext(f"{NS}imageZposition") or "nan"),
                    "inclusion": (roi.findtext(f"{NS}inclusion") or "TRUE").strip().upper() == "TRUE",
                    "pts": pts,
                })
            outlined = any(len(r["pts"]) >= 3 for r in rois) and bool(chars)
            anns.append({"noduleId": nid, "chars": chars, "rois": rois, "outlined": outlined})
        nn = len(rs.findall(f"{NS}nonNodule"))
        sessions.append({"index": si, "readerId": rid, "nodules": anns, "nonNodules": nn})
    return sessions


def convert_lidc(xml_zip: Path, xml_meta: dict, geoms: dict[str, SeriesGeom], series_uid: str, ctx: dict):
    sg = geoms[series_uid]
    name, data = find_lidc_xml(xml_zip, series_uid)
    sessions = parse_lidc(data)
    ann_list = []
    small_marks = 0
    unmatched_sop = 0
    for s in sessions:
        rid = s["readerId"]
        rlabel = f"LIDC reader {s['index'] + 1}" + (f" (servicingRadiologistID {rid})" if rid and rid.lower() not in ("anon", "anonymous") else "")
        for a in s["nodules"]:
            if not a["outlined"]:
                small_marks += 1
                continue
            vox = set()
            pts3 = []
            for r in a["rois"]:
                if r["sop"] not in sg.index:
                    unmatched_sop += 1
                    continue
                k = sg.index[r["sop"]]
                if r["inclusion"] and len(r["pts"]) >= 3:
                    xs = np.array([p[0] for p in r["pts"]]); ys = np.array([p[1] for p in r["pts"]])
                    rr, cc = fill_polygon(ys, xs, shape=(sg.rows, sg.cols))
                    vox.update((k, int(a_), int(b_)) for a_, b_ in zip(rr, cc))
                    vox.update((k, int(y), int(x)) for x, y in r["pts"])
                for x, y in r["pts"]:
                    pts3.append(px_to_patient(x, y, sg.ipp[r["sop"]], sg.iop, sg.ps))
            if not pts3:
                continue
            ann_list.append({"reader": s["index"], "readerLabel": rlabel, "ann": a, "vox": vox,
                             "pts3": np.asarray(pts3), "centroid": np.asarray(pts3).mean(axis=0)})
    # cluster across readers: overlap of filled outlines, or close contour points
    n = len(ann_list)
    link_tol = max(2 * max(sg.ps), 1.1 * (sg.spacing or 1.0))
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    readers_of = {i: {ann_list[i]["reader"]} for i in range(n)}
    cands = []
    for i in range(n):
        for j in range(i + 1, n):
            a, b = ann_list[i], ann_list[j]
            if a["reader"] == b["reader"] or np.linalg.norm(a["centroid"] - b["centroid"]) > 40:
                continue
            ov = len(a["vox"] & b["vox"])
            if ov:
                cands.append(((0, -ov), i, j))  # overlapping outlines first, largest overlap first
                continue
            d = float(np.linalg.norm(a["pts3"][:, None, :] - b["pts3"][None, :, :], axis=2).min())
            if d <= link_tol:
                cands.append(((1, d), i, j))
    blocked = 0
    for _, i, j in sorted(cands):
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        if readers_of[ri] & readers_of[rj]:
            blocked += 1  # would put two outlines of the same reader in one nodule: keep them apart
            continue
        parent[ri] = rj
        readers_of[rj] |= readers_of[ri]
    clusters = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(ann_list[i])
    ordered = sorted(clusters.values(), key=lambda c: (-len({x["reader"] for x in c}),
                                                       float(np.mean([x["centroid"] for x in c], axis=0) @ sg.normal)))
    targets, geoms_out, qc_nod = [], [], []
    k = 0
    excluded = []
    for cl in ordered:
        readers = sorted({x["reader"] for x in cl})
        dup = len(cl) - len(readers)
        cen = np.mean([x["centroid"] for x in cl], axis=0)
        extent = []
        for x in cl:
            p = x["pts3"]
            # longest in-plane extent per roi, mm (derived, approximate)
            best = 0.0
            for r in x["ann"]["rois"]:
                if r["sop"] in sg.index and len(r["pts"]) >= 2:
                    q = np.asarray(r["pts"], float) * np.asarray([sg.ps[1], sg.ps[0]])
                    dd = np.linalg.norm(q[:, None] - q[None], axis=2).max()
                    best = max(best, float(dd))
            extent.append(best)
        info = {"readers": len(readers), "annotations": len(cl), "sameReaderDuplicates": dup,
                "centroidLps": [round(float(v), 1) for v in cen],
                "maxInPlaneExtentMm": [round(e, 1) for e in extent],
                "malignancy": [x["ann"]["chars"].get("malignancy") for x in cl]}
        if len(readers) < 2:
            excluded.append(info)
            continue
        k += 1
        tid = f"{ctx['subjectSlug']}_nodule-{k}"
        planes = []
        for x in sorted(cl, key=lambda x: x["reader"]):
            by_sop = defaultdict(lambda: {"inc": [], "exc": []})
            for r in x["ann"]["rois"]:
                if r["sop"] not in sg.index or len(r["pts"]) < 3:
                    continue
                by_sop[r["sop"]]["inc" if r["inclusion"] else "exc"].append([[float(px), float(py)] for px, py in r["pts"]])
            for sop in sorted(by_sop, key=lambda s: sg.index[s]):
                d = by_sop[sop]
                if not d["inc"]:
                    continue
                pl = {"sopInstanceUid": sop, "frame": 1, "polygons": d["inc"], "reader": x["readerLabel"]}
                if d["exc"]:
                    pl["holes"] = d["exc"]
                planes.append(pl)
        mal = [m for m in info["malignancy"] if m is not None]
        reader_labels = [cl_x["readerLabel"] for cl_x in sorted(cl, key=lambda x: x["reader"])]
        targets.append({
            "id": tid,
            "label": f"Lung nodule {k} (LIDC, outlined by {len(readers)}/4 readers)",
            "classId": "finding:lung_nodule",
            "seriesUid": sg.uid,
            "geometryType": "contour_set",
            "geometryFile": f"targets/{tid}.json",
            "provenance": "source_manual",
            "provenanceDetail": {
                "source": ctx["sourceLabel"] + f" — XML member '{name}' of LIDC-XML-only.zip (sha256 {xml_meta['sha256'][:16]}...)",
                "method": ("LIDC XML unblindedReadNodule outlines (edgeMap xCoord=column, yCoord=row, zero-based pixel indices) kept per reader "
                           "as image_px planes; matched to CT slices by imageSOP_UID; inclusion=FALSE rois stored as holes. "
                           f"Cross-reader grouping by this pipeline: outlines of different readers linked when filled outlines overlap or contour "
                           f"points are within {link_tol:.2f} mm, strongest overlap first, never merging two outlines of the same reader "
                           "(greedy union-find). Per LIDC convention the outline is drawn just outside the nodule margin."),
                "readers": reader_labels,
                "note": (f"Consensus: outlined (>=3 mm nodule) by {len(readers)} of 4 readers"
                         + (f"; {dup} extra outline(s) from a reader already counted" if dup else "")
                         + f". Approx. longest in-plane extent per reader outline (derived from outline points, mm): {info['maxInPlaneExtentMm']}. "
                         f"Centroid (LPS mm) ~{info['centroidLps']}."),
            },
            "completeness": "target_only",
            "assessedClasses": ["finding:lung_nodule"],
            "unassessedNote": "",  # filled below once all clusters are known
            "review": dict(REVIEW),
            "teachingNote": (f"LIDC readers' malignancy ratings for this nodule: {mal} (scale 1-5). These are subjective suspicion "
                             "ratings by radiologists who had no pathology or follow-up information — they are NOT diagnoses. "
                             "Outlines differ between readers; compare them rather than treating any one as ground truth. "
                             + ctx.get("teachingNoteExtra", "")).strip(),
        })
        geoms_out.append({"geometryType": "contour_set", "space": "image_px", "planes": planes})
        qc_nod.append({"targetId": tid, **info, "planes": len(planes)})
    un = (f"LIDC-IDRI readers (4, two-phase blinded/unblinded) marked nodules >=3 mm (outlined), nodules <3 mm (centre mark only) "
          f"and non-nodules >=3 mm across the whole CT. Only nodules >=3 mm outlined by >=2 readers are targets here ({k}). "
          f"Not targets: {len(excluded)} outlined nodule(s) seen by only one reader, {small_marks} <3 mm nodule mark(s), "
          f"{sum(s['nonNodules'] for s in sessions)} non-nodule mark(s). Other findings and anatomy are unassessed.")
    for t in targets:
        t["unassessedNote"] = un
    qc = {"xml": name, "readingSessions": len(sessions), "readerIds": [s["readerId"] for s in sessions],
          "outlinedAnnotations": n, "clusters": len(clusters), "targets": k, "excludedSingleReader": excluded,
          "smallNoduleMarks": small_marks, "nonNodules": sum(s["nonNodules"] for s in sessions),
          "roiSopNotInSeries": unmatched_sop, "linkTolMm": link_tol, "linksBlockedSameReader": blocked, "nodules": qc_nod}
    return targets, geoms_out, qc


# ---------------------------------------------------------------- CBIS-DDSM ROI mask

def json_like(d: dict) -> str:
    return "; ".join(f"{k}={v}" for k, v in d.items())


def convert_cbis_mask(mask_items: list, geoms: dict[str, SeriesGeom], image_series_uid: str, csv_row: dict,
                      csv_meta: dict, mask_series_uid: str, ctx: dict) -> tuple[list[dict], list[dict], dict]:
    """CBIS-DDSM 'ROI mask images' series -> contour_set (image_px) on the full mammogram.
    The mask is the binary image with the same matrix as the full mammogram; linkage comes from
    the official case-description CSV row (its file paths contain the series UIDs)."""
    sg = geoms[image_series_uid]
    if len(sg.sops) != 1:
        raise RuntimeError("expected a single full-mammogram image")
    sop = sg.sops[0]
    img_path = csv_row["image file path"].strip()
    roi_path = csv_row["ROI mask file path"].strip()
    if image_series_uid not in img_path or mask_series_uid not in roi_path:
        raise RuntimeError("CSV row does not reference the selected image/mask series")
    masks = []
    for name, ds in mask_items:
        a = ds.pixel_array
        vals = np.unique(a)
        if a.shape == (sg.rows, sg.cols) and len(vals) <= 2:
            masks.append((name, ds, a > 0))
    if len(masks) != 1:
        raise RuntimeError(f"expected exactly one binary full-size mask, found {len(masks)}")
    name, mds, m = masks[0]
    rings = _mask_to_rings(m, tol_px=0.5)
    hole = split_holes(rings) if len(rings) > 1 else [False]
    pl = {"sopInstanceUid": sop, "frame": 1,
          "polygons": [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if not h]}
    hs = [[[round(float(c), 2) + 0.0, round(float(r), 2) + 0.0] for c, r in ring] for ring, h in zip(rings, hole) if h]
    if hs:
        pl["holes"] = hs
    area = int(m.sum())
    tid = f"{ctx['subjectSlug']}_{ctx.get('idPrefix', '')}mass-{csv_row['abnormality id']}"
    keys = ("pathology", "assessment", "mass shape", "mass margins", "subtlety", "breast_density",
            "abnormality type", "left or right breast", "image view", "abnormality id")
    facts = {k: csv_row[k] for k in keys if k in csv_row}
    target = {
        "id": tid,
        "label": f"Breast mass {csv_row['abnormality id']} (CBIS-DDSM ROI)",
        "classId": "finding:breast_mass",
        "seriesUid": sg.uid,
        "geometryType": "contour_set",
        "geometryFile": f"targets/{tid}.json",
        "provenance": "source_automated",
        "provenanceDetail": {
            "source": ctx["sourceLabel"] + f" - ROI mask series {mask_series_uid}; case row from {csv_meta['file']} (sha256 {csv_meta['sha256'][:16]}...)",
            "method": ("CBIS-DDSM ROI mask (binary image with the same matrix as the full mammogram, identified by matrix size and binary values; "
                       f"mask SOPInstanceUID {mds.SOPInstanceUID}) traced with skimage.measure.find_contours(level 0.5) and simplified "
                       "with approximate_polygon(0.5 px); (row, col) -> image_px [col, row]. Mask-to-image pairing from the official CSV row "
                       "(its 'image file path' and 'ROI mask file path' contain the two SeriesInstanceUIDs)."),
            "note": (f"Mask area {area} pixels; {len(pl['polygons'])} outer ring(s), {len(hs)} hole(s). CBIS-DDSM mass ROIs are 'updated' "
                     "segmentations from a local level-set algorithm initialised by the original DDSM outlines (Lee et al., Sci Data 2017, "
                     "linked from the TCIA collection page), i.e. algorithm-derived boundaries, not radiologist hand outlines. "
                     f"Source-stated case attributes (CSV): {json_like(facts)}."),
        },
        "completeness": "target_only",
        "assessedClasses": ["finding:breast_mass"],
        "unassessedNote": ("Only the abnormality listed for this image in the CBIS-DDSM CSV is referenced; other findings (including "
                           "calcifications or masses not listed) and normal anatomy are unassessed."),
        "review": dict(REVIEW),
        "teachingNote": (f"Pathology as stated by the CBIS-DDSM case description (the dataset describes verified pathology): "
                         f"{csv_row.get('pathology')}; BI-RADS assessment {csv_row.get('assessment')}; mass shape {csv_row.get('mass shape')}; "
                         f"margins {csv_row.get('mass margins')}; subtlety {csv_row.get('subtlety')}/5; breast density {csv_row.get('breast_density')}. "
                         "These are source-stated labels for this lesion; the outline is an algorithm-refined ROI, so judge the margins on "
                         "the image itself."),
    }
    geo = {"geometryType": "contour_set", "space": "image_px", "planes": [pl]}
    qc = {"maskSop": str(mds.SOPInstanceUID), "maskMember": name, "maskAreaPx": area, "rings": len(pl["polygons"]),
          "holes": len(hs), "csvRow": facts, "referencedSeries": sg.uid, "targetId": tid}
    return [target], [geo], qc


# ---------------------------------------------------------------- MIDRC-RICORD (MD.ai export) study labels

def convert_ricord_labels(zip_path: Path, zip_meta: dict, geoms: dict[str, "SeriesGeom"], study_uid: str, ctx: dict):
    """RICORD MD.ai export -> one image_label target per reader label group for one study. RICORD-1C labels are GLOBAL,
    STUDY-scoped (no boxes/polygons); they are attached to every SOP of that study present in the pack."""
    import json as _json
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".json")]
        data = _json.loads(zf.read(names[0]))
    labels = {}
    for g in data["labelGroups"]:
        for l in g["labels"]:
            labels[l["id"]] = (g["name"], l["name"], l.get("scope"), l.get("type"))
    vocab = sorted({v[1] for v in labels.values()})
    anns = [a for d in data["datasets"] for a in d["annotations"] if a.get("StudyInstanceUID") == study_uid]
    if not anns:
        raise RuntimeError(f"no RICORD annotations for study {study_uid}")
    localized = [a for a in anns if a.get("data")]
    sops = [s for g in geoms.values() if g.rec["studyUid"] == study_uid for s in g.sops]
    series_uid = next(g.uid for g in geoms.values() if g.rec["studyUid"] == study_uid)
    by_group = defaultdict(list)
    for a in anns:
        grp, name, scope, typ = labels[a["labelId"]]
        by_group[grp].append((name, a["createdById"], scope, typ, a["id"]))
    targets, geos = [], []
    for grp in sorted(by_group):
        items = by_group[grp]
        tid = f"{ctx['subjectSlug']}_ricord-{slug(grp)}"
        users = sorted({u for _, u, _, _, _ in items})
        targets.append({
            "id": tid,
            "label": f"RICORD study labels, label group '{grp}'",
            "classId": "label:ricord_cxr_assessment",
            "seriesUid": series_uid,
            "geometryType": "image_label",
            "geometryFile": f"targets/{tid}.json",
            "provenance": "source_manual",
            "provenanceDetail": {
                "source": ctx["sourceLabel"] + f" - MD.ai export '{names[0]}' in {zip_path.name} (sha256 {zip_meta['sha256'][:16]}...)",
                "method": (f"MD.ai annotations for StudyInstanceUID {study_uid} with labels of group '{grp}' (scope "
                           f"{sorted({sc for _, _, sc, _ in [(i[0], i[1], i[2], i[3]) for i in items]})}, type "
                           f"{sorted({t for *_, t, _ in items})}); label names copied verbatim; attached to all {len(sops)} SOP(s) of the study in this pack."),
                "readers": [f"MD.ai label group '{grp}', createdById {u}" for u in users],
                "note": f"Annotation ids: {', '.join(i[4] for i in items)}.",
            },
            "completeness": "target_only",
            "assessedClasses": vocab,
            "unassessedNote": ("RICORD-1C provides only study-level labels (appearance category and opacity-extent grade); there is no lesion "
                               "location, box or outline, and no other findings were labelled."),
            "review": dict(REVIEW),
            "teachingNote": ctx.get("teachingNote", ""),
        })
        geos.append({"geometryType": "image_label", "sopInstanceUids": sops, "labels": [i[0] for i in items]})
    qc = {"study": study_uid, "annotations": len(anns), "localizedAnnotations": len(localized),
          "groups": {g: [i[0] for i in v] for g, v in by_group.items()}, "sops": len(sops), "referencedSeries": series_uid}
    return targets, geos, qc


# ---------------------------------------------------------------- PASCAL VOC boxes (Lung-PET-CT-Dx)

VOC_HISTOLOGY = {"A": "adenocarcinoma", "B": "small cell carcinoma", "E": "large cell carcinoma", "G": "squamous cell carcinoma"}


def convert_voc_boxes(zip_path: Path, zip_meta: dict, geoms: dict[str, "SeriesGeom"], series_uid: str, folder: str, ctx: dict):
    """Lung-PET-CT-Dx annotation export -> one box target for the tumor of one patient on one CT series.

    The archive holds one PASCAL VOC XML per annotated image, named <SOPInstanceUID>.xml, under Annotation/<folder>/.
    Only images of `series_uid` are used (the same tumor is often boxed on other reconstructions too). The object name is the
    histology letter of the patient (A/B/E/G); VOC xmin..ymax are pixel-corner coordinates, stored as image_px with the
    pixel-centre convention (-0.5 px), like the NIH boxes."""
    g = geoms[series_uid]
    want = set(g.sops)
    boxes, letters, outside, sizes = [], set(), 0, set()
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.startswith(f"Annotation/{folder}/") and n.endswith(".xml")]
        for n in names:
            sop = n.rsplit("/", 1)[-1][:-4]
            if sop not in want:
                outside += 1
                continue
            root = ET.fromstring(zf.read(n))
            sizes.add((int(root.findtext("size/width")), int(root.findtext("size/height"))))
            for ob in root.findall("object"):
                letters.add(ob.findtext("name").strip())
                bb = ob.find("bndbox")
                x0, y0, x1, y1 = (float(bb.findtext(k)) for k in ("xmin", "ymin", "xmax", "ymax"))
                if not (0 <= x0 < x1 <= g.cols and 0 <= y0 < y1 <= g.rows):
                    raise RuntimeError(f"box outside image on {sop}: {(x0, y0, x1, y1)}")
                boxes.append({"sopInstanceUid": sop, "frame": 1, "box": [round(x0 - 0.5, 2), round(y0 - 0.5, 2), round(x1 - 0.5, 2), round(y1 - 0.5, 2)]})
    if not boxes:
        raise RuntimeError(f"no boxes of {folder} on series {series_uid}")
    if sizes != {(g.cols, g.rows)}:
        raise RuntimeError(f"VOC image size {sizes} does not match the series ({g.cols}x{g.rows})")
    if letters != {folder[0]}:
        raise RuntimeError(f"histology letters {letters} do not match the patient folder {folder}")
    boxes.sort(key=lambda b: g.index[b["sopInstanceUid"]])
    histology = VOC_HISTOLOGY[folder[0]]
    tid = f"{ctx['subjectSlug']}_lung-cancer"
    idx = sorted({g.index[b["sopInstanceUid"]] for b in boxes})
    target = {
        "id": tid,
        "label": f"Lung cancer, {histology} (radiologists' box)",
        "classId": "finding:lung_cancer",
        "seriesUid": series_uid,
        "geometryType": "box",
        "geometryFile": f"targets/{tid}.json",
        "provenance": "source_manual",
        "provenanceDetail": {
            "source": ctx["sourceLabel"] + f" - {zip_path.name} (sha256 {zip_meta['sha256'][:16]}...)",
            "method": ("Bounding boxes drawn in LabelImg by one of five academic thoracic radiologists and verified by the other four "
                       "(collection description); one PASCAL VOC XML per image named by its SOP Instance UID. Converted from pixel-corner "
                       "[xmin, ymin, xmax, ymax] to image_px with the pixel-centre convention (-0.5 px)."),
            "note": (f"{len(boxes)} boxes on {len(idx)} images of this series (display positions {idx[0] + 1}-{idx[-1] + 1} of {len(g.sops)}); "
                     f"{outside} more boxes of this patient are on other reconstructions and are not used. Histology letter '{folder[0]}' "
                     f"= {histology} (patient ID prefix, collection description)."),
        },
        "completeness": "target_only",
        "assessedClasses": ["finding:lung_cancer"],
        "unassessedNote": ("Only the primary tumor is boxed. Lymph nodes, metastases and other findings are not referenced; the box is a "
                           "rectangle around the tumor, not its outline."),
        "review": dict(REVIEW),
        "teachingNote": ctx.get("teachingNote", ""),
    }
    geo = {"geometryType": "box", "space": "image_px", "boxes": boxes}
    qc = {"folder": folder, "boxes": len(boxes), "images": len(idx), "otherSeriesBoxes": outside, "histology": histology,
          "contiguous": idx == list(range(idx[0], idx[-1] + 1))}
    return [target], [geo], qc
