-- ════════════════════════════════════════════════════════════════════════════
-- Phase 04 · Wishlist, recently viewed, customer requests lifecycle, alerts, abandoned carts.
--
-- Wishlist        guest list lives in the browser; on sign-in wishlist_merge() adds it to the
--                 account list (deterministic, no duplicates, account entries kept).
--                 reference_price = price when saved → price-drop detection (idempotent notices).
-- Recently viewed account history capped per user (engagement.recentlyViewed.maxItems).
-- Requests        Notify-me (stock_notifications) and waitlists gain a lifecycle
--                   pending(=active) → available → notified | cancelled   (expired is derived)
--                 and account linking: requests made while signed in carry user_id; guest requests
--                 can be claimed with the one-time token returned to that browser, or are linked
--                 when their email equals the account's verified sign-in email. Never by phone
--                 alone (phones are not verified).
-- Alerts          event-driven (triggers on stock / availability / price) + lazy per-user refresh
--                 when the customer opens their inbox, + a staff processing action. No cron.
-- Abandoned cart  derived from timestamps: items, idle longer than the threshold, and no order
--                 since the last cart activity. Follow-up is one in-app notice per idle period.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Public: product cards by id (guest wishlist, recently viewed, compare) ───
create or replace function public.catalog_products(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.product_summary(p.id) order by x.ord), '[]'::jsonb)
  from unnest(p_ids[1:50]) with ordinality x(id, ord)
  join public.products p on p.id = x.id
  where app.product_is_visible(p);
$$;

create or replace function app.is_uuid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
$$;

-- Effective (offer-aware) price: the variant's, or the lowest visible variant price of the product.
create or replace function app.current_price(p_product_id uuid, p_variant_id uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select min(sv.price) from app.storefront_variants sv
  where sv.product_id = p_product_id and (p_variant_id is null or sv.id = p_variant_id) and sv.price is not null;
$$;

-- ════════════════════════════════ Wishlist ════════════════════════════════
create table if not exists public.wishlist_items (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  product_id           uuid not null references public.products (id) on delete cascade,
  variant_id           uuid references public.product_variants (id) on delete cascade,
  reference_price      numeric(12, 2) check (reference_price is null or reference_price >= 0),
  last_notified_price  numeric(12, 2),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists wishlist_items_unique_idx
  on public.wishlist_items (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists wishlist_items_product_idx on public.wishlist_items (product_id);

alter table public.wishlist_items enable row level security;
revoke all on public.wishlist_items from anon;
revoke insert, update, delete, truncate on public.wishlist_items from authenticated;
drop policy if exists wishlist_items_owner_select on public.wishlist_items;
create policy wishlist_items_owner_select on public.wishlist_items for select to authenticated
  using (user_id = (select app.current_actor_id()));

create or replace function app.wishlist_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'productId', w.product_id, 'variantId', w.variant_id, 'addedAt', w.created_at,
      'referencePrice', w.reference_price,
      'currentPrice', app.current_price(w.product_id, w.variant_id),
      'product', case when app.product_is_visible(p) then app.product_summary(p.id) end,
      'variant', case when w.variant_id is not null then (
        select jsonb_build_object('sku', s ->> 'sku', 'label', s -> 'variantLabel')
        from app.variant_line_snapshot(w.variant_id) s) end)
    order by w.created_at desc, w.id), '[]'::jsonb))
  from public.wishlist_items w join public.products p on p.id = w.product_id
  where w.user_id = p_user;
$$;

create or replace function public.wishlist_get()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  perform app.process_price_drops(v_uid);
  return app.wishlist_json(v_uid);
end;
$$;

