"""Single entry point for the learning-pack data pipeline.

  python scripts/data/packs.py list
  python scripts/data/packs.py fetch <packId>      # download selected TCIA series (resumable)
  python scripts/data/packs.py build <packId>      # raw -> public/packs/<packId>/
  python scripts/data/packs.py validate <packId>   # re-verify files, write docs/data/<packId>-inventory.md
  python scripts/data/packs.py index               # rewrite public/packs/index.json from built packs
  python scripts/data/packs.py all <packId>        # fetch + build + validate + index

Raw downloads live outside the repo (RADIOLOGY_RAW_DIR, default C:/Users/kerim/radiology-data/raw).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tcia  # noqa: E402
from common import PACKS_DIR, SELECTION, dump_json, load_json, sha256_file  # noqa: E402

LIDC_XML_URL = "https://www.cancerimagingarchive.net/wp-content/uploads/LIDC-XML-only.zip"


def cmd_list() -> None:
    sel = load_json(SELECTION)
    for pid, cfg in sel["packs"].items():
        built = (PACKS_DIR / pid / "pack.json").exists()
        n_series = sum(1 for s in cfg["subjects"] for se in s["series"] if se["kind"] == "image")
        size = sum(p.stat().st_size for p in (PACKS_DIR / pid).rglob("*") if p.is_file()) if built else 0
        print(f"{pid:14s} {'built' if built else 'not built':9s} {len(cfg['subjects'])} subjects, {n_series} image series, "
              f"{size/1e6:7.1f} MB on disk, distribution={cfg.get('distribution')}  {cfg['title']}")


def fetch_lidc_xml() -> Path:
    dest = tcia.RAW_ROOT / "LIDC-IDRI" / "_annotations" / "LIDC-XML-only.zip"
    meta = dest.with_suffix(".json")
    if dest.exists() and meta.exists() and load_json(meta).get("sha256") == sha256_file(dest):
        tcia.log("  [skip] LIDC-XML-only.zip present, sha256 ok")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with tcia.session().get(LIDC_XML_URL, stream=True, timeout=(30, 600)) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(dest)
    import zipfile
    with zipfile.ZipFile(dest) as zf:
        n_xml = sum(1 for n in zf.namelist() if n.lower().endswith(".xml"))
    dump_json({"url": LIDC_XML_URL, "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "bytes": dest.stat().st_size, "sha256": sha256_file(dest), "xmlFiles": n_xml}, meta)
    tcia.log(f"  [ok] LIDC-XML-only.zip ({n_xml} XML files)")
    return dest


def fetch_csv(collection: str, name: str, url: str) -> Path:
    dest = tcia.RAW_ROOT / collection / "_metadata" / name
    meta = dest.with_suffix(".json")
    if dest.exists() and meta.exists() and load_json(meta).get("sha256") == sha256_file(dest):
        tcia.log(f"  [skip] {name} present, sha256 ok")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = tcia.session().get(url, timeout=(30, 300))
    r.raise_for_status()
    dest.write_bytes(r.content)
    dump_json({"url": url, "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "bytes": dest.stat().st_size, "sha256": sha256_file(dest)}, meta)
    tcia.log(f"  [ok] {name}")
    return dest


def cmd_fetch(pack_id: str) -> None:
    sel = load_json(SELECTION)
    cfg = sel["packs"][pack_id]
    for subj in cfg["subjects"]:
        src = sel["sources"][subj["sourceId"]]
        coll, pid = src["collection"], subj["patientId"]
        for se in subj["series"]:
            if se["kind"] == "lidc_xml":
                fetch_lidc_xml()
                continue
            if se["kind"] == "ricord_labels":
                fetch_csv(coll, se["file"]["name"], se["file"]["url"])
                continue
            if se["kind"] == "cbis_mask":
                fetch_csv(coll, se["csv"]["file"], se["csv"]["url"])
            rows = tcia.get_series(series_uid=se["uid"])
            if not rows:
                raise SystemExit(f"getSeries returned nothing for {se['uid']}")
            row = rows[0]
            pid = se["maskPatientId"] if se["kind"] == "cbis_mask" else subj["patientId"]
            if row.get("PatientID") != pid or row.get("Collection") != coll:
                raise SystemExit(f"selection mismatch for {se['uid']}: API says {row.get('Collection')}/{row.get('PatientID')}, "
                                 f"selection says {coll}/{pid}")
            if se.get("studyUid") and row.get("StudyInstanceUID") != se["studyUid"]:
                raise SystemExit(f"study mismatch for {se['uid']}")
            tcia.log(f"[fetch {pack_id}] {coll}/{pid} {row.get('Modality')} '{row.get('SeriesDescription')}' "
                     f"{row.get('ImageCount')} img {float(row.get('FileSize') or 0)/1e6:.1f} MB")
            tcia.download_series(coll, pid, se["uid"], row)


def cmd_index() -> None:
    """Upsert the entries of packs built by this pipeline into public/packs/index.json, merging by id.
    Entries for packs this pipeline does not own (e.g. 'vessel-drafts') are preserved untouched."""
    sel = load_json(SELECTION)
    idx_path = PACKS_DIR / "index.json"
    existing = load_json(idx_path)["packs"] if idx_path.exists() else []
    mine = {}
    for pid, cfg in sel["packs"].items():
        man = PACKS_DIR / pid / "pack.json"
        if not man.exists():
            continue
        m = load_json(man)
        total = sum(p.stat().st_size for p in (PACKS_DIR / pid).rglob("*") if p.is_file())
        dicom = sum(p.stat().st_size for p in (PACKS_DIR / pid / "dicom").rglob("*") if p.is_file())
        n_inst = sum(len(s["instances"]) for s in m["series"])
        lessons = f"{pid}/lessons.json" if (PACKS_DIR / pid / "lessons.json").exists() else None
        dist = cfg.get("distribution", "fetch_script")
        note = (f"{len(m['subjects'])} subjects, {len(m['studies'])} studies, {len(m['series'])} series, {n_inst} instances, "
                f"{len(m['referenceTargets'])} reference targets; DICOM {dicom/1e6:.1f} MB. ")
        note += ("Committed to the repository." if dist == "repo" else
                 f"Not committed: run `python scripts/data/packs.py all {pid}` to download from TCIA and rebuild.")
        mine[pid] = {"id": pid, "title": m["title"], "manifest": f"{pid}/pack.json", "lessons": lessons,
                     "bytes": total, "distribution": dist, "note": note}
    merged, seen = [], set()
    for e in existing:
        if e.get("id") in mine:
            merged.append(mine[e["id"]])
        else:
            merged.append(e)  # not built by this pipeline: keep exactly as found
        seen.add(e.get("id"))
    merged += [e for pid, e in mine.items() if pid not in seen]
    dump_json({"schemaVersion": 1, "packs": merged}, idx_path)
    print(json.dumps({p["id"]: p["bytes"] for p in merged}))


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit(__doc__)
    cmd = argv[0]
    if cmd == "list":
        cmd_list()
    elif cmd == "fetch":
        cmd_fetch(argv[1])
    elif cmd == "build":
        import build_pack
        build_pack.build(argv[1])
    elif cmd == "validate":
        import validate_pack
        ok = validate_pack.validate(argv[1])
        if ok:
            cmd_index()
        raise SystemExit(0 if ok else 1)
    elif cmd == "index":
        cmd_index()
    elif cmd == "all":
        import build_pack
        import validate_pack
        cmd_fetch(argv[1])
        build_pack.build(argv[1])
        ok = validate_pack.validate(argv[1])
        cmd_index()
        raise SystemExit(0 if ok else 1)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
