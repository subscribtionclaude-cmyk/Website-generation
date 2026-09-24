# Architecture

## 1. Shape of the system

```
                       ┌──────────────────────── Browser (static SPA, dist/) ─────────────────────────┐
                       │  Storefront (/, /en/…)           Admin (/admin/…, lazy chunk)                  │
                       │        │                                   │                                   │
                       │   features / pages  ──►  repositories (ports)  ◄──  auth service (port)        │
                       │                               │                         │                     │
                       │                  demo adapters │ Supabase adapters       │ demo │ Supabase Auth │
                       └───────────────────────────────┼─────────────────────────┼─────────────────────┘
                                                       ▼                         ▼
                                   Supabase (free tier): PostgreSQL + RLS · Auth · Storage
                                   (future) ERP/POS/Odoo/courier/WhatsApp adapters → sync into this DB
```

- **The Malek Store database is the operational source of truth.** External systems (Odoo, POS,
  couriers, messaging) will sync _into_ it through adapters (Phase 09); the site works fully without them.
- **Static frontend, portable backend.** The frontend is a plain Vite build for any static host.
  The backend is standard PostgreSQL; Supabase-specific surface is limited to `auth.users`,
  `auth.uid()`/JWT claims and `storage.*` (all isolated and documented).

## 2. Data modes (demo vs live)

`src/config/env.ts` resolves an explicit `dataMode`:

| Mode   | Adapters                                | Auth                                           | When                              |
| ------ | --------------------------------------- | ---------------------------------------------- | --------------------------------- |
| `demo` | `repositories/demo` (bundled seed JSON) | `DemoAuthService` (simulated, sessionStorage)  | previews, development, no backend |
| `live` | `repositories/supabase`                 | `SupabaseAuthService` (email OTP / magic link) | production                        |

- `live` without Supabase config is a hard error screen — **never** a silent fallback to demo data.
- A service-role/secret key in the bundle is detected and refused.
- `runtime/createRuntime.ts` lazy-loads **only** the adapter set of the active mode: demo previews
  never download the Supabase SDK (~56 KB gz), and live builds never execute demo adapters.
- Demo mode always shows a visible banner; demo admin previews can impersonate a system role to test
  permission-dependent UI.
- Database side: seedable business tables carry `is_demo` and register in `app.demo_tables`;
  `public.delete_all_demo_data()` removes only demo rows (Owner-level permission, audited).

## 3. Frontend layers

| Layer                   | Responsibility                                                                                 | Rules                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `domain/`               | Pure types, zod schemas, business rules (localized text, settings registry, access catalog)    | no React, no I/O                                                                      |
| `lib/`                  | Pure utilities (EGP money, Cairo time & opening hours, phone, WhatsApp links, storage, colour) | no React                                                                              |
| `repositories/`         | Ports (`types.ts`) + adapters. Every backend response is validated with zod at this boundary   | only this layer + `services/` may import `@supabase/supabase-js` (enforced by ESLint) |
| `services/`             | Auth + Supabase client                                                                         | public anon/publishable key only                                                      |
| `runtime/`              | Wires adapters for the data mode; exposed through `RuntimeContext`                             | created once at boot                                                                  |
| `features/`             | Cross-cutting React features (auth/access, settings, theme, SEO meta, store info, WhatsApp)    |                                                                                       |
| `components/`           | Reusable UI                                                                                    | design tokens only, logical CSS properties                                            |
| `storefront/`, `admin/` | Layouts, pages, route tables                                                                   | admin is a separate lazy chunk                                                        |

State: server state in TanStack Query (private query keys are always `[name, userId, …]` and are
dropped on user change); UI state is local. No global store.

## 4. Routing & languages

- Arabic (default, RTL) at `/…`, English (LTR) at `/en/…` — crawlable, shareable, hreflang-ready.
  `i18n/paths.ts` maps between them; the language switch keeps the current page, query and hash.
- The admin lives at `/admin/…` without a locale prefix: **each admin user picks the dashboard
  language independently** (stored on `profiles.admin_locale` + locally).
- `<html lang/dir>` follows the active area; all layout CSS uses logical properties
  (`margin-inline-start`, `inset-inline-end`, …), directional icons mirror in RTL.
- UI strings live in typed dictionaries (`i18n/messages/*`, `admin/i18n/*`); English must mirror the
  Arabic key set (compile-time + test). **Content** (products, offers, CMS copy, navigation labels,
  store details) is stored as `localized_text` `{ "ar", "en" }` with Arabic fallback.
- Currency EGP (final prices; VAT not shown separately). Business timezone **Africa/Cairo** (with DST):
  timestamps are stored in UTC and rendered in Cairo time; wall-clock inputs (offer end dates,
  opening hours) convert via `lib/time/zoned.ts`.
- Code splitting: every page is a lazy route; storefront entry ≈ 97 KB gz JS (React, router, query,
  zod) and admin/demo/Supabase code loads only when needed.

