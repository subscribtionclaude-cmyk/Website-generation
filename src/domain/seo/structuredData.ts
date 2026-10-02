import type { ProductDetail, StockState } from '@/domain/catalog/types';
import type { ContentEntry, Offer } from '@/domain/content/types';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import type {
  BrandSettings,
  Branch,
  SocialSettings,
  StoreSettings,
} from '@/domain/settings/schemas';
import type { Locale } from '@/i18n/config';
import { localizePath } from '@/i18n/paths';

/**
 * schema.org JSON-LD builders — pure functions shared by the storefront (`usePageMeta`) and the
 * build-time prerenderer, so crawlers without JavaScript see the same structured data as the app.
 *
 * Rules: only public store data (never customer data); demo products / offers / news never
 * produce markup in live mode (`mode !== 'live' || isDemo` → null); prices only for purchasable,
 * priced variants; every URL absolute.
 */
export type JsonLd = Record<string, unknown>;
export type DataMode = 'demo' | 'live';

interface Ctx {
  origin: string;
  locale: Locale;
}

const AVAILABILITY: Record<StockState, string> = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
};

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function absoluteUrl(origin: string, path: string, locale: Locale) {
  return /^https?:/i.test(path) ? path : `${origin}${localizePath(path, locale)}`;
}

/** Absolute URL for an asset (images are not localized). */
export function assetUrl(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

const text = (value: LocalizedText | null | undefined, locale: Locale) =>
  value ? resolveLocalized(value, locale) || undefined : undefined;

/** Drop undefined / empty values so the output is clean and deterministic. */
function clean<T extends JsonLd>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(
      ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
    ),
  ) as T;
}

export function organizationJsonLd(
  { brand, social, store }: { brand: BrandSettings; social: SocialSettings; store: StoreSettings },
  { origin, locale }: Ctx,
): JsonLd {
  const phones = store.branches.flatMap((b) => b.phones);
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: brand.name,
    url: absoluteUrl(origin, '/', locale),
    logo: assetUrl(origin, brand.logo.src),
    slogan: text(brand.tagline, locale),
    sameAs: Object.values(social).filter((v): v is string => typeof v === 'string'),
    contactPoint: phones.length
      ? phones.map((telephone) => ({
          '@type': 'ContactPoint',
          telephone,
          contactType: 'customer service',
          areaServed: 'EG',
          availableLanguage: ['ar', 'en'],
        }))
      : undefined,
    email: store.email ?? undefined,
  });
}

/** One physical branch as a LocalBusiness (ElectronicsStore) with its real opening hours. */
export function storeJsonLd(branch: Branch, brand: BrandSettings, { origin, locale }: Ctx): JsonLd {
  return clean({
    '@context': 'https://schema.org',
    '@type': 'ElectronicsStore',
    '@id': `${origin}/#branch-${branch.id}`,
    name: `${brand.name} — ${resolveLocalized(branch.name, locale)}`,
    url: absoluteUrl(origin, '/contact', locale),
    image: assetUrl(origin, brand.logo.src),
    telephone: branch.phones[0],
    address: {
      '@type': 'PostalAddress',
      streetAddress: resolveLocalized(branch.address, locale),
      addressLocality: resolveLocalized(branch.city, locale),
      addressCountry: 'EG',
    },
    hasMap: branch.mapsUrl ?? undefined,
    parentOrganization: { '@id': `${origin}/#organization` },
    openingHoursSpecification: branch.openingHours.map((rule) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: rule.days.map((d) => `https://schema.org/${DAYS[d]}`),
      opens: rule.open,
      closes: rule.close,
    })),
  });
}

/** Site-wide search (the storefront's own /search route). */
export function websiteJsonLd(name: string, { origin, locale }: Ctx): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name,
    url: absoluteUrl(origin, '/', locale),
    inLanguage: locale === 'ar' ? 'ar-EG' : 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${absoluteUrl(origin, '/search', locale)}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

function variantName(product: ProductDetail, options: Record<string, string>, locale: Locale) {
  const labels = Object.values(options);
  const name = resolveLocalized(product.name, locale);
  return labels.length ? `${name} (${labels.join(', ')})` : name;
}

/**
 * Product markup with one Offer per priced variant (each with its own SKU, price and stock
 * availability, and a URL that selects the variant). Upcoming products carry no offer (no price
 * commitments).
 */
export function productJsonLd(
  product: ProductDetail,
  { origin, locale, mode }: Ctx & { mode: DataMode },
): JsonLd | null {
  if (mode !== 'live' || product.isDemo) return null;
  const url = absoluteUrl(origin, `/product/${product.slug}`, locale);
  const images = product.media
    .filter((m) => m.kind === 'image')
    .map((m) => assetUrl(origin, m.url))
    .slice(0, 6);
  const base = clean({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: resolveLocalized(product.name, locale),
    description: text(product.description, locale) ?? text(product.subtitle, locale),
    image: images,
    brand: { '@type': 'Brand', name: resolveLocalized(product.brand.name, locale) },
    url,
    model: product.model ?? undefined,
  });
  const priced = product.variants.filter((v) => v.price !== null);
  if (product.availabilityState !== 'available' || priced.length === 0) return base;
  return {
    ...base,
    offers: priced.map((v) => ({
      '@type': 'Offer',
      sku: v.sku,
      name: variantName(product, v.options, locale),
      price: v.price,
      priceCurrency: 'EGP',
      availability: AVAILABILITY[v.stockState],
      itemCondition: 'https://schema.org/NewCondition',
      url: Object.keys(v.options).length
        ? `${url}?${new URLSearchParams(v.options).toString()}`
        : url,
    })),
  };
}

