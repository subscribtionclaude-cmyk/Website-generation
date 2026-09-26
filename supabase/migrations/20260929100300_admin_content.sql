-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Phase 06 · Marketing & content administration
--   Offers (all kinds incl. promo codes; buy-X-get-Y is stored and displayed, applied by staff),
--   news / releases / coming-soon entries with draft → published, and structured editing of the
--   existing homepage / Apple / offers page sections (no layout editing — that is Phase 07).
--   Row triggers from Phase 02 already audit offers, entries and page sections.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.offers add column if not exists buy_quantity integer check (buy_quantity is null or buy_quantity between 1 and 20);
alter table public.offers add column if not exists get_quantity integer check (get_quantity is null or get_quantity between 1 and 20);

-- ── Offers ──────────────────────────────────────────────────────────────────
create or replace function app.offer_state(p_offer public.offers)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_offer.status <> 'published' then p_offer.status
    when p_offer.starts_at is not null and p_offer.starts_at > now() then 'scheduled'
    when p_offer.ends_at is not null and p_offer.ends_at <= now() then 'expired'
    else 'active' end;
$$;

create or replace function app.admin_offer_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'kind', o.kind, 'title', o.title, 'subtitle', o.subtitle,
    'description', o.description, 'badge', o.badge, 'mediaKind', o.media_kind, 'mediaUrl', o.media_url,
    'mediaAlt', o.media_alt, 'ctaLabel', o.cta_label, 'ctaHref', o.cta_href,
    'discountPercent', o.discount_percent, 'discountAmount', o.discount_amount, 'bundlePrice', o.bundle_price,
    'promoCode', o.promo_code, 'minSubtotal', o.min_subtotal, 'maxRedemptions', o.max_redemptions,
    'maxRedemptionsPerCustomer', o.max_redemptions_per_customer, 'buyQuantity', o.buy_quantity,
    'getQuantity', o.get_quantity, 'startsAt', o.starts_at, 'endsAt', o.ends_at,
    'showCountdown', o.show_countdown, 'featuredOnHome', o.featured_on_home, 'status', o.status,
    'state', app.offer_state(o), 'sortOrder', o.sort_order, 'seoTitle', o.seo_title,
    'seoDescription', o.seo_description, 'isDemo', o.is_demo, 'updatedAt', o.updated_at,
    'redemptions', (select count(*) from public.promo_redemptions r where r.offer_id = o.id and r.status = 'active'),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'productId', op.product_id, 'variantId', op.variant_id, 'role', op.role, 'quantity', op.quantity,
        'name', p.name, 'slug', p.slug) order by op.sort_order)
      from public.offer_products op join public.products p on p.id = op.product_id where op.offer_id = o.id), '[]'::jsonb),
    'categoryIds', coalesce((select jsonb_agg(oc.category_id) from public.offer_categories oc where oc.offer_id = o.id), '[]'::jsonb))
  from public.offers o where o.id = p_id and o.deleted_at is null;
$$;

