import { z } from 'zod';

/** Zod contracts for the Phase 09 RPCs (checked against SQL output in contracts.test.ts). */
const iso = z.string();
const isoN = z.string().nullable();
const count = z.coerce.number().int();

export const HEALTH_CODES = [
  'connected',
  'auth_failed',
  'permission_denied',
  'unreachable',
  'timeout',
  'config_incomplete',
  'unsupported',
  'rate_limited',
  'provider_error',
  'runtime_unavailable',
] as const;
export type HealthCode = (typeof HEALTH_CODES)[number];

const settingsValue = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const integrationConfigSchema = z.object({
  key: z.string(),
  provider: z.string().nullable(),
  enabled: z.boolean(),
  settings: settingsValue,
  ownership: z.record(z.string(), z.enum(['malek', 'external', 'external_wins'])),
  direction: z.enum(['import', 'export', 'two_way']),
  templateMap: z.record(z.string(), z.string()),
  complete: z.boolean(),
  lastCheckAt: isoN,
  lastCheckStatus: z.enum(['connected', 'failed']).nullable(),
  lastCheckCode: z.string().nullable(),
  lastCheckMessage: z.string().nullable(),
  lastCheckLatencyMs: z.number().nullable(),
  lastOkAt: isoN,
  consecutiveFailures: z.number().int(),
  circuitOpenUntil: isoN,
  lastSyncAt: isoN,
  updatedAt: iso,
  /** Demo only: mock behaviour picked in the admin (never present in live data). */
  mockScenario: z.string().optional(),
});
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

export const syncJobSchema = z.object({
  id: z.string(),
  key: z.string(),
  domain: z.enum(['products', 'prices', 'stock', 'customers']),
  direction: z.enum(['import', 'export']),
  dryRun: z.boolean(),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'cancelled']),
  inspected: count,
  created: count,
  updated: count,
  skipped: count,
  failed: count,
  conflicts: count,
  errorCode: z.string().nullable(),
  errorSummary: z.string().nullable(),
  startedAt: iso,
  finishedAt: isoN,
  actorName: z.string().nullable(),
});
export type SyncJob = z.infer<typeof syncJobSchema>;

export const SYNC_ACTIONS = [
  'create',
  'update',
  'link',
  'unchanged',
  'skip',
  'conflict',
  'invalid',
] as const;
export type SyncAction = (typeof SYNC_ACTIONS)[number];

export const syncItemSchema = z.object({
  position: z.number().int(),
  externalId: z.string().nullable(),
  entity: z.enum(['variant', 'product', 'customer']),
  localId: z.string().nullable(),
  label: z.string().nullable(),
  action: z.enum(SYNC_ACTIONS),
  reason: z.string().nullable(),
  applied: z.boolean(),
  detail: z.record(z.string(), z.unknown()),
});
export type SyncItem = z.infer<typeof syncItemSchema>;

export const syncJobDetailSchema = syncJobSchema.extend({ items: z.array(syncItemSchema) });
export type SyncJobDetail = z.infer<typeof syncJobDetailSchema>;

export const integrationOverviewItemSchema = integrationConfigSchema.extend({
  lastSync: z
    .object({
      id: z.string(),
      domain: z.string(),
      dryRun: z.boolean(),
      status: z.string(),
      startedAt: iso,
      finishedAt: isoN,
    })
    .nullable(),
  deliveries: z.object({ queued: count, failed: count, sent: count }).nullable(),
});
export type IntegrationOverviewItem = z.infer<typeof integrationOverviewItemSchema>;

export const integrationsOverviewSchema = z.object({
  integrations: z.array(integrationOverviewItemSchema),
  notificationChannels: z
    .object({
      email: z.object({ enabled: z.boolean() }),
      whatsapp: z.object({ enabled: z.boolean() }),
      sms: z.object({ enabled: z.boolean() }),
    })
    .nullable(),
  canManage: z.boolean(),
  canTest: z.boolean(),
  canSync: z.boolean(),
});
export type IntegrationsOverview = z.infer<typeof integrationsOverviewSchema>;

export const healthCheckSchema = z.object({
  id: z.coerce.number(),
  status: z.enum(['connected', 'failed']),
  code: z.string(),
  message: z.string().nullable(),
  latencyMs: z.number().nullable(),
  checkedAt: iso,
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const DELIVERY_STATUSES = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'skipped',
  'disabled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const deliverySchema = z.object({
  id: z.coerce.number(),
  channel: z.enum(['email', 'whatsapp', 'sms']),
  status: z.enum(DELIVERY_STATUSES),
  provider: z.string().nullable(),
  attempts: z.number().int(),
  errorCode: z.string().nullable(),
  externalRef: z.string().nullable(),
  lastAttemptAt: isoN,
  nextRetryAt: isoN,
  createdAt: iso,
  templateKey: z.string().nullable(),
  category: z.string(),
  reference: z.string().nullable(),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const webhookEventSchema = z.object({
  id: z.coerce.number(),
  providerEventId: z.string(),
  eventType: z.string().nullable(),
  signatureValid: z.boolean(),
  status: z.enum(['accepted', 'rejected']),
  receivedAt: iso,
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const storefrontIntegrationsSchema = z.object({
  analytics: z.object({ provider: z.literal('ga4'), measurementId: z.string() }).nullable(),
  socialAuth: z.object({ google: z.boolean(), apple: z.boolean() }),
});
export type StorefrontIntegrations = z.infer<typeof storefrontIntegrationsSchema>;

export const integrationFeaturesSchema = z.record(
  z.string(),
  z.object({ provider: z.string().nullable() }),
);
export type IntegrationFeatures = z.infer<typeof integrationFeaturesSchema>;
