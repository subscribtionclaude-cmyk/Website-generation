import type { Brand, Category, ProductDetail } from '@/domain/catalog/types';
import type { ContentEntry, Offer } from '@/domain/content/types';
import { resolveLocalized } from '@/domain/localized';
import type { Locale } from '@/i18n/config';

/**
 * Title / description / share image for catalog and content pages — used by the storefront pages
 * and by the build-time prerenderer, so both describe a page the same way. The page title then goes
 * through `resolveSeo` (template, fallbacks).
 */
export interface EntityMeta {
  title: string;
  description?: string;
  image?: string;
}

export function productMeta(product: ProductDetail, locale: Locale): EntityMeta {
  const name = resolveLocalized(product.name, locale);
  const description = product.seo.description
    ? resolveLocalized(product.seo.description, locale)
    : product.subtitle
      ? resolveLocalized(product.subtitle, locale)
      : undefined;
  return {
    title: product.seo.title ? resolveLocalized(product.seo.title, locale) : name,
    description,
    image: product.image?.url,
  };
}

export function entryMeta(entry: ContentEntry, locale: Locale): EntityMeta {
  return {
    title: entry.seo.title
      ? resolveLocalized(entry.seo.title, locale)
      : resolveLocalized(entry.title, locale),
    description: entry.seo.description
      ? resolveLocalized(entry.seo.description, locale)
      : entry.excerpt
        ? resolveLocalized(entry.excerpt, locale)
        : undefined,
    image: entry.media?.kind === 'image' ? entry.media.url : undefined,
  };
}

export function offerMeta(offer: Offer, locale: Locale): EntityMeta {
  return {
    title: resolveLocalized(offer.title, locale),
    description: offer.subtitle ? resolveLocalized(offer.subtitle, locale) : undefined,
    image: offer.products[0]?.image?.url,
  };
}

export function categoryMeta(category: Category, locale: Locale): EntityMeta {
  return {
    title: resolveLocalized(category.name, locale),
    description: category.description ? resolveLocalized(category.description, locale) : undefined,
  };
}

/** Brand pages use the dictionary's "{brand} products" title (passed in as `format`). */
export function brandMeta(
  brand: Brand,
  locale: Locale,
  format: (name: string) => string,
): EntityMeta {
  return {
    title: format(resolveLocalized(brand.name, locale)),
    description: brand.description ? resolveLocalized(brand.description, locale) : undefined,
  };
}
