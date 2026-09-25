import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n } from '../../i18n/context';
import { useAdminPageMeta } from '../../useAdminPageMeta';
import adminStyles from '../../admin.module.css';
import orderStyles from '../orders/orders.module.css';
import styles from './customers.module.css';

/**
 * Minimal abandoned-cart view (derived from cart timestamps; no payment data, no tracking).
 * Follow-up is a single in-app reminder per idle period, sent by the database when enabled.
 */
export function AdminAbandonedCartsPage() {
  const { at } = useAdminI18n();
  const { t, format, locale } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  useAdminPageMeta(at('abandonedAdmin.title'));
  const list = useQuery({
    queryKey: ['admin-abandoned-carts', session?.userId ?? null],
    queryFn: () => repositories.customerOps.listAbandonedCarts(),
  });

  return (
    <>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>{at('abandonedAdmin.title')}</h1>
        <p className={adminStyles.pageSubtitle}>{at('abandonedAdmin.subtitle')}</p>
      </div>
      <div className={adminStyles.stack}>
        {list.isPending && <Skeleton height="12rem" radius="var(--radius-lg)" />}
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
        {list.data && (
          <Alert tone="info">
            {list.data.settings.enabled
              ? at('abandonedAdmin.settings', {
                  hours: list.data.settings.thresholdHours,
                  mode:
                    list.data.settings.followUp === 'in_app'
                      ? at('abandonedAdmin.modeInApp')
                      : at('abandonedAdmin.modeNone'),
                })
              : at('abandonedAdmin.disabled')}
          </Alert>
        )}
        {list.data && list.data.items.length === 0 && (
          <p className={adminStyles.muted}>{at('abandonedAdmin.empty')}</p>
        )}
        {list.data && list.data.items.length > 0 && (
          <div
            className={adminStyles.tableWrap}
            role="region"
            aria-label={at('abandonedAdmin.title')}
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className={`${adminStyles.table} ${orderStyles.table}`}>
              <caption className="visually-hidden">
                {at('abandonedAdmin.count', { count: list.data.total })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{at('abandonedAdmin.customer')}</th>
                  <th scope="col">{at('abandonedAdmin.items')}</th>
                  <th scope="col">{at('abandonedAdmin.lastActivity')}</th>
                  <th scope="col">{at('abandonedAdmin.reminded')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.customerId}>
                    <th scope="row">
                      {row.customerName ?? '—'}
                      {row.email && (
                        <>
                          <br />
                          <bdi dir="ltr" className={adminStyles.muted}>
                            {row.email}
                          </bdi>
                        </>
                      )}
                    </th>
                    <td>
                      <ul className={styles.items}>
                        {row.items.map((item) => (
                          <li key={item.sku}>
                            <bdi>{resolveLocalized(item.name, locale)}</bdi> × {item.quantity}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{format.dateTime(row.lastActivity)}</td>
                    <td>
                      {row.reminded ? (
                        <Badge tone="success" icon={<BellRing aria-hidden="true" />}>
                          {at('abandonedAdmin.remindedYes')}
                        </Badge>
                      ) : (
                        <Badge>{at('abandonedAdmin.remindedNo')}</Badge>
                      )}
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
