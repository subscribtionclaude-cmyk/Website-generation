import { Clock3, MapPin, Phone, Store } from 'lucide-react';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { productSourceQuery, type SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { OpeningHoursList } from '@/features/store-info/OpeningHoursList';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import { EntryCard } from '../components/EntryCard';
import { DataIcon } from '../components/icons';
import { productHref } from '../components/links';
import { SectionHeading } from '../components/SectionHeading';
import { TrustList } from '../components/TrustList';
import { useCatalogSearch, useEntries } from '../data/hooks';
import contentStyles from '../components/content.module.css';
import styles from './sections.module.css';
import { BidiText } from '@/components/text/BidiText';

const STATE_LABEL: Record<string, CoreMessageKey> = {
  coming_soon: 'catalog.comingSoon',
  waitlist_only: 'catalog.waitlistOnly',
  pre_order: 'catalog.preOrder',
  available: 'catalog.inStock',
};

/** Upcoming devices (coming soon / waitlist / pre-order) with a waitlist entry point. */
export function ComingSoonSection({
  id,
  props,
}: {
  id: string;
  props: SectionProps<'coming_soon'>;
}) {
  const { locale, t } = useI18n();
  const { data } = useCatalogSearch(productSourceQuery({ kind: 'coming_soon' }, props.limit));
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
        link={{ label: t('sections.viewAll'), href: '/coming-soon' }}
      />
      <ul className={styles.soonGrid}>
        {items.map((product) => (
          <li key={product.id}>
            <article className={styles.soon}>
              {product.image ? (
                <img
                  src={product.image.url}
                  alt=""
                  width={96}
                  height={120}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span />
              )}
              <div className={styles.soonBody}>
                <p className={styles.soonState}>
                  {t(STATE_LABEL[product.availabilityState] ?? 'catalog.comingSoon')}
                </p>
                <h3 className={styles.soonTitle}>
                  <LocaleLink to={productHref(product)} className={styles.soonLink}>
                    {resolveLocalized(product.name, locale)}
                  </LocaleLink>
                </h3>
                <p className={styles.soonCta}>
                  {product.availabilityState === 'pre_order'
                    ? t('catalog.preOrder')
                    : t('product.joinWaitlist')}
                </p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContentRail({ id, props }: { id: string; props: SectionProps<'content_rail'> }) {
  const { locale } = useI18n();
  const { data } = useEntries({ types: props.types, limit: props.limit });
  const entries = data ?? [];
  if (entries.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
        link={
          props.cta
            ? { label: resolveLocalized(props.cta.label, locale), href: props.cta.href }
            : null
        }
      />
      <ul className={styles.entryGrid}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <EntryCard entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TrustStrip({ id, props }: { id: string; props: SectionProps<'trust_strip'> }) {
  const { locale, t } = useI18n();
  const { trust } = useSettings();
  const items = trust.items.filter(
    (item) => item.visible && (!props.itemIds || props.itemIds.includes(item.id)),
  );
  if (items.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <h2 id={headingId} className={props.title ? undefined : 'visually-hidden'}>
        {props.title ? resolveLocalized(props.title, locale) : t('sections.trustTitle')}
      </h2>
      <TrustList items={items} />
    </section>
  );
}

/** Single highlighted trust statement (e.g. Apple Authorized Reseller) — hidden when the item is hidden. */
export function TrustFeature({ id, props }: { id: string; props: SectionProps<'trust_feature'> }) {
  const { locale } = useI18n();
  const { trust } = useSettings();
  const item = trust.items.find((i) => i.id === props.itemId && i.visible);
  if (!item) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <div className={contentStyles.trustFeature}>
        <span className={contentStyles.trustFeatureIcon} aria-hidden="true">
          <DataIcon name={item.icon} />
        </span>
        <div>
          {props.eyebrow && <p className="eyebrow">{resolveLocalized(props.eyebrow, locale)}</p>}
          <h2 id={headingId} className={contentStyles.trustFeatureTitle}>
            <BidiText text={resolveLocalized(item.title, locale)} />
          </h2>
          {item.body && (
            <p className={contentStyles.trustFeatureBody}>{resolveLocalized(item.body, locale)}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Branch details from settings (address, hours, phones, maps link only when configured). */
export function BranchCard({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const { store } = useSettings();
  const { t, locale } = useI18n();
  const branch = store.branches[0];
  if (!branch) return null;
  const Heading = `h${headingLevel}` as const;
  const SubHeading = `h${headingLevel + 1}` as 'h3' | 'h4';
  return (
    <div className={styles.visit}>
      <div className={styles.visitInfo}>
        <Heading className={styles.branchName}>{resolveLocalized(branch.name, locale)}</Heading>
        <address className={styles.addressLine}>
          <MapPin aria-hidden="true" />
          <span>
            {resolveLocalized(branch.address, locale)}
            {branch.landmark && (
              <>
                <br />
                {resolveLocalized(branch.landmark, locale)}
              </>
            )}
            <br />
            {resolveLocalized(branch.city, locale)}
          </span>
        </address>
        {branch.pickupEnabled && (
          <p className={styles.pickup}>
            <Store aria-hidden="true" />
            {t('store.storePickup')}
          </p>
        )}
        <div className={styles.hoursCard}>
          <SubHeading className={styles.hoursTitle}>
            <Clock3 aria-hidden="true" />
            {t('store.openingHours')}
          </SubHeading>
          <OpenStatus rules={branch.openingHours} />
          <OpeningHoursList rules={branch.openingHours} />
          <p className={styles.tzNote}>{t('store.timeZoneNote')}</p>
        </div>
      </div>
      <div className={styles.visitActions}>
        {branch.phones.map((phone) => {
          const href = toTelHref(phone);
          return href ? (
            <a
              key={phone}
              href={href}
              className={buttonClassName({ variant: 'primary', size: 'lg', block: true })}
            >
              <Phone aria-hidden="true" />
              <span>
                {t('home.callBranch')} · <bdi className="num">{phone}</bdi>
              </span>
            </a>
          ) : null;
        })}
        {branch.mapsUrl && (
          <ButtonLink
            to={branch.mapsUrl}
            variant="secondary"
            size="lg"
            block
            icon={<MapPin aria-hidden="true" />}
          >
            {t('home.directions')}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export function BranchContact({
  id,
  props,
}: {
  id: string;
  props: SectionProps<'branch_contact'>;
}) {
  const { locale } = useI18n();
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
      />
      <BranchCard />
    </section>
  );
}
