-- Export audit trail + server-side permission check for exports.
-- The browser calls log_export() BEFORE it reads any data for an export:
--   * anonymous / inactive / viewer accounts are refused (no export at all);
--   * the full CRM export and the Board report export are ADMIN ONLY;
--   * individual dataset exports are allowed to admins and BD executives (they only ever receive rows RLS already
--     lets them read — the export itself reads with the user's own session).
-- Only metadata is recorded (who, what, period, format, filters, row counts); never the exported data.
-- Additive: one new function, no table or data change.
create or replace function public.log_export(
  p_kind text, p_format text, p_from date default null, p_to date default null, p_filters jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_staff() then raise exception 'Not allowed to export CRM data' using errcode = '42501'; end if;
  if p_kind not in ('full', 'board', 'leads', 'contacts', 'calls', 'followups', 'meetings', 'minutes', 'forms',
                    'proposals', 'pipeline', 'activities', 'projects') then
    raise exception 'Unknown export type %', p_kind using errcode = '22023';
  end if;
  if p_format not in ('xlsx', 'pdf') then raise exception 'Unknown export format %', p_format using errcode = '22023'; end if;
  if p_kind in ('full', 'board') and not public.is_admin() then
    raise exception 'Only administrators can run this export' using errcode = '42501';
  end if;
  insert into audit_logs (actor_id, actor_email, entity, entity_id, action, meta)
  values (auth.uid(), (select email from profiles where id = auth.uid()), 'export', p_kind, 'data_export',
          jsonb_build_object('format', p_format, 'from', p_from, 'to', p_to, 'timezone', 'Africa/Cairo',
                             'filters', coalesce(p_filters, '{}'::jsonb) - 'file' - 'data'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_export(text, text, date, date, jsonb) from public, anon;
grant execute on function public.log_export(text, text, date, date, jsonb) to authenticated;
