# MALEK STORE — Phase Status

| Phase | Name                         | Status                   |
| ----- | ---------------------------- | ------------------------ |
| 01    | Foundation                   | ✅ COMPLETE (2026-09-24) |
| 02    | Storefront                   | ✅ COMPLETE (2026-09-24) |
| 03    | Commerce                     | ⚪ NOT STARTED — next    |
| 04    | Customer Features            | ⚪ NOT STARTED           |
| 05    | Service Experiences          | ⚪ NOT STARTED           |
| 06    | Admin Control Center         | ⚪ NOT STARTED           |
| 07    | Visual Site Editor           | ⚪ NOT STARTED           |
| 08    | Content / SEO / PWA / Polish | ⚪ NOT STARTED           |
| 09    | Integrations Layer           | ⚪ NOT STARTED           |
| 10    | QA / Staging / Launch        | ⚪ NOT STARTED           |

---

## Phase 01 — Foundation ✅

### Delivered

- [x] React 19 + TypeScript (strict) + Vite 8 project, ESLint (strict + react-hooks + jsx-a11y), Prettier
- [x] Layered structure: domain · lib · repositories (ports + demo/Supabase adapters) · services · runtime · features · components · storefront · admin
- [x] Routing: Arabic at `/`, English at `/en`, lazy page chunks; admin under `/admin` as a separate lazy chunk
- [x] Bilingual infrastructure: typed ar/en dictionaries with parity tests, Arabic fallback, bidi isolation helper, per-user admin language
- [x] RTL/LTR: `<html lang/dir>` per area, logical CSS properties, mirrored directional icons
- [x] EGP formatting (Latin or Arabic-Indic digits) and Africa/Cairo time helpers (DST-aware, opening hours across midnight)
- [x] Brand tokens (primitives → semantic, WCAG-tested), IBM Plex Sans Arabic + Manrope self-hosted, typography/spacing/motion scales, reduced motion
- [x] Logo integrated unmodified (`public/brand/malek-store-logo.png`) + generated marks, favicons, PWA icons, OG image
- [x] Public shell: header, desktop nav, mobile drawer menu, mobile tab bar, footer, skip link, demo banner, WhatsApp button (never a broken link), open-now status
- [x] Admin shell: sign-in (email code; demo role preview), staff gate, permission-filtered sidebar, module registry with phase labels, dashboard (data mode, backend, access, setup checklist, branch), read-only store details, read-only role × permission matrix
- [x] Supabase client abstraction (PKCE), email OTP / magic-link auth service, repository adapters with zod validation
- [x] Environment config (`.env.example`), explicit demo/live data mode, secret-key guard, configuration error screen
- [x] SQL migrations: foundation, audit log, identity & RBAC, site settings (draft/publish/versions/rollback), demo-data registry, storage buckets & policies
- [x] Roles/permissions foundation (8 roles, 43 permissions) with anti-escalation RPCs; first-owner bootstrap (`docs/ADMIN_BOOTSTRAP.md`)
- [x] Site settings foundation + localized content foundation (`localized_text` domain, zod schemas, bundled base settings)
- [x] Seed/demo architecture: generated `base.sql` (real config) and `demo.sql` (demo only), `is_demo` registry and deletion RPC
- [x] Error & empty states: 404, error boundaries, backend-unavailable notice, config/boot failure screens, access denied, honest "scheduled" placeholders
- [x] Docs: README, ARCHITECTURE, DATABASE, ADMIN_BOOTSTRAP, DEPLOYMENT, QA_CHECKLIST; CI workflow

### Validation

| Check                                                                         | Result                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                                                           | ✅ 0 errors                                                                  |
| `npm run lint`                                                                | ✅ 0 errors, 0 warnings                                                      |
| `npm run format:check`                                                        | ✅                                                                           |
| `npm run seed:check`                                                          | ✅ generated SQL up to date                                                  |
| `npm test` (Vitest)                                                           | ✅ 88 / 88 tests, 10 files                                                   |
| `npm run test:db` (PostgreSQL 16)                                             | ✅ migrations + idempotent re-run, contract checks, 111 / 111 SQL assertions |
| `npm run test:e2e` (Playwright, mobile + tablet + desktop, axe WCAG 2.1 A/AA) | ✅ 17 passed, 1 skipped (mobile-menu test not applicable on desktop)         |
| `npm run build`                                                               | ✅ `dist/` with `404.html` + `_redirects` SPA fallback                       |

