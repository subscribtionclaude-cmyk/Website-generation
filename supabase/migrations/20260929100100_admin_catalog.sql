-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 06 · Catalog administration
--   Products (aggregate editor: details, categories, options, variants, media, specs, relations),
--   visibility / archive / duplicate / safe delete, pricing with automatic price history,
--   inventory with reservation-aware quantities and typed stock movements, categories (cycle-safe
--   hierarchy), brands. Every write is permission-checked here; row triggers from Phase 02 already
--   audit products / variants / brands / categories, and semantic events are added below.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.products add column if not exists is_visible boolean not null default true;
alter table public.products add column if not exists warranty_kind text
  check (warranty_kind is null or warranty_kind in ('authorized_distributor', 'store', 'local', 'none', 'custom'));
alter table public.product_variants add column if not exists warranty_kind text
  check (warranty_kind is null or warranty_kind in ('authorized_distributor', 'store', 'local', 'none', 'custom'));
alter table public.product_variants add column if not exists barcode text
  check (barcode is null or barcode ~ '^[A-Za-z0-9._-]{4,64}$');
alter table public.brands add column if not exists is_featured boolean not null default false;
alter table public.brands add column if not exists show_on_apple boolean not null default false;
alter table public.brands add column if not exists seo_title public.localized_text;
alter table public.brands add column if not exists seo_description public.localized_text;
alter table public.categories add column if not exists seo_title public.localized_text;
alter table public.categories add column if not exists seo_description public.localized_text;

create unique index if not exists product_variants_barcode_uidx on public.product_variants (barcode)
  where barcode is not null and deleted_at is null;

-- Hidden products stay editable in the admin but disappear from every storefront surface.
create or replace function app.product_is_visible(p_product public.products)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_product.status = 'published'
     and p_product.is_visible
     and p_product.deleted_at is null
     and (not p_product.is_demo or app.demo_catalog_visible())
     and exists (select 1 from public.brands b where b.id = p_product.brand_id and b.deleted_at is null and b.is_visible);
$$;

-- ── Price history (written by a trigger — the frontend cannot forget it) ────
create table if not exists public.price_history (
  id              bigint generated always as identity primary key,
  variant_id      uuid not null references public.product_variants (id) on delete cascade,
  product_id      uuid not null references public.products (id) on delete cascade,
  old_price       numeric(12, 2),
  new_price       numeric(12, 2),
  old_compare_at  numeric(12, 2),
  new_compare_at  numeric(12, 2),
  reason          text check (reason is null or char_length(reason) <= 300),
  source          text not null default 'system' check (source in ('admin', 'bulk', 'import', 'system')),
  actor_id        uuid,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists price_history_variant_idx on public.price_history (variant_id, created_at desc);
create index if not exists price_history_created_idx on public.price_history (created_at desc);
create index if not exists price_history_actor_idx on public.price_history (actor_id, created_at desc);

alter table public.price_history enable row level security;
revoke all on public.price_history from anon, authenticated;

create or replace function app.record_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.price is not distinct from old.price
     and new.compare_at_price is not distinct from old.compare_at_price then
    return new;
  end if;
  if tg_op = 'INSERT' and new.price is null and new.compare_at_price is null then return new; end if;
  insert into public.price_history (variant_id, product_id, old_price, new_price, old_compare_at, new_compare_at,
                                    reason, source, actor_id, is_demo)
  values (new.id, new.product_id,
          case when tg_op = 'UPDATE' then old.price end, new.price,
          case when tg_op = 'UPDATE' then old.compare_at_price end, new.compare_at_price,
          nullif(left(current_setting('app.change_reason', true), 300), ''),
          coalesce(nullif(current_setting('app.change_source', true), ''), 'system'),
          auth.uid(), new.is_demo);
  return new;
end;
$$;

drop trigger if exists product_variants_price_history on public.product_variants;
create trigger product_variants_price_history
  after insert or update of price, compare_at_price on public.product_variants
  for each row execute function app.record_price_change();

select app.register_demo_table('public.price_history', 5);

-- ── Stock movements: typed adjustments with before / after ──────────────────
alter table public.stock_movements add column if not exists quantity_before integer;
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'cancellation_restock', 'manual_adjustment', 'restock', 'addition', 'reduction',
                    'damage', 'return', 'correction', 'import', 'initial'));
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);

-- ── Shared helpers ──────────────────────────────────────────────────────────
create or replace function app.set_change_context(p_reason text, p_source text)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('app.change_reason', coalesce(p_reason, ''), true),
         set_config('app.change_source', coalesce(p_source, 'system'), true);
$$;

create or replace function app.valid_lt(p_value jsonb, p_required boolean default true)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then not p_required
    else jsonb_typeof(p_value) = 'object' and app.is_localized_text(p_value)
         and (not p_required or char_length(btrim(coalesce(p_value ->> 'ar', ''))) > 0)
  end;
$$;

create or replace function app.json_lt(p_value jsonb)
returns public.localized_text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or p_value = 'null'::jsonb
              or char_length(btrim(coalesce(p_value ->> 'ar', ''))) = 0 then null
         else jsonb_build_object('ar', btrim(p_value ->> 'ar'),
                                 'en', coalesce(nullif(btrim(p_value ->> 'en'), ''), btrim(p_value ->> 'ar')))::public.localized_text
         end;
$$;

create or replace function app.json_numeric(p_value jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or jsonb_typeof(p_value) = 'null' then null
              when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
              when jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]{1,2})?$'
                then (p_value #>> '{}')::numeric
              else 'NaN'::numeric end;
$$;

create or replace function app.variant_option_label(p_variant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(ov.label order by o.sort_order), '[]'::jsonb)
  from public.variant_option_values vov
  join public.product_options o on o.id = vov.option_id
  join public.product_option_values ov on ov.id = vov.option_value_id
  where vov.variant_id = p_variant;
$$;

-- Admin view of stock: never raw quantity alone.
create or replace function app.admin_stock_state(p_available integer, p_threshold integer, p_active boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when not p_active then 'inactive'
              when p_available <= 0 then 'out'
              when p_available <= p_threshold then 'low'
              else 'in_stock' end;
$$;

-- ── Lookups ─────────────────────────────────────────────────────────────────
create or replace function public.admin_catalog_lookups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['catalog.view', 'inventory.manage', 'pricing.manage',
                                                 'marketing.manage', 'content.view', 'data.import']);
begin
  return jsonb_build_object(
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name,
                                                            'isVisible', b.is_visible) order by b.sort_order, b.slug)
                        from public.brands b where b.deleted_at is null), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name,
                                                                'parentId', c.parent_id, 'isVisible', c.is_visible)
                                             order by c.sort_order, c.slug)
                            from public.categories c where c.deleted_at is null), '[]'::jsonb));
end;
$$;

-- ── Products: list ──────────────────────────────────────────────────────────
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
             'stock', jsonb_build_object('total', m.stock_total, 'available', m.available_total,
                                         'out', m.out_count, 'low', m.low_count),
             'hasOffer', m.has_offer) order by m.ord)
           from (select page.*, row_number() over () as ord from page) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Products: full editor document ──────────────────────────────────────────
