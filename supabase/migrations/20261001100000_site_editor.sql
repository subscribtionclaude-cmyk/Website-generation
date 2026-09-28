-- Phase 07 — Visual Site Editor.
--
--   • design.view permission (open the editor / preview drafts) next to design.edit and design.publish
--   • page_sections.design: structured per-section presentation (background, spacing) — no raw CSS
--   • page_layout_drafts: one staff-only draft of a whole page layout (Home / Apple / Offers)
--   • page_layout_versions: every published layout, for compare and rollback
--   • site_editor_* RPCs: overview, page, save / discard draft, publish (stale-safe), versions, rollback
--   • page_seo setting (per-page title / description / Open Graph image), design scope
--
-- The storefront keeps reading only published rows (storefront_page_sections); drafts never leave
-- these staff RPCs. Section props are validated per type by the app's zod schemas
-- (src/domain/content/sections.ts); the database checks structure, types, sizes and uniqueness.

-- ── Permissions ─────────────────────────────────────────────────────────────
insert into public.permissions (key, module, is_sensitive) values ('design.view', 'design', false)
on conflict (key) do update set module = excluded.module, is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'design.view' from public.roles r
where r.key in ('super_admin', 'store_manager', 'content_editor', 'design_editor')
on conflict do nothing;

-- ── Setting: per-page SEO ───────────────────────────────────────────────────
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('page_seo', 'design', true, 'design.edit', 'design.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- Design settings are visible to everyone who may open the editor (design.view), so previews can
-- show their drafts; editing / publishing still need the definition's permissions.
create or replace function public.admin_settings_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', d.key, 'scope', d.scope, 'isPublic', d.is_public,
      'canEdit', app.has_permission(d.edit_permission),
      'canPublish', app.has_permission(d.publish_permission),
      'published', s.value, 'version', s.version, 'publishedAt', s.published_at,
      'publishedBy', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = s.published_by),
      'draft', dr.value, 'draftUpdatedAt', dr.updated_at, 'draftBaseVersion', dr.base_version,
      'draftBy', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = dr.updated_by))
      order by d.key)
    from public.setting_definitions d
    left join public.site_settings s on s.key = d.key
    left join public.site_setting_drafts dr on dr.key = d.key
    where app.has_permission(d.edit_permission) or app.has_permission(d.publish_permission)
       or (d.scope <> 'security' and app.has_permission('settings.view'))
       or (d.scope = 'design' and app.has_permission('design.view'))), '[]'::jsonb);
end;
$$;

-- ── Section presentation ────────────────────────────────────────────────────
alter table public.page_sections add column if not exists design jsonb not null default '{}'::jsonb;
alter table public.page_sections drop constraint if exists page_sections_design_check;
alter table public.page_sections add constraint page_sections_design_check
  check (jsonb_typeof(design) = 'object' and pg_column_size(design) <= 2048);

create or replace function public.storefront_page_sections(p_page_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.key, 'pageKey', s.page_key, 'type', s.type,
                                               'sortOrder', s.sort_order, 'isVisible', s.is_visible,
                                               'props', s.props, 'design', s.design)
                            order by s.sort_order, s.key), '[]'::jsonb)
  from public.page_sections s where s.page_key = p_page_key and s.is_visible;
$$;

-- ── Drafts and versions ─────────────────────────────────────────────────────
create table if not exists public.page_layout_drafts (
  page_key      text primary key check (page_key ~ '^[a-z0-9-]{1,40}$'),
  sections      jsonb not null check (jsonb_typeof(sections) = 'array' and pg_column_size(sections) <= 1048576),
  base_version  integer,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
comment on table public.page_layout_drafts is 'Staff-only draft of a whole page layout (Phase 07 Site Editor). Never read by the storefront.';

create table if not exists public.page_layout_versions (
  id            bigint generated always as identity primary key,
  page_key      text not null check (page_key ~ '^[a-z0-9-]{1,40}$'),
  version       integer not null check (version > 0),
  sections      jsonb not null check (jsonb_typeof(sections) = 'array'),
  note          text check (char_length(note) <= 500),
  published_at  timestamptz not null default now(),
  published_by  uuid,
  unique (page_key, version)
);
comment on table public.page_layout_versions is 'Every published page layout (append-only), for compare and rollback.';

alter table public.page_layout_drafts enable row level security;
alter table public.page_layout_versions enable row level security;
revoke all on public.page_layout_drafts, public.page_layout_versions from anon;
revoke insert, update, delete, truncate on public.page_layout_drafts, public.page_layout_versions from authenticated;
drop policy if exists page_layout_drafts_staff_select on public.page_layout_drafts;
create policy page_layout_drafts_staff_select on public.page_layout_drafts for select to authenticated
  using ((select app.has_permission('design.view')));
drop policy if exists page_layout_versions_staff_select on public.page_layout_versions;
create policy page_layout_versions_staff_select on public.page_layout_versions for select to authenticated
  using ((select app.has_permission('design.view')));

drop trigger if exists page_layout_versions_immutable on public.page_layout_versions;
create trigger page_layout_versions_immutable before update or delete on public.page_layout_versions
  for each row execute function app.prevent_audit_mutation();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function app.editable_page_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['home', 'apple', 'offers'] $$;

create or replace function app.section_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['hero_campaign', 'product_rail', 'offer_rail', 'offer_group', 'category_grid', 'brand_lines',
               'budget_search', 'promo_banner', 'coming_soon', 'content_rail', 'trust_strip', 'trust_feature',
               'branch_contact', 'media_banner']
$$;

-- Current published layout of a page as editor JSON (order = array order).
create or replace function app.page_layout_rows(p_page_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'type', s.type, 'isVisible', s.is_visible,
                                               'props', s.props, 'design', s.design)
                            order by s.sort_order, s.key), '[]'::jsonb)
  from public.page_sections s where s.page_key = p_page_key;
