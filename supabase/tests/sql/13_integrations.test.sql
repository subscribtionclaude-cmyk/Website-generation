-- Phase 09: integrations layer — RLS / RBAC, configuration rules (no secrets, no mock provider),
-- enable / disable, notification routing + retries, service-role-only results, webhooks, ERP sync
-- (dry run, mapping, conflicts, price history, stock never below reservations), public flags, audit.
begin;

select tests.create_user('owner13@test.local', 'owner') as owner \gset
select tests.create_user('super13@test.local', 'super_admin') as super \gset
select tests.create_user('manager13@test.local', 'store_manager') as manager \gset
select tests.create_user('cs13@test.local', 'customer_service') as cs \gset
select tests.create_user('sales13@test.local', 'sales') as sales \gset
select tests.create_user('cust13@test.local') as cust \gset
update public.profiles set phone = '+201012345678', full_name = 'Integration Customer' where id = :'cust';

-- ══ Defaults: everything optional and disabled ══════════════════════════════
select tests.assert_equal((select count(*)::int from public.integration_configs), 12, 'one row per catalog integration');
select tests.assert_equal((select count(*)::int from public.integration_configs where enabled or provider is not null), 0,
  'every integration starts unconfigured and disabled');

-- ══ RLS / RBAC ══════════════════════════════════════════════════════════════
select tests.act_as_anon();
select tests.assert_raises($$select * from public.integration_configs$$, '42501', 'anon cannot read integration config');
select tests.assert_raises($$select public.admin_integrations_overview()$$, '42501', 'anon cannot call the overview');
select tests.assert_raises($$select * from public.integration_sync_jobs$$, '42501', 'anon cannot read sync jobs');
reset role;
select tests.act_as(:'cust');
select tests.assert_equal((select count(*)::int from public.integration_configs), 0, 'customers see no integration rows (RLS)');
select tests.assert_equal((select count(*)::int from public.integration_health_checks), 0, 'customers see no health checks');
select tests.assert_raises($$select public.admin_integrations_overview()$$, '42501', 'customers cannot call the overview');
select tests.assert_raises($$update public.integration_configs set enabled = true$$, '42501', 'no direct writes');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_integrations_overview()$$, '42501', 'staff without integrations.view refused');
reset role;
select tests.act_as(:'cs');
select tests.assert_equal(jsonb_array_length(public.admin_integrations_overview() -> 'integrations'), 12,
  'customer service can view integrations');
select tests.assert_equal((public.admin_integrations_overview() ->> 'canManage')::boolean, false, 'viewer cannot manage');
select tests.assert_raises($$select public.admin_save_integration('whatsapp', 'meta_cloud', '{"phoneNumberId": "123456", "graphVersion": "v21.0"}')$$,
  '42501', 'viewer cannot configure');
select tests.assert_raises($$select public.admin_set_integration_enabled('whatsapp', true)$$, '42501', 'viewer cannot enable');
reset role;
select tests.act_as(:'manager');
select tests.assert_raises($$select public.admin_save_integration('whatsapp', 'meta_cloud', '{"phoneNumberId": "123456", "graphVersion": "v21.0"}')$$,
  '42501', 'store manager (view / test / sync) cannot change configuration');
reset role;

-- ══ Configuration rules ═════════════════════════════════════════════════════
select tests.act_as(:'super');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'mock', '{}') ->> 'code', 'invalid_provider',
  'the mock provider can never be configured on a real database');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'twilio', '{}') ->> 'code', 'invalid_provider',
  'providers outside the catalog refused');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'meta_cloud', '{"accessToken": "abc"}') ->> 'code',
  'unknown_setting', 'unknown (secret) setting names refused');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'meta_cloud',
  '{"phoneNumberId": "EAAGm0PX4ZCpsBAKZBZCq7ZBYZCZCZBZB", "graphVersion": "v21.0"}') ->> 'code', 'secret_not_allowed',
  'a token-looking value is refused even in a public field');
select tests.assert_equal(public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.com", "database": "malek", "username": "sk-live-abcdefghijklmnop"}') ->> 'code',
  'secret_not_allowed', 'API-key-looking values refused');
select tests.assert_equal(public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "http://erp.example.com", "database": "malek", "username": "api"}') ->> 'code', 'invalid_setting',
  'provider URLs must be https');
