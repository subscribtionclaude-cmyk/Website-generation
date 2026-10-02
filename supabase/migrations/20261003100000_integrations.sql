-- ════════════════════════════════════════════════════════════════════════════
-- Phase 09 · Integrations layer — every external provider is OPTIONAL and DISABLED by default.
--
--   integration_configs          one row per integration (catalog key): provider, enabled flag and
--                                PUBLIC / non-secret settings only. Secrets are never stored here:
--                                the server runtime (Supabase Edge Functions) reads them from its own
--                                environment by the names listed in integration-catalog.json.
--   integration_health_checks    "Test connection" history (structured status codes, safe text)
--   integration_sync_jobs/items  ERP / POS sync history; dry runs and applied runs; per-record plan
--   integration_external_ids     external ID ↔ Malek ID mappings (Malek IDs are never replaced)
--   integration_webhook_events   inbound webhook receipts (provider event ID → duplicates ignored)
--   notification_deliveries      (Phase 04 table, extended) external delivery attempts + retries
--
-- Provider results are recorded by the server runtime with the service role only; staff RPCs
-- configure, enable / disable, start syncs and read logs (integrations.view / test / manage / sync).
-- External price and stock updates go through the same history paths as the admin
-- (price_history trigger, stock_movements) and never bypass active stock reservations.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Permissions ─────────────────────────────────────────────────────────────
insert into public.permissions (key, module, is_sensitive) values
  ('integrations.view', 'settings', false),
  ('integrations.test', 'settings', false),
  ('integrations.sync', 'settings', true)
on conflict (key) do update set module = excluded.module, is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r
cross join (values ('integrations.view'), ('integrations.test'), ('integrations.sync')) as p (key)
where r.key = 'super_admin'
   or (r.key = 'store_manager' and p.key in ('integrations.view', 'integrations.test', 'integrations.sync'))
   or (r.key = 'customer_service' and p.key = 'integrations.view')
on conflict do nothing;

-- ── History sources for external updates ────────────────────────────────────
alter table public.price_history drop constraint if exists price_history_source_check;
alter table public.price_history add constraint price_history_source_check
  check (source in ('admin', 'bulk', 'import', 'system', 'integration'));

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'cancellation_restock', 'manual_adjustment', 'restock', 'addition', 'reduction',
                    'damage', 'return', 'correction', 'import', 'initial', 'external_sync'));

-- ── Catalog (projection of src/domain/integrations/integration-catalog.json) ─
create or replace function app.integration_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"ai":{"channel":null,"check":"server","providers":["openai_compatible"],"settings":{"baseUrl":{"required":true,"type":"url"},"model":{"required":true,"type":"string"}},"syncDomains":[]},"backup":{"channel":null,"check":"server","providers":["s3_compatible"],"settings":{"bucket":{"required":true,"type":"string"},"endpoint":{"required":true,"type":"url"},"retentionDays":{"required":false,"type":"number"}},"syncDomains":[]},"courier":{"channel":null,"check":"server","providers":["generic_http"],"settings":{"accountId":{"required":false,"type":"string"},"baseUrl":{"required":true,"type":"url"}},"syncDomains":[]},"email":{"channel":"email","check":"server","providers":["smtp","http_api"],"settings":{"fromAddress":{"required":true,"type":"email"},"fromName":{"required":false,"type":"string"},"replyTo":{"required":false,"type":"email"}},"syncDomains":[]},"google_analytics":{"channel":null,"check":"client","providers":["ga4"],"settings":{"measurementId":{"required":true,"type":"string"}},"syncDomains":[]},"odoo":{"channel":null,"check":"server","providers":["odoo_jsonrpc"],"settings":{"baseUrl":{"required":true,"type":"url"},"companyId":{"required":false,"type":"number"},"database":{"required":true,"type":"string"},"username":{"required":true,"type":"string"}},"syncDomains":["products","prices","stock","customers"]},"pos":{"channel":null,"check":"server","providers":["generic_http"],"settings":{"baseUrl":{"required":true,"type":"url"},"locationId":{"required":false,"type":"string"}},"syncDomains":["prices","stock"]},"search":{"channel":null,"check":"server","providers":["meilisearch","typesense"],"settings":{"baseUrl":{"required":true,"type":"url"},"indexName":{"required":true,"type":"string"}},"syncDomains":[]},"sms":{"channel":"sms","check":"server","providers":["http_gateway"],"settings":{"endpoint":{"required":true,"type":"url"},"senderId":{"required":true,"type":"string"}},"syncDomains":[]},"social_auth":{"channel":null,"check":"client","providers":["supabase_auth"],"settings":{"apple":{"required":false,"type":"boolean"},"google":{"required":false,"type":"boolean"}},"syncDomains":[]},"storage":{"channel":null,"check":"server","providers":["s3_compatible"],"settings":{"bucket":{"required":true,"type":"string"},"endpoint":{"required":true,"type":"url"},"region":{"required":false,"type":"string"}},"syncDomains":[]},"whatsapp":{"channel":"whatsapp","check":"server","providers":["meta_cloud"],"settings":{"businessAccountId":{"required":false,"type":"string"},"graphVersion":{"required":true,"type":"string"},"phoneNumberId":{"required":true,"type":"string"}},"syncDomains":[]}}'::jsonb;
$$;

-- Server-side results (health checks, sync results, delivery outcomes, webhooks) come from the
-- server runtime, which calls with the service role. Browsers can never record them.
create or replace function app.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
end;
$$;

-- ── Configuration ───────────────────────────────────────────────────────────
create table if not exists public.integration_configs (
  key                    text primary key,
  provider               text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  enabled                boolean not null default false,
  settings               jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192),
  ownership              jsonb not null default '{}'::jsonb check (jsonb_typeof(ownership) = 'object'),
  direction              text not null default 'import' check (direction in ('import', 'export', 'two_way')),
  template_map           jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(template_map) = 'object' and pg_column_size(template_map) <= 8192),
  last_check_at          timestamptz,
  last_check_status      text check (last_check_status is null or last_check_status in ('connected', 'failed')),
  last_check_code        text check (last_check_code is null or last_check_code ~ '^[a-z_]{1,40}$'),
  last_check_message     text check (last_check_message is null or char_length(last_check_message) <= 300),
  last_check_latency_ms  integer,
  last_ok_at             timestamptz,
  consecutive_failures   integer not null default 0,
  circuit_open_until     timestamptz,
  last_sync_at           timestamptz,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint integration_configs_key_check check (app.integration_catalog() ? key)
);

insert into public.integration_configs (key)
select k from jsonb_object_keys(app.integration_catalog()) k
on conflict (key) do nothing;

create table if not exists public.integration_health_checks (
  id          bigint generated always as identity primary key,
  key         text not null references public.integration_configs (key) on delete cascade,
  status      text not null check (status in ('connected', 'failed')),
  code        text not null check (code ~ '^[a-z_]{1,40}$'),
  message     text check (message is null or char_length(message) <= 300),
  latency_ms  integer,
  actor_id    uuid,
  checked_at  timestamptz not null default now()
);
create index if not exists integration_health_checks_key_idx on public.integration_health_checks (key, checked_at desc);

create table if not exists public.integration_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  key              text not null references public.integration_configs (key) on delete cascade,
  domain           text not null check (domain in ('products', 'prices', 'stock', 'customers')),
  direction        text not null default 'import' check (direction in ('import', 'export')),
  dry_run          boolean not null,
  status           text not null default 'running'
                     check (status in ('running', 'completed', 'partial', 'failed', 'cancelled')),
  idempotency_key  uuid not null,
  inspected        integer not null default 0,
  created          integer not null default 0,
  updated          integer not null default 0,
  skipped          integer not null default 0,
  failed           integer not null default 0,
  conflicts        integer not null default 0,
  error_code       text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  error_summary    text check (error_summary is null or char_length(error_summary) <= 300),
  actor_id         uuid,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  unique (key, idempotency_key)
);
create index if not exists integration_sync_jobs_key_idx on public.integration_sync_jobs (key, started_at desc);

