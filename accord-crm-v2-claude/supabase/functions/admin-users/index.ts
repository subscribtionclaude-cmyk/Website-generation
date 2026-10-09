// Admin user management. Runs with the service role; every call is authorised against the caller's
// verified JWT + active admin profile. Passwords are never stored, logged, echoed or returned.
import { handle, json, requireAdmin, HttpError } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'bd_executive', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE_URL = () => (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 12 || p.length > 72) throw new HttpError(400, 'Temporary password must be 12–72 characters');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, 'Temporary password needs upper-case, lower-case and a digit');
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
    const { count } = await q;
    return count ?? 0;
  }

  switch (action) {
    case 'ping':
      return json(req, { ok: true, at: new Date().toISOString() });

    case 'create': {
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = String(body.role ?? 'bd_executive');
      const fullName = String(body.full_name ?? '').trim();
      if (!EMAIL.test(email)) throw new HttpError(400, 'Valid email required');
      if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
      const target = body.daily_call_target === undefined || body.daily_call_target === null ? null : Number(body.daily_call_target);
      if (target !== null && (!Number.isInteger(target) || target < 0 || target > 2000)) throw new HttpError(400, 'Invalid daily call target');

      let uid: string; let mode: 'temporary_password' | 'invite';
      if (body.temporary_password) {
        const pw = checkPassword(body.temporary_password);
        const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: fullName } });
        if (error || !data.user) throw new HttpError(400, error?.message?.includes('already') ? 'A user with this email already exists' : 'Could not create the user');
        uid = data.user.id; mode = 'temporary_password';
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName }, redirectTo: SITE_URL() ? `${SITE_URL()}/set-password/` : undefined,
        });
        if (error || !data.user) throw new HttpError(400, error?.message?.includes('already') ? 'A user with this email already exists' : 'Could not invite the user');
        uid = data.user.id; mode = 'invite';
      }
      const { error: pe } = await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: uid, p_email: email, p_full_name: fullName, p_role: role, p_active: true,
        p_phone: body.phone ?? null, p_must_change: mode === 'temporary_password',
      });
      if (pe) { await admin.auth.admin.deleteUser(uid); throw new HttpError(500, 'Could not create the CRM profile'); }
      if (target !== null && role === 'bd_executive') {
        await admin.rpc('svc_set_target', { p_actor: user.id, p_user: uid, p_target: target, p_from: body.target_from ?? null });
      }
      await audit('user_invited_or_created', uid, { email, role, mode });
      return json(req, { ok: true, user_id: uid, mode });
    }

    case 'update': {
      const id = String(body.user_id ?? '');
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur) throw new HttpError(404, 'User not found');
      const role = body.role === undefined ? cur.role : String(body.role);
      const active = body.active === undefined ? cur.active : Boolean(body.active);
      if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
      if (id === user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot demote or deactivate your own account');
      if (cur.role === 'admin' && cur.active && (role !== 'admin' || !active) && (await activeAdminCount(id)) < 1)
        throw new HttpError(400, 'At least one active admin must remain');
      const { error } = await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: id, p_email: cur.email,
        p_full_name: body.full_name === undefined ? cur.full_name : String(body.full_name).trim(),
        p_role: role, p_active: active, p_phone: body.phone ?? null, p_must_change: null,
      });
      if (error) throw new HttpError(500, 'Update failed');
      // block token refresh for deactivated users (RLS already blocks data access immediately)
      await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (body.daily_call_target !== undefined && body.daily_call_target !== null && role === 'bd_executive') {
        const t = Number(body.daily_call_target);
        if (!Number.isInteger(t) || t < 0 || t > 2000) throw new HttpError(400, 'Invalid daily call target');
        await admin.rpc('svc_set_target', { p_actor: user.id, p_user: id, p_target: t, p_from: body.target_from ?? null });
      }
      return json(req, { ok: true });
    }

    case 'send_reset': {
      const id = String(body.user_id ?? '');
      const { data: cur } = await admin.from('profiles').select('email, active').eq('id', id).maybeSingle();
      if (!cur) throw new HttpError(404, 'User not found');
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { error } = await anon.auth.resetPasswordForEmail(cur.email, { redirectTo: SITE_URL() ? `${SITE_URL()}/set-password/` : undefined });
      if (error) throw new HttpError(502, 'Could not send the reset email');
      await audit('password_reset_initiated', id, { email: cur.email });
      return json(req, { ok: true });
    }

    case 'set_temp_password': {
      const id = String(body.user_id ?? '');
      const pw = checkPassword(body.password);
      const { data: cur } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!cur) throw new HttpError(404, 'User not found');
      const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
      if (error) throw new HttpError(400, 'Could not set the password');
      await admin.rpc('svc_upsert_profile', {
        p_actor: user.id, p_user: id, p_email: cur.email, p_full_name: null, p_role: cur.role,
        p_active: cur.active, p_phone: null, p_must_change: true,
      });
      await audit('temporary_password_set', id, { email: cur.email }); // the password itself is never logged
      return json(req, { ok: true });
    }

    default:
      throw new HttpError(400, 'Unknown action');
  }
}));
