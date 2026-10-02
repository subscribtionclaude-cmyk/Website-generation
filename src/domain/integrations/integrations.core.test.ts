import { describe, expect, it } from 'vitest';
import {
  configComplete,
  INTEGRATION_KEYS,
  INTEGRATIONS,
  isSecretLike,
  providerCapabilities,
  validateSettings,
} from './catalog';
import {
  callProvider,
  codeForStatus,
  fetchWithTimeout,
  nextCircuit,
  redact,
  retryAfterFailure,
} from './http';
import {
  isMockScenario,
  MOCK_SCENARIOS,
  mockAdapter,
  mockErpProvider,
  mockNotificationProvider,
} from './mock';
import { customerFacingVariables, routeNotification, type RouteInput } from './router';
import { SERVER_ADAPTERS } from './server/runtime';
import { deriveStatus, healthSummary } from './status';
import { jobStatus, planRecord, summarize, type LocalVariant, type PlanContext } from './sync';
import { safeEqual, signWebhook, verifyWebhook } from './webhook';

describe('integration registry', () => {
  it('covers every Phase 09 integration exactly once, all optional', () => {
    expect([...INTEGRATION_KEYS].sort()).toEqual(
      [
        'ai',
        'backup',
        'courier',
        'email',
        'google_analytics',
        'odoo',
        'pos',
        'search',
        'sms',
        'social_auth',
        'storage',
        'whatsapp',
      ].sort(),
    );
    for (const spec of INTEGRATIONS) {
      expect(spec.fallback, spec.key).toBeTruthy();
      expect(spec.providers.length, spec.key).toBeGreaterThan(0);
      expect(spec.data.length, spec.key).toBeGreaterThan(0);
    }
  });

  it('lists only server environment variable NAMES as secrets, never as settings', () => {
    for (const spec of INTEGRATIONS) {
      for (const name of spec.secrets) {
        expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(name.startsWith('VITE_'), name).toBe(false);
      }
      for (const field of spec.settings) expect(isSecretLike(field.key, ''), field.key).toBe(false);
    }
  });

  it('keeps the server adapter secret names in the catalog', () => {
    for (const [provider, adapter] of Object.entries(SERVER_ADAPTERS)) {
      const spec = INTEGRATIONS.find((i) => i.key === adapter.integration);
      expect(spec?.providers.some((p) => p.key === provider && p.adapter === 'implemented')).toBe(
        true,
      );
      for (const secret of adapter.secrets) expect(spec?.secrets).toContain(secret);
    }
  });

  it('detects capabilities per provider (no universal API assumed)', () => {
    expect(providerCapabilities('whatsapp', 'meta_cloud')).toContain('message.template');
    expect(providerCapabilities('odoo', 'odoo_jsonrpc')).not.toContain('orders.write' as never);
    expect(providerCapabilities('courier', null)).toEqual([]);
    expect(providerCapabilities('courier', 'unknown')).toEqual([]);
  });

  it('refuses secrets in public settings and validates formats', () => {
    expect(isSecretLike('apiKey', 'x')).toBe(true);
    expect(isSecretLike('note', 'sk-live1234567890')).toBe(true);
    expect(isSecretLike('note', 'EAAG' + 'x'.repeat(30))).toBe(true);
    expect(isSecretLike('phoneNumberId', '1234567890')).toBe(false);
    expect(validateSettings('whatsapp', { token: 'abc' })).toContainEqual({
      field: 'token',
      code: 'unknown_setting',
    });
    expect(
      validateSettings('whatsapp', { phoneNumberId: 'abc', graphVersion: 'v21.0' }),
    ).toContainEqual({ field: 'phoneNumberId', code: 'invalid_setting' });
    expect(validateSettings('odoo', { baseUrl: 'http://erp.local' })).toContainEqual({
      field: 'baseUrl',
      code: 'invalid_setting',
    });
    expect(validateSettings('whatsapp', {})).toContainEqual({
      field: 'phoneNumberId',
      code: 'required',
    });
    expect(
      validateSettings('whatsapp', { phoneNumberId: '1234567890', graphVersion: 'v21.0' }),
    ).toEqual([]);
  });

  it('derives completeness like the database', () => {
    expect(configComplete('whatsapp', null, {})).toBe(false);
    expect(configComplete('whatsapp', 'meta_cloud', { phoneNumberId: '12345' })).toBe(false);
    expect(
      configComplete('whatsapp', 'meta_cloud', { phoneNumberId: '12345', graphVersion: 'v21.0' }),
    ).toBe(true);
    expect(
      configComplete('whatsapp', 'other', { phoneNumberId: '12345', graphVersion: 'v21.0' }),
    ).toBe(false);
    expect(configComplete('social_auth', 'supabase_auth', { google: false, apple: false })).toBe(
      false,
    );
    expect(configComplete('social_auth', 'supabase_auth', { google: true })).toBe(true);
  });
});

