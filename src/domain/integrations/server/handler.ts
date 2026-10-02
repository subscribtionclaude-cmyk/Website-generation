import type { FetchLike } from '../http.ts';
import { redact } from '../http.ts';
import { parseWhatsappStatuses, WHATSAPP_SECRET_NAMES } from '../providers/whatsappCloud.ts';
import { safeEqual, verifyWebhook } from '../webhook.ts';
import {
  createServerAdapter,
  isErpProvider,
  isNotificationProvider,
  type EnvReader,
  type RuntimeConfig,
} from './runtime.ts';

/**
 * Request handlers behind the two Edge Functions (supabase/functions/integrations and
 * supabase/functions/integration-webhook). Pure and dependency-injected so they are unit-tested in
 * Node with fake clients; the Deno entry points only wire Deno.env, fetch and supabase-js.
 *
 *  - `user` is a client carrying the CALLER's JWT: the database decides who may act
 *    (admin_integration_authorize, admin_get_sync_job).
 *  - `service` is the service-role client used only after that check, for the service-only RPCs.
 * Responses never contain secrets, stack traces or raw provider bodies.
 */
export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface HandlerDeps {
  user: RpcClient | null;
  service: RpcClient;
  env: EnvReader;
  fetch: FetchLike;
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown> | string;
}

