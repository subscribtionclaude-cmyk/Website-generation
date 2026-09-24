-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0009 · Storefront read RPCs (+ request intake)
--
-- The public storefront reads ONLY through these SECURITY DEFINER functions. They:
--   • return published, non-deleted rows inside their publish/offer windows;
--   • expose per-variant STOCK STATES (in_stock / low_stock / out_of_stock), never quantities;
--   • exclude is_demo rows unless the staging flag features.showDemoCatalog is on (then every demo
--     row is returned with isDemo=true so the UI labels it) — live mode never silently shows demo data;
--   • implement the same semantics as src/domain/catalog/engine.ts (the demo adapter), verified by
--     supabase/tests/sql/05_catalog.test.sql and src/domain/catalog/engine.test.ts.
-- JSON keys are camelCase and validated by zod in src/repositories/supabase/supabaseStorefront.ts.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.demo_catalog_visible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value ->> 'showDemoCatalog')::boolean from public.site_settings where key = 'features'), false);
$$;

create or replace function app.variant_stock_state(p_quantity integer, p_threshold integer, p_active boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Mirrors src/domain/catalog/stock.ts. Phase 03 subtracts unexpired reservations from p_quantity.
  select case
    when not p_active or p_quantity <= 0 then 'out_of_stock'
    when p_quantity <= p_threshold then 'low_stock'
    else 'in_stock'
  end;
$$;

create or replace function app.storage_rank(p_key text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(regexp_replace(p_key, '[^0-9.]', '', 'g'), '')::numeric, 0)
         * case when p_key like '%tb' then 1024 else 1 end;
$$;

create or replace function app.product_is_visible(p_product public.products)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_product.status = 'published'
     and p_product.deleted_at is null
     and (not p_product.is_demo or app.demo_catalog_visible())
     and exists (select 1 from public.brands b where b.id = p_product.brand_id and b.deleted_at is null and b.is_visible);
$$;

-- Active variants with their option keys and computed stock state (internal).
create or replace view app.storefront_variants as
select
  v.id,
  v.product_id,
  v.sku,
  v.price,
  v.compare_at_price,
  v.is_default,
  v.warranty,
  v.sort_order,
  app.variant_stock_state(v.stock_quantity, v.low_stock_threshold, v.is_active) as stock_state,
  (select ov.key from public.variant_option_values vov
     join public.product_options o on o.id = vov.option_id
     join public.product_option_values ov on ov.id = vov.option_value_id
   where vov.variant_id = v.id and o.key = 'storage') as storage_key,
  (select ov.key from public.variant_option_values vov
     join public.product_options o on o.id = vov.option_id
     join public.product_option_values ov on ov.id = vov.option_value_id
   where vov.variant_id = v.id and o.key = 'color') as color_key,
  coalesce((select jsonb_object_agg(o.key, ov.key) from public.variant_option_values vov
     join public.product_options o on o.id = vov.option_id
     join public.product_option_values ov on ov.id = vov.option_value_id
   where vov.variant_id = v.id), '{}'::jsonb) as options
from public.product_variants v
where v.deleted_at is null and v.is_active;

revoke all on app.storefront_variants from public, anon, authenticated;

create or replace function app.catalog_has_variant_filter(p_query jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_query is not null and (
    p_query ->> 'minPrice' is not null or p_query ->> 'maxPrice' is not null
    or jsonb_array_length(coalesce(p_query -> 'storage', '[]')) > 0
    or jsonb_array_length(coalesce(p_query -> 'colors', '[]')) > 0
    or coalesce((p_query ->> 'inStockOnly')::boolean, false));
$$;

create or replace function app.catalog_variant_matches(
  p_price numeric, p_storage text, p_color text, p_stock_state text, p_query jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_query ->> 'minPrice' is null or (p_price is not null and p_price >= (p_query ->> 'minPrice')::numeric))
     and (p_query ->> 'maxPrice' is null or (p_price is not null and p_price <= (p_query ->> 'maxPrice')::numeric))
     and (jsonb_array_length(coalesce(p_query -> 'storage', '[]')) = 0 or coalesce(p_query -> 'storage', '[]') ? coalesce(p_storage, ''))
     and (jsonb_array_length(coalesce(p_query -> 'colors', '[]')) = 0 or coalesce(p_query -> 'colors', '[]') ? coalesce(p_color, ''))
     and (not coalesce((p_query ->> 'inStockOnly')::boolean, false) or p_stock_state <> 'out_of_stock');
$$;

create or replace function app.offer_is_active(p_offer public.offers)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_offer.status = 'published' and p_offer.deleted_at is null
     and (p_offer.starts_at is null or p_offer.starts_at <= now())
     and (p_offer.ends_at is null or p_offer.ends_at > now())
     and (not p_offer.is_demo or app.demo_catalog_visible());
$$;

create or replace function app.active_offer_badge(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', o.slug, 'kind', o.kind, 'badge', o.badge,
                            'discountPercent', o.discount_percent, 'endsAt', o.ends_at)
  from public.offers o join public.offer_products op on op.offer_id = o.id
  where op.product_id = p_product_id and op.role <> 'gift' and app.offer_is_active(o)
  order by o.sort_order, o.slug
  limit 1;
$$;

create or replace function app.media_json(p_media public.product_media)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_media.id, 'kind', p_media.kind, 'url', p_media.url, 'posterUrl', p_media.poster_url, 'captionsUrl', p_media.captions_url,
    'alt', p_media.alt, 'width', p_media.width, 'height', p_media.height,
    'colorKey', (select ov.key from public.product_option_values ov
                 join public.product_options o on o.id = ov.option_id
                 where ov.id = p_media.option_value_id and o.key = 'color'),
    'isCover', p_media.is_cover);
$$;

-- Card-level summary. p_query (optional) restricts the variants considered (price/storage/colour/stock).
create or replace function app.product_summary(p_product_id uuid, p_query jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_filter boolean := app.catalog_has_variant_filter(p_query);
  v_result jsonb;
begin
  select * into p from public.products where id = p_product_id;
  if not found then return null; end if;

  with vars as (
    select sv.* from app.storefront_variants sv
    where sv.product_id = p.id
      and (not v_filter or app.catalog_variant_matches(sv.price, sv.storage_key, sv.color_key, sv.stock_state, p_query))
  ),
  cheapest as (select * from vars where price is not null order by price, sort_order limit 1),
  opt_values as (
    select o.key as option_key, ov.key, ov.label, ov.swatch_hex, ov.sort_order
    from public.product_options o join public.product_option_values ov on ov.option_id = o.id
    where o.product_id = p.id and o.key in ('storage', 'color')
      and exists (select 1 from vars where vars.options ->> o.key = ov.key)
  ),
  preferred_color as (
    select value as color from jsonb_array_elements_text(coalesce(p_query -> 'colors', '[]'))
    where exists (select 1 from opt_values where option_key = 'color' and key = value)
    limit 1
  ),
  cover as (
    select m.* from public.product_media m
    left join public.product_option_values ov on ov.id = m.option_value_id
    where m.product_id = p.id
    order by (ov.key is not null and ov.key = (select color from preferred_color)) desc, m.is_cover desc, m.sort_order
    limit 1
  ),
  primary_category as (
    select c.slug, c.name from public.product_categories pc join public.categories c on c.id = pc.category_id
    where pc.product_id = p.id order by pc.is_primary desc, pc.sort_order limit 1
  )
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'subtitle', p.subtitle, 'model', p.model,
    'brand', (select jsonb_build_object('slug', b.slug, 'name', b.name) from public.brands b where b.id = p.brand_id),
    'category', (select jsonb_build_object('slug', slug, 'name', name) from primary_category),
    'categorySlugs', to_jsonb(app.product_category_slugs(p.id)),
    'availabilityState', p.availability_state,
    'stockState', coalesce((select case max(case stock_state when 'in_stock' then 2 when 'low_stock' then 1 else 0 end)
                                     when 2 then 'in_stock' when 1 then 'low_stock' else 'out_of_stock' end from vars), 'out_of_stock'),
    'isNew', p.is_new, 'isFeatured', p.is_featured,
    'releaseDate', to_char(p.release_date, 'YYYY-MM-DD'),
    'price', jsonb_build_object(
      'min', (select min(price) from vars), 'max', (select max(price) from vars),
      'compareAt', (select case when compare_at_price > price then compare_at_price end from cheapest)),
    'storages', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label) order by sort_order)
                          from opt_values where option_key = 'storage'), '[]'::jsonb),
    'colors', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'hex', swatch_hex) order by sort_order)
                        from opt_values where option_key = 'color'), '[]'::jsonb),
    'image', (select app.media_json(cover::public.product_media) from cover),
    'offer', app.active_offer_badge(p.id),
    'isDemo', p.is_demo
  ) into v_result;
  return v_result;
