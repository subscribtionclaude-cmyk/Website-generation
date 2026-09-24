# MALEK STORE — Phase Status

| Phase | Name                         | Status                   |
| ----- | ---------------------------- | ------------------------ |
| 01    | Foundation                   | ✅ COMPLETE (2026-09-24) |
| 02    | Storefront                   | ⚪ NOT STARTED — next    |
| 03    | Commerce                     | ⚪ NOT STARTED           |
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

## Phase 02 — Storefront (next)

Home (CMS-driven modular sections incl. iPhone 18 Pro / Pro Max hero + iPhone Duo teaser as editable demo
campaign content), Apple landing (+ editable Apple Authorized Reseller trust signal), Store, dynamic categories
& brands, Postgres full-text search, filters, search by budget, product cards, product page with variants
(per-variant price/stock/SKU/media/warranty), demo catalog (flagged `is_demo`), New Releases, Coming Soon,
Offers, News, Contact page.

## Phase 03 — Commerce

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