create table if not exists public.integration_sync_items (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.integration_sync_jobs (id) on delete cascade,
  position     integer not null,
  external_id  text,
  entity       text not null check (entity in ('variant', 'product', 'customer')),
  local_id     uuid,
  label        text check (label is null or char_length(label) <= 200),
  action       text not null check (action in ('create', 'update', 'link', 'unchanged', 'skip', 'conflict', 'invalid')),
  reason       text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  applied      boolean not null default false,
  detail       jsonb not null default '{}'::jsonb,
  unique (job_id, position)
);

create table if not exists public.integration_external_ids (
  key                  text not null references public.integration_configs (key) on delete cascade,
  entity               text not null check (entity in ('product', 'variant', 'customer', 'order', 'category')),
  external_id          text not null check (external_id ~ '^[A-Za-z0-9_.:/-]{1,120}$'),
  local_id             uuid not null,
  external_updated_at  timestamptz,
  synced_at            timestamptz not null default now(),
  primary key (key, entity, external_id),
  unique (key, entity, local_id)
);

create table if not exists public.integration_webhook_events (
  id                 bigint generated always as identity primary key,
  key                text not null references public.integration_configs (key) on delete cascade,
  provider_event_id  text not null check (char_length(provider_event_id) between 1 and 200),
  event_type         text check (event_type is null or char_length(event_type) <= 80),
  signature_valid    boolean not null,
  status             text not null check (status in ('accepted', 'rejected')),
  received_at        timestamptz not null default now(),
  unique (key, provider_event_id)
);

-- Delivery attempts for the optional external channels reuse the Phase 04 queue.
alter table public.notification_deliveries add column if not exists next_retry_at timestamptz;
alter table public.notification_deliveries add column if not exists last_attempt_at timestamptz;
alter table public.notification_deliveries add column if not exists error_code text
  check (error_code is null or error_code ~ '^[a-z_]{1,40}$');
alter table public.notification_deliveries add column if not exists external_ref text
  check (external_ref is null or char_length(external_ref) <= 200);
alter table public.notification_deliveries drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'disabled'));
create index if not exists notification_deliveries_due_idx on public.notification_deliveries (channel, next_retry_at)
  where status = 'queued';
create unique index if not exists notification_deliveries_external_ref_uidx
  on public.notification_deliveries (channel, external_ref) where external_ref is not null;

-- ── RLS: staff read via integrations.view; nobody writes directly ──────────
alter table public.integration_configs enable row level security;
alter table public.integration_health_checks enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_sync_items enable row level security;
alter table public.integration_external_ids enable row level security;
alter table public.integration_webhook_events enable row level security;

revoke all on public.integration_configs, public.integration_health_checks, public.integration_sync_jobs,
  public.integration_sync_items, public.integration_external_ids, public.integration_webhook_events
  from anon, authenticated;
grant select on public.integration_configs, public.integration_health_checks, public.integration_sync_jobs,
  public.integration_sync_items, public.integration_external_ids, public.integration_webhook_events
  to authenticated;

drop policy if exists integration_configs_staff_select on public.integration_configs;
create policy integration_configs_staff_select on public.integration_configs for select to authenticated
  using ((select app.has_permission('integrations.view')));
drop policy if exists integration_health_checks_staff_select on public.integration_health_checks;
create policy integration_health_checks_staff_select on public.integration_health_checks for select to authenticated
  using ((select app.has_permission('integrations.view')));
drop policy if exists integration_sync_jobs_staff_select on public.integration_sync_jobs;
create policy integration_sync_jobs_staff_select on public.integration_sync_jobs for select to authenticated
  using ((select app.has_permission('integrations.view')));
drop policy if exists integration_sync_items_staff_select on public.integration_sync_items;
create policy integration_sync_items_staff_select on public.integration_sync_items for select to authenticated
  using ((select app.has_permission('integrations.view')));
drop policy if exists integration_external_ids_staff_select on public.integration_external_ids;
create policy integration_external_ids_staff_select on public.integration_external_ids for select to authenticated
  using ((select app.has_permission('integrations.view')));
