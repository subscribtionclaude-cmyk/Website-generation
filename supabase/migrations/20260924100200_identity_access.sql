-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0003 · Identity, roles & permissions (RBAC)
--
--   profiles          1:1 with auth.users (customers and staff)
--   roles             Owner, Super Admin, Store Manager, Sales, Customer Service,
--                     Repairs Team, Content Editor, Design Editor (+ future custom roles)
--   permissions       fine-grained capability keys (catalog contract: src/domain/access/access-catalog.json)
--   role_permissions  role → permission grants
--   user_roles        user → role assignments
--
-- Authorization happens HERE (RLS + permission-checking RPCs), never only in the UI.
-- Role/grant tables have no client write policies: changes go through assign_role / revoke_role /
-- set_role_permissions, which enforce anti-escalation rules and are audited.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Profiles ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  full_name         text check (full_name is null or char_length(full_name) between 1 and 120),
  phone             text check (phone is null or phone ~ '^\+?[0-9]{5,15}$'),
  preferred_locale  text not null default 'ar' check (app.is_locale(preferred_locale)),
  admin_locale      text check (admin_locale is null or app.is_locale(admin_locale)),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table public.profiles is 'Customer/staff profile, 1:1 with auth.users. Phone is required later at checkout.';
comment on column public.profiles.admin_locale is 'Per-user dashboard language (independent from the storefront language).';

create index if not exists profiles_email_idx on public.profiles (lower(email));

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- ── Roles & permissions ──────────────────────────────────────────────────────
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         public.localized_text not null,
  description  public.localized_text,
  rank         integer not null check (rank between 0 and 100),
  grants_all   boolean not null default false,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on column public.roles.rank is 'Seniority. Staff can only assign/edit roles strictly below their own highest rank (Owner excepted).';
comment on column public.roles.grants_all is 'Owner only: implicitly holds every permission, including ones added by future migrations.';

-- Exactly one role may grant everything (Owner).
create unique index if not exists roles_single_grants_all_idx on public.roles ((true)) where grants_all;

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at before update on public.roles
  for each row execute function app.set_updated_at();

create table if not exists public.permissions (
  key           text primary key check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  module        text not null,
  is_sensitive  boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on column public.permissions.is_sensitive is 'Sensitive actions may additionally require an MFA (aal2) session when security.adminMfaRequired is on.';

create table if not exists public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade on update cascade,
  granted_at      timestamptz not null default now(),
  granted_by      uuid,
  primary key (role_id, permission_key)
);

create index if not exists role_permissions_permission_idx on public.role_permissions (permission_key);

create table if not exists public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete restrict,
  granted_at  timestamptz not null default now(),
  granted_by  uuid,
  primary key (user_id, role_id)
);

create index if not exists user_roles_role_idx on public.user_roles (role_id);

-- ── Permission helpers (used by RLS policies & RPCs) ─────────────────────────
create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.deleted_at is null
    left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = p_permission
    where ur.user_id = app.current_actor_id()
      and (r.grants_all or rp.permission_key is not null)
  );
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.deleted_at is null
    where ur.user_id = app.current_actor_id()
  );
$$;

create or replace function app.is_owner(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.deleted_at is null
    where ur.user_id = coalesce(p_user_id, app.current_actor_id()) and r.grants_all
  );
$$;

create or replace function app.max_role_rank(p_user_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.rank), 0)
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.deleted_at is null
  where ur.user_id = coalesce(p_user_id, app.current_actor_id());
$$;

revoke all on function app.has_permission(text), app.is_staff(), app.is_owner(uuid), app.max_role_rank(uuid) from public;
grant execute on function app.has_permission(text), app.is_staff(), app.is_owner(uuid), app.max_role_rank(uuid)
  to anon, authenticated, service_role;

-- Sensitive-action gate. MFA (authenticator app / TOTP, free in Supabase Auth) is enforced only when
-- the owner turns on security.adminMfaRequired; defined here, reads site_settings at call time.
create or replace function app.assert_sensitive_action_allowed()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required boolean := false;
begin
  if to_regclass('public.site_settings') is not null then
    execute $q$select coalesce((value ->> 'adminMfaRequired')::boolean, false)
               from public.site_settings where key = 'security'$q$
      into v_required;
  end if;
  if coalesce(v_required, false)
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501',
      hint = 'This action requires an authenticator-app (MFA) verified session.';
  end if;
end;
$$;

