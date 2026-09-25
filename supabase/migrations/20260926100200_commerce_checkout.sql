-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0012 · Checkout: quote, account cart, create_order, customer order views
--
-- Server-side price authority: the client sends variant ids + quantities (+ the prices it showed
-- the customer, used ONLY to detect "price changed"). Every amount is recomputed here.
-- create_order is atomic and idempotent:
--   1. per-customer advisory lock (double clicks / retries serialise), idempotency key re-checked;
--   2. row locks on every variant involved (ORDER BY id → no deadlocks between checkouts);
--   3. availability = stock − active unexpired reservations, checked under those locks;
--   4. order + items + reservations + promo redemption + timeline inserted in one transaction.
-- Business rejections return { ok:false, code } (nothing is written); raw errors never reach users.
-- Mirrored by src/domain/commerce/* (demo adapter) — see supabase/tests/sql/07_commerce.test.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Input normalisation ─────────────────────────────────────────────────────
-- Integer from a JSON number (null for anything else: strings, fractions, huge values).
create or replace function app.json_positive_int(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- Nested CASE: the numeric cast only runs once the value is known to be a JSON number.
  select case when jsonb_typeof(p_value) = 'number' then
           case when (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
                 and (p_value #>> '{}')::numeric between -1000000 and 1000000
                then (p_value #>> '{}')::numeric::integer end
         end;
$$;

-- Aggregates duplicate variant ids (first position wins), drops malformed entries.
create or replace function app.quote_items(p_items jsonb)
returns table (line_no integer, variant_id uuid, quantity integer, expected_unit_price numeric)
language sql
immutable
set search_path = ''
as $$
  with raw as (
    select ord, e
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
         with ordinality as t(e, ord)
    where jsonb_typeof(e) = 'object'
      and coalesce(e ->> 'variantId', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and app.json_positive_int(e -> 'quantity') between 1 and 99
  ), grouped as (
    select (e ->> 'variantId')::uuid as variant_id,
           min(ord) as first_ord,
           least(sum(app.json_positive_int(e -> 'quantity')), 99)::integer as quantity,
           (array_agg(case when jsonb_typeof(e -> 'expectedUnitPrice') = 'number'
                           then (e ->> 'expectedUnitPrice')::numeric end order by ord))[1] as expected_unit_price
    from raw
    group by 1
  )
  select row_number() over (order by first_ord)::integer, variant_id, quantity, expected_unit_price
  from grouped
  order by first_ord
  limit 20;
$$;

-- ── Quote ───────────────────────────────────────────────────────────────────
create or replace function app.quote_line_add_discount(p_lines jsonb, p_idx integer, p_amount numeric, p_entry jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(
           jsonb_set(p_lines, array[p_idx::text, 'discount'],
                     to_jsonb(((p_lines -> p_idx ->> 'discount')::numeric + p_amount))),
           array[p_idx::text, 'discounts'],
           (p_lines -> p_idx -> 'discounts') || jsonb_build_array(p_entry));
$$;

create or replace function app.variant_line_snapshot(p_variant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'productId', p.id,
    'productSlug', p.slug,
    'sku', v.sku,
    'name', p.name,
    'brand', b.name,
    'isDemo', p.is_demo,
    'warranty', coalesce(v.warranty, p.warranty),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('key', o.key, 'name', o.name, 'valueKey', ov.key, 'valueLabel', ov.label)
                       order by o.sort_order, o.key)
      from public.variant_option_values vov
      join public.product_options o on o.id = vov.option_id
      join public.product_option_values ov on ov.id = vov.option_value_id
      where vov.variant_id = v.id), '[]'::jsonb),
    'variantLabel', (
      select case when count(*) = 0 then null else jsonb_build_object(
               'ar', string_agg(ov.label ->> 'ar', ' · ' order by o.sort_order, o.key),
               'en', string_agg(coalesce(ov.label ->> 'en', ov.label ->> 'ar'), ' · ' order by o.sort_order, o.key)) end
      from public.variant_option_values vov
      join public.product_options o on o.id = vov.option_id
      join public.product_option_values ov on ov.id = vov.option_value_id
      where vov.variant_id = v.id),
    'image', (
      select m.url from public.product_media m
      where m.product_id = p.id and m.kind = 'image'
        and (m.option_value_id is null or m.option_value_id in (
              select vov.option_value_id from public.variant_option_values vov where vov.variant_id = v.id))
      order by (m.option_value_id is not null) desc, m.is_cover desc, m.sort_order, m.id
      limit 1))
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  where v.id = p_variant_id;
$$;

create or replace function app.offer_snapshot(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', o.slug, 'kind', o.kind, 'title', o.title, 'badge', o.badge,
                            'discountPercent', o.discount_percent, 'discountAmount', o.discount_amount,
                            'endsAt', o.ends_at)
  from public.offers o where o.id = p_offer_id;
$$;

-- Authoritative quote. p_customer may be null (anonymous cart validation).
create or replace function app.build_quote(p_customer uuid, p_items jsonb, p_promo_code text, p_fulfillment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max_qty      integer := app.commerce_int('maxQuantityPerLine', 5, 1, 99);
  v_lines        jsonb := '[]'::jsonb;
  v_item         record;
  v_variant      public.product_variants%rowtype;
  v_product      public.products%rowtype;
  v_regular      numeric;
  v_price        numeric;
  v_offer_id     uuid;
  v_available    integer;
  v_status       text;
  v_max          integer;
  v_snapshot     jsonb;
  v_idx          integer;
  v_bundles      jsonb := '[]'::jsonb;
  v_gifts_note   jsonb := '[]'::jsonb;
  v_offer        public.offers%rowtype;
  v_promo        jsonb := null;
  v_code         text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_count        integer;
  v_base         numeric;
  v_amount       numeric;
  v_left         numeric;
  v_line_base    numeric;
  v_total_disc   numeric;
  v_sets         integer;
  v_required     integer;
  v_units        integer;
  v_line         jsonb;
  v_used         jsonb := '{}'::jsonb;
  v_bundle_disc  numeric;
  v_product_id   uuid;
  v_gift_variant uuid;
  v_gift_qty     integer;
  v_valid        boolean := true;
  v_issues       text[] := '{}';
  v_original     numeric := 0;
  v_subtotal     numeric := 0;
  v_discount     numeric := 0;
  v_fee          numeric;
  v_fee_status   text;
  v_has_lines    boolean := false;
begin
  -- 1. Lines: identity, visibility, purchasability, stock, effective price.
  for v_item in select * from app.quote_items(p_items) loop
    v_has_lines := true;
    v_status := 'ok';
    v_max := null;
    v_regular := null;
    v_price := null;
    v_offer_id := null;
    select * into v_variant from public.product_variants where id = v_item.variant_id;
    if not found then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'lineNo', v_item.line_no, 'variantId', v_item.variant_id, 'quantity', v_item.quantity,
        'status', 'unavailable', 'isGift', false, 'discount', 0, 'discounts', '[]'::jsonb));
      continue;
    end if;
    select * into v_product from public.products where id = v_variant.product_id;
    v_snapshot := app.variant_line_snapshot(v_variant.id);
    select vp.regular_price, vp.unit_price, vp.offer_id into v_regular, v_price, v_offer_id
      from app.variant_pricing(v_variant.id) vp;
    v_available := app.variant_available_quantity(v_variant.id);

    if v_variant.deleted_at is not null or not v_variant.is_active or not app.product_is_visible(v_product) then
      v_status := 'unavailable';
    elsif v_product.availability_state <> 'available' or v_price is null then
      v_status := 'not_purchasable';
    elsif v_item.quantity > v_max_qty then
      v_status := 'max_quantity';
      v_max := v_max_qty;
    elsif v_available <= 0 then
      v_status := 'out_of_stock';
      v_max := 0;
    elsif v_available < v_item.quantity then
      v_status := 'insufficient_stock';
      v_max := least(v_available, v_max_qty);
    end if;

    v_lines := v_lines || jsonb_build_array(v_snapshot || jsonb_build_object(
      'lineNo', v_item.line_no,
      'variantId', v_variant.id,
      'quantity', v_item.quantity,
      'status', v_status,
      'maxQuantity', v_max,
      'stockState', app.variant_stock_state(v_available, v_variant.low_stock_threshold, v_variant.is_active),
      'regularUnitPrice', v_regular,
      'unitPrice', v_price,
      'expectedUnitPrice', v_item.expected_unit_price,
      'lineSubtotal', case when v_price is not null then v_price * v_item.quantity end,
      'offer', case when v_offer_id is not null then app.offer_snapshot(v_offer_id) end,
      'isGift', false,
      'discount', 0,
      'discounts', '[]'::jsonb));
  end loop;

  -- 2. Bundle offers: every bundle_item product present → discount_percent on the complete sets.
  for v_offer in
    select o.* from public.offers o
    where o.kind = 'bundle' and o.discount_percent is not null and app.offer_is_active(o)
    order by o.sort_order, o.id
  loop
    v_sets := null;
    for v_product_id, v_required in
      select op.product_id, op.quantity from public.offer_products op
      where op.offer_id = v_offer.id and op.role = 'bundle_item'
    loop
      select coalesce(sum((l ->> 'quantity')::integer - coalesce((v_used ->> (l ->> 'lineNo'))::integer, 0)), 0)
        into v_units
        from jsonb_array_elements(v_lines) l
        where l ->> 'status' = 'ok' and (l ->> 'productId')::uuid = v_product_id;
      v_sets := least(coalesce(v_sets, v_units / v_required), v_units / v_required);
    end loop;
    if v_sets is null or v_sets <= 0
       or (select count(*) from public.offer_products op where op.offer_id = v_offer.id and op.role = 'bundle_item') < 2 then
      continue;
    end if;
    v_bundle_disc := 0;
    for v_product_id, v_required in
      select op.product_id, op.quantity from public.offer_products op
      where op.offer_id = v_offer.id and op.role = 'bundle_item' order by op.product_id
    loop
      v_units := v_sets * v_required;
      for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
        exit when v_units <= 0;
        v_line := v_lines -> v_idx;
        continue when v_line ->> 'status' <> 'ok' or (v_line ->> 'productId')::uuid <> v_product_id;
        v_count := least(v_units, (v_line ->> 'quantity')::integer - coalesce((v_used ->> (v_line ->> 'lineNo'))::integer, 0));
        continue when v_count <= 0;
        v_amount := round((v_line ->> 'unitPrice')::numeric * v_count * v_offer.discount_percent / 100, 2);
        v_lines := app.quote_line_add_discount(v_lines, v_idx, v_amount, jsonb_build_object(
          'source', 'bundle', 'offerSlug', v_offer.slug, 'title', v_offer.title, 'units', v_count, 'amount', v_amount));
        v_used := jsonb_set(v_used, array[v_line ->> 'lineNo'],
                            to_jsonb(coalesce((v_used ->> (v_line ->> 'lineNo'))::integer, 0) + v_count));
        v_bundle_disc := v_bundle_disc + v_amount;
        v_units := v_units - v_count;
      end loop;
    end loop;
    v_bundles := v_bundles || jsonb_build_array(jsonb_build_object(
      'offerSlug', v_offer.slug, 'title', v_offer.title, 'sets', v_sets, 'discount', v_bundle_disc));
  end loop;

  -- 3. Free gifts: an active free_gift offer whose target is in the cart adds its gift (price 0).
  for v_offer in
    select o.* from public.offers o
    where o.kind = 'free_gift' and app.offer_is_active(o)
    order by o.sort_order, o.id
  loop
    continue when not exists (
      select 1 from jsonb_array_elements(v_lines) l
      where l ->> 'status' = 'ok' and not (l ->> 'isGift')::boolean
        and app.offer_applies_to_variant(v_offer.id, (l ->> 'variantId')::uuid, false));
    select coalesce(op.variant_id, (select dv.id from public.product_variants dv
                                    where dv.product_id = op.product_id and dv.deleted_at is null and dv.is_active
                                    order by dv.is_default desc, dv.sort_order, dv.id limit 1)),
           op.quantity
      into v_gift_variant, v_gift_qty
      from public.offer_products op
      where op.offer_id = v_offer.id and op.role = 'gift'
      order by op.product_id limit 1;
    continue when v_gift_variant is null;
    select coalesce(sum((l ->> 'quantity')::integer), 0) into v_count
      from jsonb_array_elements(v_lines) l
      where (l ->> 'variantId')::uuid = v_gift_variant and l ->> 'status' = 'ok';
    select * into v_product from public.products
      where id = (select product_id from public.product_variants where id = v_gift_variant);
    if app.product_is_visible(v_product)
       and app.variant_available_quantity(v_gift_variant) - v_count >= v_gift_qty then
      select vp.regular_price into v_regular from app.variant_pricing(v_gift_variant) vp;
      v_lines := v_lines || jsonb_build_array(app.variant_line_snapshot(v_gift_variant) || jsonb_build_object(
        'lineNo', jsonb_array_length(v_lines) + 1,
        'variantId', v_gift_variant,
        'quantity', v_gift_qty,
        'status', 'ok',
        'maxQuantity', null,
        'stockState', 'in_stock',
        'regularUnitPrice', coalesce(v_regular, 0),
        'unitPrice', 0,
        'expectedUnitPrice', null,
        'lineSubtotal', 0,
        'offer', app.offer_snapshot(v_offer.id),
        'isGift', true,
        'discount', 0,
        'discounts', '[]'::jsonb));
    else
      v_gifts_note := v_gifts_note || jsonb_build_array(jsonb_build_object(
        'offerSlug', v_offer.slug, 'title', v_offer.title, 'status', 'unavailable'));
    end if;
  end loop;

  -- 4. Promo code (server-side validation only).
  if v_code is not null then
    select o.* into v_offer from public.offers o
      where upper(o.promo_code) = v_code and o.kind = 'promo_code' and o.deleted_at is null
        and o.status = 'published' and (not o.is_demo or app.demo_catalog_visible())
      order by o.id limit 1;
    if not app.feature_enabled('promoCodes') then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'disabled');
    elsif v_offer.id is null then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'not_found');
    elsif v_offer.starts_at is not null and v_offer.starts_at > now() then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'not_started');
    elsif v_offer.ends_at is not null and v_offer.ends_at <= now() then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'expired');
    elsif v_offer.max_redemptions is not null
          and (select count(*) from public.promo_redemptions r
               where r.offer_id = v_offer.id and r.status = 'active') >= v_offer.max_redemptions then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'limit_reached');
    elsif p_customer is not null and v_offer.max_redemptions_per_customer is not null
          and (select count(*) from public.promo_redemptions r
               where r.offer_id = v_offer.id and r.customer_id = p_customer and r.status = 'active')
              >= v_offer.max_redemptions_per_customer then
      v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'customer_limit');
    else
      select coalesce(sum((l ->> 'lineSubtotal')::numeric - (l ->> 'discount')::numeric), 0), count(*)
        into v_base, v_count
        from jsonb_array_elements(v_lines) l
        where l ->> 'status' = 'ok' and not (l ->> 'isGift')::boolean
          and app.offer_applies_to_variant(v_offer.id, (l ->> 'variantId')::uuid, true);
      if v_count = 0 then
        v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'not_applicable');
      elsif v_offer.min_subtotal is not null and v_base < v_offer.min_subtotal then
        v_promo := jsonb_build_object('code', v_code, 'status', 'invalid', 'reason', 'min_subtotal',
                                      'minSubtotal', v_offer.min_subtotal);
      else
        v_total_disc := 0;
        v_left := least(coalesce(v_offer.discount_amount, 0), v_base);
        for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
          v_line := v_lines -> v_idx;
          continue when v_line ->> 'status' <> 'ok' or (v_line ->> 'isGift')::boolean
            or not app.offer_applies_to_variant(v_offer.id, (v_line ->> 'variantId')::uuid, true);
          v_line_base := (v_line ->> 'lineSubtotal')::numeric - (v_line ->> 'discount')::numeric;
          if v_offer.discount_percent is not null then
            v_amount := round(v_line_base * v_offer.discount_percent / 100, 2);
          else
            v_amount := least(v_left, v_line_base);
            v_left := v_left - v_amount;
          end if;
          continue when v_amount <= 0;
          v_lines := app.quote_line_add_discount(v_lines, v_idx, v_amount, jsonb_build_object(
            'source', 'promo', 'offerSlug', v_offer.slug, 'code', v_code, 'title', v_offer.title, 'amount', v_amount));
          v_total_disc := v_total_disc + v_amount;
        end loop;
        v_promo := jsonb_build_object('code', v_code, 'status', 'applied', 'offerSlug', v_offer.slug,
                                      'offerId', v_offer.id, 'title', v_offer.title,
                                      'discountPercent', v_offer.discount_percent,
                                      'discountAmount', v_offer.discount_amount, 'discount', v_total_disc);
      end if;
    end if;
  end if;

  -- 5. Line totals + order totals over valid lines.
  for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_line := v_lines -> v_idx;
    if v_line ->> 'status' = 'ok' then
      v_lines := jsonb_set(v_lines, array[v_idx::text, 'lineTotal'],
        to_jsonb((v_line ->> 'lineSubtotal')::numeric - (v_line ->> 'discount')::numeric));
      if not (v_line ->> 'isGift')::boolean then
        v_original := v_original + (v_line ->> 'regularUnitPrice')::numeric * (v_line ->> 'quantity')::integer;
        v_subtotal := v_subtotal + (v_line ->> 'lineSubtotal')::numeric;
      end if;
      v_discount := v_discount + (v_line ->> 'discount')::numeric;
    else
      v_valid := false;
      v_issues := array_append(v_issues, v_line ->> 'status');
      v_lines := jsonb_set(v_lines, array[v_idx::text, 'lineTotal'], 'null'::jsonb);
    end if;
  end loop;

  if not v_has_lines then
    v_valid := false;
    v_issues := array_append(v_issues, 'empty');
  end if;

  if p_fulfillment = 'pickup' then
    v_fee := 0;
    v_fee_status := 'not_required';
  else
    v_fee := null;
    v_fee_status := 'pending';
  end if;

  return jsonb_build_object(
    'currency', 'EGP',
    'computedAt', now(),
    'valid', v_valid,
    'issues', to_jsonb(array(select distinct unnest(v_issues))),
    'lines', v_lines,
    'bundles', v_bundles,
    'giftNotes', v_gifts_note,
    'promo', v_promo,
    'totals', jsonb_build_object(
      'originalSubtotal', v_original,
      'subtotal', v_subtotal,
      'discountTotal', v_discount,
      'shippingFee', v_fee,
      'shippingFeeStatus', v_fee_status,
      'total', v_subtotal - v_discount + coalesce(v_fee, 0)));
end;
$$;

-- Public cart validation (anonymous or signed-in). Read-only.
create or replace function public.quote_checkout(p_items jsonb, p_promo_code text default null,
                                                 p_fulfillment text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.build_quote(auth.uid(), p_items, p_promo_code, p_fulfillment);
$$;

-- ── Account cart ────────────────────────────────────────────────────────────
create or replace function app.cart_json(p_customer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
           'variantId', ci.variant_id, 'quantity', ci.quantity, 'savedForLater', ci.saved_for_later,
           'seenUnitPrice', ci.seen_unit_price, 'addedAt', ci.created_at) order by ci.created_at, ci.variant_id),
           '[]'::jsonb))
  from public.carts c join public.cart_items ci on ci.cart_id = c.id
  where c.customer_id = p_customer;
$$;

create or replace function app.require_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

create or replace function app.ensure_cart(p_customer uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.carts (customer_id) values (p_customer) on conflict (customer_id) do nothing;
  select id into v_id from public.carts where customer_id = p_customer;
  return v_id;
end;
$$;

create or replace function public.cart_get()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.cart_json(app.require_customer());
$$;

-- Deterministic merge of a browser cart into the account cart after sign-in:
--   same variant → quantities added, capped at maxQuantityPerLine and at current availability
--   (when some stock exists); a line stays "saved for later" only if both copies were saved;
--   unknown variant ids are dropped and reported; nothing else is lost.
create or replace function public.cart_merge(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := app.require_customer();
  v_cart        uuid := app.ensure_cart(v_uid);
  v_max_qty     integer := app.commerce_int('maxQuantityPerLine', 5, 1, 99);
  v_item        record;
  v_existing    public.cart_items%rowtype;
  v_qty         integer;
  v_available   integer;
  v_adjustments jsonb := '[]'::jsonb;
begin
  for v_item in
    select (e ->> 'variantId')::uuid as variant_id,
           sum(app.json_positive_int(e -> 'quantity'))::integer as quantity,
           bool_and(coalesce((e ->> 'savedForLater')::boolean, false)) as saved,
           (array_agg(case when jsonb_typeof(e -> 'seenUnitPrice') = 'number'
                           then (e ->> 'seenUnitPrice')::numeric end))[1] as seen
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object'
      and coalesce(e ->> 'variantId', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and app.json_positive_int(e -> 'quantity') between 1 and 99
    group by 1
    limit 50
  loop
    if not exists (select 1 from public.product_variants where id = v_item.variant_id) then
      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
        'variantId', v_item.variant_id, 'reason', 'removed_missing'));
      continue;
    end if;
    select * into v_existing from public.cart_items where cart_id = v_cart and variant_id = v_item.variant_id;
    v_qty := coalesce(v_existing.quantity, 0) + v_item.quantity;
    if v_qty > v_max_qty then
      v_qty := v_max_qty;
      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
        'variantId', v_item.variant_id, 'reason', 'capped_max', 'quantity', v_qty));
    end if;
    v_available := app.variant_available_quantity(v_item.variant_id);
    if v_available > 0 and v_qty > v_available then
      v_qty := v_available;
      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
        'variantId', v_item.variant_id, 'reason', 'capped_stock', 'quantity', v_qty));
    end if;
    insert into public.cart_items (cart_id, variant_id, quantity, saved_for_later, seen_unit_price)
    values (v_cart, v_item.variant_id, v_qty,
            coalesce(v_existing.saved_for_later, true) and v_item.saved,
            coalesce(v_item.seen, v_existing.seen_unit_price))
    on conflict (cart_id, variant_id) do update
      set quantity = excluded.quantity, saved_for_later = excluded.saved_for_later,
          seen_unit_price = excluded.seen_unit_price, updated_at = now();
  end loop;
  update public.carts set updated_at = now() where id = v_cart;
  return app.cart_json(v_uid) || jsonb_build_object('adjustments', v_adjustments);
end;
$$;

-- Set one line (quantity 0 removes it). Stock is validated by quote/checkout, not here.
create or replace function public.cart_set_item(p_variant_id uuid, p_quantity integer,
                                                p_saved_for_later boolean default false,
                                                p_seen_unit_price numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_customer();
  v_cart  uuid := app.ensure_cart(v_uid);
begin
  if p_quantity is null or p_quantity <= 0 then
    delete from public.cart_items where cart_id = v_cart and variant_id = p_variant_id;
  elsif exists (select 1 from public.product_variants where id = p_variant_id) then
    insert into public.cart_items (cart_id, variant_id, quantity, saved_for_later, seen_unit_price)
    values (v_cart, p_variant_id, least(p_quantity, app.commerce_int('maxQuantityPerLine', 5, 1, 99)),
            coalesce(p_saved_for_later, false),
            case when p_seen_unit_price >= 0 then round(p_seen_unit_price, 2) end)
    on conflict (cart_id, variant_id) do update
      set quantity = excluded.quantity, saved_for_later = excluded.saved_for_later,
          seen_unit_price = coalesce(excluded.seen_unit_price, public.cart_items.seen_unit_price),
          updated_at = now();
  end if;
  update public.carts set updated_at = now() where id = v_cart;
  return app.cart_json(v_uid);
end;
$$;

-- ── Manual review rules (settings key order_review; conservative defaults) ──
create or replace function app.order_review_rules()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'highValue', jsonb_build_object('enabled', true, 'threshold', 100000),
           'multipleExpensive', jsonb_build_object('enabled', true, 'unitPrice', 20000, 'minUnits', 2),
           'newCustomer', jsonb_build_object('enabled', true, 'minTotal', 30000),
           'splitPayment', jsonb_build_object('enabled', true),
           'unfinishedOrders', jsonb_build_object('enabled', true, 'maxCount', 2, 'windowDays', 7),
           'velocity', jsonb_build_object('enabled', true, 'maxOrders', 3, 'windowHours', 1))
         || coalesce((select value from public.site_settings where key = 'order_review'), '{}'::jsonb);
$$;

create or replace function app.manual_review_reasons(p_customer uuid, p_items_total numeric, p_lines jsonb,
                                                     p_payment_method text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rules    jsonb := app.order_review_rules();
  v_reasons  text[] := '{}';
  v_rule     jsonb;
begin
  v_rule := v_rules -> 'highValue';
  if (v_rule ->> 'enabled')::boolean and p_items_total >= (v_rule ->> 'threshold')::numeric then
    v_reasons := array_append(v_reasons, 'high_value');
  end if;
  v_rule := v_rules -> 'multipleExpensive';
  if (v_rule ->> 'enabled')::boolean and (
       select coalesce(sum((l ->> 'quantity')::integer), 0) from jsonb_array_elements(p_lines) l
       where l ->> 'status' = 'ok' and not (l ->> 'isGift')::boolean
         and (l ->> 'unitPrice')::numeric >= (v_rule ->> 'unitPrice')::numeric) >= (v_rule ->> 'minUnits')::integer then
    v_reasons := array_append(v_reasons, 'multiple_expensive');
  end if;
  v_rule := v_rules -> 'newCustomer';
  if (v_rule ->> 'enabled')::boolean and p_items_total >= (v_rule ->> 'minTotal')::numeric
     and not exists (select 1 from public.orders o where o.customer_id = p_customer and o.status <> 'cancelled') then
    v_reasons := array_append(v_reasons, 'new_customer');
  end if;
  v_rule := v_rules -> 'splitPayment';
  if (v_rule ->> 'enabled')::boolean and p_payment_method = 'split' then
    v_reasons := array_append(v_reasons, 'split_payment');
  end if;
  v_rule := v_rules -> 'unfinishedOrders';
  if (v_rule ->> 'enabled')::boolean and (
       select count(*) from public.orders o
       where o.customer_id = p_customer and o.status = 'cancelled'
         and o.created_at > now() - make_interval(days => (v_rule ->> 'windowDays')::integer))
     >= (v_rule ->> 'maxCount')::integer then
    v_reasons := array_append(v_reasons, 'unfinished_orders');
  end if;
  v_rule := v_rules -> 'velocity';
  if (v_rule ->> 'enabled')::boolean and (
       select count(*) from public.orders o
       where o.customer_id = p_customer
         and o.created_at > now() - make_interval(hours => (v_rule ->> 'windowHours')::integer))
     >= (v_rule ->> 'maxOrders')::integer then
    v_reasons := array_append(v_reasons, 'order_velocity');
  end if;
  return v_reasons;
end;
$$;

-- ── Order JSON ──────────────────────────────────────────────────────────────
create or replace function app.order_can_customer_cancel(o public.orders)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select o.status in ('new', 'awaiting_whatsapp', 'awaiting_payment')
     and o.paid_amount = 0 and o.stock_committed_at is null;
$$;

create or replace function app.order_json(p_order_id uuid, p_staff boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'orderNumber', o.order_number,
    'createdAt', o.created_at,
    'updatedAt', o.updated_at,
    'locale', o.locale,
    'status', o.status,
    'paymentMethod', o.payment_method,
    'paymentStatus', o.payment_status,
    'customer', jsonb_build_object('name', o.customer_name, 'phone', o.customer_phone,
                                   'phoneDisplay', o.customer_phone_display, 'email', o.customer_email),
    'fulfillment', jsonb_build_object(
      'method', o.fulfillment_method, 'pickupBranch', o.pickup_branch,
      'governorate', o.delivery_governorate, 'area', o.delivery_area, 'address', o.delivery_address,
      'notes', o.delivery_notes, 'eta', o.delivery_eta, 'courier', o.courier, 'trackingNumber', o.tracking_number),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'lineNo', i.line_no, 'productSlug', i.product_slug, 'productName', i.product_name,
        'brandName', i.brand_name, 'variantLabel', i.variant_label, 'options', i.options,
        'imageUrl', i.image_url, 'sku', i.sku, 'warranty', i.warranty,
        'regularUnitPrice', i.regular_unit_price, 'unitPrice', i.unit_price, 'quantity', i.quantity,
        'lineSubtotal', i.line_subtotal, 'discountAmount', i.discount_amount, 'lineTotal', i.line_total,
        'appliedOffer', i.applied_offer, 'discounts', i.discounts, 'isGift', i.is_gift) order by i.line_no)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'originalSubtotal', o.original_subtotal, 'subtotal', o.subtotal, 'discountTotal', o.discount_total,
      'shippingFee', o.shipping_fee, 'shippingFeeStatus', o.shipping_fee_status, 'total', o.total,
      'paidAmount', o.paid_amount, 'remainingAmount', o.remaining_amount,
      'splitDepositAmount', o.split_deposit_amount),
    'promoCode', o.promo_code,
    'customerNote', o.customer_note,
    'reservationExpiresAt', o.reservation_expires_at,
    'stockCommitted', o.stock_committed_at is not null,
    'reviewPending', o.manual_review_status = 'pending',
    'canCancel', app.order_can_customer_cancel(o),
    'cancelledAt', o.cancelled_at,
    'isDemo', o.is_demo,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'type', e.event_type, 'status', e.status, 'fromStatus', e.from_status, 'createdAt', e.created_at,
        'data', case when p_staff then e.data else e.data - 'reasons' end,
        'note', case when p_staff then e.note end, 'actorKind', e.actor_kind) order by e.id)
      from public.order_events e where e.order_id = o.id and (p_staff or e.visible_to_customer)), '[]'::jsonb))
  || case when p_staff then jsonb_build_object(
    'customerId', o.customer_id,
    'manualReview', jsonb_build_object('required', o.manual_review_required, 'status', o.manual_review_status,
                                       'reasons', to_jsonb(o.manual_review_reasons), 'reviewedAt', o.reviewed_at,
                                       'note', o.review_note),
    'staffNote', o.staff_note,
    'assignedStaffId', o.assigned_staff_id,
    'cancelReason', o.cancel_reason,
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'method', p.method, 'kind', p.kind, 'amount', p.amount, 'reference', p.reference,
        'note', p.note, 'verifiedBy', p.verified_by, 'verifiedAt', p.verified_at) order by p.verified_at)
      from public.payment_records p where p.order_id = o.id), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(jsonb_build_object(
        'variantId', r.variant_id, 'quantity', r.quantity,
        'status', case when r.status = 'active' and r.expires_at <= now() then 'expired' else r.status end,
        'expiresAt', r.expires_at) order by r.created_at)
      from public.stock_reservations r where r.order_id = o.id), '[]'::jsonb))
  else '{}'::jsonb end
  from public.orders o
  where o.id = p_order_id;
$$;

-- ── create_order ────────────────────────────────────────────────────────────
create or replace function public.create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_key           uuid;
  v_order_id      uuid;
  v_name          text := btrim(coalesce(p_payload -> 'contact' ->> 'name', ''));
  v_phone_raw     text := btrim(coalesce(p_payload -> 'contact' ->> 'phone', ''));
  v_phone         text;
  v_email         text;
  v_fulfillment   text := p_payload -> 'fulfillment' ->> 'method';
  v_branch        jsonb;
  v_governorate   text;
  v_area          text;
  v_address       text;
  v_delivery_note text;
  v_payment       text := p_payload -> 'payment' ->> 'method';
  v_deposit       numeric;
  v_promo_code    text := nullif(btrim(coalesce(p_payload ->> 'promoCode', '')), '');
  v_note          text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_locale        text := case when p_payload ->> 'locale' in ('ar', 'en') then p_payload ->> 'locale' else 'ar' end;
  v_methods       jsonb := app.commerce_config() -> 'paymentMethods';
  v_quote         jsonb;
  v_line          jsonb;
  v_expected      numeric;
  v_mismatch      boolean := false;
  v_totals        jsonb;
  v_items_total   numeric;
  v_reasons       text[];
  v_number        text;
  v_prefix        text;
  v_expires       timestamptz := now() + make_interval(mins => app.commerce_int('reservationMinutes', 30, 5, 1440));
  v_item_id       uuid;
  v_is_demo       boolean;
  v_payment_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth_required');
  end if;
  begin
    v_key := (p_payload ->> 'idempotencyKey')::uuid;
  exception when others then
    v_key := null;
  end;
  if v_key is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'idempotencyKey');
  end if;

  -- One checkout at a time per customer; a retry with the same key returns the same order.
  perform pg_advisory_xact_lock(hashtextextended('checkout:' || v_uid::text, 0));
  select id into v_order_id from public.orders where customer_id = v_uid and idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'order', app.order_json(v_order_id));
  end if;

  -- Contact
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'contact.name');
  end if;
  v_phone := app.normalize_egyptian_phone(v_phone_raw);
  if v_phone is null or v_phone !~ '^\+201[0125][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'contact.phone');
  end if;
  select email into v_email from auth.users where id = v_uid;

  -- Fulfillment
  if v_fulfillment = 'pickup' then
    select b into v_branch
      from public.site_settings s, jsonb_array_elements(s.value -> 'branches') b
      where s.key = 'store' and b ->> 'id' = coalesce(p_payload -> 'fulfillment' ->> 'branchId', b ->> 'id')
        and coalesce((b ->> 'pickupEnabled')::boolean, false)
      limit 1;
    if v_branch is null then
      return jsonb_build_object('ok', false, 'code', 'pickup_unavailable', 'field', 'fulfillment.branchId');
    end if;
    v_branch := jsonb_build_object('id', v_branch ->> 'id', 'name', v_branch -> 'name', 'address', v_branch -> 'address',
                                   'landmark', v_branch -> 'landmark', 'city', v_branch -> 'city',
                                   'phones', v_branch -> 'phones');
  elsif v_fulfillment = 'delivery' then
    v_governorate := lower(btrim(coalesce(p_payload -> 'fulfillment' ->> 'governorate', '')));
    v_area := btrim(coalesce(p_payload -> 'fulfillment' ->> 'area', ''));
    v_address := btrim(coalesce(p_payload -> 'fulfillment' ->> 'address', ''));
    v_delivery_note := nullif(btrim(coalesce(p_payload -> 'fulfillment' ->> 'notes', '')), '');
    if v_governorate !~ '^[a-z_]{2,40}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', 'fulfillment.governorate');
    elsif char_length(v_area) < 2 or char_length(v_area) > 120 then
      return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', 'fulfillment.area');
    elsif char_length(v_address) < 5 or char_length(v_address) > 400 then
      return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', 'fulfillment.address');
    elsif char_length(coalesce(v_delivery_note, '')) > 400 then
      return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', 'fulfillment.notes');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_fulfillment', 'field', 'fulfillment.method');
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'note');
  end if;

  -- Payment method
  if v_payment = 'pay_at_store' then
    if v_fulfillment <> 'pickup' or not app.feature_enabled('payAtStore') then
      return jsonb_build_object('ok', false, 'code', 'payment_method_unavailable', 'field', 'payment.method');
    end if;
  elsif v_payment is null or v_payment not in ('cod', 'instapay', 'split')
        or coalesce(v_methods ->> v_payment, 'true') <> 'true' then
    return jsonb_build_object('ok', false, 'code', 'payment_method_unavailable', 'field', 'payment.method');
  end if;

  -- Limit open (unconfirmed) orders so reservations can't be used to block stock.
  if (select count(*) from public.orders o
      where o.customer_id = v_uid and o.status in ('new', 'awaiting_whatsapp', 'awaiting_payment', 'payment_verification'))
     >= app.commerce_int('maxOpenOrdersPerCustomer', 3, 1, 50) then
    return jsonb_build_object('ok', false, 'code', 'too_many_open_orders');
  end if;

  -- Lock every variant involved (requested + possible free gifts), in id order.
  perform 1 from public.product_variants v
  where v.id in (
      select q.variant_id from app.quote_items(p_payload -> 'items') q
      union
      select coalesce(op.variant_id, dv.id)
      from public.offers o
      join public.offer_products op on op.offer_id = o.id and op.role = 'gift'
      left join public.product_variants dv on dv.product_id = op.product_id and op.variant_id is null
      where o.kind = 'free_gift' and app.offer_is_active(o))
  order by v.id
  for update of v;

  v_quote := app.build_quote(v_uid, p_payload -> 'items', v_promo_code, v_fulfillment);

  if jsonb_array_length(v_quote -> 'lines') = 0 then
    return jsonb_build_object('ok', false, 'code', 'cart_empty', 'quote', v_quote);
  end if;
  if not (v_quote ->> 'valid')::boolean then
    return jsonb_build_object('ok', false, 'code', 'cart_invalid', 'quote', v_quote);
  end if;
  if v_promo_code is not null and coalesce(v_quote -> 'promo' ->> 'status', '') <> 'applied' then
    return jsonb_build_object('ok', false, 'code', 'promo_invalid', 'quote', v_quote);
  end if;

  -- The customer must have seen exactly these prices; otherwise show the new ones and stop.
  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    continue when (v_line ->> 'isGift')::boolean;
    v_expected := (v_line ->> 'expectedUnitPrice')::numeric;
    if v_expected is null or v_expected <> (v_line ->> 'unitPrice')::numeric then
      v_mismatch := true;
    end if;
  end loop;
  v_totals := v_quote -> 'totals';
  v_expected := case when jsonb_typeof(p_payload -> 'expectedTotal') = 'number'
                     then (p_payload ->> 'expectedTotal')::numeric end;
  if v_mismatch or v_expected is null or v_expected <> (v_totals ->> 'total')::numeric then
    return jsonb_build_object('ok', false, 'code', 'price_changed', 'quote', v_quote);
  end if;

  v_items_total := (v_totals ->> 'subtotal')::numeric - (v_totals ->> 'discountTotal')::numeric;

  if v_payment = 'split' and jsonb_typeof(p_payload -> 'payment' -> 'depositAmount') = 'number' then
    v_deposit := round((p_payload -> 'payment' ->> 'depositAmount')::numeric, 2);
    if v_deposit <= 0 or v_deposit >= v_items_total then
      return jsonb_build_object('ok', false, 'code', 'invalid_deposit', 'field', 'payment.depositAmount');
    end if;
  end if;

  v_reasons := app.manual_review_reasons(v_uid, v_items_total, v_quote -> 'lines', v_payment);
  select bool_or(coalesce((l ->> 'isDemo')::boolean, false)) into v_is_demo
    from jsonb_array_elements(v_quote -> 'lines') l;

  v_payment_status := case v_payment
    when 'cod' then 'cod_pending'
    when 'instapay' then 'awaiting_payment'
    when 'split' then 'awaiting_deposit'
    else 'pay_at_store' end;

  v_prefix := left(coalesce(nullif(regexp_replace(upper(coalesce(app.commerce_config() ->> 'orderNumberPrefix', '')),
                                                  '[^A-Z]', '', 'g'), ''), 'MS'), 6);
  v_number := v_prefix || '-' || to_char(now() at time zone 'Africa/Cairo', 'YYYY') || '-'
              || lpad(nextval('public.order_number_seq')::text, 6, '0');

  begin
    insert into public.orders (
      order_number, customer_id, idempotency_key, locale,
      customer_name, customer_phone, customer_phone_display, customer_email,
      fulfillment_method, pickup_branch, delivery_governorate, delivery_area, delivery_address, delivery_notes,
      payment_method, payment_status, split_deposit_amount, status,
      original_subtotal, subtotal, discount_total, promo_code, shipping_fee, shipping_fee_status, total,
      manual_review_required, manual_review_reasons, manual_review_status,
      reservation_expires_at, customer_note, is_demo)
    values (
      v_number, v_uid, v_key, v_locale,
      v_name, v_phone, left(v_phone_raw, 30), v_email,
      v_fulfillment, v_branch, v_governorate, nullif(v_area, ''), nullif(v_address, ''), v_delivery_note,
      v_payment, v_payment_status, v_deposit, 'new',
      (v_totals ->> 'originalSubtotal')::numeric, (v_totals ->> 'subtotal')::numeric,
      (v_totals ->> 'discountTotal')::numeric,
      case when v_quote -> 'promo' ->> 'status' = 'applied' then v_quote -> 'promo' ->> 'code' end,
      (v_totals ->> 'shippingFee')::numeric, v_totals ->> 'shippingFeeStatus', (v_totals ->> 'total')::numeric,
      cardinality(v_reasons) > 0, v_reasons,
      case when cardinality(v_reasons) > 0 then 'pending' else 'not_required' end,
      v_expires, v_note, coalesce(v_is_demo, false))
    returning id into v_order_id;
  exception when unique_violation then
    select id into v_order_id from public.orders where customer_id = v_uid and idempotency_key = v_key;
    if v_order_id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'order', app.order_json(v_order_id));
    end if;
    raise;
  end;

  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    insert into public.order_items (
      order_id, line_no, product_id, variant_id, sku, product_slug, product_name, brand_name, variant_label,
      options, image_url, warranty, regular_unit_price, unit_price, quantity, line_subtotal, discount_amount,
      line_total, applied_offer, discounts, is_gift)
    values (
      v_order_id, (v_line ->> 'lineNo')::smallint, (v_line ->> 'productId')::uuid, (v_line ->> 'variantId')::uuid,
      v_line ->> 'sku', v_line ->> 'productSlug', (v_line -> 'name')::public.localized_text,
      nullif(v_line -> 'brand', 'null'::jsonb)::public.localized_text,
      nullif(v_line -> 'variantLabel', 'null'::jsonb)::public.localized_text,
      v_line -> 'options', v_line ->> 'image', nullif(v_line -> 'warranty', 'null'::jsonb)::public.localized_text,
      (v_line ->> 'regularUnitPrice')::numeric, (v_line ->> 'unitPrice')::numeric, (v_line ->> 'quantity')::integer,
      (v_line ->> 'lineSubtotal')::numeric, (v_line ->> 'discount')::numeric, (v_line ->> 'lineTotal')::numeric,
      nullif(v_line -> 'offer', 'null'::jsonb), v_line -> 'discounts', (v_line ->> 'isGift')::boolean)
    returning id into v_item_id;

    insert into public.stock_reservations (order_id, order_item_id, variant_id, quantity, expires_at, is_demo)
    values (v_order_id, v_item_id, (v_line ->> 'variantId')::uuid, (v_line ->> 'quantity')::integer, v_expires,
            coalesce(v_is_demo, false));
  end loop;

  if v_quote -> 'promo' ->> 'status' = 'applied' then
    insert into public.promo_redemptions (offer_id, order_id, customer_id, code, discount_amount, is_demo)
    values ((v_quote -> 'promo' ->> 'offerId')::uuid, v_order_id, v_uid, v_quote -> 'promo' ->> 'code',
            (v_quote -> 'promo' ->> 'discount')::numeric, coalesce(v_is_demo, false));
  end if;

  insert into public.order_events (order_id, event_type, status, data, visible_to_customer, actor_id, actor_kind)
  values (v_order_id, 'status', 'new', jsonb_build_object('total', (v_totals ->> 'total')::numeric), true, v_uid, 'customer');
  insert into public.order_events (order_id, event_type, data, visible_to_customer, actor_id, actor_kind)
  values (v_order_id, 'reservation', jsonb_build_object('action', 'reserved', 'expiresAt', v_expires), false, v_uid, 'system');
  if cardinality(v_reasons) > 0 then
    insert into public.order_events (order_id, event_type, status, data, visible_to_customer, actor_id, actor_kind)
    values (v_order_id, 'review', 'pending', jsonb_build_object('reasons', to_jsonb(v_reasons)), false, null, 'system');
  end if;

  -- Ordered lines leave the account cart; saved-for-later lines stay.
  delete from public.cart_items ci
  using public.carts c
  where ci.cart_id = c.id and c.customer_id = v_uid and not ci.saved_for_later
    and ci.variant_id in (select (l ->> 'variantId')::uuid from jsonb_array_elements(v_quote -> 'lines') l);

  -- Remember contact details for next time (never overwrite what the customer already set).
  update public.profiles
     set full_name = coalesce(full_name, v_name), phone = coalesce(phone, v_phone)
   where id = v_uid;

  perform app.log_event('order.created', 'order', v_order_id::text, null,
    jsonb_build_object('orderNumber', v_number, 'total', (v_totals ->> 'total')::numeric,
                       'paymentMethod', v_payment, 'fulfillment', v_fulfillment,
                       'manualReview', to_jsonb(v_reasons)));

  return jsonb_build_object('ok', true, 'duplicate', false, 'order', app.order_json(v_order_id));
end;
$$;

-- ── Customer order access (ownership enforced here AND by RLS) ──────────────
create or replace function public.get_my_order(p_order_number text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.order_json(o.id)
  from public.orders o
  where o.order_number = upper(btrim(p_order_number)) and o.customer_id = auth.uid();
$$;

create or replace function public.list_my_orders(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
  from (
    select o.created_at, jsonb_build_object(
      'orderNumber', o.order_number, 'createdAt', o.created_at, 'status', o.status,
      'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
      'fulfillmentMethod', o.fulfillment_method, 'shippingFeeStatus', o.shipping_fee_status,
      'total', o.total, 'remainingAmount', o.remaining_amount, 'isDemo', o.is_demo,
      'itemCount', (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id and not i.is_gift),
      'firstItem', (select jsonb_build_object('name', i.product_name, 'variantLabel', i.variant_label, 'imageUrl', i.image_url)
                    from public.order_items i where i.order_id = o.id order by i.line_no limit 1)) as j
    from public.orders o
    where o.customer_id = auth.uid()
    order by o.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ) x;
$$;

-- Shared cancellation: releases reservations (or restocks a committed sale), releases the promo.
create or replace function app.cancel_order_internal(p_order_id uuid, p_reason text, p_actor_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders%rowtype;
  v_res    record;
  v_after  integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.stock_committed_at is not null then
    for v_res in
      select r.* from public.stock_reservations r where r.order_id = p_order_id and r.status = 'committed'
      order by r.variant_id
    loop
      update public.product_variants set stock_quantity = stock_quantity + v_res.quantity
        where id = v_res.variant_id returning stock_quantity into v_after;
      insert into public.stock_movements (variant_id, delta, quantity_after, reason, order_id, actor_id, note, is_demo)
      values (v_res.variant_id, v_res.quantity, v_after, 'cancellation_restock', p_order_id,
              app.current_actor_id(), p_reason, v_order.is_demo);
    end loop;
    update public.stock_reservations set status = 'released', released_at = now(), release_reason = 'order_cancelled'
      where order_id = p_order_id and status = 'committed';
  end if;
  update public.stock_reservations set status = 'released', released_at = now(), release_reason = 'order_cancelled'
    where order_id = p_order_id and status in ('active', 'expired');
  update public.promo_redemptions set status = 'released', released_at = now()
    where order_id = p_order_id and status = 'active';
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500),
         reservation_expires_at = null,
         payment_status = case when paid_amount = 0 then 'void' else payment_status end
   where id = p_order_id;
  insert into public.order_events (order_id, event_type, status, from_status, data, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'status', 'cancelled', v_order.status, jsonb_build_object('restocked', v_order.stock_committed_at is not null),
          left(p_reason, 1000), true, app.current_actor_id(), p_actor_kind);
  perform app.log_event('order.cancelled', 'order', p_order_id::text,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('by', p_actor_kind, 'reason', p_reason));
end;
$$;

create or replace function public.cancel_my_order(p_order_number text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_customer();
  v_order  public.orders%rowtype;
begin
  select * into v_order from public.orders
   where order_number = upper(btrim(p_order_number)) and customer_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not app.order_can_customer_cancel(v_order) then
    return jsonb_build_object('ok', false, 'code', 'cannot_cancel', 'order', app.order_json(v_order.id));
  end if;
  perform app.cancel_order_internal(v_order.id, coalesce(nullif(btrim(p_reason), ''), 'customer_request'), 'customer');
  return jsonb_build_object('ok', true, 'order', app.order_json(v_order.id));
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.json_positive_int(jsonb), app.quote_items(jsonb), app.quote_line_add_discount(jsonb, integer, numeric, jsonb),
  app.variant_line_snapshot(uuid), app.offer_snapshot(uuid), app.build_quote(uuid, jsonb, text, text),
  app.cart_json(uuid), app.ensure_cart(uuid), app.order_review_rules(),
  app.manual_review_reasons(uuid, numeric, jsonb, text), app.order_json(uuid, boolean),
  app.cancel_order_internal(uuid, text, text)
  from public;
grant execute on function app.require_customer() to authenticated;

revoke all on function public.quote_checkout(jsonb, text, text), public.cart_get(), public.cart_merge(jsonb),
  public.cart_set_item(uuid, integer, boolean, numeric), public.create_order(jsonb), public.get_my_order(text),
  public.list_my_orders(integer), public.cancel_my_order(text, text)
  from public, anon;
grant execute on function public.quote_checkout(jsonb, text, text) to anon, authenticated;
grant execute on function public.cart_get(), public.cart_merge(jsonb), public.cart_set_item(uuid, integer, boolean, numeric),
  public.create_order(jsonb), public.get_my_order(text), public.list_my_orders(integer),
  public.cancel_my_order(text, text)
  to authenticated;
