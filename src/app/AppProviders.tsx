import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { RuntimeContext } from '@/runtime/context';
import type { AppRuntime } from '@/runtime/types';
import { createQueryClient } from './queryClient';

/** Provider order: runtime (adapters) → query cache → published settings → auth session. */
export function AppProviders({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <AuthProvider>{children}</AuthProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
}
