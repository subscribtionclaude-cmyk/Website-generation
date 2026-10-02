# MALEK STORE — Phase Status

| Phase | Name                         | Status                   |
| ----- | ---------------------------- | ------------------------ |
| 01    | Foundation                   | ✅ COMPLETE (2026-09-24) |
| 02    | Storefront                   | ✅ COMPLETE (2026-09-24) |
| 03    | Commerce                     | ✅ COMPLETE (2026-09-25) |
| 04    | Customer Features            | ✅ COMPLETE (2026-09-25) |
| 05    | Service Experiences          | ✅ COMPLETE (2026-09-26) |
| 06    | Admin Control Center         | ✅ COMPLETE (2026-09-28) |
| 07    | Visual Site Editor           | ✅ COMPLETE (2026-09-28) |
| 08    | Content / SEO / PWA / Polish | ✅ COMPLETE (2026-10-02) |
| 09    | Integrations Layer           | 🟡 FINAL VALIDATION      |
| 10    | QA / Staging / Launch        | ⚪ NOT STARTED — next    |

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

## Phase 05 — Service Experiences ✅

### Delivered

- [x] **Services hub + landing pages** — `/services`, `/repairs`, `/trade-in`, `/used`, `/after-sales`
      (premium, plain scrolling, local SVG art); home Trade-In / Repairs promos and the product page's
      trade-in link go straight into the request flows; footer links to the hub and after-sales.
- [x] **Repairs** for every device type: device → brand → model → diagnostic → problem → description →
      photos / video → contact + hand-off → `RP-YYYY-NNNNNN` → tracking in Account → Requests.
      "I'm not sure" and "Start a consultation" at every step; **no automatic price anywhere**.
- [x] **3D / visual diagnostic** — generic primitive models (smartphone, tablet, laptop, watch, earbuds,
      console) in three.js, lazy-loaded only on the diagnostic step; rotate / zoom / explode / select /
      reset with pointer, touch and keyboard; highlight + dim + symptoms panel; Auto / Low / High
      quality; reduced motion; auto-fitted camera; honest 2D SVG fallback when WebGL is missing or lost;
      accessible parts-list mirror; data-driven issue model (`repair_catalog` setting).
- [x] **Repair operations** — staff assign, change status, add internal notes or customer updates,
      request information, send estimate / final quotes; customer approves; all permission-checked and
      audited.
- [x] **Trade-In** — current device (brand, model, storage, colour, battery, tax paid, opened / repaired,
      condition checklist incl. "No known issue", accessories, guided photos) + target from the **live
      catalog** (exact variant, current price) or manual; staff-only valuation (catalog price read by the
      DB, difference computed by the DB, snapshot, expiry, inspection note); "Final valuation may change
      after physical inspection"; accept / decline; no automatic order.
- [x] **Used-device requests** — no live used catalogue; battery preference 90%+ / 85–89% / 80–84% /
      No specific preference (بدون تفضيل محدد), tax preference, budget; staff proposal with photos;
      customer interested / not interested.
- [x] **After-sales** — exchange / return / warranty only for the customer's own delivered order items
      (DB-checked), reasons, photos, policy acknowledgement with the stored policy version; staff
      approve / reject (reason required), request info, status, notes — audited.
- [x] **Requests hub + detail** — one list for notify-me, waitlist, repair, trade-in, used and
      after-sales with type and open / closed filters; one detail pattern (number, date, device, status,
      progress, timeline, customer-visible notes, offer, media, next action, cancel, WhatsApp).
- [x] **Media** — shared uploader (camera capture, multi-pick, preview, label, remove, replace, retry,
      in-browser compression, limits explained); private buckets (+ `used-requests`), owner + permitted
      staff only; DB re-validates every file (existence, owner folder, UUID path, MIME ↔ extension from
      metadata, size, count, video); signed URLs.
- [x] **Drafts** — Restore / Discard per flow, no media blobs stored; failed / invalid uploads never lose
      the form.
- [x] **Notifications** — Phase 04 framework reused (category `service`, 15 templates, idempotent dedupe
      keys, action links to the request).
- [x] **Staff screens** — `/admin/repairs`, `/admin/trade-in`, `/admin/used-requests`,
      `/admin/after-sales` (queue with status / search / assignee filters + detail with actions);
      read-only for `*.view`, actions for `*.manage`.