select tests.assert_equal(public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.com", "database": "malek", "username": "api"}', '{}', 'two_way') ->> 'code',
  'two_way_unsupported', 'two-way sync stays off until conflict handling is defined');
select tests.assert_equal(public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.com", "database": "malek", "username": "api"}', '{"orders": "external"}') ->> 'code',
  'invalid_ownership', 'ownership only for the provider''s sync domains');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'meta_cloud',
  '{"phoneNumberId": "123456789", "graphVersion": "v21.0"}', '{}', 'import', '{"order.nope": "x"}') ->> 'code',
  'invalid_template_map', 'template map only for existing notification events');
select public.admin_save_integration('whatsapp', 'meta_cloud', '{"phoneNumberId": "123456789", "graphVersion": "v21.0"}',
  '{}', 'import', '{"order.confirmed": "order_confirmed_v1"}') as wa \gset
select tests.assert_equal((:'wa'::jsonb ->> 'ok')::boolean, true, 'WhatsApp configured with public settings only');
select tests.assert_equal((:'wa'::jsonb -> 'integration' ->> 'complete')::boolean, true, 'configuration complete');
select tests.assert_equal((:'wa'::jsonb -> 'integration' ->> 'enabled')::boolean, false, 'saving never enables');
select tests.assert_equal(public.admin_save_integration('whatsapp', 'meta_cloud', '{"phoneNumberId": "123456789", "graphVersion": "v21.0"}',
  '{}', 'import', '{}', now() - interval '1 day') ->> 'code', 'stale', 'stale edits refused');
select tests.assert_equal(public.admin_set_integration_enabled('sms', true) ->> 'code', 'not_configured',
  'an unconfigured provider cannot be enabled');
select tests.assert_equal(public.admin_set_integration_enabled('whatsapp', true, 'Go live') ->> 'ok', 'true', 'explicit enable');
select tests.assert_equal(public.admin_set_integration_enabled('whatsapp', true) ->> 'code', 'no_change', 'no-op refused');
reset role;
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.configured' and entity_id = 'whatsapp'),
  'configuration audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.enabled' and entity_id = 'whatsapp'
  and metadata ->> 'reason' = 'Go live'), 'enable audited with its reason');
select tests.assert(not exists (select 1 from public.audit_logs where action like 'integration.%'
  and (coalesce(before_data::text, '') || coalesce(after_data::text, '') || metadata::text) like '%EAAG%'), 'refused secrets never reach the audit log');

-- ══ Notification router ═════════════════════════════════════════════════════
update public.site_settings set value = '{"channels": {"email": {"enabled": false}, "whatsapp": {"enabled": true}, "sms": {"enabled": true}}}'
 where key = 'notifications';
insert into public.notification_preferences (user_id, category, channel, enabled) values
  (:'cust', 'order', 'whatsapp', true), (:'cust', 'order', 'sms', true);
select app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000901", "customer_name": "C"}',
                  'test13:o1:confirmed', '/order/MS-2026-000901', '{"orderNumber": "MS-2026-000901"}') as n1 \gset
select tests.assert(:'n1' is not null, 'in-app notification always created');
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n1' and channel = 'whatsapp'
  and status = 'queued' and provider = 'meta_cloud'), 1, 'enabled + mapped + opted-in → one queued WhatsApp delivery');
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n1' and channel = 'sms'), 0,
  'SMS provider not configured → no SMS delivery (disabled)');
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n1' and channel = 'email'), 0,
  'email channel off → no email delivery');
select tests.assert(app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000901"}', 'test13:o1:confirmed') is null,
  'the same event twice creates nothing new');
select tests.assert_equal((select count(*)::int from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.dedupe_key = 'test13:o1:confirmed'), 1, 'duplicate event → no duplicate send');
select app.notify(:'cust', 'order.preparing', '{"order_number": "MS-2026-000901"}', 'test13:o1:preparing') as n2 \gset
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n2'), 0,
  'events not mapped for the channel are not sent externally');
update public.notification_preferences set enabled = false where user_id = :'cust' and channel = 'whatsapp';
select app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000902"}', 'test13:o2:confirmed') as n3 \gset
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n3'), 0,
  'customer preference respected (WhatsApp off)');
