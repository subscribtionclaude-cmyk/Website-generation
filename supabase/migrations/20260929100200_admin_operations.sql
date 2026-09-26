-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 06 · Operations administration
--   Orders (richer server-side filters), customers (list, detail, private CRM notes),
--   abandoned-cart follow-up state, service queues (priority, SLA / age, per-kind filters,
--   notification history), reviews (filters + moderation history), notify-me / waitlist
--   operations, notification templates and audited bulk in-app sends.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Orders: server-side filters ─────────────────────────────────────────────
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_assigned_idx on public.orders (assigned_staff_id) where assigned_staff_id is not null;

create or replace function public.staff_list_orders(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.require_permission('orders.view');
  v_limit    integer := app.page_limit(p_filter, 25, 100);
  v_offset   integer := app.page_offset(p_filter);
  v_status   text := nullif(p_filter ->> 'status', '');
  v_pay      text := nullif(p_filter ->> 'paymentStatus', '');
  v_method   text := nullif(p_filter ->> 'paymentMethod', '');
  v_fulfil   text := nullif(p_filter ->> 'fulfillment', '');
  v_review   boolean := coalesce((p_filter ->> 'reviewPending')::boolean, false);
  v_assigned text := nullif(p_filter ->> 'assigned', '');
  v_customer uuid := nullif(p_filter ->> 'customerId', '')::uuid;
  v_from     timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to       timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_q        text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_digits   text := nullif(regexp_replace(coalesce(p_filter ->> 'q', ''), '[^0-9]', '', 'g'), '');
  v_total    integer;
  v_items    jsonb;
begin
  with matched as (
    select o.* from public.orders o
    where (v_status is null or o.status = v_status)
      and (v_pay is null or o.payment_status = v_pay)
      and (v_method is null or o.payment_method = v_method)
      and (v_fulfil is null or o.fulfillment_method = v_fulfil)
      and (not v_review or o.manual_review_status = 'pending')
      and (v_customer is null or o.customer_id = v_customer)
      and (v_assigned is null or (v_assigned = 'me' and o.assigned_staff_id = v_uid)
           or (v_assigned = 'unassigned' and o.assigned_staff_id is null)
           or (v_assigned ~ '^[0-9a-f-]{36}$' and o.assigned_staff_id = v_assigned::uuid))
      and (v_from is null or o.created_at >= v_from)
      and (v_to is null or o.created_at < v_to)
      and (v_q is null or o.order_number ilike app.like_pattern(v_q) or o.customer_name ilike app.like_pattern(v_q)
           or coalesce(o.customer_email, '') ilike app.like_pattern(v_q)
           or (v_digits is not null and char_length(v_digits) >= 4 and o.customer_phone like '%' || v_digits || '%'))
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'orderNumber', m.order_number, 'createdAt', m.created_at, 'status', m.status,
             'paymentMethod', m.payment_method, 'paymentStatus', m.payment_status,
             'fulfillmentMethod', m.fulfillment_method, 'shippingFeeStatus', m.shipping_fee_status,
             'total', m.total, 'paidAmount', m.paid_amount, 'remainingAmount', m.remaining_amount,
             'customerName', m.customer_name, 'customerPhone', m.customer_phone, 'customerId', m.customer_id,
             'reviewPending', m.manual_review_status = 'pending',
             'reservationExpiresAt', m.reservation_expires_at, 'stockCommitted', m.stock_committed_at is not null,
             'itemCount', (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = m.id),
             'assignedTo', case when m.assigned_staff_id is not null then jsonb_build_object(
                'id', m.assigned_staff_id,
                'name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = m.assigned_staff_id)) end,
             'isDemo', m.is_demo) order by m.created_at desc)
           from (select * from matched order by created_at desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- Staff who can be assigned to orders.
create or replace function public.admin_order_assignees()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('orders.view');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email)) order by p.email)
    from public.profiles p
    where p.staff_suspended_at is null and exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.deleted_at is null
      left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = 'orders.manage'
      where ur.user_id = p.id and (r.grants_all or rp.permission_key is not null))), '[]'::jsonb);
end;
$$;

