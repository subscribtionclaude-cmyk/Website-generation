import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { downloadText, flattenRow, toCsv } from '@/domain/admin/csv';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type StaffOrderFilter,
  type StaffOrderSummary,
} from '@/domain/commerce/types';
import { useAccess, useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { OrderStatusBadge, PaymentStatusBadge } from '@/storefront/commerce/CommerceParts';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
} from '@/storefront/commerce/labels';
import { useAdminI18n } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { CheckboxField, InputField, SelectField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useErrorText } from '../../ui/useAdminText';
import ui from '../../ui/adminUi.module.css';
import styles from './orders.module.css';

const PAGE = 50;
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const dayEnd = (d: string) =>
  d ? new Date(new Date(`${d}T00:00:00`).getTime() + 86_400_000).toISOString() : null;

/** Staff order queue: server-side filters (URL-driven), assignment, review flags, reservations. */
export function AdminOrdersPage() {
  const { at } = useAdminI18n();
  const { t, format } = useI18n();
  const { repositories } = useRuntime();
  const { can } = useAccess();
  const session = useSession();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [exporting, setExporting] = useState<string | null>(null);

  const filter: StaffOrderFilter = {
    status: (params.get('status') as OrderStatus | null) || null,
    paymentStatus: (params.get('payment') as PaymentStatus | null) || null,
    paymentMethod: (params.get('method') as PaymentMethod | null) || null,
    fulfillment: (params.get('fulfillment') as 'delivery' | 'pickup' | null) || null,
    assigned: params.get('assigned') || null,
    customerId: params.get('customer') || null,
    reviewPending: params.get('review') === '1' || undefined,
    q: params.get('q') || null,
    from: dayStart(params.get('from') ?? ''),
    to: dayEnd(params.get('to') ?? ''),
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin-orders', session?.userId ?? null, filter],
    queryFn: () => repositories.orders.listOrders(filter),
    placeholderData: (prev) => prev,
  });
  const assignees = useQuery({
    queryKey: ['admin', 'order-assignees'],
    queryFn: () => repositories.admin.orderAssignees(),
  });
  const release = useMutation({
    mutationFn: () => repositories.orders.releaseExpiredReservations(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  };

  const exportCsv = async () => {
    setExporting(null);
    try {
      const result = await repositories.admin.exportData('orders', {
        from: filter.from,
        to: filter.to,
      });
      downloadText(
        `orders-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(result.rows.map((r) => flattenRow(r))),
      );
    } catch (e) {
      setExporting(errorText(e, true));
    }
  };

  const columns: Column<StaffOrderSummary>[] = [
    {
      id: 'number',
      header: at('orders.number'),
      rowHeader: true,
      cell: (o) => (
        <Link to={`/admin/orders/${o.id}`} className={styles.orderLink}>
          <bdi dir="ltr">{o.orderNumber}</bdi>
        </Link>
      ),
    },
    {
      id: 'date',
      header: at('orders.date'),
      className: ui.nowrap,
      cell: (o) => format.dateTime(o.createdAt),
    },
    {
      id: 'customer',
      header: at('orders.customer'),
      cell: (o) => (
        <>
          {o.customerName}
          <br />
          <bdi dir="ltr" className={ui.muted}>
            {o.customerPhone}
          </bdi>
        </>
      ),
    },
    {
      id: 'status',
      header: at('orders.status'),
      cell: (o) => <OrderStatusBadge status={o.status} />,
    },
    {
      id: 'payment',
      header: at('orders.payment'),
      cell: (o) => (
        <span className={ui.chips}>
          <PaymentStatusBadge status={o.paymentStatus} />
          <span className={ui.small}>{t(PAYMENT_METHOD_LABEL[o.paymentMethod])}</span>
        </span>
      ),
    },
    {
      id: 'total',
      header: at('orders.total'),
      className: ui.num,
      cell: (o) => format.money(o.total, { fractionDigits: 2 }),
    },
    {
      id: 'remaining',
      header: at('orders.remaining'),
      className: ui.num,
      cell: (o) => format.money(o.remainingAmount, { fractionDigits: 2 }),
    },
    { id: 'assigned', header: at('ordersP6.assignee'), cell: (o) => o.assignedTo?.name ?? '—' },
    {
      id: 'flags',
      header: at('orders.flags'),
      cell: (o) => (
        <span className={styles.flags}>
          {o.reviewPending && (
            <Badge tone="warning" icon={<ShieldAlert aria-hidden="true" />}>
              {at('orders.flagReview')}
            </Badge>
          )}
          {o.shippingFeeStatus === 'pending' && (
            <Badge tone="info">{at('orders.flagShipping')}</Badge>
          )}
          {o.stockCommitted && <Badge tone="success">{at('orders.flagCommitted')}</Badge>}
          {o.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={at('orders.title')}
        subtitle={at('orders.subtitle')}
        actions={
          <>
            {can('reports.export') && (
              <Button
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                onClick={() => void exportCsv()}
              >
                {at('ui.exportCsv')}
              </Button>
            )}
            {can('orders.manage') && (
              <Button
                variant="secondary"
                icon={<RefreshCw aria-hidden="true" />}
                loading={release.isPending}
                onClick={() => release.mutate()}
              >
                {at('orders.releaseExpired')}
              </Button>
            )}
          </>
        }
      />
      <div className={ui.stack}>
        <form
          className={ui.filters}
          role="search"
          aria-label={at('ordersP6.filters')}
          onSubmit={(event) => {
            event.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('orders.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="MS-2026-000001 / 010…"
            ltr
          />
          <SelectField
            label={at('orders.status')}
            value={filter.status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            options={[
              { value: '', label: at('orders.allStatuses') },
              ...ORDER_STATUSES.map((s) => ({ value: s, label: t(ORDER_STATUS_LABEL[s]) })),
            ]}
          />
          <SelectField
            label={at('ordersP6.paymentStatus')}
            value={filter.paymentStatus ?? ''}
            onChange={(e) => setParam('payment', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(PAYMENT_STATUS_LABEL[s]) })),
            ]}
          />
          <SelectField
            label={at('ordersP6.paymentMethod')}
            value={filter.paymentMethod ?? ''}
            onChange={(e) => setParam('method', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...PAYMENT_METHODS.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABEL[m]) })),
            ]}
          />
          <SelectField
            label={at('ordersP6.fulfillment')}
            value={filter.fulfillment ?? ''}
            onChange={(e) => setParam('fulfillment', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'delivery', label: at('ordersP6.delivery') },
              { value: 'pickup', label: at('ordersP6.pickup') },
            ]}
          />
          <SelectField
            label={at('ordersP6.assignee')}
            value={filter.assigned ?? ''}
            onChange={(e) => setParam('assigned', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'me', label: at('ordersP6.assignedToMe') },
              { value: 'unassigned', label: at('ordersP6.unassigned') },
              ...(assignees.data ?? []).map((a) => ({ value: a.id, label: a.name ?? a.id })),
            ]}
          />
          <InputField
            type="date"
            label={at('ui.from')}
            value={params.get('from') ?? ''}
            onChange={(e) => setParam('from', e.target.value)}
          />
          <InputField
            type="date"
            label={at('ui.to')}
            value={params.get('to') ?? ''}
            onChange={(e) => setParam('to', e.target.value)}
          />
          <CheckboxField
            label={at('orders.reviewOnly')}
            checked={filter.reviewPending === true}
            onChange={(on) => setParam('review', on ? '1' : '')}
          />
          <div className={ui.filterActions}>
            <Button type="submit" variant="primary" icon={<Search aria-hidden="true" />}>
              {at('orders.apply')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              {at('ui.reset')}
            </Button>
          </div>
        </form>
        {filter.customerId && (
          <Alert
            tone="info"
            action={
              <Button size="sm" variant="secondary" onClick={() => setParam('customer', '')}>
                {at('ui.reset')}
              </Button>
            }
          >
            {at('ordersP6.customerFilter')}
          </Alert>
        )}
        {release.isSuccess && (
          <Alert tone="success" live>
            {at('orders.released', { count: release.data })}
          </Alert>
        )}
        {(release.isError || exporting) && (
          <Alert tone="danger" live>
            {exporting ?? at('orders.actionFailed')}
          </Alert>
        )}
        <QueryState query={list} isEmpty={(d) => d.items.length === 0} empty={at('orders.empty')}>
          {(data) => (
            <>
              <p className={ui.muted} aria-live="polite">
                {at('orders.count', { count: data.total })}
              </p>
              <DataTable
                caption={at('orders.count', { count: data.total })}
                rows={data.items}
                rowKey={(o) => o.id}
                columns={columns}
              />
              <Pagination
                total={data.total}
                limit={PAGE}
                offset={filter.offset ?? 0}
                onChange={(offset) => {
                  const next = new URLSearchParams(params);
                  next.set('offset', String(offset));
                  setParams(next, { replace: true });
                }}
              />
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
