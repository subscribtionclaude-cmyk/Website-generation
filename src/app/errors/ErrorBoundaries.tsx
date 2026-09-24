import { House, Phone, RotateCcw, ServerCrash } from 'lucide-react';
import { useContext } from 'react';
import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { SettingsContext } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { I18nProvider } from '@/i18n/I18nProvider';
import { parseLocalePath } from '@/i18n/paths';
import { toTelHref } from '@/lib/phone';
import { NotFoundPage } from '@/storefront/pages/NotFoundPage';

function ErrorContent() {
  const { t } = useI18n();
  const settings = useContext(SettingsContext)?.settings;
  const phone = settings?.store.branches[0]?.phones[0];
  const tel = phone ? toTelHref(phone) : null;
  return (
    <div className="container" style={{ paddingBlock: 'var(--space-12)' }}>
      <StateMessage
        headingLevel={1}
        role="alert"
        icon={<ServerCrash />}
        title={t('errors.genericTitle')}
        body={t('errors.genericBody')}
        actions={
          <>
            <Button
              variant="primary"
              icon={<RotateCcw aria-hidden="true" />}
              onClick={() => window.location.reload()}
            >
              {t('common.retry')}
            </Button>
            <ButtonLink to="/" variant="secondary" icon={<House aria-hidden="true" />}>
              {t('common.backHome')}
            </ButtonLink>
            {tel && (
              <a className={buttonClassName({ variant: 'ghost' })} href={tel}>
                <Phone aria-hidden="true" />
                {t('common.contactUs')}
              </a>
            )}
          </>
        }
      />
    </div>
  );
}

/** Errors inside a layout (storefront/admin page): keeps header, footer and navigation usable. */
export function PageErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (import.meta.env.DEV) console.error(error);
  return <ErrorContent />;
}

/** Last-resort boundary above all layouts (e.g. a layout itself failed to render). */
export function RootErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  if (import.meta.env.DEV) console.error(error);
  const { locale } = parseLocalePath(location.pathname);
  return (
    <I18nProvider locale={locale}>
      <ErrorContent />
    </I18nProvider>
  );
}
