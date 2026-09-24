import { useEffect } from 'react';
import { LOCALE_META, type Locale } from './config';

/** Keep <html lang/dir> in sync with the active UI locale (drives fonts, RTL/LTR and screen readers). */
export function useDocumentLocale(locale: Locale): void {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = LOCALE_META[locale].htmlLang;
    root.dir = LOCALE_META[locale].dir;
  }, [locale]);
}
