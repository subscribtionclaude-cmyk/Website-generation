import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Boxes,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  CreditCard,
  Database,
  FlaskConical,
  History,
  KeyRound,
  ListChecks,
  PackageX,
  ShieldAlert,
  ShoppingCart,
  Star,
  Store,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { presetRange } from '@/domain/admin/dateRange';
import type { Dashboard } from '@/domain/admin/schemas';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { resolveLocalized } from '@/domain/localized';
import { hasPermission } from '@/domain/access/access';
import { PUBLIC_SETTING_KEYS } from '@/domain/settings/registry';
import { setupSettingsSchema } from '@/domain/settings/schemas';
import { setupNeeded } from '@/domain/setup/wizard';
import { useAccess, useSession } from '@/features/auth/context';
import { useSettingsContext } from '@/features/settings/context';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useI18n } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import { DateRangePicker } from '../ui/DateRangePicker';
import { Panel, StatTile } from '../ui/PageHeader';
import { QueryState } from '../ui/QueryState';
import { useAdminRepo } from '../ui/useAdminAction';
import ui from '../ui/adminUi.module.css';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from '../admin.module.css';

export function AdminDashboardPage() {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { mode } = useRuntime();
  const session = useSession();
  const { access } = useAccess();
  const { settings, sources, loadFailed } = useSettingsContext();
  useAdminPageMeta(at('dashboard.title'));
  const repo = useAdminRepo();
  // First-run setup (private `setup` setting): prompt staff who can complete it.
  const canSetup = hasPermission(access, 'settings.manage');
  const settingsRows = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => repo.settingsOverview(),
    enabled: canSetup,
  });
  const setupValue = setupSettingsSchema.safeParse(
    settingsRows.data?.find((r) => r.key === 'setup')?.published,
  );
  const setupPending =
    canSetup && settingsRows.isSuccess && (!setupValue.success || setupNeeded(setupValue.data));
  const [range, setRange] = useState(() => presetRange('today'));
  // Demo previews only have demo data; live dashboards exclude it unless asked.
  const [includeDemo, setIncludeDemo] = useState(mode === 'demo');
  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard', range.from, range.to, includeDemo],
    queryFn: () => repo.dashboard(range.from, range.to, includeDemo),
  });

  const publishedCount = PUBLIC_SETTING_KEYS.filter((key) => sources[key] === 'backend').length;
  const branch = settings.store.branches[0];
  const socialCount = Object.values(settings.social).filter(Boolean).length;

  const checklist = [
    { label: at('dashboard.setupWhatsapp'), done: Boolean(settings.store.whatsappNumber) },
    { label: at('dashboard.setupSocial', { count: socialCount }), done: socialCount > 0 },
    {
      label: at('dashboard.setupMaps'),
      done: settings.store.branches.every((b) => Boolean(b.mapsUrl)),
    },
    ...(mode === 'live'
      ? [
          {
            label: at('dashboard.setupSettingsPublished'),
            done: publishedCount === PUBLIC_SETTING_KEYS.length,
          },
        ]
      : []),
  ];

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>
          {at('dashboard.welcome', { name: isolate(session?.email ?? '') })}
        </h1>
        <p className={styles.pageSubtitle}>{at('dashboard.subtitle')}</p>
      </div>

      <div className={ui.stack} style={{ marginBlockEnd: 'var(--space-6)' }}>
        <DateRangePicker
          value={range}
          onChange={setRange}
          includeDemo={includeDemo}
          onIncludeDemoChange={setIncludeDemo}
        />
        <QueryState query={dashboard}>{(data) => <DashboardWidgets data={data} />}</QueryState>
      </div>

      <h2 className={ui.panelTitle} style={{ marginBlockEnd: 'var(--space-3)' }}>
        {at('dash.statusTitle')}
      </h2>

      <div className={styles.grid}>
        <Card>
          <h2 className={styles.cardTitle}>
            <FlaskConical aria-hidden="true" />
            {at('dashboard.dataModeTitle')}
          </h2>
          <p className={styles.metric}>
            <Badge tone={mode === 'demo' ? 'warning' : 'success'}>
              {mode === 'demo' ? at('dashboard.dataModeDemo') : at('dashboard.dataModeLive')}
            </Badge>
          </p>
          <p className={styles.muted}>
            {mode === 'demo' ? at('dashboard.dataModeDemoBody') : at('dashboard.dataModeLiveBody')}
          </p>
        </Card>

        <Card>
          <h2 className={styles.cardTitle}>
            <Database aria-hidden="true" />
            {at('dashboard.backendTitle')}
          </h2>
          <p className={styles.metric}>
            {mode === 'demo' ? (
              <Badge tone="neutral">{at('dashboard.backendDemo')}</Badge>
            ) : loadFailed ? (
              <Badge tone="danger">{at('dashboard.backendFailed')}</Badge>
            ) : (
              <Badge tone="success">{at('dashboard.backendOk')}</Badge>
            )}
          </p>
          <p className={styles.muted}>
            {at('dashboard.settingsSources', {
              published: publishedCount,
              total: PUBLIC_SETTING_KEYS.length,
            })}
          </p>
        </Card>

        <Card>
          <h2 className={styles.cardTitle}>
            <KeyRound aria-hidden="true" />
            {at('dashboard.accessTitle')}
          </h2>
          <dl className={styles.dl}>
            <div className={styles.dlRow}>
              <dt>{at('dashboard.accessRoles')}</dt>
              <dd>
                {access?.roles.map((role) => (
                  <Badge key={role.key} tone="brand">
                    {resolveLocalized(role.name, locale)}
                  </Badge>
                ))}
              </dd>
            </div>
            <div className={styles.dlRow}>
              <dt>{at('dashboard.accessPermissions')}</dt>
              <dd>{access?.grantsAll ? at('dashboard.accessAll') : access?.permissions.size}</dd>
            </div>
          </dl>
        </Card>

        <Card className={styles.span2}>
          <h2 className={styles.cardTitle}>
            <ListChecks aria-hidden="true" />
            {at('dashboard.setupTitle')}
          </h2>
          <ul className={styles.checklist}>
            {checklist.map((item) => (
              <li key={item.label} className={styles.checkItem}>
                <span className={`${styles.checkLabel} ${item.done ? styles.ok : styles.pending}`}>
                  {item.done ? (
                    <CircleCheck aria-hidden="true" />
                  ) : (
                    <CircleDashed aria-hidden="true" />
                  )}
                  <span style={{ color: 'var(--color-text-primary)' }}>{item.label}</span>
                </span>
                <Badge tone={item.done ? 'success' : 'warning'}>
                  {item.done ? at('dashboard.setupDone') : at('dashboard.setupPending')}
                </Badge>
              </li>
            ))}
          </ul>
          {setupPending ? (
            <Alert tone="warning">
              <strong>{at('dash.wizardTitle')}</strong> {at('dash.wizardBody')}{' '}
              <Link to="/admin/setup">{at('dash.wizardOpen')}</Link>
            </Alert>
          ) : (
            <Alert tone="info">
              {at('dash.setupHint')}{' '}
              <Link to="/admin/settings/store">{at('dash.openSettings')}</Link>
            </Alert>
          )}
        </Card>

        {branch && (
          <Card>
            <h2 className={styles.cardTitle}>
              <Store aria-hidden="true" />
              {at('dashboard.storeTitle')}
            </h2>
            <p style={{ fontWeight: 'var(--font-weight-semibold)' }}>
              {resolveLocalized(branch.name, locale)}
            </p>
            <p className={styles.muted}>
              {resolveLocalized(branch.address, locale)}
              {branch.landmark ? ` — ${resolveLocalized(branch.landmark, locale)}` : ''}
            </p>
            <div style={{ marginBlockStart: 'var(--space-3)' }}>
              <OpenStatus rules={branch.openingHours} />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

const SERVICE_PATHS: Record<string, string> = {
  repair: 'repairs',
  trade_in: 'trade-in',
  used: 'used-requests',
  after_sales: 'after-sales',
};

/** Permission-gated blocks: the server returns null for areas the viewer may not see. */
function DashboardWidgets({ data }: { data: Dashboard }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const money = (n: number) => format.money(n, { fractionDigits: 0 });
  const o = data.orders;
  return (
    <div className={ui.stack}>
      {o &&
        (data.includeDemo ? (
          <Alert tone="warning">{at('dash.demoIncluded')}</Alert>
        ) : o.demoExcluded > 0 ? (
          <Alert tone="info">{at('dash.demoExcluded', { count: o.demoExcluded })}</Alert>
        ) : null)}
      {o && (
        <Panel title={at('dash.kpis')} icon={<ClipboardList aria-hidden="true" />}>
          <div className={ui.tiles}>
            <StatTile
              label={at('dash.ordersToday')}
              value={format.number(o.count)}
              hint={at('dash.cancelled', { count: o.cancelled })}
              icon={<ClipboardList aria-hidden="true" />}
              to="/admin/orders"
            />
            <StatTile
              label={at('dash.revenue')}
              value={money(o.revenue)}
              icon={<Wallet aria-hidden="true" />}
            />
            <StatTile
              label={at('dash.paid')}
              value={money(o.paid)}
              icon={<CreditCard aria-hidden="true" />}
            />
            <StatTile label={at('dash.aov')} value={money(o.averageOrderValue)} />
            <StatTile
              label={at('dash.pendingVerification')}
              value={format.number(o.pendingVerification)}
              icon={<ShieldAlert aria-hidden="true" />}
              to="/admin/orders?payment=verification_pending"
              tone={o.pendingVerification > 0 ? 'warn' : undefined}
            />
            <StatTile
              label={at('dash.manualReview')}
              value={format.number(o.manualReview)}
              icon={<AlertTriangle aria-hidden="true" />}
              to="/admin/orders?review=1"
              tone={o.manualReview > 0 ? 'warn' : undefined}
            />
            <StatTile label={at('dash.openOrders')} value={format.number(o.open)} />
          </div>
        </Panel>
      )}
      <div className={ui.tiles}>
        {data.stock && (
          <>
            <StatTile
              label={at('dash.lowStock')}
              value={format.number(data.stock.low)}
              icon={<Boxes aria-hidden="true" />}
              to="/admin/inventory?view=low"
              tone={data.stock.low > 0 ? 'warn' : undefined}
            />
            <StatTile
              label={at('dash.outOfStock')}
              value={format.number(data.stock.out)}
              icon={<PackageX aria-hidden="true" />}
              to="/admin/inventory?view=out"
              tone={data.stock.out > 0 ? 'danger' : undefined}
            />
          </>
        )}
        {data.services &&
          Object.entries(data.services).map(([kind, s]) => (
            <StatTile
              key={kind}
              label={at(`modules.${SERVICE_PATHS[kind]}.title` as AdminMessageKey)}
              value={at('dash.serviceOpen', { count: format.number(s.open) })}
              hint={`${at('dash.serviceOverdue', { count: s.overdue })} · ${at('dash.serviceCreated', { count: s.created })}`}
              icon={<Wrench aria-hidden="true" />}
              to={`/admin/${SERVICE_PATHS[kind]}`}
              tone={s.overdue > 0 ? 'danger' : undefined}
            />
          ))}
        {data.reviews && (
          <StatTile
            label={at('dash.pendingReviews')}
            value={format.number(data.reviews.pending)}
            icon={<Star aria-hidden="true" />}
            to="/admin/reviews"
          />
        )}
        {data.requests && (
          <>
            <StatTile
              label={at('dash.notify')}
              value={format.number(data.requests.notify)}
              icon={<Bell aria-hidden="true" />}
              to="/admin/waitlists"
            />
            <StatTile
              label={at('dash.waitlist')}
              value={format.number(data.requests.waitlist)}
              icon={<Bell aria-hidden="true" />}
              to="/admin/waitlists"
            />
          </>
        )}
        {data.carts && (
          <StatTile
            label={at('dash.abandoned')}
            value={format.number(data.carts.abandoned)}
            icon={<ShoppingCart aria-hidden="true" />}
            to="/admin/abandoned-carts"
          />
        )}
      </div>
      {data.activity && (
        <Panel
          title={at('dash.activity')}
          icon={<History aria-hidden="true" />}
          actions={<Link to="/admin/audit-log">{at('modules.audit-log.title')}</Link>}
        >
          {data.activity.length === 0 ? (
            <p className={ui.muted}>{at('dash.noActivity')}</p>
          ) : (
            <ul
              className={ui.stack}
              style={{ gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0 }}
            >
              {data.activity.map((a) => (
                <li key={a.id} className={ui.small}>
                  <Link to={`/admin/audit-log?id=${a.id}`}>
                    <bdi className={ui.mono}>{a.action}</bdi>
                  </Link>{' '}
                  <span className={ui.muted}>
                    · {a.actorName ?? '—'} · {format.dateTime(a.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
