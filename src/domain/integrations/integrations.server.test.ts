import { describe, expect, it, vi } from 'vitest';
import { isAnalyticsAllowedPath, sanitizeAnalyticsParams } from './analytics';
import type { FetchLike } from './http';
import { mockAiProvider, mockCourierProvider, mockSearchProvider } from './mock';
import { checkGoogleAnalytics, checkSocialAuth } from './providers/clientChecks';
import { mapOdooRecord, odooDate, odooProvider } from './providers/odooJsonRpc';
import {
  parseWhatsappStatuses,
  toWhatsappRecipient,
  whatsappCloudProvider,
} from './providers/whatsappCloud';
import {
  dispatchChannel,
  handleIntegrationAction,
  handleWhatsappWebhook,
  type RpcClient,
  type RpcResult,
} from './server/handler';
import { isPublicHttpsUrl } from './http';
import { createServerAdapter } from './server/runtime';
import {
  BACKUP_COVERAGE,
  buildAiInput,
  courierQuoteOrManual,
  safeObjectUrl,
  searchWithFallback,
  suggestContent,
} from './services';
import { signWebhook } from './webhook';

// Test-only placeholder values (not credentials).
const TOKEN = 'test-access-token-value';
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

const whatsappSettings = { phoneNumberId: '1234567890', graphVersion: 'v21.0' };

describe('WhatsApp Cloud adapter (stubbed HTTP only)', () => {
  it('tests the connection with the token only in the Authorization header', async () => {
    const { fn, calls } = stubFetch(() => jsonResponse({ display_phone_number: '+20 100' }));
    const provider = whatsappCloudProvider({ ...whatsappSettings, accessToken: TOKEN, fetch: fn });
    expect(await provider.testConnection()).toMatchObject({ ok: true, code: 'connected' });
    expect(calls[0]?.url).toBe(
      'https://graph.facebook.com/v21.0/1234567890?fields=display_phone_number,verified_name',
    );
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'permission_denied'],
    [429, 'rate_limited'],
    [500, 'unreachable'],
  ] as const)('maps HTTP %s to %s without leaking the token', async (status, code) => {
    const { fn } = stubFetch(() => jsonResponse({ error: { message: `bad ${TOKEN}` } }, status));
    const result = await whatsappCloudProvider({
      ...whatsappSettings,
      accessToken: TOKEN,
      fetch: fn,
    }).testConnection();
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('sends approved templates only, with the customer-facing text as {{1}}', async () => {
    const { fn, calls } = stubFetch(() => jsonResponse({ messages: [{ id: 'wamid.ABC' }] }));
    const provider = whatsappCloudProvider({ ...whatsappSettings, accessToken: TOKEN, fetch: fn });
    const message = {
      idempotencyKey: 'delivery-1',
      to: '01012345678',
      locale: 'ar' as const,
      title: 'طلبك',
      body: 'تم تأكيد طلبك MS-1001',
      providerTemplate: 'order_update',
    };
    expect(await provider.send(message)).toEqual({ ok: true, value: { externalRef: 'wamid.ABC' } });
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      messaging_product: 'whatsapp',
      to: '201012345678',
      type: 'template',
      template: { name: 'order_update', language: { code: 'ar' } },
    });
    expect(await provider.send({ ...message, providerTemplate: null })).toMatchObject({
      ok: false,
      code: 'config_incomplete',
    });
    expect(await provider.send({ ...message, to: 'abc' })).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('normalises recipients and parses delivery receipts', () => {
    expect(toWhatsappRecipient('+20 101 234 5678')).toBe('201012345678');
    expect(toWhatsappRecipient('0020101234 5678')).toBe('201012345678');
    expect(toWhatsappRecipient('12')).toBeNull();
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'delivered' },
                  { id: 'wamid.1', status: 'read' },
                  { id: 'wamid.2', status: 'failed' },
                  { id: 'wamid.3', status: 'weird' },
                ],
                messages: [{ from: '2010', text: { body: 'hi' } }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsappStatuses(payload)).toEqual([
      { eventId: 'wamid.1:delivered', externalRef: 'wamid.1', status: 'delivered' },
      { eventId: 'wamid.1:read', externalRef: 'wamid.1', status: 'delivered' },
      { eventId: 'wamid.2:failed', externalRef: 'wamid.2', status: 'failed' },
    ]);
    expect(parseWhatsappStatuses(null)).toEqual([]);
  });
});

