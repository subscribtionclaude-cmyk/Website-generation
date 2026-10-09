import { createClient } from '@supabase/supabase-js';

// Only the PUBLIC URL + anon/publishable key ever ship in the static bundle. Data is protected by RLS.
// Runtime config (/config.js) wins; build-time env is the fallback (used by local dev and the e2e build).
const runtime = (window as unknown as { ACCORD_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string } }).ACCORD_CONFIG;
const url = (runtime?.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined)) || undefined;
const key = (runtime?.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)) || undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
export const functionsUrl = `${(url ?? '').replace(/\/$/, '')}/functions/v1`;

/** Throws a readable error for a supabase-js response. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function callFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: key ?? '' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error((json as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return json as T;
}
