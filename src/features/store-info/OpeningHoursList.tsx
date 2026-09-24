import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { groupOpeningHours, type OpeningHoursRule } from '@/lib/time/openingHours';
import styles from './storeInfo.module.css';

/** Grouped weekly schedule, e.g. "Saturday – Thursday: 12:00 PM – 12:00 AM". */
export function OpeningHoursList({ rules }: { rules: OpeningHoursRule[] }) {
  const { t, format } = useI18n();
  const { localization } = useSettings();
  const groups = groupOpeningHours(rules, localization.weekStartsOn);

  return (
    <dl className={styles.hours}>
      {groups.map((group) => {
        const first = group.days[0];
        const last = group.days.at(-1);
        if (first === undefined || last === undefined) return null;
        const days =
          first === last
            ? format.weekday(first)
            : t('store.dayRange', { from: format.weekday(first), to: format.weekday(last) });
        return (
          <div key={group.days.join('-')} className={styles.hoursRow}>
            <dt>{days}</dt>
            <dd>
              <bdi className="num">
                {t('store.timeRange', {
                  from: format.clock(group.open),
                  to: format.clock(group.close),
                })}
              </bdi>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
