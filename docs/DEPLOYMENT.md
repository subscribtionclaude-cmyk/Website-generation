# Deployment

The frontend is a static SPA. Any static host works; nothing is tied to one vendor.
The backend stays on Supabase (free tier is enough to launch).

## Build

```bash
npm ci
# set build-time env (see README §3): VITE_DATA_MODE=live, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SITE_URL
npm run build          # → dist/
npm run preview        # optional local check on http://localhost:4173
```

`VITE_*` values are baked into the bundle at build time, so each environment (staging/live) needs its
own build. Only public values belong there (the anon/publishable key is public by design; RLS
protects the data).

`dist/` contains:

| File                                          | Purpose                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/`                                     | the app's hashed, immutable files                                                                                                                                                                                    |
| `index.html`, `<path>.html`, `en/<path>.html` | prerendered public pages (Home, store, categories, brands, products, offers, news, services, contact, legal), Arabic and English — same head as the running app plus a readable body for crawlers without JavaScript |
| `404.html`                                    | the plain SPA shell (the built `index.html` before prerendering) — served for app routes without a prerendered file, and (status 404) for unknown URLs                                                               |
| `_redirects`                                  | Netlify-style rules: every known app route → `/404.html` with **200**; anything else → `/404.html` with **404**. `src/build/hosting.test.ts` keeps the list in sync with the route table                             |
| `_headers`                                    | Content-Security-Policy and security headers on every response; `sw.js` / `offline.html` / manifest revalidated; `assets/*` immutable (Netlify / Cloudflare Pages and compatible hosts)                              |
| `sitemap.xml`, `robots.txt`                   | generated at build time from published, non-demo content (demo builds: `Disallow: /`, empty sitemap)                                                                                                                 |
| `sw.js`, `offline.html`                       | service worker (public files and visited public pages only) and its offline page                                                                                                                                     |
| `manifest.webmanifest`, `icons/`, `brand/`    | PWA manifest, favicons, logo assets                                                                                                                                                                                  |

## Routing (prerendered pages + SPA deep links)

A request for `/en/store` must serve `en/store.html` when it exists, and the SPA shell `404.html`
otherwise (e.g. `/admin/orders`, `/account`, a product published after the build). Do **not** rewrite
unknown paths to `index.html` — that is now the prerendered Arabic Home page. Made-up URLs should get
the shell with a real **404** status (the app shows the bilingual not-found page); `_redirects`
does this on hosts that read it. `npm run preview` applies `_redirects` and `_headers` the same way,
so the E2E suite (incl. `e2e/launch.spec.ts`) tests what the host will serve.

| Host                                  | What to do                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ShipStatic**                        | Upload the **contents** of `dist/`. After the first deploy run the [ShipStatic check](#shipstatic-check) below. If a rule or header is not honoured, use ShipStatic's own SPA / fallback and header options per its current docs, or a host from this table that reads `_redirects` / `_headers`. |
| Netlify / Cloudflare Pages            | `.html` pages are served without the extension and `_redirects` sends the rest to `404.html` automatically.                                                                                                                                                                                       |
| Cloudflare Workers static assets      | `not_found_handling = "404-page"` (serves `404.html`, status 404, for unknown paths). Avoid `single-page-application`: it would serve the prerendered `index.html`.                                                                                                                               |
| Vercel                                | `vercel.json`: `{ "cleanUrls": true, "rewrites": [{ "source": "/(.*)", "destination": "/404.html" }] }`                                                                                                                                                                                           |
| GitHub Pages / hosts without rewrites | `.html` pages are served without the extension; `404.html` boots the app for other paths (HTTP status 404 — fine for users; prerendered public pages return 200).                                                                                                                                 |
| Nginx                                 | `location / { try_files $uri $uri.html $uri/ /404.html; }`                                                                                                                                                                                                                                        |
| Apache                                | `RewriteEngine On` · `RewriteCond %{REQUEST_FILENAME}.html -f` · `RewriteRule ^(.*)$ $1.html [L]` · `FallbackResource /404.html`                                                                                                                                                                  |

Recommended cache headers (where the host allows): `assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
HTML, `sw.js`, `sitemap.xml`, `robots.txt` → `no-cache`.

## Security headers

`dist/_headers` sets, on every response: `Content-Security-Policy` (scripts only from the site, the
one prerender inline script pinned by its SHA-256 hash, Google Tag Manager for consented analytics;
API calls to `*.supabase.co`; `frame-ancestors 'self'` so the Site Editor's same-origin preview
works), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`. On a host
that ignores `_headers`, configure the same values in the host's settings (copy them from the file).
If you change the inline script in `src/build/generateSite.ts`, `src/build/hosting.test.ts` fails
until the hash in `public/_headers` is updated. If you load scripts or call APIs from another origin
(e.g. a new integration in the browser), add that origin to the CSP — otherwise the browser blocks it.

## ShipStatic check

Phase 10 could not run a full staging deploy from the build environment: its network policy blocks
`shipstatic.com`, and the 6.5 MB / 514-file build is too large for the inline upload tool. A
2.5 KB **probe** with the real `_headers` and a reduced `_redirects` was deployed to the owner's
ShipStatic account at `https://strong-star-8p5x5jg.shipstatic.com` (marker pages only, no app
code; delete it from the ShipStatic dashboard when done). It could not be fetched from the build
environment either, so open it yourself and compare:

| URL                      | Expected (rules honoured)                                    |
| ------------------------ | ------------------------------------------------------------ |
| `/`                      | "PROBE-INDEX", status 200                                    |
| `/store`                 | "PROBE-PRERENDERED-STORE" (the real file wins over the rule) |
| `/en/store`              | "PROBE-EN-STORE" (`.html` served without the extension)      |
| `/cart`, `/admin/orders` | "PROBE-SHELL", status 200                                    |
| `/does-not-exist`        | "PROBE-SHELL", status **404**                                |
| response headers on `/`  | `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, …  |
| `/sw.js`                 | `Cache-Control: no-cache`                                    |

Use the browser's developer tools (Network tab) to see status codes and headers. Then repeat the
[post-deploy smoke test](LAUNCH_RUNBOOK.md#post-deploy-smoke-test) on the real staging deploy.

## Search engines

- Demo builds are never indexable. A live build is indexable only with `VITE_SITE_URL` set (absolute
  https) **and** Settings → Search engines → "Allow indexing" published. The base seed ships with
  indexing **off** (since v1.0.0-rc.1): switching it on is the launch step
  ([runbook step 14](LAUNCH_RUNBOOK.md#14-indexing-switch--owner)). Staging builds leave
  `VITE_SITE_URL` unset, so they stay unindexable whatever their database says.
- The build reads the public catalog through `seo_public_index()` with the anon key (published,
  visible, non-demo rows only) and fails rather than publish a sitemap that disagrees with the store.
- Prerendered pages and `sitemap.xml` reflect content at build time: rebuild and redeploy after
  publishing products, offers or news you want crawlers without JavaScript to see (the running app
  always shows the latest content). Submit `https://<domain>/sitemap.xml` in Google Search Console.

## Supabase settings per environment

In _Authentication → URL Configuration_:

- **Site URL**: the public URL of this environment.
- **Redirect URLs**: `https://<domain>/**` (and any preview domains). The email sign-in link returns to
  the page the user came from (`/account`, `/admin`, …), so the wildcard is required.

## Optional integrations (Phase 09)

Nothing here is required: with no integration configured the store runs on its free / manual
fallbacks (wa.me WhatsApp, in-app notifications, manual shipping fee, built-in search and analytics,
Supabase Storage, manual exports, email sign-in).

1. **Server runtime** — deploy the two Edge Functions (free tier is enough to start):
   `supabase functions deploy integrations` and
   `supabase functions deploy integration-webhook --no-verify-jwt` (`supabase/config.toml` already
   sets `verify_jwt = false` for the webhook, which instead checks the provider's HMAC signature).
   Without them, Test connection / sync / dispatch report "Server runtime unavailable".
2. **Secrets** — set provider secrets on the server only, by the names listed in Admin →
   Integrations (e.g. `supabase secrets set WHATSAPP_ACCESS_TOKEN=…`, `ODOO_API_KEY=…`). Never put
   them in `VITE_*` variables, the repository, the database or the admin forms — the build refuses
   secret-looking `VITE_*` variables and `npm run check:secrets` scans the built files.
3. **Configure in the admin** — public settings (IDs, URLs, template names, source-of-truth per data
   type), then **Test connection**, then **Enable**. The manual fallback stays active until a test
   passes. Disabling or removing an integration restores the fallback immediately.
4. **Webhooks** (WhatsApp delivery receipts) — callback URL
   `https://<project>.supabase.co/functions/v1/integration-webhook`, verify token =
   `WHATSAPP_VERIFY_TOKEN`, app secret = `WHATSAPP_WEBHOOK_SECRET`.
5. **Message dispatch** — "Send due messages now" in the admin, or schedule a call to the
   `integrations` function (`{"action":"dispatch","channel":"whatsapp"}`) with a staff JWT.
6. **Social sign-in** — enable Google / Apple in Supabase → Authentication → Providers (OAuth client
   secrets live there), add the site to the redirect URLs, then enable "Sign in with Google & Apple"
   in the admin.
7. **Google Analytics** — enter the Measurement ID and enable; GA loads only after a visitor accepts
   analytics cookies, never on private pages. Review your privacy policy text in Admin → Legal.

Service-worker and hosting caches must not cache `/functions/v1/*`, analytics or auth endpoints (the
shipped service worker never does).

## Domains

The site can stay on the host's free subdomain, or a custom domain can be connected later — nothing in
the code depends on the domain. When the domain changes, update `VITE_SITE_URL` (rebuild) and the
Supabase Site URL / Redirect URLs.

## Moving hosts

Rebuild with the same env and upload `dist/` to the new host. There is no server-side code in the
frontend, so switching hosts is a copy operation.

## Pre-launch checks

Follow [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) (15 ordered steps, owner checklist, smoke test) and
[`QA_CHECKLIST.md`](QA_CHECKLIST.md). Rollback: [`ROLLBACK.md`](ROLLBACK.md).
