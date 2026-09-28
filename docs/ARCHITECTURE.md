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

| Item                                                | Phase 01 state                                                                      | Completed in                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| Store details / site settings editing UI            | read-only admin view; DB draft→publish→rollback RPCs ready                          | ✅ 06 (§15), 07 (Site Editor §16)    |
| Roles & users management UI                         | read-only matrix; `assign_role` / `revoke_role` / `set_role_permissions` RPCs ready | ✅ 06 (§15)                          |
| Audit log viewer                                    | table + triggers + RPC events                                                       | ✅ 06 (§15)                          |
| Demo data admin controls (keep/replace/edit/delete) | DB registry + `delete_all_demo_data()`                                              | ✅ 06 (admin), 08 (wizard)           |
| Storage uploads UI & image compression              | buckets + policies                                                                  | ✅ 05 (service media) / 06 (catalog) |
| Contact page, Apple landing, catalog, offers, news  | ✅ delivered in Phase 02 (see §11)                                                  | 02                                   |
| Cart / checkout / orders / receipts                 | ✅ delivered in Phase 03 (see §12)                                                  | 03                                   |
| PWA service worker                                  | manifest + icons only (no service worker yet)                                       | 08                                   |
| Integrations center                                 | none (everything optional)                                                          | 09                                   |

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
and notifications, Phase 06 the staff queue. Add to cart / Buy now (enabled in Phase 03, §12) sit
next to call and context-aware WhatsApp (product, storage, colour, SKU, price).

**Motion.** Hybrid model: restrained CSS motion (hero rise + slow float) on capable devices; off for
`prefers-reduced-motion`, and `data-motion="reduced"` is set automatically on constrained devices
(data saver, ≤2 cores or ≤2 GB memory — `features/theme/adaptiveMotion.ts`).

**Bundles.** Every storefront page is a lazy chunk; the admin bundle is never requested by
storefront pages (asserted in e2e). The demo catalog ships inside the lazily loaded demo runtime only.

## 12. Commerce (Phase 03)

**Money.** Prices are `numeric(12,2)` EGP in the database. TypeScript never does float arithmetic on
money: `domain/commerce/money.ts` works in integer piasters and rounds half-up exactly like
`round(x, 2)`. The UI shows a single final price — there is no VAT line; receipts say "not a tax
invoice".

**Price authority.** The browser only ever sends variant ids and quantities. `quote_checkout`
(anonymous or signed-in) and `create_order` compute everything on the server with one pricing
function set (`app.variant_pricing` → `app.build_quote`): automatic offers (flash / limited-time /
percentage / fixed — best discount wins, inside their time window), bundles (complete sets of
bundle items), free gifts (price 0, only while in stock), then the promo code (`offers.kind =
'promo_code'`, `features.promoCodes`, window, min subtotal, total and per-customer limits; an
untargeted code applies to the whole cart). `domain/commerce/pricing.ts` mirrors it for the demo
adapter; `commerce.test.ts` and `07_commerce.test.sql` assert the same numbers.

**Cart.** One line = one exact variant. Signed out, the cart lives in `localStorage`
(`malek:v1:cart`, display data only, synced across tabs). On sign-in it is merged **once** into the
account cart by `cart_merge` (deterministic: quantities summed and capped at
`commerce.maxQuantityPerLine`, unknown variants dropped, adjustments reported to the customer; stock
shortfalls are then flagged by the quote).
Every cart view is re-quoted; a line whose price moved since the customer saw it shows **"Price
updated"** (old → new) and checkout stays disabled until the customer accepts; sold-out, over-stock,
unavailable and not-purchasable lines are flagged instead of being changed silently.

**Checkout.** Browsing and the cart are anonymous; `/checkout` requires sign-in (email code — no paid
SMS). Steps: Contact (Egyptian mobile normalised to `+20…`, no OTP) → Fulfillment (delivery:
governorate / area / address / notes, fee "to be confirmed"; or pickup from a `store.branches`
branch with `pickupEnabled`) → Payment (only methods enabled in the `commerce` setting: COD,
InstaPay, split — the only V1 methods) → Review (promo code, note)
→ Create. Each step moves focus to its heading; radio groups are real fieldsets with legends;
statuses always carry text and an icon.

**Order creation (`create_order`).** One transaction:

1. `pg_advisory_xact_lock` per customer, then the idempotency key is checked (unique
   `(customer_id, idempotency_key)`; a replay returns the existing order with `duplicate: true`). The
   UI derives the key from the payload, so a double click or retry can never create two orders.
2. Contact, fulfillment, payment and the open-order limit (`commerce.maxOpenOrdersPerCustomer`) are
   validated.
