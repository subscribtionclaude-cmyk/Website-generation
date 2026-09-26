-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 06 · Dashboard, analytics, exports, backup and product import
--   Built-in aggregates only (no external analytics). Demo rows are excluded unless asked for.
--   Exports return plain rows — the browser builds CSV/JSON and neutralises spreadsheet formulas.
--   Imports are two-step: preview (validated, stored, nothing changed) → confirm (all-or-nothing,
--   or explicitly "valid rows only"); price and stock changes keep their history.
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists service_requests_created_idx on public.service_requests (created_at desc);

-- ── Dashboard ───────────────────────────────────────────────────────────────
-- Each block is returned only when the caller may see it (null otherwise).
create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz, p_include_demo boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('dashboard.view');
  v_orders jsonb;
  v_stock jsonb;
  v_services jsonb := '{}'::jsonb;
  v_kind text;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if app.has_permission('orders.view') then
    select jsonb_build_object(
      'count', count(*) filter (where o.status <> 'cancelled'),
      'revenue', coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0),
      'paid', coalesce(sum(o.paid_amount) filter (where o.status <> 'cancelled'), 0),
      'averageOrderValue', coalesce(round(avg(o.total) filter (where o.status <> 'cancelled'), 2), 0),
      'cancelled', count(*) filter (where o.status = 'cancelled'),
      'demoExcluded', (select count(*) from public.orders d where d.is_demo and not p_include_demo
                       and d.created_at >= p_from and d.created_at < p_to))
      into v_orders
    from public.orders o
    where o.created_at >= p_from and o.created_at < p_to and (p_include_demo or not o.is_demo);
    v_orders := v_orders || jsonb_build_object(
      'pendingVerification', (select count(*) from public.orders o where o.payment_status = 'verification_pending'
                              and o.status <> 'cancelled' and (p_include_demo or not o.is_demo)),
      'manualReview', (select count(*) from public.orders o where o.manual_review_status = 'pending'
                       and o.status <> 'cancelled' and (p_include_demo or not o.is_demo)),
      'open', (select count(*) from public.orders o where o.status not in ('completed', 'cancelled', 'delivered')
               and (p_include_demo or not o.is_demo)));
  end if;
  if app.has_any_permission(array['inventory.manage', 'catalog.view']) then
    select jsonb_build_object(
      'low', count(*) filter (where v.is_active and app.variant_available_quantity(v.id) > 0
                              and app.variant_available_quantity(v.id) <= v.low_stock_threshold),
      'out', count(*) filter (where v.is_active and app.variant_available_quantity(v.id) <= 0))
      into v_stock
    from public.product_variants v join public.products p on p.id = v.product_id and p.deleted_at is null
    where v.deleted_at is null and p.status = 'published' and (p_include_demo or not v.is_demo);
  end if;
  foreach v_kind in array array['repair', 'trade_in', 'used', 'after_sales'] loop
    if app.has_permission(app.service_permission(v_kind, 'view')) then
      v_services := v_services || jsonb_build_object(v_kind, jsonb_build_object(
        'open', (select count(*) from public.service_requests r where r.kind = v_kind
                 and not app.service_status_terminal(r.status) and (p_include_demo or not r.is_demo)),
        'overdue', (select count(*) from public.service_requests r where r.kind = v_kind
                    and app.service_sla_state(r) = 'overdue' and (p_include_demo or not r.is_demo)),
        'created', (select count(*) from public.service_requests r where r.kind = v_kind
                    and r.created_at >= p_from and r.created_at < p_to and (p_include_demo or not r.is_demo))));
    end if;
  end loop;
  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to), 'includeDemo', p_include_demo,
    'orders', v_orders, 'stock', v_stock,
    'services', case when v_services = '{}'::jsonb then null else v_services end,
    'reviews', case when app.has_permission('reviews.moderate') then jsonb_build_object(
      'pending', (select count(*) from public.product_reviews r where r.status = 'pending' and (p_include_demo or not r.is_demo))) end,
    'requests', case when app.has_permission('waitlists.manage') then jsonb_build_object(
      'notify', (select count(*) from public.stock_notifications s where s.status = 'active'),
      'waitlist', (select count(*) from public.waitlist_entries w where w.status = 'active')) end,
    'carts', case when app.has_permission('customers.view') then jsonb_build_object(
      'abandoned', (select count(*) from public.carts c where app.cart_is_abandoned(c.customer_id))) end,
    'activity', case when app.has_permission('audit.view') then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'occurredAt', a.occurred_at, 'action', a.action,
                                          'entityType', a.entity_type, 'entityId', a.entity_id,
                                          'module', app.audit_module(a.entity_type, a.action),
                                          'actorName', (select coalesce(nullif(p.full_name, ''), p.email)
                                                        from public.profiles p where p.id = a.actor_id))
                       order by a.occurred_at desc)
      from (select * from public.audit_logs order by occurred_at desc, id desc limit 10) a), '[]'::jsonb) end);
end;
$$;

