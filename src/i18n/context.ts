import { createContext, useContext } from 'react';
import type { Locale, LocaleMeta, NumeralSystem } from './config';
import type { ar } from './messages/ar';
import type { servicesAr } from './messages/services.ar';
import type { MessageParams, MessagePath } from './types';
import type { Weekday } from '@/lib/time/zoned';

/** Core keys plus lazily registered feature dictionaries (type-only; no bundle cost). */
export type CoreMessageKey = MessagePath<typeof ar> | MessagePath<typeof servicesAr>;

export interface Formatters {
  money(amount: number, options?: { fractionDigits?: 'auto' | 0 | 2 }): string;
  number(value: number): string;
  dateTime(value: Date | string): string;
  date(value: Date | string): string;
  time(value: Date | string): string;
  /** Wall-clock "HH:MM" → "1:00 PM" / "1:00 م". */
  clock(hhmm: string): string;
  weekday(day: Weekday, style?: 'long' | 'short'): string;
}

export interface I18nContextValue {
  locale: Locale;
  meta: LocaleMeta;
  numerals: NumeralSystem;
  t: (key: CoreMessageKey, params?: MessageParams) => string;
  format: Formatters;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
