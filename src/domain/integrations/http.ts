import type { HealthResult, HealthResultCode, ProviderResult } from './adapters.ts';

/**
 * Outbound HTTP for provider adapters: finite timeouts, structured error codes, redacted messages.
 * `fetchImpl` is injected (server runtime: global fetch; tests: a stub) — nothing here calls a real
 * provider by itself. Relative imports only (shared with supabase/functions).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 8000;

/** Thrown by an adapter's response parser to report a structured provider failure. */
export class ProviderError extends Error {
  readonly code: HealthResultCode;
  readonly retryable: boolean;
  constructor(code: HealthResultCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/** Remove credentials from any provider text before it is stored or shown. */
export function redact(
  text: string | null | undefined,
  secrets: readonly string[] = [],
): string | null {
  if (!text) return null;
  let out = text;
  for (const secret of secrets)
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  out = out
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[redacted]')
    .replace(
      /(sk-|sk_live_|sk_test_|EAA|AKIA|ghp_|glpat-|sb_secret_)[A-Za-z0-9_-]{6,}/g,
      '[redacted]',
    )
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '[redacted]')
    .replace(/(password|passwd|api[_-]?key|token|secret)=([^&\s]+)/gi, '$1=[redacted]');
  return out.slice(0, 300);
}

/**
 * Provider endpoints entered in the admin are fetched by the server runtime, so they must be public
 * https hosts — never localhost, private / link-local IP ranges or internal names (SSRF guard).
 */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host))
    return false;
  if (host.includes(':')) return false; // IPv6 literals: never needed for a provider API
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
      return false;
  }
  return true;
}

export function codeForStatus(status: number): HealthResultCode {
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'config_incomplete';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unreachable';
  return 'provider_error';
}

export const RETRYABLE: ReadonlySet<HealthResultCode> = new Set([
  'rate_limited',
  'unreachable',
  'timeout',
  'provider_error',
]);

export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Redirects are never followed: a public endpoint must not bounce a server-side request to
    // private infrastructure (the SSRF guard only vets the configured URL).
    return await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Run a provider call and turn every failure into a safe, structured result. */
export async function callProvider<T>(
  run: () => Promise<Response>,
  parse: (response: Response) => Promise<T>,
  secrets: readonly string[] = [],
): Promise<ProviderResult<T> & { latencyMs: number }> {
  const started = Date.now();
  try {
    const response = await run();
    const latencyMs = Date.now() - started;
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
      return {
        ok: false,
        code: 'provider_error',
        message: 'redirect_not_followed',
        retryable: false,
        latencyMs,
      };
    if (!response.ok) {
      const code = codeForStatus(response.status);
      let text = '';
      try {
        text = await response.text();
      } catch {
        text = '';
      }
      return {
        ok: false,
        code,
        message: redact(`HTTP ${response.status} ${text}`, secrets),
        retryable: RETRYABLE.has(code),
        latencyMs,
      };
    }
    try {
      return { ok: true, value: await parse(response), latencyMs };
    } catch (error) {
      if (error instanceof ProviderError)
        return {
          ok: false,
          code: error.code,
          message: redact(error.message, secrets),
          retryable: error.retryable,
          latencyMs,
        };
      return {
        ok: false,
        code: 'provider_error',
        message: 'invalid_response',
        retryable: false,
        latencyMs,
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = error instanceof Error && error.name === 'AbortError';
    const code: HealthResultCode = aborted ? 'timeout' : 'unreachable';
    return {
      ok: false,
      code,
      message: redact(error instanceof Error ? error.message : String(error), secrets),
      retryable: true,
      latencyMs,
    };
  }
}

export function toHealth(
  result: ProviderResult<unknown> & { latencyMs: number | null },
): HealthResult {
  return result.ok
    ? { ok: true, code: 'connected', message: null, latencyMs: result.latencyMs }
    : { ok: false, code: result.code, message: result.message, latencyMs: result.latencyMs };
}

/**
 * Lightweight circuit breaker (mirrors app.integration_store_check): three failures in a row
 * pause outbound calls for five minutes; one success closes it.
 */
export const CIRCUIT_FAILURES = 3;
export const CIRCUIT_PAUSE_MS = 5 * 60 * 1000;

export function nextCircuit(
  state: { consecutiveFailures: number; circuitOpenUntil: string | null },
  ok: boolean,
  now: Date = new Date(),
) {
  if (ok) return { consecutiveFailures: 0, circuitOpenUntil: null };
  const failures = state.consecutiveFailures + 1;
  return {
    consecutiveFailures: failures,
    circuitOpenUntil:
      failures >= CIRCUIT_FAILURES
        ? new Date(now.getTime() + CIRCUIT_PAUSE_MS).toISOString()
        : state.circuitOpenUntil,
  };
}

/**
 * Delivery retry policy (mirrors integration_record_delivery): a failure re-queues after 1, 5
 * then 30 minutes; the third failed attempt is final until a manual retry (max 5 attempts).
 */
export const MAX_AUTOMATIC_ATTEMPTS = 3;
export const MAX_MANUAL_ATTEMPTS = 5;

export function retryAfterFailure(attempts: number, now: Date = new Date()) {
  if (attempts >= MAX_AUTOMATIC_ATTEMPTS) return { status: 'failed' as const, nextRetryAt: null };
  const minutes = attempts <= 1 ? 1 : attempts === 2 ? 5 : 30;
  return {
    status: 'queued' as const,
    nextRetryAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
  };
}
