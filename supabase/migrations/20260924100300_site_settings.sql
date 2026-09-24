-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0004 · Site settings (Draft → Publish, versioned, audited)
--
--   setting_definitions     registry of allowed keys, visibility and required permissions
--                           (contract: src/domain/settings/setting-definitions.json)
--   site_settings           PUBLISHED values (public keys readable by everyone)
--   site_setting_drafts     unpublished drafts (staff only — never visible to the public)
--   site_settings_versions  every published value, for history & rollback
--
-- Drafts live in a separate table so column-level leaks of unpublished content are impossible.
-- Values are validated again in the app with zod schemas (src/domain/settings/schemas.ts).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.setting_definitions (
  key                 text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  scope               text not null check (scope in ('design', 'settings', 'content', 'security')),
  is_public           boolean not null default false,
  edit_permission     text not null references public.permissions (key),
  publish_permission  text not null references public.permissions (key),
  created_at          timestamptz not null default now()
);

create table if not exists public.site_settings (
  key           text primary key references public.setting_definitions (key) on delete restrict,
  value         jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 262144),
  version       integer not null default 1 check (version >= 1),
  published_at  timestamptz not null default now(),
  published_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.site_settings is 'Published site configuration. Public keys are readable by anonymous visitors.';

create table if not exists public.site_setting_drafts (
  key           text primary key references public.setting_definitions (key) on delete cascade,
  value         jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 262144),
  base_version  integer,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.site_setting_drafts is 'Unpublished drafts (staff only). base_version detects concurrent publishes.';

create table if not exists public.site_settings_versions (
  id            bigint generated always as identity primary key,
  key           text not null references public.setting_definitions (key) on delete cascade,
  version       integer not null,
  value         jsonb not null,
  note          text check (note is null or char_length(note) <= 500),
  published_at  timestamptz not null default now(),
  published_by  uuid,
  unique (key, version)
);

create index if not exists site_settings_versions_key_idx on public.site_settings_versions (key, version desc);

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at before update on public.site_settings
  for each row execute function app.set_updated_at();

drop trigger if exists site_setting_drafts_set_updated_at on public.site_setting_drafts;
create trigger site_setting_drafts_set_updated_at before update on public.site_setting_drafts
  for each row execute function app.set_updated_at();

-- Any change of a published value gets a new version number — including direct operator edits
-- in the SQL editor — so history can never collide or be skipped.
create or replace function app.bump_setting_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.value is distinct from old.value and new.version <= old.version then
    new.version := old.version + 1;
    new.published_at := now();
    new.published_by := app.current_actor_id();
  end if;
  return new;
end;
$$;

revoke all on function app.bump_setting_version() from public;

drop trigger if exists site_settings_bump_version on public.site_settings;
create trigger site_settings_bump_version before update on public.site_settings
  for each row execute function app.bump_setting_version();

-- Every published value is recorded as a version (initial seed included).
create or replace function app.record_setting_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.value = old.value then
    return new;
  end if;
  insert into public.site_settings_versions (key, version, value, note, published_at, published_by)
  values (new.key, new.version, new.value, nullif(current_setting('app.publish_note', true), ''),
          new.published_at, new.published_by);
  return new;
end;
$$;

revoke all on function app.record_setting_version() from public;

drop trigger if exists site_settings_record_version on public.site_settings;
create trigger site_settings_record_version after insert or update on public.site_settings
  for each row execute function app.record_setting_version();

drop trigger if exists site_settings_audit on public.site_settings;
create trigger site_settings_audit after insert or update or delete on public.site_settings
  for each row execute function app.audit_row_change('key');

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.setting_definitions enable row level security;
alter table public.site_settings enable row level security;
alter table public.site_setting_drafts enable row level security;
alter table public.site_settings_versions enable row level security;

drop policy if exists setting_definitions_select on public.setting_definitions;
create policy setting_definitions_select on public.setting_definitions for select to anon, authenticated
  using (true);

-- Published public settings: everyone. Private settings (e.g. security): staff with settings.view.
drop policy if exists site_settings_select on public.site_settings;
create policy site_settings_select on public.site_settings for select to anon, authenticated
  using (
    exists (select 1 from public.setting_definitions d where d.key = site_settings.key and d.is_public)
    or (select app.has_permission('settings.view'))
  );

-- Drafts and history: staff who may edit that key (or view settings).
drop policy if exists site_setting_drafts_select on public.site_setting_drafts;
create policy site_setting_drafts_select on public.site_setting_drafts for select to authenticated
  using (
    exists (select 1 from public.setting_definitions d
            where d.key = site_setting_drafts.key
              and (app.has_permission(d.edit_permission) or app.has_permission(d.publish_permission)))
  );

drop policy if exists site_settings_versions_select on public.site_settings_versions;
create policy site_settings_versions_select on public.site_settings_versions for select to authenticated
  using ((select app.has_permission('settings.view')) or (select app.has_permission('design.edit')));

