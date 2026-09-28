import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { downloadText, flattenRow, toCsv } from '@/domain/admin/csv';
import {
  SERVICE_PRIORITIES,
  SLA_STATES,
  type AdminServiceFilter,
  type AdminServiceRow,
  type ServicePriority,
  type ServiceView,
  type SlaState,
} from '@/domain/admin/schemas';
import type { PermissionKey } from '@/domain/access/permissions';
import { resolveLocalized } from '@/domain/localized';
import {
  BATTERY_PREFERENCES,
  SERVICE_STATUSES,
  TAX_PREFERENCES,
  type ServiceKind,
  type StaffServiceRequest,
} from '@/domain/services/types';
import { useAccess } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { statusLabelKey } from '@/storefront/services/serviceLabels';
import { StatusPill } from '@/storefront/services/ServiceParts';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { InputField, SelectField } from '../../ui/fields';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';

const PATH: Record<ServiceKind, string> = {
  repair: 'repairs',
  trade_in: 'trade-in',
  used: 'used-requests',
  after_sales: 'after-sales',
};
const MANAGE: Record<ServiceKind, PermissionKey> = {
  repair: 'repairs.manage',
  trade_in: 'tradein.manage',
  used: 'used_requests.manage',
  after_sales: 'after_sales.manage',
};
const VIEWS: ServiceView[] = [
  'new',
  'awaiting',
  'in_progress',
  'ready',
  'completed',
  'open',
  'all',
];
const PAGE = 50;
const SLA_TONE: Record<SlaState, BadgeTone> = {
  on_track: 'success',
  approaching: 'warning',
  overdue: 'danger',
  waiting_customer: 'info',
  closed: 'neutral',
};
const PRIORITY_TONE: Record<ServicePriority, BadgeTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
};

export function SlaBadge({ sla }: { sla: SlaState }) {
  const { at } = useAdminI18n();
  return <Badge tone={SLA_TONE[sla]}>{at(`svcQueue.sla.${sla}` as AdminMessageKey)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ServicePriority }) {
  const { at } = useAdminI18n();
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      {at(`svcQueue.priority.${priority}` as AdminMessageKey)}
    </Badge>
  );
}

/**
 * Service queue: New / Awaiting customer / In progress / Ready / Completed views, priority and
 * SLA aging (internal targets only), per-kind filters, assignment and CSV export.
 */
