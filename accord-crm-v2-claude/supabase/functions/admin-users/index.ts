// Admin user management. Runs with the service role; every call is authorised against the caller's
// verified JWT + active admin profile. Passwords are never stored, logged, echoed or returned.
// There is NO application-level limit on the number of users. Errors are returned as { error, code } with a fixed,
// safe English sentence (translated in the UI) — never a raw upstream message or stack trace.
import { handle, json, requireAdmin, HttpError } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'bd_executive', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_URL = () => (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

export const MSG = {
  rateLimit: 'Invitation email limit reached. Try again later, use Temporary Password, or configure Custom SMTP.',
  exists: 'A user with this email already exists',
  invalidEmail: 'Valid email required',
  emailFailed: 'The invitation email could not be sent (email/SMTP configuration issue). Use Temporary Password or check the SMTP settings.',
  unavailable: 'Backend unavailable — please try again shortly',
  weak: 'The password was rejected as too weak — use a longer, less common password',
};

/** Map a Supabase Auth error to a safe, specific HttpError (the upstream message is never forwarded). */
function authError(error: unknown, fallback: HttpError): HttpError {
  const e = (error ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const status = Number(e.status ?? 0);
  const msg = String(e.message ?? '').toLowerCase();
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || msg.includes('rate limit'))
    return new HttpError(429, MSG.rateLimit, 'email_rate_limit');
  if (code === 'email_exists' || code === 'user_already_exists' || msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists'))
    return new HttpError(409, MSG.exists, 'user_exists');
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized' || msg.includes('invalid email') || msg.includes('unable to validate email'))
    return new HttpError(400, MSG.invalidEmail, 'invalid_email');
  if (code === 'weak_password') return new HttpError(400, MSG.weak, 'weak_password');
  if (msg.includes('sending') || msg.includes('smtp') || msg.includes('error sending')) return new HttpError(502, MSG.emailFailed, 'email_send_failed');
  if (status >= 500 || status === 0) return new HttpError(503, MSG.unavailable, 'backend_unavailable');
  return fallback;
}

function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 12 || p.length > 72) throw new HttpError(400, 'Temporary password must be 12–72 characters', 'weak_password');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, 'Temporary password needs upper-case, lower-case and a digit', 'weak_password');
  return p;
}

