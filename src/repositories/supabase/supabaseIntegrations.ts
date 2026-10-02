import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { SupabaseConfig } from '@/config/env';
import { adminProblemSchema, type AdminResult } from '@/domain/admin/schemas';
import type { HealthResult } from '@/domain/integrations/adapters';
import { integrationSpec, isIntegrationKey } from '@/domain/integrations/catalog';
import {
  checkGoogleAnalytics,
  checkSocialAuth,
} from '@/domain/integrations/providers/clientChecks';
import {
  deliverySchema,
  healthCheckSchema,
  HEALTH_CODES,
  integrationConfigSchema,
  integrationFeaturesSchema,
  integrationsOverviewSchema,
  storefrontIntegrationsSchema,
  syncJobDetailSchema,
  syncJobSchema,
  webhookEventSchema,
} from '@/domain/integrations/schemas';
import type { IntegrationsRepository, SaveIntegrationInput } from '../integrationsTypes';
import { RepositoryError } from './errors';
import { rpc } from './rpc';

const result = <T extends z.ZodRawShape>(shape: T) =>
  z.union([z.object({ ok: z.literal(true), ...shape }), adminProblemSchema]);
const configResult = result({ integration: integrationConfigSchema });
const plainResult = result({});
const startResult = result({ jobId: z.string(), duplicate: z.boolean(), status: z.string() });
const healthSchema = z.object({
  ok: z.boolean(),
  code: z.enum(HEALTH_CODES),
  message: z.string().nullable(),
  latencyMs: z.number().nullable(),
});
const testResponse = z.object({ ok: z.literal(true), health: healthSchema }).loose();
const dispatchResponse = z
  .object({
    ok: z.boolean(),
    sent: z.number().optional(),
    failed: z.number().optional(),
    skipped: z.number().optional(),
    code: z.string().optional(),
  })
  .loose();

/**
 * Integrations port over the SECURITY DEFINER RPCs in 20261003100000_integrations.sql (the database
 * checks integrations.* permissions, validates configuration, refuses secrets and writes the audit
 * log) and the `integrations` Edge Function, which holds provider secrets server-side. When the
 * function is not deployed, server actions report `runtime_unavailable` — the manual fallbacks keep
 * working and nothing pretends to be connected.
 */
export class SupabaseIntegrationsRepository implements IntegrationsRepository {
  readonly mode = 'live' as const;
  private readonly client: SupabaseClient;
  private readonly supabase: SupabaseConfig | null;

  constructor(client: SupabaseClient, supabase: SupabaseConfig | null) {
    this.client = client;
    this.supabase = supabase;
  }

