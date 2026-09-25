-- ════════════════════════════════════════════════════════════════════════════
-- Phase 04 · Verified-buyer product reviews.
--
-- Eligibility is decided HERE, never by the client: the caller must own an order that contains
-- the product (non-gift line) and has reached an eligible status (engagement.reviews.eligibleStatuses,
-- default delivered / completed). verified_buyer is set only by submit_review after that check.
-- Rule: one review per customer per product. Editing it sends it back to `pending`.
-- Moderation: staff with reviews.moderate approve / reject (optional internal note), audited;
-- nobody moderates their own review. The public sees approved reviews only, through an RPC that
-- never returns user ids, emails or moderation notes. Demo reviews are is_demo and labelled.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.product_reviews (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete cascade,
  order_id         uuid references public.orders (id) on delete set null,
  rating           smallint not null check (rating between 1 and 5),
  title            text check (title is null or char_length(title) between 2 and 120),
  body             text not null check (char_length(body) between 10 and 2000),
  image_path       text check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  author_name      text not null check (char_length(author_name) between 1 and 60),
  locale           text not null default 'ar' check (app.is_locale(locale)),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  verified_buyer   boolean not null default false,
  moderation_note  text check (moderation_note is null or char_length(moderation_note) <= 500),
  moderated_by     uuid,
  moderated_at     timestamptz,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (is_demo or user_id is not null)
);

comment on table public.product_reviews is 'Customer reviews. Public reads only via product_reviews_public (approved rows).';

create unique index if not exists product_reviews_one_per_customer_idx
  on public.product_reviews (user_id, product_id) where user_id is not null;
create index if not exists product_reviews_product_status_idx on public.product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_status_idx on public.product_reviews (status, created_at);

drop trigger if exists product_reviews_set_updated_at on public.product_reviews;
create trigger product_reviews_set_updated_at before update on public.product_reviews
  for each row execute function app.set_updated_at();
drop trigger if exists product_reviews_audit on public.product_reviews;
create trigger product_reviews_audit after update or delete on public.product_reviews
  for each row execute function app.audit_row_change('id');

alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from anon;
revoke insert, update, delete, truncate on public.product_reviews from authenticated;
drop policy if exists product_reviews_owner_select on public.product_reviews;
create policy product_reviews_owner_select on public.product_reviews for select to authenticated
  using (user_id = (select app.current_actor_id()) or (select app.has_permission('reviews.moderate')));

select app.register_demo_table('public.product_reviews', 3);

-- Approved review images are readable by everyone (signed URLs); pending/rejected ones only by
-- the author (own folder policy) and moderators (bucket permission).
create or replace function app.review_image_is_public(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.product_reviews r where r.image_path = p_name and r.status = 'approved');
$$;
grant execute on function app.review_image_is_public(text) to anon, authenticated, service_role;

drop policy if exists "malek approved review images" on storage.objects;
create policy "malek approved review images" on storage.objects for select to anon, authenticated
  using (bucket_id = 'reviews' and app.review_image_is_public(name));

