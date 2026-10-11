// Shared authorisation for privileged Edge Functions.
// Never trust a role (or user id) sent by the browser: the caller's JWT is verified with Supabase Auth and the
// role is read from the database (profiles) using the service role.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export class HttpError extends Error {
  /** `code` is a stable machine-readable reason the UI can branch on; `message` is a safe, fixed English sentence. */
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim());
  const origin = req.headers.get('origin') ?? '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AdminContext { user: User; admin: SupabaseClient; email: string }

export async function requireAdmin(req: Request): Promise<AdminContext> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Missing bearer token', 'not_signed_in');
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Invalid or expired session', 'not_signed_in');
  const { data: profile, error: pErr } = await admin.from('profiles').select('role, active, email').eq('id', data.user.id).maybeSingle();
  if (pErr) throw new HttpError(503, 'Backend unavailable — please try again shortly', 'backend_unavailable');
  if (!profile || !profile.active) throw new HttpError(403, 'Account is not active in this CRM', 'permission_denied');
  if (profile.role !== 'admin') throw new HttpError(403, 'Admin role required', 'permission_denied');
  return { user: data.user, admin, email: profile.email };
}

export async function handle(req: Request, fn: (req: Request) => Promise<Response>): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405);
  try {
    return await fn(req);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
    // never echo internals (could contain secrets); log a short message only
    console.error('function error:', e instanceof Error ? e.message : 'unknown');
    return json(req, { error: 'Internal error', code: 'internal' }, 500);
  }
}