  /** Invoke the server runtime; never throws for "not deployed" — returns a safe code instead. */
  private async invoke<T>(
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
    const { data, error } = await this.client.functions.invoke('integrations', { body });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 403 || status === 401)
        throw new RepositoryError('forbidden', error, 'forbidden');
      return { ok: false, code: 'runtime_unavailable' };
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const code = (data as { code?: unknown } | null)?.code;
      return { ok: false, code: typeof code === 'string' ? code : 'invalid_response' };
    }
    return { ok: true, data: parsed.data };
  }

  overview() {
    return rpc(this.client, 'admin_integrations_overview', {}, integrationsOverviewSchema);
  }
  save(input: SaveIntegrationInput) {
    return rpc(
      this.client,
      'admin_save_integration',
      {
        p_key: input.key,
        p_provider: input.provider,
        p_settings: input.settings,
        p_ownership: input.ownership,
        p_direction: input.direction,
        p_template_map: input.templateMap,
        p_expected_updated_at: input.expectedUpdatedAt,
      },
      configResult,
    );
  }
  setEnabled(key: string, enabled: boolean, reason: string | null) {
    return rpc(
      this.client,
      'admin_set_integration_enabled',
      { p_key: key, p_enabled: enabled, p_reason: reason },
      configResult,
    );
  }
  remove(key: string) {
    return rpc(this.client, 'admin_remove_integration', { p_key: key }, configResult);
  }

  async testConnection(key: string): Promise<AdminResult<{ health: HealthResult; mock: boolean }>> {
    if (!isIntegrationKey(key)) return { ok: false, code: 'unknown_integration' };
    if (integrationSpec(key).check === 'client') {
      const overview = await this.overview();
      const config = overview.integrations.find((i) => i.key === key);
      const health =
        key === 'google_analytics'
          ? checkGoogleAnalytics(config?.settings.measurementId)
          : await checkSocialAuth({
              fetch: (input, init) => fetch(input, init),
              supabaseUrl: this.supabase?.url ?? null,
              anonKey: this.supabase?.anonKey ?? null,
              wanted: {
                google: config?.settings.google === true,
                apple: config?.settings.apple === true,
              },
            });
      const recorded = await rpc(
        this.client,
        'admin_record_client_check',
        {
          p_key: key,
          p_status: health.ok ? 'connected' : 'failed',
          p_code: health.code,
          p_message: health.message,
          p_latency: health.latencyMs === null ? null : Math.round(health.latencyMs),
        },
        plainResult,
      );
      if (!recorded.ok) return recorded;
      return { ok: true, health, mock: false };
    }
    const outcome = await this.invoke({ action: 'test', key }, testResponse);
    if (!outcome.ok) return { ok: false, code: outcome.code };
    return { ok: true, health: outcome.data.health, mock: false };
  }

  checks(key: string, limit = 20) {
    return rpc(
      this.client,
      'admin_list_integration_checks',
      { p_key: key, p_limit: limit },
      z.array(healthCheckSchema),
    );
  }

  async startSync(key: string, domain: string, dryRun: boolean, idempotencyKey: string) {
    const started = await rpc(
      this.client,
      'admin_start_integration_sync',
      { p_key: key, p_domain: domain, p_dry_run: dryRun, p_idempotency_key: idempotencyKey },
      startResult,
    );
    if (!started.ok) return started;
    if (!started.duplicate) {
      const run = await this.invoke({ action: 'sync', jobId: started.jobId }, z.unknown());
      if (!run.ok && run.code === 'runtime_unavailable') {
        // Do not leave a "running" job behind when the server runtime is missing.
        await rpc(
          this.client,
          'admin_cancel_integration_sync',
          { p_job_id: started.jobId },
          plainResult,
        );
        return { ok: false as const, code: 'runtime_unavailable' };
      }
    }
    return { ok: true as const, jobId: started.jobId, job: await this.syncJob(started.jobId) };
  }
  cancelSync(jobId: string) {
    return rpc(this.client, 'admin_cancel_integration_sync', { p_job_id: jobId }, plainResult);
  }
  syncJobs(key: string, limit = 20) {
    return rpc(
      this.client,
      'admin_list_sync_jobs',
      { p_key: key, p_limit: limit },
      z.array(syncJobSchema),
    );
  }
  syncJob(jobId: string) {
    return rpc(
      this.client,
      'admin_get_sync_job',
      { p_job_id: jobId },
      syncJobDetailSchema.nullable(),
    );
  }
  deliveries(filter: { channel?: string | null; status?: string | null; limit?: number } = {}) {
    return rpc(
      this.client,
      'admin_list_deliveries',
      {
        p_channel: filter.channel ?? null,
        p_status: filter.status ?? null,
        p_limit: filter.limit ?? 50,
      },
      z.array(deliverySchema),
    );
  }
  retryDelivery(id: number) {
    return rpc(this.client, 'admin_retry_delivery', { p_id: id }, plainResult);
  }
  async dispatch(channel: string) {
    const outcome = await this.invoke({ action: 'dispatch', channel }, dispatchResponse);
    if (!outcome.ok) return { ok: false as const, code: outcome.code };
    if (!outcome.data.ok)
      return { ok: false as const, code: outcome.data.code ?? 'provider_error' };
    return {
      ok: true as const,
      sent: outcome.data.sent ?? 0,
      failed: outcome.data.failed ?? 0,
      skipped: outcome.data.skipped ?? 0,
    };
  }
  webhookEvents(key: string, limit = 20) {
    return rpc(
      this.client,
      'admin_list_webhook_events',
      { p_key: key, p_limit: limit },
      z.array(webhookEventSchema),
    );
  }
  features() {
    return rpc(this.client, 'admin_integration_features', {}, integrationFeaturesSchema);
  }
  storefront() {
    return rpc(this.client, 'storefront_integrations', {}, storefrontIntegrationsSchema);
  }
  /** No live AI adapter ships in this build (contract only): the editor keeps manual writing. */
  async suggestContent(): Promise<AdminResult<{ draft: string; mock: boolean }>> {
    return { ok: false, code: 'unsupported' };
  }
}