- [x] Numbering `RP-` / `TI-` / `UD-` / `AS-YYYY-000001` (not primary keys), idempotent submission,
      open-request limit, WhatsApp context links without internal notes (honest note when unconfigured),
      in-page analytics hooks only, four clearly-marked demo requests (no owner, staff queues only).
- [x] Performance: service strings moved into a lazily registered dictionary so the storefront entry
      stays within budget; `npm run check:bundle` enforces the 400 kB entry budget and that three.js
      lives only in the lazy viewer chunk.
- [x] Higgsfield: optional; generation required a paid plan, so it was **not used** (no credits spent,
      no assets, no SDK / key / runtime dependency). All artwork is local SVG / code.

### Validation

| Check                                                                                    | Result                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                      | ✅ 0 errors                                                                                                                                                                         |
| `npm run lint`                                                                           | ✅ 0 errors, 0 warnings                                                                                                                                                             |
| `npm run format:check`                                                                   | ✅                                                                                                                                                                                  |
| `npm run seed:check`                                                                     | ✅ demo catalog, media and seed SQL up to date                                                                                                                                      |
| `npm test` (Vitest)                                                                      | ✅ 207 / 207 tests, 20 files (11 service domain tests incl. SQL parity, 5 service integration tests)                                                                                |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                         | ✅ migrations + seeds + idempotent re-run, contracts, 605 / 605 SQL assertions (138 in `09_services`, incl. storage security)                                                       |
| Concurrency (separate parallel sessions)                                                 | ✅ last unit, double submit, parallel wishlist merge                                                                                                                                |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | **E2E**                                                                                                                                                                             |
| `npm run build` + `npm run check:bundle`                                                 | ✅ storefront entry 393 kB (≈ 118 KB gz); three.js only in the lazy `Diagnostic3D` chunk (≈ 135 KB gz); repair flow ≈ 8 KB gz; service strings ≈ 15 KB gz in a shared service chunk |
| Visual review (Arabic + English, 390 / 1440 px)                                          | ✅ hub, landings, repair diagnostic (3D + 2D), trade-in, used, after-sales, requests hub, request detail, admin queues / detail                                                     |
| Security / RLS review                                                                    | ✅ owner-only requests / media, permission-gated staff actions, audited decisions, DB-computed money, no internal notes to customers, no paid dependency                            |

### Known limits / not blocking