drop policy if exists integration_webhook_events_staff_select on public.integration_webhook_events;
create policy integration_webhook_events_staff_select on public.integration_webhook_events for select to authenticated
  using ((select app.has_permission('integrations.view')));

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Secret-looking keys or values are refused: configuration rows are not a secret store.
create or replace function app.integration_secret_like(p_key text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key ~* '(password|passwd|secret|token|api_?key|private|credential|signature|bearer)'
      or (jsonb_typeof(p_value) = 'string' and (
            (p_value #>> '{}') ~ '^(sk-|sk_live_|sk_test_|rk_live_|xox[abprs]-|EAA[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_|glpat-|sb_secret_)'
         or (p_value #>> '{}') ~ '-----BEGIN'
         or (p_value #>> '{}') ~ '^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.'
         or (p_value #>> '{}') ~ '^[A-Za-z0-9+/=_-]{40,}$'));
$$;

-- Required public settings present (social sign-in: at least one provider switched on).
create or replace function app.integration_config_complete(p_config public.integration_configs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_config.provider is not null
     and (app.integration_catalog() -> p_config.key -> 'providers') ? p_config.provider
     and not exists (
       select 1 from jsonb_each(app.integration_catalog() -> p_config.key -> 'settings') f
       where (f.value ->> 'required')::boolean
         and coalesce(nullif(btrim(p_config.settings ->> f.key), ''), null) is null)
     and (p_config.key <> 'social_auth'
          or coalesce((p_config.settings ->> 'google')::boolean, false)
          or coalesce((p_config.settings ->> 'apple')::boolean, false));
$$;

create or replace function app.integration_config_json(p_config public.integration_configs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'key', p_config.key, 'provider', p_config.provider, 'enabled', p_config.enabled,
    'settings', p_config.settings, 'ownership', p_config.ownership, 'direction', p_config.direction,
    'templateMap', p_config.template_map, 'complete', app.integration_config_complete(p_config),
    'lastCheckAt', p_config.last_check_at, 'lastCheckStatus', p_config.last_check_status,
    'lastCheckCode', p_config.last_check_code, 'lastCheckMessage', p_config.last_check_message,
    'lastCheckLatencyMs', p_config.last_check_latency_ms, 'lastOkAt', p_config.last_ok_at,
    'consecutiveFailures', p_config.consecutive_failures, 'circuitOpenUntil', p_config.circuit_open_until,
    'lastSyncAt', p_config.last_sync_at, 'updatedAt', p_config.updated_at);
$$;

-- ── Staff RPCs ──────────────────────────────────────────────────────────────
create or replace function public.admin_integrations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.view');
begin
  return jsonb_build_object(
    'integrations', coalesce((
      select jsonb_agg(app.integration_config_json(c) || jsonb_build_object(
        'lastSync', (select jsonb_build_object('id', j.id, 'domain', j.domain, 'dryRun', j.dry_run, 'status', j.status,
                                               'startedAt', j.started_at, 'finishedAt', j.finished_at)
                     from public.integration_sync_jobs j where j.key = c.key order by j.started_at desc limit 1),
        'deliveries', case when c.key in ('email', 'whatsapp', 'sms') then (
          select jsonb_build_object(
            'queued', count(*) filter (where d.status = 'queued'),
            'failed', count(*) filter (where d.status = 'failed'),
            'sent', count(*) filter (where d.status in ('sent', 'delivered')))
          from public.notification_deliveries d where d.channel = c.key) end)
        order by c.key)
      from public.integration_configs c), '[]'::jsonb),
    'notificationChannels', (select value -> 'channels' from public.site_settings where key = 'notifications'),
    'canManage', app.has_permission('integrations.manage'),
    'canTest', app.has_permission('integrations.test'),
    'canSync', app.has_permission('integrations.sync'));
end;
$$;

create or replace function public.admin_save_integration(p_key text, p_provider text, p_settings jsonb,
                                                         p_ownership jsonb default '{}'::jsonb,
                                                         p_direction text default 'import',
                                                         p_template_map jsonb default '{}'::jsonb,
                                                         p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.manage');
  v_spec jsonb := app.integration_catalog() -> p_key;
  v_before public.integration_configs;
  v_after public.integration_configs;
  v_key text;
  v_value jsonb;
  v_field jsonb;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_ownership jsonb := coalesce(p_ownership, '{}'::jsonb);
  v_templates jsonb := coalesce(p_template_map, '{}'::jsonb);
  v_provider_changed boolean;
begin
  if v_spec is null then return jsonb_build_object('ok', false, 'code', 'unknown_integration'); end if;
  select * into v_before from public.integration_configs where key = p_key for update;
  if p_expected_updated_at is not null and v_before.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'stale');
  end if;
  if p_provider is null or not ((v_spec -> 'providers') ? p_provider) then
    return jsonb_build_object('ok', false, 'code', 'invalid_provider', 'field', 'provider');
  end if;
  if jsonb_typeof(v_settings) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_settings');
  end if;
  for v_key, v_value in select key, value from jsonb_each(v_settings) loop
    v_field := v_spec -> 'settings' -> v_key;
    if v_field is null then
      return jsonb_build_object('ok', false, 'code', 'unknown_setting', 'field', v_key);
    end if;
    if app.integration_secret_like(v_key, v_value) then
      return jsonb_build_object('ok', false, 'code', 'secret_not_allowed', 'field', v_key);
    end if;
    if jsonb_typeof(v_value) not in ('string', 'number', 'boolean', 'null')
       or (jsonb_typeof(v_value) = 'string' and char_length(v_value #>> '{}') > 300)
       or (v_field ->> 'type' = 'boolean' and jsonb_typeof(v_value) not in ('boolean', 'null'))
       or (v_field ->> 'type' = 'number' and jsonb_typeof(v_value) not in ('number', 'null'))
       or (v_field ->> 'type' = 'url' and jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') !~ '^https://[^\s/$.?#][^\s]*$')
       or (v_field ->> 'type' = 'email' and jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$') then
      return jsonb_build_object('ok', false, 'code', 'invalid_setting', 'field', v_key);
    end if;
  end loop;
  -- Source-of-truth ownership: only for the catalog's sync domains.
  if jsonb_typeof(v_ownership) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid_ownership'); end if;
  for v_key, v_value in select key, value from jsonb_each(v_ownership) loop
    if not ((v_spec -> 'syncDomains') ? v_key)
       or coalesce(v_value #>> '{}', '') not in ('malek', 'external', 'external_wins') then
      return jsonb_build_object('ok', false, 'code', 'invalid_ownership', 'field', v_key);
    end if;
  end loop;
  -- Two-way sync stays off until conflict handling for writes back to the provider is defined.
  if p_direction = 'two_way' then return jsonb_build_object('ok', false, 'code', 'two_way_unsupported'); end if;
  if p_direction not in ('import', 'export') then return jsonb_build_object('ok', false, 'code', 'invalid_direction'); end if;
  -- Event → provider template mapping (messaging channels): known events, safe template IDs.
  if jsonb_typeof(v_templates) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid_template_map'); end if;
  for v_key, v_value in select key, value from jsonb_each(v_templates) loop
    if v_spec ->> 'channel' is null
       or not exists (select 1 from public.notification_templates t where t.key = v_key)
       or jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') !~ '^[A-Za-z0-9_.:-]{1,100}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_template_map', 'field', v_key);
    end if;
  end loop;

  v_provider_changed := v_before.provider is distinct from p_provider;
  update public.integration_configs
     set provider = p_provider,
         settings = v_settings,
         ownership = v_ownership,
         direction = p_direction,
         template_map = v_templates,
         -- A provider change starts over: disabled, untested.
         enabled = case when v_provider_changed then false else enabled end,
         last_check_at = case when v_provider_changed then null else last_check_at end,
         last_check_status = case when v_provider_changed then null else last_check_status end,
         last_check_code = case when v_provider_changed then null else last_check_code end,
         last_check_message = case when v_provider_changed then null else last_check_message end,
         consecutive_failures = case when v_provider_changed then 0 else consecutive_failures end,
         circuit_open_until = case when v_provider_changed then null else circuit_open_until end,
         updated_at = now(), updated_by = v_uid
   where key = p_key returning * into v_after;
  if not app.integration_config_complete(v_after) and v_after.enabled then
    update public.integration_configs set enabled = false where key = p_key returning * into v_after;
  end if;
  perform app.log_event(case when v_provider_changed and v_before.provider is not null
                             then 'integration.provider_changed' else 'integration.configured' end,
    'public.integration_configs', p_key,
    jsonb_build_object('provider', v_before.provider, 'settings', v_before.settings, 'ownership', v_before.ownership,
                       'direction', v_before.direction, 'templateMap', v_before.template_map),
    jsonb_build_object('provider', v_after.provider, 'settings', v_after.settings, 'ownership', v_after.ownership,
                       'direction', v_after.direction, 'templateMap', v_after.template_map),
    '{}'::jsonb);
  return jsonb_build_object('ok', true, 'integration', app.integration_config_json(v_after));
end;
$$;

create or replace function public.admin_set_integration_enabled(p_key text, p_enabled boolean, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.manage');
  v_config public.integration_configs;
  v_skipped integer := 0;
begin
  select * into v_config from public.integration_configs where key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown_integration'); end if;
  if p_enabled and not app.integration_config_complete(v_config) then
    return jsonb_build_object('ok', false, 'code', 'not_configured');
  end if;
  if v_config.enabled = p_enabled then return jsonb_build_object('ok', false, 'code', 'no_change'); end if;
  update public.integration_configs set enabled = p_enabled, updated_at = now(), updated_by = v_uid
   where key = p_key returning * into v_config;
  -- Disabling stops new outbound actions: queued deliveries are skipped (history is kept).
  if not p_enabled and p_key in ('email', 'whatsapp', 'sms') then
    update public.notification_deliveries
       set status = 'skipped', error_code = 'provider_disabled', next_retry_at = null, updated_at = now()
     where channel = p_key and status in ('queued', 'sending');
    get diagnostics v_skipped = row_count;
  end if;
  perform app.log_event(case when p_enabled then 'integration.enabled' else 'integration.disabled' end,
    'public.integration_configs', p_key, jsonb_build_object('enabled', not p_enabled),
    jsonb_build_object('enabled', p_enabled),
    jsonb_build_object('reason', nullif(left(btrim(coalesce(p_reason, '')), 300), ''), 'skippedDeliveries', v_skipped));
  return jsonb_build_object('ok', true, 'integration', app.integration_config_json(v_config), 'skippedDeliveries', v_skipped);
end;
$$;

-- Remove the configuration: provider settings go, Malek data and every log / mapping stay.
create or replace function public.admin_remove_integration(p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.manage');
  v_before public.integration_configs;
  v_after public.integration_configs;
begin
  select * into v_before from public.integration_configs where key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown_integration'); end if;
  update public.integration_configs
     set provider = null, enabled = false, settings = '{}'::jsonb, ownership = '{}'::jsonb, direction = 'import',
         template_map = '{}'::jsonb, last_check_at = null, last_check_status = null, last_check_code = null,
         last_check_message = null, last_check_latency_ms = null, consecutive_failures = 0, circuit_open_until = null,
         updated_at = now(), updated_by = v_uid
   where key = p_key returning * into v_after;
  if p_key in ('email', 'whatsapp', 'sms') then
    update public.notification_deliveries
       set status = 'skipped', error_code = 'provider_removed', next_retry_at = null, updated_at = now()
     where channel = p_key and status in ('queued', 'sending');
  end if;
  perform app.log_event('integration.removed', 'public.integration_configs', p_key,
    jsonb_build_object('provider', v_before.provider, 'settings', v_before.settings), null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'integration', app.integration_config_json(v_after));
end;
$$;

-- Shared bookkeeping for a health-check result (server runtime or client-checkable integrations).
create or replace function app.integration_store_check(p_key text, p_status text, p_code text, p_message text,
                                                       p_latency integer, p_actor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.integration_configs;
  v_message text := nullif(left(regexp_replace(coalesce(p_message, ''),
    '(Bearer\s+\S+|[A-Za-z0-9+/=_-]{32,}|eyJ[A-Za-z0-9._-]+)', '[redacted]', 'g'), 300), '');
begin
  if p_status not in ('connected', 'failed') or p_code !~ '^[a-z_]{1,40}$' then
    raise exception 'invalid health result' using errcode = '22023';
  end if;
  insert into public.integration_health_checks (key, status, code, message, latency_ms, actor_id)
  values (p_key, p_status, p_code, v_message, p_latency, p_actor);
  update public.integration_configs
     set last_check_at = now(), last_check_status = p_status, last_check_code = p_code,
         last_check_message = v_message, last_check_latency_ms = p_latency,
         last_ok_at = case when p_status = 'connected' then now() else last_ok_at end,
         consecutive_failures = case when p_status = 'connected' then 0 else consecutive_failures + 1 end,
         -- Lightweight circuit breaker: three failures in a row pause outbound calls for 5 minutes.
         circuit_open_until = case
           when p_status = 'connected' then null
           when consecutive_failures + 1 >= 3 then now() + interval '5 minutes'
           else circuit_open_until end
   where key = p_key returning * into v_config;
  perform app.log_event('integration.tested', 'public.integration_configs', p_key, null,
    jsonb_build_object('status', p_status, 'code', p_code), jsonb_build_object('latencyMs', p_latency));
  return jsonb_build_object('ok', true, 'integration', app.integration_config_json(v_config));
end;
$$;

create or replace function public.integration_record_check(p_key text, p_status text, p_code text,
                                                           p_message text default null, p_latency integer default null,
                                                           p_actor uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  if not exists (select 1 from public.integration_configs where key = p_key) then
    return jsonb_build_object('ok', false, 'code', 'unknown_integration');
  end if;
  return app.integration_store_check(p_key, p_status, p_code, p_message, p_latency, p_actor);
end;
$$;

-- Client-checkable integrations (GA measurement ID format, Supabase Auth's public settings).
create or replace function public.admin_record_client_check(p_key text, p_status text, p_code text,
                                                            p_message text default null, p_latency integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.test');
begin
  if coalesce(app.integration_catalog() -> p_key ->> 'check', '') <> 'client' then
    return jsonb_build_object('ok', false, 'code', 'server_check_required');
  end if;
  return app.integration_store_check(p_key, p_status, p_code, p_message, p_latency, v_uid);
end;
$$;

create or replace function public.admin_list_integration_checks(p_key text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.view');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'code', h.code, 'message', h.message,
                                        'latencyMs', h.latency_ms, 'checkedAt', h.checked_at) order by h.checked_at desc)
    from (select * from public.integration_health_checks where key = p_key
          order by checked_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) h), '[]'::jsonb);
end;
$$;

-- ── Sync (ERP / POS) ────────────────────────────────────────────────────────
create or replace function public.admin_start_integration_sync(p_key text, p_domain text, p_dry_run boolean,
                                                               p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.sync');
  v_config public.integration_configs;
  v_job public.integration_sync_jobs;
begin
  select * into v_config from public.integration_configs where key = p_key;
  if not found or not ((app.integration_catalog() -> p_key -> 'syncDomains') ? coalesce(p_domain, '')) then
    return jsonb_build_object('ok', false, 'code', 'sync_unsupported');
  end if;
  if p_idempotency_key is null then return jsonb_build_object('ok', false, 'code', 'idempotency_required'); end if;
  select * into v_job from public.integration_sync_jobs where key = p_key and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'jobId', v_job.id, 'duplicate', true, 'status', v_job.status);
  end if;
  if not app.integration_config_complete(v_config) then return jsonb_build_object('ok', false, 'code', 'not_configured'); end if;
  if not p_dry_run and not v_config.enabled then return jsonb_build_object('ok', false, 'code', 'not_enabled'); end if;
  if v_config.circuit_open_until is not null and v_config.circuit_open_until > now() then
    return jsonb_build_object('ok', false, 'code', 'circuit_open');
  end if;
  if exists (select 1 from public.integration_sync_jobs where key = p_key and status = 'running'
             and started_at > now() - interval '15 minutes') then
    return jsonb_build_object('ok', false, 'code', 'sync_running');
  end if;
  insert into public.integration_sync_jobs (key, domain, dry_run, idempotency_key, actor_id)
  values (p_key, p_domain, coalesce(p_dry_run, true), p_idempotency_key, v_uid) returning * into v_job;
  perform app.log_event('integration.sync_started', 'public.integration_sync_jobs', v_job.id::text, null,
    jsonb_build_object('key', p_key, 'domain', p_domain, 'dryRun', v_job.dry_run), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'jobId', v_job.id, 'duplicate', false, 'status', v_job.status);
end;
$$;

create or replace function public.admin_cancel_integration_sync(p_job_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.sync');
  v_job public.integration_sync_jobs;
begin
  update public.integration_sync_jobs set status = 'cancelled', finished_at = now(), error_code = 'cancelled'
   where id = p_job_id and status = 'running' returning * into v_job;
  if not found then return jsonb_build_object('ok', false, 'code', 'job_not_running'); end if;
  perform app.log_event('integration.sync_failed', 'public.integration_sync_jobs', v_job.id::text, null,
    jsonb_build_object('key', v_job.key, 'status', 'cancelled'), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app.sync_job_json(p_job public.integration_sync_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p_job.id, 'key', p_job.key, 'domain', p_job.domain, 'direction', p_job.direction,
    'dryRun', p_job.dry_run, 'status', p_job.status, 'inspected', p_job.inspected, 'created', p_job.created,
    'updated', p_job.updated, 'skipped', p_job.skipped, 'failed', p_job.failed, 'conflicts', p_job.conflicts,
    'errorCode', p_job.error_code, 'errorSummary', p_job.error_summary, 'startedAt', p_job.started_at,
    'finishedAt', p_job.finished_at,
    'actorName', (select coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1))
                  from auth.users u left join public.profiles p on p.id = u.id where u.id = p_job.actor_id));
$$;

create or replace function public.admin_list_sync_jobs(p_key text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.view');
begin
  return coalesce((select jsonb_agg(app.sync_job_json(j) order by j.started_at desc)
    from (select * from public.integration_sync_jobs where key = p_key
          order by started_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) j), '[]'::jsonb);
end;
$$;

create or replace function public.admin_get_sync_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.view');
  v_job public.integration_sync_jobs;
begin
  select * into v_job from public.integration_sync_jobs where id = p_job_id;
  if not found then return null; end if;
  return app.sync_job_json(v_job) || jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('position', i.position, 'externalId', i.external_id, 'entity', i.entity,
      'localId', i.local_id, 'label', i.label, 'action', i.action, 'reason', i.reason, 'applied', i.applied,
      'detail', i.detail) order by i.position)
    from public.integration_sync_items i where i.job_id = p_job_id), '[]'::jsonb));
end;
$$;

-- Plan one external record against Malek data (pure decision, no writes).
-- Ownership per domain: malek (external ignored) · external (external applied; local edits since the
-- last sync → review) · external_wins (external always applied). Stock never goes below active
-- reservations, whatever the policy.
create or replace function app.integration_plan_record(p_key text, p_domain text, p_owner text, p_record jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ext text := nullif(btrim(coalesce(p_record ->> 'externalId', '')), '');
  v_sku text := nullif(btrim(coalesce(p_record ->> 'sku', '')), '');
  v_updated timestamptz;
  v_map public.integration_external_ids;
  v_variant public.product_variants;
  v_price numeric;
  v_compare numeric;
  v_stock integer;
  v_reserved integer;
  v_user uuid;
  v_email text := lower(nullif(btrim(coalesce(p_record ->> 'email', '')), ''));
  v_entity text := case p_domain when 'customers' then 'customer' else 'variant' end;
  v_label text := left(coalesce(p_record ->> 'name', v_sku, v_email, v_ext), 200);
  v_local_newer boolean;
begin
  if v_ext is null or v_ext !~ '^[A-Za-z0-9_.:/-]{1,120}$' then
    return jsonb_build_object('action', 'invalid', 'reason', 'invalid_external_id', 'entity', v_entity, 'label', v_label);
  end if;
  begin
    v_updated := nullif(p_record ->> 'updatedAt', '')::timestamptz;
  exception when others then
    return jsonb_build_object('action', 'invalid', 'reason', 'invalid_timestamp', 'entity', v_entity, 'externalId', v_ext);
  end;

  -- Customers: explicit external ID, else the exact (verified, sign-in) email. Never fuzzy names.
  if p_domain = 'customers' then
    select * into v_map from public.integration_external_ids where key = p_key and entity = 'customer' and external_id = v_ext;
    if found then
      return jsonb_build_object('action', 'unchanged', 'entity', 'customer', 'externalId', v_ext, 'localId', v_map.local_id, 'label', v_label);
    end if;
    if v_email is not null then select id into v_user from auth.users where lower(email) = v_email; end if;
    if v_user is null then
      return jsonb_build_object('action', 'create', 'reason', 'review_required', 'entity', 'customer', 'externalId', v_ext, 'label', v_label);
    end if;
    if exists (select 1 from public.integration_external_ids where key = p_key and entity = 'customer' and local_id = v_user) then
      return jsonb_build_object('action', 'conflict', 'reason', 'already_linked', 'entity', 'customer', 'externalId', v_ext, 'localId', v_user, 'label', v_label);
    end if;
    return jsonb_build_object('action', 'link', 'entity', 'customer', 'externalId', v_ext, 'localId', v_user, 'label', v_label);
  end if;

  -- Variants: mapping first, else the exact SKU.
  select * into v_map from public.integration_external_ids where key = p_key and entity = 'variant' and external_id = v_ext;
  if found then
    select * into v_variant from public.product_variants where id = v_map.local_id and deleted_at is null;
  elsif v_sku is not null then
    select * into v_variant from public.product_variants where sku = v_sku and deleted_at is null;
  end if;
  if v_variant.id is null then
    if p_domain = 'products' then
      return jsonb_build_object('action', 'create', 'reason', 'review_required', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
    end if;
    return jsonb_build_object('action', 'skip', 'reason', 'unmatched', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
  end if;
  v_label := left(coalesce(v_variant.sku, v_label), 200);
  if v_map.local_id is null and exists (
       select 1 from public.integration_external_ids where key = p_key and entity = 'variant' and local_id = v_variant.id) then
    return jsonb_build_object('action', 'conflict', 'reason', 'already_linked', 'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label);
  end if;
  if p_domain = 'products' then
    return jsonb_build_object('action', case when v_map.local_id is null then 'link' else 'unchanged' end,
      'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label);
  end if;

  if p_domain = 'prices' then
    begin
      v_price := (p_record ->> 'price')::numeric;
      v_compare := nullif(p_record ->> 'compareAt', '')::numeric;
    exception when others then
      return jsonb_build_object('action', 'invalid', 'reason', 'invalid_price', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
    end;
    if v_price is null or v_price < 0 or v_price > 10000000 or (v_compare is not null and v_compare <= v_price) then
      return jsonb_build_object('action', 'invalid', 'reason', 'invalid_price', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
    end if;
    v_price := round(v_price, 2);
  else
    begin
      v_stock := (p_record ->> 'stock')::integer;
    exception when others then
      return jsonb_build_object('action', 'invalid', 'reason', 'invalid_stock', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
    end;
    if v_stock is null or v_stock < 0 or v_stock > 1000000 then
      return jsonb_build_object('action', 'invalid', 'reason', 'invalid_stock', 'entity', 'variant', 'externalId', v_ext, 'label', v_label);
    end if;
  end if;

  if p_owner = 'malek' then
    return jsonb_build_object('action', 'skip', 'reason', 'owned_by_malek', 'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label);
  end if;
  if (p_domain = 'prices' and v_variant.price is not distinct from v_price
        and (v_compare is null or v_variant.compare_at_price is not distinct from v_compare))
     or (p_domain = 'stock' and v_variant.stock_quantity = v_stock) then
    return jsonb_build_object('action', 'unchanged', 'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label,
      'link', v_map.local_id is null);
  end if;
  if v_map.local_id is not null and v_updated is not null and v_map.external_updated_at is not null
     and v_updated <= v_map.external_updated_at then
    return jsonb_build_object('action', 'skip', 'reason', 'not_newer', 'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label);
  end if;
  if p_domain = 'stock' then
    v_reserved := app.variant_reserved_quantity(v_variant.id, null);
    if v_stock < v_reserved then
      return jsonb_build_object('action', 'conflict', 'reason', 'below_reserved', 'entity', 'variant', 'externalId', v_ext,
        'localId', v_variant.id, 'label', v_label, 'detail', jsonb_build_object('stock', v_stock, 'reserved', v_reserved));
    end if;
  end if;
  if p_owner = 'external' then
    v_local_newer := case
      when v_map.local_id is not null then v_variant.updated_at > v_map.synced_at
      when v_updated is not null then v_variant.updated_at > v_updated
      else true end;
    if v_local_newer then
      return jsonb_build_object('action', 'conflict', 'reason',
        case when v_map.local_id is null and v_updated is null then 'no_timestamp' else 'local_changed' end,
        'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id, 'label', v_label,
        'detail', case when p_domain = 'prices'
          then jsonb_build_object('before', v_variant.price, 'after', v_price)
          else jsonb_build_object('before', v_variant.stock_quantity, 'after', v_stock) end);
    end if;
  end if;
  return jsonb_build_object('action', 'update', 'entity', 'variant', 'externalId', v_ext, 'localId', v_variant.id,
    'label', v_label, 'link', v_map.local_id is null,
    'detail', case when p_domain = 'prices'
      then jsonb_build_object('before', v_variant.price, 'after', v_price, 'compareAt', v_compare)
      else jsonb_build_object('before', v_variant.stock_quantity, 'after', v_stock) end);
end;
$$;

create or replace function app.integration_link(p_key text, p_entity text, p_external text, p_local uuid,
                                                p_external_updated timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.integration_external_ids (key, entity, external_id, local_id, external_updated_at, synced_at)
  values (p_key, p_entity, p_external, p_local, p_external_updated, now())
  on conflict (key, entity, external_id) do update
    set local_id = excluded.local_id,
        external_updated_at = coalesce(excluded.external_updated_at, public.integration_external_ids.external_updated_at),
        synced_at = now();
$$;

-- Server runtime → records the external records it fetched; plans every record and, for an applied
-- (non dry-run) job, writes the safe changes through the normal history paths.
create or replace function public.integration_record_sync_result(p_job_id uuid, p_records jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.integration_sync_jobs;
  v_config public.integration_configs;
  v_owner text;
  v_record jsonb;
  v_position integer;
  v_plan jsonb;
  v_applied boolean;
  v_variant public.product_variants;
  v_after numeric;
  v_qty integer;
  v_status text;
  v_counts jsonb := '{"create":0,"update":0,"link":0,"unchanged":0,"skip":0,"conflict":0,"invalid":0}'::jsonb;
  v_updated timestamptz;
begin
  perform app.require_service_role();
  select * into v_job from public.integration_sync_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'job_not_found'); end if;
  if v_job.status <> 'running' then return jsonb_build_object('ok', false, 'code', 'job_not_running'); end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 5000 then
    update public.integration_sync_jobs set status = 'failed', error_code = 'invalid_payload', finished_at = now()
     where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into v_config from public.integration_configs where key = v_job.key;
  v_owner := coalesce(v_config.ownership ->> v_job.domain, 'malek');
  if v_job.domain = 'products' or v_job.domain = 'customers' then v_owner := 'external'; end if;

  for v_record, v_position in select e, i from jsonb_array_elements(p_records) with ordinality as a (e, i) loop
    v_plan := app.integration_plan_record(v_job.key, v_job.domain,
                case when v_job.domain in ('prices', 'stock') then coalesce(v_config.ownership ->> v_job.domain, 'malek') else v_owner end,
                v_record);
    v_applied := false;
    begin
      v_updated := nullif(v_record ->> 'updatedAt', '')::timestamptz;
    exception when others then v_updated := null;
    end;
    if not v_job.dry_run then
      if v_plan ->> 'action' = 'update' and v_job.domain = 'prices' then
        select * into v_variant from public.product_variants where id = (v_plan ->> 'localId')::uuid for update;
        v_after := (v_plan -> 'detail' ->> 'after')::numeric;
        perform set_config('app.change_source', 'integration', true);
        perform set_config('app.change_reason', 'Integration sync: ' || v_job.key, true);
        update public.product_variants
           set price = v_after,
               compare_at_price = case when v_plan -> 'detail' ? 'compareAt' and v_plan -> 'detail' ->> 'compareAt' is not null
                                       then (v_plan -> 'detail' ->> 'compareAt')::numeric else compare_at_price end
         where id = v_variant.id;
        perform set_config('app.change_source', '', true);
        perform set_config('app.change_reason', '', true);
        perform app.log_event('price.changed', 'public.product_variants', v_variant.sku,
          jsonb_build_object('price', v_variant.price), jsonb_build_object('price', v_after),
          jsonb_build_object('source', 'integration:' || v_job.key, 'jobId', v_job.id));
        perform app.integration_link(v_job.key, 'variant', v_plan ->> 'externalId', v_variant.id, v_updated);
        v_applied := true;
      elsif v_plan ->> 'action' = 'update' and v_job.domain = 'stock' then
        select * into v_variant from public.product_variants where id = (v_plan ->> 'localId')::uuid for update;
        v_qty := (v_plan -> 'detail' ->> 'after')::integer;
        -- Re-check under the row lock: reservations may have changed since planning.
        if v_qty < app.variant_reserved_quantity(v_variant.id, null) then
          v_plan := v_plan || jsonb_build_object('action', 'conflict', 'reason', 'below_reserved');
        else
          update public.product_variants set stock_quantity = v_qty where id = v_variant.id;
          insert into public.stock_movements (variant_id, delta, quantity_before, quantity_after, reason, actor_id, note, is_demo)
          values (v_variant.id, v_qty - v_variant.stock_quantity, v_variant.stock_quantity, v_qty, 'external_sync',
                  v_job.actor_id, 'Integration sync: ' || v_job.key, v_variant.is_demo);
          perform app.log_event('stock.adjusted', 'public.product_variants', v_variant.sku,
            jsonb_build_object('quantity', v_variant.stock_quantity), jsonb_build_object('quantity', v_qty),
            jsonb_build_object('type', 'external_sync', 'source', 'integration:' || v_job.key, 'jobId', v_job.id));
          perform app.integration_link(v_job.key, 'variant', v_plan ->> 'externalId', v_variant.id, v_updated);
          v_applied := true;
        end if;
      elsif v_plan ->> 'action' = 'link'
            or (v_plan ->> 'action' = 'unchanged' and coalesce((v_plan ->> 'link')::boolean, false)) then
        perform app.integration_link(v_job.key, v_plan ->> 'entity', v_plan ->> 'externalId',
                                     (v_plan ->> 'localId')::uuid, v_updated);
        v_applied := v_plan ->> 'action' = 'link';
      end if;
    end if;
    v_counts := jsonb_set(v_counts, array[v_plan ->> 'action'], to_jsonb((v_counts ->> (v_plan ->> 'action'))::int + 1));
    insert into public.integration_sync_items (job_id, position, external_id, entity, local_id, label, action, reason, applied, detail)
    values (p_job_id, v_position, left(v_plan ->> 'externalId', 120), v_plan ->> 'entity',
            nullif(v_plan ->> 'localId', '')::uuid, v_plan ->> 'label', v_plan ->> 'action', v_plan ->> 'reason',
            v_applied, coalesce(v_plan -> 'detail', '{}'::jsonb));
  end loop;

  v_status := case when (v_counts ->> 'conflict')::int + (v_counts ->> 'invalid')::int > 0 then 'partial' else 'completed' end;
  update public.integration_sync_jobs
     set status = v_status, finished_at = now(),
         inspected = coalesce(jsonb_array_length(p_records), 0),
         created = (v_counts ->> 'link')::int + (v_counts ->> 'create')::int,
         updated = (v_counts ->> 'update')::int,
         skipped = (v_counts ->> 'skip')::int + (v_counts ->> 'unchanged')::int,
         failed = (v_counts ->> 'invalid')::int,
         conflicts = (v_counts ->> 'conflict')::int
   where id = p_job_id returning * into v_job;
  update public.integration_configs set last_sync_at = now() where key = v_job.key;
  perform app.log_event('integration.sync_completed', 'public.integration_sync_jobs', v_job.id::text, null,
    jsonb_build_object('key', v_job.key, 'domain', v_job.domain, 'dryRun', v_job.dry_run, 'status', v_status),
    v_counts);
  return jsonb_build_object('ok', true, 'job', app.sync_job_json(v_job));
end;
$$;

create or replace function public.integration_fail_sync(p_job_id uuid, p_code text, p_summary text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.integration_sync_jobs;
begin
  perform app.require_service_role();
  update public.integration_sync_jobs
     set status = 'failed', finished_at = now(),
         error_code = case when p_code ~ '^[a-z_]{1,40}$' then p_code else 'provider_error' end,
         error_summary = nullif(left(regexp_replace(coalesce(p_summary, ''),
           '(Bearer\s+\S+|[A-Za-z0-9+/=_-]{32,}|eyJ[A-Za-z0-9._-]+)', '[redacted]', 'g'), 300), '')
   where id = p_job_id and status = 'running' returning * into v_job;
  if not found then return jsonb_build_object('ok', false, 'code', 'job_not_running'); end if;
  perform app.log_event('integration.sync_failed', 'public.integration_sync_jobs', v_job.id::text, null,
    jsonb_build_object('key', v_job.key, 'status', 'failed', 'code', v_job.error_code), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'job', app.sync_job_json(v_job));
end;
$$;

-- Authoritative order snapshot for an ERP / POS export: customer-facing facts only (no internal
-- notes, no payment proofs, no staff data). The provider never edits the recorded order.
create or replace function public.integration_order_snapshot(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  perform app.require_service_role();
  select * into o from public.orders where id = p_order_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'orderNumber', o.order_number, 'createdAt', o.created_at, 'status', o.status, 'currency', 'EGP',
    'fulfillment', o.fulfillment_method, 'subtotal', o.subtotal, 'discountTotal', o.discount_total,
    'shippingFee', o.shipping_fee, 'total', o.total,
    'customer', jsonb_build_object('name', o.customer_name, 'phone', o.customer_phone,
                                   'externalId', (select external_id from public.integration_external_ids
                                                  where entity = 'customer' and local_id = o.customer_id limit 1)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'quantity', l.quantity, 'unitPrice', l.unit_price,
                                                           'lineTotal', l.line_total, 'isGift', l.is_gift) order by l.line_no)
                       from public.order_items l where l.order_id = o.id), '[]'::jsonb));
end;
$$;

-- Export bookkeeping: an order is pushed to a provider once (its external ID is the receipt).
create or replace function public.integration_record_order_export(p_key text, p_order_id uuid, p_external_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  perform app.require_service_role();
  select external_id into v_existing from public.integration_external_ids
   where key = p_key and entity = 'order' and local_id = p_order_id;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'externalId', v_existing);
  end if;
  insert into public.integration_external_ids (key, entity, external_id, local_id) values (p_key, 'order', p_external_id, p_order_id);
  perform app.log_event('integration.order_exported', 'public.orders', p_order_id::text, null,
    jsonb_build_object('key', p_key, 'externalId', p_external_id), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'duplicate', false, 'externalId', p_external_id);
end;
$$;

-- ── Notification routing: external channels only when provider enabled AND event mapped ─
create or replace function app.notification_channel_available(p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_channel = 'in_app' or (
    coalesce((select (s.value -> 'channels' -> p_channel ->> 'enabled')::boolean
              from public.site_settings s where s.key = 'notifications'), false)
    and exists (select 1 from public.integration_configs c where c.key = p_channel and c.enabled));
$$;

create or replace function app.integration_event_allowed(p_channel text, p_template text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_template is not null and exists (
    select 1 from public.integration_configs c where c.key = p_channel and c.enabled and c.template_map ? p_template);
$$;

create or replace function app.notify(p_user uuid, p_template text, p_vars jsonb, p_dedupe text,
                                      p_action text default null, p_data jsonb default '{}'::jsonb,
                                      p_is_demo boolean default false,
                                      p_title jsonb default null, p_body jsonb default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.notification_templates;
  v_category text;
  v_title jsonb;
  v_body jsonb;
  v_id uuid;
  v_channel text;
begin
  if p_user is null then return null; end if;
  if p_template is not null then
    select * into t from public.notification_templates where key = p_template and is_active;
    if not found then return null; end if;
    v_category := t.category;
    v_title := jsonb_build_object('ar', app.render_template(t.title ->> 'ar', p_vars, 'ar'),
                                  'en', app.render_template(coalesce(t.title ->> 'en', t.title ->> 'ar'), p_vars, 'en'));
    v_body := jsonb_build_object('ar', app.render_template(t.body ->> 'ar', p_vars, 'ar'),
                                 'en', app.render_template(coalesce(t.body ->> 'en', t.body ->> 'ar'), p_vars, 'en'));
  else
    v_category := 'account';
    v_title := p_title;
    v_body := p_body;
  end if;

  if not app.notification_category_mandatory(v_category) and exists (
    select 1 from public.notification_preferences
    where user_id = p_user and category = v_category and channel = 'in_app' and not enabled) then
    return null;
  end if;

  insert into public.notifications (user_id, category, template_key, title, body, action_path, data, dedupe_key, is_demo)
  values (p_user, v_category, p_template, v_title, v_body, p_action, coalesce(p_data, '{}'::jsonb), p_dedupe, coalesce(p_is_demo, false))
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;

  -- Phase 09 router: in-app always; an external channel only when its provider is enabled, the
  -- channel is switched on, the event is mapped for that channel and the customer opted in.
  -- One delivery per notification × channel (idempotent); demo rows never go out.
  if v_id is not null and not coalesce(p_is_demo, false) then
    foreach v_channel in array array['email', 'whatsapp', 'sms'] loop
      if app.notification_channel_available(v_channel) and app.integration_event_allowed(v_channel, p_template)
         and exists (
           select 1 from public.notification_preferences
           where user_id = p_user and category = v_category and channel = v_channel and enabled) then
        insert into public.notification_deliveries (notification_id, channel, provider, next_retry_at)
        values (v_id, v_channel, (select provider from public.integration_configs where key = v_channel), now())
        on conflict do nothing;
      end if;
    end loop;
  end if;
  return v_id;
end;
$$;

create or replace function app.delivery_json(d public.notification_deliveries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'channel', d.channel, 'status', d.status, 'provider', d.provider,
    'attempts', d.attempts, 'errorCode', d.error_code, 'externalRef', d.external_ref,
    'lastAttemptAt', d.last_attempt_at, 'nextRetryAt', d.next_retry_at, 'createdAt', d.created_at,
    'templateKey', n.template_key, 'category', n.category,
    'reference', coalesce(n.data ->> 'orderNumber', n.data ->> 'requestNumber'))
  from public.notifications n where n.id = d.notification_id;
$$;

create or replace function public.admin_list_deliveries(p_channel text default null, p_status text default null,
                                                        p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['integrations.view', 'notifications.manage']);
begin
  return coalesce((select jsonb_agg(app.delivery_json(d) order by d.created_at desc)
    from (select * from public.notification_deliveries
          where (p_channel is null or channel = p_channel) and (p_status is null or status = p_status)
          order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) d), '[]'::jsonb);
end;
$$;

-- Manual retry from the admin: failed or skipped (not disabled) deliveries, at most 5 attempts.
create or replace function public.admin_retry_delivery(p_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['integrations.manage', 'notifications.manage']);
  d public.notification_deliveries;
begin
  select * into d from public.notification_deliveries where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if d.status not in ('failed', 'skipped') then return jsonb_build_object('ok', false, 'code', 'not_retryable'); end if;
  if d.attempts >= 5 then return jsonb_build_object('ok', false, 'code', 'max_attempts'); end if;
  if not app.notification_channel_available(d.channel) then
    return jsonb_build_object('ok', false, 'code', 'provider_disabled');
  end if;
  update public.notification_deliveries set status = 'queued', next_retry_at = now(), error_code = null, updated_at = now()
   where id = p_id returning * into d;
  perform app.log_event('integration.delivery_retried', 'public.notification_deliveries', p_id::text, null,
    jsonb_build_object('channel', d.channel, 'attempts', d.attempts), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'delivery', app.delivery_json(d));
end;
$$;

-- Server runtime: claim due deliveries (marks them sending, counts the attempt) with only what the
-- channel needs — rendered title / body in the customer's language, the provider template ID and
-- the one contact field for that channel. No staff notes, payment data or private media.
create or replace function public.integration_claim_deliveries(p_channel text, p_limit integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.integration_configs;
  v_result jsonb;
begin
  perform app.require_service_role();
  select * into v_config from public.integration_configs where key = p_channel;
  if not found or not v_config.enabled then return '[]'::jsonb; end if;
  if v_config.circuit_open_until is not null and v_config.circuit_open_until > now() then return '[]'::jsonb; end if;
  with due as (
    select d.id from public.notification_deliveries d
    where d.channel = p_channel and d.status = 'queued' and (d.next_retry_at is null or d.next_retry_at <= now())
    order by d.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  ), claimed as (
    update public.notification_deliveries d
       set status = 'sending', attempts = d.attempts + 1, last_attempt_at = now(), updated_at = now()
      from due where d.id = due.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'attempt', c.attempts,
      'idempotencyKey', 'delivery-' || c.id,
      'locale', coalesce(p.preferred_locale, 'ar'),
      'title', n.title ->> coalesce(p.preferred_locale, 'ar'),
      'body', n.body ->> coalesce(p.preferred_locale, 'ar'),
      'templateKey', n.template_key,
      'providerTemplate', v_config.template_map ->> n.template_key,
      'to', case p_channel when 'email' then u.email else p.phone end)), '[]'::jsonb)
    into v_result
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join auth.users u on u.id = n.user_id
    left join public.profiles p on p.id = n.user_id;
  return v_result;
end;
$$;

-- Server runtime: outcome of one attempt. Failures retry with backoff (1, 5, 30 minutes) up to 3
-- attempts; then the delivery stays failed until a manual retry.
create or replace function public.integration_record_delivery(p_id bigint, p_status text, p_error_code text default null,
                                                              p_external_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
begin
  perform app.require_service_role();
  if p_status not in ('sent', 'delivered', 'failed', 'skipped') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  select * into d from public.notification_deliveries where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  update public.notification_deliveries
     set status = case when p_status = 'failed' and d.attempts < 3 then 'queued' else p_status end,
         next_retry_at = case when p_status = 'failed' and d.attempts < 3
                              then now() + (case d.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes'
                                            else interval '30 minutes' end)
                              else null end,
         error_code = case when p_status in ('failed', 'skipped') then
                        case when p_error_code ~ '^[a-z_]{1,40}$' then p_error_code else 'provider_error' end end,
         external_ref = coalesce(left(p_external_ref, 200), external_ref),
         last_error = null,
         updated_at = now()
   where id = p_id returning * into d;
  return jsonb_build_object('ok', true, 'delivery', app.delivery_json(d));
end;
$$;

-- ── Webhooks ────────────────────────────────────────────────────────────────
-- The receiving Edge Function verifies the provider signature (shared secret, timestamp window)
-- before calling this. Every provider event ID is recorded once; repeats are reported as duplicates.
create or replace function public.integration_record_webhook(p_key text, p_provider_event_id text, p_event_type text,
                                                             p_signature_valid boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform app.require_service_role();
  if not exists (select 1 from public.integration_configs where key = p_key) then
    return jsonb_build_object('ok', false, 'code', 'unknown_integration');
  end if;
  insert into public.integration_webhook_events (key, provider_event_id, event_type, signature_valid, status)
  values (p_key, left(p_provider_event_id, 200), left(p_event_type, 80), coalesce(p_signature_valid, false),
          case when coalesce(p_signature_valid, false) then 'accepted' else 'rejected' end)
  on conflict (key, provider_event_id) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', v_id is null,
                            'accepted', v_id is not null and coalesce(p_signature_valid, false));
end;
$$;

-- Provider delivery receipts (e.g. WhatsApp "delivered") matched by the provider message ID.
create or replace function public.integration_record_delivery_status(p_channel text, p_external_ref text, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
begin
  perform app.require_service_role();
  if p_status not in ('delivered', 'failed') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  update public.notification_deliveries
     set status = case when p_status = 'delivered' then 'delivered' else 'failed' end,
         error_code = case when p_status = 'failed' then 'provider_reported_failure' else error_code end,
         updated_at = now()
   where channel = p_channel and external_ref = p_external_ref and status in ('sent', 'delivered')
  returning * into d;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_webhook_events(p_key text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('integrations.view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'providerEventId', w.provider_event_id,
      'eventType', w.event_type, 'signatureValid', w.signature_valid, 'status', w.status, 'receivedAt', w.received_at)
      order by w.received_at desc)
    from (select * from public.integration_webhook_events where key = p_key
          order by received_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) w), '[]'::jsonb);
end;
$$;

-- ── Server runtime configuration (service role only) ───────────────────────
create or replace function public.integration_runtime_config(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.integration_configs;
begin
  perform app.require_service_role();
  select * into v_config from public.integration_configs where key = p_key;
  if not found then return null; end if;
  return app.integration_config_json(v_config);
end;
$$;

-- ── Feature flags for staff screens (capabilities only, no configuration) ──
-- Integration-driven features show up only when their provider is enabled, configured and the
-- circuit breaker is closed (e.g. AI suggestions in the product editor).
create or replace function public.admin_integration_features()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['integrations.view', 'catalog.manage', 'content.manage',
                                                 'orders.manage', 'shipping.manage']);
begin
  return coalesce((
    select jsonb_object_agg(c.key, jsonb_build_object('provider', c.provider))
    from public.integration_configs c
    where c.enabled and app.integration_config_complete(c)
      and (c.circuit_open_until is null or c.circuit_open_until <= now())), '{}'::jsonb);
end;
$$;

-- ── Server runtime authorization ───────────────────────────────────────────
-- The Edge Function calls this with the CALLER's JWT before acting with the service role, so the
-- database stays the authority on who may test, sync or dispatch.
create or replace function public.admin_integration_authorize(p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permission text := case p_action when 'test' then 'integrations.test' when 'sync' then 'integrations.sync'
                                     when 'dispatch' then 'integrations.manage' end;
  v_uid uuid;
begin
  if v_permission is null then return jsonb_build_object('ok', false, 'code', 'invalid_action'); end if;
  v_uid := app.require_permission(v_permission);
  return jsonb_build_object('ok', true, 'actorId', v_uid);
end;
$$;

-- ── Public storefront flags (no secrets, no provider internals) ────────────
create or replace function public.storefront_integrations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'analytics', (select case when c.enabled and c.provider = 'ga4' and app.integration_config_complete(c)
                              then jsonb_build_object('provider', 'ga4', 'measurementId', c.settings ->> 'measurementId') end
                  from public.integration_configs c where c.key = 'google_analytics'),
    'socialAuth', (select jsonb_build_object(
                     'google', c.enabled and coalesce((c.settings ->> 'google')::boolean, false),
                     'apple', c.enabled and coalesce((c.settings ->> 'apple')::boolean, false))
                   from public.integration_configs c where c.key = 'social_auth'));
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.admin_integrations_overview(), public.admin_save_integration(text, text, jsonb, jsonb, text, jsonb, timestamptz),
  public.admin_set_integration_enabled(text, boolean, text), public.admin_remove_integration(text),
  public.admin_record_client_check(text, text, text, text, integer), public.admin_list_integration_checks(text, integer),
  public.admin_start_integration_sync(text, text, boolean, uuid), public.admin_cancel_integration_sync(uuid),
  public.admin_list_sync_jobs(text, integer), public.admin_get_sync_job(uuid),
  public.admin_list_deliveries(text, text, integer), public.admin_retry_delivery(bigint),
  public.admin_list_webhook_events(text, integer), public.admin_integration_features(),
  public.admin_integration_authorize(text)
  from public, anon;
grant execute on function public.admin_integrations_overview(), public.admin_save_integration(text, text, jsonb, jsonb, text, jsonb, timestamptz),
  public.admin_set_integration_enabled(text, boolean, text), public.admin_remove_integration(text),
  public.admin_record_client_check(text, text, text, text, integer), public.admin_list_integration_checks(text, integer),
  public.admin_start_integration_sync(text, text, boolean, uuid), public.admin_cancel_integration_sync(uuid),
  public.admin_list_sync_jobs(text, integer), public.admin_get_sync_job(uuid),
  public.admin_list_deliveries(text, text, integer), public.admin_retry_delivery(bigint),
  public.admin_list_webhook_events(text, integer), public.admin_integration_features(),
  public.admin_integration_authorize(text)
  to authenticated;

revoke all on function public.integration_record_check(text, text, text, text, integer, uuid),
  public.integration_record_sync_result(uuid, jsonb), public.integration_fail_sync(uuid, text, text),
  public.integration_order_snapshot(uuid), public.integration_record_order_export(text, uuid, text),
  public.integration_claim_deliveries(text, integer), public.integration_record_delivery(bigint, text, text, text),
  public.integration_record_webhook(text, text, text, boolean),
  public.integration_record_delivery_status(text, text, text), public.integration_runtime_config(text)
  from public, anon, authenticated;
grant execute on function public.integration_record_check(text, text, text, text, integer, uuid),
  public.integration_record_sync_result(uuid, jsonb), public.integration_fail_sync(uuid, text, text),
  public.integration_order_snapshot(uuid), public.integration_record_order_export(text, uuid, text),
  public.integration_claim_deliveries(text, integer), public.integration_record_delivery(bigint, text, text, text),
  public.integration_record_webhook(text, text, text, boolean),
  public.integration_record_delivery_status(text, text, text), public.integration_runtime_config(text)
  to service_role;

revoke all on function public.storefront_integrations() from public;
grant execute on function public.storefront_integrations() to anon, authenticated;
