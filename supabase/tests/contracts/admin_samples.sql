-- Captures one JSON sample per admin RPC (as the owner, inside a rolled-back transaction) so the
-- zod contracts in src/domain/admin/schemas.ts can be checked against real SQL output:
--   npm run test:contracts  (writes src/domain/admin/__fixtures__/admin-samples.json)
begin;
\set QUIET on
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';
select tests.create_user('owner.sample@test.local', 'owner') as owner \gset
select tests.create_user('cust.sample@test.local') as cust \gset
update public.profiles set full_name = 'Sample Customer', phone = '+201000000001' where id = :'cust';
select id as ip17 from public.products where slug = 'iphone-17' \gset
select id as tpv from public.product_variants where product_id = :'ip17' order by sku limit 1 \gset
update public.site_settings set value = jsonb_set(value, '{rules}', '[]'::jsonb) where key = 'order_review' and value ? 'rules';
select tests.act_as(:'cust');
select tests.checkout(tests.items(:'tpv', '1'), '{"method": "pickup"}', '{"method": "cod"}') -> 'order' ->> 'id' as order_id \gset
reset role;
select tests.act_as(:'owner');
select public.admin_save_customer_note(:'cust', null, 'Prefers WhatsApp', false, null) ->> 'ok' as n \gset
select public.admin_adjust_stock(:'tpv', 'addition', 2, 'Sample restock', null) ->> 'ok' as a \gset
select public.admin_set_variant_price(:'tpv', 1000, null, 'Sample price', null) ->> 'ok' as p \gset
select id as offer_id from public.offers order by created_at limit 1 \gset
select id as entry_id from public.content_entries order by created_at limit 1 \gset
select max(id) as audit_id from public.audit_logs \gset
create temp table samples (name text primary key, value jsonb);
grant all on samples to authenticated;
insert into samples values
 ('get_my_access', public.get_my_access()),
 ('admin_settings_overview', public.admin_settings_overview()),
 ('admin_setting_versions', public.admin_setting_versions('store')),
 ('admin_list_audit_logs', public.admin_list_audit_logs('{"limit": 5}')),
 ('admin_get_audit_log', public.admin_get_audit_log(:'audit_id')),
 ('admin_list_staff', public.admin_list_staff()),
 ('admin_lookup_account', public.admin_lookup_account('cust.sample@test.local')),
 ('admin_lookup_account_missing', public.admin_lookup_account('nobody@test.local')),
 ('admin_list_roles', public.admin_list_roles()),
 ('admin_catalog_lookups', public.admin_catalog_lookups()),
 ('admin_list_products', public.admin_list_products('{"limit": 3}')),
 ('admin_get_product', public.admin_get_product(:'ip17')),
 ('admin_list_price_history', public.admin_list_price_history('{"limit": 3}')),
 ('admin_list_inventory', public.admin_list_inventory('{"limit": 3}')),
 ('admin_list_stock_movements', public.admin_list_stock_movements('{"limit": 3}')),
 ('admin_list_categories', public.admin_list_categories()),
 ('admin_list_brands', public.admin_list_brands()),
 ('staff_list_orders', public.staff_list_orders('{"limit": 3}')),
 ('admin_order_assignees', public.admin_order_assignees()),
 ('admin_list_customers', public.admin_list_customers('{"limit": 3}')),
 ('admin_get_customer', public.admin_get_customer(:'cust')),
 ('admin_list_abandoned_carts', public.admin_list_abandoned_carts('{"minHours": 0}')),
 ('admin_list_service_requests', public.admin_list_service_requests('repair', '{"view": "all", "limit": 3}')),
 ('admin_list_service_requests_used', public.admin_list_service_requests('used', '{"view": "all", "limit": 3}')),
 ('admin_list_reviews', public.admin_list_reviews('{"limit": 3}')),
 ('admin_list_waitlist', public.admin_list_waitlist('{"limit": 3}')),
 ('admin_list_notification_templates', public.admin_list_notification_templates()),
 ('admin_search_recipients', public.admin_search_recipients('Sample')),
 ('admin_list_offers', public.admin_list_offers('{"limit": 3}')),
 ('admin_get_offer', public.admin_get_offer(:'offer_id')),
 ('admin_list_entries', public.admin_list_entries('{"limit": 3}')),
 ('admin_get_entry', public.admin_get_entry(:'entry_id')),
 ('admin_list_page_sections', public.admin_list_page_sections('home')),
 ('admin_dashboard', public.admin_dashboard(now() - interval '30 days', now(), true)),
 ('admin_analytics', public.admin_analytics(now() - interval '30 days', now(), true)),
 ('admin_export_products', public.admin_export('products', '{}')),
 ('admin_list_import_jobs', public.admin_list_import_jobs()),
 ('admin_import_preview', public.admin_import_preview('sample.csv', '[{"sku": "SAMPLE-1", "productSlug": "sample-phone", "nameEn": "Sample", "nameAr": "عينة", "brand": "apple", "category": "phones", "price": "1000", "stock": "2"}, {"sku": ""}]'));