### Known limits / not blocking

- Migrations were validated on local PostgreSQL 16 with a Supabase compatibility shim; they have not
  yet been applied to a hosted Supabase project (needs the owner's project — see README §4).
- ShipStatic's SPA-fallback behaviour could not be verified from the build environment (its site is not
  reachable here); `dist/` ships both `_redirects` and `404.html` — verify a deep link after first deploy.
- The UI brand orange follows the owner-specified `#F65311`; the logo artwork measures ≈ `#FD4E00`
  (editable via the `theme` setting / Design Studio).
- No WhatsApp number, social links, map link or InstaPay details were supplied, so none are assumed;
  the admin setup checklist lists them as pending.

---

## Phase 02 — Storefront ✅

### Delivered

- [x] **CMS-driven modular home** — ordered `page_sections` rendered through a typed section registry
      (13 section types, zod-validated props, invalid rows skipped): Hero campaign → New releases →
      Limited offers → Shop by category → Apple spotlight → Best sellers → Search by budget → Trade-In
      promo → Repairs promo → Coming soon → News → Trust strip → Branch/contact. Phase 07 edits the same rows.
- [x] **Hero campaign** iPhone 18 Pro / Pro Max + iPhone Duo teaser from content entries (demo, editable);
      restrained motion, off for reduced motion and constrained devices (adaptive `data-motion`); brand fallback.
- [x] **Apple landing** (`/apple`): hero, iPhone/Mac/iPad/Watch/AirPods/Accessories lines, latest releases,
      Apple offers, Apple trade-in, settings-driven hideable "Apple Authorized Reseller" statement.
- [x] **Listings**: `/store`, `/category/:slug`, `/brand/:slug`, `/search`, `/budget` — hybrid premium cards + practical grid, dynamic categories & brands, URL-synced filters (brand, category, price, storage,
      colour, availability, offers, new), sorting (featured, newest, price ↑/↓, best selling — demo ranking
      kept separate from analytics), removable chips, facets, load-more, skeleton/empty/error states,
      desktop sticky sidebar + mobile filter drawer.
- [x] **Search**: free Postgres search (trigram + Arabic normalisation + transliteration keywords) with an
      identical in-memory engine for demo mode (parity proven by mirrored TS/SQL tests).
- [x] **Search by budget** ("ميزانيتي من X إلى Y"): presets from settings + validated min/max (Arabic-Indic digits).
- [x] **Product page**: variant-aware gallery (images + video with captions contract), accessible storage/colour
      radios synced to the URL, per-variant price / compare-at / SKU / stock state / media / warranty,
      spec groups (approved only), demo price/spec notes, related rails, breadcrumbs.
- [x] **Out of stock / upcoming**: "Out of stock" + Notify Me; coming soon / waitlist only / pre-order →
      waitlist; price "to be announced". Validated, duplicate-safe intake RPCs (follow-up in Phases 04/06).
- [x] Add to cart / Buy now shown **disabled with an honest note** (Phase 03); call + context-aware WhatsApp
      (product, storage, colour, SKU, price) as working paths; wishlist/compare card-action interface.
- [x] **Offers** (`/offers`, `/offers/:slug`): flash, price drops, bundles, free gift, promo codes, limited-time,
      Apple, accessories groups with jump links; countdowns derived from timestamps; promo code copy.
- [x] **New** (`/new`), **Coming soon** (`/coming-soon`), **News** (`/news?type=`, `/news/:slug`) with related
      products, publish/expiry windows, featured flag, localized text and SEO fields.
- [x] **Contact** page from settings only (no invented social/map URLs; staff/demo setup panel).
- [x] Trust items, budget presets and page size are settings (`trust`, `catalog` keys).
- [x] Header search (desktop field, mobile search icon → `/search`).
- [x] SEO: titles, descriptions, canonical (never with query), hreflang, OG type/url/image, Product JSON-LD
      (live, non-demo only), BreadcrumbList, Article; noindex for filtered/search/budget/not-found and any
      demo deployment. SPA limits documented (`docs/ARCHITECTURE.md` §9).
