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

| File                                       | Purpose                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `index.html` + `assets/`                   | the app (hashed, immutable assets)                                                   |
| `404.html`                                 | copy of `index.html` — SPA fallback for hosts that serve `404.html` on unknown paths |
| `_redirects`                               | `/* /index.html 200` — SPA rewrite for hosts that read Netlify-style rules           |
| `manifest.webmanifest`, `icons/`, `brand/` | PWA manifest, favicons, logo assets                                                  |
| `robots.txt`                               | baseline crawler rules (admin/account disallowed)                                    |

## SPA routing (deep links such as `/en/store` or `/admin/orders`)

The router needs every unknown path to serve `index.html`:

| Host                                  | What to do                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ShipStatic**                        | Upload the **contents** of `dist/`. Both `_redirects` and `404.html` are included; after the first deploy open a deep link (e.g. `/en/trade-in`) directly and reload. If it does not load, enable ShipStatic's SPA/fallback option per its current docs. (Its docs were not reachable from the build environment, so this was not verified.) |
| Netlify / Cloudflare Pages            | `_redirects` is picked up automatically.                                                                                                                                                                                                                                                                                                     |
| Cloudflare Workers static assets      | set `not_found_handling = "single-page-application"`.                                                                                                                                                                                                                                                                                        |
| Vercel                                | add `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`                                                                                                                                                                                                                                                   |
| GitHub Pages / hosts without rewrites | `404.html` boots the app (note: the HTTP status is 404, which is fine for users but not ideal for SEO — prefer a host with rewrites for production).                                                                                                                                                                                         |
| Nginx                                 | `location / { try_files $uri $uri/ /index.html; }`                                                                                                                                                                                                                                                                                           |
| Apache                                | `FallbackResource /index.html`                                                                                                                                                                                                                                                                                                               |

Recommended cache headers (where the host allows): `assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
`index.html` → `no-cache`.

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
