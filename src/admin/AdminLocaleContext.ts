import { createContext, useContext } from 'react';
import type { Locale } from '@/i18n/config';

export const AdminLocaleContext = createContext<{ setLocale: (locale: Locale) => void } | null>(
  null,
);

export function useSetAdminLocale(): (locale: Locale) => void {
  const value = useContext(AdminLocaleContext);
  if (!value) throw new Error('useSetAdminLocale must be used inside <AdminRoot>');
  return value.setLocale;
}
