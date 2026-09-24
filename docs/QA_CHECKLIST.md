# QA Checklist

Legend: ✅ PASS (verified) · ❌ FAIL · ⏳ PENDING (delivered in a later phase) · 🟡 PARTIAL (foundation in place).
Evidence names the automated check that verifies the item. Updated at the end of every phase.

_Last updated: Phase 02 — 2026-09-24._

## Phase 01 — Foundation

| Area                                                                                       | Status            | Evidence                                             |
| ------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------- |
| Production build (`dist/`, SPA fallback files)                                             | ✅                | `npm run build`                                      |
| TypeScript strict, no errors                                                               | ✅                | `npm run typecheck`                                  |
| Lint (typescript-eslint strict, react-hooks, jsx-a11y), zero warnings                      | ✅                | `npm run lint`                                       |
| Formatting                                                                                 | ✅                | `npm run format:check`                               |
| Arabic RTL default (`/`, `lang=ar-EG`, `dir=rtl`)                                          | ✅                | `storefront.test.tsx`, `e2e/smoke.spec.ts`           |
| English LTR (`/en`, `dir=ltr`) and same-page language switch                               | ✅                | `storefront.test.tsx`, e2e                           |
| Dictionary parity ar/en (keys + placeholders, no empty strings)                            | ✅                | `i18n.test.ts`                                       |
| Admin per-user dashboard language                                                          | ✅                | `admin.test.tsx`, e2e                                |
| EGP formatting (Arabic/Latin digits, English code)                                         | ✅                | `money.test.ts`                                      |
| Africa/Cairo time incl. DST, opening hours past midnight                                   | ✅                | `zoned.test.ts`, `openingHours.test.ts`              |
| Brand tokens + WCAG AA contrast of semantic pairs                                          | ✅                | `features.test.ts`                                   |
| Logo integrated unmodified; derived icons                                                  | ✅                | `public/brand/`, `npm run brand:icons`               |
| Store details from settings (no hard-coded store data in components)                       | ✅                | `storefront.test.tsx`, `domain.test.ts`              |
| WhatsApp: no broken links; guidance when unconfigured; wa.me when configured               | ✅                | `storefront.test.tsx`, `phone.test.ts`               |
| Browsing never requires login                                                              | ✅                | `storefront.test.tsx`                                |
| Account routes require sign-in; safe `?next=` redirects                                    | ✅                | `storefront.test.tsx`, `features.test.ts`            |
| Email OTP sign-in flow (demo adapter; live uses Supabase email OTP)                        | ✅ demo / ⏳ live | `storefront.test.tsx`; live needs a Supabase project |
| Admin requires sign-in + staff role; module-level permission gating                        | ✅                | `admin.test.tsx`, e2e                                |
| Demo vs live data mode separation; live never falls back to demo                           | ✅                | `env.test.ts`, visible demo banner                   |
| Service-role key refused in frontend                                                       | ✅                | `env.test.ts`                                        |
| Migrations apply cleanly and are idempotent                                                | ✅                | `npm run test:db`                                    |
| RLS enabled on every public table                                                          | ✅                | `01_schema.test.sql`                                 |
| RLS/authorization boundaries (anon vs customer vs staff)                                   | ✅                | `02_access`, `03_settings`, `04_storage_demo`        |
| RBAC anti-escalation, last-owner protection, first-owner bootstrap                         | ✅                | `02_access.test.sql`                                 |
| Draft vs live content separation (settings)                                                | ✅                | `03_settings.test.sql`                               |
| Settings versioning + rollback + conflict detection                                        | ✅                | `03_settings.test.sql`                               |
| Audit log written and immutable                                                            | ✅                | `02_access.test.sql`                                 |
| Storage folder isolation (customer uploads)                                                | ✅                | `04_storage_demo.test.sql`                           |
| Demo data deletion removes only demo rows                                                  | ✅                | `04_storage_demo.test.sql`                           |
| DB ↔ frontend contracts (roles, permissions, settings)                                     | ✅                | `scripts/db/check-contracts.mjs`                     |
| Accessibility: axe WCAG 2.1 A/AA — home (ar/en), sign-in, admin dashboard, role matrix     | ✅                | e2e (mobile + desktop)                               |
| Keyboard: skip link, visible focus, modal drawer (Escape), focusable scroll regions        | ✅                | e2e, manual review                                   |
| Mobile (Pixel 7) / tablet (820×1180) / desktop (1366) layouts, no horizontal page overflow | ✅                | e2e (3 projects; Phase 02 adds large desktop 1920)   |
| Error states: 404, page/root error boundary, config error, backend unavailable             | ✅                | `storefront.test.tsx`, manual review                 |
| No console errors on load                                                                  | ✅                | e2e                                                  |

## Phase 02 — Storefront

