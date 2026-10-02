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

## Domains

The site can stay on the host's free subdomain, or a custom domain can be connected later — nothing in
the code depends on the domain. When the domain changes, update `VITE_SITE_URL` (rebuild) and the
Supabase Site URL / Redirect URLs.

## Moving hosts

Rebuild with the same env and upload `dist/` to the new host. There is no server-side code in the
frontend, so switching hosts is a copy operation.

## Pre-launch checks

See [`QA_CHECKLIST.md`](QA_CHECKLIST.md) and the launch checklist in `PHASE_STATUS.md` (Phase 10).
