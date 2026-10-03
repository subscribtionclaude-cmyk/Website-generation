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
| **Production** | `live`                       | the dedicated Malek Store project       | `https://<your domain>` | only after step 13 (the indexing switch)     | none — audited in step 8 / 9 | customers               |

Rules that keep them apart:

- Each environment needs its **own build** (`VITE_*` values are baked in at build time).
- Never point a build at a Supabase project that belongs to another application. The Malek Store
  needs its **own** project (see [before the first launch](#before-the-first-launch-one-time)).
- `supabase/seed/demo.sql` is for demo previews only. It must never run on staging that rehearses
  production data, nor on production.
- Staging builds leave `VITE_SITE_URL` unset, so they can never publish a sitemap or `index` robots
  tags even if the staging database says "Allow indexing".

## Before the first launch (one time)

- **Dedicated Supabase project — Owner.** Create a new project for Malek Store at supabase.com
  (free plan; a region close to Egypt such as Frankfurt / `eu-central-1`). Keep the database password
  in a password manager — never in chat, the repository or the frontend. Never reuse a project that
  holds another application's data. If the free plan's project limit is reached, the owner decides
  (pause an unused project or choose a plan); nothing here purchases or upgrades anything.
- **Authentication.** Authentication → Providers: **Email** on (code / magic link — free). Phone /
  SMS stays off (no paid SMS); Google / Apple stay off unless the owner configures them.
  Authentication → URL Configuration: _Site URL_ = the public URL, _Redirect URLs_ =
  `https://<domain>/**`. Optional: add `{{ .Token }}` to the Magic Link template for 6-digit codes.
- **Rehearse on staging first.** Run steps 2–12 on a separate staging project with `VITE_SITE_URL`
  unset, including the [staging rehearsal](#staging-rehearsal), before doing them on production.

## The 15 steps

### 1. Backup

Keep the currently deployed `dist/` (or the host's current deployment) for a one-step frontend
rollback. If the target project already holds data (a staging rehearsal, an earlier launch), dump it
first:

```bash
supabase link --project-ref <ref>
supabase db dump --linked -f backup-schema.sql
supabase db dump --linked --data-only -f backup-data.sql
```

Store the files off the server, encrypted. The admin JSON export is a convenience copy, **not** a
database backup ([`OPERATIONS.md`](OPERATIONS.md#backups-and-restore)). On a brand-new empty project
there is nothing to dump yet — take the first dump after step 9.

### 2. Confirm the production environment

- The linked project ref is the **Malek Store** project (Settings → General), not staging, not
  another application.
- Build variables: `VITE_DATA_MODE=live`, `VITE_SUPABASE_URL=https://<ref>.supabase.co`,
  `VITE_SUPABASE_ANON_KEY=<publishable / anon key>`, `VITE_SITE_URL=https://<final domain>`. No other
  `VITE_*` values; never a service-role key (the build refuses secret-looking values).
- Supabase Auth Site URL / Redirect URLs point at the same domain.
- Edge Function secrets (only if integrations will be used) are set on the server, never in `VITE_*`.

### 3. Apply migrations

```bash
supabase db push                       # supabase/migrations/ in filename order (idempotent)
```

On the staging project `dialrvjkfiphftdwrvkh` the migrations were applied through the Supabase
connector, which recorded them under new versions: repair the history before the first
`supabase db push` there ([`HOSTED_VALIDATION.md`](HOSTED_VALIDATION.md#migration-history-note)).

Then run `supabase/seed/base.sql` in the SQL editor (real store details, navigation, SEO defaults,
page layouts — **no** demo rows; it never overwrites published values). Never run
`supabase/seed/demo.sql` on production.

### 4. Verify migrations

- Database → Migrations: the last applied migration is `20261004100000_launch_readiness`.
- SQL editor: `select count(*) from pg_tables where schemaname = 'public' and not rowsecurity;`
  returns **0** (RLS on every table).
- Advisors → Security: no "RLS disabled" or "function exposed" errors for this project.
- `select public.seo_public_index() ->> 'allowIndexing';` returns `false` (indexing off until step 13).

### 5. Configure storage

The migrations create the buckets and their policies; check them in Storage:

| Bucket                                                | Public | Used for                                      |
| ----------------------------------------------------- | ------ | --------------------------------------------- |
| `products`, `banners`, `site-media`                   | yes    | catalog images / videos, banners, site design |
| `repairs`, `trade-in`, `used-requests`, `after-sales` | no     | customer photos for service requests          |
| `reviews`                                             | no     | review photos (readable only after approval)  |
| `avatars`, `invoices`                                 | no     | profile pictures, invoices                    |

Do not make a private bucket public. Upload web-sized images (free-tier storage and egress are
capped). Private files are only ever shown through short-lived signed URLs.

### 6. Configure the Owner — **Owner**

Follow [`ADMIN_BOOTSTRAP.md`](ADMIN_BOOTSTRAP.md): sign in at `/admin/sign-in`, then run
`select app_private.bootstrap_first_owner('<owner email>');` once in the SQL editor (it refuses to
run again). Enrol an authenticator app (TOTP, free), then publish Settings → Security → "Require MFA
for admins". Invite staff (they sign in once; the Owner assigns roles in Admin → Staff, audited) and
give `payments.verify` only to people who confirm money.

### 7. Configure settings — **Owner**

Admin → Store setup (`/admin/setup`) and Admin → Settings (draft → review → publish; every version
can be restored). Enter only real values — the platform never invents missing data:

- **Store**: Malek Store; 72 Abbasseya Street, in front of Abdou Pasha Metro, Cairo, Egypt; phones
  01212004229 / 01212003775; Sat–Thu 12:00 PM–12:00 AM, Fri 1:00 PM–1:00 AM; map link; WhatsApp
  number (while empty, WhatsApp buttons say "Not available yet"); social links.
- **Payments**: exactly COD, InstaPay and Split. InstaPay address / account name / instructions stay
  empty until the owner provides them (checkout then says transfer details come on WhatsApp). A
  transfer screenshot never marks an order paid — staff verify money received.
- **Trust items**: confirm the "Apple Authorized Reseller" statement is accurate; if not (or not yet)
  confirmed, hide it (Settings → Catalog → trust items → visible off) or reword it. The platform never
  removes or changes it by itself.
- **Legal**: privacy, terms, returns, warranty, shipping, repair and trade-in policies are empty on
  purpose. The owner writes or approves them (ideally with legal advice); an empty policy page says
  "This page has not been published yet" and is not indexed.
- **Shipping** message and fee workflow, **receipt**, **order review thresholds**.

### 8. Remove demo data

Production should never have received demo data. If it did (or on a project that was used for a demo):
Admin → Store setup → demo content → **Delete**, or Admin → Import & export → Demo data → delete
(`delete_all_demo_data()` — removes `is_demo` rows only; real records are never touched). Then run the
read-only audit `supabase/scripts/demo_audit.sql` in the SQL editor: every row must show `ok = true`
(no unregistered demo table, zero demo rows, no demo media references, "Show demo catalog" off, no
demo slug in the public index).

### 9. Enter the real catalog — **Owner**

Admin → Import & export (CSV, server-validated preview) or the product editor: products, variants,
prices, stock, warranty text, images. Spot-check prices against the shop's list and stock against the
shelf. Run `demo_audit.sql` again, then take the first full backup (step 1 commands).

### 10. Build

```bash
git checkout v1.0.0-rc.1        # or the release you are deploying
npm ci
npm run check                   # typecheck, lint, tests, build, bundle, secrets, links
VITE_DATA_MODE=live VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_SITE_URL=https://<domain> npm run build
```

The build reads the public catalog with the anon key to prerender pages; while indexing is off it
still writes `robots.txt: Disallow: /` and `noindex` on every page.

### 11. Deploy

Upload the **contents** of `dist/` to the static host ([`DEPLOYMENT.md`](DEPLOYMENT.md)); keep the
previous deployment for [rollback](ROLLBACK.md#frontend). Custom domain (optional — the free
subdomain works): follow the host's DNS steps, wait for HTTPS, and make sure `VITE_SITE_URL` and the
Supabase Auth URLs use it (rebuild if they changed).

### 12. Smoke test

Run the [post-deploy smoke test](#post-deploy-smoke-test) on a phone and a desktop. Any failure →
[`ROLLBACK.md`](ROLLBACK.md).

### 13. Confirm the no-index / index switch — **Owner**

Until everything above is final, the site must stay unindexed: `/robots.txt` shows `Disallow: /` and
pages carry `noindex`. To go public in search: publish Settings → Search engines → "Allow indexing",
rebuild and redeploy (prerendered pages and `sitemap.xml` are generated at build time), check that
`/robots.txt` now lists the sitemap, then submit `https://<domain>/sitemap.xml` in Google Search
Console. To pause indexing later, publish the switch off and redeploy.

### 14. Enable only the optional integrations you want — **Owner**

The store runs without any of them. For each one the owner chooses (WhatsApp Cloud API, Odoo,
Google Analytics, Google / Apple sign-in, …): deploy the Edge Functions, set its secrets on the server,
configure public settings in Admin → Integrations, **Test connection**, then **Enable**
([`DEPLOYMENT.md`](DEPLOYMENT.md#optional-integrations-phase-09)). Nothing paid is enabled by the
platform; disabling restores the manual fallback immediately.

### 15. Monitor

First week: orders and requests at least twice a day, Supabase usage and logs daily, the smoke test
after every deploy ([`OPERATIONS.md`](OPERATIONS.md#monitoring)). Keep the previous deployment ready
for rollback.

## Demo → live transition

```
DEMO → backup / export → review → delete demo data → verify zero demo rows
     → configure store → preview → staging → live
```

The setup wizard (`/admin/setup`, needs `demo.manage` to delete) records one of three choices:

- **Keep** — leave demo content for now (a demo / preview project only; never production).
- **Replace with my data** — deletes the demo rows now; the owner then enters the real catalog.
- **Delete** — deletes the demo rows.

Replace and Delete run the same audited `delete_all_demo_data()`: only `is_demo` rows go; real
products, orders, customers, settings and layouts stay (`12_seo_setup.test.sql`,
`14_launch_readiness.test.sql`). Verify afterwards with `demo_audit.sql`. To show demo content again
on a staging project, load `supabase/seed/demo.sql` there — never on production.

## Staging rehearsal

On staging (steps 2–12 with `VITE_SITE_URL` unset): place a COD order, an InstaPay order and a split
order; verify a payment as staff; cancel an unpaid order (stock returns); submit a repair, trade-in,
used-device and after-sales request and answer them as staff; edit and publish a home section in the
Site Editor, then restore the previous version; restore a settings version; practise the
[restore procedure](OPERATIONS.md#backups-and-restore) once.

## Production values the owner must supply

| Value                                 | Where                               | Status at rc.1                          |
| ------------------------------------- | ----------------------------------- | --------------------------------------- |
| Supabase project (dedicated)          | supabase.com                        | ⏳ not created                          |
| Production site URL / domain          | `VITE_SITE_URL`, Supabase Auth URLs | ⏳ owner decision                       |
| Store name, address, landmark         | Settings → Store                    | ✅ seeded — owner to confirm            |
| Phones                                | Settings → Store                    | ✅ seeded — owner to confirm            |
| Opening hours                         | Settings → Store                    | ✅ seeded — owner to confirm            |
| WhatsApp number                       | Settings → Store                    | ⏳ empty                                |
| Social URLs, map URL                  | Settings → Social / Store           | ⏳ empty                                |
| InstaPay details                      | Settings → Commerce                 | ⏳ empty                                |
| Real products, prices, stock, images  | Admin → Products / Import           | ⏳ owner                                |
| Legal policies                        | Settings → Legal                    | ⏳ empty                                |
| Shipping workflow / fee message       | Settings → Shipping                 | ✅ default text — owner to confirm      |
| "Apple Authorized Reseller" statement | Settings → Catalog → trust items    | ⚠️ visible — owner must confirm or hide |

## Owner launch checklist

- [ ] Dedicated Supabase project created; database password stored safely
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
- [ ] [Staging rehearsal](#staging-rehearsal) passed
- [ ] Pre-launch backup taken and stored offline (steps 1 and 9)
- [ ] Domain decision made (free subdomain or custom domain)
- [ ] Indexing switched on only when the above is done (step 13)
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
5. `/robots.txt` — staging: `Disallow: /`; production before step 13: `Disallow: /`; after step 13:
   `Allow` + the sitemap URL. `/sitemap.xml` lists only real, published pages.
6. Add a product to the cart, open checkout, see exactly COD / InstaPay / Split (no other method).
7. Place a test order (then cancel it as staff — stock returns), submit a repair request.
8. Sign in to `/admin` with MFA; open Orders, Settings and the Site Editor preview (it renders).
9. No browser console errors (in particular no "Content Security Policy" messages).
10. Install prompt / offline: open a visited page offline — it shows the cached page or the offline
    page, never a private page.

If anything fails: [`ROLLBACK.md`](ROLLBACK.md).
