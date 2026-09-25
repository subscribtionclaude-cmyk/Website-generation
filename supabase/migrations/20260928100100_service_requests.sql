-- ════════════════════════════════════════════════════════════════════════════
-- Phase 05 · Service requests — shared helpers and customer RPCs.
--
-- create_service_request(kind, payload) is the single, validated intake for repairs, trade-in,
-- used-device requests and after-sales. Media is uploaded first (private bucket, the customer's own
-- "<uid>/<uuid>.<ext>" folder) and attached by path: the database checks the object exists, belongs
-- to the caller's folder, and that its stored MIME type, extension and size are allowed.
-- Customers never see internal notes, assignment or other customers' requests.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.clean_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or btrim(p_value) = '' then null
              when char_length(btrim(p_value)) > p_max then null
              else btrim(regexp_replace(p_value, '[\x01-\x09\x0b-\x1f\x7f]', '', 'g')) end;
$$;

create or replace function app.egp_text(p_amount numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ar', to_char(p_amount, 'FM999,999,990') || ' ج.م.',
                            'en', 'EGP ' || to_char(p_amount, 'FM999,999,990'));
$$;

create or replace function app.service_bucket(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'repair' then 'repairs' when 'trade_in' then 'trade-in'
                     when 'after_sales' then 'after-sales' when 'used' then 'used-requests' end;
$$;

-- ── Media validation (server side: object must exist; MIME, extension and size from storage) ──
create or replace function app.service_media_mime_for_ext(p_ext text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(p_ext)
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'png' then 'image/png'
    when 'webp' then 'image/webp' when 'heic' then 'image/heic' when 'heif' then 'image/heif'
    when 'mp4' then 'video/mp4' when 'mov' then 'video/quicktime' when 'webm' then 'video/webm' end;
$$;

create or replace function app.service_media_problem(p_bucket text, p_items jsonb, p_owner uuid, p_request uuid,
                                                     p_check_folder boolean)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_path text;
  v_ext text;
  v_mime text;
  v_size bigint;
  v_images integer := 0;
  v_videos integer := 0;
  v_cfg jsonb := app.services_config() -> 'media';
  o storage.objects;
begin
  if p_items is null or p_items = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_items) <> 'array' then return 'invalid_media'; end if;
  if p_request is not null then
    select count(*) filter (where media_type = 'image'), count(*) filter (where media_type = 'video')
      into v_images, v_videos from public.service_media where request_id = p_request and offer_id is null;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_path := v_item ->> 'path';
    if v_path is null
       or v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$'
       or (p_check_folder and split_part(v_path, '/', 1) <> p_owner::text) then
      return 'invalid_media';
    end if;
    if v_item ? 'label' and v_item ->> 'label' is not null and v_item ->> 'label' !~ '^[a-z][a-z_]{1,30}$' then
      return 'invalid_media';
    end if;
    select * into o from storage.objects where bucket_id = p_bucket and name = v_path;
    if not found then return 'media_missing'; end if;
    if exists (select 1 from public.service_media where bucket = p_bucket and path = v_path) then
      return 'media_in_use';
    end if;
    v_ext := substring(v_path from '\.([a-z0-9]+)$');
    v_mime := lower(coalesce(o.metadata ->> 'mimetype', ''));
    v_size := coalesce((o.metadata ->> 'size')::bigint, 0);
    -- The stored content type must match the file extension and be an allowed media type.
    if app.service_media_mime_for_ext(v_ext) is distinct from v_mime then return 'invalid_media_type'; end if;
    if v_size <= 0 then return 'invalid_media'; end if;
    if v_mime like 'image/%' then
      v_images := v_images + 1;
      if v_size > coalesce((v_cfg ->> 'maxImageBytes')::bigint, 8388608) then return 'media_too_large'; end if;
    elsif v_mime like 'video/%' then
      if not coalesce((v_cfg ->> 'allowVideo')::boolean, true) or p_bucket = 'used-requests' then
        return 'video_not_allowed';
      end if;
      v_videos := v_videos + 1;
      if v_size > coalesce((v_cfg ->> 'maxVideoBytes')::bigint, 26214400) then return 'media_too_large'; end if;
    else
      return 'invalid_media_type';
    end if;
  end loop;
  if v_images + v_videos > app.services_int('media', 'maxFiles', 8, 1, 20) then return 'too_many_files'; end if;
  if v_videos > app.services_int('media', 'maxVideos', 1, 0, 5) then return 'too_many_videos'; end if;
  return null;
end;
$$;

create or replace function app.insert_service_media(p_request uuid, p_bucket text, p_items jsonb, p_uploader uuid,
                                                    p_uploader_kind text, p_offer uuid, p_is_demo boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return 0; end if;
  insert into public.service_media (request_id, offer_id, bucket, path, media_type, mime_type, size_bytes,
                                    width, height, label, uploaded_by, uploader_kind, is_demo)
  select p_request, p_offer, p_bucket, i ->> 'path',
         case when lower(o.metadata ->> 'mimetype') like 'video/%' then 'video' else 'image' end,
         lower(o.metadata ->> 'mimetype'), (o.metadata ->> 'size')::bigint,
         case when jsonb_typeof(i -> 'width') = 'number' then least(greatest((i ->> 'width')::integer, 1), 20000) end,
         case when jsonb_typeof(i -> 'height') = 'number' then least(greatest((i ->> 'height')::integer, 1), 20000) end,
         i ->> 'label', p_uploader, p_uploader_kind, p_is_demo
  from jsonb_array_elements(p_items) i
  join storage.objects o on o.bucket_id = p_bucket and o.name = i ->> 'path';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Notifications (idempotent per request + event) ─────────────────────────────
create or replace function app.service_notify(p_request_id uuid, p_template text, p_dedupe text,
                                              p_amount numeric default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.service_requests;
begin
  select * into r from public.service_requests where id = p_request_id;
  if not found or r.user_id is null or p_template is null then return; end if;
  perform app.notify(r.user_id, p_template,
    jsonb_build_object('code', r.request_number)
      || case when p_amount is not null then jsonb_build_object('amount', app.egp_text(p_amount)) else '{}'::jsonb end,
    'service:' || r.id || ':' || p_dedupe,
    '/account/requests/' || r.request_number,
    jsonb_build_object('requestId', r.id, 'kind', r.kind),
    r.is_demo);
end;
$$;

-- Only meaningful status changes notify (no spam); offers notify separately.
create or replace function app.service_status_template(p_kind text, p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'cancelled' then 'service.cancelled'
    when p_kind = 'repair' and p_status = 'ready' then 'service.repair.ready'
    when p_kind = 'repair' and p_status in ('consultation_required', 'device_received', 'repairing', 'completed')
      then 'service.updated'
    when p_kind = 'trade_in' and p_status = 'need_more_info' then 'service.info_needed'
    when p_kind = 'trade_in' and p_status = 'inspection_required' then 'service.trade_in.inspection'
    when p_kind = 'trade_in' and p_status = 'rejected' then 'service.trade_in.rejected'
    when p_kind = 'trade_in' and p_status in ('device_received', 'completed') then 'service.updated'
    when p_kind = 'used' and p_status = 'offer_sent' then 'service.used.offer_sent'
    when p_kind = 'used' and p_status = 'not_available' then 'service.used.not_available'
    when p_kind = 'used' and p_status in ('reserved', 'completed') then 'service.updated'
    when p_kind = 'after_sales' and p_status = 'approved' then 'service.after_sales.approved'
    when p_kind = 'after_sales' and p_status = 'rejected' then 'service.after_sales.rejected'
    when p_kind = 'after_sales' and p_status = 'inspection' then 'service.after_sales.inspection'
    when p_kind = 'after_sales' and p_status = 'completed' then 'service.after_sales.completed'
    when p_kind = 'after_sales' and p_status in ('item_received', 'exchange_handling', 'refund_handling',
                                                 'warranty_handling') then 'service.updated'
  end;
$$;

-- ── JSON views ─────────────────────────────────────────────────────────────────
create or replace function app.service_offer_json(o public.service_offers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'kind', o.kind, 'status', o.status,
    'amount', o.amount, 'deviceValue', o.device_value, 'targetPrice', o.target_price, 'difference', o.difference,
    'target', o.target_snapshot, 'device', o.device, 'note', o.note, 'inspectionNote', o.inspection_note,
    'expiresAt', o.expires_at,
    'expired', o.status = 'sent' and o.expires_at is not null and o.expires_at < now(),
    'createdAt', o.created_at, 'respondedAt', o.responded_at,
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'bucket', m.bucket, 'path', m.path,
                                                            'mediaType', m.media_type, 'label', m.label)
                                        order by m.created_at)
                       from public.service_media m where m.offer_id = o.id), '[]'::jsonb));
