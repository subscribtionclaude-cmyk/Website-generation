-- Phase 08: SEO index (published, non-demo rows only), admin SEO overview, SEO settings workflow,
-- performance / setup settings, first-run setup completion (permissions, demo choice, audit).
begin;

select tests.create_user('owner12@test.local', 'owner') as owner \gset
select tests.create_user('super12@test.local', 'super_admin') as super \gset
select tests.create_user('manager12@test.local', 'store_manager') as manager \gset
select tests.create_user('editor12@test.local', 'content_editor') as editor \gset
select tests.create_user('sales12@test.local', 'sales') as sales \gset
select tests.create_user('alice12@test.local') as alice \gset

-- ══ Settings contracts ══════════════════════════════════════════════════════
select tests.assert_equal((select is_public from public.setting_definitions where key = 'performance'), true,
  'performance is public (the storefront applies it)');
select tests.assert_equal((select is_public from public.setting_definitions where key = 'setup'), false,
  'setup state is private');
select tests.act_as_anon();
select tests.assert(exists (select 1 from public.site_settings where key = 'performance'), 'anon reads performance');
select tests.assert(not exists (select 1 from public.site_settings where key = 'setup'), 'anon cannot read setup');
reset role;

-- ══ SEO index: demo / live separation ═══════════════════════════════════════
select count(*)::int as live_products from public.products p join public.brands b on b.id = p.brand_id
 where p.status = 'published' and p.is_visible and p.deleted_at is null and not p.is_demo
   and b.is_visible and b.deleted_at is null and not b.is_demo \gset
select tests.act_as_anon();
select public.seo_public_index() as idx \gset
select tests.assert_equal(jsonb_array_length(:'idx'::jsonb -> 'products'), :live_products,
  'the index lists every published live product');
reset role;
select tests.assert((select count(*) from public.products where is_demo and status = 'published') > 0,
  'fixture: demo products exist');
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';
select tests.act_as_anon();
select public.seo_public_index() as shown \gset
reset role;
select tests.assert(not exists (
  select 1 from jsonb_array_elements(:'shown'::jsonb -> 'products') x
  join public.products p on p.slug = x ->> 'slug' where p.is_demo),
  'demo products never reach the sitemap, even when the demo catalog is shown');
select tests.assert(not exists (
  select 1 from jsonb_array_elements(:'shown'::jsonb -> 'offers') x
  join public.offers o on o.slug = x ->> 'slug' where o.is_demo), 'no demo offers either');
select tests.assert(not exists (
  select 1 from jsonb_array_elements(:'shown'::jsonb -> 'entries') x
  join public.content_entries e on e.slug = x ->> 'slug' where e.is_demo), 'no demo news either');

-- A live product appears once published and visible; hiding it removes it.
insert into public.brands (slug, name, is_visible, is_demo) values ('seo-live-brand', '{"ar": "علامة", "en": "Brand"}', true, false)
returning id as brand_id \gset
insert into public.products (slug, name, brand_id, status, is_visible, is_demo)
values ('seo-live-phone', '{"ar": "هاتف", "en": "Phone"}', :'brand_id', 'published', true, false);
select tests.act_as_anon();
select tests.assert(public.seo_public_index() -> 'products' @> '[{"slug": "seo-live-phone"}]',
  'published live product is indexed');
reset role;
update public.products set is_visible = false where slug = 'seo-live-phone';
select tests.act_as_anon();
select tests.assert(not (public.seo_public_index() -> 'products' @> '[{"slug": "seo-live-phone"}]'),
  'hidden product leaves the index');
select tests.assert_equal(public.seo_public_index() -> 'legal', '[]'::jsonb, 'unwritten legal pages are not listed');
reset role;

-- ══ SEO settings: the allowIndexing switch follows the settings workflow ════
select tests.act_as(:'editor');
select tests.assert_raises($$select public.publish_setting('seo', null, false)$$, '42501',
  'content editors cannot publish SEO (content.publish)');
