-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 10 · Launch readiness
--
-- Demo cleanup completeness: every table with an is_demo column is registered for
-- delete_all_demo_data(). payment_records, stock_reservations and promo_redemptions already lose
-- their demo rows through ON DELETE CASCADE from orders / variants / offers; registering them makes
-- the cleanup explicit, keeps demo_data_summary() complete, and lets the launch audit
-- (supabase/scripts/demo_audit.sql) require "no unregistered is_demo table". Deleted before orders.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

select app.register_demo_table('public.payment_records', 4);
select app.register_demo_table('public.stock_reservations', 4);
select app.register_demo_table('public.promo_redemptions', 4);

-- ── Anti-abuse for the two anonymous write endpoints ───────────────────────
-- join_waitlist and request_stock_alert accept guests (dedupe per product + phone). A per-subject
-- flood limit stops scripted spam with rotating phone numbers: subject = signed-in user, else the
-- client IP the Supabase API gateway forwards, else a shared "anonymous" bucket with a higher cap.
-- A client can prepend its own X-Forwarded-For hop, so the per-IP limit alone can be dodged; a
-- global ceiling per bucket (100 × the per-subject limit per window) bounds even a spoofed flood.
create table if not exists app.rate_events (
  bucket     text not null,
  subject    text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_lookup_idx on app.rate_events (bucket, subject, created_at);
revoke all on app.rate_events from public, anon, authenticated;

create or replace function app.request_subject()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    app.current_actor_id()::text,
    'ip:' || nullif(btrim(split_part(
      coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'anonymous');
$$;

-- Raises 'rate_limited' (SQLSTATE 54000) when the subject used the bucket p_max times within p_window,
-- or everyone together used it p_max × 100 times.
create or replace function app.consume_rate(p_bucket text, p_max integer, p_window interval)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subject text := app.request_subject();
  v_max integer := case when v_subject = 'anonymous' then p_max * 30 else p_max end;
begin
  if (select count(*) from app.rate_events
      where bucket = p_bucket and subject = v_subject and created_at > now() - p_window) >= v_max
     or (select count(*) from app.rate_events
         where bucket = p_bucket and created_at > now() - p_window) >= p_max * 100 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into app.rate_events (bucket, subject) values (p_bucket, v_subject);
  -- Opportunistic housekeeping: rate events are only needed for a day.
  delete from app.rate_events where bucket = p_bucket and created_at < now() - interval '1 day';
end;
$$;
revoke all on function app.consume_rate(text, integer, interval), app.request_subject() from public;

create or replace function app.guard_public_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Staff tools and the service role are not limited; customers and guests are.
  if coalesce(auth.role(), 'anon') in ('anon', 'authenticated') then
    perform app.consume_rate('public_request', 10, interval '1 hour');
  end if;
  return new;
end;
$$;

drop trigger if exists waitlist_entries_rate_guard on public.waitlist_entries;
create trigger waitlist_entries_rate_guard before insert on public.waitlist_entries
  for each row execute function app.guard_public_request();
drop trigger if exists stock_notifications_rate_guard on public.stock_notifications;
create trigger stock_notifications_rate_guard before insert on public.stock_notifications
  for each row execute function app.guard_public_request();

-- ── Webhook log flood cap ───────────────────────────────────────────────────
-- Requests with a bad signature are logged for the owner (reason only), at most 200 per hour per
-- integration; beyond that they are dropped silently (the Edge Function still answers 401).
create or replace function app.cap_rejected_webhooks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.signature_valid and (
       select count(*) from public.integration_webhook_events
       where key = new.key and not signature_valid and received_at > now() - interval '1 hour') >= 200 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists integration_webhook_events_cap on public.integration_webhook_events;
create trigger integration_webhook_events_cap before insert on public.integration_webhook_events
  for each row execute function app.cap_rejected_webhooks();

-- ── MFA for integration management ─────────────────────────────────────────
-- Changing an integration's provider, settings, template mapping, ownership, direction or on/off
-- state now needs an MFA (aal2) session when Settings → Security → "Require MFA for admins" is on,
-- like role, price, payment and settings changes. Health-check bookkeeping and the server runtime
-- (service role) are not affected.
create or replace function app.guard_integration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (new.provider, new.settings, new.enabled, new.template_map, new.ownership, new.direction)
         is distinct from (old.provider, old.settings, old.enabled, old.template_map, old.ownership, old.direction) then
    perform app.assert_sensitive_action_allowed();
  end if;
  return new;
end;
$$;

drop trigger if exists integration_configs_mfa_guard on public.integration_configs;
create trigger integration_configs_mfa_guard before update on public.integration_configs
  for each row execute function app.guard_integration_change();