$$;

create or replace function app.service_request_title(r public.service_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.kind = 'after_sales' then coalesce((select i.product_name from public.order_items i where i.id = r.order_item_id),
                                              r.details -> 'product' -> 'name',
                                              jsonb_build_object('ar', 'منتج', 'en', 'Product'))
    else jsonb_build_object('ar', btrim(coalesce(r.brand, '') || ' ' || coalesce(r.model, '')),
                            'en', btrim(coalesce(r.brand, '') || ' ' || coalesce(r.model, ''))) end;
$$;

create or replace function app.service_summary_json(r public.service_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'number', r.request_number, 'status', r.status,
    'title', app.service_request_title(r),
    'deviceCategory', r.device_category, 'afterSalesType', r.after_sales_type,
    'awaitingCustomer', r.awaiting_customer,
    'openOffer', exists (select 1 from public.service_offers o where o.request_id = r.id and o.status = 'sent'),
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'isDemo', r.is_demo);
$$;

create or replace function app.service_request_json(p_id uuid, p_staff boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.service_summary_json(r) || jsonb_build_object(
    'contact', jsonb_build_object('name', r.contact_name, 'phone', r.contact_phone),
    'preferredContact', r.preferred_contact, 'handoff', r.handoff,
    'brand', r.brand, 'model', r.model, 'details', r.details,
    'consultationRequired', r.consultation_required,
    'policyVersion', r.policy_version, 'closedAt', r.closed_at, 'locale', r.locale,
    'canCancel', app.service_customer_can_cancel(r.kind, r.status),
    'order', case when r.order_id is not null then (
      select jsonb_build_object('id', o.id, 'number', o.order_number, 'status', o.status, 'createdAt', o.created_at,
                                'item', (select jsonb_build_object('id', i.id, 'name', i.product_name,
                                                                   'variantLabel', i.variant_label, 'sku', i.sku,
                                                                   'image', i.image_url, 'quantity', i.quantity)
                                         from public.order_items i where i.id = r.order_item_id))
      from public.orders o where o.id = r.order_id) end,
    'target', case when r.target_variant_id is not null then
      app.variant_line_snapshot(r.target_variant_id)
        || jsonb_build_object('variantId', r.target_variant_id,
                              'price', (select vp.unit_price from app.variant_pricing(r.target_variant_id) vp))
      else r.details -> 'target' -> 'manual' end,
    'targetIsCatalog', r.target_variant_id is not null,
    'offers', coalesce((select jsonb_agg(app.service_offer_json(o) order by (o.status = 'sent') desc, o.created_at desc, o.id)
                        from public.service_offers o where o.request_id = r.id
                          and (p_staff or o.status <> 'withdrawn')), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'bucket', m.bucket, 'path', m.path,
                                                           'mediaType', m.media_type, 'mimeType', m.mime_type,
                                                           'sizeBytes', m.size_bytes, 'label', m.label,
                                                           'uploaderKind', m.uploader_kind, 'createdAt', m.created_at)
                                        order by m.created_at)
                       from public.service_media m where m.request_id = r.id and m.offer_id is null), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', e.id, 'type', e.event_type, 'status', e.status, 'fromStatus', e.from_status,
                          'message', e.message, 'visibleToCustomer', e.visible_to_customer,
                          'actorKind', e.actor_kind, 'createdAt', e.created_at,
                          'data', case when p_staff then e.data else e.data - 'staffId' end)
                        order by e.id)
                       from public.service_events e where e.request_id = r.id
                         and (p_staff or e.visible_to_customer)), '[]'::jsonb))
  || case when p_staff then jsonb_build_object(
       'customerId', r.user_id,
       'customerEmail', (select u.email from auth.users u where u.id = r.user_id),
       'assignedTo', case when r.assigned_to is not null then jsonb_build_object(
          'id', r.assigned_to,
          'name', coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = r.assigned_to),
                           (select u.email from auth.users u where u.id = r.assigned_to))) end)
     else '{}'::jsonb end
  from public.service_requests r where r.id = p_id;
