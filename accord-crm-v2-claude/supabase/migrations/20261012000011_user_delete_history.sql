-- Permanent user deletion that PRESERVES CRM history (migration 11).
-- * profiles.id no longer cascades from auth.users: deleting the Auth account (Edge Function, service role) leaves the CRM
--   profile in place as a TOMBSTONE, so every call, meeting, follow-up, proposal, activity, target and audit row keeps
--   pointing at a real profile and still shows who did it ("<name> (Deleted user)").
-- * deleted users are inactive forever (RLS already denies every inactive account), drop out of current-team lists, and
--   their email can be reused for a new account (the unique email index ignores tombstones).
-- * admin_user_signins(): admins can read last sign-in times (auth.users) for the Users page.
-- * svc_auth_user_by_email(): service-role helper used to clean up an orphaned Auth account left by a failed invite.
-- Additive / non-destructive: no CRM row is changed by this migration.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid;
drop index if exists public.profiles_email_key;
create unique index if not exists profiles_email_key on public.profiles (lower(email)) where deleted_at is null;

-- a tombstone can never be re-activated or un-deleted (also not by a direct admin REST call)
create or replace function public.profiles_tombstone_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('app.undo_delete', true) = 'on' then return new; end if; -- svc_unmark_user_deleted only
  if old.deleted_at is not null and (new.deleted_at is null or new.active or new.role <> old.role) then
    raise exception 'Deleted users cannot be changed or reactivated' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_tombstone_guard on public.profiles;
create trigger profiles_tombstone_guard before update on public.profiles for each row execute function public.profiles_tombstone_guard();

create or replace function public.svc_mark_user_deleted(p_actor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor::text, true);
  update profiles set active = false, must_change_password = false, deleted_at = now(), deleted_by = p_actor,
         full_name = case when full_name like '%(Deleted user)' then full_name
                          else btrim(coalesce(nullif(full_name, ''), email) || ' (Deleted user)') end
   where id = p_user and deleted_at is null;
  if not found then raise exception 'User not found or already deleted' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.svc_mark_user_deleted(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_mark_user_deleted(uuid, uuid) to service_role;

-- undo of svc_mark_user_deleted, only used when the Auth deletion itself fails right after (same request)
create or replace function public.svc_unmark_user_deleted(p_actor uuid, p_user uuid, p_full_name text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor::text, true);
  perform set_config('app.undo_delete', 'on', true);
  update profiles set deleted_at = null, deleted_by = null, active = p_active, full_name = p_full_name where id = p_user;
  perform set_config('app.undo_delete', 'off', true);
end $$;
revoke all on function public.svc_unmark_user_deleted(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_unmark_user_deleted(uuid, uuid, text, boolean) to service_role;

create or replace function public.svc_auth_user_by_email(p_email text)
returns table (id uuid, has_profile boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, exists (select 1 from public.profiles p where p.id = u.id), u.last_sign_in_at
    from auth.users u where lower(u.email) = lower(p_email)
$$;
revoke all on function public.svc_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.svc_auth_user_by_email(text) to service_role;

create or replace function public.admin_user_signins() returns table (id uuid, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select u.id, u.last_sign_in_at from auth.users u join public.profiles p on p.id = u.id;
end $$;
revoke all on function public.admin_user_signins() from public, anon;
grant execute on function public.admin_user_signins() to authenticated;

-- reports: a deleted BD executive no longer appears as a current team member, but still appears for any period in
-- which they logged calls (history preserved). Only the user-selection line differs from migration 4.
create or replace function public.admin_report(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_start timestamptz := public.cairo_day_start(p_from);
  v_end   timestamptz := public.cairo_day_start(p_to + 1);
  v_today date := public.cairo_today();
  v_calls jsonb; v_meetings jsonb; v_commercial jsonb; v_followups jsonb; v_pipeline jsonb;
  v_users jsonb; v_days jsonb; v_wl jsonb; v_critical jsonb; v_tot record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
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
grant execute on function public.admin_report(date, date) to authenticated;
