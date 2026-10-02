import type { ErpProvider, ExternalRecord, HealthResult, ProviderResult } from '../adapters.ts';
import { callProvider, fetchWithTimeout, ProviderError, type FetchLike } from '../http.ts';
import type { SyncDomain } from '../types.ts';

/**
 * Odoo adapter over the documented External API (JSON-RPC at {baseUrl}/jsonrpc: `common.version`,
 * `common.authenticate`, `object.execute_kw`). READ-ONLY by design (Import Only): it reads
 * products/variants, prices, on-hand stock and customers; it never writes to Odoo. The API key
 * (ODOO_API_KEY, used in place of the password as Odoo supports) stays on the server.
 *
 * This is an adapter contract, not a verified live integration: field names follow standard Odoo
 * models (product.product, res.partner) and must be confirmed against the store's Odoo version.
 */
export const ODOO_SECRET_NAMES = { apiKey: 'ODOO_API_KEY' } as const;

export interface OdooOptions {
  baseUrl: string;
  database: string;
  username: string;
  companyId?: number | null;
  apiKey: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

interface RpcError {
  message?: string;
  data?: { name?: string; message?: string };
}

/** Odoo datetimes are UTC without a zone ("2026-01-02 10:20:30"). */
export function odooDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) return null;
  return `${value.slice(0, 19).replace(' ', 'T')}Z`;
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function mapOdooRecord(domain: SyncDomain, row: Record<string, unknown>): ExternalRecord {
  const externalId = String(row.id ?? '');
  if (domain === 'customers')
    return {
      externalId,
      name: text(row.name),
      email: text(row.email),
      updatedAt: odooDate(row.write_date),
    };
  return {
    externalId,
    sku: text(row.default_code),
    name: text(row.display_name) ?? text(row.name),
    price: domain === 'prices' || domain === 'products' ? num(row.list_price) : undefined,
    stock: domain === 'stock' ? num(row.qty_available) : undefined,
    updatedAt: odooDate(row.write_date),
  };
}

export function odooProvider(options: OdooOptions): ErpProvider {
  const secrets = [options.apiKey];
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/jsonrpc`;
  let rpcId = 0;

  function rpc(service: 'common' | 'object', method: string, args: unknown[]): Promise<Response> {
    rpcId += 1;
    return fetchWithTimeout(
      options.fetch,
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: { service, method, args },
          id: rpcId,
        }),
      },
      options.timeoutMs,
    );
  }

  async function result<T>(response: Response): Promise<T> {
    const json = (await response.json()) as { result?: T; error?: RpcError };
    if (json.error) {
      const name = json.error.data?.name ?? '';
      const code = /AccessDenied/i.test(name)
        ? 'auth_failed'
        : /AccessError/i.test(name)
          ? 'permission_denied'
          : 'provider_error';
      throw new ProviderError(code, json.error.data?.message ?? json.error.message ?? 'Odoo error');
    }
    return json.result as T;
  }

  async function authenticate(): Promise<ProviderResult<number>> {
    const outcome = await callProvider(
      () => rpc('common', 'authenticate', [options.database, options.username, options.apiKey, {}]),
      (response) => result<number | false>(response),
      secrets,
    );
    if (!outcome.ok)
      return {
        ok: false,
        code: outcome.code,
        message: outcome.message,
        retryable: outcome.retryable,
      };
    if (typeof outcome.value !== 'number' || outcome.value <= 0)
      return {
        ok: false,
        code: 'auth_failed',
        message: 'Odoo rejected the user or API key.',
        retryable: false,
      };
    return { ok: true, value: outcome.value };
  }

  const SPEC: Record<SyncDomain, { model: string; fields: string[]; domain: unknown[] }> = {
    products: {
      model: 'product.product',
      fields: ['id', 'default_code', 'display_name', 'list_price', 'write_date'],
      domain: [['active', '=', true]],
    },
    prices: {
      model: 'product.product',
      fields: ['id', 'default_code', 'display_name', 'list_price', 'write_date'],
      domain: [['active', '=', true]],
    },
    stock: {
      model: 'product.product',
      fields: ['id', 'default_code', 'display_name', 'qty_available', 'write_date'],
      domain: [['active', '=', true]],
    },
    customers: {
      model: 'res.partner',
      fields: ['id', 'name', 'email', 'write_date'],
      domain: [
        ['customer_rank', '>', 0],
        ['email', '!=', false],
      ],
    },
  };

  return {
    key: 'odoo',
    provider: 'odoo_jsonrpc',
    capabilities: ['products.read', 'prices.read', 'stock.read', 'customers.read'],
    isMock: false,
    async testConnection(): Promise<HealthResult> {
      const started = Date.now();
      const version = await callProvider(
        () => rpc('common', 'version', []),
        (response) => result<{ server_version?: string }>(response),
        secrets,
      );
      if (!version.ok)
        return {
          ok: false,
          code: version.code,
          message: version.message,
          latencyMs: version.latencyMs,
        };
      const auth = await authenticate();
      const latencyMs = Date.now() - started;
      if (!auth.ok) return { ok: false, code: auth.code, message: auth.message, latencyMs };
      return {
        ok: true,
        code: 'connected',
        message: version.value.server_version ? `Odoo ${version.value.server_version}` : null,
        latencyMs,
      };
    },
    async fetchRecords(domain, fetchOptions): Promise<ProviderResult<ExternalRecord[]>> {
      const auth = await authenticate();
      if (!auth.ok) return auth;
      const spec = SPEC[domain];
      const filter = [...spec.domain];
      if (options.companyId && spec.model === 'product.product')
        filter.push(['company_id', 'in', [options.companyId, false]]);
      const outcome = await callProvider(
        () =>
          rpc('object', 'execute_kw', [
            options.database,
            auth.value,
            options.apiKey,
            spec.model,
            'search_read',
            [filter],
            {
              fields: spec.fields,
              limit: Math.min(fetchOptions?.limit ?? 500, 2000),
              order: 'id asc',
            },
          ]),
        (response) => result<Record<string, unknown>[]>(response),
        secrets,
      );
      if (!outcome.ok)
        return {
          ok: false,
          code: outcome.code,
          message: outcome.message,
          retryable: outcome.retryable,
        };
      return {
        ok: true,
        value: (Array.isArray(outcome.value) ? outcome.value : []).map((row) =>
          mapOdooRecord(domain, row),
        ),
      };
    },
  };
}