-- ── Customers ───────────────────────────────────────────────────────────────
create table if not exists public.customer_notes (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references auth.users (id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  is_pinned    boolean not null default false,
  author_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.customer_notes is 'Internal CRM notes about a customer (staff only, never shown to the customer).';
create index if not exists customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);

alter table public.customer_notes enable row level security;
revoke all on public.customer_notes from anon, authenticated;

drop trigger if exists customer_notes_set_updated_at on public.customer_notes;
create trigger customer_notes_set_updated_at before update on public.customer_notes
  for each row execute function app.set_updated_at();
drop trigger if exists customer_notes_audit on public.customer_notes;
create trigger customer_notes_audit after insert or update or delete on public.customer_notes
  for each row execute function app.audit_row_change();

-- Lifetime value = money actually taken on non-demo, non-cancelled orders.
create or replace function app.customer_stats(p_customer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ordersCount', (select count(*) from public.orders o where o.customer_id = p_customer),
    'lifetimeValue', (select coalesce(sum(o.paid_amount), 0) from public.orders o
                      where o.customer_id = p_customer and o.status <> 'cancelled'),
    'lastOrderAt', (select max(o.created_at) from public.orders o where o.customer_id = p_customer),
    'openRequests', (select count(*) from public.service_requests r
                     where r.user_id = p_customer and not app.service_status_terminal(r.status))
                    + (select count(*) from public.stock_notifications s where s.user_id = p_customer and s.status = 'active')
                    + (select count(*) from public.waitlist_entries w where w.user_id = p_customer and w.status = 'active'),
    'wishlistCount', (select count(*) from public.wishlist_items w where w.user_id = p_customer));
$$;

create or replace function public.admin_list_customers(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('customers.view');
  v_limit   integer := app.page_limit(p_filter, 25, 100);
  v_offset  integer := app.page_offset(p_filter);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_digits  text := nullif(regexp_replace(coalesce(p_filter ->> 'q', ''), '[^0-9]', '', 'g'), '');
  v_sort    text := coalesce(nullif(p_filter ->> 'sort', ''), 'joined_desc');
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select p.*,
      (select count(*) from public.orders o where o.customer_id = p.id) as orders_count,
      (select coalesce(sum(o.paid_amount), 0) from public.orders o where o.customer_id = p.id and o.status <> 'cancelled') as ltv,
      (select max(o.created_at) from public.orders o where o.customer_id = p.id) as last_order_at
    from public.profiles p
    where p.deleted_at is null
      and not exists (select 1 from public.user_roles ur where ur.user_id = p.id)
      and (v_q is null or p.email ilike app.like_pattern(v_q) or p.full_name ilike app.like_pattern(v_q)
           or (v_digits is not null and char_length(v_digits) >= 4
               and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
  ),
  page as (
    select * from matched
    order by
      case when v_sort = 'orders_desc' then orders_count end desc,
      case when v_sort = 'value_desc' then ltv end desc,
      case when v_sort = 'last_order_desc' then last_order_at end desc nulls last,
      created_at desc, id
    limit v_limit offset v_offset
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'name', m.full_name, 'email', m.email, 'phone', m.phone, 'joinedAt', m.created_at,
             'preferredLocale', m.preferred_locale) || app.customer_stats(m.id) order by m.ord)
           from (select page.*, row_number() over () as ord from page) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_get_customer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('customers.view');
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = p_id and deleted_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_profile.id, 'name', v_profile.full_name, 'email', v_profile.email, 'phone', v_profile.phone,
    'preferredLocale', v_profile.preferred_locale, 'joinedAt', v_profile.created_at,
    'isStaff', exists (select 1 from public.user_roles where user_id = p_id),
    'lastSignInAt', (select u.last_sign_in_at from auth.users u where u.id = p_id),
    'stats', app.customer_stats(p_id),
    'addresses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'governorate', a.governorate, 'area', a.area, 'address', a.address,
        'notes', a.notes, 'phone', a.phone, 'isDefault', a.is_default) order by a.is_default desc, a.created_at)
      from public.customer_addresses a where a.user_id = p_id), '[]'::jsonb),
    'orders', case when app.has_permission('orders.view') then coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'orderNumber', o.order_number, 'createdAt', o.created_at, 'status', o.status,
        'paymentStatus', o.payment_status, 'total', o.total, 'isDemo', o.is_demo) order by o.created_at desc)
      from (select * from public.orders where customer_id = p_id order by created_at desc limit 20) o), '[]'::jsonb) end,
    'serviceRequests', coalesce((select jsonb_agg(app.service_summary_json(r) order by r.created_at desc)
      from (select * from public.service_requests sr where sr.user_id = p_id
              and app.has_permission(app.service_permission(sr.kind, 'view'))
            order by sr.created_at desc limit 20) r), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'rating', rv.rating, 'status', rv.status, 'createdAt', rv.created_at,
        'product', (select jsonb_build_object('slug', p.slug, 'name', p.name) from public.products p where p.id = rv.product_id))
        order by rv.created_at desc)
      from public.product_reviews rv where rv.user_id = p_id), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'category', n.category, 'title', n.title, 'createdAt', n.created_at, 'read', n.read_at is not null)
        order by n.created_at desc)
      from (select * from public.notifications where user_id = p_id order by created_at desc limit 20) n), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cn.id, 'body', cn.body, 'isPinned', cn.is_pinned, 'createdAt', cn.created_at, 'updatedAt', cn.updated_at,
        'authorName', (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.id = cn.author_id))
        order by cn.is_pinned desc, cn.created_at desc)
      from public.customer_notes cn where cn.customer_id = p_id and cn.deleted_at is null), '[]'::jsonb),
    'activity', jsonb_build_object(
      'cartItems', (select coalesce(sum(ci.quantity), 0) from public.carts c join public.cart_items ci on ci.cart_id = c.id
                    where c.customer_id = p_id and not ci.saved_for_later),
      'recentlyViewed', (select count(*) from public.recently_viewed rv where rv.user_id = p_id),
      'followUp', (select jsonb_build_object('state', f.state, 'note', f.note, 'updatedAt', f.updated_at)
                   from public.cart_followups f where f.customer_id = p_id)));
