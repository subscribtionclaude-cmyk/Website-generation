import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { WaitlistFilter, WaitlistRow } from '@/domain/admin/schemas';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { CheckboxField, InputField, SelectField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';

const PAGE = 50;

/**
 * "Notify me" and waitlist requests with product availability and readiness. Customers with an
 * account are notified in-app automatically; guests are contacted by staff (no paid messaging).
 */
export function AdminWaitlistsPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<WaitlistFilter>({ limit: PAGE, offset: 0 });
  const list = useQuery({
    queryKey: ['admin', 'waitlist', filter],
    queryFn: () => repo.listWaitlist(filter),
    placeholderData: (prev) => prev,
  });
  const columns: Column<WaitlistRow>[] = [
    {
      id: 'product',
      header: at('waitlists.col.product'),
      rowHeader: true,
      cell: (r) => (
        <span className={styles.cellTitle}>
          <Link to={`/admin/products/${r.productId}`}>{loc(r.productName)}</Link>
          {r.sku && <span className={`${styles.mono} ${styles.muted}`}>{r.sku}</span>}
          {r.variantLabel && (
            <span className={styles.small}>{r.variantLabel.map(loc).join(' / ')}</span>
          )}
        </span>
      ),
    },
    {
      id: 'kind',
      header: at('waitlists.col.kind'),
      cell: (r) => <Badge>{at(`waitlists.kind.${r.kind}` as AdminMessageKey)}</Badge>,
    },
    {
      id: 'customer',
      header: at('waitlists.col.customer'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span>{r.customerName ?? '—'}</span>
          {r.phone && (
            <bdi dir="ltr" className={styles.small}>
              {r.phone}
            </bdi>
          )}
          {r.email && (
            <bdi dir="ltr" className={styles.small}>
              {r.email}
            </bdi>
          )}
          <span className={`${styles.small} ${styles.muted}`}>
            {r.hasAccount ? at('waitlists.account') : at('waitlists.guest')}
          </span>
        </span>
      ),
    },
    {
      id: 'date',
      header: at('waitlists.col.date'),
      className: styles.nowrap,
      cell: (r) => format.date(r.createdAt),
    },
    {
      id: 'state',
      header: at('waitlists.col.state'),
      cell: (r) => <Badge>{at(`waitlists.state.${r.status}` as AdminMessageKey)}</Badge>,
    },
    {
      id: 'available',
      header: at('waitlists.col.availability'),
      cell: (r) =>
        r.availableNow ? (
          <Badge tone="success">{at('waitlists.inStock')}</Badge>
        ) : (
          <Badge>{at('waitlists.notYet')}</Badge>
        ),
    },
    {
      id: 'readiness',
      header: at('waitlists.col.readiness'),
      cell: (r) => (
        <Badge
          tone={
            r.readiness === 'ready_contact'
              ? 'warning'
              : r.readiness === 'ready_in_app'
                ? 'success'
                : 'neutral'
          }
        >
          {at(`waitlists.readiness.${r.readiness}` as AdminMessageKey)}
        </Badge>
      ),
    },
  ];
  return (
    <>
      <PageHeader title={at('modules.waitlists.title')} subtitle={at('waitlists.subtitle')} />
      <div className={styles.stack}>
        <Alert tone="info">{at('waitlists.noPaid')}</Alert>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('waitlists.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ ...filter, q: q.trim() || null, offset: 0 });
          }}
        >
          <InputField
            label={at('ui.search')}
            type="search"
            value={q}
            placeholder={at('waitlists.searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('waitlists.col.kind')}
            value={filter.kind ?? ''}
            onChange={(e) =>
              setFilter({
                ...filter,
                kind: (e.target.value || null) as WaitlistFilter['kind'],
                offset: 0,
              })
            }
            options={[
              { value: '', label: at('ui.all') },
              { value: 'notify', label: at('waitlists.kind.notify') },
              { value: 'waitlist', label: at('waitlists.kind.waitlist') },
            ]}
          />
          <SelectField
            label={at('waitlists.col.state')}
            value={filter.status ?? ''}
            onChange={(e) => setFilter({ ...filter, status: e.target.value || null, offset: 0 })}
            options={[
              { value: '', label: at('ui.all') },
              ...(['active', 'available', 'notified', 'expired', 'cancelled'] as const).map(
                (s) => ({
                  value: s,
                  label: at(`waitlists.state.${s}`),
                }),
              ),
            ]}
          />
          <CheckboxField
            label={at('waitlists.readyOnly')}
            checked={filter.readyOnly === true}
            onChange={(readyOnly) => setFilter({ ...filter, readyOnly, offset: 0 })}
          />
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
              {at('ui.apply')}
            </Button>
          </div>
        </form>
        <QueryState
          query={list}
          isEmpty={(d) => d.items.length === 0}
          empty={at('waitlists.empty')}
        >
          {(data) => (
            <>
              <DataTable
                caption={at('modules.waitlists.title')}
                rows={data.items}
                rowKey={(r) => r.id}
                columns={columns}
              />
              <Pagination
                total={data.total}
                limit={PAGE}
                offset={filter.offset ?? 0}
                onChange={(offset) => setFilter({ ...filter, offset })}
              />
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
