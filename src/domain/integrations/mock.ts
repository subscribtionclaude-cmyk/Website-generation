import type {
  AiProvider,
  CourierProvider,
  ErpProvider,
  ExternalRecord,
  HealthResult,
  NotificationProvider,
  OutboundMessage,
  ProviderResult,
  SearchProvider,
} from './adapters.ts';
import { providerCapabilities, type IntegrationKey, type SyncDomain } from './catalog.ts';

/**
 * Deterministic MOCK providers for demo mode and automated tests. No network, no credentials, no
 * randomness: the outcome is the chosen scenario. Every mock reports `isMock: true` and its results
 * are labelled "DEMO / MOCK" in the admin — never shown as a real connection. Live mode never falls
 * back to these.
 */
export const MOCK_SCENARIOS = [
  'success',
  'auth_failed',
  'timeout',
  'rate_limited',
  'provider_error',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

const FAILURES: Record<
  Exclude<MockScenario, 'success'>,
  { code: HealthResult['code']; message: string; retryable: boolean }
> = {
  auth_failed: {
    code: 'auth_failed',
    message: 'MOCK: the provider rejected the credentials.',
    retryable: false,
  },
  timeout: {
    code: 'timeout',
    message: 'MOCK: the provider did not answer in time.',
    retryable: true,
  },
  rate_limited: {
    code: 'rate_limited',
    message: 'MOCK: too many requests — try again later.',
    retryable: true,
  },
  provider_error: {
    code: 'provider_error',
    message: 'MOCK: the provider returned an error.',
    retryable: true,
  },
};

const MOCK_LATENCY: Record<MockScenario, number> = {
  success: 42,
  auth_failed: 35,
  timeout: 8000,
  rate_limited: 28,
  provider_error: 51,
};

function outcome<T>(scenario: MockScenario, value: () => T): ProviderResult<T> {
  if (scenario === 'success') return { ok: true, value: value() };
  const failure = FAILURES[scenario];
  return { ok: false, code: failure.code, message: failure.message, retryable: failure.retryable };
}

function base(key: IntegrationKey, scenario: MockScenario) {
  return {
    key,
    provider: 'mock',
    capabilities: providerCapabilities(key, 'mock'),
    isMock: true as const,
    testConnection(): Promise<HealthResult> {
      const result = outcome(scenario, () => null);
      return Promise.resolve(
        result.ok
          ? {
              ok: true,
              code: 'connected',
              message: 'MOCK: connection simulated (demo — no network).',
              latencyMs: MOCK_LATENCY.success,
            }
          : {
              ok: false,
              code: result.code,
              message: result.message,
              latencyMs: MOCK_LATENCY[scenario],
            },
      );
    },
  };
}

export function mockAdapter(key: IntegrationKey, scenario: MockScenario = 'success') {
  return base(key, scenario);
}

/** Simple stable hash so mock references are deterministic for the same input. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function mockNotificationProvider(
  key: 'whatsapp' | 'sms' | 'email',
  scenario: MockScenario = 'success',
): NotificationProvider & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    ...base(key, scenario),
    sent,
    send(message) {
      const result = outcome(scenario, () => ({
        externalRef: `mock-${key}-${hash(message.idempotencyKey)}`,
      }));
      if (result.ok) sent.push(message);
      return Promise.resolve(result);
    },
  };
}

/** Deterministic external catalogue used by the ERP/POS mocks (matches seeded demo SKUs by design of the caller). */
export function mockErpProvider(
  key: 'odoo' | 'pos',
  records: Partial<Record<SyncDomain, ExternalRecord[]>>,
  scenario: MockScenario = 'success',
): ErpProvider {
  return {
    ...base(key, scenario),
    fetchRecords(domain, options) {
      return Promise.resolve(
        outcome(scenario, () => (records[domain] ?? []).slice(0, options?.limit ?? 500)),
      );
    },
  };
}

export function mockCourierProvider(scenario: MockScenario = 'success'): CourierProvider {
  return {
    ...base('courier', scenario),
    quote(request) {
      return Promise.resolve(
        outcome(scenario, () => ({
          fee: 50 + request.parcel.items * 10,
          currency: 'EGP' as const,
          etaDays: 3,
        })),
      );
    },
    createShipment(request) {
      return Promise.resolve(
        outcome(scenario, () => ({
          trackingNumber: `MOCK-${hash(request.idempotencyKey).toUpperCase()}`,
          status: 'created' as const,
        })),
      );
    },
    track(trackingNumber) {
      return Promise.resolve(
        outcome(scenario, () => ({ trackingNumber, status: 'in_transit' as const })),
      );
    },
    cancel(trackingNumber) {
      return Promise.resolve(
        outcome(scenario, () => ({ trackingNumber, status: 'cancelled' as const })),
      );
    },
  };
}

export function mockAiProvider(scenario: MockScenario = 'success'): AiProvider {
  return {
    ...base('ai', scenario),
    suggest(input) {
      return Promise.resolve(
        outcome(scenario, () => {
          const specs = input.specs
            .slice(0, 3)
            .map((s) => `${s.label}: ${s.value}`)
            .join(input.locale === 'ar' ? '، ' : ', ');
          const brand = input.brand ? `${input.brand} ` : '';
          const text =
            input.locale === 'ar'
              ? `[مسودة تجريبية] ${brand}${input.name}${specs ? ` — ${specs}` : ''}. متوفر لدى مالك ستور مع ضمان.`
              : `[MOCK draft] ${brand}${input.name}${specs ? ` — ${specs}` : ''}. Available at Malek Store with warranty.`;
          return { text: text.slice(0, 300) };
        }),
      );
    },
  };
}

export function mockSearchProvider(
  index: { slug: string; text: string }[],
  scenario: MockScenario = 'success',
): SearchProvider {
  return {
    ...base('search', scenario),
    query(q, options) {
      const needle = q.trim().toLowerCase();
      return Promise.resolve(
        outcome(scenario, () => ({
          slugs: index
            .filter((entry) => needle && entry.text.toLowerCase().includes(needle))
            .slice(0, options?.limit ?? 20)
            .map((entry) => entry.slug),
        })),
      );
    },
  };
}