end;
$$;

create or replace function public.admin_save_customer_note(p_customer_id uuid, p_note_id uuid, p_body text,
                                                           p_pinned boolean default false,
                                                           p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('customers.manage');
  v_note public.customer_notes;
begin
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_note', 'field', 'body');
  end if;
  if not exists (select 1 from public.profiles where id = p_customer_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_note_id is null then
    insert into public.customer_notes (customer_id, body, is_pinned, author_id)
    values (p_customer_id, btrim(p_body), coalesce(p_pinned, false), v_uid) returning * into v_note;
  else
    select * into v_note from public.customer_notes
    where id = p_note_id and customer_id = p_customer_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_note.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object('ok', false, 'code', 'stale');
    end if;
    update public.customer_notes set body = btrim(p_body), is_pinned = coalesce(p_pinned, false)
    where id = p_note_id returning * into v_note;
  end if;
  return jsonb_build_object('ok', true, 'id', v_note.id, 'updatedAt', v_note.updated_at);
end;
$$;

create or replace function public.admin_delete_customer_note(p_note_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('customers.manage');
begin
  update public.customer_notes set deleted_at = now() where id = p_note_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Abandoned carts: follow-up state (no paid automation) ──────────────────
create table if not exists public.cart_followups (
  customer_id  uuid primary key references auth.users (id) on delete cascade,
  state        text not null default 'none' check (state in ('none', 'contacted', 'recovered', 'dismissed')),
  note         text check (note is null or char_length(note) <= 500),
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);

alter table public.cart_followups enable row level security;
revoke all on public.cart_followups from anon, authenticated;
drop trigger if exists cart_followups_audit on public.cart_followups;
create trigger cart_followups_audit after insert or update or delete on public.cart_followups
  for each row execute function app.audit_row_change('customer_id');

create or replace function public.admin_list_abandoned_carts(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_permission('customers.view');
  v_limit     integer := app.page_limit(p_filter, 50, 200);
  v_offset    integer := app.page_offset(p_filter);
  v_min_hours integer := nullif(p_filter ->> 'minHours', '')::integer;
  v_min_value numeric := nullif(p_filter ->> 'minValue', '')::numeric;
  v_state     text := nullif(p_filter ->> 'state', '');
  v_q         text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_total     integer;
  v_items     jsonb;
begin
  with carts as (
    select c.id as cart_id, c.customer_id, a.item_count, a.last_activity, pr.full_name, pr.email, pr.phone,
      (select coalesce(sum(ci.quantity * coalesce(vp.unit_price, 0)), 0)
       from public.cart_items ci cross join lateral app.variant_pricing(ci.variant_id) vp
       where ci.cart_id = c.id and not ci.saved_for_later) as cart_value,
      coalesce(f.state, 'none') as follow_state, f.note as follow_note, f.updated_at as follow_updated_at
    from public.carts c
    cross join lateral app.cart_activity(c.customer_id) a
    join public.profiles pr on pr.id = c.customer_id
    left join public.cart_followups f on f.customer_id = c.customer_id
    where app.cart_is_abandoned(c.customer_id)
  ),
  matched as (
    select * from carts
    where (v_min_hours is null or last_activity < now() - make_interval(hours => v_min_hours))
      and (v_min_value is null or cart_value >= v_min_value)
      and (v_state is null or follow_state = v_state)
      and (v_q is null or email ilike app.like_pattern(v_q) or full_name ilike app.like_pattern(v_q))
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'customerId', m.customer_id, 'customerName', coalesce(m.full_name, split_part(m.email, '@', 1)),
             'email', m.email, 'phone', m.phone, 'itemCount', m.item_count, 'lastActivity', m.last_activity,
             'cartValue', m.cart_value, 'followUp', m.follow_state, 'followUpNote', m.follow_note,
             'followUpAt', m.follow_updated_at,
             'reminded', exists (select 1 from public.notifications n where n.user_id = m.customer_id
                                 and n.dedupe_key = 'cart:' || floor(extract(epoch from m.last_activity))::bigint),
             'items', (select coalesce(jsonb_agg(jsonb_build_object('sku', s ->> 'sku', 'name', s -> 'name',
                                                                    'quantity', ci.quantity) order by ci.created_at), '[]'::jsonb)
                       from public.cart_items ci cross join lateral app.variant_line_snapshot(ci.variant_id) s
                       where ci.cart_id = m.cart_id and not ci.saved_for_later))
             order by m.last_activity)
           from (select * from matched order by last_activity limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('settings', app.abandoned_cart_config(), 'total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_set_cart_followup(p_customer_id uuid, p_state text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('customers.manage');
begin
  if p_state not in ('none', 'contacted', 'recovered', 'dismissed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;
  if not exists (select 1 from public.carts where customer_id = p_customer_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.cart_followups (customer_id, state, note, updated_by)
  values (p_customer_id, p_state, nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid)
  on conflict (customer_id) do update set state = excluded.state, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Service queues: priority, SLA, richer filters ──────────────────────────
alter table public.service_requests add column if not exists priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));
create index if not exists service_requests_kind_status_idx on public.service_requests (kind, status, created_at desc);

-- Operational thresholds from the private service_sla setting (no promises to customers).
create or replace function app.service_sla_hours(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'warnHours', coalesce(case when (s.value -> p_kind ->> 'warnHours') ~ '^[0-9]{1,4}$'
                               then (s.value -> p_kind ->> 'warnHours')::integer end, 24),
    'overdueHours', coalesce(case when (s.value -> p_kind ->> 'overdueHours') ~ '^[0-9]{1,4}$'
                                  then (s.value -> p_kind ->> 'overdueHours')::integer end, 48))
  from (select 1) one left join public.site_settings s on s.key = 'service_sla';
$$;

create or replace function app.service_last_change(p_request_id uuid, p_created timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select max(e.created_at) from public.service_events e
                   where e.request_id = p_request_id and e.event_type in ('status', 'created', 'customer_response')),
                  p_created);
$$;

-- Age state of an open request: on_track → approaching → overdue; the clock is paused while the
-- customer owes us an answer (waiting_customer); closed requests have no SLA.
create or replace function app.service_sla_state(r public.service_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.service_status_terminal(r.status) then 'closed'
    when r.awaiting_customer or exists (select 1 from public.service_offers o where o.request_id = r.id and o.status = 'sent')
      then 'waiting_customer'
    when now() - app.service_last_change(r.id, r.created_at)
         >= make_interval(hours => (app.service_sla_hours(r.kind) ->> 'overdueHours')::integer) then 'overdue'
    when now() - app.service_last_change(r.id, r.created_at)
         >= make_interval(hours => (app.service_sla_hours(r.kind) ->> 'warnHours')::integer) then 'approaching'
    else 'on_track' end;
$$;

create or replace function app.service_view_match(r public.service_requests, p_view text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_view
    when 'new' then r.status = 'new'
    when 'awaiting' then not app.service_status_terminal(r.status) and (r.awaiting_customer
         or exists (select 1 from public.service_offers o where o.request_id = r.id and o.status = 'sent'))
    when 'in_progress' then not app.service_status_terminal(r.status) and r.status not in ('new', 'ready')
         and not r.awaiting_customer
         and not exists (select 1 from public.service_offers o where o.request_id = r.id and o.status = 'sent')
    when 'ready' then r.status in ('ready', 'reserved', 'approved')
    when 'completed' then app.service_status_terminal(r.status)
    when 'open' then not app.service_status_terminal(r.status)
    else true end;
$$;

create or replace function public.admin_list_service_requests(p_kind text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_limit    integer := app.page_limit(p_filter, 50, 200);
  v_offset   integer := app.page_offset(p_filter);
  v_view     text := coalesce(nullif(p_filter ->> 'view', ''), 'open');
  v_status   text := nullif(p_filter ->> 'status', '');
  v_q        text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_assigned text := nullif(p_filter ->> 'assigned', '');
  v_priority text := nullif(p_filter ->> 'priority', '');
  v_sla      text := nullif(p_filter ->> 'sla', '');
  v_device   text := nullif(p_filter ->> 'deviceCategory', '');
  v_type     text := nullif(p_filter ->> 'afterSalesType', '');
  v_battery  text := nullif(p_filter ->> 'battery', '');
  v_tax      text := nullif(p_filter ->> 'tax', '');
  v_budget_min numeric := nullif(p_filter ->> 'budgetMin', '')::numeric;
  v_budget_max numeric := nullif(p_filter ->> 'budgetMax', '')::numeric;
  v_from     timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to       timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_total    integer;
  v_items    jsonb;
  v_counts   jsonb;
begin
  if p_kind not in ('repair', 'trade_in', 'used', 'after_sales') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  v_uid := app.require_permission(app.service_permission(p_kind, 'view'));

  with base as (
    select r as req, r.created_at, r.priority, app.service_sla_state(r) as sla_state,
           app.service_last_change(r.id, r.created_at) as last_change
    from public.service_requests r
    where r.kind = p_kind
      and (v_status is null or r.status = v_status)
      and (v_assigned is null or (v_assigned = 'me' and r.assigned_to = v_uid)
           or (v_assigned = 'unassigned' and r.assigned_to is null)
           or (v_assigned ~ '^[0-9a-f-]{36}$' and r.assigned_to = v_assigned::uuid))
      and (v_priority is null or r.priority = v_priority)
      and (v_device is null or r.device_category = v_device)
      and (v_type is null or r.after_sales_type = v_type)
      and (v_battery is null or r.details -> 'device' ->> 'batteryPreference' = v_battery)
      and (v_tax is null or r.details -> 'device' ->> 'taxPreference' = v_tax)
      and (v_budget_min is null or nullif(r.details -> 'device' ->> 'budget', '')::numeric >= v_budget_min)
      and (v_budget_max is null or nullif(r.details -> 'device' ->> 'budget', '')::numeric <= v_budget_max)
      and (v_from is null or r.created_at >= v_from)
      and (v_to is null or r.created_at < v_to)
      and (v_q is null or r.request_number ilike app.like_pattern(v_q) or r.contact_name ilike app.like_pattern(v_q)
           or r.contact_phone like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%'
           or coalesce(r.brand, '') ilike app.like_pattern(v_q) or coalesce(r.model, '') ilike app.like_pattern(v_q)
           or exists (select 1 from public.order_items oi where oi.id = r.order_item_id
                      and (oi.product_name ->> 'ar' ilike app.like_pattern(v_q)
                           or oi.product_name ->> 'en' ilike app.like_pattern(v_q) or oi.sku ilike app.like_pattern(v_q))))
  ),
  matched as (
    select * from base where app.service_view_match(base.req, v_view) and (v_sla is null or sla_state = v_sla)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(app.service_summary_json(f.req) || jsonb_build_object(
             'contactName', (f.req).contact_name, 'contactPhone', (f.req).contact_phone, 'priority', f.priority,
             'sla', f.sla_state, 'lastChangeAt', f.last_change,
             'ageHours', floor(extract(epoch from now() - f.created_at) / 3600)::integer,
             'budget', (f.req).details -> 'device' -> 'budget',
             'batteryPreference', (f.req).details -> 'device' -> 'batteryPreference',
             'taxPreference', (f.req).details -> 'device' -> 'taxPreference',
             'product', (select oi.product_name from public.order_items oi where oi.id = (f.req).order_item_id),
             'assignedTo', case when (f.req).assigned_to is not null then jsonb_build_object(
                'id', (f.req).assigned_to,
                'name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = (f.req).assigned_to)) end)
             order by f.ord)
           from (select m.*, row_number() over (order by case m.priority when 'urgent' then 0 when 'high' then 1
                                                                 when 'normal' then 2 else 3 end, m.created_at) as ord
                 from matched m
                 order by case m.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, m.created_at
                 limit v_limit offset v_offset) f), '[]'::jsonb),
         (select jsonb_build_object(
             'new', count(*) filter (where app.service_view_match(b.req, 'new')),
             'awaiting', count(*) filter (where app.service_view_match(b.req, 'awaiting')),
             'in_progress', count(*) filter (where app.service_view_match(b.req, 'in_progress')),
             'ready', count(*) filter (where app.service_view_match(b.req, 'ready')),
             'completed', count(*) filter (where app.service_view_match(b.req, 'completed')),
             'overdue', count(*) filter (where b.sla_state = 'overdue'),
             'approaching', count(*) filter (where b.sla_state = 'approaching'))
          from base b)
    into v_total, v_items, v_counts;
  return jsonb_build_object('ok', true, 'total', v_total, 'items', v_items, 'counts', v_counts,
                            'sla', app.service_sla_hours(p_kind));
end;
$$;

create or replace function public.admin_set_service_priority(p_id uuid, p_priority text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
begin
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    return jsonb_build_object('ok', false, 'code', 'invalid_priority');
  end if;
  update public.service_requests set priority = p_priority where id = p_id;
  perform app.log_event('service.priority_changed', 'public.service_requests', p_id::text,
                        jsonb_build_object('priority', r.priority), jsonb_build_object('priority', p_priority));
  return jsonb_build_object('ok', true);
end;
$$;

-- Extra staff context: priority, SLA and every notification the customer received for it.
create or replace function public.admin_service_context(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'view');
begin
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'priority', r.priority, 'sla', app.service_sla_state(r), 'slaHours', app.service_sla_hours(r.kind),
    'lastChangeAt', app.service_last_change(r.id, r.created_at),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'templateKey', n.template_key, 'title', n.title, 'createdAt', n.created_at,
        'read', n.read_at is not null) order by n.created_at desc)
      from public.notifications n where n.dedupe_key like 'service:' || r.id::text || ':%'), '[]'::jsonb));
end;
$$;

-- ── Reviews: filters + moderation history ───────────────────────────────────
create or replace function public.admin_list_reviews(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('reviews.moderate');
  v_limit   integer := app.page_limit(p_filter, 30, 100);
  v_offset  integer := app.page_offset(p_filter);
  v_status  text := nullif(p_filter ->> 'status', '');
  v_rating  integer := nullif(p_filter ->> 'rating', '')::integer;
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_from    timestamptz := nullif(p_filter ->> 'from', '')::timestamptz;
  v_to      timestamptz := nullif(p_filter ->> 'to', '')::timestamptz;
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select r.* from public.product_reviews r join public.products p on p.id = r.product_id
    where (v_status is null or r.status = v_status)
      and (v_rating is null or r.rating = v_rating)
      and (v_q is null or p.name ->> 'ar' ilike app.like_pattern(v_q) or p.name ->> 'en' ilike app.like_pattern(v_q)
           or p.slug ilike app.like_pattern(v_q))
      and (v_from is null or r.created_at >= v_from)
      and (v_to is null or r.created_at < v_to)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(app.review_json(r, true) || jsonb_build_object(
             'moderationNote', r.moderation_note, 'moderatedAt', r.moderated_at,
             'orderNumber', (select o.order_number from public.orders o where o.id = r.order_id),
             'eligible', r.order_id is not null and exists (select 1 from public.orders o where o.id = r.order_id
                                                          and o.status in ('delivered', 'completed')),
             'product', jsonb_build_object('slug', p.slug, 'name', p.name),
             'history', coalesce((select jsonb_agg(jsonb_build_object(
                 'at', a.occurred_at, 'action', a.action,
                 'status', a.after_data ->> 'status',
                 'by', (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.id = a.actor_id))
                 order by a.occurred_at)
               from public.audit_logs a where a.entity_type = 'public.product_reviews' and a.entity_id = r.id::text
                 and (a.before_data ->> 'status') is distinct from (a.after_data ->> 'status')), '[]'::jsonb))
             order by r.created_at desc, r.id)
           from (select * from matched order by created_at desc, id limit v_limit offset v_offset) r
           join public.products p on p.id = r.product_id), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Notify-me / waitlist operations ─────────────────────────────────────────
create or replace function public.admin_list_waitlist(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('waitlists.manage');
  v_limit   integer := app.page_limit(p_filter, 50, 200);
  v_offset  integer := app.page_offset(p_filter);
  v_kind    text := nullif(p_filter ->> 'kind', '');
  v_status  text := nullif(p_filter ->> 'status', '');
  v_ready   boolean := coalesce((p_filter ->> 'readyOnly')::boolean, false);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_total   integer;
  v_items   jsonb;
begin
  with rows as (
    select 'notify'::text as kind, s.id, s.product_id, s.variant_id, s.user_id, s.name, s.phone, s.email,
           s.status, s.created_at, s.notified_at,
           coalesce(s.variant_id is not null and app.variant_available_quantity(s.variant_id) > 0,
                    false) as available_now
    from public.stock_notifications s
    union all
    select 'waitlist', w.id, w.product_id, null, w.user_id, w.name, w.phone, w.email, w.status, w.created_at, null,
           exists (select 1 from public.products p where p.id = w.product_id and p.availability_state = 'available'
                   and app.product_is_visible(p))
    from public.waitlist_entries w
  ),
  matched as (
    select rw.*, p.name as product_name, p.slug as product_slug, v.sku
    from rows rw join public.products p on p.id = rw.product_id
    left join public.product_variants v on v.id = rw.variant_id
    where (v_kind is null or rw.kind = v_kind)
      and (v_status is null or rw.status = v_status)
      and (not v_ready or (rw.status = 'active' and rw.available_now))
      and (v_q is null or p.name ->> 'ar' ilike app.like_pattern(v_q) or p.name ->> 'en' ilike app.like_pattern(v_q)
           or coalesce(rw.name, '') ilike app.like_pattern(v_q) or coalesce(rw.email, '') ilike app.like_pattern(v_q)
           or coalesce(rw.phone, '') like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%'
           or coalesce(v.sku, '') ilike app.like_pattern(v_q))
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'kind', m.kind, 'productId', m.product_id, 'productName', m.product_name,
             'productSlug', m.product_slug, 'sku', m.sku,
             'variantLabel', case when m.variant_id is not null then app.variant_option_label(m.variant_id) end,
             'customerName', m.name, 'phone', m.phone, 'email', m.email, 'hasAccount', m.user_id is not null,
             'status', m.status, 'createdAt', m.created_at, 'notifiedAt', m.notified_at,
             'availableNow', m.available_now,
             'readiness', case when m.status <> 'active' then 'closed'
                               when m.available_now and m.user_id is not null then 'ready_in_app'
                               when m.available_now then 'ready_contact'
                               else 'waiting' end)
             order by m.created_at desc)
           from (select * from matched order by created_at desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- ── Notification templates & bulk in-app sends ──────────────────────────────
create or replace function public.admin_list_notification_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('notifications.manage');
begin
  return jsonb_build_object(
    'channels', coalesce((select value -> 'channels' from public.site_settings where key = 'notifications'), '{}'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object(
        'key', t.key, 'category', t.category, 'title', t.title, 'body', t.body, 'isActive', t.is_active,
        'updatedAt', t.updated_at,
        'sent30d', (select count(*) from public.notifications n where n.template_key = t.key
                    and n.created_at > now() - interval '30 days')) order by t.category, t.key)
      from public.notification_templates t), '[]'::jsonb));
end;
$$;

create or replace function public.admin_save_notification_template(p_key text, p_title jsonb, p_body jsonb,
                                                                   p_is_active boolean, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('notifications.manage');
  v_row public.notification_templates;
  v_bad text;
begin
  select * into v_row from public.notification_templates where key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'stale');
  end if;
  if not app.valid_lt(p_title) or not app.valid_lt(p_body)
     or char_length(p_title ->> 'ar') > 120 or char_length(coalesce(p_title ->> 'en', '')) > 120
     or char_length(p_body ->> 'ar') > 1000 or char_length(coalesce(p_body ->> 'en', '')) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_message');
  end if;
  -- Only the closed placeholder set is allowed (anything else would be dropped at render time).
  select m[1] into v_bad
  from regexp_matches(coalesce(p_title ->> 'ar', '') || coalesce(p_title ->> 'en', '') || coalesce(p_body ->> 'ar', '')
                      || coalesce(p_body ->> 'en', ''), '\{\{([^}]*)\}\}', 'g') as m
  where m[1] not in ('customer_name', 'order_number', 'product_name', 'status', 'amount', 'code')
  limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'code', 'unknown_placeholder', 'placeholder', v_bad);
  end if;
  update public.notification_templates set title = app.json_lt(p_title), body = app.json_lt(p_body),
    is_active = coalesce(p_is_active, true), updated_at = clock_timestamp()
  where key = p_key returning * into v_row;
  return jsonb_build_object('ok', true, 'updatedAt', v_row.updated_at);
end;
$$;

create or replace function public.admin_send_notifications(p_user_ids uuid[], p_title jsonb, p_body jsonb,
                                                            p_action_path text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('notifications.manage');
  v_user uuid;
  v_sent integer := 0;
  v_result jsonb;
begin
  if cardinality(coalesce(p_user_ids, '{}')) = 0 or cardinality(p_user_ids) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  foreach v_user in array (select array_agg(distinct u) from unnest(p_user_ids) u) loop
    v_result := public.staff_send_notification(v_user, p_title, p_body, p_action_path);
    if not (v_result ->> 'ok')::boolean then
      if v_result ->> 'code' = 'not_found' then continue; end if;
      return v_result;
    end if;
    v_sent := v_sent + 1;
  end loop;
  perform app.log_event('notification.bulk_sent', 'notification', null, null,
                        jsonb_build_object('title', p_title, 'recipients', v_sent), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'sent', v_sent);
end;
$$;

-- Customers that can receive a manual notification (search by name / email / phone).
create or replace function public.admin_search_recipients(p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('notifications.manage');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if v_q is null or char_length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email))
    from (select * from public.profiles p where p.deleted_at is null
            and (p.email ilike app.like_pattern(v_q) or p.full_name ilike app.like_pattern(v_q)
                 or regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%'
                    and char_length(regexp_replace(v_q, '[^0-9]', '', 'g')) >= 4)
          order by p.email limit 20) p), '[]'::jsonb);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.customer_stats(uuid), app.service_sla_hours(text), app.service_last_change(uuid, timestamptz),
  app.service_sla_state(public.service_requests), app.service_view_match(public.service_requests, text) from public;
