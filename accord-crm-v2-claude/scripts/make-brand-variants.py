"""Derive the UI logo variants from the supplied ACCORD artwork (no redrawing — recolour/crop only).

  public/brand/accord-logo-dark.png   high-contrast variant for dark surfaces: wordmark + ring in soft white,
                                      tagline in brand gold (the supplied dark logo was mid-lavender on navy, too faint)
Compact/app icons are NOT made here: they come only from the official icon files (scripts/make-icons.py).
The original supplied dark logo is kept (not deployed) at assets-src/accord-logo-dark-original.png.
usage: python3 scripts/make-brand-variants.py
"""
import os, shutil
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'brand')
src = Image.open(os.path.join(ROOT, 'accord-logo-light.png')).convert('RGBA')
orig_dark = os.path.join(ROOT, '..', '..', 'assets-src', 'accord-logo-dark-original.png')
if not os.path.exists(orig_dark):
    shutil.copy(os.path.join(ROOT, 'accord-logo-dark.png'), orig_dark)

WORD_DARK = (241, 243, 255)   # soft white
GOLD_DARK = (226, 194, 104)   # brand gold, lifted for dark backgrounds

def is_gold(x, y):
    # the tagline block ("360 FACILITY MANAGEMENT SOLUTIONS") sits under the wordmark, left of the ring
    return 95 <= y <= 128 and x < 200

def recolour(im, word, gold):
    out = Image.new('RGBA', im.size)
    px, po = im.load(), out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            po[x, y] = (*(gold if is_gold(x, y) else word), a)
    return out

recolour(src, WORD_DARK, GOLD_DARK).save(os.path.join(ROOT, 'accord-logo-dark.png'), optimize=True)

print('brand variants written')