-- ── Analytics (aggregates only — no customer identities) ────────────────────
create or replace function public.admin_analytics(p_from timestamptz, p_to timestamptz, p_include_demo boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('analytics.view');
  v_totals jsonb;
  v_orders_in_range integer;
  v_carts integer;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  select jsonb_build_object(
      'orders', count(*) filter (where o.status <> 'cancelled'),
      'revenue', coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0),
      'paid', coalesce(sum(o.paid_amount) filter (where o.status <> 'cancelled'), 0),
      'averageOrderValue', coalesce(round(avg(o.total) filter (where o.status <> 'cancelled'), 2), 0),
      'cancelled', count(*) filter (where o.status = 'cancelled'),
      'itemsSold', coalesce((select sum(i.quantity) from public.order_items i join public.orders x on x.id = i.order_id
                             where x.created_at >= p_from and x.created_at < p_to and x.status <> 'cancelled'
                               and (p_include_demo or not x.is_demo)), 0),
      'customers', count(distinct o.customer_id) filter (where o.status <> 'cancelled'))
    into v_totals
  from public.orders o
  where o.created_at >= p_from and o.created_at < p_to and (p_include_demo or not o.is_demo);
  v_orders_in_range := (v_totals ->> 'orders')::integer;
  -- Conversion (honest, signed-in only): customers with an order ÷ customers whose cart was active.
  select count(distinct c.customer_id) into v_carts
  from public.carts c where c.updated_at >= p_from and c.updated_at < p_to
     or exists (select 1 from public.cart_items ci where ci.cart_id = c.id and ci.updated_at >= p_from and ci.updated_at < p_to);
  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to), 'includeDemo', p_include_demo,
    'totals', v_totals || jsonb_build_object(
      'activeCarts', v_carts,
      'conversion', case when v_carts > 0 then round((v_totals ->> 'customers')::numeric / v_carts, 4) end),
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue)
                                        order by d.day)
      from (select (o.created_at at time zone 'Africa/Cairo')::date as day, count(*) as orders, sum(o.total) as revenue
            from public.orders o
            where o.created_at >= p_from and o.created_at < p_to and o.status <> 'cancelled'
              and (p_include_demo or not o.is_demo)
            group by 1) d), '[]'::jsonb),
    'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (
        select o.status, count(*) as n from public.orders o
        where o.created_at >= p_from and o.created_at < p_to and (p_include_demo or not o.is_demo) group by o.status) s), '{}'::jsonb),
    'byPayment', coalesce((select jsonb_object_agg(s.method, s.n) from (
        select o.payment_method as method, count(*) as n from public.orders o
        where o.created_at >= p_from and o.created_at < p_to and o.status <> 'cancelled'
          and (p_include_demo or not o.is_demo) group by o.payment_method) s), '{}'::jsonb),
    'bestSellers', coalesce((select jsonb_agg(b order by (b ->> 'quantity')::integer desc, b ->> 'slug') from (
        select jsonb_build_object('productId', i.product_id, 'slug', i.product_slug, 'name', i.product_name,
                                  'quantity', sum(i.quantity), 'revenue', sum(i.line_total)) as b
        from public.order_items i join public.orders o on o.id = i.order_id
        where o.created_at >= p_from and o.created_at < p_to and o.status <> 'cancelled' and not i.is_gift
          and (p_include_demo or not o.is_demo)
        group by i.product_id, i.product_slug, i.product_name
        order by sum(i.quantity) desc limit 10) x), '[]'::jsonb),
    'repeatCustomers', jsonb_build_object(
      'customers', (select count(*) from (
          select o.customer_id from public.orders o
          where o.status <> 'cancelled' and (p_include_demo or not o.is_demo)
            and o.customer_id in (select x.customer_id from public.orders x where x.created_at >= p_from
                                    and x.created_at < p_to and x.status <> 'cancelled' and (p_include_demo or not x.is_demo))
          group by o.customer_id having count(*) >= 2) r),
      'ofCustomers', (v_totals ->> 'customers')::integer),
    'services', (select jsonb_object_agg(k.kind, jsonb_build_object(
        'created', (select count(*) from public.service_requests r where r.kind = k.kind and r.created_at >= p_from
                    and r.created_at < p_to and (p_include_demo or not r.is_demo)),
        'completed', (select count(*) from public.service_requests r where r.kind = k.kind and r.status = 'completed'
                      and r.updated_at >= p_from and r.updated_at < p_to and (p_include_demo or not r.is_demo)),
        'open', (select count(*) from public.service_requests r where r.kind = k.kind
                 and not app.service_status_terminal(r.status) and (p_include_demo or not r.is_demo))))
      from (values ('repair'), ('trade_in'), ('used'), ('after_sales')) as k (kind)),
    'stock', (select jsonb_build_object(
        'low', count(*) filter (where v.is_active and app.variant_available_quantity(v.id) > 0
                                and app.variant_available_quantity(v.id) <= v.low_stock_threshold),
        'out', count(*) filter (where v.is_active and app.variant_available_quantity(v.id) <= 0))
      from public.product_variants v join public.products p on p.id = v.product_id and p.deleted_at is null
      where v.deleted_at is null and p.status = 'published' and (p_include_demo or not v.is_demo)),
    'abandonedCarts', (select count(*) from public.carts c where app.cart_is_abandoned(c.customer_id)));