revoke all on function app.assert_sensitive_action_allowed() from public;
grant execute on function app.assert_sensitive_action_allowed() to authenticated, service_role;

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- Profiles: users read/update their own; staff with customer/user permissions can read.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select app.current_actor_id())
    or (select app.has_permission('customers.view'))
    or (select app.has_permission('users.view'))
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select app.current_actor_id()))
  with check (id = (select app.current_actor_id()));

-- Column-level: users may only change these fields on their own profile.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, phone, preferred_locale, admin_locale) on public.profiles to authenticated;

-- Role catalog: readable by staff; writes only through RPCs below.
drop policy if exists roles_select_staff on public.roles;
create policy roles_select_staff on public.roles for select to authenticated
  using ((select app.is_staff()));

drop policy if exists permissions_select_staff on public.permissions;
create policy permissions_select_staff on public.permissions for select to authenticated
  using ((select app.is_staff()));

drop policy if exists role_permissions_select_staff on public.role_permissions;
create policy role_permissions_select_staff on public.role_permissions for select to authenticated
  using ((select app.is_staff()));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = (select app.current_actor_id())
    or (select app.has_permission('users.view'))
  );

revoke insert, update, delete, truncate on public.roles, public.permissions, public.role_permissions, public.user_roles
  from anon, authenticated;
revoke select on public.roles, public.permissions, public.role_permissions, public.user_roles from anon;

-- Audit log visibility (table created in 0002).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select app.has_permission('audit.view')));

-- ── Audit triggers ───────────────────────────────────────────────────────────
drop trigger if exists roles_audit on public.roles;
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function app.audit_row_change('key');

drop trigger if exists role_permissions_audit on public.role_permissions;
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row_change('role_id,permission_key');

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function app.audit_row_change('user_id,role_id');

-- ── Profile provisioning from Supabase Auth ──────────────────────────────────
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locale text;
begin
  v_locale := new.raw_user_meta_data ->> 'locale';
  insert into public.profiles (id, email, preferred_locale)
  values (new.id, new.email, case when app.is_locale(v_locale) then v_locale else 'ar' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function app.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function app.handle_new_auth_user(), app.sync_auth_user_email() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app.sync_auth_user_email();

-- Backfill profiles for users that signed up before this migration.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ── RPC: current user's access ───────────────────────────────────────────────
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select app.current_actor_id() as id),
  my_roles as (
    select r.* from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.deleted_at is null
    join me on ur.user_id = me.id
  ),
  grants_all as (select coalesce(bool_or(grants_all), false) as value from my_roles)
  select jsonb_build_object(
    'userId', (select id from me),
    'grantsAll', (select value from grants_all),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'rank', rank, 'name', name) order by rank desc, key)
      from my_roles), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(p.key order by p.key)
      from public.permissions p
      where (select value from grants_all)
         or exists (select 1 from public.role_permissions rp
                    join my_roles r on r.id = rp.role_id
                    where rp.permission_key = p.key)), '[]'::jsonb)
  );
$$;

comment on function public.get_my_access() is 'Roles and effective permissions of the calling user.';

-- ── RPCs: role assignment with anti-escalation rules ─────────────────────────
-- Rules: caller needs roles.manage; may only assign/revoke roles ranked strictly below their own
-- highest rank; only an Owner can grant/revoke Owner; the last Owner can never be removed.
create or replace function public.assign_role(p_user_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_role public.roles;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not app.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.assert_sensitive_action_allowed();

  select * into v_role from public.roles where key = p_role_key and deleted_at is null;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if v_role.grants_all then
    if not app.is_owner(v_actor) then raise exception 'only_owner_can_grant_owner' using errcode = '42501'; end if;
  elsif not app.is_owner(v_actor) and v_role.rank >= app.max_role_rank(v_actor) then
    raise exception 'cannot_grant_role_at_or_above_own_rank' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role_id, granted_by)
  values (p_user_id, v_role.id, v_actor)
  on conflict (user_id, role_id) do nothing;
end;
$$;