$$;

-- ── Customer intake ────────────────────────────────────────────────────────────
create or replace function public.create_service_request(p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_key uuid;
  v_existing public.service_requests;
  v_name text;
  v_phone text;
  v_contact text;
  v_handoff text;
  v_locale text;
  v_category text;
  v_brand text;
  v_model text;
  v_details jsonb := '{}'::jsonb;
  v_consult boolean := false;
  v_media jsonb := p_payload -> 'media';
  v_problem text;
  v_bucket text;
  v_order public.orders;
  v_item public.order_items;
  v_type text;
  v_target uuid;
  v_catalog jsonb;
  v_component jsonb;
  v_text text;
  v_num numeric;
  v_arr text[];
  r public.service_requests;
begin
  if p_kind not in ('repair', 'trade_in', 'used', 'after_sales') or jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not app.service_enabled(p_kind) then
    return jsonb_build_object('ok', false, 'code', 'service_disabled');
  end if;

  -- Idempotent: the same submission key returns the request it already created.
  if app.is_uuid(p_payload ->> 'idempotencyKey') then
    v_key := (p_payload ->> 'idempotencyKey')::uuid;
    select * into v_existing from public.service_requests where user_id = v_uid and idempotency_key = v_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true,
                                'request', jsonb_build_object('id', v_existing.id, 'number', v_existing.request_number,
                                                              'status', v_existing.status));
    end if;
  end if;

  if (select count(*) from public.service_requests
      where user_id = v_uid and not app.service_status_terminal(status))
     >= app.services_int('requests', 'maxOpenPerCustomer', 10, 1, 100) then
    return jsonb_build_object('ok', false, 'code', 'too_many_open');
  end if;

  -- Contact (Egyptian mobile, normalised exactly like checkout).
  v_name := app.clean_text(p_payload -> 'contact' ->> 'name', 120);
  if v_name is null or char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'name');
  end if;
  v_phone := app.normalize_egyptian_phone(p_payload -> 'contact' ->> 'phone');
  if v_phone is null or v_phone !~ '^\+201[0125][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'phone');
  end if;
  v_contact := coalesce(p_payload ->> 'preferredContact', 'whatsapp');
  if v_contact not in ('whatsapp', 'phone') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'preferredContact');
  end if;
  v_locale := case when p_payload ->> 'locale' = 'en' then 'en' else 'ar' end;
  v_bucket := app.service_bucket(p_kind);

  if p_kind = 'repair' then
    v_category := p_payload -> 'device' ->> 'category';
    v_catalog := app.repair_catalog();
    if v_category is null or v_category !~ '^[a-z][a-z0-9_]{1,39}$'
       or (jsonb_array_length(v_catalog) > 0 and not exists (
             select 1 from jsonb_array_elements(v_catalog) c where c ->> 'key' = v_category)) then
      return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'category');
    end if;
    v_brand := app.clean_text(p_payload -> 'device' ->> 'brand', 60);
    v_model := app.clean_text(p_payload -> 'device' ->> 'model', 80);
    if v_brand is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'brand'); end if;
    if v_model is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'model'); end if;
    -- Component / symptom must come from the published diagnostic model (or be left open).
    v_text := p_payload -> 'diagnosis' ->> 'component';
    if v_text is not null then
      select c into v_component
        from jsonb_array_elements(v_catalog) cat, jsonb_array_elements(cat -> 'components') c
        where cat ->> 'key' = v_category and c ->> 'key' = v_text;
      if v_component is null then
        return jsonb_build_object('ok', false, 'code', 'invalid_diagnosis', 'field', 'component');
      end if;
      if p_payload -> 'diagnosis' ->> 'symptom' is not null and not exists (
           select 1 from jsonb_array_elements(v_component -> 'symptoms') s
           where s ->> 'key' = p_payload -> 'diagnosis' ->> 'symptom') then
        return jsonb_build_object('ok', false, 'code', 'invalid_diagnosis', 'field', 'symptom');
      end if;
    elsif p_payload -> 'diagnosis' ->> 'symptom' is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_diagnosis', 'field', 'symptom');
    end if;
    v_text := app.clean_text(p_payload ->> 'description', 2000);
    if v_text is null or char_length(v_text) < 10 then
      return jsonb_build_object('ok', false, 'code', 'invalid_description', 'field', 'description');
    end if;
    v_handoff := coalesce(p_payload ->> 'handoff', 'store_visit');
    if v_handoff not in ('store_visit', 'pickup_delivery') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'handoff');
    end if;
    v_consult := coalesce((p_payload ->> 'consultation')::boolean, false)
                 or coalesce((p_payload -> 'diagnosis' ->> 'unsure')::boolean, false)
                 or p_payload -> 'diagnosis' ->> 'component' is null;
    v_details := jsonb_build_object(
      'diagnosis', jsonb_build_object(
        'component', p_payload -> 'diagnosis' ->> 'component',
        'componentLabel', v_component -> 'label',
        'symptom', p_payload -> 'diagnosis' ->> 'symptom',
        'symptomLabel', (select s -> 'label' from jsonb_array_elements(v_component -> 'symptoms') s
                         where s ->> 'key' = p_payload -> 'diagnosis' ->> 'symptom'),
        'unsure', coalesce((p_payload -> 'diagnosis' ->> 'unsure')::boolean, false),
        'usedViewer', case when p_payload -> 'diagnosis' ->> 'viewer' in ('3d', '2d', 'list', 'none')
                           then p_payload -> 'diagnosis' ->> 'viewer' end),
      'description', v_text);

  elsif p_kind = 'trade_in' then
    v_category := p_payload -> 'current' ->> 'category';
    if v_category is not null and v_category !~ '^[a-z][a-z0-9_]{1,39}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'category');
    end if;
    v_brand := app.clean_text(p_payload -> 'current' ->> 'brand', 60);
    v_model := app.clean_text(p_payload -> 'current' ->> 'model', 80);
    if v_brand is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'brand'); end if;
    if v_model is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'model'); end if;
    if jsonb_typeof(p_payload -> 'current' -> 'batteryHealth') = 'number' then
      v_num := (p_payload -> 'current' ->> 'batteryHealth')::numeric;
      if v_num < 1 or v_num > 100 or v_num <> floor(v_num) then
        return jsonb_build_object('ok', false, 'code', 'invalid_battery', 'field', 'batteryHealth');
      end if;
    elsif p_payload -> 'current' -> 'batteryHealth' is not null and p_payload -> 'current' -> 'batteryHealth' <> 'null'::jsonb then
      return jsonb_build_object('ok', false, 'code', 'invalid_battery', 'field', 'batteryHealth');
    end if;
    if coalesce(p_payload -> 'current' ->> 'taxPaid', 'unknown') not in ('yes', 'no', 'unknown')
       or coalesce(p_payload -> 'current' ->> 'openedBefore', 'unknown') not in ('yes', 'no', 'unknown')
       or coalesce(p_payload -> 'current' ->> 'repairedBefore', 'unknown') not in ('yes', 'no', 'unknown') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'current');
    end if;
    select coalesce(array_agg(distinct a), '{}') into v_arr
      from jsonb_array_elements_text(coalesce(p_payload -> 'current' -> 'accessories', '[]'::jsonb)) a;
    if not v_arr <@ array['box', 'charger', 'cable', 'accessories', 'receipt'] then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'accessories');
    end if;
    v_details := jsonb_build_object('accessories', to_jsonb(v_arr));
    select coalesce(array_agg(distinct c), '{}') into v_arr
      from jsonb_array_elements_text(coalesce(p_payload -> 'current' -> 'conditions', '[]'::jsonb)) c;
    if not v_arr <@ array['none', 'scratches', 'dents', 'broken_glass', 'display', 'camera', 'speaker', 'battery',
                          'opened', 'repaired', 'replaced_parts', 'other']
       or ('none' = any (v_arr) and cardinality(v_arr) > 1) then
      return jsonb_build_object('ok', false, 'code', 'invalid_condition', 'field', 'conditions');
    end if;
    if cardinality(v_arr) = 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_condition', 'field', 'conditions');
    end if;
    v_details := jsonb_build_object('current', jsonb_build_object(
      'category', v_category, 'brand', v_brand, 'model', v_model,
      'storage', app.clean_text(p_payload -> 'current' ->> 'storage', 20),
      'color', app.clean_text(p_payload -> 'current' ->> 'color', 30),
      'batteryHealth', case when jsonb_typeof(p_payload -> 'current' -> 'batteryHealth') = 'number'
                            then (p_payload -> 'current' ->> 'batteryHealth')::integer end,
      'taxPaid', coalesce(p_payload -> 'current' ->> 'taxPaid', 'unknown'),
      'openedBefore', coalesce(p_payload -> 'current' ->> 'openedBefore', 'unknown'),
      'repairedBefore', coalesce(p_payload -> 'current' ->> 'repairedBefore', 'unknown'),
      'accessories', v_details -> 'accessories',
      'conditions', to_jsonb(v_arr),
      'notes', app.clean_text(p_payload -> 'current' ->> 'notes', 2000)));
    -- Target: an exact live catalog variant, or a manual description.
    if app.is_uuid(p_payload -> 'target' ->> 'variantId') then
      v_target := (p_payload -> 'target' ->> 'variantId')::uuid;
      if not exists (
        select 1 from public.product_variants v join public.products p on p.id = v.product_id
        where v.id = v_target and v.is_active and v.deleted_at is null and p.deleted_at is null
          and p.status = 'published' and (not p.is_demo or app.demo_catalog_visible())) then
        return jsonb_build_object('ok', false, 'code', 'invalid_target', 'field', 'target');
      end if;
    elsif p_payload -> 'target' -> 'manual' is not null then
      if app.clean_text(p_payload -> 'target' -> 'manual' ->> 'brand', 60) is null
         or app.clean_text(p_payload -> 'target' -> 'manual' ->> 'model', 80) is null then
        return jsonb_build_object('ok', false, 'code', 'invalid_target', 'field', 'target');
      end if;
      v_details := v_details || jsonb_build_object('target', jsonb_build_object('manual', jsonb_build_object(
        'brand', app.clean_text(p_payload -> 'target' -> 'manual' ->> 'brand', 60),
        'model', app.clean_text(p_payload -> 'target' -> 'manual' ->> 'model', 80),
        'storage', app.clean_text(p_payload -> 'target' -> 'manual' ->> 'storage', 20),
        'color', app.clean_text(p_payload -> 'target' -> 'manual' ->> 'color', 30))));
    else
      return jsonb_build_object('ok', false, 'code', 'invalid_target', 'field', 'target');
    end if;
    v_consult := true;

  elsif p_kind = 'used' then
    v_category := p_payload -> 'device' ->> 'category';
    if v_category is not null and v_category !~ '^[a-z][a-z0-9_]{1,39}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'category');
    end if;
    v_brand := app.clean_text(p_payload -> 'device' ->> 'brand', 60);
    v_model := app.clean_text(p_payload -> 'device' ->> 'model', 80);
    if v_brand is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'brand'); end if;
    if v_model is null then return jsonb_build_object('ok', false, 'code', 'invalid_device', 'field', 'model'); end if;
    if coalesce(p_payload -> 'device' ->> 'batteryPreference', 'none') not in ('90_plus', '85_89', '80_84', 'none') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'batteryPreference');
    end if;
    if coalesce(p_payload -> 'device' ->> 'taxPreference', 'no_preference') not in ('tax_paid', 'not_tax_paid', 'no_preference') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'taxPreference');
    end if;
    if p_payload -> 'device' -> 'budget' is not null and p_payload -> 'device' -> 'budget' <> 'null'::jsonb then
      if jsonb_typeof(p_payload -> 'device' -> 'budget') <> 'number'
         or (p_payload -> 'device' ->> 'budget')::numeric <= 0
         or (p_payload -> 'device' ->> 'budget')::numeric > 10000000 then
        return jsonb_build_object('ok', false, 'code', 'invalid_budget', 'field', 'budget');
      end if;
    end if;
    v_details := jsonb_build_object('device', jsonb_build_object(
      'category', v_category, 'brand', v_brand, 'model', v_model,
      'storage', app.clean_text(p_payload -> 'device' ->> 'storage', 20),
      'color', app.clean_text(p_payload -> 'device' ->> 'color', 30),
      'batteryPreference', coalesce(p_payload -> 'device' ->> 'batteryPreference', 'none'),
      'taxPreference', coalesce(p_payload -> 'device' ->> 'taxPreference', 'no_preference'),
      'budget', case when jsonb_typeof(p_payload -> 'device' -> 'budget') = 'number'
                     then round((p_payload -> 'device' ->> 'budget')::numeric, 2) end,
      'notes', app.clean_text(p_payload -> 'device' ->> 'notes', 2000)));
    v_media := null; -- Used requests carry no customer media (staff attach proposal photos).

  else -- after_sales
    v_type := p_payload ->> 'type';
    if v_type is null or v_type not in ('exchange', 'return', 'warranty') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'type');
    end if;
    -- The customer can only choose a line from an order they own (never a forged id pair).
    if not app.is_uuid(p_payload ->> 'orderItemId') then
      return jsonb_build_object('ok', false, 'code', 'not_eligible', 'field', 'orderItemId');
    end if;
    select i.* into v_item from public.order_items i where i.id = (p_payload ->> 'orderItemId')::uuid;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_eligible', 'field', 'orderItemId'); end if;
    select * into v_order from public.orders where id = v_item.order_id;
    if v_order.customer_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'code', 'not_eligible', 'field', 'orderItemId');
    end if;
    if v_order.status not in ('delivered', 'completed') then
      return jsonb_build_object('ok', false, 'code', 'not_delivered', 'field', 'orderItemId');
    end if;
    if exists (select 1 from public.service_requests where order_item_id = v_item.id and after_sales_type = v_type
               and not app.service_status_terminal(status)) then
      return jsonb_build_object('ok', false, 'code', 'duplicate_open', 'field', 'orderItemId');
    end if;
    if coalesce(p_payload ->> 'reason', '') not in ('defective', 'damaged_on_arrival', 'wrong_item', 'not_as_described',
                                                    'changed_mind', 'warranty_issue', 'other') then
      return jsonb_build_object('ok', false, 'code', 'invalid_reason', 'field', 'reason');
    end if;
    v_text := app.clean_text(p_payload ->> 'description', 2000);
    if v_text is null or char_length(v_text) < 10 then
      return jsonb_build_object('ok', false, 'code', 'invalid_description', 'field', 'description');
    end if;
    -- Policy acknowledgement must be for the currently published policy version.
    if coalesce((p_payload ->> 'policyAccepted')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'code', 'policy_required', 'field', 'policy');
    end if;
    if p_payload ->> 'policyVersion' is distinct from (app.services_config() -> 'afterSales' ->> 'policyVersion') then
      return jsonb_build_object('ok', false, 'code', 'policy_changed', 'field', 'policy');
    end if;
    v_details := jsonb_build_object('reason', p_payload ->> 'reason', 'description', v_text,
                                    'product', jsonb_build_object('name', v_item.product_name, 'sku', v_item.sku));
  end if;

  v_problem := app.service_media_problem(v_bucket, v_media, v_uid, null, true);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', v_problem, 'field', 'media');
  end if;

  insert into public.service_requests (
    kind, request_number, user_id, idempotency_key, status, contact_name, contact_phone, preferred_contact, handoff,
    device_category, brand, model, details, consultation_required, order_id, order_item_id, after_sales_type,
    policy_version, target_variant_id, locale, is_demo)
  values (
    p_kind, app.next_service_number(p_kind), v_uid, v_key, 'new', v_name, v_phone, v_contact, v_handoff,
    v_category, v_brand, v_model, v_details, v_consult, v_order.id, v_item.id, v_type,
    case when p_kind = 'after_sales' then p_payload ->> 'policyVersion' end, v_target, v_locale,
    coalesce(v_order.is_demo, false))
  returning * into r;

  perform app.insert_service_media(r.id, v_bucket, v_media, v_uid, 'customer', null, r.is_demo);
  insert into public.service_events (request_id, event_type, status, visible_to_customer, actor_id, actor_kind, data)
  values (r.id, 'created', 'new', true, v_uid, 'customer',
          jsonb_build_object('media', coalesce(jsonb_array_length(case when jsonb_typeof(v_media) = 'array' then v_media end), 0)));

  return jsonb_build_object('ok', true, 'request', jsonb_build_object('id', r.id, 'number', r.request_number,
                                                                      'status', r.status));
