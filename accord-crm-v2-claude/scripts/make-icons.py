#!/usr/bin/env python3
"""Build UI logos + PWA icons ONLY from the supplied ACCORD logo files (no generated/redrawn artwork).
Run: python3 -I scripts/make-icons.py   (needs Pillow)"""
from PIL import Image
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets-src')
OUT_B = os.path.join(ROOT, 'public', 'brand'); OUT_I = os.path.join(ROOT, 'public', 'icons')
os.makedirs(OUT_B, exist_ok=True); os.makedirs(OUT_I, exist_ok=True)

def trimmed(name):
    im = Image.open(os.path.join(SRC, name)).convert('RGBA')
    return im.crop(im.getchannel('A').getbbox())

light = trimmed('accord-logo-light-transparent.png')   # deep-blue wordmark: for light surfaces
dark = trimmed('accord-logo-dark-transparent.png')     # light-purple wordmark: for dark surfaces
light.save(os.path.join(OUT_B, 'accord-logo-light.png'), optimize=True)
dark.save(os.path.join(OUT_B, 'accord-logo-dark.png'), optimize=True)

def icon(size, fill_ratio, bg=(255, 255, 255, 255)):
    canvas = Image.new('RGBA', (size, size), bg)
    w = int(size * fill_ratio); h = int(light.height * w / light.width)
    logo = light.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - w) // 2, (size - h) // 2))
    return canvas.convert('RGB')

icon(192, 0.74).save(os.path.join(OUT_I, 'icon-192.png'), optimize=True)
icon(512, 0.74).save(os.path.join(OUT_I, 'icon-512.png'), optimize=True)
icon(512, 0.56).save(os.path.join(OUT_I, 'icon-maskable-512.png'), optimize=True)   # inside the 80% safe zone
icon(180, 0.76).save(os.path.join(OUT_I, 'apple-touch-icon.png'), optimize=True)    # iOS needs opaque, no transparency
icon(64, 0.9).save(os.path.join(OUT_I, 'favicon-64.png'), optimize=True)
icon(32, 0.94).save(os.path.join(OUT_I, 'favicon-32.png'), optimize=True)
print('icons written')