create or replace function public.revoke_role(p_user_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_role public.roles;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not app.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.assert_sensitive_action_allowed();

  select * into v_role from public.roles where key = p_role_key;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;

  if v_role.grants_all then
    if not app.is_owner(v_actor) then raise exception 'only_owner_can_revoke_owner' using errcode = '42501'; end if;
    -- Serialize owner removals so two concurrent revocations cannot remove the last owner.
    perform 1 from public.roles where id = v_role.id for update;
    if (select count(*) from public.user_roles where role_id = v_role.id and user_id <> p_user_id) = 0 then
      raise exception 'cannot_remove_last_owner' using errcode = '42501';
    end if;
  elsif not app.is_owner(v_actor) and v_role.rank >= app.max_role_rank(v_actor) then
    raise exception 'cannot_revoke_role_at_or_above_own_rank' using errcode = '42501';
  end if;

  delete from public.user_roles where user_id = p_user_id and role_id = v_role.id;
end;
$$;

-- Replace a role's permission set. Non-owners can only grant permissions they hold themselves.
create or replace function public.set_role_permissions(p_role_key text, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_role public.roles;
  v_unknown text;
  v_missing text;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not app.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.assert_sensitive_action_allowed();

  select * into v_role from public.roles where key = p_role_key and deleted_at is null;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if v_role.grants_all then raise exception 'owner_role_is_implicit' using errcode = '42501'; end if;
  if not app.is_owner(v_actor) and v_role.rank >= app.max_role_rank(v_actor) then
    raise exception 'cannot_edit_role_at_or_above_own_rank' using errcode = '42501';
  end if;

  select requested.permission_key into v_unknown
  from unnest(coalesce(p_permissions, '{}')) as requested (permission_key)
  where not exists (select 1 from public.permissions p where p.key = requested.permission_key)
  limit 1;
  if v_unknown is not null then
    raise exception 'unknown_permission: %', v_unknown using errcode = '22023';
  end if;

  if not app.is_owner(v_actor) then
    select requested.permission_key into v_missing
    from unnest(coalesce(p_permissions, '{}')) as requested (permission_key)
    where not app.has_permission(requested.permission_key)
    limit 1;
    if v_missing is not null then
      raise exception 'cannot_grant_permission_you_do_not_hold: %', v_missing using errcode = '42501';
    end if;
  end if;

  delete from public.role_permissions
  where role_id = v_role.id and permission_key <> all (coalesce(p_permissions, '{}'));

  insert into public.role_permissions (role_id, permission_key, granted_by)
  select v_role.id, requested.permission_key, v_actor
  from unnest(coalesce(p_permissions, '{}')) as requested (permission_key)
  on conflict (role_id, permission_key) do nothing;
end;
$$;

revoke all on function public.get_my_access() from public, anon;
revoke all on function public.assign_role(uuid, text) from public, anon;
revoke all on function public.revoke_role(uuid, text) from public, anon;
revoke all on function public.set_role_permissions(text, text[]) from public, anon;
grant execute on function public.get_my_access(), public.assign_role(uuid, text), public.revoke_role(uuid, text),
  public.set_role_permissions(text, text[]) to authenticated;

-- ── First-owner bootstrap (operator-only) ────────────────────────────────────
-- Run ONCE from the Supabase SQL editor after the owner has signed in to the site once:
--   select app_private.bootstrap_first_owner('owner@example.com');
-- Refuses to run when any Owner exists, so it can never be used to escalate later.
-- Not callable through the API (schema has no grants for anon/authenticated/service_role).
create or replace function app_private.bootstrap_first_owner(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_owner_role uuid;
begin
  select id into v_owner_role from public.roles where grants_all;
  if v_owner_role is null then raise exception 'Owner role missing — run all migrations first.'; end if;

  lock table public.user_roles in share row exclusive mode;
  if exists (select 1 from public.user_roles where role_id = v_owner_role) then
    raise exception 'An Owner already exists. Additional owners must be granted by an existing Owner from the dashboard.'
      using errcode = '42501';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No user with email %. Sign in on the site once (email code) and run this again.', p_email
      using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email) values (v_user_id, lower(btrim(p_email)))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role_id, granted_by) values (v_user_id, v_owner_role, null);
  perform app.log_event('access.bootstrap_owner', 'public.user_roles', v_user_id::text, null,
                        jsonb_build_object('user_id', v_user_id), jsonb_build_object('email', lower(btrim(p_email))));
  return v_user_id;
end;
$$;

revoke all on function app_private.bootstrap_first_owner(text) from public, anon, authenticated, service_role;

-- ── Seed: permission catalog & system roles (contract: access-catalog.json) ──
insert into public.permissions (key, module, is_sensitive) values
  ('dashboard.view', 'dashboard', false),
  ('catalog.view', 'catalog', false),
  ('catalog.manage', 'catalog', false),
  ('pricing.manage', 'catalog', true),
  ('inventory.manage', 'catalog', true),
  ('orders.view', 'orders', false),
  ('orders.manage', 'orders', false),
  ('payments.verify', 'orders', true),
  ('shipping.manage', 'orders', false),
  ('customers.view', 'customers', false),
  ('customers.manage', 'customers', false),
  ('repairs.view', 'services', false),
  ('repairs.manage', 'services', false),
  ('tradein.view', 'services', false),
  ('tradein.manage', 'services', false),
  ('used_requests.view', 'services', false),
  ('used_requests.manage', 'services', false),
  ('after_sales.view', 'services', false),
  ('after_sales.manage', 'services', false),
  ('reviews.moderate', 'engagement', false),
  ('waitlists.manage', 'engagement', false),
  ('notifications.manage', 'engagement', false),
  ('marketing.manage', 'engagement', false),
  ('content.view', 'content', false),
  ('content.manage', 'content', false),
  ('content.publish', 'content', false),
  ('legal.manage', 'content', false),
  ('design.edit', 'design', false),
  ('design.publish', 'design', false),
  ('analytics.view', 'analytics', false),
  ('reports.export', 'analytics', true),
  ('data.import', 'data', true),
  ('data.backup', 'data', true),
  ('demo.manage', 'data', true),
  ('settings.view', 'settings', false),
  ('settings.manage', 'settings', false),
  ('settings.publish', 'settings', true),
  ('integrations.manage', 'settings', true),
  ('security.manage', 'settings', true),
  ('users.view', 'access', false),
  ('users.manage', 'access', true),
  ('roles.manage', 'access', true),
  ('audit.view', 'access', false)
on conflict (key) do update set module = excluded.module, is_sensitive = excluded.is_sensitive;

insert into public.roles (key, name, rank, grants_all, is_system) values
  ('owner',            '{"ar": "المالك", "en": "Owner"}',                100, true,  true),
  ('super_admin',      '{"ar": "مدير عام النظام", "en": "Super Admin"}',  90, false, true),
  ('store_manager',    '{"ar": "مدير الفرع", "en": "Store Manager"}',     70, false, true),
  ('sales',            '{"ar": "المبيعات", "en": "Sales"}',                40, false, true),
  ('customer_service', '{"ar": "خدمة العملاء", "en": "Customer Service"}', 40, false, true),
  ('repairs_team',     '{"ar": "فريق الصيانة", "en": "Repairs Team"}',     30, false, true),
  ('content_editor',   '{"ar": "محرر المحتوى", "en": "Content Editor"}',   30, false, true),
  ('design_editor',    '{"ar": "محرر التصميم", "en": "Design Editor"}',    30, false, true)
on conflict (key) do nothing;

-- Super Admin: every permission defined so far.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, grants.permission_key
from public.roles r
join (values
  ('store_manager', array[
    'dashboard.view',
    'catalog.view', 'catalog.manage', 'pricing.manage', 'inventory.manage',
    'orders.view', 'orders.manage', 'payments.verify', 'shipping.manage',
    'customers.view', 'customers.manage',
    'repairs.view', 'repairs.manage', 'tradein.view', 'tradein.manage',
    'used_requests.view', 'used_requests.manage', 'after_sales.view', 'after_sales.manage',
    'reviews.moderate', 'waitlists.manage', 'notifications.manage', 'marketing.manage',
    'content.view', 'content.manage', 'content.publish', 'legal.manage',
    'analytics.view', 'reports.export', 'data.import',
    'settings.view', 'users.view', 'audit.view']),
  ('sales', array[
    'dashboard.view', 'catalog.view',
    'orders.view', 'orders.manage', 'shipping.manage',
    'customers.view',
    'tradein.view', 'tradein.manage', 'used_requests.view', 'used_requests.manage',
    'waitlists.manage']),
  ('customer_service', array[
    'dashboard.view', 'catalog.view', 'orders.view', 'customers.view',
    'repairs.view', 'tradein.view', 'used_requests.view', 'used_requests.manage',
    'after_sales.view', 'after_sales.manage',
    'reviews.moderate', 'waitlists.manage', 'notifications.manage']),
  ('repairs_team', array['dashboard.view', 'repairs.view', 'repairs.manage', 'customers.view', 'after_sales.view']),
  ('content_editor', array['dashboard.view', 'catalog.view', 'content.view', 'content.manage']),
  ('design_editor', array['dashboard.view', 'content.view', 'design.edit', 'design.publish'])
) as role_grants (role_key, permission_keys) on role_grants.role_key = r.key
cross join lateral unnest(role_grants.permission_keys) as grants (permission_key)
on conflict do nothing;
