import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { resolveLocalized } from '@/domain/localized';
import type { PublicSettingKey } from '@/domain/settings/registry';
import { useSettingsContext } from '@/features/settings/context';
import { OpeningHoursList } from '@/features/store-info/OpeningHoursList';
import { useI18n } from '@/i18n/context';
import type { ReactNode } from 'react';
import { useAdminI18n } from '../i18n/context';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from '../admin.module.css';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.dlRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Read-only view of published store settings (editing with draft → publish arrives in Phase 06). */
export function AdminStoreSettingsPage() {
  const { at } = useAdminI18n();
  const { locale, format } = useI18n();
  const { settings, sources } = useSettingsContext();
  useAdminPageMeta(at('storeSettings.title'));

  const source = (key: PublicSettingKey) => (
    <Badge tone={sources[key] === 'backend' ? 'success' : 'neutral'}>
      {sources[key] === 'backend'
        ? at('storeSettings.sourceBackend')
        : at('storeSettings.sourceDefault')}
    </Badge>
  );
  const notConfigured = <span className={styles.muted}>{at('storeSettings.notConfigured')}</span>;
  const onOff = (value: boolean) => (
    <Badge tone={value ? 'success' : 'neutral'}>
      {value ? at('storeSettings.enabled') : at('storeSettings.disabled')}
    </Badge>
  );

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{at('storeSettings.title')}</h1>
        <p className={styles.pageSubtitle}>{at('storeSettings.subtitle')}</p>
      </div>
      <div className={styles.stack}>
        <Alert tone="info">{at('storeSettings.readOnlyNote')}</Alert>

        <Card>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{at('storeSettings.brand')}</h2>
            {source('brand')}
          </div>
          <dl className={styles.dl}>
            <Row label={at('storeSettings.name')}>
              <bdi>{settings.brand.name}</bdi>
            </Row>
            <Row label={at('storeSettings.tagline')}>
              {resolveLocalized(settings.brand.tagline, locale)}
            </Row>
          </dl>
        </Card>

        <Card>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{at('storeSettings.branches')}</h2>
            {source('store')}
          </div>
          <div className={styles.stack}>
            {settings.store.branches.map((branch) => (
              <dl key={branch.id} className={styles.dl}>
                <Row label={at('storeSettings.name')}>{resolveLocalized(branch.name, locale)}</Row>
                <Row label={at('storeSettings.branches')}>
                  {resolveLocalized(branch.address, locale)}
                  {branch.landmark ? ` — ${resolveLocalized(branch.landmark, locale)}` : ''}
                  {' · '}
                  {resolveLocalized(branch.city, locale)}
                </Row>
                <Row label={at('storeSettings.contact')}>
                  {branch.phones.map((phone) => (
                    <bdi key={phone} className="num" style={{ display: 'block' }}>
                      {phone}
                    </bdi>
                  ))}
                </Row>
                <Row label={at('dashboard.storeTitle')}>
                  <OpeningHoursList rules={branch.openingHours} />
                </Row>
                <Row label={at('storeSettings.pickup')}>{onOff(branch.pickupEnabled)}</Row>
                <Row label={at('storeSettings.maps')}>
                  {branch.mapsUrl ? <bdi>{branch.mapsUrl}</bdi> : notConfigured}
                </Row>
              </dl>
            ))}
            <dl className={styles.dl}>
              <Row label={at('storeSettings.whatsapp')}>
                {settings.store.whatsappNumber ? (
                  <bdi className="num">{settings.store.whatsappNumber}</bdi>
                ) : (
                  notConfigured
                )}
              </Row>
              <Row label={at('storeSettings.email')}>
                {settings.store.email ? <bdi>{settings.store.email}</bdi> : notConfigured}
              </Row>
            </dl>
          </div>
        </Card>

        <Card>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{at('storeSettings.social')}</h2>
            {source('social')}
          </div>
          <dl className={styles.dl}>
            {(Object.keys(settings.social) as (keyof typeof settings.social)[]).map((key) => (
              <Row key={key} label={key}>
                {settings.social[key] ? <bdi>{settings.social[key]}</bdi> : notConfigured}
              </Row>
            ))}
          </dl>
        </Card>

        <Card>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{at('storeSettings.localization')}</h2>
            {source('localization')}
          </div>
          <dl className={styles.dl}>
            <Row label={at('storeSettings.numerals')}>
              {settings.localization.numerals === 'latn'
                ? at('storeSettings.numeralsLatn')
                : at('storeSettings.numeralsArab')}
            </Row>
            <Row label={at('storeSettings.currency')}>
              {settings.localization.currency} · <bdi className="num">{format.money(25000)}</bdi>
            </Row>
            <Row label={at('storeSettings.timeZone')}>
              <bdi>{settings.localization.timeZone}</bdi>
            </Row>
            <Row label={at('storeSettings.weekStart')}>
              {format.weekday(settings.localization.weekStartsOn)}
            </Row>
          </dl>
        </Card>

        <Card>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{at('storeSettings.features')}</h2>
            {source('features')}
          </div>
          <dl className={styles.dl}>
            <Row label={at('storeSettings.promoCodes')}>{onOff(settings.features.promoCodes)}</Row>
            <Row label={at('storeSettings.loyalty')}>{onOff(settings.features.loyalty)}</Row>
          </dl>
        </Card>
      </div>
    </>
  );
}
