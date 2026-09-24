-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0007 · Catalog
--
--   brands ─┐                       categories (tree via parent_id)
--           ├── products ── product_categories ──┘
--           │      ├── product_options ── product_option_values
--           │      ├── product_variants ── variant_option_values (one value per option)
--           │      ├── product_media (optionally tied to a colour value / variant)
--           │      ├── product_spec_groups ── product_specs (flexible per category)
--           │      ├── product_relations (accessory / similar / recommended …)
--           │      └── product_rankings (best-seller score; demo vs analytics kept apart)
--   brand_categories (explicit brand ↔ category links)
--
-- Exact Model + Storage + Colour (any option set) is one VARIANT with its own price, old price,
-- SKU, stock, media, availability and warranty. The storefront never reads these tables directly:
-- it uses the SECURITY DEFINER RPCs in 0010, which expose stock STATES only.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── Search normalisation (mirrors src/domain/catalog/search.ts) ──────────────
create or replace function app.normalize_search(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p_value, '')),
        '[' || chr(1611) || '-' || chr(1618) || chr(1648) || chr(1600) || ']', '', 'g'),
      chr(1571) || chr(1573) || chr(1570) || chr(1649) || chr(1609) || chr(1577)
        || chr(1632) || chr(1633) || chr(1634) || chr(1635) || chr(1636)
        || chr(1637) || chr(1638) || chr(1639) || chr(1640) || chr(1641),
      chr(1575) || chr(1575) || chr(1575) || chr(1575) || chr(1610) || chr(1607) || '0123456789'),
    '[[:space:][:punct:]]+', ' ', 'g'));
$$;

grant execute on function app.normalize_search(text) to anon, authenticated, service_role;

