import { useQuery } from '@tanstack/react-query';
import { CircleAlert, PackageOpen, ShoppingBag } from 'lucide-react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { BidiText } from '@/components/text/BidiText';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { Money, OrderStatusBadge, PaymentStatusBadge, Thumb } from './CommerceParts';
import styles from './commerce.module.css';

/** The signed-in customer's own orders (RLS/ownership enforced by the backend). */
export function MyOrders() {
  const { t, format, locale } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const orders = useQuery({
    queryKey: ['orders', session?.userId ?? null],
    queryFn: () => repositories.commerce.listMyOrders(),
    enabled: Boolean(session),
  });

  if (orders.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton height="96px" />
      </div>
    );
  }
  if (orders.isError) {
    return (
      <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
        <CircleAlert aria-hidden="true" />
        <span>{t('account.ordersError')}</span>
      </p>
    );
  }
  if (orders.data.length === 0) {
    return (
      <StateMessage
        headingLevel={3}
        icon={<PackageOpen />}
        title={t('account.ordersEmpty')}
        actions={
          <ButtonLink to="/store" variant="primary" icon={<ShoppingBag aria-hidden="true" />}>
            {t('account.browseStore')}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <ul className={styles.orderList}>
      {orders.data.map((order) => (
        <li key={order.orderNumber}>
          <LocaleLink to={`/order/${order.orderNumber}`} className={styles.orderCard}>
            <Thumb src={order.firstItem?.imageUrl ?? null} />
            <div className={styles.lineBody}>
              <span className={styles.lineName}>
                <bdi dir="ltr">{order.orderNumber}</bdi>
                {order.isDemo && (
                  <>
                    {' '}
                    <span className={styles.demoTag}>{t('order.demoOrder')}</span>
                  </>
                )}
              </span>
              {order.firstItem && (
                <span className={styles.lineMeta}>
                  <BidiText text={resolveLocalized(order.firstItem.name, locale)} />
                  {order.itemCount > 1 && (
                    <span>{t('account.orderMoreItems', { count: order.itemCount - 1 })}</span>
                  )}
                </span>
              )}
              <span className={styles.lineMeta}>
                <time dateTime={order.createdAt}>{format.date(order.createdAt)}</time>
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.paymentStatus} />
              </span>
            </div>
            <div className={styles.linePrice}>
              <Money amount={order.total} />
              {order.shippingFeeStatus === 'pending' && (
                <span className={styles.amountOld}>{t('checkout.totalBeforeShipping')}</span>
              )}
            </div>
          </LocaleLink>
        </li>
      ))}
    </ul>
  );
}
