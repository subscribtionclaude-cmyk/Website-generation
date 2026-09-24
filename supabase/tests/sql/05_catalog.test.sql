-- Storefront catalog RPCs. Expectations mirror src/domain/catalog/engine.test.ts (demo adapter parity).
begin;

create temporary table r on commit drop as select 1;
grant select on r to anon, authenticated;

-- ── Demo gating: live storefront never shows demo rows by default ─────────
select tests.act_as_anon();
select tests.assert_equal((public.catalog_search('{}') ->> 'total')::int, 0, 'demo products hidden while features.showDemoCatalog is off');
select tests.assert(public.catalog_product('iphone-18-pro') is null, 'demo product detail hidden while flag is off');
select tests.assert_equal(jsonb_array_length(public.storefront_offers()), 0, 'demo offers hidden while flag is off');
select tests.assert_equal(jsonb_array_length(public.catalog_brands()), 0, 'demo brands hidden while flag is off');
select tests.assert_equal(jsonb_array_length(public.storefront_page_sections('home')), 13, 'home layout (base config) is always available');
reset role;

update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';

select tests.act_as_anon();
-- ── Listing & pagination ───────────────────────────────────────────────────
select tests.assert_equal((public.catalog_search('{"pageSize": 12}') ->> 'total')::int, 28, '28 demo products visible with staging flag');
select tests.assert_equal(jsonb_array_length(public.catalog_search('{"pageSize": 12}') -> 'items'), 12, 'page size respected');
select tests.assert_equal(jsonb_array_length(public.catalog_search('{"pageSize": 12, "page": 3}') -> 'items'), 4, 'last page');
select tests.assert((public.catalog_search('{"pageSize": 48}') -> 'items' -> 0 ->> 'isDemo')::boolean, 'demo rows are labelled isDemo');
select tests.assert_equal((public.catalog_search('{"pageSize": 500}') ->> 'pageSize')::int, 48, 'page size is capped at 48');

-- ── Search (normalised Arabic, transliterations, brand/category names) ────
select tests.assert_equal(app.normalize_search('آيفون ١٨ بـرو'), 'ايفون 18 برو', 'search normalisation matches the TS implementation');
select tests.assert_equal((public.catalog_search('{"q": "ايفون", "pageSize": 48}') ->> 'total')::int, 6, 'Arabic transliteration search');
select tests.assert_equal(
  (select string_agg(item ->> 'slug', ',' order by ord) from jsonb_array_elements(
     public.catalog_search('{"q": "آيفون 18", "sort": "price_asc", "pageSize": 48}') -> 'items') with ordinality as t(item, ord)),
  'magsafe-clear-case-18-pro,iphone-18-pro,iphone-18-pro-max', 'multi-token search, price ascending');
select tests.assert_equal((public.catalog_search('{"q": "Samsung"}') ->> 'total')::int, 5, 'brand name search');
select tests.assert_equal((public.catalog_search('{"q": "سماعات"}') ->> 'total')::int, 3, 'category name search (Arabic)');
select tests.assert_equal((public.catalog_search('{"q": "zzzz-nothing"}') ->> 'total')::int, 0, 'no results');

-- ── Filters ────────────────────────────────────────────────────────────────
select tests.assert_equal((public.catalog_search('{"brands": ["samsung"]}') ->> 'total')::int, 5, 'brand filter');
select tests.assert_equal((public.catalog_search('{"categories": ["laptops"]}') ->> 'total')::int, 2, 'category filter includes sub-categories');
select tests.assert_equal((public.catalog_search('{"categories": ["playstation-5"]}') ->> 'total')::int, 1, 'sub-category filter');
select tests.assert_equal(public.catalog_search('{"availability": ["coming_soon"]}') -> 'items' -> 0 ->> 'slug', 'iphone-duo', 'availability filter');
select tests.assert_equal((public.catalog_search('{"onOffer": true, "pageSize": 48}') ->> 'total')::int, 10, 'offers filter (price drops + active offers)');
select tests.assert_equal((public.catalog_search('{"newOnly": true, "pageSize": 48}') ->> 'total')::int, 7, 'new filter');