end;
$$;

-- Does a product satisfy the query? p_ignore lets facets drop their own dimension
-- ('brands', 'categories', 'variant').
create or replace function app.catalog_matches(p public.products, p_query jsonb, p_ignore text[] default '{}')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from unnest(string_to_array(app.normalize_search(p_query ->> 'q'), ' ')) as token
      where token <> '' and position(token in p.search_text) = 0)
    and ('brands' = any (p_ignore) or jsonb_array_length(coalesce(p_query -> 'brands', '[]')) = 0
         or exists (select 1 from public.brands b where b.id = p.brand_id and coalesce(p_query -> 'brands', '[]') ? b.slug))
    and ('categories' = any (p_ignore) or jsonb_array_length(coalesce(p_query -> 'categories', '[]')) = 0
         or exists (select 1 from unnest(app.product_category_slugs(p.id)) s where coalesce(p_query -> 'categories', '[]') ? s))
    and (not coalesce((p_query ->> 'newOnly')::boolean, false) or p.is_new)
    and (not coalesce((p_query ->> 'featuredOnly')::boolean, false) or p.is_featured)
    and (jsonb_array_length(coalesce(p_query -> 'availability', '[]')) = 0
         or coalesce(p_query -> 'availability', '[]') ? p.availability_state)
    and (not coalesce((p_query ->> 'onOffer')::boolean, false)
         or exists (select 1 from public.product_variants v where v.product_id = p.id and v.deleted_at is null
                    and v.compare_at_price is not null and v.price is not null and v.compare_at_price > v.price)
         or app.active_offer_badge(p.id) is not null)
    and ('variant' = any (p_ignore) or not app.catalog_has_variant_filter(p_query)
         or exists (select 1 from app.storefront_variants sv where sv.product_id = p.id
                    and app.catalog_variant_matches(sv.price, sv.storage_key, sv.color_key, sv.stock_state, p_query)));