- Not yet run against a hosted Supabase project (needs the owner's project); RPCs, RLS and storage
  policies are validated locally with PostgreSQL 16 + the Supabase shim.
- The staff screens are functional Phase 05 workflows; bulk actions, SLA views and richer filters come
  with the Phase 06 admin control center.
- Client-side HEIC images are uploaded as-is (not recompressed) because browsers cannot decode HEIC;
  the size limit still applies.
- No WhatsApp number is configured in base settings, so request pages show the honest "not available"
  note until the owner adds one.
- Demo-mode requests and media live in the browser that created them (media previews within a size
  budget) and are badged "Demo".

## Phase 06 — Admin Control Center ✅

### Delivered

- [x] **Admin shell** — dense near-black / orange / neutral UI kit (`src/admin/ui/`: tables with
      keyboard row selection and bulk bar, filters, tabs, accessible `<dialog>` confirmations with
      affected-item lists / reason / type-to-confirm, dirty-state guard + sticky save bar, stale and
      deleted-elsewhere states, pagination), persistent **Demo / Live** badge, drawer navigation on
      mobile, every module a lazy chunk behind its permission gate (`moduleRoute`).
- [x] **Dashboard** — date ranges (today / 7 / 30 days / custom, Cairo days), permission-gated widgets
      computed from real data only; demo data excluded unless switched on (and labelled when it is).
- [x] **Catalog** — products list (server filters, bulk publish / hide / archive / restore), product
      editor (details, variants matrix, media, specs, warranty, relations, SEO), categories with cycle
      and depth protection, brands, **inventory** (adjustments with reason → stock movements,
      correction counts, below-reserved guard), **prices** with reason → price history, bulk variant
      edits with review step; optimistic concurrency (`stale`) everywhere.
- [x] **Orders & customers** — URL-driven filters (status, payment status / method, fulfilment,
      assignee, dates, customer), assignment, CSV export; customer list / detail (orders, requests,
      addresses, reviews, notifications, activity) with **private CRM notes** (never shown to the
      customer, audited); reviews moderation, abandoned carts with follow-up, waitlists with
      readiness, notification templates + manual in-app sends.
- [x] **Service queues** — repairs / trade-in / used / after-sales views (new, awaiting, in progress,
      ready, completed, open, all), per-kind filters, priority, **SLA aging** from the `service_sla`
      setting (internal targets only, labelled as such), context panel.
- [x] **Content** — offers of every kind incl. **promo codes** (schedule, countdown, homepage flag,
      products / categories, redemption limits), news / launches / coming-soon / campaigns (publish
      needs `content.publish`), **structured page content** for Home / Apple / Offers (section
      visibility + fields validated by the storefront's own section schemas; reorder / layout are
      Phase 07), legal pages.
- [x] **Settings** — one schema-driven workspace over **draft → publish → version history → compare →
      rollback** (force-publish over a newer version needs a reason) for general, store, payments
      (**COD / InstaPay / Split only**; InstaPay details stay empty until the owner enters them),
      shipping (manual fees), receipt template (live preview on a fake sample order; the storefront
      invoice now renders the published template), order review, customers (engagement, abandoned
      carts, **loyalty foundation — off by default**), services + SLA + repair catalog, catalog, trust
      (Apple authorized-reseller text: editable, hideable via its section), notifications (external
      channels off; no paid provider), SEO, security. Storefront `/legal/:page` shows published
      policies and says honestly when one is not written.
- [x] **Insights & data** — analytics from aggregates only (no customer PII in charts) with CSV
      export; CSV **import** (column mapping → server-validated preview → all-or-nothing or valid-rows
      commit; formulas never executed and rejected in text fields; duplicates flagged); exports (CSV
      with formula neutralisation / JSON); **backup** JSON (settings, catalog, content — clearly not a
      replacement for provider backups, no secrets or customer data); **demo data** summary, delete
      (demo rows only, type-to-confirm), preview reset.
- [x] **Access** — roles matrix + permission editing with **escalation protection** (cannot edit
      roles at / above your level or grant permissions you do not hold), staff list, add by existing
      account e-mail (**no passwords created**), change role, suspend (reason) / reactivate, last
      activity; **audit log** with filters, deep link and redacted before / after diff.
- [x] Site Editor, SEO module and Integrations stay planned (their pages say Phase 07 / 08 / 09).

### Validation

| Check                                                                                    | Result                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` / `npm run lint` / `npm run format:check` / `npm run seed:check`     | ✅ 0 errors, 0 warnings                                                                                                                     |
| `npm test` (Vitest)                                                                      | ✅ 282 / 282 tests, 24 files (admin engine parity, 39 RPC contract samples, module smoke, admin workflows)                                  |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                         | ✅ 856 / 856 SQL assertions (212 in `10_admin`: RBAC, escalation, audit, stale edits, import, demo cleanup)                                 |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | ✅ 276 passed, 12 skipped by design (admin-heavy editors on mobile, viewport-only checks), 0 failed; admin scenarios A–M on all 4 viewports |     |
| `npm run build` + `npm run check:bundle`                                                 | ✅ storefront entry 397.5 kB of the 400 kB budget; admin modules are separate lazy chunks                                                   |
| Visual review (Arabic + English; desktop, tablet, mobile)                                | ✅ tables, filters, forms, dialogs, drawer, sticky bars, long Arabic text, no page overflow                                                 |
| Security review                                                                          | ✅ every write is a permission-checked, audited RPC; demo cleanup touches `is_demo` rows only; no paid service                              |

### Known limits / not blocking

- Not yet run against a hosted Supabase project; RPCs and RLS are validated locally with PostgreSQL 16.
- Import accepts CSV (Excel "CSV UTF-8"); native XLSX parsing would need a library and is not included.
- Conversion is cart → order (site traffic is not tracked without an analytics provider).
- Staff removal is by suspension (the history stays); roles cannot be revoked to "none".
- Section reordering, layout and design editing were left to the Phase 07 Site Editor (now delivered).

## Phase 07 — Visual Site Editor ✅

### Delivered

- [x] **Site Editor** (`/admin/site-editor`, lazy chunk behind `design.view`) editing the **real
      storefront**: Home, Apple and Offers layouts are the same `page_sections` rows the storefront
      renders; no separate website builder.
- [x] **Permissions** — new `design.view` (read / preview), `design.edit` (drafts), `design.publish`
      (publish / rollback), all enforced by `site_editor_*` RPCs and RLS; unauthorized calls refused.
- [x] **Sections** — add (per-page supported types; reference-needing types only when published data
      exists), remove (confirm), hide / show, duplicate, reorder by drag and drop, move buttons and a
      keyboard pick-up (announced); new `media_banner` section; manual product picks; picked offers.
- [x] **Inspector** — generated from `SECTION_PROP_SCHEMAS` (`SchemaForm` + reference `choices` +
      `custom` controls): bilingual fields, images (upload / replace / remove), safe-route links and
      buttons, product / offer / campaign / brand / trust references, visibility, structured section
      design (background, spacing — no CSS). Apple authorized-reseller badge: hideable / removable as a
      section, its text editable and switchable off site-wide from the inspector.
- [x] **Design, navigation, SEO** — theme presets, whitelisted colour tokens with contrast warnings,
      type scale, heading weight, section spacing, corner radius; brand; header / mobile bar / footer
      (links, blocks, note); site SEO + share image and new per-page SEO (`page_seo`, ar + en).
- [x] **Real preview** — the storefront itself in a same-origin frame (lazy preview runtime overriding
      only page sections and design settings), unpublished changes live, desktop / tablet / mobile
      widths, Arabic RTL / English LTR, Home / Apple / Offers with header and footer, follows the
      selected section, opens in a new window.
- [x] **Preview Sample Store** — same renderer, sections, schemas and preview engine on the demo
      catalog in an isolated storage namespace, marked **DEMO CONTENT**; refused in live mode unless
      `features.showDemoCatalog` is on.
- [x] **Workflow** — undo / redo for the whole session; save draft; publish dialog (per-item, note,
      permission-locked items, stale-draft "publish anyway"); version history, compare and rollback;
      Phase 06 live section edits recorded as versions; every draft / discard / publish / rollback
      audited (module "design").
- [x] **SEO integration** — one resolver (`src/domain/seo/pageSeo.ts`) for the storefront and the
      editor over the existing `seo` / `page_seo` settings and the page's sections (share image from
      an image banner); SEO preview per page and language (search snippet with length checks, social
      card, canonical / hreflang / robots, value sources, published-now comparison); the preview
      frame's real title matches. No separate SEO store.
- [x] **Media** — raster uploads (PNG / JPEG / WebP / AVIF ≤ 10 MB, compressed in the browser) to the
      existing `site-media` storage (insert needs `design.edit`); SVG and unsafe URLs refused.
- [x] **Performance** — editor and preview runtime are separate lazy chunks; the storefront entry is
      **smaller** than before Phase 07 (402,002 B vs 407,011 B; budget 409,600 B).

### Validation

| Check                                                                                    | Result                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` / `lint` / `format:check` / `seed:check`                             | ✅ 0 errors, 0 warnings                                                                                                                                                                |
| `npm test` (Vitest)                                                                      | ✅ 318 / 318 tests, 26 files (site-editor domain, validation parity with SQL, history, defaults, protocol, preset contrast, demo engine parity, 45 RPC contract samples, editor smoke) |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                         | ✅ 909 / 909 SQL assertions (47 in `11_site_editor`: permissions, validation, draft isolation, conflicts, publish / versions, stale draft, rollback, direct-table denial, audit)       |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe WCAG 2.1 A/AA; overflow) | ✅ 328 passed, 12 skipped by design, 0 failed; site editor A–L (L = SEO preview) + sample store + design presets on all 4 viewports                                                    |
| `npm run build` + `npm run check:bundle`                                                 | ✅ entry 402,002 B of the 409,600 B budget; no editor code in the storefront                                                                                                           |
| Visual review                                                                            | ✅ Arabic + English editor; desktop / tablet / mobile previews; sample store; dialogs; no overflow, no console errors                                                                  |

