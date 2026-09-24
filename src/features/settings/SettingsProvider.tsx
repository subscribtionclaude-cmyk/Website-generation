import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { resolveSettings } from '@/domain/settings/resolve';
import { useRuntime } from '@/runtime/context';
import { BootSplash } from '@/components/feedback/BootSplash';
import { SETTINGS_QUERY_KEY, SettingsContext, type SettingsContextValue } from './context';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { repositories } = useRuntime();
  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => resolveSettings(await repositories.settings.listPublishedSettings()),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const { data, isError, refetch } = query;
  const value = useMemo<SettingsContextValue | null>(() => {
    const retry = () => void refetch();
    if (data) return { ...data, loadFailed: false, refetch: retry };
    if (isError) {
      // Backend unavailable: keep the site usable with bundled base settings (real store details).
      return { ...resolveSettings([]), loadFailed: true, refetch: retry };
    }
    return null;
  }, [data, isError, refetch]);

  if (!value) return <BootSplash />;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
