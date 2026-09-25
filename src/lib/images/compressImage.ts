/**
 * Browser-side photo compression (free; no upload service): downscale to `maxSize` px on the long
 * edge and re-encode as WebP (JPEG fallback). Keeps uploads small for storage and mobile data.
 */
export async function compressImage(file: File, maxSize = 1280, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not_an_image');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const blob = (await encode('image/webp')) ?? (await encode('image/jpeg'));
  if (!blob) throw new Error('encode_failed');
  return blob;
}
