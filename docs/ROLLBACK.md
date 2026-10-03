# Rollback and incident recovery

How to undo a bad release or a bad change. The guiding rules:

- **Prefer the smallest undo**: a setting or layout version before a frontend rollback, a frontend
  rollback before touching the database.
- **The database moves forward only.** There are no "down" migrations. A database problem is fixed by
  a new, reviewed forward migration (or, as a last resort, a restore into a fresh project). Never run
  destructive SQL from this page without reading it, understanding it and taking a backup first.
- **Keep the previous deployment** of the frontend available until the new one has passed the
  [post-deploy smoke test](LAUNCH_RUNBOOK.md#post-deploy-smoke-test).
- Every admin-side undo below is recorded in the audit log (Admin → Audit log).

## Which undo do I need?

| Symptom                                                       | Undo                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Wrong text, price display, hours, payment details on the site | [Settings version](#store-settings) — Admin → Settings → history |
| Home / Apple / offers page looks wrong after an edit          | [Site Editor version](#site-editor-layouts) — Version history    |
| An integration sends wrong messages / imports wrong data      | [Disable the integration](#integrations)                         |
| The whole site broke after a deploy (blank page, errors)      | [Frontend rollback](#frontend)                                   |
| Visitors keep seeing an old or broken cached version          | [Service worker kill switch](#service-worker-kill-switch)        |
| Demo data was deleted / real data looks deleted               | [Demo cleanup](#demo-cleanup)                                    |
| A migration or a data change damaged the database             | [Database incidents](#database-incidents)                        |

## Store settings

Admin → Settings → pick the setting → **Version history** → restore a version. Restoring publishes
the old value as a **new** version (nothing is deleted), takes effect immediately for customers and
is audited (`rollback_setting`). Sensitive settings need an MFA session when "Require MFA for
admins" is on.

## Site Editor layouts

Admin → Site Editor → **Version history** → **Restore**. Every publish, restore or live edit records
a version; restoring publishes a new version and never deletes one (`site_editor_rollback`).
An unpublished draft can simply be discarded (`site_editor_discard_draft`) — customers never saw it.

## Integrations

Admin → Integrations → the integration → **Disable** (with a reason). The manual fallback (wa.me
WhatsApp links, in-app notifications, manual shipping fee, CSV import) is active again immediately.
Imported price and stock changes are in the price history / stock movements and the audit log, so
each one can be corrected by hand. To withdraw a provider's access completely, also remove its
server secret: `supabase secrets unset <NAME>` (names are listed on the integration's page).

## Frontend

The frontend is static files, so a rollback is "serve the previous `dist/` again". No database change
is involved.

| Host             | Rollback                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ShipStatic       | Deployments are immutable: point the domain back at the previous deployment (Domains → link the earlier deployment), or re-upload the previous `dist/`. |
| Netlify          | Deploys → pick the previous deploy → **Publish deploy**.                                                                                                |
| Cloudflare Pages | Deployments → previous deployment → **Rollback to this deployment**.                                                                                    |
| Any other host   | Re-upload the previous `dist/` (keep the last two builds, or rebuild the previous git tag).                                                             |

To rebuild an older version: `git checkout <tag or commit> && npm ci && npm run build` with the same
`VITE_*` values as before.

After a rollback, open tabs recover on their own: each release has its own page cache, the service
worker is always revalidated (`Cache-Control: no-cache`), and a tab that asks for a chunk that no
longer exists reloads once instead of erroring.

## Service worker kill switch

Use only if visitors are stuck on a broken cached version and a normal redeploy did not help.
Deploy this file **as `sw.js`** (replacing the generated one), keep it for a few weeks, then go back
to normal builds:

```js
// sw.js — kill switch: removes every cache and unregisters itself, then reloads open tabs.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' }))
        client.navigate(client.url);
    })(),
  );
});
```

The site keeps working without a service worker (it only loses offline support). The next normal
build registers the real worker again.

## Demo cleanup

`delete_all_demo_data()` (Admin → Import & export → Demo data) deletes rows flagged `is_demo` only —
real products, orders, customers, settings and layouts are never touched (proven by the database
tests). If demo content was wanted (a sales demo on staging), load `supabase/seed/demo.sql` again on
that staging project. Never load it on production.

If real records seem to be missing after a cleanup, they were flagged `is_demo` by mistake: stop,
check the audit log (`demo.delete_all` shows who and when) and restore those rows from the
pre-launch backup (see below) — do not re-run the demo seed.

## Database incidents

1. **Stop the damage**: disable the integration or feature involved; if needed, roll the frontend
   back so customers stop triggering the problem.
2. **Look before acting**: Admin → Audit log (who changed what, with before / after values), price
   history, stock movements, order timeline. Supabase → Logs for errors.
3. **Fix forward**: write a new migration that corrects the schema or data, test it locally with
   `npm run test:db`, then `supabase db push`. Keep it idempotent like the existing ones.
4. **Restore only as a last resort**, and never over the live database first: restore the backup
   (Supabase backups / PITR if your plan includes them, or your own `supabase db dump` files) into a
   **new** project, verify it, then either copy the needed rows back or switch the frontend to the
   new project (rebuild with its URL and anon key). Re-create Edge Function secrets there.

### Phase 10 launch-readiness migration

`20261004100000_launch_readiness.sql` adds guard triggers. If one of them ever blocks legitimate
use, it can be switched off on its own (non-destructive — no data is removed) while a forward fix
is prepared. Review and run manually in the SQL editor:

```sql
-- Guest waitlist / stock-alert flood limit (raises 'rate_limited'):
drop trigger if exists waitlist_entries_rate_guard on public.waitlist_entries;
drop trigger if exists stock_notifications_rate_guard on public.stock_notifications;
-- Integration changes requiring MFA when "Require MFA for admins" is on:
drop trigger if exists integration_configs_mfa_guard on public.integration_configs;
-- Rejected-webhook log cap:
drop trigger if exists integration_webhook_events_cap on public.integration_webhook_events;
```

Re-running the migration file restores them.

## Orders, money and stock

Orders are never edited in place to "undo" them. An unpaid order that has not been dispatched is
**cancelled** with a reason: its stock reservations are released, committed stock goes back through
stock movements, and the order timeline keeps the history. The database refuses to cancel an order
that already has verified money (`refund_required`) or has been dispatched (`cannot_cancel`): V1 has
no automated refund — hand the money back outside the system, record it in the order notes, and use
the After-Sales workflow for returns. Verified payments are added only by staff with
`payments.verify` (MFA when required); if one was recorded by mistake, do not delete rows — note it
on the order and correct it with a reviewed forward fix, keeping the audit trail.