-- Variant-level filters must be satisfied by the SAME variant.
select tests.assert_equal((public.catalog_search('{"minPrice": 20000, "maxPrice": 30000, "pageSize": 48}') ->> 'total')::int, 6, 'budget 20k–30k');
select tests.assert_equal(
  (select item -> 'price' from jsonb_array_elements(public.catalog_search('{"minPrice": 20000, "maxPrice": 30000, "pageSize": 48}') -> 'items') item
   where item ->> 'slug' = 'ipad-11'),
  '{"min": 21000.00, "max": 26000.00, "compareAt": null}'::jsonb, 'card shows only in-budget variant prices');
select tests.assert_equal(
  (select string_agg(item ->> 'slug', ',') from jsonb_array_elements(
     public.catalog_search('{"q": "iphone 18 pro", "storage": ["1tb"], "colors": ["orange"], "inStockOnly": true, "pageSize": 48}') -> 'items') item),
  'iphone-18-pro-max', 'sold-out exact combination excluded (1TB + orange + in stock)');
select tests.assert_equal(
  (select (item -> 'price' ->> 'min')::numeric from jsonb_array_elements(public.catalog_search('{"colors": ["orange"], "storage": ["512gb"], "pageSize": 48}') -> 'items') item
   where item ->> 'slug' = 'iphone-18-pro'), 83500::numeric, 'orange 512GB has its own price');
select tests.assert_equal(
  (select item -> 'image' ->> 'colorKey' from jsonb_array_elements(public.catalog_search('{"colors": ["orange"], "storage": ["512gb"], "pageSize": 48}') -> 'items') item
   where item ->> 'slug' = 'iphone-18-pro'), 'orange', 'card image follows the filtered colour');

-- ── Sorting ────────────────────────────────────────────────────────────────
select tests.assert_equal(public.catalog_search('{"sort": "price_asc"}') -> 'items' -> 0 ->> 'slug', 'usb-c-cable', 'price ascending');
select tests.assert_equal(public.catalog_search('{"sort": "price_desc"}') -> 'items' -> 0 ->> 'slug', 'macbook-pro-14', 'price descending');
select tests.assert_equal(public.catalog_search('{"sort": "best_selling"}') -> 'items' -> 0 ->> 'slug', 'iphone-18-pro', 'best selling (demo ranking)');
select tests.assert_equal(public.catalog_search('{"sort": "newest"}') -> 'items' -> 0 ->> 'slug', 'magsafe-clear-case-18-pro', 'newest');
select tests.assert_equal(public.catalog_search('{"sort": "price_asc", "pageSize": 48}') -> 'items' -> 27 ->> 'slug', 'iphone-duo', 'unpriced products sort last');

-- ── Facets ─────────────────────────────────────────────────────────────────
select tests.assert_equal(jsonb_array_length(public.catalog_search('{"brands": ["samsung"]}') -> 'facets' -> 'brands'), 7, 'brand facet ignores the brand filter');
select tests.assert_equal(
  (select (b ->> 'count')::int from jsonb_array_elements(public.catalog_search('{"brands": ["samsung"]}') -> 'facets' -> 'brands') b where b ->> 'key' = 'apple'),
  16, 'apple count in brand facet');
select tests.assert_equal(
  (select string_agg(s ->> 'key', ',' order by ord) from jsonb_array_elements(public.catalog_search('{"brands": ["samsung"]}') -> 'facets' -> 'storage') with ordinality t(s, ord)),
  '128gb,256gb,512gb', 'storage facet (scoped, ordered by size)');
select tests.assert_equal(public.catalog_search('{"brands": ["samsung"]}') -> 'facets' -> 'price', '{"min": 9000.00, "max": 70000.00}'::jsonb, 'price facet');
select tests.assert_equal(
  (select string_agg(s ->> 'key', ',' order by ord) from jsonb_array_elements(public.catalog_search('{}') -> 'facets' -> 'storage') with ordinality t(s, ord)),
  '128gb,256gb,512gb,1tb', 'TB sorts after GB');
select tests.assert_equal(
  (select string_agg(s ->> 'key', ',' order by ord) from (select * from jsonb_array_elements(public.catalog_search('{}') -> 'facets' -> 'categories') with ordinality t(s, ord) limit 4) x),
  'phones,tablets,laptops,macbook', 'category facet order (children after parent)');
