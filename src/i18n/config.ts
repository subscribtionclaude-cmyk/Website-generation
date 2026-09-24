export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Arabic is the default public language and the fallback for missing translations. */
export const DEFAULT_LOCALE: Locale = 'ar';
export const FALLBACK_LOCALE: Locale = 'ar';

export type TextDirection = 'rtl' | 'ltr';
export type NumeralSystem = 'latn' | 'arab';

export interface LocaleMeta {
  /** Value for the <html lang> attribute. */
  htmlLang: string;
  /** Base BCP-47 tag used for Intl formatting (numbering system is appended at runtime). */
  intlLocale: string;
  dir: TextDirection;
  /** Native language name, used by the language switcher. */
  nativeName: string;
  /** Compact switcher label. */
  shortLabel: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  ar: {
    htmlLang: 'ar-EG',
    intlLocale: 'ar-EG',
    dir: 'rtl',
    nativeName: 'العربية',
    shortLabel: 'ع',
  },
  en: { htmlLang: 'en', intlLocale: 'en-EG', dir: 'ltr', nativeName: 'English', shortLabel: 'EN' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

/** BCP-47 tag with an explicit numbering system, e.g. `ar-EG-u-nu-latn`. */
export function intlLocaleFor(locale: Locale, numerals: NumeralSystem): string {
  return `${LOCALE_META[locale].intlLocale}-u-nu-${numerals}`;
}
