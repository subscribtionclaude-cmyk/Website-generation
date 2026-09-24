import { Hourglass, Sparkles } from 'lucide-react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { productSourceQuery } from '@/domain/content/sections';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { EntryCard } from '../components/EntryCard';
import { FeaturedProductGrid, ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import { useCatalogSearch, useEntries } from '../data/hooks';
import styles from './contentPages.module.css';

/** New releases: newest arrivals (premium cards first), release notes and a coming-soon link. */
export function NewPage() {
  const { t } = useI18n();
  usePageMeta({ title: t('content.newTitle'), description: t('content.newSubtitle') });
  const products = useCatalogSearch(productSourceQuery({ kind: 'new' }, 24));
  const releases = useEntries({ types: ['new_release'], limit: 6 });
  const items = products.data?.items ?? [];
  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs
        items={[{ label: t('common.home'), href: '/' }, { label: t('content.newTitle') }]}
      />
      <header className={styles.head}>
        <h1 className={styles.title}>{t('content.newTitle')}</h1>
        <p className={styles.subtitle}>{t('content.newSubtitle')}</p>
      </header>
      {products.isPending ? (
        <ProductGridSkeleton count={8} />
      ) : products.isError ? (
        <StateMessage icon={<Sparkles />} title={t('catalog.loadError')} role="alert" />
      ) : items.length === 0 ? (
        <StateMessage icon={<Sparkles />} title={t('content.empty')} />
      ) : (
        <section aria-labelledby="new-arrivals">
          <SectionHeading
            id="new-arrivals"
            title={t('content.newArrivals')}
            link={{ label: t('content.comingSoonTitle'), href: '/coming-soon' }}
          />
          <FeaturedProductGrid products={items.slice(0, 4)} />
          {items.length > 4 && (
            <div className={styles.section}>
              <ProductGrid products={items.slice(4)} />
            </div>
          )}
        </section>
      )}
      {releases.data && releases.data.length > 0 && (
        <section className={styles.section} aria-labelledby="new-releases">
          <SectionHeading
            id="new-releases"
            title={t('content.releases')}
            link={{ label: t('sections.viewAll'), href: '/news?type=new_release' }}
          />
          <ul className={styles.grid}>
            {releases.data.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Upcoming devices: Coming Soon / Waitlist Only / Pre-Order Open states, with waitlist entry. */
export function ComingSoonPage() {
  const { t } = useI18n();
  usePageMeta({
    title: t('content.comingSoonTitle'),
    description: t('content.comingSoonSubtitle'),
  });
  const products = useCatalogSearch(productSourceQuery({ kind: 'coming_soon' }, 24));
  const teasers = useEntries({ types: ['coming_soon'], limit: 6 });
  const items = products.data?.items ?? [];
  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs
        items={[
          { label: t('common.home'), href: '/' },
          { label: t('content.newTitle'), href: '/new' },
          { label: t('content.comingSoonTitle') },
        ]}
      />
      <header className={styles.head}>
        <h1 className={styles.title}>{t('content.comingSoonTitle')}</h1>
        <p className={styles.subtitle}>{t('content.comingSoonSubtitle')}</p>
      </header>
      {products.isPending ? (
        <ProductGridSkeleton count={4} />
      ) : products.isError ? (
        <StateMessage icon={<Hourglass />} title={t('catalog.loadError')} role="alert" />
      ) : items.length === 0 ? (
        <StateMessage
          icon={<Hourglass />}
          title={t('content.comingSoonEmpty')}
          actions={
            <ButtonLink to="/new" variant="primary">
              {t('content.newArrivals')}
            </ButtonLink>
          }
        />
      ) : (
        <ProductGrid products={items} headingLevel={2} />
      )}
      {teasers.data && teasers.data.length > 0 && (
        <section className={styles.section} aria-labelledby="soon-updates">
          <SectionHeading id="soon-updates" title={t('content.typeComingSoon')} />
          <ul className={styles.grid}>
            {teasers.data.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
