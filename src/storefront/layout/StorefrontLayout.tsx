import { useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { DemoModeBanner } from '@/features/data-mode/DemoModeBanner';
import { useSettingsContext } from '@/features/settings/context';
import { WhatsAppMessageContext } from '@/features/whatsapp/context';
import { WhatsAppFab } from '@/features/whatsapp/WhatsAppFab';
import type { Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/context';
import { I18nProvider } from '@/i18n/I18nProvider';
import { useDocumentLocale } from '@/i18n/useDocumentLocale';
import { MobileTabBar } from './MobileTabBar';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SkipLink } from './SkipLink';
import styles from './StorefrontLayout.module.css';

/** Public storefront shell. Browsing never requires login. */
export function StorefrontLayout({ locale }: { locale: Locale }) {
  return (
    <I18nProvider locale={locale}>
      <StorefrontShell />
    </I18nProvider>
  );
}

function StorefrontShell() {
  const { locale, t } = useI18n();
  const { loadFailed, refetch } = useSettingsContext();
  useDocumentLocale(locale);
  const [message, setMessage] = useState<string | null>(null);
  const whatsapp = useMemo(() => ({ message, setMessage }), [message]);

  return (
    <WhatsAppMessageContext value={whatsapp}>
      <div className={styles.shell}>
        <SkipLink />
        <DemoModeBanner />
        <SiteHeader />
        {loadFailed && (
          <div className={`container ${styles.notice}`}>
            <Alert
              tone="warning"
              live
              action={
                <Button size="sm" variant="secondary" onClick={refetch}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('errors.backendUnavailable')}
            </Alert>
          </div>
        )}
        <main id="main-content" tabIndex={-1} className={styles.main}>
          <Outlet />
        </main>
        <SiteFooter />
        <MobileTabBar />
        <WhatsAppFab />
      </div>
    </WhatsAppMessageContext>
  );
}