3. The variants are locked `FOR UPDATE` in id order (deadlock-free) and the quote is rebuilt. If any
   unit price or the total differs from what the customer confirmed, **nothing is written** and the
   new quote comes back as `price_changed`.
4. Manual-review rules run, the human order number is issued (`MS-2026-000123` from a sequence,
   Cairo year — never the primary key), and items (full snapshots: name, variant, SKU, image,
   warranty, regular / unit price, discounts, applied offer), reservations, the promo redemption, the
   first timeline event and an audit event are inserted; ordered lines leave the account cart.

Business outcomes are returned as `{ ok: false, code }` (never raw database errors); permission
failures raise `42501`.

**Reservations (no cron).** Each order line holds a soft reservation with `reservation_expires_at =
now() + commerce.reservationMinutes` (30). Availability everywhere — quotes, product stock states,
`FOR UPDATE` checks — is `stock_quantity − active reservations whose expiry is in the future`, so an
expired hold stops counting the moment its timestamp passes; `release_expired_reservations()` only
tidies statuses (staff button; safe to call from any scheduler later). Stock is **committed once**,
when staff confirm the order: `stock_quantity` is decremented, one `sale` row is written to
`stock_movements` and the reservations become `committed`. Cancelling before commit releases the
holds; cancelling after commit restocks with a `cancellation_restock` movement.

**Concurrency.** `test:db` runs real parallel sessions: two customers racing for the last unit (one
order, one `cart_invalid`) and the same idempotency key submitted twice at once (one order, one
duplicate).

**Order lifecycle.** `new → awaiting_whatsapp / awaiting_payment / payment_verification → confirmed →
preparing → ready_for_pickup | out_for_delivery → delivered → completed`, plus `cancelled`
(`app.order_transition_allowed`, mirrored in `domain/commerce/status.ts`). Confirming requires: no
pending/rejected review, a confirmed shipping fee for delivery, InstaPay fully paid, split deposit
paid. Completing requires `remaining = 0`. Every change writes an append-only `order_events` row
(actor kind, status, note, customer-visible flag) and the row-level audit trigger.

**Payments.** Exactly three V1 methods — COD, InstaPay, split (InstaPay deposit + rest on delivery);
pay-at-store was not approved and is rejected by the database —
no gateway. `payment_status` is **derived** from the method and _verified_ money only
(`cod_pending`, `awaiting_payment`, `awaiting_deposit`, `verification_pending`, `deposit_verified`,
`partially_paid`, `paid`, `void`). A customer's screenshot never changes it: staff
can mark "payment verification" (`orders.manage`), but only `staff_record_payment` —
`payments.verify` **and** the MFA gate — adds money, with method, amount, reference and note, audited.
The database enforces `total = subtotal − discount_total + shipping_fee`, `paid_amount ≤ total` and
`remaining_amount = total − paid_amount` (generated column). InstaPay details come from the
`commerce.instapay` setting; when unset, checkout says the team sends them on WhatsApp — nothing is
invented.

**Shipping.** Delivery orders start with `shipping_fee_status = 'pending'` ("to be confirmed", total
shown as "total before shipping"). Staff with `shipping.manage` enter the fee (plus ETA, courier,
tracking) — audited; a fee that would make the verified payments exceed the new total is refused.
Pickup orders have no fee.

**Manual review.** `order_review` (private setting) holds conservative demo defaults — high value
(≥ 100,000), several expensive units, new customer with a large order, split payment, recently
cancelled orders, order velocity. Flagged orders show "needs review" to the customer (without the
reasons) and cannot be confirmed until `payments.verify` staff approve.

**Customer views.** `/order/:number` (receipt + progress + WhatsApp hand-off + cancel while allowed),
`/order/:number/invoice` and `/account` (order list) read through `get_my_order` / `list_my_orders`,
which only return the caller's own orders; an unknown and a foreign number look identical. The
WhatsApp hand-off appears only after the order exists, prefilled with the number, items, total,
payment and fulfillment (no address or email); if no WhatsApp number is configured the page says so
instead of rendering a broken link.

**Invoice.** Browser-native: print CSS hides the site chrome (`print-hidden`) and "Print / save as
PDF" uses the browser's own PDF output — no paid service. The page renders from an editable template
contract (`domain/commerce/invoiceTemplate.ts`: logo, visible fields, title, terms, footer) that
Phase 06's receipt-template editor will store as a setting.

**Staff.** `/admin/orders` (queue with status / review filters, search, release expired holds) and
`/admin/orders/:id` (items, totals, customer, review reasons, verified payments, holds, timeline;
actions: review, status, shipping, payment verification, record verified payment, cancel, note).
Each action is available only with its permission and is re-checked by the RPC.