$$;

create or replace function app.ordered_categories()
returns table (id uuid, slug text, name jsonb, parent_slug text, ord bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.slug, c.name::jsonb, parent.slug,
         row_number() over (order by coalesce(parent.sort_order, c.sort_order), coalesce(parent.slug, c.slug),
                                     (c.parent_id is not null), c.sort_order, c.slug)
  from public.categories c
  left join public.categories parent on parent.id = c.parent_id
  where c.deleted_at is null and c.is_visible and (not c.is_demo or app.demo_catalog_visible());
$$;

-- ── Public RPCs ──────────────────────────────────────────────────────────────
create or replace function public.catalog_search(p_query jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query jsonb := coalesce(p_query, '{}'::jsonb);
  v_page integer := greatest(coalesce((v_query ->> 'page')::integer, 1), 1);
  v_size integer := least(greatest(coalesce((v_query ->> 'pageSize')::integer, 12), 1), 48);
  v_sort text := coalesce(v_query ->> 'sort', 'featured');
  v_filter boolean := app.catalog_has_variant_filter(v_query);
  v_items jsonb;
  v_total integer;
  v_facets jsonb;
begin
  if char_length(coalesce(v_query ->> 'q', '')) > 80 then
    raise exception 'query_too_long' using errcode = '22023';
  end if;

  with matched as (
    select p.id, p.is_featured, p.release_date, coalesce(p.name ->> 'en', p.name ->> 'ar') as sort_name,
           coalesce((select r.best_seller_score from public.product_rankings r
                     where r.product_id = p.id and r.source = case when p.is_demo then 'demo' else 'analytics' end), 0) as score,
           app.product_summary(p.id, case when v_filter then v_query end) as summary
    from public.products p
    where app.product_is_visible(p) and app.catalog_matches(p, v_query)
  ),
  ranked as (
    select summary, count(*) over () as total,
           row_number() over (order by
             case when v_sort = 'newest' then release_date end desc nulls last,
             case when v_sort = 'price_asc' then (summary -> 'price' ->> 'min')::numeric end asc nulls last,
             case when v_sort = 'price_desc' then (summary -> 'price' ->> 'min')::numeric end desc nulls last,
             case when v_sort = 'best_selling' then score end desc,
             case when v_sort not in ('newest', 'price_asc', 'price_desc', 'best_selling') then is_featured::integer end desc,
             case when v_sort not in ('newest', 'price_asc', 'price_desc', 'best_selling') then score end desc,
             sort_name) as rn
    from matched
  )
  select coalesce(jsonb_agg(summary order by rn) filter (where rn > (v_page - 1) * v_size and rn <= v_page * v_size), '[]'::jsonb),
         coalesce(max(total), 0)
  into v_items, v_total
  from ranked;

  with scope as (
    select p.id from public.products p where app.product_is_visible(p) and app.catalog_matches(p, v_query, array['variant'])
  ),
  scope_variants as (
    select sv.* from app.storefront_variants sv join scope on scope.id = sv.product_id
  ),
  brand_counts as (
    select p.brand_id, count(*) as n from public.products p
    where app.product_is_visible(p) and app.catalog_matches(p, v_query, array['brands', 'variant'])
    group by p.brand_id
  ),
  category_counts as (
    select s.slug, count(*) as n
    from public.products p, unnest(app.product_category_slugs(p.id)) s(slug)
    where app.product_is_visible(p) and app.catalog_matches(p, v_query, array['categories', 'variant'])
    group by s.slug
  ),
  option_values as (
    select distinct on (o.key, ov.key) o.key as option_key, ov.key, ov.label, ov.swatch_hex
    from scope_variants sv
    join public.variant_option_values vov on vov.variant_id = sv.id
    join public.product_options o on o.id = vov.option_id and o.key in ('storage', 'color')
    join public.product_option_values ov on ov.id = vov.option_value_id
    order by o.key, ov.key, ov.sort_order
  ),
  option_counts as (
    select ov.option_key, ov.key, ov.label, ov.swatch_hex,
           (select count(distinct sv.product_id) from scope_variants sv
            where (ov.option_key = 'storage' and sv.storage_key = ov.key)
               or (ov.option_key = 'color' and sv.color_key = ov.key)) as n
    from option_values ov
  )
  select jsonb_build_object(
    'brands', coalesce((select jsonb_agg(jsonb_build_object('key', b.slug, 'label', b.name, 'count', bc.n)
                                         order by b.sort_order, b.slug)
                        from brand_counts bc join public.brands b on b.id = bc.brand_id), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('key', oc.slug, 'label', oc.name, 'count', cc.n) order by oc.ord)
                            from app.ordered_categories() oc join category_counts cc on cc.slug = oc.slug), '[]'::jsonb),
    'storage', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'count', n, 'hex', null)
                                          order by app.storage_rank(key), key)
                         from option_counts where option_key = 'storage'), '[]'::jsonb),
    'colors', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'count', n, 'hex', swatch_hex)
                                         order by n desc, key)
                        from option_counts where option_key = 'color'), '[]'::jsonb),
    'price', jsonb_build_object('min', (select min(price) from scope_variants), 'max', (select max(price) from scope_variants))
  ) into v_facets;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'facets', v_facets);
