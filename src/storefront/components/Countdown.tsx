import { Timer } from 'lucide-react';
import { useNow } from '@/hooks/useNow';
import { useI18n } from '@/i18n/context';
import { countdownParts } from '@/domain/content/time';
import styles from './content.module.css';

/**
 * Live countdown derived from the offer's end timestamp (never hard-coded numbers).
 * Screen readers get one summary (not a per-second live region).
 */
export function Countdown({ endsAt }: { endsAt: string }) {
  const { t, format } = useI18n();
  const now = useNow(1000);
  const parts = countdownParts(endsAt, now);
  if (!parts) return <span className={styles.countdown}>{t('offers.ended')}</span>;
  const units: [number, string][] = [
    [parts.days, t('offers.days')],
    [parts.hours, t('offers.hours')],
    [parts.minutes, t('offers.minutes')],
    [parts.seconds, t('offers.seconds')],
  ];
  return (
    <span className={styles.countdown}>
      <Timer aria-hidden="true" width={16} height={16} />
      <span className="visually-hidden">
        {t('offers.countdownLabel', {
          days: parts.days,
          hours: parts.hours,
          minutes: parts.minutes,
        })}
      </span>
      <span aria-hidden="true">{t('offers.endsIn')}</span>
      <span className={styles.countdownUnits} aria-hidden="true">
        {units.map(([value, label]) => (
          <span key={label} className={styles.countdownUnit}>
            <strong>{format.number(value).padStart(2, format.number(0))}</strong>
            <span>{label}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
