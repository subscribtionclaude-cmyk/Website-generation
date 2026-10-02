import type { Capability, SyncDomain } from './types.ts';

/**
 * Adapter contracts. Business logic depends on these interfaces only; each provider
 * implementation lives in its own module (providers/*, mock.ts) and is created by the server
 * runtime (secrets) or the demo runtime (mocks). Relative imports only — shared with
 * supabase/functions.
 */
export type HealthResultCode =
  | 'connected'
  | 'auth_failed'
  | 'permission_denied'
  | 'unreachable'
  | 'timeout'
  | 'config_incomplete'
  | 'unsupported'
  | 'rate_limited'
  | 'provider_error'
  | 'runtime_unavailable';

export interface HealthResult {
  ok: boolean;
  code: HealthResultCode;
  /** Safe, redacted summary (never a secret, never a stack trace). */
  message: string | null;
  latencyMs: number | null;
}

/** Outcome of any outbound provider call. */
export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: HealthResultCode; message: string | null; retryable: boolean };

export interface IntegrationAdapter {
  readonly key: string;
  readonly provider: string;
  readonly capabilities: readonly Capability[];
  /** True for deterministic mocks (demo / tests) — shown as "DEMO / MOCK", never as a real connection. */
  readonly isMock: boolean;
  testConnection(): Promise<HealthResult>;
}

// ── Messaging (WhatsApp / SMS / email) ──────────────────────────────────────
export interface OutboundMessage {
  /** Idempotency key (one send per delivery row). */
  idempotencyKey: string;
  to: string;
  locale: 'ar' | 'en';
  title: string;
  body: string;
  /** Provider template ID mapped to the notification event (WhatsApp requires approved templates). */
  providerTemplate: string | null;
}

export interface NotificationProvider extends IntegrationAdapter {
  send(message: OutboundMessage): Promise<ProviderResult<{ externalRef: string | null }>>;
}

// ── ERP / POS ───────────────────────────────────────────────────────────────
/** Normalized external record (fields depend on the domain). */
export interface ExternalRecord {
  externalId: string;
  sku?: string | null;
  name?: string | null;
  email?: string | null;
  price?: number | null;
  compareAt?: number | null;
  stock?: number | null;
  updatedAt?: string | null;
}

export interface ErpProvider extends IntegrationAdapter {
  fetchRecords(
    domain: SyncDomain,
    options?: { limit?: number },
  ): Promise<ProviderResult<ExternalRecord[]>>;
}
/** A POS speaks the same contract (catalog, prices, stock); sales import is a future capability. */
export type PosProvider = ErpProvider;

// ── Courier ─────────────────────────────────────────────────────────────────
export interface ShipmentRequest {
  idempotencyKey: string;
  orderNumber: string;
  recipient: { name: string; phone: string; address: string; area: string; governorate: string };
  parcel: { items: number; declaredValue: number };
}
export interface CourierQuote {
  fee: number;
  currency: 'EGP';
  etaDays: number | null;
}
export interface ShipmentInfo {
  trackingNumber: string;
  status: 'created' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
}

/** Optional methods: present only when the provider supports them (capability detection). */
export interface CourierProvider extends IntegrationAdapter {
  quote?(request: ShipmentRequest): Promise<ProviderResult<CourierQuote>>;
  createShipment?(request: ShipmentRequest): Promise<ProviderResult<ShipmentInfo>>;
  track?(trackingNumber: string): Promise<ProviderResult<ShipmentInfo>>;
  cancel?(trackingNumber: string): Promise<ProviderResult<ShipmentInfo>>;
}

// ── AI ──────────────────────────────────────────────────────────────────────
export type SuggestionKind = 'seo_description' | 'spec_text' | 'news_draft';

/** Only public catalog / content fields — never orders, contact data or private media. */
export interface PublicContentInput {
  kind: SuggestionKind;
  locale: 'ar' | 'en';
  name: string;
  brand: string | null;
  category: string | null;
  subtitle: string | null;
  specs: { label: string; value: string }[];
}

export interface AiProvider extends IntegrationAdapter {
  suggest(input: PublicContentInput): Promise<ProviderResult<{ text: string }>>;
}

// ── Search ──────────────────────────────────────────────────────────────────
export interface SearchProvider extends IntegrationAdapter {
  query(q: string, options?: { limit?: number }): Promise<ProviderResult<{ slugs: string[] }>>;
}

// ── Storage / backup ────────────────────────────────────────────────────────
/** Private media must stay private whatever the provider: signed, expiring URLs only. */
export type MediaVisibility = 'public' | 'private';
export interface StoredObject {
  path: string;
  visibility: MediaVisibility;
  size: number;
  contentType: string;
}
export interface StorageProvider extends IntegrationAdapter {
  upload(object: StoredObject, body: Uint8Array): Promise<ProviderResult<StoredObject>>;
  /** Public objects: a stable URL. Private objects: a signed URL expiring within `expiresIn` seconds. */
  url(
    object: StoredObject,
    expiresIn?: number,
  ): Promise<ProviderResult<{ url: string; expiresAt: string | null }>>;
  remove(path: string): Promise<ProviderResult<null>>;
  metadata(path: string): Promise<ProviderResult<StoredObject>>;
}

export interface BackupProvider extends IntegrationAdapter {
  upload(name: string, body: Uint8Array): Promise<ProviderResult<{ location: string }>>;
}

// ── Social sign-in ──────────────────────────────────────────────────────────
export interface SocialAuthStatus {
  google: boolean;
  apple: boolean;
}
