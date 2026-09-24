-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0001 · Foundation
-- Schemas, shared helpers and conventions used by every later migration.
--
-- Conventions (see docs/DATABASE.md):
--   • uuid primary keys (gen_random_uuid()), created_at / updated_at timestamptz (UTC).
--   • Soft deletes via deleted_at where records must stay referencable (roles, profiles, catalog…).
--   • Text + CHECK constraints instead of Postgres ENUMs (easier to evolve and to migrate away).
--   • Bilingual content stored as public.localized_text ({"ar": "...", "en": "..."}; Arabic required).
--   • Seedable business tables carry is_demo boolean and register in app.demo_tables.
--   • RLS is enabled on every public table; writes that need business rules go through
--     SECURITY DEFINER RPCs that check permissions with app.has_permission().
--   • Plain PostgreSQL only (no Supabase-specific SQL besides auth.uid()/auth.jwt() and storage.*),
--     so a future move away from Supabase stays feasible.
-- ════════════════════════════════════════════════════════════════════════════

-- `app`: helper functions used by RLS policies and RPCs (not exposed through the Data API).
create schema if not exists app;
-- `app_private`: operator-only functions (e.g. first-owner bootstrap). No API role can reach it.
create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app to anon, authenticated, service_role;

comment on schema app is 'MALEK STORE helper functions for RLS policies and RPCs. Not exposed via the Data API.';
comment on schema app_private is 'Operator-only functions. Callable from the SQL editor / psql only.';

-- ── updated_at maintenance ───────────────────────────────────────────────────
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is 'BEFORE UPDATE trigger: stamps updated_at with now() (UTC).';

-- ── Locales ──────────────────────────────────────────────────────────────────
create or replace function app.is_locale(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value in ('ar', 'en');
$$;

-- ── Localized text ───────────────────────────────────────────────────────────
-- {"ar": "…", "en": "…"} — only ar/en keys, string values, Arabic required and non-blank.
create or replace function app.is_localized_text(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or (
      jsonb_typeof(p_value) = 'object'
      and p_value ? 'ar'
      and jsonb_typeof(p_value -> 'ar') = 'string'
      and length(btrim(p_value ->> 'ar')) > 0
      and not exists (
        select 1
        from jsonb_each(p_value) as entry(key, value)
        where entry.key not in ('ar', 'en') or jsonb_typeof(entry.value) <> 'string'
      )
    );
$$;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'localized_text' and n.nspname = 'public') then
    create domain public.localized_text as jsonb
      check (app.is_localized_text(value));
  end if;
end;
$$;

comment on domain public.localized_text is
  'Bilingual text {"ar": "...", "en": "..."}. Arabic is required and is the display fallback.';

-- Resolve a localized value for display with Arabic fallback (useful in views/exports).
create or replace function app.localized(p_value jsonb, p_locale text default 'ar')
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p_value ->> p_locale), ''), p_value ->> 'ar');
$$;

-- ── JSON diff helper (audit) ─────────────────────────────────────────────────
create or replace function app.jsonb_changed_keys(p_before jsonb, p_after jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(key order by key), '{}')
  from (
    select key from jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) as key
    union
    select key from jsonb_object_keys(coalesce(p_after, '{}'::jsonb)) as key
  ) as keys
  where (p_before -> key) is distinct from (p_after -> key);
$$;

revoke all on function app.set_updated_at() from public;
grant execute on function app.is_locale(text), app.is_localized_text(jsonb), app.localized(jsonb, text),
  app.jsonb_changed_keys(jsonb, jsonb) to anon, authenticated, service_role;
