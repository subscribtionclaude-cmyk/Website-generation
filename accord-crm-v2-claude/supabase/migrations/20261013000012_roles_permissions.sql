-- ACCORD CRM V6 — roles, permissions, terminology and the privacy-safe management report (migration 12).
-- Additive. No CRM business row is changed. Migration 11 (applied manually in production) is NOT re-run or edited.
--
-- Model
--   * canonical roles stay as they are: admin | bd_executive | viewer. "Sales" / "Management Viewer" are DISPLAY labels
--     (settings.terminology) and never rewrite data.
--   * permission_catalog  — every permission, its section, its default per role and whether it is configurable for that
--                           role ('config'), always granted ('on') or never grantable ('off' = hard security rule).
--   * role_permissions    — the role template (Sales, Management Viewer). Admin is not stored: admins have everything.
--   * user_permission_overrides — optional per-user exceptions on top of the role template.
--   * Resolution (deterministic, deny by default):
--       inactive / deleted / anonymous → DENY;  admin → ALLOW;  role mode 'off' → DENY;  role mode 'on' → ALLOW;
--       user override if set → its value;  role template value;  otherwise DENY;  then every dependency must also hold.
--   * Security boundary = the database: RLS on raw tables and the RPCs call has_perm(); the UI only mirrors it.

create table public.permission_catalog (
  perm text primary key,
  section text not null check (section in ('dashboard', 'people', 'reporting', 'data', 'export', 'admin')),
  sort int not null,
  sales_mode text not null check (sales_mode in ('on', 'off', 'config')),
  viewer_mode text not null check (viewer_mode in ('on', 'off', 'config')),
  sales_default boolean not null default false,
  viewer_default boolean not null default false,
  depends_on text references public.permission_catalog (perm)
);

insert into public.permission_catalog (perm, section, sort, sales_mode, viewer_mode, sales_default, viewer_default, depends_on) values
  -- dashboard / department aggregates
  ('mgmt.dashboard',            'dashboard', 10, 'config', 'config', false, true,  null),
  ('mgmt.department',           'dashboard', 20, 'config', 'config', false, true,  null),
  -- people / performance (employee-level data)
  ('perf.individual',           'people',    10, 'config', 'config', false, false, 'mgmt.department'),
  ('perf.names',                'people',    20, 'config', 'config', false, false, 'perf.individual'),
  ('perf.targets',              'people',    30, 'config', 'config', false, false, 'perf.individual'),
  -- reporting
  ('reports.view',              'reporting', 10, 'config', 'config', false, true,  'mgmt.department'),
  ('reports.daily',             'reporting', 20, 'config', 'config', false, true,  'reports.view'),
  ('reports.weekly',            'reporting', 30, 'config', 'config', false, true,  'reports.view'),
  ('reports.monthly',           'reporting', 40, 'config', 'config', false, true,  'reports.view'),
  ('reports.board',             'reporting', 50, 'config', 'config', false, true,  'reports.view'),
  -- operational (raw) data — Sales always has its working data; a Viewer only if explicitly granted
  ('raw.leads',                 'data',      10, 'on',     'config', true,  false, null),
  ('raw.calls',                 'data',      20, 'on',     'config', true,  false, null),
  ('raw.meetings',              'data',      30, 'on',     'config', true,  false, null),
  ('raw.followups',             'data',      40, 'on',     'config', true,  false, null),
  ('raw.proposals',             'data',      50, 'on',     'config', true,  false, null),
  -- export
  ('export.management_summary', 'export',    10, 'config', 'config', false, true,  'mgmt.department'),
  ('export.datasets',           'export',    20, 'config', 'off',    true,  false, null),
  ('export.full',               'export',    30, 'off',    'off',    false, false, null),
  -- administration: admin only, never grantable (shown read-only in the UI)
  ('admin.users',               'admin',     10, 'off',    'off',    false, false, null),
  ('admin.permissions',         'admin',     20, 'off',    'off',    false, false, null),
  ('admin.targets',             'admin',     30, 'off',    'off',    false, false, null),
  ('admin.config',              'admin',     40, 'off',    'off',    false, false, null),
  ('admin.sync',                'admin',     50, 'off',    'off',    false, false, null),
  ('admin.audit',               'admin',     60, 'off',    'off',    false, false, null),
  ('admin.system',              'admin',     70, 'off',    'off',    false, false, null);

