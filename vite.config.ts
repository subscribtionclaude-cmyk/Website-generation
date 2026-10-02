/// <reference types="vitest/config" />
import { existsSync } from 'node:fs';
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

/**
 * `vite preview` like a static host with `public/_redirects`: prerendered pages (dist/<path>.html,
 * written by scripts/generate-site.mjs) are served as they are; any other navigation gets the
 * plain SPA shell (dist/404.html) instead of the prerendered Home page in dist/index.html.
 */
function previewShell(): Plugin {
  return {
    name: 'malek-preview-shell',
    configurePreviewServer(server) {
      const outDir = server.config.build.outDir;
      server.middlewares.use((req, _res, next) => {
        const path = new URL(req.url ?? '/', 'http://preview').pathname;
        const isPage = req.method === 'GET' && !/\.[a-z0-9]+$/i.test(path) && path !== '/';
        if (isPage && !existsSync(`${outDir}${path.replace(/\/+$/, '')}.html`))
          req.url = '/404.html';
        next();
      });
    },
  };
}

/**
 * Preload the primary Arabic faces (Arabic is the default locale) so the first paint doesn't wait
 * for CSS to discover them and headings don't re-wrap when the web font arrives (CLS). English
 * prerendered pages drop this hint (generate-site).
 */
function fontPreload(): Plugin {
  return {
    name: 'malek-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        // Body text (400) and headings (700): the faces the first screen paints with.
        const fonts = Object.keys(ctx.bundle ?? {}).filter((f) =>
          /ibm-plex-sans-arabic-arabic-(400|700)-normal-[\w-]+\.woff2$/.test(f),
        );
        return fonts.map((font) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `/${font}`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
            'data-locale': 'ar',
          },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

/**
 * Build-time secret guard: every VITE_* variable is embedded in the public bundle, so a
 * secret-looking name or value stops dev/build immediately. Provider secrets belong in the server
 * runtime's environment (Supabase Edge Function secrets) — see .env.example.
 * (scripts/check-secrets.mjs re-checks the environment and scans the built output.)
 */
const SECRET_ENV_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|CREDENTIAL|API_KEY|ACCESS_KEY)/;
const SECRET_ENV_VALUE =
  /^(sb_secret_|sk-|sk_live_|rk_live_|EAA[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_|xox[abprs]-|-----BEGIN)/;

function envGuard(): Plugin {
  return {
    name: 'malek-env-guard',
    configResolved(config) {
      for (const [name, value] of Object.entries(config.env)) {
        if (!name.startsWith('VITE_')) continue;
        const badName = name !== 'VITE_SUPABASE_ANON_KEY' && SECRET_ENV_NAME.test(name);
        if (badName || (typeof value === 'string' && SECRET_ENV_VALUE.test(value)))
          throw new Error(
            `${name} looks like a secret. VITE_* variables are public (embedded in the browser bundle); ` +
              'keep provider secrets in the server runtime environment (Supabase Edge Function secrets).',
          );
      }
    },
  };
}

export default defineConfig({
  plugins: [envGuard(), react(), spaFallback(), previewShell(), fontPreload()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@seed': fileURLToPath(new URL('./supabase/seed/data', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep the admin, demo data and backend client out of the storefront entry chunk. The entry
    // budget (400 kB) is enforced by scripts/check-bundle.mjs; the only larger chunk is the lazy
    // three.js repair-diagnostic viewer (never loaded by Home, Shop, Product, Checkout, Account).
    chunkSizeWarningLimit: 600,
    modulePreload: {
      // Storefront chunks keep their <link rel="modulepreload"> hints. Admin pages and the Site
      // Editor preview runtime load their own imports instead: their preload lists would otherwise
      // sit in the storefront entry (the admin route table lives there) for every shopper.
      resolveDependencies: (filename, deps) =>
        /(^|\/)(Admin[A-Z]\w*|RequireModule|previewRuntime)-/.test(filename) ? [] : deps,
    },
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
