-- Private bucket for proposal files, forms, lead attachments and meeting documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-files', 'crm-files', false, 26214400,
  array['application/pdf','image/png','image/jpeg','image/webp',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain','text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: <lead_id>/<kind>/<uuid>-<filename>. Access is by signed URL / authenticated download only.
create policy "crm files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'crm-files' and public.is_member());
create policy "crm files: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-files' and public.is_staff());
create policy "crm files: owner or admin update" on storage.objects for update to authenticated
  using (bucket_id = 'crm-files' and (public.is_admin() or (public.is_staff() and owner_id = (select auth.uid())::text)))
  with check (bucket_id = 'crm-files' and (public.is_admin() or (public.is_staff() and owner_id = (select auth.uid())::text)));
create policy "crm files: owner or admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'crm-files' and (public.is_admin() or (public.is_staff() and owner_id = (select auth.uid())::text)));