create or replace function public.admin_list_offers(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_any_permission(array['marketing.manage', 'content.view']);
  v_limit  integer := app.page_limit(p_filter, 50, 200);
  v_offset integer := app.page_offset(p_filter);
  v_q      text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_kind   text := nullif(p_filter ->> 'kind', '');
  v_state  text := nullif(p_filter ->> 'state', '');
  v_promo  boolean := coalesce((p_filter ->> 'promoOnly')::boolean, false);
  v_total  integer;
  v_items  jsonb;
begin
  with matched as (
    select o.*, app.offer_state(o) as state from public.offers o
    where o.deleted_at is null
      and (v_kind is null or o.kind = v_kind)
      and (not v_promo or o.promo_code is not null)
      and (v_q is null or o.slug ilike app.like_pattern(v_q) or o.title ->> 'ar' ilike app.like_pattern(v_q)
           or o.title ->> 'en' ilike app.like_pattern(v_q) or coalesce(o.promo_code, '') ilike app.like_pattern(v_q))
  )
  select (select count(*) from matched where v_state is null or state = v_state),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'slug', m.slug, 'kind', m.kind, 'title', m.title, 'promoCode', m.promo_code,
             'status', m.status, 'state', m.state, 'startsAt', m.starts_at, 'endsAt', m.ends_at,
             'featuredOnHome', m.featured_on_home, 'discountPercent', m.discount_percent,
             'discountAmount', m.discount_amount, 'sortOrder', m.sort_order, 'isDemo', m.is_demo,
             'updatedAt', m.updated_at,
             'productCount', (select count(*) from public.offer_products op where op.offer_id = m.id),
             'redemptions', (select count(*) from public.promo_redemptions r where r.offer_id = m.id and r.status = 'active'))
             order by m.sort_order, m.updated_at desc)
           from (select * from matched where v_state is null or state = v_state
                 order by sort_order, updated_at desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_get_offer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_any_permission(array['marketing.manage', 'content.view']);
begin
  return app.admin_offer_json(p_id);
end;
$$;

create or replace function public.admin_save_offer(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_permission('marketing.manage');
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_slug    text := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_kind    text := coalesce(p_payload ->> 'kind', '');
  v_status  text := coalesce(nullif(p_payload ->> 'status', ''), 'draft');
  v_code    text := nullif(upper(btrim(coalesce(p_payload ->> 'promoCode', ''))), '');
  v_percent numeric := app.json_numeric(p_payload -> 'discountPercent');
  v_amount  numeric := app.json_numeric(p_payload -> 'discountAmount');
  v_bundle  numeric := app.json_numeric(p_payload -> 'bundlePrice');
  v_min     numeric := app.json_numeric(p_payload -> 'minSubtotal');
  v_starts  timestamptz := nullif(p_payload ->> 'startsAt', '')::timestamptz;
  v_ends    timestamptz := nullif(p_payload ->> 'endsAt', '')::timestamptz;
  v_products jsonb := coalesce(p_payload -> 'products', '[]'::jsonb);
  v_row     public.offers;
begin
  if v_slug !~ '^[a-z0-9-]{1,80}$' then return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'field', 'slug'); end if;
  if v_kind not in ('flash', 'price_drop', 'bundle', 'free_gift', 'promo_code', 'limited_time', 'percentage', 'fixed', 'buy_x_get_y') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'field', 'kind');
  end if;
  if v_status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if not app.valid_lt(p_payload -> 'title') then return jsonb_build_object('ok', false, 'code', 'title_required', 'field', 'title'); end if;
  if not app.valid_lt(p_payload -> 'badge') then return jsonb_build_object('ok', false, 'code', 'badge_required', 'field', 'badge'); end if;
  if not app.valid_lt(p_payload -> 'subtitle', false) or not app.valid_lt(p_payload -> 'description', false)
     or not app.valid_lt(p_payload -> 'ctaLabel', false) or not app.valid_lt(p_payload -> 'mediaAlt', false) then
    return jsonb_build_object('ok', false, 'code', 'invalid_text');
  end if;
  if nullif(p_payload ->> 'ctaHref', '') is not null and not app.is_safe_href(p_payload ->> 'ctaHref') then
    return jsonb_build_object('ok', false, 'code', 'invalid_link', 'field', 'ctaHref');
  end if;
  if nullif(p_payload ->> 'mediaUrl', '') is not null and p_payload ->> 'mediaUrl' !~ '^(/|https://)' then
    return jsonb_build_object('ok', false, 'code', 'invalid_media', 'field', 'mediaUrl');
  end if;
  if v_percent = 'NaN'::numeric or v_amount = 'NaN'::numeric or v_bundle = 'NaN'::numeric or v_min = 'NaN'::numeric
     or v_percent is not null and (v_percent <= 0 or v_percent > 100) or v_amount is not null and v_amount <= 0
     or v_bundle is not null and v_bundle < 0 or v_min is not null and v_min < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_discount', 'field', 'discount');
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    return jsonb_build_object('ok', false, 'code', 'invalid_dates', 'field', 'endsAt');
  end if;
  -- Kind-specific requirements.
  if v_kind in ('percentage', 'flash', 'limited_time') and v_percent is null and v_amount is null
     or v_kind = 'fixed' and v_amount is null then
    return jsonb_build_object('ok', false, 'code', 'discount_required', 'field', 'discount');
  end if;
  if v_kind in ('flash', 'limited_time') and v_ends is null then
    return jsonb_build_object('ok', false, 'code', 'end_required', 'field', 'endsAt');
  end if;
  if v_kind = 'promo_code' then
    if v_code is null or v_code !~ '^[A-Z0-9_-]{3,30}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_code', 'field', 'promoCode');
    end if;
    if v_percent is null and v_amount is null then
      return jsonb_build_object('ok', false, 'code', 'discount_required', 'field', 'discount');
    end if;
  elsif v_code is not null then
    return jsonb_build_object('ok', false, 'code', 'code_only_for_promo', 'field', 'promoCode');
  end if;
  if v_code is not null and exists (select 1 from public.offers where upper(promo_code) = v_code and deleted_at is null
                                    and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'code_taken', 'field', 'promoCode');
  end if;
  if v_kind = 'bundle' and (select count(*) from jsonb_array_elements(v_products) x where x ->> 'role' = 'bundle_item') < 2 then
    return jsonb_build_object('ok', false, 'code', 'bundle_items_required', 'field', 'products');
  end if;
  if v_kind = 'free_gift' and not exists (select 1 from jsonb_array_elements(v_products) x where x ->> 'role' = 'gift') then
    return jsonb_build_object('ok', false, 'code', 'gift_required', 'field', 'products');
  end if;
  if v_kind = 'buy_x_get_y' and (nullif(p_payload ->> 'buyQuantity', '') is null or nullif(p_payload ->> 'getQuantity', '') is null) then
    return jsonb_build_object('ok', false, 'code', 'quantities_required', 'field', 'buyQuantity');
  end if;
  if exists (select 1 from jsonb_array_elements(v_products) x
             where coalesce(x ->> 'role', 'target') not in ('target', 'bundle_item', 'gift')
                or not exists (select 1 from public.products p where p.id = nullif(x ->> 'productId', '')::uuid and p.deleted_at is null)
                or (nullif(x ->> 'variantId', '') is not null and not exists (
                      select 1 from public.product_variants v where v.id = (x ->> 'variantId')::uuid
                        and v.product_id = (x ->> 'productId')::uuid and v.deleted_at is null))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_product', 'field', 'products');
  end if;
  if exists (select 1 from public.offers where slug = v_slug and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'field', 'slug');
  end if;

  if v_id is null then
    insert into public.offers (slug, kind, title, subtitle, description, badge, media_kind, media_url, media_alt,
                               cta_label, cta_href, discount_percent, discount_amount, bundle_price, promo_code,
                               min_subtotal, max_redemptions, max_redemptions_per_customer, buy_quantity, get_quantity,
                               starts_at, ends_at, show_countdown, featured_on_home, status, sort_order,
                               seo_title, seo_description)
    values (v_slug, v_kind, app.json_lt(p_payload -> 'title'), app.json_lt(p_payload -> 'subtitle'),
            app.json_lt(p_payload -> 'description'), app.json_lt(p_payload -> 'badge'),
            case when nullif(p_payload ->> 'mediaUrl', '') is not null then coalesce(nullif(p_payload ->> 'mediaKind', ''), 'image') end,
            nullif(p_payload ->> 'mediaUrl', ''), app.json_lt(p_payload -> 'mediaAlt'),
            app.json_lt(p_payload -> 'ctaLabel'), nullif(p_payload ->> 'ctaHref', ''),
            v_percent, v_amount, v_bundle, v_code, v_min,
            nullif(p_payload ->> 'maxRedemptions', '')::integer, nullif(p_payload ->> 'maxRedemptionsPerCustomer', '')::integer,
            nullif(p_payload ->> 'buyQuantity', '')::integer, nullif(p_payload ->> 'getQuantity', '')::integer,
            v_starts, v_ends, coalesce((p_payload ->> 'showCountdown')::boolean, false),
            coalesce((p_payload ->> 'featuredOnHome')::boolean, false), v_status,
            coalesce(nullif(p_payload ->> 'sortOrder', '')::integer, 0),
            app.json_lt(p_payload -> 'seoTitle'), app.json_lt(p_payload -> 'seoDescription'))
    returning * into v_row;
  else
    select * into v_row from public.offers where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_row.updated_at is distinct from nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
    end if;
    update public.offers set slug = v_slug, kind = v_kind, title = app.json_lt(p_payload -> 'title'),
      subtitle = app.json_lt(p_payload -> 'subtitle'), description = app.json_lt(p_payload -> 'description'),
      badge = app.json_lt(p_payload -> 'badge'),
      media_kind = case when nullif(p_payload ->> 'mediaUrl', '') is not null then coalesce(nullif(p_payload ->> 'mediaKind', ''), 'image') end,
      media_url = nullif(p_payload ->> 'mediaUrl', ''), media_alt = app.json_lt(p_payload -> 'mediaAlt'),
      cta_label = app.json_lt(p_payload -> 'ctaLabel'), cta_href = nullif(p_payload ->> 'ctaHref', ''),
      discount_percent = v_percent, discount_amount = v_amount, bundle_price = v_bundle, promo_code = v_code,
      min_subtotal = v_min, max_redemptions = nullif(p_payload ->> 'maxRedemptions', '')::integer,
      max_redemptions_per_customer = nullif(p_payload ->> 'maxRedemptionsPerCustomer', '')::integer,
      buy_quantity = nullif(p_payload ->> 'buyQuantity', '')::integer, get_quantity = nullif(p_payload ->> 'getQuantity', '')::integer,
      starts_at = v_starts, ends_at = v_ends, show_countdown = coalesce((p_payload ->> 'showCountdown')::boolean, false),
      featured_on_home = coalesce((p_payload ->> 'featuredOnHome')::boolean, false), status = v_status,
      sort_order = coalesce(nullif(p_payload ->> 'sortOrder', '')::integer, sort_order),
      seo_title = app.json_lt(p_payload -> 'seoTitle'), seo_description = app.json_lt(p_payload -> 'seoDescription'),
      updated_at = clock_timestamp()
    where id = v_id returning * into v_row;
  end if;

  delete from public.offer_products where offer_id = v_row.id;
  insert into public.offer_products (offer_id, product_id, variant_id, role, quantity, sort_order)
  select v_row.id, (x ->> 'productId')::uuid, nullif(x ->> 'variantId', '')::uuid, coalesce(x ->> 'role', 'target'),
         greatest(coalesce(nullif(x ->> 'quantity', '')::integer, 1), 1), ord::integer
  from jsonb_array_elements(v_products) with ordinality as t (x, ord);
  delete from public.offer_categories where offer_id = v_row.id;
  insert into public.offer_categories (offer_id, category_id)
  select distinct v_row.id, c.id::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'categoryIds', '[]')) c (id)
  join public.categories cat on cat.id = c.id::uuid and cat.deleted_at is null;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'updatedAt', v_row.updated_at);
