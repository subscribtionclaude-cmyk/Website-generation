-- ACCORD CRM V2 (Claude independent version) — core schema
-- Timezone for all business-date logic: Africa/Cairo

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Time helpers (Cairo business calendar)
-- ---------------------------------------------------------------------------
create or replace function public.cairo_date(ts timestamptz) returns date
language sql immutable parallel safe as $$ select (ts at time zone 'Africa/Cairo')::date $$;

create or replace function public.cairo_today() returns date
language sql stable as $$ select public.cairo_date(now()) $$;

-- start of a Cairo calendar day, as an absolute instant
create or replace function public.cairo_day_start(d date) returns timestamptz
language sql immutable parallel safe as $$ select (d::timestamp) at time zone 'Africa/Cairo' $$;

create or replace function public.norm_name(t text) returns text
language sql immutable parallel safe as $$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(t, ''), '[.,]', ' ', 'g'), '\s+', ' ', 'g')))
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Reference / configuration tables
-- ---------------------------------------------------------------------------
create table public.pipeline_stages (
  key text primary key,
  label text not null,
  position int not null,
  is_terminal boolean not null default false,
  active boolean not null default true
);

create table public.call_outcomes (
  key text primary key,
  label text not null,
  kind text not null check (kind in ('responded', 'did_not_respond')),
  position int not null default 0,
  active boolean not null default true
);

create table public.activity_types (
  key text primary key,
  label text not null,
  icon text not null default 'circle'
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (CRM access is granted ONLY by an active row here)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role text not null check (role in ('admin', 'bd_executive', 'viewer')),
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create or replace function public.current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active), false)
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'bd_executive') from public.profiles where id = auth.uid() and active), false)
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;
revoke all on function public.current_app_role(), public.is_admin(), public.is_staff(), public.is_member() from public, anon;
grant execute on function public.current_app_role(), public.is_admin(), public.is_staff(), public.is_member() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leads & contacts
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  name_norm text not null,
  external_lead_id text,
  website text,
  industry text,
  city text,
  address text,
  temperature text not null default 'cold' check (temperature in ('cold', 'warm', 'hot', 'lost', 'closed')),
  pipeline_stage text not null default 'research' references public.pipeline_stages (key),
  owner_id uuid references public.profiles (id),
  source text not null default 'manual' check (source in ('manual', 'google_sheet', 'import')),
  source_sheet text,
  source_row int,
  legacy jsonb not null default '{}'::jsonb,
  notes text,
  archived boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leads_external_lead_id_key on public.leads (external_lead_id) where external_lead_id is not null;
create index leads_name_norm_idx on public.leads (name_norm);
create index leads_owner_idx on public.leads (owner_id);
create index leads_stage_idx on public.leads (pipeline_stage) where not archived;
create index leads_temperature_idx on public.leads (temperature) where not archived;

create or replace function public.leads_before_write() returns trigger
language plpgsql as $$
begin
  new.name := btrim(new.name);
  new.name_norm := public.norm_name(new.name);
  return new;
end $$;
create trigger leads_before_write before insert or update on public.leads
  for each row execute function public.leads_before_write();
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  full_name text not null default '',
  job_title text,
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  linkedin text[] not null default '{}',
  is_primary boolean not null default false,
  notes text,
  dedupe_key text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_lead_idx on public.contacts (lead_id);
create unique index contacts_lead_dedupe_key on public.contacts (lead_id, dedupe_key) where dedupe_key is not null;
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Call sessions & attempts (every attempt is its own immutable-by-default row)
-- ---------------------------------------------------------------------------
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index call_sessions_user_idx on public.call_sessions (user_id, started_at desc);

