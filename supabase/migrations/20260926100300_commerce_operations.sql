-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0013 · Order operations (staff): status, stock commit, shipping fee, payments,
--                      manual review, cancellation, assignment, notes, reservation cleanup
--
-- Every function checks the caller's permission INSIDE the database (RBAC from Phase 01):
--   orders.view      read orders            orders.manage     status, cancel, assign, notes
--   shipping.manage  shipping fee / ETA     payments.verify   record verified money, review decisions
-- Payment verification and review decisions also honour the MFA gate (security.adminMfaRequired).
-- A screenshot never marks anything paid: paid_amount only grows through staff_record_payment.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.require_permission(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.has_permission(p_permission) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Payment status is derived from method + verified money (+ whether the shipping fee is known).
create or replace function app.derived_payment_status(o public.orders)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when o.status = 'cancelled' and o.paid_amount = 0 then 'void'
    when o.paid_amount > 0 and o.paid_amount >= o.total and o.shipping_fee_status <> 'pending' then 'paid'
    when o.paid_amount > 0 and o.payment_method = 'split' then 'deposit_verified'
    when o.paid_amount > 0 then 'partially_paid'
    when o.payment_status = 'verification_pending' then 'verification_pending'
    else case o.payment_method
           when 'cod' then 'cod_pending'
           when 'instapay' then 'awaiting_payment'
           else 'awaiting_deposit' end
  end;
$$;

create or replace function app.order_transition_allowed(p_from text, p_to text, p_fulfillment text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'new' then p_to in ('awaiting_whatsapp', 'awaiting_payment', 'payment_verification', 'confirmed')
    when 'awaiting_whatsapp' then p_to in ('awaiting_payment', 'payment_verification', 'confirmed')
    when 'awaiting_payment' then p_to in ('awaiting_whatsapp', 'payment_verification', 'confirmed')
    when 'payment_verification' then p_to in ('awaiting_payment', 'confirmed')
    when 'confirmed' then p_to = 'preparing'
    when 'preparing' then (p_fulfillment = 'pickup' and p_to = 'ready_for_pickup')
                       or (p_fulfillment = 'delivery' and p_to = 'out_for_delivery')
    when 'ready_for_pickup' then p_fulfillment = 'pickup' and p_to = 'completed'
    when 'out_for_delivery' then p_to in ('delivered', 'preparing')
    when 'delivered' then p_to = 'completed'
    else false
  end;
$$;

-- Reservation → sold stock, exactly once (reservations flip to 'committed'; one 'sale' movement each).
create or replace function app.commit_order_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders%rowtype;
  v_res      record;
  v_failing  jsonb := '[]'::jsonb;
  v_after    integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.stock_committed_at is not null then
    return jsonb_build_object('ok', true, 'alreadyCommitted', true);
  end if;

  perform 1 from public.product_variants v
  where v.id in (select r.variant_id from public.stock_reservations r
                 where r.order_id = p_order_id and r.status in ('active', 'expired'))
  order by v.id
  for update of v;

  for v_res in
    select r.*, v.stock_quantity, v.sku from public.stock_reservations r
    join public.product_variants v on v.id = r.variant_id
    where r.order_id = p_order_id and r.status in ('active', 'expired')
    order by r.variant_id
  loop
    -- A live hold is already counted; an expired one must fit into what is available now.
    if v_res.stock_quantity < v_res.quantity
       or (not (v_res.status = 'active' and v_res.expires_at > now())
           and app.variant_available_quantity(v_res.variant_id, p_order_id) < v_res.quantity) then
      v_failing := v_failing || jsonb_build_array(jsonb_build_object('variantId', v_res.variant_id, 'sku', v_res.sku,
                                                                     'quantity', v_res.quantity));
    end if;
  end loop;
  if jsonb_array_length(v_failing) > 0 then
    return jsonb_build_object('ok', false, 'code', 'stock_unavailable', 'lines', v_failing);
  end if;

  for v_res in
    select r.* from public.stock_reservations r
    where r.order_id = p_order_id and r.status in ('active', 'expired')
    order by r.variant_id
  loop
    update public.product_variants set stock_quantity = stock_quantity - v_res.quantity
      where id = v_res.variant_id returning stock_quantity into v_after;
    insert into public.stock_movements (variant_id, delta, quantity_after, reason, order_id, actor_id, is_demo)
    values (v_res.variant_id, -v_res.quantity, v_after, 'sale', p_order_id, app.current_actor_id(), v_order.is_demo);
    update public.stock_reservations set status = 'committed', committed_at = now() where id = v_res.id;
  end loop;

  update public.orders set stock_committed_at = now(), reservation_expires_at = null where id = p_order_id;
  insert into public.order_events (order_id, event_type, data, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'reservation', jsonb_build_object('action', 'committed'), false, app.current_actor_id(), 'staff');
  return jsonb_build_object('ok', true, 'alreadyCommitted', false);
end;
$$;

-- ── Status ──────────────────────────────────────────────────────────────────
create or replace function public.staff_set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('orders.manage');
  v_order   public.orders%rowtype;
  v_commit  jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'use_cancel');
  end if;
  if not app.order_transition_allowed(v_order.status, p_status, v_order.fulfillment_method) then
    return jsonb_build_object('ok', false, 'code', 'invalid_transition', 'from', v_order.status, 'to', p_status);
  end if;

  if p_status = 'confirmed' then
    if v_order.manual_review_status = 'pending' then
      return jsonb_build_object('ok', false, 'code', 'review_pending');
    elsif v_order.manual_review_status = 'rejected' then
      return jsonb_build_object('ok', false, 'code', 'review_rejected');
    elsif v_order.fulfillment_method = 'delivery' and v_order.shipping_fee_status <> 'confirmed' then
      return jsonb_build_object('ok', false, 'code', 'shipping_fee_pending');
    elsif v_order.payment_method = 'instapay' and v_order.payment_status <> 'paid' then
      return jsonb_build_object('ok', false, 'code', 'payment_not_verified');
    elsif v_order.payment_method = 'split' and v_order.paid_amount <= 0 then
      return jsonb_build_object('ok', false, 'code', 'deposit_not_verified');
    end if;
    v_commit := app.commit_order_stock(p_order_id);
    if not (v_commit ->> 'ok')::boolean then
      return v_commit || jsonb_build_object('order', app.order_json(p_order_id, true));
    end if;
  elsif p_status = 'completed' and v_order.remaining_amount > 0 then
    return jsonb_build_object('ok', false, 'code', 'balance_due');
  end if;

  update public.orders set status = p_status where id = p_order_id;
  insert into public.order_events (order_id, event_type, status, from_status, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'status', p_status, v_order.status, left(p_note, 1000), true, v_uid, 'staff');
  perform app.log_event('order.status_changed', 'order', p_order_id::text,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', p_status),
    jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Cancellation (staff) ────────────────────────────────────────────────────
create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_permission('orders.manage');
  v_order  public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'already_cancelled');
  elsif v_order.status in ('out_for_delivery', 'delivered', 'completed') then
    -- Returns/refunds after dispatch belong to the After-Sales workflow (Phase 05).
    return jsonb_build_object('ok', false, 'code', 'cannot_cancel');
  elsif v_order.paid_amount > 0 then
    return jsonb_build_object('ok', false, 'code', 'refund_required');
  elsif char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  perform app.cancel_order_internal(p_order_id, btrim(p_reason), 'staff');
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Shipping (manual fee now; courier API later via Integrations) ───────────
create or replace function public.staff_set_shipping(p_order_id uuid, p_fee numeric default null,
                                                     p_eta text default null, p_courier text default null,
                                                     p_tracking text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('shipping.manage');
  v_order   public.orders%rowtype;
  v_fee     numeric;
  v_total   numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif v_order.fulfillment_method <> 'delivery' then
    return jsonb_build_object('ok', false, 'code', 'not_delivery');
  elsif v_order.status in ('cancelled', 'completed', 'delivered') then
    return jsonb_build_object('ok', false, 'code', 'order_closed');
  end if;

  v_fee := v_order.shipping_fee;
  v_total := v_order.total;
  if p_fee is not null then
    if p_fee < 0 or p_fee > 100000 then
      return jsonb_build_object('ok', false, 'code', 'invalid_fee');
    end if;
    v_fee := round(p_fee, 2);
    v_total := v_order.subtotal - v_order.discount_total + v_fee;
    if v_total < v_order.paid_amount then
      -- Would make the remaining balance negative: needs a refund/adjustment workflow instead.
      return jsonb_build_object('ok', false, 'code', 'would_overpay');
    end if;
  end if;

  update public.orders
     set shipping_fee = v_fee,
         shipping_fee_status = case when v_fee is not null then 'confirmed' else shipping_fee_status end,
         total = v_total,
         delivery_eta = coalesce(nullif(btrim(p_eta), ''), delivery_eta),
         courier = coalesce(nullif(btrim(p_courier), ''), courier),
         tracking_number = coalesce(nullif(btrim(p_tracking), ''), tracking_number)
   where id = p_order_id;
  update public.orders o set payment_status = app.derived_payment_status(o) where o.id = p_order_id;

  insert into public.order_events (order_id, event_type, data, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'shipping', jsonb_build_object(
            'fromFee', v_order.shipping_fee, 'toFee', v_fee, 'total', v_total,
            'eta', nullif(btrim(p_eta), ''), 'courier', nullif(btrim(p_courier), ''),
            'trackingNumber', nullif(btrim(p_tracking), '')),
          left(p_note, 1000), true, v_uid, 'staff');
  perform app.log_event('order.shipping_updated', 'order', p_order_id::text,
    jsonb_build_object('shippingFee', v_order.shipping_fee, 'total', v_order.total),
    jsonb_build_object('shippingFee', v_fee, 'total', v_total), jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Payments ────────────────────────────────────────────────────────────────
-- "Customer says they paid" (e.g. sent an InstaPay screenshot on WhatsApp): marks the order as
-- being checked. It does NOT change paid_amount.
create or replace function public.staff_mark_payment_verification(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_permission('orders.manage');
  v_order  public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif v_order.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'code', 'order_closed');
  elsif v_order.payment_method not in ('instapay', 'split') or v_order.paid_amount > 0 then
    return jsonb_build_object('ok', false, 'code', 'not_applicable');
  end if;
  update public.orders
     set payment_status = 'verification_pending',
         status = case when status in ('new', 'awaiting_whatsapp', 'awaiting_payment') then 'payment_verification'
                       else status end
   where id = p_order_id;
  insert into public.order_events (order_id, event_type, data, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'payment', jsonb_build_object('action', 'verification_started'), left(p_note, 1000), true,
          v_uid, 'staff');
  if v_order.status in ('new', 'awaiting_whatsapp', 'awaiting_payment') then
    insert into public.order_events (order_id, event_type, status, from_status, visible_to_customer, actor_id, actor_kind)
    values (p_order_id, 'status', 'payment_verification', v_order.status, true, v_uid, 'staff');
  end if;
  perform app.log_event('order.payment_verification_started', 'order', p_order_id::text, null, null,
                        jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- Staff confirm money ACTUALLY received (InstaPay transfer seen in the account, or cash in hand).
create or replace function public.staff_record_payment(p_order_id uuid, p_amount numeric, p_method text,
                                                       p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('payments.verify');
  v_order   public.orders%rowtype;
  v_amount  numeric := round(p_amount, 2);
  v_kind    text;
begin
  perform app.assert_sensitive_action_allowed();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'order_closed');
  elsif v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  elsif p_method is null or p_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'code', 'invalid_method');
  elsif v_amount > v_order.remaining_amount then
    return jsonb_build_object('ok', false, 'code', 'exceeds_remaining', 'remaining', v_order.remaining_amount);
  end if;

  v_kind := case when v_order.payment_method = 'split' and p_method = 'instapay' and v_order.paid_amount = 0
                      and v_amount < v_order.total then 'deposit' else 'payment' end;
  insert into public.payment_records (order_id, method, kind, amount, reference, note, verified_by, is_demo)
  values (p_order_id, p_method, v_kind, v_amount, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''),
          v_uid, v_order.is_demo);
  update public.orders set paid_amount = paid_amount + v_amount where id = p_order_id;
  update public.orders o set payment_status = app.derived_payment_status(o) where o.id = p_order_id;

  insert into public.order_events (order_id, event_type, data, visible_to_customer, actor_id, actor_kind)
  select p_order_id, 'payment', jsonb_build_object('action', case v_kind when 'deposit' then 'deposit_verified'
                                                                          else 'payment_verified' end,
                                                   'amount', v_amount, 'method', p_method,
                                                   'paidAmount', o.paid_amount, 'remainingAmount', o.remaining_amount,
                                                   'paymentStatus', o.payment_status),
         true, v_uid, 'staff'
  from public.orders o where o.id = p_order_id;
  perform app.log_event(case v_kind when 'deposit' then 'order.deposit_verified' else 'order.payment_verified' end,
    'order', p_order_id::text, jsonb_build_object('paidAmount', v_order.paid_amount),
    jsonb_build_object('paidAmount', v_order.paid_amount + v_amount),
    jsonb_build_object('amount', v_amount, 'method', p_method, 'reference', p_reference));
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Manual review decision ──────────────────────────────────────────────────
create or replace function public.staff_review_order(p_order_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_permission('payments.verify');
  v_order  public.orders%rowtype;
begin
  perform app.assert_sensitive_action_allowed();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  elsif v_order.manual_review_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'review_not_pending');
  elsif p_decision not in ('approved', 'rejected') or p_decision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  elsif p_decision = 'rejected' and v_order.paid_amount > 0 then
    return jsonb_build_object('ok', false, 'code', 'refund_required');
  end if;

  update public.orders
     set manual_review_status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         review_note = left(nullif(btrim(p_note), ''), 1000)
   where id = p_order_id;
  insert into public.order_events (order_id, event_type, status, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'review', p_decision, left(p_note, 1000), false, v_uid, 'staff');
  perform app.log_event('order.review_' || p_decision, 'order', p_order_id::text,
    jsonb_build_object('manualReviewStatus', 'pending'), jsonb_build_object('manualReviewStatus', p_decision),
    jsonb_build_object('note', p_note, 'reasons', to_jsonb(v_order.manual_review_reasons)));
  if p_decision = 'rejected' and v_order.status <> 'cancelled' then
    perform app.cancel_order_internal(p_order_id, 'manual_review_rejected', 'staff');
  end if;
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Assignment & internal notes ─────────────────────────────────────────────
create or replace function public.staff_assign_order(p_order_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('orders.manage');
begin
  if p_staff_id is not null and not exists (select 1 from public.user_roles where user_id = p_staff_id) then
    return jsonb_build_object('ok', false, 'code', 'not_staff');
  end if;
  update public.orders set assigned_staff_id = p_staff_id where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.order_events (order_id, event_type, data, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'assignment', jsonb_build_object('staffId', p_staff_id), false, v_uid, 'staff');
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

create or replace function public.staff_add_order_note(p_order_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('orders.manage');
begin
  if char_length(btrim(coalesce(p_note, ''))) = 0 then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.order_events (order_id, event_type, note, visible_to_customer, actor_id, actor_kind)
  values (p_order_id, 'note', left(btrim(p_note), 1000), false, v_uid, 'staff');
  return jsonb_build_object('ok', true, 'order', app.order_json(p_order_id, true));
end;
$$;

-- ── Optional cleanup of expired holds (availability never depends on it) ────
-- Can be called by staff, a free pg_cron job, or never: expired holds already don't count.
create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and not app.has_permission('orders.manage') then
    raise exception 'permission denied: orders.manage' using errcode = '42501';
  end if;
  with expired as (
    update public.stock_reservations
       set status = 'expired', released_at = now(), release_reason = 'expired'
     where status = 'active' and expires_at <= now()
    returning order_id
  ), orders_hit as (
    insert into public.order_events (order_id, event_type, data, visible_to_customer, actor_kind)
    select distinct order_id, 'reservation', jsonb_build_object('action', 'expired'), false, 'system' from expired
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- ── Staff reads ─────────────────────────────────────────────────────────────
create or replace function public.staff_list_orders(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('orders.view');
  v_limit   integer := least(greatest(coalesce(app.json_positive_int(p_filter -> 'limit'), 25), 1), 100);
  v_offset  integer := greatest(coalesce(app.json_positive_int(p_filter -> 'offset'), 0), 0);
  v_status  text := nullif(p_filter ->> 'status', '');
  v_pay     text := nullif(p_filter ->> 'paymentStatus', '');
  v_review  boolean := coalesce((p_filter ->> 'reviewPending')::boolean, false);
  v_q       text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_total   integer;
  v_items   jsonb;
begin
  with matched as (
    select o.* from public.orders o
    where (v_status is null or o.status = v_status)
      and (v_pay is null or o.payment_status = v_pay)
      and (not v_review or o.manual_review_status = 'pending')
      and (v_q is null or o.order_number ilike '%' || v_q || '%' or o.customer_name ilike '%' || v_q || '%'
           or o.customer_phone like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%')
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'orderNumber', m.order_number, 'createdAt', m.created_at, 'status', m.status,
             'paymentMethod', m.payment_method, 'paymentStatus', m.payment_status,
             'fulfillmentMethod', m.fulfillment_method, 'shippingFeeStatus', m.shipping_fee_status,
             'total', m.total, 'paidAmount', m.paid_amount, 'remainingAmount', m.remaining_amount,
             'customerName', m.customer_name, 'customerPhone', m.customer_phone,
             'reviewPending', m.manual_review_status = 'pending',
             'reservationExpiresAt', m.reservation_expires_at, 'stockCommitted', m.stock_committed_at is not null,
             'itemCount', (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = m.id),
             'isDemo', m.is_demo) order by m.created_at desc)
           from (select * from matched order by created_at desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.staff_get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('orders.view');
begin
  return app.order_json(p_order_id, true);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.derived_payment_status(public.orders), app.order_transition_allowed(text, text, text),
  app.commit_order_stock(uuid) from public;
grant execute on function app.require_permission(text) to authenticated;

revoke all on function public.staff_set_order_status(uuid, text, text), public.staff_cancel_order(uuid, text),
  public.staff_set_shipping(uuid, numeric, text, text, text, text), public.staff_mark_payment_verification(uuid, text),
  public.staff_record_payment(uuid, numeric, text, text, text), public.staff_review_order(uuid, text, text),
  public.staff_assign_order(uuid, uuid), public.staff_add_order_note(uuid, text),
  public.release_expired_reservations(), public.staff_list_orders(jsonb), public.staff_get_order(uuid)
  from public, anon;
grant execute on function public.staff_set_order_status(uuid, text, text), public.staff_cancel_order(uuid, text),
  public.staff_set_shipping(uuid, numeric, text, text, text, text), public.staff_mark_payment_verification(uuid, text),
  public.staff_record_payment(uuid, numeric, text, text, text), public.staff_review_order(uuid, text, text),
  public.staff_assign_order(uuid, uuid), public.staff_add_order_note(uuid, text),
  public.release_expired_reservations(), public.staff_list_orders(jsonb), public.staff_get_order(uuid)
  to authenticated;