**Demo vs live.** Demo mode runs the same rules in the browser (`domain/commerce/demoCommerce.ts`,
persisted in `localStorage`) and badges every order "Demo". Live mode uses only the Supabase RPCs; if
they fail, the customer sees an error state — never demo data.

## 13. Customer features (Phase 04)

**Account area.** `/account` is one lazy chunk (`storefront/pages/account/AccountPages.tsx`) with a
simple section nav (a scrollable pill row on phones, a sidebar on desktop): Overview · Orders ·
Wishlist (`/wishlist`) · Requests · Notifications · Reviews · Addresses · Profile. Every section has
an honest empty state. Orders filter current / completed / cancelled and page with "show more";
receipts, invoices and the WhatsApp hand-off are the Phase 03 pages. Staff notes never reach the
customer view.

**Profile and addresses.** `update_my_profile` stores name, Egyptian mobile (normalised exactly like
checkout) and preferred language; the sign-in email is read-only. Saved addresses share one rule set
with checkout (`domain/customer/address.ts` ↔ `app.delivery_address_problem`): max 10, one default,
owner-only. Checkout preselects the default address, offers the saved list and can save a new one
after the order is placed (best effort — it never blocks the receipt).

**Wishlist.** Guests keep a list in this browser (`localStorage`, capped). At sign-in
`CustomerListsProvider` calls `wishlist_merge` once: deterministic (oldest first), account entries are
kept, duplicates are ignored, invalid / unavailable items are reported (not silently dropped) and the
merge is idempotent and safe under concurrent sessions. The browser copy is cleared **only after** the
merge succeeded. Toggles on cards and the product page have accessible names and `aria-pressed` (the
heart fill is never the only signal) and announce the result in a live region. Each saved item keeps
a `reference_price`; a drop of at least `engagement.wishlist.priceDropPercent` produces one in-app
notice per new low price.

**Recently viewed.** Product pages record a view. Guests: browser list (max
`engagement.recentlyViewed.maxItems`, de-duplicated, newest first). Signed in: `recent_track` /
`recent_merge` keep the same cap in the account. Shown as a rail on product pages and the account
overview.

**Compare.** Browser-only (no personal data), max `engagement.compare.maxItems` (4). Products must
share the same top-level category (`rootCategoryOf`); an incompatible product is refused with an
explanation. Rows come from the Phase 02 spec architecture (`buildCompareRows`: price, availability,
brand, storage, colours, shared spec items, warranty) with a "differences only" toggle. On phones the
table scrolls inside a labelled, keyboard-focusable region with a sticky first column; the page never
scrolls sideways. A floating tray links to `/compare` and reserves scroll padding so it never hides
focused controls.

**Verified-buyer reviews.** Eligibility is decided in the database (`app.review_eligible_order`): the
customer owns a non-demo order in an eligible status (`engagement.reviews.eligibleStatuses`, default
delivered / completed) containing the product as a paid (non-gift) line. Rule: **one review per
customer per product** — resubmitting edits it and sends it back to `pending`. `verified_buyer` is set
only by the server; there is no client path to it. Public reads (`product_reviews_public`) return
approved reviews only, with the author as first name + initial and no ids, emails or moderation data.
Staff moderate at `/admin/reviews` (`reviews.moderate`, audited `review.approved` / `review.rejected`,
the author is notified, self-moderation is refused). Optional photos are compressed in the browser and
stored in the private `reviews` bucket under the customer's folder; they become readable only once
the review is approved (signed URLs). Seeded demo reviews are `is_demo`, never verified and labelled
"Demo review".

**Notify me and waitlists.** Requests (`stock_notifications`, `waitlist_entries`) have the lifecycle
Active → Available → Notified, plus Cancelled and Expired (derived from age,
`engagement.requests.expireAfterDays`). Guest requests return a one-time claim token (only its hash is
stored); after sign-in the browser's tokens — and requests made with the verified sign-in email, never
a phone number — are linked to the account. The account "Requests" area lists them with text + icon
status pills and cancel; since Phase 05 the same hub also lists service requests (§14).

**Notifications.** Tables: `notification_templates` (localized, closed placeholder set
`customer_name, order_number, product_name, status, amount, code` — values cannot inject placeholders),
`notifications` (unique `(user_id, dedupe_key)` ⇒ every producer is idempotent),
`notification_preferences` and `notification_deliveries`. `app.notify()` is the single producer: it
honours preferences (order and account messages are mandatory) and queues a delivery row only for an
external channel that is both enabled and configured — none are in V1, so nothing is sent outside the
app and no paid email / SMS / WhatsApp is required (adapters stay disabled by default, Phase 09).
Producers:

- order status: an `order_events` trigger (customer-visible staff events only);
- back in stock / waitlist available / pre-order: triggers on `product_variants` and `products`
  (event-driven, no cron), plus a lazy per-user `app.refresh_customer_alerts` on inbox reads and a
  staff `process_customer_alerts()` catch-up;
