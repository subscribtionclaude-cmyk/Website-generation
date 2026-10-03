# Launch runbook — MALEK STORE v1.0.0-rc.1

The ordered path from this repository to a live store. Every step is free on Supabase's free plan
and a free static host; nothing here needs a paid provider. Steps marked **Owner** need a decision or
an account only the store owner has. Do them in order: each step assumes the previous ones.

Related: [`ROLLBACK.md`](ROLLBACK.md) (undoing a release), [`OPERATIONS.md`](OPERATIONS.md) (daily
operations, backups, monitoring), [`SECURITY.md`](SECURITY.md) (security review),
[`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) (current readiness verdict), [`DEPLOYMENT.md`](DEPLOYMENT.md)
(host specifics), [`ADMIN_BOOTSTRAP.md`](ADMIN_BOOTSTRAP.md) (first Owner).

## Environment matrix

| Environment    | Data mode (`VITE_DATA_MODE`) | Backend                                 | `VITE_SITE_URL`         | Indexable                                    | Demo data                    | Who uses it             |
| -------------- | ---------------------------- | --------------------------------------- | ----------------------- | -------------------------------------------- | ---------------------------- | ----------------------- |
| **Local**      | `demo` (default) or `live`   | none (in-browser demo) or a dev project | unset                   | never                                        | demo only                    | developers              |
| **Demo**       | `demo`                       | none — everything runs in the browser   | unset                   | never (`robots.txt: Disallow: /`, `noindex`) | yes, labelled "demo"         | owner previews, sales   |
| **Staging**    | `live`                       | a separate Supabase project (free)      | **unset**               | never (no site URL → no sitemap, `noindex`)  | none (base seed only)        | owner + staff rehearsal |
| **Production** | `live`                       | the dedicated Malek Store project       | `https://<your domain>` | only after step 14 (the indexing switch)     | none — audited in step 3 / 8 | customers               |

Rules that keep them apart:

- Each environment needs its **own build** (`VITE_*` values are baked in at build time).
- Never point a build at a Supabase project that belongs to another application. The Malek Store
  needs its **own** project (see step 1).
- `supabase/seed/demo.sql` is for demo previews only. It must never run on staging that rehearses
  production data, nor on production.
- Staging builds leave `VITE_SITE_URL` unset, so they can never publish a sitemap or `index` robots
  tags even if the staging database says "Allow indexing".

## The 15 steps

### 1. Create the dedicated Supabase project — **Owner**

Create a new project for Malek Store at supabase.com (free plan; region close to Egypt, e.g.
Frankfurt / `eu-central-1`). Store the database password in a password manager — never in chat, the
repository or the frontend. Do **not** reuse a project that already holds another application's data.
If the free plan's active-project limit is reached, pause or free up a project you no longer use, or
decide on a plan yourself; nothing in this repository purchases or upgrades anything.

### 2. Apply the migrations

```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/ in filename order
```

Check in the dashboard (Database → Migrations) that the last applied migration is
`20261004100000_launch_readiness`. The migrations are idempotent; re-running `db push` is safe.
Then run the database advisors (Dashboard → Advisors → Security) and confirm RLS is enabled on every
`public` table (the migrations enable it everywhere; `npm run test:db` proves it locally).

### 3. Seed the base configuration only

Run `supabase/seed/base.sql` in the SQL editor (store details, navigation, SEO defaults, page
layouts — no demo rows). Then run the read-only launch audit:

```sql
-- paste supabase/scripts/demo_audit.sql; every row must show ok = true
```

It checks: no `is_demo` table is missing from the cleanup registry, zero demo rows, no live record
references demo media, "Show demo catalog" is off and no demo slug is in the public sitemap index.

### 4. Configure authentication

Authentication → Providers: **Email** on (email code / magic link — free). Leave phone/SMS off (no
paid SMS) and Google / Apple off unless you configure them yourself.
Authentication → URL Configuration: _Site URL_ = the environment's public URL; _Redirect URLs_ =
`https://<domain>/**`. Optional: add `{{ .Token }}` to the Magic Link template so customers can type
the 6-digit code; configure your own SMTP later if the built-in sender's rate limit is reached.

### 5. Create the first Owner and turn on MFA — **Owner**

Follow [`ADMIN_BOOTSTRAP.md`](ADMIN_BOOTSTRAP.md): sign in at `/admin/sign-in`, then run
`select app_private.bootstrap_first_owner('<owner email>');` once in the SQL editor. Enrol an
authenticator app (TOTP, free) for the Owner, then publish Settings → Security → "Require MFA for
admins" (`security.adminMfaRequired = true`). From then on role, price, payment, settings and
integration changes need an MFA session.

### 6. Invite staff — **Owner**

Staff sign in once at `/admin/sign-in`; the Owner assigns roles in Admin → Staff (`/admin/access/users`, audited).
Give `payments.verify` only to people who confirm money; they must use MFA once step 5 is on.
Walk staff through [`OPERATIONS.md`](OPERATIONS.md#staff-operations-checklist).

### 7. Review store settings — **Owner**

In Admin → Settings (save draft → review → publish; every version can be restored):

- **Store** — name, address (72 Abbasseya Street, in front of Abdou Pasha Metro, Cairo), phones
  (01212004229 / 01212003775), opening hours (Sat–Thu 12:00 PM–12:00 AM, Fri 1:00 PM–1:00 AM),
  map link, WhatsApp number. These are settings, not code — correct them here if anything changes.
- **Payments** — exactly COD, InstaPay and Split. Enter the real InstaPay address / account name /
  instructions; until then checkout says the team sends transfer details on WhatsApp. A customer's
  transfer screenshot never marks an order paid — staff verify money received.
- **Trust items** — confirm the "Apple Authorized Reseller" statement is accurate for the store.
  If it is not (or not yet) confirmed, hide it (Settings → Catalog → trust items → visible off) or
  reword it. The
  platform never removes or changes it on its own.
- **Legal** — privacy, terms, returns, warranty, shipping, repair and trade-in policies are empty
  on purpose. Write or approve the text yourself (ideally with legal advice); an empty policy page
  says "This page has not been published yet" with a contact link, and is not indexed.
- **Shipping**, **receipt**, **social links**, **order review thresholds** — review the defaults.

### 8. Load the real catalog — **Owner**

Admin → Import & export (CSV) or the product editor: products, variants, prices, stock, warranty
text, images. Check a sample of prices against the shop's price list. Run the demo audit (step 3)
again. Finish Admin → Store setup (`/admin/setup`), choosing "no demo content".

### 9. Build and deploy staging

```bash
npm ci && npm run check
VITE_DATA_MODE=live VITE_SUPABASE_URL=https://<staging-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<publishable key> npm run build     # VITE_SITE_URL deliberately unset
```

Upload the **contents** of `dist/` to the static host (see [`DEPLOYMENT.md`](DEPLOYMENT.md)). The
build refuses a secret-looking `VITE_*` value; never paste a service-role key anywhere in the frontend.

### 10. Rehearse on staging

Run the [post-deploy smoke test](#post-deploy-smoke-test) and the end-to-end flows staff will use:
place a COD order, an InstaPay order and a split order; verify payment as staff; cancel one order
(stock returns); submit a repair, trade-in, used-device and after-sales request; edit and publish a
home section in the Site Editor, then roll it back.

### 11. Pre-launch backup

Immediately before switching production on:

```bash
supabase db dump --linked -f backup-schema.sql
supabase db dump --linked --data-only -f backup-data.sql
```

Also download Admin → Import & export → Backup (JSON). Keep the files off the server (encrypted
drive or password manager attachment). The admin JSON export is a convenience copy, **not** a
database backup — restores use the SQL dump or Supabase's own backups (see
[`OPERATIONS.md`](OPERATIONS.md#backups-and-restore)).

### 12. Build and deploy production

Same as step 9 with the production project and `VITE_SITE_URL=https://<your domain>`. Deploy, then
run the smoke test against the production URL. Keep the previous `dist/` (or host deployment) so
[`ROLLBACK.md`](ROLLBACK.md) can restore it in one step.

### 13. Domain — **Owner**

Optional: the store can launch on the host's free subdomain. For a custom domain, follow the host's
DNS steps, wait for HTTPS, then update `VITE_SITE_URL` (rebuild + redeploy) and the Supabase Site
URL / Redirect URLs. Sign in once on the final domain to confirm the email link returns there.

### 14. Indexing switch — **Owner**

Only when the catalog, prices, policies and store details are final: publish Settings → Search
engines → "Allow indexing" (`seo.allowIndexing = true`), rebuild and redeploy (prerendered pages and
`sitemap.xml` are generated at build time), check `https://<domain>/robots.txt` lists the sitemap,
then submit `https://<domain>/sitemap.xml` in Google Search Console. To pause indexing later,
publish the switch off and redeploy.

### 15. Go live and watch

Announce the store, then follow [monitoring for the first week](OPERATIONS.md#monitoring): check
new orders and requests at least twice a day, watch the Supabase usage page, and keep the previous
deployment ready for rollback.

## Owner launch checklist

- [ ] Dedicated Supabase project created (step 1); database password stored safely
- [ ] Hosting account chosen (ShipStatic free, Netlify, Cloudflare Pages, …)
- [ ] First Owner created; MFA enrolled; "Require MFA for admins" published
- [ ] Store name, address, landmark, phones and opening hours confirmed in settings
- [ ] WhatsApp number entered (while empty, WhatsApp buttons say "Not available yet" — nothing is invented)
- [ ] InstaPay address / account name / instructions entered (or left empty on purpose)
- [ ] "Apple Authorized Reseller" claim confirmed as accurate — or hidden / reworded
- [ ] Legal policies written or approved by the owner (privacy, terms, returns, warranty, shipping, repairs, trade-in)
- [ ] Real catalog, prices and stock loaded and spot-checked; demo audit all `ok`
- [ ] Shipping fee message and delivery areas confirmed
- [ ] Order review thresholds tuned for the store
- [ ] Staff accounts and roles assigned; staff trained ([`OPERATIONS.md`](OPERATIONS.md))
- [ ] Staging rehearsal passed (step 10)
- [ ] Pre-launch backup taken and stored offline (step 11)
- [ ] Domain decision made (free subdomain or custom domain)
- [ ] Indexing switched on only when the above is done (step 14)
- [ ] Optional integrations (WhatsApp API, Odoo, analytics, social sign-in) — only if the owner
      chooses and configures them; the store runs without any of them

## Post-deploy smoke test

Run after every deploy (staging and production), on a phone and a desktop:

1. `/` and `/en` load; header, footer, store hours ("open now" state) and phone links are right.
2. Reload a deep link directly: `/en/store`, `/product/<slug>`, `/cart`, `/admin` — each loads.
3. A made-up URL (`/this-does-not-exist`) shows the not-found page; the browser's network panel
   shows status **404** (on hosts that honour `_redirects`).
4. Response headers on `/` include `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: SAMEORIGIN`; `/sw.js` has `Cache-Control: no-cache`.
5. `/robots.txt` — staging: `Disallow: /`; production before step 14: `Disallow: /`; after step 14:
   `Allow` + the sitemap URL. `/sitemap.xml` lists only real, published pages.
6. Add a product to the cart, open checkout, see exactly COD / InstaPay / Split (no other method).
7. Place a test order (then cancel it as staff — stock returns), submit a repair request.
8. Sign in to `/admin` with MFA; open Orders, Settings and the Site Editor preview (it renders).
9. No browser console errors (in particular no "Content Security Policy" messages).
10. Install prompt / offline: open a visited page offline — it shows the cached page or the offline
    page, never a private page.

If anything fails: [`ROLLBACK.md`](ROLLBACK.md).
