import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  Undo2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import type { ProductFilter, ProductListItem, ProductStateAction } from '@/domain/admin/schemas';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { BulkBar, DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog } from '../../ui/Dialog';
import { InputField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized, useLookups } from './catalogHooks';
import { StatusBadge } from './catalogParts';

const PAGE_SIZE = 25;

type Pending =
  | { kind: 'state'; action: ProductStateAction; ids: string[] }
  | { kind: 'delete'; id: string }
  | { kind: 'duplicate'; id: string };

/** Catalog list: server-side search / filters / sort / pagination, bulk visibility and status. */
export function AdminProductsPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const navigate = useNavigate();
  const loc = useLocalized();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirm = useConfirm<Pending>();
  const canManage = can('catalog.manage');

  const filter: ProductFilter = {
    q: params.get('q'),
    brandId: params.get('brand'),
    categoryId: params.get('category'),
    status: (params.get('status') as ProductFilter['status']) ?? null,
    visibility: (params.get('visibility') as ProductFilter['visibility']) ?? null,
    stock: (params.get('stock') as ProductFilter['stock']) ?? null,
    offer: (params.get('offer') as ProductFilter['offer']) ?? null,
    price: (params.get('price') as ProductFilter['price']) ?? null,
    data: (params.get('data') as ProductFilter['data']) ?? null,
    sort: (params.get('sort') as ProductFilter['sort']) ?? 'updated_desc',
    limit: PAGE_SIZE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin', 'products', filter],
    queryFn: () => repo.listProducts(filter),
    placeholderData: (previous) => previous,
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const stateAction = useAdminAction((ids: string[], action: ProductStateAction) =>
    repo.setProductsState(ids, action),
  );
  const remove = useAdminAction((id: string) => repo.deleteProduct(id));
  const duplicate = useAdminAction((id: string) => repo.duplicateProduct(id), {
    onSuccess: (r) => {
      if (r.ok) void navigate(`/admin/products/${r.id}`);
    },
  });
  const pendingAction = stateAction.pending || remove.pending || duplicate.pending;
  const actionError = stateAction.error ?? remove.error ?? duplicate.error;

  const rows = list.data?.items ?? [];
  const nameOf = (id: string) => {
    const p = rows.find((r) => r.id === id);
    return p ? loc(p.name) : id;
  };

  const askState = (action: ProductStateAction, ids: string[]) =>
    confirm.ask(
      {
        title: at(`catalog.bulk.${action}Title` as AdminMessageKey, { count: ids.length }),
        body: at(`catalog.bulk.${action}Body` as AdminMessageKey),
        affected: ids.map(nameOf),
        confirmLabel: at(`catalog.bulk.${action}` as AdminMessageKey),
        tone: action === 'archive' || action === 'hide' ? 'danger' : 'default',
      },
      { kind: 'state', action, ids },
    );

  const columns: Column<ProductListItem>[] = [
    {
      id: 'image',
      header: <span className="visually-hidden">{at('catalog.col.image')}</span>,
      cell: (p) =>
        p.image ? (
          <img className={styles.thumb} src={p.image} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumb} aria-hidden="true" style={{ display: 'inline-block' }} />
        ),
    },
    {
      id: 'product',
      header: at('catalog.col.product'),
      rowHeader: true,
      cell: (p) => (
        <span className={styles.cellTitle}>
          <Link to={`/admin/products/${p.id}`}>{loc(p.name)}</Link>
          <span className={`${styles.mono} ${styles.muted}`}>{p.slug}</span>
          {p.isDemo && (
            <span>
              <Badge>{at('ui.demo')}</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'brand',
      header: at('catalog.col.brand'),
      cell: (p) => (p.brand ? loc(p.brand.name) : '—'),
    },
    {
      id: 'category',
      header: at('catalog.col.category'),
      cell: (p) => (p.category ? loc(p.category.name) : '—'),
    },
    {
      id: 'price',
      header: at('catalog.col.startingPrice'),
      className: styles.num,
      cell: (p) =>
        p.startingPrice !== null
          ? format.money(p.startingPrice, { fractionDigits: 0 })
          : p.missingPriceCount > 0
            ? at('catalog.askForPrice')
            : '—',
    },
    {
      id: 'variants',
      header: at('catalog.col.variants'),
      className: styles.num,
      cell: (p) => format.number(p.variantCount),
    },
    {
      id: 'stock',
      header: at('catalog.col.stock'),
      cell: (p) => (
        <span className={styles.chips}>
          <span className={styles.small}>
            {at('catalog.stockUnits', { count: format.number(p.stock.total) })}
          </span>
          {p.stock.out > 0 && (
            <Badge tone="danger">{at('catalog.stockOut', { count: p.stock.out })}</Badge>
          )}
          {p.stock.low > 0 && (
            <Badge tone="warning">{at('catalog.stockLow', { count: p.stock.low })}</Badge>
          )}
        </span>
      ),
    },
    {
      id: 'visibility',
      header: at('catalog.col.visibility'),
      cell: (p) => (
        <span className={styles.chips}>
          <StatusBadge status={p.status} />
          {!p.isVisible && <Badge tone="neutral">{at('catalog.hidden')}</Badge>}
        </span>
      ),
    },
    {
      id: 'offer',
      header: at('catalog.col.offer'),
      cell: (p) => (p.hasOffer ? <Badge tone="brand">{at('catalog.onOffer')}</Badge> : '—'),
    },
    {
      id: 'updated',
      header: at('catalog.col.updated'),
      className: styles.nowrap,
      cell: (p) => format.date(p.updatedAt),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: (p) => (
        <span className={styles.rowActions}>
          <Link
            to={`/admin/products/${p.id}`}
            className={styles.iconButton}
            aria-label={`${at('ui.edit')}: ${loc(p.name)}`}
          >
            <Pencil aria-hidden="true" />
          </Link>
          {canManage && (
            <>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`${at('ui.duplicate')}: ${loc(p.name)}`}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('catalog.duplicateTitle'),
                      body: at('catalog.duplicateBody'),
                      affected: [loc(p.name)],
                      confirmLabel: at('ui.duplicate'),
                    },
                    { kind: 'duplicate', id: p.id },
                  )
                }
              >
                <Copy aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`${at('ui.delete')}: ${loc(p.name)}`}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('catalog.deleteTitle'),
                      body: at('catalog.deleteBody'),
                      affected: [loc(p.name)],
                      confirmLabel: at('ui.delete'),
                      tone: 'danger',
                      irreversible: true,
                    },
                    { kind: 'delete', id: p.id },
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </button>
            </>
          )}
        </span>
      ),
    },
  ];

  const lookupsData = lookups.data;
  return (
    <>
      <PageHeader
        title={at('modules.products.title')}
        subtitle={at('catalog.productsSubtitle')}
        actions={
          <>
            {can('data.import') && (
              <Link to="/admin/import-export" className={buttonClassName({ variant: 'secondary' })}>
                <Upload aria-hidden="true" />
                {at('catalog.import')}
              </Link>
            )}
            {canManage && (
              <Link to="/admin/products/new" className={buttonClassName({ variant: 'primary' })}>
                <Plus aria-hidden="true" />
                {at('catalog.newProduct')}
              </Link>
            )}
          </>
        }
      />
      <div className={styles.stack}>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('catalog.filtersLabel')}
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('ui.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={at('catalog.searchPlaceholder')}
            type="search"
          />
          <SelectField
            label={at('catalog.col.brand')}
            value={filter.brandId ?? ''}
            onChange={(e) => setParam('brand', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...(lookupsData?.brands ?? []).map((b) => ({ value: b.id, label: loc(b.name) })),
            ]}
          />
          <SelectField
            label={at('catalog.col.category')}
            value={filter.categoryId ?? ''}
            onChange={(e) => setParam('category', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...(lookupsData?.categories ?? []).map((c) => ({ value: c.id, label: loc(c.name) })),
            ]}
          />
          <SelectField
            label={at('catalog.col.status')}
            value={filter.status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'published', label: at('catalog.status.published') },
              { value: 'draft', label: at('catalog.status.draft') },
              { value: 'archived', label: at('catalog.status.archived') },
            ]}
          />
          <SelectField
            label={at('catalog.col.visibility')}
            value={filter.visibility ?? ''}
            onChange={(e) => setParam('visibility', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'visible', label: at('catalog.visible') },
              { value: 'hidden', label: at('catalog.hidden') },
            ]}
          />
          <SelectField
            label={at('catalog.col.stock')}
            value={filter.stock ?? ''}
            onChange={(e) => setParam('stock', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'in_stock', label: at('catalog.stockState.in_stock') },
              { value: 'low', label: at('catalog.stockState.low') },
              { value: 'out', label: at('catalog.stockState.out') },
            ]}
          />
          <SelectField
            label={at('catalog.col.offer')}
            value={filter.offer ?? ''}
            onChange={(e) => setParam('offer', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'with', label: at('catalog.withOffer') },
              { value: 'without', label: at('catalog.withoutOffer') },
            ]}
          />
          <SelectField
            label={at('catalog.priceFilter')}
            value={filter.price ?? ''}
            onChange={(e) => setParam('price', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'missing', label: at('catalog.missingPrice') },
              { value: 'priced', label: at('catalog.pricedOnly') },
            ]}
          />
          <SelectField
            label={at('catalog.dataLabel')}
            value={filter.data ?? ''}
            onChange={(e) => setParam('data', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              { value: 'demo', label: at('ui.demo') },
              { value: 'live', label: at('ui.live') },
            ]}
          />
          <SelectField
            label={at('catalog.sortLabel')}
            value={filter.sort ?? 'updated_desc'}
            onChange={(e) => setParam('sort', e.target.value)}
            options={[
              { value: 'updated_desc', label: at('catalog.sort.updated') },
              { value: 'name', label: at('catalog.sort.name') },
              { value: 'price_asc', label: at('catalog.sort.priceAsc') },
              { value: 'price_desc', label: at('catalog.sort.priceDesc') },
              { value: 'stock_asc', label: at('catalog.sort.stockAsc') },
            ]}
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

        {actionError && (
          <Alert tone="danger" live>
            {actionError}
          </Alert>
        )}

        <QueryState query={list} isEmpty={(d) => d.items.length === 0} empty={at('catalog.empty')}>
          {(data) => (
            <>
              <p className={styles.muted} aria-live="polite">
                {at('ui.rowsCount', { count: format.number(data.total) })}
              </p>
              <DataTable
                caption={at('modules.products.title')}
                rows={data.items}
                rowKey={(p) => p.id}
                rowLabel={(p) => loc(p.name)}
                columns={columns}
                selected={canManage ? selected : undefined}
                onSelectedChange={canManage ? setSelected : undefined}
              />
              <Pagination
                total={data.total}
                limit={PAGE_SIZE}
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
          <Button
            size="sm"
            variant="accent"
            icon={<Send aria-hidden="true" />}
            onClick={() => askState('publish', [...selected])}
          >
            {at('catalog.bulk.publish')}
          </Button>
          <Button
            size="sm"
            variant="inverse"
            icon={<Undo2 aria-hidden="true" />}
            onClick={() => askState('draft', [...selected])}
          >
            {at('catalog.bulk.draft')}
          </Button>
          <Button
            size="sm"
            variant="inverse"
            icon={<Eye aria-hidden="true" />}
            onClick={() => askState('show', [...selected])}
          >
            {at('catalog.bulk.show')}
          </Button>
          <Button
            size="sm"
            variant="inverse"
            icon={<EyeOff aria-hidden="true" />}
            onClick={() => askState('hide', [...selected])}
          >
            {at('catalog.bulk.hide')}
          </Button>
          <Button
            size="sm"
            variant="inverse"
            icon={<Archive aria-hidden="true" />}
            onClick={() => askState('archive', [...selected])}
          >
            {at('catalog.bulk.archive')}
          </Button>
          <Button size="sm" variant="inverse" onClick={() => askState('restore', [...selected])}>
            {at('catalog.bulk.restore')}
          </Button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={pendingAction}
        onCancel={confirm.close}
        onConfirm={async () => {
          const p = confirm.payload;
          if (!p) return;
          const result =
            p.kind === 'state'
              ? await stateAction.run(p.ids, p.action)
              : p.kind === 'delete'
                ? await remove.run(p.id)
                : await duplicate.run(p.id);
          if (result?.ok) {
            setSelected(new Set());
          }
          confirm.close();
        }}
      />
    </>
  );
}