end;
$$;

create or replace function public.catalog_product(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_summary jsonb;
  v_related jsonb;
begin
  select * into p from public.products where slug = p_slug;
  if not found or not app.product_is_visible(p) then return null; end if;
  v_summary := app.product_summary(p.id);

  select jsonb_build_object(
    'accessories', coalesce(jsonb_agg(app.product_summary(r.related_product_id) order by r.sort_order) filter (where r.kind = 'accessory'), '[]'::jsonb),
    'similar', coalesce(jsonb_agg(app.product_summary(r.related_product_id) order by r.sort_order) filter (where r.kind = 'similar'), '[]'::jsonb),
    'recommended', coalesce(jsonb_agg(app.product_summary(r.related_product_id) order by r.sort_order) filter (where r.kind = 'recommended'), '[]'::jsonb))
  into v_related
  from public.product_relations r join public.products rp on rp.id = r.related_product_id
  where r.product_id = p.id and r.status = 'approved' and app.product_is_visible(rp);

  return v_summary || jsonb_build_object(
    'description', p.description,
    'warranty', p.warranty,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('key', o.key, 'name', o.name, 'values', vals.values) order by o.sort_order)
      from public.product_options o
      cross join lateral (
        select jsonb_agg(jsonb_build_object('key', ov.key, 'label', ov.label, 'hex', ov.swatch_hex) order by ov.sort_order) as values
        from public.product_option_values ov
        where ov.option_id = o.id
          and exists (select 1 from app.storefront_variants sv where sv.product_id = p.id and sv.options ->> o.key = ov.key)
      ) vals
      where o.product_id = p.id and vals.values is not null), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'sku', sv.sku, 'options', sv.options, 'price', sv.price,
                                          'compareAtPrice', sv.compare_at_price, 'stockState', sv.stock_state,
                                          'warranty', sv.warranty, 'isDefault', sv.is_default) order by sv.sort_order, sv.sku)
      from app.storefront_variants sv where sv.product_id = p.id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(app.media_json(m) order by m.sort_order) from public.product_media m where m.product_id = p.id), '[]'::jsonb),
    'specGroups', coalesce((
      select jsonb_agg(jsonb_build_object('key', g.key, 'title', g.title, 'items', items.items) order by g.sort_order)
      from public.product_spec_groups g
      cross join lateral (
        select jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label, 'value', s.value) order by s.sort_order) as items
        from public.product_specs s where s.group_id = g.id and s.status = 'approved'
      ) items
      where g.product_id = p.id and items.items is not null), '[]'::jsonb),
    'relations', coalesce(v_related, '{"accessories": [], "similar": [], "recommended": []}'::jsonb),
    'seo', jsonb_build_object('title', p.seo_title, 'description', p.seo_description));
