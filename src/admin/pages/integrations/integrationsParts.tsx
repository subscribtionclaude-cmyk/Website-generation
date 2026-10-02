import { CircleAlert, CircleCheck, CircleDashed, CirclePause, PlugZap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { IntegrationConfig } from '@/domain/integrations/schemas';
import type { IntegrationState } from '@/domain/integrations/status';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n } from '../../i18n/context';
import { STATE_TONE, statusOf } from './integrationsUtils';

const STATE_ICON: Record<IntegrationState, ReactNode> = {
  not_configured: <CircleDashed aria-hidden="true" />,
  disabled: <CirclePause aria-hidden="true" />,
  untested: <PlugZap aria-hidden="true" />,
  connected: <CircleCheck aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
};

export function StateBadge({ state }: { state: IntegrationState }) {
  const { at } = useAdminI18n();
  return (
    <Badge tone={STATE_TONE[state]} icon={STATE_ICON[state]}>
      {at(`integrationsAdmin.state.${state}`)}
    </Badge>
  );
}

/** Status badges shown on cards and detail headers. */
export function IntegrationBadges({ config }: { config: IntegrationConfig }) {
  const { at } = useAdminI18n();
  const { mode } = useRuntime();
  const status = statusOf(config);
  return (
    <>
      <StateBadge state={status.state} />
      <Badge>{at('integrationsAdmin.badge.optional')}</Badge>
      {status.requiresSubscription ? (
        <Badge tone="warning">{at('integrationsAdmin.badge.requiresSubscription')}</Badge>
      ) : status.mayRequireSubscription ? (
        <Badge>{at('integrationsAdmin.badge.mayRequireSubscription')}</Badge>
      ) : (
        <Badge tone="brand">{at('integrationsAdmin.badge.free')}</Badge>
      )}
      {status.fallbackActive && <Badge tone="info">{at('integrationsAdmin.badge.fallback')}</Badge>}
      {status.circuitOpen && <Badge tone="danger">{at('integrationsAdmin.badge.circuit')}</Badge>}
      {mode === 'demo' && config.provider && config.key !== 'google_analytics' && (
        <Badge tone="warning">{at('integrationsAdmin.badge.mock')}</Badge>
      )}
    </>
  );
}
