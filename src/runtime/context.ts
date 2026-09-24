import { createContext, useContext } from 'react';
import type { AppRuntime } from './types';

export const RuntimeContext = createContext<AppRuntime | null>(null);

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside <RuntimeContext.Provider>');
  return runtime;
}

export function useIsDemoMode(): boolean {
  return useRuntime().mode === 'demo';
}
