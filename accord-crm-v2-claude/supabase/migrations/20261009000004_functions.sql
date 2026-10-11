-- Views + RPC functions (business logic lives next to the data)

-- ---------------------------------------------------------------------------
-- Lead list view (RLS of the caller applies)
-- ---------------------------------------------------------------------------
create or replace view public.lead_list_v with (security_invoker = true) as
select
  l.id, l.name, l.external_lead_id, l.temperature, l.pipeline_stage, l.owner_id, l.city, l.industry,
  l.source, l.archived, l.created_at, l.updated_at, l.legacy,
  o.full_name as owner_name,
  r.search_text, r.contacts_count, r.primary_contact, r.total_calls, r.responded_calls,
  r.last_call_at, r.last_call_outcome, r.open_follow_ups, r.next_follow_up_date,
  r.next_meeting_at, r.next_meeting_confirmation, r.meetings_total, r.meetings_attended,
  r.last_meeting_outcome, r.form_status, r.proposal_status, r.proposal_response,
  r.negotiation_recorded, r.last_activity_at,
  -- A SUGGESTION only: the UI asks for confirmation, the system never moves the stage silently.
  case
    when l.pipeline_stage in ('won', 'lost') then null
    when r.negotiation_recorded
         and (select position from public.pipeline_stages where key = l.pipeline_stage) < (select position from public.pipeline_stages where key = 'negotiation')
      then 'negotiation'
    when r.proposal_status in ('sent', 'under_review', 'revision_requested')
         and (select position from public.pipeline_stages where key = l.pipeline_stage) < (select position from public.pipeline_stages where key = 'proposal')
      then 'proposal'
    when (r.next_meeting_at is not null or r.meetings_attended > 0)
         and (select position from public.pipeline_stages where key = l.pipeline_stage) < (select position from public.pipeline_stages where key = 'meeting')
      then 'meeting'
    else null
  end as suggested_stage
from public.leads l
left join public.lead_rollups r on r.lead_id = l.id
left join public.profiles o on o.id = l.owner_id;
grant select on public.lead_list_v to authenticated;

-- ---------------------------------------------------------------------------
-- Targets
-- ---------------------------------------------------------------------------
create or replace function public.user_target_on(p_user uuid, p_date date) returns int
language sql stable security invoker set search_path = public as $$
  select daily_call_target from user_targets
   where user_id = p_user and active and effective_from <= p_date
     and (effective_to is null or effective_to >= p_date)
   order by effective_from desc limit 1
$$;
revoke all on function public.user_target_on(uuid, date) from public, anon;
grant execute on function public.user_target_on(uuid, date) to authenticated, service_role;

-- Sum of daily targets across the WORKING days of a range (settings.working_days, 0 = Sunday).
create or replace function public.user_target_total(p_user uuid, p_from date, p_to date) returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(public.user_target_on(p_user, d::date)), 0)
    from generate_series(p_from, p_to, interval '1 day') d
   where extract(dow from d)::int in (
     select jsonb_array_elements_text(coalesce((select value from settings where key = 'working_days'), '[0,1,2,3,4]'::jsonb))::int)
$$;
revoke all on function public.user_target_total(uuid, date, date) from public, anon;
grant execute on function public.user_target_total(uuid, date, date) to authenticated, service_role;