update public.notification_preferences set enabled = true where user_id = :'cust' and channel = 'whatsapp';
select app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000903"}', 'test13:o3:confirmed', null, '{}', true) as n4 \gset
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n4'), 0,
  'demo notifications never go to an external provider');

-- ══ Service-role boundary: results come from the server runtime only ════════
select tests.act_as(:'super');
select tests.assert_raises($$select public.integration_record_check('whatsapp', 'connected', 'connected')$$, '42501',
  'staff cannot forge a server health result');
select tests.assert_raises($$select public.integration_claim_deliveries('whatsapp')$$, '42501', 'staff cannot claim deliveries');
select tests.assert_equal(public.admin_record_client_check('whatsapp', 'connected', 'connected') ->> 'code', 'server_check_required',
  'server-checked integrations cannot be marked from the browser');
reset role;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select tests.assert_equal(public.integration_record_check('whatsapp', 'failed', 'auth_failed',
  'Invalid OAuth access token Bearer EAAGabcdefghijklmnopqrstuvwxyz0123456789', 410) ->> 'ok', 'true', 'server records a failed check');
reset role;
select tests.assert((select last_check_message from public.integration_configs where key = 'whatsapp') not like '%EAAG%',
  'tokens in provider errors are redacted before storage');
select tests.assert((select message from public.integration_health_checks where key = 'whatsapp' order by id desc limit 1) like '%[redacted]%',
  'health history keeps only the redacted message');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_check('whatsapp', 'failed', 'unreachable');
select public.integration_record_check('whatsapp', 'failed', 'timeout');
reset role;
select tests.assert((select circuit_open_until > now() from public.integration_configs where key = 'whatsapp'),
  'three failures in a row open the circuit breaker');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select tests.assert_equal(public.integration_claim_deliveries('whatsapp'), '[]'::jsonb, 'an open circuit pauses outbound sends');
select public.integration_record_check('whatsapp', 'connected', 'connected', null, 120);
reset role;
select tests.assert_equal((select consecutive_failures from public.integration_configs where key = 'whatsapp'), 0,
  'a successful check closes the circuit');
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.tested' and entity_id = 'whatsapp'),
  'connection tests audited');

-- Claim → attempt → retry with backoff → final failure → manual retry.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_claim_deliveries('whatsapp') as claimed \gset
reset role;
select tests.assert_equal(jsonb_array_length(:'claimed'::jsonb), 1, 'one due delivery claimed');
select tests.assert_equal(:'claimed'::jsonb -> 0 ->> 'to', '+201012345678', 'only the WhatsApp phone is shared');
select tests.assert_equal(:'claimed'::jsonb -> 0 ->> 'providerTemplate', 'order_confirmed_v1', 'provider template ID from the mapping');
select tests.assert(not (:'claimed'::jsonb -> 0 ? 'email'), 'no other personal fields in the payload');
select (:'claimed'::jsonb -> 0 ->> 'id')::bigint as did \gset
select tests.assert_equal((select status from public.notification_deliveries where id = :did), 'sending', 'claimed delivery is sending');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_delivery(:did, 'failed', 'rate_limited');
reset role;
select tests.assert_equal((select status from public.notification_deliveries where id = :did), 'queued', 'first failure re-queues');
select tests.assert((select next_retry_at > now() from public.notification_deliveries where id = :did), 'with a backoff delay');
update public.notification_deliveries set attempts = 3, status = 'sending' where id = :did;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_delivery(:did, 'failed', 'provider_error');
reset role;
select tests.assert_equal((select status from public.notification_deliveries where id = :did), 'failed',
  'after three attempts the delivery stays failed (no infinite retries)');
select tests.act_as(:'sales');
select tests.assert_raises(format('select public.admin_retry_delivery(%s)', :did), '42501',
  'staff without integrations.manage / notifications.manage cannot retry');
