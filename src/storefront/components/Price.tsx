import { useI18n } from '@/i18n/context';
import { discountPercent } from '@/domain/catalog/stock';
import type { AvailabilityState } from '@/domain/catalog/types';
import styles from './catalog.module.css';

interface PriceProps {
  min: number | null;
  max?: number | null;
  compareAt?: number | null;
  size?: 'md' | 'lg';
  /** Show "From X" when the price varies across variants. */
  showFrom?: boolean;
  showSaving?: boolean;
  /**
   * Without a price: an available product shows "Ask for price" (published, price not entered yet);
   * a coming-soon / pre-order / waitlist product shows "Price to be announced".
   */
  availability?: AvailabilityState;
}

/**
 * Final price in EGP (VAT not shown separately). Old price is a real <del> with a spoken label,
 * so the "Was → Now" relation isn't conveyed by strike-through styling alone.
 */
export function Price({
  min,
  max = null,
  compareAt = null,
  size = 'md',
  showFrom = true,
  showSaving = true,
  availability = 'available',
}: PriceProps) {
  const { t, format } = useI18n();
  if (min === null)
    return (
      <p className={`${styles.price} ${styles.priceTba}`}>
        {t(availability === 'available' ? 'catalog.askForPrice' : 'catalog.priceTba')}
      </p>
    );
  const varies = showFrom && max !== null && max > min;
  const percent = discountPercent(min, compareAt);
  return (
    <p className={[styles.price, size === 'lg' && styles.priceLg].filter(Boolean).join(' ')}>
      {varies && <span className={styles.priceFrom}>{t('catalog.fromLabel')}</span>}
      <span className="visually-hidden">{t('catalog.currentPrice')}: </span>
      <data className={styles.priceNow} value={String(min)}>
        {format.money(min)}
      </data>
      {percent !== null && compareAt !== null && (
        <>
          <del className={styles.priceOld}>
            <span className="visually-hidden">{t('catalog.oldPrice')}: </span>
            {format.money(compareAt)}
          </del>
          {showSaving && <span className={styles.priceSave}>{t('catalog.save', { percent })}</span>}
        </>
      )}
    </p>
  );
}
