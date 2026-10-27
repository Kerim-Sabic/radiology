#!/usr/bin/env python3
"""Index the structure of *Learning Radiology: Recognizing the Basics* (5th ed.).

Regenerates three structural JSON files from the user's own PDF copy:

    page-map.v1.json   physical page -> printed label, page kind, unit id
    figures.v1.json    figure / table / box IDs, pages, image bbox, modality
    sections.v1.json   headings (from the PDF outline, cross-checked against
                       heading fonts) plus case-quiz, take-home, pitfalls and
                       video-listing markers

Copyright note: the repository is public. This script writes only IDs, page
numbers, bounding boxes, short heading titles and machine-composed
descriptions built from a controlled vocabulary defined in this file. It never
writes book prose, captions or extracted body text.

Usage:
    python scripts/book/index_book.py --pdf <book.pdf> --out public/content/book
    python scripts/book/index_book.py --pdf <book.pdf> --out public/content/book --check

Requires PyMuPDF (``fitz``) and numpy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")
import numpy as np

EXPECTED_SHA256 = "0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1"
EXPECTED_PAGES = 552
DOC_META = {
    "title": "Learning Radiology: Recognizing the Basics",
    "edition": "5th",
    "author": "William Herring",
    "isbn": "9780323878173",
}
SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# Known anchors asserted by --check (numbers only; verified by hand 2026-10-27)
# unit id -> (first physical page, printed label of that page)
KNOWN_UNIT_STARTS = {  # printed labels cross-checked against the book's Contents pages
    "ch01": (15, "1"), "ch02": (26, "11"), "ch03": (37, "22"), "ch04": (49, "34"),
    "ch05": (60, "45"), "ch06": (65, "50"), "ch07": (74, "59"), "ch08": (84, "69"),
    "ch09": (94, "79"), "ch10": (112, "92"), "ch11": (131, "111"), "ch12": (148, "128"),
    "ch13": (160, "140"), "ch14": (169, "149"), "ch15": (181, "161"), "ch16": (191, "171"),
    "ch17": (199, "179"), "ch18": (221, "201"), "ch19": (243, "223"), "ch20": (256, "236"),
    "ch21": (267, "247"), "ch22": (290, "270"), "ch23": (303, "283"), "ch24": (321, "301"),
    "ch25": (334, "314"), "ch26": (341, "321"), "ch27": (367, "347"), "ch28": (382, "362"),
    "ch29": (402, "382"),
    "appA": (420, "e1"), "appB": (440, "e21"), "appC": (454, "e35"), "appD": (458, "e39"),
    "appE": (464, "e45"), "appF": (469, "e50"), "appG": (520, "e101"), "appH": (530, "e111"),
}
KNOWN_UNIT_ENDS = {"ch01": (25, "10"), "ch29": (419, "399"), "appA": (439, "e20"),
                   "appB": (453, "e34"), "appC": (457, "e38"), "appD": (463, "e44"),
                   "appE": (468, "e49"), "appF": (519, "e100"), "appG": (529, "e110"),
                   "appH": (531, "e112")}
KNOWN_LABELS = {15: "1", 16: "2", 17: "2.e1", 18: "3", 39: "24", 40: "25",
                95: "79.e1", 96: "79.e2", 97: "79.e3", 98: "79.e4", 99: "79.e5",
                100: "80", 420: "e1", 469: "e50", 532: "400", 535: "403"}
KNOWN_KINDS = {17: "inserted", 95: "inserted", 99: "inserted", 100: "chapter",
               532: "bibliography", 535: "index", 420: "appendix"}
KNOWN_FIGURES = {"Fig 3.5": 40, "Fig 3.6": 40, "eFig 1.1": 17, "eFig 9.1": 95}
KNOWN_SECTIONS = [("ch03", "Five-Vessel Level", 39)]

# ---------------------------------------------------------------------------
LABEL_RE = re.compile(r"^(\d+(\.e\d+)?|e\d+|[ivxlc]+)$")
ROMAN = [(100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
         (5, "v"), (4, "iv"), (1, "i")]


def to_roman(n: int) -> str:
    out = ""
    for v, s in ROMAN:
        while n >= v:
            out += s
            n -= v
    return out


def from_roman(s: str) -> int:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}
    total = 0
    for i, ch in enumerate(s):
        v = vals[ch]
        if i + 1 < len(s) and vals[s[i + 1]] > v:
            total -= v
        else:
            total += v
    return total


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def norm(s: str) -> str:
    s = s.replace("ﬁ", "fi").replace("ﬂ", "fl")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def unit_id_from_outline(title: str):
    m = re.match(r"^(\d+)\.\s", title)
    if m:
        return "ch%02d" % int(m.group(1)), "chapter", m.group(1)
    m = re.match(r"^([A-H])\s*-", title)
    if m:
        return "app" + m.group(1), "appendix", m.group(1)
    return None


# ---------------------------------------------------------------------------
# Span extraction
class Page:
    __slots__ = ("pno", "w", "h", "spans", "lines")

    def __init__(self, pno, w, h, spans):
        self.pno, self.w, self.h, self.spans = pno, w, h, spans
        self.lines = None


def extract_pages(doc):
    pages = []
    for i, p in enumerate(doc):
        d = p.get_text("dict")
        spans = []
        for b in d["blocks"]:
            if b.get("type") != 0:
                continue
            for line in b["lines"]:
                for s in line["spans"]:
                    t = s["text"]
                    if not t.strip():
                        continue
                    x0, y0, x1, y1 = s["bbox"]
                    spans.append({"t": t.strip(), "s": round(s["size"], 1),
                                  "b": (x0, y0, x1, y1)})
        pages.append(Page(i + 1, p.rect.width, p.rect.height, spans))
    return pages


def yc(s):
    return (s["b"][1] + s["b"][3]) / 2


def page_lines(pg: Page):
    """Group spans into visual lines (column-aware)."""
    if pg.lines is not None:
        return pg.lines
    sp = sorted(pg.spans, key=lambda s: (round(yc(s)), s["b"][0]))
    lines = []
    for s in sp:
        c = yc(s)
        for L in lines:
            if abs(L["yc"] - c) < 3 and -1 <= s["b"][0] - L["x1"] < 12:
                L["spans"].append(s)
                L["x1"] = max(L["x1"], s["b"][2])
                break
        else:
            lines.append({"yc": c, "x0": s["b"][0], "x1": s["b"][2], "spans": [s]})
    for L in lines:
        L["spans"].sort(key=lambda s: s["b"][0])
        L["text"] = " ".join(s["t"] for s in L["spans"])
        L["y0"] = min(s["b"][1] for s in L["spans"])
        L["y1"] = max(s["b"][3] for s in L["spans"])
        L["size"] = max(s["s"] for s in L["spans"])
        L["col"] = 0 if L["x0"] < pg.w / 2 - 10 else 1
    lines.sort(key=lambda L: (L["col"], L["y0"], L["x0"]))
    pg.lines = lines
    return lines


# ---------------------------------------------------------------------------
# Page map
def detect_label(pg: Page):
    cands = []
    for s in pg.spans:
        x0, y0, x1, y1 = s["b"]
        if (y1 < 45 or y0 > pg.h - 45) and (x0 < 75 or x1 > pg.w - 75) and LABEL_RE.match(s["t"]):
            cands.append((0 if y1 < 45 else 1, s["t"]))
    cands.sort()
    return cands[0][1] if cands else None


def header_unit(pg: Page):
    top = " ".join(s["t"] for s in sorted([s for s in pg.spans if s["b"][3] < 45],
                                           key=lambda s: s["b"][0]))
    m = re.search(r"CHAPTER\s+(\d+)", top)
    if m:
        return "ch%02d" % int(m.group(1))
    m = re.search(r"E-APPENDIX\s+([A-H])", top)
    if m:
        return "app" + m.group(1)
    if "BIBLIOGRAPHY" in top:
        return "bibliography"
    if re.search(r"\bINDEX\b", top):
        return "index"
    return None


def is_blank(pg: Page):
    return norm(" ".join(s["t"] for s in pg.spans)) == "thispageintentionallyleftblank"


def build_units(doc, n_pages):
    toc = doc.get_toc()
    starts = []
    for lvl, title, page in toc:
        if lvl != 1:
            continue
        u = unit_id_from_outline(title)
        if u:
            uid, kind, number = u
            title_clean = re.sub(r"^(\d+\.|[A-H]\s*-)\s*", "", title).strip()
            starts.append({"id": uid, "kind": kind, "number": number,
                           "title": title_clean, "start": page})
        elif title.strip().upper() in ("BIBLIOGRAPHY", "INDEX"):
            starts.append({"id": title.strip().lower(), "kind": title.strip().lower(),
                           "number": None, "title": title.strip().title(), "start": page})
    starts.sort(key=lambda u: u["start"])
    for i, u in enumerate(starts):
        u["end"] = (starts[i + 1]["start"] - 1) if i + 1 < len(starts) else n_pages
    return toc, starts


def build_page_map(pages, units):
    n = len(pages)
    raw = [detect_label(pg) for pg in pages]
    labels = list(raw)
    inferred = [False] * n

    def kind_of(lab):
        if lab is None:
            return None
        if re.fullmatch(r"[ivxlc]+", lab):
            return "roman"
        if re.fullmatch(r"\d+", lab):
            return "arabic"
        if re.fullmatch(r"e\d+", lab):
            return "eapp"
        return "inserted"

    def value(lab):
        k = kind_of(lab)
        if k == "roman":
            return from_roman(lab)
        if k == "arabic":
            return int(lab)
        if k == "eapp":
            return int(lab[1:])
        return None

    # infer missing labels from the nearest labelled neighbours of the same series
    for i in range(n):
        if labels[i] is not None:
            continue
        guess = None
        for d in range(1, 8):  # look forward first (front matter), then back
            j = i + d
            if j < n and raw[j] is not None and kind_of(raw[j]) in ("roman", "arabic", "eapp"):
                v = value(raw[j]) - d
                k = kind_of(raw[j])
                # make sure the previous labelled page agrees (if it is the same series)
                back = next((i - e for e in range(1, 8) if i - e >= 0 and raw[i - e] is not None), None)
                if back is not None and kind_of(raw[back]) == k and value(raw[back]) + (i - back) != v:
                    v = None
                if v is not None and v >= 1:
                    guess = to_roman(v) if k == "roman" else ("e%d" % v if k == "eapp" else str(v))
                break
        if guess is None:
            for d in range(1, 8):
                j = i - d
                if j >= 0 and raw[j] is not None and kind_of(raw[j]) in ("roman", "arabic", "eapp"):
                    k = kind_of(raw[j])
                    v = value(raw[j]) + d
                    guess = to_roman(v) if k == "roman" else ("e%d" % v if k == "eapp" else str(v))
                    break
        if guess is not None:
            labels[i] = guess
            inferred[i] = True

    unit_of = {}
    for u in units:
        for p in range(u["start"], u["end"] + 1):
            unit_of[p] = u
    first_unit = min(u["start"] for u in units)

    entries = []
    for i, pg in enumerate(pages):
        p = i + 1
        u = unit_of.get(p)
        if is_blank(pg):
            kind = "blank"
        elif p < first_unit or u is None:
            kind = "front"
        elif u["kind"] in ("chapter", "appendix", "bibliography", "index"):
            kind = u["kind"]
            if kind == "chapter" and labels[i] and ".e" in labels[i]:
                kind = "inserted"
        else:
            kind = "front"
        if kind == "blank" and u is not None and u["kind"] in ("index", "bibliography"):
            pass
        chapter_id = u["id"] if (u is not None and u["kind"] in ("chapter", "appendix")
                                 and kind != "blank") else None
        e = {"physical": p, "printed": labels[i], "kind": kind, "chapterId": chapter_id}
        if inferred[i]:
            e["inferred"] = True
        entries.append(e)
    return entries


# ---------------------------------------------------------------------------
# Sections (PDF outline cross-checked against heading fonts)
SPECIAL_RE = [
    (re.compile(r"^CASE QUIZ\s+\d+\s+QUESTION$"), "case_quiz_question"),
    (re.compile(r"^CASE QUIZ\s+\d+\s+ANSWER$"), "case_quiz_answer"),
    (re.compile(r"^TAKE HOME POINTS$"), "take_home"),
    (re.compile(r"^DIAGNOSTIC PITFALLS$"), "pitfalls"),
]


def find_heading_line(pg: Page, title: str, min_size: float):
    """First heading-sized line whose text (joined with up to two wrapped
    continuation lines of the same size) starts with the outline title."""
    nt = norm(title)
    key = nt[:60]
    if not key:
        return None
    lines = page_lines(pg)
    for i, L in enumerate(lines):
        if L["size"] < min_size:
            continue
        # the em dash glyph is extracted as an isolated "d" in this PDF
        joined = norm(re.sub(r"\s+d\s+", " ", L["text"]))
        for M in lines[i + 1:i + 3]:
            if M["col"] == L["col"] and abs(M["size"] - L["size"]) < 0.3 and 0 <= M["y0"] - L["y1"] < 6:
                joined += norm(re.sub(r"\s+d\s+", " ", M["text"]))
        if joined.startswith(key) or (len(joined) >= 12 and key.startswith(joined)):
            return L
    return None


def build_sections(toc, units, pages, pmap):
    unit_by_id = {u["id"]: u for u in units}
    out = []
    problems = []
    counters = defaultdict(int)
    current = None
    for lvl, title, page in toc:
        if lvl == 1:
            u = unit_id_from_outline(title)
            current = unit_by_id.get(u[0]) if u else None
            continue
        if current is None or current["kind"] not in ("chapter", "appendix"):
            continue
        level = min(lvl - 1, 3)
        pg = pages[page - 1]
        L = find_heading_line(pg, title, 9.95 if lvl <= 4 else 9.0)
        verified = L is not None
        if not verified:
            for dp in (1, -1):
                q = page + dp
                if 1 <= q <= len(pages):
                    L2 = find_heading_line(pages[q - 1], title, 9.95 if lvl <= 4 else 9.0)
                    if L2 is not None:
                        page, L, verified = q, L2, True
                        break
        if not verified:
            problems.append((current["id"], title, page))
        counters[current["id"]] += 1
        sid = "%s-s%02d" % (current["id"], counters[current["id"]])
        clean = re.sub(r"\s+", " ", title.replace("``", "“").replace("''", "”")).strip()
        e = {"id": sid, "chapterId": current["id"], "title": clean, "level": level,
             "kind": "heading", "physical": page, "printed": pmap[page - 1]["printed"],
             "_y": L["y0"] if L else 0.0, "_col": L["col"] if L else 0}
        if not verified:
            e["verified"] = False
        out.append(e)

    # special boxes found by their 11 pt uppercase banners
    special_counts = defaultdict(int)
    for pg in pages:
        u = pmap[pg.pno - 1]["chapterId"]
        if not u:
            continue
        for L in page_lines(pg):
            if L["size"] < 10.5 or L["size"] > 11.5:
                continue
            txt = re.sub(r"\s+", " ", L["text"]).strip()
            for rx, kind in SPECIAL_RE:
                if rx.match(txt):
                    if kind == "take_home":
                        sid = "%s-takehome" % u
                        title = "Take Home Points"
                    elif kind == "case_quiz_question":
                        sid = "%s-quiz-question" % u
                        title = "Case Quiz Question"
                    elif kind == "case_quiz_answer":
                        sid = "%s-quiz-answer" % u
                        title = "Case Quiz Answer"
                    else:
                        special_counts[(u, kind)] += 1
                        sid = "%s-pitfalls-%d" % (u, special_counts[(u, kind)])
                        title = "Diagnostic Pitfalls"
                    if any(s["id"] == sid for s in out):
                        problems.append((u, "duplicate special " + sid, pg.pno))
                        continue
                    out.append({"id": sid, "chapterId": u, "title": title, "level": 2,
                                "kind": kind, "physical": pg.pno,
                                "printed": pmap[pg.pno - 1]["printed"],
                                "_y": L["y0"], "_col": L["col"]})
    return out, problems


def build_video_listing(toc, pages, pmap):
    """Video Contents page (front matter) + in-text 'Video N.M' references.

    Only IDs and page numbers are recorded; this does not assert that any video
    is available to the app.
    """
    listing_page = None
    for lvl, title, page in toc:
        if lvl == 1 and title.strip().lower() == "video contents":
            listing_page = page
    refs = {}
    # "Video 1.1", "Videos 19.4 and 19.5", "Videos 18.1-18.8" (range ends only; not expanded)
    rx = re.compile(r"\bVideos?\s+((?:\d{1,2}\.\d{1,2}(?:\s*(?:,|and|to|–|-)\s*)?)+)")
    for pg in pages:
        u = pmap[pg.pno - 1]["chapterId"]
        if not u or not u.startswith("ch"):
            continue
        txt = " ".join(L["text"] for L in page_lines(pg))
        for m in rx.finditer(txt):
            for num in re.findall(r"\d{1,2}\.\d{1,2}", m.group(1)):
                vid = "Video " + num
                if vid not in refs:
                    refs[vid] = {"id": vid, "chapterId": "ch%02d" % int(num.split(".")[0]),
                                 "firstMentionPhysical": pg.pno,
                                 "firstMentionPrinted": pmap[pg.pno - 1]["printed"]}
    listed = set()
    if listing_page:
        for L in page_lines(pages[listing_page - 1]):
            m = re.match(r"^(\d{1,2}\.\d{1,2})\s", L["text"])
            if m:
                listed.add("Video " + m.group(1))
    for vid in listed:
        refs.setdefault(vid, {"id": vid, "chapterId": "ch%02d" % int(vid.split()[1].split(".")[0]),
                              "firstMentionPhysical": None, "firstMentionPrinted": None})
    for vid, r in refs.items():
        r["inVideoContents"] = vid in listed
    vids = sorted(refs.values(), key=lambda r: tuple(int(x) for x in r["id"].split()[1].split(".")))
    return listing_page, vids


# ---------------------------------------------------------------------------
# Figures, tables, boxes
PFX_RE = re.compile(r"^(e-?)?(Fig\.?|FIG\.?|Figure|TABLE|Table|BOX|Box)$")
COMB_RE = re.compile(r"^(e-?)?(Fig\.?|FIG\.?|TABLE|Table|BOX|Box)\s*([0-9]{1,2}|[A-H])\.(\d{1,3})(.*)$")
NUM_RE = re.compile(r"^([0-9]{1,2}|[A-H])\.(\d{1,3})(.*)$")


def find_caption_starts(pages, pmap):
    """Return dict id -> caption record (first valid occurrence)."""
    found = {}
    rejected = defaultdict(int)
    for pg in pages:
        unit = pmap[pg.pno - 1]["chapterId"]
        if not unit:
            continue
        sp = pg.spans
        for i, s in enumerate(sp):
            m = PFX_RE.match(s["t"])
            if m and i + 1 < len(sp):
                m2 = NUM_RE.match(sp[i + 1]["t"])
                if not m2:
                    continue
                eflag, kw = m.group(1) or "", m.group(2)
                ch, num, rest = m2.group(1), int(m2.group(2)), m2.group(3)
                after = sp[i + 2]["t"] if i + 2 < len(sp) else ""
                num_span = sp[i + 1]
            else:
                m = COMB_RE.match(s["t"])
                if not m:
                    continue
                eflag, kw, ch, num, rest = m.group(1) or "", m.group(2), m.group(3), int(m.group(4)), m.group(5)
                after = sp[i + 1]["t"] if i + 1 < len(sp) else ""
                num_span = s
            kwl = kw.lower().rstrip(".")
            kind = "figure" if kwl.startswith("fig") else ("table" if kwl == "table" else "box")
            # reference, not caption: panel suffix or closing parenthesis
            if re.match(r"^[A-Za-z]", rest) or rest.startswith(")") or (not rest and after.startswith(")")):
                rejected["reference"] += 1
                continue
            # must start a visual line (nothing immediately to the left)
            left = [o for o in sp if o is not s and abs(yc(o) - yc(s)) < 3
                    and s["b"][0] - 9 < o["b"][2] <= s["b"][0] + 1]
            if left:
                rejected["not_line_start"] += 1
                continue
            if kind == "figure":
                if not (7.5 <= s["s"] <= 8.6):
                    rejected["figure_size"] += 1
                    continue
                # wrapped reference: a line of caption prose immediately above, overlapping
                # (short image labels such as "LV" or "Reflection" do not count)
                above = [L for L in page_lines(pg) if L["size"] <= 8.6 and 4 < yc(s) - L["yc"] < 16
                         and L["x0"] <= s["b"][0] + 100 and L["x1"] > s["b"][0]
                         and len(L["text"].split()) >= 5]
                if above:
                    rejected["wrapped_reference"] += 1
                    continue
            else:
                if s["s"] < 9.5:
                    rejected["table_size"] += 1
                    continue
                if not (kw.isupper() or eflag):
                    rejected["mixed_case_reference"] += 1
                    continue
            # unit consistency
            if unit.startswith("ch"):
                if not ch.isdigit() or "ch%02d" % int(ch) != unit:
                    rejected["other_unit"] += 1
                    continue
            else:
                if ch != unit[3:]:
                    rejected["other_unit"] += 1
                    continue
            prefix = {"figure": "Fig", "table": "Table", "box": "Box"}[kind]
            fid = "%s%s %s.%d" % ("e" if eflag else "", prefix, ch, num)
            if fid in found:
                rejected["duplicate_later_occurrence"] += 1
                continue
            found[fid] = {"id": fid, "kind": kind, "e": bool(eflag), "ch": ch, "num": num,
                          "unit": unit, "physical": pg.pno, "start_span": s,
                          "num_span": num_span}
    return found, dict(rejected)


def caption_block(pg: Page, start):
    """Collect the caption's spans (caption-size text flowing below the start).

    The horizontal window is fixed by the first line and the page column, so a
    neighbouring caption in the other column is never absorbed.
    """
    s0 = start
    x0 = s0["b"][0]
    right_col = x0 > pg.w / 2 - 20
    cap_size = s0["s"]
    if cap_size <= 8.6:
        small = [s for s in pg.spans if s["s"] <= 8.6]
    else:  # table / box titles are set in a larger face
        small = [s for s in pg.spans if cap_size - 0.6 <= s["s"] <= 11.6]
    first = [s for s in small if abs(yc(s) - yc(s0)) < 3 and s["b"][0] >= x0 - 1]
    first.sort(key=lambda s: s["b"][0])
    line = [first[0]] if first else [s0]
    for s in first[1:]:
        if s["b"][0] - line[-1]["b"][2] < 14:
            line.append(s)
    bx0 = min(s["b"][0] for s in line)
    bx1 = max(s["b"][2] for s in line)
    if right_col:
        lo, hi = max(bx0 - 25, pg.w / 2 - 12), pg.w
    else:
        lo, hi = bx0 - 25, (pg.w / 2 + 5 if bx1 < pg.w / 2 + 5 else pg.w)
    by0 = min(s["b"][1] for s in line)
    by1 = max(s["b"][3] for s in line)
    members = set(id(s) for s in line)
    while True:
        # add the whole next line at once (spans of one line differ slightly in y)
        nxt = [s for s in small if id(s) not in members and by1 - 3 < s["b"][1] < by1 + 6
               and s["b"][0] >= lo and s["b"][2] <= hi + 2]
        if not nxt:
            break
        for s in nxt:
            members.add(id(s))
        by1 = max([by1] + [s["b"][3] for s in nxt])
        bx1 = max([bx1] + [s["b"][2] for s in nxt])
    mem = sorted([s for s in small if id(s) in members], key=lambda s: (yc(s), s["b"][0])) or list(line)
    rows = []
    for s in mem:
        if rows and abs(yc(s) - rows[-1][0]) < 3:
            rows[-1][1].append(s)
        else:
            rows.append([yc(s), [s]])
    text = " ".join(" ".join(t["t"] for t in sorted(r[1], key=lambda t: t["b"][0])) for r in rows)
    bx0 = min(s["b"][0] for s in mem)
    return (bx0, by0, bx1, by1), text, members


def render_rgb(page, scale):
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return arr.astype(np.int16)


def runs(mask, gap):
    """Contiguous True runs in a 1-D bool array, merging gaps <= gap."""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return []
    out = []
    a = b = int(idx[0])
    for v in idx[1:]:
        v = int(v)
        if v - b <= gap + 1:
            b = v
        else:
            out.append((a, b))
            a = b = v
    out.append((a, b))
    return out


def is_obstacle_line(L, members):
    if any(id(s) in members for s in L["spans"]):
        return False
    t = L["text"]
    if L["size"] >= 10.4 and len(t) >= 3:
        return True
    if L["size"] >= 9.5 and (len(t.split()) >= 4 or len(t) >= 25):
        return True
    return False


def detect_bbox(pg: Page, ink, scale, cap_box, members, other_caps):
    """Find the image region adjacent to a caption. Returns normalized bbox or None."""
    W, H = pg.w, pg.h
    cx0, cy0, cx1, cy1 = cap_box
    bx0, bx1 = max(0, cx0 - 6), min(W, cx1 + 6)
    if (cx1 - cx0) < 0.45 * W and abs((cx0 + cx1) / 2 - W / 2) < 40:
        # short centred caption under a page-wide composite figure
        bx0, bx1 = 36.0, W - 36.0
    lines = page_lines(pg)
    obstacles = [L for L in lines if is_obstacle_line(L, members)]
    obstacles += [{"x0": b[0], "x1": b[2], "y0": b[1], "y1": b[3]} for b in other_caps]

    def overlaps(o):
        return o["x1"] > bx0 + 5 and o["x0"] < bx1 - 5

    def analyse(y_top, y_bot, prefer):
        if y_bot - y_top < 25:
            return None
        r0, r1 = int(y_top * scale), int(y_bot * scale)
        c0, c1 = int(bx0 * scale), int(bx1 * scale)
        sub = ink[r0:r1, c0:c1]
        if sub.size == 0:
            return None
        row_frac = sub.mean(axis=1)
        rr = [r for r in runs(row_frac > 0.02, int(6 * scale)) if (r[1] - r[0]) >= 12 * scale]
        if not rr:
            return None
        # anchor on the nearest substantial run, then keep runs contiguous with it
        # (allow white gaps of <= 40 pt, e.g. between stacked panels)
        rr.sort(key=lambda r: r[0], reverse=(prefer == "up"))
        anchor = next((k for k, r in enumerate(rr) if (r[1] - r[0]) >= 30 * scale), None)
        if anchor is None:
            return None
        a = rr[anchor]
        gap0 = (sub.shape[0] - a[1]) if prefer == "up" else a[0]
        if gap0 > 120 * scale:
            return None
        keep = rr[:anchor + 1]
        for r in rr[anchor + 1:]:
            last = keep[-1]
            gap = (last[0] - r[1]) if prefer == "up" else (r[0] - last[1])
            if gap <= 50 * scale:
                keep.append(r)
            else:
                break
        fy0 = r0 + min(r[0] for r in keep)
        fy1 = r0 + max(r[1] for r in keep) + 1
        if (fy1 - fy0) < 30 * scale:
            return None
        band = ink[fy0:fy1, :]
        col_frac = band.mean(axis=0)
        cr = runs(col_frac > 0.03, int(8 * scale))
        cr = [c for c in cr if c[1] >= c0 and c[0] <= c1 and (c[1] - c[0]) >= 20 * scale]
        if not cr:
            return None
        fx0 = min(c[0] for c in cr)
        fx1 = max(c[1] for c in cr) + 1
        return (fx0 / scale, fy0 / scale, fx1 / scale, fy1 / scale)

    # search above the caption
    above = [o for o in obstacles if overlaps(o) and o["y1"] <= cy0 + 1]
    top = max([o["y1"] for o in above] + [44.0])
    res = analyse(top, cy0 - 1, "up")
    if res is None:
        below = [o for o in obstacles if overlaps(o) and o["y0"] >= cy1 - 1]
        bot = min([o["y0"] for o in below] + [H - 40.0])
        res = analyse(cy1 + 1, bot, "down")
    if res is None:
        # side caption: image to the left or right, vertically overlapping the caption
        for side in ("left", "right"):
            if side == "left":
                sx0, sx1 = 36.0, cx0 - 4
            else:
                sx0, sx1 = cx1 + 4, W - 36.0
            if sx1 - sx0 < 60:
                continue
            c0, c1 = int(sx0 * scale), int(sx1 * scale)
            r0 = int(max(44.0, cy0 - 400) * scale)
            r1 = int(min(H - 40.0, cy1 + 60) * scale)
            sub = ink[r0:r1, c0:c1]
            if sub.size == 0:
                continue
            rr = [r for r in runs(sub.mean(axis=1) > 0.25, int(6 * scale)) if (r[1] - r[0]) >= 40 * scale]
            rr = [r for r in rr if r0 + r[1] >= cy0 * scale - 2 and r0 + r[0] <= cy1 * scale + 2]
            if not rr:
                continue
            fy0, fy1 = r0 + rr[0][0], r0 + rr[0][1] + 1
            cr = runs(ink[fy0:fy1, c0:c1].mean(axis=0) > 0.25, int(8 * scale))
            cr = [c for c in cr if (c[1] - c[0]) >= 40 * scale]
            if not cr:
                continue
            res = ((c0 + min(c[0] for c in cr)) / scale, fy0 / scale,
                   (c0 + max(c[1] for c in cr) + 1) / scale, fy1 / scale)
            break
    if res is None:
        return None
    x0, y0, x1, y1 = res
    return [round(max(0.0, x0 / W), 4), round(max(0.0, y0 / H), 4),
            round(min(1.0, x1 / W), 4), round(min(1.0, y1 / H), 4)]


def ink_mask(pg: Page, rgb, scale):
    gray = rgb.mean(axis=2)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    ink = (gray < 205) | ((sat > 0.2) & (gray < 245))
    # erase all text so only pictorial content remains
    for s in pg.spans:
        x0, y0, x1, y1 = s["b"]
        ink[max(0, int(y0 * scale) - 1):int(y1 * scale) + 2,
            max(0, int(x0 * scale) - 1):int(x1 * scale) + 2] = False
    return ink, gray, sat


# ---- modality / annotation / description heuristics (controlled vocabulary)
MODALITY_RULES = [
    ("diagram", r"\b(diagram|illustration|drawing|schematic|cartoon|artist|algorithm|flow ?chart|graph)\b"),
    ("photo", r"\b(photograph|photo|photomicrograph)\b"),
    ("mammo", r"\b(mammogra\w*|tomosynthesis|craniocaudal|mediolateral oblique|(?-i:CC|MLO) views?)\b"),
    ("NM", r"\b(scintigra\w*|nuclear medicine|(?-i:PET)|(?-i:SPECT)|bone scans?|radionuclide|(?-i:V/Q)|"
           r"ventilation/perfusion|perfusion scan|technetium|tc-?99m|(?-i:FDG)|(?-i:HIDA)|thyroid scan|gallium|"
           r"indium|octreotide|sestamibi|thallium|radiotracer|radiopharmaceutical)\b"),
    ("US", r"\b(ultraso\w*|sonogra\w*|sonographic|doppler|transducer|(?-i:US)|(?-i:POCUS)|echocardiogra\w*)\b"),
    ("MRI", r"\b((?-i:MRI|MR|MRA|MRCP|DWI|FLAIR|STIR)|magnetic resonance|t1[- ]?weighted|t2[- ]?weighted|"
            r"diffusion[- ]weighted|gadolinium|(?-i:T1|T2)W?I?)\b"),
    # plane words (axial/coronal/sagittal) are deliberately not CT clues: MRI uses them too
    ("CT", r"\b((?-i:CT|CTA|HRCT|CECT|NCCT|MIP)|computed tomogra\w*|ct scans?|"
           r"scout (image|view)|scanogram|topogram|maximum intensity projection)\b"),
    # bare "angiogram" is ambiguous (CT vs catheter) and therefore not a fluoroscopy clue
    ("fluoro", r"\b(fluoroscop\w*|barium|esophagram|upper (?-i:GI)|small bowel follow|enema|"
               r"cystogra\w*|cystourethrogra\w*|urethrogra\w*|hysterosalpingogra\w*|arteriogra\w*|venogra\w*|"
               r"catheter angiogra\w*|digital subtraction|(?-i:DSA)|myelogra\w*|fistulogra\w*|"
               r"urogra\w*|(?-i:IVP)|sinogra\w*|contrast stud\w*|swallow stud\w*|embolization|"
               r"cholangiogra\w*|(?-i:ERCP))\b"),
    ("radiograph", r"\b(radiograph\w*|x-?rays?|plain films?|(?-i:PA|AP)|"
                   r"frontal (view|radiograph|projection|chest|film)|lateral (view|radiograph|chest|film)|"
                   r"supine|upright|decubitus|portable|chest films?|oblique views?|"
                   r"conventional radiograph\w*)\b"),
]
MODALITY_RULES = [(name, re.compile(rx, re.I)) for name, rx in MODALITY_RULES]
# chapters where an image without explicit modality words is almost always one modality
UNIT_DEFAULT_MODALITY = {
    "ch02": "radiograph", "ch04": "radiograph", "ch05": "radiograph", "ch06": "radiograph",
    "ch07": "radiograph", "ch08": "radiograph", "ch09": "radiograph", "ch10": "radiograph",
    "ch11": "radiograph", "ch12": "radiograph", "ch14": "radiograph", "ch15": "radiograph",
    "ch16": "radiograph", "ch21": "radiograph", "ch22": "radiograph", "ch23": "radiograph",
    "ch24": "radiograph", "ch27": "radiograph", "ch13": "CT", "ch25": "CT", "ch26": "CT",
    "ch18": "US", "ch19": "US", "ch20": "MRI", "ch29": "mammo", "appA": "NM",
    "appB": "radiograph",
}
ANNOT_RE = re.compile(r"\b(arrows?|arrowheads?|circles?|circled|asterisks?|outlined|dotted|dashed|"
                      r"brackets?|ovals?|lines? drawn|red line|white line|black line|labeled|labelled|"
                      r"calipers?|cursors?|markers? on)\b|\*|\((?-i:[A-Z]{2,3}|[I-Z])\)", re.I)
# single letters A-H in parentheses are usually panel references, not labels in the image

# (regex on caption text, phrase written for this index). Specific before generic;
# topics_for() orders hits by position and drops overlaps.
TOPICS = [
    (r"tension pneumothorax", "tension pneumothorax"), (r"hydropneumothorax", "hydropneumothorax"),
    (r"pneumothora\w*", "pneumothorax"), (r"pneumomediastin\w*", "pneumomediastinum"),
    (r"pneumopericard\w*", "pneumopericardium"), (r"subcutaneous (emphysema|air)", "subcutaneous air"),
    (r"pneumoperitoneum|free (intraperitoneal )?air", "free intraperitoneal air"),
    (r"retroperitoneal air", "retroperitoneal air"), (r"pneumatosis", "pneumatosis"),
    (r"portal venous gas|portal vein gas", "portal venous gas"),
    (r"pneumobilia|air in the biliary", "biliary air"), (r"abscess\w*", "abscess"),
    (r"pericardial effusion", "pericardial effusion"), (r"subpulmonic effusion", "subpulmonic effusion"),
    (r"pleural effusion", "pleural effusion"), (r"effusion", "effusion"),
    (r"meniscus", "meniscus sign"), (r"loculated", "loculated fluid"), (r"empyema", "empyema"),
    (r"round(ed)? atelectasis", "round atelectasis"),
    (r"atelectasis|collapsed? (lung|lobe)|lobar collapse", "atelectasis"),
    (r"air bronchograms?", "air bronchograms"), (r"silhouette sign", "silhouette sign"),
    (r"covid", "COVID-19 pneumonia"), (r"aspiration", "aspiration"),
    (r"pneumonia|consolidation", "pneumonia / consolidation"), (r"airspace disease", "airspace disease"),
    (r"tuberculosis|\b(?-i:TB)\b", "tuberculosis"), (r"miliary", "miliary nodules"),
    (r"kerley", "Kerley B lines"), (r"peribronchial cuffing", "peribronchial cuffing"),
    (r"pulmonary edema|alveolar edema|interstitial edema", "pulmonary edema"),
    (r"interstitial (lung )?disease|interstitial pattern|reticular", "interstitial lung disease"),
    (r"congestive heart failure|\b(?-i:CHF)\b|heart failure", "heart failure"),
    (r"honeycomb\w*", "honeycombing"), (r"fibrosis", "fibrosis"), (r"sarcoid\w*", "sarcoidosis"),
    (r"emphysema|\b(?-i:COPD)\b|chronic obstructive", "emphysema / COPD"), (r"bullae|bulla\b", "bullae"),
    (r"bronchiectasis", "bronchiectasis"), (r"cavit\w+", "cavitation"),
    (r"solitary pulmonary nodule", "solitary pulmonary nodule"),
    (r"bronchogenic carcinoma|lung cancer|carcinoma of the lung", "lung cancer"),
    (r"pancoast|superior sulcus", "superior sulcus tumor"), (r"lymphangitic", "lymphangitic spread"),
    (r"metasta\w+", "metastases"), (r"pulmonary embol\w*|thromboembol\w*", "pulmonary embolism"),
    (r"\bnodules?\b", "nodule"), (r"\bcysts?\b|cystic", "cyst"),
    (r"(anterior|middle|posterior) mediastin\w*|mediastinal mass", "mediastinal mass"),
    (r"thymoma|thymic|thymus", "thymus"), (r"teratoma", "teratoma"), (r"lymphoma", "lymphoma"),
    (r"goiter|thyroid", "thyroid"), (r"neurogenic tumor|neurofibroma|schwannoma", "neurogenic tumor"),
    (r"hiatal hernia", "hiatal hernia"), (r"lymphadenopathy|adenopathy|lymph nodes?", "lymph nodes"),
    (r"endotracheal tube|\b(?-i:ETT)\b", "endotracheal tube"), (r"tracheostomy", "tracheostomy tube"),
    (r"central venous catheter|central line|\b(?-i:CVC)\b", "central venous catheter"),
    (r"\b(?-i:PICC)\b|peripherally inserted", "PICC line"),
    (r"swan-ganz|pulmonary artery catheter", "pulmonary artery catheter"),
    (r"hemodialysis catheter|dialysis catheter", "dialysis catheter"),
    (r"chest tube|pleural drainage tube|thoracostomy", "chest tube"), (r"pacemaker", "pacemaker"),
    (r"defibrillator|\b(?-i:AICD|ICD)\b", "defibrillator"),
    (r"intra-aortic balloon|\b(?-i:IABP)\b", "intra-aortic balloon pump"),
    (r"nasogastric|\b(?-i:NGT?)\b", "nasogastric tube"), (r"feeding tube|dobbhoff", "feeding tube"),
    (r"valve replacement|prosthetic valve", "prosthetic heart valve"),
    (r"\b(?-i:PEG)\b|gastrostomy", "gastrostomy tube"),
    (r"cardiomegaly|enlarged (heart|cardiac silhouette)|cardiac enlargement", "cardiomegaly"),
    (r"cardiothoracic ratio", "cardiothoracic ratio"), (r"mitral", "mitral valve"),
    (r"aortic stenosis", "aortic stenosis"), (r"pulmonary (arterial )?hypertension", "pulmonary hypertension"),
    (r"cardiomyopathy", "cardiomyopathy"), (r"dissection", "aortic dissection"),
    (r"pseudoaneurysm", "pseudoaneurysm"), (r"aneurysm\w*", "aneurysm"),
    (r"calcium scor\w*", "coronary calcium score"), (r"coronary", "coronary arteries"),
    (r"left atri\w+", "left atrium"), (r"left ventric\w+", "left ventricle"),
    (r"right ventric\w+", "right ventricle"), (r"right atri\w+", "right atrium"),
    (r"aortic arch|aortic knob", "aortic arch"), (r"pulmonary arter\w+", "pulmonary arteries"),
    (r"pulmonary vein|pulmonary venous", "pulmonary veins"),
    (r"superior vena cava|\b(?-i:SVC)\b", "superior vena cava"), (r"azygos", "azygos vein"),
    (r"\bhil(um|a|ar)\b", "hila"), (r"fissures?", "fissures"), (r"retrosternal", "retrosternal space"),
    (r"costophrenic", "costophrenic angles"), (r"diaphragm\w*", "diaphragm"), (r"trachea\w*", "trachea"),
    (r"lung window|mediastinal window|bone window|soft[- ]tissue window|windowing|window (level|width)",
     "CT windowing"),
    (r"inspiration|rotation|penetration|magnification|technical adequacy|technically adequate",
     "technical quality"),
    (r"small bowel obstruction|\b(?-i:SBO)\b", "small bowel obstruction"),
    (r"large bowel obstruction|colonic obstruction|\b(?-i:LBO)\b", "large bowel obstruction"),
    (r"volvulus", "volvulus"), (r"ileus", "ileus"), (r"bowel gas|gas pattern", "bowel gas pattern"),
    (r"air-fluid levels?", "air-fluid levels"), (r"intussuscep\w+", "intussusception"),
    (r"appendicitis|appendicolith", "appendicitis"), (r"diverticul\w+", "diverticular disease"),
    (r"colitis|inflammatory bowel|crohn|ulcerative", "bowel inflammation"), (r"polyps?", "polyp"),
    (r"apple.?core|colon cancer|colorectal (cancer|carcinoma)|carcinoma of the colon", "colon cancer"),
    (r"esophag\w+", "esophagus"), (r"stomach|gastric", "stomach"), (r"duoden\w+", "duodenum"),
    (r"ulcers?\b", "ulcer"), (r"inguinal hernia", "inguinal hernia"), (r"hernia\w*", "hernia"),
    (r"pancrea\w+", "pancreas"), (r"cirrhosis", "cirrhosis"), (r"fatty liver|steatosis", "fatty liver"),
    (r"hemangioma", "hemangioma"), (r"hepatocellular", "hepatocellular carcinoma"),
    (r"\bliver\b|hepatic", "liver"),
    (r"gallbladder|cholecyst\w+|gallstones?|cholelith\w+", "gallbladder / gallstones"),
    (r"biliary|bile ducts?|common duct", "bile ducts"), (r"\bspleen\b|splenic", "spleen"),
    (r"hydronephrosis", "hydronephrosis"), (r"kidneys?|renal", "kidney"),
    (r"\bstones?\b|calculus|calculi|urolith\w*", "stones / calculi"), (r"bladder", "bladder"),
    (r"adrenal", "adrenal gland"), (r"prostat\w+", "prostate"), (r"\buter\w+|endometri\w+", "uterus"),
    (r"ovar\w+|adnex\w+", "ovary / adnexa"), (r"ectopic", "ectopic pregnancy"),
    (r"pregnan\w+|fetus|fetal|gestation\w*", "pregnancy"), (r"testic\w+|testis|scrot\w+", "scrotum / testis"),
    (r"torsion", "torsion"), (r"ascites", "ascites"), (r"calcification\w*|calcified", "calcification"),
    (r"\baort\w+", "aorta"), (r"carotid", "carotid artery"),
    (r"deep (venous|vein) thrombo\w*|\b(?-i:DVT)\b|thrombus", "venous thrombosis"),
    (r"point-of-care|\b(?-i:POCUS|FAST)\b", "point-of-care ultrasound"),
    (r"compression fracture", "compression fracture"), (r"stress fracture", "stress fracture"),
    (r"salter|growth plate|physis", "growth plate injury"), (r"fractures?", "fracture"),
    (r"dislocat\w+", "dislocation"), (r"osteoarthritis|degenerative", "degenerative arthritis"),
    (r"rheumatoid", "rheumatoid arthritis"), (r"\bgout\w*", "gout"), (r"ankylosing", "ankylosing spondylitis"),
    (r"arthritis|arthropath\w+", "arthritis"), (r"osteoporo\w+|osteopeni\w+", "osteoporosis"),
    (r"osteoblastic|sclerotic|blastic", "sclerotic bone lesion"), (r"osteolytic|\blytic", "lytic bone lesion"),
    (r"osteomyelitis", "osteomyelitis"), (r"avascular necrosis|osteonecrosis", "avascular necrosis"),
    (r"paget", "Paget disease"), (r"myeloma", "multiple myeloma"),
    (r"(disk|disc) herniation|herniated (disk|disc)", "disk herniation"),
    (r"spinal stenosis", "spinal stenosis"), (r"spondylolys\w+|spondylolisth\w+", "spondylolysis / listhesis"),
    (r"cervical spine|\bc-spine\b", "cervical spine"), (r"vertebra\w*|\bspine\b|spinal", "spine"),
    (r"\bhips?\b|femoral head|femoral neck", "hip"), (r"\bknees?\b", "knee"),
    (r"shoulders?", "shoulder"), (r"wrists?|scaphoid", "wrist"), (r"elbows?|fat pad", "elbow"),
    (r"ankles?", "ankle"), (r"\bfoot\b|calcane\w+", "foot"), (r"fingers?|phalan\w+", "hand"),
    (r"pelvi[sc]", "pelvis"), (r"\bribs?\b", "ribs"),
    (r"(lung|pulmonary) contusion", "lung contusion"), (r"lacerat\w+", "laceration"),
    (r"subdural", "subdural hematoma"), (r"epidural", "epidural hematoma"),
    (r"subarachnoid", "subarachnoid hemorrhage"), (r"intracerebral|intraparenchymal", "intracerebral hemorrhage"),
    (r"hemorrhag\w+|hematoma|bleed\w*", "hemorrhage"),
    (r"stroke|infarct\w*|ischemi\w+", "stroke / infarct"), (r"hydroceph\w+", "hydrocephalus"),
    (r"herniation", "herniation"), (r"glioma|glioblastoma|meningioma|brain tumou?r", "brain tumor"),
    (r"multiple sclerosis|demyelinat\w+", "demyelination"), (r"atroph\w+", "atrophy"),
    (r"diffuse axonal", "diffuse axonal injury"), (r"skull|calvar\w+", "skull"),
    (r"\bsinus(es|itis)?\b", "sinuses"), (r"orbit\w*", "orbit"),
    (r"\bbrain\b|cerebr\w+|intracranial", "brain"),
    (r"croup|epiglott\w+", "upper airway infection"), (r"foreign bod\w+", "foreign body"),
    (r"necrotizing enterocolitis|\b(?-i:NEC)\b", "necrotizing enterocolitis"),
    (r"pyloric stenosis", "pyloric stenosis"), (r"respiratory distress|hyaline membrane", "neonatal lung disease"),
    (r"child abuse|nonaccidental|non-accidental", "nonaccidental injury"),
    (r"stenosis|stenotic", "stenosis"),
    (r"biops\w+", "biopsy"), (r"\bdrain(s|age)?\b", "drainage"), (r"emboliz\w+", "embolization"),
    (r"\bstents?\b", "stent"), (r"(vena cava|\b(?-i:IVC)\b) filter", "IVC filter"),
    (r"thrombectomy", "thrombectomy"), (r"ablation", "ablation"), (r"angioplasty", "angioplasty"),
    (r"\b(?-i:TIPS)\b|portosystemic", "TIPS"),
    (r"architectural distortion", "architectural distortion"), (r"asymmetr\w+", "asymmetry"),
    (r"implants?", "implant"), (r"dense breasts?|breast density", "breast density"),
    (r"\bbreasts?\b", "breast"), (r"bone scans?|skeletal scintig\w*", "bone scan"),
    (r"perfusion", "perfusion"), (r"\b(?-i:PET)\b", "PET"),
    (r"artificial intelligence|neural network|deep learning|machine learning", "AI concept"),
    (r"roentgen|edison|radium|thorotrast", "history of radiology"),
    (r"radiation dose|\bdose\b", "radiation dose"),
    (r"\bmass(es)?\b", "mass"), (r"\bnormal\b", "normal anatomy"), (r"anatom\w+", "anatomy"),
]
TOPICS = [(re.compile(rx, re.I), phrase) for rx, phrase in TOPICS]
MOD_PHRASE = {"radiograph": "Radiograph", "CT": "CT image", "MRI": "MR image", "US": "Ultrasound image",
              "NM": "Nuclear medicine image", "fluoro": "Fluoroscopic contrast study",
              "mammo": "Mammogram", "diagram": "Diagram", "photo": "Photograph",
              "other": "Figure", None: "Figure"}


def classify_modality(text):
    """Earliest explicit modality word in the text wins."""
    best = None
    for name, rx in MODALITY_RULES:
        m = rx.search(text)
        if m and (best is None or m.start() < best[1]):
            best = (name, m.start())
    return best[0] if best else None


def topics_for(text, limit=3):
    """Controlled-vocabulary topics in order of first appearance; specific beats generic."""
    hits = []
    for rx, phrase in TOPICS:
        m = rx.search(text)
        if m:
            hits.append((m.start(), -(m.end() - m.start()), m.end(), phrase))
    hits.sort()
    out, spans = [], []
    for start, _neg, end, phrase in hits:
        if any(start < e and end > b for b, e in spans) or phrase in out:
            continue
        if phrase in ("normal anatomy", "anatomy", "mass") and len(hits) > 1 and out:
            continue
        spans.append((start, end))
        out.append(phrase)
        if len(out) >= limit:
            break
    return out


def compose_description(kind, modality, topics, heading):
    if kind == "table":
        lead = "Table summarizing"
    elif kind == "box":
        lead = "Box listing key points on"
    else:
        lead = MOD_PHRASE.get(modality, "Figure") + " showing"
    if topics:
        body = ", ".join(topics[:-1]) + (" and " if len(topics) > 1 else "") + topics[-1]
    elif heading:
        lead = lead.replace(" showing", " illustrating").replace(" summarizing", " for section").replace(
            " listing key points on", " for section")
        body = "“%s”" % heading
    else:
        body = "chapter content"
    words = (lead + " " + body).split()
    if len(words) > 15:
        words = words[:15]
    return " ".join(words).rstrip(",")


def build_figures(doc, pages, pmap, sections, scale=1.0):
    found, rejected = find_caption_starts(pages, pmap)
    by_page = defaultdict(list)
    for f in found.values():
        by_page[f["physical"]].append(f)
    sec_by_unit = defaultdict(list)
    for s in sections:
        if s["kind"] == "heading":
            sec_by_unit[s["chapterId"]].append(s)
    out = []
    for p in sorted(by_page):
        pg = pages[p - 1]
        recs = by_page[p]
        blocks = {}
        for f in recs:
            blocks[f["id"]] = caption_block(pg, f["start_span"])
        need_img = any(f["kind"] == "figure" for f in recs)
        ink = gray = sat = None
        if need_img:
            rgb = render_rgb(doc[p - 1], scale)
            ink, gray, sat = ink_mask(pg, rgb, scale)
        for f in recs:
            box, text, members = blocks[f["id"]]
            unit = f["unit"]
            # containing section: last heading at or before the caption in reading order
            col = 0 if box[0] < pg.w / 2 - 10 else 1
            key = (p, col, box[1])
            heading = None
            chain = []
            for s in sec_by_unit[unit]:
                if (s["physical"], s["_col"], s["_y"]) <= key:
                    heading = s
            if heading:
                # ancestors (for modality fallback)
                lvl = heading["level"]
                chain = [heading["title"]]
                for s in reversed([s for s in sec_by_unit[unit]
                                   if (s["physical"], s["_col"], s["_y"]) <= key]):
                    if s["level"] < lvl:
                        chain.append(s["title"])
                        lvl = s["level"]
            bbox = None
            modality = None
            annotated = None
            if f["kind"] == "figure":
                others = [blocks[o["id"]][0] for o in recs if o["id"] != f["id"]]
                bbox = detect_bbox(pg, ink, scale, box, members, others)
                body0 = re.sub(r"^\S*\s*[0-9A-H]{1,2}\.\d+\s*", "", text)
                title0 = re.split(r"(?<=[A-Za-z\)])\.\s", body0, maxsplit=1)[0]
                if re.search(r"\bphotograph(s|ed)?\b", text, re.I):
                    modality = "photo"
                elif MODALITY_RULES[0][1].search(title0):
                    modality = "diagram"
                else:
                    modality = classify_modality(text)
                if modality is None and bbox is not None:
                    r0, c0 = int(bbox[1] * pg.h * scale), int(bbox[0] * pg.w * scale)
                    r1, c1 = int(bbox[3] * pg.h * scale), int(bbox[2] * pg.w * scale)
                    g = gray[r0:r1, c0:c1]
                    st = sat[r0:r1, c0:c1]
                    if g.size:
                        colourful = float(((st > 0.25) & (g < 245)).mean())
                        white = float((g >= 250).mean())  # pure paper white: line drawings
                        # colour alone is not a diagram clue in US/NM units (tinted
                        # sonograms, colour-coded scintigrams); require paper-white too
                        if colourful > 0.2 and UNIT_DEFAULT_MODALITY.get(unit) not in ("US", "NM"):
                            # colour drawing on paper vs. other colour picture (photo, poster)
                            modality = "diagram" if white > 0.2 else ("photo" if unit == "appE" else "other")
                        elif white > 0.55:
                            modality = "diagram"
                if modality is None:
                    for t in chain:
                        modality = classify_modality(t)
                        if modality:
                            break
                if modality is None:
                    modality = UNIT_DEFAULT_MODALITY.get(unit)
                if ANNOT_RE.search(text):
                    annotated = True
            # topics come from the caption's lead phrase first, then the whole caption
            body = re.sub(r"^\S*\s*[0-9A-H]{1,2}\.\d+\s*", "", text)
            lead = re.split(r"(?<=[A-Za-z\)])\.\s", body, maxsplit=1)[0]
            tps = topics_for(lead) or topics_for(body, limit=2)
            if unit == "appF" and heading and heading["level"] >= 2:
                # signs atlas: each figure illustrates the sign named by its heading
                tps = []
            desc = compose_description(f["kind"], modality, tps, heading["title"] if heading else None)
            out.append({
                "id": f["id"], "kind": f["kind"], "chapterId": unit, "physical": p,
                "printed": pmap[p - 1]["printed"], "bbox": bbox,
                "hasPrintedAnnotations": annotated, "modality": modality,
                "description": desc,
                "_sort": (f["kind"] != "figure", f["kind"] == "box", f["e"], f["num"]),
            })
    unit_order = {}
    for i, u in enumerate(sorted({e["chapterId"] for e in out},
                                 key=lambda x: (x.startswith("app"), x))):
        unit_order[u] = i
    out.sort(key=lambda e: (unit_order[e["chapterId"]],) + e["_sort"])
    for e in out:
        del e["_sort"]
    return out, rejected


# ---------------------------------------------------------------------------
def sequence_gaps(figs):
    gaps = {}
    groups = defaultdict(set)
    for f in figs:
        m = re.match(r"^(e?)(Fig|Table|Box) ([0-9A-H]+)\.(\d+)$", f["id"])
        groups[(m.group(1), m.group(2), m.group(3))].add(int(m.group(4)))
    for k, nums in groups.items():
        missing = [n for n in range(1, max(nums) + 1) if n not in nums]
        if missing:
            gaps["%s%s %s" % k] = missing
    return gaps


def write_json(path, obj):
    """Deterministic JSON: sorted keys; arrays of objects get one element per line."""
    def dump(v):
        return json.dumps(v, ensure_ascii=False, sort_keys=True)

    lines = ["{"]
    keys = sorted(obj)
    for i, k in enumerate(keys):
        v = obj[k]
        tail = "," if i + 1 < len(keys) else ""
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            lines.append(" %s: [" % dump(k))
            for j, x in enumerate(v):
                lines.append("  " + dump(x) + ("," if j + 1 < len(v) else ""))
            lines.append(" ]" + tail)
        else:
            lines.append(" %s: %s%s" % (dump(k), dump(v), tail))
    lines.append("}")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def run_checks(pmap, units, sections, figs, gaps, sha_ok, curriculum_path):
    results = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))

    check("sha256 matches expected copy", sha_ok)
    check("physical page count == %d" % EXPECTED_PAGES, len(pmap) == EXPECTED_PAGES, str(len(pmap)))
    by_p = {e["physical"]: e for e in pmap}
    for p, lab in sorted(KNOWN_LABELS.items()):
        check("PDF%d printed == %s" % (p, lab), by_p[p]["printed"] == lab, str(by_p[p]["printed"]))
    for p, kind in sorted(KNOWN_KINDS.items()):
        check("PDF%d kind == %s" % (p, kind), by_p[p]["kind"] == kind, by_p[p]["kind"])
    ustart = {u["id"]: u for u in units}
    for uid, (p, lab) in sorted(KNOWN_UNIT_STARTS.items()):
        u = ustart.get(uid)
        ok = u is not None and u["start"] == p and by_p[p]["printed"] == lab and by_p[p]["chapterId"] == uid
        check("%s starts PDF%d / printed %s" % (uid, p, lab), ok,
              "" if u is None else "PDF%d/%s" % (u["start"], by_p[u["start"]]["printed"]))
    for uid, (p, lab) in sorted(KNOWN_UNIT_ENDS.items()):
        u = ustart.get(uid)
        ok = u is not None and u["end"] == p and by_p[p]["printed"] == lab
        check("%s ends PDF%d / printed %s" % (uid, p, lab), ok,
              "" if u is None else "PDF%d/%s" % (u["end"], by_p[u["end"]]["printed"]))
    for fid, p in sorted(KNOWN_FIGURES.items()):
        f = next((x for x in figs if x["id"] == fid), None)
        check("%s on PDF%d" % (fid, p), f is not None and f["physical"] == p,
              "" if f is None else "PDF%d" % f["physical"])
    for uid, title, p in KNOWN_SECTIONS:
        s = next((x for x in sections if x["chapterId"] == uid and x["title"].startswith(title)), None)
        check("section '%s' (%s) on PDF%d" % (title, uid, p), s is not None and s["physical"] == p,
              "" if s is None else "PDF%d" % s["physical"])
    check("no gaps in figure/table/box numbering", not gaps, json.dumps(gaps))
    n_units = len([u for u in units if u["kind"] in ("chapter", "appendix")])
    check("37 units (29 chapters + 8 appendices)", n_units == 37, str(n_units))
    for uid in [u["id"] for u in units if u["kind"] == "chapter"]:
        kinds = {s["kind"] for s in sections if s["chapterId"] == uid}
        check("%s has case quiz Q/A and take-home markers" % uid,
              {"case_quiz_question", "case_quiz_answer", "take_home"} <= kinds, ",".join(sorted(kinds)))
    unverified = [s["id"] for s in sections if s.get("verified") is False]
    check("all outline headings found on their page", not unverified, ",".join(unverified[:10]))
    if curriculum_path and os.path.exists(curriculum_path):
        cur = json.load(open(curriculum_path, encoding="utf-8"))
        fig_by_id = {f["id"]: f for f in figs}
        sec_by_id = {s["id"]: s for s in sections}
        bad = []
        n_anchor = 0
        for u in cur["units"]:
            u0 = ustart[u["id"]]
            if u["physicalRange"] != [u0["start"], u0["end"]]:
                bad.append("%s physicalRange" % u["id"])
            if u["printedRange"] != [by_p[u0["start"]]["printed"], by_p[u0["end"]]["printed"]]:
                bad.append("%s printedRange" % u["id"])
            for o in u["objectives"]:
                if not o["anchors"]:
                    bad.append("%s no anchors" % o["id"])
                for a in o["anchors"]:
                    n_anchor += 1
                    pe = by_p.get(a["physical"])
                    if pe is None or pe["printed"] != a["printed"]:
                        bad.append("%s anchor printed %s" % (o["id"], a.get("printed")))
                    if pe is not None and pe["chapterId"] != u["id"]:
                        bad.append("%s anchor PDF%d outside unit" % (o["id"], a["physical"]))
                    if a.get("figureId"):
                        f = fig_by_id.get(a["figureId"])
                        if f is None or f["physical"] != a["physical"]:
                            bad.append("%s figure %s" % (o["id"], a["figureId"]))
                    if a.get("sectionId"):
                        s = sec_by_id.get(a["sectionId"])
                        if s is None or s["physical"] != a["physical"]:
                            bad.append("%s section %s" % (o["id"], a["sectionId"]))
            for key in ("caseQuiz",):
                for part in ("question", "answer"):
                    ref = (u.get(key) or {}).get(part)
                    if ref and by_p[ref["physical"]]["printed"] != ref["printed"]:
                        bad.append("%s %s" % (u["id"], part))
        check("curriculum anchors consistent with page map/figures/sections (%d anchors)" % n_anchor,
              not bad, "; ".join(bad[:12]))
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", required=True, help="output dir, e.g. public/content/book")
    ap.add_argument("--allow-other-copy", action="store_true",
                    help="continue (with a warning) if the PDF hash differs; the actual hash is recorded")
    ap.add_argument("--check", action="store_true",
                    help="assert known anchors; exit non-zero on mismatch")
    ap.add_argument("--curriculum", default=None,
                    help="curriculum JSON to validate in --check mode "
                         "(default: <out>/../curriculum.v1.json)")
    ap.add_argument("--no-write", action="store_true", help="do not write files (use with --check)")
    args = ap.parse_args(argv)

    sha = sha256_file(args.pdf)
    sha_ok = sha == EXPECTED_SHA256
    if not sha_ok:
        msg = "SHA-256 mismatch: expected %s, got %s" % (EXPECTED_SHA256, sha)
        if not args.allow_other_copy:
            sys.exit(msg + " (use --allow-other-copy to continue)")
        print("WARNING: " + msg + "; continuing and recording the actual hash", file=sys.stderr)

    doc = fitz.open(args.pdf)
    pages = extract_pages(doc)
    toc, units = build_units(doc, len(pages))
    if not any(u["kind"] == "chapter" for u in units):
        sys.exit("PDF outline has no chapter bookmarks; this does not look like the expected book")
    pmap = build_page_map(pages, units)

    # running-header consistency (page-level unit verification)
    header_mismatch = []
    for pg, e in zip(pages, pmap):
        hu = header_unit(pg)
        if hu and hu.startswith(("ch", "app")) and e["chapterId"] != hu:
            header_mismatch.append(pg.pno)

    sections, sec_problems = build_sections(toc, units, pages, pmap)
    listing_page, videos = build_video_listing(toc, pages, pmap)
    figs, rejected = build_figures(doc, pages, pmap, sections)
    gaps = sequence_gaps(figs)

    # finalize sections: order by unit, page, column, y
    uorder = {u["id"]: i for i, u in enumerate(units)}
    sections.sort(key=lambda s: (uorder[s["chapterId"]], s["physical"], s["_col"], s["_y"],
                                 s["kind"] != "heading", s["id"]))
    if listing_page:
        sections.insert(0, {"id": "front-video-contents", "chapterId": None, "title": "Video Contents",
                            "level": 1, "kind": "video_listing", "physical": listing_page,
                            "printed": pmap[listing_page - 1]["printed"]})
    for s in sections:
        s.pop("_y", None)
        s.pop("_col", None)

    page_map_obj = {
        "schemaVersion": SCHEMA_VERSION,
        "document": dict(DOC_META, sha256=sha, filename=os.path.basename(args.pdf),
                         physicalPageCount=len(pages)),
        "pages": pmap,
    }
    figures_obj = {"schemaVersion": SCHEMA_VERSION, "bookSha256": sha, "figures": figs}
    sections_obj = {"schemaVersion": SCHEMA_VERSION, "bookSha256": sha, "sections": sections,
                    "videoReferences": videos,
                    "note": "Video IDs are listed only because the book refers to them; "
                            "no video content is shipped or implied to be available."}

    if not args.no_write:
        os.makedirs(args.out, exist_ok=True)
        write_json(os.path.join(args.out, "page-map.v1.json"), page_map_obj)
        write_json(os.path.join(args.out, "figures.v1.json"), figures_obj)
        write_json(os.path.join(args.out, "sections.v1.json"), sections_obj)

    n_inf = sum(1 for e in pmap if e.get("inferred"))
    kinds = defaultdict(int)
    for f in figs:
        kinds[f["kind"]] += 1
    print("pages=%d inferredLabels=%d figures=%d tables=%d boxes=%d bboxNull=%d sections=%d videos=%d"
          % (len(pmap), n_inf, kinds["figure"], kinds["table"], kinds["box"],
             sum(1 for f in figs if f["kind"] == "figure" and f["bbox"] is None),
             len(sections), len(videos)))
    print("caption candidates rejected:", json.dumps(rejected, sort_keys=True))
    if header_mismatch:
        print("running-header/unit mismatches on PDF pages:", header_mismatch)
    if sec_problems:
        print("section problems:", sec_problems[:20])

    if args.check:
        cur = args.curriculum or os.path.join(os.path.dirname(os.path.normpath(args.out)), "curriculum.v1.json")
        results = run_checks(pmap, units, sections, figs, gaps, sha_ok, cur)
        results.append(("running headers agree with unit ranges", not header_mismatch, str(header_mismatch)))
        failed = 0
        for name, ok, detail in results:
            print("%s  %s%s" % ("PASS" if ok else "FAIL", name, "" if ok or not detail else "  -> " + detail))
            failed += 0 if ok else 1
        print("%d checks, %d failed" % (len(results), failed))
        if failed:
            sys.exit(1)


if __name__ == "__main__":
    main()
