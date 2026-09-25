-- ════════════════════════════════════════════════════════════════════════════
-- Phase 05 · Service experiences: request model (repairs, trade-in, used-device requests,
-- after-sales), human request numbers, timeline, staff offers (quotes / valuations / proposals),
-- private request media, RLS, storage policies and the "service" notification category.
--
-- Settings (contract: src/domain/settings/setting-definitions.json):
--   services        (public)  enabled services, media limits, trade-in offer validity,
--                             after-sales policy version, open-request limit
--   repair_catalog  (public)  data-driven diagnostic model: device category → component → symptoms
--
-- Rules:
--   * Customers create and read only their own requests (RPCs + RLS; no direct writes).
--   * Money (repair quotes, trade-in valuations, used-device prices) is staff-controlled, audited,
--     stored as numeric(12,2); the trade-in difference is computed by the database.
--   * Internal notes are timeline events with visible_to_customer = false — never exposed to the
--     customer RPCs or RLS.
--   * Request media lives in private buckets; customers read their own uploads and media attached
--     to their own requests; staff read by bucket permission; anonymous users read nothing.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('services',       'settings', true, 'settings.manage', 'settings.publish'),
  ('repair_catalog', 'settings', true, 'settings.manage', 'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- Safe defaults; published values override per top-level section.
create or replace function app.services_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', jsonb_build_object('repairs', true, 'tradeIn', true, 'used', true, 'afterSales', true),
    'media', jsonb_build_object('maxFiles', 8, 'maxVideos', 1, 'allowVideo', true,
                                'maxImageBytes', 8388608, 'maxVideoBytes', 26214400,
                                'imageMaxDimension', 2560, 'imageQuality', 0.85),
    'tradeIn', jsonb_build_object('offerValidityDays', 7),
    'afterSales', jsonb_build_object('policyVersion', '1'),
    'requests', jsonb_build_object('maxOpenPerCustomer', 10))
  || coalesce((select value from public.site_settings where key = 'services'), '{}'::jsonb);
$$;

create or replace function app.services_int(p_section text, p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(greatest(coalesce(
    case when jsonb_typeof(app.services_config() -> p_section -> p_key) = 'number'
         then floor((app.services_config() -> p_section ->> p_key)::numeric)::integer end,
    p_default), p_min), p_max);
$$;

create or replace function app.service_enabled(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((app.services_config() -> 'enabled' ->> case p_kind
    when 'repair' then 'repairs' when 'trade_in' then 'tradeIn'
    when 'used' then 'used' when 'after_sales' then 'afterSales' end)::boolean, false);
$$;

-- The published repair catalog (categories → components → symptoms). Empty when unpublished:
-- repairs still work as "I'm not sure" consultations.
create or replace function app.repair_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value -> 'categories' from public.site_settings where key = 'repair_catalog'), '[]'::jsonb);
$$;

