-- Rollups, timeline activities and audit triggers

-- ---------------------------------------------------------------------------
-- Rollup maintenance
-- ---------------------------------------------------------------------------
create or replace function public.refresh_lead_rollup(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_search text;
  v_contacts int;
  v_primary text;
  v_calls int;
  v_resp int;
  v_last_call timestamptz;
  v_last_out text;
  v_open int;
  v_next_fu date;
  v_next_mt timestamptz;
  v_next_conf text;
  v_mt_total int;
  v_mt_att int;
  v_mt_out text;
  v_form text;
  v_prop text;
  v_prop_resp text;
  v_neg boolean;
  v_last_act timestamptz;
begin
  if not exists (select 1 from leads where id = p_lead) then
    return;
  end if;

  select lower(concat_ws(' ', l.name, l.external_lead_id,
           (select string_agg(concat_ws(' ', c.full_name, c.job_title,
                    array_to_string(c.emails, ' '), array_to_string(c.phones, ' ')), ' ')
              from contacts c where c.lead_id = l.id)))
    into v_search from leads l where l.id = p_lead;

  select count(*) into v_contacts from contacts where lead_id = p_lead;
  select coalesce(nullif(c.full_name, ''), c.emails[1], c.phones[1]) into v_primary
    from contacts c where c.lead_id = p_lead
    order by c.is_primary desc, (c.full_name <> '') desc, c.created_at limit 1;

  select count(*), count(*) filter (where o.kind = 'responded')
    into v_calls, v_resp
    from call_attempts a join call_outcomes o on o.key = a.outcome where a.lead_id = p_lead;
  select a.called_at, a.outcome into v_last_call, v_last_out
    from call_attempts a where a.lead_id = p_lead order by a.called_at desc, a.created_at desc limit 1;

  select count(*), min(due_date) into v_open, v_next_fu
    from follow_ups where lead_id = p_lead and status = 'open';

  select scheduled_at, confirmation_status into v_next_mt, v_next_conf
    from meetings where lead_id = p_lead and status = 'scheduled' and scheduled_at >= now()
    order by scheduled_at limit 1;

  select count(*) filter (where status <> 'requested'), count(*) filter (where attendance_status = 'attended')
    into v_mt_total, v_mt_att from meetings where lead_id = p_lead;
  select meeting_outcome into v_mt_out from meetings
    where lead_id = p_lead and attendance_status = 'attended' and meeting_outcome is not null
    order by scheduled_at desc limit 1;

  select status into v_form from commercial_forms where lead_id = p_lead order by created_at desc limit 1;
  select status, coalesce(response_outcome, response_state) into v_prop, v_prop_resp
    from proposals where lead_id = p_lead order by created_at desc limit 1;

  select exists (select 1 from proposals where lead_id = p_lead and response_outcome = 'negotiation')
      or exists (select 1 from meetings where lead_id = p_lead and (meeting_outcome = 'negotiation' or next_step = 'commercial_negotiation'))
    into v_neg;

  select max(occurred_at) into v_last_act from activities where lead_id = p_lead;

  insert into lead_rollups as r (lead_id, search_text, contacts_count, primary_contact, total_calls, responded_calls,
      last_call_at, last_call_outcome, open_follow_ups, next_follow_up_date, next_meeting_at, next_meeting_confirmation,
      meetings_total, meetings_attended, last_meeting_outcome, form_status, proposal_status, proposal_response,
      negotiation_recorded, last_activity_at, updated_at)
  values (p_lead, v_search, v_contacts, v_primary, v_calls, v_resp, v_last_call, v_last_out, v_open, v_next_fu,
      v_next_mt, v_next_conf, v_mt_total, v_mt_att, v_mt_out, v_form, v_prop, v_prop_resp, v_neg, v_last_act, now())
  on conflict (lead_id) do update set
      search_text = excluded.search_text, contacts_count = excluded.contacts_count,
      primary_contact = excluded.primary_contact, total_calls = excluded.total_calls,
      responded_calls = excluded.responded_calls, last_call_at = excluded.last_call_at,
      last_call_outcome = excluded.last_call_outcome, open_follow_ups = excluded.open_follow_ups,
      next_follow_up_date = excluded.next_follow_up_date, next_meeting_at = excluded.next_meeting_at,
      next_meeting_confirmation = excluded.next_meeting_confirmation, meetings_total = excluded.meetings_total,
      meetings_attended = excluded.meetings_attended, last_meeting_outcome = excluded.last_meeting_outcome,
      form_status = excluded.form_status, proposal_status = excluded.proposal_status,
      proposal_response = excluded.proposal_response, negotiation_recorded = excluded.negotiation_recorded,
      last_activity_at = excluded.last_activity_at, updated_at = now();
end $$;
revoke all on function public.refresh_lead_rollup(uuid) from public, anon, authenticated;

create or replace function public.trg_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then v_new := (to_jsonb(new) ->> (case tg_table_name when 'leads' then 'id' else 'lead_id' end))::uuid; end if;
  if tg_op in ('DELETE', 'UPDATE') then v_old := (to_jsonb(old) ->> (case tg_table_name when 'leads' then 'id' else 'lead_id' end))::uuid; end if;
  if v_new is not null then perform public.refresh_lead_rollup(v_new); end if;
  if v_old is not null and v_old is distinct from v_new then perform public.refresh_lead_rollup(v_old); end if;
  return null;
end $$;

create trigger rollup_leads after insert or update of name, external_lead_id on public.leads
  for each row execute function public.trg_rollup();
create trigger rollup_contacts after insert or update or delete on public.contacts
  for each row execute function public.trg_rollup();
create trigger rollup_calls after insert or update or delete on public.call_attempts
  for each row execute function public.trg_rollup();
create trigger rollup_follow_ups after insert or update or delete on public.follow_ups
  for each row execute function public.trg_rollup();
create trigger rollup_meetings after insert or update or delete on public.meetings
  for each row execute function public.trg_rollup();
create trigger rollup_forms after insert or update or delete on public.commercial_forms
  for each row execute function public.trg_rollup();
create trigger rollup_proposals after insert or update or delete on public.proposals
  for each row execute function public.trg_rollup();

-- ---------------------------------------------------------------------------
-- Timeline activities (only verified, user-recorded business events)
-- ---------------------------------------------------------------------------
create or replace function public.log_activity(
  p_lead uuid, p_actor uuid, p_type text, p_summary text,
  p_ref_table text, p_ref_id uuid, p_data jsonb default '{}'::jsonb, p_at timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into activities (lead_id, actor_id, type, occurred_at, summary, ref_table, ref_id, data)
  values (p_lead, p_actor, p_type, coalesce(p_at, now()), p_summary, p_ref_table, p_ref_id, coalesce(p_data, '{}'::jsonb));
  update lead_rollups set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'), coalesce(p_at, now()))
   where lead_id = p_lead;
end $$;
revoke all on function public.log_activity(uuid, uuid, text, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;

create or replace function public.actor_id() returns uuid
language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor', true), '')::uuid)
$$;

create or replace function public.trg_activity_leads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.id, coalesce(actor_id(), new.created_by), 'lead_created',
      case when new.source = 'google_sheet' then 'Lead imported from Accord New Data' else 'Lead created' end,
      'leads', new.id, jsonb_build_object('source', new.source));
  else
    if new.pipeline_stage is distinct from old.pipeline_stage then
      perform log_activity(new.id, actor_id(), 'pipeline_change',
        'Pipeline: ' || old.pipeline_stage || ' → ' || new.pipeline_stage,
        'leads', new.id, jsonb_build_object('from', old.pipeline_stage, 'to', new.pipeline_stage));
    end if;
    if new.temperature is distinct from old.temperature then
      perform log_activity(new.id, actor_id(), 'temperature_change',
        'Temperature: ' || old.temperature || ' → ' || new.temperature,
        'leads', new.id, jsonb_build_object('from', old.temperature, 'to', new.temperature));
    end if;
  end if;
  return null;
end $$;
create trigger activity_leads after insert or update of pipeline_stage, temperature on public.leads
  for each row execute function public.trg_activity_leads();

create or replace function public.trg_activity_calls() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text; v_kind text;
begin
  select label, kind into v_label, v_kind from call_outcomes where key = new.outcome;
  perform log_activity(new.lead_id, new.user_id, 'call',
    v_label || coalesce(' — ' || nullif(btrim(new.notes), ''), ''),
    'call_attempts', new.id,
    jsonb_build_object('outcome', new.outcome, 'kind', v_kind, 'sub_outcome', new.sub_outcome), new.called_at);
  return null;
end $$;
create trigger activity_calls after insert on public.call_attempts
  for each row execute function public.trg_activity_calls();

create or replace function public.trg_activity_follow_ups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.lead_id, coalesce(actor_id(), new.created_by), 'follow_up_created',
      'Follow-up due ' || new.due_date || coalesce(' — ' || nullif(btrim(new.notes), ''), ''),
      'follow_ups', new.id, jsonb_build_object('due_date', new.due_date, 'origin', new.origin));
  else
    if old.status <> 'completed' and new.status = 'completed' then
      perform log_activity(new.lead_id, coalesce(actor_id(), new.completed_by), 'follow_up_completed',
        'Follow-up completed (was due ' || new.due_date || ')', 'follow_ups', new.id,
        jsonb_build_object('due_date', new.due_date));
    elsif new.due_date is distinct from old.due_date and new.status = 'open' then
      perform log_activity(new.lead_id, actor_id(), 'follow_up_rescheduled',
        'Follow-up moved ' || old.due_date || ' → ' || new.due_date, 'follow_ups', new.id,
        jsonb_build_object('from', old.due_date, 'to', new.due_date));
    end if;
  end if;
  return null;
end $$;
create trigger activity_follow_ups after insert or update on public.follow_ups
  for each row execute function public.trg_activity_follow_ups();

create or replace function public.trg_activity_meetings() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_who uuid := coalesce(actor_id(), new.created_by);
begin
  if tg_op = 'INSERT' then
    if new.status = 'requested' then
      perform log_activity(new.lead_id, v_who, 'meeting_requested', 'Meeting requested', 'meetings', new.id, '{}');
    else
      perform log_activity(new.lead_id, v_who, 'meeting_scheduled',
        'Meeting scheduled for ' || to_char(new.scheduled_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI')
          || ' (' || new.confirmation_status || ')',
        'meetings', new.id,
        jsonb_build_object('scheduled_at', new.scheduled_at, 'type', new.meeting_type,
          'rescheduled_from', new.rescheduled_from_id, 'follows', new.follows_meeting_id));
    end if;
    return null;
  end if;

  if old.status = 'requested' and new.status = 'scheduled' then
    perform log_activity(new.lead_id, v_who, 'meeting_scheduled',
      'Meeting scheduled for ' || to_char(new.scheduled_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'),
      'meetings', new.id, jsonb_build_object('scheduled_at', new.scheduled_at));
  end if;
  if new.confirmation_status is distinct from old.confirmation_status and new.confirmation_status = 'confirmed' then
    perform log_activity(new.lead_id, v_who, 'meeting_confirmed', 'Meeting confirmed', 'meetings', new.id, '{}');
  end if;
  if new.attendance_status is distinct from old.attendance_status then
    if new.attendance_status = 'attended' then
      perform log_activity(new.lead_id, v_who, 'meeting_attended', 'Meeting attended', 'meetings', new.id, '{}');
    elsif new.attendance_status = 'not_attended' then
      perform log_activity(new.lead_id, v_who, 'meeting_not_attended',
        'Meeting not attended — ' || coalesce(new.not_attended_reason, 'no reason'),
        'meetings', new.id, jsonb_build_object('reason', new.not_attended_reason));
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'rescheduled' then
      perform log_activity(new.lead_id, v_who, 'meeting_rescheduled', 'Meeting rescheduled', 'meetings', new.id,
        jsonb_build_object('replacement', new.next_meeting_id));
    elsif new.status = 'cancelled' then
      perform log_activity(new.lead_id, v_who, 'meeting_cancelled', 'Meeting cancelled', 'meetings', new.id, '{}');
    end if;
  end if;
  if coalesce(btrim(new.minutes_of_meeting), '') <> '' and coalesce(btrim(old.minutes_of_meeting), '') = '' then
    perform log_activity(new.lead_id, v_who, 'minutes_added', 'Minutes of meeting recorded', 'meetings', new.id,
      jsonb_build_object('outcome', new.meeting_outcome, 'next_step', new.next_step));
  end if;
  return null;
end $$;
create trigger activity_meetings after insert or update on public.meetings
  for each row execute function public.trg_activity_meetings();

create or replace function public.trg_activity_forms() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_who uuid := coalesce(actor_id(), new.created_by);
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.lead_id, v_who, case new.status when 'sent' then 'form_sent' when 'completed' then 'form_completed' else 'form_required' end,
      'Information form — ' || new.status, 'commercial_forms', new.id, jsonb_build_object('status', new.status));
  elsif new.status is distinct from old.status then
    perform log_activity(new.lead_id, v_who,
      case new.status when 'sent' then 'form_sent' when 'completed' then 'form_completed' else 'form_updated' end,
      'Information form — ' || old.status || ' → ' || new.status, 'commercial_forms', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end $$;
create trigger activity_forms after insert or update on public.commercial_forms
  for each row execute function public.trg_activity_forms();

create or replace function public.trg_activity_proposals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_who uuid := coalesce(actor_id(), new.created_by);
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.lead_id, v_who, 'proposal_prepared',
      'Proposal PR-' || lpad(new.proposal_no::text, 5, '0') || ' — ' || new.status, 'proposals', new.id,
      jsonb_build_object('status', new.status));
    return null;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'sent' then
      perform log_activity(new.lead_id, v_who, 'proposal_sent', 'Proposal sent', 'proposals', new.id,
        jsonb_build_object('sent_on', new.sent_on));
    else
      perform log_activity(new.lead_id, v_who, 'proposal_status_changed',
        'Proposal status: ' || old.status || ' → ' || new.status, 'proposals', new.id,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  if new.response_outcome is distinct from old.response_outcome and new.response_outcome is not null then
    perform log_activity(new.lead_id, v_who, 'proposal_response', 'Client response: ' || new.response_outcome,
      'proposals', new.id, jsonb_build_object('outcome', new.response_outcome, 'response_on', new.response_on));
    if new.response_outcome = 'negotiation' then
      perform log_activity(new.lead_id, v_who, 'negotiation', 'Negotiation recorded', 'proposals', new.id, '{}');
    end if;
  end if;
  return null;
end $$;
create trigger activity_proposals after insert or update on public.proposals
  for each row execute function public.trg_activity_proposals();

-- ---------------------------------------------------------------------------
-- Generic audit trigger
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text;
  od jsonb := '{}'::jsonb; nd jsonb := '{}'::jsonb;
  v_actor uuid; v_email text; v_action text; v_id text;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = '1' then
    return null;
  end if;
  v_actor := actor_id();
  select email into v_email from profiles where id = v_actor;

  if tg_op = 'INSERT' then
    n := to_jsonb(new); v_id := coalesce(n ->> 'id', n ->> 'key'); v_action := 'create'; nd := n;
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old); v_id := coalesce(o ->> 'id', o ->> 'key'); v_action := 'delete'; od := o;
  else
    o := to_jsonb(old); n := to_jsonb(new); v_id := coalesce(n ->> 'id', n ->> 'key'); v_action := 'update';
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (n -> k) is distinct from (o -> k) then
        od := od || jsonb_build_object(k, o -> k);
        nd := nd || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if nd = '{}'::jsonb then return null; end if;
    -- semantic action names for the events the business cares about
    if tg_table_name = 'profiles' and nd ? 'role' then v_action := 'role_changed';
    elsif tg_table_name = 'profiles' and nd ? 'active' then v_action := case when (nd ->> 'active')::boolean then 'user_activated' else 'user_deactivated' end;
    elsif tg_table_name = 'leads' and nd ? 'pipeline_stage' then v_action := 'pipeline_changed';
    elsif tg_table_name = 'leads' and nd ? 'temperature' then v_action := 'temperature_changed';
    elsif tg_table_name = 'meetings' and nd ? 'confirmation_status' then v_action := 'meeting_confirmation';
    elsif tg_table_name = 'meetings' and nd ? 'attendance_status' then v_action := 'meeting_attendance';
    elsif tg_table_name = 'meetings' and nd ? 'minutes_of_meeting' then v_action := 'minutes_edited';
    elsif tg_table_name = 'meetings' and (nd ? 'scheduled_at' or nd ? 'status') then v_action := 'meeting_changed';
    elsif tg_table_name = 'commercial_forms' and nd ? 'status' then v_action := 'form_status_changed';
    elsif tg_table_name = 'proposals' and nd ? 'response_outcome' then v_action := 'proposal_response';
    elsif tg_table_name = 'proposals' and (nd ->> 'status') = 'sent' then v_action := 'proposal_sent';
    elsif tg_table_name = 'proposals' and nd ? 'status' then v_action := 'proposal_status_changed';
    elsif tg_table_name = 'call_attempts' then v_action := 'call_edited';
    end if;
  end if;

  if tg_table_name = 'call_attempts' and tg_op = 'DELETE' then v_action := 'call_deleted'; end if;
  if tg_table_name = 'profiles' and tg_op = 'INSERT' then v_action := 'user_created'; end if;
  if tg_table_name = 'user_targets' then v_action := case tg_op when 'INSERT' then 'target_set' when 'DELETE' then 'target_deleted' else 'target_changed' end; end if;
  if tg_table_name = 'settings' then v_action := 'setting_changed'; end if;

  insert into audit_logs (actor_id, actor_email, entity, entity_id, action, old_value, new_value)
  values (v_actor, v_email, tg_table_name, v_id, v_action,
          case when tg_op = 'INSERT' then null else od end,
          case when tg_op = 'DELETE' then null else nd end);
  return null;
end $$;

-- everything except high-volume call inserts is audited (call edits/deletes are)
create trigger audit_leads after insert or update or delete on public.leads for each row execute function public.audit_row();
create trigger audit_contacts after insert or update or delete on public.contacts for each row execute function public.audit_row();
create trigger audit_calls after update or delete on public.call_attempts for each row execute function public.audit_row();
create trigger audit_follow_ups after insert or update or delete on public.follow_ups for each row execute function public.audit_row();
create trigger audit_meetings after insert or update or delete on public.meetings for each row execute function public.audit_row();
create trigger audit_forms after insert or update or delete on public.commercial_forms for each row execute function public.audit_row();
create trigger audit_proposals after insert or update or delete on public.proposals for each row execute function public.audit_row();
create trigger audit_targets after insert or update or delete on public.user_targets for each row execute function public.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.audit_row();
create trigger audit_settings after insert or update or delete on public.settings for each row execute function public.audit_row();
create trigger audit_pipeline_stages after insert or update or delete on public.pipeline_stages for each row execute function public.audit_row();
create trigger audit_call_outcomes after insert or update or delete on public.call_outcomes for each row execute function public.audit_row();
create trigger audit_projects after update or delete on public.projects for each row execute function public.audit_row();
create trigger audit_attachments after insert or delete on public.attachments for each row execute function public.audit_row();
