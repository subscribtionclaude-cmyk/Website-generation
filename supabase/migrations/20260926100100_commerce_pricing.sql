-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0011 · Commerce pricing & availability
--
--   • Availability = stock_quantity − ACTIVE, UNEXPIRED reservations (by timestamp, no cron).
--   • Automatic time-bound offers (kinds flash / limited_time / percentage / fixed) discount the
--     selling price of their target variants while the offer window is open; when the offer ends the
--     price reverts by itself. The best (largest) automatic discount wins; offers never stack.
--   • app.storefront_variants keeps its Phase 02 columns (so earlier migrations stay re-runnable) but
--     now returns the effective price, the "was" price and a reservation-aware stock state.
-- Mirrored in src/domain/catalog/engine.ts (demo adapter) and src/domain/commerce/pricing.ts.
-- ════════════════════════════════════════════════════════════════════════════

-- Commerce configuration with safe defaults (the published `commerce` setting overrides keys).
create or replace function app.commerce_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'reservationMinutes', 30,
           'maxQuantityPerLine', 5,
           'maxOpenOrdersPerCustomer', 3,
           'orderNumberPrefix', 'MS',
           'paymentMethods', jsonb_build_object('cod', true, 'instapay', true, 'split', true))
         || coalesce((select value from public.site_settings where key = 'commerce'), '{}'::jsonb);
$$;

create or replace function app.commerce_int(p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(greatest(coalesce(
           case when jsonb_typeof(app.commerce_config() -> p_key) = 'number'
                then (app.commerce_config() ->> p_key)::numeric::integer end,
           p_default), p_min), p_max);
$$;

create or replace function app.feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value ->> p_key)::boolean from public.site_settings where key = 'features'), false);
$$;

-- ── Reservations & availability ─────────────────────────────────────────────
create or replace function app.variant_reserved_quantity(p_variant_id uuid, p_exclude_order uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0)::integer
  from public.stock_reservations r
  where r.variant_id = p_variant_id
    and r.status = 'active'
    and r.expires_at > now()
    and (p_exclude_order is null or r.order_id <> p_exclude_order);
$$;

create or replace function app.variant_available_quantity(p_variant_id uuid, p_exclude_order uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(v.stock_quantity - app.variant_reserved_quantity(v.id, p_exclude_order), 0)
  from public.product_variants v
  where v.id = p_variant_id;
$$;

-- ── Offer applicability ─────────────────────────────────────────────────────
create or replace function app.category_subtree(p_category_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select id from public.categories where id = p_category_id
    union
    select c.id from public.categories c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

-- Does the offer target this variant? Targets: offer_products (role 'target', whole product or one
-- variant) and offer_categories (incl. sub-categories). p_untargeted_applies: an offer with no
-- targets at all applies to everything (used for store-wide promo codes, never for automatic offers).
create or replace function app.offer_applies_to_variant(p_offer_id uuid, p_variant_id uuid,
                                                        p_untargeted_applies boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.offer_products op
           join public.product_variants v on v.id = p_variant_id
           where op.offer_id = p_offer_id and op.role = 'target' and op.product_id = v.product_id
             and (op.variant_id is null or op.variant_id = v.id))
      or exists (
           select 1 from public.offer_categories oc
           join public.product_variants v on v.id = p_variant_id
           join public.product_categories pc on pc.product_id = v.product_id
           where oc.offer_id = p_offer_id
             and pc.category_id in (select app.category_subtree(oc.category_id)))
      or (p_untargeted_applies
          and not exists (select 1 from public.offer_products op
                          where op.offer_id = p_offer_id and op.role = 'target')
          and not exists (select 1 from public.offer_categories oc where oc.offer_id = p_offer_id));
$$;

-- Effective selling price of one variant right now.
create or replace function app.variant_pricing(p_variant_id uuid)
returns table (regular_price numeric, unit_price numeric, offer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select v.price,
         case when d.discount > 0 then greatest(v.price - d.discount, 0) else v.price end,
         case when d.discount > 0 then d.offer_id end
  from public.product_variants v
  left join lateral (
    select o.id as offer_id,
           round(greatest(coalesce(v.price * o.discount_percent / 100, 0), coalesce(o.discount_amount, 0)), 2)
             as discount
    from public.offers o
    where v.price is not null
      and o.kind in ('flash', 'limited_time', 'percentage', 'fixed')
      and app.offer_is_active(o)
      and app.offer_applies_to_variant(o.id, v.id, false)
    order by 2 desc, o.sort_order, o.id
    limit 1
  ) d on true
  where v.id = p_variant_id;
$$;

-- Same columns as Phase 02 (Phase 02 migrations remain re-runnable); new semantics:
--   price            → effective price (automatic offer applied)
--   compare_at_price → the higher "was" price while an automatic offer runs, else the stored one
--   stock_state      → computed from quantity AVAILABLE after active reservations
create or replace view app.storefront_variants as
select
  v.id,
  v.product_id,
  v.sku,
  (case when vp.offer_id is not null then vp.unit_price else v.price end)::numeric(12, 2) as price,
  (case when vp.offer_id is not null then greatest(v.price, coalesce(v.compare_at_price, 0))
        else v.compare_at_price end)::numeric(12, 2) as compare_at_price,
  v.is_default,
  v.warranty,
  v.sort_order,
  app.variant_stock_state(app.variant_available_quantity(v.id), v.low_stock_threshold, v.is_active) as stock_state,
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
left join lateral app.variant_pricing(v.id) vp on true
where v.deleted_at is null and v.is_active;

revoke all on app.storefront_variants from public, anon, authenticated;

revoke all on function app.commerce_config(), app.commerce_int(text, integer, integer, integer),
  app.feature_enabled(text), app.variant_reserved_quantity(uuid, uuid), app.variant_available_quantity(uuid, uuid),
  app.category_subtree(uuid), app.offer_applies_to_variant(uuid, uuid, boolean), app.variant_pricing(uuid)
  from public;