-- Validates one (product, variant) pair; returns the product id or null.
create or replace function app.wishlist_target(p_product text, p_variant text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.products p
  where app.is_uuid(p_product) and p.id = p_product::uuid and app.product_is_visible(p)
    and (p_variant is null or (app.is_uuid(p_variant) and exists (
      select 1 from public.product_variants v
      where v.id = p_variant::uuid and v.product_id = p.id and v.deleted_at is null)));
$$;

create or replace function public.wishlist_set(p_product_id uuid, p_variant_id uuid default null, p_saved boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  if not coalesce(p_saved, true) then
    delete from public.wishlist_items
     where user_id = v_uid and product_id = p_product_id
       and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    return jsonb_build_object('ok', true, 'saved', false);
  end if;
  if app.wishlist_target(p_product_id::text, p_variant_id::text) is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if (select count(*) from public.wishlist_items where user_id = v_uid)
     >= app.engagement_int('wishlist', 'maxItems', 100, 1, 500) then
    return jsonb_build_object('ok', false, 'code', 'wishlist_full');
  end if;
  insert into public.wishlist_items (user_id, product_id, variant_id, reference_price)
  values (v_uid, p_product_id, p_variant_id, app.current_price(p_product_id, p_variant_id))
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'saved', true);
end;
$$;

-- Deterministic guest → account merge: existing account entries win, new ones are added in
-- the guest's order (oldest first), invalid ones are reported, the cap is respected.
create or replace function public.wishlist_merge(p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_item jsonb;
  v_product uuid;
  v_variant uuid;
  v_added_at timestamptz;
  v_max integer := app.engagement_int('wishlist', 'maxItems', 100, 1, 500);
  v_adjustments jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  for v_item in
    select e from jsonb_array_elements(p_items) with ordinality t(e, i)
    order by case when (e ->> 'addedAt') ~ '^\d{4}-\d{2}-\d{2}' then (e ->> 'addedAt') end nulls last, i
    limit 200
  loop
    v_product := app.wishlist_target(v_item ->> 'productId', nullif(v_item ->> 'variantId', ''));
    if v_product is null then
      v_adjustments := v_adjustments || jsonb_build_object('productId', v_item ->> 'productId', 'reason', 'removed_missing');
      continue;
    end if;
    v_variant := nullif(v_item ->> 'variantId', '')::uuid;
    if exists (select 1 from public.wishlist_items where user_id = v_uid and product_id = v_product
               and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 = coalesce(v_variant, '00000000-0000-0000-0000-000000000000'::uuid)) then
      continue;
    end if;
    if (select count(*) from public.wishlist_items where user_id = v_uid) >= v_max then
      v_adjustments := v_adjustments || jsonb_build_object('productId', v_product, 'reason', 'wishlist_full');
      continue;
    end if;
    v_added_at := case when (v_item ->> 'addedAt') ~ '^\d{4}-\d{2}-\d{2}T' then least((v_item ->> 'addedAt')::timestamptz, now())
                       else now() end;
    insert into public.wishlist_items (user_id, product_id, variant_id, reference_price, created_at)
    values (v_uid, v_product, v_variant, app.current_price(v_product, v_variant), v_added_at)
    on conflict do nothing;
  end loop;
  return app.wishlist_json(v_uid) || jsonb_build_object('ok', true, 'adjustments', v_adjustments);
end;
$$;

-- Price drop: current effective price at least engagement.wishlist.priceDropPercent below the price
-- the customer saved it at, and lower than any price already announced. One notice per new price.
create or replace function app.process_price_drops(p_user uuid default null, p_product uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_pct integer := app.engagement_int('wishlist', 'priceDropPercent', 5, 1, 90);
begin
  for r in
    select w.*, p.slug, p.name as product_name, p.is_demo, app.current_price(w.product_id, w.variant_id) as price_now
    from public.wishlist_items w join public.products p on p.id = w.product_id
    where (p_user is null or w.user_id = p_user) and (p_product is null or w.product_id = p_product)
      and w.reference_price is not null and app.product_is_visible(p)
  loop
    continue when r.price_now is null
      or r.price_now > r.reference_price * (100 - v_pct) / 100
      or (r.last_notified_price is not null and r.price_now >= r.last_notified_price);
    perform app.notify(r.user_id, 'price.drop',
      jsonb_build_object('product_name', r.product_name,
                         'amount', jsonb_build_object('ar', to_char(r.price_now, 'FM999,999,990') || ' ج.م.',
                                                      'en', 'EGP ' || to_char(r.price_now, 'FM999,999,990'))),
      'price:' || r.id || ':' || r.price_now::text, '/product/' || r.slug,
      jsonb_build_object('productId', r.product_id, 'price', r.price_now, 'was', r.reference_price), r.is_demo);
    update public.wishlist_items set last_notified_price = r.price_now, updated_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ════════════════════════════ Recently viewed ════════════════════════════
create table if not exists public.recently_viewed (
  user_id     uuid not null references auth.users (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete set null,
  viewed_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists recently_viewed_user_idx on public.recently_viewed (user_id, viewed_at desc);

alter table public.recently_viewed enable row level security;
revoke all on public.recently_viewed from anon;
revoke insert, update, delete, truncate on public.recently_viewed from authenticated;
drop policy if exists recently_viewed_owner_select on public.recently_viewed;
create policy recently_viewed_owner_select on public.recently_viewed for select to authenticated
  using (user_id = (select app.current_actor_id()));

create or replace function app.trim_recently_viewed(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.recently_viewed r
  where r.user_id = p_user and r.product_id in (
    select product_id from public.recently_viewed where user_id = p_user
    order by viewed_at desc, product_id offset app.engagement_int('recentlyViewed', 'maxItems', 20, 1, 100));
$$;

create or replace function public.recent_track(p_product_id uuid, p_variant_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  if app.wishlist_target(p_product_id::text, p_variant_id::text) is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.recently_viewed (user_id, product_id, variant_id, viewed_at)
  values (v_uid, p_product_id, p_variant_id, now())
  on conflict (user_id, product_id) do update set viewed_at = now(), variant_id = excluded.variant_id;
  perform app.trim_recently_viewed(v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.recent_merge(p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_item jsonb;
  v_product uuid;
  v_at timestamptz;
begin
  if jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  for v_item in select e from jsonb_array_elements(p_items) e limit 100 loop
    v_product := app.wishlist_target(v_item ->> 'productId', nullif(v_item ->> 'variantId', ''));
    continue when v_product is null;
    v_at := case when (v_item ->> 'viewedAt') ~ '^\d{4}-\d{2}-\d{2}T' then least((v_item ->> 'viewedAt')::timestamptz, now())
                 else now() end;
    insert into public.recently_viewed (user_id, product_id, variant_id, viewed_at)
    values (v_uid, v_product, nullif(v_item ->> 'variantId', '')::uuid, v_at)
    on conflict (user_id, product_id) do update
      set viewed_at = greatest(public.recently_viewed.viewed_at, excluded.viewed_at),
          variant_id = case when excluded.viewed_at > public.recently_viewed.viewed_at
                            then excluded.variant_id else public.recently_viewed.variant_id end;
  end loop;
  perform app.trim_recently_viewed(v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.recent_list(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('productId', r.product_id, 'variantId', r.variant_id,
                                               'viewedAt', r.viewed_at, 'product', app.product_summary(p.id))
                            order by r.viewed_at desc, r.product_id), '[]'::jsonb)
  from (select * from public.recently_viewed where user_id = app.require_customer()
        order by viewed_at desc, product_id limit least(greatest(coalesce(p_limit, 20), 1), 100)) r
  join public.products p on p.id = r.product_id
  where app.product_is_visible(p);
$$;

create or replace function public.recent_clear()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.recently_viewed where user_id = app.require_customer();
  select jsonb_build_object('ok', true);
$$;

-- ═════════════════════ Customer requests lifecycle ═════════════════════
alter table public.stock_notifications add column if not exists claim_token_hash text;
alter table public.stock_notifications add column if not exists available_at timestamptz;
alter table public.stock_notifications drop constraint if exists stock_notifications_status_check;
alter table public.stock_notifications add constraint stock_notifications_status_check
  check (status in ('pending', 'available', 'notified', 'cancelled', 'expired'));

alter table public.waitlist_entries add column if not exists claim_token_hash text;
alter table public.waitlist_entries add column if not exists available_at timestamptz;
alter table public.waitlist_entries add column if not exists notified_at timestamptz;
alter table public.waitlist_entries drop constraint if exists waitlist_entries_status_check;
alter table public.waitlist_entries add constraint waitlist_entries_status_check
  check (status in ('waiting', 'available', 'notified', 'converted', 'cancelled', 'expired'));

create index if not exists stock_notifications_user_idx on public.stock_notifications (user_id) where user_id is not null;
create index if not exists waitlist_entries_user_idx on public.waitlist_entries (user_id) where user_id is not null;

-- Customers read their own requests (staff keep waitlists.manage access).
drop policy if exists stock_notifications_owner_select on public.stock_notifications;
create policy stock_notifications_owner_select on public.stock_notifications for select to authenticated
  using (user_id = (select app.current_actor_id()));
drop policy if exists waitlist_entries_owner_select on public.waitlist_entries;
create policy waitlist_entries_owner_select on public.waitlist_entries for select to authenticated
  using (user_id = (select app.current_actor_id()));

create or replace function app.request_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Same intake as Phase 02, now also returning an id + one-time claim token for guest requests.
create or replace function public.request_stock_alert(p_product_slug text, p_variant_sku text, p_name text, p_phone text,
                                                      p_email text default null, p_locale text default 'ar')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_variant uuid;
  v_phone text := app.validate_request_contact(p_name, p_phone, p_email);
  v_uid uuid := app.current_actor_id();
  v_token text := case when v_uid is null then gen_random_uuid()::text end;
  v_id uuid;
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then raise exception 'product_not_found' using errcode = 'P0002'; end if;
  if p_variant_sku is not null then
    select id into v_variant from public.product_variants
    where product_id = p.id and sku = p_variant_sku and deleted_at is null;
    if v_variant is null then raise exception 'variant_not_found' using errcode = 'P0002'; end if;
  end if;

  insert into public.stock_notifications (product_id, variant_id, user_id, name, phone, email, locale, claim_token_hash)
  values (p.id, v_variant, v_uid, btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''),
          case when app.is_locale(p_locale) then p_locale else 'ar' end,
          case when v_token is not null then app.request_token_hash(v_token) end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    -- Already registered with this phone: attach it to the signed-in account when it is unowned.
    if v_uid is not null then
      update public.stock_notifications set user_id = v_uid
       where product_id = p.id and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                 = coalesce(v_variant, '00000000-0000-0000-0000-000000000000'::uuid)
         and phone = v_phone and status = 'pending' and user_id is null;
    end if;
    return jsonb_build_object('status', 'duplicate');
  end if;
  perform app.process_stock_alerts(null, null, v_id);
  return jsonb_build_object('status', 'created', 'id', v_id, 'claimToken', v_token);
end;
$$;

create or replace function public.join_waitlist(p_product_slug text, p_name text, p_phone text, p_email text default null,
                                                p_desired_storage text default null, p_desired_color text default null,
                                                p_locale text default 'ar')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_phone text := app.validate_request_contact(p_name, p_phone, p_email);
  v_uid uuid := app.current_actor_id();
  v_token text := case when v_uid is null then gen_random_uuid()::text end;
  v_id uuid;
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then raise exception 'product_not_found' using errcode = 'P0002'; end if;

  insert into public.waitlist_entries (product_id, user_id, name, phone, email, desired_storage, desired_color, locale,
                                       claim_token_hash)
  values (p.id, v_uid, btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''),
          nullif(left(btrim(coalesce(p_desired_storage, '')), 40), ''), nullif(left(btrim(coalesce(p_desired_color, '')), 40), ''),
          case when app.is_locale(p_locale) then p_locale else 'ar' end,
          case when v_token is not null then app.request_token_hash(v_token) end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    if v_uid is not null then
      update public.waitlist_entries set user_id = v_uid
       where product_id = p.id and phone = v_phone and status = 'waiting' and user_id is null;
    end if;
    return jsonb_build_object('status', 'duplicate');
  end if;
  return jsonb_build_object('status', 'created', 'id', v_id, 'claimToken', v_token);
end;
$$;

-- Link guest requests to the signed-in account: one-time tokens from this browser, plus requests
-- whose email equals the account's verified sign-in email.
create or replace function public.claim_my_requests(p_claims jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_email text := (select lower(email) from public.profiles where id = v_uid);
  v_claim jsonb;
  v_linked integer := 0;
  v_n integer;
begin
  if jsonb_typeof(coalesce(p_claims, '[]'::jsonb)) = 'array' then
    for v_claim in select e from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) e limit 50 loop
      continue when not app.is_uuid(v_claim ->> 'id') or char_length(coalesce(v_claim ->> 'token', '')) < 20;
      if v_claim ->> 'kind' = 'waitlist' then
        update public.waitlist_entries set user_id = v_uid, claim_token_hash = null
         where id = (v_claim ->> 'id')::uuid and user_id is null
           and claim_token_hash = app.request_token_hash(v_claim ->> 'token');
      else
        update public.stock_notifications set user_id = v_uid, claim_token_hash = null
         where id = (v_claim ->> 'id')::uuid and user_id is null
           and claim_token_hash = app.request_token_hash(v_claim ->> 'token');
      end if;
      get diagnostics v_n = row_count;
      v_linked := v_linked + v_n;
    end loop;
  end if;
  if v_email is not null then
    update public.stock_notifications set user_id = v_uid
     where user_id is null and lower(email) = v_email and status in ('pending', 'available');
    get diagnostics v_n = row_count;
    v_linked := v_linked + v_n;
    update public.waitlist_entries set user_id = v_uid
     where user_id is null and lower(email) = v_email and status in ('waiting', 'available');
    get diagnostics v_n = row_count;
    v_linked := v_linked + v_n;
  end if;
  return jsonb_build_object('ok', true, 'linked', v_linked);
end;
$$;

-- Back in stock: pending requests whose variant (or any variant of the product) can be bought now.
-- Linked requests get an in-app notice (idempotent per request) → notified; guest requests become
-- `available` for staff follow-up by phone.
create or replace function app.process_stock_alerts(p_variant uuid default null, p_user uuid default null,
                                                    p_request uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_cutoff timestamptz := now() - make_interval(days => app.engagement_int('requests', 'expireAfterDays', 180, 7, 3650));
begin
  for r in
    select sn.*, p.slug, p.name as product_name, p.is_demo
    from public.stock_notifications sn join public.products p on p.id = sn.product_id
    where sn.status = 'pending' and sn.created_at >= v_cutoff
      and (p_user is null or sn.user_id = p_user) and (p_request is null or sn.id = p_request)
      and (p_variant is null or sn.variant_id = p_variant
           or (sn.variant_id is null and exists (select 1 from public.product_variants v
                                                  where v.id = p_variant and v.product_id = sn.product_id)))
      and app.product_is_visible(p) and p.availability_state = 'available'
      and exists (select 1 from public.product_variants v
                  where v.product_id = sn.product_id and (sn.variant_id is null or v.id = sn.variant_id)
                    and v.is_active and v.deleted_at is null and v.price is not null
                    and app.variant_available_quantity(v.id) > 0)
    for update of sn skip locked
  loop
    if r.user_id is not null then
      perform app.notify(r.user_id, 'stock.back_in_stock',
        jsonb_build_object('product_name', r.product_name), 'stock:' || r.id, '/product/' || r.slug,
        jsonb_build_object('productId', r.product_id, 'variantId', r.variant_id), r.is_demo);
      update public.stock_notifications set status = 'notified', available_at = now(), notified_at = now() where id = r.id;
    else
      update public.stock_notifications set status = 'available', available_at = now() where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Waitlist: the product reached an actionable state (pre-order open or available).
create or replace function app.process_waitlist(p_product uuid default null, p_user uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_cutoff timestamptz := now() - make_interval(days => app.engagement_int('requests', 'expireAfterDays', 180, 7, 3650));
begin
  for r in
    select w.*, p.slug, p.name as product_name, p.is_demo, p.availability_state
    from public.waitlist_entries w join public.products p on p.id = w.product_id
    where w.status = 'waiting' and w.created_at >= v_cutoff
      and (p_product is null or w.product_id = p_product) and (p_user is null or w.user_id = p_user)
      and app.product_is_visible(p) and p.availability_state in ('available', 'pre_order')
    for update of w skip locked
  loop
    if r.user_id is not null then
      perform app.notify(r.user_id, case when r.availability_state = 'pre_order' then 'waitlist.pre_order'
                                         else 'waitlist.available' end,
        jsonb_build_object('product_name', r.product_name), 'waitlist:' || r.id || ':' || r.availability_state,
        '/product/' || r.slug, jsonb_build_object('productId', r.product_id, 'state', r.availability_state), r.is_demo);
      update public.waitlist_entries set status = 'notified', available_at = now(), notified_at = now() where id = r.id;
    else
      update public.waitlist_entries set status = 'available', available_at = now() where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Event-driven processing (no cron): restocks, availability changes, price changes.
create or replace function app.variant_change_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock_quantity > old.stock_quantity or (new.is_active and not old.is_active) then
    perform app.process_stock_alerts(new.id);
  end if;
  if new.price is distinct from old.price then
    perform app.process_price_drops(null, new.product_id);
  end if;
  return null;
end;
$$;

drop trigger if exists product_variants_customer_alerts on public.product_variants;
create trigger product_variants_customer_alerts
  after update of stock_quantity, is_active, price on public.product_variants
  for each row execute function app.variant_change_alerts();

create or replace function app.product_change_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if new.availability_state is distinct from old.availability_state or new.status is distinct from old.status then
    perform app.process_waitlist(new.id);
    for v in select id from public.product_variants where product_id = new.id and deleted_at is null loop
      perform app.process_stock_alerts(v);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists products_customer_alerts on public.products;
create trigger products_customer_alerts after update of availability_state, status on public.products
  for each row execute function app.product_change_alerts();

-- Staff "process now" (also covers stock freed by expired reservations).
create or replace function public.process_customer_alerts()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('waitlists.manage');
  return jsonb_build_object('stock', app.process_stock_alerts(), 'waitlist', app.process_waitlist(),
                            'priceDrops', app.process_price_drops());
end;
$$;

create or replace function app.request_status(p_status text, p_created timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_status in ('pending', 'waiting')
         and p_created < now() - make_interval(days => app.engagement_int('requests', 'expireAfterDays', 180, 7, 3650))
      then 'expired'
    when p_status in ('pending', 'waiting') then 'active'
    else p_status end;
$$;

create or replace function public.list_my_requests()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  perform app.refresh_customer_alerts(v_uid);
  return jsonb_build_object(
    'notify', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sn.id, 'kind', 'notify', 'status', app.request_status(sn.status, sn.created_at),
        'createdAt', sn.created_at, 'availableAt', sn.available_at,
        'product', jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name,
                                      'image', (app.product_summary(p.id) -> 'image'),
                                      'availabilityState', p.availability_state, 'isDemo', p.is_demo,
                                      'visible', app.product_is_visible(p)),
        'variant', case when sn.variant_id is not null then (
            select jsonb_build_object('sku', s ->> 'sku', 'label', s -> 'variantLabel')
            from app.variant_line_snapshot(sn.variant_id) s) end,
        'stockState', coalesce((select sv.stock_state from app.storefront_variants sv where sv.id = sn.variant_id),
                               (app.product_summary(p.id) ->> 'stockState')))
        order by sn.created_at desc)
      from public.stock_notifications sn join public.products p on p.id = sn.product_id
      where sn.user_id = v_uid), '[]'::jsonb),
    'waitlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'kind', 'waitlist', 'status', app.request_status(w.status, w.created_at),
        'createdAt', w.created_at, 'availableAt', w.available_at,
        'desiredStorage', w.desired_storage, 'desiredColor', w.desired_color,
        'product', jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name,
                                      'image', (app.product_summary(p.id) -> 'image'),
                                      'availabilityState', p.availability_state, 'isDemo', p.is_demo,
                                      'visible', app.product_is_visible(p)))
        order by w.created_at desc)
      from public.waitlist_entries w join public.products p on p.id = w.product_id
      where w.user_id = v_uid), '[]'::jsonb));
end;
$$;

create or replace function public.cancel_my_request(p_kind text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
begin
  if p_kind = 'waitlist' then
    update public.waitlist_entries set status = 'cancelled'
     where id = p_id and user_id = v_uid and status in ('waiting', 'available');
  else
    update public.stock_notifications set status = 'cancelled'
     where id = p_id and user_id = v_uid and status in ('pending', 'available');
  end if;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ════════════════════════════ Abandoned carts ════════════════════════════
create or replace function app.cart_activity(p_customer uuid)
returns table (item_count integer, last_activity timestamptz, converted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select coalesce(sum(ci.quantity) filter (where not ci.saved_for_later), 0)::integer as item_count,
           greatest(max(c.updated_at), max(ci.updated_at)) as last_activity
    from public.carts c left join public.cart_items ci on ci.cart_id = c.id
    where c.customer_id = p_customer)
  select a.item_count, a.last_activity,
         exists (select 1 from public.orders o where o.customer_id = p_customer and o.created_at >= a.last_activity)
  from a;
$$;

create or replace function app.cart_is_abandoned(p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((app.abandoned_cart_config() ->> 'enabled')::boolean, false)
     and a.item_count > 0 and not a.converted
     and a.last_activity < now() - make_interval(hours => least(greatest(coalesce(
           case when (app.abandoned_cart_config() ->> 'thresholdHours') ~ '^[0-9]{1,4}$'
                then (app.abandoned_cart_config() ->> 'thresholdHours')::integer end, 48), 1), 720))
  from app.cart_activity(p_customer) a;
$$;

create or replace function app.process_abandoned_cart(p_user uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
begin
  if app.abandoned_cart_config() ->> 'followUp' <> 'in_app' or not coalesce(app.cart_is_abandoned(p_user), false) then
    return false;
  end if;
  select * into a from app.cart_activity(p_user);
  -- One gentle reminder per idle period (a new cart activity starts a new period).
  return app.notify(p_user, 'cart.abandoned', '{}'::jsonb,
                    'cart:' || floor(extract(epoch from a.last_activity))::bigint, '/cart',
                    jsonb_build_object('itemCount', a.item_count)) is not null;
end;
$$;

create or replace function public.my_cart_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('itemCount', coalesce(a.item_count, 0), 'lastActivity', a.last_activity,
                            'abandoned', coalesce(app.cart_is_abandoned(app.require_customer()), false))
  from (select 1) one left join app.cart_activity(app.require_customer()) a on true;
$$;

create or replace function public.staff_list_abandoned_carts(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customers uuid[];
begin
  perform app.require_permission('customers.view');
  select coalesce(array_agg(c.customer_id order by a.last_activity), '{}') into v_customers
  from public.carts c cross join lateral app.cart_activity(c.customer_id) a
  where app.cart_is_abandoned(c.customer_id);
  return jsonb_build_object(
    'settings', app.abandoned_cart_config(),
    'total', cardinality(v_customers),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'customerId', c.customer_id,
          'customerName', coalesce(pr.full_name, split_part(pr.email, '@', 1)),
          'email', pr.email,
          'itemCount', a.item_count,
          'lastActivity', a.last_activity,
          'reminded', exists (select 1 from public.notifications n
                              where n.user_id = c.customer_id
                                and n.dedupe_key = 'cart:' || floor(extract(epoch from a.last_activity))::bigint),
          'items', (select coalesce(jsonb_agg(jsonb_build_object('sku', s ->> 'sku', 'name', s -> 'name',
                                                                 'quantity', ci.quantity) order by ci.created_at), '[]'::jsonb)
                    from public.cart_items ci cross join lateral app.variant_line_snapshot(ci.variant_id) s
                    where ci.cart_id = c.id and not ci.saved_for_later))
        order by x.ord)
      from unnest(v_customers[greatest(coalesce(p_offset, 0), 0) + 1 :
                              greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 50), 1), 200)])
           with ordinality x(customer_id, ord)
      join public.carts c on c.customer_id = x.customer_id
      join public.profiles pr on pr.id = c.customer_id
      cross join lateral app.cart_activity(c.customer_id) a), '[]'::jsonb));
