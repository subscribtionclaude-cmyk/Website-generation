# Hosted Supabase staging validation — 2026-10-03

**Result: PASSED.** The release candidate (`d91770c`, v1.0.0-rc.1) runs on a real hosted Supabase
project with the same schema, policies and behaviour as the local test cluster. The static host is
still to be validated (see [Remaining](#remaining)).

| Item              | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Project           | "Malek store" · ref `dialrvjkfiphftdwrvkh` · eu-west-2 · created 2026-10-03 (free plan) |
| URL               | `https://dialrvjkfiphftdwrvkh.supabase.co`                                              |
| State before work | empty: no application tables, no auth users, no buckets, no migrations, no functions    |
| Source            | commit `d91770cb2d51c9714426562d9888beb249756d07`                                       |
| Seed              | `supabase/seed/base.sql` only (no demo catalog)                                         |

No other Supabase project was touched. No paid service was enabled. No secret was written to the
repository, the database or the chat (the publishable key is public by design).

## How it was run

- **Migrations** — each of the 30 files was fetched from the pinned commit, checked against the
  local file's MD5, then applied with one `apply_migration` call each, strictly in order.
- **Live HTTP tests** — the build environment cannot reach `*.supabase.co` directly, so Auth,
  REST, Storage and Edge Function requests were sent from inside the database with the `http`
  extension, using the public publishable key and real user sessions.
- **Fixtures** — RLS and privilege tests used fixtures inside transactions that were rolled back.
  HTTP tests used four QA accounts on the reserved `malek-staging.test` domain (two customers,
  `repairs_team`, `store_manager`) with a random password that was never printed.

## Results

| Area                     | Result                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations               | ✅ 30 / 30 applied from a clean state, MD5-verified, in file order                                                                                                                                                                                                                                                                                        |
| Schema fingerprint       | ✅ identical to the local reference build (columns, constraints, indexes, policies, functions, triggers, buckets, table and function grants, seed) except 3 explained items: opclass and `varchar` cast rendering, and Supabase's own `rls_auto_enable` event-trigger function                                                                            |
| Structure                | 68 tables, 168 indexes, 457 constraints, 57 triggers (+2 on `auth.users`), 64 table policies + 9 storage policies, 381 functions, 308 `SECURITY DEFINER`                                                                                                                                                                                                  |
| Definer functions        | ✅ all 308 pin `search_path`; `app_private` has no API grants (anon, authenticated and service_role)                                                                                                                                                                                                                                                      |
| RLS                      | ✅ enabled on every `public` table; the two internal tables without RLS (`app.rate_events`, `app.demo_tables`) have no API grants                                                                                                                                                                                                                         |
| Advisors (security)      | ✅ no ERROR. WARN: 19 anon-executable definer functions, all intended public storefront RPCs; 184 authenticated-executable definer functions, each checking permissions inside; leaked-password protection off (Auth setting, see owner actions). INFO: 5 tables with RLS and no policy (staff-only tables reached through RPCs)                          |
| RLS / privileges         | ✅ 50 / 50: anonymous sees 0 rows in 20 private tables; Customer A sees only their own rows and nothing of B's; customers, sales and customer service are refused privileged RPCs (42501), including self-assigning Owner or Super Admin; customer service can view integrations but not change them; integration settings and audit data stay staff-only |
| Storage                  | ✅ 17 / 17 (below)                                                                                                                                                                                                                                                                                                                                        |
| Auth                     | ✅ 14 / 14 (below)                                                                                                                                                                                                                                                                                                                                        |
| First-Owner bootstrap    | ✅ (below)                                                                                                                                                                                                                                                                                                                                                |
| Edge Functions           | ✅ deployed; 33 live checks passed (one expectation corrected, see the note below)                                                                                                                                                                                                                                                                        |
| Not-configured fallbacks | ✅ all 12 integrations off with no provider; Test connection reports `config_incomplete` / `no_provider`; `storefront_integrations()` exposes no analytics and no social sign-in, so the storefront keeps its manual paths (wa.me link, email sign-in, built-in search)                                                                                   |
| Demo contamination       | ✅ `supabase/scripts/demo_audit.sql` 21 / 21 ok; 0 products, variants, prices, stock movements, reviews, orders, service requests, offers, service offers, content entries, notification deliveries; no integration configured                                                                                                                            |
| Indexing                 | ✅ published `seo.allowIndexing = false`; `seo_public_index()` (as anon) returns `allowIndexing: false` and no products. `features.showDemoCatalog = false`                                                                                                                                                                                               |

### Storage (live, Storage API)

- Customer uploads to their own folder in the private `repairs` bucket; reads it back.
- Customer cannot write into another customer's folder, nor to the public `products` bucket (RLS).
- Customer B cannot read or sign Customer A's file; anonymous requests to the public and
  authenticated URLs of a private file are refused.
- Repairs staff and the store manager (`repairs.view`) can read repair media.
- A signed URL (2 s) works immediately and is refused after expiry (`InvalidJWT`, `exp`).
- Catalog staff upload public product media; anonymous visitors read it from the public URL.
- A disallowed MIME type is refused (415). Test objects were deleted through the API (0 objects left).

### Auth (live, email + password session for the test accounts)

Sign-in returns a session; `/auth/v1/user` returns the right account; the profile row is linked to
the auth user; REST returns only the caller's own profile; anonymous REST on `profiles` and
`audit_logs` is refused; `get_my_access` resolves no roles for a customer, `repairs_team` +
`repairs.view` (and not `integrations.manage`) for repairs staff, `store_manager` + `catalog.manage`
for the manager; a tampered JWT and a wrong password are refused; logout ends the session; the
refresh token and the access token stop working after logout. Access tokens live 3,600 s. Sign-up
with reserved domains (`example.com`) is rejected by Auth. No SMS is used anywhere.

Not verified live: natural token expiry after one hour (the expiry claim is enforced, as the signed
URL test shows) and delivery of the email sign-in code (no inbox on a reserved domain). Check both
once with a real mailbox during the owner rehearsal.

### First-Owner bootstrap (inside a rolled-back transaction)

No Owner and no non-test auth user exist (no default admin, no default password). `bootstrap_first_owner`
cannot be executed by anon, authenticated or service_role and is refused (42501) to a signed-in
customer even through SQL. It refuses an unknown email (P0002), assigns the first Owner once
(email trimmed, case-insensitive), writes an `access.bootstrap_owner` audit event, and refuses
every later call (42501). The new Owner resolves all permissions; a customer still has none and
cannot assign themselves Owner. The transaction was rolled back, so the real one-time bootstrap is
still available.

### Edge Functions

`integrations` (JWT verification on) and `integration-webhook` (JWT verification off, HMAC checked
in code) deployed as version 1. The deployed source matches the repository byte for byte (the two
type-only modules are dropped by the bundler). No function secrets are set.

| Check                                                                    | Result                        |
| ------------------------------------------------------------------------ | ----------------------------- |
| No `Authorization` header                                                | 401 at the gateway            |
| Tampered JWT                                                             | 401 at the gateway            |
| Publishable key only (no user session)                                   | 403 `forbidden` (see note)    |
| Customer → test / sync                                                   | 403 `forbidden`               |
| Repairs staff → test                                                     | 403 `forbidden`               |
| Store manager → dispatch (needs `integrations.manage`)                   | 403 `forbidden`               |
| Unknown action / malformed body / unknown integration / GET              | 400 / 400 / 404 / 405         |
| Store manager → test WhatsApp, Odoo (not configured)                     | 200, `config_incomplete`      |
| Service-only RPCs via REST with a staff JWT                              | 403 (42501), all 4 tried      |
| Service-only RPCs executable by anon / authenticated                     | 0 of 8                        |
| Webhook: unsigned, forged signature                                      | 401, logged as rejected only  |
| Webhook: verify handshake without a configured token / PUT / 300 KB body | 403 / 405 / 413               |
| Duplicate provider event (database, service role, rolled back)           | 2nd call `duplicate: true`    |
| Responses                                                                | safe codes only, no internals |

Note: with the new publishable keys, the gateway accepts a request that carries only the
publishable key (it counts as the anonymous role). The function then asks the database
(`admin_integration_authorize`) and refuses. Authorization is enforced in the database either way.

Covered by unit tests rather than live: SSRF guard (private / local hosts, IP ranges, credentials
in URLs), never following redirects, 8 s timeouts, secret redaction, valid HMAC signatures and
replay windows. A valid-signature webhook and a real provider call need provider secrets, which
were deliberately not configured.

## Migration history note

Applying through the Supabase connector recorded each migration under a new version
(`20261003173912` … `20261003175947`) with the file name as its name, instead of the file's own
version. Before running `supabase db push` against this project, repair the history so the CLI does
not try to apply them again, for example
`supabase migration repair --status applied 20260924100000 … 20261004100000` plus
`--status reverted` for the connector versions (`supabase migration list` shows both). All
migrations are idempotent, so a re-run would not change data, but repairing keeps the history clean.

## QA residue — owner cleanup required

The connector refuses `DELETE`, `UPDATE` and `DROP` statements in this environment (they time out
waiting for a confirmation that cannot be shown), so these test leftovers could not be removed:

- 4 QA auth users `qa-*@malek-staging.test` (two hold `repairs_team` / `store_manager`). **They are
  locked:** each password was changed to a random value that was never stored or shown, and every
  session and refresh token was revoked (verified: the old password is refused, 0 live sessions).
- schema `qa_tmp` (the old, now useless test password and a scratch table);
- the health-check result of the WhatsApp and Odoo tests (`config_incomplete`, 1 failure each);
- 2 rejected webhook log rows (`missing_secret`);
- the `http` extension (used for the live tests);
- audit-log rows for the test role assignments (append-only by design; harmless).

Run once in **Supabase → SQL Editor** on `dialrvjkfiphftdwrvkh`:

```sql
delete from auth.users where email like 'qa-%@malek-staging.test';
drop schema if exists qa_tmp cascade;
update public.integration_configs
   set last_check_at = null, last_check_status = null, last_check_code = null,
       last_check_message = null, last_check_latency_ms = null,
       consecutive_failures = 0, circuit_open_until = null
 where key in ('whatsapp', 'odoo');
delete from public.integration_webhook_events where status = 'rejected' and event_type = 'missing_secret';
drop extension if exists http;
```

Then run `supabase/scripts/demo_audit.sql` again (all rows ok).

## Static staging on ShipStatic — 2026-10-03

**URL:** https://light-drifter-54c6ek6.shipstatic.com (uploaded by the owner from the build below).

**Build:** `VITE_DATA_MODE=live`, `VITE_SUPABASE_URL=https://dialrvjkfiphftdwrvkh.supabase.co`, the
publishable key, no `VITE_SITE_URL`. 26 prerendered pages, 0 sitemap URLs, not indexable; secret
guard and bundle budget pass. The build environment cannot reach `*.supabase.co`, so the prerender
step was fed the exact responses of the real project's public RPCs (fetched from the project itself
with the same key and requests); nothing was invented and no code changed.

Checked over HTTP from the staging database (this environment cannot reach `*.shipstatic.com`):

| Check                                 | Result                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact build                           | ✅ every file checked matches `dist/` byte for byte once ShipStatic's `?_ship=54c6ek6` cache-busting rewrite is removed                                       |
| Public pages, direct load / refresh   | ✅ 200 for `/`, `/en`, `/store`, `/en/store`, `/apple`, `/en/apple`, `/offers`, `/news`, `/contact`, `/repairs`, `/trade-in`, `/used`, `/after-sales`         |
| Unknown URLs                          | ✅ real 404 with the app's not-found page (`/this-page-does-not-exist`, `/en/missing/deep/link`, missing assets)                                              |
| App routes without a prerendered file | ⚠️ `/admin` (and `/cart`, `/account`, `/checkout`, …) render the app but answer **404**: ShipStatic ignores `_redirects`                                      |
| Assets / MIME / chunks                | ✅ 196 chunks fetched (every chunk that imports others, incl. entry + CSS): all 200 with correct MIME types; no redirects; hashed assets immutable            |
| Live Supabase                         | ✅ bundle references `dialrvjkfiphftdwrvkh` only — no demo backend, localhost or other project                                                                |
| SEO (staging)                         | ✅ `robots.txt` `Disallow: /`, empty sitemap, `noindex, nofollow` on every page, no canonical (no `VITE_SITE_URL`), hreflang alternates present               |
| PWA                                   | ✅ manifest, `sw.js`, `offline.html` served from the root (scope `/`); ⚠️ `sw.js` / manifest cached `max-age=31536000, immutable` by ShipStatic (see below)   |
| Security headers                      | ⚠️ ShipStatic ignores `_headers`: only `X-Content-Type-Options: nosniff` and HSTS are sent — **no CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy** |

**ShipStatic limitations found (not fixed by switching hosts, as instructed):**

1. `_headers` is not applied: CSP, frame protection, Referrer-Policy and Permissions-Policy are
   missing. `_headers` and `_redirects` are served as plain public files (no secrets in them).
2. `_redirects` is not applied: app routes without a prerendered page get the SPA shell with a 404
   status. Browsers still show the page; the status matters for crawlers and monitoring.
3. HTML, JS and CSS are rewritten to add `?_ship=<id>` to asset URLs, but imports written as template
   literals (``import(`./X.js`)``) are left alone. Result: those lazy chunks load without the
   suffix and their modulepreloads are fetched twice. Two modules load under two URLs
   (`RequireModule`, a stateless route guard, and the repair page chunk that the 3D diagnostic
   reads its CSS-module class names from); neither holds shared state, so nothing breaks — it costs
   extra downloads only.
4. `sw.js`, the manifest, `robots.txt` and the sitemap are served `immutable` for a year. Each
   deployment has its own hostname, so staging is unaffected; on a custom domain this would delay
   service-worker updates and a robots.txt change.

Not checked from here (needs a real browser on the URL): console errors, visual review (Arabic
RTL / English LTR, mobile / desktop), fonts and images in the browser, CLS, live Supabase calls from
the page, service-worker registration.

## Sign-in emails: code only

The site verifies a 6-digit code (`verifyOtp`, type `email`). The default Supabase emails also carry
a sign-in link; staff should get the code only. `supabase/templates/email-code.html` is the
code-only template (no link), wired into local dev by `supabase/config.toml`. On the hosted project
paste it into **Authentication → Emails** for both **Magic link** and **Confirm signup**, and keep
**Email OTP length = 6** (Authentication → Providers → Email).

## Remaining

1. **Browser check of the ShipStatic URL** — console, visuals, sign-in with a real mailbox,
   Admin → Integrations showing "Not configured".
2. Decide whether ShipStatic's missing security headers / 404 status on app routes are acceptable
   for production, or pick a host that applies `_headers` / `_redirects`.
3. Owner cleanup above, then the first-Owner bootstrap with the owner's real account.