describe('Odoo adapter (stubbed JSON-RPC only)', () => {
  const settings = {
    baseUrl: 'https://erp.example.test/',
    database: 'malek',
    username: 'sync@example.test',
  };
  const API_KEY = 'test-odoo-key-value';
  function odooStub(options: { uid?: number | false; error?: string } = {}) {
    return stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        params: { service: string; method: string; args: unknown[] };
      };
      const { method, args } = body.params;
      if (method === 'version') return jsonResponse({ result: { server_version: '17.0' } });
      if (method === 'authenticate') return jsonResponse({ result: options.uid ?? 7 });
      if (options.error)
        return jsonResponse({
          error: {
            message: 'Odoo Server Error',
            data: { name: options.error, message: `denied ${API_KEY}` },
          },
        });
      const model = args[3];
      return jsonResponse({
        result:
          model === 'res.partner'
            ? [
                {
                  id: 4,
                  name: 'Buyer',
                  email: 'buyer@example.com',
                  write_date: '2026-09-01 10:00:00',
                },
              ]
            : [
                {
                  id: 11,
                  default_code: 'IP18-256',
                  display_name: 'iPhone 18',
                  list_price: 1100,
                  qty_available: 6,
                  write_date: '2026-09-01 10:00:00',
                },
              ],
      });
    });
  }

  it('tests the connection with version + authenticate (read-only)', async () => {
    const { fn, calls } = odooStub();
    const provider = odooProvider({ ...settings, apiKey: API_KEY, fetch: fn });
    expect(await provider.testConnection()).toMatchObject({
      ok: true,
      code: 'connected',
      message: 'Odoo 17.0',
    });
    expect(calls.every((c) => c.url === 'https://erp.example.test/jsonrpc')).toBe(true);
  });

  it('reports rejected credentials as auth_failed', async () => {
    const { fn } = odooStub({ uid: false });
    const result = await odooProvider({ ...settings, apiKey: API_KEY, fetch: fn }).testConnection();
    expect(result).toMatchObject({ ok: false, code: 'auth_failed' });
  });

  it('reads records with search_read and maps them', async () => {
    const { fn, calls } = odooStub();
    const provider = odooProvider({ ...settings, companyId: 2, apiKey: API_KEY, fetch: fn });
    expect(await provider.fetchRecords('stock')).toEqual({
      ok: true,
      value: [
        {
          externalId: '11',
          sku: 'IP18-256',
          name: 'iPhone 18',
          price: undefined,
          stock: 6,
          updatedAt: '2026-09-01T10:00:00Z',
        },
      ],
    });
    const rpc = JSON.parse(String(calls.at(-1)?.init?.body)) as {
      params: { method: string; args: unknown[] };
    };
    expect(rpc.params.method).toBe('execute_kw');
    expect(rpc.params.args[4]).toBe('search_read');
    expect(JSON.stringify(rpc.params.args[5])).toContain('company_id');
    const customers = await provider.fetchRecords('customers');
    expect(customers.ok && customers.value[0]).toMatchObject({
      externalId: '4',
      email: 'buyer@example.com',
    });
  });

  it('turns Odoo access errors into safe codes', async () => {
    const { fn } = odooStub({ error: 'odoo.exceptions.AccessError' });
    const result = await odooProvider({ ...settings, apiKey: API_KEY, fetch: fn }).fetchRecords(
      'prices',
    );
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it('parses Odoo dates and missing fields', () => {
    expect(odooDate('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05Z');
    expect(odooDate(false)).toBeNull();
    expect(
      mapOdooRecord('prices', { id: 1, default_code: false, name: 'X', list_price: 5 }),
    ).toMatchObject({
      externalId: '1',
      sku: null,
      price: 5,
    });
  });
});

describe('client-side checks', () => {
  it('verifies the GA measurement ID format only', () => {
    expect(checkGoogleAnalytics('G-ABC1234')).toMatchObject({
      ok: true,
      message: 'format_verified',
    });
    expect(checkGoogleAnalytics('UA-1')).toMatchObject({ ok: false, code: 'config_incomplete' });
  });
  it('reads which social providers Supabase Auth has enabled', async () => {
    const { fn, calls } = stubFetch(() =>
      jsonResponse({ external: { google: true, apple: false } }),
    );
    const base = { fetch: fn, supabaseUrl: 'https://p.supabase.co/', anonKey: 'anon-public-key' };
    expect(
      await checkSocialAuth({ ...base, wanted: { google: true, apple: false } }),
    ).toMatchObject({ ok: true });
    expect(await checkSocialAuth({ ...base, wanted: { google: true, apple: true } })).toMatchObject(
      {
        ok: false,
        message: 'provider_off:apple',
      },
    );
    expect(calls[0]?.url).toBe('https://p.supabase.co/auth/v1/settings');
    expect(
      await checkSocialAuth({ ...base, supabaseUrl: null, wanted: { google: true, apple: false } }),
    ).toMatchObject({
      code: 'runtime_unavailable',
    });
  });
});

describe('server adapter factory', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  it('never falls back to a mock in live mode', () => {
    const fetchFn: FetchLike = () => Promise.reject(new Error('no network in tests'));
    expect(
      createServerAdapter(
        { key: 'sms', provider: 'http_gateway', enabled: true, settings: {} },
        env({}),
        fetchFn,
      ),
    ).toMatchObject({
      ok: false,
      health: { code: 'unsupported' },
    });
    expect(
      createServerAdapter(
        { key: 'whatsapp', provider: 'mock', enabled: true, settings: {} },
        env({}),
        fetchFn,
      ),
    ).toMatchObject({
      ok: false,
      health: { code: 'unsupported' },
    });
  });
  it('names missing secrets without exposing values', () => {
    const fetchFn: FetchLike = () => Promise.reject(new Error('no network in tests'));
    const missing = createServerAdapter(
      { key: 'whatsapp', provider: 'meta_cloud', enabled: true, settings: whatsappSettings },
      env({}),
      fetchFn,
    );
    expect(missing).toMatchObject({
      ok: false,
      health: { code: 'config_incomplete', message: 'missing_secret:WHATSAPP_ACCESS_TOKEN' },
    });
    const built = createServerAdapter(
      { key: 'whatsapp', provider: 'meta_cloud', enabled: true, settings: whatsappSettings },
      env({ WHATSAPP_ACCESS_TOKEN: TOKEN }),
      fetchFn,
    );
    expect(built.ok && built.adapter.isMock).toBe(false);
  });
});

