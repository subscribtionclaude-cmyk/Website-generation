/**
 * Runtime configuration, resolved once at boot from Vite env variables.
 *
 * Data mode rules (never silently mix demo data into live mode):
 *  - VITE_DATA_MODE=demo  → demo repositories + demo auth, even if Supabase is configured.
 *  - VITE_DATA_MODE=live  → Supabase required; missing config is a hard, visible error.
 *  - unset                → live when Supabase is configured, otherwise demo.
 */
export type DataMode = 'demo' | 'live';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface AppConfig {
  dataMode: DataMode;
  dataModeSource: 'explicit' | 'auto';
  supabase: SupabaseConfig | null;
  siteUrl: string | null;
}

export type ConfigIssueCode =
  | 'invalid_data_mode'
  | 'live_mode_requires_supabase'
  | 'incomplete_supabase_config'
  | 'invalid_supabase_url'
  | 'secret_key_in_frontend'
  | 'invalid_site_url';

export interface ConfigIssue {
  code: ConfigIssueCode;
  variable: string;
  message: string;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: ConfigIssue[] };

export type RawEnv = Partial<Record<string, string | boolean | undefined>>;

function read(env: RawEnv, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function decodeJwtRole(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/** Secret keys must never ship in a browser bundle — refuse to start rather than expose them. */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  return decodeJwtRole(key) === 'service_role';
}

function isHttpUrl(value: string, requireHttps: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    // Plain http is only acceptable for local development stacks.
    return (
      !requireHttps && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function resolveAppConfig(env: RawEnv): ConfigResult {
  const issues: ConfigIssue[] = [];
  const rawMode = read(env, 'VITE_DATA_MODE').toLowerCase();
  const url = read(env, 'VITE_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = read(env, 'VITE_SUPABASE_ANON_KEY');
  const siteUrl = read(env, 'VITE_SITE_URL').replace(/\/+$/, '');

  if (rawMode !== '' && rawMode !== 'demo' && rawMode !== 'live') {
    issues.push({
      code: 'invalid_data_mode',
      variable: 'VITE_DATA_MODE',
      message: `VITE_DATA_MODE must be "demo" or "live" (got "${rawMode}").`,
    });
  }

  if (anonKey && looksLikeSecretKey(anonKey)) {
    issues.push({
      code: 'secret_key_in_frontend',
      variable: 'VITE_SUPABASE_ANON_KEY',
      message:
        'A service-role / secret key was supplied. Only the public anon or publishable key may be used in the frontend. Rotate the exposed key in Supabase.',
    });
  }

  if ((url && !anonKey) || (!url && anonKey)) {
    issues.push({
      code: 'incomplete_supabase_config',
      variable: url ? 'VITE_SUPABASE_ANON_KEY' : 'VITE_SUPABASE_URL',
      message: 'Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.',
    });
  }

  if (url && !isHttpUrl(url, false)) {
    issues.push({
      code: 'invalid_supabase_url',
      variable: 'VITE_SUPABASE_URL',
      message: 'VITE_SUPABASE_URL must be an https URL (http is allowed only for localhost).',
    });
  }

  if (siteUrl && !isHttpUrl(siteUrl, false)) {
    issues.push({
      code: 'invalid_site_url',
      variable: 'VITE_SITE_URL',
      message: 'VITE_SITE_URL must be an absolute https URL.',
    });
  }

  const hasSupabase = Boolean(url && anonKey);
  const dataMode: DataMode =
    rawMode === 'demo' || rawMode === 'live' ? rawMode : hasSupabase ? 'live' : 'demo';

  if (
    dataMode === 'live' &&
    !hasSupabase &&
    !issues.some((i) => i.code === 'incomplete_supabase_config')
  ) {
    issues.push({
      code: 'live_mode_requires_supabase',
      variable: 'VITE_SUPABASE_URL',
      message:
        'Live mode needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Demo data is never used as a silent fallback.',
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    config: {
      dataMode,
      dataModeSource: rawMode ? 'explicit' : 'auto',
      supabase: hasSupabase ? { url, anonKey } : null,
      siteUrl: siteUrl || null,
    },
  };
}
