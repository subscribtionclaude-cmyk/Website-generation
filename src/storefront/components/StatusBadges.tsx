import {
  CircleCheck,
  CircleSlash,
  Clock3,
  FlaskConical,
  Hourglass,
  Sparkles,
  Tag,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { AvailabilityState, OfferBadge, StockState } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import styles from './catalog.module.css';

const STOCK: Record<StockState, { key: CoreMessageKey; Icon: typeof CircleCheck }> = {
  in_stock: { key: 'catalog.inStock', Icon: CircleCheck },
  low_stock: { key: 'catalog.lowStock', Icon: TriangleAlert },
  out_of_stock: { key: 'catalog.outOfStock', Icon: CircleSlash },
};

/** Stock state as icon + text (never colour alone). */
export function StockStatus({
  state,
  availability = 'available',
}: {
  state: StockState;
  availability?: AvailabilityState;
}) {
  const { t } = useI18n();
  if (availability !== 'available') {
    const key: CoreMessageKey =
      availability === 'coming_soon'
        ? 'catalog.comingSoon'
        : availability === 'pre_order'
          ? 'catalog.preOrder'
          : 'catalog.waitlistOnly';
    return (
      <span className={`${styles.stock} ${styles['stock-out_of_stock']}`}>
        <Clock3 aria-hidden="true" />
        {t(key)}
      </span>
    );
  }
  const { key, Icon } = STOCK[state];
  return (
    <span className={`${styles.stock} ${styles[`stock-${state}`]}`}>
      <Icon aria-hidden="true" />
      {t(key)}
    </span>
  );
}

interface BadgeInput {
  isNew: boolean;
  availabilityState: AvailabilityState;
  offer: OfferBadge | null;
  isDemo: boolean;
}

/** New / Coming soon / Offer / Demo badges. The Demo tag only shows in live (staging) mode. */
export function ProductBadges({ product, max = 2 }: { product: BadgeInput; max?: number }) {
  const { t, locale } = useI18n();
  const { mode } = useRuntime();
  const badges: ReactNode[] = [];
  if (
    product.availabilityState === 'coming_soon' ||
    product.availabilityState === 'waitlist_only'
  ) {
    badges.push(
      <span key="soon" className={`${styles.badge} ${styles.badgeSoon}`}>
        <Hourglass aria-hidden="true" />
        {t('catalog.comingSoon')}
      </span>,
    );
  } else if (product.availabilityState === 'pre_order') {
    badges.push(
      <span key="pre" className={`${styles.badge} ${styles.badgeSoon}`}>
        {t('catalog.preOrder')}
      </span>,
    );
  }
  if (product.offer) {
    badges.push(
      <span key="offer" className={`${styles.badge} ${styles.badgeOffer}`}>
        <Tag aria-hidden="true" />
        {resolveLocalized(product.offer.badge, locale)}
      </span>,
    );
  }
  if (product.isNew && product.availabilityState === 'available') {
    badges.push(
      <span key="new" className={`${styles.badge} ${styles.badgeNew}`}>
        <Sparkles aria-hidden="true" />
        {t('catalog.new')}
      </span>,
    );
  }
  if (product.isDemo && mode === 'live') {
    badges.unshift(
      <span key="demo" className={`${styles.badge} ${styles.badgeDemo}`}>
        <FlaskConical aria-hidden="true" />
        {t('catalog.demo')}
      </span>,
    );
  }
  if (badges.length === 0) return null;
  return (
    <div className={styles.badges}>
      {badges.slice(0, max + (product.isDemo && mode === 'live' ? 1 : 0))}
    </div>
  );
}
