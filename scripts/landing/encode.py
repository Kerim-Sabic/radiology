"""PNG screenshots from shoot.mjs -> WebP for the landing page (public/landing). Run: python scripts/landing/encode.py"""
from pathlib import Path

from PIL import Image

SRC = Path('test-results/landing-shots')
OUT = Path('public/landing')
OUT.mkdir(parents=True, exist_ok=True)
# Name -> width in px (the hero is shown large; the others in cards).
SIZES = {'hero': 1920, 'ct': 1280, 'mammo': 1280, 'mri': 1280, 'us': 1280, 'xray': 1280, 'conditions': 1280}
for name, width in SIZES.items():
    im = Image.open(SRC / f'{name}.png').convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=82, method=6)
    print(name, im.size, (OUT / f'{name}.webp').stat().st_size // 1024, 'KB')
