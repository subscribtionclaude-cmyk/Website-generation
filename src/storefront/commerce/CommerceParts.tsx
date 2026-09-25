import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock3,
  Gift,
  Hourglass,
  PackageCheck,
  Tag,
  Truck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BidiText } from '@/components/text/BidiText';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type {
  LineDiscount,
  OrderStatus,
  OrderTotals,
  PaymentStatus,
  QuoteTotals,
} from '@/domain/commerce/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from './labels';
import styles from './commerce.module.css';

/** Money with a spoken label; amounts are always the backend's numbers. */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const { format } = useI18n();
  return (
    <data value={String(amount)} className={className ?? styles.amount}>
      {format.money(amount, { fractionDigits: 'auto' })}
    </data>
  );
}

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  confirmed: styles.statusGood,
  preparing: styles.statusGood,
  ready_for_pickup: styles.statusGood,
  out_for_delivery: styles.statusGood,
  delivered: styles.statusGood,
  completed: styles.statusGood,
  cancelled: styles.statusBad,
  awaiting_payment: styles.statusWait,
  payment_verification: styles.statusWait,
};

/** Status as icon + text (never colour alone). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  const Icon =
    status === 'cancelled'
      ? CircleSlash
      : status === 'completed' || status === 'delivered'
        ? PackageCheck
        : status === 'out_for_delivery'
          ? Truck
          : status === 'new'
            ? CircleDashed
            : Clock3;
  return (
    <span className={[styles.status, STATUS_TONE[status]].filter(Boolean).join(' ')}>
      <Icon aria-hidden="true" />
      {t(ORDER_STATUS_LABEL[status])}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  const good = status === 'paid' || status === 'deposit_verified';
  const Icon = good ? CircleCheck : status === 'void' ? CircleSlash : Hourglass;
  return (
    <span
      className={[
        styles.status,
        good ? styles.statusGood : status === 'void' ? styles.statusBad : styles.statusWait,
      ].join(' ')}
    >
      <Icon aria-hidden="true" />
      {t(PAYMENT_STATUS_LABEL[status])}
    </span>
  );
}

export function Thumb({ src }: { src: string | null }) {
  return (
    <span className={styles.thumb}>
      {src ? <img src={src} alt="" width={76} height={76} loading="lazy" /> : null}
    </span>
  );
}

function DiscountTags({ discounts }: { discounts: LineDiscount[] }) {
  const { t, locale } = useI18n();
  if (discounts.length === 0) return null;
  return (
    <>
      {discounts.map((d, i) => (
        <span key={`${d.offerSlug}-${i}`} className={styles.tag}>
          <Tag aria-hidden="true" />
          {d.source === 'promo' && d.code
            ? t('cart.promoApplied', { code: d.code })
            : resolveLocalized(d.title, locale)}
          {' −'}
          <Money amount={d.amount} className={styles.sku} />
        </span>
      ))}
    </>
  );
}

/** One line (quote or order): identity, variant, quantity, price and discounts. */
export function LineRow({
  line,
  compact = false,
  actions,
  notes,
}: {
  line: {
    name: string;
    productSlug: string | null;
    variantLabel: string | null;
    sku: string | null;
    image: string | null;
    quantity: number;
    unitPrice: number | null;
    regularUnitPrice: number | null;
    lineTotal: number | null;
    lineSubtotal: number | null;
    discounts: LineDiscount[];
    isGift: boolean;
    offerLabel: string | null;
  };
  compact?: boolean;
  actions?: ReactNode;
  notes?: ReactNode;
}) {
  const { t } = useI18n();
  const nameNode = <BidiText text={line.name} />;
  return (
    <li className={[styles.line, compact && styles.lineCompact].filter(Boolean).join(' ')}>
      <Thumb src={line.image} />
      <div className={styles.lineBody}>
        <div className={styles.lineTop}>
          <div className={styles.lineBody}>
            {line.productSlug && !compact ? (
              <LocaleLink to={`/product/${line.productSlug}`} className={styles.lineName}>
                {nameNode}
              </LocaleLink>
            ) : (
              <span className={styles.lineName}>{nameNode}</span>
            )}
            <span className={styles.lineMeta}>
              {line.variantLabel && <span>{line.variantLabel}</span>}
              <span>{t('cart.quantity', { count: line.quantity })}</span>
              {line.sku && !compact && <bdi className={styles.sku}>{line.sku}</bdi>}
            </span>
          </div>
          <div className={styles.linePrice}>
            {line.lineTotal !== null && <Money amount={line.lineTotal} />}
            {line.lineSubtotal !== null &&
              line.lineTotal !== null &&
              line.lineSubtotal > line.lineTotal && (
                <del className={styles.amountOld}>
                  <span className="visually-hidden">{t('catalog.oldPrice')}: </span>
                  <Money amount={line.lineSubtotal} className={styles.amountOld} />
                </del>
              )}
            {line.unitPrice !== null && line.quantity > 1 && !line.isGift && (
              <span className={styles.amountOld}>
                {t('cart.unitPrice')} <Money amount={line.unitPrice} className={styles.amountOld} />
              </span>
            )}
          </div>
        </div>
        {(line.isGift || line.offerLabel || line.discounts.length > 0) && (
          <span className={styles.lineMeta}>
            {line.isGift && (
              <span className={styles.tag}>
                <Gift aria-hidden="true" />
                {t('cart.freeGift')}
              </span>
            )}
            {line.offerLabel && !line.isGift && (
              <span className={styles.tag}>
                <Tag aria-hidden="true" />
                {line.offerLabel}
              </span>
            )}
            <DiscountTags discounts={line.discounts} />
          </span>
        )}
        {notes}
        {actions}
      </div>
    </li>
  );
}

