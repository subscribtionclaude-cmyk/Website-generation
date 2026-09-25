-- ════════════════════════════════════════════════════════════════════════════
-- Phase 05 · Service requests — staff operations (minimal workflow; Phase 06 polishes the UI).
--
-- Every action requires the request kind's permission (repairs.*, tradein.*, used_requests.*,
-- after_sales.*) and is audited through app.log_event. Money is always set here, by staff:
--   * repair quotes (estimate / final)          → amount
--   * trade-in valuation                        → device_value; target_price is the authoritative
--     catalog price of the chosen variant (snapshot at offer time) or, for a manual target, a
--     staff-entered price; difference = target_price − device_value (computed by the database)
--   * used-device proposal                      → price + device details + optional photos
-- Customers never supply or edit these values.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.require_service_permission(p_request uuid, p_action text)
returns public.service_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.service_requests;
begin
  select * into r from public.service_requests where id = p_request;
  if not found then
    -- Do not reveal existence to callers without any service permission.
    if not (app.has_permission('repairs.view') or app.has_permission('tradein.view')
            or app.has_permission('used_requests.view') or app.has_permission('after_sales.view')) then
      raise exception 'permission denied' using errcode = '42501';
    end if;
    return null;
  end if;
  perform app.require_permission(app.service_permission(r.kind, p_action));
  return r;
end;
$$;

create or replace function app.service_set_status_internal(p_request uuid, p_status text, p_message text,
                                                           p_visible boolean, p_actor uuid, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests;
begin
  select * into r from public.service_requests where id = p_request for update;
  update public.service_requests
    set status = p_status,
        closed_at = case when app.service_status_terminal(p_status) then now() else null end,
        awaiting_customer = case when app.service_status_terminal(p_status) then false else awaiting_customer end
    where id = p_request;
  if app.service_status_terminal(p_status) then
    update public.service_offers set status = 'withdrawn' where request_id = p_request and status = 'sent';
  end if;
  insert into public.service_events (request_id, event_type, status, from_status, message, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (p_request, 'status', p_status, r.status, p_message, p_data, p_visible, p_actor, 'staff');
  perform app.log_event('service.status_changed', 'service_request', p_request::text,
                        jsonb_build_object('status', r.status), jsonb_build_object('status', p_status),
                        jsonb_build_object('number', r.request_number, 'kind', r.kind));
  perform app.service_notify(p_request, app.service_status_template(r.kind, p_status), 'status:' || p_status);
end;
$$;

-- ── Lists and detail ───────────────────────────────────────────────────────────
create or replace function public.staff_list_service_requests(p_kind text, p_status text default null,
                                                              p_q text default null, p_assigned text default null,
                                                              p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if p_kind not in ('repair', 'trade_in', 'used', 'after_sales') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  v_uid := app.require_permission(app.service_permission(p_kind, 'view'));
  return (
    with filtered as (
      select r.* from public.service_requests r
      where r.kind = p_kind
        and (p_status is null or r.status = p_status or (p_status = 'open' and not app.service_status_terminal(r.status)))
        and (p_assigned is null or (p_assigned = 'me' and r.assigned_to = v_uid)
             or (p_assigned = 'unassigned' and r.assigned_to is null))
        and (v_q is null or r.request_number ilike '%' || v_q || '%' or r.contact_phone like '%' || v_q || '%'
             or r.contact_name ilike '%' || v_q || '%' or coalesce(r.brand, '') ilike '%' || v_q || '%'
             or coalesce(r.model, '') ilike '%' || v_q || '%'))
    select jsonb_build_object(
      'ok', true,
      'total', (select count(*) from filtered),
      'items', coalesce((select jsonb_agg(app.service_summary_json(f) || jsonb_build_object(
                           'contactName', f.contact_name, 'contactPhone', f.contact_phone,
                           'assignedTo', case when f.assigned_to is not null then jsonb_build_object(
                             'id', f.assigned_to,
                             'name', coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = f.assigned_to),
                                              (select u.email from auth.users u where u.id = f.assigned_to))) end)
                         order by f.created_at desc)
                         from (select * from filtered order by created_at desc
                               limit least(greatest(coalesce(p_limit, 50), 1), 200)
                               offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)));
end;
$$;

create or replace function public.staff_get_service_request(p_id uuid)
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
  return app.service_request_json(r.id, true);
end;
$$;

-- Staff who can work on this kind of request (for assignment).
create or replace function public.staff_service_assignees(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(app.service_permission(p_kind, 'manage'));
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id,
                                        'name', coalesce(nullif(p.full_name, ''), u.email)) order by coalesce(nullif(p.full_name, ''), u.email))
    from auth.users u
    left join public.profiles p on p.id = u.id
    where exists (
      select 1 from public.user_roles ur
      join public.roles ro on ro.id = ur.role_id
      where ur.user_id = u.id and ro.deleted_at is null
        and (ro.grants_all or exists (
              select 1 from public.role_permissions rp
              where rp.role_id = ro.id and rp.permission_key = app.service_permission(p_kind, 'manage'))))), '[]'::jsonb);
