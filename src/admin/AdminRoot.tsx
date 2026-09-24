import { useMemo } from 'react';
import { Outlet } from 'react-router';
import { I18nProvider } from '@/i18n/I18nProvider';
import { useDocumentLocale } from '@/i18n/useDocumentLocale';
import { createTranslator } from '@/i18n/translator';
import { adminAr } from './i18n/ar';
import { AdminI18nContext, type AdminI18nValue, type AdminMessageKey } from './i18n/context';
import { adminEn } from './i18n/en';
import { AdminLocaleContext } from './AdminLocaleContext';
import { useAdminLocale } from './useAdminLocale';

/** Root of the lazily-loaded admin area: per-user dashboard language + admin dictionary. */
export function AdminRoot() {
  const [locale, setLocale] = useAdminLocale();
  const adminI18n = useMemo<AdminI18nValue>(
    () => ({ at: createTranslator<AdminMessageKey>(locale === 'en' ? adminEn : adminAr, adminAr) }),
    [locale],
  );
  const localeControl = useMemo(() => ({ setLocale }), [setLocale]);
  useDocumentLocale(locale);

  return (
    <I18nProvider locale={locale}>
      <AdminI18nContext.Provider value={adminI18n}>
        <AdminLocaleContext.Provider value={localeControl}>
          <Outlet />
        </AdminLocaleContext.Provider>
      </AdminI18nContext.Provider>
    </I18nProvider>
  );
}
