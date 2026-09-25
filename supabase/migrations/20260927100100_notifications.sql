-- ════════════════════════════════════════════════════════════════════════════
-- Phase 04 · Notification framework (in-app first, free).
--
--   notification_templates     localized title/body with a closed set of {{placeholders}}
--   notifications              one row per user + event; unique (user_id, dedupe_key) = idempotent
--   notification_preferences   per user × category × channel
--   notification_deliveries    attempts for OPTIONAL external channels (email / WhatsApp / SMS).
--                              All external channels are disabled by default (setting `notifications`),
--                              so V1 creates no delivery rows and needs no paid provider.
--
-- Everything is created by SECURITY DEFINER code (triggers, processing functions, staff RPCs).
-- Customers can read and mark-read only their own notifications; nobody can create one for
-- another user from the client.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_templates (
  key          text primary key check (key ~ '^[a-z][a-z_]*(\.[a-z_]+)+$'),
  category     text not null check (category in ('order', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account')),
  title        public.localized_text not null,
  body         public.localized_text not null,
  is_active    boolean not null default true,
  updated_at   timestamptz not null default now()
);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category     text not null check (category in ('order', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account')),
  template_key text,
  title        public.localized_text not null,
  body         public.localized_text not null,
  -- Internal path only (never an external URL).
  action_path  text check (action_path is null or action_path ~ '^/[A-Za-z0-9/_.?=&%-]*$'),
  data         jsonb not null default '{}'::jsonb,
  dedupe_key   text not null check (char_length(dedupe_key) between 3 and 200),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  is_demo      boolean not null default false,
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.notification_preferences (
  user_id     uuid not null references auth.users (id) on delete cascade,
  category    text not null check (category in ('order', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart', 'account')),
  channel     text not null check (channel in ('in_app', 'email', 'whatsapp', 'sms')),
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, category, channel)
);

create table if not exists public.notification_deliveries (
  id               bigint generated always as identity primary key,
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  channel          text not null check (channel in ('email', 'whatsapp', 'sms')),
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider         text,
  attempts         integer not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (notification_id, channel)
);

alter table public.notification_templates enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_templates, public.notifications, public.notification_preferences,
  public.notification_deliveries from anon;
revoke insert, update, delete, truncate on public.notification_templates, public.notifications,
  public.notification_preferences, public.notification_deliveries from authenticated;

drop policy if exists notifications_owner_select on public.notifications;
create policy notifications_owner_select on public.notifications for select to authenticated
  using (user_id = (select app.current_actor_id()) or (select app.has_permission('notifications.manage')));
drop policy if exists notification_preferences_owner_select on public.notification_preferences;
create policy notification_preferences_owner_select on public.notification_preferences for select to authenticated
  using (user_id = (select app.current_actor_id()));
drop policy if exists notification_templates_staff_select on public.notification_templates;
create policy notification_templates_staff_select on public.notification_templates for select to authenticated
  using ((select app.has_permission('notifications.manage')));
drop policy if exists notification_deliveries_staff_select on public.notification_deliveries;
create policy notification_deliveries_staff_select on public.notification_deliveries for select to authenticated
  using ((select app.has_permission('notifications.manage')));

drop trigger if exists notification_templates_audit on public.notification_templates;
create trigger notification_templates_audit after insert or update or delete on public.notification_templates
  for each row execute function app.audit_row_change('key');

select app.register_demo_table('public.notifications', 4);

-- ── Templates (editable by staff later; Phase 06 UI) ─────────────────────────
insert into public.notification_templates (key, category, title, body) values
  ('order.confirmed', 'order', '{"ar": "تم تأكيد طلبك", "en": "Your order is confirmed"}',
   '{"ar": "الطلب {{order_number}} اتأكد. هنجهزه ونبلغك بكل خطوة.", "en": "Order {{order_number}} is confirmed. We will prepare it and keep you posted."}'),
  ('order.preparing', 'order', '{"ar": "جاري تجهيز طلبك", "en": "We are preparing your order"}',
   '{"ar": "بدأنا نجهز الطلب {{order_number}}.", "en": "We have started preparing order {{order_number}}."}'),
  ('order.ready_for_pickup', 'order', '{"ar": "طلبك جاهز للاستلام", "en": "Your order is ready for pickup"}',
   '{"ar": "الطلب {{order_number}} جاهز في الفرع.", "en": "Order {{order_number}} is ready at the store."}'),
  ('order.out_for_delivery', 'order', '{"ar": "طلبك خرج للتوصيل", "en": "Your order is out for delivery"}',
   '{"ar": "الطلب {{order_number}} في الطريق إليك.", "en": "Order {{order_number}} is on its way."}'),
  ('order.delivered', 'order', '{"ar": "تم توصيل طلبك", "en": "Your order was delivered"}',
   '{"ar": "تم توصيل الطلب {{order_number}}. نتمنى يعجبك!", "en": "Order {{order_number}} was delivered. We hope you enjoy it!"}'),
  ('order.completed', 'order', '{"ar": "اكتمل طلبك", "en": "Your order is complete"}',
   '{"ar": "الطلب {{order_number}} اكتمل. تقدر تقيّم منتجاتك من حسابك.", "en": "Order {{order_number}} is complete. You can review your products from your account."}'),
  ('order.cancelled', 'order', '{"ar": "تم إلغاء طلبك", "en": "Your order was cancelled"}',
   '{"ar": "تم إلغاء الطلب {{order_number}}. تواصل معانا لو محتاج مساعدة.", "en": "Order {{order_number}} was cancelled. Contact us if you need help."}'),
  ('stock.back_in_stock', 'back_in_stock', '{"ar": "رجع للمخزون", "en": "Back in stock"}',
   '{"ar": "{{product_name}} متاح دلوقتي. الكمية محدودة.", "en": "{{product_name}} is available again. Quantities are limited."}'),
  ('waitlist.available', 'waitlist', '{"ar": "المنتج متاح", "en": "Now available"}',
   '{"ar": "{{product_name}} اللي سجلت اهتمامك بيه متاح دلوقتي.", "en": "{{product_name}}, which you joined the waitlist for, is now available."}'),
  ('waitlist.pre_order', 'waitlist', '{"ar": "الحجز المسبق متاح", "en": "Pre-orders are open"}',
   '{"ar": "الحجز المسبق لـ {{product_name}} بدأ.", "en": "Pre-orders for {{product_name}} are open."}'),
  ('price.drop', 'price_drop', '{"ar": "السعر نزل", "en": "Price dropped"}',
   '{"ar": "سعر {{product_name}} في المفضلة بقى {{amount}}.", "en": "{{product_name}} in your wishlist is now {{amount}}."}'),
  ('review.approved', 'review', '{"ar": "تم نشر تقييمك", "en": "Your review is published"}',
   '{"ar": "شكرًا! تقييمك لـ {{product_name}} اتنشر.", "en": "Thank you! Your review of {{product_name}} is now published."}'),
  ('review.rejected', 'review', '{"ar": "لم يتم نشر تقييمك", "en": "Your review was not published"}',
   '{"ar": "تقييمك لـ {{product_name}} مااتنشرش لأنه لا يتوافق مع سياسة التقييمات. تقدر تعدّله.", "en": "Your review of {{product_name}} was not published because it does not meet our review policy. You can edit it."}'),
  ('cart.abandoned', 'cart', '{"ar": "سلتك مستنياك", "en": "Your cart is waiting"}',
   '{"ar": "لسه عندك منتجات في السلة. كمّل طلبك وقت ما يناسبك.", "en": "You still have items in your cart. Continue whenever it suits you."}')
on conflict (key) do nothing;

-- ── Rendering: closed placeholder set, no expressions, values cannot inject placeholders ──
create or replace function app.render_template(p_template text, p_vars jsonb, p_locale text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := coalesce(p_template, '');
  v_key text;
  v_value text;
begin
  foreach v_key in array array['customer_name', 'order_number', 'product_name', 'status', 'amount', 'code'] loop
    v_value := case jsonb_typeof(p_vars -> v_key)
      when 'object' then coalesce(p_vars -> v_key ->> p_locale, p_vars -> v_key ->> 'ar')
      when 'string' then p_vars ->> v_key
      when 'number' then p_vars ->> v_key
      else '' end;
    v_value := left(translate(coalesce(v_value, ''), '{}', ''), 200);
    v_out := replace(v_out, '{{' || v_key || '}}', v_value);
  end loop;
  -- Unknown placeholders are dropped, never evaluated.
  return btrim(regexp_replace(v_out, '\{\{[^}]*\}\}', '', 'g'));
end;
$$;

-- Categories customers cannot switch off in-app (transactional).
create or replace function app.notification_category_mandatory(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_category in ('order', 'account');
$$;

create or replace function app.notification_channel_available(p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_channel = 'in_app' or coalesce((
    select (s.value -> 'channels' -> p_channel ->> 'enabled')::boolean
    from public.site_settings s where s.key = 'notifications'), false);
$$;

-- Create one notification (idempotent on user + dedupe key). Returns the id, or null when the
-- user switched the category off, the template is inactive, or it already exists.
create or replace function app.notify(p_user uuid, p_template text, p_vars jsonb, p_dedupe text,
                                      p_action text default null, p_data jsonb default '{}'::jsonb,
                                      p_is_demo boolean default false,
                                      p_title jsonb default null, p_body jsonb default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.notification_templates;
  v_category text;
  v_title jsonb;
  v_body jsonb;
  v_id uuid;
  v_channel text;
begin
  if p_user is null then return null; end if;
  if p_template is not null then
    select * into t from public.notification_templates where key = p_template and is_active;
    if not found then return null; end if;
    v_category := t.category;
    v_title := jsonb_build_object('ar', app.render_template(t.title ->> 'ar', p_vars, 'ar'),
                                  'en', app.render_template(coalesce(t.title ->> 'en', t.title ->> 'ar'), p_vars, 'en'));
    v_body := jsonb_build_object('ar', app.render_template(t.body ->> 'ar', p_vars, 'ar'),
                                 'en', app.render_template(coalesce(t.body ->> 'en', t.body ->> 'ar'), p_vars, 'en'));
  else
    v_category := 'account';
    v_title := p_title;
    v_body := p_body;
  end if;

  if not app.notification_category_mandatory(v_category) and exists (
    select 1 from public.notification_preferences
    where user_id = p_user and category = v_category and channel = 'in_app' and not enabled) then
    return null;
  end if;

  insert into public.notifications (user_id, category, template_key, title, body, action_path, data, dedupe_key, is_demo)
  values (p_user, v_category, p_template, v_title, v_body, p_action, coalesce(p_data, '{}'::jsonb), p_dedupe, coalesce(p_is_demo, false))
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;

  -- Optional external channels: queued only when the channel is configured AND the user opted in.
  if v_id is not null then
    foreach v_channel in array array['email', 'whatsapp', 'sms'] loop
      if app.notification_channel_available(v_channel) and exists (
        select 1 from public.notification_preferences
        where user_id = p_user and category = v_category and channel = v_channel and enabled) then
        insert into public.notification_deliveries (notification_id, channel) values (v_id, v_channel)
        on conflict do nothing;
      end if;
    end loop;
  end if;
  return v_id;
end;
$$;

-- ── Order status → in-app notification (idempotent per order + status) ──────
create or replace function app.order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if new.event_type <> 'status' or not new.visible_to_customer or new.actor_kind = 'customer'
     or new.status not in ('confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered',
                           'completed', 'cancelled') then
    return null;
  end if;
  select * into o from public.orders where id = new.order_id;
  if not found then return null; end if;
  perform app.notify(o.customer_id, 'order.' || new.status,
    jsonb_build_object('order_number', o.order_number, 'customer_name', o.customer_name),
    'order:' || o.id || ':' || new.status, '/order/' || o.order_number,
    jsonb_build_object('orderNumber', o.order_number, 'status', new.status), o.is_demo);
  return null;
end;
$$;

drop trigger if exists order_events_notify on public.order_events;
create trigger order_events_notify after insert on public.order_events
  for each row execute function app.order_status_notification();

-- Lazy per-user processing hook (back-in-stock, waitlist, price drops, abandoned cart). Replaced by
-- the customer-lists migration; defined here so the inbox RPCs exist in order.
create or replace function app.refresh_customer_alerts(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform p_user;
end;
$$;

-- ── Customer inbox ───────────────────────────────────────────────────────────
create or replace function app.notification_json(n public.notifications)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', n.id, 'category', n.category, 'title', n.title, 'body', n.body,
    'actionPath', n.action_path, 'data', n.data, 'readAt', n.read_at, 'createdAt', n.created_at, 'isDemo', n.is_demo);
$$;

create or replace function public.list_my_notifications(p_limit integer default 20, p_before timestamptz default null,
                                                        p_unread_only boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
begin
  perform app.refresh_customer_alerts(v_uid);
  select coalesce(jsonb_agg(app.notification_json(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_items
  from (select * from public.notifications n
        where n.user_id = v_uid and (p_before is null or n.created_at < p_before)
          and (not coalesce(p_unread_only, false) or n.read_at is null)
        order by n.created_at desc, n.id limit v_limit + 1) x;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_items) with ordinality t(e, i)
                                                  where i <= v_limit order by i) q), '[]'::jsonb),
    'hasMore', jsonb_array_length(v_items) > v_limit,
    'unreadCount', (select count(*) from public.notifications where user_id = v_uid and read_at is null));
end;
$$;

create or replace function public.my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications where user_id = app.require_customer() and read_at is null;
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = v_uid;
  return (select count(*)::integer from public.notifications where user_id = v_uid and read_at is null);
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  update public.notifications set read_at = now() where user_id = v_uid and read_at is null;
  return 0;
end;
$$;

-- ── Preferences ─────────────────────────────────────────────────────────────
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
  from unnest(array['order', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart']) with ordinality c(category, ord);
$$;

create or replace function public.set_my_notification_preference(p_category text, p_channel text, p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  if p_category not in ('order', 'back_in_stock', 'waitlist', 'price_drop', 'review', 'cart')
     or p_channel not in ('in_app', 'email', 'whatsapp', 'sms') or p_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_preference');
  end if;
  if not app.notification_channel_available(p_channel) then
    return jsonb_build_object('ok', false, 'code', 'channel_unavailable');
  end if;
  if p_channel = 'in_app' and app.notification_category_mandatory(p_category) and not p_enabled then
    return jsonb_build_object('ok', false, 'code', 'mandatory_category');
  end if;
  insert into public.notification_preferences (user_id, category, channel, enabled)
  values (v_uid, p_category, p_channel, p_enabled)
  on conflict (user_id, category, channel) do update set enabled = excluded.enabled, updated_at = now();
  return jsonb_build_object('ok', true, 'preferences', public.get_my_notification_preferences());
end;
$$;

-- ── Staff: manual in-app message to one customer (audited) ───────────────────
create or replace function public.staff_send_notification(p_user_id uuid, p_title jsonb, p_body jsonb,
                                                          p_action_path text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_permission('notifications.manage');
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not app.is_localized_text(p_title) or not app.is_localized_text(p_body) or p_title is null or p_body is null
     or char_length(p_title ->> 'ar') > 120 or char_length(p_body ->> 'ar') > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_message');
  end if;
  if p_action_path is not null and p_action_path !~ '^/[A-Za-z0-9/_.?=&%-]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_action');
  end if;
  v_id := app.notify(p_user_id, null, '{}'::jsonb, 'manual:' || gen_random_uuid(), p_action_path, '{}'::jsonb, false,
                     p_title, p_body);
  perform app.log_event('notification.manual_sent', 'notification', v_id::text, null,
    jsonb_build_object('userId', p_user_id, 'title', p_title), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function app.render_template(text, jsonb, text), app.notification_category_mandatory(text),
  app.notification_channel_available(text),
  app.notify(uuid, text, jsonb, text, text, jsonb, boolean, jsonb, jsonb), app.order_status_notification(),
  app.refresh_customer_alerts(uuid), app.notification_json(public.notifications)
  from public, anon, authenticated;
revoke all on function public.list_my_notifications(integer, timestamptz, boolean), public.my_unread_notification_count(),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.get_my_notification_preferences(),
  public.set_my_notification_preference(text, text, boolean), public.staff_send_notification(uuid, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.list_my_notifications(integer, timestamptz, boolean), public.my_unread_notification_count(),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.get_my_notification_preferences(),
  public.set_my_notification_preference(text, text, boolean), public.staff_send_notification(uuid, jsonb, jsonb, text)
  to authenticated;