- price drops on saved items; review approved / rejected; abandoned-cart reminder;
- manual staff messages (`staff_send_notification`, `notifications.manage`, audited).

The inbox pages with a `before` cursor, shows read/unread (text, not colour only), mark one / mark
all, category, timestamp and action link. The header bell and the account nav show the unread count
(on small phones inside the menu drawer and on the Account tab).

**Abandoned cart.** Derived, not tracked: a signed-in cart is abandoned when it has items, its last
activity (max of `carts` / `cart_items.updated_at`) is older than `abandoned_cart.thresholdHours`
(default 48 h) and no order was created since. Follow-up (`followUp: in_app | off`) is at most one
in-app reminder per idle period (dedupe `cart:<epoch>`). Customers see a "Your cart is waiting →
Continue your cart" card; staff with `customers.view` get a minimal list at `/admin/abandoned-carts`
(name, email, items, last activity, reminder sent) — no payment data.

**Recommendations.** Rule-based, explicit relations first (`product_relations`, audited):
related (manual, then same category by price closeness), accessories (manual), compatible (explicit
relation in either direction — never guessed from names), you may also like (same brand / category
within ±40 % of the price) and frequently bought together (manual, then **real** delivered / completed,
non-demo, non-gift orders from at least `engagement.recommendations.minCustomers` distinct customers,
returned as product ids only). Rails are de-duplicated in the order bought-together → accessories →
compatible → related → you may also like. In demo mode the aggregation runs over demo orders in the
browser only and never reaches live data.

**Demo vs live.** Demo mode uses `domain/customer/demoCustomer.ts` (same rules, persisted in
`localStorage`); live mode uses only the Supabase adapters (`repositories/supabase/supabaseCustomer.ts`)
and shows an error state on failure — never demo data.

## 14. Service experiences (Phase 05)

**Routes and chunks.** `/services` (hub), `/repairs`, `/trade-in`, `/used`, `/after-sales` (landing
pages, one lazy chunk), `/repairs/request`, `/trade-in/request`, `/used/request`,
`/after-sales/request` (request flows, lazy chunks) and `/account/requests/:number` (tracking,
inside the account layout). Staff screens live at `/admin/repairs`, `/admin/trade-in`,
`/admin/used-requests` and `/admin/after-sales` (list + detail each, `RequireModule` + the database
permission checks). Landing pages are plain scrolling pages — no scroll hijacking — and the home
Trade-In / Repairs promos link straight into the request flows. A product page's "trade in for this"
link (`/trade-in?product=slug`) pre-selects that product as the target device.

**One request model.** Every service request is a row of `service_requests` (`kind` = `repair`,
`trade_in`, `used`, `after_sales`) with a customer-facing number that is not the primary key
(`RP-` / `TI-` / `UD-` / `AS-YYYY-000001`, one sequence per kind). Events (`service_events`,
append-only, `visible_to_customer`), offers (`service_offers`) and media (`service_media`) hang off
it. The frontend mirrors the rules in `src/domain/services/*` (statuses, validation, media checks)
and a SQL-parity test keeps them aligned with the migrations.

Lifecycles (terminal = completed / cancelled / rejected / not available):

| Kind        | Statuses                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repair      | New → Under Review → (Consultation Required) → Device Received → Diagnosing → Quote Sent → Customer Approved → Repairing → Quality Check → Ready → Completed; Cancelled               |
| Trade-In    | New → Under Review → (Need More Info / Inspection Required) → Valuation Ready → Offer Sent → Customer Accepted (or Declined) → Device Received → Trade Completed; Rejected; Cancelled |
| Used device | New → Searching Availability → Option Found → Offer Sent → Customer Interested → Reserved → Completed; Not Available; Cancelled                                                       |
| After-sales | New → Under Review → Approved / Rejected → Item Received → Inspection → Exchange / Refund / Warranty handling (by type) → Completed; Cancelled                                        |

"Offer" statuses (Quote Sent, Valuation Ready / Offer Sent, Option Found) are set only by sending an
offer; customer approval statuses only by the customer's own response; after-sales approve / reject
only through the decision action (reason required to reject). Customers can cancel while a request
is still early (`app.service_customer_can_cancel`).

**Repairs and the diagnostic.** Device type → brand → model → diagnostic (component → symptom, or
"I'm not sure", or "Start a consultation") → description → photos / one video → contact + hand-off
(store visit or pickup/delivery) → request number → tracking. The issue model is data
(`repair_catalog` setting: category → component → symptoms, bilingual), so staff can extend it
without code. **No price is ever calculated**: quotes (estimate / final) are sent by staff, audited,
and the repair only proceeds after the customer approves.

