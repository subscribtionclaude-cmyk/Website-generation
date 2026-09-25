import { GitCompareArrows, X } from 'lucide-react';
import { useLocation } from 'react-router';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { useCustomerLists } from '@/features/customer/context';
import { useI18n } from '@/i18n/context';
import styles from './customer.module.css';

/** Slim bar shown while products are selected for comparison (hidden on the compare page). */
export function CompareTray() {
  const { t } = useI18n();
  const { compare } = useCustomerLists();
  const { pathname } = useLocation();
  if (compare.items.length === 0 || /\/compare$/.test(pathname)) return null;
  return (
    <aside className={`${styles.tray} print-hidden`} aria-label={t('compare.trayLabel')}>
      <GitCompareArrows aria-hidden="true" />
      <LocaleLink to="/compare" className={styles.trayLink}>
        {t('compare.view', { count: compare.items.length, max: compare.max })}
      </LocaleLink>
      <button type="button" className={styles.trayClear} onClick={compare.clear}>
        <X aria-hidden="true" />
        <span className="visually-hidden">{t('compare.clear')}</span>
      </button>
    </aside>
  );
}