end;
$$;

create or replace function public.admin_set_offers_status(p_ids uuid[], p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('marketing.manage');
  v_count integer;
begin
  if p_status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  update public.offers set status = p_status where id = any (p_ids) and deleted_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.admin_delete_offer(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('marketing.manage');
begin
  if not exists (select 1 from public.offers where id = p_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.promo_redemptions where offer_id = p_id)
     or exists (select 1 from public.order_items where applied_offer ->> 'offerId' = p_id::text) then
    update public.offers set status = 'archived', deleted_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.offers where id = p_id;
  return jsonb_build_object('ok', true, 'archived', false);
end;
$$;

-- ── Content entries (news, new releases, coming soon, offer updates, campaigns) ──
create or replace function app.admin_entry_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'type', e.type, 'eyebrow', e.eyebrow, 'title', e.title, 'subtitle', e.subtitle,
    'excerpt', e.excerpt, 'body', e.body, 'mediaKind', e.media_kind, 'mediaUrl', e.media_url,
    'mediaPosterUrl', e.media_poster_url, 'mediaAlt', e.media_alt, 'ctaLabel', e.cta_label, 'ctaHref', e.cta_href,
    'secondaryCtaLabel', e.secondary_cta_label, 'secondaryCtaHref', e.secondary_cta_href, 'state', e.state,
    'releaseDate', e.release_date, 'publishAt', e.publish_at, 'expiresAt', e.expires_at,
    'isFeatured', e.is_featured, 'status', e.status, 'seoTitle', e.seo_title, 'seoDescription', e.seo_description,
    'isDemo', e.is_demo, 'updatedAt', e.updated_at,
    'products', coalesce((select jsonb_agg(jsonb_build_object('productId', ep.product_id, 'name', p.name, 'slug', p.slug)
                                           order by ep.sort_order)
                          from public.content_entry_products ep join public.products p on p.id = ep.product_id
                          where ep.entry_id = e.id), '[]'::jsonb))
  from public.content_entries e where e.id = p_id and e.deleted_at is null;
$$;

create or replace function public.admin_list_entries(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_permission('content.view');
  v_limit  integer := app.page_limit(p_filter, 50, 200);
  v_offset integer := app.page_offset(p_filter);
  v_q      text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_type   text := nullif(p_filter ->> 'type', '');
  v_status text := nullif(p_filter ->> 'status', '');
  v_total  integer;
  v_items  jsonb;
begin
  with matched as (
    select e.* from public.content_entries e
    where e.deleted_at is null
      and (v_type is null or e.type = v_type)
      and (v_status is null or e.status = v_status)
      and (v_q is null or e.slug ilike app.like_pattern(v_q) or e.title ->> 'ar' ilike app.like_pattern(v_q)
           or e.title ->> 'en' ilike app.like_pattern(v_q))
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id, 'slug', m.slug, 'type', m.type, 'title', m.title, 'status', m.status,
             'publishAt', m.publish_at, 'expiresAt', m.expires_at, 'isFeatured', m.is_featured,
             'mediaUrl', m.media_url, 'isDemo', m.is_demo, 'updatedAt', m.updated_at,
             'live', m.status = 'published' and m.publish_at <= now() and (m.expires_at is null or m.expires_at > now()))
             order by m.publish_at desc)
           from (select * from matched order by publish_at desc limit v_limit offset v_offset) m), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_get_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.view');