The diagnostic (`storefront/services/diagnostic/`) has three equivalent layers:

1. **3D viewer** (`Diagnostic3D.tsx`, three.js core + OrbitControls + RoundedBoxGeometry, all free
   and bundled — no external models or CDN). Generic primitive models per category (smartphone,
   tablet, laptop, watch, earbuds, console) are described as data in `deviceModels.ts`; they are
   labelled "Generic illustration — not an exact picture of your device". The camera is fitted to the
   model's assembled + exploded bounds for any aspect ratio. Controls: drag / touch rotate, wheel /
   pinch zoom, arrow keys and +/− on the focused viewer, Explode (animated, instant with reduced
   motion), Reset, tap to select. Selecting highlights the part (orange emissive), dims the others and
   opens the symptoms panel. It renders on demand (no idle animation loop work) and disposes all GPU
   resources on unmount. Quality Auto / Low / High (Auto picks Low on few cores, little memory or
   Data Saver; Low = no antialiasing, pixel ratio 1, no shadows).
2. **2D diagram** (SVG, front + back outlines, parts drawn largest first so small parts stay tappable)
   — used when WebGL is unavailable, when the context is lost, or by choice ("Use 2D view"). When
   WebGL is missing the 3D toggle is hidden and an honest notice is shown.
3. **Accessible parts list** (radio group) + symptom radios + "I'm not sure" — always present; the
   canvas and SVG are mirrors of it, so the request never depends on graphics.

**Bundle.** three.js is only in the `Diagnostic3D` chunk, dynamically imported by the diagnostic
step. `npm run check:bundle` (part of `npm run check`) fails if three.js appears in any other chunk
or if the storefront entry exceeds 400 kB; E2E scenario I asserts that Home, Store, Product, Cart and
Account never request the chunk. Service-only UI strings live in `i18n/messages/services.{ar,en}.ts`
and are registered by the service chunks (`i18n/extraMessages.ts`), so the entry chunk does not carry
them; keys stay type-checked and parity-tested.

**Trade-In valuation semantics.** The customer describes the current device (brand, model, storage,
colour, battery %, tax paid, opened / repaired, condition checklist incl. "No known issue",
accessories: original box, charger, cable, original accessories, receipt, photos with guidance) and
picks the target from the **live catalog** (exact variant id, current price shown) or enters a
manual target. There is **no automatic valuation**. Staff send an offer with Current Device Value;
for a catalog target the New Device Price is read from the catalog at send time (`app.variant_pricing`,
staff cannot override it — `catalog_price_only`), for a manual target staff enter it. The database
computes Difference = New Device Price − Current Device Value (a check constraint enforces it),
stores a snapshot of the target, an optional inspection note and an expiry (default
`services.tradeIn.offerValidityDays`). Customers see "Final valuation may change after physical
inspection", accept or decline; accepting **does not create an order**.

**Used-device requests.** No live used catalogue. Fields: brand, model, storage, colour, battery
preference (90%+, 85–89%, 80–84%, No specific preference / بدون تفضيل محدد), tax preference,
budget, notes. Staff answer with a proposal (device details, price, photos, note); the customer marks
it Interested / Not interested.

**After-sales.** Exchange, Return and Warranty requests are tied to an order item the customer owns
in a delivered / completed order — checked by the database (`not_eligible`, `not_delivered`,
duplicate open request per item and type refused). The customer must acknowledge the policy; the
policy version (`services.afterSales.policyVersion`) is stored with the request and a changed policy
is refused until re-acknowledged. Staff approve / reject (reason required), request info, move the
status and add notes / updates — all audited.

**Media security.** Private buckets `repairs`, `trade-in`, `after-sales`, `used-requests`. Files are
uploaded before submit to `<uid>/<uuid>.<ext>` in the caller's own folder and attached by path; the
database re-validates every reference (object exists, owner folder, UUID path, MIME ↔ extension from
the stored object metadata, size and count limits, video rules) — the browser's MIME type is never
trusted alone (the client also sniffs magic bytes). Readable by the owner and staff with the kind's
view permission only (storage policy via `app.service_media_visible_to_actor`); anonymous users and
other customers get nothing; the app uses 15-minute signed URLs. Images are compressed in the browser
(longest side ≤ `imageMaxDimension`, quality `imageQuality`, detail kept for diagnosis); limits are
settings and shown up front. Camera capture (`capture="environment"`), preview, remove, replace,
labels (front, back, damage…) and retry are supported; a failed upload never clears the form.

**Drafts.** Each flow keeps a draft in this browser (`service-draft:<flow>`, 14 days) with the typed
fields and references to already-uploaded files only — never file blobs. On return the customer sees
Restore / Discard. Drafts survive the sign-in round trip.

