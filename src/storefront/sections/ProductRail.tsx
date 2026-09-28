import { productSourceQuery, type SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { SectionHeading } from '../components/SectionHeading';
import { FeaturedProductGrid, ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { useCatalogSearch, useProductsByIds } from '../data/hooks';
import styles from './sections.module.css';

/** Product rail: "premium" = large featured cards, "grid" = practical cards (hybrid presentation). */
export function ProductRail({ id, props }: { id: string; props: SectionProps<'product_rail'> }) {
  const { locale, t } = useI18n();
  const manualIds = props.source.kind === 'manual' ? (props.source.productIds ?? []) : null;
  const query = productSourceQuery(props.source, props.limit);
  const search = useCatalogSearch(query, manualIds === null);
  // Hand-picked products (Site Editor): the listed ids in order; hidden / unpublished ids are skipped.
  const picked = useProductsByIds(manualIds ?? [], manualIds !== null);
  const { isPending, isError } = manualIds === null ? search : picked;
  const items =
    manualIds === null ? (search.data?.items ?? []) : (picked.data ?? []).slice(0, props.limit);
  if (manualIds?.length === 0) return null;
  if (!isPending && !isError && items.length === 0) return null;
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
        <FeaturedProductGrid products={items} />
      ) : (
        <ProductGrid products={items} />
      )}
    </section>
  );
}
