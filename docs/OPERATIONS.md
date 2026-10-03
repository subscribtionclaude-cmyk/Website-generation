# Operations guide

Day-to-day running of the store after launch: the staff checklist, backups and restore, monitoring,
free-tier limits, logging and privacy, and data retention. Launch steps are in
[`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md); undoing changes is in [`ROLLBACK.md`](ROLLBACK.md).

## Staff operations checklist

**Every shift**

- [ ] Admin → Orders: new orders, orders flagged for manual review (high value, several expensive
      units, new customer, split payment, repeated unfinished orders, many orders in an hour).
- [ ] InstaPay / split orders: compare the customer's transfer with the bank / InstaPay app **before**
      verifying. A screenshot alone is never proof — only staff verification (Admin → order →
      Record / verify payment, `payments.verify`) marks money received.
- [ ] COD orders: confirm the shipping fee with the customer (the site says the team confirms it).
- [ ] Reservations: unpaid orders hold stock for `commerce.reservationMinutes` (30 min by default);
      expired holds stop counting automatically.
- [ ] Service requests (repairs, trade-in, used devices, after-sales): reply, set status, add notes.
- [ ] Waitlist / "notify me" requests for products back in stock.
- [ ] Reviews waiting for moderation.

**Every day**

- [ ] Stock spot-check of fast-moving items against the shelf; correct with a stock adjustment
      (reason required — it is recorded as a stock movement).
- [ ] Abandoned carts (Admin → Abandoned carts) — follow up only in-app or by a manual call / WhatsApp.
- [ ] Integrations page (only if any are enabled): health and failed messages.

**Every week**

- [ ] Audit log review (Admin → Audit log): role changes, price changes, payment verifications,
      settings publishes, demo cleanup, integration changes.
- [ ] Staff access review (Admin → Staff): remove or suspend people who left.
- [ ] Backup (below).

**Never**

- Share admin accounts, passwords or one-time codes; every person signs in with their own email.
- Paste keys, passwords or customer data into chats, the site editor or support tickets.
- Mark an order paid from a screenshot or a phone call alone.

## Backups and restore

**An application export is not a database backup.** Admin → Import & export → Backup (JSON) and the
CSV exports are convenience copies of settings, catalog and content: handy to inspect or re-import a
few records, but they do not contain everything (orders, payments, audit history, auth users) and
cannot restore the database.

Real backups:

| What                     | How                                                                                               | When                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Supabase managed backups | Dashboard → Database → Backups. What is included depends on your Supabase plan — check it.        | automatic (if your plan includes them)        |
| Your own SQL dump (free) | `supabase db dump --linked -f schema.sql` and `supabase db dump --linked --data-only -f data.sql` | before launch, before every migration, weekly |
| Storage files (images)   | Download the public `media` bucket from the dashboard or with the Supabase CLI / S3 tools         | monthly, and before bulk changes              |

Keep at least the last four weekly dumps off the server (encrypted drive or password manager). The
dumps contain customer data: treat them as confidential.

**Restore** (practise once on staging before launch):

1. Create a **new** Supabase project (never restore over the only copy of live data).
2. Apply the schema dump (or `supabase db push` the migrations), then the data dump, with `psql`.
3. Check: order counts, latest orders, product prices, settings; sign in to the admin.
4. Point the frontend at the restored project (rebuild with its URL / anon key), set the Auth URL
   configuration and Edge Function secrets again.

## Monitoring

There is no paid monitoring service in this release. Free, built-in signals:

- **Supabase Dashboard → Reports / Usage**: database size, egress, auth users, function calls.
- **Supabase → Logs**: API, auth, database and Edge Function logs (errors, slow queries).
- **Supabase → Advisors**: security (RLS, exposed functions) and performance hints — check weekly.
- **Admin dashboard**: setup checklist, data mode, order and request queues, integration health.
- **Static host**: deploy history and (on most hosts) basic traffic numbers.
- Optional: any free uptime checker pinging `https://<domain>/` and `https://<project>.supabase.co/auth/v1/health`.

First week after launch: check orders and requests at least twice a day, the Supabase usage page
daily, and run the [smoke test](LAUNCH_RUNBOOK.md#post-deploy-smoke-test) after every deploy.

## Free-tier limits

The platform is built to run on Supabase's free plan and a free static host. Limits change — check
supabase.com/pricing and your host's pricing page. Practical points:

- Free Supabase projects can be **paused after a period of inactivity**; a store with daily traffic
  and staff sign-ins stays active, but check the dashboard if the site suddenly cannot load data.
- Database size, storage, egress and monthly active users are capped. Product images are the
  biggest consumer: upload web-sized images rather than camera originals.
- The built-in auth email sender is rate-limited; if sign-in emails stop arriving at peak times,
  configure your own SMTP (many providers have free tiers) — an owner decision.
- Nothing in this repository upgrades a plan or enables a paid provider; when a limit is reached
  the owner decides.

## Logging and privacy

- The browser app logs nothing in production builds (developer messages only in development) and
  sends no data to third parties. Google Analytics is off by default and, if the owner enables it,
  loads only after the visitor accepts analytics cookies and never on private pages.
- The audit log records **who** did **what** (actor, action, entity, changed fields with before /
  after values) — no passwords, keys, payment card data or IP addresses.
- Integration errors are redacted (secrets and tokens are removed before anything is stored).
- The guest anti-abuse limiter stores the requester's IP address with a timestamp for at most about
  a day (`app.rate_events`), only for the waitlist and stock-alert forms.
- Customer data (name, phone, address, orders, requests) is visible only to the customer and to
  staff whose role allows it (RLS + permission checks in every database function).

## Data retention

No automatic deletion was added for launch — deleting business records is an owner decision. What
expires or is cleaned up today:

| Data                                 | What happens                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Stock reservations of unpaid orders  | stop counting after `reservationMinutes`; `release_expired_reservations()` tidies them (optional) |
| Guest anti-abuse rate events         | deleted after about a day                                                                         |
| Waitlist / stock-alert requests      | shown as expired after `engagement.requests.expireAfterDays` (180) — not deleted                  |
| Abandoned carts                      | listed after `abandoned_cart.thresholdHours` (48); follow-up in-app only                          |
| Orders, payments, audit log, history | kept (needed for accounting, warranty and disputes)                                               |

If the owner adopts a retention policy (for example deleting closed service requests after N years),
implement it as a reviewed migration or a scheduled function, document it in the privacy policy,
and take a backup first.

## Error observability

- Customers see friendly error pages (bilingual) with a way back; the not-found page answers a real
  404 status.
- A deploy that removes old files does not break open tabs: they reload once to the new version.
- Server-side errors appear in Supabase → Logs; integration failures appear on the integration's
  page with a safe error code.
- A dedicated error-tracking service is **not** included (it would send visitor data to a third
  party); if the owner wants one later, add it with consent and a privacy-policy update.