**Notifications.** Reuse the Phase 04 framework (`app.notify`, category `service`, mandatory like
orders): repair quote ready / status / ready; trade-in info needed / inspection / offer ready /
accepted / rejected; used option found / offer sent / not available; after-sales approved / rejected /
inspection / completed. Dedupe keys `service:<id>:<event>` make every producer idempotent; action links
open `/account/requests/<number>`.

**WhatsApp.** The request page builds a context message (service, number, device) with
`buildWhatsAppLink` — no internal notes. With no WhatsApp number configured it says so and points to
the contact page instead of showing a broken link.

**Analytics hooks.** `lib/analytics/track.ts` records `repair_started`, `repair_submitted`,
`diagnostic_part_selected`, `trade_in_started`, `trade_in_submitted`, `used_request_submitted`,
`after_sales_submitted` in-page only (a `malek:analytics` DOM event + small ring buffer). Nothing is
sent to any external or paid service.

**Demo vs live.** Demo mode runs `domain/services/demoServices.ts` (same rules, `localStorage`,
media previews kept in the browser within a budget) with four seeded requests (one per kind, numbers
`…-900001`) that have **no owner** — they appear only in the staff queues, badged Demo. Live mode uses
only the Supabase adapters and shows error states on failure; it never falls back to demo data.

**Higgsfield (optional, not used).** Higgsfield was considered for optional marketing illustrations.
Its generation required a paid plan ("Requires basic plan or higher"), so per the rules it was not
used and no credits were spent. All service artwork is local SVG (`ServiceArt.tsx`) and the 3D
models are code-defined primitives; there is no Higgsfield SDK, key, asset or runtime dependency.

## 15. Admin control center (Phase 06)

**Shape.** `/admin/*` is loaded only by staff: `AdminRoot` (dictionary + per-user language) →
`AdminShell` (sidebar / mobile drawer, persistent **Demo / Live** badge) → one lazy chunk per module
(`moduleRoute(path, moduleId, load)` in `src/admin/routes.tsx`), each wrapped in `RequireModuleId`.
The module registry (`src/admin/modules.ts`) drives the sidebar, route guards and the "planned"
pages that remain for the Site Editor (07), SEO (08) and Integrations (09). Hiding a link is never
the security boundary: every read and write is a `security definer` RPC that checks the permission
again.

**Port.** `AdminRepository` (`src/repositories/adminTypes.ts`) maps 1:1 to the admin RPCs in
`supabase/migrations/20260929100000…100400_admin_*.sql`. Every response is parsed with the zod
schemas in `src/domain/admin/schemas.ts`; `src/domain/admin/contracts.test.ts` parses samples
captured from the real SQL (`__fixtures__/admin-samples.json`, refreshed with
`UPDATE_CONTRACT_SAMPLES=1 npm run test:db`). The demo adapter runs the same rules in the browser
(`src/domain/admin/demo/*`: permissions, validation codes, stale detection, audit) and a parity suite
keeps the two aligned. Business refusals come back as `{ ok: false, code }` and are shown with the
`problems.*` texts; permission refusals throw `forbidden`.

**UI kit** (`src/admin/ui/`). `DataTable` (internal scroll, sticky header, labelled row selection),
`BulkBar`, `Pagination`, WAI-ARIA `Tabs` + `TabPanel`, fields (bilingual `LocalizedField`),
`Dialog` / `ConfirmDialog` on native `<dialog>` (affected-item list, optional / required reason for
the audit log, type-to-confirm, irreversible warning — no `window.confirm`), `useDirtyGuard`
(router blocker + `beforeunload`) with `DirtyBar`, `useAdminAction` (runs a write, turns refusal codes
into text, refreshes `['admin']` and storefront `['public']` queries), `QueryState` (loading /
empty / forbidden / unavailable / invalid-data states), `Charts` (dependency-free bars with a table
equivalent), `DiffTable`, and **`SchemaForm`** — an editor generated from a zod schema (bilingual
text, bounded numbers, enums, toggles, nullable groups, repeatable lists) used by the settings
workspace and the page-section editor, so the admin validates with the exact schemas the storefront
parses. Labels come from `fieldLabels` / `fieldHints` / `fieldOptions` in the admin dictionary.

**Concurrency.** Mutable records carry `updatedAt` (settings drafts carry `draftUpdatedAt` and a base
version). Saves send the value the editor loaded; the database refuses with `stale` /
`draft_conflict` instead of overwriting a newer change, and the UI explains and offers a reload.
Publishing a draft built on an older version needs an explicit "publish anyway" with a reason.