create table public.role_permissions (
  role text not null check (role in ('bd_executive', 'viewer')),
  perm text not null references public.permission_catalog (perm),
  allowed boolean not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (role, perm)
);
insert into public.role_permissions (role, perm, allowed)
  select 'bd_executive', perm, sales_default from public.permission_catalog where sales_mode = 'config'
  union all
  select 'viewer', perm, viewer_default from public.permission_catalog where viewer_mode = 'config';

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  perm text not null references public.permission_catalog (perm),
  allowed boolean not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, perm)
);

alter table public.permission_catalog enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
-- reads only; every write goes through the audited admin RPCs below (no insert/update/delete policies at all)
create policy perm_catalog_read on public.permission_catalog for select to authenticated using (public.is_member());
create policy role_perm_read on public.role_permissions for select to authenticated using (public.is_admin());
create policy user_override_read on public.user_permission_overrides for select to authenticated
  using (public.is_admin() or (public.is_member() and user_id = auth.uid()));
grant select on public.permission_catalog, public.role_permissions, public.user_permission_overrides to authenticated;
revoke insert, update, delete, truncate on public.permission_catalog, public.role_permissions, public.user_permission_overrides from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------------------------------------------
-- internal: value of permission p for role r (and optional user u). Not callable by clients.
create or replace function public.perm_for(r text, p text, u uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c record; m text; v boolean;
begin
  if r = 'admin' then return exists (select 1 from permission_catalog where perm = p); end if;
  select * into c from permission_catalog where perm = p;
  if not found then return false; end if;                                  -- unknown permission → deny
  m := case r when 'bd_executive' then c.sales_mode when 'viewer' then c.viewer_mode else 'off' end;
  if m = 'off' then return false; end if;
  if m = 'on' then v := true;
  else
    if u is not null then select allowed into v from user_permission_overrides where user_id = u and perm = p; end if;
    if v is null then select allowed into v from role_permissions where role = r and perm = p; end if;
    v := coalesce(v, false);
  end if;
  if v and c.depends_on is not null then v := public.perm_for(r, c.depends_on, u); end if;
  return v;
end $$;
revoke all on function public.perm_for(text, text, uuid) from public, anon, authenticated;

-- the caller's effective permission (inactive / deleted / anonymous → false)
create or replace function public.has_perm(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from profiles where id = auth.uid() and active and deleted_at is null;
  if v_role is null then return false; end if;
  return public.perm_for(v_role, p, auth.uid());
end $$;
revoke all on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;

-- one payload for the UI: role + every effective permission (+ which ones are user overrides)
create or replace function public.my_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from profiles where id = auth.uid() and active and deleted_at is null;
  if v_role is null then return jsonb_build_object('role', null, 'perms', '{}'::jsonb, 'overrides', '[]'::jsonb); end if;
  return jsonb_build_object(
    'role', v_role,
    'perms', (select jsonb_object_agg(perm, public.perm_for(v_role, perm, auth.uid())) from permission_catalog),
    'overrides', coalesce((select jsonb_agg(perm) from user_permission_overrides where user_id = auth.uid()), '[]'::jsonb));
end $$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- admin: the template of a role (used by "Preview as role" and the role-change summary)
create or replace function public.role_template(p_role text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role not in ('admin', 'bd_executive', 'viewer') then raise exception 'Unknown role' using errcode = '22023'; end if;
  return (select jsonb_object_agg(perm, public.perm_for(p_role, perm, null)) from permission_catalog);
end $$;
revoke all on function public.role_template(text) from public, anon;
grant execute on function public.role_template(text) to authenticated;

-- admin: inherited / override / effective, per permission, for one user
create or replace function public.user_effective_permissions(p_user uuid)
returns table (perm text, inherited boolean, override boolean, effective boolean, configurable boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select role into v_role from profiles where id = p_user and deleted_at is null;
  if v_role is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  return query
    select c.perm, public.perm_for(v_role, c.perm, null), o.allowed, public.perm_for(v_role, c.perm, p_user),
           (case v_role when 'bd_executive' then c.sales_mode when 'viewer' then c.viewer_mode else 'off' end) = 'config'
      from permission_catalog c left join user_permission_overrides o on o.user_id = p_user and o.perm = c.perm
     order by c.section, c.sort;
end $$;
revoke all on function public.user_effective_permissions(uuid) from public, anon;
grant execute on function public.user_effective_permissions(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin mutations (audited; hard rules enforced here, not in the UI)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.perm_audit(p_action text, p_entity_id text, p_old jsonb, p_new jsonb, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, actor_email, entity, entity_id, action, old_value, new_value, meta)
  values (auth.uid(), (select email from profiles where id = auth.uid()), 'permissions', p_entity_id, p_action, p_old, p_new, p_meta);
$$;
revoke all on function public.perm_audit(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.admin_set_role_permission(p_role text, p_perm text, p_allowed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_old boolean; v_changed jsonb := '[]'::jsonb; d record;
begin
  if not public.is_admin() then raise exception 'Only administrators can change permissions' using errcode = '42501'; end if;
  if p_role not in ('bd_executive', 'viewer') then raise exception 'Administrator permissions are protected and cannot be changed' using errcode = '42501'; end if;
  select * into c from permission_catalog where perm = p_perm;
  if not found then raise exception 'Unknown permission' using errcode = '22023'; end if;
  if (case p_role when 'bd_executive' then c.sales_mode else c.viewer_mode end) <> 'config' then
    raise exception 'This permission is locked for this role' using errcode = '42501';
  end if;
  if p_allowed and c.depends_on is not null and not public.perm_for(p_role, c.depends_on, null) then
    raise exception 'Enable % first', c.depends_on using errcode = '22023';
  end if;
  select allowed into v_old from role_permissions where role = p_role and perm = p_perm;
  insert into role_permissions (role, perm, allowed, updated_by, updated_at) values (p_role, p_perm, p_allowed, auth.uid(), now())
    on conflict (role, perm) do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();
  if v_old is distinct from p_allowed then
    perform public.perm_audit('role_permission_changed', p_role || ':' || p_perm, jsonb_build_object('allowed', v_old), jsonb_build_object('allowed', p_allowed), jsonb_build_object('role', p_role, 'permission', p_perm));
  end if;
  -- switching a permission off switches its dependants off too (no contradictory configuration)
  if not p_allowed then
    for d in with recursive deps as (
               select perm from permission_catalog where depends_on = p_perm
               union select pc.perm from permission_catalog pc join deps on pc.depends_on = deps.perm)
             select rp.perm from role_permissions rp join deps using (perm) where rp.role = p_role and rp.allowed loop
      update role_permissions set allowed = false, updated_by = auth.uid(), updated_at = now() where role = p_role and perm = d.perm;
      perform public.perm_audit('role_permission_changed', p_role || ':' || d.perm, '{"allowed": true}'::jsonb, '{"allowed": false}'::jsonb, jsonb_build_object('role', p_role, 'permission', d.perm, 'because', p_perm));
      v_changed := v_changed || to_jsonb(d.perm);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'also_disabled', v_changed);
end $$;
revoke all on function public.admin_set_role_permission(text, text, boolean) from public, anon;
grant execute on function public.admin_set_role_permission(text, text, boolean) to authenticated;

-- p_allowed = null removes the override (back to the role default for that permission)
create or replace function public.admin_set_user_override(p_user uuid, p_perm text, p_allowed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text; c record; v_old boolean;
begin
  if not public.is_admin() then raise exception 'Only administrators can change permissions' using errcode = '42501'; end if;
  select role into v_role from profiles where id = p_user and deleted_at is null;
  if v_role is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'Administrator permissions are protected and cannot be changed' using errcode = '42501'; end if;
  select * into c from permission_catalog where perm = p_perm;
  if not found then raise exception 'Unknown permission' using errcode = '22023'; end if;
  if (case v_role when 'bd_executive' then c.sales_mode else c.viewer_mode end) <> 'config' then
    raise exception 'This permission is locked for this role' using errcode = '42501';
  end if;
  select allowed into v_old from user_permission_overrides where user_id = p_user and perm = p_perm;
  if p_allowed is null then
    delete from user_permission_overrides where user_id = p_user and perm = p_perm;
  else
    insert into user_permission_overrides (user_id, perm, allowed, updated_by, updated_at) values (p_user, p_perm, p_allowed, auth.uid(), now())
      on conflict (user_id, perm) do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();
  end if;
  if v_old is distinct from p_allowed then
    perform public.perm_audit(case when p_allowed is null then 'user_override_removed' else 'user_override_set' end, p_user::text || ':' || p_perm,
      jsonb_build_object('override', v_old), jsonb_build_object('override', p_allowed), jsonb_build_object('user_id', p_user, 'permission', p_perm));
  end if;
end $$;
revoke all on function public.admin_set_user_override(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_user_override(uuid, text, boolean) to authenticated;

create or replace function public.admin_reset_user_overrides(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; n int;
begin
  if not public.is_admin() then raise exception 'Only administrators can change permissions' using errcode = '42501'; end if;
  select coalesce(jsonb_object_agg(perm, allowed), '{}'::jsonb) into v_old from user_permission_overrides where user_id = p_user;
  delete from user_permission_overrides where user_id = p_user;
  get diagnostics n = row_count;
  if n > 0 then perform public.perm_audit('user_overrides_reset', p_user::text, v_old, '{}'::jsonb, jsonb_build_object('user_id', p_user)); end if;
  return n;
end $$;
revoke all on function public.admin_reset_user_overrides(uuid) from public, anon;
grant execute on function public.admin_reset_user_overrides(uuid) to authenticated;

-- terminology (display labels only — never role keys or business data). Stored in settings.terminology:
--   { "<label key>": { "en": "...", "ar": "..." }, ... }   blank = product default. Audited by the settings audit trigger.
create or replace function public.admin_set_terminology(p_labels jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; clean jsonb := '{}'::jsonb; en text; ar text;
begin
  if not public.is_admin() then raise exception 'Only administrators can change terminology' using errcode = '42501'; end if;
  if jsonb_typeof(p_labels) <> 'object' then raise exception 'Invalid labels' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(p_labels) loop
    if k not in ('role_admin', 'role_sales', 'role_viewer', 'sales_team', 'sales_department', 'management_dashboard') then
      raise exception 'Unknown label %', k using errcode = '22023';
    end if;
    en := btrim(coalesce(v ->> 'en', '')); ar := btrim(coalesce(v ->> 'ar', ''));
    if length(en) > 40 or length(ar) > 40 then raise exception 'Labels must be 40 characters or fewer' using errcode = '22023'; end if;
    if en <> '' or ar <> '' then clean := clean || jsonb_build_object(k, jsonb_build_object('en', en, 'ar', ar)); end if;
  end loop;
  perform set_config('app.actor', auth.uid()::text, true);
  insert into settings (key, value, description, updated_by, updated_at)
    values ('terminology', clean, 'Display labels (English / Arabic) — presentation only', auth.uid(), now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.admin_set_terminology(jsonb) from public, anon;
grant execute on function public.admin_set_terminology(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Shared report core (exactly migration 11's admin_report body, minus the admin check). Internal only: callable by
-- admin_report and management_report, never directly by clients.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.report_core(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.cairo_day_start(p_from);
  v_end   timestamptz := public.cairo_day_start(p_to + 1);
  v_today date := public.cairo_today();
  v_calls jsonb; v_meetings jsonb; v_commercial jsonb; v_followups jsonb; v_pipeline jsonb;
  v_users jsonb; v_days jsonb; v_wl jsonb; v_critical jsonb; v_tot record;
begin
  if p_to < p_from then raise exception 'Invalid range'; end if;
  if p_to - p_from > 400 then raise exception 'Range too large (max 400 days)'; end if;

  -- call totals (attempts, never de-duplicated by lead)
  select count(*) as total, count(*) filter (where o.kind = 'responded') as responded,
         count(distinct a.lead_id) as uniq
    into v_tot
    from call_attempts a join call_outcomes o on o.key = a.outcome
   where a.called_at >= v_start and a.called_at < v_end;

  -- per user
  with users as (
    select p.id, p.full_name, p.email, p.role, p.active from profiles p
     where (p.role = 'bd_executive' and p.deleted_at is null)
        or exists (select 1 from call_attempts a where a.user_id = p.id and a.called_at >= v_start and a.called_at < v_end)
  ), c as (
    select a.user_id, count(*) total, count(*) filter (where o.kind = 'responded') responded,
           count(distinct a.lead_id) uniq
      from call_attempts a join call_outcomes o on o.key = a.outcome
     where a.called_at >= v_start and a.called_at < v_end group by a.user_id
  ), m as (
    select created_by uid, count(*) n from meetings
     where created_from_call_id is not null and created_at >= v_start and created_at < v_end group by created_by
  ), pr as (
    select coalesce(owner_id, created_by) uid, count(*) n from proposals
     where created_at >= v_start and created_at < v_end group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'name', coalesce(nullif(u.full_name, ''), u.email), 'active', u.active,
      'total', coalesce(c.total, 0), 'responded', coalesce(c.responded, 0),
      'did_not_respond', coalesce(c.total, 0) - coalesce(c.responded, 0), 'unique_leads', coalesce(c.uniq, 0),
      'response_rate', case when coalesce(c.total, 0) > 0 then round(100.0 * c.responded / c.total, 1) end,
      'target', t.tgt,
      'achievement_pct', case when t.tgt > 0 then round(100.0 * coalesce(c.total, 0) / t.tgt, 1) end,
      'remaining', greatest(t.tgt - coalesce(c.total, 0), 0),
      'meetings_generated', coalesce(m.n, 0), 'proposals_generated', coalesce(pr.n, 0))
      order by coalesce(c.total, 0) desc, u.full_name), '[]'::jsonb)
    into v_users
    from users u
    left join c on c.user_id = u.id
    left join m on m.uid = u.id
    left join pr on pr.uid = u.id
    cross join lateral (select case when p_from = p_to then coalesce(public.user_target_on(u.id, p_from), 0) else public.user_target_total(u.id, p_from, p_to) end as tgt) t;

  -- per day
  with days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
  c as (
    select public.cairo_date(a.called_at) as day, count(*) total, count(*) filter (where o.kind = 'responded') responded,
           count(distinct a.lead_id) uniq
      from call_attempts a join call_outcomes o on o.key = a.outcome
     where a.called_at >= v_start and a.called_at < v_end group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', days.day, 'total', coalesce(c.total, 0), 'responded', coalesce(c.responded, 0),
      'did_not_respond', coalesce(c.total, 0) - coalesce(c.responded, 0), 'unique_leads', coalesce(c.uniq, 0),
      'target', (select coalesce(sum(public.user_target_on(p.id, days.day)), 0) from profiles p where p.role = 'bd_executive' and p.active
                  and (p_from = p_to or extract(dow from days.day)::int in (select jsonb_array_elements_text(coalesce((select value from settings where key = 'working_days'), '[0,1,2,3,4]'::jsonb))::int)))
    ) order by days.day), '[]'::jsonb)
    into v_days from days left join c on c.day = days.day;

  v_calls := jsonb_build_object(
    'total', v_tot.total, 'responded', v_tot.responded, 'did_not_respond', v_tot.total - v_tot.responded,
    'unique_leads', v_tot.uniq,
    'response_rate', case when v_tot.total > 0 then round(100.0 * v_tot.responded / v_tot.total, 1) end,
    'target', (select coalesce(sum((u ->> 'target')::bigint), 0) from jsonb_array_elements(v_users) u),
    'by_user', v_users, 'by_day', v_days);
  v_calls := v_calls || jsonb_build_object(
    'achievement_pct', case when (v_calls ->> 'target')::bigint > 0 then round(100.0 * v_tot.total / (v_calls ->> 'target')::bigint, 1) end,
    'remaining', greatest((v_calls ->> 'target')::bigint - v_tot.total, 0));

  -- meetings
  select jsonb_build_object(
    'scheduled', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and status <> 'requested'),
    'confirmed', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and confirmation_status = 'confirmed' and status in ('scheduled','completed','missed')),
    'unconfirmed', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and confirmation_status = 'unconfirmed' and status in ('scheduled','completed','missed')),
    'attended', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and attendance_status = 'attended'),
    'not_attended', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and attendance_status = 'not_attended'),
    'rescheduled', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and status = 'rescheduled'),
    'cancelled', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and status = 'cancelled'),
    'awaiting_outcome', count(*) filter (where scheduled_at >= v_start and scheduled_at < v_end and status = 'scheduled' and attendance_status = 'pending' and scheduled_at < now()),
    'requested', count(*) filter (where created_at >= v_start and created_at < v_end and status = 'requested'),
    'generated_from_calls', count(*) filter (where created_at >= v_start and created_at < v_end and created_from_call_id is not null))
    into v_meetings from meetings;

  -- commercial
  select jsonb_build_object(
    'forms_sent', (select count(*) from commercial_forms where sent_on between p_from and p_to),
    'forms_completed', (select count(*) from commercial_forms where completed_on between p_from and p_to),
    'forms_awaiting_client', (select count(*) from commercial_forms where status in ('sent', 'partially_completed')),
    'proposals_prepared', (select count(*) from proposals where created_at >= v_start and created_at < v_end),
    'proposals_sent', (select count(*) from proposals where sent_on between p_from and p_to),
    'awaiting_responses', (select count(*) from proposals where status in ('sent', 'under_review') and response_state is distinct from 'responded'),
    'proposal_responses', (select count(*) from proposals where response_on between p_from and p_to),
    'negotiations', (select count(distinct lead_id) from activities where type = 'negotiation' and occurred_at >= v_start and occurred_at < v_end),
    'proposal_value_sent', (select coalesce(sum(value), 0) from proposals where sent_on between p_from and p_to),
    'accepted', (select count(*) from proposals where status = 'accepted' and response_on between p_from and p_to),
    'rejected', (select count(*) from proposals where status = 'rejected' and response_on between p_from and p_to),
    'won', (select count(distinct lead_id) from activities where type = 'pipeline_change' and data ->> 'to' = 'won' and occurred_at >= v_start and occurred_at < v_end),
    'lost', (select count(distinct lead_id) from activities where type = 'pipeline_change' and data ->> 'to' = 'lost' and occurred_at >= v_start and occurred_at < v_end))
    into v_commercial;

  -- follow-ups due in range
  select jsonb_build_object(
    'due', count(*) filter (where due_date between p_from and p_to),
    'completed', count(*) filter (where due_date between p_from and p_to and status = 'completed'),
    'overdue', count(*) filter (where due_date between p_from and p_to and status = 'open' and due_date < v_today),
    'open_overdue_total', count(*) filter (where status = 'open' and due_date < v_today))
    into v_followups from follow_ups where status <> 'cancelled';

  -- pipeline: current snapshot + entries during period
  select coalesce(jsonb_agg(jsonb_build_object(
      'stage', s.key, 'label', s.label, 'position', s.position,
      'current', (select count(*) from leads l where l.pipeline_stage = s.key and not l.archived),
      'entered', (select count(distinct a.lead_id) from activities a where a.type = 'pipeline_change' and a.data ->> 'to' = s.key and a.occurred_at >= v_start and a.occurred_at < v_end))
      order by s.position), '[]'::jsonb)
    into v_pipeline from pipeline_stages s where s.active;

  -- wins / losses detail
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', x.lead_id, 'lead', x.name, 'result', x.res, 'at', x.at, 'by', x.who) order by x.at desc), '[]'::jsonb)
    into v_wl
    from (select a.lead_id, l.name, a.data ->> 'to' res, a.occurred_at at, coalesce(nullif(p.full_name, ''), p.email) who
            from activities a join leads l on l.id = a.lead_id left join profiles p on p.id = a.actor_id
           where a.type = 'pipeline_change' and a.data ->> 'to' in ('won', 'lost')
             and a.occurred_at >= v_start and a.occurred_at < v_end
           order by a.occurred_at desc limit 50) x;

  -- critical follow-ups (overdue, oldest first)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'lead_id', x.lead_id, 'lead', x.name, 'due_date', x.due_date,
           'days_overdue', v_today - x.due_date, 'owner', x.owner, 'notes', x.notes) order by x.due_date), '[]'::jsonb)
    into v_critical
    from (select f.id, f.lead_id, l.name, f.due_date, coalesce(nullif(p.full_name, ''), p.email) owner, f.notes
            from follow_ups f join leads l on l.id = f.lead_id left join profiles p on p.id = f.owner_id
           where f.status = 'open' and f.due_date < v_today
           order by f.due_date limit 25) x;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', 'Africa/Cairo', 'generated_at', now()),
    'calls', v_calls, 'meetings', v_meetings, 'commercial', v_commercial,
    'follow_ups', v_followups, 'pipeline', v_pipeline, 'wins_losses', v_wl, 'critical_follow_ups', v_critical);