const json = (status: number, body: Record<string, unknown>): HandlerResponse => ({ status, body });
const CHANNELS = ['whatsapp', 'sms', 'email'] as const;
const KEY = /^[a-z_]{2,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(deps: HandlerDeps, action: 'test' | 'sync' | 'dispatch') {
  if (!deps.user) return null;
  const { data, error } = await deps.user.rpc('admin_integration_authorize', { p_action: action });
  const result = data as { ok?: boolean; actorId?: string } | null;
  if (error || !result?.ok || typeof result.actorId !== 'string') return null;
  return result.actorId;
}

async function runtimeConfig(deps: HandlerDeps, key: string): Promise<RuntimeConfig | null> {
  const { data, error } = await deps.service.rpc('integration_runtime_config', { p_key: key });
  if (error || !data || typeof data !== 'object') return null;
  return data as RuntimeConfig;
}

export async function handleIntegrationAction(
  input: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> {
  const body = (input ?? {}) as {
    action?: unknown;
    key?: unknown;
    jobId?: unknown;
    channel?: unknown;
  };
  const action = body.action;
  if (action !== 'test' && action !== 'sync' && action !== 'dispatch')
    return json(400, { ok: false, code: 'invalid_action' });
  const actor = await authorize(deps, action);
  if (!actor) return json(403, { ok: false, code: 'forbidden' });

  if (action === 'test') {
    const key = typeof body.key === 'string' && KEY.test(body.key) ? body.key : null;
    if (!key) return json(400, { ok: false, code: 'invalid_request' });
    const config = await runtimeConfig(deps, key);
    if (!config) return json(404, { ok: false, code: 'unknown_integration' });
    const built = createServerAdapter(config, deps.env, deps.fetch);
    const health = built.ok ? await built.adapter.testConnection() : built.health;
    const message = built.ok ? redact(health.message, built.secrets) : health.message;
    const { data, error } = await deps.service.rpc('integration_record_check', {
      p_key: key,
      p_status: health.ok ? 'connected' : 'failed',
      p_code: health.code,
      p_message: message,
      p_latency: health.latencyMs === null ? null : Math.round(health.latencyMs),
      p_actor: actor,
    });
    if (error) return json(500, { ok: false, code: 'record_failed' });
    return json(200, { ok: true, health: { ...health, message }, result: data });
  }

  if (action === 'sync') {
    const jobId = typeof body.jobId === 'string' && UUID.test(body.jobId) ? body.jobId : null;
    if (!jobId || !deps.user) return json(400, { ok: false, code: 'invalid_request' });
    const { data: jobData, error: jobError } = await deps.user.rpc('admin_get_sync_job', {
      p_job_id: jobId,
    });
    const job = jobData as { key?: string; domain?: string; status?: string } | null;
    if (jobError || !job?.key || !job.domain)
      return json(404, { ok: false, code: 'job_not_found' });
    if (job.status !== 'running') return json(409, { ok: false, code: 'job_not_running' });
    const config = await runtimeConfig(deps, job.key);
    const built = config ? createServerAdapter(config, deps.env, deps.fetch) : null;
    const failSync = async (code: string, summary: string | null) => {
      await deps.service.rpc('integration_fail_sync', {
        p_job_id: jobId,
        p_code: code,
        p_summary: summary,
      });
      return json(200, { ok: false, code });
    };
    if (!built) return failSync('unknown_integration', null);
    if (!built.ok) return failSync(built.health.code, built.health.message);
    if (!isErpProvider(built.adapter)) return failSync('unsupported', 'sync_not_supported');
    const records = await built.adapter.fetchRecords(
      job.domain as 'products' | 'prices' | 'stock' | 'customers',
    );
    if (!records.ok) return failSync(records.code, redact(records.message, built.secrets));
    const { data, error } = await deps.service.rpc('integration_record_sync_result', {
      p_job_id: jobId,
      p_records: records.value,
    });
    if (error) return failSync('record_failed', null);
    return json(200, { ok: true, result: data });
  }

  // dispatch: send due deliveries for one channel through its enabled provider.
  const channel = CHANNELS.find((c) => c === body.channel);
  if (!channel) return json(400, { ok: false, code: 'invalid_request' });
  return dispatchChannel(deps, channel);
}

interface ClaimedDelivery {
  id: number;
  idempotencyKey: string;
  locale: 'ar' | 'en';
  title: string | null;
  body: string | null;
  providerTemplate: string | null;
  to: string | null;
}

export async function dispatchChannel(
  deps: HandlerDeps,
  channel: (typeof CHANNELS)[number],
): Promise<HandlerResponse> {
  const config = await runtimeConfig(deps, channel);
  if (!config?.enabled)
    return json(200, { ok: true, sent: 0, failed: 0, skipped: 0, code: 'provider_disabled' });
  const built = createServerAdapter(config, deps.env, deps.fetch);
  if (!built.ok)
    return json(200, { ok: false, code: built.health.code, message: built.health.message });
  if (!isNotificationProvider(built.adapter)) return json(200, { ok: false, code: 'unsupported' });
  const { data, error } = await deps.service.rpc('integration_claim_deliveries', {
    p_channel: channel,
    p_limit: 20,
  });
  if (error) return json(500, { ok: false, code: 'claim_failed' });
  const claimed = (Array.isArray(data) ? data : []) as ClaimedDelivery[];
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const delivery of claimed) {
    if (!delivery.to || !delivery.body) {
      counts.skipped += 1;
      await deps.service.rpc('integration_record_delivery', {
        p_id: delivery.id,
        p_status: 'skipped',
        p_error_code: 'no_recipient',
      });
      continue;
    }
    const result = await built.adapter.send({
      idempotencyKey: delivery.idempotencyKey,
      to: delivery.to,
      locale: delivery.locale === 'en' ? 'en' : 'ar',
      title: delivery.title ?? '',
      body: delivery.body,
      providerTemplate: delivery.providerTemplate,
    });
    if (result.ok) counts.sent += 1;
    else counts.failed += 1;
    await deps.service.rpc('integration_record_delivery', {
      p_id: delivery.id,
      p_status: result.ok ? 'sent' : 'failed',
      p_error_code: result.ok ? null : result.code,
      p_external_ref: result.ok ? result.value.externalRef : null,
    });
  }
  return json(200, { ok: true, ...counts });
}

/** Meta webhook: GET verification handshake, POST signed delivery receipts. */
export async function handleWhatsappWebhook(
  request: {
    method: string;
    url: string;
    headers: { get(name: string): string | null };
    body: string;
  },
  deps: Pick<HandlerDeps, 'service' | 'env'>,
): Promise<HandlerResponse> {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const expected = deps.env(WHATSAPP_SECRET_NAMES.verifyToken);
    const given = params.get('hub.verify_token') ?? '';
    if (params.get('hub.mode') === 'subscribe' && expected && safeEqual(given, expected))
      return { status: 200, body: (params.get('hub.challenge') ?? '').slice(0, 200) };
    return { status: 403, body: 'forbidden' };
  }
  if (request.method !== 'POST') return { status: 405, body: 'method_not_allowed' };
  if (request.body.length > 256_000) return { status: 413, body: 'too_large' };

  const verification = await verifyWebhook({
    secret: deps.env(WHATSAPP_SECRET_NAMES.webhookSecret),
    body: request.body,
    signature: request.headers.get('x-hub-signature-256'),
  });
  if (!verification.ok) {
    // Rejected requests are logged (reason only, never the body) so the owner can spot a
    // misconfigured secret; nothing in them is processed.
    await deps.service.rpc('integration_record_webhook', {
      p_key: 'whatsapp',
      p_provider_event_id: `rejected:${crypto.randomUUID()}`,
      p_event_type: verification.reason,
      p_signature_valid: false,
    });
    return { status: 401, body: 'invalid_signature' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return { status: 400, body: 'invalid_json' };
  }
  let applied = 0;
  let duplicates = 0;
  for (const event of parseWhatsappStatuses(payload)) {
    const { data } = await deps.service.rpc('integration_record_webhook', {
      p_key: 'whatsapp',
      p_provider_event_id: event.eventId,
      p_event_type: `status.${event.status}`,
      p_signature_valid: true,
    });
    const recorded = data as { accepted?: boolean; duplicate?: boolean } | null;
    if (recorded?.duplicate) {
      duplicates += 1;
      continue;
    }
    if (recorded?.accepted && event.status !== 'sent') {
      await deps.service.rpc('integration_record_delivery_status', {
        p_channel: 'whatsapp',
        p_external_ref: event.externalRef,
        p_status: event.status,
      });
      applied += 1;
    }
  }
  // Always 200 after a valid signature so the provider does not retry processed events.
  return { status: 200, body: { ok: true, applied, duplicates } };
}