reset role;
select tests.act_as(:'super');
select tests.assert_equal(public.admin_retry_delivery(:did) ->> 'ok', 'true', 'manual retry from the admin');
select tests.assert_equal(jsonb_array_length(public.admin_list_deliveries('whatsapp')), 1, 'delivery log listed');
select tests.assert(not (public.admin_list_deliveries('whatsapp') -> 0 ? 'to'), 'the delivery log shows no contact details');
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_claim_deliveries('whatsapp');
select public.integration_record_delivery(:did, 'sent', null, 'wamid.TEST123');
select tests.assert_equal(public.integration_record_delivery_status('whatsapp', 'wamid.TEST123', 'delivered') ->> 'ok', 'true',
  'provider receipt marks the delivery delivered');
reset role;
select tests.assert_equal((select status from public.notification_deliveries where id = :did), 'delivered', 'delivered status stored');

-- Disabling skips queued sends and keeps history.
select app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000904"}', 'test13:o4:confirmed') as n5 \gset
select tests.act_as(:'super');
select tests.assert_equal((public.admin_set_integration_enabled('whatsapp', false) ->> 'skippedDeliveries')::int, 1,
  'disable skips the queued delivery');
reset role;
select tests.assert_equal((select error_code from public.notification_deliveries where notification_id = :'n5'), 'provider_disabled',
  'skipped with a reason');
select tests.assert_equal((select status from public.notification_deliveries where id = :did), 'delivered', 'history kept');
select app.notify(:'cust', 'order.confirmed', '{"order_number": "MS-2026-000905"}', 'test13:o5:confirmed') as n6 \gset
select tests.assert_equal((select count(*)::int from public.notification_deliveries where notification_id = :'n6'), 0,
  'a disabled provider receives nothing new (manual WhatsApp remains)');

-- ══ Webhooks: verified once, duplicates ignored ═════════════════════════════
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select tests.assert_equal(public.integration_record_webhook('whatsapp', 'evt-1', 'message.status', true) ->> 'accepted', 'true',
  'verified webhook accepted');
select tests.assert_equal(public.integration_record_webhook('whatsapp', 'evt-1', 'message.status', true) ->> 'duplicate', 'true',
  'the same provider event ID is a duplicate');
select tests.assert_equal(public.integration_record_webhook('whatsapp', 'evt-2', 'message.status', false) ->> 'accepted', 'false',
  'an invalid signature is rejected');
reset role;
select tests.assert_equal((select count(*)::int from public.integration_webhook_events where key = 'whatsapp'), 2,
  'one row per provider event');
select tests.act_as(:'cust');
select tests.assert_raises($$select public.integration_record_webhook('whatsapp', 'evt-3', 'x', true)$$, '42501',
  'webhook recording is server-only');
reset role;

-- ══ ERP sync: dry run, mapping, conflicts, history, reservations ════════════
insert into public.brands (slug, name, is_visible, is_demo) values ('int-brand', '{"ar": "علامة", "en": "Brand"}', true, false)
returning id as brand \gset
insert into public.products (slug, name, brand_id, status, is_visible, is_demo)
values ('int-phone', '{"ar": "هاتف", "en": "Phone"}', :'brand', 'published', true, false) returning id as product \gset
insert into public.product_variants (product_id, sku, price, stock_quantity) values (:'product', 'INT-SKU-1', 1000, 10)
returning id as variant \gset

select tests.act_as(:'manager');
select tests.assert_equal(public.admin_start_integration_sync('odoo', 'prices', true, gen_random_uuid()) ->> 'code', 'not_configured',
  'no sync before the ERP is configured');
reset role;
select tests.act_as(:'super');
select public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.com", "database": "malek", "username": "api"}',
  '{"prices": "external", "stock": "external"}');
reset role;
select tests.act_as(:'cs');
select tests.assert_raises($$select public.admin_start_integration_sync('odoo', 'prices', true, gen_random_uuid())$$, '42501',
  'viewers cannot start a sync');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_start_integration_sync('odoo', 'orders', true, gen_random_uuid()) ->> 'code', 'sync_unsupported',
  'only catalog sync domains');
select tests.assert_equal(public.admin_start_integration_sync('odoo', 'prices', false, gen_random_uuid()) ->> 'code', 'not_enabled',
  'applying needs the integration enabled (dry runs do not)');
select public.admin_start_integration_sync('odoo', 'prices', true, '22222222-2222-4222-8222-222222222222') as j1 \gset
select tests.assert_equal(public.admin_start_integration_sync('odoo', 'prices', true, '22222222-2222-4222-8222-222222222222') ->> 'duplicate',
  'true', 'same idempotency key → same job');
