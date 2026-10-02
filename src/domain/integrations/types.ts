/**
 * Shared integration types (no JSON, no aliases, no runtime code) — imported by the browser core
 * and by the server runtime (supabase/functions) alike.
 */
export type IntegrationCategory =
  | 'messaging'
  | 'analytics'
  | 'erp'
  | 'pos'
  | 'shipping'
  | 'ai'
  | 'search'
  | 'storage'
  | 'backup'
  | 'auth';

export type IntegrationKey =
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'google_analytics'
  | 'odoo'
  | 'pos'
  | 'courier'
  | 'ai'
  | 'search'
  | 'storage'
  | 'backup'
  | 'social_auth';

export type SyncDomain = 'products' | 'prices' | 'stock' | 'customers';
export type Ownership = 'malek' | 'external' | 'external_wins';
export type MessagingChannel = 'email' | 'whatsapp' | 'sms';

/** Free / manual path that keeps the store working while the provider is absent. */
export type FallbackMode =
  | 'manual_whatsapp'
  | 'manual_contact'
  | 'in_app_only'
  | 'built_in_analytics'
  | 'malek_primary'
  | 'manual_shipping'
  | 'manual_content'
  | 'built_in_search'
  | 'supabase_storage'
  | 'manual_export'
  | 'email_sign_in';

export type Capability =
  | 'message.template'
  | 'message.text'
  | 'message.email'
  | 'delivery.status'
  | 'webhook'
  | 'analytics.events'
  | 'products.read'
  | 'prices.read'
  | 'stock.read'
  | 'customers.read'
  | 'sales.read'
  | 'shipment.quote'
  | 'shipment.create'
  | 'shipment.track'
  | 'shipment.cancel'
  | 'content.spec_suggest'
  | 'content.seo_suggest'
  | 'content.news_suggest'
  | 'search.query'
  | 'media.upload'
  | 'media.signed_url'
  | 'media.delete'
  | 'media.metadata'
  | 'backup.upload'
  | 'auth.google'
  | 'auth.apple';

export interface SettingField {
  key: string;
  type: 'string' | 'url' | 'email' | 'number' | 'boolean';
  required: boolean;
  pattern?: string;
}

export interface ProviderSpec {
  key: string;
  /** implemented: a real adapter exists · contract: interface + mock; adapter added with a provider. */
  adapter: 'implemented' | 'contract';
  capabilities: Capability[];
}

export interface IntegrationSpec {
  key: IntegrationKey;
  category: IntegrationCategory;
  channel?: MessagingChannel;
  /** Where "Test connection" runs: server runtime (secrets) or the browser (public checks). */
  check: 'server' | 'client';
  subscription: 'free' | 'may_require' | 'required';
  fallback: FallbackMode;
  providers: ProviderSpec[];
  settings: SettingField[];
  /** Names of server-only environment variables (values never leave the server). */
  secrets: string[];
  syncDomains: SyncDomain[];
  /** Data categories this integration receives (shown in the admin). */
  data: string[];
}

export type SettingsValue = Record<string, string | number | boolean | null>;