end $$;
revoke all on function public.report_core(date, date) from public, anon, authenticated;

-- admin_report keeps its exact output and admin-only rule; it now reads through the shared (internal) core
create or replace function public.admin_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return public.report_core(p_from, p_to);
end $$;
grant execute on function public.admin_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Management report: department aggregates for anyone with management reporting; employee-level rows ONLY when the
-- caller's effective permissions allow them. Data minimisation happens HERE — fields that are not permitted are never
-- put into the response. No notes, minutes, contact details, lead names or auth data are ever included.
-- p_preview_role (admin only) renders the report exactly as that role's template would see it (it can only reduce).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.management_report(p_from date, p_to date, p_preview_role text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text; v_uid uuid := auth.uid(); r jsonb; out jsonb; byu jsonb;
  ind boolean; nm boolean; tg boolean;
  v_start timestamptz; v_end timestamptz; v_today date := public.cairo_today();
begin
  select role into v_role from profiles where id = v_uid and active and deleted_at is null;
  if v_role is null then raise exception 'Not allowed to view management reporting' using errcode = '42501'; end if;
  if p_preview_role is not null then
    if v_role <> 'admin' then raise exception 'Only administrators can preview roles' using errcode = '42501'; end if;
    if p_preview_role not in ('admin', 'bd_executive', 'viewer') then raise exception 'Unknown role' using errcode = '22023'; end if;
    v_role := p_preview_role; v_uid := null;
  end if;
  if not (public.perm_for(v_role, 'mgmt.department', v_uid)
          and (public.perm_for(v_role, 'mgmt.dashboard', v_uid) or public.perm_for(v_role, 'reports.view', v_uid))) then
    raise exception 'Not allowed to view management reporting' using errcode = '42501';
  end if;
  ind := public.perm_for(v_role, 'perf.individual', v_uid);
  nm := ind and public.perm_for(v_role, 'perf.names', v_uid);
  tg := ind and public.perm_for(v_role, 'perf.targets', v_uid);

  r := public.report_core(p_from, p_to);             -- validates the range (max 400 days, from <= to)
  v_start := public.cairo_day_start(p_from); v_end := public.cairo_day_start(p_to + 1);

  out := jsonb_build_object(
    'range', r -> 'range',
    'scope', jsonb_build_object('individual', ind, 'names', nm, 'targets', tg),
    -- ACTIVITY DURING THE SELECTED PERIOD
    'calls', (r -> 'calls') - 'by_user',
    'meetings', r -> 'meetings',
    'commercial', r -> 'commercial',
    'follow_ups', r -> 'follow_ups',
    'pipeline', r -> 'pipeline',
    'period', jsonb_build_object(
      'leads_new', (select count(*) from leads where created_at >= v_start and created_at < v_end),
      'won', (select count(*) from jsonb_array_elements(r -> 'wins_losses') e where e ->> 'result' = 'won'),
      'lost', (select count(*) from jsonb_array_elements(r -> 'wins_losses') e where e ->> 'result' = 'lost')),
    -- CURRENT SNAPSHOT (state right now, independent of the period)
    'snapshot', jsonb_build_object(
      'leads', (select jsonb_build_object(
          'total', count(*),
          'active', count(*) filter (where pipeline_stage not in ('won', 'lost') and temperature not in ('lost', 'closed')),
          'hot', count(*) filter (where temperature = 'hot'),
          'warm', count(*) filter (where temperature = 'warm'),
          'cold', count(*) filter (where temperature = 'cold'),
          'closed', count(*) filter (where pipeline_stage = 'won' or temperature = 'closed'),
          'lost', count(*) filter (where pipeline_stage = 'lost' or temperature = 'lost'))
        from leads where not archived),
      'follow_ups', (select jsonb_build_object(
          'open', count(*) filter (where status = 'open'),
          'overdue', count(*) filter (where status = 'open' and due_date < v_today))
        from follow_ups),
      'meetings', (select jsonb_build_object(
          'upcoming', count(*) filter (where status = 'scheduled' and scheduled_at >= now()),
          'awaiting_outcome', count(*) filter (where status = 'scheduled' and attendance_status = 'pending' and scheduled_at < now()))
        from meetings),
      'proposals', (select jsonb_build_object(
          'preparing', count(*) filter (where status in ('not_started', 'preparing', 'ready')),
          'sent', count(*) filter (where status = 'sent'),
          'under_review', count(*) filter (where status = 'under_review'),
          'awaiting_response', count(*) filter (where status in ('sent', 'under_review') and response_state is distinct from 'responded'),
          'revision_requested', count(*) filter (where status = 'revision_requested'),
          'accepted', count(*) filter (where status = 'accepted'),
          'rejected', count(*) filter (where status = 'rejected'))
        from proposals)));

  if ind then
    -- employee-level AGGREGATES only; names / individual targets only when separately allowed
    select coalesce(jsonb_agg(
             (case when nm then jsonb_build_object('name', e ->> 'name') else jsonb_build_object('member', x.ord) end)
             || jsonb_build_object('active', e -> 'active', 'total', e -> 'total', 'responded', e -> 'responded',
                                   'did_not_respond', e -> 'did_not_respond', 'unique_leads', e -> 'unique_leads',
                                   'response_rate', e -> 'response_rate', 'meetings_generated', e -> 'meetings_generated',
                                   'proposals_generated', e -> 'proposals_generated')
             || (case when tg then jsonb_build_object('target', e -> 'target', 'achievement_pct', e -> 'achievement_pct', 'remaining', e -> 'remaining') else '{}'::jsonb end)
             order by x.ord), '[]'::jsonb)
      into byu
      from jsonb_array_elements(r -> 'calls' -> 'by_user') with ordinality as x(e, ord);
    out := jsonb_set(out, '{calls,by_user}', byu);
  end if;
  return out;
