// Shared helpers for the catalog import scripts (Node 22+, imports the TypeScript domain directly).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const SOURCES_DIR = join(ROOT, 'scripts/catalog/sources');
export const INGESTED_FILE = join(ROOT, 'catalog/media/ingested.json');

/** Verified per-brand source files, in storefront brand order. */
export function loadSources(onlyBrands = []) {
  const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json'));
  const sources = files.map((f) => JSON.parse(readFileSync(join(SOURCES_DIR, f), 'utf8')));
  return sources
    .filter((s) => onlyBrands.length === 0 || onlyBrands.includes(s.brand.slug))
    .sort((a, b) => (a.brand.sortOrder ?? 999) - (b.brand.sortOrder ?? 999));
}

/** Official images already copied into our storage (exported from the media-ingest log). */
export function loadIngested() {
  if (!existsSync(INGESTED_FILE)) return [];
  return JSON.parse(readFileSync(INGESTED_FILE, 'utf8')).images ?? [];
}

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
