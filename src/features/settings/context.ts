import { createContext, useContext } from 'react';
import type { PublicSettings } from '@/domain/settings/registry';
import type { ResolvedSettings } from '@/domain/settings/resolve';

export interface SettingsContextValue extends ResolvedSettings {
  /** True when the backend could not be reached and bundled base settings are shown. */
  loadFailed: boolean;
  refetch: () => void;
}

/** Public, non-user-scoped: the only query kept across sign-in/sign-out (see AuthProvider). */
export const SETTINGS_QUERY_KEY = ['settings', 'published'] as const;

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettingsContext(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}

/** Published public site settings (validated, with bundled fallbacks). */
export function useSettings(): PublicSettings {
  return useSettingsContext().settings;
}
