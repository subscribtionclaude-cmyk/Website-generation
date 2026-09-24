-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · 0006 · Storage buckets & policies (Supabase Storage, free tier)
--
-- Public buckets (served via public URLs, CDN-cacheable; writes = staff only):
--   products · banners · site-media
-- Private buckets (signed URLs only):
--   repairs · trade-in · after-sales · reviews · avatars → customers upload into their own
--     "<auth.uid()>/..." folder; relevant staff can read.
--   invoices → staff only.
-- Size limits are conservative for the free tier; images are also compressed client-side
-- before upload (Phase 05/06). Listing public buckets is not allowed (no enumeration).
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('products',    'products',    true,   5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']),
  ('banners',     'banners',     true,   8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']),
  ('site-media',  'site-media',  true,  10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'video/mp4', 'video/webm']),
  ('repairs',     'repairs',     false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('trade-in',    'trade-in',    false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('after-sales', 'after-sales', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('reviews',     'reviews',     false,  5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('avatars',     'avatars',     false,  2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('invoices',    'invoices',    false,  5242880, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Which permission lets staff manage a public bucket, or read a private one.
create or replace function app.storage_staff_permission(p_bucket text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket = 'products'    then 'catalog.manage'
    when p_bucket = 'banners'     then 'content.manage'
    when p_bucket = 'site-media'  then case when p_action = 'read' then 'content.view' else 'design.edit' end
    when p_bucket = 'repairs'     then case when p_action = 'read' then 'repairs.view' else 'repairs.manage' end
    when p_bucket = 'trade-in'    then case when p_action = 'read' then 'tradein.view' else 'tradein.manage' end
    when p_bucket = 'after-sales' then case when p_action = 'read' then 'after_sales.view' else 'after_sales.manage' end
    when p_bucket = 'reviews'     then 'reviews.moderate'
    when p_bucket = 'avatars'     then case when p_action = 'read' then 'customers.view' else 'customers.manage' end
    when p_bucket = 'invoices'    then case when p_action = 'read' then 'orders.view' else 'orders.manage' end
  end;
$$;

create or replace function app.is_customer_upload_bucket(p_bucket text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_bucket in ('repairs', 'trade-in', 'after-sales', 'reviews', 'avatars');
$$;

grant execute on function app.storage_staff_permission(text, text), app.is_customer_upload_bucket(text)
  to anon, authenticated, service_role;

-- Staff: read/write according to bucket permission.
drop policy if exists "malek staff read objects" on storage.objects;
create policy "malek staff read objects" on storage.objects for select to authenticated
  using (app.has_permission(app.storage_staff_permission(bucket_id, 'read')));

drop policy if exists "malek staff insert objects" on storage.objects;
create policy "malek staff insert objects" on storage.objects for insert to authenticated
  with check (app.has_permission(app.storage_staff_permission(bucket_id, 'write')));

drop policy if exists "malek staff update objects" on storage.objects;
create policy "malek staff update objects" on storage.objects for update to authenticated
  using (app.has_permission(app.storage_staff_permission(bucket_id, 'write')))
  with check (app.has_permission(app.storage_staff_permission(bucket_id, 'write')));

drop policy if exists "malek staff delete objects" on storage.objects;
create policy "malek staff delete objects" on storage.objects for delete to authenticated
  using (app.has_permission(app.storage_staff_permission(bucket_id, 'write')));

-- Customers: only inside their own top-level folder of customer-upload buckets.
drop policy if exists "malek customers read own uploads" on storage.objects;
create policy "malek customers read own uploads" on storage.objects for select to authenticated
  using (
    app.is_customer_upload_bucket(bucket_id)
    and (storage.foldername(name))[1] = (select app.current_actor_id())::text
  );

drop policy if exists "malek customers insert own uploads" on storage.objects;
create policy "malek customers insert own uploads" on storage.objects for insert to authenticated
  with check (
    app.is_customer_upload_bucket(bucket_id)
    and (storage.foldername(name))[1] = (select app.current_actor_id())::text
  );

drop policy if exists "malek customers delete own uploads" on storage.objects;
create policy "malek customers delete own uploads" on storage.objects for delete to authenticated
  using (
    app.is_customer_upload_bucket(bucket_id)
    and (storage.foldername(name))[1] = (select app.current_actor_id())::text
  );