/** A promotion page: an Offer over the included products (live, non-demo only). */
export function promotionJsonLd(
  offer: Offer,
  { origin, locale, mode }: Ctx & { mode: DataMode },
): JsonLd | null {
  if (mode !== 'live' || offer.isDemo) return null;
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: resolveLocalized(offer.title, locale),
    description: text(offer.description, locale) ?? text(offer.subtitle, locale),
    url: absoluteUrl(origin, `/offers/${offer.slug}`, locale),
    priceCurrency: 'EGP',
    validFrom: offer.startsAt ?? undefined,
    validThrough: offer.endsAt ?? undefined,
    itemOffered: offer.products
      .filter((p) => !p.isDemo)
      .map((p) => ({
        '@type': 'Product',
        name: resolveLocalized(p.name, locale),
        url: absoluteUrl(origin, `/product/${p.slug}`, locale),
      })),
  });
}

/** News / launches as NewsArticle (live, non-demo only). */
export function articleJsonLd(
  entry: ContentEntry,
  { origin, locale, mode, publisher }: Ctx & { mode: DataMode; publisher: BrandSettings },
): JsonLd | null {
  if (mode !== 'live' || entry.isDemo) return null;
  const url = absoluteUrl(origin, `/news/${entry.slug}`, locale);
  return clean({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: resolveLocalized(entry.title, locale).slice(0, 110),
    description: text(entry.excerpt, locale) ?? text(entry.subtitle, locale),
    datePublished: entry.publishAt,
    expires: entry.expiresAt ?? undefined,
    inLanguage: locale === 'ar' ? 'ar-EG' : 'en',
    url,
    mainEntityOfPage: url,
    image: entry.media?.kind === 'image' ? [assetUrl(origin, entry.media.url)] : undefined,
    publisher: {
      '@type': 'Organization',
      name: publisher.name,
      url: absoluteUrl(origin, '/', locale),
      logo: { '@type': 'ImageObject', url: assetUrl(origin, publisher.logo.src) },
    },
  });
}

export function breadcrumbJsonLd(
  crumbs: { label: string; href?: string }[],
  { origin, locale }: Ctx,
): JsonLd {
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

/** A listing page (category, brand, offers) as an ItemList of links. */
export function itemListJsonLd(
  name: string,
  items: { name: string; path: string }[],
  { origin, locale }: Ctx,
): JsonLd | null {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: items.slice(0, 50).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(origin, item.path, locale),
    })),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────
const REQUIRED: Record<string, string[]> = {
  Organization: ['name', 'url'],
  ElectronicsStore: ['name', 'address', 'url'],
  WebSite: ['name', 'url', 'potentialAction'],
  Product: ['name', 'url'],
  Offer: ['url'],
  BreadcrumbList: ['itemListElement'],
  ItemList: ['itemListElement'],
  NewsArticle: ['headline', 'datePublished', 'url', 'publisher'],
};
const URL_KEYS = new Set([
  'url',
  'item',
  'logo',
  'image',
  'mainEntityOfPage',
  'hasMap',
  'urlTemplate',
]);
/** Keys that would indicate private or internal data leaking into public markup. */
const FORBIDDEN_KEYS =
  /password|token|secret|customer|order|internal|note|cost|stock_?qty|quantity|isDemo/i;

/**
 * Structural checks run by unit tests and by the prerenderer (which fails the build on a problem):
 * context / type present, required properties per type, absolute http(s) URLs, no private keys,
 * no undefined / NaN values or blank required text, offers carry a price and currency.
 */
export function validateJsonLd(node: unknown, path = '$'): string[] {
  const problems: string[] = [];
  const visit = (value: unknown, at: string, top: boolean) => {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
      problems.push(`${at}: empty value`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${at}[${i}]`, false));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (top && obj['@context'] !== 'https://schema.org') problems.push(`${at}: missing @context`);
    const type = obj['@type'];
    if (top && typeof type !== 'string') problems.push(`${at}: missing @type`);
    if (typeof type === 'string') {
      for (const key of REQUIRED[type] ?? [])
        if (
          obj[key] === undefined ||
          (typeof obj[key] === 'string' && obj[key].trim() === '') ||
          (Array.isArray(obj[key]) && obj[key].length === 0)
        )
          problems.push(`${at}: ${type} needs ${key}`);
      if (type === 'Offer' && (obj.price !== undefined || at.includes('offers'))) {
        if (typeof obj.price !== 'number') problems.push(`${at}: offer price must be a number`);
        if (obj.priceCurrency !== 'EGP') problems.push(`${at}: offer needs priceCurrency`);
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.test(key)) problems.push(`${at}.${key}: private key in public markup`);
      if (URL_KEYS.has(key) && typeof child === 'string' && !/^https?:\/\//.test(child))
        problems.push(`${at}.${key}: URL must be absolute`);
      if (URL_KEYS.has(key) && Array.isArray(child))
        child.forEach((c, i) => {
          if (typeof c === 'string' && !/^https?:\/\//.test(c))
            problems.push(`${at}.${key}[${i}]: URL must be absolute`);
        });
      visit(child, `${at}.${key}`, false);
    }
  };
  visit(node, path, true);
  return problems;
}

/** `<script type="application/ld+json">` body; "<" is escaped so it can never close the tag. */
export function serializeJsonLd(nodes: JsonLd[]): string {
  return JSON.stringify(nodes.length === 1 ? nodes[0] : nodes).replace(/</g, '\\u003c');
}