create or replace function app.admin_product_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'brandId', p.brand_id, 'model', p.model, 'name', p.name,
    'subtitle', p.subtitle, 'description', p.description, 'warranty', p.warranty, 'warrantyKind', p.warranty_kind,
    'availabilityState', p.availability_state, 'status', p.status, 'isVisible', p.is_visible,
    'isNew', p.is_new, 'isFeatured', p.is_featured, 'releaseDate', p.release_date, 'keywords', p.keywords,
    'seoTitle', p.seo_title, 'seoDescription', p.seo_description, 'isDemo', p.is_demo,
    'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'hasHistory', exists (select 1 from public.order_items oi where oi.product_id = p.id),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', pc.category_id, 'isPrimary', pc.is_primary)
                                             order by pc.is_primary desc, pc.sort_order)
                            from public.product_categories pc where pc.product_id = p.id), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object(
        'key', o.key, 'name', o.name, 'values', coalesce((
          select jsonb_agg(jsonb_build_object('key', ov.key, 'label', ov.label, 'swatchHex', ov.swatch_hex)
                           order by ov.sort_order, ov.key)
          from public.product_option_values ov where ov.option_id = o.id), '[]'::jsonb))
        order by o.sort_order, o.key)
      from public.product_options o where o.product_id = p.id), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'compareAtPrice', v.compare_at_price,
        'stock', v.stock_quantity, 'reserved', app.variant_reserved_quantity(v.id, null),
        'available', app.variant_available_quantity(v.id), 'lowStockThreshold', v.low_stock_threshold,
        'isActive', v.is_active, 'isDefault', v.is_default, 'warranty', v.warranty, 'warrantyKind', v.warranty_kind,
        'updatedAt', v.updated_at,
        'options', coalesce((select jsonb_object_agg(o.key, ov.key) from public.variant_option_values vov
                             join public.product_options o on o.id = vov.option_id
                             join public.product_option_values ov on ov.id = vov.option_value_id
                             where vov.variant_id = v.id), '{}'::jsonb),
        'lastPriceChange', (select jsonb_build_object('at', ph.created_at, 'reason', ph.reason, 'source', ph.source,
                                                      'oldPrice', ph.old_price,
                                                      'by', (select coalesce(pr.full_name, pr.email) from public.profiles pr
                                                             where pr.id = ph.actor_id))
                            from public.price_history ph where ph.variant_id = v.id
                            order by ph.created_at desc, ph.id desc limit 1))
        order by v.sort_order, v.sku)
      from public.product_variants v where v.product_id = p.id and v.deleted_at is null), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'url', m.url, 'posterUrl', m.poster_url, 'captionsUrl', m.captions_url,
        'alt', m.alt, 'width', m.width, 'height', m.height, 'isCover', m.is_cover,
        'variantSku', (select v.sku from public.product_variants v where v.id = m.variant_id),
        'colorKey', (select ov.key from public.product_option_values ov where ov.id = m.option_value_id))
        order by m.sort_order, m.created_at)
      from public.product_media m where m.product_id = p.id), '[]'::jsonb),
    'specGroups', coalesce((select jsonb_agg(jsonb_build_object(
        'key', g.key, 'title', g.title, 'items', coalesce((
          select jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label, 'value', s.value,
                                              'visible', s.status = 'approved') order by s.sort_order, s.key)
          from public.product_specs s where s.group_id = g.id), '[]'::jsonb))
        order by g.sort_order, g.key)
      from public.product_spec_groups g where g.product_id = p.id), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'productId', r.related_product_id, 'slug', rp.slug, 'name', rp.name)
        order by r.kind, r.sort_order)
      from public.product_relations r join public.products rp on rp.id = r.related_product_id
      where r.product_id = p.id and r.kind in ('accessory', 'similar', 'recommended', 'compatible')
        and rp.deleted_at is null), '[]'::jsonb))
  from public.products p where p.id = p_id and p.deleted_at is null;
$$;

create or replace function public.admin_get_product(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['catalog.view', 'pricing.manage', 'inventory.manage']);
begin
  return app.admin_product_json(p_id);
end;
$$;