reset role;
\set records '[{"externalId": "odoo:P1", "sku": "INT-SKU-1", "price": 1100, "updatedAt": "2030-01-01T00:00:00Z"}, {"externalId": "odoo:P2", "sku": "NOPE-SKU", "price": 50}, {"externalId": "bad id!", "price": 1}, {"externalId": "odoo:P4", "sku": "INT-SKU-1", "price": -5}]'
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j1'::jsonb ->> 'jobId')::uuid, :'records'::jsonb) as r1 \gset
reset role;
select tests.assert_equal(:'r1'::jsonb -> 'job' ->> 'status', 'partial', 'dry run with invalid rows is partial');
select tests.assert_equal((:'r1'::jsonb -> 'job' ->> 'updated')::int, 1, 'dry run: one update planned');
select tests.assert_equal((:'r1'::jsonb -> 'job' ->> 'failed')::int, 2, 'dry run: invalid external ID and negative price');
select tests.assert_equal((:'r1'::jsonb -> 'job' ->> 'skipped')::int, 1, 'dry run: unmatched SKU skipped');
select tests.assert_equal((select price from public.product_variants where id = :'variant'), 1000.00, 'dry run changes nothing');
select tests.assert_equal((select count(*)::int from public.integration_external_ids where key = 'odoo'), 0, 'dry run maps nothing');
select tests.act_as(:'cs');
select tests.assert_equal(jsonb_array_length(public.admin_get_sync_job((:'j1'::jsonb ->> 'jobId')::uuid) -> 'items'), 4,
  'sync details list every record');
reset role;

select tests.act_as(:'super');
select public.admin_set_integration_enabled('odoo', true);
reset role;
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'prices', false, gen_random_uuid()) as j2 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j2'::jsonb ->> 'jobId')::uuid, :'records'::jsonb) as r2 \gset
reset role;
select tests.assert_equal((select price from public.product_variants where id = :'variant'), 1100.00, 'external price applied');
select tests.assert_equal((select source from public.price_history where variant_id = :'variant' order by id desc limit 1), 'integration',
  'price history written with source "integration"');
select tests.assert(exists (select 1 from public.audit_logs where action = 'price.changed' and entity_id = 'INT-SKU-1'
  and metadata ->> 'source' = 'integration:odoo'), 'external price update audited with its source');
select tests.assert_equal((select local_id from public.integration_external_ids where key = 'odoo' and entity = 'variant'
  and external_id = 'odoo:P1'), :'variant'::uuid, 'external ID mapped to the Malek variant (Malek ID unchanged)');

-- Re-running the same feed is idempotent.
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'prices', false, gen_random_uuid()) as j3 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j3'::jsonb ->> 'jobId')::uuid, :'records'::jsonb) as r3 \gset
reset role;
select tests.assert_equal((:'r3'::jsonb -> 'job' ->> 'updated')::int, 0, 're-running the same feed changes nothing');
select tests.assert_equal((select count(*)::int from public.price_history where variant_id = :'variant' and source = 'integration'), 1,
  'no duplicate price history');

-- Local edit after the last sync → conflict (review), unless the policy says external wins.
update public.integration_external_ids set synced_at = now() - interval '1 hour' where key = 'odoo' and external_id = 'odoo:P1';
update public.product_variants set price = 1200 where id = :'variant';
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'prices', false, gen_random_uuid()) as j4 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j4'::jsonb ->> 'jobId')::uuid,
  '[{"externalId": "odoo:P1", "sku": "INT-SKU-1", "price": 1300, "updatedAt": "2030-02-01T00:00:00Z"}]') as r4 \gset
reset role;
select tests.assert_equal((:'r4'::jsonb -> 'job' ->> 'conflicts')::int, 1, 'newer local edit → conflict for review');
select tests.assert_equal((select price from public.product_variants where id = :'variant'), 1200.00, 'local data not overwritten');
select tests.act_as(:'super');
select public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.com", "database": "malek", "username": "api"}',
  '{"prices": "external_wins", "stock": "external"}');