describe('status', () => {
  const base = {
    key: 'whatsapp' as const,
    provider: 'meta_cloud',
    settings: { phoneNumberId: '12345', graphVersion: 'v21.0' },
    lastCheckStatus: null,
    circuitOpenUntil: null,
  };
  it('never treats saved configuration as connected', () => {
    expect(deriveStatus({ ...base, provider: null, enabled: false }).state).toBe('not_configured');
    expect(deriveStatus({ ...base, enabled: false }).state).toBe('disabled');
    expect(deriveStatus({ ...base, enabled: true }).state).toBe('untested');
    expect(deriveStatus({ ...base, enabled: true }).fallbackActive).toBe(true);
    const ok = deriveStatus({ ...base, enabled: true, lastCheckStatus: 'connected' });
    expect(ok.state).toBe('connected');
    expect(ok.fallbackActive).toBe(false);
    expect(deriveStatus({ ...base, enabled: true, lastCheckStatus: 'failed' }).state).toBe('error');
  });
  it('reports an open circuit as an error and flags subscriptions', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    const status = deriveStatus(
      {
        ...base,
        enabled: true,
        lastCheckStatus: 'connected',
        circuitOpenUntil: '2026-10-02T10:03:00Z',
      },
      now,
    );
    expect(status).toMatchObject({
      state: 'error',
      circuitOpen: true,
      mayRequireSubscription: true,
    });
    expect(
      deriveStatus({ ...base, key: 'sms', provider: null, enabled: false }).requiresSubscription,
    ).toBe(true);
    expect(healthSummary(['connected', 'disabled', 'error', 'not_configured', 'untested'])).toEqual(
      {
        connected: 1,
        disabled: 1,
        error: 1,
        needsSetup: 2,
      },
    );
  });
});

describe('http safety', () => {
  it('redacts credentials from provider text', () => {
    const out = redact('Bearer abc.def token=hunter2 key sk-test_1234567890 and mysecretvalue', [
      'mysecretvalue',
    ]);
    expect(out).not.toMatch(/abc\.def|hunter2|sk-test_1234567890|mysecretvalue/);
    expect(redact('x'.repeat(500))?.length).toBeLessThanOrEqual(300);
    expect(redact(null)).toBeNull();
  });

  it('maps HTTP statuses to health codes', () => {
    expect(codeForStatus(401)).toBe('auth_failed');
    expect(codeForStatus(403)).toBe('permission_denied');
    expect(codeForStatus(429)).toBe('rate_limited');
    expect(codeForStatus(503)).toBe('unreachable');
    expect(codeForStatus(400)).toBe('provider_error');
  });

  it('times out instead of hanging', async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    const result = await callProvider(
      () => fetchWithTimeout(hanging, 'https://provider.invalid', {}, 20),
      async () => null,
    );
    expect(result).toMatchObject({ ok: false, code: 'timeout', retryable: true });
  });

  it('never leaks a secret echoed in an error body', async () => {
    const result = await callProvider(
      () => Promise.resolve(new Response('bad key: s3cr3t-value-123', { status: 401 })),
      async () => null,
      ['s3cr3t-value-123'],
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('s3cr3t-value-123');
  });

  it('opens the circuit after three failures and closes on success', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    let state = { consecutiveFailures: 0, circuitOpenUntil: null as string | null };
    state = nextCircuit(state, false, now);
    state = nextCircuit(state, false, now);
    expect(state.circuitOpenUntil).toBeNull();
    state = nextCircuit(state, false, now);
    expect(state.circuitOpenUntil).toBe('2026-10-02T10:05:00.000Z');
    expect(nextCircuit(state, true, now)).toEqual({
      consecutiveFailures: 0,
      circuitOpenUntil: null,
    });
  });

  it('retries conservatively (1, 5 minutes) then stops', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    expect(retryAfterFailure(1, now)).toEqual({
      status: 'queued',
      nextRetryAt: '2026-10-02T10:01:00.000Z',
    });
    expect(retryAfterFailure(2, now)).toEqual({
      status: 'queued',
      nextRetryAt: '2026-10-02T10:05:00.000Z',
    });
    expect(retryAfterFailure(3, now)).toEqual({ status: 'failed', nextRetryAt: null });
  });
});

