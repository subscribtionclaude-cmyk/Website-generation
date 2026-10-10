#!/usr/bin/env python3
"""Build every compact ACCORD icon from the ONE final, authoritative app icon — nothing else.

  assets-src/official-icons/accord-app-icon.png   (final ACCORD compact/app icon, 1024 px, transparent background)

Only technical operations are applied: crop to the artwork's own bounds, frame it in a centred square, resize
(LANCZOS on premultiplied alpha), and — where a platform needs an opaque icon (iOS Home Screen, PWA launchers) — place
it on white. The artwork itself is never recoloured, redrawn, simplified or altered.

Outputs (new file names, so browsers / iPadOS cannot serve a stale cached icon)
  public/brand/accord-app-icon.png                                   in-app compact icon (collapsed sidebar, mobile bar)
  public/icons/accord-favicon-32.png, accord-favicon-64.png          browser tab
  public/icons/accord-apple-touch-icon.png                           iPhone / iPad Home Screen (180, opaque)
  public/icons/accord-icon-192.png, accord-icon-512.png              PWA "any" (opaque)
  public/icons/accord-icon-maskable-512.png                          PWA maskable (artwork inside the 80 % safe zone)
The full ACCORD wordmark logos are produced separately by scripts/make-brand-variants.py and are unchanged.
Run: python3 -I scripts/make-icons.py   (needs Pillow)
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets-src', 'official-icons', 'accord-app-icon.png')
OUT_B = os.path.join(ROOT, 'public', 'brand')
OUT_I = os.path.join(ROOT, 'public', 'icons')
os.makedirs(OUT_B, exist_ok=True); os.makedirs(OUT_I, exist_ok=True)

src = Image.open(SRC).convert('RGBA')
box = src.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
art = src.crop(box)  # the artwork exactly, without the empty export margin


def framed(fill: float) -> Image.Image:
    """Artwork centred in a transparent square; `fill` = share of the side taken by the artwork's longer edge."""
    w, h = art.size
    side = round(max(w, h) / fill)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(art, ((side - w) // 2, (side - h) // 2))
    return canvas


def sized(img: Image.Image, px: int, opaque: bool = False) -> Image.Image:
    out = img.convert('RGBa').resize((px, px), Image.LANCZOS).convert('RGBA')
    if opaque:
        bg = Image.new('RGBA', (px, px), (255, 255, 255, 255))
        bg.alpha_composite(out)
        return bg.convert('RGB')
    return out


tight = framed(0.94)      # favicon / in-app: as large as possible so it reads at 32 px
padded = framed(0.80)     # Home Screen / PWA "any": comfortable margin on the white tile
# maskable: the artwork's bounding box must sit inside the safe-zone circle (diameter 80 % of the icon)
w, h = art.size
maskable = framed(0.80 * max(w, h) / (w * w + h * h) ** 0.5)

sized(tight, 256).save(os.path.join(OUT_B, 'accord-app-icon.png'), optimize=True)
sized(tight, 32).save(os.path.join(OUT_I, 'accord-favicon-32.png'), optimize=True)
sized(tight, 64).save(os.path.join(OUT_I, 'accord-favicon-64.png'), optimize=True)
sized(padded, 180, opaque=True).save(os.path.join(OUT_I, 'accord-apple-touch-icon.png'), optimize=True)
sized(padded, 192, opaque=True).save(os.path.join(OUT_I, 'accord-icon-192.png'), optimize=True)
sized(padded, 512, opaque=True).save(os.path.join(OUT_I, 'accord-icon-512.png'), optimize=True)
sized(maskable, 512, opaque=True).save(os.path.join(OUT_I, 'accord-icon-maskable-512.png'), optimize=True)
print('icons written from', os.path.relpath(SRC, ROOT), 'artwork box', box)
