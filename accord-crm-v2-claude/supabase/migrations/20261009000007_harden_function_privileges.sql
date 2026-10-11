-- Hardening found by the Supabase security advisor on the hosted project:
-- default privileges on hosted Supabase had granted EXECUTE on new functions to anon/authenticated.

-- 1) anonymous callers get NO functions at all
revoke execute on all functions in schema public from public, anon;
-- 2) trigger / internal functions are not callable through the REST API by anyone but the owner
revoke execute on function public.audit_row(), public.trg_rollup(), public.trg_activity_leads(), public.trg_activity_calls(),
  public.trg_activity_follow_ups(), public.trg_activity_meetings(), public.trg_activity_forms(), public.trg_activity_proposals(),
  public.audit_logs_immutable(), public.leads_before_write(), public.set_updated_at() from authenticated;
-- 3) explicit allow-list for signed-in users (RLS helpers + RPCs the app calls)
grant execute on function public.is_admin(), public.is_staff(), public.is_member(), public.current_app_role(),
  public.cairo_date(timestamptz), public.cairo_today(), public.cairo_day_start(date), public.norm_name(text), public.actor_id(),
  public.update_my_profile(text, text), public.clear_must_change_password() to authenticated;
-- 4) pin search_path on helper functions
alter function public.cairo_date(timestamptz) set search_path = public;
alter function public.cairo_today() set search_path = public;
alter function public.cairo_day_start(date) set search_path = public;
alter function public.norm_name(text) set search_path = public;
alter function public.leads_before_write() set search_path = public;
alter function public.audit_logs_immutable() set search_path = public;
alter function public.actor_id() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.array_union(text[], text[]) set search_path = public;
-- keep future functions private by default
alter default privileges in schema public revoke execute on functions from public, anon;
