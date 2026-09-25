-- ════════════════════════════════════════════════════════════════════════════
-- Phase 04 · Customer accounts: engagement settings, profile editing, saved addresses.
--
-- Settings (contract: src/domain/settings/setting-definitions.json):
--   engagement      (public)  wishlist / recently viewed / compare / reviews / requests / recommendations
--   abandoned_cart  (private) enabled, threshold, follow-up mode (in-app only in V1)
--   notifications   (private) optional external channels — all disabled; in-app always works
--
-- Addresses share one typed model with checkout delivery (governorate / area / address / notes);
-- app.delivery_address_problem() applies the same rules create_order applies to a delivery address.
-- Customers can only read and write their own addresses (RLS + RPCs, no direct writes).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('engagement',     'settings', true,  'settings.manage', 'settings.publish'),
  ('abandoned_cart', 'settings', false, 'settings.manage', 'settings.publish'),
  ('notifications',  'settings', false, 'settings.manage', 'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- Setting readers with safe defaults (a missing or partial setting never breaks a feature).
create or replace function app.engagement_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'wishlist', jsonb_build_object('maxItems', 100, 'priceDropPercent', 5),
    'recentlyViewed', jsonb_build_object('maxItems', 20),
    'compare', jsonb_build_object('maxItems', 4),
    'reviews', jsonb_build_object('enabled', true, 'eligibleStatuses', jsonb_build_array('delivered', 'completed'),
                                  'allowImages', true),
    'requests', jsonb_build_object('expireAfterDays', 180),
    'recommendations', jsonb_build_object('minCustomers', 2, 'limit', 8))
  || coalesce((select value from public.site_settings where key = 'engagement'), '{}'::jsonb);
$$;

create or replace function app.engagement_int(p_section text, p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(greatest(coalesce(
    case when (app.engagement_config() -> p_section ->> p_key) ~ '^[0-9]{1,6}$'
         then (app.engagement_config() -> p_section ->> p_key)::integer end,
    p_default), p_min), p_max);
$$;

create or replace function app.abandoned_cart_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('enabled', true, 'thresholdHours', 48, 'followUp', 'in_app')
  || coalesce((select value from public.site_settings where key = 'abandoned_cart'), '{}'::jsonb);
$$;

-- ── Profile ─────────────────────────────────────────────────────────────────
-- Name, Egyptian phone (normalised exactly like checkout) and preferred language. Email is the
-- verified sign-in email and is not editable here.
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_locale text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := null;
begin
  if v_name is not null and char_length(v_name) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'fullName');
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_phone := app.normalize_egyptian_phone(p_phone);
    if v_phone is null or v_phone !~ '^\+201[0125][0-9]{8}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'phone');
    end if;
  end if;
  if p_locale is not null and not app.is_locale(p_locale) then
    return jsonb_build_object('ok', false, 'code', 'invalid_locale', 'field', 'preferredLocale');
  end if;

  update public.profiles
     set full_name = v_name,
         phone = v_phone,
         preferred_locale = coalesce(p_locale, preferred_locale)
   where id = v_uid;
  return jsonb_build_object('ok', true, 'profile', (
    select jsonb_build_object('id', p.id, 'email', p.email, 'fullName', p.full_name, 'phone', p.phone,
                              'preferredLocale', p.preferred_locale, 'createdAt', p.created_at)
    from public.profiles p where p.id = v_uid));
end;
$$;

-- ── Saved addresses ─────────────────────────────────────────────────────────
create table if not exists public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null default 'home' check (label in ('home', 'work', 'other')),
  governorate  text not null check (governorate ~ '^[a-z_]{2,40}$'),
  area         text not null check (char_length(area) between 2 and 120),
  address      text not null check (char_length(address) between 5 and 400),
  notes        text check (notes is null or char_length(notes) <= 400),
  phone        text check (phone is null or phone ~ '^\+201[0125][0-9]{8}$'),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.customer_addresses is 'Saved delivery addresses; same shape as the checkout delivery address. Owner-only.';

create index if not exists customer_addresses_user_idx on public.customer_addresses (user_id, created_at);
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (user_id) where is_default;

drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at before update on public.customer_addresses
  for each row execute function app.set_updated_at();

alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from anon;
revoke insert, update, delete, truncate on public.customer_addresses from authenticated;
drop policy if exists customer_addresses_owner_select on public.customer_addresses;
create policy customer_addresses_owner_select on public.customer_addresses for select to authenticated
  using (user_id = (select app.current_actor_id()) or (select app.has_permission('customers.view')));