/** Fake Supabase client: records calls, answers from a table of handlers. */
function fakeClient(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc(fn, args = {}) {
      calls.push({ fn, args });
      const handler = handlers[fn];
      const result: RpcResult = handler
        ? { data: handler(args), error: null }
        : { data: null, error: { message: `unexpected ${fn}` } };
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

const ACTOR = '00000000-0000-4000-8000-000000000001';
const JOB = '00000000-0000-4000-8000-0000000000aa';

describe('integrations Edge Function handler', () => {
  const allowed = () =>
    fakeClient({ admin_integration_authorize: () => ({ ok: true, actorId: ACTOR }) });
  const noNetwork: FetchLike = () => Promise.reject(new Error('no network in tests'));

  it('refuses callers the database does not authorize', async () => {
    const user = fakeClient({ admin_integration_authorize: () => null });
    const service = fakeClient({});
    expect(
      await handleIntegrationAction(
        { action: 'test', key: 'whatsapp' },
        { user: user.client, service: service.client, env: () => undefined, fetch: noNetwork },
      ),
    ).toEqual({ status: 403, body: { ok: false, code: 'forbidden' } });
    expect(
      await handleIntegrationAction(
        { action: 'test', key: 'whatsapp' },
        { user: null, service: service.client, env: () => undefined, fetch: noNetwork },
      ),
    ).toMatchObject({ status: 403 });
    expect(service.calls).toHaveLength(0);
    expect(
      (
        await handleIntegrationAction(
          { action: 'drop' },
          { user: null, service: service.client, env: () => undefined, fetch: noNetwork },
        )
      ).status,
    ).toBe(400);
  });

  it('records a server test result with the acting user and no secret', async () => {
    const user = allowed();
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'whatsapp',
        provider: 'meta_cloud',
        enabled: true,
        settings: whatsappSettings,
      }),
      integration_record_check: (args) => ({ ok: true, args }),
    });
    const { fn } = stubFetch(() => jsonResponse({ error: { message: `expired ${TOKEN}` } }, 401));
    const response = await handleIntegrationAction(
      { action: 'test', key: 'whatsapp' },
      {
        user: user.client,
        service: service.client,
        env: (n) => (n === 'WHATSAPP_ACCESS_TOKEN' ? TOKEN : undefined),
        fetch: fn,
      },
    );
    expect(response.status).toBe(200);
    const record = service.calls.find((c) => c.fn === 'integration_record_check');
    expect(record?.args).toMatchObject({
      p_key: 'whatsapp',
      p_status: 'failed',
      p_code: 'auth_failed',
      p_actor: ACTOR,
    });
    expect(JSON.stringify(response)).not.toContain(TOKEN);
    expect(JSON.stringify(service.calls)).not.toContain(TOKEN);
  });

  it('records unsupported providers honestly instead of faking success', async () => {
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'sms',
        provider: 'http_gateway',
        enabled: true,
        settings: {},
      }),
      integration_record_check: () => ({ ok: true }),
    });
    await handleIntegrationAction(
      { action: 'test', key: 'sms' },
      { user: allowed().client, service: service.client, env: () => undefined, fetch: noNetwork },
    );
    expect(service.calls.find((c) => c.fn === 'integration_record_check')?.args).toMatchObject({
      p_status: 'failed',
      p_code: 'unsupported',
    });
  });

  it('runs a sync: fetch from the provider, apply through the database', async () => {
    const user = fakeClient({
      admin_integration_authorize: () => ({ ok: true, actorId: ACTOR }),
      admin_get_sync_job: () => ({ key: 'odoo', domain: 'prices', status: 'running' }),
    });
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'odoo',
        provider: 'odoo_jsonrpc',
        enabled: true,
        settings: { baseUrl: 'https://erp.example.test', database: 'malek', username: 'u' },
      }),
      integration_record_sync_result: () => ({ ok: true }),
    });
    const { fn } = stubFetch((_u, init) => {
      const method = (JSON.parse(String(init?.body)) as { params: { method: string } }).params
        .method;
      if (method === 'authenticate') return jsonResponse({ result: 3 });
      return jsonResponse({
        result: [
          { id: 5, default_code: 'IP18-256', list_price: 999, write_date: '2026-09-01 00:00:00' },
        ],
      });
    });
    const response = await handleIntegrationAction(
      { action: 'sync', jobId: JOB },
      {
        user: user.client,
        service: service.client,
        env: (n) => (n === 'ODOO_API_KEY' ? 'test-odoo' : undefined),
        fetch: fn,
      },
    );
    expect(response).toMatchObject({ status: 200, body: { ok: true } });
    const applied = service.calls.find((c) => c.fn === 'integration_record_sync_result');
    expect(applied?.args.p_records).toEqual([
      {
        externalId: '5',
        sku: 'IP18-256',
        name: null,
        price: 999,
        stock: undefined,
        updatedAt: '2026-09-01T00:00:00Z',
      },
    ]);
  });

  it('marks the sync failed (redacted) when the provider fails', async () => {
    const user = fakeClient({
      admin_integration_authorize: () => ({ ok: true, actorId: ACTOR }),
      admin_get_sync_job: () => ({ key: 'odoo', domain: 'stock', status: 'running' }),
    });
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'odoo',
        provider: 'odoo_jsonrpc',
        enabled: true,
        settings: { baseUrl: 'https://erp.example.test', database: 'd', username: 'u' },
      }),
      integration_fail_sync: () => ({ ok: true }),
    });
    const { fn } = stubFetch(() => new Response('down', { status: 503 }));
    const response = await handleIntegrationAction(
      { action: 'sync', jobId: JOB },
      { user: user.client, service: service.client, env: () => 'test-odoo-secret', fetch: fn },
    );
    expect(response.body).toMatchObject({ ok: false, code: 'unreachable' });
    expect(service.calls.find((c) => c.fn === 'integration_fail_sync')?.args).toMatchObject({
      p_job_id: JOB,
      p_code: 'unreachable',
    });
    expect(service.calls.some((c) => c.fn === 'integration_record_sync_result')).toBe(false);
  });

  it('dispatches claimed deliveries and records each outcome', async () => {
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'whatsapp',
        provider: 'meta_cloud',
        enabled: true,
        settings: whatsappSettings,
      }),
      integration_claim_deliveries: () => [
        {
          id: 1,
          idempotencyKey: 'delivery-1',
          locale: 'en',
          title: 'T',
          body: 'Order MS-1 confirmed',
          providerTemplate: 'order_update',
          to: '+201012345678',
        },
        {
          id: 2,
          idempotencyKey: 'delivery-2',
          locale: 'ar',
          title: 'T',
          body: 'x',
          providerTemplate: 'order_update',
          to: null,
        },
      ],
      integration_record_delivery: () => ({ ok: true }),
    });
    const { fn } = stubFetch(() => jsonResponse({ messages: [{ id: 'wamid.9' }] }));
    const response = await dispatchChannel(
      { user: null, service: service.client, env: () => TOKEN, fetch: fn },
      'whatsapp',
    );
    expect(response.body).toMatchObject({ ok: true, sent: 1, skipped: 1, failed: 0 });
    const records = service.calls
      .filter((c) => c.fn === 'integration_record_delivery')
      .map((c) => c.args);
    expect(records).toEqual([
      { p_id: 1, p_status: 'sent', p_error_code: null, p_external_ref: 'wamid.9' },
      { p_id: 2, p_status: 'skipped', p_error_code: 'no_recipient' },
    ]);
  });

  it('does nothing while the provider is disabled', async () => {
    const service = fakeClient({
      integration_runtime_config: () => ({
        key: 'whatsapp',
        provider: 'meta_cloud',
        enabled: false,
        settings: {},
      }),
    });
    const response = await dispatchChannel(
      { user: null, service: service.client, env: () => TOKEN, fetch: noNetwork },
      'whatsapp',
    );
    expect(response.body).toMatchObject({ code: 'provider_disabled', sent: 0 });
    expect(service.calls.map((c) => c.fn)).toEqual(['integration_runtime_config']);
  });
});

