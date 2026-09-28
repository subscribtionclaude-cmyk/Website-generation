import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { downloadText, toCsv } from '@/domain/admin/csv';
import { presetRange, storeDay } from '@/domain/admin/dateRange';
import type { Analytics } from '@/domain/admin/schemas';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/domain/commerce/types';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from '@/storefront/commerce/labels';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ColumnChart, ShareBars } from '../../ui/Charts';
import { DataTable } from '../../ui/DataTable';
import { DateRangePicker } from '../../ui/DateRangePicker';
import { PageHeader, Panel, StatTile } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';

/**
 * Store analytics computed from the store's own orders, carts and requests (no paid analytics
 * provider). Aggregates only — no customer names or contact details appear in charts or exports.
 */
export function AdminAnalyticsPage() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const { mode } = useRuntime();
  const [range, setRange] = useState(() => presetRange('30d'));
  const [includeDemo, setIncludeDemo] = useState(mode === 'demo');
  const analytics = useQuery({
    queryKey: ['admin', 'analytics', range.from, range.to, includeDemo],
    queryFn: () => repo.analytics(range.from, range.to, includeDemo),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHeader title={at('modules.analytics.title')} subtitle={at('analyticsAdmin.subtitle')} />
      <div className={styles.stack}>
        <DateRangePicker
          value={range}
          onChange={setRange}
          includeDemo={includeDemo}
          onIncludeDemoChange={setIncludeDemo}
        />
        <QueryState query={analytics}>{(data) => <AnalyticsBody data={data} />}</QueryState>
      </div>
    </>
  );
}