-- ── Products: save the whole aggregate ──────────────────────────────────────
-- Validation is authoritative here (the UI shares the same rules via zod). Stock of existing
-- variants is NEVER changed by this function (use admin_adjust_stock so every change has a
-- movement); new variants may start with an initial quantity (inventory.manage).
create or replace function public.admin_save_product(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := app.require_permission('catalog.manage');
  v_id         uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_product    public.products;
  v_is_new     boolean := v_id is null;
  v_slug       text := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_brand      uuid := nullif(p_payload ->> 'brandId', '')::uuid;
  v_cats       jsonb := coalesce(p_payload -> 'categoryIds', '[]'::jsonb);
  v_primary    uuid := nullif(p_payload ->> 'primaryCategoryId', '')::uuid;
  v_options    jsonb := coalesce(p_payload -> 'options', '[]'::jsonb);
  v_variants   jsonb := coalesce(p_payload -> 'variants', '[]'::jsonb);
  v_media      jsonb := coalesce(p_payload -> 'media', '[]'::jsonb);
  v_specs      jsonb := coalesce(p_payload -> 'specGroups', '[]'::jsonb);
  v_relations  jsonb := coalesce(p_payload -> 'relations', '[]'::jsonb);
  v_status     text := coalesce(nullif(p_payload ->> 'status', ''), 'draft');
  v_is_demo    boolean;
  v_opt        jsonb;
  v_val        jsonb;
  v_var        jsonb;
  v_existing   public.product_variants;
  v_variant_id uuid;
  v_option_id  uuid;
  v_idx        integer;
  v_price      numeric;
  v_compare    numeric;
  v_stock      integer;
  v_price_changes integer := 0;
  v_keep_ids   uuid[] := '{}';
  v_sku        text;
  v_group_id   uuid;
  v_item       jsonb;
  v_default_seen boolean := false;
begin
  -- Shape / field validation --------------------------------------------------
  if v_slug !~ '^[a-z0-9-]{1,80}$' then return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'field', 'slug'); end if;
  if not app.valid_lt(p_payload -> 'name') then return jsonb_build_object('ok', false, 'code', 'name_required', 'field', 'name'); end if;
  if not app.valid_lt(p_payload -> 'subtitle', false) or not app.valid_lt(p_payload -> 'description', false)
     or not app.valid_lt(p_payload -> 'warranty', false) or not app.valid_lt(p_payload -> 'seoTitle', false)
     or not app.valid_lt(p_payload -> 'seoDescription', false) then
    return jsonb_build_object('ok', false, 'code', 'invalid_text');
  end if;
  if v_brand is null or not exists (select 1 from public.brands where id = v_brand and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'brand_required', 'field', 'brandId');
  end if;
  if jsonb_typeof(v_cats) <> 'array' or jsonb_array_length(v_cats) = 0 then
    return jsonb_build_object('ok', false, 'code', 'category_required', 'field', 'categoryIds');
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_cats) c (id)
             where not exists (select 1 from public.categories where id = c.id::uuid and deleted_at is null)) then
    return jsonb_build_object('ok', false, 'code', 'category_required', 'field', 'categoryIds');
  end if;
  if v_status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if coalesce(p_payload ->> 'availabilityState', 'available') not in ('available', 'coming_soon', 'waitlist_only', 'pre_order') then
    return jsonb_build_object('ok', false, 'code', 'invalid_availability');
  end if;
  if nullif(p_payload ->> 'warrantyKind', '') is not null
     and p_payload ->> 'warrantyKind' not in ('authorized_distributor', 'store', 'local', 'none', 'custom') then
    return jsonb_build_object('ok', false, 'code', 'invalid_warranty');
  end if;
  if exists (select 1 from public.products where slug = v_slug and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'field', 'slug');
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    return jsonb_build_object('ok', false, 'code', 'variant_required', 'field', 'variants');
  end if;
  -- Options: unique keys, valid keys, at least one value each, unique value keys.
  if exists (select 1 from jsonb_array_elements(v_options) o
             where coalesce(o ->> 'key', '') !~ '^[a-z][a-z0-9_-]{0,30}$' or not app.valid_lt(o -> 'name')
                or jsonb_array_length(coalesce(o -> 'values', '[]')) = 0
                or exists (select 1 from jsonb_array_elements(o -> 'values') v
                           where coalesce(v ->> 'key', '') !~ '^[a-z0-9-]{1,40}$' or not app.valid_lt(v -> 'label')
                              or (nullif(v ->> 'swatchHex', '') is not null and v ->> 'swatchHex' !~ '^#[0-9a-fA-F]{6}$'))
                or (select count(distinct v ->> 'key') from jsonb_array_elements(o -> 'values') v)
                   <> jsonb_array_length(o -> 'values'))
     or (select count(distinct o ->> 'key') from jsonb_array_elements(v_options) o) <> jsonb_array_length(v_options) then
    return jsonb_build_object('ok', false, 'code', 'invalid_options', 'field', 'options');
  end if;
  -- Variants: SKU format + unique, combination complete + unique, prices.
  if exists (select 1 from jsonb_array_elements(v_variants) v
             where upper(btrim(coalesce(v ->> 'sku', ''))) !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_sku', 'field', 'variants');
  end if;
  if (select count(distinct upper(btrim(v ->> 'sku'))) from jsonb_array_elements(v_variants) v) <> jsonb_array_length(v_variants) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_sku', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) v
             join public.product_variants other on other.sku = upper(btrim(v ->> 'sku'))
             where other.id is distinct from nullif(v ->> 'id', '')::uuid) then
    return jsonb_build_object('ok', false, 'code', 'sku_taken', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) v
             where nullif(v ->> 'barcode', '') is not null and v ->> 'barcode' !~ '^[A-Za-z0-9._-]{4,64}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_barcode', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) v
             where (select count(*) from jsonb_object_keys(coalesce(v -> 'options', '{}'))) <> jsonb_array_length(v_options)
                or exists (select 1 from jsonb_array_elements(v_options) o
                           where not exists (select 1 from jsonb_array_elements(o -> 'values') ov
                                             where ov ->> 'key' = v -> 'options' ->> (o ->> 'key'))))
     or (select count(distinct (select string_agg(k || '=' || (v -> 'options' ->> k), ',' order by k)
                                from jsonb_object_keys(coalesce(v -> 'options', '{}')) k))
         from jsonb_array_elements(v_variants) v) <> jsonb_array_length(v_variants) then
    return jsonb_build_object('ok', false, 'code', 'invalid_combination', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) v
             where app.json_numeric(v -> 'price') = 'NaN'::numeric or app.json_numeric(v -> 'price') < 0
                or app.json_numeric(v -> 'compareAtPrice') = 'NaN'::numeric
                or app.json_numeric(v -> 'compareAtPrice') < 0
                or (app.json_numeric(v -> 'compareAtPrice') is not null and app.json_numeric(v -> 'price') is not null
                    and app.json_numeric(v -> 'compareAtPrice') <= app.json_numeric(v -> 'price'))
                or coalesce(nullif(v ->> 'lowStockThreshold', '')::integer, 2) < 0
                or coalesce(nullif(v ->> 'initialStock', '')::integer, 0) < 0) then
    return jsonb_build_object('ok', false, 'code', 'invalid_price', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_media) m
             where coalesce(m ->> 'url', '') !~ '^(/|https://)' or coalesce(m ->> 'kind', 'image') not in ('image', 'video')
                or (nullif(m ->> 'posterUrl', '') is not null and m ->> 'posterUrl' !~ '^(/|https://)')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_media', 'field', 'media');
  end if;
  if exists (select 1 from jsonb_array_elements(v_specs) g
             where coalesce(g ->> 'key', '') !~ '^[a-z][a-z0-9_-]{0,40}$' or not app.valid_lt(g -> 'title')
                or exists (select 1 from jsonb_array_elements(coalesce(g -> 'items', '[]')) s
                           where coalesce(s ->> 'key', '') !~ '^[a-z][a-z0-9_-]{0,40}$'
                              or not app.valid_lt(s -> 'label') or not app.valid_lt(s -> 'value'))
                or (select count(distinct s ->> 'key') from jsonb_array_elements(coalesce(g -> 'items', '[]')) s)
                   <> jsonb_array_length(coalesce(g -> 'items', '[]')))
     or (select count(distinct g ->> 'key') from jsonb_array_elements(v_specs) g) <> jsonb_array_length(v_specs) then
    return jsonb_build_object('ok', false, 'code', 'invalid_specs', 'field', 'specGroups');
  end if;
  if exists (select 1 from jsonb_array_elements(v_relations) r
             where coalesce(r ->> 'kind', '') not in ('accessory', 'similar', 'recommended', 'compatible')
                or nullif(r ->> 'productId', '') is null
                or (r ->> 'productId')::uuid = v_id
                or not exists (select 1 from public.products x where x.id = (r ->> 'productId')::uuid and x.deleted_at is null)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_relation', 'field', 'relations');
  end if;

  -- Existing product: stale-edit protection ----------------------------------
  if not v_is_new then
    select * into v_product from public.products where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_product.updated_at is distinct from nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_product.updated_at);
    end if;
    -- Variants edited elsewhere (pricing / stock screens) since this editor loaded.
    if exists (select 1 from jsonb_array_elements(v_variants) v
               join public.product_variants pv on pv.id = nullif(v ->> 'id', '')::uuid
               where pv.updated_at is distinct from nullif(v ->> 'updatedAt', '')::timestamptz) then
      return jsonb_build_object('ok', false, 'code', 'stale_variant');
    end if;
    if exists (select 1 from jsonb_array_elements(v_variants) v
               where nullif(v ->> 'id', '') is not null
                 and not exists (select 1 from public.product_variants pv
                                 where pv.id = (v ->> 'id')::uuid and pv.product_id = v_id and pv.deleted_at is null)) then
      return jsonb_build_object('ok', false, 'code', 'stale_variant');
    end if;
    v_is_demo := v_product.is_demo;
  else
    v_is_demo := coalesce((p_payload ->> 'isDemo')::boolean, false);
  end if;

  -- Price edits need pricing.manage, initial stock needs inventory.manage.
  select count(*) into v_price_changes
  from jsonb_array_elements(v_variants) v
  left join public.product_variants pv on pv.id = nullif(v ->> 'id', '')::uuid
  where pv.id is null and (app.json_numeric(v -> 'price') is not null or app.json_numeric(v -> 'compareAtPrice') is not null)
     or pv.id is not null and (pv.price is distinct from app.json_numeric(v -> 'price')
                               or pv.compare_at_price is distinct from app.json_numeric(v -> 'compareAtPrice'));
  if v_price_changes > 0 and not app.has_permission('pricing.manage') then
    return jsonb_build_object('ok', false, 'code', 'pricing_forbidden', 'field', 'variants');
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) v
             where nullif(v ->> 'id', '') is null and coalesce(nullif(v ->> 'initialStock', '')::integer, 0) > 0)
     and not app.has_permission('inventory.manage') then
    return jsonb_build_object('ok', false, 'code', 'inventory_forbidden', 'field', 'variants');
  end if;

  perform app.set_change_context(p_payload ->> 'priceReason', 'admin');

  -- Product row ------------------------------------------------------------------
  if v_is_new then
    insert into public.products (slug, brand_id, model, name, subtitle, description, warranty, warranty_kind,
                                 availability_state, status, is_visible, is_new, is_featured, release_date,
                                 keywords, seo_title, seo_description, published_at, is_demo)
    values (v_slug, v_brand, nullif(btrim(coalesce(p_payload ->> 'model', '')), ''),
            app.json_lt(p_payload -> 'name'), app.json_lt(p_payload -> 'subtitle'),
            app.json_lt(p_payload -> 'description'), app.json_lt(p_payload -> 'warranty'),
            nullif(p_payload ->> 'warrantyKind', ''),
            coalesce(nullif(p_payload ->> 'availabilityState', ''), 'available'), v_status,
            coalesce((p_payload ->> 'isVisible')::boolean, true), coalesce((p_payload ->> 'isNew')::boolean, false),
            coalesce((p_payload ->> 'isFeatured')::boolean, false), nullif(p_payload ->> 'releaseDate', '')::date,
            left(coalesce(p_payload ->> 'keywords', ''), 1000), app.json_lt(p_payload -> 'seoTitle'),
            app.json_lt(p_payload -> 'seoDescription'),
            case when v_status = 'published' then now() end, v_is_demo)
    returning * into v_product;
    v_id := v_product.id;
  else
    update public.products set
      slug = v_slug, brand_id = v_brand, model = nullif(btrim(coalesce(p_payload ->> 'model', '')), ''),
      name = app.json_lt(p_payload -> 'name'), subtitle = app.json_lt(p_payload -> 'subtitle'),
      description = app.json_lt(p_payload -> 'description'), warranty = app.json_lt(p_payload -> 'warranty'),
      warranty_kind = nullif(p_payload ->> 'warrantyKind', ''),
      availability_state = coalesce(nullif(p_payload ->> 'availabilityState', ''), 'available'),
      status = v_status, is_visible = coalesce((p_payload ->> 'isVisible')::boolean, true),
      is_new = coalesce((p_payload ->> 'isNew')::boolean, false),
      is_featured = coalesce((p_payload ->> 'isFeatured')::boolean, false),
      release_date = nullif(p_payload ->> 'releaseDate', '')::date,
      keywords = left(coalesce(p_payload ->> 'keywords', ''), 1000),
      seo_title = app.json_lt(p_payload -> 'seoTitle'), seo_description = app.json_lt(p_payload -> 'seoDescription'),
      published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end,
      updated_at = clock_timestamp()
    where id = v_id
    returning * into v_product;
  end if;

  -- Categories ---------------------------------------------------------------------
  delete from public.product_categories where product_id = v_id;
  insert into public.product_categories (product_id, category_id, is_primary, sort_order)
  select v_id, c.id::uuid, c.id::uuid = coalesce(v_primary, (v_cats ->> 0)::uuid), c.ord::integer
  from jsonb_array_elements_text(v_cats) with ordinality as c (id, ord);

  -- Options & values (upsert by key; removed ones are deleted) -----------------------
  delete from public.variant_option_values vov using public.product_variants pv
  where vov.variant_id = pv.id and pv.product_id = v_id;
  delete from public.product_options o
  where o.product_id = v_id and o.key not in (select x ->> 'key' from jsonb_array_elements(v_options) x);
  v_idx := 0;
  for v_opt in select * from jsonb_array_elements(v_options) loop
    v_idx := v_idx + 1;
    insert into public.product_options (product_id, key, name, sort_order)
    values (v_id, v_opt ->> 'key', app.json_lt(v_opt -> 'name'), v_idx)
    on conflict (product_id, key) do update set name = excluded.name, sort_order = excluded.sort_order
    returning id into v_option_id;
    delete from public.product_option_values ov
    where ov.option_id = v_option_id and ov.key not in (select x ->> 'key' from jsonb_array_elements(v_opt -> 'values') x);
    insert into public.product_option_values (option_id, key, label, swatch_hex, sort_order)
    select v_option_id, x ->> 'key', app.json_lt(x -> 'label'), nullif(x ->> 'swatchHex', ''), x_ord::integer
    from jsonb_array_elements(v_opt -> 'values') with ordinality as t (x, x_ord)
    on conflict (option_id, key) do update
      set label = excluded.label, swatch_hex = excluded.swatch_hex, sort_order = excluded.sort_order;
  end loop;

  -- Variants -----------------------------------------------------------------------
  v_idx := 0;
  for v_var in select * from jsonb_array_elements(v_variants) loop
    v_idx := v_idx + 1;
    v_sku := upper(btrim(v_var ->> 'sku'));
    v_price := app.json_numeric(v_var -> 'price');
    v_compare := app.json_numeric(v_var -> 'compareAtPrice');
    if coalesce((v_var ->> 'isDefault')::boolean, false) and not v_default_seen then
      v_default_seen := true;
    end if;
    if nullif(v_var ->> 'id', '') is null then
      v_stock := coalesce(nullif(v_var ->> 'initialStock', '')::integer, 0);
      insert into public.product_variants (product_id, sku, barcode, price, compare_at_price, stock_quantity,
                                           low_stock_threshold, is_active, is_default, warranty, warranty_kind,
                                           sort_order, is_demo)
      values (v_id, v_sku, nullif(btrim(coalesce(v_var ->> 'barcode', '')), ''), v_price, v_compare, v_stock,
              coalesce(nullif(v_var ->> 'lowStockThreshold', '')::integer, 2),
              coalesce((v_var ->> 'isActive')::boolean, true), false,
              app.json_lt(v_var -> 'warranty'), nullif(v_var ->> 'warrantyKind', ''), v_idx, v_is_demo)
      returning id into v_variant_id;
      if v_stock > 0 then
        insert into public.stock_movements (variant_id, delta, quantity_before, quantity_after, reason, actor_id, note, is_demo)
        values (v_variant_id, v_stock, 0, v_stock, 'initial', v_uid, 'Initial stock', v_is_demo);
      end if;
    else
      v_variant_id := (v_var ->> 'id')::uuid;
      update public.product_variants set
        sku = v_sku, barcode = nullif(btrim(coalesce(v_var ->> 'barcode', '')), ''),
        price = v_price, compare_at_price = v_compare,
        low_stock_threshold = coalesce(nullif(v_var ->> 'lowStockThreshold', '')::integer, low_stock_threshold),
        is_active = coalesce((v_var ->> 'isActive')::boolean, true), is_default = false,
        warranty = app.json_lt(v_var -> 'warranty'), warranty_kind = nullif(v_var ->> 'warrantyKind', ''),
        sort_order = v_idx
      where id = v_variant_id;
    end if;
    v_keep_ids := v_keep_ids || v_variant_id;
    insert into public.variant_option_values (variant_id, option_id, option_value_id)
    select v_variant_id, o.id, ov.id
    from jsonb_each_text(coalesce(v_var -> 'options', '{}')) as sel (option_key, value_key)
    join public.product_options o on o.product_id = v_id and o.key = sel.option_key
    join public.product_option_values ov on ov.option_id = o.id and ov.key = sel.value_key;
  end loop;
  -- Removed variants are retired (kept for order history), never hard-deleted.
  update public.product_variants set deleted_at = now(), is_active = false, is_default = false
  where product_id = v_id and deleted_at is null and id <> all (v_keep_ids);
  -- Exactly one default variant.
  update public.product_variants set is_default = true
  where id = coalesce(
    (select pv.id from jsonb_array_elements(v_variants) with ordinality as t (v, ord)
     join public.product_variants pv on pv.product_id = v_id and pv.sku = upper(btrim(t.v ->> 'sku'))
     where coalesce((t.v ->> 'isDefault')::boolean, false) order by t.ord limit 1),
    v_keep_ids[1]);

  -- Media (replace) ---------------------------------------------------------------------
  delete from public.product_media where product_id = v_id;
  insert into public.product_media (product_id, variant_id, option_value_id, kind, url, poster_url, captions_url, alt,
                                    width, height, sort_order, is_cover, is_demo)
  select v_id,
         (select pv.id from public.product_variants pv where pv.product_id = v_id and pv.deleted_at is null
            and pv.sku = upper(nullif(m ->> 'variantSku', ''))),
         (select ov.id from public.product_option_values ov join public.product_options o on o.id = ov.option_id
            where o.product_id = v_id and o.key = 'color' and ov.key = nullif(m ->> 'colorKey', '')),
         coalesce(m ->> 'kind', 'image'), m ->> 'url', nullif(m ->> 'posterUrl', ''), nullif(m ->> 'captionsUrl', ''),
         coalesce(app.json_lt(m -> 'alt'), app.json_lt(p_payload -> 'name')),
         nullif(m ->> 'width', '')::integer, nullif(m ->> 'height', '')::integer, ord::integer,
         coalesce((m ->> 'isCover')::boolean, false), v_is_demo
  from jsonb_array_elements(v_media) with ordinality as t (m, ord);
  if not exists (select 1 from public.product_media where product_id = v_id and is_cover) then
    update public.product_media set is_cover = true
    where id = (select id from public.product_media where product_id = v_id and kind = 'image' order by sort_order limit 1);
  end if;

  -- Specifications (replace) -------------------------------------------------------------
  delete from public.product_spec_groups where product_id = v_id;
  v_idx := 0;
  for v_opt in select * from jsonb_array_elements(v_specs) loop
    v_idx := v_idx + 1;
    insert into public.product_spec_groups (product_id, key, title, sort_order)
    values (v_id, v_opt ->> 'key', app.json_lt(v_opt -> 'title'), v_idx)
    returning id into v_group_id;
    insert into public.product_specs (group_id, key, label, value, sort_order, status, source)
    select v_group_id, s ->> 'key', app.json_lt(s -> 'label'), app.json_lt(s -> 'value'), s_ord::integer,
           case when coalesce((s ->> 'visible')::boolean, true) then 'approved' else 'suggested' end, 'manual'
    from jsonb_array_elements(coalesce(v_opt -> 'items', '[]')) with ordinality as t (s, s_ord);
  end loop;

  -- Manual relations (bought-together stays derived / managed elsewhere) --------------
  delete from public.product_relations
  where product_id = v_id and kind in ('accessory', 'similar', 'recommended', 'compatible');
  insert into public.product_relations (product_id, related_product_id, kind, sort_order, status, source)
  select distinct on ((r ->> 'productId')::uuid, r ->> 'kind')
         v_id, (r ->> 'productId')::uuid, r ->> 'kind', ord::integer, 'approved', 'manual'
  from jsonb_array_elements(v_relations) with ordinality as t (r, ord);

  perform app.log_event(case when v_is_new then 'catalog.product_created' else 'catalog.product_saved' end,
                        'public.products', v_id::text, null, null,
                        jsonb_build_object('slug', v_slug, 'variants', jsonb_array_length(v_variants),
                                           'price_changes', v_price_changes));
  return jsonb_build_object('ok', true, 'id', v_id,
                            'updatedAt', (select updated_at from public.products where id = v_id));
