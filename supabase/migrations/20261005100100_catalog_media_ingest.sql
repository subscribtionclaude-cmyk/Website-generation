-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Catalog media ingest authorization (additive, idempotent)
--
-- The catalog-media-ingest Edge Function copies official manufacturer images into the products
-- bucket. It is gated by short-lived, use-limited tokens that only a database operator can create
-- (app_private has no API grants); the function checks them through catalog_media_authorize(),
-- which only the service role may execute. An expired or used-up token is useless.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists app_private.catalog_media_tokens (
  token       text primary key check (char_length(token) >= 48),
  expires_at  timestamptz not null,
  max_uses    integer not null default 200 check (max_uses between 1 and 2000),
  uses        integer not null default 0 check (uses >= 0),
  created_at  timestamptz not null default now(),
  check (expires_at <= created_at + interval '6 hours')
);

revoke all on app_private.catalog_media_tokens from public, anon, authenticated, service_role;

create or replace function public.catalog_media_authorize(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  if p_token is null or char_length(p_token) < 48 then return false; end if;
  update app_private.catalog_media_tokens
     set uses = uses + 1
   where token = p_token and expires_at > now() and uses < max_uses;
  return found;
end;
$$;

revoke all on function public.catalog_media_authorize(text) from public, anon, authenticated;
grant execute on function public.catalog_media_authorize(text) to service_role;
