import type { PermissionKey } from '@/domain/access/permissions';
import type { AdminResult } from '@/domain/admin/schemas';
import { NOTIFICATION_TEMPLATES } from '@/domain/customer/templates';
import type { ExternalRecord, HealthResult, PublicContentInput } from './adapters';
import {
  configComplete,
  INTEGRATION_KEYS,
  integrationSpec,
  isIntegrationKey,
  isSecretLike,
  validateSettings,
  type IntegrationKey,
  type Ownership,
  type SettingsValue,
  type SyncDomain,
} from './catalog';
import { nextCircuit } from './http';
import { isMockScenario, mockAdapter, mockAiProvider, type MockScenario } from './mock';
import { checkGoogleAnalytics } from './providers/clientChecks';
import type {
  Delivery,
  HealthCheck,
  IntegrationConfig,
  IntegrationFeatures,
  IntegrationsOverview,
  StorefrontIntegrations,
  SyncItem,
  SyncJob,
  SyncJobDetail,
  WebhookEvent,
} from './schemas';
import { jobStatus, planRecord, summarize, type LocalVariant, type Mapping } from './sync';

/**
 * DEMO MODE ONLY — the Phase 09 integration RPCs mirrored in this browser. Every provider here is a
 * deterministic MOCK (no network, no credentials): results are labelled DEMO / MOCK and are never
 * presented as a real connection. Live mode never constructs this class.
 */
export interface DemoIntegrationsActor {
  userId: string | null;
  name: string | null;
  can(permission: PermissionKey): boolean;
}

interface StoredConfig {
  provider: string | null;
  enabled: boolean;
  settings: SettingsValue;
  ownership: Record<string, Ownership>;
  direction: 'import' | 'export';
  templateMap: Record<string, string>;
  lastCheckAt: string | null;
  lastCheckStatus: 'connected' | 'failed' | null;
  lastCheckCode: string | null;
  lastCheckMessage: string | null;
  lastCheckLatencyMs: number | null;
  lastOkAt: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastSyncAt: string | null;
  updatedAt: string;
  mockScenario: MockScenario;
}

interface StoredJob extends SyncJobDetail {
  idempotencyKey: string;
}

export interface DemoIntegrationsState {
  version: 1;
  seq: number;
  configs: Record<string, StoredConfig>;
  checks: (HealthCheck & { key: string })[];
  jobs: StoredJob[];
  mappings: (Mapping & { key: string })[];
}

export interface DemoIntegrationsOptions {
  storage: { load(): DemoIntegrationsState | null; save(state: DemoIntegrationsState): void };
  audit(
    actor: DemoIntegrationsActor,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata: unknown,
  ): void;
  notificationChannels(): IntegrationsOverview['notificationChannels'];
  variants(): LocalVariant[];
  customers(): { id: string; email: string }[];
  applyChange(
    actor: DemoIntegrationsActor,
    change: {
      domain: 'prices' | 'stock';
      variantId: string;
      after: number;
      compareAt?: number | null;
      key: string;
      jobId: string;
    },
  ): { ok: true } | { ok: false; code: string };
  now?: () => Date;
  uuid?: () => string;
}

export class DemoIntegrationsForbidden extends Error {
  readonly code = '42501';
}

const MESSAGING: readonly string[] = ['email', 'whatsapp', 'sms'];
const MAX_CHECKS = 200;
const MAX_JOBS = 60;
const INITIAL_UPDATED_AT = '2026-01-01T00:00:00.000Z';

const emptyConfig = (): StoredConfig => ({
  provider: null,
  enabled: false,
  settings: {},
  ownership: {},
  direction: 'import',
  templateMap: {},
  lastCheckAt: null,
  lastCheckStatus: null,
  lastCheckCode: null,
  lastCheckMessage: null,
  lastCheckLatencyMs: null,
  lastOkAt: null,
  consecutiveFailures: 0,
  circuitOpenUntil: null,
  lastSyncAt: null,
  updatedAt: INITIAL_UPDATED_AT,
  mockScenario: 'success',
});

export const emptyDemoIntegrationsState = (): DemoIntegrationsState => ({
  version: 1,
  seq: 0,
  configs: {},
  checks: [],
  jobs: [],
  mappings: [],
});

export interface SaveIntegrationInput {
  key: string;
  provider: string | null;
  settings: SettingsValue;
  ownership: Record<string, string>;
  direction: string;
  templateMap: Record<string, string>;
  expectedUpdatedAt: string | null;
  /** Demo only: how the MOCK provider behaves (success, auth failure, timeout…). */
  mockScenario?: string;
}

