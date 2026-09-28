import type { Offer, OfferKind } from './types';

export interface OfferFilter {
  kinds?: readonly OfferKind[];
  brands?: readonly string[];
  categories?: readonly string[];
  /** Specific offers picked in the Site Editor (kept in the picked order). */
  slugs?: readonly string[];
}

/** Section-level offer filtering (picked offers, or kind / linked product brand / category). */
export function filterOffers(offers: Offer[], filter: OfferFilter | null | undefined): Offer[] {
  if (!filter) return offers;
  if (filter.slugs?.length) {
    const picked = filter.slugs;
    return picked.flatMap((slug) => offers.find((o) => o.slug === slug) ?? []);
  }
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
