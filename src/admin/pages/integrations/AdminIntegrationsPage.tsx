import {
  Activity,
  ArrowLeftRight,
  CircleAlert,
  CircleCheck,
  CirclePause,
  FlaskConical,
  KeyRound,
  ListChecks,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { isIntegrationKey } from '@/domain/integrations/catalog';
import type { IntegrationOverviewItem } from '@/domain/integrations/schemas';
import { healthSummary } from '@/domain/integrations/status';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel, StatTile } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { ConfigureForm } from './ConfigureForm';
import { HealthTab, MessagingTab, SyncTab } from './IntegrationTabs';
import { IntegrationBadges } from './integrationsParts';
import {
  GROUPS,
  healthText,
  integrationName,
  specOf,
  statusOf,
  testOutcomeText,
  useIntegrationsOverview,
  useIntegrationsRepo,
} from './integrationsUtils';
import local from './integrations.module.css';

/**
 * Admin → Integrations & services. Every integration is optional, off by default and has a free
 * or manual fallback; status is derived from configuration + the last health check, never assumed.
 * The database checks integrations.view / manage / test / sync on every call and audits writes.
 */
export function AdminIntegrationsPage() {
  const { at } = useAdminI18n();
  const { mode } = useRuntime();
  const overview = useIntegrationsOverview();
  return (
    <>
      <PageHeader
        title={at('modules.integrations.title')}
        subtitle={at('integrationsAdmin.subtitle')}
      />
      {mode === 'demo' ? (
        <Alert tone="warning" title={at('integrationsAdmin.badge.mock')}>
          {at('integrationsAdmin.demoBanner')}
        </Alert>
      ) : (
        <Alert tone="info">{at('integrationsAdmin.liveRuntimeNote')}</Alert>
      )}
      <QueryState query={overview}>
        {(data) => {
          const states = data.integrations.map((i) => statusOf(i).state);
          const summary = healthSummary(states);
          const byKey = new Map(data.integrations.map((i) => [i.key, i]));
          return (
            <div className={styles.stack}>
              <section aria-labelledby="integrations-health">
                <h2 id="integrations-health" className="visually-hidden">
                  {at('integrationsAdmin.health.title')}
                </h2>
                <div className={styles.tiles} data-testid="integrations-health">
                  <StatTile
                    label={at('integrationsAdmin.health.connected')}
                    value={summary.connected}
                    icon={<CircleCheck aria-hidden="true" />}
                  />
                  <StatTile
                    label={at('integrationsAdmin.health.disabled')}
                    value={summary.disabled}
                    icon={<CirclePause aria-hidden="true" />}
                  />
                  <StatTile
                    label={at('integrationsAdmin.health.error')}
                    value={summary.error}
                    icon={<CircleAlert aria-hidden="true" />}
                    tone={summary.error > 0 ? 'danger' : undefined}
                  />
                  <StatTile
                    label={at('integrationsAdmin.health.needsSetup')}
                    value={summary.needsSetup}
                    icon={<Wrench aria-hidden="true" />}
                  />
                </div>
              </section>
              {GROUPS.map((group) => (
                <section key={group.id} aria-labelledby={`integrations-group-${group.id}`}>
                  <h2 id={`integrations-group-${group.id}`} className={local.groupTitle}>
                    {at(`integrationsAdmin.groups.${group.id}` as AdminMessageKey)}
                  </h2>
                  <div className={styles.cards}>
                    {group.keys.flatMap((key) => {
                      const item = byKey.get(key);
                      return item
                        ? [
                            <IntegrationCard
                              key={key}
                              item={item}
                              canManage={data.canManage}
                              canTest={data.canTest}
                            />,
                          ]
                        : [];
                    })}
                  </div>
                </section>
              ))}
              <SyncCenterPanel
                items={data.integrations.filter((i) => specOf(i.key).syncDomains.length > 0)}
              />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

/** Test / enable / disable shared by the cards and the detail header. */
function useIntegrationActions(item: IntegrationOverviewItem) {
  const { at } = useAdminI18n();
  const repo = useIntegrationsRepo();
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const test = useAdminAction((key: string) => repo.testConnection(key), {
    onSuccess: (r) =>
      r.ok &&
      setNotice({
        tone: r.health.ok ? 'success' : 'danger',
        text: testOutcomeText(at, item.key, r.health, r.mock),
      }),
  });
  const toggle = useAdminAction(
    (enabled: boolean, reason: string) => repo.setEnabled(item.key, enabled, reason || null),
    {
      onSuccess: (r) =>
        r.ok &&
        setNotice({
          tone: 'success',
          text: r.integration.enabled
            ? at('integrationsAdmin.enabled')
            : at('integrationsAdmin.disabled'),
        }),
    },
  );
  return { test, toggle, notice, setNotice };
}

function IntegrationCard({
  item,
  canManage,
  canTest,
}: {
  item: IntegrationOverviewItem;
  canManage: boolean;
  canTest: boolean;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const spec = specOf(item.key);
  const name = integrationName(at, item.key);
  const { test, toggle, notice } = useIntegrationActions(item);
  const confirm = useConfirm<boolean>();
  const hintId = `${item.key}-setup-hint`;
  return (
    <article
      className={local.card}
      data-testid={`integration-card-${item.key}`}
      aria-labelledby={`${item.key}-title`}
    >
      <div className={local.cardHead}>
        <h3 id={`${item.key}-title`} className={local.cardTitle}>
          {name}
        </h3>
        <div className={styles.chips}>
          <IntegrationBadges config={item} />
        </div>
      </div>
      <p className={styles.small}>
        {at(`integrationsAdmin.purpose.${item.key}` as AdminMessageKey)}
      </p>
      <dl className={local.facts}>
        <div>
          <dt>{at('integrationsAdmin.card.lastCheck')}</dt>
          <dd>
            {item.lastCheckAt ? (
              <>
                <time dateTime={item.lastCheckAt}>{format.dateTime(item.lastCheckAt)}</time>
                {' · '}
                {healthText(at, item.lastCheckCode, item.lastCheckMessage)}
              </>
            ) : (
              at('integrationsAdmin.card.never')
            )}
          </dd>
        </div>
        <div>
          <dt>{at('integrationsAdmin.card.fallback')}</dt>
          <dd>{at(`integrationsAdmin.fallback.${spec.fallback}` as AdminMessageKey)}</dd>
        </div>
      </dl>
      {notice && (
        <Alert tone={notice.tone} live>
          {notice.text}
        </Alert>
      )}
      {(test.error || toggle.error) && (
        <Alert tone="danger" live>
          {test.error ?? toggle.error}
        </Alert>
      )}
      <div className={local.cardActions}>
        <Link
          to={`/admin/integrations/${item.key}?tab=configure`}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          <Settings2 aria-hidden="true" width={16} height={16} />
          {canManage
            ? at('integrationsAdmin.card.configure')
            : at('integrationsAdmin.card.details')}
          <span className="visually-hidden"> — {name}</span>
        </Link>
        {canTest && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Activity aria-hidden="true" width={16} height={16} />}
            loading={test.pending}
            disabled={!item.provider}
            aria-describedby={!item.complete ? hintId : undefined}
            onClick={() => void test.run(item.key)}
          >
            {test.pending
              ? at('integrationsAdmin.card.testing')
              : at('integrationsAdmin.card.test')}
            <span className="visually-hidden"> — {name}</span>
          </Button>
        )}
        {canManage &&
          (item.enabled ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => confirm.ask(disableOptions(at, name), false)}
            >
              {at('integrationsAdmin.card.disable')}
              <span className="visually-hidden"> — {name}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!item.complete}
              aria-describedby={!item.complete ? hintId : undefined}
              onClick={() => confirm.ask(enableOptions(at, name), true)}
            >
              {at('integrationsAdmin.card.enable')}
              <span className="visually-hidden"> — {name}</span>
            </Button>
          ))}
      </div>
      {(canTest || canManage) && !item.complete && (
        <p id={hintId} className={`${styles.small} ${styles.muted}`}>
          {canManage
            ? at('integrationsAdmin.card.needsSetup')
            : at('integrationsAdmin.card.testNeedsConfig')}
        </p>
      )}
      <Link to={`/admin/integrations/${item.key}`} className={local.detailsLink}>
        {at('integrationsAdmin.card.details')}
        <span className="visually-hidden"> — {name}</span>
      </Link>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={toggle.pending}
        error={toggle.error}
        onCancel={confirm.close}
        onConfirm={async (reason) => {
          const result = await toggle.run(confirm.payload ?? false, reason);
          if (result?.ok) confirm.close();
        }}
      />
    </article>
  );
}

function enableOptions(at: ReturnType<typeof useAdminI18n>['at'], name: string) {
  return {
    title: at('integrationsAdmin.enableTitle', { name }),
    body: at('integrationsAdmin.enableBody'),
    confirmLabel: at('integrationsAdmin.card.enable'),
    reason: 'optional' as const,
  };
}

function disableOptions(at: ReturnType<typeof useAdminI18n>['at'], name: string) {
  return {
    title: at('integrationsAdmin.disableTitle', { name }),
    body: at('integrationsAdmin.disableBody'),
    confirmLabel: at('integrationsAdmin.card.disable'),
    tone: 'danger' as const,
    reason: 'optional' as const,
  };
}

function SyncCenterPanel({ items }: { items: IntegrationOverviewItem[] }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  return (
    <Panel
      title={at('integrationsAdmin.syncCenterPanel')}
      icon={<ArrowLeftRight aria-hidden="true" />}
    >
      <p className={styles.small}>{at('integrationsAdmin.sync.centerHint')}</p>
      <ul className={local.list}>
        {items.map((item) => (
          <li key={item.key}>
            <strong>{integrationName(at, item.key)}</strong>
            <span className={local.grow}>
              {item.lastSync
                ? at('integrationsAdmin.lastSync', {
                    status: at(
                      `integrationsAdmin.sync.jobStatus.${item.lastSync.status}` as AdminMessageKey,
                    ),
                    date: format.dateTime(item.lastSync.startedAt),
                  })
                : at('integrationsAdmin.syncCenterEmpty')}
            </span>
            <Link
              to={`/admin/integrations/${item.key}?tab=sync`}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              {at('integrationsAdmin.sync.center')}
              <span className="visually-hidden"> — {integrationName(at, item.key)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Detail page ─────────────────────────────────────────────────────────────
type TabId = 'overview' | 'configure' | 'health' | 'sync' | 'messaging';

export function AdminIntegrationDetailPage() {
  const { at } = useAdminI18n();
  const { key = '' } = useParams();
  const overview = useIntegrationsOverview();
  if (!isIntegrationKey(key))
    return (
      <>
        <PageHeader title={at('modules.integrations.title')} />
        <Alert tone="danger">{at('problems.unknown_integration')}</Alert>
      </>
    );
  return (
    <QueryState query={overview}>
      {(data) => {
        const item = data.integrations.find((i) => i.key === key);
        if (!item)
          return (
            <>
              <PageHeader title={at('modules.integrations.title')} />
              <Alert tone="danger">{at('problems.unknown_integration')}</Alert>
            </>
          );
        return (
          <IntegrationDetail
            item={item}
            canManage={data.canManage}
            canTest={data.canTest}
            canSync={data.canSync}
            channels={data.notificationChannels}
          />
        );
      }}
    </QueryState>
  );
}

function IntegrationDetail({
  item,
  canManage,
  canTest,
  canSync,
  channels,
}: {
  item: IntegrationOverviewItem;
  canManage: boolean;
  canTest: boolean;
  canSync: boolean;
  channels: {
    email: { enabled: boolean };
    whatsapp: { enabled: boolean };
    sms: { enabled: boolean };
  } | null;
}) {
  const { at } = useAdminI18n();
  const { mode } = useRuntime();
  const spec = specOf(item.key);
  const name = integrationName(at, item.key);
  const [params, setParams] = useSearchParams();
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: at('integrationsAdmin.tabs.overview') },
    { id: 'configure', label: at('integrationsAdmin.tabs.configure') },
    { id: 'health', label: at('integrationsAdmin.tabs.health') },
    ...(spec.syncDomains.length > 0
      ? [{ id: 'sync' as const, label: at('integrationsAdmin.tabs.sync') }]
      : []),
    ...(spec.channel
      ? [{ id: 'messaging' as const, label: at('integrationsAdmin.tabs.messaging') }]
      : []),
  ];
  const requested = params.get('tab') as TabId | null;
  const active: TabId = tabs.some((t) => t.id === requested) && requested ? requested : 'overview';
  const setActive = (id: TabId) =>
    setParams(
      (p) => {
        p.set('tab', id);
        return p;
      },
      { replace: true },
    );
  return (
    <>
      <PageHeader
        title={name}
        subtitle={at(`integrationsAdmin.purpose.${item.key}` as AdminMessageKey)}
        crumbs={[{ label: at('modules.integrations.title'), to: '/admin/integrations' }]}
      />
      {mode === 'demo' && (
        <Alert tone="warning" title={at('integrationsAdmin.badge.mock')}>
          {at('integrationsAdmin.demoBanner')}
        </Alert>
      )}
      <div className={styles.chips} data-testid="integration-status">
        <IntegrationBadges config={item} />
      </div>
      <Tabs
        tabs={tabs}
        active={active}
        onChange={setActive}
        idBase={`integration-${item.key}`}
        label={at('integrationsAdmin.tabs.label')}
      />
      <TabPanel idBase={`integration-${item.key}`} active={active}>
        {active === 'overview' && <OverviewTab item={item} />}
        {active === 'configure' && <ConfigureForm item={item} canManage={canManage} />}
        {active === 'health' && <HealthTab item={item} canTest={canTest} canManage={canManage} />}
        {active === 'sync' && <SyncTab item={item} canSync={canSync} />}
        {active === 'messaging' && (
          <MessagingTab item={item} canManage={canManage} channels={channels} />
        )}
      </TabPanel>
    </>
  );
}

function OverviewTab({ item }: { item: IntegrationOverviewItem }) {
  const { at } = useAdminI18n();
  const spec = specOf(item.key);
  const subscription =
    spec.subscription === 'required'
      ? at('integrationsAdmin.overview.subscriptionRequired')
      : spec.subscription === 'may_require'
        ? at('integrationsAdmin.overview.subscriptionMaybe')
        : at('integrationsAdmin.overview.subscriptionFree');
  return (
    <div className={styles.stack}>
      <Panel
        title={at('integrationsAdmin.data.title')}
        icon={<ShieldCheck aria-hidden="true" />}
        headingLevel={3}
      >
        <ul className={local.bullets}>
          {spec.data.map((d) => (
            <li key={d}>{at(`integrationsAdmin.data.${d}` as AdminMessageKey)}</li>
          ))}
        </ul>
      </Panel>
      <Panel
        title={at('integrationsAdmin.card.fallback')}
        icon={<FlaskConical aria-hidden="true" />}
        headingLevel={3}
      >
        <p>{at(`integrationsAdmin.fallback.${spec.fallback}` as AdminMessageKey)}</p>
        <p className={styles.small}>{subscription}</p>
      </Panel>
      <Panel
        title={at('integrationsAdmin.overview.adapter')}
        icon={<ListChecks aria-hidden="true" />}
        headingLevel={3}
      >
        <ul className={local.list}>
          {spec.providers.map((p) => (
            <li key={p.key}>
              <strong>{at(`integrationsAdmin.provider.${p.key}` as AdminMessageKey)}</strong>
              <Badge tone={p.adapter === 'implemented' ? 'success' : 'neutral'}>
                {at(`integrationsAdmin.badge.${p.adapter}`)}
              </Badge>
              <span className={local.grow}>
                {at(
                  p.adapter === 'implemented'
                    ? 'integrationsAdmin.overview.implementedHint'
                    : 'integrationsAdmin.overview.contractHint',
                )}
              </span>
            </li>
          ))}
        </ul>
        <h4 className={local.subTitle}>{at('integrationsAdmin.overview.capabilities')}</h4>
        <div className={styles.chips}>
          {[...new Set(spec.providers.flatMap((p) => p.capabilities))].map((c) => (
            <Badge key={c}>{at(`integrationsAdmin.capability.${c}` as AdminMessageKey)}</Badge>
          ))}
        </div>
      </Panel>
      <Panel
        title={at('integrationsAdmin.configure.secrets')}
        icon={<KeyRound aria-hidden="true" />}
        headingLevel={3}
      >
        <SecretsList secrets={spec.secrets} social={item.key === 'social_auth'} />
      </Panel>
      {spec.channel && (
        <p className={styles.small}>
          <MessageSquare aria-hidden="true" width={14} height={14} />{' '}
          {at('integrationsAdmin.messaging.channelHint')}
        </p>
      )}
    </div>
  );
}

export function SecretsList({ secrets, social }: { secrets: string[]; social: boolean }) {
  const { at } = useAdminI18n();
  if (social)
    return <p className={styles.small}>{at('integrationsAdmin.configure.socialSecrets')}</p>;
  if (secrets.length === 0)
    return <p className={styles.small}>{at('integrationsAdmin.configure.noSecrets')}</p>;
  return (
    <>
      <p className={styles.small}>{at('integrationsAdmin.configure.secretsHint')}</p>
      <p>
        <code dir="ltr" className={local.command}>
          supabase secrets set {secrets[0]}=…
        </code>
      </p>
      <ul className={local.secretNames} data-testid="secret-names">
        {secrets.map((s) => (
          <li key={s}>
            <code dir="ltr">{s}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
