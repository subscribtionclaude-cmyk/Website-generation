import {
  CircleCheck,
  CircleDashed,
  Database,
  FlaskConical,
  KeyRound,
  ListChecks,
  Store,
} from 'lucide-react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { resolveLocalized } from '@/domain/localized';
import { PUBLIC_SETTING_KEYS } from '@/domain/settings/registry';
import { useAccess, useSession } from '@/features/auth/context';
import { useSettingsContext } from '@/features/settings/context';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useI18n } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n } from '../i18n/context';
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
          <Alert tone="info">{at('dashboard.setupHint')}</Alert>
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