select tests.assert_equal(public.catalog_search('{}') -> 'facets' -> 'colors' -> 0 ->> 'key', 'black', 'most common colour first');
select tests.assert_equal((public.catalog_search('{}') -> 'facets' -> 'colors' -> 0 ->> 'count')::int, 14, 'colour facet count');
select tests.assert_raises($$select public.catalog_search(jsonb_build_object('q', repeat('x', 81)))$$, '22023', 'overlong queries rejected');

-- ── Product detail ─────────────────────────────────────────────────────────
select tests.assert(position('stock_quantity' in public.catalog_product('iphone-18-pro')::text) = 0
                    and position('"stock"' in public.catalog_product('iphone-18-pro')::text) = 0, 'no stock quantities in the payload');
select tests.assert_equal(
  (select v ->> 'stockState' from jsonb_array_elements(public.catalog_product('iphone-18-pro') -> 'variants') v where v ->> 'sku' = 'IP18P-1TB-ORANGE'),
  'out_of_stock', 'sold-out variant state');
select tests.assert_equal(
  (select v ->> 'stockState' from jsonb_array_elements(public.catalog_product('iphone-18-pro') -> 'variants') v where v ->> 'sku' = 'IP18P-512GB-BLUE'),
  'low_stock', 'low-stock variant state');
select tests.assert_equal(
  (select (v ->> 'price')::numeric from jsonb_array_elements(public.catalog_product('iphone-18-pro') -> 'variants') v
   where v -> 'options' = '{"storage": "512gb", "color": "orange"}'::jsonb), 83500::numeric, 'variant options map');
select tests.assert_equal(jsonb_array_length(public.catalog_product('iphone-18-pro') -> 'variants'), 12, '3 storages × 4 colours');
select tests.assert_equal(jsonb_array_length(public.catalog_product('iphone-18-pro') -> 'media'), 8, 'colour-specific media');
select tests.assert_equal(
  (select count(*)::int from jsonb_array_elements(public.catalog_product('iphone-18-pro') -> 'media') m where m ->> 'colorKey' = 'blue'), 2,
  'media linked to colour values');
select tests.assert(public.catalog_product('iphone-18-pro') -> 'relations' -> 'accessories' @> '[{"slug": "magsafe-clear-case-18-pro"}]', 'related accessories');
select tests.assert_equal(public.catalog_product('apple-watch-ultra-3') ->> 'stockState', 'out_of_stock', 'fully sold-out product');
select tests.assert_equal(public.catalog_product('iphone-duo') ->> 'availabilityState', 'coming_soon', 'coming soon product');
select tests.assert_equal(public.catalog_product('iphone-duo') -> 'price', '{"min": null, "max": null, "compareAt": null}'::jsonb, 'no invented price for iPhone Duo');
select tests.assert(public.catalog_product('no-such-product') is null, 'unknown product → null');
select tests.assert_equal(jsonb_array_length(public.catalog_categories()), 10, 'categories');
select tests.assert_equal(jsonb_array_length(public.catalog_brands()), 7, 'brands');
select tests.assert_raises($$select count(*) from public.product_variants$$, '42501', 'anon cannot read variant rows (stock) directly');
select tests.assert_raises($$select count(*) from public.products$$, '42501', 'anon cannot read catalog tables directly');
reset role;

-- Suggested (unapproved) specs and relations are never public; drafts are hidden.
insert into public.product_specs (group_id, key, label, value, status, source)
select g.id, 'ai-guess', '{"ar": "اقتراح"}', '{"ar": "قيمة مقترحة"}', 'suggested', 'assisted'
from public.product_spec_groups g join public.products p on p.id = g.product_id where p.slug = 'iphone-17' limit 1;
update public.products set status = 'draft' where slug = 'honor-400';
select tests.act_as_anon();
select tests.assert(position('ai-guess' in public.catalog_product('iphone-17')::text) = 0, 'suggested specs are not published');
select tests.assert(public.catalog_product('honor-400') is null, 'draft products are hidden');
select tests.assert_equal((public.catalog_search('{"pageSize": 48}') ->> 'total')::int, 27, 'draft excluded from listing');
reset role;

