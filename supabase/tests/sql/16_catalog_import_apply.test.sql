-- Catalog bulk import (app_private.catalog_import): operator-only, dry run writes nothing, the real
-- run creates real (non-demo) "Ask for price" products with provenance, a re-run merges instead of
-- duplicating and never touches prices / stock / status, and content the import does not own
-- (demo brands, demo categories, foreign slugs or SKUs) is reported and left untouched.
begin;

select tests.create_user('owner16@test.local', 'owner') as owner \gset
select tests.create_user('cust16@test.local') as cust \gset

create temp table manifest16 (name text primary key, doc jsonb not null);
insert into manifest16 values ('base', $json$
{
  "version": 1,
  "batch": "test16-wave1",
  "description": "SQL test import",
  "manifestPath": "catalog/manifest/test16.json",
  "checkedAt": "2026-10-04T08:00:00Z",
  "category": { "slug": "smartphones16", "name": { "ar": "الهواتف الذكية", "en": "Smartphones" }, "icon": "phone", "sortOrder": 1 },
  "brands": [
    { "slug": "brand16", "name": { "ar": "براند ١٦", "en": "Brand16" }, "sourceUrl": "https://brand16.example/", "sortOrder": 5 }
  ],
  "products": [
    {
      "key": "brand16/phone-16-pro",
      "brand": "brand16",
      "slug": "brand16-phone-16-pro",
      "model": "Phone 16 Pro",
      "name": { "ar": "Phone 16 Pro", "en": "Phone 16 Pro" },
      "subtitle": { "ar": "شاشة 6.3 بوصة", "en": "6.3-inch display" },
      "keywords": "فون phone",
      "sourceUrl": "https://brand16.example/phone-16-pro/specs",
      "options": [
        { "key": "color", "name": { "ar": "اللون", "en": "Color" }, "values": [
          { "key": "black", "label": { "ar": "أسود", "en": "Black" }, "swatchHex": "#111111" },
          { "key": "silver", "label": { "ar": "فضي", "en": "Silver" }, "swatchHex": "#dddddd" } ] },
        { "key": "storage", "name": { "ar": "السعة", "en": "Storage" }, "values": [
          { "key": "256gb", "label": { "ar": "256 جيجابايت", "en": "256GB" } },
          { "key": "512gb", "label": { "ar": "512 جيجابايت", "en": "512GB" } } ] }
      ],
      "variants": [
        { "sku": "B16-P16P-256-BLK", "options": { "color": "black", "storage": "256gb" } },
        { "sku": "B16-P16P-512-BLK", "options": { "color": "black", "storage": "512gb" } },
        { "sku": "B16-P16P-256-SLV", "options": { "color": "silver", "storage": "256gb" } }
      ],
      "media": [
        { "key": "media/brand16/phone-16-pro/black/1", "color": "black", "isCover": true,
          "url": "https://x.supabase.co/storage/v1/object/public/products/catalog/brand16/0123456789abcdef-1200.webp",
          "sourceUrl": "https://brand16.example/img/black.png",
          "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "width": 1200, "height": 1200, "alt": { "ar": "Brand16 Phone 16 Pro — أسود", "en": "Brand16 Phone 16 Pro — Black" } }
      ],
      "specs": [
        { "key": "display", "title": { "ar": "الشاشة", "en": "Display" }, "items": [
          { "key": "size", "label": { "ar": "المقاس", "en": "Size" }, "value": { "ar": "6.3 بوصة", "en": "6.3-inch" } } ] }
      ]
    }
  ]
}
$json$);

select count(*) as products_before from public.products \gset
select count(*) as variants_before from public.product_variants \gset

-- ── Operator only ───────────────────────────────────────────────────────────
select tests.act_as(:'owner');
select tests.assert_raises($$select app_private.catalog_import('{}'::jsonb, true)$$, '42501',
  'even the Owner session cannot run the catalog import');
reset role;
select tests.act_as_anon();
select tests.assert_raises($$select app_private.catalog_import('{}'::jsonb, true)$$, '42501', 'visitors cannot run the import');
select tests.assert_raises($$select count(*) from app_private.catalog_media_ingest_log$$, '42501', 'visitors cannot read the media ingest log');
reset role;
set local role service_role;
select tests.assert_raises($$select count(*) from app_private.catalog_media_ingest_log$$, '42501', 'the service role cannot read the media ingest log');
reset role;

-- ── Dry run: full report, nothing kept ──────────────────────────────────────
select app_private.catalog_import((select doc from manifest16 where name = 'base'), true) as dry \gset
select tests.assert((:'dry'::jsonb ->> 'dryRun')::boolean, 'the dry run says so');
select tests.assert_equal((:'dry'::jsonb -> 'products' ->> 'created')::int, 1, 'dry run reports the product it would create');
select tests.assert_equal((:'dry'::jsonb -> 'variants' ->> 'created')::int, 3, 'dry run reports the variants it would create');
select tests.assert_equal((:'dry'::jsonb -> 'totals' ->> 'askForPriceVariants')::int, 3, 'dry run counts Ask for price variants');
select tests.assert_equal((select count(*) from public.products)::int, :'products_before'::int, 'the dry run wrote no product');
select tests.assert_equal((select count(*) from public.product_variants)::int, :'variants_before'::int, 'the dry run wrote no variant');
select tests.assert(not exists (select 1 from public.catalog_import_batches where id = 'test16-wave1'), 'the dry run wrote no batch');
select tests.assert(not exists (select 1 from public.brands where slug = 'brand16'), 'the dry run wrote no brand');

-- ── Real run ────────────────────────────────────────────────────────────────
select app_private.catalog_import((select doc from manifest16 where name = 'base'), false) as run1 \gset
select tests.assert_equal((:'run1'::jsonb -> 'products' ->> 'created')::int, 1, 'the import created the product');
select tests.assert_equal((:'run1'::jsonb -> 'brands' ->> 'created')::int, 1, 'the import created the brand');
select tests.assert_equal(jsonb_array_length(:'run1'::jsonb -> 'conflicts'), 0, 'no conflicts on a clean import');
select id as pid from public.products where slug = 'brand16-phone-16-pro' \gset
select tests.assert((select not is_demo and status = 'published' and is_visible and availability_state = 'available'
                     from public.products where id = :'pid'), 'imported products are real, published and visible');
select tests.assert_equal((select count(*)::int from public.product_variants where product_id = :'pid' and price is null and stock_quantity = 0
                           and not is_demo), 3, 'variants are unpriced (Ask for price) with no invented stock');
select tests.assert_equal((select count(*)::int from public.product_variants where product_id = :'pid' and is_default), 1,
  'exactly one default variant');
select tests.assert_equal((select count(*)::int from public.product_media where product_id = :'pid' and is_cover and option_value_id is not null), 1,
  'the official image is the cover and belongs to its colour');
select tests.assert_equal((select status || '/' || source from public.product_specs s join public.product_spec_groups g on g.id = s.group_id
                           where g.product_id = :'pid'), 'approved/assisted', 'specs are public and marked as assisted');
select tests.assert_equal((select count(*)::int from public.catalog_sources where batch_id = 'test16-wave1'), 7,
  'provenance for category, brand, product, 3 variants and the image');
select tests.assert_equal((select image_source_url || ' ' || sha256 from public.catalog_sources where entity_type = 'media' and batch_id = 'test16-wave1'),
  'https://brand16.example/img/black.png 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'image provenance keeps the official source URL and file hash');

-- Storefront: visible, price null, never purchasable.
select id as v256 from public.product_variants where sku = 'B16-P16P-256-BLK' \gset
select tests.act_as_anon();
select public.catalog_product('brand16-phone-16-pro') as detail \gset
select tests.assert(:'detail'::jsonb is not null, 'the imported product is on the storefront');
select tests.assert((:'detail'::jsonb -> 'price' ->> 'min') is null, 'its price is null, never 0');
select tests.assert_equal((public.quote_checkout(tests.items(:'v256', '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status'),
  'not_purchasable', 'an imported unpriced variant cannot be bought');
reset role;

-- ── Staff edits after the import survive a re-run ───────────────────────────
update public.product_variants set price = 55000, stock_quantity = 4 where sku = 'B16-P16P-256-BLK';
update public.products set status = 'draft' where id = :'pid';

select app_private.catalog_import((select doc from manifest16 where name = 'base'), false) as run2 \gset
select tests.assert_equal((:'run2'::jsonb -> 'products' ->> 'created')::int, 0, 're-run creates no product');
select tests.assert_equal((:'run2'::jsonb -> 'products' ->> 'unchanged')::int, 1, 're-run with the same manifest changes nothing');
select tests.assert_equal((:'run2'::jsonb -> 'variants' ->> 'created')::int, 0, 're-run creates no variant');
select tests.assert_equal((:'run2'::jsonb -> 'media' ->> 'created')::int, 0, 're-run creates no image');
select tests.assert_equal((select count(*)::int from public.products where slug like 'brand16-%'), 1, 'no duplicate product');
select tests.assert_equal((select count(*)::int from public.product_variants where product_id = :'pid'), 3, 'no duplicate variants');
select tests.assert_equal((select count(*)::int from public.product_media where product_id = :'pid'), 1, 'no duplicate images');
select tests.assert_equal((select count(*)::int from public.brands where slug = 'brand16'), 1, 'no duplicate brand');
select tests.assert_equal((select price::int || '/' || stock_quantity from public.product_variants where sku = 'B16-P16P-256-BLK'),
  '55000/4', 'a re-run never resets a price or stock entered by staff');
select tests.assert_equal((select status from public.products where id = :'pid'), 'draft', 'a re-run keeps the status staff chose');

-- Changed source data merges into the same rows; a new variant is added.
update manifest16 set doc = jsonb_set(jsonb_set(doc, '{products,0,subtitle}', '{"ar": "شاشة 6.3 بوصة · 5G", "en": "6.3-inch display · 5G"}'),
  '{products,0,variants}', (doc #> '{products,0,variants}') || '[{"sku": "B16-P16P-512-SLV", "options": {"color": "silver", "storage": "512gb"}}]')
where name = 'base';
select app_private.catalog_import((select doc from manifest16 where name = 'base'), false) as run3 \gset
select tests.assert_equal((:'run3'::jsonb -> 'products' ->> 'updated')::int, 1, 'changed source data updates the product');
select tests.assert_equal((:'run3'::jsonb -> 'variants' ->> 'created')::int, 1, 'a newly confirmed variant is added');
select tests.assert_equal((select subtitle ->> 'en' from public.products where id = :'pid'), '6.3-inch display · 5G', 'the merge updated the subtitle');
select tests.assert_equal((select count(*)::int from public.product_variants where product_id = :'pid'), 4, 'four variants, none duplicated');

-- ── Commerce fields are refused ─────────────────────────────────────────────
select tests.assert_raises($$select app_private.catalog_import(jsonb_set((select doc from manifest16 where name = 'base'),
  '{products,0,variants,0,price}', '0'), true)$$, '22023', 'a manifest with a price (even 0) is refused');
select tests.assert_raises($$select app_private.catalog_import(jsonb_set((select doc from manifest16 where name = 'base'),
  '{products,0,variants,0,stock}', '5'), true)$$, '22023', 'a manifest with stock is refused');

-- ── Content the import does not own is reported, never overwritten ─────────
insert into manifest16 values ('conflicts', $json$
{
  "version": 1, "batch": "test16-conflicts", "category": { "slug": "smartphones16", "name": { "ar": "الهواتف الذكية", "en": "Smartphones" } },
  "brands": [
    { "slug": "brand16", "name": { "ar": "براند ١٦", "en": "Brand16" } },
    { "slug": "samsung", "name": { "ar": "سامسونج", "en": "Samsung" } }
  ],
  "products": [
    { "key": "samsung/galaxy-x", "brand": "samsung", "slug": "samsung-galaxy-x", "name": { "ar": "Galaxy X", "en": "Galaxy X" },
      "sourceUrl": "https://www.samsung.com/eg/", "variants": [ { "sku": "SAM-GX-1", "options": {} } ] },
    { "key": "brand16/taken-slug", "brand": "brand16", "slug": "galaxy-s26-ultra", "name": { "ar": "X", "en": "X" },
      "sourceUrl": "https://brand16.example/x", "variants": [ { "sku": "B16-X-1", "options": {} } ] },
    { "key": "brand16/taken-sku", "brand": "brand16", "slug": "brand16-other", "name": { "ar": "Y", "en": "Y" },
      "sourceUrl": "https://brand16.example/y", "variants": [ { "sku": "GS26U-256GB-BLACK", "options": {} } ] }
  ]
}
$json$);
select updated_at as demo_updated from public.products where slug = 'galaxy-s26-ultra' \gset
select app_private.catalog_import((select doc from manifest16 where name = 'conflicts'), false) as run4 \gset
select tests.assert_equal(jsonb_array_length(:'run4'::jsonb -> 'conflicts'), 4,
  'demo brand, its product, a foreign slug and a foreign SKU are all reported');
select tests.assert_equal((:'run4'::jsonb -> 'products' ->> 'created')::int, 0, 'no conflicting product is created');
select tests.assert_equal((select updated_at from public.products where slug = 'galaxy-s26-ultra'), :'demo_updated'::timestamptz,
  'the demo product with that slug is untouched');
select tests.assert(not exists (select 1 from public.products where slug in ('samsung-galaxy-x', 'brand16-other')),
  'nothing is attached to a demo brand or created with a taken SKU');
select tests.assert_equal((:'run4'::jsonb -> 'brands' ->> 'reused')::int, 1, 'the brand created earlier is reused, not duplicated');

update manifest16 set doc = jsonb_set(doc, '{category,slug}', '"phones"') where name = 'conflicts';
select tests.assert_raises($$select app_private.catalog_import((select doc from manifest16 where name = 'conflicts'), true)$$,
  '23505', 'a demo category is never adopted by the real catalog');

rollback;