-- Phase 07 Site Editor: one publish (versions 1 + 2), then an open draft with a section design.
select public.site_editor_get_page('home') -> 'published' as home_layout \gset
select public.site_editor_save_draft('home', :'home_layout'::jsonb, null) ->> 'ok' as d1 \gset
select public.site_editor_publish('home', 'Sample publish', false) ->> 'ok' as p1 \gset
select public.site_editor_save_draft('home', jsonb_set(:'home_layout'::jsonb, '{0,design}', '{"background": "muted"}'),
  null) ->> 'ok' as d2 \gset
insert into samples values
 ('site_editor_overview', public.site_editor_overview()),
 ('site_editor_get_page', public.site_editor_get_page('home')),
 ('site_editor_versions', public.site_editor_versions('home', 5)),
 ('site_editor_conflict', public.site_editor_save_draft('home', '[]'::jsonb, null)),
 ('storefront_page_sections', public.storefront_page_sections('home'));
insert into samples select 'admin_service_context', public.admin_service_context(id) from public.service_requests order by created_at limit 1;
-- Phase 08: SEO overview / public index (sitemap source) and first-run setup completion.
insert into samples values
 ('admin_seo_overview', public.admin_seo_overview()),
 ('seo_public_index', public.seo_public_index()),
 ('admin_complete_setup_invalid', public.admin_complete_setup('nope', null)),
 ('admin_complete_setup', public.admin_complete_setup('keep', 'Sample setup'));
-- Phase 09: integrations — configuration, a client check, a dry-run sync recorded by the server
-- runtime (service role), one failed delivery and one webhook event.
select sku as tpv_sku from public.product_variants where id = :'tpv' \gset
select public.admin_save_integration('odoo', 'odoo_jsonrpc',
  '{"baseUrl": "https://erp.example.test", "database": "malek", "username": "sync"}', '{"prices": "external_wins"}') ->> 'ok' as i1 \gset
select public.admin_save_integration('google_analytics', 'ga4', '{"measurementId": "G-SAMPLE123"}') ->> 'ok' as i2 \gset
select public.admin_set_integration_enabled('google_analytics', true) ->> 'ok' as i3 \gset
select public.admin_record_client_check('google_analytics', 'connected', 'connected', 'format_verified', null) ->> 'ok' as i4 \gset
select public.admin_start_integration_sync('odoo', 'prices', true, '00000000-0000-4000-8000-0000000000a1') ->> 'jobId' as job_id \gset
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true) as claims \gset
set local role service_role;
select public.integration_record_sync_result(:'job_id', jsonb_build_array(
  jsonb_build_object('externalId', 'ODOO-1', 'sku', :'tpv_sku', 'price', 1100, 'updatedAt', now()),
  jsonb_build_object('externalId', 'bad id'),
  jsonb_build_object('externalId', 'ODOO-404', 'sku', 'NO-SUCH-SKU', 'price', 10))) ->> 'ok' as r1 \gset
reset role;
with n as (
  insert into public.notifications (user_id, category, template_key, title, body, data, dedupe_key)
  values (:'cust', 'order', 'order.confirmed', '{"ar": "تم تأكيد طلبك", "en": "Your order is confirmed"}',
          '{"ar": "الطلب MS-1 اتأكد.", "en": "Order MS-1 is confirmed."}', '{"orderNumber": "MS-1"}', 'sample:delivery')
  returning id)
insert into public.notification_deliveries (notification_id, channel, status, attempts, error_code)
select id, 'whatsapp', 'failed', 3, 'provider_error' from n;
insert into public.integration_webhook_events (key, provider_event_id, event_type, signature_valid, status)
values ('whatsapp', 'wamid.SAMPLE:delivered', 'status.delivered', true, 'accepted');
select tests.act_as(:'owner');
insert into samples values
 ('admin_integrations_overview', public.admin_integrations_overview()),
 ('admin_list_integration_checks', public.admin_list_integration_checks('google_analytics', 5)),
 ('admin_list_sync_jobs', public.admin_list_sync_jobs('odoo', 5)),
 ('admin_get_sync_job', public.admin_get_sync_job(:'job_id')),
 ('admin_list_deliveries', public.admin_list_deliveries(null, null, 5)),
 ('admin_list_webhook_events', public.admin_list_webhook_events('whatsapp', 5)),
 ('admin_integration_features', public.admin_integration_features()),
 ('admin_save_integration_refused', public.admin_save_integration('odoo', 'odoo_jsonrpc',
   '{"baseUrl": "https://erp.example.test", "database": "malek", "username": "sk-live1234567890abcdef"}')),
 ('storefront_integrations', public.storefront_integrations());
\pset tuples_only on
\pset format unaligned
\o :out
select jsonb_object_agg(name, value) from samples;
\o
rollback;