-- ── Offers & content windows ───────────────────────────────────────────────
insert into public.offers (slug, kind, title, badge, status, starts_at, ends_at, is_demo)
values ('expired-offer', 'flash', '{"ar": "منتهي"}', '{"ar": "منتهي"}', 'published', now() - interval '3 days', now() - interval '1 day', false),
       ('draft-offer', 'flash', '{"ar": "مسودة"}', '{"ar": "مسودة"}', 'draft', null, null, false);
insert into public.content_entries (slug, type, title, status, publish_at)
values ('future-news', 'news', '{"ar": "لاحقًا"}', 'published', now() + interval '1 day');
select tests.act_as_anon();
select tests.assert_equal(jsonb_array_length(public.storefront_offers()), 7, 'only active, published offers');
select tests.assert(public.storefront_offer('expired-offer') is null, 'expired offer hidden');
select tests.assert_equal(public.storefront_offer('ps5-flash-offer') ->> 'kind', 'flash', 'offer detail');
select tests.assert((public.storefront_offer('ps5-flash-offer') ->> 'endsAt')::timestamptz > now(), 'countdown end timestamp in the future');
select tests.assert_equal(public.storefront_offer('macbook-air-free-charger') -> 'productRoles' ->> 'apple-20w-usb-c-adapter', 'gift', 'gift role');
select tests.assert_equal(
  (select item -> 'offer' from jsonb_array_elements(public.catalog_search('{"q": "20W"}') -> 'items') item), 'null'::jsonb,
  'gift items do not get the offer badge');
select tests.assert_equal(jsonb_array_length(public.storefront_entries()), 7, 'published entries only (future hidden)');
select tests.assert_equal(jsonb_array_length(public.storefront_entries(array['news'])), 2, 'entries by type');
select tests.assert_equal(public.storefront_entry('iphone-duo-teaser') -> 'products' -> 0 ->> 'availabilityState', 'coming_soon', 'entry products');
select tests.assert_equal(jsonb_array_length(public.storefront_page_sections('apple')), 7, 'apple page sections');
select tests.assert_equal(
  (select string_agg(x ->> 'type', ',' order by (x ->> 'sortOrder')::int) from jsonb_array_elements(public.storefront_page_sections('home')) x),
  'hero_campaign,product_rail,offer_rail,category_grid,brand_lines,product_rail,budget_search,promo_banner,promo_banner,coming_soon,content_rail,trust_strip,branch_contact',
  'home section order matches the storefront registry');
select tests.assert(
  (public.catalog_product('iphone-18-pro') -> 'media' -> 0) ? 'captionsUrl',
  'media exposes the captions contract (WebVTT url or null)');
reset role;

-- ── Integrity ──────────────────────────────────────────────────────────────
set constraints all immediate;
select tests.assert_raises($$
  insert into public.product_variants (id, product_id, sku, price)
  select '00000000-0000-0000-0000-0000000000aa', id, 'DUPLICATE-COMBO', 1 from public.products where slug = 'galaxy-buds-3-pro';
  insert into public.variant_option_values (variant_id, option_id, option_value_id)
  select '00000000-0000-0000-0000-0000000000aa', o.id, ov.id
  from public.products p join public.product_options o on o.product_id = p.id
  join public.product_option_values ov on ov.option_id = o.id
  where p.slug = 'galaxy-buds-3-pro' and ov.key = 'silver';
$$, '23505', 'duplicate variant combination rejected');

-- Demo cleanup removes the whole demo catalog through FK cascades.
select tests.create_user('owner5@test.local', 'owner');
select tests.act_as((select id from auth.users where email = 'owner5@test.local'));
select public.delete_all_demo_data();
reset role;
select tests.assert_equal((select count(*)::int from public.products where is_demo), 0, 'demo products deleted');
select tests.assert_equal((select count(*)::int from public.product_variants), 0, 'demo variants deleted');
select tests.assert_equal((select count(*)::int from public.offers where is_demo), 0, 'demo offers deleted');
select tests.assert_equal((select count(*)::int from public.page_sections), 28, 'base page layouts survive demo cleanup');

rollback;
