import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ORDER_STATUSES, type OrderStatus } from '@/domain/commerce/types';
import { useAccess, useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { OrderStatusBadge, PaymentStatusBadge } from '@/storefront/commerce/CommerceParts';
import { ORDER_STATUS_LABEL } from '@/storefront/commerce/labels';
import { useAdminI18n } from '../../i18n/context';
import { useAdminPageMeta } from '../../useAdminPageMeta';
import adminStyles from '../../admin.module.css';
import styles from './orders.module.css';

/** Staff order queue: filters, review flags and reservation clean-up. */
export function AdminOrdersPage() {
  const { at } = useAdminI18n();
  const { t, format } = useI18n();
  const { repositories } = useRuntime();
  const { can } = useAccess();
  const session = useSession();
  const queryClient = useQueryClient();
  useAdminPageMeta(at('orders.title'));
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const list = useQuery({
    queryKey: ['admin-orders', session?.userId ?? null, status, reviewOnly, search],
    queryFn: () =>
      repositories.orders.listOrders({
        status: status || null,
        reviewPending: reviewOnly || undefined,
        q: search || null,
        limit: 50,
      }),
  });
  const release = useMutation({
    mutationFn: () => repositories.orders.releaseExpiredReservations(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
  });

  return (
    <>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>{at('orders.title')}</h1>
        <p className={adminStyles.pageSubtitle}>{at('orders.subtitle')}</p>
      </div>
      <div className={adminStyles.stack}>
        <form
          className={styles.filters}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(q.trim());
          }}
        >
          <div className={styles.field}>
            <label className={adminStyles.label} htmlFor="orders-q">
              {at('orders.search')}
            </label>
            <input
              id="orders-q"
              className={adminStyles.select}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="MS-2026-000001 / 010…"
              dir="ltr"
            />
          </div>
          <div className={styles.field}>
            <label className={adminStyles.label} htmlFor="orders-status">
              {at('orders.status')}
            </label>
            <select
              id="orders-status"
              className={adminStyles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
            >
              <option value="">{at('orders.allStatuses')}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(ORDER_STATUS_LABEL[s])}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={(e) => setReviewOnly(e.target.checked)}
            />
            {at('orders.reviewOnly')}
          </label>
          <Button type="submit" variant="primary" icon={<Search aria-hidden="true" />}>
            {at('orders.apply')}
          </Button>
          {can('orders.manage') && (
            <Button
              type="button"
              variant="secondary"
              icon={<RefreshCw aria-hidden="true" />}
              loading={release.isPending}
              onClick={() => release.mutate()}
            >
              {at('orders.releaseExpired')}
            </Button>
          )}
        </form>
        {release.isSuccess && (
          <Alert tone="success" live>
            {at('orders.released', { count: release.data })}
          </Alert>
        )}
        {release.isError && (
          <Alert tone="danger" live>
            {at('orders.actionFailed')}
          </Alert>
        )}

        {list.isPending && <Skeleton height="20rem" radius="var(--radius-lg)" />}
        {list.isError && (
          <Alert
            tone="danger"
            live
            action={
              <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {at('errors.loadFailed')}
          </Alert>
        )}
        {list.data && list.data.items.length === 0 && (
          <Alert tone="info">{at('orders.empty')}</Alert>
        )}
        {list.data && list.data.items.length > 0 && (
          <div
            className={adminStyles.tableWrap}
            role="region"
            aria-label={at('orders.title')}
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className={`${adminStyles.table} ${styles.table}`}>
              <caption className="visually-hidden">
                {at('orders.count', { count: list.data.total })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{at('orders.number')}</th>
                  <th scope="col">{at('orders.date')}</th>
                  <th scope="col">{at('orders.customer')}</th>
                  <th scope="col">{at('orders.status')}</th>
                  <th scope="col">{at('orders.payment')}</th>
                  <th scope="col">{at('orders.total')}</th>
                  <th scope="col">{at('orders.remaining')}</th>
                  <th scope="col">{at('orders.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <tr key={o.id}>
                    <th scope="row">
                      <Link to={`/admin/orders/${o.id}`} className={styles.orderLink}>
                        <bdi dir="ltr">{o.orderNumber}</bdi>
                      </Link>
                    </th>
                    <td>{format.dateTime(o.createdAt)}</td>
                    <td>
                      {o.customerName}
                      <br />
                      <bdi dir="ltr" className={adminStyles.muted}>
                        {o.customerPhone}
                      </bdi>
                    </td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </td>
                    <td className={styles.num}>{format.money(o.total, { fractionDigits: 2 })}</td>
                    <td className={styles.num}>
                      {format.money(o.remainingAmount, { fractionDigits: 2 })}
                    </td>
                    <td>
                      <span className={styles.flags}>
                        {o.reviewPending && (
                          <Badge tone="warning" icon={<ShieldAlert aria-hidden="true" />}>
                            {at('orders.flagReview')}
                          </Badge>
                        )}
                        {o.shippingFeeStatus === 'pending' && (
                          <Badge tone="info">{at('orders.flagShipping')}</Badge>
                        )}
                        {o.stockCommitted && (
                          <Badge tone="success">{at('orders.flagCommitted')}</Badge>
                        )}
                        {o.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
