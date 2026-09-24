# Creating the first Owner

MALEK STORE ships **without any default admin account or password**. The first Owner is created
once, by someone with access to the Supabase project dashboard.

## Steps

1. Deploy the site in live mode (migrations applied, `supabase/seed/base.sql` run, Email auth enabled).
2. The owner opens `https://<site>/admin/sign-in`, enters their email and signs in with the emailed
   code or link. The dashboard says "You don't have dashboard access" — expected: the account exists
   but has no role yet.
3. In Supabase → **SQL Editor**, run:

   ```sql
   select app_private.bootstrap_first_owner('owner@example.com');
   ```

   It returns the owner's user id and writes an `access.bootstrap_owner` audit entry.

4. The owner reloads `/admin` and now has full access.

## Why this is safe

- `app_private` has **no privileges** for `anon`, `authenticated` or `service_role`, so the function
  cannot be called through the public API — only from the SQL editor / `psql` as the database owner.
- The function **refuses to run once any Owner exists** (it takes a lock so two sessions cannot race),
  so it cannot be reused for privilege escalation later.
- Additional Owners/staff are granted through the audited `assign_role` RPC by an existing Owner
  (or, for roles below their rank, by staff holding `roles.manage`). The last Owner can never be removed.

## Recommended hardening after bootstrap

- Enable an authenticator app (TOTP MFA — free in Supabase Auth) for the Owner, then publish the
  `security` setting with `{"adminMfaRequired": true}` so sensitive actions require an MFA session.
- Keep the Supabase dashboard account itself protected with MFA.

## Recovery

If the only Owner loses access to their email, a database operator can grant Owner to another
existing user from the SQL editor (as the database owner, which bypasses the API-level rules):

```sql
insert into public.user_roles (user_id, role_id)
select u.id, r.id from auth.users u, public.roles r
where lower(u.email) = lower('new-owner@example.com') and r.key = 'owner';
```

This is recorded in `audit_logs` by the `user_roles` audit trigger.