end;
$$;

-- Bulk visibility / status (publish, draft, archive, restore, hide, show).
create or replace function public.admin_set_products_state(p_ids uuid[], p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
  v_count integer;
begin
  if p_action not in ('publish', 'draft', 'archive', 'restore', 'hide', 'show') then
    return jsonb_build_object('ok', false, 'code', 'invalid_action');
  end if;
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  update public.products set
    status = case p_action when 'publish' then 'published' when 'draft' then 'draft' when 'archive' then 'archived'
                           when 'restore' then 'draft' else status end,
    is_visible = case p_action when 'hide' then false when 'show' then true else is_visible end,
    published_at = case when p_action = 'publish' then coalesce(published_at, now()) else published_at end
  where id = any (p_ids) and deleted_at is null;
  get diagnostics v_count = row_count;
  perform app.log_event('catalog.products_' || p_action, 'public.products', null, null, null,
                        jsonb_build_object('ids', to_jsonb(p_ids), 'count', v_count));
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.admin_duplicate_product(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
  v_src jsonb := app.admin_product_json(p_id);
  v_slug text;
  v_suffix integer := 1;
  v_payload jsonb;
  v_result jsonb;
begin
  if v_src is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  v_slug := left(v_src ->> 'slug', 70) || '-copy';
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := left(v_src ->> 'slug', 70) || '-copy-' || v_suffix;
  end loop;
  v_payload := v_src - 'id' - 'updatedAt' || jsonb_build_object(
    'slug', v_slug, 'status', 'draft',
    'primaryCategoryId', (select c ->> 'id' from jsonb_array_elements(v_src -> 'categories') c
                          where (c ->> 'isPrimary')::boolean limit 1),
    'categoryIds', (select jsonb_agg(c ->> 'id') from jsonb_array_elements(v_src -> 'categories') c),
    'variants', (select jsonb_agg((v - 'id' - 'updatedAt' - 'stock' - 'reserved' - 'available' - 'lastPriceChange' - 'barcode')
                                   || jsonb_build_object('sku', left(v ->> 'sku', 55) || '-COPY' || v_suffix,
                                                         'initialStock', 0))
                 from jsonb_array_elements(v_src -> 'variants') v),
    'media', (select coalesce(jsonb_agg(m - 'id' - 'variantSku'), '[]'::jsonb) from jsonb_array_elements(v_src -> 'media') m),
    'relations', (select coalesce(jsonb_agg(jsonb_build_object('kind', r ->> 'kind', 'productId', r ->> 'productId')), '[]'::jsonb)
                  from jsonb_array_elements(v_src -> 'relations') r),
    'priceReason', 'Duplicated from ' || (v_src ->> 'slug'));
  v_result := public.admin_save_product(v_payload);
  if (v_result ->> 'ok')::boolean then
    perform app.log_event('catalog.product_duplicated', 'public.products', v_result ->> 'id', null, null,
                          jsonb_build_object('source', p_id));
  end if;
  return v_result;
end;
$$;

-- Hard delete only when nothing refers to the product; otherwise archive it.
create or replace function public.admin_delete_product(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
  v_slug text;
begin
  select slug into v_slug from public.products where id = p_id and deleted_at is null;
  if v_slug is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if exists (select 1 from public.order_items where product_id = p_id)
     or exists (select 1 from public.product_variants v join public.stock_reservations r on r.variant_id = v.id
                where v.product_id = p_id)
     or exists (select 1 from public.service_requests where target_variant_id in
                (select id from public.product_variants where product_id = p_id))
     or exists (select 1 from public.product_reviews where product_id = p_id) then
    return jsonb_build_object('ok', false, 'code', 'has_history');
  end if;
  delete from public.products where id = p_id;
  perform app.log_event('catalog.product_deleted', 'public.products', p_id::text, null, null,
                        jsonb_build_object('slug', v_slug));
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Pricing ─────────────────────────────────────────────────────────────────
create or replace function public.admin_set_variant_price(p_variant_id uuid, p_price numeric, p_compare_at numeric,
                                                          p_reason text, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('pricing.manage');
  v_variant public.product_variants;
begin
  perform app.assert_sensitive_action_allowed();
  select * into v_variant from public.product_variants where id = p_variant_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_variant.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_variant.updated_at);
  end if;
  if p_price is not null and p_price < 0 or p_compare_at is not null and p_compare_at < 0
     or (p_price is not null and p_compare_at is not null and p_compare_at <= p_price) then
    return jsonb_build_object('ok', false, 'code', 'invalid_price');
  end if;
  if v_variant.price is not distinct from p_price and v_variant.compare_at_price is not distinct from p_compare_at then
    return jsonb_build_object('ok', false, 'code', 'no_change');
  end if;
  perform app.set_change_context(p_reason, 'admin');
  update public.product_variants set price = p_price, compare_at_price = p_compare_at where id = p_variant_id
  returning * into v_variant;
  perform app.log_event('price.changed', 'public.product_variants', v_variant.sku, null, null,
                        jsonb_build_object('price', p_price, 'compare_at', p_compare_at, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'updatedAt', v_variant.updated_at);
end;
$$;

-- Wide-impact variant updates. The UI confirms first; this checks each field's permission and
-- records one semantic audit event plus the row-level audit / price history per variant.
create or replace function public.admin_bulk_update_variants(p_ids uuid[], p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['catalog.manage', 'pricing.manage', 'inventory.manage']);
  v_mode text := nullif(p_patch ->> 'priceMode', '');
  v_value numeric := app.json_numeric(p_patch -> 'priceValue');
  v_compare text := coalesce(nullif(p_patch ->> 'compareAt', ''), 'keep');
  v_count integer;
  v_bad integer;
begin
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  if v_mode is not null or v_compare <> 'keep' then
    if not app.has_permission('pricing.manage') then return jsonb_build_object('ok', false, 'code', 'pricing_forbidden'); end if;
    perform app.assert_sensitive_action_allowed();
    if v_mode is not null and (v_mode not in ('set', 'percent', 'amount') or v_value is null or v_value = 'NaN'::numeric
                               or (v_mode = 'set' and v_value < 0) or (v_mode = 'percent' and (v_value < -90 or v_value > 500))) then
      return jsonb_build_object('ok', false, 'code', 'invalid_price');
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'reason_required');
    end if;
  end if;
  if (p_patch ? 'isActive' or p_patch ? 'warrantyKind' or p_patch ? 'warranty') and not app.has_permission('catalog.manage') then
    return jsonb_build_object('ok', false, 'code', 'catalog_forbidden');
  end if;
  if p_patch ? 'lowStockThreshold' and not app.has_any_permission(array['inventory.manage', 'catalog.manage']) then
    return jsonb_build_object('ok', false, 'code', 'inventory_forbidden');
  end if;
  if p_patch ? 'lowStockThreshold' and coalesce(nullif(p_patch ->> 'lowStockThreshold', '')::integer, -1) < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_threshold');
  end if;
  if p_patch ? 'warrantyKind' and nullif(p_patch ->> 'warrantyKind', '') is not null
     and p_patch ->> 'warrantyKind' not in ('authorized_distributor', 'store', 'local', 'none', 'custom') then
    return jsonb_build_object('ok', false, 'code', 'invalid_warranty');
  end if;

  -- Resulting prices must stay valid for every selected variant.
  select count(*) into v_bad from public.product_variants v
  where v.id = any (p_ids) and v.deleted_at is null and v_mode is not null and v.price is null and v_mode <> 'set';
  if v_bad > 0 then return jsonb_build_object('ok', false, 'code', 'price_missing'); end if;

  perform app.set_change_context(p_reason, 'bulk');
  with target as (
    select v.id,
      case v_mode
        when 'set' then round(v_value, 2)
        when 'percent' then round(v.price * (1 + v_value / 100), 0)
        when 'amount' then round(v.price + v_value, 2)
        else v.price end as new_price
    from public.product_variants v where v.id = any (p_ids) and v.deleted_at is null
  )
  select count(*) into v_bad from target where new_price < 0;
  if v_bad > 0 then return jsonb_build_object('ok', false, 'code', 'invalid_price'); end if;

  update public.product_variants v set
    price = case v_mode
              when 'set' then round(v_value, 2)
              when 'percent' then round(v.price * (1 + v_value / 100), 0)
              when 'amount' then round(v.price + v_value, 2)
              else v.price end,
    compare_at_price = case
              when v_compare = 'clear' then null
              when v_compare = 'previous' and v_mode is not null then v.price
              else v.compare_at_price end,
    is_active = case when p_patch ? 'isActive' then (p_patch ->> 'isActive')::boolean else v.is_active end,
    low_stock_threshold = case when p_patch ? 'lowStockThreshold'
                               then (p_patch ->> 'lowStockThreshold')::integer else v.low_stock_threshold end,
    warranty_kind = case when p_patch ? 'warrantyKind' then nullif(p_patch ->> 'warrantyKind', '') else v.warranty_kind end,
    warranty = case when p_patch ? 'warranty' then app.json_lt(p_patch -> 'warranty') else v.warranty end
  where v.id = any (p_ids) and v.deleted_at is null;
  get diagnostics v_count = row_count;
  -- A compare-at price must stay above the new price.
  update public.product_variants set compare_at_price = null
  where id = any (p_ids) and compare_at_price is not null and price is not null and compare_at_price <= price;
  perform app.log_event('catalog.variants_bulk_updated', 'public.product_variants', null, null, p_patch,
                        jsonb_build_object('ids', to_jsonb(p_ids), 'count', v_count, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.admin_list_price_history(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_any_permission(array['pricing.manage', 'catalog.view']);
  v_limit   integer := app.page_limit(p_filter, 50, 200);
  v_offset  integer := app.page_offset(p_filter);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_variant uuid := nullif(p_filter ->> 'variantId', '')::uuid;
  v_product uuid := nullif(p_filter ->> 'productId', '')::uuid;
  v_actor   text := nullif(btrim(coalesce(p_filter ->> 'actor', '')), '');
  v_source  text := nullif(p_filter ->> 'source', '');
  v_from    timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to      timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select h.*, v.sku, p.name as product_name, p.slug as product_slug, pr.email as actor_email, pr.full_name as actor_name
    from public.price_history h
    join public.product_variants v on v.id = h.variant_id
    join public.products p on p.id = h.product_id
    left join public.profiles pr on pr.id = h.actor_id
    where (v_variant is null or h.variant_id = v_variant)
      and (v_product is null or h.product_id = v_product)
      and (v_q is null or v.sku ilike app.like_pattern(v_q) or p.name ->> 'ar' ilike app.like_pattern(v_q)
           or p.name ->> 'en' ilike app.like_pattern(v_q) or p.slug ilike app.like_pattern(v_q))
      and (v_actor is null or pr.email ilike app.like_pattern(v_actor) or pr.full_name ilike app.like_pattern(v_actor))
      and (v_source is null or h.source = v_source)
      and (v_from is null or h.created_at >= v_from)
      and (v_to is null or h.created_at < v_to)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'createdAt', m.created_at, 'variantId', m.variant_id, 'productId', m.product_id,
             'sku', m.sku, 'productName', m.product_name, 'productSlug', m.product_slug,
             'variantLabel', app.variant_option_label(m.variant_id),
             'oldPrice', m.old_price, 'newPrice', m.new_price, 'oldCompareAt', m.old_compare_at,
             'newCompareAt', m.new_compare_at, 'reason', m.reason, 'source', m.source,
             'actorName', coalesce(m.actor_name, m.actor_email), 'isDemo', m.is_demo)
             order by m.created_at desc, m.id desc)
           from (select * from matched order by created_at desc, id desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Inventory ───────────────────────────────────────────────────────────────
create or replace function public.admin_list_inventory(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_any_permission(array['inventory.manage', 'catalog.view']);
  v_limit   integer := app.page_limit(p_filter, 50, 200);
  v_offset  integer := app.page_offset(p_filter);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_view    text := coalesce(nullif(p_filter ->> 'view', ''), 'all');
  v_brand   uuid := nullif(p_filter ->> 'brandId', '')::uuid;
  v_cat     uuid := nullif(p_filter ->> 'categoryId', '')::uuid;
  v_total   integer;
  v_items   jsonb;
begin
  with base as (
    select v.id, v.sku, v.product_id, v.stock_quantity, v.low_stock_threshold, v.is_active, v.is_demo, v.updated_at,
           p.name as product_name, p.slug as product_slug,
           app.variant_reserved_quantity(v.id, null) as reserved,
           app.variant_available_quantity(v.id) as available,
           (select max(sm.created_at) from public.stock_movements sm where sm.variant_id = v.id) as last_movement_at,
           (select sm.created_at from public.stock_movements sm
            where sm.variant_id = v.id and sm.delta > 0 and sm.quantity_after - sm.delta <= 0
              and sm.created_at > now() - interval '14 days'
            order by sm.created_at desc limit 1) as back_in_stock_at
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
    where v.deleted_at is null
      and (v_q is null or v.sku ilike app.like_pattern(v_q) or p.name ->> 'ar' ilike app.like_pattern(v_q)
           or p.name ->> 'en' ilike app.like_pattern(v_q) or v.barcode = v_q)
      and (v_brand is null or p.brand_id = v_brand)
      and (v_cat is null or exists (select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_id = v_cat))
  ),
  matched as (
    select * from base
    where case v_view
      when 'low' then is_active and available > 0 and available <= low_stock_threshold
      when 'out' then is_active and available <= 0
      when 'back_in_stock' then is_active and available > 0 and back_in_stock_at is not null
      else true end
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'variantId', m.id, 'productId', m.product_id, 'sku', m.sku, 'productName', m.product_name,
             'productSlug', m.product_slug, 'variantLabel', app.variant_option_label(m.id),
             'quantity', m.stock_quantity, 'reserved', m.reserved, 'available', m.available,
             'lowStockThreshold', m.low_stock_threshold, 'isActive', m.is_active,
             'state', app.admin_stock_state(m.available, m.low_stock_threshold, m.is_active),
             'lastMovementAt', m.last_movement_at, 'backInStockAt', m.back_in_stock_at,
             'updatedAt', m.updated_at, 'isDemo', m.is_demo)
             order by m.available, m.sku)
           from (select * from matched order by available, sku limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- Typed stock adjustment with reason, before / after, and stale protection.
create or replace function public.admin_adjust_stock(p_variant_id uuid, p_type text, p_quantity integer, p_reason text,
                                                     p_expected_quantity integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('inventory.manage');
  v_variant public.product_variants;
  v_before integer;
  v_after integer;
  v_reserved integer;
begin
  if p_type not in ('addition', 'reduction', 'damage', 'return', 'correction') then
    return jsonb_build_object('ok', false, 'code', 'invalid_type');
  end if;
  if p_quantity is null or p_quantity < 0 or (p_type <> 'correction' and p_quantity = 0) or p_quantity > 100000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_quantity', 'field', 'quantity');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
  end if;
  select * into v_variant from public.product_variants where id = p_variant_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  v_before := v_variant.stock_quantity;
  if p_expected_quantity is not null and p_expected_quantity <> v_before then
    return jsonb_build_object('ok', false, 'code', 'stale', 'quantity', v_before);
  end if;
  v_after := case p_type
    when 'addition' then v_before + p_quantity
    when 'return' then v_before + p_quantity
    when 'correction' then p_quantity
    else v_before - p_quantity end;
  if v_after < 0 then return jsonb_build_object('ok', false, 'code', 'negative', 'quantity', v_before); end if;
  if v_after = v_before then return jsonb_build_object('ok', false, 'code', 'no_change'); end if;
  v_reserved := app.variant_reserved_quantity(p_variant_id, null);
  if v_after < v_reserved then
    return jsonb_build_object('ok', false, 'code', 'below_reserved', 'reserved', v_reserved);
  end if;
  update public.product_variants set stock_quantity = v_after where id = p_variant_id returning * into v_variant;
  insert into public.stock_movements (variant_id, delta, quantity_before, quantity_after, reason, actor_id, note, is_demo)
  values (p_variant_id, v_after - v_before, v_before, v_after, p_type, v_uid, left(btrim(p_reason), 500), v_variant.is_demo);
  perform app.log_event('stock.adjusted', 'public.product_variants', v_variant.sku,
                        jsonb_build_object('quantity', v_before), jsonb_build_object('quantity', v_after),
                        jsonb_build_object('type', p_type, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after, 'reserved', v_reserved,
                            'available', v_after - v_reserved, 'updatedAt', v_variant.updated_at);
end;
$$;

create or replace function public.admin_list_stock_movements(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_any_permission(array['inventory.manage', 'catalog.view']);
  v_limit   integer := app.page_limit(p_filter, 50, 200);
  v_offset  integer := app.page_offset(p_filter);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_variant uuid := nullif(p_filter ->> 'variantId', '')::uuid;
  v_type    text := nullif(p_filter ->> 'type', '');
  v_actor   text := nullif(btrim(coalesce(p_filter ->> 'actor', '')), '');
  v_from    timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to      timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select sm.*, v.sku, p.name as product_name, o.order_number, pr.email as actor_email, pr.full_name as actor_name
    from public.stock_movements sm
    join public.product_variants v on v.id = sm.variant_id
    join public.products p on p.id = v.product_id
    left join public.orders o on o.id = sm.order_id
    left join public.profiles pr on pr.id = sm.actor_id
    where (v_variant is null or sm.variant_id = v_variant)
      and (v_type is null or sm.reason = v_type)
      and (v_q is null or v.sku ilike app.like_pattern(v_q) or p.name ->> 'ar' ilike app.like_pattern(v_q)
           or p.name ->> 'en' ilike app.like_pattern(v_q) or o.order_number ilike app.like_pattern(v_q))
      and (v_actor is null or pr.email ilike app.like_pattern(v_actor) or pr.full_name ilike app.like_pattern(v_actor))
      and (v_from is null or sm.created_at >= v_from)
      and (v_to is null or sm.created_at < v_to)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'createdAt', m.created_at, 'type', m.reason, 'variantId', m.variant_id, 'sku', m.sku,
             'productName', m.product_name, 'variantLabel', app.variant_option_label(m.variant_id),
             'quantityBefore', coalesce(m.quantity_before, m.quantity_after - m.delta), 'change', m.delta,
             'quantityAfter', m.quantity_after, 'reason', m.note, 'orderNumber', m.order_number,
             'actorName', coalesce(m.actor_name, m.actor_email), 'isDemo', m.is_demo)
             order by m.created_at desc, m.id desc)
           from (select * from matched order by created_at desc, id desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Categories ──────────────────────────────────────────────────────────────
create or replace function public.admin_list_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'parentId', c.parent_id, 'name', c.name, 'description', c.description,
      'icon', c.icon, 'imageUrl', c.image_url, 'sortOrder', c.sort_order, 'isVisible', c.is_visible,
      'showInNav', c.show_in_nav, 'showOnHome', c.show_on_home, 'showInShop', c.show_in_shop,
      'showInCategoryGrid', c.show_in_category_grid, 'seoTitle', c.seo_title, 'seoDescription', c.seo_description,
      'isDemo', c.is_demo, 'updatedAt', c.updated_at,
      'productCount', (select count(*) from public.product_categories pc join public.products p on p.id = pc.product_id
                       where pc.category_id = c.id and p.deleted_at is null),
      'childCount', (select count(*) from public.categories ch where ch.parent_id = c.id and ch.deleted_at is null))
      order by c.sort_order, c.slug)
    from public.categories c where c.deleted_at is null), '[]'::jsonb);
end;
$$;

create or replace function public.admin_save_category(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('catalog.manage');
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_parent  uuid := nullif(p_payload ->> 'parentId', '')::uuid;
  v_slug    text := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_row     public.categories;
  v_cursor  uuid;
  v_depth   integer := 0;
begin
  if v_slug !~ '^[a-z0-9-]{1,60}$' then return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'field', 'slug'); end if;
  if not app.valid_lt(p_payload -> 'name') then return jsonb_build_object('ok', false, 'code', 'name_required', 'field', 'name'); end if;
  if nullif(p_payload ->> 'icon', '') is not null and p_payload ->> 'icon' !~ '^[a-z-]{1,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_icon', 'field', 'icon');
  end if;
  if nullif(p_payload ->> 'imageUrl', '') is not null and p_payload ->> 'imageUrl' !~ '^(/|https://)' then
    return jsonb_build_object('ok', false, 'code', 'invalid_image', 'field', 'imageUrl');
  end if;
  if exists (select 1 from public.categories where slug = v_slug and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'field', 'slug');
  end if;
  if v_parent is not null then
    if not exists (select 1 from public.categories where id = v_parent and deleted_at is null) then
      return jsonb_build_object('ok', false, 'code', 'parent_not_found', 'field', 'parentId');
    end if;
    -- Walk up from the new parent: reaching this category means a cycle.
    v_cursor := v_parent;
    while v_cursor is not null loop
      if v_cursor = v_id then return jsonb_build_object('ok', false, 'code', 'cycle', 'field', 'parentId'); end if;
      v_depth := v_depth + 1;
      if v_depth > 10 then return jsonb_build_object('ok', false, 'code', 'too_deep', 'field', 'parentId'); end if;
      select parent_id into v_cursor from public.categories where id = v_cursor;
    end loop;
  end if;
  if v_id is null then
    insert into public.categories (slug, parent_id, name, description, icon, image_url, sort_order, is_visible,
                                   show_in_nav, show_on_home, show_in_shop, show_in_category_grid, seo_title, seo_description)
    values (v_slug, v_parent, app.json_lt(p_payload -> 'name'), app.json_lt(p_payload -> 'description'),
            nullif(p_payload ->> 'icon', ''), nullif(p_payload ->> 'imageUrl', ''),
            coalesce(nullif(p_payload ->> 'sortOrder', '')::integer,
                     (select coalesce(max(sort_order), 0) + 1 from public.categories where parent_id is not distinct from v_parent)),
            coalesce((p_payload ->> 'isVisible')::boolean, true), coalesce((p_payload ->> 'showInNav')::boolean, false),
            coalesce((p_payload ->> 'showOnHome')::boolean, false), coalesce((p_payload ->> 'showInShop')::boolean, true),
            coalesce((p_payload ->> 'showInCategoryGrid')::boolean, false),
            app.json_lt(p_payload -> 'seoTitle'), app.json_lt(p_payload -> 'seoDescription'))
    returning * into v_row;
  else
    select * into v_row from public.categories where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_row.updated_at is distinct from nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
    end if;
    update public.categories set slug = v_slug, parent_id = v_parent, name = app.json_lt(p_payload -> 'name'),
      description = app.json_lt(p_payload -> 'description'), icon = nullif(p_payload ->> 'icon', ''),
      image_url = nullif(p_payload ->> 'imageUrl', ''),
      is_visible = coalesce((p_payload ->> 'isVisible')::boolean, true),
      show_in_nav = coalesce((p_payload ->> 'showInNav')::boolean, false),
      show_on_home = coalesce((p_payload ->> 'showOnHome')::boolean, false),
      show_in_shop = coalesce((p_payload ->> 'showInShop')::boolean, true),
      show_in_category_grid = coalesce((p_payload ->> 'showInCategoryGrid')::boolean, false),
      seo_title = app.json_lt(p_payload -> 'seoTitle'), seo_description = app.json_lt(p_payload -> 'seoDescription'),
      updated_at = clock_timestamp()
    where id = v_id returning * into v_row;
  end if;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'updatedAt', v_row.updated_at);
end;
$$;

create or replace function public.admin_reorder_categories(p_parent_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
begin
  if exists (select 1 from unnest(p_ids) i where not exists (
      select 1 from public.categories c where c.id = i and c.parent_id is not distinct from p_parent_id and c.deleted_at is null)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  update public.categories c set sort_order = t.ord
  from unnest(p_ids) with ordinality as t (id, ord) where c.id = t.id;
  perform app.log_event('catalog.categories_reordered', 'public.categories', p_parent_id::text, null, null,
                        jsonb_build_object('ids', to_jsonb(p_ids)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_delete_category(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
begin
  if not exists (select 1 from public.categories where id = p_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.categories where parent_id = p_id and deleted_at is null)
     or exists (select 1 from public.product_categories pc join public.products p on p.id = pc.product_id
                where pc.category_id = p_id and p.deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;
  update public.categories set deleted_at = now(), is_visible = false where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Brands ──────────────────────────────────────────────────────────────────
create or replace function public.admin_list_brands()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'logoUrl', b.logo_url,
      'sortOrder', b.sort_order, 'isVisible', b.is_visible, 'isFeatured', b.is_featured,
      'showOnApple', b.show_on_apple, 'seoTitle', b.seo_title, 'seoDescription', b.seo_description,
      'isDemo', b.is_demo, 'updatedAt', b.updated_at,
      'categoryIds', coalesce((select jsonb_agg(bc.category_id) from public.brand_categories bc where bc.brand_id = b.id), '[]'::jsonb),
      'productCount', (select count(*) from public.products p where p.brand_id = b.id and p.deleted_at is null))
      order by b.sort_order, b.slug)
    from public.brands b where b.deleted_at is null), '[]'::jsonb);
end;
$$;

create or replace function public.admin_save_brand(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_permission('catalog.manage');
  v_id   uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_slug text := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_row  public.brands;
begin
  if v_slug !~ '^[a-z0-9-]{1,60}$' then return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'field', 'slug'); end if;
  if not app.valid_lt(p_payload -> 'name') then return jsonb_build_object('ok', false, 'code', 'name_required', 'field', 'name'); end if;
  if nullif(p_payload ->> 'logoUrl', '') is not null and p_payload ->> 'logoUrl' !~ '^(/|https://)' then
    return jsonb_build_object('ok', false, 'code', 'invalid_image', 'field', 'logoUrl');
  end if;
  if exists (select 1 from public.brands where slug = v_slug and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'field', 'slug');
  end if;
  if v_id is null then
    insert into public.brands (slug, name, description, logo_url, sort_order, is_visible, is_featured, show_on_apple,
                               seo_title, seo_description)
    values (v_slug, app.json_lt(p_payload -> 'name'), app.json_lt(p_payload -> 'description'),
            nullif(p_payload ->> 'logoUrl', ''),
            coalesce(nullif(p_payload ->> 'sortOrder', '')::integer, (select coalesce(max(sort_order), 0) + 1 from public.brands)),
            coalesce((p_payload ->> 'isVisible')::boolean, true), coalesce((p_payload ->> 'isFeatured')::boolean, false),
            coalesce((p_payload ->> 'showOnApple')::boolean, false),
            app.json_lt(p_payload -> 'seoTitle'), app.json_lt(p_payload -> 'seoDescription'))
    returning * into v_row;
  else
    select * into v_row from public.brands where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_row.updated_at is distinct from nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
    end if;
    update public.brands set slug = v_slug, name = app.json_lt(p_payload -> 'name'),
      description = app.json_lt(p_payload -> 'description'), logo_url = nullif(p_payload ->> 'logoUrl', ''),
      sort_order = coalesce(nullif(p_payload ->> 'sortOrder', '')::integer, sort_order),
      is_visible = coalesce((p_payload ->> 'isVisible')::boolean, true),
      is_featured = coalesce((p_payload ->> 'isFeatured')::boolean, false),
      show_on_apple = coalesce((p_payload ->> 'showOnApple')::boolean, false),
      seo_title = app.json_lt(p_payload -> 'seoTitle'), seo_description = app.json_lt(p_payload -> 'seoDescription'),
      updated_at = clock_timestamp()
    where id = v_id returning * into v_row;
  end if;
  delete from public.brand_categories where brand_id = v_row.id;
  insert into public.brand_categories (brand_id, category_id)
  select v_row.id, c.id::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'categoryIds', '[]')) c (id)
  join public.categories cat on cat.id = c.id::uuid and cat.deleted_at is null
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'updatedAt', v_row.updated_at);
end;
$$;

create or replace function public.admin_delete_brand(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('catalog.manage');
begin
  if not exists (select 1 from public.brands where id = p_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.products where brand_id = p_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;
  update public.brands set deleted_at = now(), is_visible = false where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.record_price_change(), app.set_change_context(text, text), app.valid_lt(jsonb, boolean),
  app.json_lt(jsonb), app.json_numeric(jsonb), app.variant_option_label(uuid), app.admin_stock_state(integer, integer, boolean),
  app.admin_product_json(uuid) from public;
grant execute on function app.set_change_context(text, text), app.valid_lt(jsonb, boolean), app.json_lt(jsonb),
  app.json_numeric(jsonb), app.variant_option_label(uuid), app.admin_stock_state(integer, integer, boolean)
  to authenticated;

revoke all on function public.admin_catalog_lookups(), public.admin_list_products(jsonb), public.admin_get_product(uuid),
  public.admin_save_product(jsonb), public.admin_set_products_state(uuid[], text), public.admin_duplicate_product(uuid),
  public.admin_delete_product(uuid), public.admin_set_variant_price(uuid, numeric, numeric, text, timestamptz),
  public.admin_bulk_update_variants(uuid[], jsonb, text), public.admin_list_price_history(jsonb),
  public.admin_list_inventory(jsonb), public.admin_adjust_stock(uuid, text, integer, text, integer),
  public.admin_list_stock_movements(jsonb), public.admin_list_categories(), public.admin_save_category(jsonb),
  public.admin_reorder_categories(uuid, uuid[]), public.admin_delete_category(uuid), public.admin_list_brands(),
  public.admin_save_brand(jsonb), public.admin_delete_brand(uuid)
  from public, anon;
grant execute on function public.admin_catalog_lookups(), public.admin_list_products(jsonb), public.admin_get_product(uuid),
  public.admin_save_product(jsonb), public.admin_set_products_state(uuid[], text), public.admin_duplicate_product(uuid),
  public.admin_delete_product(uuid), public.admin_set_variant_price(uuid, numeric, numeric, text, timestamptz),
  public.admin_bulk_update_variants(uuid[], jsonb, text), public.admin_list_price_history(jsonb),
  public.admin_list_inventory(jsonb), public.admin_adjust_stock(uuid, text, integer, text, integer),
  public.admin_list_stock_movements(jsonb), public.admin_list_categories(), public.admin_save_category(jsonb),
  public.admin_reorder_categories(uuid, uuid[]), public.admin_delete_category(uuid), public.admin_list_brands(),
  public.admin_save_brand(jsonb), public.admin_delete_brand(uuid)
  to authenticated;
