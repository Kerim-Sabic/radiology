"""Builds public/content/credits.json, the data of the public /credits page.

  python scripts/data/credits.py

Every `sources` entry of every public/packs/*/pack.json is merged with the hand-written entries in
scripts/data/credits_extra.json (matched by id, DOI or URL; the extras' fields win). Extras that match no pack source
stand alone (datasets not yet in a pack, AI tools, software). Re-run after a pack is added; tests/credits.test.ts fails
if a pack source id is missing from the output. The output has no timestamp, so a re-run changes nothing unless the
sources changed.
"""
import glob
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "content", "credits.json")
EXTRA = os.path.join(os.path.dirname(__file__), "credits_extra.json")

KINDS = [
    ("images", "Images and datasets"),
    ("ai_tools", "AI tools"),
    ("other", "Other credits"),
]
GENERIC_USAGE = "Studies and images from this collection are shown as de-identified cases, with the collection's own labels where it provides them."


def norm(v):
    if not v:
        return None
    v = str(v).strip().lower()
    v = re.sub(r"^https?://(dx\.)?doi\.org/", "", v)
    v = re.sub(r"^https?://", "", v).rstrip("/")
    return v


def keys(e):
    ks = {norm(e.get("id")), norm(e.get("doi")), norm(e.get("url"))}
    ks |= {norm(m) for m in e.get("match", [])}
    return {k for k in ks if k}


def owner_from_citation(c):
    head = re.split(r"\s\(\d{4}\)|\.\s|\s\d{4}[;:.]", c, maxsplit=1)[0].strip()
    first = head.split(",")[0].strip()
    return f"{first} et al." if (head.count(",") >= 2 or " et al" in head) else (head or "See the citation")


def main():
    entries = {}  # id -> entry
    order = []
    for f in sorted(glob.glob(os.path.join(ROOT, "public", "packs", "*", "pack.json"))):
        pid = os.path.basename(os.path.dirname(f))
        with open(f, encoding="utf8") as fh:
            d = json.load(fh)
        for s in d.get("sources") or []:
            sid = s["id"]
            e = entries.get(sid)
            if e is None:
                e = {
                    "id": sid, "ids": [sid], "kind": "images", "name": s["name"], "what": "", "usage": GENERIC_USAGE,
                    "owner": owner_from_citation(s["citation"]), "license": s["license"],
                    "licenseUrl": s.get("licenseUrl"), "permission": False, "url": s["url"], "doi": s.get("doi"),
                    "links": [], "citation": s["citation"], "packs": [],
                }
                entries[sid] = e
                order.append(sid)
            if pid not in e["packs"]:
                e["packs"].append(pid)
    with open(EXTRA, encoding="utf8") as fh:
        extras = json.load(fh)["entries"]
    for x in extras:
        hit = None
        for sid in order:
            if sid == x["id"] or keys(entries[sid]) & keys(x):
                hit = sid
                break
        if hit is None:
            e = {"id": x["id"], "ids": [x["id"]], "kind": "other", "name": x["name"], "what": "", "usage": "", "owner": "",
                 "license": "", "licenseUrl": None, "permission": False, "url": "", "doi": None, "links": [], "citation": "", "packs": []}
            entries[x["id"]] = e
            order.append(x["id"])
        else:
            e = entries[hit]
            if x["id"] not in e["ids"]:
                e["ids"].append(x["id"])
        for k, v in x.items():
            if k in ("id", "match"):
                continue
            e[k] = v
    groups = []
    for kind, title in KINDS:
        items = [entries[i] for i in order if entries[i]["kind"] == kind]
        items.sort(key=lambda e: e["name"].lower())
        for e in items:
            e["packs"].sort()
        groups.append({"kind": kind, "title": title, "entries": items})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8", newline="\n") as fh:
        json.dump({"groups": groups}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    counts = ", ".join(f"{g['title']} {len(g['entries'])}" for g in groups)
    print(f"credits.json: {sum(len(g['entries']) for g in groups)} entries ({counts})")


if __name__ == "__main__":
    main()
