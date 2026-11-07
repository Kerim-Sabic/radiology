"""Posters: the first picture of each free task, shown while the reading room's code and the first slice download.

A visitor from an ad on a slow phone connection waited ~12 s for the task's text and ~23 s for the first image. The
reading room now shows the task and this poster as soon as the app shell has loaded (src/components/RoomPreview.tsx),
and keeps it in the viewer until the real slice is drawn. So the poster must be exactly what the viewer opens at:

- a task with targets opens (for a visitor without an account) at the slice where its first target's outline is
  largest (src/pages/Workstation.tsx, targetView);
- any other task opens at its start slice ("first", "middle" or a number), in the viewer's order (head to feet);
- in the task's window preset (the series' own presets), or the image's own window for a radiograph.

    venv-gpu/Scripts/python scripts/build/posters.py   ->  public/landing/posters/<task id, ":" as "--">.webp

Only the always-free cases (src/content/weekly.ts FREE_CASES): their images are already public in the free edition.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / 'public' / 'packs'
OUT = ROOT / 'public' / 'landing' / 'posters'


def free_cases() -> list[str]:
    src = (ROOT / 'src' / 'content' / 'weekly.ts').read_text(encoding='utf-8')
    m = re.search(r"FREE_CASES\s*=\s*\[([^\]]*)\]", src)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values():
            walk(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk(v, fn)


def series_info(pack: dict, uid: str) -> dict | None:
    found = []
    walk(pack, lambda o: found.append(o) if uid in (o.get('seriesInstanceUid'), o.get('uid'), o.get('seriesUid')) and o.get('instances') else None)
    return found[0] if found else None


def presets_for(pack: dict, uid: str) -> list[dict]:
    found = []
    walk(pack, lambda o: found.append(o['windowPresets']) if 'windowPresets' in o and uid in json.dumps(o)[:600] else None)
    return found[0] if found else []


def area(poly) -> float:
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i][:2]
        x2, y2 = poly[(i + 1) % len(poly)][:2]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def render(path: Path, window: dict | None, max_w: int) -> Image.Image:
    ds = pydicom.dcmread(str(path))
    px = ds.pixel_array.astype(np.float32)
    if px.ndim == 3 and px.shape[-1] in (3, 4):
        img = Image.fromarray(px[..., :3].astype(np.uint8), 'RGB')
    else:
        if px.ndim == 3:
            px = px[0]
        v = px * float(getattr(ds, 'RescaleSlope', 1) or 1) + float(getattr(ds, 'RescaleIntercept', 0) or 0)
        if window:
            lo, hi = window['center'] - window['width'] / 2, window['center'] + window['width'] / 2
        else:
            wc, ww = getattr(ds, 'WindowCenter', None), getattr(ds, 'WindowWidth', None)
            if wc is not None and ww is not None:
                wc = float(wc[0] if isinstance(wc, pydicom.multival.MultiValue) else wc)
                ww = float(ww[0] if isinstance(ww, pydicom.multival.MultiValue) else ww)
                lo, hi = wc - ww / 2, wc + ww / 2
            else:
                lo, hi = np.percentile(v, 0.5), np.percentile(v, 99.5)
        g = np.clip((v - lo) / max(1e-6, hi - lo) * 255, 0, 255).astype(np.uint8)
        if str(getattr(ds, 'PhotometricInterpretation', '')).upper() == 'MONOCHROME1':
            g = 255 - g
        img = Image.fromarray(g, 'L')
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    return img


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = set(free_cases())
    made = 0
    for pack_dir in sorted(PACKS.iterdir()):
        lessons_path = pack_dir / 'lessons.json'
        if not lessons_path.exists():
            continue
        lessons = json.loads(lessons_path.read_text(encoding='utf-8'))
        tasks = [t for t in lessons.get('tasks', []) if t['caseId'] in wanted]
        if not tasks:
            continue
        pack = json.loads((pack_dir / 'pack.json').read_text(encoding='utf-8'))
        for t in tasks:
            uid = t['start']['seriesUid']
            info = series_info(pack, uid)
            if not info:
                print('no series', t['id'])
                continue
            inst = info['instances']
            # The viewer's order: head to feet (descending patient z), as the app counts "Im n/N".
            if all(i.get('ipp') for i in inst):
                order = sorted(inst, key=lambda i: -float(i['ipp'][2]))
            else:
                order = sorted(inst, key=lambda i: i.get('instanceNumber') or 0)
            sop = None
            for target in t.get('targets', []):
                geom_path = pack_dir / 'targets' / f"{target['targetId']}.json"
                if not geom_path.exists():
                    continue
                g = json.loads(geom_path.read_text(encoding='utf-8'))
                if g.get('geometryType', 'contour_set') == 'contour_set' and g.get('planes'):
                    sop = max(g['planes'], key=lambda pl: max((area(p) for p in pl['polygons']), default=0))['sopInstanceUid']
                elif g.get('boxes'):
                    sop = g['boxes'][0]['sopInstanceUid']
                break
            if sop is None:
                s = t['start'].get('slice', 'middle')
                idx = 0 if s == 'first' else len(order) - 1 if s == 'last' else len(order) // 2 if s == 'middle' else int(s)
                sop = order[max(0, min(idx, len(order) - 1))]['sopInstanceUid']
            ins = next(i for i in inst if i['sopInstanceUid'] == sop)
            name = t['start'].get('windowPreset')
            window = next((w for w in presets_for(pack, uid) if w['label'] == name), None) if name else None
            img = render(pack_dir / ins['file'], window, 768)
            out = OUT / f"{t['id'].replace(':', '--')}.webp"
            img.save(out, 'WEBP', quality=78, method=6)
            made += 1
            print(f"{out.name}: image {order.index(ins) + 1}/{len(order)}, window {name or 'image'}, {out.stat().st_size // 1024} KB")
    print(made, 'posters')
    return 0


if __name__ == '__main__':
    sys.exit(main())
