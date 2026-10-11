-- Row Level Security. Default deny. Anonymous has NO table access at all.
-- Access model:
--   admin        : full management
--   bd_executive : reads the shared lead pool; writes own calls / follow-ups / meetings / forms / proposals;
--                  may edit leads they own or unassigned leads
--   viewer       : read-only
--   inactive / no profile / anon : nothing

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'pipeline_stages','call_outcomes','activity_types','settings','profiles','leads','contacts',
    'call_sessions','call_attempts','user_targets','follow_ups','meetings','commercial_forms',
    'proposals','attachments','projects','activities','sync_runs','sync_errors','audit_logs','lead_rollups']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- authenticated: table privileges are granted narrowly; RLS then filters rows
grant select on public.pipeline_stages, public.call_outcomes, public.activity_types, public.settings,
  public.profiles, public.leads, public.contacts, public.call_sessions, public.call_attempts, public.user_targets,
  public.follow_ups, public.meetings, public.commercial_forms, public.proposals, public.attachments,
  public.projects, public.activities, public.lead_rollups to authenticated;
grant select on public.sync_runs, public.sync_errors, public.audit_logs to authenticated;
grant insert, update, delete on public.pipeline_stages, public.call_outcomes, public.settings,
  public.profiles, public.leads, public.contacts, public.call_sessions, public.call_attempts, public.user_targets,
  public.follow_ups, public.meetings, public.commercial_forms, public.proposals, public.attachments,
  public.projects to authenticated;
grant usage on sequence public.proposal_seq to authenticated;

-- reference / config ---------------------------------------------------------
create policy ref_read on public.pipeline_stages for select to authenticated using (public.is_member());
create policy ref_write on public.pipeline_stages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ref_read on public.call_outcomes for select to authenticated using (public.is_member());
create policy ref_write on public.call_outcomes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ref_read on public.activity_types for select to authenticated using (public.is_member());
create policy ref_read on public.settings for select to authenticated using (public.is_member());
create policy ref_write on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: members see colleagues; only admins (or the service role via Edge Function) write
create policy profiles_read on public.profiles for select to authenticated using (public.is_member() or id = auth.uid());
create policy profiles_admin_write on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- leads ----------------------------------------------------------------------
create policy leads_read on public.leads for select to authenticated using (public.is_member());
create policy leads_insert on public.leads for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid() and (owner_id is null or owner_id = auth.uid() or public.is_admin()));
create policy leads_update on public.leads for update to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id is null or owner_id = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and (owner_id is null or owner_id = auth.uid())));
create policy leads_delete on public.leads for delete to authenticated using (public.is_admin());

create policy rollups_read on public.lead_rollups for select to authenticated using (public.is_member());

-- contacts: writable by whoever can write the lead
create policy contacts_read on public.contacts for select to authenticated using (public.is_member());
create policy contacts_write on public.contacts for all to authenticated
  using (public.is_admin() or (public.is_staff() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id is null or l.owner_id = auth.uid()))))
  with check (public.is_admin() or (public.is_staff() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id is null or l.owner_id = auth.uid()))));

-- calls: anyone active reads lead history; users log calls as themselves; edit/delete own same-day only
create policy calls_read on public.call_attempts for select to authenticated using (public.is_member());
create policy calls_insert on public.call_attempts for insert to authenticated
  with check (public.is_staff() and (user_id = auth.uid() or public.is_admin()));
create policy calls_update on public.call_attempts for update to authenticated
  using (public.is_admin() or (public.is_staff() and user_id = auth.uid() and public.cairo_date(called_at) = public.cairo_today()))
  with check (public.is_admin() or (public.is_staff() and user_id = auth.uid() and public.cairo_date(called_at) = public.cairo_today()));
create policy calls_delete on public.call_attempts for delete to authenticated
  using (public.is_admin() or (public.is_staff() and user_id = auth.uid() and public.cairo_date(called_at) = public.cairo_today()));

create policy sessions_read on public.call_sessions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy sessions_write on public.call_sessions for all to authenticated
  using (public.is_staff() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_staff() and (user_id = auth.uid() or public.is_admin()));

-- targets: admin manages; users read their own
create policy targets_read on public.user_targets for select to authenticated using (public.is_admin() or (public.is_member() and user_id = auth.uid()));
create policy targets_write on public.user_targets for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- follow-ups / meetings / forms / proposals: staff create; owner (or creator) or admin edits
create policy fu_read on public.follow_ups for select to authenticated using (public.is_member());
create policy fu_insert on public.follow_ups for insert to authenticated
  with check (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
create policy fu_update on public.follow_ups for update to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())));
create policy fu_delete on public.follow_ups for delete to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())));

create policy mt_read on public.meetings for select to authenticated using (public.is_member());
create policy mt_insert on public.meetings for insert to authenticated
  with check (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
create policy mt_update on public.meetings for update to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())));
create policy mt_delete on public.meetings for delete to authenticated using (public.is_admin());

create policy form_read on public.commercial_forms for select to authenticated using (public.is_member());
create policy form_insert on public.commercial_forms for insert to authenticated
  with check (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
create policy form_update on public.commercial_forms for update to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())));
create policy form_delete on public.commercial_forms for delete to authenticated using (public.is_admin());

create policy prop_read on public.proposals for select to authenticated using (public.is_member());
create policy prop_insert on public.proposals for insert to authenticated
  with check (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
create policy prop_update on public.proposals for update to authenticated
  using (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and (owner_id = auth.uid() or created_by = auth.uid())));
create policy prop_delete on public.proposals for delete to authenticated using (public.is_admin());

create policy att_read on public.attachments for select to authenticated using (public.is_member());
create policy att_insert on public.attachments for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid());
create policy att_delete on public.attachments for delete to authenticated
  using (public.is_admin() or (public.is_staff() and uploaded_by = auth.uid()));
create policy att_update on public.attachments for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy projects_read on public.projects for select to authenticated using (public.is_member());
create policy projects_write on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- timeline: read-only for users (rows are written by SECURITY DEFINER triggers)
create policy activities_read on public.activities for select to authenticated using (public.is_member());

-- admin-only operational tables
create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_admin());
create policy sync_errors_read on public.sync_errors for select to authenticated using (public.is_admin());
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());

-- views run with the caller's rights
-- (defined in the functions migration with security_invoker = true)
