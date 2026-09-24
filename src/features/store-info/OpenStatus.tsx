import { useNow } from '@/hooks/useNow';
import { useI18n } from '@/i18n/context';
import { getOpenStatus, type OpeningHoursRule } from '@/lib/time/openingHours';
import styles from './storeInfo.module.css';

/** "Open now · Closes 12:00 AM" — evaluated in Cairo time; state is conveyed by text, not colour alone. */
export function OpenStatus({
  rules,
  onDark = false,
}: {
  rules: OpeningHoursRule[];
  onDark?: boolean;
}) {
  const { t, format } = useI18n();
  const now = useNow();
  const status = getOpenStatus(rules, now);
  const next = status.nextChange;

  let detail: string | null = null;
  if (next) {
    const time = format.clock(next.time);
    if (status.isOpen) detail = t('store.closesAt', { time });
    else if (next.dayOffset === 0) detail = t('store.opensTodayAt', { time });
    else if (next.dayOffset === 1) detail = t('store.opensTomorrowAt', { time });
    else detail = t('store.opensAt', { day: format.weekday(next.weekday), time });
  }

  return (
    <p
      className={[
        styles.status,
        status.isOpen ? styles.open : styles.closed,
        onDark && styles.onDark,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span>{status.isOpen ? t('store.openNow') : t('store.closedNow')}</span>
      {detail && (
        <>
          <span aria-hidden="true">·</span>
          <span className={styles.detail}>{detail}</span>
        </>
      )}
    </p>
  );
}
