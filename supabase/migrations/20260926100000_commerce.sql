-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0010 · Commerce: carts, orders, reservations, payments, stock movements
--
-- Principles (see docs/ARCHITECTURE.md §12):
--   • Every money value is numeric(12,2) EGP. Totals are recomputed by the database; the order row
--     enforces total = subtotal − discount_total + shipping_fee and paid + remaining = total.
--   • Nobody (not even staff) writes these tables directly: all changes go through the
--     SECURITY DEFINER RPCs in 20260926100200_commerce_rpcs.sql, which check permissions.
--   • Stock is RESERVED at checkout (soft, time-limited) and only DECREMENTED when staff confirm the
--     order (one 'sale' stock movement). Expired reservations stop counting by timestamp — no cron.
--   • Historical orders keep purchase-time snapshots (names, variants, prices, discounts).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Settings contract (see src/domain/settings/setting-definitions.json) ────
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('commerce',     'settings', true,  'settings.manage', 'settings.publish'),
  ('order_review', 'settings', false, 'settings.manage', 'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- ── Promo code usage limits (promo codes are offers of kind 'promo_code') ────
alter table public.offers add column if not exists max_redemptions integer
  check (max_redemptions is null or max_redemptions > 0);
alter table public.offers add column if not exists max_redemptions_per_customer integer
  check (max_redemptions_per_customer is null or max_redemptions_per_customer > 0);
alter table public.offers add column if not exists min_subtotal numeric(12, 2)
  check (min_subtotal is null or min_subtotal >= 0);

create unique index if not exists offers_promo_code_uidx
  on public.offers (upper(promo_code)) where promo_code is not null and deleted_at is null;

-- ── Order numbers: human-friendly, unique, never the primary key ─────────────
create sequence if not exists public.order_number_seq as bigint start 1;
revoke all on sequence public.order_number_seq from public, anon, authenticated;

-- ── Account carts (signed-in customers; anonymous carts live in the browser) ──
create table if not exists public.carts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null unique references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.cart_items (
  cart_id          uuid not null references public.carts (id) on delete cascade,
  variant_id       uuid not null references public.product_variants (id) on delete cascade,
  quantity         integer not null check (quantity between 1 and 99),
  saved_for_later  boolean not null default false,
  -- Unit price the customer last saw (display only — used to show "price updated", never to charge).
  seen_unit_price  numeric(12, 2) check (seen_unit_price is null or seen_unit_price >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

create index if not exists cart_items_variant_idx on public.cart_items (variant_id);

-- ── Orders ───────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                      uuid primary key default gen_random_uuid(),
  order_number            text not null unique check (order_number ~ '^[A-Z]{1,6}-[0-9]{4}-[0-9]{6,}$'),
  customer_id             uuid not null references auth.users (id) on delete restrict,
  idempotency_key         uuid not null,
  locale                  text not null default 'ar' check (app.is_locale(locale)),

  -- Customer snapshot (purchase time)
  customer_name           text not null check (char_length(customer_name) between 2 and 120),
  customer_phone          text not null check (customer_phone ~ '^\+201[0125][0-9]{8}$'),
  customer_phone_display  text check (customer_phone_display is null or char_length(customer_phone_display) <= 30),
  customer_email          text check (customer_email is null or char_length(customer_email) <= 254),

  -- Fulfillment
  fulfillment_method      text not null check (fulfillment_method in ('delivery', 'pickup')),
  pickup_branch           jsonb,
  delivery_governorate    text check (delivery_governorate is null or delivery_governorate ~ '^[a-z_]{2,40}$'),
  delivery_area           text check (delivery_area is null or char_length(delivery_area) between 2 and 120),
  delivery_address        text check (delivery_address is null or char_length(delivery_address) between 5 and 400),
  delivery_notes          text check (delivery_notes is null or char_length(delivery_notes) <= 400),
  delivery_eta            text check (delivery_eta is null or char_length(delivery_eta) <= 120),
  courier                 text check (courier is null or char_length(courier) <= 120),
  tracking_number         text check (tracking_number is null or char_length(tracking_number) <= 120),

  -- Payment
  -- V1 payment methods are exactly COD, InstaPay and split (InstaPay deposit + rest on delivery).
  payment_method          text not null check (payment_method in ('cod', 'instapay', 'split')),
  payment_status          text not null check (payment_status in (
                            'cod_pending', 'awaiting_payment', 'awaiting_deposit', 'verification_pending',
                            'deposit_verified', 'partially_paid', 'paid', 'void')),
  split_deposit_amount    numeric(12, 2) check (split_deposit_amount is null or split_deposit_amount > 0),

  -- Order status (current; full timeline in order_events)
  status                  text not null default 'new' check (status in (
                            'new', 'awaiting_whatsapp', 'awaiting_payment', 'payment_verification', 'confirmed',
                            'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed',
                            'cancelled')),

  -- Money (EGP, final prices — no separate VAT line in V1)
  original_subtotal       numeric(12, 2) not null check (original_subtotal >= 0),
  subtotal                numeric(12, 2) not null check (subtotal >= 0),
  discount_total          numeric(12, 2) not null default 0 check (discount_total >= 0),
  promo_code              text,
  shipping_fee            numeric(12, 2) check (shipping_fee is null or shipping_fee >= 0),
  shipping_fee_status     text not null check (shipping_fee_status in ('pending', 'confirmed', 'not_required')),
  total                   numeric(12, 2) not null check (total >= 0),
  paid_amount             numeric(12, 2) not null default 0 check (paid_amount >= 0),
  remaining_amount        numeric(12, 2) generated always as (total - paid_amount) stored,

  -- Manual review
  manual_review_required  boolean not null default false,
  manual_review_reasons   text[] not null default '{}',
  manual_review_status    text not null default 'not_required'
                          check (manual_review_status in ('not_required', 'pending', 'approved', 'rejected')),
  reviewed_by             uuid references auth.users (id) on delete set null,
  reviewed_at             timestamptz,
  review_note             text check (review_note is null or char_length(review_note) <= 1000),

  -- Stock
  reservation_expires_at  timestamptz,
  stock_committed_at      timestamptz,

  -- Operations
  assigned_staff_id       uuid references auth.users (id) on delete set null,
  customer_note           text check (customer_note is null or char_length(customer_note) <= 500),
  staff_note              text check (staff_note is null or char_length(staff_note) <= 2000),
  cancelled_at            timestamptz,
  cancel_reason           text check (cancel_reason is null or char_length(cancel_reason) <= 500),

  is_demo                 boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (customer_id, idempotency_key),
  check (discount_total <= subtotal),
  check (total = subtotal - discount_total + coalesce(shipping_fee, 0)),
  check (paid_amount <= total),
  check (shipping_fee_status <> 'pending' or shipping_fee is null),
  check (shipping_fee_status <> 'confirmed' or shipping_fee is not null),
  check (fulfillment_method <> 'pickup' or (shipping_fee_status = 'not_required' and pickup_branch is not null)),
  check (fulfillment_method <> 'delivery' or (shipping_fee_status <> 'not_required'
         and delivery_governorate is not null and delivery_area is not null and delivery_address is not null)),
  check (manual_review_required = (manual_review_status <> 'not_required'))
);

comment on table public.orders is
  'Customer orders. Written only by commerce RPCs; totals are database-computed. remaining_amount = total − paid_amount.';
comment on column public.orders.paid_amount is
  'Money staff VERIFIED as received (sum of payment_records). A customer screenshot never changes this.';

create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_review_idx on public.orders (manual_review_status) where manual_review_required;
create index if not exists orders_created_idx on public.orders (created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function app.set_updated_at();

create table if not exists public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  line_no             smallint not null check (line_no > 0),
  product_id          uuid references public.products (id) on delete set null,
  variant_id          uuid references public.product_variants (id) on delete set null,
  sku                 text not null,
  product_slug        text not null,
  product_name        public.localized_text not null,
  brand_name          public.localized_text,
  variant_label       public.localized_text,
  options             jsonb not null default '[]'::jsonb,
  image_url           text,
  warranty            public.localized_text,
  regular_unit_price  numeric(12, 2) not null check (regular_unit_price >= 0),
  unit_price          numeric(12, 2) not null check (unit_price >= 0),
  quantity            integer not null check (quantity between 1 and 99),
  line_subtotal       numeric(12, 2) not null,
  discount_amount     numeric(12, 2) not null default 0,
  line_total          numeric(12, 2) not null,
  applied_offer       jsonb,
  discounts           jsonb not null default '[]'::jsonb,
  is_gift             boolean not null default false,
  unique (order_id, line_no),
  check (line_subtotal = unit_price * quantity),
  check (discount_amount >= 0 and discount_amount <= line_subtotal),
  check (line_total = line_subtotal - discount_amount),
  check (not is_gift or unit_price = 0)
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);

-- Append-only order timeline: status changes, payments, shipping, review, reservation, notes.
create table if not exists public.order_events (
  id                   bigint generated always as identity primary key,
  order_id             uuid not null references public.orders (id) on delete cascade,
  event_type           text not null check (event_type in ('status', 'payment', 'shipping', 'review',
                                                           'reservation', 'note', 'assignment')),
  status               text,
  from_status          text,
  data                 jsonb not null default '{}'::jsonb,
  note                 text check (note is null or char_length(note) <= 1000),
  visible_to_customer  boolean not null default false,
  actor_id             uuid,
  actor_kind           text not null check (actor_kind in ('customer', 'staff', 'system')),
  created_at           timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, id);

create or replace function app.prevent_order_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_events is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists order_events_append_only on public.order_events;
create trigger order_events_append_only before update on public.order_events
  for each row execute function app.prevent_order_event_update();

-- Verified money received. Created only by staff (payments.verify) — never from a screenshot upload.
create table if not exists public.payment_records (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  method       text not null check (method in ('instapay', 'cash')),
  kind         text not null check (kind in ('payment', 'deposit')),
  amount       numeric(12, 2) not null check (amount > 0),
  reference    text check (reference is null or char_length(reference) <= 120),
  note         text check (note is null or char_length(note) <= 500),
  verified_by  uuid not null references auth.users (id) on delete restrict,
  verified_at  timestamptz not null default now(),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists payment_records_order_idx on public.payment_records (order_id);

-- Soft stock holds. Counted while status = 'active' AND expires_at > now().
create table if not exists public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  order_item_id   uuid references public.order_items (id) on delete cascade,
  variant_id      uuid not null references public.product_variants (id) on delete cascade,
  quantity        integer not null check (quantity > 0),
  status          text not null default 'active' check (status in ('active', 'committed', 'released', 'expired')),
  expires_at      timestamptz not null,
  committed_at    timestamptz,
  released_at     timestamptz,
  release_reason  text,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists stock_reservations_active_idx
  on public.stock_reservations (variant_id, expires_at) where status = 'active';
create index if not exists stock_reservations_order_idx on public.stock_reservations (order_id);

-- Inventory history: one coherent movement per committed sale / restock / manual adjustment.
create table if not exists public.stock_movements (
  id              bigint generated always as identity primary key,
  variant_id      uuid not null references public.product_variants (id) on delete cascade,
  delta           integer not null check (delta <> 0),
  quantity_after  integer not null check (quantity_after >= 0),
  reason          text not null check (reason in ('sale', 'cancellation_restock', 'manual_adjustment', 'restock')),
  order_id        uuid references public.orders (id) on delete set null,
  actor_id        uuid,
  note            text check (note is null or char_length(note) <= 500),
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
create index if not exists stock_movements_order_idx on public.stock_movements (order_id);

create table if not exists public.promo_redemptions (
  id               uuid primary key default gen_random_uuid(),
  offer_id         uuid not null references public.offers (id) on delete cascade,
  order_id         uuid not null unique references public.orders (id) on delete cascade,
  customer_id      uuid not null references auth.users (id) on delete cascade,
  code             text not null,
  discount_amount  numeric(12, 2) not null check (discount_amount >= 0),
  status           text not null default 'active' check (status in ('active', 'released')),
  released_at      timestamptz,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists promo_redemptions_offer_idx on public.promo_redemptions (offer_id, customer_id)
  where status = 'active';

-- ── Row-level security ───────────────────────────────────────────────────────
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.payment_records enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.promo_redemptions enable row level security;

revoke all on public.carts, public.cart_items, public.orders, public.order_items, public.order_events,
  public.payment_records, public.stock_reservations, public.stock_movements, public.promo_redemptions
  from anon;
revoke insert, update, delete, truncate on public.carts, public.cart_items, public.orders, public.order_items,
  public.order_events, public.payment_records, public.stock_reservations, public.stock_movements,
  public.promo_redemptions from authenticated;
grant select on public.carts, public.cart_items, public.orders, public.order_items, public.order_events,
  public.payment_records, public.stock_reservations, public.stock_movements, public.promo_redemptions
  to authenticated;

drop policy if exists carts_owner_select on public.carts;
create policy carts_owner_select on public.carts for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists cart_items_owner_select on public.cart_items;
create policy cart_items_owner_select on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid()));

drop policy if exists orders_owner_or_staff_select on public.orders;
create policy orders_owner_or_staff_select on public.orders for select to authenticated
  using (customer_id = auth.uid() or app.has_permission('orders.view'));

drop policy if exists order_items_owner_or_staff_select on public.order_items;
create policy order_items_owner_or_staff_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or app.has_permission('orders.view'))));