- [x] Migrations: catalog, content, storefront RPCs — RLS on every table, no direct anon access, indexes,
      demo registry, localized content without duplicated records, stock quantities never exposed.
- [x] Demo data (all `is_demo`): 7 brands, 10 categories, 28 products, 116 variants, 7 offers (incl. AirPods
      limited offer, AirPods + Apple Watch bundle, DEMO10 10% code), 7 content entries, 76 generated SVG
      device illustrations. iPhone 18 Pro / Pro Max / Duo specs are "to be confirmed" only.

### Validation

| Check                                                                                    | Result                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                      | ✅ 0 errors                                                                                    |
| `npm run lint`                                                                           | ✅ 0 errors, 0 warnings                                                                        |
| `npm run format:check`                                                                   | ✅                                                                                             |
| `npm run seed:check`                                                                     | ✅ demo catalog, media and seed SQL up to date                                                 |
| `npm test` (Vitest)                                                                      | ✅ 137 / 137 tests, 14 files                                                                   |
| `npm run test:db` (PostgreSQL 16)                                                        | ✅ migrations + idempotent re-run, contracts, 204 / 204 SQL assertions                         |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | ✅ 126 passed, 6 skipped (viewport-specific tests)                                             |
| `npm run build`                                                                          | ✅ storefront entry ≈ 105 KB gz; pages lazy; no admin chunk on storefront                      |
| Visual review (Arabic + English, 390 / 1440 px screenshots)                              | ✅ issues found and fixed (bidi of mixed titles, RTL countdown, product meta layout, contrast) |

### Known limits / not blocking

- Not yet run against a hosted Supabase project (needs the owner's project); RPCs and adapters are
  validated locally with PostgreSQL 16 + the Supabase shim, and the Supabase adapter parses every RPC with zod.
- Product imagery is generated demo illustrations, not photos; real media arrives with admin uploads (Phase 06).
- Notify-me / waitlist requests are stored but nobody is notified yet (Phase 04 notifications, Phase 06 queue).
- Promo codes are displayed only; they apply at checkout (Phase 03).
- Structured data and meta are client-rendered (SPA); prerendering + sitemap are Phase 08.
- The Phase 02 migrations were edited during Phase 02 (not yet applied to any real project); from now on
  changes go into new migration files.

## Phase 03 — Commerce (next)

Cart (guest, local) + account merge, verified checkout (phone required), orders, receipt + printable invoice,
COD, InstaPay (manual funds verification), split payment, optional pay-at-store, 30-minute soft reservation
(`reservation_expires_at`), manual shipping fee, store pickup, WhatsApp handoff after order creation,
manual-review rules.

## Phase 04 — Customer Features

Account area, wishlist (local → merge), recently viewed, compare, verified-buyer reviews, notify me,
waitlist, notifications framework (manual/automatic), abandoned cart, recommendations.

## Phase 05 — Service Experiences

Trade-In, used-device requests, repairs with category-based 3D diagnostics (Three.js / R3F, lazy-loaded),
media uploads (compression, limits), after-sales, related admin workflows.

## Phase 06 — Admin Control Center

Products, categories, brands, variants, prices + price history, stock + movement history, orders, customers,
repairs, trade-in, used requests, reviews, offers/promo codes/loyalty, news, waitlists, shipping, receipt
templates, legal pages, **store details & site settings editing**, analytics, import/export, roles, users &
permissions management, audit log viewer.

## Phase 07 — Visual Site Editor

Section registry, modular pages, drag & drop, add/remove/hide/duplicate, content & design controls,
responsive previews, draft → preview → publish, undo/redo, version history, rollback.

## Phase 08 — Content / SEO / PWA / Polish

SEO controls, JSON-LD, sitemap, prerendering of public pages, PWA service worker (no caching of private
data), performance settings, accessibility pass, motion & campaign polish, first-run setup wizard
(incl. demo keep/replace/delete).

## Phase 09 — Integrations Layer

Adapter contracts + settings UI (all optional, disabled by default): Odoo, POS, WhatsApp Business, SMS,
email, Google Analytics, courier, AI provider, external storage, search, backups, social auth.

## Phase 10 — QA / Staging / Launch

Full QA, security & RLS review, performance & accessibility review, demo cleanup, backups, deployment
docs, ShipStatic/generic static build, launch checklist, release notes.