exception
  when unique_violation then
    -- A concurrent retry with the same key won the race: return its request.
    select * into v_existing from public.service_requests where user_id = v_uid and idempotency_key = v_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true,
                                'request', jsonb_build_object('id', v_existing.id, 'number', v_existing.request_number,
                                                              'status', v_existing.status));
    end if;
    return jsonb_build_object('ok', false, 'code', 'media_in_use', 'field', 'media');
end;
$$;

create or replace function public.list_my_service_requests(p_kind text default null, p_status text default null,
                                                           p_limit integer default 50, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.service_requests r
              where r.user_id = app.require_customer()
                and (p_kind is null or r.kind = p_kind) and (p_status is null or r.status = p_status)),
    'items', coalesce((select jsonb_agg(app.service_summary_json(r) order by r.created_at desc)
                       from (select * from public.service_requests r
                             where r.user_id = app.require_customer()
                               and (p_kind is null or r.kind = p_kind) and (p_status is null or r.status = p_status)
                             order by r.created_at desc
                             limit least(greatest(coalesce(p_limit, 50), 1), 100)
                             offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
$$;

create or replace function public.get_my_service_request(p_number text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.service_request_json(r.id, false)
  from public.service_requests r
  where r.request_number = upper(btrim(p_number)) and r.user_id = app.require_customer();
$$;

create or replace function public.cancel_my_service_request(p_number text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  r public.service_requests;
begin
  select * into r from public.service_requests
    where request_number = upper(btrim(p_number)) and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not app.service_customer_can_cancel(r.kind, r.status) then
    return jsonb_build_object('ok', false, 'code', 'cannot_cancel');
  end if;
  update public.service_requests set status = 'cancelled', closed_at = now(), awaiting_customer = false
    where id = r.id;
  update public.service_offers set status = 'withdrawn' where request_id = r.id and status = 'sent';
  insert into public.service_events (request_id, event_type, status, from_status, message, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'status', 'cancelled', r.status, app.clean_text(p_reason, 500), true, v_uid, 'customer');
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, false));
end;
$$;

-- Answer a staff information request (message and/or more media).
create or replace function public.respond_my_service_request(p_number text, p_message text, p_media jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  r public.service_requests;
  v_message text := app.clean_text(p_message, 2000);
  v_problem text;
  v_count integer;
begin
  select * into r from public.service_requests
    where request_number = upper(btrim(p_number)) and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if app.service_status_terminal(r.status) then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if r.kind = 'used' and p_media is not null and jsonb_array_length(p_media) > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_media', 'field', 'media');
  end if;
  if v_message is null and (p_media is null or jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) = 0) then
    return jsonb_build_object('ok', false, 'code', 'message_required', 'field', 'message');
  end if;
  v_problem := app.service_media_problem(app.service_bucket(r.kind), p_media, v_uid, r.id, true);
  if v_problem is not null then return jsonb_build_object('ok', false, 'code', v_problem, 'field', 'media'); end if;
  v_count := app.insert_service_media(r.id, app.service_bucket(r.kind), p_media, v_uid, 'customer', null, r.is_demo);
  update public.service_requests
    set awaiting_customer = false,
        status = case when r.kind = 'trade_in' and r.status = 'need_more_info' then 'under_review' else status end
    where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, message, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'customer_response',
          case when r.kind = 'trade_in' and r.status = 'need_more_info' then 'under_review' end,
          case when r.kind = 'trade_in' and r.status = 'need_more_info' then r.status end,
          v_message, jsonb_build_object('media', v_count), true, v_uid, 'customer');
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, false));
end;
$$;