-- Atomically set a new target from a date: closes/deactivates overlapping rows (history preserved).
create or replace function public.set_user_target(p_user uuid, p_target int, p_from date default null) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_from date := coalesce(p_from, public.cairo_today()); v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'unknown user'; end if;
  -- soft-retire rows starting on/after the new effective date
  update user_targets set active = false where user_id = p_user and active and effective_from >= v_from;
  -- close the one that spans the new date
  update user_targets set effective_to = v_from - 1
   where user_id = p_user and active and effective_from < v_from and (effective_to is null or effective_to >= v_from);
  insert into user_targets (user_id, daily_call_target, effective_from, created_by)
  values (p_user, p_target, v_from, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create or replace function public.log_call(
  p_lead_id uuid,
  p_outcome text,
  p_contact_id uuid default null,
  p_sub_outcome text default null,
  p_notes text default null,
  p_session_id uuid default null,
  p_called_at timestamptz default null,
  p_duration int default null,
  p_follow_up_date date default null,
  p_follow_up_note text default null
) returns public.call_attempts
language plpgsql security invoker set search_path = public as $$
declare
  v_call call_attempts;
  v_fu uuid;
begin
  if not exists (select 1 from call_outcomes where key = p_outcome and active) then
    raise exception 'Unknown or inactive call outcome: %', p_outcome;
  end if;
  if p_follow_up_date is not null and p_follow_up_date < public.cairo_today() then
    raise exception 'Follow-up date cannot be in the past';
  end if;

  insert into call_attempts (lead_id, contact_id, user_id, call_session_id, outcome, sub_outcome, called_at,
                             duration_seconds, notes)
  values (p_lead_id, p_contact_id, auth.uid(), p_session_id, p_outcome, p_sub_outcome,
          coalesce(p_called_at, now()), p_duration, nullif(btrim(p_notes), ''))
  returning * into v_call;

  if p_follow_up_date is not null then
    insert into follow_ups (lead_id, contact_id, owner_id, title, notes, due_date, origin, call_id, created_by)
    values (p_lead_id, p_contact_id, auth.uid(), 'Follow-up after call', nullif(btrim(p_follow_up_note), ''),
            p_follow_up_date, 'call', v_call.id, auth.uid())
    returning id into v_fu;
    update call_attempts set follow_up_id = v_fu where id = v_call.id returning * into v_call;
  end if;
  return v_call;
end $$;
grant execute on function public.log_call(uuid, text, uuid, text, text, uuid, timestamptz, int, date, text) to authenticated;

-- Per-user metrics for a Cairo date range. Callers may only ask for themselves unless admin.
create or replace function public.call_metrics(p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_total int; v_resp int; v_uniq int; v_target bigint; v_day_target int;
begin
  if p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.is_member() then raise exception 'not allowed' using errcode = '42501'; end if;

  select count(*), count(*) filter (where o.kind = 'responded'), count(distinct a.lead_id)
    into v_total, v_resp, v_uniq
    from call_attempts a join call_outcomes o on o.key = a.outcome
   where a.user_id = p_user
     and a.called_at >= public.cairo_day_start(p_from)
     and a.called_at <  public.cairo_day_start(p_to + 1);

  v_target := public.user_target_total(p_user, p_from, p_to);
  v_day_target := case when p_from = p_to then public.user_target_on(p_user, p_from) else null end;
  if p_from = p_to then v_target := coalesce(v_day_target, 0); end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', v_total, 'responded', v_resp, 'did_not_respond', v_total - v_resp,
    'unique_leads', v_uniq,
    'response_rate', case when v_total > 0 then round(100.0 * v_resp / v_total, 1) end,
    'target', v_target,
    'has_target', v_target > 0,
    -- never capped at 100
    'achievement_pct', case when v_target > 0 then round(100.0 * v_total / v_target, 1) end,
    'remaining', greatest(v_target - v_total, 0));
end $$;
grant execute on function public.call_metrics(uuid, date, date) to authenticated;

-- Day-by-day breakdown for a user over a Cairo date range (history / weekly / monthly views)
create or replace function public.call_metrics_daily(p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.is_member() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Invalid range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', d.day, 'total', coalesce(c.total, 0), 'responded', coalesce(c.responded, 0),
      'did_not_respond', coalesce(c.total, 0) - coalesce(c.responded, 0), 'unique_leads', coalesce(c.uniq, 0),
      'target', public.user_target_on(p_user, d.day)) order by d.day desc)
    from (select g::date as day from generate_series(p_from, p_to, interval '1 day') g) d
    left join (
      select public.cairo_date(a.called_at) as day, count(*) total, count(*) filter (where o.kind = 'responded') responded,
             count(distinct a.lead_id) uniq
        from call_attempts a join call_outcomes o on o.key = a.outcome
       where a.user_id = p_user and a.called_at >= public.cairo_day_start(p_from) and a.called_at < public.cairo_day_start(p_to + 1)
       group by 1) c on c.day = d.day), '[]'::jsonb);
end $$;
grant execute on function public.call_metrics_daily(uuid, date, date) to authenticated;