describe('WhatsApp webhook handler', () => {
  const SECRET = 'test-webhook-secret';
  const env = (name: string) =>
    ({ WHATSAPP_WEBHOOK_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'test-verify' })[name];
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }],
  });
  const headers = (signature: string | null) => ({
    get: (n: string) => (n === 'x-hub-signature-256' ? signature : null),
  });

  it('answers the verification handshake only with the right token', async () => {
    const service = fakeClient({});
    const ok = await handleWhatsappWebhook(
      {
        method: 'GET',
        url: 'https://f.test/?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=42',
        headers: headers(null),
        body: '',
      },
      { service: service.client, env },
    );
    expect(ok).toEqual({ status: 200, body: '42' });
    const bad = await handleWhatsappWebhook(
      {
        method: 'GET',
        url: 'https://f.test/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42',
        headers: headers(null),
        body: '',
      },
      { service: service.client, env },
    );
    expect(bad.status).toBe(403);
  });

  it('rejects unsigned or tampered payloads without processing them', async () => {
    const service = fakeClient({
      integration_record_webhook: () => ({ ok: true, accepted: false }),
    });
    const response = await handleWhatsappWebhook(
      { method: 'POST', url: 'https://f.test/', headers: headers('sha256=deadbeef'), body },
      { service: service.client, env },
    );
    expect(response.status).toBe(401);
    expect(service.calls.map((c) => c.fn)).toEqual(['integration_record_webhook']);
    expect(service.calls[0]?.args).toMatchObject({
      p_signature_valid: false,
      p_event_type: 'bad_signature',
    });
  });

  it('applies signed receipts once (duplicates ignored)', async () => {
    let seen = false;
    const service = fakeClient({
      integration_record_webhook: () => {
        const result = seen
          ? { ok: true, duplicate: true, accepted: false }
          : { ok: true, duplicate: false, accepted: true };
        seen = true;
        return result;
      },
      integration_record_delivery_status: () => ({ ok: true }),
    });
    const signature = `sha256=${await signWebhook(SECRET, body)}`;
    const request = { method: 'POST', url: 'https://f.test/', headers: headers(signature), body };
    expect(await handleWhatsappWebhook(request, { service: service.client, env })).toEqual({
      status: 200,
      body: { ok: true, applied: 1, duplicates: 0 },
    });
    expect(await handleWhatsappWebhook(request, { service: service.client, env })).toEqual({
      status: 200,
      body: { ok: true, applied: 0, duplicates: 1 },
    });
    expect(service.calls.filter((c) => c.fn === 'integration_record_delivery_status')).toHaveLength(
      1,
    );
  });
});

