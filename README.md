# MALEK STORE — Retail & Operations Platform

Bilingual (Arabic RTL default / English LTR) ecommerce and operations platform for **MALEK STORE**:
customer storefront, admin control center, visual site editor, catalog, orders, repairs, trade-in,
used-device requests, content, analytics and integrations.

> **Release:** `v1.0.0-rc.1` — all ten phases built; launch readiness: **ready after owner actions**
> (see [`docs/LAUNCH_READINESS.md`](docs/LAUNCH_READINESS.md)). Launch steps:
> [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md). Progress: [`PHASE_STATUS.md`](PHASE_STATUS.md),
> changes: [`CHANGELOG.md`](CHANGELOG.md).

**Stack:** React 19 · TypeScript (strict) · Vite 8 · React Router 8 · TanStack Query · Zod ·
Supabase (Postgres, Auth, Storage) · self-hosted IBM Plex Sans Arabic + Manrope · Vitest ·
Playwright + axe-core.
**Free-first:** no paid service is needed to run, develop or launch the platform.

---

## 1. Quick start (demo mode — no backend needed)

Requirements: **Node.js ≥ 22.22** (React Router 8 minimum) and npm.

```bash
npm install
cp .env.example .env.local        # VITE_DATA_MODE=demo by default
npm run dev                       # http://localhost:5173
```

- Storefront (Arabic): `http://localhost:5173/` · English: `http://localhost:5173/en`
- Admin: `http://localhost:5173/admin` → in demo mode pick a role (Owner, Sales, …) to preview the
  dashboard with exactly that role's permissions.
- Customer sign-in (demo): any email + any 6-digit code. No email is sent.
- Commerce (demo): add products to the cart without an account, check out (sign-in is asked for only
  at checkout), try delivery or pickup, COD / InstaPay / split payment and the demo promo code
  **DEMO10** (10% off accessories). Orders are numbered `MS-2026-000001…`, badged "Demo" and kept in
  this browser only. Then preview the admin as Owner → **Orders** to set the shipping fee, confirm
  (stock is committed once) and record verified payments. Nothing is charged, sent or delivered.

- Services (demo): `/services` → start a repair (3D / 2D diagnostic), trade-in, used-device or
  after-sales request, track it under **Account → Requests**, then preview the admin as Owner →
  **Repairs / Trade-In / Used requests / After-sales** to send quotes, valuations and proposals.
  Uploaded photos stay in this browser. No price or valuation is ever calculated automatically.

- Admin control center (demo): as Owner, manage products, variants, prices (with history), stock
  (with movements), categories, brands, offers and promo codes, news, Home / Apple / Offers content,
  customers (private notes), service queues (SLA aging), settings (draft → publish → rollback),
  receipts, legal pages, analytics, CSV import / export, backups, demo data, roles, staff and the
  audit log. Try other roles to see what each may do. **Demo data → Reset the preview** starts over.

- Visual site editor (demo): as Owner or Design editor open **Admin → Site editor**. Reorder, add,
  duplicate, hide or remove sections of the Home, Apple and Offers pages (drag and drop, move buttons
  or the keyboard), edit each section's content and design, change the theme, menus, footer and SEO,
  and watch the **real storefront** update in the preview (mobile / tablet / desktop, Arabic /
  English). Save a draft (the storefront does not change), publish, compare versions and roll back;
  undo / redo with Ctrl+Z. **Preview sample store** shows the same design on the demo catalog,
  marked DEMO CONTENT.

A striped **"Demo mode"** banner is always visible in demo mode. Demo data is never used in live mode.

## 2. Scripts

