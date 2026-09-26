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
insert into samples select 'admin_service_context', public.admin_service_context(id) from public.service_requests order by created_at limit 1;
\pset tuples_only on
\pset format unaligned
\o :out
select jsonb_object_agg(name, value) from samples;
\o
rollback;
