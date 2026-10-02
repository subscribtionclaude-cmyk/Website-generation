import type { AdminResult } from '@/domain/admin/schemas';
import type { HealthResult, PublicContentInput } from '@/domain/integrations/adapters';
import type { SaveIntegrationInput } from '@/domain/integrations/demoIntegrations';
import type {
  Delivery,
  HealthCheck,
  IntegrationConfig,
  IntegrationFeatures,
  IntegrationsOverview,
  StorefrontIntegrations,
  SyncJob,
  SyncJobDetail,
  WebhookEvent,
} from '@/domain/integrations/schemas';

export type { SaveIntegrationInput };

/**
 * Phase 09 integrations port. Live: SECURITY DEFINER RPCs (configuration, logs, permissions,
 * audit) + the `integrations` Edge Function for anything that needs a provider secret (Test
 * connection, sync, dispatch). Demo: the in-browser engine with deterministic MOCK providers.
 */
export interface IntegrationsRepository {
  readonly mode: 'demo' | 'live';
  overview(): Promise<IntegrationsOverview>;
  save(input: SaveIntegrationInput): Promise<AdminResult<{ integration: IntegrationConfig }>>;
  setEnabled(
    key: string,
    enabled: boolean,
    reason: string | null,
  ): Promise<AdminResult<{ integration: IntegrationConfig }>>;
  remove(key: string): Promise<AdminResult<{ integration: IntegrationConfig }>>;
  /** Runs the provider's health check (server runtime, browser for keyless checks, or MOCK). */
  testConnection(key: string): Promise<AdminResult<{ health: HealthResult; mock: boolean }>>;
  checks(key: string, limit?: number): Promise<HealthCheck[]>;
  /** Dry run or applied import; returns the finished job (or the duplicate of a repeated click). */
  startSync(
    key: string,
    domain: string,
    dryRun: boolean,
    idempotencyKey: string,
  ): Promise<AdminResult<{ jobId: string; job: SyncJobDetail | null }>>;
  cancelSync(jobId: string): Promise<AdminResult>;
  syncJobs(key: string, limit?: number): Promise<SyncJob[]>;
  syncJob(jobId: string): Promise<SyncJobDetail | null>;
  deliveries(filter?: {
    channel?: string | null;
    status?: string | null;
    limit?: number;
  }): Promise<Delivery[]>;
  retryDelivery(id: number): Promise<AdminResult>;
  /** Send due deliveries for one channel now (otherwise a scheduler calls the server runtime). */
  dispatch(
    channel: string,
  ): Promise<AdminResult<{ sent: number; failed: number; skipped: number }>>;
  webhookEvents(key: string, limit?: number): Promise<WebhookEvent[]>;
  /** Integration-driven staff features (e.g. AI suggestions) — enabled providers only. */
  features(): Promise<IntegrationFeatures>;
  /** Public storefront flags: analytics measurement ID (when enabled) and social sign-in buttons. */
  storefront(): Promise<StorefrontIntegrations>;
  /** AI draft for the editor (never published automatically). */
  suggestContent(input: PublicContentInput): Promise<AdminResult<{ draft: string; mock: boolean }>>;
}
