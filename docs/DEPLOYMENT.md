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
| `404.html`                                    | the plain SPA shell (the built `index.html` before prerendering) — served for every other route                                                                                                                      |
| `_redirects`                                  | `/* /404.html 200` — rewrite for hosts that read Netlify-style rules                                                                                                                                                 |
| `_headers`                                    | `sw.js` / `offline.html` revalidated, `assets/*` immutable (Netlify / Cloudflare Pages)                                                                                                                              |
| `sitemap.xml`, `robots.txt`                   | generated at build time from published, non-demo content (demo builds: `Disallow: /`, empty sitemap)                                                                                                                 |
| `sw.js`, `offline.html`                       | service worker (public files and visited public pages only) and its offline page                                                                                                                                     |
| `manifest.webmanifest`, `icons/`, `brand/`    | PWA manifest, favicons, logo assets                                                                                                                                                                                  |

## Routing (prerendered pages + SPA deep links)

A request for `/en/store` must serve `en/store.html` when it exists, and the SPA shell `404.html`
otherwise (e.g. `/admin/orders`, `/account`, a product published after the build). Do **not** rewrite
unknown paths to `index.html` — that is now the prerendered Arabic Home page.

| Host                                  | What to do                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ShipStatic**                        | Upload the **contents** of `dist/`. After the first deploy open `/en/store` (prerendered) and `/admin` (shell) directly and reload; if a deep link does not load, enable ShipStatic's SPA / fallback option with `404.html` per its current docs. (Its docs were not reachable from the build environment, so this was not verified.) |
| Netlify / Cloudflare Pages            | `.html` pages are served without the extension and `_redirects` sends the rest to `404.html` automatically.                                                                                                                                                                                                                           |
| Cloudflare Workers static assets      | `not_found_handling = "404-page"` (serves `404.html`, status 404, for unknown paths). Avoid `single-page-application`: it would serve the prerendered `index.html`.                                                                                                                                                                   |
| Vercel                                | `vercel.json`: `{ "cleanUrls": true, "rewrites": [{ "source": "/(.*)", "destination": "/404.html" }] }`                                                                                                                                                                                                                               |
| GitHub Pages / hosts without rewrites | `.html` pages are served without the extension; `404.html` boots the app for other paths (HTTP status 404 — fine for users; prerendered public pages return 200).                                                                                                                                                                     |
| Nginx                                 | `location / { try_files $uri $uri.html $uri/ /404.html; }`                                                                                                                                                                                                                                                                            |
| Apache                                | `RewriteEngine On` · `RewriteCond %{REQUEST_FILENAME}.html -f` · `RewriteRule ^(.*)$ $1.html [L]` · `FallbackResource /404.html`                                                                                                                                                                                                      |

Recommended cache headers (where the host allows): `assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
HTML, `sw.js`, `sitemap.xml`, `robots.txt` → `no-cache`.

## Search engines

- Demo builds are never indexable. A live build is indexable only with `VITE_SITE_URL` set (absolute
  https) **and** Settings → Search engines → "Allow indexing" published.
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

See [`QA_CHECKLIST.md`](QA_CHECKLIST.md) and the launch checklist in `PHASE_STATUS.md` (Phase 10).