export function ServiceQueuePage({ kind }: { kind: ServiceKind }) {
  const { at } = useAdminI18n();
  const { t, locale, format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const { repositories } = useRuntime();
  const settings = useSettings();
  const errorText = useErrorText();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [exportError, setExportError] = useState<string | null>(null);
  const num = (key: string) => (params.get(key) ? Number(params.get(key)) : null);
  const view = (params.get('view') as ServiceView | null) ?? 'open';
  const filter: AdminServiceFilter = {
    view,
    status: params.get('status'),
    q: params.get('q'),
    assigned: params.get('assigned'),
    priority: (params.get('priority') as ServicePriority | null) ?? null,
    sla: (params.get('sla') as SlaState | null) ?? null,
    deviceCategory: params.get('device'),
    afterSalesType: params.get('type'),
    battery: params.get('battery'),
    tax: params.get('tax'),
    budgetMin: num('budgetMin'),
    budgetMax: num('budgetMax'),
    from: params.get('from') ? new Date(`${params.get('from')}T00:00:00`).toISOString() : null,
    to: params.get('to')
      ? new Date(new Date(`${params.get('to')}T00:00:00`).getTime() + 86_400_000).toISOString()
      : null,
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const list = useQuery({
    queryKey: ['admin-services', 'queue', kind, filter],
    queryFn: () => repo.listServiceRequests(kind, filter),
    placeholderData: (prev) => prev,
  });
  const assignees = useQuery({
    queryKey: ['admin-services', 'assignees', kind],
    queryFn: () => repositories.serviceOps.assignees(kind),
  });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  };
  const title = at(`modules.${PATH[kind]}.title` as AdminMessageKey);
  const base = `/admin/${PATH[kind]}`;

  const columns: Column<AdminServiceRow>[] = [
    {
      id: 'number',
      header: at('servicesAdmin.number'),
      rowHeader: true,
      cell: (r) => (
        <Link to={`${base}/${r.id}`} className={styles.mono} style={{ fontWeight: 700 }}>
          <bdi dir="ltr">{r.number}</bdi>
        </Link>
      ),
    },
    {
      id: 'age',
      header: at('svcQueue.age'),
      className: styles.nowrap,
      cell: (r) => (
        <span className={styles.cellTitle} style={{ minWidth: 0 }}>
          <span>{format.dateTime(r.createdAt)}</span>
          <span className={`${styles.small} ${styles.muted}`}>
            {at('svcQueue.hours', { count: format.number(r.ageHours) })}
          </span>
        </span>
      ),
    },
    {
      id: 'customer',
      header: at('orders.customer'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span>{r.contactName}</span>
          <bdi dir="ltr" className={`${styles.small} ${styles.muted}`}>
            {r.contactPhone}
          </bdi>
        </span>
      ),
    },
    {
      id: 'device',
      header: t('services.device'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span>{resolveLocalized(r.title, locale)}</span>
          {kind === 'used' && r.budget !== null && (
            <span className={styles.small}>
              {at('svcQueue.budget', { amount: format.money(r.budget, { fractionDigits: 0 }) })}
            </span>
          )}
          {kind === 'after_sales' && r.afterSalesType && (
            <span className={styles.small}>
              {at(`svcQueue.afterSales.${r.afterSalesType}` as AdminMessageKey)}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: at('servicesAdmin.status'),
      cell: (r) => <StatusPill status={r.status} />,
    },
    {
      id: 'priority',
      header: at('svcQueue.priorityLabel'),
      cell: (r) => <PriorityBadge priority={r.priority} />,
    },
    { id: 'sla', header: at('svcQueue.slaLabel'), cell: (r) => <SlaBadge sla={r.sla} /> },
    {
      id: 'assigned',
      header: at('servicesAdmin.assigned'),
      cell: (r) => r.assignedTo?.name ?? at('servicesAdmin.unassigned'),
    },
    {
      id: 'flags',
      header: at('orders.flags'),
      cell: (r) => (
        <span className={styles.chips}>
          {r.awaitingCustomer && <Badge tone="info">{at('servicesAdmin.flagAwaiting')}</Badge>}
          {r.openOffer && <Badge tone="warning">{at('servicesAdmin.flagOffer')}</Badge>}
          {r.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
        </span>
      ),
    },
  ];

  const exportCsv = async () => {
    setExportError(null);
    try {
      const result = await repo.exportData(kind);
      downloadText(
        `${PATH[kind]}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(result.rows.map((r) => flattenRow(r))),
      );
    } catch (e) {
      setExportError(errorText(e, true));
    }
  };

  const counts = list.data?.counts;
  return (
    <>
      <PageHeader
        title={title}
        subtitle={at('servicesAdmin.subtitle')}
        actions={
          can('reports.export') && (
            <Button
              variant="secondary"
              icon={<Download aria-hidden="true" />}
              onClick={() => void exportCsv()}
            >
              {at('ui.exportCsv')}
            </Button>
          )
        }
      />
      <div className={styles.stack}>
        <Tabs
          idBase={`svc-${kind}`}
          label={at('svcQueue.views')}
          active={view}
          onChange={(v) => setParam('view', v === 'open' ? '' : v)}
          tabs={VIEWS.map((v) => ({
            id: v,
            label: at(`svcQueue.view.${v}` as AdminMessageKey),
            count: counts && v in counts ? counts[v as keyof typeof counts] : undefined,
          }))}
        />
        {counts && (counts.overdue > 0 || counts.approaching > 0) && (
          <Alert tone={counts.overdue > 0 ? 'danger' : 'warning'}>
            {at('svcQueue.slaSummary', {
              overdue: counts.overdue,
              approaching: counts.approaching,
            })}
          </Alert>
        )}
        <p className={styles.hint}>{at('svcQueue.slaDisclaimer')}</p>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('svcQueue.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <InputField
            label={at('servicesAdmin.search')}
            value={q}
            ltr
            placeholder="RP-2026-000001 / 010…"
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('servicesAdmin.status')}
            value={filter.status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...SERVICE_STATUSES[kind].map((s) => ({ value: s, label: t(statusLabelKey(s)) })),
            ]}
          />
          <SelectField
            label={at('svcQueue.priorityLabel')}
            value={filter.priority ?? ''}
            onChange={(e) => setParam('priority', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...SERVICE_PRIORITIES.map((p) => ({ value: p, label: at(`svcQueue.priority.${p}`) })),
            ]}
          />
          <SelectField
            label={at('svcQueue.slaLabel')}
            value={filter.sla ?? ''}
            onChange={(e) => setParam('sla', e.target.value)}
            options={[
              { value: '', label: at('ui.all') },
              ...SLA_STATES.map((s) => ({ value: s, label: at(`svcQueue.sla.${s}`) })),
            ]}
          />
          <SelectField
            label={at('servicesAdmin.assigned')}
            value={filter.assigned ?? ''}
            onChange={(e) => setParam('assigned', e.target.value)}
            options={[
              { value: '', label: at('servicesAdmin.assignedAny') },
              { value: 'me', label: at('servicesAdmin.assignedMe') },
              { value: 'unassigned', label: at('servicesAdmin.unassigned') },
              ...(assignees.data ?? []).map((a) => ({ value: a.id, label: a.name ?? a.id })),
            ]}
          />
          {(kind === 'repair' || kind === 'trade_in') && (
            <SelectField
              label={at('svcQueue.deviceCategory')}
              value={filter.deviceCategory ?? ''}
              onChange={(e) => setParam('device', e.target.value)}
              options={[
                { value: '', label: at('ui.all') },
                ...settings.repair_catalog.categories.map((c) => ({
                  value: c.key,
                  label: resolveLocalized(c.label, locale),
                })),
              ]}
            />
          )}
          {kind === 'after_sales' && (
            <SelectField
              label={at('svcQueue.afterSalesType')}
              value={filter.afterSalesType ?? ''}
              onChange={(e) => setParam('type', e.target.value)}
              options={[
                { value: '', label: at('ui.all') },
                ...(['exchange', 'return', 'warranty'] as const).map((k) => ({
                  value: k,
                  label: at(`svcQueue.afterSales.${k}`),
                })),
              ]}
            />
          )}
          {kind === 'used' && (
            <>
              <InputField
                label={at('svcQueue.budgetMin')}
                inputMode="numeric"
                ltr
                value={params.get('budgetMin') ?? ''}
                onChange={(e) => setParam('budgetMin', e.target.value)}
              />
              <InputField
                label={at('svcQueue.budgetMax')}
                inputMode="numeric"
                ltr
                value={params.get('budgetMax') ?? ''}
                onChange={(e) => setParam('budgetMax', e.target.value)}
              />
              <SelectField
                label={at('svcQueue.battery')}
                value={filter.battery ?? ''}
                onChange={(e) => setParam('battery', e.target.value)}
                options={[
                  { value: '', label: at('ui.all') },
                  ...BATTERY_PREFERENCES.map((b) => ({
                    value: b,
                    label: at(`svcQueue.batteryOption.${b}`),
                  })),
                ]}
              />
              <SelectField
                label={at('svcQueue.tax')}
                value={filter.tax ?? ''}
                onChange={(e) => setParam('tax', e.target.value)}
                options={[
                  { value: '', label: at('ui.all') },
                  ...TAX_PREFERENCES.map((x) => ({
                    value: x,
                    label: at(`svcQueue.taxOption.${x}`),
                  })),
                ]}
              />
            </>
          )}
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
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
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
        {exportError && (
          <Alert tone="danger" live>
            {exportError}
          </Alert>
        )}
        <TabPanel idBase={`svc-${kind}`} active={view}>
          <QueryState
            query={list}
            isEmpty={(d) => d.items.length === 0}
            empty={at('servicesAdmin.empty')}
          >
            {(data) => (
              <>
                <p className={styles.muted} aria-live="polite">
                  {at('servicesAdmin.count', { count: data.total })}
                </p>
                <DataTable
                  caption={title}
                  rows={data.items}
                  rowKey={(r) => r.id}
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
        </TabPanel>
      </div>
    </>
  );
}

/** Priority, SLA aging and every notification the customer received for this request. */
export function ServiceContextPanel({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { format, locale } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const context = useQuery({
    queryKey: ['admin', 'service-context', request.id],
    queryFn: () => repo.serviceContext(request.id),
  });
  const [priority, setPriority] = useState<ServicePriority | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useAdminAction((p: ServicePriority) => repo.setServicePriority(request.id, p), {
    invalidate: ['admin-services'],
    onSuccess: () => setSaved(true),
  });
  return (
    <Panel title={at('svcQueue.context')} headingLevel={2}>
      <QueryState query={context} skeletonHeight="8rem">
        {(c) =>
          c && (
            <div className={styles.stack}>
              <span className={styles.chips}>
                <PriorityBadge priority={c.priority} />
                <SlaBadge sla={c.sla} />
              </span>
              <p className={`${styles.small} ${styles.muted}`}>
                {at('svcQueue.slaThresholds', {
                  warn: c.slaHours.warnHours,
                  overdue: c.slaHours.overdueHours,
                })}{' '}
                · {at('svcQueue.lastChange', { date: format.dateTime(c.lastChangeAt) })}
              </p>
              {can(MANAGE[request.kind]) && (
                <form
                  className={styles.stack}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (priority) void save.run(priority);
                  }}
                >
                  <SelectField
                    label={at('svcQueue.priorityLabel')}
                    value={priority ?? c.priority}
                    onChange={(e) => {
                      setSaved(false);
                      setPriority(e.target.value as ServicePriority);
                    }}
                    options={SERVICE_PRIORITIES.map((p) => ({
                      value: p,
                      label: at(`svcQueue.priority.${p}`),
                    }))}
                  />
                  {save.error && (
                    <Alert tone="danger" live>
                      {save.error}
                    </Alert>
                  )}
                  {saved && !save.error && (
                    <Alert tone="success" live>
                      {at('ui.saved')}
                    </Alert>
                  )}
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    loading={save.pending}
                    disabled={!priority || priority === c.priority}
                  >
                    {at('svcQueue.savePriority')}
                  </Button>
                </form>
              )}
              <div>
                <h3 className={styles.fieldLabel}>
                  {at('svcQueue.notifications', { count: c.notifications.length })}
                </h3>
                {c.notifications.length === 0 ? (
                  <p className={`${styles.small} ${styles.muted}`}>
                    {at('svcQueue.noNotifications')}
                  </p>
                ) : (
                  <ul
                    className={styles.small}
                    style={{ paddingInlineStart: 'var(--space-4)', margin: 0 }}
                  >
                    {c.notifications.map((n) => (
                      <li key={n.id}>
                        {resolveLocalized(n.title, locale)} · {format.dateTime(n.createdAt)} ·{' '}
                        {n.read ? at('customers.read') : at('customers.unread')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )
        }
      </QueryState>
    </Panel>
  );
}
