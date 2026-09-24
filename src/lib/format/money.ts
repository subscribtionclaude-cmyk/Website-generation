import { intlLocaleFor, type Locale, type NumeralSystem } from '@/i18n/config';

/** V1 sells in Egyptian pounds only. Prices are FINAL prices (VAT is not shown as a separate line). */
export const DEFAULT_CURRENCY = 'EGP';

export interface NumberFormatContext {
  locale: Locale;
  numerals: NumeralSystem;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, locale: string, options: Intl.NumberFormatOptions) {
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Round to piasters (2 dp), half away from zero, avoiding binary float artefacts (1.005 → 1.01). */
export function roundMoney(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(amount) * 100 + Number.EPSILON * 100)) / 100;
}

export interface FormatMoneyOptions extends NumberFormatContext {
  /** `auto` hides `.00` for whole amounts (typical for device prices) and shows 2 dp otherwise. */
  fractionDigits?: 'auto' | 0 | 2;
  currency?: string;
}

/**
 * Format an amount in EGP.
 *   ar → "25,000 ج.م."   (Latin digits by default; Arabic-Indic available via settings)
 *   en → "EGP 25,000"
 */
export function formatMoney(amount: number, options: FormatMoneyOptions): string {
  if (!Number.isFinite(amount)) return '—';
  const rounded = roundMoney(amount);
  const mode = options.fractionDigits ?? 'auto';
  const digits = mode === 'auto' ? (Number.isInteger(rounded) ? 0 : 2) : mode;
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const locale = intlLocaleFor(options.locale, options.numerals);
  return getFormatter(`money|${locale}|${currency}|${digits}`, locale, {
    style: 'currency',
    currency,
    currencyDisplay: options.locale === 'en' ? 'code' : 'symbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rounded);
}

export function formatNumber(value: number, options: NumberFormatContext): string {
  if (!Number.isFinite(value)) return '—';
  const locale = intlLocaleFor(options.locale, options.numerals);
  return getFormatter(`number|${locale}`, locale, { maximumFractionDigits: 2 }).format(value);
}