### Known limits / not blocking

- Not yet run against a hosted Supabase project (RPCs, RLS and storage policies validated locally).
- The three editable pages are Home, Apple and Offers; other pages keep their fixed templates.
- Theme presets fill colour tokens; fonts are the bundled families (no font uploads).
- Demo-mode image uploads stay in the browser (data URLs) and cannot be used for the brand logo,
  which accepts `/brand/` assets or https only.
- Section design is intentionally limited to background and spacing presets.

## Phase 08 — Content / SEO / PWA / Polish ✅

### Delivered

- [x] **One SEO system** — the existing `seo` / `page_seo` settings and `src/domain/seo/pageSeo.ts`,
      extended with shared entity titles (`entityMeta.ts`), one head builder (`pageHead.ts`) used by
      the running app and the prerenderer, site rules (`site.ts`) and structured data
      (`structuredData.ts`). The storefront, the Site Editor preview, the prerendered pages, the
      sitemap and Admin → SEO all read the same source.
- [x] **Metadata** — title, description, canonical, hreflang (ar-EG / en / x-default), robots, Open
      Graph on every public page, live and prerendered.
- [x] **JSON-LD** — Organization, ElectronicsStore per branch (address, opening hours, map),
      WebSite + site search, Product with per-variant EGP Offers, Offer promotions, NewsArticle,
      BreadcrumbList, ItemList; validated (`validateJsonLd`), never demo data, never private fields;
      invalid markup fails the build.
