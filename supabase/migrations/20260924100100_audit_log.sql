-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0002 · Audit log
-- Append-only record of important changes: who, what, when, before/after.
-- Rows are written only by triggers / SECURITY DEFINER functions; nobody can edit or delete them
-- through the API, and a trigger blocks UPDATE/DELETE/TRUNCATE even for privileged roles.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,            -- auth user id (no FK: history must outlive deleted users)
  actor_role    text,            -- JWT role (authenticated / service_role) or DB role for SQL-editor changes
  action        text not null check (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  entity_type   text not null,
  entity_id     text,
  changed_fields text[],
  before_data   jsonb,
  after_data    jsonb,
  metadata      jsonb not null default '{}'::jsonb
);

comment on table public.audit_logs is 'Append-only audit trail of admin changes (who, what, when, before/after).';

create index if not exists audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, occurred_at desc);

alter table public.audit_logs enable row level security;

-- Immutability: API roles can never write directly; triggers below also stop privileged edits.
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated, service_role;
revoke all on public.audit_logs from anon;
grant select on public.audit_logs to authenticated;

create or replace function app.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_no_update_delete on public.audit_logs;
create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function app.prevent_audit_mutation();

drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function app.prevent_audit_mutation();

-- Current actor helpers (work for API requests and for SQL-editor sessions).
create or replace function app.current_actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function app.current_actor_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''), session_user::text);
$$;

-- Write a custom audit event (used by RPCs for semantic actions such as "setting.publish").
create or replace function app.log_event(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                                 changed_fields, before_data, after_data, metadata)
  values (app.current_actor_id(), app.current_actor_role(), p_action, p_entity_type, p_entity_id,
          app.jsonb_changed_keys(p_before, p_after), p_before, p_after, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Generic row-change trigger.
--   TG_ARGV[0] = comma-separated key columns forming entity_id (default: id)
--   TG_ARGV[1] = comma-separated columns to redact from before/after (optional)
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_key_columns text[] := string_to_array(coalesce(nullif(tg_argv[0], ''), 'id'), ',');
  v_redact text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}');
  v_entity_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old) - v_redact; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new) - v_redact; end if;

  -- Ignore no-op updates and updates that only touch updated_at.
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return new;
  end if;

  v_row := coalesce(v_after, v_before);
  select string_agg(coalesce(v_row ->> btrim(col), ''), ':' order by ord)
    into v_entity_id
    from unnest(v_key_columns) with ordinality as k(col, ord);

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                                 changed_fields, before_data, after_data)
  values (app.current_actor_id(), app.current_actor_role(), lower(tg_op),
          tg_table_schema || '.' || tg_table_name, v_entity_id,
          app.jsonb_changed_keys(v_before, v_after), v_before, v_after);

  return coalesce(new, old);
end;
$$;

comment on function app.audit_row_change() is
  'AFTER INSERT/UPDATE/DELETE trigger writing before/after snapshots to public.audit_logs.';

revoke all on function app.log_event(text, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function app.audit_row_change() from public;
revoke all on function app.prevent_audit_mutation() from public;
grant execute on function app.current_actor_id(), app.current_actor_role() to anon, authenticated, service_role;
