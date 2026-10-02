import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '@/runtime/context';

/**
 * Public integration flags (analytics measurement ID when enabled, social sign-in buttons).
 * Nothing else about a provider ever reaches the storefront.
 */
export function useStorefrontIntegrations() {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'integrations'],
    queryFn: () => repositories.integrations.storefront(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
