import {
  ArrowRight,
  BadgeCheck,
  Camera,
  ClipboardCheck,
  Gamepad2,
  Headphones,
  Laptop,
  MessagesSquare,
  PackageSearch,
  ShieldCheck,
  Smartphone,
  Tablet,
  Watch,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { KIND_ICON } from './serviceLabels';
import { ServiceArt } from './ServiceArt';
import { HonestNote } from './ServiceParts';
import styles from './services.module.css';

const MODEL_ICON: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  watch: Watch,
  earbuds: Headphones,
  console: Gamepad2,
  none: PackageSearch,
};

function Hero({
  eyebrow,
  title,
  body,
  art,
  cta,
  secondary,
  trust,
}: {
  eyebrow: string;
  title: string;
  body: string;
  art: Parameters<typeof ServiceArt>[0]['variant'];
  cta?: { to: string; label: string };
  secondary?: { to: string; label: string };
  trust: string[];
}) {
  return (
    <section className={styles.hero} aria-labelledby="service-hero-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id="service-hero-title" className={styles.heroTitle}>
          {title}
        </h1>
        <p className={styles.heroBody}>{body}</p>
        {(cta || secondary) && (
          <div className={styles.heroActions}>
            {cta && (
              <ButtonLink to={cta.to} variant="accent" size="lg">
                {cta.label}
              </ButtonLink>
            )}
            {secondary && (
              <ButtonLink to={secondary.to} variant="inverse" size="lg">
                {secondary.label}
              </ButtonLink>
            )}
          </div>
        )}
        <ul className={styles.trust}>
          {trust.map((item) => (
            <li key={item}>
              <BadgeCheck aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.heroArt}>
        <ServiceArt variant={art} />
      </div>
    </section>
  );
}

function Steps({ title, items }: { title: string; items: { title: string; body: string }[] }) {
  return (
    <section className={styles.section} aria-labelledby="service-steps">
      <h2 id="service-steps" className={styles.sectionTitle}>
        {title}
      </h2>
      <ol className={styles.steps}>
        {items.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Disabled() {
  const { t } = useI18n();
  return <HonestNote>{t('services.disabledNotice')}</HonestNote>;
}

// ── /services ──────────────────────────────────────────────────────────────
export function ServicesPage() {
  const { t } = useI18n();
  usePageMeta({ title: t('services.hubTitle'), description: t('services.hubBody') });
  const cards: {
    kind: keyof typeof KIND_ICON;
    to: string;
    title: CoreMessageKey;
    body: CoreMessageKey;
  }[] = [
    {
      kind: 'repair',
      to: '/repairs',
      title: 'services.cardRepairTitle',
      body: 'services.cardRepairBody',
    },
    {
      kind: 'trade_in',
      to: '/trade-in',
      title: 'services.cardTradeInTitle',
      body: 'services.cardTradeInBody',
    },
    { kind: 'used', to: '/used', title: 'services.cardUsedTitle', body: 'services.cardUsedBody' },
    {
      kind: 'after_sales',
      to: '/after-sales',
      title: 'services.cardAfterSalesTitle',
      body: 'services.cardAfterSalesBody',
    },
  ];
  return (
    <div className={`container ${styles.page}`}>
      <Hero
        eyebrow={t('services.hubEyebrow')}
        title={t('services.hubTitle')}
        body={t('services.hubBody')}
        art="services"
        trust={[
          t('services.trustTeam'),
          t('services.trustNoAutoPrice'),
          t('services.trustTracking'),
        ]}
      />
      <section className={styles.section} aria-labelledby="service-cards">
        <h2 id="service-cards" className={styles.sectionTitle}>
          {t('services.chooseService')}
        </h2>
        <div className={styles.serviceGrid}>
          {cards.map((card) => {
            const Icon = KIND_ICON[card.kind];
            return (
              <LocaleLink key={card.kind} to={card.to} className={styles.serviceCard}>
                <span className={styles.serviceIcon}>
                  <Icon aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{t(card.title)}</h3>
                <p className={styles.cardBody}>{t(card.body)}</p>
                <span className={styles.cardLink}>
                  {t('services.learnMore')}
                  <ArrowRight aria-hidden="true" className="flip-rtl" />
                </span>
              </LocaleLink>
            );
          })}
        </div>
      </section>
      <HonestNote>{t('services.trackingNote')}</HonestNote>
    </div>
  );
}

// ── /repairs ───────────────────────────────────────────────────────────────
export function RepairsPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  usePageMeta({ title: t('repairs.title'), description: t('repairs.heroBody') });
  const enabled = settings.services.enabled.repairs;
  const categories = settings.repair_catalog.categories;
  return (
    <div className={`container ${styles.page}`}>
      <Hero
        eyebrow={t('repairs.eyebrow')}
        title={t('repairs.title')}
        body={t('repairs.heroBody')}
        art="repair"
        cta={enabled ? { to: '/repairs/request', label: t('repairs.start') } : undefined}
        trust={[
          t('repairs.trustAllBrands'),
          t('services.trustNoAutoPrice'),
          t('repairs.trustDiagnostic'),
        ]}
      />
      {!enabled && <Disabled />}
      <section className={styles.section} aria-labelledby="repair-devices">
        <div className={styles.sectionHead}>
          <h2 id="repair-devices" className={styles.sectionTitle}>
            {t('repairs.devicesTitle')}
          </h2>
          <p className={styles.lead}>{t('repairs.devicesBody')}</p>
        </div>
        <div className={styles.serviceGrid}>
          {categories.map((c) => {
            const Icon = MODEL_ICON[c.model] ?? Wrench;
            const content = (
              <>
                <span className={styles.serviceIcon}>
                  <Icon aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{resolveLocalized(c.label, locale)}</h3>
                <p className={styles.cardBody}>
                  {c.brands
                    .filter((b) => b !== 'Other')
                    .slice(0, 5)
                    .join(' · ') || t('repairs.anyBrand')}
                </p>
              </>
            );
            return enabled ? (
              <LocaleLink
                key={c.key}
                to={`/repairs/request?device=${c.key}`}
                className={styles.serviceCard}
              >
                {content}
              </LocaleLink>
            ) : (
              <div key={c.key} className={styles.serviceCard}>
                {content}
              </div>
            );
          })}
        </div>
      </section>
      <Steps
        title={t('repairs.howTitle')}
        items={[
          { title: t('repairs.how1Title'), body: t('repairs.how1Body') },
          { title: t('repairs.how2Title'), body: t('repairs.how2Body') },
          { title: t('repairs.how3Title'), body: t('repairs.how3Body') },
          { title: t('repairs.how4Title'), body: t('repairs.how4Body') },
        ]}
      />
      <HonestNote>{t('repairs.noAutoPrice')}</HonestNote>
    </div>
  );
}

// ── /trade-in ──────────────────────────────────────────────────────────────
export function TradeInPage() {
  const { t } = useI18n();
  const settings = useSettings();
  const [params] = useSearchParams();
  usePageMeta({ title: t('tradeIn.title'), description: t('tradeIn.heroBody') });
  const enabled = settings.services.enabled.tradeIn;
  const product = params.get('product');
  const requestPath =
    product && /^[a-z0-9-]{1,120}$/.test(product)
      ? `/trade-in/request?product=${product}`
      : '/trade-in/request';
  return (
    <div className={`container ${styles.page}`}>
      <Hero
        eyebrow={t('tradeIn.eyebrow')}
        title={t('tradeIn.title')}
        body={t('tradeIn.heroBody')}
        art="tradeIn"
        cta={enabled ? { to: requestPath, label: t('tradeIn.start') } : undefined}
        secondary={{ to: '/store', label: t('tradeIn.browse') }}
        trust={[
          t('tradeIn.trustCatalog'),
          t('tradeIn.trustInspection'),
          t('services.trustTracking'),
        ]}
      />
      {!enabled && <Disabled />}
      <Steps
        title={t('tradeIn.howTitle')}
        items={[
          { title: t('tradeIn.how1Title'), body: t('tradeIn.how1Body') },
          { title: t('tradeIn.how2Title'), body: t('tradeIn.how2Body') },
          { title: t('tradeIn.how3Title'), body: t('tradeIn.how3Body') },
          { title: t('tradeIn.how4Title'), body: t('tradeIn.how4Body') },
        ]}
      />
      <section className={styles.section} aria-labelledby="trade-prepare">
        <h2 id="trade-prepare" className={styles.sectionTitle}>
          {t('tradeIn.prepareTitle')}
        </h2>
        <ul className={styles.trust} style={{ color: 'var(--color-text-primary)' }}>
          {(['front', 'back', 'sides', 'screen_on', 'camera', 'damage'] as const).map((l) => (
            <li key={l}>
              <Camera aria-hidden="true" />
              {t(`media.label_${l}` as CoreMessageKey)}
            </li>
          ))}
        </ul>
      </section>
      <HonestNote>{t('tradeIn.valuationNote')}</HonestNote>
    </div>
  );
}

// ── /used ──────────────────────────────────────────────────────────────────
export function UsedPage() {
  const { t } = useI18n();
  const settings = useSettings();
  usePageMeta({ title: t('used.title'), description: t('used.heroBody') });
  const enabled = settings.services.enabled.used;
  return (
    <div className={`container ${styles.page}`}>
      <Hero
        eyebrow={t('used.eyebrow')}
        title={t('used.title')}
        body={t('used.heroBody')}
        art="used"
        cta={enabled ? { to: '/used/request', label: t('used.start') } : undefined}
        trust={[t('used.trustBattery'), t('used.trustChecked'), t('services.trustTracking')]}
      />
      {!enabled && <Disabled />}
      <Steps
        title={t('used.howTitle')}
        items={[
          { title: t('used.how1Title'), body: t('used.how1Body') },
          { title: t('used.how2Title'), body: t('used.how2Body') },
          { title: t('used.how3Title'), body: t('used.how3Body') },
        ]}
      />
      <HonestNote>{t('used.noCatalogNote')}</HonestNote>
    </div>
  );
}

// ── /after-sales ───────────────────────────────────────────────────────────
export function AfterSalesPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  usePageMeta({ title: t('afterSales.title'), description: t('afterSales.heroBody') });
  const enabled = settings.services.enabled.afterSales;
  const policies = settings.services.afterSales.policies;
  const types: {
    key: 'exchange' | 'return' | 'warranty';
    icon: LucideIcon;
    title: CoreMessageKey;
  }[] = [
    { key: 'exchange', icon: ClipboardCheck, title: 'afterSales.typeExchange' },
    { key: 'return', icon: MessagesSquare, title: 'afterSales.typeReturn' },
    { key: 'warranty', icon: ShieldCheck, title: 'afterSales.typeWarranty' },
  ];
  return (
    <div className={`container ${styles.page}`}>
      <Hero
        eyebrow={t('afterSales.eyebrow')}
        title={t('afterSales.title')}
        body={t('afterSales.heroBody')}
        art="afterSales"
        cta={enabled ? { to: '/after-sales/request', label: t('afterSales.start') } : undefined}
        trust={[
          t('afterSales.trustOwned'),
          t('afterSales.trustPolicy'),
          t('services.trustTracking'),
        ]}
      />
      {!enabled && <Disabled />}
      <section className={styles.section} aria-labelledby="after-types">
        <h2 id="after-types" className={styles.sectionTitle}>
          {t('afterSales.typesTitle')}
        </h2>
        <div className={styles.serviceGrid}>
          {types.map(({ key, icon: Icon, title }) => (
            <div key={key} className={styles.serviceCard}>
              <span className={styles.serviceIcon}>
                <Icon aria-hidden="true" />
              </span>
              <h3 className={styles.cardTitle}>{t(title)}</h3>
              <p className={styles.cardBody}>{resolveLocalized(policies[key], locale)}</p>
            </div>
          ))}
        </div>
      </section>
      <HonestNote>{t('afterSales.policyNote')}</HonestNote>
    </div>
  );
}
