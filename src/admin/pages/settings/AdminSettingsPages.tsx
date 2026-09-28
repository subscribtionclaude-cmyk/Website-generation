import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { isSettingKey } from '@/domain/settings/registry';
import {
  LEGAL_PAGE_KEYS,
  type LegalPageKey,
  type LegalSettings,
  type ReceiptSettings,
} from '@/domain/settings/schemas';
import { useI18n } from '@/i18n/context';
import { InvoiceSheet } from '@/storefront/pages/InvoiceSheet';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { InputField, LocalizedField } from '../../ui/fields';
import { toDraft } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { cleanLocalized } from '../../ui/schemaIntrospect';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { SAMPLE_RECEIPT_ORDER } from './sampleOrder';
import { SettingWorkspace } from './SettingWorkspace';
import { useSettingTitle } from './settingsHooks';
import {
  DEDICATED_SETTING_PATHS,
  EDITABLE_SETTING_KEYS,
  SETTING_GROUPS,
  settingHref,
} from './settingsCatalog';

/** Settings hub: every category with its publish state. */
export function AdminSettingsIndexPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const titleOf = useSettingTitle();
  const overview = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => repo.settingsOverview(),
  });
  return (
    <>
      <PageHeader
        title={at('modules.store-settings.title')}
        subtitle={at('settingsAdmin.subtitle')}
      />
      <div className={styles.stack}>
        <Alert tone="info">{at('settingsAdmin.workflow')}</Alert>
        <QueryState query={overview}>
          {(rows) => (
            <div className={styles.cards}>
              {SETTING_GROUPS.map((group) => {
                const items = group.keys.flatMap((k) => rows.filter((r) => r.key === k));
                if (items.length === 0) return null;
                return (
                  <Panel
                    key={group.id}
                    title={at(`settingsAdmin.group.${group.id}` as AdminMessageKey)}
                  >
                    <ul className={styles.pickList}>
                      {items.map((row) => (
                        <li key={row.key}>
                          <span className={styles.cellTitle}>
                            <Link to={settingHref(row.key as never)}>{titleOf(row.key)}</Link>
                            <span className={`${styles.small} ${styles.muted}`}>
                              {row.version !== null
                                ? at('settingsAdmin.versionAt', {
                                    version: row.version,
                                    date: row.publishedAt ? format.date(row.publishedAt) : '—',
                                  })
                                : at('settingsAdmin.unpublished')}
                            </span>
                          </span>
                          <span className={styles.chips}>
                            {row.draft !== null && (
                              <Badge tone="warning">{at('settingsAdmin.draftPending')}</Badge>
                            )}
                            {!row.canEdit && <Badge>{at('settingsAdmin.viewOnly')}</Badge>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                );
              })}
            </div>
          )}
        </QueryState>
        <Alert tone="info">{at('settingsAdmin.designPhase7')}</Alert>
      </div>
    </>
  );
}

/** Generic editor for one setting key (/admin/settings/:key). */
export function AdminSettingEditorPage() {
  const { key = '' } = useParams();
  const { at } = useAdminI18n();
  if (!isSettingKey(key) || !EDITABLE_SETTING_KEYS.includes(key))
    return (
      <>
        <PageHeader
          title={at('modules.store-settings.title')}
          crumbs={[{ label: at('modules.store-settings.title'), to: '/admin/settings' }]}
        />
        <Alert tone="warning">
          {key === 'theme' || key === 'navigation'
            ? at('settingsAdmin.designPhase7')
            : at('settingsAdmin.notAvailable')}
        </Alert>
      </>
    );
  const dedicated = DEDICATED_SETTING_PATHS[key];
  if (dedicated) return <Navigate to={dedicated} replace />;
  return (
    <SettingWorkspace
      key={key}
      settingKey={key}
      subtitle={at(`settingsAdmin.about.${key}` as AdminMessageKey)}
    />
  );
}

/** Shipping rules customers see; fees are always confirmed manually by staff (V1). */
export function AdminShippingPage() {
  const { at } = useAdminI18n();
  return (
    <SettingWorkspace
      settingKey="shipping"
      title={at('modules.shipping.title')}
      subtitle={at('settingsAdmin.about.shipping')}
      crumbs={[]}
      aside={() => (
        <Panel title={at('shippingAdmin.opsTitle')}>
          <div className={styles.stack}>
            <p className={styles.small}>{at('shippingAdmin.manualFee')}</p>
            <Link
              to="/admin/orders?fulfillment=delivery"
              className={buttonClassName({ variant: 'secondary' })}
            >
              {at('shippingAdmin.deliveryOrders')}
            </Link>
          </div>
        </Panel>
      )}
    />
  );
}

/** Structured receipt / invoice template with a live preview on a clearly fake sample order. */
export function AdminReceiptsPage() {
  const { at } = useAdminI18n();
  return (
    <SettingWorkspace
      settingKey="receipt"
      title={at('modules.receipts.title')}
      subtitle={at('settingsAdmin.about.receipt')}
      crumbs={[]}
      aside={(value) => (
        <Panel title={at('receiptsAdmin.preview')}>
          <p className={styles.small}>{at('receiptsAdmin.previewHint')}</p>
          <div
            className={styles.receiptFrame}
            role="region"
            aria-label={at('receiptsAdmin.preview')}
            // Scrollable preview must be reachable by keyboard.
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <InvoiceSheet order={SAMPLE_RECEIPT_ORDER} template={value as ReceiptSettings} />
          </div>
        </Panel>
      )}
    />
  );
}

/** Legal / policy pages: bilingual plain text, published through the settings workflow. */
export function AdminLegalPage() {
  const { at } = useAdminI18n();
  return (
    <SettingWorkspace
      settingKey="legal"
      title={at('modules.legal.title')}
      subtitle={at('settingsAdmin.about.legal')}
      crumbs={[]}
      renderForm={(args) => <LegalForm {...args} />}
    />
  );
}

function LegalForm({
  value,
  onChange,
  disabled,
  issues,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  issues: Record<string, { code: string }>;
}) {
  const { at } = useAdminI18n();
  const [page, setPage] = useState<LegalPageKey>('privacy');
  const legal = value as LegalSettings;
  const doc = legal.pages[page];
  const set = (patch: Partial<LegalSettings['pages'][LegalPageKey]>) =>
    onChange({ pages: { ...legal.pages, [page]: { ...doc, ...patch } } });
  const today = new Date().toISOString().slice(0, 10);
  const hasIssue = (field: string) =>
    Object.keys(issues).some((k) => k.startsWith(`pages.${page}.${field}`));
  return (
    <div className={styles.panel}>
      <div className={styles.stack}>
        <Tabs
          idBase="legal"
          label={at('legalAdmin.pages')}
          tabs={LEGAL_PAGE_KEYS.map((k) => ({
            id: k,
            label: (
              <>
                {at(`legalAdmin.page.${k}` as AdminMessageKey)}
                {!legal.pages[k].body && (
                  <span className={styles.muted}> · {at('legalAdmin.empty')}</span>
                )}
              </>
            ),
          }))}
          active={page}
          onChange={setPage}
        />
        <TabPanel idBase="legal" active={page}>
          <fieldset
            disabled={disabled}
            className={styles.stack}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend className="visually-hidden">
              {at(`legalAdmin.page.${page}` as AdminMessageKey)}
            </legend>
            <LocalizedField
              legend={at('legalAdmin.title')}
              required
              value={toDraft(doc.title)}
              maxLength={120}
              error={hasIssue('title') ? at('schemaForm.required') : null}
              onChange={(d) => set({ title: cleanLocalized(d) })}
            />
            <LocalizedField
              legend={at('legalAdmin.body')}
              value={toDraft(doc.body)}
              multiline
              rows={14}
              maxLength={50000}
              hint={at('legalAdmin.bodyHint')}
              error={hasIssue('body') ? at('legalAdmin.bodyArabic') : null}
              onChange={(d) =>
                set({
                  body: !d.ar.trim() && !d.en.trim() ? null : cleanLocalized(d),
                  updatedAt: today,
                })
              }
            />
            <InputField
              type="date"
              label={at('legalAdmin.updatedAt')}
              hint={at('legalAdmin.updatedAtHint')}
              value={doc.updatedAt ?? ''}
              onChange={(e) => set({ updatedAt: e.target.value || null })}
            />
            <div>
              <Link
                to={`/legal/${page.replace(/_/g, '-')}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                <ExternalLink aria-hidden="true" />
                {at('legalAdmin.viewPublic')}
              </Link>
            </div>
          </fieldset>
        </TabPanel>
      </div>
    </div>
  );
}
