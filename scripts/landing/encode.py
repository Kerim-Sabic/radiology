"""PNG screenshots from shoot.mjs -> WebP for the landing page (public/landing). Run: python scripts/landing/encode.py"""
from pathlib import Path

from PIL import Image

SRC = Path('test-results/landing-shots')
OUT = Path('public/landing')
OUT.mkdir(parents=True, exist_ok=True)
# Name -> width in px (the hero is shown large; the others in cards).
SIZES = {'hero': 2400, 'hero-phone': 1200, 'ct': 1600, 'mammo': 1600, 'mri': 1600, 'us': 1600, 'xray': 1600, 'conditions': 1280, 'graded': 2000, 'graded-phone': 1200}
# Phone versions are crops of the same shots: the scans only, big enough to read on a 390 px screen.
SOURCES = {'hero-phone': 'hero', 'graded-phone': 'graded'}
# Crops in screenshot pixels (2x): the graded shot keeps the image and the result beside it.
CROPS = {'graded': (260, 160, 2880, 1400), 'hero-phone': (0, 160, 2112, 1800), 'graded-phone': (1080, 160, 2880, 1400)}
for name, width in SIZES.items():
    src = SRC / f"{SOURCES.get(name, name)}.png"
    if not src.exists():
        continue
    im = Image.open(src).convert('RGB')
    if name in CROPS and CROPS[name]:
        im = im.crop(CROPS[name])
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=82, method=6)
    print(name, im.size, (OUT / f'{name}.webp').stat().st_size // 1024, 'KB')