end;
$$;

-- ══════════════ Lazy per-user refresh (replaces the notifications stub) ══════════════
create or replace function app.refresh_customer_alerts(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  perform app.process_stock_alerts(null, p_user);
  perform app.process_waitlist(null, p_user);
  perform app.process_price_drops(p_user);
  perform app.process_abandoned_cart(p_user);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function app.is_uuid(text), app.current_price(uuid, uuid), app.wishlist_json(uuid),
  app.wishlist_target(text, text), app.process_price_drops(uuid, uuid), app.trim_recently_viewed(uuid),
  app.request_token_hash(text), app.process_stock_alerts(uuid, uuid, uuid), app.process_waitlist(uuid, uuid),
  app.variant_change_alerts(), app.product_change_alerts(), app.request_status(text, timestamptz),
  app.cart_activity(uuid), app.cart_is_abandoned(uuid), app.process_abandoned_cart(uuid), app.refresh_customer_alerts(uuid)
  from public, anon, authenticated;

revoke all on function public.catalog_products(uuid[]) from public;
grant execute on function public.catalog_products(uuid[]) to anon, authenticated, service_role;

revoke all on function public.request_stock_alert(text, text, text, text, text, text),
  public.join_waitlist(text, text, text, text, text, text, text) from public;
grant execute on function public.request_stock_alert(text, text, text, text, text, text),
  public.join_waitlist(text, text, text, text, text, text, text) to anon, authenticated, service_role;

revoke all on function public.wishlist_get(), public.wishlist_set(uuid, uuid, boolean), public.wishlist_merge(jsonb),
  public.recent_track(uuid, uuid), public.recent_merge(jsonb), public.recent_list(integer), public.recent_clear(),
  public.claim_my_requests(jsonb), public.list_my_requests(), public.cancel_my_request(text, uuid),
  public.process_customer_alerts(), public.my_cart_status(), public.staff_list_abandoned_carts(integer, integer)
  from public, anon;
grant execute on function public.wishlist_get(), public.wishlist_set(uuid, uuid, boolean), public.wishlist_merge(jsonb),
  public.recent_track(uuid, uuid), public.recent_merge(jsonb), public.recent_list(integer), public.recent_clear(),
  public.claim_my_requests(jsonb), public.list_my_requests(), public.cancel_my_request(text, uuid),
  public.process_customer_alerts(), public.my_cart_status(), public.staff_list_abandoned_carts(integer, integer)
  to authenticated;
