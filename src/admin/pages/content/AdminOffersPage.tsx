import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import {
  OFFER_KINDS,
  type OfferFilter,
  type OfferKind,
  type OfferListItem,
  type ProductStatus,
} from '@/domain/admin/schemas';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { BulkBar, DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, InputField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';
import { PublicationStateBadge } from './contentParts';

const PAGE = 50;
const STATES = ['draft', 'scheduled', 'active', 'expired', 'archived'] as const;

/** Offers & promo codes: every kind, schedule, homepage placement, bulk publish/unpublish. */
export function AdminOffersPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirm = useConfirm<ProductStatus>();
  const canManage = can('marketing.manage');

  const filter: OfferFilter = {
    q: params.get('q') || null,
    kind: (params.get('kind') as OfferKind | null) || null,
    state: params.get('state') || null,
    promoOnly: params.get('promo') === '1' || undefined,
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin', 'offers', filter],
    queryFn: () => repo.listOffers(filter),
    placeholderData: (prev) => prev,
  });
  const bulk = useAdminAction(
    (status: ProductStatus) => repo.setOffersStatus([...selected], status),
    {
      onSuccess: () => setSelected(new Set()),
    },
  );
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  };
  const discount = (o: OfferListItem) =>
    o.discountPercent !== null
      ? `${format.number(o.discountPercent)}%`
      : o.discountAmount !== null
        ? format.money(o.discountAmount)
        : '—';

  const columns: Column<OfferListItem>[] = [
    {
      id: 'title',
      header: at('offersAdmin.col.offer'),
      rowHeader: true,
      cell: (o) => (
        <span className={styles.cellTitle}>
          <Link to={`/admin/offers/${o.id}`}>{loc(o.title)}</Link>
          <span className={`${styles.mono} ${styles.muted}`}>{o.slug}</span>
        </span>
      ),
    },
    {
      id: 'kind',
      header: at('offersAdmin.col.kind'),
      cell: (o) => at(`offersAdmin.kind.${o.kind}` as AdminMessageKey),
    },
    {
      id: 'state',
      header: at('offersAdmin.col.state'),
      cell: (o) => <PublicationStateBadge state={o.state} />,
    },
    {
      id: 'discount',
      header: at('offersAdmin.col.discount'),
      className: styles.num,
      cell: discount,
    },
    {
      id: 'code',
      header: at('offersAdmin.col.code'),
      cell: (o) => (o.promoCode ? <span className={styles.mono}>{o.promoCode}</span> : '—'),
    },
    {
      id: 'schedule',
      header: at('offersAdmin.col.schedule'),
      className: styles.nowrap,
      cell: (o) => (
        <span className={styles.small}>
          {o.startsAt ? format.dateTime(o.startsAt) : at('offersAdmin.noStart')}
          <br />
          {o.endsAt ? format.dateTime(o.endsAt) : at('offersAdmin.noEnd')}
        </span>
      ),
    },
    {
      id: 'placement',
      header: at('offersAdmin.col.placement'),
      cell: (o) => (
        <span className={styles.chips}>
          {o.featuredOnHome && <Badge tone="brand">{at('offersAdmin.home')}</Badge>}
          {o.isDemo && <Badge>{at('ui.demo')}</Badge>}
        </span>
      ),
    },
    {
      id: 'usage',
      header: at('offersAdmin.col.usage'),
      className: styles.num,
      cell: (o) =>
        at('offersAdmin.usage', {
          products: format.number(o.productCount),
          redemptions: format.number(o.redemptions),
        }),
    },
  ];

  const bulkAsk = (status: ProductStatus) =>
    confirm.ask(
      {
        title: at(`offersAdmin.bulk.${status}` as AdminMessageKey),
        body: at('offersAdmin.bulk.body'),
        affected: (list.data?.items ?? [])
          .filter((o) => selected.has(o.id))
          .map((o) => loc(o.title)),
        confirmLabel: at(`offersAdmin.bulk.${status}` as AdminMessageKey),
        tone: status === 'published' ? 'default' : 'danger',
      },
      status,
    );

  return (
    <>
      <PageHeader
        title={at('modules.offers.title')}
        subtitle={at('offersAdmin.subtitle')}
        actions={
          canManage && (
            <Link to="/admin/offers/new" className={buttonClassName({ variant: 'primary' })}>
              <Plus aria-hidden="true" />
              {at('offersAdmin.new')}
            </Link>
          )
        }
      />
      <div className={styles.stack}>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('offersAdmin.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('ui.search')}
            type="search"
            value={q}
            placeholder={at('offersAdmin.searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('offersAdmin.col.kind')}
            value={filter.kind ?? ''}
            onChange={(e) => setParam('kind', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...OFFER_KINDS.map((k) => ({
                value: k,
                label: at(`offersAdmin.kind.${k}` as AdminMessageKey),
              })),
            ]}
          />
          <SelectField
            label={at('offersAdmin.col.state')}
            value={filter.state ?? ''}
            onChange={(e) => setParam('state', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...STATES.map((s) => ({
                value: s,
                label: at(`contentAdmin.state.${s}` as AdminMessageKey),
              })),
            ]}
          />
          <CheckboxField
            label={at('offersAdmin.promoOnly')}
            checked={filter.promoOnly === true}
            onChange={(on) => setParam('promo', on ? '1' : '')}
          />
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
              {at('ui.apply')}
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
        {bulk.error && (
          <Alert tone="danger" live>
            {bulk.error}
          </Alert>
        )}
        <QueryState
          query={list}
          isEmpty={(d) => d.items.length === 0}
          empty={at('offersAdmin.empty')}
        >
          {(data) => (
            <>
              <DataTable
                caption={at('ui.rowsCount', { count: data.total })}
                rows={data.items}
                rowKey={(o) => o.id}
                rowLabel={(o) => loc(o.title)}
                columns={columns}
                selected={canManage ? selected : undefined}
                onSelectedChange={canManage ? setSelected : undefined}
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
        <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="accent" onClick={() => bulkAsk('published')}>
            {at('offersAdmin.bulk.published')}
          </Button>
          <Button size="sm" variant="inverse" onClick={() => bulkAsk('draft')}>
            {at('offersAdmin.bulk.draft')}
          </Button>
          <Button size="sm" variant="inverse" onClick={() => bulkAsk('archived')}>
            {at('offersAdmin.bulk.archived')}
          </Button>
        </BulkBar>
      </div>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={bulk.pending}
        error={bulk.error}
        onCancel={confirm.close}
        onConfirm={async () => {
          if (confirm.payload) {
            const r = await bulk.run(confirm.payload);
            if (r?.ok) confirm.close();
          }
        }}
      />
    </>
  );
}
