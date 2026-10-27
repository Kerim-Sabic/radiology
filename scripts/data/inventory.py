"""Series inventory, geometric sorting/QC, window presets, lossless re-encoding, thumbnails.

Everything here is derived from the DICOM files themselves; nothing is typed in by hand
except the role/region hints that come from selection.json (and are recorded as such).
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from pydicom.uid import (JPEG2000Lossless, JPEGLSLossless, RLELossless)

from common import (LOSSY_TS, UID_NAMES, basis, fnum, jsonable, series_short_id,
                    sha256_bytes)

PROJECTION_MODALITIES = {"DX", "CR", "MG", "RF", "XA", "IO", "PX", "RG"}
ENCODE_TS = {"jpegls": JPEGLSLossless, "j2k": JPEG2000Lossless, "rle": RLELossless}
ENCODE_PLUGIN = {"jpegls": "pyjpegls", "j2k": "pylibjpeg", "rle": "pydicom"}

ACQ_FIELDS = [
    "SeriesDescription", "ProtocolName", "StudyDescription", "ImageType", "Manufacturer",
    "ManufacturerModelName", "BodyPartExamined", "PatientPosition", "ScanningSequence",
    "SequenceVariant", "ScanOptions", "MRAcquisitionType", "SequenceName", "EchoTime",
    "RepetitionTime", "InversionTime", "FlipAngle", "EchoTrainLength", "MagneticFieldStrength",
    "ContrastBolusAgent", "ContrastBolusRoute", "ContrastBolusStartTime", "KVP",
    "XRayTubeCurrent", "Exposure", "SliceThickness", "SpacingBetweenSlices", "ConvolutionKernel",
    "ReconstructionDiameter", "GantryDetectorTilt", "ViewPosition", "ImageLaterality",
    "Laterality", "PatientOrientation", "PresentationLUTShape", "PixelSpacingCalibrationType",
    "DistanceSourceToDetector", "DistanceSourceToPatient", "EstimatedRadiographicMagnificationFactor",
    "BurnedInAnnotation", "LossyImageCompression", "AcquisitionNumber",
]

SCOUT_RE = re.compile(r"(scout|locator|localizer|localiser|surview|topogram|scanogram|\bloc\b|_loc\b|t2_loc)", re.I)
REFORMAT_RE = re.compile(r"(\bmpr\b|\bmip\b|minip|reformat|\bcor(onal)?s?\b|\bsag(ittal)?s?\b|cor-mip|sag-mip|\bvr\b|\b3d\b(?!_ax))", re.I)


@dataclass
class Item:
    raw: bytes
    ds: pydicom.Dataset
    name: str


@dataclass
class SeriesResult:
    uid: str
    modality: str
    short: str
    record: dict  # pack.json Series (without instances bytes until written)
    sorted_items: list[Item]
    outputs: list[tuple[str, bytes]] = field(default_factory=list)  # (relpath, bytes) in sorted order
    qc: dict = field(default_factory=dict)


def load_items(pairs) -> list[Item]:
    out = []
    for name, raw in pairs:
        ds = pydicom.dcmread(io.BytesIO(raw))
        out.append(Item(raw=raw, ds=ds, name=name))
    return out


def _acq_str(v):
    """Acquisition values are strings; multi-valued elements joined with a backslash (DICOM style)."""
    from pydicom.multival import MultiValue
    if v is None or isinstance(v, (bytes, pydicom.Sequence)):
        return None
    if isinstance(v, (MultiValue, list, tuple)):
        parts = [str(x).strip() for x in v]
        return "\\".join(parts) if any(parts) else None
    s = str(v).strip()  # DS/IS keep the header's original text (e.g. '3.00')
    return s or None


def _acq_value(items: list[Item], kw: str):
    vals = []
    for it in items:
        v = _acq_str(it.ds.get(kw)) if kw in it.ds else None
        key = repr(v)
        if key not in [repr(x) for x in vals]:
            vals.append(v)
    vals_nn = [v for v in vals if v is not None]
    if not vals_nn:
        return None
    if len(vals) == 1:
        return vals[0]
    shown = " | ".join(str(v) for v in vals[:6])
    return f"varies across {len(items)} instances ({len(vals)} distinct): {shown}{' ...' if len(vals) > 6 else ''}"


def determine_role(modality: str, items: list[Item], hint: dict) -> tuple[str, str]:
    ds0 = items[0].ds
    desc = str(ds0.get("SeriesDescription", "") or "")
    itype = [str(x).upper() for x in (ds0.get("ImageType") or [])]
    if hint.get("role"):
        return hint["role"], hint.get("roleNote", "Role set in selection.json: " + hint.get("why", ""))
    if "LOCALIZER" in itype:
        return "scout", f"ImageType contains LOCALIZER ({'\\'.join(itype)}); projection localizer acquired by the {modality} scanner, not a diagnostic radiograph."
    if SCOUT_RE.search(desc):
        return "scout", f"SeriesDescription '{desc}' matches the scout/localizer pattern; not a diagnostic series."
    if modality in ("CT", "MR", "PT"):
        if itype[:1] == ["DERIVED"] and any(t in itype for t in ("REFORMATTED", "MPR", "MIP", "PROJECTION IMAGE", "VOLUME_RENDER")):
            return "vendor_reformat", f"ImageType {'\\'.join(itype)} indicates a scanner-generated reformat/projection."
        if REFORMAT_RE.search(desc):
            return "vendor_reformat", f"SeriesDescription '{desc}' indicates a vendor MPR/MIP reformat."
    note = hint.get("roleNote") or f"Primary {modality} series ({desc or 'no description'})."
    return "diagnostic", note


def sort_items(items: list[Item]) -> tuple[list[Item], dict]:
    """Sort by IPP projected on the IOP normal (ascending). Never by filename/InstanceNumber
    when geometry exists. Returns (sorted, qc dict)."""
    qc: dict[str, Any] = {"issues": []}
    have_geom = all(("ImagePositionPatient" in it.ds and "ImageOrientationPatient" in it.ds) for it in items)
    if not have_geom:
        # projection images: no patient geometry; order has no spatial meaning
        srt = sorted(items, key=lambda it: (int(it.ds.get("InstanceNumber") or 0), str(it.ds.SOPInstanceUID)))
        qc["method"] = "no ImagePositionPatient/ImageOrientationPatient: ordered by InstanceNumber (no geometric meaning)"
        qc["positions"] = None
        return srt, qc
    iops = np.array([[float(x) for x in it.ds.ImageOrientationPatient] for it in items])
    ref = iops[0]
    mixed = np.abs(iops - ref).max() > 1e-3
    if mixed:
        qc["issues"].append("mixed ImageOrientationPatient within series")
    _, _, n = basis(ref)
    ipps = np.array([[float(x) for x in it.ds.ImagePositionPatient] for it in items])
    proj = ipps @ n
    order = np.argsort(proj, kind="stable")
    srt = [items[i] for i in order]
    p = proj[order]
    qc["method"] = "ascending projection of ImagePositionPatient on n = rowDir x colDir (from ImageOrientationPatient)"
    qc["normal"] = [round(float(x), 6) for x in n]
    qc["positions"] = [float(x) for x in p]
    if len(items) >= 2:
        d = np.diff(p)
        dup = int((np.abs(d) < 1e-3).sum())
        if dup:
            qc["issues"].append(f"{dup} duplicate slice position(s)")
        dd = d[np.abs(d) >= 1e-3]
        if len(dd):
            med = float(np.median(dd))
            qc["sliceSpacing"] = med
            dev = float(np.abs(dd - med).max())
            qc["maxSpacingDeviation"] = dev
            qc["uniform"] = bool(dev <= 0.05)
            if not qc["uniform"]:
                qc["issues"].append(f"non-uniform slice spacing (median {med:.3f} mm, max deviation {dev:.3f} mm)")
            gaps = int((dd > 1.5 * med).sum())
            if gaps:
                missing = int(np.round(dd[dd > 1.5 * med] / med - 1).sum())
                qc["issues"].append(f"{gaps} gap(s) in slice positions; about {missing} slice(s) missing")
            # gantry tilt / sheared stack: in-plane component of IPP steps
            steps = np.diff(ipps[order], axis=0)
            along = steps @ n
            inplane = np.linalg.norm(steps - np.outer(along, n), axis=1)
            ok = np.abs(along) > 1e-3
            if ok.any():
                ang = float(np.degrees(np.arctan2(inplane[ok], np.abs(along[ok]))).max())
                qc["maxStackShearDeg"] = round(ang, 3)
                if ang > 0.5:
                    qc["issues"].append(f"slice stack not orthogonal to image plane (shear up to {ang:.2f} deg; gantry tilt or oblique stack)")
        else:
            qc["sliceSpacing"] = None
            qc["uniform"] = None
    return srt, qc


def window_presets(modality: str, role: str, region: str | None, items: list[Item], rescale) -> list[dict]:
    ds0 = items[0].ds
    if modality == "CT" and role != "scout" and rescale is not None:
        reg = (region or "chest").lower()
        presets = {
            "chest": [("Soft tissue", 40, 400), ("Lung", -600, 1500), ("Mediastinum", 50, 350), ("Bone", 400, 1800)],
            "abdomen": [("Soft tissue", 40, 400), ("Bone", 400, 1800), ("Lung", -600, 1500)],
            "pelvis": [("Soft tissue", 40, 400), ("Bone", 400, 1800)],
            "extremity": [("Soft tissue", 40, 400), ("Bone", 400, 1800), ("Lung", -600, 1500)],
            "spine": [("Bone", 400, 1800), ("Soft tissue", 40, 400)],
            "head": [("Brain", 40, 80), ("Bone", 400, 1800), ("Soft tissue", 40, 400)],
        }.get(reg, [("Soft tissue", 40, 400), ("Bone", 400, 1800)])
        return [{"label": l, "center": c, "width": w} for l, c, w in presets]
    # MR / DX / CR / scouts: file values if present, else percentile default
    wc, ww = ds0.get("WindowCenter"), ds0.get("WindowWidth")
    out = []
    if wc is not None and ww is not None:
        wcs = list(wc) if isinstance(wc, pydicom.multival.MultiValue) else [wc]
        wws = list(ww) if isinstance(ww, pydicom.multival.MultiValue) else [ww]
        expl = ds0.get("WindowCenterWidthExplanation")
        expls = list(expl) if isinstance(expl, pydicom.multival.MultiValue) else ([expl] if expl else [])
        for i, (c, w) in enumerate(zip(wcs, wws)):
            if fnum(w) and fnum(w) > 0:
                lab = f"File: {expls[i]}" if i < len(expls) and expls[i] else ("File preset" if len(wcs) == 1 else f"File preset {i+1}")
                out.append({"label": lab, "center": round(float(c), 3), "width": round(float(w), 3)})
    if out:
        dedup, seen = [], set()
        for w in out:
            if (w["center"], w["width"]) not in seen:
                seen.add((w["center"], w["width"]))
                dedup.append(w)
        if len(dedup) == 1 and len(out) > 1 and dedup[0]["label"].startswith("File preset"):
            dedup[0]["label"] = "File preset"
        return dedup
    vals = []
    for it in items[:: max(1, len(items) // 24)]:
        a = it.ds.pixel_array.astype(np.float64)
        if rescale:
            a = a * rescale["slope"] + rescale["intercept"]
        vals.append(a.ravel()[:: max(1, a.size // 200000)])
    v = np.concatenate(vals)
    # ignore pixels at the extreme stored values (background / saturation), then take p1-p99
    inner = v[(v > v.min()) & (v < v.max())]
    if inner.size > 1000:
        v = inner
    lo, hi = np.percentile(v, [1, 99])
    if hi <= lo:
        hi = lo + 1
    return [{"label": "Auto (p1-p99)", "center": round(float((lo + hi) / 2), 2), "width": round(float(hi - lo), 2)}]


def geometry_record(modality: str, role: str, items: list[Item], sqc: dict) -> dict:
    ds0 = items[0].ds
    rows, cols = int(ds0.Rows), int(ds0.Columns)
    issues = list(sqc["issues"])
    if len({(int(it.ds.Rows), int(it.ds.Columns)) for it in items}) > 1:
        issues.append("mixed matrix size within series")
    projection = modality in PROJECTION_MODALITIES or role == "scout"
    ps, src = None, "none"
    if "PixelSpacing" in ds0:
        ps, src = [float(x) for x in ds0.PixelSpacing], "PixelSpacing"
    elif "ImagerPixelSpacing" in ds0:
        ps, src = [float(x) for x in ds0.ImagerPixelSpacing], "ImagerPixelSpacing"
    if ps is None:
        # enhanced/multiframe: shared functional groups
        sh = ds0.get("SharedFunctionalGroupsSequence")
        if sh and "PixelMeasuresSequence" in sh[0]:
            ps, src = [float(x) for x in sh[0].PixelMeasuresSequence[0].PixelSpacing], "PixelSpacing"
    if len({tuple(it.ds.get("PixelSpacing") or it.ds.get("ImagerPixelSpacing") or []) for it in items}) > 1:
        issues.append("mixed pixel spacing within series")
    if projection:
        calibrated = bool(src == "PixelSpacing" and ds0.get("PixelSpacingCalibrationType"))
    else:
        calibrated = src == "PixelSpacing"
    iop = None
    if "ImageOrientationPatient" in ds0:
        iop = [round(float(x), 6) for x in ds0.ImageOrientationPatient]
    nframes = sum(int(it.ds.get("NumberOfFrames") or 1) for it in items)
    if any(int(it.ds.get("NumberOfFrames") or 1) > 1 for it in items):
        issues.append("multi-frame instance(s): per-frame geometry not handled by this builder")
    if projection:
        issues.append("projection image (no tomographic slice stack)")
    elif len(items) < 3:
        issues.append(f"only {len(items)} slice(s)")
    if iop is None and not projection:
        issues.append("no ImageOrientationPatient")
    slope = ds0.get("RescaleSlope")
    icpt = ds0.get("RescaleIntercept")
    rescale = None
    if slope is not None or icpt is not None:
        rescale = {"slope": float(slope if slope is not None else 1.0),
                   "intercept": float(icpt if icpt is not None else 0.0),
                   "type": (str(ds0.get("RescaleType")) if ds0.get("RescaleType") else None)}
        if len({(str(it.ds.get("RescaleSlope")), str(it.ds.get("RescaleIntercept"))) for it in items}) > 1:
            issues.append("rescale slope/intercept varies across instances (per-instance values in files are authoritative)")
    hu = bool(modality == "CT" and rescale is not None and role != "scout"
              and (rescale["type"] in (None, "HU")))
    issues = list(dict.fromkeys(issues))
    eligible = (not projection and len(items) >= 3 and iop is not None and nframes == len(items)
                and not any(k in " ".join(issues) for k in ("duplicate", "mixed", "non-uniform", "gap", "orthogonal", "multi-frame")))
    return {
        "rows": rows, "columns": cols,
        "pixelSpacing": ps, "pixelSpacingSource": src, "spacingCalibrated": calibrated,
        "iop": iop,
        "sliceSpacing": (round(sqc["sliceSpacing"], 4) if sqc.get("sliceSpacing") else None),
        "sliceSpacingUniform": (sqc.get("uniform") if len(items) >= 2 and sqc.get("positions") is not None else None),
        "volumeEligible": bool(eligible), "volumeIssues": issues,
        "photometric": str(ds0.PhotometricInterpretation),
        "bitsStored": int(ds0.BitsStored), "pixelRepresentation": int(ds0.PixelRepresentation),
        "rescale": rescale, "hu": hu,
    }


def reencode(item: Item, mode: str) -> tuple[bytes, str]:
    """Lossless re-encode one instance; verify pixel-exact round trip with two decoders
    where available. Returns (bytes, status). On any failure returns original bytes."""
    src_ts = str(item.ds.file_meta.TransferSyntaxUID)
    if mode == "original":
        return item.raw, "original"
    target = ENCODE_TS[mode]
    if src_ts == target:
        return item.raw, "already-target"
    if src_ts in LOSSY_TS:
        return item.raw, f"kept: source {src_ts} is lossy"
    if item.ds.file_meta.TransferSyntaxUID.is_compressed:
        return item.raw, "kept: source already losslessly compressed"
    try:
        orig = item.ds.pixel_array.copy()
        ds2 = pydicom.dcmread(io.BytesIO(item.raw))
        # keep the SOP Instance UID: lossless transcoding of the same instance (annotations reference it)
        ds2.compress(target, encoding_plugin=ENCODE_PLUGIN[mode], generate_instance_uid=False)
        buf = io.BytesIO()
        ds2.save_as(buf, enforce_file_format=True)
        out = buf.getvalue()
        ds3 = pydicom.dcmread(io.BytesIO(out))
        # every non-pixel attribute must be unchanged (pydicom may only touch PixelData)
        src_ds = pydicom.dcmread(io.BytesIO(item.raw))
        k_src = {t for t in src_ds.keys() if t != 0x7FE00010}
        k_out = {t for t in ds3.keys() if t != 0x7FE00010}
        if k_src != k_out:
            return item.raw, f"kept: attribute set changed ({sorted(map(str, k_src ^ k_out))[:4]})"
        for t in k_src:
            if src_ds[t].value != ds3[t].value:
                return item.raw, f"kept: attribute {t} changed by encoder"
        a3 = ds3.pixel_array
        if a3.shape != orig.shape or not np.array_equal(a3, orig):
            return item.raw, "kept: round-trip mismatch"
        # second, independent decoder (gdcm) when it supports the syntax
        try:
            from pydicom.pixels import pixel_array as _pa
            a4 = _pa(io.BytesIO(out), decoding_plugin="gdcm")
            if a4.shape != orig.shape or not np.array_equal(a4, orig):
                return item.raw, "kept: gdcm round-trip mismatch"
        except Exception:  # noqa: BLE001  (gdcm may not decode every syntax)
            pass
        return out, "reencoded"
    except Exception as e:  # noqa: BLE001
        return item.raw, f"kept: encode failed ({type(e).__name__}: {str(e)[:120]})"


def thumbnail_png(items: list[Item], rec: dict, max_side: int = 256) -> bytes:
    from PIL import Image
    it = items[len(items) // 2]
    a = it.ds.pixel_array.astype(np.float64)
    if a.ndim == 3 and int(it.ds.get("SamplesPerPixel", 1)) == 1:
        a = a[a.shape[0] // 2]
    g = rec["geometry"]
    if g["rescale"]:
        a = a * g["rescale"]["slope"] + g["rescale"]["intercept"]
    wp = rec["windowPresets"][0]
    lo, hi = wp["center"] - wp["width"] / 2, wp["center"] + wp["width"] / 2
    v = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    if g["photometric"] == "MONOCHROME1":
        v = 1 - v
    im = Image.fromarray((v * 255).astype(np.uint8))
    ps = g["pixelSpacing"]
    if ps and ps[0] and ps[1] and abs(ps[0] - ps[1]) > 1e-6:  # anisotropic pixels: correct aspect
        h, w = im.size[1], im.size[0]
        im = im.resize((w, max(1, int(round(h * ps[0] / ps[1])))))
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build_series(items: list[Item], hint: dict, subject_key: str) -> SeriesResult:
    ds0 = items[0].ds
    modality = str(ds0.Modality)
    uid = str(ds0.SeriesInstanceUID)
    assert all(str(it.ds.SeriesInstanceUID) == uid for it in items), "mixed series in zip"
    sops = [str(it.ds.SOPInstanceUID) for it in items]
    dup_sop = len(sops) - len(set(sops))
    if dup_sop:
        seen, uniq = set(), []
        for it in items:
            if str(it.ds.SOPInstanceUID) not in seen:
                seen.add(str(it.ds.SOPInstanceUID)); uniq.append(it)
        items = uniq
    role, role_note = determine_role(modality, items, hint)
    if hint.get("roleNoteExtra"):
        role_note = f"{role_note} {hint['roleNoteExtra']}"
    srt, sqc = sort_items(items)
    if dup_sop:
        sqc["issues"].append(f"{dup_sop} duplicate SOPInstanceUID file(s) dropped")
    geom = geometry_record(modality, role, srt, sqc)
    acq = {}
    for kw in ACQ_FIELDS:
        v = _acq_value(srt, kw)
        if v is not None:
            acq[kw] = v
    sop_classes = sorted({str(it.ds.SOPClassUID) for it in srt})
    if len(sop_classes) > 1:
        geom["volumeIssues"].append("mixed SOP classes")
        geom["volumeEligible"] = False
    rec = {
        "uid": uid,
        "studyUid": str(ds0.StudyInstanceUID),
        "subjectKey": subject_key,
        "modality": modality,
        "sopClassUid": sop_classes[0],
        "frameOfReferenceUid": (str(ds0.FrameOfReferenceUID) if ds0.get("FrameOfReferenceUID") else None),
        "number": (int(ds0.SeriesNumber) if ds0.get("SeriesNumber") not in (None, "") else None),
        "description": str(ds0.get("SeriesDescription", "") or ""),
        "bodyPart": (str(ds0.BodyPartExamined) if ds0.get("BodyPartExamined") else None),
        "role": role,
        "roleNote": role_note,
        "acquisition": acq,
        "geometry": geom,
    }
    rec["windowPresets"] = window_presets(modality, role, hint.get("region"), srt, geom["rescale"])
    short = series_short_id(modality, uid)
    return SeriesResult(uid=uid, modality=modality, short=short, record=rec, sorted_items=srt, qc=sqc)


def encode_and_place(sr: SeriesResult, mode: str) -> None:
    """Fill sr.outputs, sr.record.instances / encoding / bytes."""
    statuses: dict[str, int] = {}
    src_ts, out_ts = [], []
    instances = []
    total = 0
    for it in sr.sorted_items:
        out, status = reencode(it, mode)
        key = status.split(":")[0] if status.startswith("kept") else status
        statuses[status] = statuses.get(status, 0) + 1
        sts = str(it.ds.file_meta.TransferSyntaxUID)
        ots = str(pydicom.dcmread(io.BytesIO(out), stop_before_pixels=True).file_meta.TransferSyntaxUID)
        src_ts.append(sts); out_ts.append(ots)
        sha = sha256_bytes(out)
        rel = f"dicom/{sr.short}/{sha[:16]}.dcm"
        sr.outputs.append((rel, out))
        ipp = it.ds.get("ImagePositionPatient")
        instances.append({
            "sopInstanceUid": str(it.ds.SOPInstanceUID),
            "file": rel, "bytes": len(out), "sha256": sha,
            "frames": int(it.ds.get("NumberOfFrames") or 1),
            "instanceNumber": (int(it.ds.InstanceNumber) if it.ds.get("InstanceNumber") not in (None, "") else None),
            "ipp": ([round(float(x), 4) for x in ipp] if ipp is not None else None),
        })
        total += len(out)
    uniq_out = sorted(set(out_ts))
    uniq_src = sorted(set(src_ts))
    changed = any(s != o for s, o in zip(src_ts, out_ts))
    lossy_src = any(s in LOSSY_TS for s in uniq_src) or any(
        str(it.ds.get("LossyImageCompression", "00")) == "01" for it in sr.sorted_items)
    if mode == "original":
        note = f"Kept byte-for-byte as distributed by TCIA ({', '.join(UID_NAMES.get(t, t) for t in uniq_src)})."
    elif changed:
        note = (f"Losslessly re-encoded {', '.join(UID_NAMES.get(t, t) for t in uniq_src)} -> "
                f"{', '.join(UID_NAMES.get(t, t) for t in uniq_out)}; every instance decoded after encoding and "
                f"compared pixel-for-pixel with the source (np.array_equal on stored values; gdcm cross-check where supported). "
                f"Status counts: {statuses}. SOP Instance UIDs unchanged.")
    elif set(statuses) == {"kept: source already losslessly compressed"}:
        note = (f"Kept byte-for-byte as distributed: the source is already losslessly compressed "
                f"({', '.join(UID_NAMES.get(t, t) for t in uniq_src)}), so it was not transcoded.")
    else:
        note = f"Not re-encoded ({statuses}); kept as distributed."
    if lossy_src:
        note += " Source pixel data was already lossy-compressed (LossyImageCompression=01 or lossy transfer syntax)."
    sr.record["encoding"] = {
        "transferSyntaxes": uniq_out,
        "reencodedFrom": (uniq_src if changed else None),
        "lossless": bool(not lossy_src),
        "note": note,
    }
    sr.record["instances"] = instances
    sr.record["bytes"] = total
    sr.qc["encodeStatus"] = statuses