-- ── Brands & categories ──────────────────────────────────────────────────────
create table if not exists public.brands (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  name         public.localized_text not null,
  description  public.localized_text,
  logo_url     text,
  sort_order   integer not null default 100,
  is_visible   boolean not null default true,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.categories (
  id                     uuid primary key default gen_random_uuid(),
  parent_id              uuid references public.categories (id),
  slug                   text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  name                   public.localized_text not null,
  description            public.localized_text,
  icon                   text check (icon is null or icon ~ '^[a-z-]{1,30}$'),
  image_url              text,
  sort_order             integer not null default 100,
  is_visible             boolean not null default true,
  show_in_nav            boolean not null default true,
  show_on_home           boolean not null default true,
  show_in_shop           boolean not null default true,
  show_in_category_grid  boolean not null default true,
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  check (parent_id is null or parent_id <> id)
);

create index if not exists categories_parent_idx on public.categories (parent_id);

create table if not exists public.brand_categories (
  brand_id     uuid not null references public.brands (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  primary key (brand_id, category_id)
);

-- ── Products ─────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  brand_id            uuid not null references public.brands (id),
  model               text check (model is null or char_length(model) <= 120),
  name                public.localized_text not null,
  subtitle            public.localized_text,
  description         public.localized_text,
  warranty            public.localized_text,
  availability_state  text not null default 'available'
                      check (availability_state in ('available', 'coming_soon', 'waitlist_only', 'pre_order')),
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_new              boolean not null default false,
  is_featured         boolean not null default false,
  release_date        date,
  keywords            text not null default '' check (char_length(keywords) <= 1000),
  spec_source         text not null default 'manual' check (spec_source in ('manual', 'assisted', 'mixed')),
  seo_title           public.localized_text,
  seo_description     public.localized_text,
  search_text         text not null default '',
  published_at        timestamptz,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

comment on column public.products.availability_state is 'Commercial state of the line: available / coming_soon / waitlist_only / pre_order. Per-variant stock is separate.';
comment on column public.products.search_text is 'Normalised text (names, model, brand, categories, keywords) maintained by triggers; indexed with pg_trgm.';

create index if not exists products_brand_idx on public.products (brand_id);
create index if not exists products_status_idx on public.products (status) where deleted_at is null;
create index if not exists products_release_idx on public.products (release_date desc nulls last);
create index if not exists products_search_trgm_idx on public.products using gin (search_text extensions.gin_trgm_ops);

create table if not exists public.product_categories (
  product_id   uuid not null references public.products (id) on delete cascade,
  category_id  uuid not null references public.categories (id),
  is_primary   boolean not null default false,
  sort_order   integer not null default 0,
  primary key (product_id, category_id)
);

create unique index if not exists product_categories_one_primary_idx
  on public.product_categories (product_id) where is_primary;
create index if not exists product_categories_category_idx on public.product_categories (category_id);

create table if not exists public.product_options (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_-]{0,30}$'),
  name        public.localized_text not null,
  sort_order  integer not null default 0,
  unique (product_id, key)
);

create table if not exists public.product_option_values (
  id          uuid primary key default gen_random_uuid(),
  option_id   uuid not null references public.product_options (id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9-]{1,40}$'),
  label       public.localized_text not null,
  swatch_hex  text check (swatch_hex is null or swatch_hex ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  unique (option_id, key),
  unique (id, option_id)
);

create table if not exists public.product_variants (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  sku                  text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'),
  price                numeric(12, 2) check (price is null or price >= 0),
  compare_at_price     numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  stock_quantity       integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold  integer not null default 2 check (low_stock_threshold >= 0),
  is_active            boolean not null default true,
  is_default           boolean not null default false,
  warranty             public.localized_text,
  sort_order           integer not null default 0,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

comment on column public.product_variants.price is 'FINAL price in EGP (VAT not shown separately). Null = price not announced.';
comment on column public.product_variants.compare_at_price is 'Old price shown as "Was X → Now Y" when greater than price.';
comment on column public.product_variants.stock_quantity is 'Quantity-based stock (IMEI/serial tracking can be added later). Never exposed to the storefront.';

create index if not exists product_variants_product_idx on public.product_variants (product_id);
create unique index if not exists product_variants_one_default_idx
  on public.product_variants (product_id) where is_default and deleted_at is null;

create table if not exists public.variant_option_values (
  variant_id       uuid not null references public.product_variants (id) on delete cascade,
  option_id        uuid not null references public.product_options (id) on delete cascade,
  option_value_id  uuid not null,
  primary key (variant_id, option_id),
  foreign key (option_value_id, option_id) references public.product_option_values (id, option_id) on delete cascade
);

create index if not exists variant_option_values_value_idx on public.variant_option_values (option_value_id);

-- Every variant must carry exactly one value per product option, and no two variants of a product
-- may share the same combination. Checked at commit (deferred) so rows can be inserted in any order.
create or replace function app.assert_variant_combination()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_variant uuid := coalesce(new.variant_id, old.variant_id);
  v_product uuid;
  v_signature text;
begin
  select product_id into v_product from public.product_variants where id = v_variant;
  if v_product is null then return null; end if;

  if (select count(*) from public.variant_option_values where variant_id = v_variant)
     <> (select count(*) from public.product_options where product_id = v_product) then
    raise exception 'variant % must have exactly one value for each product option', v_variant
      using errcode = '23514';
  end if;

  select string_agg(option_value_id::text, ',' order by option_id) into v_signature
  from public.variant_option_values where variant_id = v_variant;

  if exists (
    select 1 from public.product_variants other
    where other.product_id = v_product and other.id <> v_variant and other.deleted_at is null
      and (select string_agg(option_value_id::text, ',' order by option_id)
           from public.variant_option_values where variant_id = other.id) = v_signature
  ) then
    raise exception 'duplicate variant combination for product %', v_product using errcode = '23505';
  end if;
  return null;
end;
$$;

drop trigger if exists variant_option_values_combination on public.variant_option_values;
create constraint trigger variant_option_values_combination
  after insert or update on public.variant_option_values
  deferrable initially deferred
  for each row execute function app.assert_variant_combination();

create table if not exists public.product_media (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  variant_id       uuid references public.product_variants (id) on delete cascade,
  option_value_id  uuid references public.product_option_values (id) on delete cascade,
  kind             text not null default 'image' check (kind in ('image', 'video')),
  url              text not null check (url ~ '^(/|https://)'),
  poster_url       text check (poster_url is null or poster_url ~ '^(/|https://)'),
  captions_url     text check (captions_url is null or captions_url ~ '^(/|https://)'),
  alt              public.localized_text not null,
  width            integer check (width is null or width > 0),
  height           integer check (height is null or height > 0),
  sort_order       integer not null default 0,
  is_cover         boolean not null default false,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.product_media.captions_url is 'WebVTT captions for video media (rendered as a <track>; add them for every video with speech).';
comment on column public.product_media.option_value_id is 'Colour (or other option value) this media belongs to; switching colour on the product page switches the gallery.';

create index if not exists product_media_product_idx on public.product_media (product_id, sort_order);

create table if not exists public.product_spec_groups (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_-]{0,40}$'),
  title       public.localized_text not null,
  sort_order  integer not null default 0,
  unique (product_id, key)
);

create table if not exists public.product_specs (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.product_spec_groups (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_-]{0,40}$'),
  label       public.localized_text not null,
  value       public.localized_text not null,
  sort_order  integer not null default 0,
  status      text not null default 'approved' check (status in ('approved', 'suggested')),
  source      text not null default 'manual' check (source in ('manual', 'assisted')),
  unique (group_id, key)
);

comment on column public.product_specs.status is 'Assisted (AI/data provider) suggestions stay "suggested" until staff approve them; only approved specs are public.';

create table if not exists public.product_relations (
  product_id          uuid not null references public.products (id) on delete cascade,
  related_product_id  uuid not null references public.products (id) on delete cascade,
  kind                text not null check (kind in ('accessory', 'similar', 'recommended', 'bought_together', 'compatible')),
  sort_order          integer not null default 0,
  status              text not null default 'approved' check (status in ('approved', 'suggested')),
  source              text not null default 'manual' check (source in ('manual', 'suggested')),
  primary key (product_id, related_product_id, kind),
  check (product_id <> related_product_id)
);

create table if not exists public.product_rankings (
  product_id         uuid primary key references public.products (id) on delete cascade,
  best_seller_score  numeric(10, 2) not null default 0,
  source             text not null check (source in ('demo', 'analytics')),
  updated_at         timestamptz not null default now()
);

comment on table public.product_rankings is 'Best-seller score. Demo products use source=demo; real products only ever use source=analytics (Phase 06).';

-- ── Timestamps ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['brands', 'categories', 'products', 'product_variants', 'product_media'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ── Search text maintenance ──────────────────────────────────────────────────
create or replace function app.product_category_slugs(p_product_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  with recursive tree as (
    select c.id, c.parent_id, c.slug
    from public.product_categories pc join public.categories c on c.id = pc.category_id
    where pc.product_id = p_product_id
    union
    select parent.id, parent.parent_id, parent.slug
    from tree join public.categories parent on parent.id = tree.parent_id
  )
  select coalesce(array_agg(distinct slug), '{}') from tree;
$$;

create or replace function app.compute_product_search_text(p_product public.products)
returns text
language sql
stable
set search_path = ''
as $$
  select app.normalize_search(concat_ws(' ',
    p_product.name ->> 'ar', p_product.name ->> 'en', p_product.model,
    p_product.subtitle ->> 'ar', p_product.subtitle ->> 'en', p_product.keywords,
    (select concat_ws(' ', b.name ->> 'ar', b.name ->> 'en') from public.brands b where b.id = p_product.brand_id),
    (select string_agg(concat_ws(' ', c.name ->> 'ar', c.name ->> 'en'), ' ')
       from public.categories c where c.slug = any (app.product_category_slugs(p_product.id)))
  ));
$$;

create or replace function app.products_set_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := app.compute_product_search_text(new);
  return new;
end;
$$;

drop trigger if exists products_search_text on public.products;
create trigger products_search_text before insert or update of name, model, subtitle, keywords, brand_id, search_text
  on public.products for each row execute function app.products_set_search_text();

-- Category links / brand or category renames refresh the affected products.
create or replace function app.refresh_product_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'product_categories' then
    update public.products set search_text = '' where id = coalesce(new.product_id, old.product_id);
  elsif tg_table_name = 'brands' then
    update public.products set search_text = '' where brand_id = new.id;
  elsif tg_table_name = 'categories' then
    update public.products p set search_text = ''
    where new.slug = any (app.product_category_slugs(p.id)) or old.slug = any (app.product_category_slugs(p.id));
  end if;
  return null;
end;
$$;

drop trigger if exists product_categories_refresh_search on public.product_categories;
create trigger product_categories_refresh_search after insert or update or delete on public.product_categories
  for each row execute function app.refresh_product_search_text();

drop trigger if exists brands_refresh_search on public.brands;
create trigger brands_refresh_search after update of name on public.brands
  for each row execute function app.refresh_product_search_text();

drop trigger if exists categories_refresh_search on public.categories;
create trigger categories_refresh_search after update of name, slug, parent_id on public.categories
  for each row execute function app.refresh_product_search_text();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Storefront visitors never read these tables directly (RPCs in 0010). Staff read with catalog.view;
-- admin write paths (with price/stock history) arrive in Phase 06.
do $$
declare
  t text;
begin
  foreach t in array array['brands', 'categories', 'brand_categories', 'products', 'product_categories',
                           'product_options', 'product_option_values', 'product_variants', 'variant_option_values',
                           'product_media', 'product_spec_groups', 'product_specs', 'product_relations',
                           'product_rankings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.has_permission(''catalog.view'')))',
                   t || '_staff_select', t);
  end loop;
end;
$$;

-- ── Audit (catalog, prices and stock changes) ────────────────────────────────
drop trigger if exists brands_audit on public.brands;
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function app.audit_row_change('slug');
drop trigger if exists categories_audit on public.categories;
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function app.audit_row_change('slug');
drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function app.audit_row_change('slug', 'search_text');
drop trigger if exists product_variants_audit on public.product_variants;
create trigger product_variants_audit after insert or update or delete on public.product_variants
  for each row execute function app.audit_row_change('sku');

-- ── Demo data registry (children are removed by FK cascades) ─────────────────
select app.register_demo_table('public.product_variants', 20);
select app.register_demo_table('public.product_media', 20);
select app.register_demo_table('public.products', 30);
select app.register_demo_table('public.categories', 40);
select app.register_demo_table('public.brands', 50);
