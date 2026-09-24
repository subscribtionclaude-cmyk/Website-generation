import { productSourceQuery, type SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { SectionHeading } from '../components/SectionHeading';
import { FeaturedProductGrid, ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { useCatalogSearch } from '../data/hooks';
import styles from './sections.module.css';

/** Product rail: "premium" = large featured cards, "grid" = practical cards (hybrid presentation). */
export function ProductRail({ id, props }: { id: string; props: SectionProps<'product_rail'> }) {
  const { locale, t } = useI18n();
  const query = productSourceQuery(props.source, props.limit);
  const { data, isPending, isError } = useCatalogSearch(query);
  if (!isPending && !isError && data.items.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        eyebrow={props.eyebrow ? resolveLocalized(props.eyebrow, locale) : null}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
        link={
          props.cta
            ? { label: resolveLocalized(props.cta.label, locale), href: props.cta.href }
            : null
        }
      />
      {isPending ? (
        <ProductGridSkeleton count={props.layout === 'premium' ? 4 : Math.min(props.limit, 8)} />
      ) : isError ? (
        <p className={styles.errorNote} role="status">
          {t('catalog.loadError')}
        </p>
      ) : props.layout === 'premium' ? (
        <FeaturedProductGrid products={data.items} />
      ) : (
        <ProductGrid products={data.items} />
      )}
    </section>
  );
}