/** Subtotal → savings → discounts → shipping (pending / free / fee) → total (→ paid / remaining). */
export function Totals({ totals }: { totals: QuoteTotals | OrderTotals }) {
  const { t } = useI18n();
  const savings = totals.originalSubtotal - totals.subtotal;
  const order = 'paidAmount' in totals ? totals : null;
  return (
    <>
      <dl className={styles.totals}>
        <div className={styles.totalRow}>
          <dt>{t('checkout.subtotal')}</dt>
          <dd>
            <Money amount={totals.originalSubtotal} />
          </dd>
        </div>
        {savings > 0 && (
          <div className={`${styles.totalRow} ${styles.totalSaving}`}>
            <dt>{t('checkout.offerSavings')}</dt>
            <dd>
              −<Money amount={savings} className={styles.amount} />
            </dd>
          </div>
        )}
        {totals.discountTotal > 0 && (
          <div className={`${styles.totalRow} ${styles.totalSaving}`}>
            <dt>{t('checkout.discounts')}</dt>
            <dd>
              −<Money amount={totals.discountTotal} className={styles.amount} />
            </dd>
          </div>
        )}
        <div className={styles.totalRow}>
          <dt>{t('checkout.shipping')}</dt>
          <dd>
            {totals.shippingFeeStatus === 'pending' ? (
              <span className={styles.pending}>{t('checkout.shippingPending')}</span>
            ) : totals.shippingFeeStatus === 'not_required' ? (
              t('checkout.shippingPickup')
            ) : (
              <Money amount={totals.shippingFee ?? 0} />
            )}
          </dd>
        </div>
        <div className={`${styles.totalRow} ${styles.totalGrand}`}>
          <dt>
            {totals.shippingFeeStatus === 'pending'
              ? t('checkout.totalBeforeShipping')
              : t('checkout.total')}
          </dt>
          <dd>
            <Money amount={totals.total} />
          </dd>
        </div>
        {order && (
          <>
            <div className={styles.totalRow}>
              <dt>{t('checkout.paid')}</dt>
              <dd>
                <Money amount={order.paidAmount} />
              </dd>
            </div>
            <div className={styles.totalRow}>
              <dt>{t('checkout.remaining')}</dt>
              <dd>
                <Money amount={order.remainingAmount} />
              </dd>
            </div>
          </>
        )}
      </dl>
      <p className={styles.taxNote}>{t('checkout.finalPriceNote')}</p>
    </>
  );
}