grant execute on function app.customer_stats(uuid), app.service_sla_hours(text), app.service_last_change(uuid, timestamptz),
  app.service_sla_state(public.service_requests), app.service_view_match(public.service_requests, text) to authenticated;

revoke all on function public.admin_order_assignees(), public.admin_list_customers(jsonb), public.admin_get_customer(uuid),
  public.admin_save_customer_note(uuid, uuid, text, boolean, timestamptz), public.admin_delete_customer_note(uuid),
  public.admin_list_abandoned_carts(jsonb), public.admin_set_cart_followup(uuid, text, text),
  public.admin_list_service_requests(text, jsonb), public.admin_set_service_priority(uuid, text),
  public.admin_service_context(uuid), public.admin_list_reviews(jsonb), public.admin_list_waitlist(jsonb),
  public.admin_list_notification_templates(), public.admin_save_notification_template(text, jsonb, jsonb, boolean, timestamptz),
  public.admin_send_notifications(uuid[], jsonb, jsonb, text), public.admin_search_recipients(text)
  from public, anon;
grant execute on function public.admin_order_assignees(), public.admin_list_customers(jsonb), public.admin_get_customer(uuid),
  public.admin_save_customer_note(uuid, uuid, text, boolean, timestamptz), public.admin_delete_customer_note(uuid),
  public.admin_list_abandoned_carts(jsonb), public.admin_set_cart_followup(uuid, text, text),
  public.admin_list_service_requests(text, jsonb), public.admin_set_service_priority(uuid, text),
  public.admin_service_context(uuid), public.admin_list_reviews(jsonb), public.admin_list_waitlist(jsonb),
  public.admin_list_notification_templates(), public.admin_save_notification_template(text, jsonb, jsonb, boolean, timestamptz),
  public.admin_send_notifications(uuid[], jsonb, jsonb, text), public.admin_search_recipients(text)
  to authenticated;