$$;

-- Structural validation (per-type props are validated by the app's section schemas).
create or replace function app.validate_page_layout(p_sections jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_design jsonb;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then return 'invalid_layout'; end if;
  if jsonb_array_length(p_sections) > 40 then return 'too_many_sections'; end if;
  for v_item in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_item) <> 'object' then return 'invalid_layout'; end if;
    v_key := v_item ->> 'key';
    if v_key is null or v_key !~ '^[a-z0-9-]{1,60}$' then return 'invalid_key'; end if;
    if v_key = any (v_keys) then return 'duplicate_key'; end if;
    v_keys := v_keys || v_key;
    if coalesce(v_item ->> 'type', '') <> all (app.section_types()) then return 'unknown_type'; end if;
    if jsonb_typeof(v_item -> 'isVisible') is distinct from 'boolean' then return 'invalid_layout'; end if;
    if jsonb_typeof(v_item -> 'props') is distinct from 'object' or pg_column_size(v_item -> 'props') > 65536 then
      return 'invalid_props';
    end if;
    v_design := coalesce(v_item -> 'design', '{}'::jsonb);
    if jsonb_typeof(v_design) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_design) k where k not in ('background', 'spacing'))
       or coalesce(v_design ->> 'background', 'default') not in ('default', 'muted', 'dark', 'brand')
       or coalesce(v_design ->> 'spacing', 'default') not in ('compact', 'default', 'relaxed') then
      return 'invalid_design';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function app.layout_current_version(p_page_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select max(version) from public.page_layout_versions where page_key = p_page_key $$;

create or replace function app.layout_record_version(p_page_key text, p_note text, p_uid uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_version integer := coalesce(app.layout_current_version(p_page_key), 0) + 1;
begin
  insert into public.page_layout_versions (page_key, version, sections, note, published_by)
  values (p_page_key, v_version, app.page_layout_rows(p_page_key), left(p_note, 500), p_uid);
  return v_version;
end;
$$;

-- The layout that existed before the first editor publish becomes version 1, so it can be restored.
create or replace function app.layout_ensure_initial(p_page_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if app.layout_current_version(p_page_key) is null then
    perform app.layout_record_version(p_page_key, 'Initial layout', null);
  end if;
end;
$$;

-- Replace a page's published rows with a layout (positions follow the array order).
create or replace function app.layout_apply(p_page_key text, p_sections jsonb, p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.page_sections where page_key = p_page_key;
  insert into public.page_sections (page_key, key, type, sort_order, is_visible, props, design, updated_by)
  select p_page_key, s.value ->> 'key', s.value ->> 'type', (s.ordinality * 10)::integer,
         (s.value ->> 'isVisible')::boolean, s.value -> 'props', coalesce(s.value -> 'design', '{}'::jsonb), p_uid
  from jsonb_array_elements(p_sections) with ordinality as s(value, ordinality);
end;
$$;

create or replace function app.staff_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = p_uid $$;

create or replace function app.site_editor_page_json(p_page_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pageKey', p_page_key,
    'published', app.page_layout_rows(p_page_key),
    'version', app.layout_current_version(p_page_key),
    'publishedAt', (select v.published_at from public.page_layout_versions v
                    where v.page_key = p_page_key order by v.version desc limit 1),
    'publishedBy', (select app.staff_name(v.published_by) from public.page_layout_versions v
                    where v.page_key = p_page_key order by v.version desc limit 1),
    'draft', d.sections, 'draftUpdatedAt', d.updated_at, 'draftBaseVersion', d.base_version,
    'draftBy', app.staff_name(d.updated_by),
    'canEdit', app.has_permission('design.edit'), 'canPublish', app.has_permission('design.publish'))
  from (select 1) one
  left join public.page_layout_drafts d on d.page_key = p_page_key;
$$;

-- ── RPCs ────────────────────────────────────────────────────────────────────
create or replace function public.site_editor_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.view');
begin
  return (select jsonb_agg(app.site_editor_page_json(k) - 'published' || jsonb_build_object(
            'sectionCount', (select count(*) from public.page_sections s where s.page_key = k))
          order by ord)
          from unnest(app.editable_page_keys()) with ordinality as t(k, ord));
end;
$$;

create or replace function public.site_editor_get_page(p_page_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.view');
begin
  if p_page_key is null or p_page_key <> all (app.editable_page_keys()) then return null; end if;
  return app.site_editor_page_json(p_page_key);
end;
$$;

create or replace function public.site_editor_save_draft(p_page_key text, p_sections jsonb,
                                                        p_expected_draft_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.edit');
  v_problem text;
  v_draft public.page_layout_drafts;
  v_before jsonb;
begin
  if p_page_key is null or p_page_key <> all (app.editable_page_keys()) then
    return jsonb_build_object('ok', false, 'code', 'invalid_page');
  end if;
  v_problem := app.validate_page_layout(p_sections);
  if v_problem is not null then return jsonb_build_object('ok', false, 'code', v_problem); end if;
  select * into v_draft from public.page_layout_drafts where page_key = p_page_key for update;
  if found then
    if v_draft.updated_at is distinct from p_expected_draft_at then
      return jsonb_build_object('ok', false, 'code', 'draft_conflict', 'draftUpdatedAt', v_draft.updated_at);
    end if;
    v_before := v_draft.sections;
    update public.page_layout_drafts set sections = p_sections, updated_at = clock_timestamp(), updated_by = v_uid
    where page_key = p_page_key returning * into v_draft;
  else
    if p_expected_draft_at is not null then return jsonb_build_object('ok', false, 'code', 'draft_gone'); end if;
    v_before := app.page_layout_rows(p_page_key);
    insert into public.page_layout_drafts (page_key, sections, base_version, updated_at, updated_by)
    values (p_page_key, p_sections, app.layout_current_version(p_page_key), clock_timestamp(), v_uid)
    returning * into v_draft;
  end if;
  perform app.log_event('site_editor.draft_saved', 'public.page_layout_drafts', p_page_key, jsonb_build_object('sections', v_before),
                        jsonb_build_object('sections', p_sections),
                        jsonb_build_object('sections', jsonb_array_length(p_sections)));
  return jsonb_build_object('ok', true, 'draftUpdatedAt', v_draft.updated_at, 'baseVersion', v_draft.base_version);
end;
$$;

create or replace function public.site_editor_discard_draft(p_page_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.edit');
  v_draft public.page_layout_drafts;
begin
  delete from public.page_layout_drafts where page_key = p_page_key returning * into v_draft;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_draft'); end if;
  perform app.log_event('site_editor.draft_discarded', 'public.page_layout_drafts', p_page_key,
                        jsonb_build_object('sections', v_draft.sections), null);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.site_editor_publish(p_page_key text, p_note text default null,
                                                     p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.publish');
  v_draft public.page_layout_drafts;
  v_problem text;
  v_before jsonb;
  v_version integer;
begin
  select * into v_draft from public.page_layout_drafts where page_key = p_page_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_draft'); end if;
  if not coalesce(p_force, false) and v_draft.base_version is distinct from app.layout_current_version(p_page_key) then
    return jsonb_build_object('ok', false, 'code', 'draft_conflict');
  end if;
  v_problem := app.validate_page_layout(v_draft.sections);
  if v_problem is not null then return jsonb_build_object('ok', false, 'code', v_problem); end if;
  perform app.layout_ensure_initial(p_page_key);
  v_before := app.page_layout_rows(p_page_key);
  perform app.layout_apply(p_page_key, v_draft.sections, v_uid);
  v_version := app.layout_record_version(p_page_key, nullif(btrim(p_note), ''), v_uid);
  delete from public.page_layout_drafts where page_key = p_page_key;
  perform app.log_event('site_editor.published', 'public.page_layout_versions', p_page_key, jsonb_build_object('sections', v_before),
                        jsonb_build_object('sections', v_draft.sections), jsonb_build_object('version', v_version, 'note', p_note, 'forced', coalesce(p_force, false)));
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

create or replace function public.site_editor_versions(p_page_key text, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'version', v.version, 'note', v.note, 'publishedAt', v.published_at,
      'publishedBy', app.staff_name(v.published_by), 'sections', v.sections) order by v.version desc)
    from (select * from public.page_layout_versions where page_key = p_page_key
          order by version desc limit greatest(1, least(coalesce(p_limit, 30), 100))) v), '[]'::jsonb);
end;
$$;

create or replace function public.site_editor_rollback(p_page_key text, p_version integer, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('design.publish');
  v_target public.page_layout_versions;
  v_before jsonb;
  v_version integer;
begin
  select * into v_target from public.page_layout_versions where page_key = p_page_key and version = p_version;
  if not found then return jsonb_build_object('ok', false, 'code', 'version_not_found'); end if;
  perform app.layout_ensure_initial(p_page_key);
  v_before := app.page_layout_rows(p_page_key);
  perform app.layout_apply(p_page_key, v_target.sections, v_uid);
  v_version := app.layout_record_version(p_page_key,
                 coalesce(nullif(btrim(p_note), ''), format('Restored version %s', p_version)), v_uid);
  perform app.log_event('site_editor.rolled_back', 'public.page_layout_versions', p_page_key, jsonb_build_object('sections', v_before),
                        jsonb_build_object('sections', v_target.sections), jsonb_build_object('toVersion', p_version, 'version', v_version));
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

-- Phase 06 structured content edits change live rows; record them as versions too so history stays whole.
create or replace function public.admin_save_page_section(p_id uuid, p_is_visible boolean, p_props jsonb,
                                                          p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.manage');
  v_row public.page_sections;
begin
  if not app.has_permission('content.publish') then return jsonb_build_object('ok', false, 'code', 'publish_forbidden'); end if;
  if p_props is null or jsonb_typeof(p_props) <> 'object' or pg_column_size(p_props) > 65536 then
    return jsonb_build_object('ok', false, 'code', 'invalid_props');
  end if;
  select * into v_row from public.page_sections where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
  end if;
  perform app.layout_ensure_initial(v_row.page_key);
  update public.page_sections set props = p_props, is_visible = coalesce(p_is_visible, is_visible),
    updated_by = v_uid, updated_at = clock_timestamp()
  where id = p_id returning * into v_row;
  perform app.layout_record_version(v_row.page_key, format('Content edit: %s', v_row.key), v_uid);
  return jsonb_build_object('ok', true, 'updatedAt', v_row.updated_at);
end;
$$;

-- Audit viewer: editor events get their own "design" area.
create or replace function app.audit_module(p_entity_type text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entity_type in ('public.page_layout_drafts', 'public.page_layout_versions') or p_action like 'site_editor.%'
      then 'design'
    when p_entity_type in ('public.products', 'public.product_variants', 'public.brands', 'public.categories',
                           'public.product_relations', 'public.product_media', 'public.price_history')
      or p_action like 'catalog.%' or p_action like 'stock.%' or p_action like 'price.%' then 'catalog'
    when p_entity_type in ('public.orders', 'public.payment_records') or p_action like 'order.%'
      or p_action like 'payment.%' then 'orders'
    when p_entity_type in ('public.service_requests', 'public.service_offers') or p_action like 'service.%' then 'services'
    when p_entity_type in ('public.site_settings') or p_action like 'setting.%' then 'settings'
    when p_entity_type in ('public.roles', 'public.role_permissions', 'public.user_roles', 'public.profiles')
      or p_action like 'access.%' or p_action like 'staff.%' then 'access'
    when p_entity_type in ('public.offers', 'public.content_entries', 'public.page_sections') or p_action like 'content.%'
      or p_action like 'offer.%' then 'content'
    when p_entity_type in ('public.product_reviews', 'public.customer_notes', 'public.notification_templates')
      or p_action like 'review.%' or p_action like 'customer.%' or p_action like 'notification.%' then 'customers'
    when p_action like 'data.%' or p_action like 'demo.%' or p_action like 'import.%' or p_action like 'export.%' then 'data'
    else 'other' end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.editable_page_keys(), app.section_types(), app.page_layout_rows(text),
  app.validate_page_layout(jsonb), app.layout_current_version(text), app.layout_record_version(text, text, uuid),
  app.layout_ensure_initial(text), app.layout_apply(text, jsonb, uuid), app.staff_name(uuid),
  app.site_editor_page_json(text) from public;
grant execute on function app.editable_page_keys(), app.section_types(), app.validate_page_layout(jsonb)
  to authenticated;

revoke all on function public.site_editor_overview(), public.site_editor_get_page(text),
  public.site_editor_save_draft(text, jsonb, timestamptz), public.site_editor_discard_draft(text),
  public.site_editor_publish(text, text, boolean), public.site_editor_versions(text, integer),
  public.site_editor_rollback(text, integer, text) from public, anon;
grant execute on function public.site_editor_overview(), public.site_editor_get_page(text),
  public.site_editor_save_draft(text, jsonb, timestamptz), public.site_editor_discard_draft(text),
  public.site_editor_publish(text, text, boolean), public.site_editor_versions(text, integer),
  public.site_editor_rollback(text, integer, text) to authenticated;