-- ── Eligibility ──────────────────────────────────────────────────────────────
create or replace function app.review_eligible_order(p_user uuid, p_product uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.orders o
  join public.order_items oi on oi.order_id = o.id and oi.product_id = p_product and not oi.is_gift
  where o.customer_id = p_user
    and o.status in (select jsonb_array_elements_text(coalesce(
          app.engagement_config() -> 'reviews' -> 'eligibleStatuses', '["delivered", "completed"]'::jsonb)))
  order by o.created_at desc
  limit 1;
$$;

create or replace function app.review_author_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- First name + initial only (privacy). Falls back to a neutral label.
  select coalesce(
    nullif(btrim(split_part(btrim(p.full_name), ' ', 1) || coalesce(' ' || left(nullif(split_part(btrim(p.full_name), ' ', 2), ''), 1) || '.', '')), ''),
    'MALEK STORE customer')
  from public.profiles p where p.id = p_user;
$$;

create or replace function app.review_json(r public.product_reviews, p_owner boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body,
    'authorName', r.author_name, 'verifiedBuyer', r.verified_buyer, 'imagePath', r.image_path,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'isDemo', r.is_demo)
  || case when p_owner then jsonb_build_object('status', r.status, 'productId', r.product_id,
       'rejected', r.status = 'rejected') else '{}'::jsonb end;
$$;

create or replace function public.my_review_status(p_product_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_actor_id();
  p public.products;
  r public.product_reviews;
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then
    return jsonb_build_object('eligible', false, 'reason', 'not_found');
  end if;
  if not coalesce((app.engagement_config() -> 'reviews' ->> 'enabled')::boolean, true) then
    return jsonb_build_object('eligible', false, 'reason', 'disabled');
  end if;
  if v_uid is null then return jsonb_build_object('eligible', false, 'reason', 'sign_in'); end if;
  select * into r from public.product_reviews where user_id = v_uid and product_id = p.id;
  if app.review_eligible_order(v_uid, p.id) is not null then
    return jsonb_build_object('eligible', true, 'reason', null,
      'review', case when r.id is not null then app.review_json(r, true) end,
      'allowImages', coalesce((app.engagement_config() -> 'reviews' ->> 'allowImages')::boolean, true));
  end if;
  return jsonb_build_object('eligible', false,
    'reason', case when exists (select 1 from public.orders o join public.order_items oi on oi.order_id = o.id
                                where o.customer_id = v_uid and oi.product_id = p.id and o.status <> 'cancelled')
                   then 'not_delivered' else 'no_purchase' end,
    'review', case when r.id is not null then app.review_json(r, true) end);
end;
$$;

create or replace function public.submit_review(p_product_slug text, p_rating integer, p_body text,
                                                p_title text default null, p_image_path text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_customer();
  p public.products;
  v_order uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  r public.product_reviews;
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not coalesce((app.engagement_config() -> 'reviews' ->> 'enabled')::boolean, true) then
    return jsonb_build_object('ok', false, 'code', 'reviews_disabled');
  end if;
  v_order := app.review_eligible_order(v_uid, p.id);
  if v_order is null then return jsonb_build_object('ok', false, 'code', 'not_eligible'); end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return jsonb_build_object('ok', false, 'code', 'invalid_review', 'field', 'rating');
  end if;
  if char_length(v_body) not between 10 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_review', 'field', 'body');
  end if;
  if v_title is not null and char_length(v_title) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_review', 'field', 'title');
  end if;
  if v_image is not null and (not coalesce((app.engagement_config() -> 'reviews' ->> 'allowImages')::boolean, true)
                              or v_image !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]{1,120}$')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_review', 'field', 'image');
  end if;

  insert into public.product_reviews (product_id, user_id, order_id, rating, title, body, image_path, author_name,
                                      locale, status, verified_buyer)
  values (p.id, v_uid, v_order, p_rating, v_title, v_body, v_image, app.review_author_name(v_uid),
          coalesce((select preferred_locale from public.profiles where id = v_uid), 'ar'), 'pending', true)
  on conflict (user_id, product_id) where user_id is not null do update
    set rating = excluded.rating, title = excluded.title, body = excluded.body, image_path = excluded.image_path,
        order_id = excluded.order_id, author_name = excluded.author_name, status = 'pending', verified_buyer = true,
        moderation_note = null, moderated_by = null, moderated_at = null
  returning * into r;
  return jsonb_build_object('ok', true, 'review', app.review_json(r, true));
end;
$$;

create or replace function public.delete_my_review(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.product_reviews where id = p_id and user_id = app.require_customer();
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_my_reviews()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.review_json(r, true) || jsonb_build_object(
      'product', jsonb_build_object('slug', p.slug, 'name', p.name, 'image', app.product_summary(p.id) -> 'image'))
    order by r.updated_at desc), '[]'::jsonb)
  from public.product_reviews r join public.products p on p.id = r.product_id
  where r.user_id = app.require_customer();
$$;

-- Public: approved reviews + summary. Never user ids, emails or moderation notes.
create or replace function public.product_reviews_public(p_product_slug text, p_limit integer default 10,
                                                         p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  select * into p from public.products where slug = p_product_slug;
  if not found or not app.product_is_visible(p) then return null; end if;
  return jsonb_build_object(
    'summary', (
      select jsonb_build_object('count', count(*), 'average', round(avg(r.rating)::numeric, 1),
        'distribution', jsonb_build_object(
          '1', count(*) filter (where r.rating = 1), '2', count(*) filter (where r.rating = 2),
          '3', count(*) filter (where r.rating = 3), '4', count(*) filter (where r.rating = 4),
          '5', count(*) filter (where r.rating = 5)))
      from public.product_reviews r where r.product_id = p.id and r.status = 'approved'),
    'items', coalesce((
      select jsonb_agg(app.review_json(x) order by x.created_at desc, x.id)
      from (select * from public.product_reviews r where r.product_id = p.id and r.status = 'approved'
            order by r.created_at desc, r.id
            limit least(greatest(coalesce(p_limit, 10), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end;
$$;

-- ── Staff moderation ─────────────────────────────────────────────────────────
create or replace function public.staff_list_reviews(p_status text default 'pending', p_limit integer default 30,
                                                     p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('reviews.moderate');
  return jsonb_build_object(
    'total', (select count(*) from public.product_reviews where p_status is null or status = p_status),
    'items', coalesce((
      select jsonb_agg(app.review_json(r, true) || jsonb_build_object(
          'moderationNote', r.moderation_note, 'moderatedAt', r.moderated_at,
          'orderNumber', (select o.order_number from public.orders o where o.id = r.order_id),
          'product', jsonb_build_object('slug', p.slug, 'name', p.name)) order by r.created_at, r.id)
      from (select * from public.product_reviews where p_status is null or status = p_status
            order by created_at, id limit least(greatest(coalesce(p_limit, 30), 1), 100)
            offset greatest(coalesce(p_offset, 0), 0)) r
      join public.products p on p.id = r.product_id), '[]'::jsonb));
end;
$$;

create or replace function public.staff_moderate_review(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_actor_id();
  r public.product_reviews;
  p public.products;
begin
  perform app.require_permission('reviews.moderate');
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  select * into r from public.product_reviews where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if r.user_id = v_uid then return jsonb_build_object('ok', false, 'code', 'own_review'); end if;
  update public.product_reviews
     set status = p_decision, moderation_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         moderated_by = v_uid, moderated_at = now()
   where id = p_id
  returning * into r;
  perform app.log_event('review.' || p_decision, 'product_review', p_id::text, null,
    jsonb_build_object('status', p_decision), jsonb_build_object('productId', r.product_id));
  select * into p from public.products where id = r.product_id;
  perform app.notify(r.user_id, 'review.' || p_decision, jsonb_build_object('product_name', p.name),
    'review:' || r.id || ':' || p_decision || ':' || floor(extract(epoch from r.moderated_at))::bigint,
    case when p_decision = 'approved' then '/product/' || p.slug else '/account/reviews' end,
    jsonb_build_object('reviewId', r.id), r.is_demo);
  return jsonb_build_object('ok', true, 'review', app.review_json(r, true));
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function app.review_eligible_order(uuid, uuid), app.review_author_name(uuid),
  app.review_json(public.product_reviews, boolean) from public, anon, authenticated;
revoke all on function public.my_review_status(text), public.product_reviews_public(text, integer, integer) from public;
grant execute on function public.my_review_status(text), public.product_reviews_public(text, integer, integer)
  to anon, authenticated, service_role;
revoke all on function public.submit_review(text, integer, text, text, text), public.delete_my_review(uuid),
  public.list_my_reviews(), public.staff_list_reviews(text, integer, integer),
  public.staff_moderate_review(uuid, text, text) from public, anon;
grant execute on function public.submit_review(text, integer, text, text, text), public.delete_my_review(uuid),
  public.list_my_reviews(), public.staff_list_reviews(text, integer, integer),
  public.staff_moderate_review(uuid, text, text) to authenticated;
