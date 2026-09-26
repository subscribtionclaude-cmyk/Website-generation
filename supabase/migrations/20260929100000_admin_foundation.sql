-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 06 · Admin control center — foundation
--   • New setting keys: shipping, receipt, legal, loyalty, service_sla (all through the existing
--     draft → publish → version → rollback workflow; nothing bypasses it).
--   • Settings admin RPCs: overview, version history, draft save with stale-draft detection.
--   • Audit log viewer (read-only, filtered, secrets redacted).
--   • Staff accounts: suspension (loses every permission immediately), last activity, role changes
--     that keep the Phase 01 anti-escalation rules.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Setting definitions (contract: src/domain/settings/setting-definitions.json) ──
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('shipping',    'settings', true,  'settings.manage',  'settings.publish'),
  ('receipt',     'settings', true,  'settings.manage',  'settings.publish'),
  ('legal',       'content',  true,  'legal.manage',     'legal.manage'),
  ('loyalty',     'settings', true,  'marketing.manage', 'settings.publish'),
  ('service_sla', 'settings', false, 'settings.manage',  'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- Optimistic concurrency needs a distinct stamp for every write, even inside one transaction
-- (now() is frozen per transaction), so updated_at now uses the statement's clock.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ── Shared helpers ──────────────────────────────────────────────────────────
-- Page size / offset from a filter object (bounded).
create or replace function app.page_limit(p_filter jsonb, p_default integer default 25, p_max integer default 100)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(nullif(p_filter ->> 'limit', '')::integer, p_default), 1), p_max);
$$;

