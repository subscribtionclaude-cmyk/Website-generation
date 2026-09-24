import type { Offer, OfferKind } from './types';

export interface OfferFilter {
  kinds?: readonly OfferKind[];
  brands?: readonly string[];
  categories?: readonly string[];
}

/** Section-level offer filtering (kind / linked product brand / linked product category). */
export function filterOffers(offers: Offer[], filter: OfferFilter | null | undefined): Offer[] {
  if (!filter) return offers;
  return offers.filter((offer) => {
    if (filter.kinds?.length && !filter.kinds.includes(offer.kind)) return false;
    if (filter.brands?.length && !offer.products.some((p) => filter.brands?.includes(p.brand.slug)))
      return false;
    if (
      filter.categories?.length &&
      !offer.products.some((p) => p.categorySlugs.some((c) => filter.categories?.includes(c)))
    )
      return false;
    return true;
  });
}
