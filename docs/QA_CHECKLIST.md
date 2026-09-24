# QA Checklist

Legend: ✅ PASS (verified) · ❌ FAIL · ⏳ PENDING (delivered in a later phase) · 🟡 PARTIAL (foundation in place).
Evidence names the automated check that verifies the item. Updated at the end of every phase.

_Last updated: Phase 01 — 2026-09-24._

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
| Mobile (Pixel 7) / tablet (820×1180) / desktop (1366) layouts, no horizontal page overflow | ✅                | e2e (3 projects)                                     |
| Error states: 404, page/root error boundary, config error, backend unavailable             | ✅                | `storefront.test.tsx`, manual review                 |
| No console errors on load                                                                  | ✅                | e2e                                                  |

## Later phases (tracked from the specification)

| Area                                                                                           | Status | Phase |
| ---------------------------------------------------------------------------------------------- | ------ | ----- |
| Catalog, variants, variant pricing & stock, search, filters, budget search                     | ⏳     | 02    |
| Apple landing, offers, new releases, coming soon, news, contact page                           | ⏳     | 02    |
| Cart, account merge, verified checkout, 30-min reservation                                     | ⏳     | 03    |
| COD, InstaPay (manual verification), split payment, pay-at-store toggle                        | ⏳     | 03    |
| Orders, receipt, invoice/print, shipping (manual fee), pickup, WhatsApp handoff                | ⏳     | 03    |
| Manual-review (fraud) rules                                                                    | ⏳     | 03    |
| Wishlist, recently viewed, compare, reviews, notify me, waitlist                               | ⏳     | 04    |
| Notifications framework, abandoned cart, recommendations                                       | ⏳     | 04    |
| Trade-In, used requests, repairs + 3D, uploads, after-sales                                    | ⏳     | 05    |
| Admin modules (products … audit viewer), import/export, analytics                              | ⏳     | 06    |
| Visual site editor (drag/drop, draft/preview/publish, undo, rollback)                          | ⏳     | 07    |
| SEO (sitemap, JSON-LD, prerender), PWA service worker, performance settings, onboarding wizard | ⏳     | 08    |
| Integrations (all optional, disabled by default)                                               | ⏳     | 09    |
| Full QA, security & RLS review, backups, launch checklist                                      | ⏳     | 10    |
