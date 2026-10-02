import '@/i18n/messages/integrations';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { isAnalyticsAllowedPath } from '@/domain/integrations/analytics';
import { useI18n } from '@/i18n/context';
import {
  disableGoogleAnalytics,
  loadGoogleAnalytics,
  readConsent,
  trackPageView,
  writeConsent,
  type ConsentChoice,
} from './analyticsLoader';
import styles from './AnalyticsConsent.module.css';

/**
 * Analytics consent (Phase 09). Shown only when the owner enabled Google Analytics. Accept and
 * Reject carry equal weight; "Cookie settings" in the footer reopens the choice at any time.
 * GA loads only after "Accept", only on public pages, and never in demo mode (no network).
 */
export function AnalyticsConsent({
  measurementId,
  demo,
}: {
  measurementId: string;
  demo: boolean;
}) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [choice, setChoice] = useState<ConsentChoice | null>(() => readConsent());
  const [open, setOpen] = useState(() => readConsent() === null);
  const allowed = isAnalyticsAllowedPath(pathname);
  // The footer (rendered by the same layout) is already in the DOM when this lazy chunk renders.
  const slot = document.getElementById('footer-cookie-settings');

  useEffect(() => {
    if (demo || choice !== 'granted' || !allowed) return;
    if (loadGoogleAnalytics(measurementId, pathname)) trackPageView(pathname, document.title);
  }, [demo, choice, allowed, measurementId, pathname]);

  const decide = (next: ConsentChoice) => {
    writeConsent(next);
    setChoice(next);
    setOpen(false);
    if (next === 'denied') disableGoogleAnalytics(measurementId);
  };

  const manage = slot
    ? createPortal(
        <button type="button" className={styles.manage} onClick={() => setOpen(true)}>
          {t('integrations.consent.manage')}
        </button>,
        slot,
      )
    : null;

  // Private areas (account, checkout, orders…) never show the banner or load analytics.
  if (!open || !allowed) return manage;
  return (
    <>
      {manage}
      <section
        className={styles.banner}
        aria-labelledby="analytics-consent-title"
        data-testid="analytics-consent"
      >
        <h2 id="analytics-consent-title" className={styles.title}>
          {t('integrations.consent.title')}
        </h2>
        <p className={styles.body}>{t('integrations.consent.body')}</p>
        {demo && <p className={styles.note}>{t('integrations.consent.demo')}</p>}
        {choice && (
          <p className={styles.note}>
            {t('integrations.consent.current', {
              choice: t(`integrations.consent.${choice}`),
            })}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => decide('denied')}>
            {t('integrations.consent.reject')}
          </Button>
          <Button variant="secondary" onClick={() => decide('granted')}>
            {t('integrations.consent.accept')}
          </Button>
        </div>
      </section>
    </>
  );
}