create or replace function public.my_call_metrics(p_date date default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  select public.call_metrics(auth.uid(), coalesce(p_date, public.cairo_today()), coalesce(p_date, public.cairo_today()))
$$;
grant execute on function public.my_call_metrics(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------
create or replace function public.record_meeting_attendance(
  p_meeting uuid,
  p_attended boolean,
  p_reason text default null,
  p_notes text default null,
  p_replacement jsonb default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  m meetings;
  v_new uuid;
begin
  select * into m from meetings where id = p_meeting for update;
  if not found then raise exception 'Meeting not found'; end if;
  if m.status = 'requested' then raise exception 'Meeting has not been scheduled yet'; end if;
  if m.attendance_status <> 'pending' then raise exception 'Attendance already recorded for this meeting'; end if;

  if p_attended then
    update meetings set attendance_status = 'attended', attendance_recorded_at = now(), status = 'completed'
     where id = p_meeting;
    return jsonb_build_object('meeting_id', p_meeting, 'replacement_id', null);
  end if;

  if p_reason is null then raise exception 'A reason is required when a meeting is not attended'; end if;
  if p_reason = 'rescheduled' and p_replacement is null then
    raise exception 'A replacement meeting is required when the reason is "rescheduled"';
  end if;

  update meetings set attendance_status = 'not_attended', attendance_recorded_at = now(),
         not_attended_reason = p_reason, not_attended_notes = nullif(btrim(p_notes), ''),
         status = case when p_reason = 'rescheduled' then 'rescheduled' else 'missed' end
   where id = p_meeting;

  if p_replacement is not null then
    insert into meetings (lead_id, contact_id, owner_id, status, scheduled_at, meeting_type, location, online_link,
                          confirmation_status, meeting_with, purpose, agenda, rescheduled_from_id, proposal_id, created_by)
    values (m.lead_id, m.contact_id, m.owner_id, 'scheduled',
            (p_replacement ->> 'scheduled_at')::timestamptz,
            coalesce(p_replacement ->> 'meeting_type', m.meeting_type),
            coalesce(p_replacement ->> 'location', m.location),
            coalesce(p_replacement ->> 'online_link', m.online_link),
            coalesce(p_replacement ->> 'confirmation_status', 'unconfirmed'),
            coalesce(p_replacement ->> 'meeting_with', m.meeting_with),
            coalesce(p_replacement ->> 'purpose', m.purpose),
            coalesce(p_replacement ->> 'agenda', m.agenda),
            m.id, m.proposal_id, auth.uid())
    returning id into v_new;
    update meetings set next_meeting_id = v_new, next_meeting_required = true where id = p_meeting;
  end if;
  return jsonb_build_object('meeting_id', p_meeting, 'replacement_id', v_new);
end $$;
grant execute on function public.record_meeting_attendance(uuid, boolean, text, text, jsonb) to authenticated;

-- Reschedule = keep the old meeting (status rescheduled) + create a new linked one
create or replace function public.reschedule_meeting(
  p_meeting uuid, p_scheduled_at timestamptz, p_confirmation text default 'unconfirmed', p_note text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare m meetings; v_new uuid;
begin
  select * into m from meetings where id = p_meeting for update;
  if not found then raise exception 'Meeting not found'; end if;
  if m.attendance_status <> 'pending' or m.status not in ('scheduled') then
    raise exception 'Only an open scheduled meeting can be rescheduled';
  end if;
  insert into meetings (lead_id, contact_id, owner_id, status, scheduled_at, meeting_type, location, online_link,
                        confirmation_status, meeting_with, purpose, agenda, internal_attendees, external_attendees,
                        rescheduled_from_id, proposal_id, created_by, notes)
  values (m.lead_id, m.contact_id, m.owner_id, 'scheduled', p_scheduled_at, m.meeting_type, m.location, m.online_link,
          p_confirmation, m.meeting_with, m.purpose, m.agenda, m.internal_attendees, m.external_attendees,
          m.id, m.proposal_id, auth.uid(), nullif(btrim(p_note), ''))
  returning id into v_new;
  update meetings set status = 'rescheduled', next_meeting_id = v_new where id = p_meeting;
  return v_new;
end $$;
grant execute on function public.reschedule_meeting(uuid, timestamptz, text, text) to authenticated;

-- Record minutes / outcome / next step (+ optional next meeting & follow-up) atomically.
create or replace function public.save_meeting_outcome(
  p_meeting uuid, p_data jsonb, p_next_meeting jsonb default null, p_follow_up_date date default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare m meetings; v_new uuid; v_fu uuid;
begin
  select * into m from meetings where id = p_meeting for update;
  if not found then raise exception 'Meeting not found'; end if;
  if m.attendance_status <> 'attended' then
    raise exception 'Minutes can only be recorded after the meeting is marked Attended';
  end if;

  update meetings set
    meeting_with       = case when p_data ? 'meeting_with'       then p_data ->> 'meeting_with'       else meeting_with end,
    external_attendees = case when p_data ? 'external_attendees' then p_data ->> 'external_attendees' else external_attendees end,
    internal_attendees = case when p_data ? 'internal_attendees' then p_data ->> 'internal_attendees' else internal_attendees end,
    summary            = case when p_data ? 'summary'            then p_data ->> 'summary'            else summary end,
    minutes_of_meeting = case when p_data ? 'minutes_of_meeting' then p_data ->> 'minutes_of_meeting' else minutes_of_meeting end,
    client_requirements= case when p_data ? 'client_requirements' then p_data ->> 'client_requirements' else client_requirements end,
    discussion_points  = case when p_data ? 'discussion_points'  then p_data ->> 'discussion_points'  else discussion_points end,
    agreements         = case when p_data ? 'agreements'         then p_data ->> 'agreements'         else agreements end,
    commitments        = case when p_data ? 'commitments'        then p_data ->> 'commitments'        else commitments end,
    requested_documents= case when p_data ? 'requested_documents' then p_data ->> 'requested_documents' else requested_documents end,
    commercial_notes   = case when p_data ? 'commercial_notes'   then p_data ->> 'commercial_notes'   else commercial_notes end,
    meeting_outcome    = case when p_data ? 'meeting_outcome'    then nullif(p_data ->> 'meeting_outcome', '') else meeting_outcome end,
    next_step          = case when p_data ? 'next_step'          then nullif(p_data ->> 'next_step', '') else next_step end,
    next_step_detail   = case when p_data ? 'next_step_detail'   then p_data ->> 'next_step_detail'   else next_step_detail end,
    next_follow_up_at  = coalesce(p_follow_up_date, case when p_data ? 'next_follow_up_at' then nullif(p_data ->> 'next_follow_up_at', '')::date else next_follow_up_at end),
    next_meeting_required = case when p_data ? 'next_meeting_required' then (p_data ->> 'next_meeting_required')::boolean else next_meeting_required end
  where id = p_meeting;

  if p_next_meeting is not null then
    insert into meetings (lead_id, contact_id, owner_id, status, scheduled_at, meeting_type, location, online_link,
                          confirmation_status, meeting_with, purpose, agenda, follows_meeting_id, proposal_id, created_by)
    values (m.lead_id, m.contact_id, m.owner_id, 'scheduled', (p_next_meeting ->> 'scheduled_at')::timestamptz,
            coalesce(p_next_meeting ->> 'meeting_type', m.meeting_type), p_next_meeting ->> 'location',
            p_next_meeting ->> 'online_link', coalesce(p_next_meeting ->> 'confirmation_status', 'unconfirmed'),
            coalesce(p_next_meeting ->> 'meeting_with', m.meeting_with),
            coalesce(p_next_meeting ->> 'purpose', 'Follow-up meeting'), p_next_meeting ->> 'agenda',
            m.id, m.proposal_id, auth.uid())
    returning id into v_new;
    update meetings set next_meeting_id = v_new, next_meeting_required = true where id = p_meeting;
  end if;

  if p_follow_up_date is not null then
    insert into follow_ups (lead_id, contact_id, owner_id, title, notes, due_date, origin, meeting_id, created_by)
    values (m.lead_id, m.contact_id, coalesce(m.owner_id, auth.uid()), 'Follow-up after meeting',
            nullif(btrim(p_data ->> 'next_step_detail'), ''), p_follow_up_date, 'meeting', m.id, auth.uid())
    returning id into v_fu;
  end if;
  return jsonb_build_object('meeting_id', p_meeting, 'next_meeting_id', v_new, 'follow_up_id', v_fu);
end $$;
grant execute on function public.save_meeting_outcome(uuid, jsonb, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------
create or replace function public.record_proposal_response(
  p_proposal uuid, p_outcome text, p_response_on date, p_notes text default null,
  p_review_meeting jsonb default null, p_follow_up_date date default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare pr proposals; v_mt uuid; v_fu uuid; v_status text;
begin
  select * into pr from proposals where id = p_proposal for update;
  if not found then raise exception 'Proposal not found'; end if;
  if pr.status not in ('sent', 'under_review', 'revision_requested') then
    raise exception 'A client response can only be recorded for a sent proposal';
  end if;
  if p_response_on is null then raise exception 'Response date is required'; end if;

  v_status := case p_outcome
    when 'accepted' then 'accepted'
    when 'rejected' then 'rejected'
    when 'needs_revision' then 'revision_requested'
    else 'under_review' end;

  update proposals set response_state = 'responded', response_outcome = p_outcome, response_on = p_response_on,
         response_notes = nullif(btrim(p_notes), ''), status = v_status,
         next_follow_up_date = coalesce(p_follow_up_date, next_follow_up_date)
   where id = p_proposal;

  if p_review_meeting is not null then
    insert into meetings (lead_id, contact_id, owner_id, status, scheduled_at, meeting_type, location, online_link,
                          confirmation_status, meeting_with, purpose, proposal_id, created_by)
    values (pr.lead_id, null, coalesce(pr.owner_id, auth.uid()), 'scheduled', (p_review_meeting ->> 'scheduled_at')::timestamptz,
            coalesce(p_review_meeting ->> 'meeting_type', 'physical'), p_review_meeting ->> 'location',
            p_review_meeting ->> 'online_link', coalesce(p_review_meeting ->> 'confirmation_status', 'unconfirmed'),
            p_review_meeting ->> 'meeting_with', coalesce(p_review_meeting ->> 'purpose', 'Proposal Review Meeting'),
            pr.id, auth.uid())
    returning id into v_mt;
  end if;
  if p_follow_up_date is not null then
    insert into follow_ups (lead_id, owner_id, title, notes, due_date, origin, proposal_id, created_by)
    values (pr.lead_id, coalesce(pr.owner_id, auth.uid()), 'Proposal follow-up', nullif(btrim(p_notes), ''),
            p_follow_up_date, 'proposal', pr.id, auth.uid())
    returning id into v_fu;
  end if;
  return jsonb_build_object('proposal_id', p_proposal, 'meeting_id', v_mt, 'follow_up_id', v_fu);
end $$;
grant execute on function public.record_proposal_response(uuid, text, date, text, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Complete a follow-up and optionally schedule the next one in one step
-- ---------------------------------------------------------------------------
create or replace function public.complete_follow_up(p_id uuid, p_next_date date default null, p_next_note text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare f follow_ups; v_new uuid;
begin
  select * into f from follow_ups where id = p_id for update;
  if not found then raise exception 'Follow-up not found'; end if;
  update follow_ups set status = 'completed', completed_at = now(), completed_by = auth.uid() where id = p_id and status = 'open';
  if p_next_date is not null then
    if p_next_date < public.cairo_today() then raise exception 'Next follow-up cannot be in the past'; end if;
    insert into follow_ups (lead_id, contact_id, owner_id, title, notes, due_date, origin, call_id, meeting_id, proposal_id, created_by)
    values (f.lead_id, f.contact_id, coalesce(f.owner_id, auth.uid()), 'Follow-up', nullif(btrim(p_next_note), ''),
            p_next_date, case when f.origin = 'google_sheet' then 'manual' else f.origin end, f.call_id, f.meeting_id, f.proposal_id, auth.uid())
    returning id into v_new;
  end if;
  return v_new;
end $$;
grant execute on function public.complete_follow_up(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile self-service
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text, p_phone text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not allowed' using errcode = '42501'; end if;
  update profiles set full_name = btrim(p_full_name), phone = nullif(btrim(p_phone), '') where id = auth.uid();
end $$;
grant execute on function public.update_my_profile(text, text) to authenticated;

create or replace function public.clear_must_change_password() returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = false where id = auth.uid();
end $$;
grant execute on function public.clear_must_change_password() to authenticated;

-- Used ONLY by the admin-users Edge Function (service role). Sets app.actor so the audit trail names the admin.
create or replace function public.svc_upsert_profile(
  p_actor uuid, p_user uuid, p_email text, p_full_name text, p_role text, p_active boolean,
  p_phone text default null, p_must_change boolean default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor::text, true);
  insert into profiles (id, email, full_name, phone, role, active, must_change_password, created_by)
  values (p_user, lower(p_email), coalesce(p_full_name, ''), p_phone, p_role, coalesce(p_active, true), coalesce(p_must_change, false), p_actor)
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(p_full_name, ''), profiles.full_name),
    phone = coalesce(p_phone, profiles.phone),
    role = excluded.role,
    active = excluded.active,
    must_change_password = coalesce(p_must_change, profiles.must_change_password);
end $$;
revoke all on function public.svc_upsert_profile(uuid, uuid, text, text, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_upsert_profile(uuid, uuid, text, text, text, boolean, text, boolean) to service_role;

create or replace function public.svc_audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, actor_email, entity, entity_id, action, meta)
  values (p_actor, (select email from profiles where id = p_actor), p_entity, p_entity_id, p_action, p_meta);
end $$;
revoke all on function public.svc_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_audit(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Management reporting (admin only). Everything is derived from timestamps / explicit events.
-- ---------------------------------------------------------------------------
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
     where p.role = 'bd_executive'
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

create or replace function public.system_status() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'server_time', now(), 'cairo_today', public.cairo_today(),
    'counts', jsonb_build_object(
      'leads', (select count(*) from leads), 'contacts', (select count(*) from contacts),
      'calls', (select count(*) from call_attempts), 'follow_ups', (select count(*) from follow_ups),
      'meetings', (select count(*) from meetings), 'proposals', (select count(*) from proposals),
      'forms', (select count(*) from commercial_forms), 'projects', (select count(*) from projects),
      'users_active', (select count(*) from profiles where active), 'users_total', (select count(*) from profiles),
      'audit_entries', (select count(*) from audit_logs)),
    'last_sync', (select to_jsonb(s) - 'summary' from sync_runs s where mode = 'sync' order by started_at desc limit 1));
end $$;
grant execute on function public.system_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Google Sheet import (called by the google-sheet-sync Edge Function with the service role).
-- Idempotent; never merges on weak evidence; never writes back to the Sheet.
-- ---------------------------------------------------------------------------
create or replace function public.sync_log_error(p_run uuid, p_row int, p_kind text, p_msg text, p_payload jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into sync_errors (run_id, row_number, kind, message, payload) values (p_run, p_row, p_kind, p_msg, p_payload)
$$;
revoke all on function public.sync_log_error(uuid, int, text, text, jsonb) from public, anon, authenticated;

create or replace function public.array_union(a text[], b text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by ord), '{}') from (
    select x, min(ord) ord from (
      select x, ord from unnest(coalesce(a, '{}')) with ordinality t(x, ord)
      union all
      select x, ord + 100000 from unnest(coalesce(b, '{}')) with ordinality t(x, ord)
    ) u group by x) v
$$;

create or replace function public.sync_apply_leads(p_run uuid, p_actor uuid, p_sheet text, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_row int; v_company text; v_norm text; v_ext text; v_lead uuid; v_found_by text;
  v_n_ins int := 0; v_n_upd int := 0; v_n_skip int := 0; v_n_conf int := 0; v_n_rej int := 0;
  v_cands uuid[]; v_changed boolean; v_created boolean;
  v_emails text[]; v_phones text[]; v_links text[];
  v_temp text; v_stage text; v_legacy jsonb; v_old_legacy jsonb; v_name text;
  c jsonb; v_key text; v_ct contacts; v_new_emails text[]; v_new_phones text[]; v_new_links text[];
  v_fu date; v_fu_ins int; v_contacts_ins int := 0;
begin
  perform set_config('app.skip_audit', '1', true);
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r ->> 'row_number')::int;
    v_company := btrim(coalesce(r ->> 'company', ''));
    v_ext := nullif(btrim(coalesce(r ->> 'external_lead_id', '')), '');
    v_norm := public.norm_name(v_company);
    v_created := false; v_changed := false; v_lead := null; v_found_by := null;
    v_emails := coalesce(array(select jsonb_array_elements_text(r -> 'emails')), '{}');
    v_phones := coalesce(array(select jsonb_array_elements_text(r -> 'phones')), '{}');
    v_links  := coalesce(array(select jsonb_array_elements_text(r -> 'linkedin')), '{}');

    if v_company = '' then
      v_n_rej := v_n_rej + 1;
      perform sync_log_error(p_run, v_row, 'rejected', 'Missing company name', r);
      continue;
    end if;

    -- 1) external Lead ID
    if v_ext is not null then
      select id into v_lead from leads where external_lead_id = v_ext;
      if found then
        v_found_by := 'lead_id';
        -- a Lead ID that points at a manually-created lead with a DIFFERENT company name is a collision, not a match
        if exists (select 1 from leads where id = v_lead and source <> 'google_sheet' and name_norm <> v_norm) then
          v_n_conf := v_n_conf + 1;
          perform sync_log_error(p_run, v_row, 'conflict', 'Lead ID ' || v_ext || ' already belongs to a different, manually created company; not merged', r);
          continue;
        end if;
      end if;
    end if;

    -- 2/3) strong Company + Email / Company + Phone (no Lead ID match)
    if v_lead is null then
      select array_agg(distinct l.id) into v_cands
        from leads l
       where l.name_norm = v_norm
         and (l.external_lead_id is null or v_ext is null or l.external_lead_id = v_ext)
         and exists (select 1 from contacts c2 where c2.lead_id = l.id
                      and (c2.emails && v_emails or c2.phones && v_phones));
      if coalesce(array_length(v_cands, 1), 0) = 1 then
        v_lead := v_cands[1]; v_found_by := 'company+contact';
      elsif coalesce(array_length(v_cands, 1), 0) > 1 then
        v_n_conf := v_n_conf + 1;
        perform sync_log_error(p_run, v_row, 'conflict', 'Several leads match this company + email/phone; not merged', r);
        continue;
      end if;
    end if;

    -- weak name-only evidence: only safe when it cannot be a different organisation
    if v_lead is null then
      select array_agg(l.id) into v_cands from leads l where l.name_norm = v_norm;
      if coalesce(array_length(v_cands, 1), 0) > 0 then
        if v_ext is null and array_length(v_cands, 1) = 1
           and (select source = 'google_sheet' and external_lead_id is null and not exists (select 1 from contacts c3 where c3.lead_id = leads.id and (cardinality(c3.emails) > 0 or cardinality(c3.phones) > 0))
                  from leads where id = v_cands[1])
           and cardinality(v_emails) = 0 and cardinality(v_phones) = 0 then
          v_lead := v_cands[1]; v_found_by := 'name-only(no identifiers)';
        else
          v_n_conf := v_n_conf + 1;
          perform sync_log_error(p_run, v_row, 'conflict',
            'Company name already exists but no Lead ID / email / phone confirms it is the same organisation; not merged', r);
          continue;
        end if;
      end if;
    end if;

    -- legacy values (kept for traceability; CRM-owned fields are not overwritten after first import)
    v_legacy := jsonb_strip_nulls(jsonb_build_object(
      'status', nullif(r ->> 'status', ''), 'next_step', nullif(r ->> 'next_step', ''),
      'notes', nullif(r ->> 'notes', ''), 'last_activity', nullif(r ->> 'last_activity', ''),
      'follow_up_date', nullif(r ->> 'follow_up_date', ''),
      'email_sent', r -> 'email_sent', 'contacted', r -> 'contacted', 'called', r -> 'called',
      'extra_notes', r -> 'extra_notes'));

    v_temp := case lower(coalesce(r ->> 'status', ''))
      when 'cold' then 'cold' when 'warm' then 'warm' when 'hot' then 'hot'
      when 'lost' then 'lost' when 'closed' then 'closed' else 'cold' end;
    v_stage := case when coalesce((r ->> 'email_sent')::boolean, false) or coalesce((r ->> 'contacted')::boolean, false)
                      or coalesce((r ->> 'called')::boolean, false) then 'outreach' else 'research' end;

    if v_lead is null then
      if not p_dry_run then
        insert into leads (name, external_lead_id, temperature, pipeline_stage, source, source_sheet, source_row, legacy, created_by)
        values (v_company, v_ext, v_temp, v_stage, 'google_sheet', p_sheet, v_row, v_legacy, p_actor)
        returning id into v_lead;
      end if;
      v_created := true;
    else
      select legacy, name into v_old_legacy, v_name from leads where id = v_lead;
      if v_old_legacy is distinct from v_legacy and not p_dry_run then
        update leads set legacy = v_legacy, source_row = v_row where id = v_lead;
        v_changed := true;
      elsif v_old_legacy is distinct from v_legacy then
        v_changed := true;
      end if;
    end if;

    -- contacts -----------------------------------------------------------------
    if not p_dry_run then
      -- general (company-level) contact carries every email / phone / LinkedIn URL from the row
      if cardinality(v_emails) + cardinality(v_phones) + cardinality(v_links) > 0 then
        select * into v_ct from contacts where lead_id = v_lead and dedupe_key = 'general';
        if not found then
          insert into contacts (lead_id, full_name, emails, phones, linkedin, dedupe_key, source)
          values (v_lead, '', v_emails, v_phones, v_links, 'general', 'google_sheet');
          v_contacts_ins := v_contacts_ins + 1; v_changed := true;
        else
          v_new_emails := public.array_union(v_ct.emails, v_emails);
          v_new_phones := public.array_union(v_ct.phones, v_phones);
          v_new_links := public.array_union(v_ct.linkedin, v_links);
          if v_new_emails <> v_ct.emails or v_new_phones <> v_ct.phones or v_new_links <> v_ct.linkedin then
            update contacts set emails = v_new_emails, phones = v_new_phones, linkedin = v_new_links where id = v_ct.id;
            v_changed := true;
          end if;
        end if;
      end if;
      -- named people
      for c in select value from jsonb_array_elements(coalesce(r -> 'contacts', '[]'::jsonb)) loop
        if btrim(coalesce(c ->> 'name', '')) = '' then continue; end if;
        v_key := 'n:' || public.norm_name(c ->> 'name');
        select * into v_ct from contacts where lead_id = v_lead and dedupe_key = v_key;
        if not found then
          insert into contacts (lead_id, full_name, job_title, dedupe_key, source, is_primary)
          values (v_lead, btrim(c ->> 'name'), nullif(btrim(coalesce(c ->> 'title', '')), ''), v_key, 'google_sheet',
                  not exists (select 1 from contacts where lead_id = v_lead and is_primary));
          v_contacts_ins := v_contacts_ins + 1; v_changed := true;
        elsif coalesce(v_ct.job_title, '') is distinct from coalesce(nullif(btrim(coalesce(c ->> 'title', '')), ''), v_ct.job_title, '') then
          update contacts set job_title = nullif(btrim(coalesce(c ->> 'title', '')), '') where id = v_ct.id;
          v_changed := true;
        end if;
      end loop;

      -- follow-up from the sheet date (never duplicated; never resurrects a completed one)
      v_fu := nullif(r ->> 'follow_up_date', '')::date;
      if v_fu is not null then
        insert into follow_ups (lead_id, owner_id, title, notes, due_date, origin, created_by)
        values (v_lead, (select owner_id from leads where id = v_lead), 'Follow-up (imported)',
                nullif(concat_ws(' · ', nullif(r ->> 'next_step', ''), nullif(r ->> 'notes', '')), ''), v_fu, 'google_sheet', p_actor)
        on conflict (lead_id, due_date) where origin = 'google_sheet' do nothing;
        get diagnostics v_fu_ins = row_count;
        if v_fu_ins > 0 then v_changed := true; end if;
      end if;
    end if;

    if v_created then v_n_ins := v_n_ins + 1;
    elsif v_changed then v_n_upd := v_n_upd + 1;
    else v_n_skip := v_n_skip + 1; end if;
  end loop;

  return jsonb_build_object('inserted', v_n_ins, 'updated', v_n_upd, 'skipped', v_n_skip,
                            'conflicts', v_n_conf, 'rejected', v_n_rej, 'contacts_inserted', v_contacts_ins);
end $$;
revoke all on function public.sync_apply_leads(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sync_apply_leads(uuid, uuid, text, jsonb, boolean) to service_role;

create or replace function public.sync_apply_projects(p_run uuid, p_actor uuid, p_sheet text, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_row int; v_dev text; v_prj text; v_dn text; v_pn text; v_id uuid; v_attrs jsonb;
  v_ins int := 0; v_upd int := 0; v_skip int := 0; v_rej int := 0; v_old jsonb; v_exists boolean;
begin
  perform set_config('app.skip_audit', '1', true);
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r ->> 'row_number')::int;
    v_dev := btrim(coalesce(r ->> 'developer', '')); v_prj := btrim(coalesce(r ->> 'project', ''));
    if v_dev = '' or v_prj = '' then
      v_rej := v_rej + 1;
      perform sync_log_error(p_run, v_row, 'rejected', 'Developer and Project are both required', r);
      continue;
    end if;
    v_dn := public.norm_name(v_dev); v_pn := public.norm_name(v_prj);
    v_attrs := coalesce(r -> 'attributes', '{}'::jsonb);
    select id, attributes into v_id, v_old from projects where developer_norm = v_dn and project_norm = v_pn;
    v_exists := found;
    if not v_exists then
      if not p_dry_run then
        insert into projects (developer_name, developer_norm, project_name, project_norm, attributes, source_sheet, source_row)
        values (v_dev, v_dn, v_prj, v_pn, v_attrs, p_sheet, v_row);
      end if;
      v_ins := v_ins + 1;
    elsif v_old is distinct from v_attrs then
      if not p_dry_run then update projects set attributes = v_attrs, source_row = v_row where id = v_id; end if;
      v_upd := v_upd + 1;
    else
      v_skip := v_skip + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'conflicts', 0, 'rejected', v_rej);
end $$;
revoke all on function public.sync_apply_projects(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sync_apply_projects(uuid, uuid, text, jsonb, boolean) to service_role;

-- Service-only helpers used by Edge Functions (act on behalf of a verified admin)
create or replace function public.svc_set_target(p_actor uuid, p_user uuid, p_target int, p_from date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_from date := coalesce(p_from, public.cairo_today()); v_id uuid;
begin
  perform set_config('app.actor', p_actor::text, true);
  update user_targets set active = false where user_id = p_user and active and effective_from >= v_from;
  update user_targets set effective_to = v_from - 1
   where user_id = p_user and active and effective_from < v_from and (effective_to is null or effective_to >= v_from);
  insert into user_targets (user_id, daily_call_target, effective_from, created_by)
  values (p_user, p_target, v_from, p_actor) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.svc_set_target(uuid, uuid, int, date) from public, anon, authenticated;
grant execute on function public.svc_set_target(uuid, uuid, int, date) to service_role;
grant execute on function public.sync_log_error(uuid, int, text, text, jsonb) to service_role;