reset role;
select tests.assert_equal(public.seo_public_index() ->> 'allowIndexing', 'false',
  'a freshly seeded store is not indexable until the owner switches indexing on');
select tests.act_as(:'manager');
select public.save_setting_draft('seo', (select value from public.site_settings where key = 'seo') || '{"allowIndexing": true}');
select tests.assert_equal(public.seo_public_index() ->> 'allowIndexing', 'false', 'a draft does not change indexing');
select public.publish_setting('seo', 'Launch: allow indexing', false);
select tests.assert_equal(public.seo_public_index() ->> 'allowIndexing', 'true', 'publishing does');
select public.save_setting_draft('seo', (select value from public.site_settings where key = 'seo') || '{"allowIndexing": false}');
select public.publish_setting('seo', 'Pause indexing', false);
select tests.assert_equal(public.seo_public_index() ->> 'allowIndexing', 'false', 'indexing can be paused again');
reset role;

-- ══ Admin SEO overview ══════════════════════════════════════════════════════
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_seo_overview()$$, '42501', 'sales has no content.view');
reset role;
select tests.act_as_anon();
select tests.assert_raises($$select public.admin_seo_overview()$$, '42501', 'anon cannot read the overview');
reset role;
select tests.act_as(:'editor');
select public.admin_seo_overview() as ov \gset
select tests.assert_equal((:'ov'::jsonb ->> 'allowIndexing'), 'false', 'overview shows indexing status');
select tests.assert((:'ov'::jsonb -> 'products' ->> 'published')::int >= 0, 'product counts');
select tests.assert((:'ov'::jsonb -> 'demoPublished' ->> 'products')::int > 0, 'demo rows are counted separately');
select tests.assert(:'ov'::jsonb ? 'pageSeo', 'page SEO status comes from page_seo');
select tests.assert(:'ov'::jsonb -> 'missing' @> '[{"slug": "seo-live-phone"}]'
  or not ((:'ov'::jsonb -> 'missing') @> '[{"slug": "seo-live-phone"}]'), 'missing list present');
reset role;

-- ══ First-run setup ═════════════════════════════════════════════════════════
select tests.act_as(:'alice');
select tests.assert_raises($$select public.admin_complete_setup('keep', null)$$, '42501', 'customers cannot');
reset role;
select tests.act_as(:'editor');
select tests.assert_raises($$select public.admin_complete_setup('keep', null)$$, '42501',
  'settings.publish is required');
reset role;
select tests.act_as(:'manager');
select tests.assert_raises($$select public.admin_complete_setup('keep', null)$$, '42501',
  'store managers view settings but cannot publish them');
reset role;
select tests.act_as(:'super');
select tests.assert_equal(public.admin_complete_setup('explode', null) ->> 'code', 'invalid_choice', 'unknown choice');
select tests.assert_equal(public.admin_complete_setup('keep', null) ->> 'ok', 'true', 'keep demo content');
select tests.assert_equal((select value ->> 'demoChoice' from public.site_settings where key = 'setup'), 'keep',
  'setup state recorded');
reset role;
select tests.assert((select count(*) from public.products where is_demo) > 0, 'keep leaves demo rows');

select tests.act_as(:'owner');
select public.admin_complete_setup('delete', 'Launch') as done \gset
select tests.assert_equal(:'done'::jsonb ->> 'ok', 'true', 'owner deletes demo content');
reset role;
select tests.assert_equal((select count(*)::int from public.products where is_demo), 0, 'demo products gone');
select tests.assert((select count(*) from public.products where not is_demo) > 0, 'live products untouched');
select tests.assert(exists (select 1 from public.site_settings_versions where key = 'setup' and note = 'Launch'),
  'setup completion is versioned');
select tests.assert(exists (select 1 from public.audit_logs where action = 'setup.completed'
                            and metadata ->> 'demoChoice' = 'delete'), 'setup completion is audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'demo.delete_all'), 'demo deletion audited');
select tests.assert_equal(app.audit_module('public.site_settings', 'setup.completed'), 'settings', 'audit module');

rollback;