| Command                                | What it does                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                          | Vite dev server                                                                                                                                                                                                                                                                                                                                          |
| `npm run build`                        | Type-check + production build to `dist/`, then `scripts/generate-site.mjs`: prerendered Arabic / English public pages, `sitemap.xml`, `robots.txt` and the service worker (`sw.js`). Demo builds are never indexable; live builds read the public catalog with the anon key                                                                              |
| `npm run preview`                      | Serve the production build locally (port 4173)                                                                                                                                                                                                                                                                                                           |
| `npm run typecheck`                    | TypeScript project build (strict)                                                                                                                                                                                                                                                                                                                        |
| `npm run lint`                         | ESLint (typescript-eslint strict, react-hooks, jsx-a11y) — zero warnings allowed                                                                                                                                                                                                                                                                         |
| `npm run format` / `format:check`      | Prettier                                                                                                                                                                                                                                                                                                                                                 |
| `npm test`                             | Vitest unit + integration tests (jsdom)                                                                                                                                                                                                                                                                                                                  |
| `npm run test:db`                      | Applies all migrations + seeds to a throwaway local PostgreSQL (then re-applies them), runs the SQL test suites (RLS, RBAC, settings, storage, audit, catalog/search parity, request intake, commerce) and parallel-session concurrency checks (last unit, double submit). Needs PostgreSQL 15+ server binaries; no Supabase account or Docker           |
| `npm run test:e2e`                     | Playwright tests on mobile, tablet, desktop and large desktop: every storefront page, key interactions, cart → checkout → order journeys (Arabic + English), admin, Site Editor, SEO (prerendered pages, metadata, sitemap, robots), PWA (install, offline, cache boundaries), CLS / LCP, overflow checks and axe-core scans (builds + previews the app) |
| `npm run seed:generate` / `seed:check` | Regenerate / verify the demo catalog (`seed/data/demo/catalog.json`, `public/demo/media`) and `supabase/seed/*.sql` from the seed sources                                                                                                                                                                                                                |
| `npm run brand:icons`                  | Regenerate favicons/app icons/optimized marks from `public/brand/malek-store-logo.png`                                                                                                                                                                                                                                                                   |
| `npm run check:bundle`                 | Bundle budget: storefront entry ≤ 400 kB, initial JavaScript (entry + modulepreloads) ≤ 650 kB, three.js only in the lazy repair-diagnostic chunk                                                                                                                                                                                                        |
| `npm run check:links`                  | Every internal link and asset on the prerendered pages resolves to a built file or an app route                                                                                                                                                                                                                                                          |
| `npm run check:secrets`                | Secret guard: no secret-looking `VITE_*` variable, no credential patterns or server-only values in `dist/`, no credentials in tracked files                                                                                                                                                                                                              |
| `npm run check`                        | typecheck + lint + format + seed check + unit tests + build + bundle budget + secret guard + link check                                                                                                                                                                                                                                                  |

## 3. Environment variables

Copy `.env.example` → `.env.local`. **Everything prefixed `VITE_` ends up in the public JS bundle.**

| Variable                 | Required | Notes                                                                                                                                                                                       |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DATA_MODE`         | no       | `demo` or `live`. Empty → `live` if Supabase vars are set, otherwise `demo`. `live` without Supabase config shows a configuration error screen — it never silently falls back to demo data. |
| `VITE_SUPABASE_URL`      | live     | `https://<project>.supabase.co`                                                                                                                                                             |
| `VITE_SUPABASE_ANON_KEY` | live     | The **public** anon key or `sb_publishable_…` key. The app refuses to start if a service-role/secret key is supplied.                                                                       |
| `VITE_SITE_URL`          | live SEO | Public https origin for canonical URLs, the sitemap and auth email redirects. Without it the app uses the current origin and a live build is **not indexable** (no sitemap).                |

Never put a service-role key, database password or any secret in the frontend or in git.
`vite build` stops when a `VITE_*` variable looks like a secret, and `npm run check:secrets` scans the
built files and the repository.

**Optional integrations (Phase 09)** — WhatsApp, SMS, email, Odoo, POS, courier, AI, search,
storage, backup, Google Analytics and Google / Apple sign-in are all **off by default** and configured
in **Admin → Integrations & services**. Their secrets are **server-side only** (Supabase Edge Function
secrets, e.g. `supabase secrets set WHATSAPP_ACCESS_TOKEN=…`); the admin lists the variable names.
See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#optional-integrations-phase-09) and
`docs/ARCHITECTURE.md` §18. The store needs none of them.

## 4. Going live with Supabase (free tier)

1. **Create a project** at supabase.com (free plan is enough).
2. **Apply the migrations** in `supabase/migrations/` (in filename order):
   - With the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, **or**
   - Paste each file into _SQL Editor_ in order.
