import catalogJson from './integration-catalog.json';
import type { Capability, IntegrationKey, IntegrationSpec, SettingsValue } from './types.ts';

/**
 * Typed integration registry over integration-catalog.json (the contract the database mirrors in
 * app.integration_catalog()). Business code asks the registry and the adapter interfaces — no
 * provider-specific logic is scattered through the app. Relative imports only: the server runtime
 * (supabase/functions) imports this module too.
 */
export type {
  IntegrationCategory,
  IntegrationKey,
  SyncDomain,
  Ownership,
  MessagingChannel,
  FallbackMode,
  Capability,
  SettingField,
  ProviderSpec,
  IntegrationSpec,
  SettingsValue,
} from './types.ts';

export const INTEGRATIONS = catalogJson.integrations as IntegrationSpec[];
export const INTEGRATION_KEYS = INTEGRATIONS.map((i) => i.key);
export const MOCK_PROVIDER = 'mock';

export function integrationSpec(key: IntegrationKey): IntegrationSpec {
  const spec = INTEGRATIONS.find((i) => i.key === key);
  if (!spec) throw new Error(`Unknown integration: ${key}`);
  return spec;
}

export function isIntegrationKey(value: string): value is IntegrationKey {
  return INTEGRATIONS.some((i) => i.key === value);
}

/** Capabilities of a configured provider (capability detection — never assume a universal API). */
export function providerCapabilities(
  key: IntegrationKey,
  provider: string | null,
  mockCapabilities?: Capability[],
): Capability[] {
  if (!provider) return [];
  if (provider === MOCK_PROVIDER) {
    const all = integrationSpec(key).providers.flatMap((p) => p.capabilities);
    return mockCapabilities ?? [...new Set(all)];
  }
  return integrationSpec(key).providers.find((p) => p.key === provider)?.capabilities ?? [];
}

/** Secret-looking names or values are never stored as configuration (mirrors app.integration_secret_like). */
const SECRET_NAME = /(password|passwd|secret|token|api_?key|private|credential|signature|bearer)/i;
const SECRET_VALUE = [
  /^(sk-|sk_live_|sk_test_|rk_live_|xox[abprs]-|EAA[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_|glpat-|sb_secret_)/,
  /-----BEGIN/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /^[A-Za-z0-9+/=_-]{40,}$/,
];

export function isSecretLike(name: string, value: unknown): boolean {
  if (SECRET_NAME.test(name)) return true;
  return typeof value === 'string' && SECRET_VALUE.some((re) => re.test(value));
}

export interface SettingsProblem {
  field: string;
  code: 'unknown_setting' | 'secret_not_allowed' | 'invalid_setting' | 'required';
}

/** Validate public settings exactly like admin_save_integration (+ the catalog patterns). */
export function validateSettings(key: IntegrationKey, settings: SettingsValue): SettingsProblem[] {
  const spec = integrationSpec(key);
  const problems: SettingsProblem[] = [];
  for (const [name, value] of Object.entries(settings)) {
    const field = spec.settings.find((f) => f.key === name);
    if (!field) {
      problems.push({ field: name, code: 'unknown_setting' });
      continue;
    }
    if (isSecretLike(name, value)) {
      problems.push({ field: name, code: 'secret_not_allowed' });
      continue;
    }
    if (value === null || value === '') continue;
    const ok =
      field.type === 'boolean'
        ? typeof value === 'boolean'
        : field.type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === 'string' &&
            value.length <= 300 &&
            (field.type !== 'url' || /^https:\/\/[^\s/$.?#][^\s]*$/.test(value)) &&
            (field.type !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) &&
            (!field.pattern || new RegExp(field.pattern).test(value));
    if (!ok) problems.push({ field: name, code: 'invalid_setting' });
  }
  for (const field of spec.settings) {
    const value = settings[field.key];
    if (field.required && (value === undefined || value === null || value === ''))
      problems.push({ field: field.key, code: 'required' });
  }
  return problems;
}

/** Required public settings present (mirrors app.integration_config_complete). */
export function configComplete(
  key: IntegrationKey,
  provider: string | null,
  settings: SettingsValue,
): boolean {
  if (!provider) return false;
  const spec = integrationSpec(key);
  if (provider !== MOCK_PROVIDER && !spec.providers.some((p) => p.key === provider)) return false;
  const missing = spec.settings.some(
    (f) =>
      f.required &&
      (settings[f.key] === undefined ||
        settings[f.key] === null ||
        String(settings[f.key]).trim() === ''),
  );
  if (missing) return false;
  if (key === 'social_auth') return settings.google === true || settings.apple === true;
  return true;
}