create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  user_id uuid not null references public.profiles (id),
  call_session_id uuid references public.call_sessions (id) on delete set null,
  outcome text not null references public.call_outcomes (key),
  sub_outcome text check (sub_outcome in (
    'interested', 'follow_up_needed', 'meeting_requested', 'meeting_scheduled',
    'proposal_discussion', 'not_interested', 'other',
    'retry_later_today', 'tomorrow', 'select_date', 'no_retry')),
  called_at timestamptz not null default now(),
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  notes text,
  follow_up_id uuid,
  meeting_id uuid,
  source text not null default 'app' check (source in ('app', 'admin', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_not_in_future check (called_at <= now() + interval '10 minutes')
);
create index call_attempts_user_time_idx on public.call_attempts (user_id, called_at desc);
create index call_attempts_lead_time_idx on public.call_attempts (lead_id, called_at desc);
create index call_attempts_time_idx on public.call_attempts (called_at);
create trigger call_attempts_updated_at before update on public.call_attempts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Targets (effective-dated, never overlapping per user)
-- ---------------------------------------------------------------------------
create table public.user_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  daily_call_target int not null check (daily_call_target >= 0),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  constraint user_targets_no_overlap exclude using gist (
    user_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (active)
);
create index user_targets_user_idx on public.user_targets (user_id, effective_from desc);
create trigger user_targets_updated_at before update on public.user_targets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Follow-ups
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  owner_id uuid references public.profiles (id),
  title text not null default 'Follow-up',
  notes text,
  due_date date not null,
  due_time time,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  origin text not null default 'manual' check (origin in ('manual', 'call', 'meeting', 'proposal', 'form', 'google_sheet')),
  call_id uuid references public.call_attempts (id) on delete set null,
  meeting_id uuid,
  proposal_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create index follow_ups_owner_due_idx on public.follow_ups (owner_id, status, due_date);
create index follow_ups_due_idx on public.follow_ups (due_date) where status = 'open';
create index follow_ups_lead_idx on public.follow_ups (lead_id, due_date);
create unique index follow_ups_sheet_key on public.follow_ups (lead_id, due_date) where origin = 'google_sheet';
create trigger follow_ups_updated_at before update on public.follow_ups
  for each row execute function public.set_updated_at();

alter table public.call_attempts
  add constraint call_attempts_follow_up_fk foreign key (follow_up_id) references public.follow_ups (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  owner_id uuid references public.profiles (id),
  status text not null default 'scheduled' check (status in ('requested', 'scheduled', 'completed', 'missed', 'cancelled', 'rescheduled')),
  scheduled_at timestamptz,
  timezone text not null default 'Africa/Cairo',
  meeting_type text not null default 'physical' check (meeting_type in ('physical', 'online', 'phone')),
  location text,
  online_link text,
  confirmation_status text not null default 'unconfirmed' check (confirmation_status in ('confirmed', 'unconfirmed', 'tentative')),
  attendance_status text not null default 'pending' check (attendance_status in ('pending', 'attended', 'not_attended')),
  attendance_recorded_at timestamptz,
  meeting_with text,
  purpose text,
  agenda text,
  internal_attendees text,
  external_attendees text,
  notes text,
  summary text,
  minutes_of_meeting text,
  discussion_points text,
  client_requirements text,
  agreements text,
  commitments text,
  requested_documents text,
  commercial_notes text,
  meeting_outcome text check (meeting_outcome in (
    'positive', 'neutral', 'negative', 'more_information_required', 'form_required',
    'proposal_requested', 'second_meeting_required', 'negotiation', 'no_opportunity', 'other')),
  next_step text check (next_step in (
    'send_requirement_form', 'wait_for_completed_form', 'prepare_proposal', 'send_proposal',
    'follow_up', 'schedule_second_meeting', 'provide_technical_information',
    'commercial_negotiation', 'close_opportunity', 'other')),
  next_step_detail text,
  next_follow_up_at date,
  next_meeting_required boolean,
  next_meeting_id uuid references public.meetings (id) on delete set null,
  not_attended_reason text check (not_attended_reason in (
    'client_did_not_attend', 'accord_did_not_attend', 'client_cancelled', 'rescheduled',
    'unable_to_reach_client', 'timing_conflict', 'other')),
  not_attended_notes text,
  rescheduled_from_id uuid references public.meetings (id) on delete set null,
  follows_meeting_id uuid references public.meetings (id) on delete set null,
  created_from_call_id uuid references public.call_attempts (id) on delete set null,
  proposal_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'requested' or scheduled_at is not null),
  check (attendance_status <> 'not_attended' or not_attended_reason is not null)
);
create index meetings_schedule_idx on public.meetings (scheduled_at) where scheduled_at is not null;
create index meetings_lead_idx on public.meetings (lead_id, scheduled_at desc);
create index meetings_owner_idx on public.meetings (owner_id, scheduled_at);
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

alter table public.call_attempts
  add constraint call_attempts_meeting_fk foreign key (meeting_id) references public.meetings (id) on delete set null;
