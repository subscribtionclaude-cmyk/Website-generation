import type { ProductSummary } from '@/domain/catalog/types';
import type { ContentEntry, ContentType, Offer } from '@/domain/content/types';
import type { CoreMessageKey } from '@/i18n/context';

/** Locale-less storefront paths (LocaleLink adds the /en prefix when needed). */
export function productHref(product: Pick<ProductSummary, 'slug'>, query = '') {
  return `/product/${product.slug}${query ? `?${query}` : ''}`;
}

export function offerHref(offer: Pick<Offer, 'slug'>) {
  return `/offers/${offer.slug}`;
}

export function entryHref(entry: Pick<ContentEntry, 'slug'>) {
  return `/news/${entry.slug}`;
}

export function budgetHref(min: number | null, max: number | null) {
  const params = new URLSearchParams();
  if (min !== null && min > 0) params.set('min', String(min));
  if (max !== null) params.set('max', String(max));
  const query = params.toString();
  return `/budget${query ? `?${query}` : ''}`;
}

export const CONTENT_TYPE_LABEL: Record<ContentType, CoreMessageKey> = {
  campaign: 'content.typeCampaign',
  new_release: 'content.typeNewRelease',
  coming_soon: 'content.typeComingSoon',
  offer_update: 'content.typeOfferUpdate',
  news: 'content.typeNews',
};
