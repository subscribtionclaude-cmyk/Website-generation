-- Phase 10: launch readiness — demo cleanup completeness and the demo / live contamination audit
-- (supabase/scripts/demo_audit.sql): after "Delete demo data" every check passes and real records
-- are untouched.
begin;

select tests.create_user('owner14@test.local', 'owner') as owner \gset
select tests.create_user('editor14@test.local', 'content_editor') as editor \gset

-- Every table with an is_demo column is registered for cleanup (a new one would fail here).
select tests.assert_equal((
  select count(*)::int
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'is_demo' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from app.demo_tables t where t.table_name = c.oid::regclass)), 0,
  'every is_demo table is registered for delete_all_demo_data()');
select tests.assert((select delete_order from app.demo_tables where table_name = 'public.payment_records'::regclass)
  < (select delete_order from app.demo_tables where table_name = 'public.orders'::regclass),
  'order children are deleted before orders');

-- Real records that must survive the cleanup.
insert into public.brands (slug, name, is_visible, is_demo) values ('live14-brand', '{"ar": "علامة", "en": "Brand"}', true, false)
returning id as brand_id \gset
insert into public.products (slug, name, brand_id, status, is_visible, is_demo)
values ('live14-phone', '{"ar": "هاتف", "en": "Phone"}', :'brand_id', 'published', true, false)
returning id as product_id \gset
select count(*) as live_settings from public.site_settings \gset
select count(*) as live_sections from public.page_sections \gset
select tests.assert((select count(*) from public.products where is_demo) > 0, 'demo catalog present before cleanup');

-- Only demo.manage may delete demo data.
select tests.act_as(:'editor');
select tests.assert_raises($$select public.delete_all_demo_data()$$, '42501', 'content editors cannot delete demo data');
reset role;
select tests.act_as(:'owner');
select public.delete_all_demo_data() as deleted \gset
reset role;
select tests.assert((:'deleted'::jsonb ->> 'public.products')::int > 0, 'cleanup reports what it deleted');

-- The audit script's checks, as the launch runbook runs them.
create temp table audit as
with demo_columns as (
  select c.oid::regclass as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'is_demo' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
)
select tbl::text as tbl,
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %s where is_demo', tbl), false, true, '')))[1]::text::bigint as found
from demo_columns;
select tests.assert((select count(*) from audit) >= 18, 'audit inspects every is_demo table');
select tests.assert_equal((select coalesce(sum(found), 0)::int from audit), 0, 'zero demo rows left in any table');
select tests.assert_equal((select count(*)::int from public.product_media t where not is_demo and t::text like '%/demo/media/%')
  + (select count(*)::int from public.site_settings t where t::text like '%/demo/media/%')
  + (select count(*)::int from public.page_sections t where t::text like '%/demo/media/%'), 0,
  'no live row points at demo media');
select tests.assert_equal((select coalesce((value ->> 'showDemoCatalog')::boolean, false)
                           from public.site_settings where key = 'features'), false, 'demo catalog switch is off');
select tests.act_as_anon();
select tests.assert_equal(jsonb_array_length(public.seo_public_index() -> 'products'), 1, 'public index lists only the live product');
reset role;

-- Real records untouched; the cleanup is audited.
select tests.assert_equal((select slug from public.products where id = :'product_id'), 'live14-phone', 'live product kept');
select tests.assert_equal((select count(*) from public.site_settings), :'live_settings'::bigint, 'settings kept');
select tests.assert_equal((select count(*) from public.page_sections), :'live_sections'::bigint, 'page layouts kept');
select tests.assert(exists (select 1 from public.audit_logs where action = 'demo.delete_all' and actor_id = :'owner'),
  'demo cleanup is audited with its actor');

-- ══ Anti-abuse: anonymous waitlist / stock-alert requests ═══════════════════
select tests.act_as_anon();
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true) as h1 \gset
do $$ begin
  for i in 0..9 loop perform public.join_waitlist('live14-phone', 'Guest', '0101234560' || i); end loop;
end $$;
select tests.assert_raises($$select public.join_waitlist('live14-phone', 'Guest', '01099999999')$$, '54000',
  'an 11th guest request from the same IP within an hour is refused');
select tests.assert_raises($$select public.request_stock_alert('live14-phone', null, 'Guest', '01099999998')$$, '54000',
  'stock alerts share the same budget');
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.7"}', true) as h2 \gset
select tests.assert_equal(public.join_waitlist('live14-phone', 'Other', '01155555555') ->> 'status', 'created',
  'another visitor is not affected');
reset role;
select tests.assert((select count(*) from app.rate_events where subject = 'ip:203.0.113.9') = 10,
  'rate events are kept per client IP');
-- Spoofed X-Forwarded-For hops (a new "IP" per request) still hit the global ceiling (10 × 100 / hour).
insert into app.rate_events (bucket, subject)
  select 'public_request', 'ip:spoofed-' || g from generate_series(1, 1000 - 11) g;
select tests.act_as_anon();
select set_config('request.headers', '{"x-forwarded-for": "192.0.2.44"}', true) as h3 \gset
select tests.assert_raises($$select public.join_waitlist('live14-phone', 'Spoof', '01177777777')$$, '54000',
  'a flood with rotating forwarded IPs is capped by the global ceiling');
reset role;

-- ══ Webhook log flood cap (bad signatures) ════════════════════════════════════
select set_config('request.jwt.claims', '{"role": "service_role"}', true) as claims \gset
set local role service_role;
do $$ begin
  for i in 1..205 loop
    perform public.integration_record_webhook('whatsapp', 'rejected:' || i, 'bad_signature', false);
  end loop;
end $$;
reset role;
select tests.assert_equal((select count(*)::int from public.integration_webhook_events
                           where key = 'whatsapp' and not signature_valid), 200,
  'at most 200 rejected webhook requests are logged per hour');

-- ══ MFA for integration management (when enforced) ═══════════════════════════
update public.site_settings set value = value || '{"adminMfaRequired": true}' where key = 'security';
select tests.act_as(:'owner');
select tests.assert_raises($$select public.admin_save_integration('google_analytics', 'ga4', '{"measurementId": "G-MFA12345"}')$$,
  '42501', 'configuring an integration needs an MFA session when MFA is enforced');
reset role;
select tests.act_as(:'owner', 'aal2');
select tests.assert_equal(public.admin_save_integration('google_analytics', 'ga4', '{"measurementId": "G-MFA12345"}') ->> 'ok',
  'true', 'an MFA-verified owner can configure it');
select tests.assert_equal(public.admin_record_client_check('google_analytics', 'connected', 'connected') ->> 'ok', 'true',
  'health-check bookkeeping is not an MFA action');
reset role;
select tests.act_as(:'owner');
select tests.assert_equal(public.admin_record_client_check('google_analytics', 'failed', 'timeout') ->> 'ok', 'true',
  'recording a check without MFA still works');
select tests.assert_raises($$select public.admin_set_integration_enabled('google_analytics', true, null)$$, '42501',
  'enabling needs MFA too');
reset role;
update public.site_settings set value = value || '{"adminMfaRequired": false}' where key = 'security';

-- The shipped audit script runs and is all green now.
\ir ../../scripts/demo_audit.sql
rollback;
