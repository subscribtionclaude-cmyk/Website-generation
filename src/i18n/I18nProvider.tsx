import { useContext, useMemo, type ReactNode } from 'react';
import { formatMoney, formatNumber } from '@/lib/format/money';
import {
  formatClockTime,
  formatDate,
  formatDateTime,
  formatTime,
  formatWeekday,
} from '@/lib/time/zoned';
import { SettingsContext } from '@/features/settings/context';
import { LOCALE_META, type Locale, type NumeralSystem } from './config';
import { I18nContext, type CoreMessageKey, type I18nContextValue } from './context';
import { ar } from './messages/ar';
import { en } from './messages/en';
import { createTranslator } from './translator';

const DICTIONARIES = { ar, en } as const;

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Numeral style is an admin setting; outside the settings provider (e.g. fatal error screens) use Latin digits.
  const numerals: NumeralSystem =
    useContext(SettingsContext)?.settings.localization.numerals ?? 'latn';

  const value = useMemo<I18nContextValue>(() => {
    const ctx = { locale, numerals };
    return {
      locale,
      meta: LOCALE_META[locale],
      numerals,
      t: createTranslator<CoreMessageKey>(DICTIONARIES[locale], ar),
      format: {
        money: (amount, options) => formatMoney(amount, { ...ctx, ...options }),
        number: (value) => formatNumber(value, ctx),
        dateTime: (value) => formatDateTime(value, ctx),
        date: (value) => formatDate(value, ctx),
        time: (value) => formatTime(value, ctx),
        clock: (hhmm) => formatClockTime(hhmm, ctx),
        weekday: (day, style) => formatWeekday(day, ctx, style),
      },
    };
  }, [locale, numerals]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