end;
$$;

-- ── Actions ────────────────────────────────────────────────────────────────────
create or replace function public.staff_assign_service_request(p_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_uid uuid := app.current_actor_id();
begin
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if p_staff_id is not null and not exists (
       select 1 from jsonb_array_elements(public.staff_service_assignees(r.kind)) a where (a ->> 'id')::uuid = p_staff_id) then
    return jsonb_build_object('ok', false, 'code', 'not_staff');
  end if;
  update public.service_requests set assigned_to = p_staff_id where id = r.id;
  insert into public.service_events (request_id, event_type, data, visible_to_customer, actor_id, actor_kind)
  values (r.id, 'assignment', jsonb_build_object('staffId', p_staff_id), false, v_uid, 'staff');
  perform app.log_event('service.assigned', 'service_request', r.id::text,
                        jsonb_build_object('assignedTo', r.assigned_to), jsonb_build_object('assignedTo', p_staff_id),
                        jsonb_build_object('number', r.request_number));
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

create or replace function public.staff_set_service_status(p_id uuid, p_status text, p_note text default null)
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
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if p_status = r.status then return jsonb_build_object('ok', false, 'code', 'same_status'); end if;
  if not app.service_status_valid(r.kind, p_status, r.after_sales_type) then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  -- Offer states come from sending an offer, never from a bare status change.
  if p_status in ('quote_sent', 'valuation_ready', 'option_found')
     or (p_status = 'offer_sent' and r.kind = 'trade_in') then
    return jsonb_build_object('ok', false, 'code', 'use_offer');
  end if;
  if r.kind = 'after_sales' and p_status in ('item_received', 'inspection', 'exchange_handling', 'refund_handling',
                                             'warranty_handling', 'completed')
     and not exists (select 1 from public.service_events e where e.request_id = r.id and e.status = 'approved') then
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  perform app.service_set_status_internal(r.id, p_status, app.clean_text(p_note, 2000), true, app.current_actor_id());
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

-- Internal note (staff only) or customer-visible update.
create or replace function public.staff_add_service_note(p_id uuid, p_message text, p_visible boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_message text := app.clean_text(p_message, 2000);
  v_event bigint;
begin
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_message is null then return jsonb_build_object('ok', false, 'code', 'message_required'); end if;
  insert into public.service_events (request_id, event_type, message, visible_to_customer, actor_id, actor_kind)
  values (r.id, case when p_visible then 'update' else 'note' end, v_message, coalesce(p_visible, false),
          app.current_actor_id(), 'staff')
  returning id into v_event;
  perform app.log_event(case when p_visible then 'service.update_published' else 'service.note_added' end,
                        'service_request', r.id::text, null, null,
                        jsonb_build_object('number', r.request_number, 'eventId', v_event));
  if p_visible then
    perform app.service_notify(r.id, 'service.updated', 'update:' || v_event);
  end if;
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

create or replace function public.staff_request_service_info(p_id uuid, p_message text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_message text := app.clean_text(p_message, 2000);
  v_event bigint;
begin
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if v_message is null then return jsonb_build_object('ok', false, 'code', 'message_required'); end if;
  update public.service_requests
    set awaiting_customer = true,
        status = case when r.kind = 'trade_in' then 'need_more_info' else status end
    where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, message, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'info_requested', case when r.kind = 'trade_in' then 'need_more_info' end,
          case when r.kind = 'trade_in' then r.status end, v_message, true, app.current_actor_id(), 'staff')
  returning id into v_event;
  perform app.log_event('service.info_requested', 'service_request', r.id::text, null, null,
                        jsonb_build_object('number', r.request_number));
  perform app.service_notify(r.id, 'service.info_needed', 'info:' || v_event);
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

-- Repair estimate / final quote. Never promised automatically — always a staff decision.
create or replace function public.staff_send_repair_quote(p_id uuid, p_kind text, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_offer uuid;
begin
  if r.id is null or r.kind <> 'repair' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if p_kind not in ('estimate', 'final') then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 or round(p_amount, 2) <> p_amount then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  update public.service_offers set status = 'superseded' where request_id = r.id and status = 'sent';
  insert into public.service_offers (request_id, kind, amount, note, created_by, is_demo)
  values (r.id, 'repair_' || p_kind, p_amount, app.clean_text(p_note, 1000), app.current_actor_id(), r.is_demo)
  returning id into v_offer;
  update public.service_requests set status = 'quote_sent' where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'offer', 'quote_sent', r.status, jsonb_build_object('offerId', v_offer, 'kind', 'repair_' || p_kind),
          true, app.current_actor_id(), 'staff');
  perform app.log_event('service.repair_quote_sent', 'service_request', r.id::text, null,
                        jsonb_build_object('kind', p_kind, 'amount', p_amount),
                        jsonb_build_object('number', r.request_number, 'offerId', v_offer));
  perform app.service_notify(r.id, 'service.repair.quote_ready', 'offer:' || v_offer, p_amount);
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

-- Trade-in valuation → offer. The new-device price is the authoritative catalog price when the
-- target is a catalog variant (a staff-entered target price is refused); staff enter it only for a
-- manual target. Difference = target price − device value (may be negative: the store pays).
create or replace function public.staff_send_trade_in_offer(p_id uuid, p_device_value numeric,
                                                            p_target_price numeric default null,
                                                            p_note text default null,
                                                            p_inspection_note text default null,
                                                            p_valid_days integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_target_price numeric(12, 2);
  v_snapshot jsonb;
  v_days integer;
  v_offer uuid;
begin
  if r.id is null or r.kind <> 'trade_in' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if p_device_value is null or p_device_value < 0 or p_device_value > 10000000 or round(p_device_value, 2) <> p_device_value then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'field', 'deviceValue');
  end if;
  if r.target_variant_id is not null then
    if p_target_price is not null then
      return jsonb_build_object('ok', false, 'code', 'catalog_price_only', 'field', 'targetPrice');
    end if;
    select vp.unit_price into v_target_price from app.variant_pricing(r.target_variant_id) vp;
    if v_target_price is null then
      return jsonb_build_object('ok', false, 'code', 'target_price_unavailable', 'field', 'targetPrice');
    end if;
    v_snapshot := app.variant_line_snapshot(r.target_variant_id)
                  || jsonb_build_object('variantId', r.target_variant_id, 'price', v_target_price);
  else
    if p_target_price is null or p_target_price < 0 or p_target_price > 10000000 or round(p_target_price, 2) <> p_target_price then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'field', 'targetPrice');
    end if;
    v_target_price := p_target_price;
    v_snapshot := coalesce(r.details -> 'target' -> 'manual', '{}'::jsonb) || jsonb_build_object('price', v_target_price);
  end if;
  v_days := least(greatest(coalesce(p_valid_days, app.services_int('tradeIn', 'offerValidityDays', 7, 1, 60)), 1), 60);
  update public.service_offers set status = 'superseded' where request_id = r.id and status = 'sent';
  insert into public.service_offers (request_id, kind, device_value, target_price, difference, target_snapshot, note,
                                     inspection_note, expires_at, created_by, is_demo)
  values (r.id, 'trade_in', p_device_value, v_target_price, v_target_price - p_device_value, v_snapshot,
          app.clean_text(p_note, 1000), app.clean_text(p_inspection_note, 1000), now() + make_interval(days => v_days),
          app.current_actor_id(), r.is_demo)
  returning id into v_offer;
  update public.service_requests set status = 'offer_sent', awaiting_customer = false where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'offer', 'offer_sent', r.status, jsonb_build_object('offerId', v_offer, 'kind', 'trade_in'),
          true, app.current_actor_id(), 'staff');
  perform app.log_event('service.trade_in_valuation', 'service_request', r.id::text, null,
                        jsonb_build_object('deviceValue', p_device_value, 'targetPrice', v_target_price,
                                           'difference', v_target_price - p_device_value),
                        jsonb_build_object('number', r.request_number, 'offerId', v_offer));
  perform app.service_notify(r.id, 'service.trade_in.offer_ready', 'offer:' || v_offer, p_device_value);
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