drop policy if exists order_events_owner_or_staff_select on public.order_events;
create policy order_events_owner_or_staff_select on public.order_events for select to authenticated
  using (app.has_permission('orders.view')
         or (visible_to_customer and exists (select 1 from public.orders o
                                             where o.id = order_id and o.customer_id = auth.uid())));

drop policy if exists payment_records_staff_select on public.payment_records;
create policy payment_records_staff_select on public.payment_records for select to authenticated
  using (app.has_permission('orders.view'));

drop policy if exists stock_reservations_staff_select on public.stock_reservations;
create policy stock_reservations_staff_select on public.stock_reservations for select to authenticated
  using (app.has_permission('orders.view') or app.has_permission('inventory.manage'));

drop policy if exists stock_movements_staff_select on public.stock_movements;
create policy stock_movements_staff_select on public.stock_movements for select to authenticated
  using (app.has_permission('inventory.manage') or app.has_permission('orders.view'));

drop policy if exists promo_redemptions_staff_select on public.promo_redemptions;
create policy promo_redemptions_staff_select on public.promo_redemptions for select to authenticated
  using (app.has_permission('orders.view') or app.has_permission('marketing.manage'));

-- ── Audit safety net (semantic events are also logged by the RPCs) ───────────
drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after insert or update or delete on public.orders
  for each row execute function app.audit_row_change('id');

drop trigger if exists payment_records_audit on public.payment_records;
create trigger payment_records_audit after insert or update or delete on public.payment_records
  for each row execute function app.audit_row_change('id');

-- ── Demo data registry: demo orders are deleted before the demo catalog ──────
select app.register_demo_table('public.orders', 5);
select app.register_demo_table('public.stock_movements', 6);
