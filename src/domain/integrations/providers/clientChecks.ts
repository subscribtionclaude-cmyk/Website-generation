import type { HealthResult } from '../adapters.ts';
import { callProvider, fetchWithTimeout, toHealth, type FetchLike } from '../http.ts';

/**
 * Integrations whose "Test connection" needs no secret run in the browser:
 *  - Google Analytics 4: Google offers no keyless connection test, so the check verifies the
 *    Measurement ID format only and says so. Nothing is loaded in the admin (no GA on staff pages).
 *  - Social sign-in: Supabase Auth's public settings endpoint (anon key) reports which external
 *    providers are switched on in the Supabase dashboard — OAuth client secrets live there, never here.
 */
export const GA_MEASUREMENT_ID = /^G-[A-Z0-9]{4,15}$/;

export function checkGoogleAnalytics(measurementId: unknown): HealthResult {
  if (typeof measurementId === 'string' && GA_MEASUREMENT_ID.test(measurementId))
    return { ok: true, code: 'connected', message: 'format_verified', latencyMs: null };
  return {
    ok: false,
    code: 'config_incomplete',
    message: 'invalid_measurement_id',
    latencyMs: null,
  };
}

export async function checkSocialAuth(options: {
  fetch: FetchLike;
  supabaseUrl: string | null;
  anonKey: string | null;
  wanted: { google: boolean; apple: boolean };
  timeoutMs?: number;
}): Promise<HealthResult> {
  if (!options.supabaseUrl || !options.anonKey)
    return {
      ok: false,
      code: 'runtime_unavailable',
      message: 'supabase_not_configured',
      latencyMs: null,
    };
  const { anonKey } = options;
  const result = await callProvider(
    () =>
      fetchWithTimeout(
        options.fetch,
        `${options.supabaseUrl?.replace(/\/+$/, '')}/auth/v1/settings`,
        { headers: { apikey: anonKey } },
        options.timeoutMs,
      ),
    async (response) => (await response.json()) as { external?: Record<string, unknown> },
    [anonKey],
  );
  if (!result.ok) return toHealth(result);
  const external = result.value.external ?? {};
  const missing = (['google', 'apple'] as const).filter(
    (p) => options.wanted[p] && external[p] !== true,
  );
  if (missing.length > 0)
    return {
      ok: false,
      code: 'config_incomplete',
      message: `provider_off:${missing.join(',')}`,
      latencyMs: result.latencyMs,
    };
  return { ok: true, code: 'connected', message: null, latencyMs: result.latencyMs };
}
