/// <reference types="vitest/config" />
import { copyFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Generic static-host SPA fallback: many static hosts (and GitHub-Pages-style hosts)
 * serve `404.html` for unknown paths. Copying index.html there lets deep links such as
 * `/en/store` boot the SPA even where rewrite rules (`public/_redirects`) are unsupported.
 */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'malek-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      await copyFile(`${outDir}/index.html`, `${outDir}/404.html`);
    },
  };
}

export default defineConfig({
  plugins: [react(), spaFallback()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@seed': fileURLToPath(new URL('./supabase/seed/data', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep the admin, demo data and backend client out of the storefront entry chunk.
    chunkSizeWarningLimit: 400,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Only the token sheet is loaded for real (contrast tests read it); other CSS is stubbed for speed.
    css: { include: [/src\/styles\/tokens\.css/], modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
  },
});
