// Supabase Edge Function (Deno): copies OFFICIAL manufacturer product images into the products
// bucket as square, transparent WebP derivatives (480 px card / 1200 px detail), addressed by the
// SHA-256 of the source file so the same image is stored once. Never hot-links, never follows
// redirects, only fetches allow-listed manufacturer domains, and only runs with a short-lived token
// created by a database operator (catalog_media_authorize, service role only).
//
// POST { token, brand, items: [{ key, url, kind?: 'image' | 'swatch' }] }   (max 2 items per call)
//  → { results: [{ key, ok, sha256, width, height, files: { 480, 1200 } } | { key, ok: false, error }] }
// A "swatch" item returns the average colour of an official colour-swatch image instead of files.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import encodeWebp, { init as initWebp } from 'npm:@jsquash/webp@1.5.0/encode.js';
import {
  DERIVATIVE_SIZES,
  derivativePath,
  fitInSquare,
  isOfficialImageUrl,
  MAX_SOURCE_BYTES,
  sourceProblem,
} from '../../../src/domain/catalog/import/media.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const QUALITY: Record<number, number> = { 480: 80, 1200: 86 };
const BRAND = /^[a-z0-9-]{1,60}$/;

// ImageScript decodes and resizes; libwebp (jsquash, Apache-2.0) encodes, because the Deno build of
// ImageScript has no WebP encoder. The wasm binary is pinned by version and SHA-256.
const WEBP_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/codec/enc/webp_enc_simd.wasm';
const WEBP_WASM_SHA256 = '39c279269ec1163b987b6d69749458e3d5b03b9585f58b6ca5455b76b504a305';
let webpReady: Promise<unknown> | null = null;

function loadWebpEncoder(): Promise<unknown> {
  webpReady ??= (async () => {
    const res = await fetch(WEBP_WASM_URL, { signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) throw new Error(`webp wasm http ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256Hex(bytes)) !== WEBP_WASM_SHA256) throw new Error('webp wasm hash mismatch');
    return initWebp(await WebAssembly.compile(bytes));
  })().catch((error) => {
    webpReady = null; // retry on the next request
    throw error;
  });
  return webpReady;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function averageHex(img: Image): string | null {
  const px = img.bitmap;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] ?? 0) < 200) continue; // ignore transparent / anti-aliased edge pixels
    r += px[i] ?? 0;
    g += px[i + 1] ?? 0;
    b += px[i + 2] ?? 0;
    n += 1;
  }
  if (n === 0) return null;
  const h = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed' });
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    brand?: unknown;
    items?: unknown;
  } | null;
  const items = Array.isArray(body?.items) ? body.items.slice(0, 2) : [];
  const brand = typeof body?.brand === 'string' && BRAND.test(body.brand) ? body.brand : null;
  if (!brand || items.length === 0) return json(400, { ok: false, code: 'invalid_request' });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await service.rpc('catalog_media_authorize', {
    p_token: typeof body?.token === 'string' ? body.token : '',
  });
  if (auth.error || auth.data !== true) return json(403, { ok: false, code: 'forbidden' });

  const results = [];
  for (const raw of items) {
    const item = raw as { key?: unknown; url?: unknown; kind?: unknown };
    const key = typeof item.key === 'string' ? item.key.slice(0, 200) : '';
    const source = typeof item.url === 'string' ? item.url : '';
    if (!key || !isOfficialImageUrl(source)) {
      results.push({ key, ok: false, error: 'source_not_official' });
      continue;
    }
    let step = 'fetch';
    try {
      const res = await fetch(source, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          'User-Agent': 'MalekStoreCatalogIngest/1.0',
          Accept: 'image/png,image/jpeg,image/webp',
        },
      });
      if (res.status !== 200) {
        results.push({ key, ok: false, error: `http_${res.status}` });
        continue;
      }
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MAX_SOURCE_BYTES) {
        results.push({ key, ok: false, error: 'too_large' });
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha256 = await sha256Hex(bytes);
      let img: Image;
      try {
        img = (await Image.decode(bytes)) as Image;
      } catch {
        results.push({ key, ok: false, error: 'decode_failed', sha256 });
        continue;
      }
      if (item.kind === 'swatch') {
        results.push({ key, ok: true, sha256, swatchHex: averageHex(img) });
        continue;
      }
      const problem = sourceProblem({
        contentType: res.headers.get('content-type'),
        bytes: bytes.length,
        width: img.width,
        height: img.height,
      });
      if (problem) {
        results.push({
          key,
          ok: false,
          error: problem,
          sha256,
          width: img.width,
          height: img.height,
        });
        continue;
      }
      const files: Record<number, string> = {};
      for (const size of DERIVATIVE_SIZES) {
        step = 'resize';
        const fit = fitInSquare(img.width, img.height, size);
        const scaled = img.clone().resize(fit.width, fit.height);
        const canvas = new Image(size, size).composite(scaled, fit.x, fit.y);
        step = 'encode';
        await loadWebpEncoder();
        const px = canvas.bitmap;
        const rgba = new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength);
        const webp = new Uint8Array(
          await encodeWebp({ data: rgba, width: size, height: size } as ImageData, {
            quality: QUALITY[size] ?? 82,
          }),
        );
        step = 'upload';
        const path = derivativePath(brand, sha256, size);
        const up = await service.storage.from('products').upload(path, webp, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: false,
        });
        // Same content hash = same file: an existing object is the expected dedupe outcome.
        if (up.error && !/exists|duplicate/i.test(up.error.message)) {
          console.error('catalog-media-ingest upload error', up.error.message);
          throw new Error('upload_failed');
        }
        files[size] = `${url}/storage/v1/object/public/products/${path}`;
      }
      results.push({
        key,
        ok: true,
        sha256,
        width: img.width,
        height: img.height,
        bytes: bytes.length,
        files,
      });
    } catch (error) {
      // Only a step code goes back to the caller; the detail stays in the function logs.
      console.error(`catalog-media-ingest ${step} failed`, error);
      const name = error instanceof Error ? error.name : '';
      results.push({
        key,
        ok: false,
        error: name === 'TimeoutError' ? 'timeout' : `${step}_failed`,
      });
    }
  }
  return json(200, { ok: true, results });
});
