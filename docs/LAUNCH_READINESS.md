# Launch readiness report — v1.0.0-rc.1

**Date:** 2026-10-03 · **Branch:** `claude/malek-store-platform-yg5z2q` · **Version:** `1.0.0-rc.1`

## Overall status: **BLOCKED**

The code passes every engineering check that could run here, and **no engineering defect is open**.
Launch is blocked because two **critical validations could not be performed** in the build
environment and must not be assumed:

1. **Hosted Supabase validation** — no dedicated Malek Store Supabase project exists. The only
   reachable projects belong to another application with real data, so applying these migrations
   there was not acceptable, and creating a new project was not possible without the owner (free-plan
   project limit / account decision).
2. **Real static-host validation** — the build environment's network policy blocks the static
   host, so the full build could not be deployed and observed (a small hosting-rules probe was
   deployed but could not be fetched).

Once the owner creates the project and the checks in [Unblocking](#unblocking-the-launch) pass, the
status becomes **READY AFTER OWNER ACTIONS** (the owner content listed below), then
**READY FOR PRODUCTION** when those are done.

## Validation summary

| Area                  | Status           | Detail                                                                                                                                                            |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted Supabase       | ⛔ not performed | no dedicated project; validated on local PostgreSQL with a Supabase shim instead                                                                                  |
| Storage               | ⚠️ local only    | bucket policies, folder isolation, MIME / size limits tested locally (`04_storage_demo`); not on a hosted project                                                 |
| Edge Functions        | ⚠️ not deployed  | handler logic unit-tested (`integrations.server.test.ts`); not executed under Deno or deployed                                                                    |
| Static host / staging | ⛔ not observed  | `_headers` / `_redirects` applied and E2E-tested on the local preview server; ShipStatic probe `https://strong-star-8p5x5jg.shipstatic.com` unreachable from here |
| `npm run check`       | ✅               | typecheck, lint, format, seed check, 450 unit tests (36 files), build, bundle budget, secret guard, link check                                                    |
| Database              | ✅               | 1,122 assertions: 1,056 SQL, 7 concurrency checks, 59 RPC contract samples; migrations re-applied (idempotent)                                                    |
| E2E                   | ✅               | 459 passed, 17 skipped by design, 0 failed — mobile, tablet, desktop, large desktop (Chromium); axe WCAG 2.1 A/AA + overflow in every spec                        |
| CI (GitHub Actions)   | ✅               | checks + 4 E2E shards green on `6e50f48`                                                                                                                          |
| Security review       | ✅               | [`SECURITY.md`](SECURITY.md) — 8 issues fixed, accepted risks listed                                                                                              |
| Dependencies          | ✅               | `npm audit` 0 vulnerabilities                                                                                                                                     |
| Browsers              | ⚠️ Chromium only | Firefox, Safari / iOS and real devices not tested                                                                                                                 |

## Reviews

- **Security** — CSP + security headers, SSRF redirect hardening, guest rate limits with a global
  ceiling, MFA for integration changes, webhook log cap, demo-registry completeness; no secrets in
  the repository, bundle or database. Details and accepted risks: [`SECURITY.md`](SECURITY.md).
- **RLS** — enabled on every `public` table (asserted); 323 `SECURITY DEFINER` functions all pin
  `search_path`; anon has no direct table access; customers see only their own rows; staff access is
  per permission. Tested locally only.
- **PWA / cache** — service worker caches public files and visited public pages only (never admin,
  account, checkout, orders, auth, API, functions, analytics); per-release page caches; `sw.js`,
  manifest and offline page revalidated; one automatic reload after a deploy; kill switch in
  [`ROLLBACK.md`](ROLLBACK.md).
- **SEO / prerender** — 144 prerendered Arabic / English pages with JSON-LD, canonical and hreflang;
  demo builds never indexable; base seed ships with indexing **off** (explicit launch switch);
  unknown URLs return 404; 6,490 internal links resolve.
- **Commerce integrity** — server-authoritative prices, exact variant identity, offer windows,
  30-minute reservations, idempotent checkout, last-unit race (one order), snapshots, money
  constraints (`total = subtotal − discount + shipping`, `paid ≤ total`, `numeric(12,2)`), stock never
  double-decremented, payment verification by permission (+ MFA when required), screenshots never
  verify payments. Payment methods exactly COD / InstaPay / Split.
- **Audit** — every sensitive operation audited; audit log append-only.

## Performance

| Metric                                | Result                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Storefront entry chunk                | **399,722 B** (budget 409,600 B; was 406,201 B at Phase 09)               |
| Initial JavaScript (entry + preloads) | **621.0 KiB** (new budget 650 KiB)                                        |
| three.js                              | only in the lazy repair-diagnostic chunk                                  |
| CLS / LCP                             | Phase 08 E2E checks; CLS < 0.05 even with fonts delayed 700 ms (was 0.23) |

Real-network Core Web Vitals on the production host were not measured (no staging URL reachable).

## Demo / live cleanup

`delete_all_demo_data()` covers every `is_demo` table (registry completeness enforced);
`supabase/scripts/demo_audit.sql` (read-only) checks unregistered demo tables, demo rows, demo media
references, the demo-catalog switch and demo slugs in the public index. Verified locally: after
cleanup the audit is clean while a live product, settings and layouts remain.

## Backup / restore readiness

Documented ([`OPERATIONS.md`](OPERATIONS.md#backups-and-restore)): application export ≠ database
backup; `supabase db dump` (schema + data) before launch, before every migration and weekly; restore
into a new project, verify, then switch. Not rehearsed on a hosted project (none available) — the
staging rehearsal includes one restore.

## Runbooks

- Deployment: [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — 15 ordered steps, environment matrix,
  demo → live transition, owner checklist, smoke test. ✅ written
- Rollback: [`ROLLBACK.md`](ROLLBACK.md) — settings, Site Editor, integrations, frontend, service
  worker kill switch, demo cleanup, database incidents (forward fix; non-destructive guard switches).
  ✅ written

## Owner actions (setup — not engineering failures)

1. Create the dedicated Malek Store Supabase project (free plan) and give the engineer access through
   a secure route (Supabase dashboard / CLI on their machine — never credentials in chat).
2. Choose the hosting account and the domain (free subdomain is fine).
3. Confirm store details (address, landmark, phones, opening hours) — seeded, editable.
4. Enter the WhatsApp number, social links and map link (or leave empty on purpose).
5. Enter InstaPay details (or leave empty on purpose).
6. Confirm the "Apple Authorized Reseller" statement is accurate — or hide / reword it.
7. Write or approve the legal policies (privacy, terms, returns, warranty, shipping, repairs,
   trade-in).
8. Provide the real catalog, prices, stock and images.
9. Confirm the shipping workflow / fee message and the order review thresholds.
10. Enrol MFA, publish "Require MFA for admins", assign staff roles.
11. Decide on optional integrations (none needed to launch).

## Unblocking the launch

On the dedicated project, run [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) steps 2–6 and the staging
rehearsal, and check:

- migrations apply and re-apply cleanly; `pg_tables` reports RLS on every table; Advisors clean;
- storage buckets exist with the listed public / private flags; a customer cannot read another
  customer's upload;
- email sign-in works on the real domain; first-Owner bootstrap works once and refuses a second run;
- (only if integrations are wanted) the Edge Functions deploy and Admin → Integrations → Test
  connection reaches them instead of reporting "Server runtime unavailable";
- the full `dist/` deploys to the static host and passes the smoke test: deep links, real 404,
  security headers, `robots.txt`, no CSP errors in the console.

## Exact production-launch procedure

[`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md#the-15-steps): 1 Backup · 2 Confirm production env ·
3 Apply migrations (+ base seed) · 4 Verify migrations · 5 Configure storage · 6 Configure Owner ·
7 Configure settings · 8 Remove demo data (audit clean) · 9 Enter real catalog · 10 Build ·
11 Deploy · 12 Smoke test · 13 Confirm no-index / index switch · 14 Enable only desired optional
integrations · 15 Monitor.