create or replace function app.page_offset(p_filter jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(coalesce(nullif(p_filter ->> 'offset', '')::integer, 0), 0);
$$;

-- ILIKE pattern from free text (escapes wildcards).
create or replace function app.like_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(btrim(coalesce(p_text, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- True when the caller holds at least one of the permissions.
create or replace function app.has_any_permission(p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from unnest(p_permissions) as p (key) where app.has_permission(p.key));
$$;

create or replace function app.require_any_permission(p_permissions text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.has_any_permission(p_permissions) then
    raise exception 'permission denied: %', array_to_string(p_permissions, ' | ') using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Recursively replace secret-looking values before audit data leaves the database.
create or replace function app.redact_secrets(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
begin
  if p_value is null then return null; end if;
  case jsonb_typeof(p_value)
    when 'object' then
      v_result := '{}'::jsonb;
      for v_key, v_item in select key, value from jsonb_each(p_value) loop
        if v_key ~* '(password|secret|token|api_?key|otp|hash|idempotency|signature|credential)' then
          v_result := v_result || jsonb_build_object(v_key, '[redacted]');
        else
          v_result := v_result || jsonb_build_object(v_key, app.redact_secrets(v_item));
        end if;
      end loop;
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(app.redact_secrets(e) order by i), '[]'::jsonb) into v_result
      from jsonb_array_elements(p_value) with ordinality as a (e, i);
      return v_result;
    else
      return p_value;
  end case;
end;
$$;

-- ── Staff suspension & activity ─────────────────────────────────────────────
alter table public.profiles add column if not exists staff_suspended_at timestamptz;
alter table public.profiles add column if not exists staff_suspended_by uuid;
alter table public.profiles add column if not exists staff_suspension_reason text
  check (staff_suspension_reason is null or char_length(staff_suspension_reason) <= 300);
alter table public.profiles add column if not exists last_active_at timestamptz;

-- Suspended staff keep their role rows (for reactivation) but hold no permission at all.
create or replace function app.is_active_staff_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles p where p.id = p_user_id and p.staff_suspended_at is not null);
$$;

create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_staff_user(app.current_actor_id()) and exists (
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
  select app.is_active_staff_user(app.current_actor_id()) and exists (
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
  select app.is_active_staff_user(coalesce(p_user_id, app.current_actor_id())) and exists (
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
  select case when app.is_active_staff_user(coalesce(p_user_id, app.current_actor_id())) then
    coalesce((select max(r.rank)
              from public.user_roles ur
              join public.roles r on r.id = ur.role_id and r.deleted_at is null
              where ur.user_id = coalesce(p_user_id, app.current_actor_id())), 0)
  else 0 end;
$$;

create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select app.current_actor_id() as id),
  suspended as (select not app.is_active_staff_user((select id from me)) as value),
  my_roles as (
    select r.* from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.deleted_at is null
    join me on ur.user_id = me.id
    where not (select value from suspended)
  ),
  grants_all as (select coalesce(bool_or(grants_all), false) as value from my_roles)
  select jsonb_build_object(
    'userId', (select id from me),
    'suspended', (select value from suspended),
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

-- Staff "last active" (throttled to one write per 5 minutes).
create or replace function public.admin_touch_activity()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_staff() then return; end if;
  update public.profiles set last_active_at = now()
  where id = auth.uid() and (last_active_at is null or last_active_at < now() - interval '5 minutes');
end;
$$;

-- ── Settings admin ──────────────────────────────────────────────────────────
-- Every definition the caller can work with: published value, pending draft, versions, rights.
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
       or (d.scope <> 'security' and app.has_permission('settings.view'))), '[]'::jsonb);
end;
$$;

create or replace function public.admin_setting_versions(p_key text, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_def public.setting_definitions;
begin
  select * into v_def from public.setting_definitions where key = p_key;
  if not found then raise exception 'unknown_setting' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (app.has_permission(v_def.edit_permission) or app.has_permission(v_def.publish_permission)
      or (v_def.scope <> 'security' and app.has_permission('settings.view'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', v.version, 'value', v.value, 'note', v.note, 'publishedAt', v.published_at,
      'publishedBy', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = v.published_by))
      order by v.version desc)
    from (select * from public.site_settings_versions where key = p_key
          order by version desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) v), '[]'::jsonb);
end;
$$;

-- Save a draft without silently overwriting another editor's newer draft.
--   p_expected_draft_at = the draft's updated_at the editor started from (null = there was no draft).
create or replace function public.admin_save_setting_draft(p_key text, p_value jsonb, p_expected_draft_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft public.site_setting_drafts;
  v_saved public.site_setting_drafts;
begin
  perform app.require_setting_permission(p_key, 'edit');
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  if pg_column_size(p_value) > 262144 then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;
  select * into v_draft from public.site_setting_drafts where key = p_key for update;
  if found and v_draft.updated_at is distinct from p_expected_draft_at then
    return jsonb_build_object('ok', false, 'code', 'draft_conflict', 'draftUpdatedAt', v_draft.updated_at);
  end if;
  if not found and p_expected_draft_at is not null then
    -- The draft this editor started from was published or discarded meanwhile.
    return jsonb_build_object('ok', false, 'code', 'draft_gone');
  end if;
  insert into public.site_setting_drafts (key, value, base_version, updated_by)
  values (p_key, p_value, (select version from public.site_settings where key = p_key), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by
  returning * into v_saved;
  perform app.log_event('setting.draft_saved', 'public.site_settings', p_key, null, null,
                        jsonb_build_object('base_version', v_saved.base_version));
  return jsonb_build_object('ok', true, 'draftUpdatedAt', v_saved.updated_at, 'baseVersion', v_saved.base_version);
end;
$$;

-- ── Audit log viewer ────────────────────────────────────────────────────────
create or replace function app.audit_module(p_entity_type text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
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

create or replace function public.admin_list_audit_logs(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('audit.view');
  v_limit   integer := app.page_limit(p_filter, 50, 200);
  v_offset  integer := app.page_offset(p_filter);
  v_actor   text := nullif(btrim(coalesce(p_filter ->> 'actor', '')), '');
  v_action  text := nullif(btrim(coalesce(p_filter ->> 'action', '')), '');
  v_module  text := nullif(p_filter ->> 'module', '');
  v_entity  text := nullif(p_filter ->> 'entityType', '');
  v_entity_id text := nullif(btrim(coalesce(p_filter ->> 'entityId', '')), '');
  v_from    timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to      timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select a.*, p.email as actor_email, p.full_name as actor_name
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id
    where (v_actor is null or p.email ilike app.like_pattern(v_actor) or p.full_name ilike app.like_pattern(v_actor)
           or a.actor_id::text = v_actor)
      and (v_action is null or a.action ilike app.like_pattern(v_action))
      and (v_module is null or app.audit_module(a.entity_type, a.action) = v_module)
      and (v_entity is null or a.entity_type = v_entity)
      and (v_entity_id is null or a.entity_id = v_entity_id)
      and (v_from is null or a.occurred_at >= v_from)
      and (v_to is null or a.occurred_at < v_to)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'occurredAt', m.occurred_at, 'actorId', m.actor_id,
             'actorName', coalesce(m.actor_name, m.actor_email), 'actorEmail', m.actor_email,
             'actorRole', m.actor_role, 'action', m.action, 'entityType', m.entity_type, 'entityId', m.entity_id,
             'module', app.audit_module(m.entity_type, m.action), 'changedFields', to_jsonb(m.changed_fields))
             order by m.occurred_at desc, m.id desc)
           from (select * from matched order by occurred_at desc, id desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_get_audit_log(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('audit.view');
  v_row jsonb;
begin
  select jsonb_build_object(
      'id', a.id, 'occurredAt', a.occurred_at, 'actorId', a.actor_id,
      'actorName', coalesce(p.full_name, p.email), 'actorEmail', p.email, 'actorRole', a.actor_role,
      'action', a.action, 'entityType', a.entity_type, 'entityId', a.entity_id,
      'module', app.audit_module(a.entity_type, a.action), 'changedFields', to_jsonb(a.changed_fields),
      'before', app.redact_secrets(a.before_data), 'after', app.redact_secrets(a.after_data),
      'metadata', app.redact_secrets(a.metadata))
    into v_row
  from public.audit_logs a left join public.profiles p on p.id = a.actor_id
  where a.id = p_id;
  return v_row;
end;
$$;

-- ── Staff accounts & roles ──────────────────────────────────────────────────
create or replace function public.admin_list_staff(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('users.view');
  v_q   text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_status text := nullif(p_filter ->> 'status', '');
begin
  return coalesce((
    select jsonb_agg(row_data order by (row_data ->> 'rank')::integer desc, row_data ->> 'email')
    from (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'name', p.full_name,
        'status', case when p.staff_suspended_at is null then 'active' else 'suspended' end,
        'suspendedAt', p.staff_suspended_at, 'suspensionReason', p.staff_suspension_reason,
        'lastActiveAt', p.last_active_at, 'createdAt', p.created_at,
        'rank', coalesce(max(r.rank), 0),
        'roles', jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'rank', r.rank) order by r.rank desc)) as row_data
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      join public.roles r on r.id = ur.role_id and r.deleted_at is null
      where p.deleted_at is null
        and (v_q is null or p.email ilike app.like_pattern(v_q) or p.full_name ilike app.like_pattern(v_q))
        and (v_status is null or (v_status = 'active') = (p.staff_suspended_at is null))
      group by p.id
    ) staff), '[]'::jsonb);
end;
$$;

-- Access is granted to an existing account only: the person signs in once (email code, no
-- password is ever created or shared) and then an authorised manager assigns a role.
create or replace function public.admin_lookup_account(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('roles.manage');
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles
  where lower(email) = lower(btrim(coalesce(p_email, ''))) and deleted_at is null;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'id', v_profile.id, 'email', v_profile.email, 'name', v_profile.full_name,
    'roles', coalesce((select jsonb_agg(r.key) from public.user_roles ur join public.roles r on r.id = ur.role_id
                       where ur.user_id = v_profile.id), '[]'::jsonb));
end;
$$;

-- Replace a staff member's role with another (atomic revoke + assign; same escalation rules).
create or replace function public.admin_change_staff_role(p_user_id uuid, p_from_role text, p_to_role text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_to_role is null then return jsonb_build_object('ok', false, 'code', 'role_required'); end if;
  if p_from_role = p_to_role then return jsonb_build_object('ok', true); end if;
  perform public.assign_role(p_user_id, p_to_role);
  if p_from_role is not null then perform public.revoke_role(p_user_id, p_from_role); end if;
  perform app.log_event('access.role_changed', 'public.profiles', p_user_id::text,
                        jsonb_build_object('role', p_from_role), jsonb_build_object('role', p_to_role));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_staff_suspended(p_user_id uuid, p_suspended boolean, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_permission('users.manage');
  v_target_rank integer;
  v_target_owner boolean;
begin
  perform app.assert_sensitive_action_allowed();
  if p_user_id = v_actor then return jsonb_build_object('ok', false, 'code', 'cannot_suspend_self'); end if;
  if not exists (select 1 from public.user_roles where user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'not_staff');
  end if;
  select coalesce(max(r.rank), 0), coalesce(bool_or(r.grants_all), false) into v_target_rank, v_target_owner
  from public.user_roles ur join public.roles r on r.id = ur.role_id and r.deleted_at is null
  where ur.user_id = p_user_id;
  if v_target_owner and not app.is_owner(v_actor) then
    return jsonb_build_object('ok', false, 'code', 'only_owner_can_suspend_owner');
  end if;
  if not app.is_owner(v_actor) and v_target_rank >= app.max_role_rank(v_actor) then
    return jsonb_build_object('ok', false, 'code', 'rank_too_high');
  end if;
  if p_suspended then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'reason_required');
    end if;
    if v_target_owner and (
      select count(distinct ur.user_id) from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.grants_all
      join public.profiles p on p.id = ur.user_id and p.staff_suspended_at is null
      where ur.user_id <> p_user_id) = 0 then
      return jsonb_build_object('ok', false, 'code', 'cannot_suspend_last_owner');
    end if;
    update public.profiles set staff_suspended_at = now(), staff_suspended_by = v_actor,
      staff_suspension_reason = left(btrim(p_reason), 300)
    where id = p_user_id and staff_suspended_at is null;
  else
    update public.profiles set staff_suspended_at = null, staff_suspended_by = null, staff_suspension_reason = null
    where id = p_user_id;
  end if;
  perform app.log_event(case when p_suspended then 'staff.suspended' else 'staff.reactivated' end,
                        'public.profiles', p_user_id::text, null, null,
                        jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- Roles with their permissions and assigned staff (for the RBAC screens).
create or replace function public.admin_list_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('users.view');
  v_rank integer := app.max_role_rank(auth.uid());
  v_owner boolean := app.is_owner(auth.uid());
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', r.key, 'name', r.name, 'description', r.description, 'rank', r.rank,
      'grantsAll', r.grants_all, 'isSystem', r.is_system,
      'editable', not r.grants_all and (v_owner or r.rank < v_rank) and app.has_permission('roles.manage'),
      'permissions', coalesce((select jsonb_agg(rp.permission_key order by rp.permission_key)
                               from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb),
      'users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.full_name,
                                                             'suspended', p.staff_suspended_at is not null)
                                          order by p.email)
                         from public.user_roles ur join public.profiles p on p.id = ur.user_id
                         where ur.role_id = r.id), '[]'::jsonb))
      order by r.rank desc, r.key)
    from public.roles r where r.deleted_at is null), '[]'::jsonb);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.page_limit(jsonb, integer, integer), app.page_offset(jsonb), app.like_pattern(text),
  app.has_any_permission(text[]), app.require_any_permission(text[]), app.redact_secrets(jsonb),
  app.is_active_staff_user(uuid), app.audit_module(text, text) from public;
grant execute on function app.page_limit(jsonb, integer, integer), app.page_offset(jsonb), app.like_pattern(text),
  app.has_any_permission(text[]), app.require_any_permission(text[]), app.redact_secrets(jsonb),
  app.is_active_staff_user(uuid), app.audit_module(text, text) to authenticated;
grant execute on function app.is_active_staff_user(uuid) to anon, service_role;

revoke all on function public.admin_touch_activity(), public.admin_settings_overview(),
  public.admin_setting_versions(text, integer), public.admin_save_setting_draft(text, jsonb, timestamptz),
  public.admin_list_audit_logs(jsonb), public.admin_get_audit_log(bigint), public.admin_list_staff(jsonb),
  public.admin_lookup_account(text), public.admin_change_staff_role(uuid, text, text),
  public.admin_set_staff_suspended(uuid, boolean, text), public.admin_list_roles()
  from public, anon;
grant execute on function public.admin_touch_activity(), public.admin_settings_overview(),
  public.admin_setting_versions(text, integer), public.admin_save_setting_draft(text, jsonb, timestamptz),
  public.admin_list_audit_logs(jsonb), public.admin_get_audit_log(bigint), public.admin_list_staff(jsonb),
  public.admin_lookup_account(text), public.admin_change_staff_role(uuid, text, text),
  public.admin_set_staff_suspended(uuid, boolean, text), public.admin_list_roles()
  to authenticated;