## 5. Site settings (CMS foundation)

- Registry: `setting-definitions.json` (shared contract) → keys, scope (design/settings/content/security),
  public or private, and edit/publish permissions.
- Values are validated by zod schemas (`domain/settings/schemas.ts`) — including safe-link rules
  (internal paths or https only) and whitelisted design tokens (`#RRGGBB` only) to prevent script/CSS
  injection from admin-edited content.
- Workflow (DB): **draft** (`site_setting_drafts`, staff-only) → **publish** (`site_settings`, public
  keys readable by anyone) with **version history** (`site_settings_versions`) and **rollback**
  (publishes an old value as a new version). Stale drafts are rejected (`draft_conflict`) unless forced.
- The frontend merges published rows over bundled **base settings** (real owner-supplied data from
  `supabase/seed/data/base/site-settings.json`), so the site stays correct if a row is missing or the
  backend is briefly unavailable (a retry notice is shown).
- Nothing about the store is hard-coded in components: header, navigation, mobile tab bar, footer,
  contact details, hours and SEO defaults all read from settings. The Design Studio (Phase 07) edits
  these same keys.

## 6. Design system

- `styles/tokens.css`: primitives (brand orange `#F65311`, brand black `#0B0B0C`, neutral scale,
  status colours) → **semantic tokens** used by components (`--color-background`, `--color-surface`,
  `--color-text-primary`, `--color-brand-primary`, `--color-on-brand-primary`, `--color-success`, …).
