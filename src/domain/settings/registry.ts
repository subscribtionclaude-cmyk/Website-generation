import type { z } from 'zod';
import type { PermissionKey } from '@/domain/access/permissions';
import definitionsJson from './setting-definitions.json';
import {
  brandSettingsSchema,
  catalogSettingsSchema,
  commerceSettingsSchema,
  featuresSettingsSchema,
  localizationSettingsSchema,
  navigationSettingsSchema,
  orderReviewSettingsSchema,
  securitySettingsSchema,
  seoSettingsSchema,
  socialSettingsSchema,
  storeSettingsSchema,
  themeSettingsSchema,
  trustSettingsSchema,
} from './schemas';

export type SettingScope = 'design' | 'settings' | 'content' | 'security';

export interface SettingDefinition {
  key: string;
  scope: SettingScope;
  isPublic: boolean;
  editPermission: PermissionKey;
  publishPermission: PermissionKey;
}

/** Schemas for every setting key. `registry.test.ts` checks this matches setting-definitions.json. */
export const SETTING_SCHEMAS = {
  brand: brandSettingsSchema,
  theme: themeSettingsSchema,
  navigation: navigationSettingsSchema,
  store: storeSettingsSchema,
  social: socialSettingsSchema,
  localization: localizationSettingsSchema,
  features: featuresSettingsSchema,
  seo: seoSettingsSchema,
  trust: trustSettingsSchema,
  catalog: catalogSettingsSchema,
  commerce: commerceSettingsSchema,
  order_review: orderReviewSettingsSchema,
  security: securitySettingsSchema,
} as const satisfies Record<string, z.ZodType>;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export const SETTING_DEFINITIONS = definitionsJson.definitions as SettingDefinition[];

export const PUBLIC_SETTING_KEYS = SETTING_DEFINITIONS.filter((d) => d.isPublic).map(
  (d) => d.key,
) as PublicSettingKey[];

export type PublicSettingKey = Exclude<SettingKey, 'security' | 'order_review'>;

export type PublicSettings = { [K in PublicSettingKey]: SettingValue<K> };

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key);
}
