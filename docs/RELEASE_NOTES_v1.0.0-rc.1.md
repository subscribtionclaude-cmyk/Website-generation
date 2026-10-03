# MALEK STORE v1.0.0-rc.1 — release notes

**Release candidate, 2026-10-03.** This is not a launch approval: the store goes live only after the
owner actions in [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) and the
[launch runbook](LAUNCH_RUNBOOK.md). Version identifier: `1.0.0-rc.1` (`package.json`, git tag
`v1.0.0-rc.1`).

## What is in this release

The complete platform built in Phases 01–09 — bilingual storefront (Arabic RTL / English LTR),
catalog, cart and checkout (COD, InstaPay, split payment), customer accounts, repairs, trade-in,
used devices, after-sales, admin control center, visual Site Editor, SEO / PWA, optional
integrations — plus the Phase 10 launch hardening below. No new features were added in Phase 10.

## Changes in Phase 10

**Security**

- Content-Security-Policy and security headers for the static host; an E2E spec fails on any CSP
  violation (storefront, admin, Site Editor preview frame).
- Validation runs without `eval` (Zod jitless) so the strict CSP holds.
- Server-side provider calls never follow redirects (SSRF hardening).
- Guest waitlist / stock-alert requests are rate-limited (per visitor and globally).
- Integration changes require an MFA session when "Require MFA for admins" is on.
- Rejected webhook requests are logged at most 200 per hour per integration.

**Correctness and launch safety**

- Unknown URLs return a real 404 status; known routes still load the app.
- Demo cleanup covers every demo table; new read-only launch audit (`supabase/scripts/demo_audit.sql`).
- The base configuration ships with search-engine indexing **off**; switching it on is the
  explicit launch step.
- Open tabs recover from a deploy (one automatic reload instead of a broken page).

**Performance**

- Storefront visitors no longer download the admin route table: entry 399,116 B (budget
  409,600 B), initial JavaScript 620.4 KiB (new 650 KiB budget).

**Tooling**

- `npm run check:links` (internal link check) in `npm run check`.
- CI runs the database suite on every push and the E2E suite per viewport in parallel.

**Documentation**

- New: [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md), [`ROLLBACK.md`](ROLLBACK.md),
  [`OPERATIONS.md`](OPERATIONS.md), [`SECURITY.md`](SECURITY.md),
  [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md), [`../CHANGELOG.md`](../CHANGELOG.md).
- Updated: README, ARCHITECTURE (§19), DATABASE, DEPLOYMENT, QA_CHECKLIST, PHASE_STATUS.

## Upgrade notes

- Apply `supabase/migrations/20261004100000_launch_readiness.sql` (idempotent). No RPC signature
  changed; `join_waitlist` / `request_stock_alert` can now return `rate_limited` (SQLSTATE 54000).
- Existing projects keep their published `seo.allowIndexing` value — the seed never overwrites
  published settings. New projects start with indexing off.
- Deploy the new `_headers` / `_redirects` with `dist/`. If you add a script, API or frame origin
  in the browser, add it to the CSP in `public/_headers`.

## Validation

| Check                            | Result                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `npm run check`                  | ✅ typecheck, lint, format, seed, 448 unit tests, build, bundle, secrets, links |
| `npm run test:db`                | ✅ 1,122 assertions (SQL suites, concurrency, 59 contract samples)              |
| `npm run test:e2e` (4 viewports) | ✅ 449 passed, 15 skipped by design, 0 failed                                   |
| `npm audit`                      | ✅ 0 vulnerabilities                                                            |

## Known limits

- Not validated on a hosted Supabase project or on the real static host (see
  [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md)).
- Automated browser coverage is Chromium only (mobile, tablet, desktop, large-desktop profiles).
- Optional provider adapters (WhatsApp Cloud, Odoo, GA4, Google / Apple sign-in) are tested against
  stubs, not live accounts; Edge Functions were not executed under Deno.
