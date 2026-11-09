"""
Reference heart-chest (cardiothoracic) ratios for the Measure drill (src/pages/Measure.tsx).

For every chest film in the radiograph atlas (public/packs/anatomy-atlas-xr) that has a heart and both lung outlines,
this finds its picture in the image packs and writes public/content/cxr-ratio.json:
  - the heart and lung outlines as simplified polygons in 0..1 image coordinates;
  - the reference ratio = widest horizontal extent of the heart / widest horizontal extent of the two lungs together.
Those outlines are Horalix AI drafts that no radiologist has reviewed, so the reference is an ESTIMATE: the drill says so,
never scores it toward a certificate, and the lung edge is a close stand-in for the inner chest wall, not the rib.

Films are dropped (and listed in docs/data/cxr-ratio-report.md) when an outline is missing, the ratio is implausible, or the
heart does not sit inside the chest. Re-run: python scripts/data/cxr_ratio.py
"""
import json, os, glob, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PACKS = os.path.join(ROOT, 'public', 'packs')
OUT = os.path.join(ROOT, 'public', 'content', 'cxr-ratio.json')
REPORT = os.path.join(ROOT, 'docs', 'data', 'cxr-ratio-report.md')
TOL = 2.0  # polygon simplification, in 1024-px units


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-9
    idx, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax > eps:
        return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


IMG_DIR = os.path.join(ROOT, 'public', 'content', 'cxr-measure')
SIDE = 768


def export_image(dcm_path, out_path):
    """The film as a sharp 8-bit WebP (the picture is shown at up to ~700 px wide, so taps stay precise)."""
    import numpy as np, pydicom
    ds = pydicom.dcmread(dcm_path)
    a = ds.pixel_array.astype('float32')
    lo, hi = float(a.min()), float(a.max())
    a = (a - lo) / (hi - lo or 1.0)
    if str(ds.get('PhotometricInterpretation', '')).strip() == 'MONOCHROME1':
        a = 1.0 - a
    im = Image.fromarray((a * 255).astype('uint8'))
    im.thumbnail((SIDE, SIDE), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    im.save(out_path, 'WEBP', quality=84, method=6)
    return im.size


def simplify_ring(pts, eps):
    """A closed outline: split at the point farthest from the start, simplify both halves, rejoin."""
    pts = [tuple(p) for p in pts]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 4:
        return pts
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = rdp(pts[: far + 1], eps)
    b = rdp(pts[far:] + [pts[0]], eps)
    return a[:-1] + b[:-1]


def load_poly(path):
    g = json.load(open(path, encoding='utf-8'))
    polys = [p for pl in g['planes'] for p in pl['polygons']]
    if not polys:
        return None
    return max(polys, key=lambda p: (max(x for x, _ in p) - min(x for x, _ in p)) * (max(y for _, y in p) - min(y for _, y in p)))


def main():
    atl = json.load(open(os.path.join(PACKS, 'anatomy-atlas-xr', 'pack.json'), encoding='utf-8'))
    by_series = {}
    for t in atl['referenceTargets']:
        by_series.setdefault(t['seriesUid'], {})[t['id'].split('-cxr-', 1)[1]] = t
    series_info = {}
    for pk in ('cxr-findings', 'cxr-findings-2', 'cxr-findings-3'):
        d = json.load(open(os.path.join(PACKS, pk, 'pack.json'), encoding='utf-8'))
        for s in d['series']:
            if s['uid'] in by_series:
                series_info[s['uid']] = (pk, s)
    films, dropped = [], []
    for n, (uid, parts) in enumerate(sorted(by_series.items())):
        why = None
        if uid not in series_info:
            dropped.append((uid[-8:], 'no picture')); continue
        pk, s = series_info[uid]
        need = ['heart', 'lung-left', 'lung-right']
        if any(k not in parts for k in need):
            dropped.append((uid[-8:], 'missing ' + ', '.join(k for k in need if k not in parts))); continue
        geo = s['geometry']
        W, H = float(geo['columns']), float(geo['rows'])
        polys = {k: load_poly(os.path.join(PACKS, 'anatomy-atlas-xr', parts[k]['geometryFile'])) for k in need}
        if any(v is None for v in polys.values()):
            dropped.append((uid[-8:], 'empty outline')); continue
        ext = lambda p: (min(x for x, _ in p), max(x for x, _ in p))
        h0, h1 = ext(polys['heart'])
        a0, a1 = ext(polys['lung-left'])
        b0, b1 = ext(polys['lung-right'])
        t0, t1 = min(a0, b0), max(a1, b1)
        hw, tw = h1 - h0, t1 - t0
        if tw <= 0:
            dropped.append((uid[-8:], 'no thorax width')); continue
        ctr = hw / tw
        if not (0.30 <= ctr <= 0.80):
            dropped.append((uid[-8:], f'implausible ratio {ctr:.2f}')); continue
        if h0 < t0 - 0.02 * W or h1 > t1 + 0.02 * W:
            dropped.append((uid[-8:], 'heart outside the chest')); continue
        fid = f'film-{len(films) + 1:03d}'
        try:
            img = export_image(os.path.join(PACKS, pk, s['instances'][0]['file']), os.path.join(IMG_DIR, fid + '.webp'))
        except Exception as e:  # a file that will not decode
            dropped.append((uid[-8:], f'picture failed: {type(e).__name__}')); continue
        norm =lambda p: [[round(x / W, 4), round(y / H, 4)] for x, y in simplify_ring(p, TOL)]
        films.append({
            'id': fid,
            'thumb': f'/content/cxr-measure/{fid}.webp',
            'aspect': round(W / H, 4),
            'ctr': round(ctr, 3),
            'heart': norm(polys['heart']),
            'lungLeft': norm(polys['lung-left']),
            'lungRight': norm(polys['lung-right']),
            'x': [round(h0 / W, 4), round(h1 / W, 4), round(t0 / W, 4), round(t1 / W, 4)],
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'version': 1, 'note': 'AI outlines (Horalix), unreviewed: reference is an estimate', 'films': films}, open(OUT, 'w'), separators=(',', ':'))
    ctrs = sorted(f['ctr'] for f in films)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', encoding='utf-8') as r:
        r.write('# Reference heart-chest ratios (Measure drill)\n\n')
        r.write('_Generated by `scripts/data/cxr_ratio.py`; do not edit by hand._\n\n')
        r.write(f'- Atlas films considered: {len(by_series)}; **kept {len(films)}**, dropped {len(dropped)}.\n')
        if ctrs:
            r.write(f'- Reference ratio: min {ctrs[0]:.2f}, median {ctrs[len(ctrs)//2]:.2f}, max {ctrs[-1]:.2f}; {sum(c > 0.5 for c in ctrs)} films above 0.50.\n')
        r.write('- Method: heart width = widest horizontal extent of the AI heart outline; chest width = widest horizontal extent of both AI lung outlines together. The lung edge stands in for the inner chest wall, so the estimate can be a little high (the lungs stop slightly inside the ribs). The drill labels it an AI estimate and never scores it toward a certificate.\n')
        r.write('- Not validated against a radiologist\'s measurement yet.\n\n## Dropped films\n\n| film (series id tail) | reason |\n|---|---|\n')
        for u, w in dropped:
            r.write(f'| {u} | {w} |\n')
    print(f'kept {len(films)}, dropped {len(dropped)}; ratio {ctrs[0]:.2f}..{ctrs[-1]:.2f}; size {os.path.getsize(OUT)//1024} KB')


if __name__ == '__main__':
    main()
