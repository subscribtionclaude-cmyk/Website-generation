-- LOCAL TESTING ONLY. Assertion helpers for supabase/tests/sql/*.test.sql.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.assert(p_condition boolean, p_message text) returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

create or replace function tests.assert_equal(p_actual anyelement, p_expected anyelement, p_message text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

-- Run a statement as the CURRENT role and require it to fail with the given SQLSTATE
-- (e.g. 42501 insufficient_privilege / RLS violation).
create or replace function tests.assert_raises(p_sql text, p_sqlstate text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (raised %: %)', p_message, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got %: %)', p_message, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, statement succeeded)', p_message, p_sqlstate;
end;
$$;

-- Impersonate an API caller for the rest of the transaction (like PostgREST does).
create or replace function tests.act_as(p_user_id uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Create an auth user (the auth trigger provisions the profile) with optional system role.
create or replace function tests.create_user(p_email text, p_role_key text default null) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into auth.users (email) values (p_email) returning id into v_id;
  if p_role_key is not null then
    insert into public.user_roles (user_id, role_id)
    select v_id, id from public.roles where key = p_role_key;
  end if;
  return v_id;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