reset role;
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'prices', false, gen_random_uuid()) as j5 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j5'::jsonb ->> 'jobId')::uuid,
  '[{"externalId": "odoo:P1", "sku": "INT-SKU-1", "price": 1300, "updatedAt": "2030-02-01T00:00:00Z"}]');
reset role;
select tests.assert_equal((select price from public.product_variants where id = :'variant'), 1300.00,
  '"external wins" policy applies the external price');

-- Stock: external quantities never bypass active reservations.
select tests.act_as(:'cust');
select tests.checkout(tests.items(:'variant', '3'), '{"method": "pickup", "branchId": "abbasseya"}', '{"method": "cod"}') as ord \gset
reset role;
select tests.assert_equal(app.variant_reserved_quantity(:'variant', null), 3, 'fixture: an order holds 3 units');
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'stock', false, gen_random_uuid()) as j6 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j6'::jsonb ->> 'jobId')::uuid,
  '[{"externalId": "odoo:P1", "sku": "INT-SKU-1", "stock": 2, "updatedAt": "2030-03-01T00:00:00Z"}]') as r6 \gset
reset role;
select tests.assert_equal((:'r6'::jsonb -> 'job' ->> 'conflicts')::int, 1, 'external stock below active reservations → conflict');
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'variant'), 10, 'stock unchanged');
select tests.assert_equal((select reason from public.integration_sync_items where job_id = (:'j6'::jsonb ->> 'jobId')::uuid),
  'below_reserved', 'conflict reason recorded');
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'stock', false, gen_random_uuid()) as j7 \gset
reset role;
update public.integration_external_ids set synced_at = now() + interval '1 minute' where key = 'odoo' and external_id = 'odoo:P1';
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j7'::jsonb ->> 'jobId')::uuid,
  '[{"externalId": "odoo:P1", "sku": "INT-SKU-1", "stock": 4, "updatedAt": "2030-03-02T00:00:00Z"}]');
reset role;
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'variant'), 4, 'external stock applied');
select tests.assert_equal(app.variant_reserved_quantity(:'variant', null), 3, 'reservations untouched');
select tests.assert_equal((select reason from public.stock_movements where variant_id = :'variant' order by created_at desc, id desc limit 1),
  'external_sync', 'stock movement recorded with reason external_sync');
select tests.act_as(:'cust');
select tests.assert_equal(tests.checkout(tests.items(:'variant', '2'), '{"method": "pickup", "branchId": "abbasseya"}',
  '{"method": "cod"}') ->> 'ok', 'false', 'checkout still sees only 4 − 3 = 1 available');
reset role;

-- Customers: exact email links, unknown customers are never auto-created.
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'customers', false, gen_random_uuid()) as j8 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_record_sync_result((:'j8'::jsonb ->> 'jobId')::uuid,
  '[{"externalId": "odoo:C1", "email": "CUST13@test.local", "name": "Integration Customer"}, {"externalId": "odoo:C2", "email": "nobody@test.local", "name": "Integration Customer"}]') as r8 \gset
reset role;
select tests.assert_equal((select local_id from public.integration_external_ids where key = 'odoo' and entity = 'customer'
  and external_id = 'odoo:C1'), :'cust'::uuid, 'customer linked by exact email');
select tests.assert_equal((select action from public.integration_sync_items where job_id = (:'j8'::jsonb ->> 'jobId')::uuid and position = 2),
  'create', 'unknown customer listed for review, not created (same name is not enough)');
select tests.assert_equal((select count(*)::int from auth.users where email = 'nobody@test.local'), 0, 'no account created');

