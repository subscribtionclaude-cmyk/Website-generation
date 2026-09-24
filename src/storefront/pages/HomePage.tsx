import { ArrowRight, Clock3, MapPin, Phone, Store } from 'lucide-react';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { NavIcon } from '@/components/navigation/navIcons';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { resolveLocalized } from '@/domain/localized';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { OpeningHoursList } from '@/features/store-info/OpeningHoursList';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useI18n } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import styles from './HomePage.module.css';

/**
 * Phase 01 home: brand hero + settings-driven navigation tiles + branch details.
 * Phase 02 replaces the body with CMS-driven modular sections (hero campaign, releases, offers …)
 * and Phase 07 makes them editable in the Site Editor. Nothing here is hard-coded store data.
 */
export function HomePage() {
  const { brand, navigation, store } = useSettings();
  const { t, locale } = useI18n();
  usePageMeta({});

  const explore = navigation.primary.filter(
    (item) => item.visible && item.href !== '/' && item.id !== 'contact',
  );
  const branch = store.branches[0];

  return (
    <>
      <section className={styles.hero} aria-labelledby="home-hero-title">
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>{brand.name}</p>
            <h1 id="home-hero-title" className={styles.heroTitle}>
              {resolveLocalized(brand.tagline, locale)}
            </h1>
            {branch && (
              <p className={styles.heroLead}>
                {resolveLocalized(branch.name, locale)}
                {branch.landmark ? ` — ${resolveLocalized(branch.landmark, locale)}` : ''}
              </p>
            )}
            <div className={styles.heroActions}>
              <ButtonLink to="/store" variant="accent" size="lg">
                {t('home.heroCtaShop')}
              </ButtonLink>
              <ButtonLink to="/trade-in" variant="inverse" size="lg">
                {t('home.heroCtaTradeIn')}
              </ButtonLink>
            </div>
          </div>
          <div className={styles.heroVisual} aria-hidden="true">
            <div className={styles.heroTile}>
              <img src="/brand/malek-store-mark-384.webp" alt="" width={384} height={378} />
            </div>
          </div>
        </div>
      </section>

      {explore.length > 0 && (
        <section className={`container ${styles.section}`} aria-labelledby="home-explore-title">
          <div className={styles.sectionHead}>
            <h2 id="home-explore-title" className={styles.sectionTitle}>
              {t('home.exploreTitle')}
            </h2>
            <p className={styles.sectionLead}>{t('home.exploreSubtitle')}</p>
          </div>
          <ul className={styles.explore}>
            {explore.map((item) => (
              <li key={item.id}>
                <LocaleLink
                  to={item.href}
                  className={[styles.exploreCard, item.highlight && styles.exploreCardHighlight]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <NavIcon icon={item.icon} className={styles.exploreIcon} />
                  <span className={styles.exploreFoot}>
                    {resolveLocalized(item.label, locale)}
                    <ArrowRight className={`${styles.exploreArrow} flip-rtl`} aria-hidden="true" />
                  </span>
                </LocaleLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {branch && (
        <section className={`container ${styles.section}`} aria-labelledby="home-visit-title">
          <div className={styles.sectionHead}>
            <h2 id="home-visit-title" className={styles.sectionTitle}>
              {t('home.visitTitle')}
            </h2>
            <p className={styles.sectionLead}>{t('home.visitSubtitle')}</p>
          </div>
          <div className={styles.visit}>
            <div className={styles.visitInfo}>
              <h3 className={styles.branchName}>{resolveLocalized(branch.name, locale)}</h3>
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
                <h4 className={styles.hoursTitle}>
                  <Clock3 aria-hidden="true" />
                  {t('store.openingHours')}
                </h4>
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
        </section>
      )}
    </>
  );
}
