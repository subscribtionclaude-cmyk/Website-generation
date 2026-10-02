-- Phase 08 — content / SEO / PWA / polish.
--   * `performance` setting (public): motion level and campaign effects.
--   * `setup` setting (private): first-run wizard state (written by admin_complete_setup).
--   * seo_public_index(): the indexable public URLs for sitemap.xml / prerendering — published,
--     visible, NON-demo rows only (even when the demo catalog is shown on the storefront).
--   * admin_seo_overview(): SEO status for the admin (missing metadata, indexing, page SEO).
--   * admin_complete_setup(): finishes the first-run wizard (demo keep / replace / delete), audited.
-- SEO keeps using the existing `seo` / `page_seo` settings; nothing here stores page metadata.

-- ── Settings ──────────────────────────────────────────────────────────────────
insert into public.setting_definitions (key, scope, is_public, edit_permission, publish_permission)
values ('performance', 'settings', true, 'settings.manage', 'settings.publish'),
       ('setup', 'settings', false, 'settings.manage', 'settings.publish')
on conflict (key) do update
  set scope = excluded.scope, is_public = excluded.is_public,
      edit_permission = excluded.edit_permission, publish_permission = excluded.publish_permission;

-- ── Public SEO index (sitemap / prerender source) ────────────────────────────
create or replace function public.seo_public_index()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('slug', p.slug, 'updatedAt', p.updated_at) order by p.slug)
      from public.products p
      join public.brands b on b.id = p.brand_id
      where p.status = 'published' and p.is_visible and p.deleted_at is null and not p.is_demo
        and b.deleted_at is null and b.is_visible and not b.is_demo), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c.slug, 'updatedAt', c.updated_at) order by c.slug)
      from public.categories c
      where c.is_visible and c.deleted_at is null and not c.is_demo), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('slug', b.slug, 'updatedAt', b.updated_at) order by b.slug)
      from public.brands b
      where b.is_visible and b.deleted_at is null and not b.is_demo), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('slug', e.slug, 'updatedAt', e.updated_at) order by e.slug)
      from public.content_entries e
      where e.status = 'published' and e.deleted_at is null and e.publish_at <= now()
        and (e.expires_at is null or e.expires_at > now()) and not e.is_demo), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('slug', o.slug, 'updatedAt', o.updated_at) order by o.slug)
      from public.offers o
      where o.status = 'published' and o.deleted_at is null and not o.is_demo
        and (o.starts_at is null or o.starts_at <= now()) and (o.ends_at is null or o.ends_at > now())),
      '[]'::jsonb),
    'legal', coalesce((
      select jsonb_agg(p.key order by p.key)
      from public.site_settings s, jsonb_each(s.value -> 'pages') p
      where s.key = 'legal' and jsonb_typeof(p.value -> 'body') = 'object'), '[]'::jsonb),
    'allowIndexing', coalesce((select (value ->> 'allowIndexing')::boolean from public.site_settings
                               where key = 'seo'), false));
$$;

-- ── Admin SEO overview ────────────────────────────────────────────────────────
create or replace function public.admin_seo_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('content.view');
begin
  return jsonb_build_object(
    'allowIndexing', coalesce((select (value ->> 'allowIndexing')::boolean from public.site_settings
                               where key = 'seo'), false),
    'pageSeo', (select value -> 'pages' from public.site_settings where key = 'page_seo'),
    'products', (select jsonb_build_object(
        'published', count(*),
        'missingTitle', count(*) filter (where p.seo_title is null),
        'missingDescription', count(*) filter (where p.seo_description is null and p.description is null),
        'missingImage', count(*) filter (where not exists (
          select 1 from public.product_media m where m.product_id = p.id and m.kind = 'image')))
      from public.products p
      where p.status = 'published' and p.deleted_at is null and not p.is_demo),
    'entries', (select jsonb_build_object(
        'published', count(*),
        'missingTitle', count(*) filter (where e.seo_title is null),
        'missingDescription', count(*) filter (where e.seo_description is null and e.excerpt is null))
      from public.content_entries e
      where e.status = 'published' and e.deleted_at is null and not e.is_demo),
    'offers', (select jsonb_build_object(
        'published', count(*),
        'missingDescription', count(*) filter (where o.seo_description is null and o.description is null))
      from public.offers o
      where o.status = 'published' and o.deleted_at is null and not o.is_demo),
    'categories', (select jsonb_build_object(
        'visible', count(*),
        'missingDescription', count(*) filter (where c.description is null))
      from public.categories c where c.is_visible and c.deleted_at is null and not c.is_demo),
    'brands', (select jsonb_build_object(
        'visible', count(*),
        'missingDescription', count(*) filter (where b.description is null))
      from public.brands b where b.is_visible and b.deleted_at is null and not b.is_demo),
    'demoPublished', (select jsonb_build_object(
        'products', (select count(*) from public.products where is_demo and status = 'published' and deleted_at is null),
        'offers', (select count(*) from public.offers where is_demo and status = 'published' and deleted_at is null),
        'entries', (select count(*) from public.content_entries where is_demo and status = 'published' and deleted_at is null))),
    'demoCatalogShown', app.demo_catalog_visible(),
    'missing', coalesce((
      select jsonb_agg(x order by x ->> 'kind', x ->> 'slug')
      from (
        (select jsonb_build_object('kind', 'product', 'id', p.id, 'slug', p.slug, 'name', p.name) as x
         from public.products p
         where p.status = 'published' and p.deleted_at is null and not p.is_demo
           and (p.seo_description is null and p.description is null)
         order by p.updated_at desc limit 20)
        union all
        (select jsonb_build_object('kind', 'entry', 'id', e.id, 'slug', e.slug, 'name', e.title)
         from public.content_entries e
         where e.status = 'published' and e.deleted_at is null and not e.is_demo
           and (e.seo_description is null and e.excerpt is null)
         order by e.updated_at desc limit 20)
      ) t), '[]'::jsonb));