- [x] **sitemap.xml / robots.txt** generated at build time: published non-demo pages only (live data
      from the new `seo_public_index()`), Arabic + English URLs with alternates, private areas /
      search / filtered views excluded. Demo deployments, live builds without `VITE_SITE_URL` and
      live sites with indexing switched off are never indexed (`Disallow: /`, empty sitemap).
- [x] **Prerendering** — Arabic and English HTML for Home, static routes, products, categories,
      brands, news, offers and legal pages (146 files in the demo build) with the real head and a
      readable body for crawlers without JavaScript; the SPA, routing, editor preview and auth are
      unchanged (React replaces `#root`; hosting rewrites unknown paths to the plain shell `404.html`).
- [x] **PWA** — manifest (id, shortcuts), install button shown only when the browser offers
      installation, service worker built from TypeScript with unit-tested cache rules, bilingual
      offline page. Public assets, images and visited public pages only; admin, account, orders /
      invoices, checkout, cart, wishlist, compare, search, API / auth calls, signed uploads,
      notifications and payments are never cached, and nothing requested by a private page is
      intercepted. A test walks the real route table so a new private route can't become cacheable.
- [x] **Performance** — entry 404,474 B within the existing 409,600 B budget; layout-stability work
      (first screen reserved, loading placeholders sized like content, fixed 16:10 news media, Arabic
      400 / 700 font preloads): CLS ≤ 0.004 on key pages at 4 widths (was up to 0.83 on Home);
      lazy images with dimensions; new `performance` setting.
- [x] **Motion** — Settings → Performance & motion (reduced motion for everyone, campaign effects
      off); OS reduced-motion always respected; no animation library.
- [x] **Accessibility pass** — axe WCAG 2.2 AA + best practices on 28 routes × 2 widths, no-JS pages
      and the offline page: demo banner is now a labelled landmark, search landmarks are named,
      English contact page overflow fixed; regression tests added.