describe('fallback services', () => {
  it('sends only public product fields to AI and returns a draft', async () => {
    const input = buildAiInput('seo_description', 'en', {
      name: 'iPhone 18',
      brand: 'Apple',
      specs: [{ label: 'Storage', value: '256GB' }],
      ...({ cost: 900, stock: 3, internalNote: 'secret' } as object),
    } as Parameters<typeof buildAiInput>[2]);
    expect(Object.keys(input).sort()).toEqual([
      'brand',
      'category',
      'kind',
      'locale',
      'name',
      'specs',
      'subtitle',
    ]);
    const result = await suggestContent(mockAiProvider(), input);
    expect(result).toMatchObject({ ok: true, value: { mock: true } });
    expect(result.ok && result.value.draft).toContain('iPhone 18');
    expect(await suggestContent(null, input)).toMatchObject({ ok: false, message: 'ai_disabled' });
  });

  it('falls back to built-in search and manual shipping', async () => {
    const builtIn = vi.fn(() => ['built-in-hit']);
    expect(await searchWithFallback(null, 'iphone', builtIn)).toEqual({
      slugs: ['built-in-hit'],
      source: 'built_in',
    });
    expect(
      await searchWithFallback(mockSearchProvider([], 'timeout'), 'iphone', builtIn),
    ).toMatchObject({ source: 'built_in' });
    expect(
      await searchWithFallback(
        mockSearchProvider([{ slug: 'iphone-18', text: 'iPhone 18' }]),
        'iphone',
        builtIn,
      ),
    ).toEqual({ slugs: ['iphone-18'], source: 'provider' });
    const request = {
      idempotencyKey: 'o1',
      orderNumber: 'MS-1',
      recipient: { name: 'A', phone: '010', address: 'x', area: 'y', governorate: 'Cairo' },
      parcel: { items: 2, declaredValue: 100 },
    };
    expect(await courierQuoteOrManual(null, request)).toEqual({
      mode: 'manual',
      reason: 'no_provider',
    });
    expect(await courierQuoteOrManual(mockCourierProvider('provider_error'), request)).toEqual({
      mode: 'manual',
      reason: 'provider_error',
    });
    expect(await courierQuoteOrManual(mockCourierProvider(), request)).toMatchObject({
      mode: 'quoted',
      quote: { fee: 70 },
    });
  });

  it('keeps private media private and backups honest', async () => {
    const provider = {
      key: 'storage',
      provider: 'test',
      capabilities: [],
      isMock: true,
      testConnection: () =>
        Promise.resolve({ ok: true, code: 'connected' as const, message: null, latencyMs: 1 }),
      upload: vi.fn(),
      remove: vi.fn(),
      metadata: vi.fn(),
      url: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: { url: 'https://cdn/x', expiresAt: null } }),
      ),
    };
    const object = {
      path: 'proofs/a.jpg',
      visibility: 'private' as const,
      size: 1,
      contentType: 'image/jpeg',
    };
    expect(await safeObjectUrl(provider, object)).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    expect(await safeObjectUrl(provider, { ...object, visibility: 'public' })).toMatchObject({
      ok: true,
    });
    expect(BACKUP_COVERAGE.manual_export.restorable).toBe(false);
  });

  it('keeps analytics free of personal data and off private pages', () => {
    expect(
      sanitizeAnalyticsParams({
        item_id: 'iphone-18',
        value: 1200,
        email: 'a@b.com',
        search_term: 'call me 01012345678',
        page_title: 'iPhone 18',
        address: 'Cairo',
      }),
    ).toEqual({ item_id: 'iphone-18', value: 1200, page_title: 'iPhone 18' });
    for (const path of [
      '/admin',
      '/account/orders',
      '/en/checkout',
      '/order/MS-1',
      '/cart',
      '/repairs/request',
      '/en/trade-in/request',
    ])
      expect(isAnalyticsAllowedPath(path), path).toBe(false);
    for (const path of ['/', '/product/iphone-18', '/en/store', '/repairs'])
      expect(isAnalyticsAllowedPath(path), path).toBe(true);
  });
});

