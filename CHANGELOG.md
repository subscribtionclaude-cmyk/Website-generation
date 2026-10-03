# Changelog

All notable changes to the MALEK STORE platform. Dates are in Africa/Cairo time.
Versions follow [Semantic Versioning](https://semver.org/); `-rc` releases are release candidates,
not launch approvals.

## [1.0.0-rc.1] — 2026-10-03

First release candidate (Phase 10 — QA / staging / launch readiness). No new features: hardening,
launch tooling and documentation. Details: [`docs/RELEASE_NOTES_v1.0.0-rc.1.md`](docs/RELEASE_NOTES_v1.0.0-rc.1.md).

### Security

- Content-Security-Policy and security headers for the static host (`public/_headers`), applied by
  the local preview too; a new E2E spec fails on any CSP violation (storefront, admin, Site Editor
  preview frame).
- Zod runs in jitless mode everywhere (no `eval` under the CSP).
- Server-side provider calls never follow redirects (SSRF hardening).
- Guest waitlist / stock-alert requests are rate-limited per visitor and globally.
- Changing an integration requires an MFA session when "Require MFA for admins" is on.
- Rejected webhook requests are logged at most 200 per hour per integration.

### Fixed

- Unknown URLs now return a real **404** status (known app routes still get the app with 200).
- Every `is_demo` table is registered for demo cleanup; read-only launch audit
  `supabase/scripts/demo_audit.sql`.
- The base seed ships with search-engine indexing off; publishing "Allow indexing" is the explicit
  launch switch (staging and fresh projects can no longer be indexed by accident).
- An open tab that requests a chunk removed by a newer deploy reloads once instead of erroring.
- Selecting a section in the Site Editor scrolls only the preview; it no longer scrolls the editor
  page itself (which could move controls under the pointer and lose a click).
- Unit tests no longer time out on slower CI runners; the database test script no longer stops
  silently when the test runner prints coloured output.

### Performance

- The admin route table loads on the first visit to `/admin`; storefront visitors download ~7 KB
  less. Storefront entry 399,162 B (budget 409,600 B); initial JavaScript 620.4 KiB.
- New bundle guard: total initial JavaScript (entry + modulepreloaded chunks) budget of 650 KB.

### Tooling and operations

- `npm run check:links` — every internal link on the prerendered pages resolves.
- CI: database tests on every push; E2E sharded per viewport (mobile, tablet, desktop, large desktop).
- New docs: launch runbook, rollback, operations, security review, launch readiness report.

## Development phases before the first release candidate

The package stayed at version 0.1.0 during development; phases were not released separately.

### Phase 09 — optional integrations (2026-10-02)

WhatsApp Cloud, Odoo (read-only), Google Analytics (consent-first), AI draft suggestions, social
sign-in and courier / SMS / email / POS / search / storage / backup interfaces with mocks; all off by
default with manual fallbacks; server-side secrets only; Edge Functions for test / sync / dispatch /
webhooks.

### Phase 08 — content, SEO, PWA and polish (2026-10-02)

Prerendered public pages, JSON-LD, sitemap and robots, service worker with offline page, setup
wizard, admin SEO module, performance and accessibility pass.

### Phase 07 — visual Site Editor (2026-09-28)

Drag-and-drop page sections with a same-origin live preview, drafts, publish, version history and
rollback, SEO preview.

### Phase 06 — admin control center (2026-09-28)

Orders, catalog, customers, services, content, settings workflow (draft / publish / versions),
import / export, staff and roles, audit log.

### Phase 05 — service experiences (2026-09-26)

Repairs (3D / 2D diagnostic), trade-in, used devices, after-sales requests and staff workflows.

### Phase 04 — customer features (2026-09-25)

Accounts, wishlist, compare, reviews, inbox, recommendations. V1 payment methods are exactly COD,
InstaPay and split payment (pay-at-store removed).

### Phase 03 — commerce (2026-09-25)

Cart, checkout, stock reservations, orders, payment records, invoices, manual review rules.

### Phase 02 — storefront (2026-09-24)

CMS-driven home, catalog, product pages, offers, news, contact, search and search by budget.

### Phase 01 — foundation (2026-09-24)

Project foundation, bilingual RTL / LTR infrastructure, brand tokens, Supabase schema foundation,
roles and permissions, first-owner bootstrap, demo / live data modes.