begin
  return app.admin_entry_json(p_id);
end;
$$;

-- content.manage saves; making an entry published (or keeping it published) needs content.publish.
create or replace function public.admin_save_entry(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_permission('content.manage');
  v_id     uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_slug   text := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_type   text := coalesce(p_payload ->> 'type', '');
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'draft');
  v_pub    timestamptz := coalesce(nullif(p_payload ->> 'publishAt', '')::timestamptz, now());
  v_exp    timestamptz := nullif(p_payload ->> 'expiresAt', '')::timestamptz;
  v_row    public.content_entries;
begin
  if v_slug !~ '^[a-z0-9-]{1,80}$' then return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'field', 'slug'); end if;
  if v_type not in ('campaign', 'new_release', 'coming_soon', 'offer_update', 'news') then
    return jsonb_build_object('ok', false, 'code', 'invalid_type', 'field', 'type');
  end if;
  if v_status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if v_status = 'published' and not app.has_permission('content.publish') then
    return jsonb_build_object('ok', false, 'code', 'publish_forbidden', 'field', 'status');
  end if;
  if not app.valid_lt(p_payload -> 'title') then return jsonb_build_object('ok', false, 'code', 'title_required', 'field', 'title'); end if;
  if not app.valid_lt(p_payload -> 'eyebrow', false) or not app.valid_lt(p_payload -> 'subtitle', false)
     or not app.valid_lt(p_payload -> 'excerpt', false) or not app.valid_lt(p_payload -> 'body', false)
     or not app.valid_lt(p_payload -> 'ctaLabel', false) or not app.valid_lt(p_payload -> 'secondaryCtaLabel', false)
     or not app.valid_lt(p_payload -> 'mediaAlt', false) or not app.valid_lt(p_payload -> 'seoTitle', false)
     or not app.valid_lt(p_payload -> 'seoDescription', false) then
    return jsonb_build_object('ok', false, 'code', 'invalid_text');
  end if;
  if nullif(p_payload ->> 'ctaHref', '') is not null and not app.is_safe_href(p_payload ->> 'ctaHref')
     or nullif(p_payload ->> 'secondaryCtaHref', '') is not null and not app.is_safe_href(p_payload ->> 'secondaryCtaHref') then
    return jsonb_build_object('ok', false, 'code', 'invalid_link', 'field', 'ctaHref');
  end if;
  if nullif(p_payload ->> 'mediaUrl', '') is not null and p_payload ->> 'mediaUrl' !~ '^(/|https://)' then
    return jsonb_build_object('ok', false, 'code', 'invalid_media', 'field', 'mediaUrl');
  end if;
  if v_exp is not null and v_exp <= v_pub then return jsonb_build_object('ok', false, 'code', 'invalid_dates', 'field', 'expiresAt'); end if;
  if nullif(p_payload ->> 'state', '') is not null and p_payload ->> 'state' not in ('available', 'coming_soon', 'waitlist_only', 'pre_order') then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;
  if exists (select 1 from public.content_entries where slug = v_slug and (v_id is null or id <> v_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'field', 'slug');
  end if;
  if v_id is null then
    insert into public.content_entries (slug, type, eyebrow, title, subtitle, excerpt, body, media_kind, media_url,
                                        media_poster_url, media_alt, cta_label, cta_href, secondary_cta_label,
                                        secondary_cta_href, state, release_date, publish_at, expires_at, is_featured,
                                        status, seo_title, seo_description)
    values (v_slug, v_type, app.json_lt(p_payload -> 'eyebrow'), app.json_lt(p_payload -> 'title'),
            app.json_lt(p_payload -> 'subtitle'), app.json_lt(p_payload -> 'excerpt'), app.json_lt(p_payload -> 'body'),
            case when nullif(p_payload ->> 'mediaUrl', '') is not null then coalesce(nullif(p_payload ->> 'mediaKind', ''), 'image') end,
            nullif(p_payload ->> 'mediaUrl', ''), nullif(p_payload ->> 'mediaPosterUrl', ''), app.json_lt(p_payload -> 'mediaAlt'),
            app.json_lt(p_payload -> 'ctaLabel'), nullif(p_payload ->> 'ctaHref', ''),
            app.json_lt(p_payload -> 'secondaryCtaLabel'), nullif(p_payload ->> 'secondaryCtaHref', ''),
            nullif(p_payload ->> 'state', ''), nullif(p_payload ->> 'releaseDate', '')::date, v_pub, v_exp,
            coalesce((p_payload ->> 'isFeatured')::boolean, false), v_status,
            app.json_lt(p_payload -> 'seoTitle'), app.json_lt(p_payload -> 'seoDescription'))
    returning * into v_row;
  else
    select * into v_row from public.content_entries where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if v_row.updated_at is distinct from nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
    end if;
    if v_row.status = 'published' and not app.has_permission('content.publish') then
      return jsonb_build_object('ok', false, 'code', 'publish_forbidden', 'field', 'status');
    end if;
    update public.content_entries set slug = v_slug, type = v_type, eyebrow = app.json_lt(p_payload -> 'eyebrow'),
      title = app.json_lt(p_payload -> 'title'), subtitle = app.json_lt(p_payload -> 'subtitle'),
      excerpt = app.json_lt(p_payload -> 'excerpt'), body = app.json_lt(p_payload -> 'body'),
      media_kind = case when nullif(p_payload ->> 'mediaUrl', '') is not null then coalesce(nullif(p_payload ->> 'mediaKind', ''), 'image') end,
      media_url = nullif(p_payload ->> 'mediaUrl', ''), media_poster_url = nullif(p_payload ->> 'mediaPosterUrl', ''),
      media_alt = app.json_lt(p_payload -> 'mediaAlt'), cta_label = app.json_lt(p_payload -> 'ctaLabel'),
      cta_href = nullif(p_payload ->> 'ctaHref', ''), secondary_cta_label = app.json_lt(p_payload -> 'secondaryCtaLabel'),
      secondary_cta_href = nullif(p_payload ->> 'secondaryCtaHref', ''), state = nullif(p_payload ->> 'state', ''),
      release_date = nullif(p_payload ->> 'releaseDate', '')::date, publish_at = v_pub, expires_at = v_exp,
      is_featured = coalesce((p_payload ->> 'isFeatured')::boolean, false), status = v_status,
      seo_title = app.json_lt(p_payload -> 'seoTitle'), seo_description = app.json_lt(p_payload -> 'seoDescription'),
      updated_at = clock_timestamp()
    where id = v_id returning * into v_row;
  end if;
  delete from public.content_entry_products where entry_id = v_row.id;
  insert into public.content_entry_products (entry_id, product_id, sort_order)
  select v_row.id, p.id, t.ord::integer
  from jsonb_array_elements_text(coalesce(p_payload -> 'productIds', '[]')) with ordinality as t (id, ord)
  join public.products p on p.id = t.id::uuid and p.deleted_at is null
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'updatedAt', v_row.updated_at);
end;
$$;