end;
$$;

create or replace function public.catalog_brands()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'logoUrl', b.logo_url,
    'sortOrder', b.sort_order,
    'categorySlugs', coalesce((
      select jsonb_agg(oc.slug order by oc.ord) from app.ordered_categories() oc
      where exists (select 1 from public.products p where p.brand_id = b.id and app.product_is_visible(p)
                    and oc.slug = any (app.product_category_slugs(p.id)))
         or exists (select 1 from public.brand_categories bc where bc.brand_id = b.id and bc.category_id = oc.id)), '[]'::jsonb),
    'productCount', (select count(*) from public.products p where p.brand_id = b.id and app.product_is_visible(p)),
    'isDemo', b.is_demo) order by b.sort_order, b.slug), '[]'::jsonb)
  from public.brands b
  where b.deleted_at is null and b.is_visible and (not b.is_demo or app.demo_catalog_visible());
$$;

create or replace function public.catalog_categories()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'parentSlug', oc.parent_slug, 'description', c.description,
    'icon', c.icon, 'imageUrl', c.image_url, 'sortOrder', c.sort_order,
    'showInNav', c.show_in_nav, 'showOnHome', c.show_on_home, 'showInShop', c.show_in_shop,
    'showInCategoryGrid', c.show_in_category_grid,
    'productCount', (select count(*) from public.products p where app.product_is_visible(p)
                     and c.slug = any (app.product_category_slugs(p.id))),
    'isDemo', c.is_demo) order by oc.ord), '[]'::jsonb)
  from app.ordered_categories() oc join public.categories c on c.id = oc.id;
$$;