export class DemoIntegrations {
  private readonly options: DemoIntegrationsOptions;
  private readonly state: DemoIntegrationsState;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private lastStamp = 0;

  constructor(options: DemoIntegrationsOptions) {
    this.options = options;
    this.state = options.storage.load() ?? emptyDemoIntegrationsState();
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private stamp() {
    this.lastStamp = Math.max(this.now().getTime(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }
  private persist() {
    this.options.storage.save(this.state);
  }
  private require(actor: DemoIntegrationsActor, ...permissions: PermissionKey[]) {
    if (!actor.userId || !permissions.some((p) => actor.can(p)))
      throw new DemoIntegrationsForbidden('forbidden');
  }
  private config(key: string): StoredConfig {
    const existing = this.state.configs[key];
    if (existing) return existing;
    const created = emptyConfig();
    this.state.configs[key] = created;
    return created;
  }
  private complete(key: IntegrationKey, c: StoredConfig) {
    return configComplete(key, c.provider, c.settings);
  }
  private circuitOpen(c: StoredConfig) {
    return c.circuitOpenUntil !== null && new Date(c.circuitOpenUntil) > this.now();
  }
  private json(key: IntegrationKey): IntegrationConfig {
    const c = this.config(key);
    return {
      key,
      provider: c.provider,
      enabled: c.enabled,
      settings: c.settings,
      ownership: c.ownership,
      direction: c.direction,
      templateMap: c.templateMap,
      complete: this.complete(key, c),
      lastCheckAt: c.lastCheckAt,
      lastCheckStatus: c.lastCheckStatus,
      lastCheckCode: c.lastCheckCode,
      lastCheckMessage: c.lastCheckMessage,
      lastCheckLatencyMs: c.lastCheckLatencyMs,
      lastOkAt: c.lastOkAt,
      consecutiveFailures: c.consecutiveFailures,
      circuitOpenUntil: c.circuitOpenUntil,
      lastSyncAt: c.lastSyncAt,
      updatedAt: c.updatedAt,
      mockScenario: c.mockScenario,
    };
  }
  private auditable(c: StoredConfig) {
    return {
      provider: c.provider,
      settings: c.settings,
      ownership: c.ownership,
      direction: c.direction,
      templateMap: c.templateMap,
    };
  }

  // ── overview & configuration ─────────────────────────────────────────────
  overview(actor: DemoIntegrationsActor): IntegrationsOverview {
    this.require(actor, 'integrations.view');
    const keys = this.keys();
    return {
      integrations: keys.map((key) => {
        const last = this.state.jobs.find((j) => j.key === key) ?? null;
        return {
          ...this.json(key),
          lastSync: last
            ? {
                id: last.id,
                domain: last.domain,
                dryRun: last.dryRun,
                status: last.status,
                startedAt: last.startedAt,
                finishedAt: last.finishedAt,
              }
            : null,
          // Demo notifications are demo data: they are never queued for external channels.
          deliveries: MESSAGING.includes(key) ? { queued: 0, failed: 0, sent: 0 } : null,
        };
      }),
      notificationChannels: this.options.notificationChannels(),
      canManage: actor.can('integrations.manage'),
      canTest: actor.can('integrations.test'),
      canSync: actor.can('integrations.sync'),
    };
  }

  private keys(): IntegrationKey[] {
    return [...INTEGRATION_KEYS].sort();
  }

  save(
    actor: DemoIntegrationsActor,
    input: SaveIntegrationInput,
  ): AdminResult<{ integration: IntegrationConfig }> {
    this.require(actor, 'integrations.manage');
    if (!isIntegrationKey(input.key)) return { ok: false, code: 'unknown_integration' };
    const key = input.key;
    const spec = integrationSpec(key);
    const before = this.config(key);
    if (input.expectedUpdatedAt !== null && before.updatedAt !== input.expectedUpdatedAt)
      return { ok: false, code: 'stale' };
    if (!input.provider || !spec.providers.some((p) => p.key === input.provider))
      return { ok: false, code: 'invalid_provider', field: 'provider' };
    for (const [name, value] of Object.entries(input.settings)) {
      if (!spec.settings.some((f) => f.key === name))
        return { ok: false, code: 'unknown_setting', field: name };
      if (isSecretLike(name, value)) return { ok: false, code: 'secret_not_allowed', field: name };
    }
    const invalid = validateSettings(key, input.settings).find((p) => p.code === 'invalid_setting');
    if (invalid) return { ok: false, code: 'invalid_setting', field: invalid.field };
    for (const [domain, owner] of Object.entries(input.ownership)) {
      if (
        !(spec.syncDomains as string[]).includes(domain) ||
        !['malek', 'external', 'external_wins'].includes(owner)
      )
        return { ok: false, code: 'invalid_ownership', field: domain };
    }
    if (input.direction === 'two_way') return { ok: false, code: 'two_way_unsupported' };
    if (input.direction !== 'import' && input.direction !== 'export')
      return { ok: false, code: 'invalid_direction' };
    for (const [event, template] of Object.entries(input.templateMap)) {
      if (
        !spec.channel ||
        !NOTIFICATION_TEMPLATES[event] ||
        !/^[A-Za-z0-9_.:-]{1,100}$/.test(template)
      )
        return { ok: false, code: 'invalid_template_map', field: event };
    }
    const snapshot = this.auditable(before);
    const providerChanged = before.provider !== input.provider;
    const next: StoredConfig = {
      ...before,
      provider: input.provider,
      settings: { ...input.settings },
      ownership: input.ownership as Record<string, Ownership>,
      direction: input.direction,
      templateMap: { ...input.templateMap },
      updatedAt: this.stamp(),
      mockScenario: isMockScenario(input.mockScenario) ? input.mockScenario : before.mockScenario,
    };
    if (providerChanged) {
      Object.assign(next, {
        enabled: false,
        lastCheckAt: null,
        lastCheckStatus: null,
        lastCheckCode: null,
        lastCheckMessage: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
      });
    }
    if (next.enabled && !configComplete(key, next.provider, next.settings)) next.enabled = false;
    this.state.configs[key] = next;
    this.options.audit(
      actor,
      providerChanged && before.provider !== null
        ? 'integration.provider_changed'
        : 'integration.configured',
      'public.integration_configs',
      key,
      snapshot,
      this.auditable(next),
      {},
    );
    this.persist();
    return { ok: true, integration: this.json(key) };
  }

  setEnabled(
    actor: DemoIntegrationsActor,
    key: string,
    enabled: boolean,
    reason: string | null,
  ): AdminResult<{ integration: IntegrationConfig; skippedDeliveries: number }> {
    this.require(actor, 'integrations.manage');
    if (!isIntegrationKey(key)) return { ok: false, code: 'unknown_integration' };
    const c = this.config(key);
    if (enabled && !this.complete(key, c)) return { ok: false, code: 'not_configured' };
    if (c.enabled === enabled) return { ok: false, code: 'no_change' };
    c.enabled = enabled;
    c.updatedAt = this.stamp();
    this.options.audit(
      actor,
      enabled ? 'integration.enabled' : 'integration.disabled',
      'public.integration_configs',
      key,
      { enabled: !enabled },
      { enabled },
      { reason: reason?.trim().slice(0, 300) || null, skippedDeliveries: 0 },
    );
    this.persist();
    return { ok: true, integration: this.json(key), skippedDeliveries: 0 };
  }

  remove(
    actor: DemoIntegrationsActor,
    key: string,
  ): AdminResult<{ integration: IntegrationConfig }> {
    this.require(actor, 'integrations.manage');
    if (!isIntegrationKey(key)) return { ok: false, code: 'unknown_integration' };
    const before = this.config(key);
    this.state.configs[key] = {
      ...emptyConfig(),
      lastOkAt: before.lastOkAt,
      lastSyncAt: before.lastSyncAt,
      updatedAt: this.stamp(),
    };
    this.options.audit(
      actor,
      'integration.removed',
      'public.integration_configs',
      key,
      { provider: before.provider, settings: before.settings },
      null,
      {},
    );
    this.persist();
    return { ok: true, integration: this.json(key) };
  }

  // ── health ────────────────────────────────────────────────────────────────
  async test(
    actor: DemoIntegrationsActor,
    key: string,
  ): Promise<AdminResult<{ health: HealthResult; mock: boolean; integration: IntegrationConfig }>> {
    this.require(actor, 'integrations.test');
    if (!isIntegrationKey(key)) return { ok: false, code: 'unknown_integration' };
    const c = this.config(key);
    let health: HealthResult;
    if (!c.provider) {
      health = { ok: false, code: 'config_incomplete', message: 'no_provider', latencyMs: null };
    } else if (key === 'google_analytics') {
      // A real (offline) check: Google offers no keyless connection test.
      health = checkGoogleAnalytics(c.settings.measurementId);
    } else {
      health = await mockAdapter(key, c.mockScenario).testConnection();
    }
    this.storeCheck(actor, key, health);
    return { ok: true, health, mock: key !== 'google_analytics', integration: this.json(key) };
  }

  private storeCheck(actor: DemoIntegrationsActor, key: IntegrationKey, health: HealthResult) {
    const c = this.config(key);
    const at = this.stamp();
    const status = health.ok ? 'connected' : 'failed';
    this.state.seq += 1;
    this.state.checks.unshift({
      id: this.state.seq,
      key,
      status,
      code: health.code,
      message: health.message,
      latencyMs: health.latencyMs,
      checkedAt: at,
    });
    this.state.checks = this.state.checks.slice(0, MAX_CHECKS);
    const circuit = nextCircuit(c, health.ok, this.now());
    Object.assign(c, {
      lastCheckAt: at,
      lastCheckStatus: status,
      lastCheckCode: health.code,
      lastCheckMessage: health.message,
      lastCheckLatencyMs: health.latencyMs,
      lastOkAt: health.ok ? at : c.lastOkAt,
      ...circuit,
    });
    this.options.audit(
      actor,
      'integration.tested',
      'public.integration_configs',
      key,
      null,
      { status, code: health.code },
      { latencyMs: health.latencyMs, mock: true },
    );
    this.persist();
  }

  checks(actor: DemoIntegrationsActor, key: string, limit = 20): HealthCheck[] {
    this.require(actor, 'integrations.view');
    return this.state.checks
      .filter((c) => c.key === key)
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map(({ key: _key, ...check }) => check);
  }

  // ── sync ──────────────────────────────────────────────────────────────────
  /** Deterministic MOCK external catalogue derived from the demo catalogue (matches by SKU). */
  private mockRecords(domain: SyncDomain): ExternalRecord[] {
    const variants = [...this.options.variants()]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .slice(0, 4);
    const stamp = this.now().toISOString();
    const round = (n: number) => Math.round(n / 10) * 10;
    const records: ExternalRecord[] = [];
    if (domain === 'customers') {
      for (const [i, c] of this.options.customers().slice(0, 3).entries())
        records.push({
          externalId: `MOCK-P${i + 1}`,
          email: c.email,
          name: c.email.split('@')[0],
          updatedAt: stamp,
        });
      records.push({
        externalId: 'MOCK-P99',
        email: 'new.customer@example.com',
        name: 'New customer',
        updatedAt: stamp,
      });
      return records;
    }
    variants.forEach((v, i) => {
      const externalId = `MOCK-${i + 1}`;
      if (domain === 'products')
        records.push({ externalId, sku: v.sku, name: v.sku, updatedAt: stamp });
      if (domain === 'prices') {
        const base = v.price ?? 1000;
        if (i === 0)
          records.push({ externalId, sku: v.sku, price: round(base * 1.05), updatedAt: stamp });
        if (i === 1) records.push({ externalId, sku: v.sku, price: v.price, updatedAt: stamp });
        // No timestamp: under "external" ownership this needs review (conflict).
        if (i === 2) records.push({ externalId, sku: v.sku, price: round(base * 0.95) });
        if (i === 3) records.push({ externalId, sku: v.sku, price: -1, updatedAt: stamp });
      }
      if (domain === 'stock') {
        if (i === 0) records.push({ externalId, sku: v.sku, stock: v.stock + 5, updatedAt: stamp });
        if (i === 1) records.push({ externalId, sku: v.sku, stock: v.stock, updatedAt: stamp });
        if (i === 2)
          records.push({
            externalId,
            sku: v.sku,
            stock: Math.max(v.reserved - 1, 0),
            updatedAt: stamp,
          });
        if (i === 3) records.push({ externalId, sku: v.sku, stock: 2.5, updatedAt: stamp });
      }
    });
    if (domain === 'products')
      records.push({
        externalId: 'MOCK-NEW-1',
        sku: 'MOCK-NEW-SKU',
        name: 'New external product',
        updatedAt: stamp,
      });
    else
      records.push({
        externalId: 'MOCK-404',
        sku: 'MOCK-UNKNOWN-SKU',
        price: 100,
        stock: 1,
        updatedAt: stamp,
      });
    return records;
  }

  startSync(
    actor: DemoIntegrationsActor,
    key: string,
    domain: string,
    dryRun: boolean,
    idempotencyKey: string,
  ): AdminResult<{ jobId: string; duplicate: boolean; job: SyncJobDetail }> {
    this.require(actor, 'integrations.sync');
    if (!isIntegrationKey(key) || !(integrationSpec(key).syncDomains as string[]).includes(domain))
      return { ok: false, code: 'sync_unsupported' };
    if (!idempotencyKey) return { ok: false, code: 'idempotency_required' };
    const existing = this.state.jobs.find(
      (j) => j.key === key && j.idempotencyKey === idempotencyKey,
    );
    if (existing) return { ok: true, jobId: existing.id, duplicate: true, job: existing };
    const c = this.config(key);
    if (!this.complete(key, c)) return { ok: false, code: 'not_configured' };
    if (!dryRun && !c.enabled) return { ok: false, code: 'not_enabled' };
    if (this.circuitOpen(c)) return { ok: false, code: 'circuit_open' };
    const syncDomain = domain as SyncDomain;
    const job: StoredJob = {
      id: this.uuid(),
      key,
      domain: syncDomain,
      direction: 'import',
      dryRun,
      status: 'running',
      inspected: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      conflicts: 0,
      errorCode: null,
      errorSummary: null,
      startedAt: this.stamp(),
      finishedAt: null,
      actorName: actor.name,
      items: [],
      idempotencyKey,
    };
    this.state.jobs.unshift(job);
    this.state.jobs = this.state.jobs.slice(0, MAX_JOBS);
    this.options.audit(
      actor,
      'integration.sync_started',
      'public.integration_sync_jobs',
      job.id,
      null,
      { key, domain, dryRun },
      {},
    );

    // MOCK provider fetch: the chosen scenario decides the outcome (no network).
    if (c.mockScenario !== 'success') {
      Object.assign(job, {
        status: 'failed',
        finishedAt: this.stamp(),
        errorCode: c.mockScenario,
        errorSummary: `MOCK: ${c.mockScenario.replace('_', ' ')}`,
      });
      this.options.audit(
        actor,
        'integration.sync_failed',
        'public.integration_sync_jobs',
        job.id,
        null,
        { key, status: 'failed', code: c.mockScenario },
        {},
      );
      this.persist();
      return { ok: true, jobId: job.id, duplicate: false, job };
    }

    const owner: Ownership =
      syncDomain === 'prices' || syncDomain === 'stock'
        ? (c.ownership[syncDomain] ?? 'malek')
        : 'external_wins';
    const variants = this.options.variants();
    const items: SyncItem[] = [];
    for (const [index, record] of this.mockRecords(syncDomain).entries()) {
      const mappings = this.state.mappings.filter((m) => m.key === key);
      let plan = planRecord(record, {
        domain: syncDomain,
        owner,
        variants,
        customers: this.options.customers(),
        mappings,
      });
      let applied = false;
      if (!dryRun) {
        if (
          plan.action === 'update' &&
          plan.localId &&
          (syncDomain === 'prices' || syncDomain === 'stock')
        ) {
          const after = Number(plan.detail?.after);
          const result = this.options.applyChange(actor, {
            domain: syncDomain,
            variantId: plan.localId,
            after,
            compareAt: syncDomain === 'prices' ? (record.compareAt ?? null) : undefined,
            key,
            jobId: job.id,
          });
          if (result.ok) {
            applied = true;
            this.link(key, plan.entity, plan.externalId, plan.localId, record.updatedAt ?? null);
          } else {
            plan = { ...plan, action: 'conflict', reason: result.code };
          }
        } else if (plan.action === 'link' || (plan.action === 'unchanged' && plan.link)) {
          if (plan.localId)
            this.link(key, plan.entity, plan.externalId, plan.localId, record.updatedAt ?? null);
          applied = plan.action === 'link';
        }
      }
      items.push({
        position: index + 1,
        externalId: plan.externalId,
        entity: plan.entity,
        localId: plan.localId,
        label: plan.label,
        action: plan.action,
        reason: plan.reason,
        applied,
        detail: plan.detail ?? {},
      });
    }
    const summary = summarize(items);
    const status = jobStatus(summary);
    Object.assign(job, { ...summary, status, finishedAt: this.stamp(), items });
    c.lastSyncAt = job.finishedAt;
    this.options.audit(
      actor,
      'integration.sync_completed',
      'public.integration_sync_jobs',
      job.id,
      null,
      { key, domain, dryRun, status },
      summary,
    );
    this.persist();
    return { ok: true, jobId: job.id, duplicate: false, job };
  }

  private link(
    key: string,
    entity: 'variant' | 'customer',
    externalId: string | null,
    localId: string,
    externalUpdatedAt: string | null,
  ) {
    if (!externalId) return;
    const at = this.stamp();
    const existing = this.state.mappings.find(
      (m) => m.key === key && m.entity === entity && m.externalId === externalId,
    );
    if (existing) {
      existing.syncedAt = at;
      existing.externalUpdatedAt = externalUpdatedAt ?? existing.externalUpdatedAt;
      return;
    }
    this.state.mappings.push({ key, entity, externalId, localId, externalUpdatedAt, syncedAt: at });
  }

  cancelSync(actor: DemoIntegrationsActor, jobId: string): AdminResult {
    this.require(actor, 'integrations.sync');
    const job = this.state.jobs.find((j) => j.id === jobId && j.status === 'running');
    if (!job) return { ok: false, code: 'job_not_running' };
    Object.assign(job, { status: 'cancelled', finishedAt: this.stamp(), errorCode: 'cancelled' });
    this.options.audit(
      actor,
      'integration.sync_failed',
      'public.integration_sync_jobs',
      job.id,
      null,
      { key: job.key, status: 'cancelled' },
      {},
    );
    this.persist();
    return { ok: true };
  }

  jobs(actor: DemoIntegrationsActor, key: string, limit = 20): SyncJob[] {
    this.require(actor, 'integrations.view');
    return this.state.jobs
      .filter((j) => j.key === key)
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map(({ items: _items, idempotencyKey: _idem, ...job }) => job);
  }

  job(actor: DemoIntegrationsActor, jobId: string): SyncJobDetail | null {
    this.require(actor, 'integrations.view');
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    const { idempotencyKey: _idem, ...detail } = job;
    return detail;
  }

  // ── messaging ─────────────────────────────────────────────────────────────
  /** Demo notifications are demo data and are never queued for external delivery. */
  deliveries(actor: DemoIntegrationsActor): Delivery[] {
    this.require(actor, 'integrations.view', 'notifications.manage');
    return [];
  }
  retryDelivery(actor: DemoIntegrationsActor): AdminResult {
    this.require(actor, 'integrations.manage', 'notifications.manage');
    return { ok: false, code: 'not_found' };
  }
  dispatch(
    actor: DemoIntegrationsActor,
    channel: string,
  ): AdminResult<{ sent: number; failed: number; skipped: number }> {
    this.require(actor, 'integrations.manage');
    if (!MESSAGING.includes(channel)) return { ok: false, code: 'invalid_request' };
    return { ok: true, sent: 0, failed: 0, skipped: 0 };
  }
  webhookEvents(actor: DemoIntegrationsActor): WebhookEvent[] {
    this.require(actor, 'integrations.view');
    return [];
  }

  // ── flags ─────────────────────────────────────────────────────────────────
  features(actor: DemoIntegrationsActor): IntegrationFeatures {
    this.require(
      actor,
      'integrations.view',
      'catalog.manage',
      'content.manage',
      'orders.manage',
      'shipping.manage',
    );
    const out: IntegrationFeatures = {};
    for (const key of this.keys()) {
      const c = this.config(key);
      if (c.enabled && this.complete(key, c) && !this.circuitOpen(c))
        out[key] = { provider: c.provider };
    }
    return out;
  }

  storefront(): StorefrontIntegrations {
    const ga = this.config('google_analytics');
    const social = this.config('social_auth');
    return {
      analytics:
        ga.enabled && ga.provider === 'ga4' && this.complete('google_analytics', ga)
          ? { provider: 'ga4', measurementId: String(ga.settings.measurementId) }
          : null,
      socialAuth: {
        google: social.enabled && social.settings.google === true,
        apple: social.enabled && social.settings.apple === true,
      },
    };
  }

  /** AI draft (MOCK): fills the editor only — publishing stays a separate, human action. */
  async suggest(
    actor: DemoIntegrationsActor,
    input: PublicContentInput,
  ): Promise<AdminResult<{ draft: string; mock: boolean }>> {
    this.require(actor, 'catalog.manage', 'content.manage');
    const c = this.config('ai');
    if (!c.enabled || !this.complete('ai', c) || this.circuitOpen(c))
      return { ok: false, code: 'not_enabled' };
    const result = await mockAiProvider(c.mockScenario).suggest(input);
    if (!result.ok) return { ok: false, code: result.code };
    return { ok: true, draft: result.value.text, mock: true };
  }
}