create or replace function public.admin_set_entries_status(p_ids uuid[], p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.publish');
  v_count integer;
begin
  if p_status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection');
  end if;
  update public.content_entries set status = p_status where id = any (p_ids) and deleted_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.admin_delete_entry(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.publish');
begin
  update public.content_entries set deleted_at = now(), status = 'archived' where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Page sections: structured content editing (layout stays fixed until Phase 07) ──
create or replace function public.admin_list_page_sections(p_page_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'pageKey', s.page_key, 'key', s.key, 'type', s.type, 'sortOrder', s.sort_order,
      'isVisible', s.is_visible, 'props', s.props, 'updatedAt', s.updated_at,
      'updatedBy', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = s.updated_by))
      order by s.sort_order)
    from public.page_sections s where s.page_key = p_page_key), '[]'::jsonb);
end;
$$;

-- Sections are live content (no draft layer yet), so saving needs both content.manage and
-- content.publish. Only props / visibility change — never the section type or position.
create or replace function public.admin_save_page_section(p_id uuid, p_is_visible boolean, p_props jsonb,
                                                          p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.manage');
  v_row public.page_sections;
begin
  if not app.has_permission('content.publish') then return jsonb_build_object('ok', false, 'code', 'publish_forbidden'); end if;
  if p_props is null or jsonb_typeof(p_props) <> 'object' or pg_column_size(p_props) > 65536 then
    return jsonb_build_object('ok', false, 'code', 'invalid_props');
  end if;
  select * into v_row from public.page_sections where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'stale', 'updatedAt', v_row.updated_at);
  end if;
  update public.page_sections set props = p_props, is_visible = coalesce(p_is_visible, is_visible),
    updated_by = v_uid, updated_at = clock_timestamp()
  where id = p_id returning * into v_row;
  return jsonb_build_object('ok', true, 'updatedAt', v_row.updated_at);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function app.offer_state(public.offers), app.admin_offer_json(uuid), app.admin_entry_json(uuid) from public;
grant execute on function app.offer_state(public.offers) to authenticated;

revoke all on function public.admin_list_offers(jsonb), public.admin_get_offer(uuid), public.admin_save_offer(jsonb),
  public.admin_set_offers_status(uuid[], text), public.admin_delete_offer(uuid), public.admin_list_entries(jsonb),
  public.admin_get_entry(uuid), public.admin_save_entry(jsonb), public.admin_set_entries_status(uuid[], text),
  public.admin_delete_entry(uuid), public.admin_list_page_sections(text),
  public.admin_save_page_section(uuid, boolean, jsonb, timestamptz)
  from public, anon;
grant execute on function public.admin_list_offers(jsonb), public.admin_get_offer(uuid), public.admin_save_offer(jsonb),
  public.admin_set_offers_status(uuid[], text), public.admin_delete_offer(uuid), public.admin_list_entries(jsonb),
  public.admin_get_entry(uuid), public.admin_save_entry(jsonb), public.admin_set_entries_status(uuid[], text),
  public.admin_delete_entry(uuid), public.admin_list_page_sections(text),
  public.admin_save_page_section(uuid, boolean, jsonb, timestamptz)
  to authenticated;