create or replace function app.offer_json(o public.offers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'kind', o.kind, 'title', o.title, 'subtitle', o.subtitle,
    'description', o.description, 'badge', o.badge,
    'media', case when o.media_url is not null then jsonb_build_object('kind', coalesce(o.media_kind, 'image'),
             'url', o.media_url, 'posterUrl', null, 'captionsUrl', null, 'alt', coalesce(o.media_alt::jsonb, o.title::jsonb)) end,
    'cta', case when o.cta_href is not null then jsonb_build_object('label', coalesce(o.cta_label::jsonb, o.title::jsonb), 'href', o.cta_href) end,
    'discountPercent', o.discount_percent, 'discountAmount', o.discount_amount, 'bundlePrice', o.bundle_price,
    'promoCode', o.promo_code, 'startsAt', o.starts_at, 'endsAt', o.ends_at,
    'showCountdown', o.show_countdown, 'featuredOnHome', o.featured_on_home, 'sortOrder', o.sort_order,
    'products', coalesce((select jsonb_agg(app.product_summary(op.product_id) order by op.sort_order, p.slug)
                          from public.offer_products op join public.products p on p.id = op.product_id
                          where op.offer_id = o.id and app.product_is_visible(p)), '[]'::jsonb),
    'productRoles', coalesce((select jsonb_object_agg(p.slug, op.role)
                              from public.offer_products op join public.products p on p.id = op.product_id
                              where op.offer_id = o.id and app.product_is_visible(p)), '{}'::jsonb),
    'isDemo', o.is_demo);
$$;

create or replace function public.storefront_offers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.offer_json(o) order by o.sort_order, o.slug), '[]'::jsonb)
  from public.offers o where app.offer_is_active(o);
$$;