- Contrast is enforced by tests (WCAG AA). Brand orange is a fill colour: black text on orange
  (5.8:1); orange **text** uses `--color-brand-text` (#B0390C, 6.2:1).
- Runtime overrides: `ThemeController` applies whitelisted token overrides from the `theme` setting.
- Typography: IBM Plex Sans Arabic (Arabic) + Manrope (Latin), self-hosted via Fontsource (no font CDN).
  Scale tokens for display/hero, headings, body, prices (tabular numerals), specs, admin, legal.
- Motion: duration tokens collapse to ~0 with `prefers-reduced-motion` or `data-motion="reduced"`
  (admin performance setting later). Cinematic motion is limited to hero/campaign areas.
- Logo: `public/brand/malek-store-logo.png` is the untouched source of truth; `npm run brand:icons`
  derives trimmed marks (WebP), favicons and PWA icons without altering the artwork.

## 7. Security model

- **Authorization lives in the database.** RLS on every public table; privileged writes only through
  `SECURITY DEFINER` RPCs that call `app.has_permission()`; client write privileges are revoked on
  sensitive tables. The UI permission checks only shape the interface.
- RBAC: 8 system roles, 43 permissions (`access-catalog.json` is the shared contract; `npm run test:db`
  verifies the migrated DB matches it). Anti-escalation: staff can only assign/edit roles ranked below
  them, can only grant permissions they hold, only an Owner can grant/revoke Owner, the last Owner
  cannot be removed.
- Optional MFA gate: when `security.adminMfaRequired` is on, sensitive RPCs require an `aal2`
  (authenticator-app TOTP, free in Supabase Auth) session.
- Audit: append-only `audit_logs` (who/what/when/before/after) written by triggers and RPCs; updates
  and deletes are blocked even for privileged roles.
- First Owner: operator-only `app_private.bootstrap_first_owner()` (no API access, refuses once an
  Owner exists). No default credentials.
- Storage: public buckets only for catalog/marketing media (staff-write); customer uploads go to
  private buckets inside `<auth.uid()>/…` folders; size and MIME limits per bucket.
- Frontend: secret-key guard, open-redirect guard on `?next=`, safe external links
  (`noopener noreferrer`), no `dangerouslySetInnerHTML`, validated admin-editable links/colours.

## 8. Error handling & resilience

Config error screen · boot failure screen (chunk load failure) · root and page error boundaries
(retry / home / call the branch) · 404 · backend-unavailable notice with retry · auth errors mapped
to clear messages (invalid code, rate limit, network) · duplicate-submission guards on forms ·
honest placeholders for later-phase sections (no fake buttons).

## 9. SEO (honest limits)

The site is a client-rendered SPA. `usePageMeta` sets per-route `<title>`, description, robots,
Open Graph (title, description, type, url, image), canonical and hreflang alternates (`ar-EG`, `en`,
`x-default` → Arabic), plus page JSON-LD:

- **Product** schema (per-variant `Offer` in EGP with stock availability) — emitted **only for
  non-demo products in live mode**; upcoming products carry no offer (no price commitments).
- **BreadcrumbList** on product/entry pages, **Article** on news entries.
- **Index rules:** filtered/sorted listings, `/search`, `/budget`, news type tabs, not-found states,
  account and admin pages are `noindex`; filtered URLs canonicalise to the unfiltered path (the
  canonical never carries a query string). A demo-mode deployment is always `noindex`.

Crawlers that do not execute JavaScript only see `index.html` defaults. Phase 08 adds build-time
prerendering of public pages and sitemap generation — still with no paid infrastructure. Perfect
SSR-level SEO is not claimed.

## 10. Phase mapping of deferred items

To avoid silently dropping requirements, items touched in Phase 01 but finished later:

| Item                                                | Phase 01 state                                                                      | Completed in                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| Store details / site settings editing UI            | read-only admin view; DB draft→publish→rollback RPCs ready                          | 06 (settings), 07 (Design Studio) |
| Roles & users management UI                         | read-only matrix; `assign_role` / `revoke_role` / `set_role_permissions` RPCs ready | 06                                |
| Audit log viewer                                    | table + triggers + RPC events                                                       | 06                                |
| Demo data admin controls (keep/replace/edit/delete) | DB registry + `delete_all_demo_data()`                                              | 08 (wizard), 10 (cleanup)         |
| Storage uploads UI & image compression              | buckets + policies                                                                  | 05 / 06                           |
| Contact page, Apple landing, catalog, offers, news  | ✅ delivered in Phase 02 (see §11)                                                  | 02                                |
| Cart / checkout / orders / receipts                 | routed placeholders                                                                 | 03                                |
| PWA service worker                                  | manifest + icons only (no service worker yet)                                       | 08                                |
| Integrations center                                 | none (everything optional)                                                          | 09                                |

## 11. Storefront (Phase 02)

**Catalog model.** Product → options (e.g. `storage`, `color`) → option values; a **variant** is one
exact combination with its own price, compare-at price, SKU, stock state, warranty and (through the
colour value) media. The storefront never receives stock quantities — only `in_stock` / `low_stock` /
`out_of_stock`. Product availability (`available`, `coming_soon`, `waitlist_only`, `pre_order`) is
separate from stock and drives the CTA (`domain/catalog/variants.ts → purchaseState`).

**One semantics, two adapters.** `domain/catalog/engine.ts` is the reference implementation of search,
filters, sorting, facets, offers and content windows. The demo adapter runs it in memory; the
Supabase adapter calls the `catalog_*` / `storefront_*` RPCs, which the SQL tests prove return the
same results (`05_catalog.test.sql` mirrors `engine.test.ts`). Search normalisation (Arabic letter
variants, diacritics, Arabic-Indic digits, transliteration keywords) exists in both TS and SQL.
Best-selling order uses `product_rankings` with an explicit `source` (`demo` vs `analytics`), so demo
rankings are never confused with real analytics.

**Modular pages.** Home, Apple and Offers are ordered `page_sections` rows. Each section `type` has a
zod props schema (`domain/content/sections.ts`) and a component in the registry
(`storefront/sections/SectionRenderer.tsx`); unknown or invalid rows are skipped, never crash a page.
Phase 07's Site Editor edits the same rows and schemas. Section types: `hero_campaign`,
`product_rail`, `offer_rail`, `offer_group`, `category_grid`, `brand_lines`, `budget_search`,
`promo_banner`, `coming_soon`, `content_rail`, `trust_strip`, `trust_feature`, `branch_contact`.

**Routes.** `/apple`, `/store`, `/category/:slug`, `/brand/:slug`, `/search?q=`, `/budget?min=&max=`,
`/product/:slug?storage=&color=`, `/offers`, `/offers/:slug`, `/new`, `/coming-soon`, `/news?type=`,
`/news/:slug`, `/contact` (all mirrored under `/en`). Filter state lives in the URL
(`domain/catalog/queryParams.ts`); listings paginate with "load more".

**Data rules.** Demo mode serves the generated demo catalog; live mode serves only the database and
shows an error state on failure (no silent demo fallback). Demo rows appear in live mode only when
the `features.showDemoCatalog` staging flag is on, and are then badged "Demo". Countdowns derive from
offer timestamps; the trust strip, Apple Authorized Reseller statement, budget presets and page size
come from settings.

**Customer requests.** Notify-me (sold-out variant) and waitlist (upcoming product) are real,
validated intake contracts (`request_stock_alert`, `join_waitlist`) — Phase 04 adds account linking
and notifications, Phase 06 the staff queue. Add to cart / Buy now are visibly disabled with an
honest "ordering online soon" note until Phase 03; call and context-aware WhatsApp (product, storage,
colour, SKU, price) are the working paths.

**Motion.** Hybrid model: restrained CSS motion (hero rise + slow float) on capable devices; off for
`prefers-reduced-motion`, and `data-motion="reduced"` is set automatically on constrained devices
(data saver, ≤2 cores or ≤2 GB memory — `features/theme/adaptiveMotion.ts`).

**Bundles.** Every storefront page is a lazy chunk; the admin bundle is never requested by
storefront pages (asserted in e2e). The demo catalog ships inside the lazily loaded demo runtime only.
