# MALEK STORE — Phase Status

| Phase | Name                         | Status                   |
| ----- | ---------------------------- | ------------------------ |
| 01    | Foundation                   | ✅ COMPLETE (2026-09-24) |
| 02    | Storefront                   | ✅ COMPLETE (2026-09-24) |
| 03    | Commerce                     | ✅ COMPLETE (2026-09-25) |
| 04    | Customer Features            | ✅ COMPLETE (2026-09-25) |
| 05    | Service Experiences          | ⚪ NOT STARTED — next    |
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
- Promo codes were display-only in Phase 02; they apply at checkout since Phase 03.
- Structured data and meta are client-rendered (SPA); prerendering + sitemap are Phase 08.
- The Phase 02 migrations were edited during Phase 02 (not yet applied to any real project); from now on
  changes go into new migration files.

## Phase 03 — Commerce ✅

### Delivered

- [x] **Cart**: guest cart in the browser (one line per exact variant, quantity caps, save for later,
      multi-tab sync, survives refresh); header / tab-bar badges; Add to cart and Buy now enabled.
      On sign-in the browser cart is merged once into the account cart (`cart_merge`, deterministic,
      adjustments shown).
- [x] **Server price authority**: every cart view and order is re-quoted server-side (`quote_checkout`,
      `create_order`) — variant, price, stock, offer window, quantity, bundles, free gifts, promo code;
      the demo engine mirrors it with identical test expectations. "Price updated" (old → new, accept to
      continue), sold-out, insufficient-stock, not-purchasable and max-quantity states.
- [x] **Checkout** (`/checkout`, sign-in required only here — email code, no paid SMS): Contact
      (Egyptian mobile validated + normalised) → Fulfillment (delivery: governorate / area / address /
      notes, fee "to be confirmed"; or store pickup from settings) → Payment (COD, InstaPay, split;
      V1 methods only — pay-at-store was removed by the Phase 04 correction) → Review (promo code, note) → Create. Mobile-first, focus management,
      fieldset radio groups, Arabic + English.
- [x] **Order creation**: atomic and idempotent (per-customer advisory lock + unique idempotency key),
      `FOR UPDATE` row locks in id order, price-change detection that writes nothing, open-order limit,
      human order number `MS-2026-000001` (sequence, not the PK), full item snapshots, discount snapshot,
      promo redemption, status history (actor, time, note, customer-visible flag), audit events.
- [x] **Reservations**: 30-minute soft hold per line via `reservation_expires_at` — availability ignores
      expired holds by timestamp (no cron); stock is committed **once** on staff confirmation with a
      `sale` stock movement; cancellation releases holds or restocks (`cancellation_restock`).
- [x] **Payments**: COD, InstaPay (manual verification), split (InstaPay deposit + rest on delivery),
      no other method (pay-at-store removed in Phase 04). Payment status derived from verified money only; a screenshot never marks
      an order paid; only `payments.verify` staff (+ MFA gate) record money; the database enforces
      `total = subtotal − discount + shipping`, `paid ≤ total`, `remaining = total − paid`.
- [x] **Shipping**: manual per-order fee by `shipping.manage` staff (ETA, courier, tracking), audited;
      "total before shipping" until confirmed; pickup has no fee.
- [x] **Promo codes** validated server-side (window, min subtotal, total + per-customer limits, targets);
      DEMO10 demo case (10% off accessories, max 2 per customer). `features.promoCodes` stays off in
      the real base settings and is on only in demo mode.
- [x] **Manual review** rules as a private setting (`order_review`) with conservative demo defaults
      (high value, several expensive units, new customer + large order, split payment, recently
      cancelled orders, velocity); flagged orders cannot be confirmed until approved.
- [x] **Receipt** (`/order/:number`): success state, status + payment badges (icon + text), items,
      totals, next steps, WhatsApp hand-off after creation (prefilled, never a broken link — honest
      notice when no number is configured), call the store, progress timeline, customer cancel while
      allowed. **Account** order list. Orders are visible to their owner only.
- [x] **Printable invoice** (`/order/:number/invoice`): browser print / save as PDF, print CSS hiding site
      chrome, A4 page margins, rendered from an editable template contract
      (`domain/commerce/invoiceTemplate.ts`) for Phase 06's editor. Final prices, no VAT line,
      "not a tax invoice".
- [x] **Admin Orders** (`/admin/orders`, `/admin/orders/:id`): queue (status / review filters, search,
      release expired holds) and detail (snapshots, totals, customer, review reasons, verified payments,
      holds, timeline) with permission-gated actions: review, status, shipping fee, payment
      verification, record verified payment, cancel, internal note — each re-checked by its RPC and
      audited.
