import type { ProductDetail, StockState } from '@/domain/catalog/types';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';
import { localizePath } from '@/i18n/paths';

/**
 * schema.org JSON-LD contracts. Product markup is emitted only for real (non-demo) products in
 * live mode — demo prices must never reach search engines as offers.
 */
const AVAILABILITY: Record<StockState, string> = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
};

export function absoluteUrl(origin: string, path: string, locale: Locale) {
  return /^https?:/i.test(path) ? path : `${origin}${localizePath(path, locale)}`;
}

export function productJsonLd(
  product: ProductDetail,
  { origin, locale, mode }: { origin: string; locale: Locale; mode: 'demo' | 'live' },
): object | null {
  if (mode !== 'live' || product.isDemo) return null;
  const url = absoluteUrl(origin, `/product/${product.slug}`, locale);
  const text = (value: LocalizedText | null) =>
    value ? resolveLocalized(value, locale) : undefined;
  const priced = product.variants.filter((v) => v.price !== null);
  const images = product.media
    .filter((m) => m.kind === 'image')
    .map((m) => new URL(m.url, `${origin}/`).toString());
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: text(product.name),
    description: text(product.description) ?? text(product.subtitle),
    image: images.slice(0, 6),
    brand: { '@type': 'Brand', name: text(product.brand.name) },
    url,
  };
  if (product.model) base.model = product.model;
  // Upcoming products carry no purchasable offer (no price commitments before launch).
  if (product.availabilityState !== 'available' || priced.length === 0) return base;
  base.offers = priced.map((v) => ({
    '@type': 'Offer',
    sku: v.sku,
    price: v.price,
    priceCurrency: 'EGP',
    availability: AVAILABILITY[v.stockState],
    itemCondition: 'https://schema.org/NewCondition',
    url: `${url}?${new URLSearchParams(v.options).toString()}`,
  }));
  return base;
}

export function breadcrumbJsonLd(
  crumbs: { label: string; href?: string }[],
  { origin, locale }: { origin: string; locale: Locale },
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: absoluteUrl(origin, crumb.href, locale) } : {}),
    })),
  };
}
