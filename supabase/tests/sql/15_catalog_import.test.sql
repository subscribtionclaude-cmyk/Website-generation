-- Catalog import support: "Ask for price" products (variant price NULL) are visible on the
-- storefront but can never reach a paid checkout; staff find them with the "Missing price" filter;
-- import provenance (catalog_import_batches / catalog_sources) is staff-only.
begin;

select tests.create_user('owner15@test.local', 'owner') as owner \gset
select tests.create_user('sales15@test.local', 'sales') as sales \gset
select tests.create_user('designer15@test.local', 'design_editor') as designer \gset
select tests.create_user('cust15@test.local') as cust \gset

-- A real (non-demo) published product with one colour and two storages, no price yet.
insert into public.brands (slug, name, is_visible, is_demo) values ('live15-brand', '{"ar": "علامة", "en": "Brand15"}', true, false)
returning id as brand_id \gset
insert into public.products (slug, name, model, brand_id, status, is_visible, is_demo, published_at)
values ('live15-phone', '{"ar": "هاتف ١٥", "en": "Phone 15"}', 'P15', :'brand_id', 'published', true, false, now())
returning id as product_id \gset
insert into public.product_options (product_id, key, name, sort_order)
values (:'product_id', 'storage', '{"ar": "السعة", "en": "Storage"}', 0) returning id as opt_storage \gset
insert into public.product_option_values (option_id, key, label, sort_order) values
  (:'opt_storage', '128gb', '{"ar": "128 جيجابايت", "en": "128 GB"}', 0) returning id as v128 \gset
insert into public.product_option_values (option_id, key, label, sort_order) values
  (:'opt_storage', '256gb', '{"ar": "256 جيجابايت", "en": "256 GB"}', 1) returning id as v256 \gset
insert into public.product_variants (product_id, sku, price, stock_quantity, is_default, sort_order)
values (:'product_id', 'LIVE15-128GB', null, 3, true, 0) returning id as var128 \gset
insert into public.product_variants (product_id, sku, price, stock_quantity, is_default, sort_order)
values (:'product_id', 'LIVE15-256GB', null, 0, false, 1) returning id as var256 \gset
insert into public.variant_option_values (variant_id, option_id, option_value_id) values
  (:'var128', :'opt_storage', :'v128'), (:'var256', :'opt_storage', :'v256');

-- ── Storefront: visible, no price claimed ───────────────────────────────────
select tests.act_as_anon();
select public.catalog_product('live15-phone') as detail \gset
select tests.assert(:'detail'::jsonb is not null, 'an unpriced published product is visible on the storefront');
select tests.assert_equal((select count(*)::int from jsonb_array_elements(:'detail'::jsonb -> 'variants') v
                           where v ->> 'price' is null), 2, 'both variants are exposed with price null (never 0)');
select tests.assert((:'detail'::jsonb -> 'price' ->> 'min') is null, 'the product price range is null, not 0');
select tests.assert(not exists (
    select 1 from jsonb_array_elements((public.catalog_search('{"q": "phone 15", "minPrice": 0}'::jsonb)) -> 'items') i
    where i ->> 'slug' = 'live15-phone'), 'an unpriced product never matches a price filter');

-- ── Checkout: quote marks it not purchasable, create_order refuses the cart ─
select tests.assert_equal((public.quote_checkout(tests.items(:'var128', '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status'),
  'not_purchasable', 'the quote marks an unpriced variant as not purchasable');
reset role;
select tests.act_as(:'cust');
select tests.assert_equal(
  tests.checkout(tests.items(:'var128', '1'), '{"method": "pickup", "branchId": "abbasseya"}', '{"method": "cod"}') ->> 'code',
  'cart_invalid', 'create_order refuses a cart with an unpriced variant (no paid checkout)');
reset role;
select tests.assert_equal((select count(*)::int from public.order_items where variant_id in (:'var128', :'var256')), 0,
  'no order line was written for the unpriced product');

-- ── Admin: "Missing price" filter ───────────────────────────────────────────
select tests.act_as(:'owner');
select public.admin_list_products('{"price": "missing", "q": "live15", "limit": 100}'::jsonb) as missing \gset
select public.admin_list_products('{"price": "priced", "q": "live15", "limit": 100}'::jsonb) as priced \gset
reset role;
select tests.assert_equal((:'missing'::jsonb ->> 'total')::int, 1, 'Missing price finds the unpriced product');
select tests.assert_equal((:'missing'::jsonb -> 'items' -> 0 ->> 'missingPriceCount')::int, 2, 'missingPriceCount counts unpriced active variants');
select tests.assert_equal((:'priced'::jsonb ->> 'total')::int, 0, 'Priced excludes it');

-- Pricing one variant keeps it in "Missing price" (the other is still unpriced); pricing both moves it.
update public.product_variants set price = 52000 where id = :'var128';
select tests.act_as(:'owner');
select tests.assert_equal((public.admin_list_products('{"price": "missing", "q": "live15"}'::jsonb) ->> 'total')::int, 1,
  'partially priced products stay in Missing price');
reset role;
update public.product_variants set price = 58000 where id = :'var256';
select tests.act_as(:'owner');
select tests.assert_equal((public.admin_list_products('{"price": "priced", "q": "live15"}'::jsonb) ->> 'total')::int, 1,
  'fully priced products move to Priced');
reset role;
-- Entering a price does not invent stock: the 256 GB variant is still 0.
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'var256'), 0,
  'pricing a variant never changes its stock');

select tests.act_as(:'designer');
select tests.assert_raises($$select public.admin_list_products('{}'::jsonb)$$, '42501', 'roles without catalog access cannot list products');
reset role;

-- ── Import provenance: staff-only ───────────────────────────────────────────
insert into public.catalog_import_batches (id, description, manifest)
values ('test-batch-15', 'SQL test batch', 'catalog/manifest/test.json');
insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_brand, source_url, checked_at)
values ('product', :'product_id', 'test-batch-15', 'brand15/phone-15', 'Brand15', 'https://brand15.example/phone-15', now());
select tests.assert_raises($$insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, checked_at)
  values ('product', gen_random_uuid(), 'test-batch-15', 'brand15/phone-15', now())$$, '23505',
  'one source row per manifest key (re-imports update, never duplicate)');
select tests.assert_raises($$insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_url, checked_at)
  values ('media', gen_random_uuid(), 'test-batch-15', 'x', 'http://insecure.example/a.png', now())$$, '23514',
  'source URLs must be https');

select tests.act_as_anon();
select tests.assert_raises($$select count(*) from public.catalog_sources$$, '42501', 'visitors cannot read import provenance');
reset role;
select tests.act_as(:'cust');
select tests.assert_equal((select count(*)::int from public.catalog_sources), 0, 'customers see no provenance rows');
select tests.assert_raises($$insert into public.catalog_import_batches (id, description, manifest) values ('x15-batch', 'x', 'x')$$,
  '42501', 'signed-in users cannot write import batches');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal((select count(*)::int from public.catalog_sources where batch_id = 'test-batch-15'), 1,
  'staff with catalog.view read provenance');
reset role;

rollback;