-- ── Status catalog (mirrors src/domain/services/status.ts) ─────────────────────
create or replace function app.service_statuses(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'repair' then array['new', 'under_review', 'consultation_required', 'device_received', 'diagnosing',
                             'quote_sent', 'customer_approved', 'repairing', 'quality_check', 'ready',
                             'completed', 'cancelled']
    when 'trade_in' then array['new', 'under_review', 'need_more_info', 'inspection_required', 'valuation_ready',
                               'offer_sent', 'customer_accepted', 'customer_declined', 'device_received',
                               'completed', 'rejected', 'cancelled']
    when 'used' then array['new', 'searching', 'option_found', 'offer_sent', 'customer_interested', 'reserved',
                           'completed', 'not_available', 'cancelled']
    when 'after_sales' then array['new', 'under_review', 'approved', 'rejected', 'item_received', 'inspection',
                                  'exchange_handling', 'refund_handling', 'warranty_handling', 'completed',
                                  'cancelled']
    else array[]::text[] end;
$$;

create or replace function app.service_status_valid(p_kind text, p_status text, p_after_sales_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = any (app.service_statuses(p_kind))
     -- After-sales handling states are only relevant to their own request type.
     and not (p_kind = 'after_sales' and (
          (p_status = 'exchange_handling' and p_after_sales_type is distinct from 'exchange')
       or (p_status = 'refund_handling' and p_after_sales_type is distinct from 'return')
       or (p_status = 'warranty_handling' and p_after_sales_type is distinct from 'warranty')));
$$;

create or replace function app.service_status_terminal(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('completed', 'cancelled', 'rejected', 'not_available');
$$;

-- Early states in which the customer may still cancel on their own.
create or replace function app.service_customer_can_cancel(p_kind text, p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'repair' then p_status in ('new', 'under_review', 'consultation_required', 'quote_sent')
    when 'trade_in' then p_status in ('new', 'under_review', 'need_more_info', 'inspection_required',
                                      'valuation_ready', 'offer_sent', 'customer_declined')
    when 'used' then p_status in ('new', 'searching', 'option_found', 'offer_sent')
    when 'after_sales' then p_status in ('new', 'under_review')
    else false end;
$$;

create or replace function app.service_permission(p_kind text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'repair' then 'repairs.'
    when 'trade_in' then 'tradein.'
    when 'used' then 'used_requests.'
    when 'after_sales' then 'after_sales.'
  end || case when p_action = 'manage' then 'manage' else 'view' end;
$$;

create or replace function app.service_number_prefix(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'repair' then 'RP' when 'trade_in' then 'TI' when 'used' then 'UD'
                     when 'after_sales' then 'AS' end;
$$;

create sequence if not exists public.service_repair_seq as bigint start 1;
create sequence if not exists public.service_trade_in_seq as bigint start 1;
create sequence if not exists public.service_used_seq as bigint start 1;
create sequence if not exists public.service_after_sales_seq as bigint start 1;
revoke all on sequence public.service_repair_seq, public.service_trade_in_seq, public.service_used_seq,
  public.service_after_sales_seq from public, anon, authenticated;

-- Human request number (RP-2026-000001 …); never used as a primary key.
create or replace function app.next_service_number(p_kind text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  v_seq := case p_kind
    when 'repair' then nextval('public.service_repair_seq')
    when 'trade_in' then nextval('public.service_trade_in_seq')
    when 'used' then nextval('public.service_used_seq')
    when 'after_sales' then nextval('public.service_after_sales_seq') end;
  if v_seq is null then
    raise exception 'unknown service kind %', p_kind using errcode = '22023';
  end if;
  return app.service_number_prefix(p_kind) || '-' || to_char(now() at time zone 'Africa/Cairo', 'YYYY') || '-'
         || lpad(v_seq::text, 6, '0');
end;
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────────
create table if not exists public.service_requests (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('repair', 'trade_in', 'used', 'after_sales')),
  request_number         text not null unique check (request_number ~ '^(RP|TI|UD|AS)-[0-9]{4}-[0-9]{6,}$'),
  user_id                uuid references auth.users (id) on delete cascade,
  idempotency_key        uuid,
  status                 text not null default 'new',
  contact_name           text not null check (char_length(btrim(contact_name)) between 2 and 120),
  contact_phone          text not null check (contact_phone ~ '^\+201[0125][0-9]{8}$'),
  preferred_contact      text not null default 'whatsapp' check (preferred_contact in ('whatsapp', 'phone')),
  handoff                text check (handoff in ('store_visit', 'pickup_delivery')),
  -- Summary fields for lists and search (full customer input lives in details).
  device_category        text check (device_category is null or device_category ~ '^[a-z][a-z0-9_]{1,39}$'),
  brand                  text check (brand is null or char_length(brand) <= 60),
  model                  text check (model is null or char_length(model) <= 80),
  details                jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  consultation_required  boolean not null default false,
  awaiting_customer      boolean not null default false,
  -- After-sales: the purchased line the request is about (ownership validated by the RPC).
  order_id               uuid references public.orders (id) on delete restrict,
  order_item_id          uuid references public.order_items (id) on delete restrict,
  after_sales_type       text check (after_sales_type in ('exchange', 'return', 'warranty')),
  policy_version         text check (policy_version is null or char_length(policy_version) <= 40),
  -- Trade-in: the exact catalog variant the customer wants (null = manual target in details).
  target_variant_id      uuid references public.product_variants (id) on delete set null,
  assigned_to            uuid references auth.users (id) on delete set null,
  locale                 text not null default 'ar' check (locale in ('ar', 'en')),
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  closed_at              timestamptz,
  check (user_id is not null or is_demo),
  check (app.service_status_valid(kind, status, after_sales_type)),
  check ((kind = 'after_sales') = (after_sales_type is not null)),
  check (kind <> 'after_sales' or is_demo or (order_id is not null and order_item_id is not null)),
  unique (user_id, idempotency_key)
);

create index if not exists service_requests_user_idx on public.service_requests (user_id, created_at desc);
create index if not exists service_requests_kind_status_idx on public.service_requests (kind, status, created_at desc);
create index if not exists service_requests_assigned_idx on public.service_requests (assigned_to) where assigned_to is not null;

drop trigger if exists service_requests_updated_at on public.service_requests;
create trigger service_requests_updated_at before update on public.service_requests
  for each row execute function app.set_updated_at();

-- Append-only timeline. visible_to_customer = false ⇒ internal (staff notes, assignment, audit trail).
create table if not exists public.service_events (
  id                   bigint generated always as identity primary key,
  request_id           uuid not null references public.service_requests (id) on delete cascade,
  event_type           text not null check (event_type in ('created', 'status', 'note', 'update', 'info_requested',
                                                           'customer_response', 'offer', 'offer_response',
                                                           'assignment', 'media')),
  status               text,
  from_status          text,
  message              text check (message is null or char_length(message) <= 2000),
  data                 jsonb not null default '{}'::jsonb,
  visible_to_customer  boolean not null,
  actor_id             uuid,
  actor_kind           text not null check (actor_kind in ('customer', 'staff', 'system')),
  created_at           timestamptz not null default now()
);
create index if not exists service_events_request_idx on public.service_events (request_id, id);

-- Staff offers: repair estimate / final quote, trade-in valuation, used-device proposal.
create table if not exists public.service_offers (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.service_requests (id) on delete cascade,
  kind             text not null check (kind in ('repair_estimate', 'repair_final', 'trade_in', 'used_proposal')),
  status           text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'superseded', 'withdrawn')),
  amount           numeric(12, 2) check (amount is null or amount >= 0),
  device_value     numeric(12, 2) check (device_value is null or device_value >= 0),
  target_price     numeric(12, 2) check (target_price is null or target_price >= 0),
  difference       numeric(12, 2),
  target_snapshot  jsonb,
  device           jsonb,
  note             text check (note is null or char_length(note) <= 1000),
  inspection_note  text check (inspection_note is null or char_length(inspection_note) <= 1000),
  expires_at       timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  is_demo          boolean not null default false,
  check (kind = 'trade_in' or amount is not null),
  check (kind <> 'trade_in' or (device_value is not null and target_price is not null
                                and difference = target_price - device_value))
);
create index if not exists service_offers_request_idx on public.service_offers (request_id, created_at desc);
-- At most one open offer per request.
create unique index if not exists service_offers_one_open on public.service_offers (request_id) where status = 'sent';

create table if not exists public.service_media (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.service_requests (id) on delete cascade,
  offer_id      uuid references public.service_offers (id) on delete cascade,
  bucket        text not null check (bucket in ('repairs', 'trade-in', 'after-sales', 'used-requests')),
  path          text not null check (char_length(path) <= 300),
  media_type    text not null check (media_type in ('image', 'video')),
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  width         integer check (width is null or width between 1 and 20000),
  height        integer check (height is null or height between 1 and 20000),
  label         text check (label is null or label ~ '^[a-z][a-z_]{1,30}$'),
  uploaded_by   uuid,
  uploader_kind text not null check (uploader_kind in ('customer', 'staff')),
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists service_media_request_idx on public.service_media (request_id);

-- ── RLS: owner or the kind's view permission; no direct writes ─────────────────
alter table public.service_requests enable row level security;
alter table public.service_events enable row level security;
alter table public.service_offers enable row level security;
alter table public.service_media enable row level security;
revoke insert, update, delete, truncate on public.service_requests, public.service_events,
  public.service_offers, public.service_media from anon, authenticated;
revoke all on public.service_requests, public.service_events, public.service_offers, public.service_media from anon;

create or replace function app.can_view_service_request(p_request uuid, p_customer_visible_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.service_requests r
    where r.id = p_request
      and (r.user_id = app.current_actor_id() or app.has_permission(app.service_permission(r.kind, 'view'))));
$$;

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated
  using (user_id = (select app.current_actor_id()) or app.has_permission(app.service_permission(kind, 'view')));

drop policy if exists service_events_select on public.service_events;
create policy service_events_select on public.service_events for select to authenticated
  using (exists (select 1 from public.service_requests r where r.id = request_id
                   and ((r.user_id = (select app.current_actor_id()) and visible_to_customer)
                        or app.has_permission(app.service_permission(r.kind, 'view')))));

drop policy if exists service_offers_select on public.service_offers;
create policy service_offers_select on public.service_offers for select to authenticated
  using (app.can_view_service_request(request_id));

drop policy if exists service_media_select on public.service_media;
create policy service_media_select on public.service_media for select to authenticated
  using (app.can_view_service_request(request_id));

-- Audit every change to offers and media (money and evidence).
drop trigger if exists service_offers_audit on public.service_offers;
create trigger service_offers_audit after insert or update or delete on public.service_offers
  for each row execute function app.audit_row_change();
drop trigger if exists service_requests_audit on public.service_requests;
create trigger service_requests_audit after update or delete on public.service_requests
  for each row execute function app.audit_row_change();

select app.register_demo_table('public.service_media', 1);
select app.register_demo_table('public.service_offers', 1);
select app.register_demo_table('public.service_requests', 2);

-- ── Storage: private used-proposal bucket + request-scoped read access ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('used-requests', 'used-requests', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.storage_staff_permission(p_bucket text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket = 'products'      then 'catalog.manage'
    when p_bucket = 'banners'       then 'content.manage'
    when p_bucket = 'site-media'    then case when p_action = 'read' then 'content.view' else 'design.edit' end
    when p_bucket = 'repairs'       then case when p_action = 'read' then 'repairs.view' else 'repairs.manage' end
    when p_bucket = 'trade-in'      then case when p_action = 'read' then 'tradein.view' else 'tradein.manage' end
    when p_bucket = 'after-sales'   then case when p_action = 'read' then 'after_sales.view' else 'after_sales.manage' end
    when p_bucket = 'used-requests' then case when p_action = 'read' then 'used_requests.view' else 'used_requests.manage' end
    when p_bucket = 'reviews'       then 'reviews.moderate'
    when p_bucket = 'avatars'       then case when p_action = 'read' then 'customers.view' else 'customers.manage' end
    when p_bucket = 'invoices'      then case when p_action = 'read' then 'orders.view' else 'orders.manage' end
  end;
$$;

-- A customer can also read files staff attached to *their own* request (e.g. used-device photos).
create or replace function app.service_media_visible_to_actor(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.service_media m
    join public.service_requests r on r.id = m.request_id
    where m.bucket = p_bucket and m.path = p_name and r.user_id = app.current_actor_id());
$$;
grant execute on function app.service_media_visible_to_actor(text, text) to authenticated;

drop policy if exists "malek service media owner read" on storage.objects;
create policy "malek service media owner read" on storage.objects for select to authenticated
  using (bucket_id in ('repairs', 'trade-in', 'after-sales', 'used-requests')
         and app.service_media_visible_to_actor(bucket_id, name));

-- ── Notifications: "service" category (transactional, like orders) ────────────
alter table public.notification_templates drop constraint if exists notification_templates_category_check;
alter table public.notification_templates add constraint notification_templates_category_check
  check (category in ('order', 'service', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account'));
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('order', 'service', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account'));
alter table public.notification_preferences drop constraint if exists notification_preferences_category_check;
alter table public.notification_preferences add constraint notification_preferences_category_check
  check (category in ('order', 'service', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account'));

create or replace function app.notification_category_mandatory(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_category in ('order', 'service', 'account');
$$;

insert into public.notification_templates (key, category, title, body) values
  ('service.updated', 'service', '{"ar": "تحديث على طلبك", "en": "Update on your request"}',
   '{"ar": "في تحديث جديد على الطلب {{code}}. افتح الطلب لتشوف التفاصيل.", "en": "There is a new update on request {{code}}. Open it to see the details."}'),
  ('service.info_needed', 'service', '{"ar": "محتاجين معلومات إضافية", "en": "We need a bit more information"}',
   '{"ar": "فريقنا محتاج تفاصيل أو صور إضافية للطلب {{code}}.", "en": "Our team needs more details or photos for request {{code}}."}'),
  ('service.cancelled', 'service', '{"ar": "تم إلغاء الطلب", "en": "Request cancelled"}',
   '{"ar": "تم إلغاء الطلب {{code}}. لو محتاج مساعدة تواصل معانا.", "en": "Request {{code}} was cancelled. Contact us if you need help."}'),
  ('service.repair.quote_ready', 'service', '{"ar": "عرض سعر الصيانة جاهز", "en": "Your repair quote is ready"}',
   '{"ar": "أرسلنا عرض سعر للطلب {{code}} بقيمة {{amount}}. راجعه من حسابك.", "en": "We sent a quote of {{amount}} for request {{code}}. Review it in your account."}'),
  ('service.repair.ready', 'service', '{"ar": "جهازك جاهز", "en": "Your device is ready"}',
   '{"ar": "الطلب {{code}}: جهازك جاهز للاستلام أو التوصيل.", "en": "Request {{code}}: your device is ready for pickup or delivery."}'),
  ('service.trade_in.inspection', 'service', '{"ar": "مطلوب فحص الجهاز", "en": "Device inspection required"}',
   '{"ar": "الطلب {{code}}: محتاجين نفحص الجهاز في الفرع قبل التقييم النهائي.", "en": "Request {{code}}: we need to inspect the device in store before the final valuation."}'),
  ('service.trade_in.offer_ready', 'service', '{"ar": "عرض الاستبدال جاهز", "en": "Your trade-in offer is ready"}',
   '{"ar": "الطلب {{code}}: قيمة جهازك الحالي {{amount}}. راجع العرض من حسابك.", "en": "Request {{code}}: your current device is valued at {{amount}}. Review the offer in your account."}'),
  ('service.trade_in.rejected', 'service', '{"ar": "تعذر إتمام الاستبدال", "en": "Trade-in not possible"}',
   '{"ar": "للأسف مش هنقدر نكمل طلب الاستبدال {{code}}. تفاصيل أكتر في حسابك.", "en": "Unfortunately we cannot continue trade-in request {{code}}. More details are in your account."}'),
  ('service.used.option_found', 'service', '{"ar": "لقينا جهاز مناسب", "en": "We found a device for you"}',
   '{"ar": "الطلب {{code}}: لقينا جهاز مستعمل مناسب بسعر {{amount}}. شوف التفاصيل والصور.", "en": "Request {{code}}: we found a matching used device for {{amount}}. See the details and photos."}'),
  ('service.used.offer_sent', 'service', '{"ar": "العرض جاهز", "en": "Your offer is ready"}',
   '{"ar": "الطلب {{code}}: العرض النهائي جاهز في حسابك.", "en": "Request {{code}}: the final offer is ready in your account."}'),
  ('service.used.not_available', 'service', '{"ar": "الجهاز غير متاح حاليًا", "en": "Device not available right now"}',
   '{"ar": "للأسف ملقيناش جهاز مناسب للطلب {{code}} حاليًا.", "en": "Unfortunately we could not find a matching device for request {{code}} right now."}'),
  ('service.after_sales.approved', 'service', '{"ar": "تمت الموافقة على طلبك", "en": "Your request was approved"}',
   '{"ar": "الطلب {{code}} اتقبل. هنتواصل معاك بالخطوات الجاية.", "en": "Request {{code}} was approved. We will contact you with the next steps."}'),
  ('service.after_sales.rejected', 'service', '{"ar": "لم تتم الموافقة على طلبك", "en": "Your request was not approved"}',
   '{"ar": "الطلب {{code}} اترفض. السبب موجود في تفاصيل الطلب.", "en": "Request {{code}} was not approved. The reason is in the request details."}'),
  ('service.after_sales.inspection', 'service', '{"ar": "جاري فحص المنتج", "en": "Your item is being inspected"}',
   '{"ar": "الطلب {{code}}: استلمنا المنتج وبدأنا الفحص.", "en": "Request {{code}}: we received the item and started the inspection."}'),
  ('service.after_sales.completed', 'service', '{"ar": "تم إنهاء طلبك", "en": "Your request is complete"}',
   '{"ar": "الطلب {{code}} خلص. شكرًا لثقتك في ملك ستور.", "en": "Request {{code}} is complete. Thank you for choosing Malek Store."}')
on conflict (key) do update set category = excluded.category, title = excluded.title, body = excluded.body;

-- Preferences list now includes the (mandatory) service category.
create or replace function public.get_my_notification_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object(
    'category', c.category,
    'mandatory', app.notification_category_mandatory(c.category),
    'channels', (select jsonb_object_agg(ch.channel, jsonb_build_object(
        'available', app.notification_channel_available(ch.channel),
        'enabled', case
          when not app.notification_channel_available(ch.channel) then false
          when ch.channel = 'in_app' and app.notification_category_mandatory(c.category) then true
          else coalesce((select p.enabled from public.notification_preferences p
                         where p.user_id = app.require_customer() and p.category = c.category and p.channel = ch.channel),
                        ch.channel = 'in_app') end))
      from unnest(array['in_app', 'email', 'whatsapp', 'sms']) ch(channel)))
    order by c.ord)
  from unnest(array['order', 'service', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart']) with ordinality c(category, ord);
$$;
