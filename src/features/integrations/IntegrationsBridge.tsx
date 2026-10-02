import { lazy, Suspense } from 'react';
import { useRuntime } from '@/runtime/context';
import { useStorefrontIntegrations } from './useStorefrontIntegrations';

const AnalyticsConsent = lazy(() =>
  import('./AnalyticsConsent').then((m) => ({ default: m.AnalyticsConsent })),
);

/**
 * Storefront hook-in for optional integrations. Renders nothing (and downloads nothing) unless
 * the owner enabled Google Analytics; the consent banner and GA loader live in a lazy chunk.
 */
export function IntegrationsBridge() {
  const { mode } = useRuntime();
  const { data } = useStorefrontIntegrations();
  if (!data?.analytics) return null;
  return (
    <Suspense fallback={null}>
      <AnalyticsConsent measurementId={data.analytics.measurementId} demo={mode === 'demo'} />
    </Suspense>
  );
}