- [x] **Migrations** (4 new files): commerce tables with RLS (owner / staff read, no direct writes),
      pricing + reservation-aware availability, checkout and customer RPCs, staff operations; demo
      registration for orders and stock movements.
- [x] Fixes found during Phase 03 QA: guest quotes are scoped like other private queries (the auth
      clean-up no longer drops an in-flight guest quote); `scroll-padding` keeps focused controls clear
      of the sticky header and mobile tab bar (WCAG 2.4.11); checkout grids can no longer widen the page
      on phones; the DEMO10 description no longer says "later phase".

### Validation

| Check                                                                                    | Result                                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                      | ✅ 0 errors                                                                                             |
| `npm run lint`                                                                           | ✅ 0 errors, 0 warnings                                                                                 |
| `npm run format:check`                                                                   | ✅                                                                                                      |
| `npm run seed:check`                                                                     | ✅ demo catalog, media and seed SQL up to date                                                          |
| `npm test` (Vitest)                                                                      | ✅ 167 / 167 tests, 16 files (22 commerce domain tests, 8 commerce integration tests)                   |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                         | ✅ migrations + seeds + idempotent re-run, contracts, 349 / 349 SQL assertions (140 in `07_commerce`)   |
| Concurrency (separate parallel sessions)                                                 | ✅ last unit: `cart_invalid` + `ok` (one order); double submit: `ok` + `ok:duplicate` (one order)       |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | ✅ 146 passed, 6 skipped (viewport-specific) — incl. 20 commerce journeys                               |
| `npm run build`                                                                          | ✅ storefront entry ≈ 114 KB gz; cart / checkout / order / invoice pages are lazy chunks                |
| Visual review (Arabic + English, 390 / 1440 px) + invoice print (A4 render + PDF)        | ✅ fixed: receipt copy without WhatsApp, RTL invoice totals, Arabic comma in English addresses, spacing |
| Security review                                                                          | ✅ no client total trusted; staff-only payment verification; orders private; no paid integration        |

### Known limits / not blocking