alter table public.follow_ups
  add constraint follow_ups_meeting_fk foreign key (meeting_id) references public.meetings (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Information / requirement forms
-- ---------------------------------------------------------------------------
create table public.commercial_forms (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  owner_id uuid references public.profiles (id),
  required boolean not null default true,
  status text not null default 'not_sent' check (status in ('not_required', 'not_sent', 'sent', 'partially_completed', 'completed')),
  sent_on date,
  completed_on date,
  link text,
  file_path text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- never fabricate dates: a status that implies an event needs that event's date
  check (status not in ('sent', 'partially_completed', 'completed') or sent_on is not null),
  check (status <> 'completed' or completed_on is not null)
);
create index commercial_forms_lead_idx on public.commercial_forms (lead_id, created_at desc);
create index commercial_forms_status_idx on public.commercial_forms (status);
create trigger commercial_forms_updated_at before update on public.commercial_forms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------
create sequence public.proposal_seq;
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_no bigint not null default nextval('public.proposal_seq'),
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_ids uuid[] not null default '{}',
  meeting_id uuid references public.meetings (id) on delete set null,
  form_id uuid references public.commercial_forms (id) on delete set null,
  title text not null default 'Proposal',
  owner_id uuid references public.profiles (id),
  value numeric(14, 2) check (value is null or value >= 0),
  currency text not null default 'EGP',
  status text not null default 'not_started' check (status in (
    'not_started', 'preparing', 'ready', 'sent', 'under_review', 'revision_requested', 'accepted', 'rejected', 'closed')),
  prepared_on date,
  sent_on date,
  file_path text,
  notes text,
  next_follow_up_date date,
  response_state text check (response_state in ('awaiting_response', 'responded', 'no_response_yet')),
  response_outcome text check (response_outcome in (
    'positive', 'needs_revision', 'needs_meeting', 'negotiation', 'rejected', 'accepted', 'other')),
  response_on date,
  response_notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('sent', 'under_review') or sent_on is not null),
  check (response_state is distinct from 'responded' or (response_outcome is not null and response_on is not null))
);
create unique index proposals_no_key on public.proposals (proposal_no);
create index proposals_lead_idx on public.proposals (lead_id, created_at desc);
create index proposals_owner_idx on public.proposals (owner_id, status);
create trigger proposals_updated_at before update on public.proposals
  for each row execute function public.set_updated_at();

alter table public.meetings add constraint meetings_proposal_fk foreign key (proposal_id) references public.proposals (id) on delete set null;
alter table public.follow_ups add constraint follow_ups_proposal_fk foreign key (proposal_id) references public.proposals (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Attachments (metadata; bytes live in private Storage bucket "crm-files")
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  entity_type text not null check (entity_type in ('lead', 'meeting', 'proposal', 'form')),
  entity_id uuid,
  bucket text not null default 'crm-files',
  path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index attachments_lead_idx on public.attachments (lead_id, created_at desc);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Sheet2 reference data (developers / projects) — never creates leads
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  developer_name text not null,
  developer_norm text not null,
  project_name text not null,
  project_norm text not null,
  attributes jsonb not null default '{}'::jsonb,
  linked_lead_id uuid references public.leads (id) on delete set null, -- manual link only, never auto-merged
  source_sheet text,
  source_row int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (developer_norm, project_norm)
);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Timeline, sync history, audit
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  type text not null references public.activity_types (key),
  occurred_at timestamptz not null default now(),
  summary text,
  ref_table text,
  ref_id uuid,
  data jsonb not null default '{}'::jsonb
);
create index activities_lead_time_idx on public.activities (lead_id, occurred_at desc, id);
create index activities_type_time_idx on public.activities (type, occurred_at);
create index activities_actor_time_idx on public.activities (actor_id, occurred_at);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  initiated_by uuid references public.profiles (id),
  spreadsheet_id text not null,
  sheet_name text not null,
  mode text not null check (mode in ('preview', 'sync')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  rows_scanned int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  conflicts int not null default 0,
  rejected int not null default 0,
  errors int not null default 0,
  summary jsonb not null default '{}'::jsonb
);
create index sync_runs_started_idx on public.sync_runs (started_at desc);

create table public.sync_errors (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.sync_runs (id) on delete cascade,
  row_number int,
  kind text not null check (kind in ('rejected', 'conflict', 'error')),
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index sync_errors_run_idx on public.sync_errors (run_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  entity text not null,
  entity_id text,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  meta jsonb
);
create index audit_logs_at_idx on public.audit_logs (at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, at desc);

-- audit log is append-only
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Denormalised per-lead rollups (maintained by triggers; not user-writable)
-- ---------------------------------------------------------------------------
create table public.lead_rollups (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  search_text text not null default '',
  contacts_count int not null default 0,
  primary_contact text,
  total_calls int not null default 0,
  responded_calls int not null default 0,
  last_call_at timestamptz,
  last_call_outcome text,
  open_follow_ups int not null default 0,
  next_follow_up_date date,
  next_meeting_at timestamptz,
  next_meeting_confirmation text,
  meetings_total int not null default 0,
  meetings_attended int not null default 0,
  last_meeting_outcome text,
  form_status text,
  proposal_status text,
  proposal_response text,
  negotiation_recorded boolean not null default false,
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);
create index lead_rollups_search_trgm on public.lead_rollups using gin (search_text extensions.gin_trgm_ops);
create index lead_rollups_next_fu_idx on public.lead_rollups (next_follow_up_date);
create index lead_rollups_last_call_idx on public.lead_rollups (last_call_at desc);