3. **Seed the base configuration** (real store details, navigation, SEO defaults — not demo data):
   run `supabase/seed/base.sql` in the SQL editor. It never overwrites values already published.
   It also seeds the base page layouts (home, Apple, offers). `supabase/seed/demo.sql` is for demo
   previews only (demo catalog, offers, news — all `is_demo`); don't run it on a real store, or
   remove it later with `select public.delete_all_demo_data();`.
4. **Auth settings** (_Authentication → Providers / URL Configuration_):
   - Enable the **Email** provider (email OTP / magic link — free).
   - _Site URL_ = your public URL; add `https://<your-domain>/**` (and `http://localhost:5173/**`
     for development) to _Redirect URLs_.
   - To let customers type a **6-digit code** instead of only clicking the link, edit the
     _Magic Link_ email template to include `{{ .Token }}`.
   - The built-in email sender is rate-limited; for production volume configure your own SMTP
     (optional; many providers have free tiers).
5. **Commerce settings** (edit them in **Admin → Settings**: save a draft, review, publish; every
   version can be compared and restored):
   - `store.whatsappNumber` — the store's real WhatsApp number (the order hand-off shows an honest
     "not available" notice while it is empty; nothing is invented).
   - `commerce.instapay` — your real InstaPay address, account name and instructions (while empty,
     checkout says the team sends transfer details on WhatsApp). `commerce.paymentMethods`,
     `reservationMinutes` (30), `maxQuantityPerLine`, `maxOpenOrdersPerCustomer`.
   - `order_review` (private) — manual-review thresholds; the shipped values are conservative
     demo defaults, tune them to the store.
   - `features.promoCodes` — off by default in the real base settings. V1 payment methods are exactly
     COD, InstaPay and split payment (there is no pay-at-store method).
   - Staff who verify money need `payments.verify`; with `security.adminMfaRequired` on they must
     use an MFA session.
6. **Customer-feature settings** (Phase 04): `engagement` (public — wishlist cap and price-drop %,
   recently viewed cap, compare max, review eligibility statuses / photos, request expiry,
   recommendation privacy threshold), `abandoned_cart` (private — enabled, `thresholdHours` 48,
   `followUp: in_app | off`) and `notifications` (private — email / WhatsApp / SMS channels are
   disabled; only in-app notifications are sent, no paid provider is needed). Review photos go to
   the private `reviews` Storage bucket (created by the migrations) and become readable only after
   approval.
7. **Frontend env**: set `VITE_DATA_MODE=live`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_SITE_URL`, then build and deploy.
8. **Create the first Owner** — see below.

## 5. First Owner (admin bootstrap)

There are **no default admin credentials**. Full details: [`docs/ADMIN_BOOTSTRAP.md`](docs/ADMIN_BOOTSTRAP.md).

1. The owner signs in once on the live site (`/admin/sign-in`, email code). This creates their account
   with no staff role.
2. In the Supabase **SQL Editor** (runs as the database owner — not reachable from the API):

   ```sql
   select app_private.bootstrap_first_owner('owner@example.com');
   ```

3. Reload `/admin`. The function refuses to run once any Owner exists, so it cannot be used for
   privilege escalation later. Further staff sign in once with their own account, then the Owner
   grants them a role in **Admin → Staff** (no passwords are created; roles above your own level and
   permissions you do not hold can never be granted).

## 5a. Admin data tools

- **Import**: Admin → Import & export → upload a CSV (Excel "Save as CSV UTF-8"), map columns,
  review the server-validated preview, then apply all rows or only the valid ones. Cells are data
  only: formulas are never executed and formula-looking text is rejected.
- **Export**: CSV (cells starting with `=`, `+`, `-`, `@` are neutralised) or JSON.
- **Backup**: a JSON copy of settings, catalog and content. It is a convenience copy — keep your
  database provider's backups (e.g. Supabase daily backups / PITR) enabled; restores happen there.
- **Demo data**: delete removes rows flagged `is_demo` only; live data is never touched. To replace
  demo data on a staging project, delete it and load `supabase/seed/demo.sql` again.
- **First-run setup** (Admin → Store setup, `/admin/setup`): store details, branding, the demo-content
  decision (keep / replace / delete) and a final review; publishes through the normal settings
  workflow and is recorded in the audit log. The dashboard reminds owners until it is finished.
- **SEO** (Admin → Search engines, `/admin/seo`): indexing status, sitemap / robots links, per-page
  SEO preview and pages missing a description. Edit SEO in Settings → Search engines and in the Site
  Editor.

## 6. Project structure

```
src/
  app/            App bootstrap, providers, router, error boundaries, config-error screen
  config/         Validated environment config + data-mode resolution
  runtime/        Adapter wiring per data mode (demoRuntime / liveRuntime, lazy-loaded)
  services/       Supabase client + auth services (Supabase email OTP, demo)
  repositories/   Repository ports (types.ts) + demo and Supabase adapters (zod-validated)
  domain/         Pure business models: localized text, settings, access, catalog engine, content/sections,
                  commerce (money, pricing, cart, status, review, WhatsApp text, invoice template, demo engine),
                  customer features, services (statuses, validation, media rules, demo engine)
  features/       Cross-cutting features: auth, settings, theme, SEO meta, store info, WhatsApp, demo banner, cart
  build/          Build-time site generator (prerendered pages, sitemap, robots) — runs after vite build
  pwa/            Service worker, cache rules, install prompt
  i18n/           Locales, typed dictionaries (ar/en), translator, locale-aware paths
  lib/            Money (EGP), Cairo time & opening hours, phone, WhatsApp links, storage, colour
  components/     Shared UI (buttons, feedback states, drawer, fields, brand logo, navigation)
  storefront/     Public layout, pages, section registry, catalog/product + commerce UI, account,
                  services (request flows, 3D / 2D diagnostic, media uploader) and routes (/, /en/…)
  admin/          Admin area (lazy chunk): layout, module registry, pages, dictionaries
  styles/         Design tokens (CSS variables), base styles, fonts
