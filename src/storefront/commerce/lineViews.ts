import type { OrderItem, QuoteLine } from '@/domain/commerce/types';
import { resolveLocalized } from '@/domain/localized';

/** Normalise quote lines and order-item snapshots into the shape LineRow renders. */
export function quoteLineView(line: QuoteLine, locale: 'ar' | 'en') {
  return {
    name: line.name ? resolveLocalized(line.name, locale) : (line.sku ?? '—'),
    productSlug: line.productSlug,
    variantLabel: line.variantLabel ? resolveLocalized(line.variantLabel, locale) : null,
    sku: line.sku,
    image: line.image,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    regularUnitPrice: line.regularUnitPrice,
    lineTotal: line.status === 'ok' ? line.lineTotal : null,
    lineSubtotal: line.status === 'ok' ? line.lineSubtotal : null,
    discounts: line.discounts,
    isGift: line.isGift,
    offerLabel: line.offer ? resolveLocalized(line.offer.badge, locale) : null,
  };
}

export function orderItemView(item: OrderItem, locale: 'ar' | 'en') {
  return {
    name: resolveLocalized(item.productName, locale),
    productSlug: item.productSlug,
    variantLabel: item.variantLabel ? resolveLocalized(item.variantLabel, locale) : null,
    sku: item.sku,
    image: item.imageUrl,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    regularUnitPrice: item.regularUnitPrice,
    lineTotal: item.lineTotal,
    lineSubtotal: item.lineSubtotal,
    discounts: item.discounts,
    isGift: item.isGift,
    offerLabel: item.appliedOffer ? resolveLocalized(item.appliedOffer.badge, locale) : null,
  };
}
