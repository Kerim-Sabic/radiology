# A 6-frame vertical strip of axial chest CT slices (starter case, LCTSC-Train-S1-012, CC BY 3.0) for the loader.
import sys, os, glob
import numpy as np, pydicom
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
ds = sorted(((float(pydicom.dcmread(f, stop_before_pixels=True).ImagePositionPatient[2]), f) for f in glob.glob(os.path.join(src, '*.dcm'))), key=lambda x: -x[0])
idx = [int(sys.argv[3]) + i * int(sys.argv[4]) for i in range(6)]
S = int(os.environ.get("RS_SIZE", "240"))
frames = []
for k in idx:
    d = pydicom.dcmread(ds[k][1])
    a = d.pixel_array.astype(np.float32) * float(getattr(d, 'RescaleSlope', 1)) + float(getattr(d, 'RescaleIntercept', 0))
    # body box: soft tissue above -400 HU, ignoring the table (thin bright rows at the bottom)
    from scipy import ndimage
    lab, n = ndimage.label(ndimage.binary_opening(a > -400, iterations=2))
    big = np.argmax(ndimage.sum(np.ones_like(a), lab, range(1, n + 1))) + 1
    m = lab == big
    rows = np.where(m.any(1))[0]; cols = np.where(m.any(0))[0]
    cy, cx = (rows.min() + rows.max()) / 2, (cols.min() + cols.max()) / 2
    half = max(rows.max() - rows.min(), cols.max() - cols.min()) / 2 * 1.08
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    keep = ndimage.binary_dilation(ndimage.binary_fill_holes(m), iterations=3)
    lvl, wid = float(sys.argv[5]), float(sys.argv[6])
    img = (np.clip((a - (lvl - wid / 2)) / wid, 0, 1) ** 1.15 * 255 * keep).astype(np.uint8)
    im = Image.fromarray(img).crop(box).resize((S, S), Image.LANCZOS)
    frames.append(im)
    print(k + 1, box)
strip = Image.new('L', (S, S * 6))
for i, im in enumerate(frames):
    strip.paste(im, (0, S * i))
os.makedirs(out, exist_ok=True)
p = os.path.join(out, 'ct-chest-strip.webp')
strip.save(p, 'WEBP', quality=int(os.environ.get("RS_Q", "62")), method=6)
print(p, os.path.getsize(p))
sheet = Image.new('L', (S * 6, S)); [sheet.paste(im, (S * i, 0)) for i, im in enumerate(frames)]; sheet.save(os.path.join(out, 'strip-sheet.png'))
