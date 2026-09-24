import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { ProductSummary } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { ColorSwatches } from './ColorSwatches';
import { productHref } from './links';
import { Price } from './Price';
import { ProductBadges, StockStatus } from './StatusBadges';
import styles from './catalog.module.css';
import { BidiText } from '@/components/text/BidiText';

/**
 * Optional card actions (wishlist / compare). Phase 04 supplies real handlers; until then nothing is
 * rendered, so there are no non-functional buttons.
 */
export interface ProductCardActions {
  renderActions?: (product: ProductSummary) => ReactNode;
}

interface ProductCardProps extends ProductCardActions {
  product: ProductSummary;
  headingLevel?: 2 | 3 | 4;
  /** Preserve an active colour filter when opening the product. */
  linkQuery?: string;
  priority?: boolean;
}

/** Practical grid card: the whole card is one link (stretched title link), keyboard + SR friendly. */
export function ProductCard({
  product,
  headingLevel = 3,
  linkQuery,
  renderActions,
  priority = false,
}: ProductCardProps) {
  const { locale } = useI18n();
  const Heading = `h${headingLevel}` as const;
  const name = resolveLocalized(product.name, locale);
  const storages = product.storages.map((s) => resolveLocalized(s.label, locale)).join(' · ');
  return (
    <article className={styles.card}>
      <div className={styles.cardMedia}>
        {product.image ? (
          <img
            src={product.image.url}
            alt={resolveLocalized(product.image.alt, locale)}
            width={product.image.width ?? 800}
            height={product.image.height ?? 800}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : null}
        <div className={styles.cardBadges}>
          <ProductBadges product={product} />
        </div>
      </div>
      <div className={styles.cardBody}>
        <p className={styles.cardBrand}>{resolveLocalized(product.brand.name, locale)}</p>
        <Heading className={styles.cardTitle}>
          <LocaleLink className={styles.cardLink} to={productHref(product, linkQuery)}>
            <BidiText text={name} />
          </LocaleLink>
        </Heading>
        {storages && <p className={styles.cardMeta}>{storages}</p>}
        <ColorSwatches colors={product.colors} />
        <div className={styles.cardFoot}>
          <Price
            min={product.price.min}
            max={product.price.max}
            compareAt={product.price.compareAt}
          />
          <StockStatus state={product.stockState} availability={product.availabilityState} />
        </div>
        {renderActions && <div className={styles.cardActions}>{renderActions(product)}</div>}
      </div>
    </article>
  );
}

/** Larger premium card for New Releases / featured rails (hybrid presentation). */
export function FeaturedProductCard({
  product,
  tone = 'light',
  headingLevel = 3,
  ctaLabel,
}: {
  product: ProductSummary;
  tone?: 'light' | 'dark';
  headingLevel?: 2 | 3 | 4;
  ctaLabel: string;
}) {
  const { locale } = useI18n();
  const Heading = `h${headingLevel}` as const;
  return (
    <article
      className={[styles.featured, tone === 'dark' && styles.featuredDark]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.featuredMedia}>
        {product.image && (
          <img
            src={product.image.url}
            alt={resolveLocalized(product.image.alt, locale)}
            width={product.image.width ?? 800}
            height={product.image.height ?? 800}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className={styles.cardBadges}>
          <ProductBadges product={product} />
        </div>
      </div>
      <div className={styles.featuredBody}>
        <p className={styles.cardBrand}>{resolveLocalized(product.brand.name, locale)}</p>
        <Heading className={styles.featuredTitle}>
          <LocaleLink className={styles.cardLink} to={productHref(product)}>
            <BidiText text={resolveLocalized(product.name, locale)} />
          </LocaleLink>
        </Heading>
        {product.subtitle && (
          <p className={styles.featuredSubtitle}>{resolveLocalized(product.subtitle, locale)}</p>
        )}
        <Price
          min={product.price.min}
          max={product.price.max}
          compareAt={product.price.compareAt}
        />
        <StockStatus state={product.stockState} availability={product.availabilityState} />
        <span className={styles.featuredCta} aria-hidden="true">
          {ctaLabel}
          <ArrowRight className="flip-rtl" />
        </span>
      </div>
    </article>
  );
}
