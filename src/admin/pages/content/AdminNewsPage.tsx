import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import {
  ENTRY_TYPES,
  PRODUCT_STATUSES,
  type EntryFilter,
  type EntryListItem,
  type EntryType,
  type ProductStatus,
} from '@/domain/admin/schemas';
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
import { StatusBadge } from '../catalog/catalogParts';
import { useLocalized } from '../catalog/catalogHooks';

const PAGE = 50;

/** News, launches, coming-soon teasers and campaigns (publishing needs content.publish). */
export function AdminNewsPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirm = useConfirm<ProductStatus>();
  const canManage = can('content.manage');
  const canPublish = can('content.publish');

  const filter: EntryFilter = {
    q: params.get('q') || null,
    type: (params.get('type') as EntryType | null) || null,
    status: (params.get('status') as ProductStatus | null) || null,
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin', 'entries', filter],
    queryFn: () => repo.listEntries(filter),
    placeholderData: (prev) => prev,
  });
  const bulk = useAdminAction(
    (status: ProductStatus) => repo.setEntriesStatus([...selected], status),
    { onSuccess: () => setSelected(new Set()) },
  );
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  };

  const columns: Column<EntryListItem>[] = [
    {
      id: 'media',
      header: <span className="visually-hidden">{at('newsAdmin.field.media')}</span>,
      cell: (e) =>
        e.mediaUrl ? <img className={styles.thumb} src={e.mediaUrl} alt="" loading="lazy" /> : null,
    },
    {
      id: 'title',
      header: at('newsAdmin.col.title'),
      rowHeader: true,
      cell: (e) => (
        <span className={styles.cellTitle}>
          <Link to={`/admin/news/${e.id}`}>{loc(e.title)}</Link>
          <span className={`${styles.mono} ${styles.muted}`}>{e.slug}</span>
        </span>
      ),
    },
    {
      id: 'type',
      header: at('newsAdmin.col.type'),
      cell: (e) => at(`newsAdmin.type.${e.type}` as AdminMessageKey),
    },
    {
      id: 'status',
      header: at('newsAdmin.col.status'),
      cell: (e) => (
        <span className={styles.chips}>
          <StatusBadge status={e.status} />
          {e.live && <Badge tone="success">{at('newsAdmin.live')}</Badge>}
          {e.isFeatured && <Badge tone="brand">{at('newsAdmin.featured')}</Badge>}
          {e.isDemo && <Badge>{at('ui.demo')}</Badge>}
        </span>
      ),
    },
    {
      id: 'dates',
      header: at('newsAdmin.col.window'),
      className: styles.nowrap,
      cell: (e) => (
        <span className={styles.small}>
          {format.dateTime(e.publishAt)}
          <br />
          {e.expiresAt ? format.dateTime(e.expiresAt) : at('offersAdmin.noEnd')}
        </span>
      ),
    },
  ];

  const bulkAsk = (status: ProductStatus) =>
    confirm.ask(
      {
        title: at(`offersAdmin.bulk.${status}` as AdminMessageKey),
        body: at('newsAdmin.bulkBody'),
        affected: (list.data?.items ?? [])
          .filter((e) => selected.has(e.id))
          .map((e) => loc(e.title)),
        confirmLabel: at(`offersAdmin.bulk.${status}` as AdminMessageKey),
        tone: status === 'published' ? 'default' : 'danger',
      },
      status,
    );

  return (
    <>
      <PageHeader
        title={at('modules.news.title')}
        subtitle={at('newsAdmin.subtitle')}
        actions={
          canManage && (
            <Link to="/admin/news/new" className={buttonClassName({ variant: 'primary' })}>
              <Plus aria-hidden="true" />
              {at('newsAdmin.new')}
            </Link>
          )
        }
      />
      <div className={styles.stack}>
        {canManage && !canPublish && <Alert tone="info">{at('newsAdmin.noPublish')}</Alert>}
        <form
          className={styles.filters}
          role="search"
          aria-label={at('newsAdmin.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('ui.search')}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('newsAdmin.col.type')}
            value={filter.type ?? ''}
            onChange={(e) => setParam('type', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...ENTRY_TYPES.map((t) => ({
                value: t,
                label: at(`newsAdmin.type.${t}` as AdminMessageKey),
              })),
            ]}
          />
          <SelectField
            label={at('newsAdmin.col.status')}
            value={filter.status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...PRODUCT_STATUSES.map((s) => ({
                value: s,
                label: at(`catalog.status.${s}` as AdminMessageKey),
              })),
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
        {bulk.error && (
          <Alert tone="danger" live>
            {bulk.error}
          </Alert>
        )}
        <QueryState
          query={list}
          isEmpty={(d) => d.items.length === 0}
          empty={at('newsAdmin.empty')}
        >
          {(data) => (
            <>
              <DataTable
                caption={at('ui.rowsCount', { count: data.total })}
                rows={data.items}
                rowKey={(e) => e.id}
                rowLabel={(e) => loc(e.title)}
                columns={columns}
                selected={canPublish ? selected : undefined}
                onSelectedChange={canPublish ? setSelected : undefined}
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
