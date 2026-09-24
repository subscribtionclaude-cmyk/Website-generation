-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0008 · Offers, content entries & page sections
--
--   offers ── offer_products / offer_categories   (price drop, %, fixed, bundle, gift, buy X get Y,
--                                                   limited-time, promo code, flash)
--   content_entries ── content_entry_products     (campaign, new_release, coming_soon,
--                                                   offer_update, news)
--   page_sections                                 (section-registry rows for Home / Apple / Offers;
--                                                   versioned drafts arrive with the Phase 07 editor)
-- All customer-facing text is localized_text. Countdowns derive from starts_at / ends_at.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.is_safe_href(p_href text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_href is null or (p_href ~ '^/' and p_href !~ '^//') or p_href ~ '^https://';
$$;

create table if not exists public.offers (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  kind              text not null check (kind in ('flash', 'price_drop', 'bundle', 'free_gift', 'promo_code',
                                                 'limited_time', 'percentage', 'fixed', 'buy_x_get_y')),
  title             public.localized_text not null,
  subtitle          public.localized_text,
  description       public.localized_text,
  badge             public.localized_text not null,
  media_kind        text check (media_kind is null or media_kind in ('image', 'video')),
  media_url         text check (media_url is null or media_url ~ '^(/|https://)'),
  media_alt         public.localized_text,
  cta_label         public.localized_text,
  cta_href          text check (app.is_safe_href(cta_href)),
  discount_percent  numeric(5, 2) check (discount_percent is null or discount_percent between 0 and 100),
  discount_amount   numeric(12, 2) check (discount_amount is null or discount_amount >= 0),
  bundle_price      numeric(12, 2) check (bundle_price is null or bundle_price >= 0),
  promo_code        text check (promo_code is null or promo_code ~ '^[A-Z0-9_-]{3,30}$'),
  starts_at         timestamptz,
  ends_at           timestamptz,
  show_countdown    boolean not null default false,
  featured_on_home  boolean not null default false,
  status            text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order        integer not null default 100,
  seo_title         public.localized_text,
  seo_description   public.localized_text,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists offers_window_idx on public.offers (status, starts_at, ends_at);

create table if not exists public.offer_products (
  offer_id    uuid not null references public.offers (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  role        text not null default 'target' check (role in ('target', 'bundle_item', 'gift')),
  quantity    integer not null default 1 check (quantity > 0),
  sort_order  integer not null default 0,
  primary key (offer_id, product_id, role)
);

create index if not exists offer_products_product_idx on public.offer_products (product_id);

create table if not exists public.offer_categories (
  offer_id     uuid not null references public.offers (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  primary key (offer_id, category_id)
);

create table if not exists public.content_entries (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  type                text not null check (type in ('campaign', 'new_release', 'coming_soon', 'offer_update', 'news')),
  eyebrow             public.localized_text,
  title               public.localized_text not null,
  subtitle            public.localized_text,
  excerpt             public.localized_text,
  body                public.localized_text,
  media_kind          text check (media_kind is null or media_kind in ('image', 'video')),
  media_url           text check (media_url is null or media_url ~ '^(/|https://)'),
  media_poster_url    text check (media_poster_url is null or media_poster_url ~ '^(/|https://)'),
  media_captions_url  text check (media_captions_url is null or media_captions_url ~ '^(/|https://)'),
  media_alt           public.localized_text,
  cta_label           public.localized_text,
  cta_href            text check (app.is_safe_href(cta_href)),
  secondary_cta_label public.localized_text,
  secondary_cta_href  text check (app.is_safe_href(secondary_cta_href)),
  state               text check (state is null or state in ('available', 'coming_soon', 'waitlist_only', 'pre_order')),
  release_date        date,
  publish_at          timestamptz not null default now(),
  expires_at          timestamptz,
  is_featured         boolean not null default false,
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  seo_title           public.localized_text,
  seo_description     public.localized_text,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (expires_at is null or expires_at > publish_at)
);

create index if not exists content_entries_feed_idx on public.content_entries (type, status, publish_at desc);

create table if not exists public.content_entry_products (
  entry_id    uuid not null references public.content_entries (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (entry_id, product_id)
);

create table if not exists public.page_sections (
  id          uuid primary key default gen_random_uuid(),
  page_key    text not null check (page_key ~ '^[a-z0-9-]{1,40}$'),
  key         text not null check (key ~ '^[a-z0-9-]{1,60}$'),
  type        text not null check (type ~ '^[a-z_]{1,40}$'),
  sort_order  integer not null default 100,
  is_visible  boolean not null default true,
  props       jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 65536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (page_key, key)
);

comment on table public.page_sections is 'Section-registry rows per page. Props are validated per type by the storefront (src/domain/content/sections.ts).';

do $$
declare
  t text;
begin
  foreach t in array array['offers', 'content_entries', 'page_sections'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;

  foreach t in array array['offers', 'offer_products', 'offer_categories', 'content_entries',
                           'content_entry_products', 'page_sections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
  end loop;
end;
$$;

create policy offers_staff_select on public.offers for select to authenticated
  using ((select app.has_permission('marketing.manage')) or (select app.has_permission('content.view')));
create policy offer_products_staff_select on public.offer_products for select to authenticated
  using ((select app.has_permission('marketing.manage')) or (select app.has_permission('content.view')));
create policy offer_categories_staff_select on public.offer_categories for select to authenticated
  using ((select app.has_permission('marketing.manage')) or (select app.has_permission('content.view')));
create policy content_entries_staff_select on public.content_entries for select to authenticated
  using ((select app.has_permission('content.view')));
create policy content_entry_products_staff_select on public.content_entry_products for select to authenticated
  using ((select app.has_permission('content.view')));
create policy page_sections_staff_select on public.page_sections for select to authenticated
  using ((select app.has_permission('design.edit')) or (select app.has_permission('content.view')));

drop trigger if exists offers_audit on public.offers;
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function app.audit_row_change('slug');
drop trigger if exists content_entries_audit on public.content_entries;
create trigger content_entries_audit after insert or update or delete on public.content_entries
  for each row execute function app.audit_row_change('slug');
drop trigger if exists page_sections_audit on public.page_sections;
create trigger page_sections_audit after insert or update or delete on public.page_sections
  for each row execute function app.audit_row_change('page_key,key');

select app.register_demo_table('public.offers', 10);
select app.register_demo_table('public.content_entries', 10);

-- ── Customer requests: "Notify me when available" & Coming Soon waitlists ───
-- Persisted now so the storefront CTAs are real; staff follow-up screens and automatic
-- notifications (when a provider is configured) arrive in Phases 04/06.
create table if not exists public.stock_notifications (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  user_id     uuid,
  name        text not null check (char_length(name) between 2 and 80),
  phone       text not null check (phone ~ '^\+20[0-9]{9,10}$'),
  email       text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  locale      text not null default 'ar' check (app.is_locale(locale)),
  status      text not null default 'pending' check (status in ('pending', 'notified', 'cancelled')),
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);

create unique index if not exists stock_notifications_unique_idx
  on public.stock_notifications (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), phone)
  where status = 'pending';

create table if not exists public.waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  user_id          uuid,
  name             text not null check (char_length(name) between 2 and 80),
  phone            text not null check (phone ~ '^\+20[0-9]{9,10}$'),
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  desired_storage  text check (desired_storage is null or char_length(desired_storage) <= 40),
  desired_color    text check (desired_color is null or char_length(desired_color) <= 40),
  locale           text not null default 'ar' check (app.is_locale(locale)),
  status           text not null default 'waiting' check (status in ('waiting', 'notified', 'converted', 'cancelled')),
  created_at       timestamptz not null default now()
);

create unique index if not exists waitlist_entries_unique_idx
  on public.waitlist_entries (product_id, phone) where status = 'waiting';

alter table public.stock_notifications enable row level security;
alter table public.waitlist_entries enable row level security;
revoke all on public.stock_notifications, public.waitlist_entries from anon;
revoke insert, update, delete, truncate on public.stock_notifications, public.waitlist_entries from authenticated;

drop policy if exists stock_notifications_staff_select on public.stock_notifications;
create policy stock_notifications_staff_select on public.stock_notifications for select to authenticated
  using ((select app.has_permission('waitlists.manage')));
drop policy if exists waitlist_entries_staff_select on public.waitlist_entries;
create policy waitlist_entries_staff_select on public.waitlist_entries for select to authenticated
  using ((select app.has_permission('waitlists.manage')));

-- ── New settings keys (contract: setting-definitions.json) ───────────────────
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission) values
  ('trust',   'content',  true, 'content.manage',  'content.publish'),
  ('catalog', 'settings', true, 'settings.manage', 'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;
