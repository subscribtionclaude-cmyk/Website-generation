import { Skeleton } from '@/components/feedback/Skeleton';
import type { ProductSummary } from '@/domain/catalog/types';
import { useI18n } from '@/i18n/context';
import { FeaturedProductCard, ProductCard, type ProductCardActions } from './ProductCard';
import styles from './catalog.module.css';

export function ProductGrid({
  products,
  columns = 4,
  headingLevel = 3,
  linkQuery,
  renderActions,
}: {
  products: ProductSummary[];
  columns?: 3 | 4;
  headingLevel?: 2 | 3 | 4;
  linkQuery?: string;
} & ProductCardActions) {
  return (
    <ul className={[styles.grid, columns === 4 && styles.grid4].filter(Boolean).join(' ')}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            headingLevel={headingLevel}
            linkQuery={linkQuery}
            renderActions={renderActions}
            priority={index < 4}
          />
        </li>
      ))}
    </ul>
  );
}

export function FeaturedProductGrid({
  products,
  headingLevel = 3,
}: {
  products: ProductSummary[];
  headingLevel?: 2 | 3 | 4;
}) {
  const { t } = useI18n();
  return (
    <ul className={styles.featuredGrid}>
      {products.map((product, index) => (
        <li key={product.id}>
          <FeaturedProductCard
            product={product}
            tone={index === 0 ? 'dark' : 'light'}
            headingLevel={headingLevel}
            ctaLabel={t('campaign.pick')}
          />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({
  count = 8,
  columns = 4,
}: {
  count?: number;
  columns?: 3 | 4;
}) {
  return (
    <ul
      className={[styles.grid, columns === 4 && styles.grid4].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.skeletonCard}>
          <Skeleton height="auto" radius="var(--radius-md)" className="skeleton-square" />
          <Skeleton width="40%" height="0.8rem" />
          <Skeleton width="85%" height="1rem" />
          <Skeleton width="55%" height="1rem" />
        </li>
      ))}
    </ul>
  );
}
