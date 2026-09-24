import { ButtonLink } from '@/components/navigation/ButtonLink';
import { resolveLocalized } from '@/domain/localized';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { SectionPage } from '../sections/SectionRenderer';
import { BranchCard } from '../sections/InfoSections';
import styles from './HomePage.module.css';

/**
 * CMS-driven home: an ordered list of page sections (hero campaign, new releases, offers …)
 * rendered through the section registry. Phase 07's Site Editor edits the same rows.
 */
export function HomePage() {
  usePageMeta({});
  return <SectionPage pageKey="home" fallback={<BrandFallback />} header={<BrandHeading />} />;
}

function BrandHeading() {
  const { brand } = useSettings();
  const { locale } = useI18n();
  return (
    <h1 className="visually-hidden">{`${brand.name} — ${resolveLocalized(brand.tagline, locale)}`}</h1>
  );
}

/** Shown when page sections can't be loaded: brand hero + branch details (settings only). */
function BrandFallback() {
  const { brand } = useSettings();
  const { t, locale } = useI18n();
  return (
    <>
      <section className={styles.hero} aria-labelledby="home-hero-title">
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>{brand.name}</p>
            <h1 id="home-hero-title" className={styles.heroTitle}>
              {resolveLocalized(brand.tagline, locale)}
            </h1>
            <div className={styles.heroActions}>
              <ButtonLink to="/store" variant="accent" size="lg">
                {t('home.heroCtaShop')}
              </ButtonLink>
              <ButtonLink to="/trade-in" variant="inverse" size="lg">
                {t('home.heroCtaTradeIn')}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
      <section className={`container ${styles.section}`} aria-labelledby="home-visit-title">
        <h2 id="home-visit-title" className={styles.sectionTitle}>
          {t('home.visitTitle')}
        </h2>
        <BranchCard />
      </section>
    </>
  );
}
