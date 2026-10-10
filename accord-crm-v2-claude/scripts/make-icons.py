#!/usr/bin/env python3
"""Build every ACCORD app/brand ICON from the two OFFICIAL, approved icon files — nothing else.

  assets-src/official-icons/accord-icon-light.png   (official, light surfaces)
  assets-src/official-icons/accord-icon-dark.png    (official, dark / night surfaces)

Only technical operations are applied: crop away the white export margin, square-crop, resize (LANCZOS, aspect kept),
and — for the dark icon only — an alpha mask that follows its own rounded-square outline so no white export
background shows on dark UI. No recolouring, redrawing or simplification.

Outputs
  public/brand/accord-icon-light.png, accord-icon-dark.png   in-app compact icon (collapsed sidebar), 192 px
  public/icons/icon-192.png, icon-512.png, apple-touch-icon.png, icon-maskable-512.png   PWA / Home Screen (light)
  public/icons/favicon-32.png, favicon-64.png                  favicon, light theme
  public/icons/favicon-dark-32.png, favicon-dark-64.png        favicon, dark theme
Wordmark logos are produced separately by scripts/make-brand-variants.py.
Run: python3 -I scripts/make-icons.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets-src', 'official-icons')
OUT_B = os.path.join(ROOT, 'public', 'brand')
OUT_I = os.path.join(ROOT, 'public', 'icons')
os.makedirs(OUT_B, exist_ok=True); os.makedirs(OUT_I, exist_ok=True)

light_src = Image.open(os.path.join(SRC, 'accord-icon-light.png')).convert('RGB')
dark_src = Image.open(os.path.join(SRC, 'accord-icon-dark.png')).convert('RGB')

# Light icon: the round badge spans x 41..979 of the 1024 export; square crop around it (white export background kept,
# it is the icon's own background and matches light surfaces / iOS opaque-icon rules).
LIGHT_BOX = (41, 68, 979, 1006)
# Dark icon: the navy rounded square spans x 85..982, y 92..971; square crop inside it, then mask the rounded corners.
DARK_BOX = (94, 92, 973, 971)
DARK_RADIUS = 0.17  # corner radius of the official artwork (~150 px of 879)

light = light_src.crop(LIGHT_BOX)
dark = dark_src.crop(DARK_BOX).convert('RGBA')
mask = Image.new('L', dark.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, dark.width - 1, dark.height - 1), radius=int(dark.width * DARK_RADIUS), fill=255)
dark.putalpha(mask)

def sized(im, n):
    return im.resize((n, n), Image.LANCZOS)

# in-app compact icon
sized(light, 192).save(os.path.join(OUT_B, 'accord-icon-light.png'), optimize=True)
sized(dark, 192).save(os.path.join(OUT_B, 'accord-icon-dark.png'), optimize=True)

# PWA / Home Screen (opaque)
sized(light, 192).save(os.path.join(OUT_I, 'icon-192.png'), optimize=True)
sized(light, 512).save(os.path.join(OUT_I, 'icon-512.png'), optimize=True)
sized(light, 180).save(os.path.join(OUT_I, 'apple-touch-icon.png'), optimize=True)
# maskable: whole badge inside the 80 % safe zone, padded with the icon's own white background
pad = Image.new('RGB', (640, 640), (255, 255, 255))
pad.paste(sized(light, 512), (64, 64))
sized(pad, 512).save(os.path.join(OUT_I, 'icon-maskable-512.png'), optimize=True)

# favicons
sized(light, 32).save(os.path.join(OUT_I, 'favicon-32.png'), optimize=True)
sized(light, 64).save(os.path.join(OUT_I, 'favicon-64.png'), optimize=True)
sized(dark, 32).save(os.path.join(OUT_I, 'favicon-dark-32.png'), optimize=True)
sized(dark, 64).save(os.path.join(OUT_I, 'favicon-dark-64.png'), optimize=True)
print('official ACCORD icons written')