-- Failures are summarised safely; orders export once from an authoritative snapshot.
select tests.act_as(:'manager');
select public.admin_start_integration_sync('odoo', 'prices', true, gen_random_uuid()) as j9 \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select public.integration_fail_sync((:'j9'::jsonb ->> 'jobId')::uuid, 'auth_failed', 'Access denied for key sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
select public.integration_order_snapshot((:'ord'::jsonb -> 'order' ->> 'id')::uuid) as snap \gset
select tests.assert_equal(public.integration_record_order_export('odoo', (:'ord'::jsonb -> 'order' ->> 'id')::uuid, 'SO0001') ->> 'duplicate',
  'false', 'order exported once');
select tests.assert_equal(public.integration_record_order_export('odoo', (:'ord'::jsonb -> 'order' ->> 'id')::uuid, 'SO0002') ->> 'externalId',
  'SO0001', 'a repeated export returns the first external ID (idempotent)');
reset role;
select tests.assert((select error_summary from public.integration_sync_jobs where id = (:'j9'::jsonb ->> 'jobId')::uuid) like '%[redacted]%',
  'sync failure summary redacts credentials');
select tests.assert_equal(jsonb_array_length(:'snap'::jsonb -> 'lines'), 1, 'snapshot carries the order lines');
select tests.assert(not (:'snap'::jsonb ? 'internalNotes') and not (:'snap'::jsonb ? 'paymentProof'),
  'snapshot has no internal notes or payment proofs');
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.sync_started'), 'sync start audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.sync_completed'), 'sync result audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'integration.sync_failed'), 'sync failure audited');

-- Removing the configuration keeps Malek data, mappings and history.
select tests.act_as(:'super');
select tests.assert_equal(public.admin_remove_integration('odoo') ->> 'ok', 'true', 'configuration removed');
reset role;
select tests.assert_equal((select provider from public.integration_configs where key = 'odoo'), null, 'provider cleared');
select tests.assert((select count(*) from public.integration_sync_jobs where key = 'odoo') >= 8, 'sync history kept');
select tests.assert((select count(*) from public.integration_external_ids where key = 'odoo') >= 2, 'external ID mappings kept');
select tests.assert_equal((select price from public.product_variants where id = :'variant'), 1300.00, 'products untouched');

-- ══ Public storefront flags ═════════════════════════════════════════════════
select tests.act_as_anon();
select tests.assert_equal(public.storefront_integrations() -> 'analytics', 'null'::jsonb, 'analytics off by default');
select tests.assert_equal((public.storefront_integrations() -> 'socialAuth' ->> 'google')::boolean, false, 'social sign-in off by default');
reset role;
select tests.act_as(:'super');
select public.admin_save_integration('google_analytics', 'ga4', '{"measurementId": "G-TEST1234"}');
select public.admin_set_integration_enabled('google_analytics', true);
select tests.assert_equal(public.admin_record_client_check('google_analytics', 'connected', 'connected') ->> 'ok', 'true',
  'client-checkable integration records its own check');
select public.admin_save_integration('social_auth', 'supabase_auth', '{"google": true, "apple": false}');
select public.admin_set_integration_enabled('social_auth', true);
reset role;
select tests.act_as_anon();
select tests.assert_equal(public.storefront_integrations() -> 'analytics' ->> 'measurementId', 'G-TEST1234',
  'enabled analytics exposes only its public measurement ID');
select tests.assert_equal((public.storefront_integrations() -> 'socialAuth' ->> 'google')::boolean, true, 'Google sign-in offered');
select tests.assert_equal((public.storefront_integrations() -> 'socialAuth' ->> 'apple')::boolean, false, 'Apple stays off');
reset role;

-- Staff feature flags: capabilities only (enabled + configured + circuit closed).
select tests.act_as(:'manager');
select tests.assert(public.admin_integration_features() ? 'google_analytics', 'enabled integrations listed as features');
select tests.assert(not (public.admin_integration_features() ? 'whatsapp'), 'disabled integrations are not features');
select tests.assert(not (public.admin_integration_features() -> 'google_analytics' ? 'settings'), 'no configuration in feature flags');
reset role;
select tests.act_as(:'cust');
select tests.assert_raises($$select public.admin_integration_features()$$, '42501', 'customers cannot read feature flags');
reset role;

-- Server runtime authorization: the Edge Function asks with the caller's JWT.
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_integration_authorize('test') ->> 'ok', 'true', 'manager may run server tests');
select tests.assert_equal(public.admin_integration_authorize('sync') ->> 'actorId', :'manager', 'authorization returns the acting user');
select tests.assert_equal(public.admin_integration_authorize('nope') ->> 'code', 'invalid_action', 'unknown runtime action refused');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_integration_authorize('test')$$, '42501', 'staff without integrations.test refused');
reset role;
select tests.act_as(:'cust');
select tests.assert_raises($$select public.admin_integration_authorize('dispatch')$$, '42501', 'customers cannot dispatch');
reset role;

rollback;