end;
$$;

-- ── Exports ─────────────────────────────────────────────────────────────────
create or replace function public.admin_export(p_kind text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('reports.export');
  v_include_demo boolean := coalesce((p_filter ->> 'includeDemo')::boolean, true);
  v_rows jsonb;
begin
  case p_kind
    when 'products' then
      perform app.require_permission('catalog.view');
      select coalesce(jsonb_agg(jsonb_build_object(
          'slug', p.slug, 'name_ar', p.name ->> 'ar', 'name_en', p.name ->> 'en',
          'brand', (select b.slug from public.brands b where b.id = p.brand_id),
          'category', (select c.slug from public.product_categories pc join public.categories c on c.id = pc.category_id
                       where pc.product_id = p.id order by pc.is_primary desc limit 1),
          'status', p.status, 'visible', p.is_visible, 'availability', p.availability_state,
          'variants', (select count(*) from public.product_variants v where v.product_id = p.id and v.deleted_at is null),
          'is_demo', p.is_demo, 'updated_at', p.updated_at) order by p.slug), '[]'::jsonb) into v_rows
      from public.products p where p.deleted_at is null and (v_include_demo or not p.is_demo);
    when 'variants', 'prices', 'stock', 'catalog' then
      perform app.require_permission('catalog.view');
      select coalesce(jsonb_agg(jsonb_build_object(
          'product_slug', p.slug, 'product_name_ar', p.name ->> 'ar', 'product_name_en', p.name ->> 'en',
          'brand', (select b.slug from public.brands b where b.id = p.brand_id),
          'category', (select c.slug from public.product_categories pc join public.categories c on c.id = pc.category_id
                       where pc.product_id = p.id order by pc.is_primary desc limit 1),
          'sku', v.sku, 'barcode', v.barcode,
          'storage', (select ov.key from public.variant_option_values vov join public.product_options o on o.id = vov.option_id
                      join public.product_option_values ov on ov.id = vov.option_value_id
                      where vov.variant_id = v.id and o.key = 'storage'),
          'color', (select ov.label ->> 'en' from public.variant_option_values vov join public.product_options o on o.id = vov.option_id
                    join public.product_option_values ov on ov.id = vov.option_value_id
                    where vov.variant_id = v.id and o.key = 'color'),
          'price', v.price, 'compare_at_price', v.compare_at_price, 'stock', v.stock_quantity,
          'reserved', app.variant_reserved_quantity(v.id, null), 'available', app.variant_available_quantity(v.id),
          'low_stock_threshold', v.low_stock_threshold, 'active', v.is_active, 'is_demo', v.is_demo)
          order by p.slug, v.sort_order), '[]'::jsonb) into v_rows
      from public.product_variants v join public.products p on p.id = v.product_id and p.deleted_at is null
      where v.deleted_at is null and (v_include_demo or not v.is_demo);
    when 'orders' then
      perform app.require_permission('orders.view');
      select coalesce(jsonb_agg(jsonb_build_object(
          'order_number', o.order_number, 'created_at', o.created_at, 'status', o.status,
          'payment_method', o.payment_method, 'payment_status', o.payment_status, 'fulfillment', o.fulfillment_method,
          'customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'subtotal', o.subtotal,
          'discount', o.discount_total, 'shipping_fee', o.shipping_fee, 'total', o.total, 'paid', o.paid_amount,
          'remaining', o.remaining_amount, 'is_demo', o.is_demo) order by o.created_at desc), '[]'::jsonb) into v_rows
      from (select * from public.orders where (v_include_demo or not is_demo)
              and (nullif(p_filter ->> 'from', '') is null or created_at >= (p_filter ->> 'from')::timestamptz)
              and (nullif(p_filter ->> 'to', '') is null or created_at < (p_filter ->> 'to')::timestamptz)
            order by created_at desc limit 10000) o;
    when 'customers' then
      perform app.require_permission('customers.view');
      select coalesce(jsonb_agg(jsonb_build_object(
          'name', p.full_name, 'email', p.email, 'phone', p.phone, 'joined_at', p.created_at) || app.customer_stats(p.id)
          order by p.created_at desc), '[]'::jsonb) into v_rows
      from (select * from public.profiles pr where pr.deleted_at is null
              and not exists (select 1 from public.user_roles ur where ur.user_id = pr.id)
            order by pr.created_at desc limit 10000) p;
    when 'repair', 'trade_in', 'used', 'after_sales' then
      perform app.require_permission(app.service_permission(p_kind, 'view'));
      select coalesce(jsonb_agg(jsonb_build_object(
          'number', r.request_number, 'created_at', r.created_at, 'status', r.status, 'priority', r.priority,
          'contact_name', r.contact_name, 'contact_phone', r.contact_phone, 'device_category', r.device_category,
          'brand', r.brand, 'model', r.model, 'after_sales_type', r.after_sales_type, 'sla', app.service_sla_state(r),
          'is_demo', r.is_demo) order by r.created_at desc), '[]'::jsonb) into v_rows
      from (select * from public.service_requests where kind = p_kind and (v_include_demo or not is_demo)
            order by created_at desc limit 10000) r;
    when 'price_history' then
      perform app.require_any_permission(array['pricing.manage', 'catalog.view']);
      select coalesce(jsonb_agg(jsonb_build_object(
          'created_at', h.created_at, 'sku', v.sku, 'old_price', h.old_price, 'new_price', h.new_price,
          'old_compare_at', h.old_compare_at, 'new_compare_at', h.new_compare_at, 'reason', h.reason, 'source', h.source,
          'actor', (select pr.email from public.profiles pr where pr.id = h.actor_id)) order by h.created_at desc), '[]'::jsonb)
        into v_rows
      from (select * from public.price_history where (v_include_demo or not is_demo) order by created_at desc limit 10000) h
      join public.product_variants v on v.id = h.variant_id;
    when 'stock_movements' then
      perform app.require_any_permission(array['inventory.manage', 'catalog.view']);
      select coalesce(jsonb_agg(jsonb_build_object(
          'created_at', m.created_at, 'sku', v.sku, 'type', m.reason,
          'before', coalesce(m.quantity_before, m.quantity_after - m.delta), 'change', m.delta, 'after', m.quantity_after,
          'reason', m.note, 'order_number', (select o.order_number from public.orders o where o.id = m.order_id),
          'actor', (select pr.email from public.profiles pr where pr.id = m.actor_id)) order by m.created_at desc), '[]'::jsonb)
        into v_rows
      from (select * from public.stock_movements where (v_include_demo or not is_demo) order by created_at desc limit 10000) m
      join public.product_variants v on v.id = m.variant_id;
    else
      raise exception 'unknown_export' using errcode = '22023';
  end case;
  perform app.log_event('export.' || p_kind, 'export', p_kind, null, null,
                        jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return jsonb_build_object('kind', p_kind, 'generatedAt', now(), 'rows', v_rows);
end;
$$;

-- Configuration + catalog + content backup (no customer data, no secrets, no auth).
create or replace function public.admin_export_backup()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('data.backup');
begin
  perform app.log_event('data.backup_exported', 'backup', null, null, null, '{}'::jsonb);
  return jsonb_build_object(
    'format', 'malek-store-backup', 'version', 1, 'generatedAt', now(),
    'note', 'Configuration, catalog and content export. It does not replace your database provider backups and contains no customer, order or authentication data.',
    'settings', coalesce((select jsonb_object_agg(s.key, jsonb_build_object('version', s.version, 'value', s.value))
                          from public.site_settings s where s.key <> 'security'), '{}'::jsonb),
    'brands', coalesce((select jsonb_agg(to_jsonb(b) order by b.slug) from public.brands b where b.deleted_at is null), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.slug) from public.categories c where c.deleted_at is null), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_set(x.doc, '{variants}', (
                              select coalesce(jsonb_agg(v - 'lastPriceChange' - 'reserved' - 'available'), '[]'::jsonb)
                              from jsonb_array_elements(x.doc -> 'variants') v)) order by x.doc ->> 'slug')
                          from (select app.admin_product_json(p.id) as doc from public.products p where p.deleted_at is null) x),
                         '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(app.admin_offer_json(o.id) order by o.slug)
                        from public.offers o where o.deleted_at is null), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(app.admin_entry_json(e.id) order by e.slug)
                         from public.content_entries e where e.deleted_at is null), '[]'::jsonb),
    'pageSections', coalesce((select jsonb_agg(jsonb_build_object('pageKey', s.page_key, 'key', s.key, 'type', s.type,
                                                                  'sortOrder', s.sort_order, 'isVisible', s.is_visible,
                                                                  'props', s.props) order by s.page_key, s.sort_order)
                              from public.page_sections s), '[]'::jsonb),
    'notificationTemplates', coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'category', t.category,
                                                                           'title', t.title, 'body', t.body,
                                                                           'isActive', t.is_active) order by t.key)
                                       from public.notification_templates t), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'rank', r.rank, 'grantsAll', r.grants_all,
                                                           'permissions', (select coalesce(jsonb_agg(rp.permission_key order by rp.permission_key), '[]'::jsonb)
                                                                           from public.role_permissions rp where rp.role_id = r.id))
                                        order by r.rank desc)
                       from public.roles r where r.deleted_at is null), '[]'::jsonb));
