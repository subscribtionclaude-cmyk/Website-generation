import { useQuery } from '@tanstack/react-query';
import { PackagePlus, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  MOVEMENT_TYPES,
  STOCK_ADJUSTMENT_TYPES,
  WARRANTY_KINDS,
  type BulkVariantPatch,
  type InventoryFilter,
  type InventoryRow,
  type MovementRow,
  type PriceHistoryRow,
  type StockAdjustmentType,
} from '@/domain/admin/schemas';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { BulkBar, DataTable, type Column } from '../../ui/DataTable';
import { Dialog } from '../../ui/Dialog';
import { InputField, SelectField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized, useLookups } from './catalogHooks';
import { StockStateBadge } from './catalogParts';

type TabId = 'stock' | 'movements' | 'prices';
const PAGE = 50;

/** Stock levels, typed adjustments with reasons, movement history and price history. */
export function AdminInventoryPage() {
  const { at } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId | null) ?? 'stock';
  return (
    <>
      <PageHeader title={at('modules.inventory.title')} subtitle={at('inventory.subtitle')} />
      <Tabs
        idBase="inventory"
        label={at('modules.inventory.title')}
        tabs={[
          { id: 'stock', label: at('inventory.tabs.stock') },
          { id: 'movements', label: at('inventory.tabs.movements') },
          { id: 'prices', label: at('inventory.tabs.prices') },
        ]}
        active={tab}
        onChange={(id) => {
          const next = new URLSearchParams();
          next.set('tab', id);
          setParams(next, { replace: true });
        }}
      />
      <TabPanel idBase="inventory" active={tab}>
        {tab === 'stock' && <StockTab />}
        {tab === 'movements' && <MovementsTab />}
        {tab === 'prices' && <PriceHistoryTab />}
      </TabPanel>
    </>
  );
}

