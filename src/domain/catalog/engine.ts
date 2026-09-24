import type { ContentEntry, Offer } from '@/domain/content/types';
import { resolveDate, resolveTime, type RawCatalog, type RawProduct } from './raw';
import { normalizeSearchText, searchTokens } from './search';
import { bestStockState, stockStateFor } from './stock';
import type {
  Brand,
  CatalogFacets,
  CatalogPage,
  CatalogQuery,
  Category,
  FacetOption,
  MediaItem,
  OfferBadge,
  ProductDetail,
  ProductSummary,
  StockState,
} from './types';

/**
 * Reference implementation of the storefront catalog semantics, used by the demo adapter and unit
 * tests. The SQL RPCs (catalog_search, catalog_product …) implement the same rules:
 *   • a product matches variant-level filters (price, storage, colour, in-stock) if ONE variant
 *     satisfies all of them at once; cards then show that variant subset's price/colours/image;
 *   • category filters include sub-categories;
 *   • facets: brands ignore the brand filter, categories ignore the category filter, and
 *     storage/colour/price facets ignore variant-level filters (so options never disappear);
 *   • only offers inside their start/end window and entries inside their publish/expiry window count.
 */

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 48;

interface VariantRow {
  raw: RawProduct['variants'][number];
  stockState: StockState;
}

interface ProductRow {
  raw: RawProduct;
  releaseDate: string | null;
  variants: VariantRow[];
  categorySet: Set<string>;
  haystack: string;
}

export interface CatalogEngine {
  brands(): Brand[];
  categories(): Category[];
  search(query: CatalogQuery): CatalogPage;
  product(slug: string): ProductDetail | null;
  summaries(slugs: string[]): ProductSummary[];
  offers(): Offer[];
  offer(slug: string): Offer | null;
  entries(filter?: { types?: string[]; featuredOnly?: boolean; limit?: number }): ContentEntry[];
  entry(slug: string): ContentEntry | null;
}