end;
$$;

-- ── First-run setup ───────────────────────────────────────────────────────────
create or replace function public.admin_complete_setup(p_demo_choice text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_permission('settings.publish');
  v_deleted jsonb := null;
  v_value jsonb;
begin
  if p_demo_choice is null or p_demo_choice not in ('keep', 'replace', 'delete') then
    return jsonb_build_object('ok', false, 'code', 'invalid_choice');
  end if;
  -- Deleting demo rows needs demo.manage (checked by delete_all_demo_data, which is audited too).
  if p_demo_choice in ('replace', 'delete') then
    if not app.has_permission('demo.manage') then
      return jsonb_build_object('ok', false, 'code', 'demo_forbidden');
    end if;
    v_deleted := public.delete_all_demo_data();
  end if;
  v_value := jsonb_build_object('completedAt', now(), 'completedBy', v_uid, 'demoChoice', p_demo_choice);
  perform set_config('app.publish_note', coalesce(p_note, 'First-run setup completed'), true);
  insert into public.site_settings (key, value, version, published_at, published_by)
  values ('setup', v_value, 1, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, published_at = excluded.published_at, published_by = excluded.published_by;
  perform app.log_event('setup.completed', 'public.site_settings', 'setup', null, v_value,
                        jsonb_build_object('demoChoice', p_demo_choice, 'deleted', v_deleted));
  return jsonb_build_object('ok', true, 'demoChoice', p_demo_choice, 'deleted', v_deleted);
end;
$$;

-- Audit viewer: setup events belong to "settings".
create or replace function app.audit_module(p_entity_type text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entity_type in ('public.page_layout_drafts', 'public.page_layout_versions') or p_action like 'site_editor.%'
      then 'design'
    when p_entity_type in ('public.products', 'public.product_variants', 'public.brands', 'public.categories',
                           'public.product_relations', 'public.product_media', 'public.price_history')
      or p_action like 'catalog.%' or p_action like 'stock.%' or p_action like 'price.%' then 'catalog'
    when p_entity_type in ('public.orders', 'public.payment_records') or p_action like 'order.%'
      or p_action like 'payment.%' then 'orders'
    when p_entity_type in ('public.service_requests', 'public.service_offers') or p_action like 'service.%' then 'services'
    when p_entity_type in ('public.site_settings') or p_action like 'setting.%' or p_action like 'setup.%' then 'settings'
    when p_entity_type in ('public.roles', 'public.role_permissions', 'public.user_roles', 'public.profiles')
      or p_action like 'access.%' or p_action like 'staff.%' then 'access'
    when p_entity_type in ('public.offers', 'public.content_entries', 'public.page_sections') or p_action like 'content.%'
      or p_action like 'offer.%' then 'content'
    when p_entity_type in ('public.product_reviews', 'public.customer_notes', 'public.notification_templates')
      or p_action like 'review.%' or p_action like 'customer.%' or p_action like 'notification.%' then 'customers'
    when p_action like 'data.%' or p_action like 'demo.%' or p_action like 'import.%' or p_action like 'export.%' then 'data'
    else 'other' end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
revoke all on function public.seo_public_index() from public;
grant execute on function public.seo_public_index() to anon, authenticated;
revoke all on function public.admin_seo_overview(), public.admin_complete_setup(text, text) from public, anon;
grant execute on function public.admin_seo_overview(), public.admin_complete_setup(text, text) to authenticated;
