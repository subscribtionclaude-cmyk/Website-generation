/**
 * Catalog media rules shared by the media-ingest Edge Function (supabase/functions/
 * catalog-media-ingest) and the storefront. Pure functions, relative imports only (Deno + Vite).
 *
 * Product images come only from official manufacturer hosts, are re-encoded into our own storage
 * (never hot-linked) as square transparent WebP derivatives, and are addressed by content hash so
 * the same file is stored once.
 */

/** Official manufacturer / manufacturer-CDN domains (a host must equal one or be a subdomain). */
export const OFFICIAL_IMAGE_DOMAINS = [
  'apple.com',
  'cdn-apple.com',
  'samsung.com',
  'mi.com',
  'appmifile.com',
  'oppo.com',
  'realme.com',
  'honor.com',
  'hihonor.com',
  'infinixmobility.com',
  'tecno-mobile.com',
  'vivo.com',
] as const;

export function isOfficialImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false;
  return OFFICIAL_IMAGE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Square derivatives: card / thumbnail and product-page detail. */
export const DERIVATIVE_SIZES = [480, 1200] as const;
export type DerivativeSize = (typeof DERIVATIVE_SIZES)[number];

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MIN_SOURCE_SIDE = 400;
export const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type SourceProblem = 'type' | 'too_large' | 'empty' | 'too_small' | 'aspect';

/** Reject anything that is not a usable product photo (wrong type, tiny swatch, banner strip…). */
export function sourceProblem(src: {
  contentType: string | null;
  bytes: number;
  width: number;
  height: number;
}): SourceProblem | null {
  const type = (src.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(SOURCE_TYPES as readonly string[]).includes(type)) return 'type';
  if (src.bytes <= 0) return 'empty';
  if (src.bytes > MAX_SOURCE_BYTES) return 'too_large';
  if (Math.min(src.width, src.height) < MIN_SOURCE_SIDE) return 'too_small';
  const ratio = src.width / src.height;
  if (ratio > 3 || ratio < 1 / 3) return 'aspect';
  return null;
}

/** Fit (w, h) inside a square box without upscaling past the box, centred. */
export function fitInSquare(width: number, height: number, box: number) {
  const scale = Math.min(box / width, box / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, x: Math.round((box - w) / 2), y: Math.round((box - h) / 2) };
}

const SLUG = /^[a-z0-9-]{1,60}$/;
const SHA = /^[0-9a-f]{64}$/;

/** Storage path of one derivative: products/catalog/<brand>/<sha16>-<size>.webp */
export function derivativePath(brand: string, sha256: string, size: DerivativeSize): string {
  if (!SLUG.test(brand)) throw new Error('invalid brand slug');
  if (!SHA.test(sha256)) throw new Error('invalid sha256');
  return `catalog/${brand}/${sha256.slice(0, 16)}-${size}.webp`;
}

const DERIVATIVE_URL =
  /^(.*\/storage\/v1\/object\/public\/products\/catalog\/[a-z0-9-]+\/[0-9a-f]{16})-(480|1200)\.webp$/;

/**
 * Responsive sources for a catalog image stored by the ingest function, so listing cards load the
 * 480 px file and the product page the 1200 px one. Other URLs (demo media, staff uploads) get none.
 */
export function catalogSrcSet(url: string): string | undefined {
  const m = DERIVATIVE_URL.exec(url);
  if (!m) return undefined;
  return `${m[1]}-480.webp 480w, ${m[1]}-1200.webp 1200w`;
}