Deno.serve((req) => handle(req, async (req) => {
  const { user, admin } = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const audit = (a: string, id: string, meta: Record<string, unknown> = {}) =>
    admin.rpc('svc_audit', { p_actor: user.id, p_action: a, p_entity: 'profiles', p_entity_id: id, p_meta: meta });

  async function activeAdminCount(excluding?: string): Promise<number> {
    let q = admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true);
    if (excluding) q = q.neq('id', excluding);
    const { count, error } = await q;
    if (error) throw new HttpError(503, MSG.unavailable, 'backend_unavailable');
    return count ?? 0;
  }
  const userId = () => {
    const id = String(body.user_id ?? '');
    if (!UUID.test(id)) throw new HttpError(400, 'User not found', 'not_found');
    return id;
  };

  switch (action) {
    case 'ping':
      return json(req, { ok: true, at: new Date().toISOString() });

    case 'create': {
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = String(body.role ?? 'bd_executive');
      const fullName = String(body.full_name ?? '').trim();
      if (!EMAIL.test(email)) throw new HttpError(400, MSG.invalidEmail, 'invalid_email');
      if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role', 'invalid_role');
      const target = body.daily_call_target === undefined || body.daily_call_target === null ? null : Number(body.daily_call_target);
      if (target !== null && (!Number.isInteger(target) || target < 0 || target > 2000)) throw new HttpError(400, 'Invalid daily call target', 'invalid_target');
      const pw = body.temporary_password ? checkPassword(body.temporary_password) : null;

      // Existing CRM user with this email (active or deactivated)? Never create a duplicate.
      const { data: same } = await admin.from('profiles').select('*').eq('email', email);
      if (((same ?? []) as { deleted_at?: string | null }[]).some((p) => !p.deleted_at)) throw new HttpError(409, MSG.exists, 'user_exists');
      // An Auth account WITHOUT a CRM profile that never signed in is debris from an earlier failed attempt
      // (e.g. an invite interrupted after the account was created): remove it so a retry cannot duplicate anything.
      const { data: orphans } = await admin.rpc('svc_auth_user_by_email', { p_email: email });
      for (const o of (orphans ?? []) as { id: string; has_profile: boolean; last_sign_in_at: string | null }[]) {
        if (!o.has_profile && !o.last_sign_in_at) await admin.auth.admin.deleteUser(o.id);
        else if (!o.has_profile) throw new HttpError(409, MSG.exists, 'user_exists');
      }

      let uid: string; let mode: 'temporary_password' | 'invite';
      if (pw) {
        // server-side admin creation: no email is sent, so it never depends on email delivery or its rate limit
        const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: fullName } });
        if (error || !data.user) throw authError(error, new HttpError(400, 'Could not create the user', 'create_failed'));
        uid = data.user.id; mode = 'temporary_password';
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName }, redirectTo: SITE_URL() ? `${SITE_URL()}/set-password/` : undefined,
        });
        if (error || !data.user) {
          // if Auth kept a half-created account despite the failure, remove it (no profile yet, never signed in)
          const { data: left } = await admin.rpc('svc_auth_user_by_email', { p_email: email });
          for (const o of (left ?? []) as { id: string; has_profile: boolean; last_sign_in_at: string | null }[])
            if (!o.has_profile && !o.last_sign_in_at) await admin.auth.admin.deleteUser(o.id);
          throw authError(error, new HttpError(400, 'Could not invite the user', 'invite_failed'));
        }
        uid = data.user.id; mode = 'invite';
      }
      const { error: pe } = await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: uid, p_email: email, p_full_name: fullName, p_role: role, p_active: true,
        p_phone: body.phone ?? null, p_must_change: mode === 'temporary_password',
      });
      if (pe) { await admin.auth.admin.deleteUser(uid); throw new HttpError(500, 'Could not create the CRM profile', 'profile_failed'); }
      if (target !== null && role === 'bd_executive') {
        await admin.rpc('svc_set_target', { p_actor: user.id, p_user: uid, p_target: target, p_from: body.target_from ?? null });
      }
      await audit('user_invited_or_created', uid, { email, role, mode });
      return json(req, { ok: true, user_id: uid, mode });
    }

    case 'update': {
      const id = userId();
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur) throw new HttpError(404, 'User not found', 'not_found');
      if (cur.deleted_at) throw new HttpError(400, 'Deleted users cannot be changed or reactivated', 'user_deleted');
      const role = body.role === undefined ? cur.role : String(body.role);
      const active = body.active === undefined ? cur.active : Boolean(body.active);
      if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role', 'invalid_role');
      if (id === user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot demote or deactivate your own account', 'self');
      if (cur.role === 'admin' && cur.active && (role !== 'admin' || !active) && (await activeAdminCount(id)) < 1)
        throw new HttpError(400, 'At least one active admin must remain', 'last_admin');
      const { error } = await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: id, p_email: cur.email,
        p_full_name: body.full_name === undefined ? cur.full_name : String(body.full_name).trim(),
        p_role: role, p_active: active, p_phone: body.phone ?? null, p_must_change: null,
      });
      if (error) throw new HttpError(500, 'Update failed', 'update_failed');
      // block token refresh for deactivated users (RLS already blocks data access immediately)
      await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (body.daily_call_target !== undefined && body.daily_call_target !== null && role === 'bd_executive') {
        const t = Number(body.daily_call_target);
        if (!Number.isInteger(t) || t < 0 || t > 2000) throw new HttpError(400, 'Invalid daily call target', 'invalid_target');
        await admin.rpc('svc_set_target', { p_actor: user.id, p_user: id, p_target: t, p_from: body.target_from ?? null });
      }
      return json(req, { ok: true });
    }

    case 'delete': {
      // PERMANENT: removes the Auth account (no sign-in, no token refresh ever again). The CRM profile stays as a
      // tombstone so every historical call / meeting / follow-up / proposal / activity / target / audit row keeps its author.
      const id = userId();
      if (id === user.id) throw new HttpError(400, 'You cannot delete your own account', 'self');
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur) throw new HttpError(404, 'User not found', 'not_found');
      if (cur.deleted_at) throw new HttpError(400, 'This user has already been deleted', 'user_deleted');
      if (cur.role === 'admin' && cur.active && (await activeAdminCount(id)) < 1)
        throw new HttpError(400, 'At least one active admin must remain', 'last_admin');
      const { error: me } = await admin.rpc('svc_mark_user_deleted', { p_actor: user.id, p_user: id });
      if (me) throw new HttpError(503, 'User deletion is not available yet — apply database migration 11 first', 'backend_unavailable');
      const { error: de } = await admin.auth.admin.deleteUser(id);
      const gone = !de || Number((de as { status?: number }).status) === 404 || String(de.message ?? '').toLowerCase().includes('not found');
      if (!gone) {
        await admin.rpc('svc_unmark_user_deleted', { p_actor: user.id, p_user: id, p_full_name: cur.full_name, p_active: cur.active });
        throw new HttpError(502, 'Could not remove the login account — nothing was changed. Please try again.', 'delete_failed');
      }
      await audit('user_deleted', id, { email: cur.email, role: cur.role, history_preserved: true });
      return json(req, { ok: true });
    }

    case 'send_reset': {
      const id = userId();
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur || cur.deleted_at) throw new HttpError(404, 'User not found', 'not_found');
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { error } = await anon.auth.resetPasswordForEmail(cur.email, { redirectTo: SITE_URL() ? `${SITE_URL()}/set-password/` : undefined });
      if (error) {
        const e = authError(error, new HttpError(502, 'Could not send the reset email', 'email_send_failed'));
        if (e.code === 'email_rate_limit') throw new HttpError(429, 'Password-reset email limit reached. Try again later, set a temporary password, or configure Custom SMTP.', 'email_rate_limit');
        throw e;
      }
      await audit('password_reset_initiated', id, { email: cur.email });
      return json(req, { ok: true });
    }

    case 'set_temp_password': {
      const id = userId();
      const pw = checkPassword(body.password);
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur || cur.deleted_at) throw new HttpError(404, 'User not found', 'not_found');
      // an admin-issued password vouches for the account: confirm the email too, so the user can sign in immediately
      // (an invited user who never opened the invitation would otherwise get "Email not confirmed")
      const { error } = await admin.auth.admin.updateUserById(id, { password: pw, email_confirm: true });
      if (error) throw authError(error, new HttpError(400, 'Could not set the password', 'update_failed'));
      await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: id, p_email: cur.email, p_full_name: null, p_role: cur.role,
        p_active: cur.active, p_phone: null, p_must_change: true,
      });
      await audit('temporary_password_set', id, { email: cur.email }); // the password itself is never logged
      return json(req, { ok: true });
    }

    case 'confirm_email': {
      // admin-safe: confirms the email of an existing CRM user (never changes the password, never creates anything)
      const id = userId();
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur || cur.deleted_at) throw new HttpError(404, 'User not found', 'not_found');
      const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true });
      if (error) throw authError(error, new HttpError(400, 'Could not confirm the email', 'update_failed'));
      await audit('email_confirmed_by_admin', id, { email: cur.email });
      return json(req, { ok: true });
    }

    case 'auth_status': {
      // per CRM user: is the email confirmed, when did they last sign in (read from Supabase Auth, service role)
      const { data: profs } = await admin.from('profiles').select('id');
      const ids = new Set(((profs ?? []) as { id: string }[]).map((p) => p.id));
      const out: { id: string; confirmed: boolean; last_sign_in_at: string | null }[] = [];
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new HttpError(503, MSG.unavailable, 'backend_unavailable');
        for (const u of data.users) if (ids.has(u.id)) out.push({ id: u.id, confirmed: Boolean(u.email_confirmed_at), last_sign_in_at: u.last_sign_in_at ?? null });
        if (data.users.length < 1000) break;
      }
      return json(req, { ok: true, users: out });
    }

    default:
      throw new HttpError(400, 'Unknown action', 'unknown_action');
  }
}));
