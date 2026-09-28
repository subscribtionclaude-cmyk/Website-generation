import { useQuery } from '@tanstack/react-query';
import { BellRing, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  FOLLOW_UP_STATES,
  type AbandonedCartFilter,
  type AbandonedCartRow,
  type FollowUpState,
} from '@/domain/admin/schemas';
import { resolveLocalized } from '@/domain/localized';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog } from '../../ui/Dialog';
import { InputField, SelectField, TextareaField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import customerStyles from './customers.module.css';

const PAGE = 50;

/**
 * Abandoned carts (derived from cart timestamps; no payment data, no tracking). Follow-up is a
 * single in-app reminder per idle period sent by the database when enabled, plus a manual
 * follow-up state staff record here — no paid messaging automation.
 */
export function AdminAbandonedCartsPage() {
  const { at } = useAdminI18n();
  const { format, locale } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const [draft, setDraft] = useState({ q: '', minHours: '', minValue: '', state: '' });
  const [filter, setFilter] = useState<AbandonedCartFilter>({ limit: PAGE, offset: 0 });
  const [editing, setEditing] = useState<AbandonedCartRow | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'abandoned-carts', filter],
    queryFn: () => repo.listAbandonedCarts(filter),
    placeholderData: (prev) => prev,
  });

  const columns: Column<AbandonedCartRow>[] = [
    {
      id: 'customer',
      header: at('abandonedAdmin.customer'),
      rowHeader: true,
      cell: (row) => (
        <span className={styles.cellTitle}>
          {can('customers.view') ? (
            <Link to={`/admin/customers/${row.customerId}`}>{row.customerName ?? '—'}</Link>
          ) : (
            (row.customerName ?? '—')
          )}
          {row.email && (
            <bdi dir="ltr" className={`${styles.small} ${styles.muted}`}>
              {row.email}
            </bdi>
          )}
          {row.phone && (
            <bdi dir="ltr" className={`${styles.small} ${styles.muted}`}>
              {row.phone}
            </bdi>
          )}
        </span>
      ),
    },
    {
      id: 'items',
      header: at('abandonedAdmin.items'),
      cell: (row) => (
        <ul className={customerStyles.items}>
          {row.items.map((item) => (
            <li key={item.sku}>
              <bdi>{resolveLocalized(item.name, locale)}</bdi> × {item.quantity}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'value',
      header: at('carts.value'),
      className: styles.num,
      cell: (row) => format.money(row.cartValue, { fractionDigits: 0 }),
    },
    {
      id: 'activity',
      header: at('abandonedAdmin.lastActivity'),
      className: styles.nowrap,
      cell: (row) => format.dateTime(row.lastActivity),
    },
    {
      id: 'reminded',
      header: at('abandonedAdmin.reminded'),
      cell: (row) =>
        row.reminded ? (
          <Badge tone="success" icon={<BellRing aria-hidden="true" />}>
            {at('abandonedAdmin.remindedYes')}
          </Badge>
        ) : (
          <Badge>{at('abandonedAdmin.remindedNo')}</Badge>
        ),
    },
    {
      id: 'followUp',
      header: at('carts.followUp'),
      cell: (row) => (
        <span className={styles.cellTitle}>
          <Badge
            tone={
              row.followUp === 'recovered'
                ? 'success'
                : row.followUp === 'none'
                  ? 'neutral'
                  : 'info'
            }
          >
            {at(`carts.state.${row.followUp}` as AdminMessageKey)}
          </Badge>
          {row.followUpNote && <span className={styles.small}>{row.followUpNote}</span>}
          {can('customers.manage') && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
              {at('carts.update')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={at('abandonedAdmin.title')} subtitle={at('abandonedAdmin.subtitle')} />
      <div className={styles.stack}>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('carts.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({
              q: draft.q.trim() || null,
              minHours: draft.minHours ? Number(draft.minHours) : null,
              minValue: draft.minValue ? Number(draft.minValue) : null,
              state: (draft.state || null) as FollowUpState | null,
              limit: PAGE,
              offset: 0,
            });
          }}
        >
          <InputField
            label={at('carts.customer')}
            type="search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
          <InputField
            label={at('carts.minHours')}
            inputMode="numeric"
            ltr
            value={draft.minHours}
            onChange={(e) => setDraft({ ...draft, minHours: e.target.value })}
          />
          <InputField
            label={at('carts.minValue')}
            inputMode="decimal"
            ltr
            value={draft.minValue}
            onChange={(e) => setDraft({ ...draft, minValue: e.target.value })}
          />
          <SelectField
            label={at('carts.followUp')}
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value })}
            options={[
              { value: '', label: at('ui.all') },
              ...FOLLOW_UP_STATES.map((s) => ({
                value: s,
                label: at(`carts.state.${s}` as AdminMessageKey),
              })),
            ]}
          />
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
              {at('ui.apply')}
            </Button>
          </div>
        </form>
        <QueryState query={list}>
          {(data) => (
            <>
              <Alert tone="info">
                {data.settings.enabled
                  ? at('abandonedAdmin.settings', {
                      hours: data.settings.thresholdHours,
                      mode:
                        data.settings.followUp === 'in_app'
                          ? at('abandonedAdmin.modeInApp')
                          : at('abandonedAdmin.modeNone'),
                    })
                  : at('abandonedAdmin.disabled')}
              </Alert>
              {data.items.length === 0 ? (
                <p className={styles.muted}>{at('abandonedAdmin.empty')}</p>
              ) : (
                <>
                  <DataTable
                    caption={at('abandonedAdmin.count', { count: data.total })}
                    rows={data.items}
                    rowKey={(r) => r.customerId}
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
            </>
          )}
        </QueryState>
      </div>
      {editing && <FollowUpDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function FollowUpDialog({ row, onClose }: { row: AbandonedCartRow; onClose: () => void }) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const [state, setState] = useState<FollowUpState>(row.followUp);
  const [note, setNote] = useState(row.followUpNote ?? '');
  const save = useAdminAction(
    () => repo.setCartFollowup(row.customerId, state, note.trim() || null),
    { onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={at('carts.updateTitle', { name: row.customerName ?? row.email ?? '—' })}
      icon={null}
    >
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <SelectField
          label={at('carts.followUp')}
          value={state}
          onChange={(e) => setState(e.target.value as FollowUpState)}
          options={FOLLOW_UP_STATES.map((s) => ({
            value: s,
            label: at(`carts.state.${s}` as AdminMessageKey),
          }))}
        />
        <TextareaField
          label={at('ui.note')}
          value={note}
          onChange={setNote}
          maxLength={1000}
          rows={3}
          hint={at('carts.noteHint')}
        />
        {save.error && (
          <Alert tone="danger" live>
            {save.error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" loading={save.pending}>
            {at('ui.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
