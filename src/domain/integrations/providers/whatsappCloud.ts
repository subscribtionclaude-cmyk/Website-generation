import type { HealthResult, NotificationProvider, ProviderResult } from '../adapters.ts';
import { callProvider, fetchWithTimeout, toHealth, type FetchLike } from '../http.ts';

/**
 * WhatsApp Business Cloud API adapter (Meta Graph API). Server-side only: the access token comes
 * from the server environment (WHATSAPP_ACCESS_TOKEN) and is never stored in the database or sent
 * to the browser. Untested against a live account until the store owner configures one.
 *
 * Business-initiated messages must use an approved template: each notification event is mapped to
 * a template (Admin → Integrations → WhatsApp → template mapping) whose body has exactly one
 * variable {{1}} — the localized, customer-facing notification text. Unmapped events are never sent
 * (the router skips them and the manual wa.me link remains the path).
 */
export const WHATSAPP_SECRET_NAMES = {
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  webhookSecret: 'WHATSAPP_WEBHOOK_SECRET',
  verifyToken: 'WHATSAPP_VERIFY_TOKEN',
} as const;

const GRAPH = 'https://graph.facebook.com';

export interface WhatsappCloudOptions {
  phoneNumberId: string;
  graphVersion: string;
  accessToken: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

/** Cloud API recipients are digits with the country code (Egypt local 01… → 201…). */
export function toWhatsappRecipient(phone: string): string | null {
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^01[0125]\d{8}$/.test(digits)) digits = `2${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsappCloudProvider(options: WhatsappCloudOptions): NotificationProvider {
  const secrets = [options.accessToken];
  const base = `${GRAPH}/${encodeURIComponent(options.graphVersion)}/${encodeURIComponent(options.phoneNumberId)}`;
  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json',
  };
  return {
    key: 'whatsapp',
    provider: 'meta_cloud',
    capabilities: ['message.template', 'message.text', 'delivery.status', 'webhook'],
    isMock: false,
    async testConnection(): Promise<HealthResult> {
      const result = await callProvider(
        () =>
          fetchWithTimeout(
            options.fetch,
            `${base}?fields=display_phone_number,verified_name`,
            { headers },
            options.timeoutMs,
          ),
        async (response) => (await response.json()) as { display_phone_number?: string },
        secrets,
      );
      return toHealth(result);
    },
    async send(message): Promise<ProviderResult<{ externalRef: string | null }>> {
      const to = toWhatsappRecipient(message.to);
      if (!to)
        return {
          ok: false,
          code: 'provider_error',
          message: 'invalid_recipient',
          retryable: false,
        };
      if (!message.providerTemplate)
        return {
          ok: false,
          code: 'config_incomplete',
          message: 'template_not_mapped',
          retryable: false,
        };
      const body = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: message.providerTemplate,
          language: { code: message.locale },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: message.body.slice(0, 1000) }] },
          ],
        },
      };
      const result = await callProvider(
        () =>
          fetchWithTimeout(
            options.fetch,
            `${base}/messages`,
            { method: 'POST', headers, body: JSON.stringify(body) },
            options.timeoutMs,
          ),
        async (response) => {
          const json = (await response.json()) as { messages?: { id?: string }[] };
          return { externalRef: json.messages?.[0]?.id ?? null };
        },
        secrets,
      );
      if (!result.ok)
        return {
          ok: false,
          code: result.code,
          message: result.message,
          retryable: result.retryable,
        };
      return { ok: true, value: result.value };
    },
  };
}

export interface WhatsappStatusEvent {
  /** Unique per message × status (Meta resends webhooks; duplicates are ignored by event ID). */
  eventId: string;
  externalRef: string;
  status: 'sent' | 'delivered' | 'failed';
}

const STATUS_MAP: Record<string, WhatsappStatusEvent['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  failed: 'failed',
};

/** Extract delivery receipts from a Cloud API webhook payload (anything else is ignored). */
export function parseWhatsappStatuses(payload: unknown): WhatsappStatusEvent[] {
  const events: WhatsappStatusEvent[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const item of statuses) {
        const { id, status } = (item ?? {}) as { id?: unknown; status?: unknown };
        const mapped = typeof status === 'string' ? STATUS_MAP[status] : undefined;
        if (typeof id !== 'string' || !mapped || id.length > 200) continue;
        events.push({
          eventId: `${id}:${String(status)}`.slice(0, 200),
          externalRef: id,
          status: mapped,
        });
      }
    }
  }
  return events;
}