function StockTab() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [pricing, setPricing] = useState<InventoryRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const filter: InventoryFilter = {
    q: params.get('q'),
    view: (params.get('view') as InventoryFilter['view']) ?? 'all',
    brandId: params.get('brand'),
    categoryId: params.get('category'),
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin', 'inventory', filter],
    queryFn: () => repo.listInventory(filter),
    placeholderData: (prev) => prev,
  });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
    setSelected(new Set());
  };
  const canStock = can('inventory.manage');
  const canPrice = can('pricing.manage');
  const rows = list.data?.items ?? [];
  const label = (r: InventoryRow) =>
    `${loc(r.productName)} · ${r.variantLabel.map(loc).join(' / ') || r.sku}`;

  const columns: Column<InventoryRow>[] = [
    {
      id: 'sku',
      header: 'SKU',
      rowHeader: true,
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span className={styles.mono}>{r.sku}</span>
          <Link to={`/admin/products/${r.productId}`} className={styles.small}>
            {loc(r.productName)}
          </Link>
          <span className={`${styles.small} ${styles.muted}`}>
            {r.variantLabel.map(loc).join(' / ')}
          </span>
        </span>
      ),
    },
    {
      id: 'onhand',
      header: at('inventory.col.onHand'),
      className: styles.num,
      cell: (r) => format.number(r.quantity),
    },
    {
      id: 'reserved',
      header: at('inventory.col.reserved'),
      className: styles.num,
      cell: (r) => format.number(r.reserved),
    },
    {
      id: 'available',
      header: at('inventory.col.available'),
      className: styles.num,
      cell: (r) => format.number(r.available),
    },
    {
      id: 'threshold',
      header: at('inventory.col.threshold'),
      className: styles.num,
      cell: (r) => format.number(r.lowStockThreshold),
    },
    {
      id: 'state',
      header: at('inventory.col.state'),
      cell: (r) => <StockStateBadge state={r.state} />,
    },
    {
      id: 'price',
      header: at('inventory.col.price'),
      className: styles.num,
      cell: (r) => (r.price === null ? '—' : format.money(r.price, { fractionDigits: 0 })),
    },
    {
      id: 'lastPrice',
      header: at('inventory.col.lastPriceChange'),
      cell: (r) =>
        r.lastPriceChange ? (
          <span className={`${styles.small} ${styles.cellTitle}`} style={{ minWidth: 160 }}>
            <span>
              {at('inventory.previousPrice', {
                price:
                  r.lastPriceChange.oldPrice === null
                    ? '—'
                    : format.money(r.lastPriceChange.oldPrice, { fractionDigits: 0 }),
              })}
            </span>
            <span className={styles.muted}>
              {format.date(r.lastPriceChange.at)} ·{' '}
              {r.lastPriceChange.by ??
                at(`inventory.source.${r.lastPriceChange.source}` as AdminMessageKey)}
            </span>
            {r.lastPriceChange.reason && (
              <span className={styles.muted}>{r.lastPriceChange.reason}</span>
            )}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'moved',
      header: at('inventory.col.lastMovement'),
      className: styles.nowrap,
      cell: (r) => (
        <span className={styles.small}>
          {r.lastMovementAt ? format.date(r.lastMovementAt) : '—'}
          {r.backInStockAt && (
            <>
              {' '}
              <Badge tone="success">{at('inventory.backInStock')}</Badge>
            </>
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: (r) => (
        <span className={styles.rowActions}>
          {canStock && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('inventory.adjust')}: ${label(r)}`}
              onClick={() => setAdjusting(r)}
            >
              <PackagePlus aria-hidden="true" />
            </button>
          )}
          {canPrice && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('inventory.changePrice')}: ${label(r)}`}
              onClick={() => setPricing(r)}
            >
              <Tag aria-hidden="true" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <form
        className={styles.filters}
        role="search"
        aria-label={at('inventory.filters')}
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', q.trim());
        }}
      >
        <InputField
          label={at('ui.search')}
          type="search"
          value={q}
          placeholder={at('inventory.searchPlaceholder')}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label={at('inventory.view')}
          value={filter.view ?? 'all'}
          onChange={(e) => setParam('view', e.target.value === 'all' ? '' : e.target.value)}
          options={[
            { value: 'all', label: at('ui.all') },
            { value: 'low', label: at('catalog.stockState.low') },
            { value: 'out', label: at('catalog.stockState.out') },
            { value: 'back_in_stock', label: at('inventory.backInStock') },
          ]}
        />
        <SelectField
          label={at('catalog.col.brand')}
          value={filter.brandId ?? ''}
          onChange={(e) => setParam('brand', e.target.value)}
          options={[
            { value: '', label: at('ui.all') },
            ...(lookups.data?.brands ?? []).map((b) => ({ value: b.id, label: loc(b.name) })),
          ]}
        />
        <SelectField
          label={at('catalog.col.category')}
          value={filter.categoryId ?? ''}
          onChange={(e) => setParam('category', e.target.value)}
          options={[
            { value: '', label: at('ui.all') },
            ...(lookups.data?.categories ?? []).map((c) => ({ value: c.id, label: loc(c.name) })),
          ]}
        />
        <div className={styles.filterActions}>
          <Button type="submit" icon={<Search aria-hidden="true" />}>
            {at('ui.apply')}
          </Button>
        </div>
      </form>
      <QueryState query={list} isEmpty={(d) => d.items.length === 0}>
        {(data) => (
          <>
            <p className={styles.muted} aria-live="polite">
              {at('ui.rowsCount', { count: format.number(data.total) })}
            </p>
            <DataTable
              caption={at('inventory.tabs.stock')}
              rows={data.items}
              rowKey={(r) => r.variantId}
              rowLabel={label}
              columns={columns}
              selected={canPrice || can('catalog.manage') || canStock ? selected : undefined}
              onSelectedChange={
                canPrice || can('catalog.manage') || canStock ? setSelected : undefined
              }
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
        <Button size="sm" variant="accent" onClick={() => setBulk(true)}>
          {at('inventory.bulkEdit')}
        </Button>
      </BulkBar>
      {adjusting && (
        <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} label={label(adjusting)} />
      )}
      {pricing && (
        <PriceDialog row={pricing} onClose={() => setPricing(null)} label={label(pricing)} />
      )}
      {bulk && (
        <BulkVariantDialog
          rows={rows.filter((r) => selected.has(r.variantId))}
          label={label}
          onClose={(done) => {
            setBulk(false);
            if (done) setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function AdjustDialog({
  row,
  onClose,
  label,
}: {
  row: InventoryRow;
  onClose: () => void;
  label: string;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const [type, setType] = useState<StockAdjustmentType>('addition');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useAdminAction(
    () => repo.adjustStock(row.variantId, type, Number(quantity), reason.trim(), row.quantity),
    { onSuccess: onClose },
  );
  const qty = Number(quantity);
  const valid = quantity.trim() !== '' && Number.isInteger(qty) && qty >= 0;
  const after = !valid
    ? null
    : type === 'addition' || type === 'return'
      ? row.quantity + qty
      : type === 'correction'
        ? qty
        : row.quantity - qty;
  return (
    <Dialog open onClose={onClose} title={at('inventory.adjustTitle')} icon={<PackagePlus />}>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void adjust.run();
        }}
      >
        <p>
          <strong>{label}</strong> <span className={styles.mono}>{row.sku}</span>
        </p>
        <SelectField
          label={at('inventory.adjustType')}
          value={type}
          onChange={(e) => setType(e.target.value as StockAdjustmentType)}
          options={STOCK_ADJUSTMENT_TYPES.map((t) => ({
            value: t,
            label: at(`inventory.type.${t}` as AdminMessageKey),
          }))}
        />
        <InputField
          label={type === 'correction' ? at('inventory.countedQuantity') : at('inventory.quantity')}
          value={quantity}
          inputMode="numeric"
          ltr
          required
          onChange={(e) => setQuantity(e.target.value)}
        />
        <InputField
          label={at('ui.reason')}
          hint={at('ui.reasonHint')}
          value={reason}
          required
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
        <dl className={styles.formGrid} style={{ margin: 0 }}>
          <div>
            <dt className={styles.fieldLabel}>{at('inventory.before')}</dt>
            <dd style={{ margin: 0 }}>{format.number(row.quantity)}</dd>
          </div>
          <div>
            <dt className={styles.fieldLabel}>{at('inventory.after')}</dt>
            <dd style={{ margin: 0 }} aria-live="polite">
              {after === null ? '—' : format.number(after)}
            </dd>
          </div>
          <div>
            <dt className={styles.fieldLabel}>{at('inventory.col.reserved')}</dt>
            <dd style={{ margin: 0 }}>{format.number(row.reserved)}</dd>
          </div>
        </dl>
        {after !== null && after < row.reserved && (
          <Alert tone="warning">{at('problems.below_reserved')}</Alert>
        )}
        {adjust.error && (
          <Alert tone="danger" live>
            {adjust.error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button
            type="submit"
            loading={adjust.pending}
            disabled={!valid || !reason.trim()}
            variant={type === 'damage' || type === 'reduction' ? 'danger' : 'primary'}
          >
            {at('inventory.applyAdjustment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PriceDialog({
  row,
  onClose,
  label,
}: {
  row: InventoryRow;
  onClose: () => void;
  label: string;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const [price, setPrice] = useState(row.price === null ? '' : String(row.price));
  const [compare, setCompare] = useState(
    row.compareAtPrice === null ? '' : String(row.compareAtPrice),
  );
  const [reason, setReason] = useState('');
  const toNum = (s: string) => (s.trim() === '' ? null : Number(s));
  const change = useAdminAction(
    () =>
      repo.setVariantPrice(
        row.variantId,
        toNum(price),
        toNum(compare),
        reason.trim(),
        row.updatedAt,
      ),
    { onSuccess: onClose },
  );
  return (
    <Dialog open onClose={onClose} title={at('inventory.priceTitle')} icon={<Tag />}>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void change.run();
        }}
      >
        <p>
          <strong>{label}</strong> <span className={styles.mono}>{row.sku}</span>
        </p>
        <p className={styles.small}>
          {at('inventory.currentPrice', {
            price: row.price === null ? '—' : format.money(row.price, { fractionDigits: 0 }),
          })}
          {row.lastPriceChange &&
            ` · ${at('inventory.previousPrice', { price: row.lastPriceChange.oldPrice === null ? '—' : format.money(row.lastPriceChange.oldPrice, { fractionDigits: 0 }) })} (${format.date(row.lastPriceChange.at)})`}
        </p>
        <div className={styles.formGrid}>
          <InputField
            label={at('catalog.editor.price')}
            value={price}
            inputMode="decimal"
            ltr
            onChange={(e) => setPrice(e.target.value)}
          />
          <InputField
            label={at('catalog.editor.compareAt')}
            hint={at('inventory.compareHint')}
            value={compare}
            inputMode="decimal"
            ltr
            onChange={(e) => setCompare(e.target.value)}
          />
        </div>
        <InputField
          label={at('ui.reason')}
          hint={at('ui.reasonHint')}
          value={reason}
          required
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
        {change.code === 'stale' ? (
          <Alert tone="warning" live>
            {at('ui.staleBody')}
          </Alert>
        ) : (
          change.error && (
            <Alert tone="danger" live>
              {change.error}
            </Alert>
          )
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" loading={change.pending} disabled={!reason.trim()}>
            {at('inventory.savePrice')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BulkVariantDialog({
  rows,
  label,
  onClose,
}: {
  rows: InventoryRow[];
  label: (r: InventoryRow) => string;
  onClose: (done: boolean) => void;
}) {
  const { at } = useAdminI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const [priceMode, setPriceMode] = useState<'' | 'set' | 'percent' | 'amount'>('');
  const [priceValue, setPriceValue] = useState('');
  const [compareAt, setCompareAt] = useState<'keep' | 'clear' | 'previous'>('keep');
  const [active, setActive] = useState<'' | 'on' | 'off'>('');
  const [threshold, setThreshold] = useState('');
  const [warrantyKind, setWarrantyKind] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const patch: BulkVariantPatch = {};
  if (priceMode) {
    patch.priceMode = priceMode;
    patch.priceValue = Number(priceValue);
  }
  if (compareAt !== 'keep') patch.compareAt = compareAt;
  if (active) patch.isActive = active === 'on';
  if (threshold.trim()) patch.lowStockThreshold = Number(threshold);
  if (warrantyKind)
    patch.warrantyKind =
      warrantyKind === 'none-set' ? null : (warrantyKind as BulkVariantPatch['warrantyKind']);
  const run = useAdminAction(
    () =>
      repo.bulkUpdateVariants(
        rows.map((r) => r.variantId),
        patch,
        reason.trim(),
      ),
    {
      onSuccess: () => onClose(true),
    },
  );
  const empty = Object.keys(patch).length === 0;
  return (
    <Dialog
      open
      onClose={() => onClose(false)}
      title={at('inventory.bulkTitle', { count: rows.length })}
      wide
      tone="danger"
    >
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirmed) return setConfirmed(true);
          void run.run();
        }}
      >
        <ul className={styles.affected}>
          {rows.map((r) => (
            <li key={r.variantId}>
              <span className={styles.mono}>{r.sku}</span> — {label(r)}
            </li>
          ))}
        </ul>
        <div className={styles.formGrid}>
          {can('pricing.manage') && (
            <>
              <SelectField
                label={at('inventory.bulk.priceMode')}
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value as typeof priceMode)}
                options={[
                  { value: '', label: at('inventory.bulk.noPriceChange') },
                  { value: 'set', label: at('inventory.bulk.set') },
                  { value: 'percent', label: at('inventory.bulk.percent') },
                  { value: 'amount', label: at('inventory.bulk.amount') },
                ]}
              />
              {priceMode && (
                <InputField
                  label={at('inventory.bulk.value')}
                  hint={at(`inventory.bulk.${priceMode}Hint` as AdminMessageKey)}
                  value={priceValue}
                  inputMode="decimal"
                  ltr
                  onChange={(e) => setPriceValue(e.target.value)}
                />
              )}
              <SelectField
                label={at('inventory.bulk.compareAt')}
                value={compareAt}
                onChange={(e) => setCompareAt(e.target.value as typeof compareAt)}
                options={[
                  { value: 'keep', label: at('inventory.bulk.keep') },
                  { value: 'previous', label: at('inventory.bulk.previous') },
                  { value: 'clear', label: at('inventory.bulk.clear') },
                ]}
              />
            </>
          )}
          {can('catalog.manage') && (
            <>
              <SelectField
                label={at('inventory.bulk.availability')}
                value={active}
                onChange={(e) => setActive(e.target.value as typeof active)}
                options={[
                  { value: '', label: at('inventory.bulk.keep') },
                  { value: 'on', label: at('catalog.editor.active') },
                  { value: 'off', label: at('catalog.editor.inactive') },
                ]}
              />
              <SelectField
                label={at('catalog.editor.variantWarranty')}
                value={warrantyKind}
                onChange={(e) => setWarrantyKind(e.target.value)}
                options={[
                  { value: '', label: at('inventory.bulk.keep') },
                  { value: 'none-set', label: at('catalog.editor.inheritWarranty') },
                  ...WARRANTY_KINDS.map((k) => ({
                    value: k,
                    label: at(`catalog.warranty.${k}` as AdminMessageKey),
                  })),
                ]}
              />
            </>
          )}
          {(can('inventory.manage') || can('catalog.manage')) && (
            <InputField
              label={at('catalog.editor.lowStock')}
              hint={at('inventory.bulk.keepEmpty')}
              value={threshold}
              inputMode="numeric"
              ltr
              onChange={(e) => setThreshold(e.target.value)}
            />
          )}
        </div>
        <InputField
          label={at('ui.reason')}
          hint={at('ui.reasonHint')}
          value={reason}
          maxLength={300}
          required={Boolean(priceMode) || compareAt !== 'keep'}
          onChange={(e) => setReason(e.target.value)}
        />
        {confirmed && (
          <Alert tone="warning">{at('inventory.bulk.confirm', { count: rows.length })}</Alert>
        )}
        {run.error && (
          <Alert tone="danger" live>
            {run.error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => onClose(false)}>
            {at('ui.cancel')}
          </Button>
          <Button
            type="submit"
            variant={confirmed ? 'danger' : 'primary'}
            loading={run.pending}
            disabled={empty}
          >
            {confirmed
              ? at('inventory.bulk.apply', { count: rows.length })
              : at('inventory.bulk.review')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MovementsTab() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<{
    q: string;
    type: string;
    actor: string;
    from: string;
    to: string;
    offset: number;
  }>({ q: '', type: '', actor: '', from: '', to: '', offset: 0 });
  const [actor, setActor] = useState('');
  const list = useQuery({
    queryKey: ['admin', 'movements', filter],
    queryFn: () =>
      repo.listStockMovements({
        q: filter.q || null,
        type: (filter.type || null) as MovementRow['type'] | null,
        actor: filter.actor || null,
        from: filter.from ? new Date(filter.from).toISOString() : null,
        to: filter.to ? new Date(new Date(filter.to).getTime() + 86_400_000).toISOString() : null,
        limit: PAGE,
        offset: filter.offset,
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<MovementRow>[] = [
    {
      id: 'date',
      header: at('inventory.col.date'),
      className: styles.nowrap,
      cell: (m) => format.dateTime(m.createdAt),
    },
    {
      id: 'type',
      header: at('inventory.col.type'),
      cell: (m) => (
        <Badge tone={m.change >= 0 ? 'success' : 'warning'}>
          {at(`inventory.type.${m.type}` as AdminMessageKey)}
        </Badge>
      ),
    },
    {
      id: 'variant',
      header: 'SKU',
      rowHeader: true,
      cell: (m) => (
        <span className={styles.cellTitle}>
          <span className={styles.mono}>{m.sku}</span>
          <span className={styles.small}>
            {loc(m.productName)} {m.variantLabel.map(loc).join(' / ')}
          </span>
        </span>
      ),
    },
    {
      id: 'before',
      header: at('inventory.before'),
      className: styles.num,
      cell: (m) => format.number(m.quantityBefore),
    },
    {
      id: 'change',
      header: at('inventory.col.change'),
      className: styles.num,
      cell: (m) => <bdi dir="ltr">{m.change > 0 ? `+${m.change}` : m.change}</bdi>,
    },
    {
      id: 'after',
      header: at('inventory.after'),
      className: styles.num,
      cell: (m) => format.number(m.quantityAfter),
    },
    { id: 'reason', header: at('ui.reason'), cell: (m) => m.reason ?? '—' },
    {
      id: 'order',
      header: at('inventory.col.order'),
      cell: (m) => (m.orderNumber ? <bdi className={styles.mono}>{m.orderNumber}</bdi> : '—'),
    },
    { id: 'actor', header: at('inventory.col.staff'), cell: (m) => m.actorName ?? '—' },
  ];
  return (
    <div className={styles.stack}>
      <form
        className={styles.filters}
        role="search"
        aria-label={at('inventory.filters')}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter((f) => ({ ...f, q: q.trim(), actor: actor.trim(), offset: 0 }));
        }}
      >
        <InputField
          label={at('ui.search')}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label={at('inventory.col.type')}
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value, offset: 0 }))}
          options={[
            { value: '', label: at('ui.all') },
            ...MOVEMENT_TYPES.map((t) => ({
              value: t,
              label: at(`inventory.type.${t}` as AdminMessageKey),
            })),
          ]}
        />
        <InputField
          label={at('inventory.col.staff')}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <InputField
          type="date"
          label={at('ui.from')}
          value={filter.from}
          onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value, offset: 0 }))}
        />
        <InputField
          type="date"
          label={at('ui.to')}
          value={filter.to}
          onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value, offset: 0 }))}
        />
        <div className={styles.filterActions}>
          <Button type="submit" icon={<Search aria-hidden="true" />}>
            {at('ui.apply')}
          </Button>
        </div>
      </form>
      <QueryState query={list} isEmpty={(d) => d.items.length === 0}>
        {(data) => (
          <>
            <DataTable
              caption={at('inventory.tabs.movements')}
              rows={data.items}
              rowKey={(m) => String(m.id)}
              columns={columns}
            />
            <Pagination
              total={data.total}
              limit={PAGE}
              offset={filter.offset}
              onChange={(offset) => setFilter((f) => ({ ...f, offset }))}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}

function PriceHistoryTab() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const [actor, setActor] = useState('');
  const [filter, setFilter] = useState({
    q: '',
    actor: '',
    source: '',
    from: '',
    to: '',
    offset: 0,
  });
  const list = useQuery({
    queryKey: ['admin', 'price-history', filter],
    queryFn: () =>
      repo.listPriceHistory({
        q: filter.q || null,
        actor: filter.actor || null,
        source: filter.source || null,
        from: filter.from ? new Date(filter.from).toISOString() : null,
        to: filter.to ? new Date(new Date(filter.to).getTime() + 86_400_000).toISOString() : null,
        limit: PAGE,
        offset: filter.offset,
      }),
    placeholderData: (prev) => prev,
  });
  const money = (n: number | null) => (n === null ? '—' : format.money(n, { fractionDigits: 0 }));
  const columns: Column<PriceHistoryRow>[] = [
    {
      id: 'date',
      header: at('inventory.col.date'),
      className: styles.nowrap,
      cell: (h) => format.dateTime(h.createdAt),
    },
    {
      id: 'variant',
      header: 'SKU',
      rowHeader: true,
      cell: (h) => (
        <span className={styles.cellTitle}>
          <span className={styles.mono}>{h.sku}</span>
          <span className={styles.small}>
            {loc(h.productName)} {h.variantLabel.map(loc).join(' / ')}
          </span>
        </span>
      ),
    },
    {
      id: 'old',
      header: at('inventory.col.oldPrice'),
      className: styles.num,
      cell: (h) => money(h.oldPrice),
    },
    {
      id: 'new',
      header: at('inventory.col.newPrice'),
      className: styles.num,
      cell: (h) => money(h.newPrice),
    },
    {
      id: 'compare',
      header: at('catalog.editor.compareAt'),
      className: styles.num,
      cell: (h) => `${money(h.oldCompareAt)} → ${money(h.newCompareAt)}`,
    },
    {
      id: 'source',
      header: at('inventory.col.source'),
      cell: (h) => <Badge>{at(`inventory.source.${h.source}` as AdminMessageKey)}</Badge>,
    },
    { id: 'reason', header: at('ui.reason'), cell: (h) => h.reason ?? '—' },
    { id: 'actor', header: at('inventory.col.staff'), cell: (h) => h.actorName ?? '—' },
  ];
  return (
    <div className={styles.stack}>
      <form
        className={styles.filters}
        role="search"
        aria-label={at('inventory.filters')}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter((f) => ({ ...f, q: q.trim(), actor: actor.trim(), offset: 0 }));
        }}
      >
        <InputField
          label={at('inventory.searchProductVariant')}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <InputField
          label={at('inventory.col.staff')}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <SelectField
          label={at('inventory.col.source')}
          value={filter.source}
          onChange={(e) => setFilter((f) => ({ ...f, source: e.target.value, offset: 0 }))}
          options={[
            { value: '', label: at('ui.all') },
            ...(['admin', 'bulk', 'import', 'system'] as const).map((s) => ({
              value: s,
              label: at(`inventory.source.${s}`),
            })),
          ]}
        />
        <InputField
          type="date"
          label={at('ui.from')}
          value={filter.from}
          onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value, offset: 0 }))}
        />
        <InputField
          type="date"
          label={at('ui.to')}
          value={filter.to}
          onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value, offset: 0 }))}
        />
        <div className={styles.filterActions}>
          <Button type="submit" icon={<Search aria-hidden="true" />}>
            {at('ui.apply')}
          </Button>
        </div>
      </form>
      <QueryState query={list} isEmpty={(d) => d.items.length === 0}>
        {(data) => (
          <>
            <DataTable
              caption={at('inventory.tabs.prices')}
              rows={data.items}
              rowKey={(h) => String(h.id)}
              columns={columns}
            />
            <Pagination
              total={data.total}
              limit={PAGE}
              offset={filter.offset}
              onChange={(offset) => setFilter((f) => ({ ...f, offset }))}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