-- Used-device proposal: a real available device the team found (no used catalog is created).
create or replace function public.staff_send_used_proposal(p_id uuid, p_device jsonb, p_price numeric,
                                                           p_note text default null, p_media jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_device jsonb;
  v_problem text;
  v_offer uuid;
begin
  if r.id is null or r.kind <> 'used' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if p_price is null or p_price <= 0 or p_price > 10000000 or round(p_price, 2) <> p_price then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'field', 'price');
  end if;
  if jsonb_typeof(p_device) <> 'object' or app.clean_text(p_device ->> 'brand', 60) is null
     or app.clean_text(p_device ->> 'model', 80) is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'device');
  end if;
  if jsonb_typeof(p_device -> 'batteryHealth') = 'number'
     and ((p_device ->> 'batteryHealth')::numeric not between 1 and 100) then
    return jsonb_build_object('ok', false, 'code', 'invalid_battery', 'field', 'batteryHealth');
  end if;
  if coalesce(p_device ->> 'taxStatus', 'unknown') not in ('tax_paid', 'not_tax_paid', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'taxStatus');
  end if;
  v_device := jsonb_build_object(
    'brand', app.clean_text(p_device ->> 'brand', 60), 'model', app.clean_text(p_device ->> 'model', 80),
    'storage', app.clean_text(p_device ->> 'storage', 20), 'color', app.clean_text(p_device ->> 'color', 30),
    'batteryHealth', case when jsonb_typeof(p_device -> 'batteryHealth') = 'number'
                          then (p_device ->> 'batteryHealth')::integer end,
    'condition', app.clean_text(p_device ->> 'condition', 500),
    'taxStatus', coalesce(p_device ->> 'taxStatus', 'unknown'));
  v_problem := app.service_media_problem('used-requests', p_media, app.current_actor_id(), null, false);
  if v_problem is not null then return jsonb_build_object('ok', false, 'code', v_problem, 'field', 'media'); end if;
  update public.service_offers set status = 'superseded' where request_id = r.id and status = 'sent';
  insert into public.service_offers (request_id, kind, amount, device, note, created_by, is_demo)
  values (r.id, 'used_proposal', p_price, v_device, app.clean_text(p_note, 1000), app.current_actor_id(), r.is_demo)
  returning id into v_offer;
  perform app.insert_service_media(r.id, 'used-requests', p_media, app.current_actor_id(), 'staff', v_offer, r.is_demo);
  update public.service_requests set status = 'option_found', awaiting_customer = false where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'offer', 'option_found', r.status, jsonb_build_object('offerId', v_offer, 'kind', 'used_proposal'),
          true, app.current_actor_id(), 'staff');
  perform app.log_event('service.used_proposal', 'service_request', r.id::text, null,
                        jsonb_build_object('price', p_price, 'device', v_device),
                        jsonb_build_object('number', r.request_number, 'offerId', v_offer));
  perform app.service_notify(r.id, 'service.used.option_found', 'offer:' || v_offer, p_price);
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

