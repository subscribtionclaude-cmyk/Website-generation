-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0005 · Demo data registry
--
-- Every seedable business table (catalog, offers, news … from Phase 02) has
--   is_demo boolean not null default false
-- and registers itself here. "Delete All Demo Data" removes exactly those rows, in a safe order,
-- without touching real data. Demo rows are never created by the live frontend.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists app.demo_tables (
  table_name    regclass primary key,
  delete_order  integer not null default 100,
  registered_at timestamptz not null default now()
);

comment on table app.demo_tables is 'Tables holding is_demo rows, deleted in ascending delete_order (children first).';

create or replace function app.register_demo_table(p_table regclass, p_delete_order integer default 100)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = p_table and attname = 'is_demo' and atttypid = 'boolean'::regtype and not attisdropped
  ) then
    raise exception 'Table % has no boolean is_demo column', p_table;
  end if;
  insert into app.demo_tables (table_name, delete_order) values (p_table, p_delete_order)
  on conflict (table_name) do update set delete_order = excluded.delete_order;
end;
$$;

revoke all on function app.register_demo_table(regclass, integer) from public;

-- Counts of demo rows per registered table (for the admin demo-data screen).
create or replace function public.demo_data_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
begin
  if not (app.has_permission('demo.manage') or app.has_permission('dashboard.view')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for v_table in select table_name from app.demo_tables order by delete_order loop
    execute format('select count(*) from %s where is_demo', v_table.table_name) into v_count;
    v_result := v_result || jsonb_build_object(v_table.table_name::text, v_count);
  end loop;
  return v_result;
end;
$$;

-- Delete every demo row in registered tables. Requires demo.manage (+ MFA when enforced). Audited.
create or replace function public.delete_all_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
begin
  if app.current_actor_id() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not app.has_permission('demo.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.assert_sensitive_action_allowed();

  for v_table in select table_name from app.demo_tables order by delete_order, table_name::text loop
    execute format('delete from %s where is_demo', v_table.table_name);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object(v_table.table_name::text, v_count);
  end loop;

  perform app.log_event('demo.delete_all', 'demo_data', null, null, null, jsonb_build_object('deleted', v_result));
  return v_result;
end;
$$;

revoke all on function public.demo_data_summary() from public, anon;
revoke all on function public.delete_all_demo_data() from public, anon;
grant execute on function public.demo_data_summary(), public.delete_all_demo_data() to authenticated;
