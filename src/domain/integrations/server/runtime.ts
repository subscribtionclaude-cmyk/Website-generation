import type {
  ErpProvider,
  HealthResult,
  IntegrationAdapter,
  NotificationProvider,
} from '../adapters.ts';
import { isPublicHttpsUrl, type FetchLike } from '../http.ts';
import { odooProvider, ODOO_SECRET_NAMES } from '../providers/odooJsonRpc.ts';
import { whatsappCloudProvider, WHATSAPP_SECRET_NAMES } from '../providers/whatsappCloud.ts';
import type { SettingsValue } from '../types.ts';

/**
 * Server-side adapter factory (Supabase Edge Functions). Secrets are read from the server
 * environment by NAME at call time and handed to the adapter — they are never returned, logged or
 * stored. Live mode never falls back to a mock: a provider without an installed adapter, or with
 * missing secrets, reports `unsupported` / `config_incomplete` and the manual fallback stays active.
 */
export type EnvReader = (name: string) => string | undefined;

export interface RuntimeConfig {
  key: string;
  provider: string | null;
  enabled: boolean;
  settings: SettingsValue;
}

export type AdapterResult<T extends IntegrationAdapter> =
  { ok: true; adapter: T; secrets: string[] } | { ok: false; health: HealthResult };

/** Providers with a live adapter in this build, and the secret NAMES each needs. */
export const SERVER_ADAPTERS: Record<string, { integration: string; secrets: string[] }> = {
  meta_cloud: { integration: 'whatsapp', secrets: [WHATSAPP_SECRET_NAMES.accessToken] },
  odoo_jsonrpc: { integration: 'odoo', secrets: [ODOO_SECRET_NAMES.apiKey] },
};

const fail = (
  code: HealthResult['code'],
  message: string,
): { ok: false; health: HealthResult } => ({
  ok: false,
  health: { ok: false, code, message, latencyMs: null },
});

const str = (value: SettingsValue[string] | undefined) => (typeof value === 'string' ? value : '');

export function createServerAdapter(
  config: RuntimeConfig,
  env: EnvReader,
  fetchImpl: FetchLike,
): AdapterResult<IntegrationAdapter> {
  if (!config.provider) return fail('config_incomplete', 'no_provider');
  const spec = SERVER_ADAPTERS[config.provider];
  if (!spec || spec.integration !== config.key) return fail('unsupported', 'adapter_not_installed');
  const missing = spec.secrets.filter((name) => !env(name));
  // Secret NAMES (never values) are safe to report so the owner knows what to set on the server.
  if (missing.length > 0) return fail('config_incomplete', `missing_secret:${missing.join(',')}`);
  const secret = (name: string) => env(name) ?? '';

  if (config.provider === 'meta_cloud') {
    const accessToken = secret(WHATSAPP_SECRET_NAMES.accessToken);
    return {
      ok: true,
      secrets: [accessToken],
      adapter: whatsappCloudProvider({
        phoneNumberId: str(config.settings.phoneNumberId),
        graphVersion: str(config.settings.graphVersion),
        accessToken,
        fetch: fetchImpl,
      }),
    };
  }
  const baseUrl = str(config.settings.baseUrl);
  if (!isPublicHttpsUrl(baseUrl)) return fail('config_incomplete', 'endpoint_not_public');
  const apiKey = secret(ODOO_SECRET_NAMES.apiKey);
  return {
    ok: true,
    secrets: [apiKey],
    adapter: odooProvider({
      baseUrl,
      database: str(config.settings.database),
      username: str(config.settings.username),
      companyId: typeof config.settings.companyId === 'number' ? config.settings.companyId : null,
      apiKey,
      fetch: fetchImpl,
    }),
  };
}

export function isNotificationProvider(
  adapter: IntegrationAdapter,
): adapter is NotificationProvider {
  return typeof (adapter as Partial<NotificationProvider>).send === 'function';
}

export function isErpProvider(adapter: IntegrationAdapter): adapter is ErpProvider {
  return typeof (adapter as Partial<ErpProvider>).fetchRecords === 'function';
}