-- After-sales approval / rejection (reason shown to the customer).
create or replace function public.staff_decide_after_sales(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests := app.require_service_permission(p_id, 'manage');
  v_note text := app.clean_text(p_note, 2000);
begin
  if r.id is null or r.kind <> 'after_sales' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if r.status not in ('new', 'under_review') then return jsonb_build_object('ok', false, 'code', 'already_decided'); end if;
  if p_decision not in ('approved', 'rejected') then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if p_decision = 'rejected' and v_note is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'note');
  end if;
  perform app.service_set_status_internal(r.id, p_decision, v_note, true, app.current_actor_id(),
                                          jsonb_build_object('decision', p_decision));
  perform app.log_event('service.after_sales_' || p_decision, 'service_request', r.id::text, null, null,
                        jsonb_build_object('number', r.request_number));
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, true));
end;
$$;

revoke all on function app.require_service_permission(uuid, text),
  app.service_set_status_internal(uuid, text, text, boolean, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.staff_list_service_requests(text, text, text, text, integer, integer),
  public.staff_get_service_request(uuid), public.staff_service_assignees(text),
  public.staff_assign_service_request(uuid, uuid), public.staff_set_service_status(uuid, text, text),
  public.staff_add_service_note(uuid, text, boolean), public.staff_request_service_info(uuid, text),
  public.staff_send_repair_quote(uuid, text, numeric, text),
  public.staff_send_trade_in_offer(uuid, numeric, numeric, text, text, integer),
  public.staff_send_used_proposal(uuid, jsonb, numeric, text, jsonb),
  public.staff_decide_after_sales(uuid, text, text)
  from public, anon;
grant execute on function public.staff_list_service_requests(text, text, text, text, integer, integer),
  public.staff_get_service_request(uuid), public.staff_service_assignees(text),
  public.staff_assign_service_request(uuid, uuid), public.staff_set_service_status(uuid, text, text),
  public.staff_add_service_note(uuid, text, boolean), public.staff_request_service_info(uuid, text),
  public.staff_send_repair_quote(uuid, text, numeric, text),
  public.staff_send_trade_in_offer(uuid, numeric, numeric, text, text, integer),
  public.staff_send_used_proposal(uuid, jsonb, numeric, text, jsonb),
  public.staff_decide_after_sales(uuid, text, text)
  to authenticated;