**Settings workspace.** `SettingWorkspace` handles any key of `SETTING_SCHEMAS`: edit → validate →
save draft → review the diff against the published value → publish (optional note) → version
history → compare any version → restore (published as a new version). Dedicated screens reuse it:
`/admin/shipping`, `/admin/receipts` (live preview on a fake order with the storefront's own
`InvoiceSheet`, which now renders the published `receipt` setting) and `/admin/legal` (seven policy
pages; `/legal/:page` on the storefront, linked from the footer only once a body is published).
Payments accept COD, InstaPay and Split only (strict schema); InstaPay details are a nullable group
that stays empty until the owner fills it. Loyalty is a foundation setting, off by default.

**Structured page content.** `/admin/page-content` edits the Home / Apple / Offers rows of
`page_sections`: visibility plus each section's fields, validated by `SECTION_PROP_SCHEMAS`, published
at once. Since Phase 07 each such edit is also recorded as a layout version, and order / layout /
design live in the Site Editor (§16), which writes the same rows.

**Data tools.** Import is CSV only (Excel "CSV UTF-8"): parse locally (untrusted text, control
characters stripped, 2 MB / 2,000 rows) → map columns → `admin_import_preview` validates every row on
the server (formula-looking text rejected, duplicates, unknown brand / category, permissions,
below-reserved stock) → commit all-or-nothing or valid rows only. Exports are CSV with formula
neutralisation (`=`, `+`, `-`, `@`, tab, CR get a leading apostrophe) or JSON. The backup is a JSON copy
of settings, catalog and content; it contains no secrets or customer data and does not replace the
provider's backups. Demo cleanup deletes `is_demo` rows only.

**Access and audit.** Roles and staff screens mirror the database's escalation rules (no editing a
role at or above your rank, no granting permissions you do not hold, only the owner manages owners,
the last owner cannot be removed or suspended). Staff are added by the e-mail of an existing account;
no passwords are ever created. The audit viewer filters by actor, action, module, entity and dates,
deep-links with `?id=`, and shows a before / after diff with secret-looking keys masked
(`redactSecrets`, mirroring `app.redact_secrets`).

**Analytics.** Aggregates computed in SQL from orders, carts and service requests for a date range;
demo rows excluded unless included on purpose (then labelled). Charts show no customer names or
contact details. Conversion is cart → order; there is no traffic tracking and no paid provider.

## 16. Visual Site Editor (Phase 07)

**What it edits.** The real storefront — no second website builder. Page layouts for Home, Apple and
Offers are the same ordered `page_sections` rows the storefront renders through the section registry
(`SECTION_COMPONENTS` + `SECTION_PROP_SCHEMAS`), plus a structured per-section `design`
(`background`: default / muted / dark / brand tint, `spacing`: compact / default / relaxed — enum
values only, rendered as `data-*` attributes; there is no free-form CSS anywhere). Design settings go
through the existing settings workflow (§15): `theme` (preset, whitelisted colour tokens, type scale,
heading weight, section spacing, corner radius), `brand`, `navigation` (header, mobile tab bar and the
new optional `footer` block: extra links, services / social / hours toggles, note), `seo` (+ default
share image) and the new `page_seo` setting (per-page title / description / share image for the
three pages, Arabic + English, empty = defaults). The Apple authorized-reseller badge is a
`trust_feature` section (hide / remove it in the layout) whose text and site-wide on/off switch are
the `trust` setting, edited in place from the inspector.

**Drafts, publish, versions.** `supabase/migrations/20261001100000_site_editor.sql` adds
`page_layout_drafts` (one per page, with `base_version`) and append-only `page_layout_versions`.
RPCs: `site_editor_overview / get_page / save_draft / discard_draft / publish / versions / rollback`
(`design.view` to read, `design.edit` to draft, `design.publish` to publish or roll back; direct table
writes are denied by RLS + immutability triggers). `app.validate_page_layout` checks structure (≤ 40
sections, slug keys, unique keys, known types, object props ≤ 64 kB, closed design keys); the editor
validates each section against its zod schema before saving. The first publish records the previous
layout as version 1 ("Initial layout"), publish and rollback replace the live rows in one
transaction and record a new version, and a Phase 06 live section edit is recorded as a version too.
A draft whose base version is older than the live one is refused (`draft_conflict`) unless the
publisher confirms "publish anyway". Every draft save, discard, publish and rollback is audited with
before / after layouts under the audit module `design`.