describe('server-side fetch targets (SSRF guard)', () => {
  it('accepts public https hosts only', () => {
    expect(isPublicHttpsUrl('https://erp.example.com/odoo')).toBe(true);
    expect(isPublicHttpsUrl('https://8.8.8.8')).toBe(true);
    for (const url of [
      'http://erp.example.com',
      'https://localhost:8069',
      'https://erp.local',
      'https://odoo.internal',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://172.20.1.1',
      'https://192.168.1.10',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1',
      'https://[::1]',
      'https://user:pass@erp.example.com',
      'https://intranet',
      'not a url',
    ])
      expect(isPublicHttpsUrl(url), url).toBe(false);
  });

  it('refuses to build an adapter for a private endpoint', () => {
    const fetchFn: FetchLike = () => Promise.reject(new Error('no network in tests'));
    const result = createServerAdapter(
      {
        key: 'odoo',
        provider: 'odoo_jsonrpc',
        enabled: true,
        settings: { baseUrl: 'https://169.254.169.254', database: 'd', username: 'u' },
      },
      () => 'test-odoo-secret',
      fetchFn,
    );
    expect(result).toMatchObject({
      ok: false,
      health: { code: 'config_incomplete', message: 'endpoint_not_public' },
    });
  });
});

describe('server-side fetches never follow redirects', () => {
  it('asks fetch not to follow and reports a redirect as a provider error', async () => {
    const { fn, calls } = stubFetch(
      () => new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/' } }),
    );
    const result = await whatsappCloudProvider({
      ...whatsappSettings,
      accessToken: TOKEN,
      fetch: fn,
    }).testConnection();
    expect(calls[0]?.init?.redirect).toBe('manual');
    expect(result).toMatchObject({
      ok: false,
      code: 'provider_error',
      message: 'redirect_not_followed',
    });
  });
});