end $$;
revoke all on function public.management_report(date, date, text) from public, anon;
grant execute on function public.management_report(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Exports: full CRM + board = admin only (hard rule); management summary = permission; datasets = staff + permission
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.log_export(
  p_kind text, p_format text, p_from date default null, p_to date default null, p_filters jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_member() then raise exception 'Not allowed to export CRM data' using errcode = '42501'; end if;
  if p_kind not in ('full', 'board', 'management', 'leads', 'contacts', 'calls', 'followups', 'meetings', 'minutes', 'forms',
                    'proposals', 'pipeline', 'activities', 'projects') then
    raise exception 'Unknown export type %', p_kind using errcode = '22023';
  end if;
  if p_format not in ('xlsx', 'pdf') then raise exception 'Unknown export format %', p_format using errcode = '22023'; end if;
  if p_kind in ('full', 'board') then
    if not public.is_admin() then raise exception 'Only administrators can run this export' using errcode = '42501'; end if;
  elsif p_kind = 'management' then
    if not (public.is_admin() or public.has_perm('export.management_summary')) then
      raise exception 'Not allowed to export the management summary' using errcode = '42501';
    end if;
  elsif not (public.is_admin() or (public.is_staff() and public.has_perm('export.datasets'))) then
    raise exception 'Not allowed to export CRM data' using errcode = '42501';
  end if;
  insert into audit_logs (actor_id, actor_email, entity, entity_id, action, meta)
  values (auth.uid(), (select email from profiles where id = auth.uid()), 'export', p_kind, 'data_export',
          jsonb_build_object('format', p_format, 'from', p_from, 'to', p_to, 'timezone', 'Africa/Cairo',
                             'filters', coalesce(p_filters, '{}'::jsonb) - 'file' - 'data'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_export(text, text, date, date, jsonb) from public, anon;
grant execute on function public.log_export(text, text, date, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- RLS: raw operational rows. Sales + Admin (staff) keep exactly their current access. A Management Viewer reads raw
-- rows ONLY when the matching permission is granted (default: none). Writes are unchanged (viewers never write).
-- (select has_perm(...)) is evaluated once per statement, not per row.
-- ---------------------------------------------------------------------------------------------------------------
drop policy leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy rollups_read on public.lead_rollups;
create policy rollups_read on public.lead_rollups for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy contacts_read on public.contacts;
create policy contacts_read on public.contacts for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy activities_read on public.activities;
create policy activities_read on public.activities for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy att_read on public.attachments;
create policy att_read on public.attachments for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads'))));
drop policy calls_read on public.call_attempts;
create policy calls_read on public.call_attempts for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.calls'))));
drop policy fu_read on public.follow_ups;
create policy fu_read on public.follow_ups for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.followups'))));
drop policy mt_read on public.meetings;
create policy mt_read on public.meetings for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.meetings'))));
drop policy form_read on public.commercial_forms;
create policy form_read on public.commercial_forms for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.proposals'))));
drop policy prop_read on public.proposals;
create policy prop_read on public.proposals for select to authenticated
  using (public.is_staff() or (public.is_member() and (select public.has_perm('raw.proposals'))));
-- colleagues' names: staff, yourself, or a viewer allowed employee names / raw lead data (owner names)
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_staff() or id = auth.uid()
         or (public.is_member() and ((select public.has_perm('perf.names')) or (select public.has_perm('raw.leads')))));
drop policy "crm files: members read" on storage.objects;
create policy "crm files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'crm-files' and (public.is_staff() or (public.is_member() and (select public.has_perm('raw.leads')))));