supabase/
  migrations/     Ordered SQL migrations (RLS, RBAC, audit, settings, demo registry, storage, catalog, content, storefront RPCs, commerce, customer, services)
  seed/           base.sql (real config) + demo.sql (demo only), generated from seed/data/*.json
  tests/          Local-only Supabase shim + SQL test suites + concurrency scripts (npm run test:db)
public/brand/     Source-of-truth logo + optimized derivatives; public/icons: favicons & PWA icons
public/demo/      Generated demo device illustrations (demo mode only)
docs/             Architecture, database, bootstrap, deployment, QA checklist
e2e/              Playwright + axe tests (smoke, storefront, commerce, customer, services, admin, site editor, Phase 08 SEO / PWA)
```

## 7. Deployment

`npm run build` produces a static `dist/` that runs on any static host (ShipStatic, Netlify,
Cloudflare Pages, GitHub Pages, S3/CloudFront, Nginx…). Public pages are prerendered as
`dist/<path>.html`; every other route gets the SPA shell through `dist/_redirects` or the
`dist/404.html` fallback. Custom domain is optional.

SEO and PWA notes:

- Set `VITE_SITE_URL` and turn on Settings → Search engines → "Allow indexing" (off in the base seed
  until launch) to be indexed; rebuild after publishing content so crawlers without JavaScript (and
  `sitemap.xml`) see it.
- The service worker (`/sw.js`) caches public files and visited public pages only — never admin,
  account, orders, checkout, cart, payments, notifications or private uploads. Serve `sw.js` without
  long caching (`dist/_headers` does this on Netlify / Cloudflare Pages).
  Details and host-specific notes: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## 8. Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — technical architecture and decisions
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema conventions, RLS model, RPCs, migration workflow
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — QA checklist with pass/fail state
- [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md) — the 15 launch steps, owner checklist, environment matrix, smoke test
- [`docs/ROLLBACK.md`](docs/ROLLBACK.md) — undoing a release: settings, Site Editor, integrations, frontend, service worker, database
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — staff checklist, backups and restore, monitoring, free-tier limits, privacy, retention
- [`docs/SECURITY.md`](docs/SECURITY.md) — security review and accepted risks
- [`docs/LAUNCH_READINESS.md`](docs/LAUNCH_READINESS.md) — launch readiness report
- [`CHANGELOG.md`](CHANGELOG.md) · [`docs/RELEASE_NOTES_v1.0.0-rc.1.md`](docs/RELEASE_NOTES_v1.0.0-rc.1.md)
- [`PHASE_STATUS.md`](PHASE_STATUS.md) — phase plan and progress
