import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { CustomerFilter, CustomerListItem } from '@/domain/admin/schemas';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { InputField, SelectField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';

const PAGE = 50;

/** Customer list: search by name / phone / email, value and activity at a glance. */
export function AdminCustomersPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const filter: CustomerFilter = {
    q: params.get('q'),
    sort: (params.get('sort') as CustomerFilter['sort']) ?? 'joined_desc',
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin', 'customers', filter],
    queryFn: () => repo.listCustomers(filter),
    placeholderData: (prev) => prev,
  });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  };
  const columns: Column<CustomerListItem>[] = [
    {
      id: 'name',
      header: at('customers.col.customer'),
      rowHeader: true,
      cell: (c) => (
        <span className={styles.cellTitle}>
          <Link to={`/admin/customers/${c.id}`}>
            {c.name ?? c.email ?? at('customers.unnamed')}
          </Link>
          {c.email && (
            <bdi className={`${styles.small} ${styles.muted}`} dir="ltr">
              {c.email}
            </bdi>
          )}
        </span>
      ),
    },
    {
      id: 'phone',
      header: at('customers.col.phone'),
      cell: (c) => (c.phone ? <bdi dir="ltr">{c.phone}</bdi> : '—'),
    },
    {
      id: 'orders',
      header: at('customers.col.orders'),
      className: styles.num,
      cell: (c) => format.number(c.ordersCount),
    },
    {
      id: 'ltv',
      header: at('customers.col.ltv'),
      className: styles.num,
      cell: (c) => format.money(c.lifetimeValue, { fractionDigits: 0 }),
    },
    {
      id: 'last',
      header: at('customers.col.lastOrder'),
      className: styles.nowrap,
      cell: (c) => (c.lastOrderAt ? format.date(c.lastOrderAt) : '—'),
    },
    {
      id: 'requests',
      header: at('customers.col.openRequests'),
      className: styles.num,
      cell: (c) => format.number(c.openRequests),
    },
    {
      id: 'wishlist',
      header: at('customers.col.wishlist'),
      className: styles.num,
      cell: (c) => format.number(c.wishlistCount),
    },
    {
      id: 'joined',
      header: at('customers.col.joined'),
      className: styles.nowrap,
      cell: (c) => (c.joinedAt ? format.date(c.joinedAt) : '—'),
    },
  ];
  return (
    <>
      <PageHeader title={at('modules.customers.title')} subtitle={at('customers.subtitle')} />
      <div className={styles.stack}>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('customers.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('ui.search')}
            type="search"
            value={q}
            placeholder={at('customers.searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('catalog.sortLabel')}
            value={filter.sort ?? 'joined_desc'}
            onChange={(e) => setParam('sort', e.target.value)}
            options={[
              { value: 'joined_desc', label: at('customers.sort.joined') },
              { value: 'orders_desc', label: at('customers.sort.orders') },
              { value: 'value_desc', label: at('customers.sort.value') },
              { value: 'last_order_desc', label: at('customers.sort.lastOrder') },
            ]}
          />
          <div className={styles.filterActions}>
            <button
              type="submit"
              className={styles.iconButton}
              style={{
                width: 'auto',
                paddingInline: 'var(--space-3)',
                gap: 'var(--space-2)',
                display: 'inline-flex',
              }}
            >
              <Search aria-hidden="true" />
              {at('ui.apply')}
            </button>
          </div>
        </form>
        <QueryState
          query={list}
          isEmpty={(d) => d.items.length === 0}
          empty={at('customers.empty')}
        >
          {(data) => (
            <>
              <p className={styles.muted} aria-live="polite">
                {at('ui.rowsCount', { count: format.number(data.total) })}
              </p>
              <DataTable
                caption={at('modules.customers.title')}
                rows={data.items}
                rowKey={(c) => c.id}
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