create or replace function public.storefront_offer(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.offer_json(o) from public.offers o where o.slug = p_slug and app.offer_is_active(o);
$$;

create or replace function app.entry_is_visible(e public.content_entries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select e.status = 'published' and e.deleted_at is null and e.publish_at <= now()
     and (e.expires_at is null or e.expires_at > now())
     and (not e.is_demo or app.demo_catalog_visible());
$$;

create or replace function app.entry_json(e public.content_entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'type', e.type, 'eyebrow', e.eyebrow, 'title', e.title, 'subtitle', e.subtitle,
    'excerpt', e.excerpt, 'body', e.body,
    'media', case when e.media_url is not null then jsonb_build_object('kind', coalesce(e.media_kind, 'image'),
             'url', e.media_url, 'posterUrl', e.media_poster_url, 'captionsUrl', e.media_captions_url, 'alt', coalesce(e.media_alt::jsonb, e.title::jsonb)) end,
    'cta', case when e.cta_href is not null then jsonb_build_object('label', coalesce(e.cta_label::jsonb, e.title::jsonb), 'href', e.cta_href) end,
    'secondaryCta', case when e.secondary_cta_href is not null then
      jsonb_build_object('label', coalesce(e.secondary_cta_label::jsonb, e.title::jsonb), 'href', e.secondary_cta_href) end,
    'state', e.state, 'releaseDate', to_char(e.release_date, 'YYYY-MM-DD'),
    'publishAt', e.publish_at, 'expiresAt', e.expires_at, 'isFeatured', e.is_featured,
    'products', coalesce((select jsonb_agg(app.product_summary(ep.product_id) order by ep.sort_order)
                          from public.content_entry_products ep join public.products p on p.id = ep.product_id
                          where ep.entry_id = e.id and app.product_is_visible(p)), '[]'::jsonb),
    'seo', jsonb_build_object('title', e.seo_title, 'description', e.seo_description),
    'isDemo', e.is_demo);
$$;

create or replace function public.storefront_entries(p_types text[] default '{}', p_featured_only boolean default false,
                                                     p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(entry order by publish_at desc), '[]'::jsonb)
  from (
    select app.entry_json(e) as entry, e.publish_at
    from public.content_entries e
    where app.entry_is_visible(e)
      and (coalesce(cardinality(p_types), 0) = 0 or e.type = any (p_types))
      and (not p_featured_only or e.is_featured)
    order by e.publish_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
  ) rows;
$$;

create or replace function public.storefront_entry(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.entry_json(e) from public.content_entries e where e.slug = p_slug and app.entry_is_visible(e);
$$;

create or replace function public.storefront_page_sections(p_page_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.key, 'pageKey', s.page_key, 'type', s.type,
                                               'sortOrder', s.sort_order, 'isVisible', s.is_visible, 'props', s.props)
                            order by s.sort_order, s.key), '[]'::jsonb)
  from public.page_sections s where s.page_key = p_page_key and s.is_visible;
$$;

-- ── Request intake (anonymous allowed; validated, de-duplicated) ─────────────
create or replace function app.normalize_egyptian_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(translate(coalesce(p_phone, ''),
                                     chr(1632) || chr(1633) || chr(1634) || chr(1635) || chr(1636)
                                     || chr(1637) || chr(1638) || chr(1639) || chr(1640) || chr(1641),
                                     '0123456789'), '[\s\-().]', '', 'g');
  national text;
begin
  if v like '+20%' then national := substr(v, 4);
  elsif v like '0020%' then national := substr(v, 5);
  elsif v ~ '^20[0-9]{10}$' then national := substr(v, 3);
  elsif v like '0%' then national := substr(v, 2);
  else return null;
  end if;
  if national ~ '^1[0125][0-9]{8}$' or national ~ '^[2-9][0-9]{7,8}$' then
    return '+20' || national;
  end if;
  return null;
end;
$$;

create or replace function app.validate_request_contact(p_name text, p_phone text, p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_phone text := app.normalize_egyptian_phone(p_phone);
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_phone is null then raise exception 'invalid_phone' using errcode = '22023'; end if;
  if p_email is not null and btrim(p_email) <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  return v_phone;
end;
$$;

create or replace function public.request_stock_alert(p_product_slug text, p_variant_sku text, p_name text, p_phone text,
                                                      p_email text default null, p_locale text default 'ar')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_variant uuid;
  v_phone text := app.validate_request_contact(p_name, p_phone, p_email);
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then raise exception 'product_not_found' using errcode = 'P0002'; end if;
  if p_variant_sku is not null then
    select id into v_variant from public.product_variants
    where product_id = p.id and sku = p_variant_sku and deleted_at is null;
    if v_variant is null then raise exception 'variant_not_found' using errcode = 'P0002'; end if;
  end if;

  insert into public.stock_notifications (product_id, variant_id, user_id, name, phone, email, locale)
  values (p.id, v_variant, app.current_actor_id(), btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''),
          case when app.is_locale(p_locale) then p_locale else 'ar' end)
  on conflict do nothing;
  return jsonb_build_object('status', case when found then 'created' else 'duplicate' end);
end;
$$;

create or replace function public.join_waitlist(p_product_slug text, p_name text, p_phone text, p_email text default null,
                                                p_desired_storage text default null, p_desired_color text default null,
                                                p_locale text default 'ar')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_phone text := app.validate_request_contact(p_name, p_phone, p_email);
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then raise exception 'product_not_found' using errcode = 'P0002'; end if;

  insert into public.waitlist_entries (product_id, user_id, name, phone, email, desired_storage, desired_color, locale)
  values (p.id, app.current_actor_id(), btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''),
          nullif(left(btrim(coalesce(p_desired_storage, '')), 40), ''), nullif(left(btrim(coalesce(p_desired_color, '')), 40), ''),
          case when app.is_locale(p_locale) then p_locale else 'ar' end)
  on conflict do nothing;
  return jsonb_build_object('status', case when found then 'created' else 'duplicate' end);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.demo_catalog_visible()', 'app.product_is_visible(public.products)', 'app.offer_is_active(public.offers)',
    'app.active_offer_badge(uuid)', 'app.media_json(public.product_media)', 'app.product_summary(uuid, jsonb)',
    'app.catalog_matches(public.products, jsonb, text[])', 'app.ordered_categories()', 'app.offer_json(public.offers)',
    'app.entry_is_visible(public.content_entries)', 'app.entry_json(public.content_entries)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.catalog_search(jsonb)', 'public.catalog_product(text)', 'public.catalog_brands()', 'public.catalog_categories()',
    'public.storefront_offers()', 'public.storefront_offer(text)', 'public.storefront_entries(text[], boolean, integer)',
    'public.storefront_entry(text)', 'public.storefront_page_sections(text)',
    'public.request_stock_alert(text, text, text, text, text, text)',
    'public.join_waitlist(text, text, text, text, text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
