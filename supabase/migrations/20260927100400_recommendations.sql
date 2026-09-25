-- ════════════════════════════════════════════════════════════════════════════
-- Phase 04 · Free, rule-based recommendations (no AI, no paid engine).
--
--   related          manual `similar` + `recommended` relations first, then same category
--                    ordered by closeness in price
--   accessories      manual `accessory` relations
--   compatible       explicit `compatible` relations in either direction (never guessed from names)
--   boughtTogether   manual `bought_together` relations first, then aggregates of REAL orders:
--                    delivered / completed, non-demo, non-gift lines, and only pairs bought by at
--                    least engagement.recommendations.minCustomers different customers (default 2).
--                    Only products are returned — never counts, customers or order data.
--   youMayAlsoLike   same category or brand within ±40 % of the price, not already shown
-- Demo-mode rankings are computed in the browser from demo orders and never reach live mode.
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists product_relations_audit on public.product_relations;
create trigger product_relations_audit after insert or update or delete on public.product_relations
  for each row execute function app.audit_row_change('product_id');

create or replace function app.bought_together_products(p_product uuid, p_limit integer)
returns table (product_id uuid, customers bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select other.product_id, count(distinct o.customer_id) as customers
  from public.order_items mine
  join public.orders o on o.id = mine.order_id
  join public.order_items other on other.order_id = o.id and other.product_id is not null
                                 and other.product_id <> p_product and not other.is_gift
  where mine.product_id = p_product and not mine.is_gift
    and o.status in ('delivered', 'completed') and not o.is_demo
  group by other.product_id
  having count(distinct o.customer_id) >= app.engagement_int('recommendations', 'minCustomers', 2, 2, 100)
  order by customers desc, other.product_id
  limit p_limit;
$$;

create or replace function public.product_recommendations(p_product_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_limit integer := app.engagement_int('recommendations', 'limit', 8, 2, 24);
  v_price numeric := null;
  v_category uuid;
  v_seen uuid[];
  v_related uuid[];
  v_accessories uuid[];
  v_compatible uuid[];
  v_manual_bt uuid[];
  v_orders_bt uuid[];
  v_like uuid[];
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then return null; end if;
  v_price := app.current_price(p.id);
  select pc.category_id into v_category from public.product_categories pc
   where pc.product_id = p.id order by pc.is_primary desc, pc.category_id limit 1;

  select coalesce(array_agg(r.related_product_id order by case r.kind when 'similar' then 0 else 1 end, r.sort_order), '{}')
    into v_related
  from public.product_relations r join public.products rp on rp.id = r.related_product_id
  where r.product_id = p.id and r.kind in ('similar', 'recommended') and r.status = 'approved' and app.product_is_visible(rp);

  if cardinality(v_related) < 4 and v_category is not null then
    v_related := v_related || coalesce((
      select array_agg(x.id order by x.gap, x.id) from (
        select op.id, abs(coalesce(app.current_price(op.id), 0) - coalesce(v_price, 0)) as gap
        from public.products op join public.product_categories pc on pc.product_id = op.id and pc.category_id = v_category
        where op.id <> p.id and op.id <> all (v_related) and app.product_is_visible(op)
          and op.availability_state = 'available'
        order by gap, op.id limit 4 - cardinality(v_related)) x), '{}');
  end if;

  select coalesce(array_agg(r.related_product_id order by r.sort_order), '{}') into v_accessories
  from public.product_relations r join public.products rp on rp.id = r.related_product_id
  where r.product_id = p.id and r.kind = 'accessory' and r.status = 'approved' and app.product_is_visible(rp);

  select coalesce(array_agg(distinct x.other), '{}') into v_compatible from (
    select r.related_product_id as other from public.product_relations r
    where r.product_id = p.id and r.kind = 'compatible' and r.status = 'approved'
    union
    select r.product_id from public.product_relations r
    where r.related_product_id = p.id and r.kind = 'compatible' and r.status = 'approved') x
  join public.products op on op.id = x.other
  where app.product_is_visible(op);

  select coalesce(array_agg(r.related_product_id order by r.sort_order), '{}') into v_manual_bt
  from public.product_relations r join public.products rp on rp.id = r.related_product_id
  where r.product_id = p.id and r.kind = 'bought_together' and r.status = 'approved' and app.product_is_visible(rp);

  select coalesce(array_agg(bt.product_id order by bt.customers desc, bt.product_id), '{}') into v_orders_bt
  from app.bought_together_products(p.id, v_limit) bt join public.products op on op.id = bt.product_id
  where app.product_is_visible(op) and bt.product_id <> all (v_manual_bt);

  v_seen := array[p.id] || v_related || v_accessories || v_compatible || v_manual_bt || v_orders_bt;
  select coalesce(array_agg(x.id order by x.same_category desc, x.gap, x.id), '{}') into v_like from (
    select op.id,
           exists (select 1 from public.product_categories pc where pc.product_id = op.id and pc.category_id = v_category) as same_category,
           abs(coalesce(app.current_price(op.id), 0) - coalesce(v_price, 0)) as gap
    from public.products op
    where op.id <> all (v_seen) and app.product_is_visible(op) and op.availability_state = 'available'
      and (op.brand_id = p.brand_id or exists (select 1 from public.product_categories pc
                                               where pc.product_id = op.id and pc.category_id = v_category))
      and (v_price is null or app.current_price(op.id) between v_price * 0.6 and v_price * 1.4)
    order by same_category desc, gap, op.id limit v_limit) x;

  return jsonb_build_object(
    'related', (select coalesce(jsonb_agg(app.product_summary(id) order by o), '[]'::jsonb)
                from unnest(v_related[1:v_limit]) with ordinality t(id, o)),
    'accessories', (select coalesce(jsonb_agg(app.product_summary(id) order by o), '[]'::jsonb)
                    from unnest(v_accessories[1:v_limit]) with ordinality t(id, o)),
    'compatible', (select coalesce(jsonb_agg(app.product_summary(id) order by o), '[]'::jsonb)
                   from unnest(v_compatible[1:v_limit]) with ordinality t(id, o)),
    'boughtTogether', (select coalesce(jsonb_agg(app.product_summary(id) order by o), '[]'::jsonb)
                       from unnest((v_manual_bt || v_orders_bt)[1:4]) with ordinality t(id, o)),
    'youMayAlsoLike', (select coalesce(jsonb_agg(app.product_summary(id) order by o), '[]'::jsonb)
                       from unnest(v_like) with ordinality t(id, o)));
end;
$$;

revoke all on function app.bought_together_products(uuid, integer) from public, anon, authenticated;
revoke all on function public.product_recommendations(text) from public;
grant execute on function public.product_recommendations(text) to anon, authenticated, service_role;
