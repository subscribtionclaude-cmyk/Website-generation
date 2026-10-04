-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Catalog import support (additive, idempotent)
--
-- 1. Admin product list: "Missing price" filter (price = 'missing' | 'priced') and a per-product
--    missingPriceCount, so staff can find every "Ask for price" product and price it in place.
-- 2. Import provenance: catalog_import_batches + catalog_sources record, for every imported brand,
--    product, variant and image, the official source URL, the source domain, when it was checked and
--    the import batch. Staff-only (catalog.view); written only by the operator's import script.
--
-- A variant with price NULL stays "Ask for price": visible on the storefront, never purchasable
-- (build_quote marks it not_purchasable and create_order refuses the cart) — unchanged here.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_products(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_any_permission(array['catalog.view', 'pricing.manage', 'inventory.manage']);
  v_limit   integer := app.page_limit(p_filter, 25, 100);
  v_offset  integer := app.page_offset(p_filter);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_brand   uuid := nullif(p_filter ->> 'brandId', '')::uuid;
  v_cat     uuid := nullif(p_filter ->> 'categoryId', '')::uuid;
  v_status  text := nullif(p_filter ->> 'status', '');
  v_vis     text := nullif(p_filter ->> 'visibility', '');
  v_stock   text := nullif(p_filter ->> 'stock', '');
  v_offer   text := nullif(p_filter ->> 'offer', '');
  v_price   text := nullif(p_filter ->> 'price', '');
  v_demo    text := nullif(p_filter ->> 'data', '');
  v_sort    text := coalesce(nullif(p_filter ->> 'sort', ''), 'updated_desc');
  v_total   integer;
  v_items   jsonb;
begin
  with base as (
    select p.id, p.slug, p.name, p.model, p.status, p.is_visible, p.is_demo, p.is_new, p.is_featured,
      p.availability_state, p.updated_at, p.brand_id,
      p.name ->> 'en' as sort_name,
      (select min(v.price) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null and v.is_active) as starting_price,
      (select count(*) from public.product_variants v where v.product_id = p.id and v.deleted_at is null) as variant_count,
      (select count(*) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null and v.is_active and v.price is null) as unpriced_count,
      (select coalesce(sum(v.stock_quantity), 0) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null) as stock_total,
      (select coalesce(sum(app.variant_available_quantity(v.id)), 0) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null and v.is_active) as available_total,
      (select count(*) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null and v.is_active
         and app.variant_available_quantity(v.id) <= 0) as out_count,
      (select count(*) from public.product_variants v
       where v.product_id = p.id and v.deleted_at is null and v.is_active
         and app.variant_available_quantity(v.id) > 0
         and app.variant_available_quantity(v.id) <= v.low_stock_threshold) as low_count,
      exists (select 1 from public.offers o
              where app.offer_is_active(o) and (
                exists (select 1 from public.offer_products op where op.offer_id = o.id and op.product_id = p.id)
                or exists (select 1 from public.offer_categories oc join public.product_categories pc
                             on pc.category_id = oc.category_id where oc.offer_id = o.id and pc.product_id = p.id)))
        as has_offer
    from public.products p
    where p.deleted_at is null
      and (v_q is null or p.search_text ilike app.like_pattern(lower(v_q)) or p.slug ilike app.like_pattern(v_q)
           or p.name ->> 'ar' ilike app.like_pattern(v_q) or p.name ->> 'en' ilike app.like_pattern(v_q)
           or exists (select 1 from public.product_variants v where v.product_id = p.id
                      and (v.sku ilike app.like_pattern(v_q) or v.barcode = v_q)))
      and (v_brand is null or p.brand_id = v_brand)
      and (v_cat is null or exists (select 1 from public.product_categories pc
                                    where pc.product_id = p.id and pc.category_id = v_cat))
      and (v_status is null or p.status = v_status)
      and (v_vis is null or (v_vis = 'visible') = p.is_visible)
      and (v_demo is null or (v_demo = 'demo') = p.is_demo)
  ),
  matched as (
    select * from base
    where (v_stock is null
           or (v_stock = 'out' and out_count > 0)
           or (v_stock = 'low' and low_count > 0)
           or (v_stock = 'in_stock' and available_total > 0))
      and (v_offer is null or (v_offer = 'with') = has_offer)
      -- "Missing price": at least one active variant has no published price (Ask for price).
      and (v_price is null or (v_price = 'missing' and unpriced_count > 0)
           or (v_price = 'priced' and unpriced_count = 0 and starting_price is not null))
  ),
  page as (
    select * from matched
    order by
      case when v_sort = 'name' then sort_name end asc,
      case when v_sort = 'price_asc' then starting_price end asc nulls last,
      case when v_sort = 'price_desc' then starting_price end desc nulls last,
      case when v_sort = 'stock_asc' then available_total end asc,
      updated_at desc, id
    limit v_limit offset v_offset
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'slug', m.slug, 'name', m.name, 'model', m.model, 'status', m.status,
             'isVisible', m.is_visible, 'isDemo', m.is_demo, 'isNew', m.is_new, 'isFeatured', m.is_featured,
             'availabilityState', m.availability_state, 'updatedAt', m.updated_at,
             'brand', (select jsonb_build_object('id', b.id, 'name', b.name) from public.brands b where b.id = m.brand_id),
             'category', (select jsonb_build_object('id', c.id, 'name', c.name) from public.product_categories pc
                          join public.categories c on c.id = pc.category_id
                          where pc.product_id = m.id order by pc.is_primary desc, pc.sort_order limit 1),
             'image', (select pm.url from public.product_media pm where pm.product_id = m.id and pm.kind = 'image'
                       order by pm.is_cover desc, pm.sort_order limit 1),
             'startingPrice', m.starting_price, 'variantCount', m.variant_count,
             'missingPriceCount', m.unpriced_count,
             'stock', jsonb_build_object('total', m.stock_total, 'available', m.available_total,
                                         'out', m.out_count, 'low', m.low_count),
             'hasOffer', m.has_offer) order by m.ord)
           from (select page.*, row_number() over () as ord from page) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Import provenance ───────────────────────────────────────────────────────
create table if not exists public.catalog_import_batches (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  description text not null check (char_length(description) between 1 and 500),
  manifest    text not null check (char_length(manifest) between 1 and 200),
  created_at  timestamptz not null default now()
);

create table if not exists public.catalog_sources (
  entity_type       text not null check (entity_type in ('brand', 'category', 'product', 'variant', 'media')),
  entity_id         uuid not null,
  batch_id          text not null references public.catalog_import_batches (id),
  manifest_key      text not null check (char_length(manifest_key) between 1 and 200),
  source_brand      text check (source_brand is null or char_length(source_brand) <= 60),
  source_url        text check (source_url is null or source_url ~ '^https://'),
  image_source_url  text check (image_source_url is null or image_source_url ~ '^https://'),
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  checked_at        timestamptz not null,
  updated_at        timestamptz not null default now(),
  primary key (entity_type, entity_id),
  unique (entity_type, manifest_key)
);

comment on table public.catalog_sources is
  'Where each imported catalog row came from (official manufacturer pages / media) and which import batch wrote it.';

create index if not exists catalog_sources_batch_idx on public.catalog_sources (batch_id);

do $$
declare
  t text;
begin
  foreach t in array array['catalog_import_batches', 'catalog_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.has_permission(''catalog.view'')))',
                   t || '_staff_select', t);
  end loop;
end;
$$;