-- Accept / decline a quote, valuation or proposal addressed to the caller.
create or replace function public.respond_my_service_offer(p_offer_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  o public.service_offers;
  r public.service_requests;
  v_status text;
begin
  if p_decision not in ('accept', 'decline') then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  select o2.* into o from public.service_offers o2
    join public.service_requests r2 on r2.id = o2.request_id
    where o2.id = p_offer_id and r2.user_id = v_uid for update of o2;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select * into r from public.service_requests where id = o.request_id for update;
  if o.status <> 'sent' or app.service_status_terminal(r.status) then
    return jsonb_build_object('ok', false, 'code', 'offer_closed');
  end if;
  if o.expires_at is not null and o.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'offer_expired');
  end if;
  v_status := case
    when o.kind in ('repair_estimate', 'repair_final') then case when p_decision = 'accept' then 'customer_approved' else 'under_review' end
    when o.kind = 'trade_in' then case when p_decision = 'accept' then 'customer_accepted' else 'customer_declined' end
    else case when p_decision = 'accept' then 'customer_interested' else 'searching' end end;
  update public.service_offers set status = case when p_decision = 'accept' then 'accepted' else 'declined' end,
                                   responded_at = now()
    where id = o.id;
  update public.service_requests set status = v_status, awaiting_customer = false where id = r.id;
  insert into public.service_events (request_id, event_type, status, from_status, message, data, visible_to_customer,
                                     actor_id, actor_kind)
  values (r.id, 'offer_response', v_status, r.status, app.clean_text(p_note, 1000),
          jsonb_build_object('offerId', o.id, 'decision', p_decision), true, v_uid, 'customer');
  return jsonb_build_object('ok', true, 'request', app.service_request_json(r.id, false));
