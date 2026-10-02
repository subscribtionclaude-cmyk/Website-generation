import { useQuery } from '@tanstack/react-query';
import type { BadgeTone } from '@/components/ui/Badge';
import type { HealthResult } from '@/domain/integrations/adapters';
import { integrationSpec, type IntegrationKey } from '@/domain/integrations/catalog';
import type { IntegrationConfig } from '@/domain/integrations/schemas';
import { deriveStatus, type IntegrationState } from '@/domain/integrations/status';
import { useRuntime } from '@/runtime/context';
import type { useAdminI18n, AdminMessageKey } from '../../i18n/context';

export const STATE_TONE: Record<IntegrationState, BadgeTone> = {
  not_configured: 'neutral',
  disabled: 'neutral',
  untested: 'info',
  connected: 'success',
  error: 'danger',
};

/** Overview groups (cards are grouped by what the store owner thinks about, not by vendor). */
export const GROUPS: { id: string; keys: IntegrationKey[] }[] = [
  { id: 'messaging', keys: ['whatsapp', 'sms', 'email'] },
  { id: 'commerce', keys: ['odoo', 'pos', 'courier'] },
  { id: 'insights', keys: ['google_analytics'] },
  { id: 'content', keys: ['ai'] },
  { id: 'infrastructure', keys: ['search', 'storage', 'backup'] },
  { id: 'signIn', keys: ['social_auth'] },
];

export function useIntegrationsRepo() {
  return useRuntime().repositories.integrations;
}

export function useIntegrationsOverview() {
  const repo = useIntegrationsRepo();
  return useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => repo.overview() });
}

export function statusOf(config: IntegrationConfig) {
  return deriveStatus({
    key: config.key as IntegrationKey,
    provider: config.provider,
    enabled: config.enabled,
    settings: config.settings,
    lastCheckStatus: config.lastCheckStatus,
    circuitOpenUntil: config.circuitOpenUntil,
  });
}

export function integrationName(at: ReturnType<typeof useAdminI18n>['at'], key: string) {
  return at(`integrationsAdmin.name.${key}` as AdminMessageKey);
}

/** Human text for a health code + safe message (never raw provider output). */
export function healthText(
  at: ReturnType<typeof useAdminI18n>['at'],
  code: string | null,
  message: string | null,
) {
  const codeText = code
    ? at(`integrationsAdmin.code.${code}` as AdminMessageKey)
    : at('integrationsAdmin.card.never');
  const detail = messageText(at, message);
  return detail ? `${codeText} — ${detail}` : codeText;
}

export function messageText(at: ReturnType<typeof useAdminI18n>['at'], message: string | null) {
  if (!message) return null;
  const [head, tail] = message.split(':');
  const known = [
    'no_provider',
    'adapter_not_installed',
    'missing_secret',
    'format_verified',
    'invalid_measurement_id',
    'provider_off',
    'supabase_not_configured',
    'endpoint_not_public',
  ];
  if (head && known.includes(head))
    return at(`integrationsAdmin.message.${head}` as AdminMessageKey, {
      names: (tail ?? '').split(',').join(', '),
    });
  // Mock / provider summaries are already redacted server-side; keep them short.
  return message.slice(0, 160);
}

export function testOutcomeText(
  at: ReturnType<typeof useAdminI18n>['at'],
  key: string,
  health: HealthResult,
  mock: boolean,
) {
  if (!health.ok)
    return at('integrationsAdmin.test.failed', {
      code: healthText(at, health.code, health.message),
    });
  if (key === 'google_analytics') return at('integrationsAdmin.test.gaFormat');
  return mock ? at('integrationsAdmin.test.okMock') : at('integrationsAdmin.test.ok');
}

export function specOf(key: string) {
  return integrationSpec(key as IntegrationKey);
}