function AnalyticsBody({ data }: { data: Analytics }) {
  const { at } = useAdminI18n();
  const { t, format } = useI18n();
  const { can } = useAccess();
  const loc = useLocalized();
  const money = (n: number) => format.money(n, { fractionDigits: 0 });
  const s = data.totals;
  const fileDay = storeDay(new Date());

  const exportDaily = () =>
    downloadText(
      `analytics-daily-${fileDay}.csv`,
      toCsv(data.byDay.map((d) => ({ day: d.day, orders: d.orders, revenue: d.revenue }))),
    );
  const exportBest = () =>
    downloadText(
      `analytics-best-sellers-${fileDay}.csv`,
      toCsv(
        data.bestSellers.map((b) => ({
          product: loc(b.name),
          slug: b.slug,
          quantity: b.quantity,
          revenue: b.revenue,
        })),
      ),
    );

  return (
    <div className={styles.stack}>
      {data.includeDemo ? (
        <Alert tone="warning">{at('analyticsAdmin.demoIncluded')}</Alert>
      ) : (
        <Alert tone="info">{at('analyticsAdmin.liveOnly')}</Alert>
      )}
      <Panel
        title={at('analyticsAdmin.sales')}
        actions={
          can('reports.export') && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                onClick={exportDaily}
              >
                {at('analyticsAdmin.exportDaily')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                onClick={exportBest}
              >
                {at('analyticsAdmin.exportBest')}
              </Button>
            </>
          )
        }
      >
        <div className={styles.stack}>
          <div className={styles.tiles}>
            <StatTile label={at('analyticsAdmin.orders')} value={format.number(s.orders)} />
            <StatTile label={at('analyticsAdmin.revenue')} value={money(s.revenue)} />
            <StatTile label={at('analyticsAdmin.paid')} value={money(s.paid)} />
            <StatTile label={at('analyticsAdmin.aov')} value={money(s.averageOrderValue)} />
            <StatTile label={at('analyticsAdmin.itemsSold')} value={format.number(s.itemsSold)} />
            <StatTile
              label={at('analyticsAdmin.cancelled')}
              value={format.number(s.cancelled)}
              tone={s.cancelled > 0 ? 'warn' : undefined}
            />
            <StatTile label={at('analyticsAdmin.customers')} value={format.number(s.customers)} />
            <StatTile
              label={at('analyticsAdmin.conversion')}
              value={
                s.conversion === null
                  ? '—'
                  : `${format.number(Math.round(s.conversion * 1000) / 10)}%`
              }
              hint={at('analyticsAdmin.conversionHint')}
            />
          </div>
          {data.byDay.length > 0 ? (
            <div className={styles.formGrid}>
              <ColumnChart
                caption={at('analyticsAdmin.revenueByDay')}
                points={data.byDay.map((d) => ({
                  label: d.day,
                  value: d.revenue,
                  display: money(d.revenue),
                }))}
              />
              <ColumnChart
                caption={at('analyticsAdmin.ordersByDay')}
                points={data.byDay.map((d) => ({
                  label: d.day,
                  value: d.orders,
                  display: format.number(d.orders),
                }))}
              />
            </div>
          ) : (
            <p className={styles.muted}>{at('analyticsAdmin.noOrders')}</p>
          )}
        </div>
      </Panel>

      <div className={styles.formGrid}>
        <Panel title={at('analyticsAdmin.byStatus')}>
          <ShareBars
            caption={at('analyticsAdmin.byStatus')}
            items={ORDER_STATUSES.filter((st) => (data.byStatus[st] ?? 0) > 0).map((st) => ({
              key: st,
              label: t(ORDER_STATUS_LABEL[st]),
              value: data.byStatus[st] ?? 0,
              display: format.number(data.byStatus[st] ?? 0),
            }))}
          />
        </Panel>
        <Panel title={at('analyticsAdmin.byPayment')}>
          <ShareBars
            caption={at('analyticsAdmin.byPayment')}
            items={PAYMENT_METHODS.filter((m) => (data.byPayment[m] ?? 0) > 0).map((m) => ({
              key: m,
              label: t(PAYMENT_METHOD_LABEL[m]),
              value: data.byPayment[m] ?? 0,
              display: format.number(data.byPayment[m] ?? 0),
            }))}
          />
        </Panel>
      </div>

      <Panel title={at('analyticsAdmin.bestSellers')}>
        {data.bestSellers.length === 0 ? (
          <p className={styles.muted}>{at('analyticsAdmin.noOrders')}</p>
        ) : (
          <DataTable
            caption={at('analyticsAdmin.bestSellers')}
            rows={data.bestSellers}
            rowKey={(b) => b.productId}
            columns={[
              {
                id: 'product',
                header: at('analyticsAdmin.product'),
                rowHeader: true,
                cell: (b) => <Link to={`/admin/products/${b.productId}`}>{loc(b.name)}</Link>,
              },
              {
                id: 'qty',
                header: at('analyticsAdmin.quantity'),
                className: styles.num,
                cell: (b) => format.number(b.quantity),
              },
              {
                id: 'revenue',
                header: at('analyticsAdmin.revenue'),
                className: styles.num,
                cell: (b) => money(b.revenue),
              },
            ]}
          />
        )}
      </Panel>

      <div className={styles.formGrid}>
        <Panel title={at('analyticsAdmin.customersTitle')}>
          <div className={styles.tiles}>
            <StatTile
              label={at('analyticsAdmin.repeat')}
              value={at('analyticsAdmin.repeatValue', {
                count: format.number(data.repeatCustomers.customers),
                total: format.number(data.repeatCustomers.ofCustomers),
              })}
            />
            <StatTile
              label={at('analyticsAdmin.activeCarts')}
              value={format.number(s.activeCarts)}
            />
            <StatTile
              label={at('analyticsAdmin.abandoned')}
              value={format.number(data.abandonedCarts)}
              to="/admin/abandoned-carts"
            />
          </div>
          <p className={styles.hint}>{at('analyticsAdmin.privacy')}</p>
        </Panel>
        <Panel title={at('analyticsAdmin.stockTitle')}>
          <div className={styles.tiles}>
            <StatTile
              label={at('analyticsAdmin.lowStock')}
              value={format.number(data.stock.low)}
              tone={data.stock.low > 0 ? 'warn' : undefined}
              to="/admin/inventory?view=low"
            />
            <StatTile
              label={at('analyticsAdmin.outOfStock')}
              value={format.number(data.stock.out)}
              tone={data.stock.out > 0 ? 'danger' : undefined}
              to="/admin/inventory?view=out"
            />
          </div>
        </Panel>
      </div>

      {Object.keys(data.services).length > 0 && (
        <Panel title={at('analyticsAdmin.services')}>
          <DataTable
            caption={at('analyticsAdmin.services')}
            rows={Object.entries(data.services)}
            rowKey={([k]) => k}
            columns={[
              {
                id: 'kind',
                header: at('analyticsAdmin.service'),
                rowHeader: true,
                cell: ([k]) => at(`analyticsAdmin.serviceKind.${k}` as AdminMessageKey),
              },
              {
                id: 'created',
                header: at('analyticsAdmin.created'),
                className: styles.num,
                cell: ([, v]) => format.number(v.created),
              },
              {
                id: 'completed',
                header: at('analyticsAdmin.completed'),
                className: styles.num,
                cell: ([, v]) => format.number(v.completed),
              },
              {
                id: 'open',
                header: at('analyticsAdmin.open'),
                className: styles.num,
                cell: ([, v]) => format.number(v.open),
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