-- Same rules create_order applies to a delivery address; returns the failing field or null.
create or replace function app.delivery_address_problem(p_address jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_address ->> 'governorate', ''))) !~ '^[a-z_]{2,40}$' then 'governorate'
    when char_length(btrim(coalesce(p_address ->> 'area', ''))) not between 2 and 120 then 'area'
    when char_length(btrim(coalesce(p_address ->> 'address', ''))) not between 5 and 400 then 'address'
    when char_length(btrim(coalesce(p_address ->> 'notes', ''))) > 400 then 'notes'
  end;
$$;

create or replace function app.address_json(a public.customer_addresses)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'label', a.label, 'governorate', a.governorate, 'area', a.area,
    'address', a.address, 'notes', a.notes, 'phone', a.phone, 'isDefault', a.is_default,
    'createdAt', a.created_at, 'updatedAt', a.updated_at);
$$;

create or replace function public.list_my_addresses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.address_json(a) order by a.is_default desc, a.created_at), '[]'::jsonb)
  from public.customer_addresses a where a.user_id = app.require_customer();
$$;

-- Create (no id) or update (own id). At most 10 addresses; the first one becomes the default.
create or replace function public.save_my_address(p_address jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_id uuid;
  v_problem text := app.delivery_address_problem(p_address);
  v_label text := coalesce(nullif(p_address ->> 'label', ''), 'home');
  v_phone text := null;
  v_default boolean := coalesce((p_address ->> 'isDefault')::boolean, false);
  v_row public.customer_addresses;
begin
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', v_problem);
  end if;
  if v_label not in ('home', 'work', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_address', 'field', 'label');
  end if;
  if nullif(btrim(coalesce(p_address ->> 'phone', '')), '') is not null then
    v_phone := app.normalize_egyptian_phone(p_address ->> 'phone');
    if v_phone is null or v_phone !~ '^\+201[0125][0-9]{8}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'phone');
    end if;
  end if;
  if (p_address ->> 'id') is not null then
    if (p_address ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    v_id := (p_address ->> 'id')::uuid;
    if not exists (select 1 from public.customer_addresses where id = v_id and user_id = v_uid) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  elsif (select count(*) from public.customer_addresses where user_id = v_uid) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many_addresses');
  end if;
  if not exists (select 1 from public.customer_addresses where user_id = v_uid and (v_id is null or id <> v_id)) then
    v_default := true;
  end if;
  if v_default then
    update public.customer_addresses set is_default = false where user_id = v_uid and is_default;
  end if;

  if v_id is null then
    insert into public.customer_addresses (user_id, label, governorate, area, address, notes, phone, is_default)
    values (v_uid, v_label, lower(btrim(p_address ->> 'governorate')), btrim(p_address ->> 'area'),
            btrim(p_address ->> 'address'), nullif(btrim(coalesce(p_address ->> 'notes', '')), ''), v_phone, v_default)
    returning * into v_row;
  else
    update public.customer_addresses
       set label = v_label, governorate = lower(btrim(p_address ->> 'governorate')), area = btrim(p_address ->> 'area'),
           address = btrim(p_address ->> 'address'), notes = nullif(btrim(coalesce(p_address ->> 'notes', '')), ''),
           phone = v_phone,
           is_default = case when v_default then true else is_default end
     where id = v_id
    returning * into v_row;
  end if;
  return jsonb_build_object('ok', true, 'address', app.address_json(v_row));
end;
$$;

create or replace function public.delete_my_address(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  v_was_default boolean;
begin
  delete from public.customer_addresses where id = p_id and user_id = v_uid returning is_default into v_was_default;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_was_default then
    update public.customer_addresses set is_default = true
     where id = (select id from public.customer_addresses where user_id = v_uid order by created_at limit 1);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function app.engagement_config(), app.engagement_int(text, text, integer, integer, integer),
  app.abandoned_cart_config(), app.delivery_address_problem(jsonb), app.address_json(public.customer_addresses)
  from public, anon, authenticated;
revoke all on function public.update_my_profile(text, text, text), public.list_my_addresses(),
  public.save_my_address(jsonb), public.delete_my_address(uuid) from public, anon;
grant execute on function public.update_my_profile(text, text, text), public.list_my_addresses(),
  public.save_my_address(jsonb), public.delete_my_address(uuid) to authenticated;
