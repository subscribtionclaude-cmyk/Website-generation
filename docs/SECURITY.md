# Security review — v1.0.0-rc.1 (Phase 10)

Scope: the static frontend, the Supabase database (migrations, RLS, functions), the Edge Function
handlers, the build / CI pipeline and the static-host configuration. Method: code review of every
layer, automated checks (`npm run check`, `npm run test:db`, the E2E suite incl. a CSP-violation
spec), dependency audit and a repository secret scan. This is an internal review, not an external
penetration test. The hosted Supabase project and the real static host were **not** available to
test (see [Limits](#limits-of-this-review)).

## Summary

| Area                             | Result                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Row-level security               | ✅ on every `public` table (asserted by `01_schema.test.sql`); no direct anon table access                                                   |
| Database functions               | ✅ all 323 `SECURITY DEFINER` functions pin `search_path = ''`; permissions checked inside every staff RPC                                   |
| Authentication / first Owner     | ✅ no default account or password; one-time, lock-protected Owner bootstrap from the SQL editor only                                         |
| MFA (aal2) for sensitive actions | ✅ roles, prices, payments, settings and — new — integration changes, when "Require MFA for admins" is on                                    |
| Secrets                          | ✅ none in the repository, the bundle or the database; build refuses secret-looking `VITE_*`; `check:secrets` in CI                          |
| XSS                              | ✅ no raw-HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, …); React escaping; CSP without `unsafe-inline` / `unsafe-eval` for scripts    |
| CSV / spreadsheet injection      | ✅ exports neutralise `= + - @`; imports reject formula-looking cells                                                                        |
| SSRF (admin-entered endpoints)   | ✅ https + public host only, and — new — redirects are never followed                                                                        |
| Abuse of anonymous endpoints     | ✅ — new — per-visitor and global rate limits on guest waitlist / stock alerts                                                               |
| Webhooks                         | ✅ HMAC signature + event-ID dedupe; — new — rejected-request log capped                                                                     |
| Security headers / CSP           | ✅ — new — CSP, `nosniff`, `SAMEORIGIN`, referrer and permissions policies (`public/_headers`)                                               |
| PWA cache privacy                | ✅ service worker caches public files / visited public pages only; never admin, account, checkout, orders, auth, API, functions or analytics |
| Dependencies                     | ✅ `npm audit`: 0 vulnerabilities (prod and dev); runtime licences MIT / ISC / OFL-1.1                                                       |
| CI                               | ✅ no secrets, no paid services; read-only token scope (`contents: read`)                                                                    |

## Fixed in Phase 10

| #   | Severity | Finding                                                                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | No Content-Security-Policy or security headers were defined for the static host.                                           | `public/_headers`: CSP (scripts: self + the one prerender inline script pinned by SHA-256 + Google Tag Manager for consented analytics; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` so the Site Editor's same-origin preview still works), `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`. The preview server applies the same file, and `e2e/launch.spec.ts` fails on any CSP violation (storefront, admin, editor preview frame). |
| 2   | Low      | Zod's JIT probes `new Function`, which a strict CSP reports as an `eval` violation on every page load.                     | Every `zod` import resolves to `src/lib/zod.ts`, which enables jitless mode before any schema runs (same validation, no eval).                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Medium   | Guest waitlist / stock-alert RPCs could be flooded with rotating phone numbers.                                            | `app.consume_rate`: 10 requests / hour per signed-in user or client IP, plus a global ceiling (1,000 / hour) that bounds a flood with spoofed `X-Forwarded-For` hops; raises `rate_limited` (SQLSTATE 54000).                                                                                                                                                                                                                                                                                                                    |
| 4   | Medium   | Changing an integration's provider, settings, mapping or on/off state did not require MFA.                                 | `integration_configs_mfa_guard` trigger calls `app.assert_sensitive_action_allowed()` (aal2 when required); health-check bookkeeping and the server runtime are unaffected.                                                                                                                                                                                                                                                                                                                                                      |
| 5   | Medium   | Server-side provider calls followed HTTP redirects, so an allowed public URL could redirect to an internal address (SSRF). | All server fetches use `redirect: 'manual'`; a 3xx / opaque redirect is a `provider_error` (`redirect_not_followed`). Tested with a redirect to `169.254.169.254`.                                                                                                                                                                                                                                                                                                                                                               |
| 6   | Low      | Requests with a bad webhook signature were logged without a cap (log flooding).                                            | At most 200 rejected events per integration per hour are stored; the function still answers 401.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Low      | Unknown URLs were served the app with status 200 (soft 404s for crawlers and scanners).                                    | `_redirects` lists the real app routes (200) and ends with `/* /404.html 404`; a test keeps the list in sync with the route table.                                                                                                                                                                                                                                                                                                                                                                                               |
| 8   | Low      | Three `is_demo` tables were cleaned only through cascades, not registered in the demo registry.                            | Registered; the read-only launch audit (`supabase/scripts/demo_audit.sql`) fails on any unregistered `is_demo` table, demo rows, demo media references, the demo-catalog switch or demo slugs in the public index.                                                                                                                                                                                                                                                                                                               |

## Accepted risks and notes

- **`style-src 'unsafe-inline'`** is required by React `style` attributes and the prerendered
  critical CSS. Scripts stay strict; inline styles cannot execute code.
- **`img-src` / `media-src https:`** allow images from any https origin because staff can enter
  image URLs (and Supabase Storage URLs differ per project). Images cannot run scripts.
- **Client IP for rate limits** comes from the gateway's `X-Forwarded-For`; the first hop can be
  spoofed, which is why the global ceiling exists. A determined attacker can still exhaust the
  shared hourly budget for guest waitlist sign-ups (signed-in customers have their own budget); the
  impact is limited to that form.
- **Soft 404 for content not in the build**: `/product/<slug>` etc. are served by the app (200)
  because products published after the last build have no prerendered file yet; a slug that does
  not exist renders the not-found state with `noindex`.
- **Demo mode role preview** (`/admin` role picker) exists only in demo builds, which have no
  backend; live builds use Supabase Auth and database-side permissions.
- **No third-party error tracker** is bundled (privacy); errors are visible in Supabase logs.

## Limits of this review

- **Hosted Supabase was not tested.** Migrations, RLS, storage policies, auth flows, the first-Owner
  bootstrap and the Edge Functions were validated on a local PostgreSQL with a Supabase
  compatibility shim (`npm run test:db`, 1,122 assertions) and unit tests, not on a hosted project.
  The owner must run [launch runbook](LAUNCH_RUNBOOK.md) steps 1–5 and 10 on a dedicated project.
- **Static-host headers were not observed live.** The ShipStatic probe deployment could not be
  fetched from the build environment (network policy). After the first deploy, check the headers
  ([smoke test](LAUNCH_RUNBOOK.md#post-deploy-smoke-test) item 4). On a host that ignores
  `_headers`, set the same headers in its configuration.
- **Browsers**: automated tests ran on Chromium only (mobile, tablet, desktop and large-desktop
  profiles). Safari / iOS and Firefox were not tested.
- **Edge Functions** were not executed under Deno here; their logic is the unit-tested handler.

## Reporting a vulnerability

Report privately to the store owner (do not open a public issue with exploit details). Rotate any
exposed key in the Supabase dashboard first, then fix forward ([`ROLLBACK.md`](ROLLBACK.md)).
