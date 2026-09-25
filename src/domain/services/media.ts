import { subtractMoney } from '@/domain/commerce/money';
import type { ServicesSettings } from '@/domain/settings/schemas';

/**
 * Shared media rules for service requests (repairs, trade-in, after-sales, used proposals).
 * The browser checks files before upload (type sniffed from the file's bytes — the browser's
 * reported MIME type is not trusted alone); the database re-checks the stored object's MIME
 * type, extension and size when a file is attached (app.service_media_problem).
 */
export const IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export type ServiceMime = (typeof IMAGE_MIME)[number] | (typeof VIDEO_MIME)[number];

export const EXT_FOR_MIME: Record<ServiceMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export const ACCEPT_ATTRIBUTE = [...IMAGE_MIME, ...VIDEO_MIME].join(',');
export const ACCEPT_IMAGES = IMAGE_MIME.join(',');

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

/** Identify a file from its first bytes (magic numbers). Null = not an allowed media type. */
export function sniffMime(bytes: Uint8Array): ServiceMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'video/webm';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

export type MediaProblem =
  | 'invalid_media_type'
  | 'media_too_large'
  | 'too_many_files'
  | 'too_many_videos'
  | 'video_not_allowed';

export interface MediaLimits {
  maxFiles: number;
  maxVideos: number;
  allowVideo: boolean;
  maxImageBytes: number;
  maxVideoBytes: number;
}

export const limitsFromSettings = (media: ServicesSettings['media']): MediaLimits => ({
  maxFiles: media.maxFiles,
  maxVideos: media.maxVideos,
  allowVideo: media.allowVideo,
  maxImageBytes: media.maxImageBytes,
  maxVideoBytes: media.maxVideoBytes,
});

/** Check one prepared file (after compression) against the limits and what is already attached. */
export function mediaProblem(
  file: { mime: ServiceMime | null; size: number },
  existing: { images: number; videos: number },
  limits: MediaLimits,
  allowVideoHere = true,
): MediaProblem | null {
  if (!file.mime) return 'invalid_media_type';
  const isVideo = file.mime.startsWith('video/');
  if (isVideo && (!limits.allowVideo || !allowVideoHere)) return 'video_not_allowed';
  if (existing.images + existing.videos + 1 > limits.maxFiles) return 'too_many_files';
  if (isVideo && existing.videos + 1 > limits.maxVideos) return 'too_many_videos';
  if (file.size > (isVideo ? limits.maxVideoBytes : limits.maxImageBytes)) return 'media_too_large';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Trade-in difference to pay = new device price − current device valuation, in exact piasters
 * (mirrors the database's numeric(12,2) arithmetic). Negative ⇒ the store owes the customer.
 */
export function tradeInDifference(targetPrice: number, deviceValue: number): number {
  return subtractMoney(targetPrice, deviceValue);
}
