// Derives web-optimised brand assets from the source-of-truth logo.
// The source file (public/brand/malek-store-logo.png) is never modified:
// derived files are only trimmed, padded and resized — the mark itself is untouched.
//
// Usage: npm run brand:icons
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const brandDir = path.join(root, 'public/brand');
const iconsDir = path.join(root, 'public/icons');
const source = path.join(brandDir, 'malek-store-logo.png');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Trim the transparent margin so the mark fills UI slots edge to edge. */
async function trimmedMark() {
  return sharp(source).trim({ threshold: 10 }).toBuffer();
}

/** Square icon: the trimmed mark centred on a background with a safe-area padding ratio. */
async function squareIcon(mark, size, paddingRatio, background) {
  const inner = Math.round(size * (1 - paddingRatio * 2));
  const resized = await sharp(mark)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9 });
}

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const mark = await trimmedMark();

  // UI mark (transparent) in modern + fallback formats.
  for (const width of [96, 192, 384]) {
    await sharp(mark)
      .resize({ width })
      .webp({ quality: 90, alphaQuality: 100 })
      .toFile(path.join(brandDir, `malek-store-mark-${width}.webp`));
  }
  await sharp(mark)
    .resize({ width: 384 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(brandDir, 'malek-store-mark.png'));

  // Favicons / app icons (white tile keeps the black "M" visible on dark browser chrome).
  await (await squareIcon(mark, 32, 0.06, WHITE)).toFile(path.join(iconsDir, 'favicon-32.png'));
  await (
    await squareIcon(mark, 180, 0.12, WHITE)
  ).toFile(path.join(iconsDir, 'apple-touch-icon.png'));
  await (await squareIcon(mark, 192, 0.12, WHITE)).toFile(path.join(iconsDir, 'icon-192.png'));
  await (await squareIcon(mark, 512, 0.12, WHITE)).toFile(path.join(iconsDir, 'icon-512.png'));
  // Maskable icons need the artwork inside the central 80% safe zone.
  await (
    await squareIcon(mark, 512, 0.2, WHITE)
  ).toFile(path.join(iconsDir, 'icon-maskable-512.png'));
  // Social preview fallback (Open Graph) — neutral white canvas with centred mark.
  const og = await sharp(mark).resize({ height: 360 }).toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: WHITE } })
    .composite([{ input: og, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(brandDir, 'og-default.png'));

  console.log('Brand assets generated in public/brand and public/icons');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
