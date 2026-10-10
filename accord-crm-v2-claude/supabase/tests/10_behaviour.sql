-- Behavioural + security tests. Run via scripts/test-sql.sh (fresh local DB).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\o /dev/null

create schema t;
create table t.results (label text, ok boolean, detail text);
grant usage on schema t to public;
grant all on t.results to public;
create function t.login(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); execute 'set role authenticated'; end $$;
create function t.anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon'; end $$;
create function t.root() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;
create function t.svc() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role service_role'; end $$;
create function t.check(label text, cond boolean, detail text default '') returns void language plpgsql as $$
begin insert into t.results values (label, coalesce(cond, false), detail); end $$;
create function t.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin insert into t.results values (label, actual is not distinct from expected, 'actual=' || coalesce(actual::text, 'null') || ' expected=' || coalesce(expected::text, 'null')); end $$;
-- expects the statement to fail (permission / RLS / constraint)
create function t.denied(label text, stmt text) returns void language plpgsql as $$
declare ok boolean := false; msg text;
begin
  begin execute stmt; exception when others then ok := true; msg := sqlerrm; end;
  insert into t.results values (label, ok, coalesce(msg, 'statement unexpectedly succeeded'));
end $$;
-- expects 0 rows changed (RLS silently filters updates/deletes)
create function t.no_rows(label text, stmt text) returns void language plpgsql as $$
declare n int; msg text; ok boolean;
begin
  begin execute stmt; get diagnostics n = row_count; ok := n = 0; msg := 'rows=' || n;
  exception when others then ok := true; msg := sqlerrm; end;
  insert into t.results values (label, ok, msg);
end $$;

-- fixtures ----------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@t'), ('00000000-0000-0000-0000-0000000000b1', 'bd1@t'),
  ('00000000-0000-0000-0000-0000000000b2', 'bd2@t'), ('00000000-0000-0000-0000-0000000000c1', 'viewer@t'),
  ('00000000-0000-0000-0000-0000000000d1', 'inactive@t'), ('00000000-0000-0000-0000-0000000000e1', 'noprofile@t');
