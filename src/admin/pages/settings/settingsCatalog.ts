import type { SettingKey } from '@/domain/settings/registry';

export type SettingGroup =
  | 'general'
  | 'store'
  | 'payments'
  | 'shipping'
  | 'orders'
  | 'customers'
  | 'services'
  | 'catalog'
  | 'notifications'
  | 'legal'
  | 'security';

/**
 * Settings hub layout. Every key edits through the same draft → publish → versions → rollback
 * workflow. `theme` and `navigation` are design settings owned by the Phase 07 Site Editor.
 */
export const SETTING_GROUPS: { id: SettingGroup; keys: SettingKey[] }[] = [
  { id: 'general', keys: ['brand', 'localization', 'features', 'social', 'seo'] },
  { id: 'store', keys: ['store'] },
  { id: 'payments', keys: ['commerce'] },
  { id: 'shipping', keys: ['shipping', 'receipt'] },
  { id: 'orders', keys: ['order_review'] },
  { id: 'customers', keys: ['engagement', 'abandoned_cart', 'loyalty'] },
  { id: 'services', keys: ['services', 'service_sla', 'repair_catalog'] },
  { id: 'catalog', keys: ['catalog', 'trust'] },
  { id: 'notifications', keys: ['notifications'] },
  { id: 'legal', keys: ['legal'] },
  { id: 'security', keys: ['security'] },
];

export const EDITABLE_SETTING_KEYS = SETTING_GROUPS.flatMap((g) => g.keys);

/** Keys with a dedicated admin screen (richer editor or preview) instead of the generic form. */
export const DEDICATED_SETTING_PATHS: Partial<Record<SettingKey, string>> = {
  shipping: '/admin/shipping',
  receipt: '/admin/receipts',
  legal: '/admin/legal',
};

export function settingHref(key: SettingKey): string {
  return DEDICATED_SETTING_PATHS[key] ?? `/admin/settings/${key}`;
}