end;
$$;

-- Purchased lines the caller may open an after-sales request for (delivered / completed orders).
create or replace function public.list_my_after_sales_items()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id, 'orderNumber', o.order_number, 'orderStatus', o.status, 'orderDate', o.created_at,
    'itemId', i.id, 'name', i.product_name, 'variantLabel', i.variant_label, 'sku', i.sku,
    'image', i.image_url, 'quantity', i.quantity, 'isGift', i.is_gift, 'warranty', i.warranty,
    'openRequests', (select coalesce(jsonb_agg(jsonb_build_object('type', s.after_sales_type, 'number', s.request_number)), '[]'::jsonb)
                     from public.service_requests s where s.order_item_id = i.id and not app.service_status_terminal(s.status)))
    order by o.created_at desc, i.line_no), '[]'::jsonb)
  from public.orders o
  join public.order_items i on i.order_id = o.id
  where o.customer_id = app.require_customer() and o.status in ('delivered', 'completed');
$$;

revoke all on function app.clean_text(text, integer), app.egp_text(numeric), app.service_bucket(text),
  app.service_media_mime_for_ext(text), app.service_media_problem(text, jsonb, uuid, uuid, boolean),
  app.insert_service_media(uuid, text, jsonb, uuid, text, uuid, boolean),
  app.service_notify(uuid, text, text, numeric), app.service_status_template(text, text),
  app.service_offer_json(public.service_offers), app.service_request_title(public.service_requests),
  app.service_summary_json(public.service_requests), app.service_request_json(uuid, boolean),
  app.next_service_number(text), app.services_config(), app.services_int(text, text, integer, integer, integer),
  app.service_enabled(text), app.repair_catalog()
  from public, anon, authenticated;
revoke all on function public.create_service_request(text, jsonb),
  public.list_my_service_requests(text, text, integer, integer), public.get_my_service_request(text),
  public.cancel_my_service_request(text, text), public.respond_my_service_request(text, text, jsonb),
  public.respond_my_service_offer(uuid, text, text), public.list_my_after_sales_items()
  from public, anon;
grant execute on function public.create_service_request(text, jsonb),
  public.list_my_service_requests(text, text, integer, integer), public.get_my_service_request(text),
  public.cancel_my_service_request(text, text), public.respond_my_service_request(text, text, jsonb),
  public.respond_my_service_offer(uuid, text, text), public.list_my_after_sales_items()
  to authenticated;