export function createCatalogEngine(raw: RawCatalog, now: Date = new Date()): CatalogEngine {
  const nowMs = now.getTime();
  const brandBySlug = new Map(raw.brands.map((b) => [b.slug, b]));
  const categoryBySlug = new Map(raw.categories.map((c) => [c.slug, c]));

  const ancestors = (slug: string): string[] => {
    const chain: string[] = [];
    let current = categoryBySlug.get(slug);
    while (current) {
      chain.push(current.slug);
      current = current.parentSlug ? categoryBySlug.get(current.parentSlug) : undefined;
    }
    return chain;
  };

  const inWindow = (start: string | null, end: string | null) => {
    const s = resolveTime(start, now);
    const e = resolveTime(end, now);
    return (
      (s === null || new Date(s).getTime() <= nowMs) &&
      (e === null || new Date(e).getTime() > nowMs)
    );
  };

  const activeOffers = raw.offers
    .filter((o) => inWindow(o.startsAt, o.endsAt))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const offerBadgeFor = (slug: string): OfferBadge | null => {
    const offer = activeOffers.find((o) =>
      o.products.some((p) => p.slug === slug && p.role !== 'gift'),
    );
    if (!offer) return null;
    return {
      slug: offer.slug,
      kind: offer.kind,
      badge: offer.badge,
      discountPercent: offer.discountPercent,
      endsAt: resolveTime(offer.endsAt, now),
    };
  };

  const rows: ProductRow[] = raw.products.map((p) => {
    const brand = brandBySlug.get(p.brandSlug);
    const categorySet = new Set(p.categorySlugs.flatMap(ancestors));
    const categoryNames = [...categorySet].flatMap((slug) => {
      const c = categoryBySlug.get(slug);
      return c ? [c.name.ar, c.name.en ?? ''] : [];
    });
    return {
      raw: p,
      releaseDate: resolveDate(p.releaseDate, now),
      variants: p.variants.map((v) => ({
        raw: v,
        stockState: stockStateFor(v.stock, v.lowStockThreshold, v.isActive),
      })),
      categorySet,
      haystack: normalizeSearchText(
        [
          p.name.ar,
          p.name.en,
          p.model,
          p.subtitle?.ar,
          p.subtitle?.en,
          brand?.name.ar,
          brand?.name.en,
          p.keywords,
          ...categoryNames,
        ]
          .filter(Boolean)
          .join(' '),
      ),
    };
  });
  const rowBySlug = new Map(rows.map((r) => [r.raw.slug, r]));

  // ── Filters ─────────────────────────────────────────────
  const hasVariantFilters = (q: CatalogQuery) =>
    q.minPrice !== undefined ||
    q.maxPrice !== undefined ||
    Boolean(q.storage?.length) ||
    Boolean(q.colors?.length) ||
    Boolean(q.inStockOnly);

  const variantMatches = (v: VariantRow, q: CatalogQuery) => {
    const price = v.raw.price;
    if (q.minPrice !== undefined && (price === null || price < q.minPrice)) return false;
    if (q.maxPrice !== undefined && (price === null || price > q.maxPrice)) return false;
    if (q.storage?.length && !q.storage.includes(v.raw.options.storage ?? '')) return false;
    if (q.colors?.length && !q.colors.includes(v.raw.options.color ?? '')) return false;
    if (q.inStockOnly && v.stockState === 'out_of_stock') return false;
    return v.raw.isActive;
  };

  const matchingVariants = (row: ProductRow, q: CatalogQuery) =>
    row.variants.filter((v) => (hasVariantFilters(q) ? variantMatches(v, q) : v.raw.isActive));

  type Dimension = 'brands' | 'categories' | 'variant';
  const productMatches = (row: ProductRow, q: CatalogQuery, ignore: Dimension[] = []) => {
    const p = row.raw;
    const tokens = q.q ? searchTokens(q.q) : [];
    if (tokens.some((t) => !row.haystack.includes(t))) return false;
    if (!ignore.includes('brands') && q.brands?.length && !q.brands.includes(p.brandSlug))
      return false;
    if (
      !ignore.includes('categories') &&
      q.categories?.length &&
      !q.categories.some((c) => row.categorySet.has(c))
    )
      return false;
    if (q.newOnly && !p.isNew) return false;
    if (q.featuredOnly && !p.isFeatured) return false;
    if (q.availability?.length && !q.availability.includes(p.availabilityState)) return false;
    if (q.onOffer) {
      const dropped = row.variants.some(
        (v) =>
          v.raw.compareAtPrice !== null &&
          v.raw.price !== null &&
          v.raw.compareAtPrice > v.raw.price,
      );
      if (!dropped && !offerBadgeFor(p.slug)) return false;
    }
    if (
      !ignore.includes('variant') &&
      hasVariantFilters(q) &&
      matchingVariants(row, q).length === 0
    )
      return false;
    return true;
  };

  // ── Projections ─────────────────────────────────────────
  const brandRef = (slug: string) => {
    const b = brandBySlug.get(slug);
    return { slug, name: b?.name ?? { ar: slug } };
  };

  const media = (m: RawProduct['media'][number]): MediaItem => ({
    id: m.id,
    kind: m.kind,
    url: m.url,
    posterUrl: m.posterUrl,
    captionsUrl: m.captionsUrl,
    alt: m.alt,
    width: m.width,
    height: m.height,
    colorKey: m.colorKey,
    isCover: m.isCover,
  });

  const summarize = (row: ProductRow, q: CatalogQuery = {}): ProductSummary => {
    const p = row.raw;
    const variants = hasVariantFilters(q)
      ? matchingVariants(row, q)
      : row.variants.filter((v) => v.raw.isActive);
    const priced = variants.filter((v) => v.raw.price !== null);
    const cheapest = [...priced].sort((a, b) => (a.raw.price ?? 0) - (b.raw.price ?? 0))[0];
    const prices = priced.map((v) => v.raw.price as number);
    const optionValues = (key: string) => {
      const option = p.options.find((o) => o.key === key);
      if (!option) return [];
      const present = new Set(variants.map((v) => v.raw.options[key]));
      return option.values.filter((val) => present.has(val.key));
    };
    const colors = optionValues('color');
    const preferredColor = q.colors?.length
      ? colors.find((c) => q.colors?.includes(c.key))?.key
      : undefined;
    const sortedMedia = [...p.media].sort((a, b) => a.sortOrder - b.sortOrder);
    const cover =
      (preferredColor && sortedMedia.find((m) => m.colorKey === preferredColor)) ||
      sortedMedia.find((m) => m.isCover) ||
      sortedMedia[0];
    const primary = categoryBySlug.get(p.categorySlugs[0] ?? '');
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      subtitle: p.subtitle,
      model: p.model,
      brand: brandRef(p.brandSlug),
      category: primary ? { slug: primary.slug, name: primary.name } : null,
      categorySlugs: [...row.categorySet],
      availabilityState: p.availabilityState,
      stockState: bestStockState(variants.map((v) => v.stockState)),
      isNew: p.isNew,
      isFeatured: p.isFeatured,
      releaseDate: row.releaseDate,
      price: {
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
        compareAt:
          cheapest &&
          cheapest.raw.compareAtPrice !== null &&
          cheapest.raw.compareAtPrice > (cheapest.raw.price ?? 0)
            ? cheapest.raw.compareAtPrice
            : null,
      },
      storages: optionValues('storage').map((v) => ({ key: v.key, label: v.label })),
      colors,
      image: cover ? media(cover) : null,
      offer: offerBadgeFor(p.slug),
      isDemo: true,
    };
  };

  // ── Sorting & facets ────────────────────────────────────
  const sortRows = (
    items: { row: ProductRow; summary: ProductSummary }[],
    sort: CatalogQuery['sort'],
  ) => {
    const byName = (a: ProductRow, b: ProductRow) =>
      (a.raw.name.en ?? a.raw.name.ar).localeCompare(b.raw.name.en ?? b.raw.name.ar);
    const priceOf = (s: ProductSummary) => s.price.min;
    const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir;
    return [...items].sort((a, b) => {
      switch (sort) {
        case 'newest':
          return (
            (b.row.releaseDate ?? '').localeCompare(a.row.releaseDate ?? '') || byName(a.row, b.row)
          );
        case 'price_asc':
          return nullsLast(priceOf(a.summary), priceOf(b.summary), 1) || byName(a.row, b.row);
        case 'price_desc':
          return nullsLast(priceOf(a.summary), priceOf(b.summary), -1) || byName(a.row, b.row);
        case 'best_selling':
          return b.row.raw.bestSellerScore - a.row.raw.bestSellerScore || byName(a.row, b.row);
        default:
          return (
            Number(b.row.raw.isFeatured) - Number(a.row.raw.isFeatured) ||
            b.row.raw.bestSellerScore - a.row.raw.bestSellerScore ||
            byName(a.row, b.row)
          );
      }
    });
  };

  const countBy = (candidates: ProductRow[], valuesOf: (row: ProductRow) => string[]) => {
    const counts = new Map<string, number>();
    for (const row of candidates)
      for (const key of new Set(valuesOf(row))) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };

  const facets = (q: CatalogQuery): CatalogFacets => {
    const brandScope = rows.filter((r) => productMatches(r, q, ['brands', 'variant']));
    const categoryScope = rows.filter((r) => productMatches(r, q, ['categories', 'variant']));
    const scope = rows.filter((r) => productMatches(r, q, ['variant']));

    const brandCounts = countBy(brandScope, (r) => [r.raw.brandSlug]);
    const brands: FacetOption[] = [...raw.brands]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((b) => brandCounts.has(b.slug))
      .map((b) => ({ key: b.slug, label: b.name, count: brandCounts.get(b.slug) ?? 0 }));

    const categoryCounts = countBy(categoryScope, (r) => [...r.categorySet]);
    const categories: FacetOption[] = orderedCategories()
      .filter((c) => categoryCounts.has(c.slug))
      .map((c) => ({ key: c.slug, label: c.name, count: categoryCounts.get(c.slug) ?? 0 }));

    const optionFacet = (key: string): FacetOption[] => {
      const counts = countBy(scope, (r) =>
        r.variants
          .filter((v) => v.raw.isActive)
          .map((v) => v.raw.options[key] ?? '')
          .filter(Boolean),
      );
      const seen = new Map<string, FacetOption>();
      for (const row of scope) {
        for (const value of row.raw.options.find((o) => o.key === key)?.values ?? []) {
          if (counts.has(value.key) && !seen.has(value.key)) {
            seen.set(value.key, {
              key: value.key,
              label: value.label,
              count: counts.get(value.key) ?? 0,
              hex: value.hex,
            });
          }
        }
      }
      return [...seen.values()];
    };

    // Same ordering rule as app.storage_rank() in SQL: numeric size, TB = 1024 GB.
    const storageOrder = (key: string) =>
      (Number.parseFloat(key.replace(/[^0-9.]/g, '')) || 0) * (key.endsWith('tb') ? 1024 : 1);
    const prices = scope.flatMap((r) =>
      r.variants
        .filter((v) => v.raw.isActive && v.raw.price !== null)
        .map((v) => v.raw.price as number),
    );
    return {
      brands,
      categories,
      storage: optionFacet('storage').sort((a, b) => storageOrder(a.key) - storageOrder(b.key)),
      colors: optionFacet('color').sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      price: {
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
      },
    };
  };

  const orderedCategories = () => {
    const out: RawCatalog['categories'] = [];
    const roots = raw.categories
      .filter((c) => c.parentSlug === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const rootCat of roots) {
      out.push(rootCat);
      out.push(
        ...raw.categories
          .filter((c) => c.parentSlug === rootCat.slug)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
    }
    return out;
  };

  const summaries = (slugs: string[]) =>
    slugs.flatMap((slug) => {
      const row = rowBySlug.get(slug);
      return row ? [summarize(row)] : [];
    });

  const toOffer = (o: RawCatalog['offers'][number]): Offer => ({
    id: o.id,
    slug: o.slug,
    kind: o.kind as Offer['kind'],
    title: o.title,
    subtitle: o.subtitle,
    description: o.description,
    badge: o.badge,
    media: null,
    cta: o.cta,
    discountPercent: o.discountPercent,
    discountAmount: o.discountAmount,
    bundlePrice: o.bundlePrice,
    promoCode: o.promoCode,
    startsAt: resolveTime(o.startsAt, now),
    endsAt: resolveTime(o.endsAt, now),
    showCountdown: o.showCountdown,
    featuredOnHome: o.featuredOnHome,
    sortOrder: o.sortOrder,
    products: summaries(o.products.map((p) => p.slug)),
    productRoles: Object.fromEntries(o.products.map((p) => [p.slug, p.role])),
    isDemo: true,
  });

  const visibleEntries = () =>
    raw.entries
      .filter((e) => inWindow(e.publishAt, e.expiresAt))
      .map((e): ContentEntry => ({
        id: e.id,
        slug: e.slug,
        type: e.type,
        eyebrow: e.eyebrow,
        title: e.title,
        subtitle: e.subtitle,
        excerpt: e.excerpt,
        body: e.body,
        media: e.media,
        cta: e.cta,
        secondaryCta: e.secondaryCta,
        state: e.state,
        releaseDate: resolveDate(e.releaseDate, now),
        publishAt: resolveTime(e.publishAt, now) ?? now.toISOString(),
        expiresAt: resolveTime(e.expiresAt, now),
        isFeatured: e.isFeatured,
        products: summaries(e.products),
        seo: { title: null, description: null },
        isDemo: true,
      }))
      .sort((a, b) => b.publishAt.localeCompare(a.publishAt));

  return {
    brands: () =>
      [...raw.brands]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b) => {
          const own = rows.filter((r) => r.raw.brandSlug === b.slug);
          return {
            id: b.id,
            slug: b.slug,
            name: b.name,
            description: b.description,
            logoUrl: b.logoUrl,
            sortOrder: b.sortOrder,
            categorySlugs: orderedCategories()
              .map((c) => c.slug)
              .filter((slug) => own.some((r) => r.categorySet.has(slug))),
            productCount: own.length,
            isDemo: true,
          };
        }),
    categories: () =>
      orderedCategories().map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        parentSlug: c.parentSlug,
        description: c.description,
        icon: c.icon,
        imageUrl: c.imageUrl,
        sortOrder: c.sortOrder,
        showInNav: c.showInNav,
        showOnHome: c.showOnHome,
        showInShop: c.showInShop,
        showInCategoryGrid: c.showInCategoryGrid,
        productCount: rows.filter((r) => r.categorySet.has(c.slug)).length,
        isDemo: true,
      })),
    search: (query) => {
      const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const page = Math.max(query.page ?? 1, 1);
      const matched = rows
        .filter((r) => productMatches(r, query))
        .map((row) => ({ row, summary: summarize(row, query) }));
      const sorted = sortRows(matched, query.sort);
      return {
        items: sorted.slice((page - 1) * pageSize, page * pageSize).map((m) => m.summary),
        total: sorted.length,
        page,
        pageSize,
        facets: facets(query),
      };
    },
    product: (slug) => {
      const row = rowBySlug.get(slug);
      if (!row) return null;
      const p = row.raw;
      const activeVariants = row.variants.filter((v) => v.raw.isActive);
      const related = (kind: 'accessory' | 'similar' | 'recommended') =>
        summaries(
          p.relations
            .filter((r) => r.kind === kind)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((r) => r.slug),
        );
      return {
        ...summarize(row),
        description: p.description,
        warranty: p.warranty,
        options: p.options
          .map((o) => ({
            key: o.key,
            name: o.name,
            values: o.values.filter((val) =>
              activeVariants.some((v) => v.raw.options[o.key] === val.key),
            ),
          }))
          .filter((o) => o.values.length > 0),
        variants: activeVariants.map((v) => ({
          id: v.raw.id,
          sku: v.raw.sku,
          options: v.raw.options,
          price: v.raw.price,
          compareAtPrice: v.raw.compareAtPrice,
          stockState: v.stockState,
          warranty: v.raw.warranty,
          isDefault: v.raw.isDefault,
        })),
        media: [...p.media].sort((a, b) => a.sortOrder - b.sortOrder).map(media),
        specGroups: p.specGroups,
        relations: {
          accessories: related('accessory'),
          similar: related('similar'),
          recommended: related('recommended'),
        },
        seo: p.seo,
      };
    },
    summaries,
    offers: () => activeOffers.map(toOffer),
    offer: (slug) => {
      const o = activeOffers.find((x) => x.slug === slug);
      return o ? toOffer(o) : null;
    },
    entries: (filter = {}) => {
      let list = visibleEntries();
      if (filter.types?.length) list = list.filter((e) => filter.types?.includes(e.type));
      if (filter.featuredOnly) list = list.filter((e) => e.isFeatured);
      return filter.limit ? list.slice(0, filter.limit) : list;
    },
    entry: (slug) => visibleEntries().find((e) => e.slug === slug) ?? null,
  };
}