-- No direct writes from API roles: all changes go through the RPCs below.
revoke insert, update, delete, truncate on public.setting_definitions, public.site_settings,
  public.site_setting_drafts, public.site_settings_versions from anon, authenticated;
revoke select on public.site_setting_drafts, public.site_settings_versions from anon;
grant select on public.setting_definitions, public.site_settings to anon, authenticated;
grant select on public.site_setting_drafts, public.site_settings_versions to authenticated;

-- ── RPCs ─────────────────────────────────────────────────────────────────────
create or replace function app.require_setting_permission(p_key text, p_action text)
returns public.setting_definitions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_def public.setting_definitions;
begin
  if app.current_actor_id() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_def from public.setting_definitions where key = p_key;
  if not found then raise exception 'unknown_setting' using errcode = 'P0002'; end if;
  if not app.has_permission(case p_action when 'publish' then v_def.publish_permission else v_def.edit_permission end) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_def;
end;
$$;

revoke all on function app.require_setting_permission(text, text) from public;

create or replace function public.save_setting_draft(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_setting_permission(p_key, 'edit');
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'invalid_setting_value' using errcode = '22023';
  end if;
  insert into public.site_setting_drafts (key, value, base_version, updated_by)
  values (p_key, p_value, (select version from public.site_settings where key = p_key), app.current_actor_id())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by;
end;
$$;

create or replace function public.discard_setting_draft(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_setting_permission(p_key, 'edit');
  delete from public.site_setting_drafts where key = p_key;
end;
$$;

-- Publish the draft. Fails with draft_conflict if someone published since the draft was started
-- (pass p_force => true after reviewing the newer version).
create or replace function public.publish_setting(p_key text, p_note text default null, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.site_setting_drafts;
  v_current integer;
  v_version integer;
begin
  perform app.require_setting_permission(p_key, 'publish');
  perform app.assert_sensitive_action_allowed();

  select * into v_draft from public.site_setting_drafts where key = p_key for update;
  if not found then raise exception 'no_draft' using errcode = 'P0002'; end if;

  select version into v_current from public.site_settings where key = p_key for update;
  if not p_force and v_current is distinct from v_draft.base_version then
    raise exception 'draft_conflict' using errcode = '40001',
      hint = 'The setting was published after this draft was started. Review and publish with p_force.';
  end if;

  perform set_config('app.publish_note', coalesce(p_note, ''), true);
  insert into public.site_settings (key, value, version, published_at, published_by)
  values (p_key, v_draft.value, 1, now(), app.current_actor_id())
  on conflict (key) do update
    set value = excluded.value,
        version = public.site_settings.version + 1,
        published_at = excluded.published_at,
        published_by = excluded.published_by
  returning version into v_version;

  delete from public.site_setting_drafts where key = p_key;
  perform app.log_event('setting.publish', 'public.site_settings', p_key, null, null,
                        jsonb_build_object('version', v_version, 'note', p_note));
  return v_version;
end;
$$;

-- Roll back = publish an older version's value as a NEW version (history is never rewritten).
create or replace function public.rollback_setting(p_key text, p_version integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
  v_version integer;
begin
  perform app.require_setting_permission(p_key, 'publish');
  perform app.assert_sensitive_action_allowed();

  select value into v_value from public.site_settings_versions where key = p_key and version = p_version;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;

  perform set_config('app.publish_note', coalesce(p_note, format('Rollback to version %s', p_version)), true);
  update public.site_settings
    set value = v_value, version = version + 1, published_at = now(), published_by = app.current_actor_id()
    where key = p_key
    returning version into v_version;
  if v_version is null then raise exception 'setting_not_published' using errcode = 'P0002'; end if;

  perform app.log_event('setting.rollback', 'public.site_settings', p_key, null, null,
                        jsonb_build_object('restored_version', p_version, 'new_version', v_version));
  return v_version;
end;
$$;

revoke all on function public.save_setting_draft(text, jsonb) from public, anon;
revoke all on function public.discard_setting_draft(text) from public, anon;
revoke all on function public.publish_setting(text, text, boolean) from public, anon;
revoke all on function public.rollback_setting(text, integer, text) from public, anon;
grant execute on function public.save_setting_draft(text, jsonb), public.discard_setting_draft(text),
  public.publish_setting(text, text, boolean), public.rollback_setting(text, integer, text) to authenticated;

-- ── Seed: setting definitions (contract: setting-definitions.json) ───────────
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('brand',        'design',   true,  'design.edit',     'design.publish'),
  ('theme',        'design',   true,  'design.edit',     'design.publish'),
  ('navigation',   'design',   true,  'design.edit',     'design.publish'),
  ('store',        'settings', true,  'settings.manage', 'settings.publish'),
  ('social',       'settings', true,  'settings.manage', 'settings.publish'),
  ('localization', 'settings', true,  'settings.manage', 'settings.publish'),
  ('features',     'settings', true,  'settings.manage', 'settings.publish'),
  ('seo',          'content',  true,  'content.manage',  'content.publish'),
  ('security',     'security', false, 'security.manage', 'security.manage')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;