| Area                                                                                                                                                               | Status           | Evidence                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------- |
| CMS-driven home: 13 sections in the required order via the section registry (zod-validated props; invalid/unknown sections skipped)                                | ✅               | `storefrontPages.test.tsx`, `content.test.ts`, `05_catalog.test.sql` |
| Hero campaign (iPhone 18 Pro / Pro Max) + iPhone Duo teaser from content entries; brand fallback; restrained motion, reduced-motion + adaptive motion              | ✅               | `storefront.test.tsx`, `seo.test.ts` (adaptive motion), screenshots  |
| Apple landing: own h1, hero, iPhone/Mac/iPad/Watch/AirPods/Accessories lines, latest releases, Apple offers, Apple trade-in, Authorized Reseller (hideable)        | ✅               | `storefrontPages.test.tsx`, e2e                                      |
| Store / category / brand / search / budget listings; hybrid premium + grid cards; dynamic categories & brands                                                      | ✅               | `storefrontPages.test.tsx`, e2e                                      |
| Filters (brand, category, price, storage, colour, availability, offers, new) + sort (featured, newest, price ↑/↓, best selling) in the URL; removable chips        | ✅               | `engine.test.ts`, `storefrontPages.test.tsx`, e2e                    |
| Mobile filter drawer (modal dialog, "Show N results"); desktop sticky sidebar                                                                                      | ✅               | `storefrontPages.test.tsx`, e2e                                      |
| Free Postgres search (trigram + Arabic normalisation) ≡ in-memory demo search                                                                                      | ✅               | `engine.test.ts` ↔ `05_catalog.test.sql` (same expectations)         |
| Search by budget (presets from settings, min/max form, Arabic-Indic digits, validation)                                                                            | ✅               | `storefrontPages.test.tsx`, `content.test.ts`                        |
| Load-more pagination, skeletons, empty and error states                                                                                                            | ✅               | `storefrontPages.test.tsx`, manual review                            |
| PDP: gallery (images + video with captions contract), variant radios (keyboard), URL-synced selection, variant price/SKU/stock/media/warranty                      | ✅               | `storefrontPages.test.tsx`, `engine.test.ts`, e2e                    |
| Out of stock → "Out of stock" + Notify Me (validated intake); coming soon → waitlist; price TBA                                                                    | ✅               | `storefrontPages.test.tsx`, `06_requests.test.sql`, e2e              |
| Spec groups from data (approved only), warranty from data (no hard-coded label), demo spec/price notes                                                             | ✅               | `engine.test.ts`, `05_catalog.test.sql`, `storefrontPages.test.tsx`  |
| Wishlist / compare card action interface (renders nothing until Phase 04 — no dead buttons)                                                                        | ✅               | `ProductCard.tsx` (`renderActions`)                                  |
| Add to cart / Buy now disabled with honest note (cart is Phase 03); call + WhatsApp paths                                                                          | ✅               | `storefrontPages.test.tsx`                                           |
| Context-aware WhatsApp (product, storage, colour, SKU, price); never a broken link                                                                                 | ✅               | `storefrontPages.test.tsx`                                           |
| Offers page groups (flash, price drops, bundles, gifts, promo codes, limited, Apple, accessories) with anchors; offer detail; countdowns from timestamps           | ✅               | `storefrontPages.test.tsx`, `content.test.ts`, e2e                   |
| New releases, Coming soon (coming soon / waitlist only / pre-order states), News (type tabs), entry pages with related products                                    | ✅               | `storefrontPages.test.tsx`, e2e                                      |
| Contact page from settings only (no invented social/map URLs; setup panel for staff/demo)                                                                          | ✅               | `storefrontPages.test.tsx`                                           |
| Trust items settings-driven                                                                                                                                        | ✅               | `storefrontPages.test.tsx` (hidden item), e2e                        |
| Demo/live separation: live never falls back to demo; demo rows only with staging flag (labelled); stock quantities never exposed                                   | ✅               | `storefrontPages.test.tsx`, `05_catalog.test.sql`                    |
| Localized content (`localized_text`, one record per product — no per-language duplicates); mixed Arabic/Latin names bidi-isolated                                  | ✅               | `seo.test.ts` (bidi), schema review                                  |
| Migrations: RLS on all new tables, no direct anon access, indexes (trigram, FKs, windows), demo registry, idempotent                                               | ✅               | `npm run test:db` (204 assertions)                                   |
| SEO: titles, descriptions, canonical (no query), hreflang, OG (type/url/image), Product JSON-LD (live, non-demo only), Breadcrumb/Article, noindex rules           | ✅               | `seo.test.ts`, `docs/ARCHITECTURE.md` §9 (SPA limits documented)     |
| Accessibility: axe WCAG 2.1 A/AA on every storefront page, filter drawer and Notify-me dialog; semantic prices (`<data>`, `<del>` + labels); no colour-only status | ✅               | e2e (4 projects)                                                     |
| Responsive: mobile / tablet / desktop / large desktop; no horizontal overflow on any page                                                                          | ✅               | e2e (4 projects), screenshots                                        |
| Performance: lazy images, route-level code splitting, storefront never downloads the admin bundle                                                                  | ✅               | e2e (bundle assertion), `npm run build` chunk list                   |
| Live Supabase project run-through                                                                                                                                  | ⏳ owner project | adapters + RPC contracts tested locally (see README §4)              |

## Later phases (tracked from the specification)

| Area                                                                                           | Status | Phase |
| ---------------------------------------------------------------------------------------------- | ------ | ----- |
| Cart, account merge, verified checkout, 30-min reservation                                     | ⏳     | 03    |
| COD, InstaPay (manual verification), split payment, pay-at-store toggle                        | ⏳     | 03    |
| Orders, receipt, invoice/print, shipping (manual fee), pickup, WhatsApp handoff                | ⏳     | 03    |
| Manual-review (fraud) rules                                                                    | ⏳     | 03    |
| Wishlist, recently viewed, compare, reviews; notify-me/waitlist follow-up & account linking    | ⏳     | 04    |
| Notifications framework, abandoned cart, recommendations                                       | ⏳     | 04    |
| Trade-In, used requests, repairs + 3D, uploads, after-sales                                    | ⏳     | 05    |
| Admin modules (products … audit viewer), import/export, analytics                              | ⏳     | 06    |
| Visual site editor (drag/drop, draft/preview/publish, undo, rollback)                          | ⏳     | 07    |
| SEO (sitemap, JSON-LD, prerender), PWA service worker, performance settings, onboarding wizard | ⏳     | 08    |
| Integrations (all optional, disabled by default)                                               | ⏳     | 09    |
| Full QA, security & RLS review, backups, launch checklist                                      | ⏳     | 10    |
