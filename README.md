# MALEK STORE — Retail & Operations Platform

Bilingual (Arabic RTL default / English LTR) ecommerce and operations platform for **MALEK STORE**:
customer storefront, admin control center, visual site editor, catalog, orders, repairs, trade-in,
used-device requests, content, analytics and integrations.

> **Build status:** Phase 03 (Commerce) complete — see [`PHASE_STATUS.md`](PHASE_STATUS.md).
> Service flows (05) and admin modules for later phases are routed and clearly marked as scheduled;
> they are not faked.

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

A striped **"Demo mode"** banner is always visible in demo mode. Demo data is never used in live mode.

## 2. Scripts

| Command                                | What it does                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                          | Vite dev server                                                                                                                                                                                                                                                                                                                                |
| `npm run build`                        | Type-check + production build to `dist/` (also writes `dist/404.html` SPA fallback)                                                                                                                                                                                                                                                            |
| `npm run preview`                      | Serve the production build locally (port 4173)                                                                                                                                                                                                                                                                                                 |
| `npm run typecheck`                    | TypeScript project build (strict)                                                                                                                                                                                                                                                                                                              |
| `npm run lint`                         | ESLint (typescript-eslint strict, react-hooks, jsx-a11y) — zero warnings allowed                                                                                                                                                                                                                                                               |
| `npm run format` / `format:check`      | Prettier                                                                                                                                                                                                                                                                                                                                       |
| `npm test`                             | Vitest unit + integration tests (jsdom)                                                                                                                                                                                                                                                                                                        |
| `npm run test:db`                      | Applies all migrations + seeds to a throwaway local PostgreSQL (then re-applies them), runs the SQL test suites (RLS, RBAC, settings, storage, audit, catalog/search parity, request intake, commerce) and parallel-session concurrency checks (last unit, double submit). Needs PostgreSQL 15+ server binaries; no Supabase account or Docker |
| `npm run test:e2e`                     | Playwright tests on mobile, tablet, desktop and large desktop: every storefront page, key interactions, cart → checkout → order journeys (Arabic + English), admin orders, invoice print, overflow checks and axe-core WCAG 2.1 A/AA scans (builds + previews the app)                                                                         |
| `npm run seed:generate` / `seed:check` | Regenerate / verify the demo catalog (`seed/data/demo/catalog.json`, `public/demo/media`) and `supabase/seed/*.sql` from the seed sources                                                                                                                                                                                                      |
| `npm run brand:icons`                  | Regenerate favicons/app icons/optimized marks from `public/brand/malek-store-logo.png`                                                                                                                                                                                                                                                         |
| `npm run check`                        | typecheck + lint + format + seed check + unit tests + build                                                                                                                                                                                                                                                                                    |

## 3. Environment variables

Copy `.env.example` → `.env.local`. **Everything prefixed `VITE_` ends up in the public JS bundle.**

| Variable                 | Required | Notes                                                                                                                                                                                       |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DATA_MODE`         | no       | `demo` or `live`. Empty → `live` if Supabase vars are set, otherwise `demo`. `live` without Supabase config shows a configuration error screen — it never silently falls back to demo data. |
| `VITE_SUPABASE_URL`      | live     | `https://<project>.supabase.co`                                                                                                                                                             |
| `VITE_SUPABASE_ANON_KEY` | live     | The **public** anon key or `sb_publishable_…` key. The app refuses to start if a service-role/secret key is supplied.                                                                       |
| `VITE_SITE_URL`          | no       | Public origin for canonical URLs and auth email redirects. Defaults to the current origin.                                                                                                  |

Never put a service-role key, database password or any secret in the frontend or in git.

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
5. **Commerce settings** (published site settings — editing UI arrives in Phase 06; until then use
   `save_setting_draft` + `publish_setting` or the base seed JSON):
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
6. **Frontend env**: set `VITE_DATA_MODE=live`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_SITE_URL`, then build and deploy.
7. **Create the first Owner** — see below.

## 5. First Owner (admin bootstrap)

There are **no default admin credentials**. Full details: [`docs/ADMIN_BOOTSTRAP.md`](docs/ADMIN_BOOTSTRAP.md).

1. The owner signs in once on the live site (`/admin/sign-in`, email code). This creates their account
   with no staff role.
2. In the Supabase **SQL Editor** (runs as the database owner — not reachable from the API):

   ```sql
   select app_private.bootstrap_first_owner('owner@example.com');
   ```

3. Reload `/admin`. The function refuses to run once any Owner exists, so it cannot be used for
   privilege escalation later. Further staff roles are assigned by the Owner (role-management UI
   arrives in Phase 06; the audited `assign_role` RPC already exists).

## 6. Project structure

```
src/
  app/            App bootstrap, providers, router, error boundaries, config-error screen
  config/         Validated environment config + data-mode resolution
  runtime/        Adapter wiring per data mode (demoRuntime / liveRuntime, lazy-loaded)
  services/       Supabase client + auth services (Supabase email OTP, demo)
  repositories/   Repository ports (types.ts) + demo and Supabase adapters (zod-validated)
  domain/         Pure business models: localized text, settings, access, catalog engine, content/sections,
                  commerce (money, pricing, cart, status, review, WhatsApp text, invoice template, demo engine)
  features/       Cross-cutting features: auth, settings, theme, SEO meta, store info, WhatsApp, demo banner, cart
  i18n/           Locales, typed dictionaries (ar/en), translator, locale-aware paths
  lib/            Money (EGP), Cairo time & opening hours, phone, WhatsApp links, storage, colour
  components/     Shared UI (buttons, feedback states, drawer, fields, brand logo, navigation)
  storefront/     Public layout, pages, section registry, catalog/product + commerce UI and routes (/, /en/…)
  admin/          Admin area (lazy chunk): layout, module registry, pages, dictionaries
  styles/         Design tokens (CSS variables), base styles, fonts
supabase/
  migrations/     Ordered SQL migrations (RLS, RBAC, audit, settings, demo registry, storage, catalog, content, storefront RPCs, commerce)
  seed/           base.sql (real config) + demo.sql (demo only), generated from seed/data/*.json
  tests/          Local-only Supabase shim + SQL test suites + concurrency scripts (npm run test:db)
public/brand/     Source-of-truth logo + optimized derivatives; public/icons: favicons & PWA icons
public/demo/      Generated demo device illustrations (demo mode only)
docs/             Architecture, database, bootstrap, deployment, QA checklist
e2e/              Playwright + axe tests (smoke, storefront pages/interactions, commerce journeys)
```

## 7. Deployment

`npm run build` produces a static `dist/` that runs on any static host (ShipStatic, Netlify,
Cloudflare Pages, GitHub Pages, S3/CloudFront, Nginx…). SPA deep links work through
`dist/_redirects` or the `dist/404.html` fallback. Custom domain is optional.
Details and host-specific notes: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## 8. Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — technical architecture and decisions
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema conventions, RLS model, RPCs, migration workflow
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — QA checklist with pass/fail state
- [`PHASE_STATUS.md`](PHASE_STATUS.md) — phase plan and progress
