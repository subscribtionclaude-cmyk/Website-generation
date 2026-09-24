import { BASE_SETTINGS } from './defaults';
import {
  PUBLIC_SETTING_KEYS,
  SETTING_SCHEMAS,
  type PublicSettingKey,
  type PublicSettings,
} from './registry';

export interface SettingRecord {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string | null;
}

export type SettingSource = 'backend' | 'default';

export interface SettingIssue {
  key: string;
  reason: 'missing' | 'invalid';
  detail?: string;
}

export interface ResolvedSettings {
  settings: PublicSettings;
  sources: Record<PublicSettingKey, SettingSource>;
  versions: Partial<Record<PublicSettingKey, number>>;
  issues: SettingIssue[];
}

/**
 * Merge published backend rows over the bundled base settings, validating each key.
 * Invalid rows never reach the UI: they are reported as issues and the base value is used instead.
 */
export function resolveSettings(records: readonly SettingRecord[]): ResolvedSettings {
  const byKey = new Map(records.map((record) => [record.key, record]));
  const settings = { ...BASE_SETTINGS } as Record<PublicSettingKey, unknown>;
  const sources = {} as Record<PublicSettingKey, SettingSource>;
  const versions: Partial<Record<PublicSettingKey, number>> = {};
  const issues: SettingIssue[] = [];

  for (const key of PUBLIC_SETTING_KEYS) {
    const record = byKey.get(key);
    if (!record) {
      sources[key] = 'default';
      issues.push({ key, reason: 'missing' });
      continue;
    }
    const parsed = SETTING_SCHEMAS[key].safeParse(record.value);
    if (parsed.success) {
      settings[key] = parsed.data;
      sources[key] = 'backend';
      versions[key] = record.version;
    } else {
      sources[key] = 'default';
      issues.push({ key, reason: 'invalid', detail: parsed.error.issues[0]?.message });
    }
  }

  return { settings: settings as PublicSettings, sources, versions, issues };
}