- [x] **First-run setup wizard** (`/admin/setup`) — store details, branding (theme presets), demo
      content keep / replace / delete, review with required vs recommended checklist; drafts through
      the settings workflow (each key's own permission), finish via `admin_complete_setup`
      (`settings.publish`, `demo.manage` to delete demo rows), audited `setup.completed`, bilingual,
      mobile, focus moves per step; dashboard reminder until done.
- [x] **Admin → SEO** (`/admin/seo`, `content.view`) — indexing status checks, sitemap / robots
      links, per-page SEO table with the existing Site Editor SEO preview, metadata gaps from
      `admin_seo_overview()` (real rows only), demo counts; no duplicate editing.
- [x] **Docs** — ARCHITECTURE §9 / §17, DATABASE (Phase 08 migration), DEPLOYMENT (routing with
      prerendered pages, search engines), QA checklist, README.

### Validation

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (typecheck, lint, format, seed check, unit tests, build + generate-site, bundle budget) | ✅ 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                      |
| `npm test` (Vitest)                                                                                     | ✅ 368 / 368 tests, 32 files (JSON-LD, sitemap, robots, page head, generator in demo + simulated live mode, PWA cache rules, route coverage, wizard logic, SEO checks, 49 RPC contract samples, admin SEO + wizard flows, a11y regressions)                                                                                  |
| `npm run test:db` (PostgreSQL 16, clean cluster)                                                        | ✅ 949 / 949 SQL assertions (36 in `12_seo_setup`), concurrency checks, 49 contract samples parsed                                                                                                                                                                                                                           |
| `npm run test:e2e` (mobile, tablet, desktop, large desktop; axe; overflow)                              | ✅ 372 passed, 12 skipped by design, 0 failed (15.7 min, fresh production build); includes the Phase 08 spec (44 / 44: SEO metadata, prerendered + no-JS pages, sitemap, robots, PWA install, offline + cache boundaries, reduced motion, CLS / LCP, a11y regressions, Admin → SEO, setup wizard) and every Phase 01–07 spec |
| `npm run build` + `npm run check:bundle`                                                                | ✅ entry 404,474 B of the 409,600 B budget; 144 prerendered pages + sitemap, robots, sw.js (3.6 kB)                                                                                                                                                                                                                          |
| Visual review                                                                                           | ✅ Arabic + English, mobile + desktop: storefront, news, contact, footer install button, offline page, no-JS prerendered pages, admin dashboard, Admin → SEO, every wizard step; no overflow, no console errors                                                                                                              |

### Known limits / not blocking

- Prerendered pages and `sitemap.xml` reflect published content **at build time**; rebuild after
  publishing to update what crawlers without JavaScript see (the running app is always current).
- Not yet built against a hosted Supabase project: live mode of the generator is covered by unit
  tests with simulated live data and by `seo_public_index` contract samples from real SQL.
- Offline support covers visited public pages and public assets; ordering, account and admin need a
  connection by design.
- Headless Chromium never fires `beforeinstallprompt` by itself, so E2E simulates the prompt; real
  installation was not exercised on a device.
- Desktop category pages keep a small layout shift (CLS ≈ 0.08) while filter facets arrive.
- ShipStatic's handling of `<path>.html` pages and the `404.html` rewrite could not be verified from
  this environment (see `docs/DEPLOYMENT.md`).

## Phase 09 — Integrations Layer (final validation in progress)

Every integration is optional, disabled by default, removable and replaceable; secrets are
server-side only; everything is permission-controlled, audited and tested. **The platform works with
no external paid service** — each integration has a free / manual fallback that stays in charge until
the provider is configured, enabled and confirmed working.

### Delivered

- [x] **Integrations & services center** (`/admin/integrations`, `/admin/integrations/:key`) — health
      overview (Connected / Disabled / Error / Needs setup), 12 cards grouped by purpose with state
      (Not configured, Disabled, Configured — not tested, Connected, Connection error), Optional,
      Requires / May require subscription, Manual fallback active, DEMO / MOCK, circuit paused;
      purpose, last check + safe error, fallback, data received, Test connection, Enable / Disable
      (confirmed, reason, audited), Configure. Detail tabs: Overview (data categories, fallback,
      adapter status, capabilities, server secret names), Configuration, Connection (history), Sync
      center (dry run, sync now — disabled until configured / enabled — recent syncs, per-item
      details, conflicts-only filter), Messages (routing per event, delivery log with manual retry,
      dispatch, webhook events). Arabic + English.
- [x] **Registry + adapters** — `integration-catalog.json` mirrored by `app.integration_catalog()`
      (contract-checked); adapter interfaces for notifications, ERP / POS, courier, AI, search,
      storage, backup, social sign-in; health codes (connected, auth failed, permission problem,
      unreachable, timeout, configuration incomplete, unsupported, rate limited, provider error,
      runtime unavailable); finite timeouts, redaction, circuit breaker, retry policy, idempotency.
- [x] **Implemented adapters** (stub-tested, not live-verified): WhatsApp Cloud API (template
      messages, delivery receipts, webhook), Odoo External API (read-only products / prices / stock /
      customers), GA4 Measurement ID check, Supabase Auth provider check. All other providers:
      interface + deterministic MOCK; live mode reports `unsupported` instead of pretending.
- [x] **Server runtime** — Supabase Edge Functions `integrations` (test / sync / dispatch; the caller's
      JWT is authorized by the database first) and `integration-webhook` (HMAC signature, event-ID
      dedupe), thin Deno wrappers over the tested core; SSRF guard on admin-entered endpoints.
- [x] **Secrets** — never in the database, frontend, `VITE_*`, browser storage, repository, audit log
      or errors: refused as settings, redacted from messages, build-time `VITE_*` guard, and
      `npm run check:secrets` (env names / values, `dist/` credential patterns + server-only values,
      tracked files) in `npm run check`. The admin shows variable names only.
- [x] **Messaging** — WhatsApp manual deep link stays the default; automatic messages only when the
      provider is configured + enabled, the channel is on, the event is mapped to a provider template,
      the customer opted in and the data is not demo. In-app always works. Statuses Pending / Sent /
      Delivered / Failed / Skipped / Disabled; retries 1 / 5 min then manual (max 5). Providers get
      only rendered customer-facing text + the one contact field. SMS / email are optional adapters;
      Supabase Auth email unaffected.
- [x] **ERP / POS** — import only (two-way refused), mappings keep external IDs, ownership per domain
      (Malek / external with conflict review / external wins), exact SKU / email matching (never
      fuzzy), new records listed for review, dry run, idempotent jobs, sync log; **stock never below
      reservations** (planned conflict + re-checked under row lock); price changes write price history
      (source `integration`) + audit; stock changes write `external_sync` movements + audit; order
      export from authoritative snapshots. CSV import unchanged.
- [x] **Courier** optional; "Shipping fee to be confirmed" kept; checkout never blocked.
- [x] **Google Analytics** — off by default; consent first (equal Accept / Reject, footer Cookie
      settings); never on admin, account, sign-in, cart, checkout, orders, wishlist, compare or
      service request forms; never in demo; path-only page views, whitelisted PII-filtered params;
      lazy chunk (no SDK in the entry).
- [x] **AI** — draft-only SEO description suggestion in the product editor (Generate → Review →
      Edit → Approve (save) → Publish), public fields only, no access to prices / stock / orders /
      payments / valuations; MOCK in demo; no live adapter ships.
- [x] **Search / storage / backup** — built-in search and Supabase Storage stay the defaults with
      fallbacks; private media only via expiring URLs; manual exports documented as not backups.
- [x] **Social sign-in** — Google / Apple buttons on the customer sign-in page when enabled; Supabase
      OAuth (PKCE); identity linking left to Supabase; demo says simulated.
- [x] **Database** — `20261003100000_integrations.sql`: 3 permissions, 6 tables (RLS, read via
      `integrations.view`, no direct writes), delivery queue extension, price / stock source values,
      staff / service-role / public RPCs, routing in `app.notify`, audit of configure / enable /
      disable / test / provider change / remove / sync start / complete / fail / retry.
- [x] **Docs** — ARCHITECTURE §18, DATABASE (Phase 09 migration + RPCs), DEPLOYMENT (optional
      integrations), QA checklist, README, `.env.example` (public vs server-only names).

### Validation

Final validation in progress (full E2E on the final build); results are recorded here when it
completes.

### Known limits / not blocking

- No real provider account was connected (by design): WhatsApp Cloud, Odoo, GA4 and Google / Apple
  OAuth adapters are verified against stubbed HTTP and mocks only, and the Edge Functions were not
  deployed or run under Deno here (their logic is the unit-tested `server/handler.ts`).
- SMS, email, POS, courier, AI, search, storage and backup ship as interfaces + mocks; a concrete
  adapter is added when the owner chooses a provider (live mode says "not supported" until then).
- Message dispatch runs on demand from the admin; scheduling it (cron calling the function) is a
  deployment step.
- The setting-pattern checks (e.g. WhatsApp phone-number ID format) run in the form; the database
  enforces types, https URLs, known keys and secret refusal.
- Storefront entry grew by ~1.7 kB (406,201 B of the 409,600 B budget) — little headroom remains.

## Phase 10 — QA / Staging / Launch

Full QA, security & RLS review, performance & accessibility review, demo cleanup, backups, deployment
docs, ShipStatic/generic static build, launch checklist, release notes.
