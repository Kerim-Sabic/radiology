# The loading screen's CT slices: an N-frame vertical strip (RS_N, default 8) of axial chest CT slices from the
# starter case (LCTSC-Train-S1-012, Lung CT Segmentation Challenge 2017, TCIA, CC BY 3.0), cropped to the body with
# one fixed box (so nothing jumps between frames), table removed, window L -150 / W 950 by default.
# Usage: RS_N=8 RS_SIZE=200 RS_Q=52 python scripts/make_loader_ct.py <series dir> <out dir> <first slice> <step> [level] [width]
# Then inline <out>/ct-chest-strip.webp as base64 in index.html (.rs-slice --rs-img).
import sys, os, glob
import numpy as np, pydicom
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
first, step = int(sys.argv[3]), int(sys.argv[4])
lvl = float(sys.argv[5]) if len(sys.argv) > 5 else -150.0
wid = float(sys.argv[6]) if len(sys.argv) > 6 else 950.0
N = int(os.environ.get('RS_N', '8'))
S = int(os.environ.get('RS_SIZE', '200'))
Q = int(os.environ.get('RS_Q', '52'))

ds = sorted(((float(pydicom.dcmread(f, stop_before_pixels=True).ImagePositionPatient[2]), f) for f in glob.glob(os.path.join(src, '*.dcm'))), key=lambda x: -x[0])
slices = []
for k in [first + i * step for i in range(N)]:
    d = pydicom.dcmread(ds[k][1])
    a = d.pixel_array.astype(np.float32) * float(getattr(d, 'RescaleSlope', 1)) + float(getattr(d, 'RescaleIntercept', 0))
    lab, n = ndimage.label(ndimage.binary_opening(a > -400, iterations=2))
    big = np.argmax(ndimage.sum(np.ones_like(a), lab, range(1, n + 1))) + 1
    body = ndimage.binary_fill_holes(lab == big)
    slices.append((k + 1, a, body))

# One square box around the union of the bodies.
union = np.any([b for _, _, b in slices], axis=0)
rows = np.where(union.any(1))[0]; cols = np.where(union.any(0))[0]
cy, cx = (rows.min() + rows.max()) / 2, (cols.min() + cols.max()) / 2
half = max(rows.max() - rows.min(), cols.max() - cols.min()) / 2 * 1.06
box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
print('box', box)

strip = Image.new('L', (S, S * N))
for i, (num, a, body) in enumerate(slices):
    keep = ndimage.binary_dilation(body, iterations=3)
    img = (np.clip((a - (lvl - wid / 2)) / wid, 0, 1) ** 1.15 * 255 * keep).astype(np.uint8)
    strip.paste(Image.fromarray(img).crop(box).resize((S, S), Image.LANCZOS), (0, S * i))
    print('slice', num)
os.makedirs(out, exist_ok=True)
p = os.path.join(out, 'ct-chest-strip.webp')
strip.save(p, 'WEBP', quality=Q, method=6)
print(p, os.path.getsize(p))
sheet = Image.new('L', (S * N, S))
for i in range(N):
    sheet.paste(strip.crop((0, S * i, S, S * (i + 1))), (S * i, 0))
sheet.save(os.path.join(out, 'strip-sheet.png'))