insert into profiles (id, email, full_name, role, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@t', 'Admin', 'admin', true),
  ('00000000-0000-0000-0000-0000000000b1', 'bd1@t', 'BD One', 'bd_executive', true),
  ('00000000-0000-0000-0000-0000000000b2', 'bd2@t', 'BD Two', 'bd_executive', true),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@t', 'Viewer', 'viewer', true),
  ('00000000-0000-0000-0000-0000000000d1', 'inactive@t', 'Inactive', 'bd_executive', false);

create function t.u(n text) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;

-- leads (as BD1 through RLS)
select t.login(t.u('b1'));
insert into leads (id, name, created_by, owner_id) values
  ('11111111-1111-1111-1111-111111111111', 'Amer Group', t.u('b1'), t.u('b1')),
  ('22222222-2222-2222-2222-222222222222', 'Palm Hills', t.u('b1'), t.u('b1')),
  ('33333333-3333-3333-3333-333333333333', 'Orascom', t.u('b1'), null);

-- 1. SAME LEAD CALLED 10 TIMES ------------------------------------------------------
do $$
declare i int; m jsonb;
begin
  for i in 1..10 loop
    perform log_call('11111111-1111-1111-1111-111111111111', case when i in (3, 6, 9) then 'responded' else 'did_not_respond' end);
  end loop;
  m := my_call_metrics();
  perform t.eq('1 same lead x10: total', (m ->> 'total')::int, 10);
  perform t.eq('1 responded', (m ->> 'responded')::int, 3);
  perform t.eq('1 did not respond', (m ->> 'did_not_respond')::int, 7);
  perform t.eq('1 unique leads', (m ->> 'unique_leads')::int, 1);
  perform t.eq('1 response rate', (m ->> 'response_rate')::numeric, 30.0);
  perform t.eq('1 rollup total_calls', (select total_calls from lead_rollups where lead_id = '11111111-1111-1111-1111-111111111111'), 10);
  perform t.eq('1 timeline keeps every call', (select count(*)::int from activities where lead_id = '11111111-1111-1111-1111-111111111111' and type = 'call'), 10);
end $$;

-- 2. DAILY BOUNDARY -------------------------------------------------------------------
select t.root();
insert into call_attempts (lead_id, user_id, outcome, called_at)
select (array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'])[1 + (g % 3)]::uuid,
       t.u('b2'), case when g % 4 = 0 then 'responded' else 'did_not_respond' end,
       public.cairo_day_start(public.cairo_today() - 1) + (g * interval '5 minutes')
from generate_series(0, 149) g;
-- plus the two boundary calls for BD2: 23:59:30 yesterday and 00:00:30 today (Cairo)
insert into call_attempts (lead_id, user_id, outcome, called_at) values
  ('11111111-1111-1111-1111-111111111111', t.u('b2'), 'responded', public.cairo_day_start(public.cairo_today()) - interval '30 seconds'),
  ('11111111-1111-1111-1111-111111111111', t.u('b2'), 'responded', public.cairo_day_start(public.cairo_today()) + interval '30 seconds');
select t.login(t.u('b2'));
do $$
declare today jsonb := my_call_metrics(); yday jsonb := my_call_metrics(public.cairo_today() - 1);
begin
  perform t.eq('2 today only counts the call after Cairo midnight', (today ->> 'total')::int, 1);
  perform t.eq('2 yesterday history intact (150 + 23:59 boundary call)', (yday ->> 'total')::int, 151);
  perform t.eq('2 yesterday rows still in table', (select count(*)::int from call_attempts where user_id = t.u('b2') and public.cairo_date(called_at) = public.cairo_today() - 1), 151);
end $$;
select t.root();
-- a brand-new user starts the day at zero
select t.eq('2 fresh day = 0 for BD1 yesterday', (select (call_metrics(t.u('b1'), public.cairo_today() - 1, public.cairo_today() - 1) ->> 'total')::int
  from (select t.login(t.u('a1'))) x), 0);
select t.root();

-- 3. TARGETS ----------------------------------------------------------------------------
select t.login(t.u('a1'));
select set_user_target(t.u('b1'), 150, public.cairo_today() - 30);
select set_user_target(t.u('b2'), 120, public.cairo_today() - 30);
select t.root();
-- BD1 had 10 calls today: top up to 75, then to 165
insert into call_attempts (lead_id, user_id, outcome, called_at)
select '22222222-2222-2222-2222-222222222222', t.u('b1'), 'did_not_respond', now() - interval '1 minute' from generate_series(1, 65);
select t.login(t.u('b1'));
do $$
declare m jsonb := my_call_metrics();
begin
  perform t.eq('3 target 150 / calls 75: pct', (m ->> 'achievement_pct')::numeric, 50.0);
  perform t.eq('3 remaining 75', (m ->> 'remaining')::int, 75);
end $$;
select t.root();
insert into call_attempts (lead_id, user_id, outcome, called_at)
select '22222222-2222-2222-2222-222222222222', t.u('b1'), 'responded', now() - interval '1 minute' from generate_series(1, 90);
select t.login(t.u('b1'));
do $$
declare m jsonb := my_call_metrics();
begin
  perform t.eq('3 calls 165: pct not capped', (m ->> 'achievement_pct')::numeric, 110.0);
  perform t.eq('3 remaining floors at 0', (m ->> 'remaining')::int, 0);
end $$;
-- target history respects effective dates
select t.login(t.u('a1'));
select set_user_target(t.u('b1'), 200, public.cairo_today());
do $$
declare old jsonb; new jsonb;
begin
  old := call_metrics(t.u('b1'), public.cairo_today() - 5, public.cairo_today() - 5);
  new := call_metrics(t.u('b1'), public.cairo_today(), public.cairo_today());
  perform t.eq('3 historic target stays 150', (old ->> 'target')::int, 150);
  perform t.eq('3 new target 200 from today', (new ->> 'target')::int, 200);
  perform t.eq('3 no overlapping targets', (select count(*)::int from user_targets where user_id = t.u('b1') and active), 2);
end $$;
select t.root();

-- 4. MEETING HAPPY PATH -------------------------------------------------------------------
select t.login(t.u('b1'));
do $$
declare c call_attempts; mt uuid; nm jsonb; r jsonb; v_next uuid;
begin
  c := log_call('33333333-3333-3333-3333-333333333333', 'responded', null, 'meeting_requested', 'Wants to meet');
  insert into meetings (lead_id, owner_id, status, created_from_call_id, created_by)
    values ('33333333-3333-3333-3333-333333333333', t.u('b1'), 'requested', c.id, t.u('b1')) returning id into mt;
  update call_attempts set meeting_id = mt where id = c.id;
  update meetings set status = 'scheduled', scheduled_at = now() + interval '2 days', meeting_type = 'online',
         online_link = 'https://meet.example/x', meeting_with = 'Mr CEO', purpose = 'Intro' where id = mt;
  perform t.eq('4 meeting scheduled is unconfirmed by default', (select confirmation_status from meetings where id = mt), 'unconfirmed');
  update meetings set confirmation_status = 'confirmed' where id = mt;
  -- cannot record minutes before attendance
  perform t.denied('4 minutes blocked before attendance', format($f$select save_meeting_outcome(%L, '{"minutes_of_meeting":"x"}')$f$, mt));
  -- attendance is explicit (not inferred from time)
  perform t.eq('4 attendance stays pending until recorded', (select attendance_status from meetings where id = mt), 'pending');
  r := record_meeting_attendance(mt, true);
  perform t.eq('4 attended => completed', (select status from meetings where id = mt), 'completed');
  r := save_meeting_outcome(mt,
     '{"minutes_of_meeting":"Line1\nLine2\nLine3","meeting_outcome":"proposal_requested","next_step":"send_requirement_form","next_step_detail":"Send form by Monday"}'::jsonb,
     jsonb_build_object('scheduled_at', now() + interval '10 days', 'purpose', 'Second meeting'), current_date + 3);
  v_next := (r ->> 'next_meeting_id')::uuid;
  perform t.check('4 next meeting created and linked', v_next is not null and (select next_meeting_id from meetings where id = mt) = v_next and (select follows_meeting_id from meetings where id = v_next) = mt);
  perform t.check('4 follow-up created from meeting', exists (select 1 from follow_ups where meeting_id = mt and origin = 'meeting'));
  perform t.check('4 timeline has requested/scheduled/confirmed/attended/minutes',
    (select count(distinct type) from activities where lead_id = '33333333-3333-3333-3333-333333333333'
       and type in ('meeting_requested', 'meeting_scheduled', 'meeting_confirmed', 'meeting_attended', 'minutes_added')) = 5);
  perform t.eq('4 temperature untouched by meeting', (select temperature from leads where id = '33333333-3333-3333-3333-333333333333'), 'cold');
  perform t.eq('4 suggestion only (stage not moved)', (select pipeline_stage from leads where id = '33333333-3333-3333-3333-333333333333'), 'research');
  perform t.eq('4 stage suggestion = meeting', (select suggested_stage from lead_list_v where id = '33333333-3333-3333-3333-333333333333'), 'meeting');
end $$;

-- 5. MISSED MEETING -----------------------------------------------------------------------
do $$
declare mt uuid; r jsonb;
begin
  insert into meetings (lead_id, owner_id, status, scheduled_at, meeting_with, created_by)
    values ('22222222-2222-2222-2222-222222222222', t.u('b1'), 'scheduled', now() - interval '1 hour', 'CFO', t.u('b1')) returning id into mt;
  perform t.denied('5 reason mandatory when not attended', format('select record_meeting_attendance(%L, false)', mt));
  r := record_meeting_attendance(mt, false, 'client_did_not_attend', 'No answer',
        jsonb_build_object('scheduled_at', now() + interval '3 days', 'purpose', 'Replacement'));
  perform t.eq('5 old meeting preserved as missed', (select status from meetings where id = mt), 'missed');
  perform t.eq('5 old meeting reason kept', (select not_attended_reason from meetings where id = mt), 'client_did_not_attend');
  perform t.check('5 replacement linked both ways', (select rescheduled_from_id from meetings where id = (r ->> 'replacement_id')::uuid) = mt
                  and (select next_meeting_id from meetings where id = mt) = (r ->> 'replacement_id')::uuid);
  perform t.eq('5 two meeting rows exist', (select count(*)::int from meetings where lead_id = '22222222-2222-2222-2222-222222222222'), 2);
  perform t.denied('5 attendance cannot be recorded twice', format('select record_meeting_attendance(%L, true)', mt));
end $$;

-- 6. COMMERCIAL CHAIN -----------------------------------------------------------------------
do $$
declare f uuid; p uuid; r jsonb; lead uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into commercial_forms (lead_id, owner_id, status, created_by) values (lead, t.u('b1'), 'not_sent', t.u('b1')) returning id into f;
  perform t.denied('6 cannot mark form sent without a date', format($f$update commercial_forms set status = 'sent' where id = %L$f$, f));
  update commercial_forms set status = 'sent', sent_on = current_date where id = f;
  perform t.denied('6 cannot mark form completed without a completion date', format($f$update commercial_forms set status = 'completed' where id = %L$f$, f));
  update commercial_forms set status = 'completed', completed_on = current_date where id = f;
  insert into proposals (lead_id, owner_id, status, title, created_by, form_id) values (lead, t.u('b1'), 'preparing', 'FM Proposal', t.u('b1'), f) returning id into p;
  perform t.denied('6 proposal cannot be "sent" without a sent date', format($f$update proposals set status = 'sent' where id = %L$f$, p));
  update proposals set status = 'sent', sent_on = current_date, response_state = 'awaiting_response' where id = p;
  perform t.eq('6 no response != lost', (select pipeline_stage from leads where id = lead), 'research');
  r := record_proposal_response(p, 'needs_meeting', current_date, 'Wants to discuss', jsonb_build_object('scheduled_at', now() + interval '4 days'), current_date + 5);
  perform t.check('6 proposal review meeting linked', (select proposal_id from meetings where id = (r ->> 'meeting_id')::uuid) = p);
  r := record_proposal_response(p, 'negotiation', current_date, 'Price talks');
  perform t.eq('6 negotiation recorded', (select negotiation_recorded from lead_rollups where lead_id = lead), true);
  perform t.eq('6 suggested stage = negotiation (not auto-applied)', (select suggested_stage from lead_list_v where id = lead), 'negotiation');
  update leads set pipeline_stage = 'negotiation' where id = lead;
  update leads set pipeline_stage = 'won' where id = lead;
  perform t.eq('6 proposal accepted NOT automatic', (select status from proposals where id = p), 'under_review');
  perform t.check('6 timeline has form_sent, form_completed, proposal_sent, response, negotiation, pipeline',
    (select count(distinct type) from activities where lead_id = lead
      and type in ('form_sent', 'form_completed', 'proposal_prepared', 'proposal_sent', 'proposal_response', 'negotiation', 'pipeline_change')) = 7);
end $$;
select t.root();

-- 7. MANAGEMENT PERIOD CALLS ------------------------------------------------------------------
-- use a clean user + days far in the past so earlier fixtures do not interfere
insert into auth.users (id, email) values (t.u('f1'), 'bd3@t');
insert into profiles (id, email, full_name, role, active) values (t.u('f1'), 'bd3@t', 'BD Three', 'bd_executive', true);
insert into user_targets (user_id, daily_call_target, effective_from, created_by) values (t.u('f1'), 100, '2026-01-01', t.u('a1'));
insert into call_attempts (lead_id, user_id, outcome, called_at)
select (array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'])[1 + (g % 2)]::uuid, t.u('f1'),
       case when g % 5 = 0 then 'responded' else 'did_not_respond' end,
       public.cairo_day_start(d.day) + interval '9 hours' + (g * interval '1 minute')
from (values ('2026-02-01'::date, 150), ('2026-02-02'::date, 200), ('2026-02-03'::date, 175)) d(day, n),
     lateral generate_series(1, d.n) g;
select t.login(t.u('a1'));
do $$
declare rep jsonb := admin_report('2026-02-01', '2026-02-03'); u jsonb;
begin
  select x into u from jsonb_array_elements(rep -> 'calls' -> 'by_user') x where x ->> 'user_id' = t.u('f1')::text;
  perform t.eq('7 period total = 150+200+175', (rep -> 'calls' ->> 'total')::int, 525);
  perform t.eq('7 unique leads reported separately (2)', (rep -> 'calls' ->> 'unique_leads')::int, 2);
  perform t.eq('7 by-user total', (u ->> 'total')::int, 525);
  perform t.eq('7 by-day sums', (select sum((x ->> 'total')::int)::int from jsonb_array_elements(rep -> 'calls' -> 'by_day') x), 525);
  -- 2026-02-01 is a Sunday, 02-02 Mon, 02-03 Tue: all working days => 3 x 100
  perform t.eq('7 user period target = 3 working days x 100', (u ->> 'target')::int, 300);
  perform t.eq('7 achievement uncapped', (u ->> 'achievement_pct')::numeric, 175.0);
  perform t.eq('7 remaining floors at 0', (u ->> 'remaining')::int, 0);
  -- a single-day report uses that day's target even on a non-working day (same as the BD dashboard); periods count working days only
  perform t.eq('7 single-day report on a Friday still shows the daily target', (select (x ->> 'target')::int from jsonb_array_elements(admin_report('2026-02-06', '2026-02-06') -> 'calls' -> 'by_user') x where x ->> 'user_id' = t.u('f1')::text), 100);
  perform t.eq('7 a Sun..Sat week counts 5 working days', (select (x ->> 'target')::int from jsonb_array_elements(admin_report('2026-02-01', '2026-02-07') -> 'calls' -> 'by_user') x where x ->> 'user_id' = t.u('f1')::text), 500);
  perform t.check('7 report has all sections', rep ?& array['calls', 'meetings', 'commercial', 'follow_ups', 'pipeline', 'wins_losses', 'critical_follow_ups']);
end $$;
select t.root();

-- 8. GOOGLE SYNC IDEMPOTENCY -------------------------------------------------------------------
select t.svc();
do $$
declare rows jsonb; run uuid := gen_random_uuid(); a jsonb; b jsonb; c jsonb; n_leads int; n_contacts int; n_fu int;
begin
  perform t.root(); insert into sync_runs (id, spreadsheet_id, sheet_name, mode) values (run, 'x', 'Sheet1', 'sync'); perform t.svc();
  rows := $j$[
   {"row_number":2,"company":"Eliwah Group","external_lead_id":"1","emails":["info@eliwahgroup.com"],"phones":[],"linkedin":[],"contacts":[],"status":"Cold","email_sent":true,"called":false,"contacted":false},
   {"row_number":3,"company":"IL Cazar Developments","external_lead_id":"2","emails":["info@ilcazar.com","marieelwy@gmail.com"],"phones":["01025408565","01287777850"],"linkedin":["https://www.linkedin.com/in/ahmed-elwy-ali-marie-b25072112"],
     "contacts":[{"name":"Ahmed Elwy","title":"CDO"},{"name":"Ahmed Morsi","title":"Sales Director"}],"status":"Warm","next_step":"Follow up","notes":"x","follow_up_date":"2026-10-11","last_activity":"2026-10-06","email_sent":true,"called":true,"contacted":false},
   {"row_number":4,"company":"No Id Co","emails":["a@noid.com"],"phones":[],"linkedin":[],"contacts":[],"status":"Hot"},
   {"row_number":5,"company":"","external_lead_id":"99","emails":[],"phones":[],"linkedin":[],"contacts":[]}
  ]$j$;
  a := sync_apply_leads(run, null, 'Sheet1', rows);
  perform t.eq('8 first sync inserted 3', (a ->> 'inserted')::int, 3);
  perform t.eq('8 first sync rejected blank company', (a ->> 'rejected')::int, 1);
  b := sync_apply_leads(run, null, 'Sheet1', rows);
  perform t.eq('8 second sync inserted 0', (b ->> 'inserted')::int, 0);
  perform t.eq('8 second sync updated 0', (b ->> 'updated')::int, 0);
  perform t.eq('8 second sync skipped 3', (b ->> 'skipped')::int, 3);
  c := sync_apply_leads(run, null, 'Sheet1', rows);
  perform t.root();
  select count(*) into n_leads from leads where source = 'google_sheet';
  select count(*) into n_contacts from contacts where source = 'google_sheet';
  select count(*) into n_fu from follow_ups where origin = 'google_sheet';
  perform t.eq('8 no duplicate companies', n_leads, 3);
  perform t.eq('8 no duplicate contacts (general x3 + 2 people)', n_contacts, 5);
  perform t.eq('8 no duplicate follow-ups', n_fu, 1);
  perform t.eq('8 legacy Called flag does not create calls', (select count(*)::int from call_attempts a join leads l on l.id = a.lead_id where l.source = 'google_sheet'), 0);
  perform t.eq('8 temperature mapped on first import only', (select temperature from leads where external_lead_id = '2'), 'warm');
  perform t.eq('8 no-id row without conflict matched by company+email', (select count(*)::int from leads where name = 'No Id Co'), 1);
  -- CRM changes survive a re-sync
  update leads set temperature = 'hot', pipeline_stage = 'qualified' where external_lead_id = '2';
  perform t.svc();
  c := sync_apply_leads(run, null, 'Sheet1', rows);
  perform t.root();
  perform t.eq('8 re-sync keeps CRM-owned temperature', (select temperature from leads where external_lead_id = '2'), 'hot');
  perform t.eq('8 re-sync keeps CRM-owned stage', (select pipeline_stage from leads where external_lead_id = '2'), 'qualified');
  -- same name, different identity => conflict, not merge
  perform t.svc();
  c := sync_apply_leads(run, null, 'Sheet1', '[{"row_number":9,"company":"Eliwah Group","external_lead_id":"500","emails":["other@else.com"],"phones":[],"linkedin":[],"contacts":[]}]'::jsonb);
  perform t.eq('8 same-name different-id is a conflict', (c ->> 'conflicts')::int, 1);
  perform t.root();
  perform t.eq('8 conflict did not create a lead', (select count(*)::int from leads where name = 'Eliwah Group'), 1);
  -- Lead ID collision with a manual lead of another name => never merged; imported separately without the clashing id
  perform t.root();
  insert into leads (name, external_lead_id, created_by) values ('Manual Co', '777', t.u('a1'));
  perform t.svc();
  c := sync_apply_leads(run, null, 'Sheet1', '[{"row_number":11,"company":"Totally Different Ltd","external_lead_id":"777","emails":["x@diff.com"],"phones":[],"linkedin":[],"contacts":[]}]'::jsonb);
  perform t.eq('8 Lead ID collision counted as conflict', (c ->> 'conflicts')::int, 1);
  perform t.eq('8 collision row still imported once', (c ->> 'inserted')::int, 1);
  c := sync_apply_leads(run, null, 'Sheet1', '[{"row_number":11,"company":"Totally Different Ltd","external_lead_id":"777","emails":["x@diff.com"],"phones":[],"linkedin":[],"contacts":[]}]'::jsonb);
  perform t.eq('8 collision row not duplicated on re-sync', (c ->> 'inserted')::int, 0);
  perform t.root();
  perform t.eq('8 collision left the manual lead untouched', (select legacy::text from leads where external_lead_id = '777'), '{}');
  perform t.eq('8 colliding company imported without the id, original id kept in legacy', (select legacy ->> 'sheet_lead_id' from leads where name = 'Totally Different Ltd'), '777');
  perform t.eq('8 exactly one lead per name', (select count(*)::int from leads where name in ('Manual Co', 'Totally Different Ltd')), 2);
  -- sheet2 projects
  perform t.svc();
  a := sync_apply_projects(run, null, 'Sheet2', '[{"row_number":2,"developer":"ERG","project":"Diamond 1"},{"row_number":3,"developer":"شركة مصر افريقيا","project":"sc-1 school"}]'::jsonb);
  b := sync_apply_projects(run, null, 'Sheet2', '[{"row_number":2,"developer":"ERG","project":"Diamond 1"},{"row_number":3,"developer":"شركة مصر افريقيا","project":"sc-1 school"}]'::jsonb);
  perform t.root();
  perform t.eq('8 projects inserted once', (a ->> 'inserted')::int, 2);
  perform t.eq('8 projects second run inserts 0', (b ->> 'inserted')::int, 0);
  perform t.eq('8 projects table size', (select count(*)::int from projects), 2);
  perform t.eq('8 projects did not create leads', (select count(*)::int from leads where name in ('ERG', 'Diamond 1')), 0);
end $$;
select t.root();

-- 9. SECURITY ---------------------------------------------------------------------------------
select t.anon();
select t.denied('9 anon cannot read leads', 'select * from leads');
select t.denied('9 anon cannot call rpc', 'select my_call_metrics()');
select t.denied('9 anon cannot read profiles', 'select * from profiles');
select t.login(t.u('e1'));   -- authenticated Auth user WITHOUT a profile
select t.eq('9 no-profile user sees 0 leads', (select count(*)::int from leads), 0);
select t.denied('9 no-profile user cannot insert lead', $$insert into leads (name, created_by) values ('x', gen_random_uuid())$$);
select t.login(t.u('d1'));   -- inactive
select t.eq('9 inactive user sees 0 leads', (select count(*)::int from leads), 0);
select t.denied('9 inactive cannot log calls', $$select log_call('11111111-1111-1111-1111-111111111111', 'responded')$$);
select t.denied('9 inactive cannot read metrics', 'select my_call_metrics()');
select t.login(t.u('c1'));   -- viewer
select t.check('9 viewer can read leads', (select count(*) from leads) > 0);
select t.denied('9 viewer cannot log calls', $$select log_call('11111111-1111-1111-1111-111111111111', 'responded')$$);
select t.denied('9 viewer cannot create leads', $$insert into leads (name, created_by) values ('v', current_setting('request.jwt.claim.sub')::uuid)$$);
select t.no_rows('9 viewer cannot update leads', $$update leads set notes = 'x'$$);
select t.denied('9 viewer cannot read admin report', $$select admin_report(current_date, current_date)$$);
select t.eq('9 viewer cannot read audit', (select count(*)::int from audit_logs), 0);
select t.root();
update leads set owner_id = t.u('b2') where external_lead_id = '1';
select t.login(t.u('b1'));   -- BD
select t.denied('9 bd cannot call admin_report', $$select admin_report(current_date, current_date)$$);
select t.eq('9 bd sees no audit rows', (select count(*)::int from audit_logs), 0);
select t.eq('9 bd sees no sync runs', (select count(*)::int from sync_runs), 0);
select t.denied('9 bd cannot read another users metrics', format('select call_metrics(%L, current_date, current_date)', t.u('b2')));
select t.no_rows('9 bd cannot change roles', $$update profiles set role = 'admin' where id = current_setting('request.jwt.claim.sub')::uuid$$);
select t.no_rows('9 bd cannot set targets', $$update user_targets set daily_call_target = 1$$);
select t.denied('9 bd cannot execute set_user_target', format('select set_user_target(%L, 1)', t.u('b1')));
select t.denied('9 bd cannot call sync functions', $$select sync_apply_leads(gen_random_uuid(), null, 's', '[]'::jsonb)$$);
select t.denied('9 bd cannot call svc_upsert_profile', format($f$select svc_upsert_profile(%L, %L, 'x@x', 'x', 'admin', true)$f$, t.u('b1'), t.u('b1')));
select t.no_rows('9 bd cannot delete leads', $$delete from leads$$);
select t.no_rows('9 bd cannot edit lead owned by someone else', $$update leads set notes = 'hijack' where external_lead_id = '1'$$);
select t.no_rows('9 bd cannot edit other users call', format($f$update call_attempts set notes = 'x' where user_id = %L$f$, t.u('b2')));
select t.no_rows('9 bd cannot edit past-day call of own', format($f$update call_attempts set notes = 'x' where user_id = %L and public.cairo_date(called_at) < public.cairo_today()$f$, t.u('b1')));
select t.denied('9 bd cannot log call as someone else', format($f$insert into call_attempts (lead_id, user_id, outcome) values ('11111111-1111-1111-1111-111111111111', %L, 'responded')$f$, t.u('b2')));
select t.denied('9 audit log is not writable by users', $$insert into audit_logs (entity, action) values ('x', 'y')$$);
select t.denied('9 audit log cannot be updated', $$update audit_logs set action = 'x'$$);
select t.login(t.u('a1'));   -- admin
select t.denied('9 even admin cannot edit audit rows', $$update audit_logs set action = 'tampered'$$);
select t.denied('9 even admin cannot delete audit rows', $$delete from audit_logs$$);
select t.check('9 admin reads audit', (select count(*) from audit_logs) > 0);
select t.check('9 admin report works', admin_report(current_date, current_date) is not null);
select t.check('9 admin status works', system_status() is not null);
select t.root();
select t.check('9 audit captured target change', exists (select 1 from audit_logs where action in ('target_set', 'target_changed')));
select t.check('9 audit captured pipeline change', exists (select 1 from audit_logs where action = 'pipeline_changed'));
select t.check('9 audit names the actor', exists (select 1 from audit_logs where actor_email = 'bd1@t'));
select t.check('9 call inserts are not individually audited (volume)', not exists (select 1 from audit_logs where entity = 'call_attempts' and action = 'create'));

select t.login(t.u('b1'));
select t.eq('9 bd cannot read another users target through the helper', public.user_target_on(t.u('b2'), current_date), null::int);
select t.check('9 bd can read their own target through the helper', public.user_target_on(t.u('b1'), current_date) is not null);
select t.root();
-- inactive flag blocks immediately after deactivation
update profiles set active = false where id = t.u('b2');
select t.login(t.u('b2'));
select t.eq('9 deactivated user loses access at once', (select count(*)::int from leads), 0);
select t.root();

-- 10. STORAGE POLICIES (private bucket crm-files) -----------------------------------------------
select t.eq('10 bucket is private', (select public from storage.buckets where id = 'crm-files'), false);
select t.login(t.u('b1'));
insert into storage.objects (bucket_id, name, owner_id) values ('crm-files', 'lead/proposal/a.pdf', t.u('b1')::text);
select t.check('10 staff can upload (insert succeeded)', true);
select t.check('10 members can read', (select count(*) from storage.objects where bucket_id = 'crm-files') = 1);
select t.no_rows('10 other staff cannot delete my file', format($f$update storage.objects set name = name where bucket_id = 'crm-files' and owner_id = %L and false$f$, t.u('b1')));
select t.login(t.u('c1'));
select t.check('10 viewer can read files', (select count(*) from storage.objects where bucket_id = 'crm-files') = 1);
select t.denied('10 viewer cannot upload', $$insert into storage.objects (bucket_id, name, owner_id) values ('crm-files', 'x/y.pdf', 'v')$$);
select t.no_rows('10 viewer cannot delete', $$delete from storage.objects where bucket_id = 'crm-files'$$);
select t.anon();
select t.eq('10 anonymous sees no files', (select count(*)::int from storage.objects), 0);
select t.denied('10 anonymous cannot upload', $$insert into storage.objects (bucket_id, name) values ('crm-files', 'z.pdf')$$);
select t.login(t.u('d1'));
select t.eq('10 inactive user sees no files', (select count(*)::int from storage.objects), 0);
select t.login(t.u('b2'));
select t.no_rows('10 other BD cannot delete a file they do not own', $$delete from storage.objects where bucket_id = 'crm-files'$$);
select t.root();

-- 11. TIMELINE ORDER IS DETERMINISTIC FOR SAME-TIMESTAMP ACTIVITIES (migration 9) ------------------
-- 40 events in ONE transaction share one now(); the newest must come first and the order must be insertion order.
create temp table tie_lead as select id from public.leads order by id limit 1;
begin;
insert into public.activities (lead_id, type, summary) select (select id from tie_lead), 'lead_created', 'tie-' || g from generate_series(1, 40) g;
commit;
select t.eq('11 same-timestamp events share one timestamp',
  (select count(distinct occurred_at)::int from public.activities where summary like 'tie-%'), 1);
select t.eq('11 newest same-timestamp event is first (occurred_at desc, seq desc)',
  (select summary from public.activities where lead_id = (select id from tie_lead) order by occurred_at desc, seq desc limit 1), 'tie-40');
select t.eq('11 first timeline page (30) holds the 30 most recent inserts, in insertion order',
  (select string_agg(summary, ',') from (select summary from public.activities where lead_id = (select id from tie_lead)
     order by occurred_at desc, seq desc limit 30) x),
  (select string_agg('tie-' || g, ',' order by g desc) from generate_series(11, 40) g));
select t.eq('11 ordering is stable across repeated reads',
  (select string_agg(id::text, ',') from (select id from public.activities where lead_id = (select id from tie_lead) order by occurred_at desc, seq desc limit 30) x),
  (select string_agg(id::text, ',') from (select id from public.activities where lead_id = (select id from tie_lead) order by occurred_at desc, seq desc limit 30) x));
select t.check('11 seq is unique and not null', (select count(*) = count(distinct seq) and count(*) filter (where seq is null) = 0 from public.activities));

-- 12. EXPORT PERMISSIONS + AUDIT (migration 10) ---------------------------------------------------
select t.root();
create temp table export_before as select count(*) n from public.audit_logs where entity = 'export';
grant select on export_before to public;
select t.login(t.u('a1'));
select t.check('12 admin can start a full export (audited)', public.log_export('full', 'xlsx', null, null, '{"period":"all"}') > 0);
select t.check('12 admin can export the board report as pdf', public.log_export('board', 'pdf', '2026-10-01', '2026-10-31', '{}') > 0);
select t.login(t.u('b1'));
select t.check('12 BD can export an individual dataset', public.log_export('leads', 'xlsx', '2026-10-01', '2026-10-10', '{"temperature":"hot"}') > 0);
select t.denied('12 BD cannot run the full CRM export', $$select public.log_export('full', 'xlsx')$$);
select t.denied('12 BD cannot export the board report', $$select public.log_export('board', 'pdf')$$);
select t.login(t.u('c1'));
select t.denied('12 viewer cannot export anything', $$select public.log_export('leads', 'xlsx')$$);
select t.login(t.u('d1'));
select t.denied('12 inactive user cannot export', $$select public.log_export('leads', 'xlsx')$$);
select t.anon();
select t.denied('12 anonymous cannot export', $$select public.log_export('leads', 'xlsx')$$);
select t.login(t.u('a1'));
select t.denied('12 unknown export type rejected', $$select public.log_export('passwords', 'xlsx')$$);
select t.denied('12 unknown format rejected', $$select public.log_export('leads', 'csv')$$);
select t.root();
select t.eq('12 exactly the 3 allowed exports were audited',
  (select count(*)::int from public.audit_logs where entity = 'export') - (select n::int from export_before), 3);
select t.check('12 audit row records who, what, period and format — never data',
  (select actor_id = t.u('b1') and action = 'data_export' and entity_id = 'leads' and meta ->> 'format' = 'xlsx'
          and meta ->> 'from' = '2026-10-01' and meta ->> 'to' = '2026-10-10' and meta ->> 'timezone' = 'Africa/Cairo'
          and meta -> 'filters' ->> 'temperature' = 'hot' and old_value is null and new_value is null
     from public.audit_logs where entity = 'export' and entity_id = 'leads' order by id desc limit 1));
select t.check('12 export audit rows are immutable', (select count(*) from pg_trigger where tgrelid = 'public.audit_logs'::regclass and not tgisinternal) > 0);

-- result -------------------------------------------------------------------------------------
\o
\echo
select format('%s  %s  %s', case when ok then 'PASS' else 'FAIL' end, label, case when ok then '' else '-- ' || detail end) from t.results order by ok, label;
select format('TOTAL %s  PASSED %s  FAILED %s', count(*), count(*) filter (where ok), count(*) filter (where not ok)) from t.results;
do $$ begin if exists (select 1 from t.results where not ok) then raise exception 'SQL TESTS FAILED'; end if; end $$;