end;
$$;

-- ── Product import ──────────────────────────────────────────────────────────
create table if not exists public.import_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'products' check (kind in ('products')),
  file_name     text check (file_name is null or char_length(file_name) <= 200),
  status        text not null default 'previewed' check (status in ('previewed', 'committed', 'failed', 'cancelled')),
  row_count     integer not null default 0,
  summary       jsonb not null default '{}'::jsonb,
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz
);

create table if not exists public.import_rows (
  job_id   uuid not null references public.import_jobs (id) on delete cascade,
  row_no   integer not null,
  action   text not null check (action in ('create_product', 'create_variant', 'update', 'error')),
  data     jsonb not null,
  errors   jsonb not null default '[]'::jsonb,
  primary key (job_id, row_no)
);

alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
revoke all on public.import_jobs, public.import_rows from anon, authenticated;

drop trigger if exists import_jobs_audit on public.import_jobs;
create trigger import_jobs_audit after insert or update on public.import_jobs
  for each row execute function app.audit_row_change();

-- Canonical option keys from spreadsheet text.
create or replace function app.import_storage_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or btrim(p_value) = '' then null
              when upper(regexp_replace(p_value, '\s', '', 'g')) ~ '^[0-9]{1,4}(GB|TB)$'
                then lower(upper(regexp_replace(p_value, '\s', '', 'g')))
              else '!invalid' end;
