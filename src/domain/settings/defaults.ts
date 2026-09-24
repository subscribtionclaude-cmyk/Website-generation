import baseSeed from '@seed/base/site-settings.json';
import { PUBLIC_SETTING_KEYS, SETTING_SCHEMAS, type PublicSettings } from './registry';

/**
 * Base (owner-supplied, non-demo) settings bundled with the app.
 * Used as the fallback when a published setting row is missing or invalid, so the storefront
 * always has correct store details even before the admin publishes anything.
 * Parsed eagerly: an invalid seed file fails fast in development and in tests.
 */
function parseBaseSettings(): PublicSettings {
  const raw = baseSeed.settings as Record<string, unknown>;
  const result: Partial<Record<string, unknown>> = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    const parsed = SETTING_SCHEMAS[key].safeParse(raw[key]);
    if (!parsed.success) {
      throw new Error(`Invalid base setting "${key}": ${parsed.error.message}`);
    }
    result[key] = parsed.data;
  }
  return result as PublicSettings;
}

export const BASE_SETTINGS: PublicSettings = parseBaseSettings();
