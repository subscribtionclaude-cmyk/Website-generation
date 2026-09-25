import { FlaskConical } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { useIsDemoMode } from '@/runtime/context';
import styles from './DemoModeBanner.module.css';

/** Always-visible marker so demo data can never be mistaken for live data. */
export function DemoModeBanner() {
  const isDemo = useIsDemoMode();
  const { t } = useI18n();
  if (!isDemo) return null;
  return (
    <div className={`${styles.banner} print-hidden`} role="note">
      <FlaskConical aria-hidden="true" className={styles.icon} />
      <strong>{t('dataMode.demoBanner')}</strong>
      <span className={styles.detail}>{t('dataMode.demoBannerDetail')}</span>
    </div>
  );
}
