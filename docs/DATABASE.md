# Database

PostgreSQL via Supabase. All schema lives in ordered, idempotent migrations in `supabase/migrations/`.

## Conventions

- `uuid` primary keys (`gen_random_uuid()`), `created_at` / `updated_at` as `timestamptz` (UTC);
  `app.set_updated_at()` trigger maintains `updated_at`.
- Soft delete via `deleted_at` where rows must stay referencable (roles, profiles; later catalog, orders).
- `text` + `CHECK` constraints instead of Postgres enums (easier to evolve and to migrate away).
- Bilingual content: `public.localized_text` domain — `{"ar": "…", "en": "…"}`, Arabic required,
  only `ar`/`en` keys. `app.localized(value, locale)` resolves with Arabic fallback.
- Seedable business tables: `is_demo boolean not null default false` + `app.register_demo_table()`.
- Schemas: `public` (API-exposed tables/RPCs), `app` (helper functions for RLS/RPCs, not exposed),
  `app_private` (operator-only; no API role has access).
- Every public table has RLS enabled (asserted by `npm run test:db`). Client roles lose direct write
  privileges on sensitive tables; changes go through permission-checking `SECURITY DEFINER` RPCs with
  `set search_path = ''`.

## Migrations (Phase 01)

| File                                 | Contents                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260924100000_foundation.sql`      | schemas, `set_updated_at`, locale + `localized_text` domain, JSON diff helper                                                                                                                                                                                                                                                      |
| `20260924100100_audit_log.sql`       | append-only `audit_logs`, `app.audit_row_change()` trigger, `app.log_event()`                                                                                                                                                                                                                                                      |
| `20260924100200_identity_access.sql` | `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`; `app.has_permission/is_staff/is_owner/max_role_rank`; MFA gate; RLS; auth-user profile provisioning; RPCs `get_my_access`, `assign_role`, `revoke_role`, `set_role_permissions`; `app_private.bootstrap_first_owner`; permission catalog + system roles seed |
| `20260924100300_site_settings.sql`   | `setting_definitions`, `site_settings` (published), `site_setting_drafts`, `site_settings_versions`; RPCs `save_setting_draft`, `discard_setting_draft`, `publish_setting`, `rollback_setting`                                                                                                                                     |
| `20260924100400_demo_data.sql`       | `app.demo_tables`, `app.register_demo_table`, `demo_data_summary()`, `delete_all_demo_data()`                                                                                                                                                                                                                                      |
| `20260924100500_storage_buckets.sql` | buckets (products, banners, site-media public; repairs, trade-in, after-sales, reviews, avatars, invoices private) + policies                                                                                                                                                                                                      |

Later phases add their own migrations (catalog, variants, inventory, price history, stock movements,
orders, payments, shipping, repairs, trade-in, used requests, reviews, wishlist, recently viewed,
offers, promo codes, loyalty, waitlist, notifications, news, site pages/sections, integrations,
uploaded files, receipt templates, legal pages, analytics events, abandoned carts, stock notifications).
Existing migrations are never edited once applied to a real project — changes go in new files.

## RPCs available to the app (Phase 01)

| RPC                                                                          | Who                      | Purpose                                               |
| ---------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `get_my_access()`                                                            | signed-in                | roles + effective permissions of the caller           |
| `assign_role(user, role)` / `revoke_role(user, role)`                        | `roles.manage`           | anti-escalation rules, last-owner protection, audited |
| `set_role_permissions(role, permissions[])`                                  | `roles.manage`           | non-owners can only grant what they hold              |
| `save_setting_draft(key, value)` / `discard_setting_draft(key)`              | key's edit permission    | drafts never visible publicly                         |
| `publish_setting(key, note, force)` / `rollback_setting(key, version, note)` | key's publish permission | versioned, conflict-checked, audited                  |
| `demo_data_summary()` / `delete_all_demo_data()`                             | `demo.manage`            | demo cleanup                                          |

Sensitive RPCs call `app.assert_sensitive_action_allowed()`, which requires an MFA (`aal2`) session
when `security.adminMfaRequired` is enabled.

## Contracts shared with the frontend

- `src/domain/access/access-catalog.json` — permissions, system roles, grants
- `src/domain/settings/setting-definitions.json` — setting keys, visibility, permissions
- `supabase/seed/data/base/site-settings.json` — base settings (generates `supabase/seed/base.sql`)

`npm run test:db` fails if the migrated database drifts from these files.

## Testing migrations locally

`npm run test:db` (see `scripts/db/test-migrations.sh`):

1. starts a throwaway PostgreSQL cluster (no Docker, no Supabase account),
2. applies `supabase/tests/supabase-shim.sql` (test-only stand-ins for Supabase roles, `auth.users`,
   `auth.uid()`, `storage.*`, and Supabase's default grants — so RLS must be the real guard),
3. applies all migrations, the base and demo seeds, then **re-applies all migrations** (idempotency),
4. checks the contracts above, and
5. runs `supabase/tests/sql/*.test.sql` (111 assertions in Phase 01: RLS on every table, anonymous vs
   customer vs staff visibility, anti-escalation, bootstrap rules, draft isolation, publish/rollback
   versions, MFA gate, storage folder isolation, audit immutability, demo deletion).

With the Supabase CLI you can also run everything against a full local stack: `supabase start` then
`supabase db reset` (applies migrations and the seeds listed in `supabase/config.toml`).

## Portability

Moving off Supabase requires: an `auth.users`-compatible table (or re-pointing `profiles.id`), a JWT
claims provider setting `request.jwt.claims` (the helpers read `sub`, `role`, `aal`), and an object
store replacing `storage.objects` policies. Everything else is plain PostgreSQL.
