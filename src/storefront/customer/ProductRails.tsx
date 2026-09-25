import { useQuery } from '@tanstack/react-query';
import type { ProductDetail, ProductSummary } from '@/domain/catalog/types';
import { useRecentProducts } from '@/features/customer/hooks';
import { useI18n } from '@/i18n/context';
import type { CoreMessageKey } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { ProductGrid } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import styles from '../product/product.module.css';

function Rail({ id, title, products }: { id: string; title: string; products: ProductSummary[] }) {
  if (products.length === 0) return null;
  return (
    <section className={styles.related} aria-labelledby={id}>
      <SectionHeading id={id} title={title} />
      <ProductGrid products={products.slice(0, 4)} />
    </section>
  );
}

const RAILS: {
  key: 'accessories' | 'compatible' | 'boughtTogether' | 'related' | 'youMayAlsoLike';
  title: CoreMessageKey;
}[] = [
  { key: 'boughtTogether', title: 'recommendations.boughtTogether' },
  { key: 'accessories', title: 'recommendations.accessories' },
  { key: 'compatible', title: 'recommendations.compatible' },
  { key: 'related', title: 'recommendations.related' },
  { key: 'youMayAlsoLike', title: 'recommendations.youMayAlsoLike' },
];

/**
 * Rule-based recommendations (manual relations first, explicit compatibility, aggregated
 * bought-together). While loading, the product's own manual relations are shown.
 */
export function ProductRecommendations({ product }: { product: ProductDetail }) {
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const recs = useQuery({
    queryKey: ['public', 'recommendations', product.slug],
    queryFn: () => repositories.catalog.getRecommendations(product.slug),
    staleTime: 60_000,
  });
  const data = recs.data ?? {
    related: [...product.relations.similar, ...product.relations.recommended],
    accessories: product.relations.accessories,
    compatible: [],
    boughtTogether: [],
    youMayAlsoLike: [],
  };
  const shown = new Set<string>();
  return (
    <>
      {RAILS.map(({ key, title }) => {
        const products = data[key].filter((p) => !shown.has(p.id));
        products.slice(0, 4).forEach((p) => shown.add(p.id));
        return <Rail key={key} id={`rec-${key}`} title={t(title)} products={products} />;
      })}
    </>
  );
}

/** "Recently viewed" (account history when signed in, else this browser's). */
export function RecentlyViewedRail({
  excludeProductId,
  title,
}: {
  excludeProductId?: string;
  title?: string;
}) {
  const { t } = useI18n();
  const { products } = useRecentProducts({ limit: 4, excludeProductId });
  return <Rail id="recently-viewed" title={title ?? t('recent.title')} products={products} />;
}
