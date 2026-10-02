#!/usr/bin/env node
/**
 * Post-build SEO step: prerendered public pages (ar + en), sitemap.xml and robots.txt.
 * The logic lives in src/build (TypeScript, the same repositories, settings, SEO resolver and
 * JSON-LD builders the storefront uses) and runs through Vite's module runner.
 *
 * Reads the same VITE_* variables as the build (.env files + process env). Live mode reads the
 * public catalog with the anon key only; a failure fails the build rather than publishing a
 * robots.txt / sitemap that silently disagrees with the store.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadEnv, runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const mode = process.env.MODE ?? 'production';
const env = { ...loadEnv(mode, root, 'VITE_'), ...pickVite(process.env) };

function pickVite(source) {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k.startsWith('VITE_')));
}

const resolve = { alias: { '@': join(root, 'src'), '@seed': join(root, 'supabase/seed/data') } };
const { module } = await runnerImport('/src/build/run.ts', {
  root,
  configFile: false,
  logLevel: 'error',
  mode,
  resolve,
});

// The untouched SPA shell (dist/404.html, copied by vite.config.ts) is the template: the
// prerendered Home page then replaces dist/index.html.
const template = await readFile(join(dist, '404.html'), 'utf8');
const { files, report } = await module.run(env, template);
for (const file of files) {
  const target = join(dist, file.file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
console.log(
  `generate-site: ${report.mode} mode, ${report.pages} prerendered pages, ` +
    `${report.sitemapUrls} sitemap URLs, indexable: ${report.indexable ? 'yes' : 'no'} — ${report.reason}`,
);

// Service worker (src/pwa/sw.ts): precaches the offline page and the app shell's entry files; the
// version changes whenever those change, which clears the previous release's page caches.
const shellAssets = [...template.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
const precache = [
  '/offline.html',
  '/brand/malek-store-mark-192.webp',
  '/icons/icon-192.png',
  ...new Set(shellAssets),
];
const offlineHtml = await readFile(join(dist, 'offline.html'), 'utf8');
const version = createHash('sha256')
  .update(JSON.stringify(precache))
  .update(offlineHtml)
  .digest('hex')
  .slice(0, 12);
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  mode,
  resolve,
  define: {
    __SW_VERSION__: JSON.stringify(version),
    __SW_PRECACHE__: JSON.stringify(precache),
  },
  build: {
    outDir: dist,
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'es2022',
    lib: {
      entry: join(root, 'src/pwa/sw.ts'),
      formats: ['iife'],
      name: 'malekServiceWorker',
      fileName: () => 'sw.js',
    },
  },
});
console.log(`generate-site: service worker ${version}, ${precache.length} precached files`);