describe('webhook verification', () => {
  const secret = 'test-webhook-secret';
  const body = '{"entry":[]}';
  it('accepts a valid signature with or without the sha256= prefix', async () => {
    const signature = await signWebhook(secret, body);
    expect((await verifyWebhook({ secret, body, signature })).ok).toBe(true);
    expect((await verifyWebhook({ secret, body, signature: `sha256=${signature}` })).ok).toBe(true);
  });
  it('rejects tampering, missing secrets and replays', async () => {
    const signature = await signWebhook(secret, body);
    expect(await verifyWebhook({ secret, body: '{"entry":[1]}', signature })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect((await verifyWebhook({ secret: undefined, body, signature })).reason).toBe(
      'missing_secret',
    );
    expect((await verifyWebhook({ secret, body, signature: null })).reason).toBe(
      'missing_signature',
    );
    const now = new Date('2026-10-02T10:00:00Z');
    const fresh = String(now.getTime() / 1000);
    const signed = await signWebhook(secret, body, fresh);
    expect(
      (await verifyWebhook({ secret, body, signature: signed, timestamp: fresh, now })).ok,
    ).toBe(true);
    const old = String(now.getTime() / 1000 - 3600);
    const signedOld = await signWebhook(secret, body, old);
    expect(
      (await verifyWebhook({ secret, body, signature: signedOld, timestamp: old, now })).reason,
    ).toBe('stale_timestamp');
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('notification router', () => {
  const ready = { providerEnabled: true, providerConfigured: true, channelSwitchedOn: true };
  const input = (over: Partial<RouteInput> = {}): RouteInput => ({
    templateKey: 'order_confirmed',
    isDemo: false,
    preferences: { whatsapp: true, email: true, sms: true },
    channels: {
      whatsapp: { ...ready, templateMap: { order_confirmed: 'order_confirmed_v1' } },
      email: { ...ready, providerEnabled: false, templateMap: {} },
      sms: { ...ready, templateMap: {} },
    },
    ...over,
  });
  it('always keeps in-app and queues only fully allowed channels', () => {
    const result = routeNotification(input());
    expect(result.inApp).toBe(true);
    expect(result.channels).toEqual([
      { channel: 'email', action: 'skip', reason: 'provider_disabled' },
      { channel: 'whatsapp', action: 'queue', providerTemplate: 'order_confirmed_v1' },
      { channel: 'sms', action: 'skip', reason: 'event_not_mapped' },
    ]);
  });
  it('respects preferences, the channel switch and demo data', () => {
    const off = routeNotification(input({ preferences: { whatsapp: false } }));
    expect(off.channels.find((c) => c.channel === 'whatsapp')).toMatchObject({
      reason: 'preference_off',
    });
    const demo = routeNotification(input({ isDemo: true }));
    expect(demo.channels.every((c) => c.action === 'skip')).toBe(true);
    const switched = input();
    switched.channels.whatsapp.channelSwitchedOn = false;
    expect(routeNotification(switched).channels[1]).toMatchObject({ reason: 'channel_off' });
  });
  it('strips private data before anything reaches a provider', () => {
    expect(
      customerFacingVariables({
        order: 'MS-1001',
        total: 1200,
        internalNote: 'call later',
        paymentProof: 'x',
        mediaUrl: 'https://private',
        trackingLink: 'https://example.com/private',
        staffName: 'A',
      }),
    ).toEqual({ order: 'MS-1001', total: 1200 });
  });
});

describe('ERP sync planner', () => {
  const variant: LocalVariant = {
    id: 'v1',
    sku: 'IP18-256',
    price: 1000,
    compareAtPrice: null,
    stock: 10,
    reserved: 3,
    updatedAt: '2026-09-01T00:00:00Z',
  };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
    domain: 'prices',
    owner: 'external_wins',
    variants: [variant],
    customers: [{ id: 'u1', email: 'buyer@example.com' }],
    mappings: [],
    ...over,
  });

  it('matches by exact SKU and never fuzzy names', () => {
    expect(planRecord({ externalId: '7', sku: 'IP18-256', price: 1100 }, ctx())).toMatchObject({
      action: 'update',
      localId: 'v1',
      link: true,
    });
    expect(planRecord({ externalId: '8', name: 'IP18-256', price: 1100 }, ctx())).toMatchObject({
      action: 'skip',
      reason: 'unmatched',
    });
    expect(
      planRecord({ externalId: '9', sku: 'NEW-1' }, ctx({ domain: 'products' })),
    ).toMatchObject({ action: 'create', reason: 'review_required' });
  });

  it('validates external data', () => {
    expect(planRecord({ externalId: 'bad id!' }, ctx()).reason).toBe('invalid_external_id');
    expect(planRecord({ externalId: '7', sku: 'IP18-256', price: -1 }, ctx()).reason).toBe(
      'invalid_price',
    );
    expect(
      planRecord({ externalId: '7', sku: 'IP18-256', price: 10, compareAt: 5 }, ctx()).reason,
    ).toBe('invalid_price');
    expect(
      planRecord({ externalId: '7', sku: 'IP18-256', stock: 2.5 }, ctx({ domain: 'stock' })).reason,
    ).toBe('invalid_stock');
    expect(planRecord({ externalId: '7', updatedAt: 'nope' }, ctx()).reason).toBe(
      'invalid_timestamp',
    );
  });

  it('honours ownership: Malek primary, external with conflicts, external wins', () => {
    const record = {
      externalId: '7',
      sku: 'IP18-256',
      price: 1100,
      updatedAt: '2026-08-01T00:00:00Z',
    };
    expect(planRecord(record, ctx({ owner: 'malek' }))).toMatchObject({
      action: 'skip',
      reason: 'owned_by_malek',
    });
    expect(planRecord(record, ctx({ owner: 'external' }))).toMatchObject({
      action: 'conflict',
      reason: 'local_changed',
    });
    expect(
      planRecord({ ...record, updatedAt: '2026-09-10T00:00:00Z' }, ctx({ owner: 'external' })),
    ).toMatchObject({
      action: 'update',
    });
    expect(
      planRecord({ externalId: '7', sku: 'IP18-256', price: 1100 }, ctx({ owner: 'external' })),
    ).toMatchObject({
      action: 'conflict',
      reason: 'no_timestamp',
    });
  });

  it('never sets stock below active reservations, whatever the policy', () => {
    const plan = planRecord(
      { externalId: '7', sku: 'IP18-256', stock: 2 },
      ctx({ domain: 'stock' }),
    );
    expect(plan).toMatchObject({
      action: 'conflict',
      reason: 'below_reserved',
      detail: { stock: 2, reserved: 3 },
    });
    expect(
      planRecord({ externalId: '7', sku: 'IP18-256', stock: 3 }, ctx({ domain: 'stock' })),
    ).toMatchObject({
      action: 'update',
      detail: { before: 10, after: 3 },
    });
  });

  it('skips stale records and keeps mappings stable', () => {
    const mappings = [
      {
        entity: 'variant' as const,
        externalId: '7',
        localId: 'v1',
        externalUpdatedAt: '2026-09-05T00:00:00Z',
        syncedAt: '2026-09-05T00:00:00Z',
      },
    ];
    expect(
      planRecord(
        { externalId: '7', price: 1100, updatedAt: '2026-09-04T00:00:00Z' },
        ctx({ mappings }),
      ),
    ).toMatchObject({ action: 'skip', reason: 'not_newer' });
    expect(
      planRecord({ externalId: '99', sku: 'IP18-256', price: 1100 }, ctx({ mappings })),
    ).toMatchObject({
      action: 'conflict',
      reason: 'already_linked',
    });
    expect(planRecord({ externalId: '7', price: 1000 }, ctx({ mappings }))).toMatchObject({
      action: 'unchanged',
      link: false,
    });
  });

  it('links customers by exact email only, never creating accounts', () => {
    const c = ctx({ domain: 'customers' });
    expect(planRecord({ externalId: 'p1', email: 'BUYER@example.com' }, c)).toMatchObject({
      action: 'link',
      localId: 'u1',
    });
    expect(
      planRecord({ externalId: 'p2', email: 'buyer@example.co', name: 'Buyer' }, c),
    ).toMatchObject({
      action: 'create',
      reason: 'review_required',
    });
  });

  it('summarises like the database', () => {
    const items = [
      planRecord({ externalId: '7', sku: 'IP18-256', price: 1100 }, ctx()),
      planRecord({ externalId: 'x y' }, ctx()),
      planRecord({ externalId: '7', sku: 'IP18-256', stock: 1 }, ctx({ domain: 'stock' })),
    ];
    const summary = summarize(items);
    expect(summary).toEqual({
      inspected: 3,
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 1,
      conflicts: 1,
    });
    expect(jobStatus(summary)).toBe('partial');
  });
});

describe('mock providers', () => {
  it('are deterministic, offline and clearly marked', async () => {
    expect(MOCK_SCENARIOS).toEqual([
      'success',
      'auth_failed',
      'timeout',
      'rate_limited',
      'provider_error',
    ]);
    expect(isMockScenario('success')).toBe(true);
    expect(isMockScenario('anything')).toBe(false);
    const ok = await mockAdapter('whatsapp').testConnection();
    expect(ok).toMatchObject({ ok: true, code: 'connected' });
    expect(ok.message).toMatch(/MOCK/);
    for (const scenario of ['auth_failed', 'timeout', 'rate_limited', 'provider_error'] as const) {
      const result = await mockAdapter('odoo', scenario).testConnection();
      expect(result.ok).toBe(false);
      expect(result.code).toBe(scenario === 'provider_error' ? 'provider_error' : scenario);
    }
    expect(mockAdapter('odoo').isMock).toBe(true);
  });
  it('send and fetch only in the success scenario', async () => {
    const provider = mockNotificationProvider('whatsapp');
    const message = {
      idempotencyKey: 'delivery-1',
      to: '+201000000000',
      locale: 'ar' as const,
      title: 't',
      body: 'b',
      providerTemplate: 'x',
    };
    const first = await provider.send(message);
    const second = await provider.send(message);
    expect(first).toEqual(second);
    expect(provider.sent).toHaveLength(2);
    const failing = mockNotificationProvider('whatsapp', 'rate_limited');
    expect(await failing.send(message)).toMatchObject({
      ok: false,
      code: 'rate_limited',
      retryable: true,
    });
    expect(failing.sent).toHaveLength(0);
    const erp = mockErpProvider('odoo', { prices: [{ externalId: '1', price: 1 }] });
    expect(await erp.fetchRecords('prices')).toEqual({
      ok: true,
      value: [{ externalId: '1', price: 1 }],
    });
    expect(await erp.fetchRecords('stock')).toEqual({ ok: true, value: [] });
  });
});