**Editor** (`/admin/site-editor`, lazy chunk, `src/admin/pages/siteEditor/`). Workspace tabs: Home,
Apple, Offers, Design & brand, Menus & footer, SEO. Page tabs show the section list (select, show /
hide, duplicate, remove with confirmation, move up / down, mouse drag and drop, and a keyboard
"pick up" on each handle — Space / Enter, arrows, Space / Enter to drop, Escape to cancel — announced
in a live region), an **Add section** dialog (only types the page supports; types needing references
such as a campaign or brand are offered only when published data exists; new sections start with
visible placeholder text) and the inspector: visibility, section design, then the section's fields
generated by `SchemaForm` from `SECTION_PROP_SCHEMAS`, with reference pickers (`choices`: brands,
categories, offers, campaigns, trust items from the public storefront data — no catalog permission
needed) and custom controls (`custom`: safe route picker for every `href`, raster image upload for
images and share images, ordered hand-picked products for `product_rail` `kind: 'manual'`). The whole
document (three layouts + design settings) is one undo / redo history (Ctrl/⌘+Z, Ctrl+Shift+Z /
Ctrl+Y; typing in one field coalesces). **Save draft** stores changed pages and settings as server
drafts; **Publish…** lists what would go live (pages with drafts or changes, setting drafts), locks
items the user may not publish, takes a version note and reports each result. **Versions** lists a
page's history with a section-level compare against the live page and restore (a new version; an
open draft for that page is discarded first). Layout adapts to the editor's own width: three panes
(structure | preview | inspector), two (switchable panel + preview) or one (pane switch), with every
pane kept mounted so the preview never reloads.

**Preview = the real storefront.** The preview is a same-origin `<iframe name="malek-preview">` on
the storefront URL (`/`, `/apple`, `/offers`, Arabic or `/en/…`). `createRuntime` sees the frame
name and lazily loads `src/preview/previewRuntime.ts`, which builds the normal runtime and overrides
exactly two reads with what the editor posts (`src/preview/protocol.ts`, zod-validated, origin and
source checked): `content.listPageSections` (the working layout) and
`settings.listPublishedSettings` (the working design settings). Routes, components, catalog data and
the section registry are the storefront's own. The frame shows a "Preview — not published" banner;
the preview URL on its own shows nothing unpublished (drafts only ever come from an authorised editor
session). Devices are true CSS widths (390 / 820 / 1280 px) scaled to fit; the editor can open the
same preview in a new window, and the preview scrolls to and outlines the selected section.

**Sample store preview.** "Preview sample store" loads the same preview frame named
`malek-preview-sample`: the demo engine in an isolated storage namespace (`malek:sample:v1:`), so the
sample never mixes with the browser's real or demo state, with a "DEMO CONTENT" banner and an
optional "apply my unpublished changes" switch. In live mode it is available only when the published
`features.showDemoCatalog` setting is on, and the frame refuses it otherwise (and whenever it is not
opened by the editor).

**Storefront changes** (all small; the entry chunk is smaller than before Phase 07):
`RenderSections` wraps a section in the design `data-*` wrapper only when a design is set; new
`media_banner` section (1–4 images with localized alt text, internal / https / demo-upload URLs only;
SVG and `javascript:` refused); `product_rail` `manual` source and `offer_group` / `offer_rail`
`slugs`; the Offers page renders any section type (campaign banners, product rails, CTAs) and keeps
its jump links for offer groups; `ThemeController` sets `data-type-scale / heading-weight / spacing /
radius` from enum values (CSS in `tokens.css`); `SiteFooter` reads the optional footer block;
`usePageMeta({ seoPage })` applies `page_seo` and the default share image. Admin and preview chunks
no longer put their `modulepreload` lists in the storefront entry (`vite.config.ts`).

**SEO integration (no separate SEO system).** Page metadata for Home / Apple / Offers is resolved by
one pure function, `resolveSeo` (`src/domain/seo/pageSeo.ts`), used by both the storefront
(`usePageMeta`) and the editor: `page_seo` override → the page's own default title / description →
the site `seo` defaults, with the title template applied; the share image comes from `page_seo`, then
the page's first visible image banner (`sectionShareImage`, store paths / https only), then
`seo.ogImage`, then the bundled default. Canonical + hreflang (`seoUrls`, Arabic as x-default) and
robots (`robotsContent`; demo deployments never indexed) are shared the same way. The SEO tab (and a
"Search & sharing for this page" shortcut on each page tab) shows an **SEO preview** per page and
language: a search-result snippet with length checks, a social share card, canonical / hreflang /
robots, the source of each value, warnings (long / short text, missing English, default image) and
what is published now. It is computed from the working drafts of the existing `seo` / `page_seo`
settings and the working page layout; the preview frame applies the same drafts, so its real
`document.title` and meta tags match (checked end-to-end). Staff without access to the
content-scoped `seo` setting see its published public values.

**Media.** Uploads go to the existing public `site-media` bucket (insert needs `design.edit` in the
storage policy); the editor accepts PNG / JPEG / WebP / AVIF up to 10 MB, compresses in the browser
first and never uploads SVG. Demo mode keeps uploads inline in the browser.
