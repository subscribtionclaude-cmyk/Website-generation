import { createContext, useContext } from 'react';
import type { MessageParams, MessagePath } from '@/i18n/types';
import type { adminAr } from './ar';

export type AdminMessageKey = MessagePath<typeof adminAr>;

export interface AdminI18nValue {
  at: (key: AdminMessageKey, params?: MessageParams) => string;
}

export const AdminI18nContext = createContext<AdminI18nValue | null>(null);

/** Admin-only translator (`at`). Shared chrome strings still come from `useI18n().t`. */
export function useAdminI18n(): AdminI18nValue {
  const value = useContext(AdminI18nContext);
  if (!value) throw new Error('useAdminI18n must be used inside the admin area');
  return value;
}
