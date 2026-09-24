import { resolveLocalized } from '@/domain/localized';
import type { TrustItem } from '@/domain/settings/schemas';
import { useI18n } from '@/i18n/context';
import { DataIcon } from './icons';
import styles from './content.module.css';
import { BidiText } from '@/components/text/BidiText';

/** Settings-driven trust items (hidden items and unknown ids are skipped). */
export function TrustList({ items }: { items: TrustItem[] }) {
  const { locale } = useI18n();
  if (items.length === 0) return null;
  return (
    <ul className={styles.trust}>
      {items.map((item) => (
        <li key={item.id} className={styles.trustItem}>
          <DataIcon name={item.icon} className={styles.trustIcon} />
          <p className={styles.trustTitle}>
            <BidiText text={resolveLocalized(item.title, locale)} />
          </p>
          {item.body && <p className={styles.trustBody}>{resolveLocalized(item.body, locale)}</p>}
        </li>
      ))}
    </ul>
  );
}