$$;

create or replace function app.import_color_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or btrim(p_value) = '' then null
              else nullif(left(trim(both '-' from regexp_replace(lower(btrim(p_value)), '[^a-z0-9]+', '-', 'g')), 40), '') end;
$$;

-- Validate one mapped row. Returns {action, errors[], normalized}.
create or replace function app.import_validate_row(p_row jsonb, p_seen_skus text[], p_new_slugs text[] default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_sku text := upper(btrim(coalesce(p_row ->> 'sku', '')));
  v_slug text := lower(btrim(coalesce(p_row ->> 'productSlug', '')));
  v_price numeric := app.json_numeric(p_row -> 'price');
  v_compare numeric := app.json_numeric(p_row -> 'compareAtPrice');
  v_stock_text text := nullif(btrim(coalesce(p_row ->> 'stock', '')), '');
  v_variant public.product_variants;
  v_product public.products;
  v_brand uuid;
  v_category uuid;
  v_storage text := app.import_storage_key(p_row ->> 'storage');
  v_color text := app.import_color_key(p_row ->> 'color');
  v_action text;
begin
  -- Spreadsheet formulas are never evaluated; a leading = in any key field is rejected.
  if exists (select 1 from jsonb_each_text(p_row) e where e.value ~ '^\s*[=+@]' and e.key in ('sku', 'productSlug', 'brand', 'category')) then
    v_errors := array_append(v_errors, 'formula_not_allowed');
  end if;
  if v_sku !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$' then v_errors := array_append(v_errors, 'invalid_sku'); end if;
  if v_sku = any (p_seen_skus) then v_errors := array_append(v_errors, 'duplicate_in_file'); end if;
  if v_price = 'NaN'::numeric or v_price < 0 or v_price > 10000000 then v_errors := array_append(v_errors, 'invalid_price'); end if;
  if v_compare = 'NaN'::numeric or v_compare < 0 or (v_compare is not null and v_price is not null and v_compare <= v_price) then
    v_errors := array_append(v_errors, 'invalid_compare_at');
  end if;
  if v_stock_text is not null and (v_stock_text !~ '^[0-9]{1,6}$') then v_errors := array_append(v_errors, 'invalid_stock'); end if;
  if v_storage = '!invalid' then v_errors := array_append(v_errors, 'invalid_storage'); end if;

  select * into v_variant from public.product_variants where sku = v_sku and deleted_at is null;
  if found then
    v_action := 'update';
    select * into v_product from public.products where id = v_variant.product_id;
    if v_slug <> '' and v_slug <> v_product.slug then v_errors := array_append(v_errors, 'sku_belongs_to_other_product'); end if;
    if nullif(p_row ->> 'price', '') is not null and v_price is distinct from v_variant.price and not app.has_permission('pricing.manage') then
      v_errors := array_append(v_errors, 'pricing_forbidden');
    end if;
    if v_stock_text is not null and v_stock_text::integer <> v_variant.stock_quantity and not app.has_permission('inventory.manage') then
      v_errors := array_append(v_errors, 'inventory_forbidden');
    end if;
    if v_stock_text is not null and v_stock_text ~ '^[0-9]{1,6}$'
       and v_stock_text::integer < app.variant_reserved_quantity(v_variant.id, null) then
      v_errors := array_append(v_errors, 'below_reserved');
    end if;
  else
    if v_slug !~ '^[a-z0-9-]{1,80}$' then v_errors := array_append(v_errors, 'invalid_slug'); end if;
    if v_price is null then v_errors := array_append(v_errors, 'price_required'); end if;
    if not app.has_permission('pricing.manage') and v_price is not null then v_errors := array_append(v_errors, 'pricing_forbidden'); end if;
    if coalesce(v_stock_text, '0') <> '0' and not app.has_permission('inventory.manage') then
      v_errors := array_append(v_errors, 'inventory_forbidden');
    end if;
    if exists (select 1 from public.product_variants where sku = v_sku and deleted_at is not null) then
      v_errors := array_append(v_errors, 'sku_retired');
    end if;
    select * into v_product from public.products where slug = v_slug and deleted_at is null;
    if not found and v_slug = any (p_new_slugs) then
      -- Another variant of a product created by an earlier row of the same file.
      v_action := 'create_variant';
    elsif found then
      v_action := 'create_variant';
      -- New variant of an existing product: its option set must match the row.
      if (v_storage is null) <> not exists (select 1 from public.product_options where product_id = v_product.id and key = 'storage')
         or (v_color is null) <> not exists (select 1 from public.product_options where product_id = v_product.id and key = 'color')
         or exists (select 1 from public.product_options where product_id = v_product.id and key not in ('storage', 'color')) then
        v_errors := array_append(v_errors, 'options_mismatch');
      end if;
    else
      v_action := 'create_product';
      if char_length(btrim(coalesce(p_row ->> 'nameAr', ''))) = 0 then v_errors := array_append(v_errors, 'name_required'); end if;
      select id into v_brand from public.brands
      where deleted_at is null and (slug = lower(btrim(coalesce(p_row ->> 'brand', '')))
             or lower(name ->> 'en') = lower(btrim(coalesce(p_row ->> 'brand', '')))
             or name ->> 'ar' = btrim(coalesce(p_row ->> 'brand', '')))
      limit 1;
      if v_brand is null then v_errors := array_append(v_errors, 'unknown_brand'); end if;
      select id into v_category from public.categories
      where deleted_at is null and (slug = lower(btrim(coalesce(p_row ->> 'category', '')))
             or lower(name ->> 'en') = lower(btrim(coalesce(p_row ->> 'category', '')))
             or name ->> 'ar' = btrim(coalesce(p_row ->> 'category', '')))
      limit 1;
      if v_category is null then v_errors := array_append(v_errors, 'unknown_category'); end if;
    end if;
  end if;
  return jsonb_build_object(
    'action', case when cardinality(v_errors) > 0 then 'error' else v_action end,
    'errors', to_jsonb(v_errors),
    'data', jsonb_build_object(
      'sku', v_sku, 'productSlug', coalesce(nullif(v_slug, ''), v_product.slug),
      'nameAr', nullif(btrim(coalesce(p_row ->> 'nameAr', '')), ''), 'nameEn', nullif(btrim(coalesce(p_row ->> 'nameEn', '')), ''),
      'brandId', v_brand, 'categoryId', v_category,
      'price', case when v_price = 'NaN'::numeric then null else v_price end,
      'compareAtPrice', case when v_compare = 'NaN'::numeric then null else v_compare end,
      'stock', case when v_stock_text ~ '^[0-9]{1,6}$' then v_stock_text::integer end,
      'storage', case when v_storage = '!invalid' then null else v_storage end, 'storageLabel', nullif(btrim(coalesce(p_row ->> 'storage', '')), ''),
      'color', v_color, 'colorLabel', nullif(btrim(coalesce(p_row ->> 'color', '')), ''),
      'colorHex', case when coalesce(p_row ->> 'colorHex', '') ~ '^#[0-9a-fA-F]{6}$' then p_row ->> 'colorHex' end,
      'lowStockThreshold', case when coalesce(p_row ->> 'lowStockThreshold', '') ~ '^[0-9]{1,4}$' then (p_row ->> 'lowStockThreshold')::integer end,
      'variantId', v_variant.id, 'productId', v_product.id,
      'currentPrice', v_variant.price, 'currentStock', v_variant.stock_quantity));
end;
$$;

create or replace function public.admin_import_preview(p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('data.import');
  v_job uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_result jsonb;
  v_seen text[] := '{}';
  v_new_slugs text[] := '{}';
  v_counts jsonb;
begin
  if not app.has_permission('catalog.manage') then raise exception 'permission denied: catalog.manage' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_file');
  end if;
  if jsonb_array_length(p_rows) > 2000 then return jsonb_build_object('ok', false, 'code', 'too_many_rows'); end if;
  insert into public.import_jobs (file_name, row_count, created_by)
  values (left(p_file_name, 200), jsonb_array_length(p_rows), v_uid) returning id into v_job;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_row) <> 'object' then
      insert into public.import_rows (job_id, row_no, action, data, errors)
      values (v_job, v_idx, 'error', '{}'::jsonb, '["invalid_row"]'::jsonb);
      continue;
    end if;
    v_result := app.import_validate_row(v_row, v_seen, v_new_slugs);
    v_seen := v_seen || upper(btrim(coalesce(v_row ->> 'sku', '')));
    if v_result ->> 'action' = 'create_product' then
      v_new_slugs := v_new_slugs || (v_result -> 'data' ->> 'productSlug');
    end if;
    insert into public.import_rows (job_id, row_no, action, data, errors)
    values (v_job, v_idx, v_result ->> 'action', v_result -> 'data', v_result -> 'errors');
  end loop;
  select jsonb_build_object(
    'total', count(*), 'createProduct', count(*) filter (where action = 'create_product'),
    'createVariant', count(*) filter (where action = 'create_variant'),
    'update', count(*) filter (where action = 'update'), 'errors', count(*) filter (where action = 'error'))
    into v_counts from public.import_rows where job_id = v_job;
  update public.import_jobs set summary = v_counts where id = v_job;
  return jsonb_build_object('ok', true, 'jobId', v_job, 'summary', v_counts,
    'rows', (select jsonb_agg(jsonb_build_object('rowNo', r.row_no, 'action', r.action, 'data', r.data, 'errors', r.errors)
                              order by r.row_no) from public.import_rows r where r.job_id = v_job));
end;
$$;

-- Apply a previewed job. p_valid_only = false: refuse if any row has errors (nothing changes).
-- The whole application runs in one sub-transaction: any failure rolls every row back.
create or replace function public.admin_import_commit(p_job_id uuid, p_valid_only boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('data.import');
  v_job public.import_jobs;
  v_row public.import_rows;
  v_check jsonb;
  v_seen text[] := '{}';
  v_product uuid;
  v_variant uuid;
  v_option uuid;
  v_before integer;
  v_applied integer := 0;
  v_error text;
  d jsonb;
begin
  if not app.has_permission('catalog.manage') then raise exception 'permission denied: catalog.manage' using errcode = '42501'; end if;
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_job.status <> 'previewed' then return jsonb_build_object('ok', false, 'code', 'already_' || v_job.status); end if;
  if v_job.created_at < now() - interval '1 hour' then
    update public.import_jobs set status = 'cancelled', error = 'expired' where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if not p_valid_only and exists (select 1 from public.import_rows where job_id = p_job_id and action = 'error') then
    return jsonb_build_object('ok', false, 'code', 'has_errors');
  end if;

  begin
    perform app.set_change_context('Import: ' || coalesce(v_job.file_name, p_job_id::text), 'import');
    for v_row in select * from public.import_rows where job_id = p_job_id and action <> 'error' order by row_no loop
      -- Re-validate against the current catalog (something may have changed since the preview).
      v_check := app.import_validate_row(
        jsonb_build_object('sku', v_row.data ->> 'sku', 'productSlug', v_row.data ->> 'productSlug',
                           'nameAr', v_row.data ->> 'nameAr', 'nameEn', v_row.data ->> 'nameEn',
                           'brand', (select slug from public.brands where id = nullif(v_row.data ->> 'brandId', '')::uuid),
                           'category', (select slug from public.categories where id = nullif(v_row.data ->> 'categoryId', '')::uuid),
                           'price', v_row.data -> 'price', 'compareAtPrice', v_row.data -> 'compareAtPrice',
                           'stock', v_row.data ->> 'stock', 'storage', v_row.data ->> 'storageLabel',
                           'color', v_row.data ->> 'colorLabel', 'colorHex', v_row.data ->> 'colorHex',
                           'lowStockThreshold', v_row.data ->> 'lowStockThreshold'), v_seen);
      v_seen := v_seen || (v_row.data ->> 'sku');
      if v_check ->> 'action' = 'error' then
        raise exception 'row %: %', v_row.row_no, v_check -> 'errors' using errcode = 'P0001';
      end if;
      d := v_check -> 'data';
      if v_check ->> 'action' = 'create_product' then
        insert into public.products (slug, brand_id, name, status, availability_state)
        values (d ->> 'productSlug', (d ->> 'brandId')::uuid,
                jsonb_build_object('ar', d ->> 'nameAr', 'en', coalesce(d ->> 'nameEn', d ->> 'nameAr'))::public.localized_text,
                'draft', 'available')
        returning id into v_product;
        insert into public.product_categories (product_id, category_id, is_primary) values (v_product, (d ->> 'categoryId')::uuid, true);
        if d ->> 'storage' is not null then
          insert into public.product_options (product_id, key, name, sort_order)
          values (v_product, 'storage', '{"ar": "المساحة", "en": "Storage"}'::jsonb::public.localized_text, 1);
        end if;
        if d ->> 'color' is not null then
          insert into public.product_options (product_id, key, name, sort_order)
          values (v_product, 'color', '{"ar": "اللون", "en": "Colour"}'::jsonb::public.localized_text, 2);
        end if;
      end if;
      if v_check ->> 'action' in ('create_product', 'create_variant') then
        v_product := coalesce(v_product, (d ->> 'productId')::uuid);
        if v_check ->> 'action' = 'create_variant' then v_product := (d ->> 'productId')::uuid; end if;
        insert into public.product_variants (product_id, sku, price, compare_at_price, stock_quantity, low_stock_threshold,
                                             is_active, is_default, sort_order)
        values (v_product, d ->> 'sku', (d ->> 'price')::numeric, nullif(d ->> 'compareAtPrice', '')::numeric,
                coalesce((d ->> 'stock')::integer, 0), coalesce((d ->> 'lowStockThreshold')::integer, 2), true,
                not exists (select 1 from public.product_variants where product_id = v_product and deleted_at is null),
                (select coalesce(max(sort_order), 0) + 1 from public.product_variants where product_id = v_product))
        returning id into v_variant;
        if d ->> 'storage' is not null then
          select id into v_option from public.product_options where product_id = v_product and key = 'storage';
          insert into public.product_option_values (option_id, key, label, sort_order)
          values (v_option, d ->> 'storage',
                  jsonb_build_object('ar', upper(d ->> 'storage'), 'en', upper(d ->> 'storage'))::public.localized_text,
                  (select coalesce(max(sort_order), 0) + 1 from public.product_option_values where option_id = v_option))
          on conflict (option_id, key) do nothing;
          insert into public.variant_option_values (variant_id, option_id, option_value_id)
          select v_variant, v_option, ov.id from public.product_option_values ov where ov.option_id = v_option and ov.key = d ->> 'storage';
        end if;
        if d ->> 'color' is not null then
          select id into v_option from public.product_options where product_id = v_product and key = 'color';
          insert into public.product_option_values (option_id, key, label, swatch_hex, sort_order)
          values (v_option, d ->> 'color',
                  jsonb_build_object('ar', d ->> 'colorLabel', 'en', d ->> 'colorLabel')::public.localized_text,
                  d ->> 'colorHex',
                  (select coalesce(max(sort_order), 0) + 1 from public.product_option_values where option_id = v_option))
          on conflict (option_id, key) do nothing;
          insert into public.variant_option_values (variant_id, option_id, option_value_id)
          select v_variant, v_option, ov.id from public.product_option_values ov where ov.option_id = v_option and ov.key = d ->> 'color';
        end if;
        if coalesce((d ->> 'stock')::integer, 0) > 0 then
          insert into public.stock_movements (variant_id, delta, quantity_before, quantity_after, reason, actor_id, note)
          values (v_variant, (d ->> 'stock')::integer, 0, (d ->> 'stock')::integer, 'import', v_uid,
                  left('Import ' || coalesce(v_job.file_name, ''), 500));
        end if;
        v_product := null;
      else
        -- Update an existing variant: only the columns present in the row.
        v_variant := (d ->> 'variantId')::uuid;
        select stock_quantity into v_before from public.product_variants where id = v_variant for update;
        update public.product_variants set
          price = case when d ? 'price' and d ->> 'price' is not null then (d ->> 'price')::numeric else price end,
          compare_at_price = case when d ->> 'compareAtPrice' is not null then (d ->> 'compareAtPrice')::numeric else compare_at_price end,
          low_stock_threshold = coalesce((d ->> 'lowStockThreshold')::integer, low_stock_threshold),
          stock_quantity = coalesce((d ->> 'stock')::integer, stock_quantity)
        where id = v_variant;
        if (d ->> 'stock') is not null and (d ->> 'stock')::integer <> v_before then
          insert into public.stock_movements (variant_id, delta, quantity_before, quantity_after, reason, actor_id, note)
          values (v_variant, (d ->> 'stock')::integer - v_before, v_before, (d ->> 'stock')::integer, 'import', v_uid,
                  left('Import ' || coalesce(v_job.file_name, ''), 500));
        end if;
      end if;
      v_applied := v_applied + 1;
    end loop;
    set constraints all immediate;
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is not null then
    update public.import_jobs set status = 'failed', error = left(v_error, 500) where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'failed', 'message', left(v_error, 300));
  end if;
  update public.import_jobs set status = 'committed', committed_at = now(),
    summary = summary || jsonb_build_object('applied', v_applied) where id = p_job_id;
  perform app.log_event('import.committed', 'public.import_jobs', p_job_id::text, null, null,
                        jsonb_build_object('applied', v_applied, 'validOnly', p_valid_only));
  return jsonb_build_object('ok', true, 'applied', v_applied);
end;
$$;

create or replace function public.admin_list_import_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('data.import');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', j.id, 'fileName', j.file_name, 'status', j.status, 'rowCount', j.row_count, 'summary', j.summary,
      'error', j.error, 'createdAt', j.created_at, 'committedAt', j.committed_at,
      'createdBy', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = j.created_by))
      order by j.created_at desc)
    from (select * from public.import_jobs order by created_at desc limit 30) j), '[]'::jsonb);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.import_storage_key(text), app.import_color_key(text), app.import_validate_row(jsonb, text[], text[]) from public;
grant execute on function app.import_storage_key(text), app.import_color_key(text) to authenticated;

revoke all on function public.admin_dashboard(timestamptz, timestamptz, boolean),
  public.admin_analytics(timestamptz, timestamptz, boolean), public.admin_export(text, jsonb),
  public.admin_export_backup(), public.admin_import_preview(text, jsonb), public.admin_import_commit(uuid, boolean),
  public.admin_list_import_jobs()
  from public, anon;
grant execute on function public.admin_dashboard(timestamptz, timestamptz, boolean),
  public.admin_analytics(timestamptz, timestamptz, boolean), public.admin_export(text, jsonb),
  public.admin_export_backup(), public.admin_import_preview(text, jsonb), public.admin_import_commit(uuid, boolean),
  public.admin_list_import_jobs()
  to authenticated;
