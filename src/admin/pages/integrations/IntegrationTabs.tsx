import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeftRight, Inbox, MessageSquare, Send, Webhook } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { NOTIFICATION_TEMPLATES } from '@/domain/customer/templates';
import { resolveLocalized } from '@/domain/localized';
import type {
  IntegrationOverviewItem,
  SyncAction,
  SyncJob,
  SyncJobDetail,
} from '@/domain/integrations/schemas';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable } from '../../ui/DataTable';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import {
  healthText,
  messageText,
  specOf,
  testOutcomeText,
  useIntegrationsRepo,
} from './integrationsUtils';
import local from './integrations.module.css';

// ── Connection (health) ─────────────────────────────────────────────────────
export function HealthTab({
  item,
  canTest,
}: {
  item: IntegrationOverviewItem;
  canTest: boolean;
  canManage: boolean;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useIntegrationsRepo();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const checks = useQuery({
    queryKey: ['admin', 'integrations', item.key, 'checks'],
    queryFn: () => repo.checks(item.key, 20),
  });
  const test = useAdminAction(() => repo.testConnection(item.key), {
    onSuccess: (r) =>
      r.ok && setNotice({ ok: r.health.ok, text: testOutcomeText(at, item.key, r.health, r.mock) }),
  });
  return (
    <div className={styles.stack}>
      <Panel
        title={at('integrationsAdmin.card.lastCheck')}
        icon={<Activity aria-hidden="true" />}
        headingLevel={3}
        actions={
          canTest ? (
            <Button
              size="sm"
              variant="primary"
              loading={test.pending}
              disabled={!item.provider}
              onClick={() => {
                setNotice(null);
                void test.run();
              }}
            >
              {test.pending
                ? at('integrationsAdmin.card.testing')
                : at('integrationsAdmin.card.test')}
            </Button>
          ) : undefined
        }
      >
        <p>
          {item.lastCheckAt ? (
            <>
              <time dateTime={item.lastCheckAt}>{format.dateTime(item.lastCheckAt)}</time> ·{' '}
              {healthText(at, item.lastCheckCode, item.lastCheckMessage)}
            </>
          ) : (
            at('integrationsAdmin.card.never')
          )}
        </p>
        {canTest && !item.provider && (
          <p className={styles.hint}>{at('integrationsAdmin.card.testNeedsConfig')}</p>
        )}
        {notice && (
          <Alert tone={notice.ok ? 'success' : 'danger'} live>
            {notice.text}
          </Alert>
        )}
        {test.error && (
          <Alert tone="danger" live>
            {test.error}
          </Alert>
        )}
      </Panel>
      <Panel title={at('integrationsAdmin.checks.title')} headingLevel={3}>
        <QueryState query={checks}>
          {(rows) =>
            rows.length === 0 ? (
              <p className={styles.muted}>{at('integrationsAdmin.checks.empty')}</p>
            ) : (
              <DataTable
                caption={at('integrationsAdmin.checks.title')}
                rows={rows}
                rowKey={(r) => String(r.id)}
                columns={[
                  {
                    id: 'at',
                    header: at('integrationsAdmin.checks.at'),
                    rowHeader: true,
                    className: styles.nowrap,
                    cell: (r) => <time dateTime={r.checkedAt}>{format.dateTime(r.checkedAt)}</time>,
                  },
                  {
                    id: 'result',
                    header: at('integrationsAdmin.checks.result'),
                    cell: (r) => (
                      <Badge tone={r.status === 'connected' ? 'success' : 'danger'}>
                        {at(`integrationsAdmin.code.${r.code}` as AdminMessageKey)}
                      </Badge>
                    ),
                  },
                  {
                    id: 'latency',
                    header: at('integrationsAdmin.checks.latency'),
                    className: styles.num,
                    cell: (r) =>
                      r.latencyMs === null
                        ? '—'
                        : at('integrationsAdmin.checks.ms', { value: format.number(r.latencyMs) }),
                  },
                  {
                    id: 'detail',
                    header: at('integrationsAdmin.checks.detail'),
                    cell: (r) => messageText(at, r.message) ?? '—',
                  },
                ]}
              />
            )
          }
        </QueryState>
      </Panel>
    </div>
  );
}

// ── Sync center ─────────────────────────────────────────────────────────────
const JOB_TONE: Record<SyncJob['status'], BadgeTone> = {
  running: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};
const countsOf = (j: SyncJob) => ({
  inspected: j.inspected,
  created: j.created,
  updated: j.updated,
  skipped: j.skipped,
  failed: j.failed,
  conflicts: j.conflicts,
});
const ACTION_TONE: Record<SyncAction, BadgeTone> = {
  create: 'info',
  update: 'brand',
  link: 'success',
  unchanged: 'neutral',
  skip: 'neutral',
  conflict: 'warning',
  invalid: 'danger',
};

export function SyncTab({ item, canSync }: { item: IntegrationOverviewItem; canSync: boolean }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useIntegrationsRepo();
  const spec = specOf(item.key);
  const [domain, setDomain] = useState<string>(spec.syncDomains[0] ?? 'prices');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();
  const jobs = useQuery({
    queryKey: ['admin', 'integrations', item.key, 'jobs'],
    queryFn: () => repo.syncJobs(item.key, 20),
  });
  const run = useAdminAction(
    (dryRun: boolean) => repo.startSync(item.key, domain, dryRun, crypto.randomUUID()),
    {
      onSuccess: (r) => {
        if (!r.ok) return;
        setSelected(r.jobId);
        setNotice(
          r.job
            ? at('integrationsAdmin.sync.done', {
                status: at(`integrationsAdmin.sync.jobStatus.${r.job.status}` as AdminMessageKey),
              })
            : null,
        );
      },
    },
  );
  const owner =
    (domain === 'prices' || domain === 'stock' ? item.ownership[domain] : null) ?? 'malek';
  const applyBlocked = !item.complete ? 'needsConfig' : !item.enabled ? 'needsEnable' : null;
  return (
    <div className={styles.stack}>
      <Panel
        title={at('integrationsAdmin.sync.center')}
        icon={<ArrowLeftRight aria-hidden="true" />}
        headingLevel={3}
      >
        <p className={styles.small}>{at('integrationsAdmin.sync.centerHint')}</p>
        <div className={styles.formGrid}>
          <SelectField
            label={at('integrationsAdmin.sync.domain')}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            options={spec.syncDomains.map((d) => ({
              value: d,
              label: at(`integrationsAdmin.configure.domain.${d}`),
            }))}
          />
        </div>
        {(domain === 'prices' || domain === 'stock') && (
          <p className={styles.small}>
            {at('integrationsAdmin.sync.owner', {
              owner: at(`integrationsAdmin.configure.owner.${owner}`),
            })}
          </p>
        )}
        {canSync && (
          <div className={local.cardActions}>
            <Button
              variant="secondary"
              loading={run.pending}
              disabled={!item.complete}
              onClick={() => {
                setNotice(null);
                void run.run(true);
              }}
            >
              {at('integrationsAdmin.sync.dryRun')}
            </Button>
            <Button
              variant="primary"
              disabled={applyBlocked !== null || run.pending}
              aria-describedby={applyBlocked ? `${item.key}-sync-hint` : undefined}
              onClick={() =>
                confirm.ask(
                  {
                    title: at('integrationsAdmin.sync.confirmTitle'),
                    body: at('integrationsAdmin.sync.confirmBody'),
                    confirmLabel: at('integrationsAdmin.sync.syncNow'),
                  },
                  undefined,
                )
              }
            >
              {at('integrationsAdmin.sync.syncNow')}
            </Button>
          </div>
        )}
        {canSync && applyBlocked && (
          <p id={`${item.key}-sync-hint`} className={styles.hint}>
            {at(`integrationsAdmin.sync.${applyBlocked}`)}
          </p>
        )}
        {notice && (
          <Alert tone="success" live>
            {notice}
          </Alert>
        )}
        {run.error && (
          <Alert tone="danger" live>
            {run.error}
          </Alert>
        )}
      </Panel>
      <Panel title={at('integrationsAdmin.sync.recent')} headingLevel={3}>
        <QueryState query={jobs}>
          {(rows) =>
            rows.length === 0 ? (
              <p className={styles.muted}>{at('integrationsAdmin.sync.empty')}</p>
            ) : (
              <DataTable
                caption={at('integrationsAdmin.sync.recent')}
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  {
                    id: 'started',
                    header: at('integrationsAdmin.sync.started'),
                    rowHeader: true,
                    className: styles.nowrap,
                    cell: (r) => <time dateTime={r.startedAt}>{format.dateTime(r.startedAt)}</time>,
                  },
                  {
                    id: 'domain',
                    header: at('integrationsAdmin.sync.domain'),
                    cell: (r) => at(`integrationsAdmin.configure.domain.${r.domain}`),
                  },
                  {
                    id: 'mode',
                    header: at('integrationsAdmin.sync.mode'),
                    cell: (r) => (
                      <Badge tone={r.dryRun ? 'neutral' : 'brand'}>
                        {r.dryRun
                          ? at('integrationsAdmin.sync.modeDry')
                          : at('integrationsAdmin.sync.modeApply')}
                      </Badge>
                    ),
                  },
                  {
                    id: 'status',
                    header: at('integrationsAdmin.sync.status'),
                    cell: (r) => (
                      <>
                        <Badge tone={JOB_TONE[r.status]}>
                          {at(`integrationsAdmin.sync.jobStatus.${r.status}`)}
                        </Badge>
                        {r.errorCode && (
                          <span className={styles.small}>
                            {' '}
                            {at(`integrationsAdmin.code.${r.errorCode}` as AdminMessageKey)}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    id: 'counts',
                    header: at('integrationsAdmin.sync.summary'),
                    cell: (r) => at('integrationsAdmin.sync.counts', countsOf(r)),
                  },
                  {
                    id: 'view',
                    header: (
                      <span className="visually-hidden">{at('integrationsAdmin.sync.view')}</span>
                    ),
                    cell: (r) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-pressed={selected === r.id}
                        onClick={() => setSelected(r.id)}
                      >
                        {at('integrationsAdmin.sync.view')}
                      </Button>
                    ),
                  },
                ]}
              />
            )
          }
        </QueryState>
      </Panel>
      {selected && <SyncJobDetails jobId={selected} />}
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={run.pending}
        error={run.error}
        onCancel={confirm.close}
        onConfirm={async () => {
          setNotice(null);
          const result = await run.run(false);
          if (result) confirm.close();
        }}
      />
    </div>
  );
}

function SyncJobDetails({ jobId }: { jobId: string }) {
  const { at } = useAdminI18n();
  const repo = useIntegrationsRepo();
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const job = useQuery({
    queryKey: ['admin', 'integrations', 'job', jobId],
    queryFn: () => repo.syncJob(jobId),
  });
  return (
    <Panel title={at('integrationsAdmin.sync.details')} headingLevel={3}>
      <QueryState query={job}>
        {(detail: SyncJobDetail | null) =>
          !detail ? (
            <p className={styles.muted}>{at('problems.job_not_found')}</p>
          ) : (
            <div className={styles.stack} data-testid="sync-details">
              <p className={styles.small}>
                {at('integrationsAdmin.sync.counts', countsOf(detail))}
              </p>
              {detail.errorSummary && <Alert tone="danger">{detail.errorSummary}</Alert>}
              <CheckboxField
                label={at('integrationsAdmin.sync.conflictsOnly')}
                checked={conflictsOnly}
                onChange={setConflictsOnly}
              />
              <DataTable
                caption={at('integrationsAdmin.sync.details')}
                rows={detail.items.filter((i) => !conflictsOnly || i.action === 'conflict')}
                rowKey={(i) => String(i.position)}
                columns={[
                  {
                    id: 'item',
                    header: at('integrationsAdmin.sync.item'),
                    rowHeader: true,
                    cell: (i) => <span dir="ltr">{i.label ?? '—'}</span>,
                  },
                  {
                    id: 'external',
                    header: at('integrationsAdmin.sync.externalId'),
                    cell: (i) => <code dir="ltr">{i.externalId ?? '—'}</code>,
                  },
                  {
                    id: 'action',
                    header: at('integrationsAdmin.sync.action'),
                    cell: (i) => (
                      <Badge tone={ACTION_TONE[i.action]}>
                        {at(`integrationsAdmin.sync.actionLabel.${i.action}`)}
                      </Badge>
                    ),
                  },
                  {
                    id: 'reason',
                    header: at('integrationsAdmin.sync.reason'),
                    cell: (i) =>
                      i.reason
                        ? at(`integrationsAdmin.sync.reasonLabel.${i.reason}` as AdminMessageKey)
                        : '—',
                  },
                  {
                    id: 'applied',
                    header: at('integrationsAdmin.sync.applied'),
                    cell: (i) =>
                      i.applied ? (
                        <Badge tone="success">{at('integrationsAdmin.sync.applied')}</Badge>
                      ) : (
                        <span className={styles.muted}>
                          {at('integrationsAdmin.sync.notApplied')}
                        </span>
                      ),
                  },
                ]}
              />
            </div>
          )
        }
      </QueryState>
    </Panel>
  );
}

// ── Messaging ───────────────────────────────────────────────────────────────
const DELIVERY_TONE: Record<string, BadgeTone> = {
  queued: 'info',
  sending: 'info',
  sent: 'success',
  delivered: 'success',
  failed: 'danger',
  skipped: 'neutral',
  disabled: 'neutral',
};

export function MessagingTab({
  item,
  canManage,
  channels,
}: {
  item: IntegrationOverviewItem;
  canManage: boolean;
  channels: {
    email: { enabled: boolean };
    whatsapp: { enabled: boolean };
    sms: { enabled: boolean };
  } | null;
}) {
  const { at } = useAdminI18n();
  const { format, locale } = useI18n();
  const { mode } = useRuntime();
  const repo = useIntegrationsRepo();
  const channel = specOf(item.key).channel ?? 'whatsapp';
  const channelOn = channels?.[channel].enabled ?? false;
  const [notice, setNotice] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ['admin', 'integrations', item.key, 'deliveries'],
    queryFn: () => repo.deliveries({ channel, limit: 50 }),
  });
  const webhooks = useQuery({
    queryKey: ['admin', 'integrations', item.key, 'webhooks'],
    queryFn: () => repo.webhookEvents(item.key, 20),
    enabled: item.key === 'whatsapp',
  });
  const dispatch = useAdminAction(() => repo.dispatch(channel), {
    onSuccess: (r) =>
      r.ok &&
      setNotice(
        at('integrationsAdmin.messaging.dispatched', {
          sent: r.sent,
          failed: r.failed,
          skipped: r.skipped,
        }),
      ),
  });
  const retry = useAdminAction((id: number) => repo.retryDelivery(id), {
    onSuccess: () => setNotice(at('integrationsAdmin.messaging.retried')),
  });
  const mapped = Object.entries(item.templateMap);
  return (
    <div className={styles.stack}>
      <Panel
        title={at('integrationsAdmin.messaging.routing')}
        icon={<MessageSquare aria-hidden="true" />}
        headingLevel={3}
      >
        <p className={styles.small}>{at('integrationsAdmin.messaging.routingHint')}</p>
        <p>
          <strong>{at('integrationsAdmin.messaging.channel')}:</strong>{' '}
          <Badge tone={channelOn ? 'success' : 'neutral'}>
            {channelOn
              ? at('integrationsAdmin.messaging.channelOn')
              : at('integrationsAdmin.messaging.channelOff')}
          </Badge>{' '}
          <Link to="/admin/settings/notifications">
            {at('integrationsAdmin.messaging.openSettings')}
          </Link>
        </p>
        <p className={styles.small}>{at('integrationsAdmin.messaging.channelHint')}</p>
        <ul className={local.list} data-testid="routing-list">
          {Object.entries(NOTIFICATION_TEMPLATES)
            .slice(0, mapped.length > 0 ? undefined : 6)
            .map(([templateKey, template]) => {
              const target = item.templateMap[templateKey];
              return (
                <li key={templateKey}>
                  <span className={local.grow}>{resolveLocalized(template.title, locale)}</span>
                  {target ? (
                    <Badge tone="success">
                      {at('integrationsAdmin.messaging.mapped', { template: target })}
                    </Badge>
                  ) : (
                    <Badge>{at('integrationsAdmin.messaging.notMapped')}</Badge>
                  )}
                </li>
              );
            })}
        </ul>
      </Panel>
      <Panel
        title={at('integrationsAdmin.messaging.deliveries')}
        icon={<Inbox aria-hidden="true" />}
        headingLevel={3}
        actions={
          canManage ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Send aria-hidden="true" width={16} height={16} />}
              loading={dispatch.pending}
              disabled={!item.enabled}
              onClick={() => {
                setNotice(null);
                void dispatch.run();
              }}
            >
              {at('integrationsAdmin.messaging.dispatch')}
            </Button>
          ) : undefined
        }
      >
        {mode === 'demo' && (
          <Alert tone="info">{at('integrationsAdmin.messaging.deliveriesDemo')}</Alert>
        )}
        {notice && (
          <Alert tone="success" live>
            {notice}
          </Alert>
        )}
        {(dispatch.error || retry.error) && (
          <Alert tone="danger" live>
            {dispatch.error ?? retry.error}
          </Alert>
        )}
        <QueryState query={deliveries}>
          {(rows) =>
            rows.length === 0 ? (
              <p className={styles.muted}>{at('integrationsAdmin.messaging.deliveriesEmpty')}</p>
            ) : (
              <DataTable
                caption={at('integrationsAdmin.messaging.deliveries')}
                rows={rows}
                rowKey={(r) => String(r.id)}
                columns={[
                  {
                    id: 'created',
                    header: at('integrationsAdmin.messaging.created'),
                    rowHeader: true,
                    className: styles.nowrap,
                    cell: (r) => <time dateTime={r.createdAt}>{format.dateTime(r.createdAt)}</time>,
                  },
                  {
                    id: 'template',
                    header: at('integrationsAdmin.messaging.template'),
                    cell: (r) => {
                      const template = r.templateKey
                        ? NOTIFICATION_TEMPLATES[r.templateKey]
                        : undefined;
                      return template
                        ? resolveLocalized(template.title, locale)
                        : (r.templateKey ?? '—');
                    },
                  },
                  {
                    id: 'status',
                    header: at('integrationsAdmin.messaging.status'),
                    cell: (r) => (
                      <Badge tone={DELIVERY_TONE[r.status] ?? 'neutral'}>
                        {at(`integrationsAdmin.messaging.deliveryStatus.${r.status}`)}
                      </Badge>
                    ),
                  },
                  {
                    id: 'attempts',
                    header: at('integrationsAdmin.messaging.attempts'),
                    className: styles.num,
                    cell: (r) => format.number(r.attempts),
                  },
                  {
                    id: 'error',
                    header: at('integrationsAdmin.messaging.error'),
                    cell: (r) => r.errorCode ?? '—',
                  },
                  {
                    id: 'retry',
                    header: (
                      <span className="visually-hidden">
                        {at('integrationsAdmin.messaging.retry')}
                      </span>
                    ),
                    cell: (r) =>
                      canManage && (r.status === 'failed' || r.status === 'skipped') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={retry.pending}
                          onClick={() => void retry.run(r.id)}
                        >
                          {at('integrationsAdmin.messaging.retry')}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            )
          }
        </QueryState>
      </Panel>
      {item.key === 'whatsapp' && (
        <Panel
          title={at('integrationsAdmin.messaging.webhooks')}
          icon={<Webhook aria-hidden="true" />}
          headingLevel={3}
        >
          <p className={styles.small}>{at('integrationsAdmin.messaging.webhookHint')}</p>
          <QueryState query={webhooks}>
            {(rows) =>
              rows.length === 0 ? (
                <p className={styles.muted}>{at('integrationsAdmin.messaging.webhooksEmpty')}</p>
              ) : (
                <DataTable
                  caption={at('integrationsAdmin.messaging.webhooks')}
                  rows={rows}
                  rowKey={(r) => String(r.id)}
                  columns={[
                    {
                      id: 'received',
                      header: at('integrationsAdmin.messaging.received'),
                      rowHeader: true,
                      cell: (r) => (
                        <time dateTime={r.receivedAt}>{format.dateTime(r.receivedAt)}</time>
                      ),
                    },
                    {
                      id: 'type',
                      header: at('integrationsAdmin.messaging.eventType'),
                      cell: (r) => <code dir="ltr">{r.eventType ?? '—'}</code>,
                    },
                    {
                      id: 'signature',
                      header: at('integrationsAdmin.messaging.signature'),
                      cell: (r) => (
                        <Badge tone={r.signatureValid ? 'success' : 'danger'}>
                          {r.signatureValid
                            ? at('integrationsAdmin.messaging.valid')
                            : at('integrationsAdmin.messaging.invalid')}
                        </Badge>
                      ),
                    },
                  ]}
                />
              )
            }
          </QueryState>
        </Panel>
      )}
      <p className={styles.small}>
        <Link
          to="/admin/integrations"
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        >
          {at('modules.integrations.title')}
        </Link>
      </p>
    </div>
  );
}