- Not yet run against a hosted Supabase project (needs the owner's project); RPCs, RLS and the MFA
  gate are validated locally with PostgreSQL 16 + the Supabase shim, and the adapter parses every RPC
  with zod.
- `store.whatsappNumber` and `commerce.instapay` are empty in the real base settings until the owner
  provides real values (the UI shows honest notices meanwhile — nothing is invented).
- No automatic customer notifications (SMS / email / WhatsApp Business) — the WhatsApp hand-off is
  customer-initiated; notifications are Phase 04, WhatsApp Business is an optional Phase 09 adapter.
- Refunds are handled by staff outside the app: an order that received money cannot be cancelled in
  the app (`refund_required`); an after-sales / refund workflow belongs to Phase 05.
- Customers send transfer screenshots on WhatsApp; in-app uploads arrive with Phases 05/06.
- Shipping zones / fee rules, receipt-template editing, staff invoice printing, stock adjustment UI and
  the order-review settings UI are Phase 06 (the data model already supports them).
- Expired holds stop counting immediately; their status is tidied by the staff button or any future
  scheduler (`release_expired_reservations`) — no cron is required.
- Demo orders live in the browser that created them (localStorage) and are badged "Demo".

## Phase 04 — Customer Features ✅

### Delivered

- [x] **Phase 03 correction**: V1 payment methods are exactly COD, InstaPay and split payment.
      Pay-at-store was removed from the schema checks, checkout RPC, payment-status derivation, demo
      engine, UI, labels, settings and seeds; the DB rejects it; a regression test asserts the
      customer sees exactly the three methods.
- [x] **Account area** (`/account`, lazy chunk): Overview (latest order, continue-your-cart, saved
      items, active requests, latest notifications, recently viewed), Orders (current / completed /
      cancelled, show more), Wishlist, Requests, Notifications, Reviews, Addresses, Profile. Scrollable
      pill nav on phones, sidebar on desktop, honest empty states.
- [x] **Profile** (name, Egyptian mobile normalised like checkout, preferred language, read-only
      email, member since) and **saved addresses** (same typed model and rules as checkout, one
      default, max 10, owner-only) reused and preselected at checkout, with optional "save this
      address".
- [x] **Wishlist**: guest list in the browser, toggles on cards and the product page (accessible
      names, `aria-pressed`, live announcements); deterministic, idempotent, concurrency-safe merge at
      sign-in that clears the browser copy only after success; price-drop notices; unavailable items
      reported.
- [x] **Recently viewed** (browser for guests, account when signed in, capped, merged at sign-in) and
      **compare** (max 4, same top-level category with an explained refusal, dynamic spec rows,
      differences-only, keyboard-scrollable region with sticky first column, floating tray).
- [x] **Verified-buyer reviews**: DB-validated eligibility (owner, product in the order, delivered /
      completed), one review per customer per product (edits go back to pending), server-only
      Verified badge, optional photo (private bucket, public only after approval), moderation at
      `/admin/reviews` (audited, no self-approval, author notified), public shows approved reviews
      only with first name + initial; demo reviews labelled.
- [x] **Notify me / waitlist**: lifecycle Active → Available → Notified, Cancelled, Expired; guest
      claim tokens (hash stored) and linking by verified sign-in email; event-driven back-in-stock and
      waitlist notices (triggers, no cron); account Requests area with Repairs / Trade-In / Used
      placeholders only.
- [x] **Notifications framework**: templates (localized, closed placeholder set), notifications
      (idempotent by `dedupe_key`), preferences (in-app; orders mandatory), deliveries (external
      channels disabled — nothing is sent outside the app); inbox with read / unread, mark one / all,
      category, time, action link and paging; header bell, account nav and mobile tab badge; audited
      manual staff messages (RPC).
- [x] **Abandoned cart**: derived from cart timestamps (enabled, 48 h threshold, one in-app reminder
      per idle period), "Your cart is waiting → Continue your cart" card, minimal staff view at
      `/admin/abandoned-carts` (`customers.view`).
- [x] **Recommendations**: explicit relations first (related, accessories, compatible in both
      directions — never guessed from names), you may also like, frequently bought together from real
      delivered / completed orders of ≥ 2 customers (aggregated ids only; demo orders never feed live).
- [x] Arabic + English strings for every new screen; demo catalog English fields fixed (phone spec
      values were Arabic-only) with a regression test.
- [x] Fixes found during Phase 04 QA: the heart / bell no longer push the header wider than small
      phones (they move into the menu drawer and the Account tab badge below 480 px); the compare tray
      reserves scroll padding and page space so it never hides focused controls; notification
      preference switches respond immediately (rolled back if the save fails); subtitles sit under
      page titles; "1-star" distribution wording.

### Validation

| Check                                                                                    | Result                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                      | ✅ 0 errors                                                                                                                                                       |
| `npm run lint`                                                                           | ✅ 0 errors, 0 warnings                                                                                                                                           |
| `npm run format:check`                                                                   | ✅                                                                                                                                                                |
| `npm run seed:check`                                                                     | ✅ demo catalog, media and seed SQL up to date                                                                                                                    |
| `npm test` (Vitest)                                                                      | ✅ 189 / 189 tests, 18 files (14 customer domain tests, 6 customer integration tests, pay-at-store regression)                                                    |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                         | ✅ migrations + seeds + idempotent re-run, contracts, 467 / 467 SQL assertions (115 in `08_customer`)                                                             |
| Concurrency (separate parallel sessions)                                                 | ✅ last unit, double submit, parallel wishlist merge (same account)                                                                                               |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | ✅ 188 passed, 8 skipped (viewport-specific) — incl. 44 customer journeys (A–J + recommendations × 4 viewports)                                                   |
| `npm run build`                                                                          | ✅ storefront entry ≈ 117 KB gz; account pages ≈ 8 KB gz lazy chunk; admin pages lazy                                                                             |
| Visual review (Arabic + English, 390 / 1440 px)                                          | ✅ account pages, wishlist, compare, review flow, notifications, requests, admin reviews, admin abandoned carts                                                   |
| Security / RLS review                                                                    | ✅ owner-only data (RPC + RLS asserted), server-only verified badge, no self-approval, permission-gated staff views, idempotent notifications, no paid dependency |

### Known limits / not blocking

- Not yet run against a hosted Supabase project (needs the owner's project); RPCs, RLS and storage
  policies are validated locally with PostgreSQL 16 + the Supabase shim, and the adapters parse every
  RPC with zod.
- External notification channels (email / WhatsApp Business / SMS) are modelled but disabled; the
  optional adapters are Phase 09. Everything customers need works in-app.
- A staff UI for manual notifications and for editing product relations / engagement settings arrives
  with the Phase 06 admin modules (the audited RPCs exist now); the admin "Notifications" module is
  marked Phase 06.
- Compare stays in the browser (no personal data, not synced across devices).
- Demo-mode customer data (wishlist, reviews, notifications, requests) lives in the browser that
  created it and is badged "Demo" where shown.

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
