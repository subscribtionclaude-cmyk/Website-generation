import type { AvailabilityState, CatalogQuery, CatalogSort } from './types';

/**
 * URL <-> CatalogQuery codec. Filters live in the query string so results are shareable,
 * back-button friendly and crawl-safe (filtered URLs are canonicalised to the unfiltered page).
 *   /store?q=iphone&brand=apple,samsung&category=phones&min=20000&max=30000
 *          &storage=256gb&color=black&stock=1&offers=1&new=1&sort=price_asc&page=2
 */
const SORTS: CatalogSort[] = ['featured', 'newest', 'price_asc', 'price_desc', 'best_selling'];
const AVAILABILITY: AvailabilityState[] = [
  'available',
  'coming_soon',
  'waitlist_only',
  'pre_order',
];
const SLUG = /^[a-z0-9-]{1,60}$/;

const list = (value: string | null) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => SLUG.test(v))
    .slice(0, 20);

const money = (value: string | null) => {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n) : undefined;
};

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const query: CatalogQuery = {};
  const q = params.get('q')?.trim().slice(0, 80);
  if (q) query.q = q;
  const brands = list(params.get('brand'));
  if (brands.length) query.brands = brands;
  const categories = list(params.get('category'));
  if (categories.length) query.categories = categories;
  let min = money(params.get('min'));
  let max = money(params.get('max'));
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) query.minPrice = min;
  if (max !== undefined) query.maxPrice = max;
  const storage = list(params.get('storage'));
  if (storage.length) query.storage = storage;
  const colors = list(params.get('color'));
  if (colors.length) query.colors = colors;
  if (params.get('stock') === '1') query.inStockOnly = true;
  if (params.get('offers') === '1') query.onOffer = true;
  if (params.get('new') === '1') query.newOnly = true;
  const availability = list(params.get('availability')).map((a) =>
    a.replace(/-/g, '_'),
  ) as AvailabilityState[];
  const validAvailability = availability.filter((a) => AVAILABILITY.includes(a));
  if (validAvailability.length) query.availability = validAvailability;
  const sort = params.get('sort') as CatalogSort | null;
  if (sort && SORTS.includes(sort)) query.sort = sort;
  const page = Number(params.get('page'));
  if (Number.isInteger(page) && page > 1 && page < 1000) query.page = page;
  return query;
}

export function serializeCatalogQuery(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.brands?.length) params.set('brand', query.brands.join(','));
  if (query.categories?.length) params.set('category', query.categories.join(','));
  if (query.minPrice !== undefined) params.set('min', String(query.minPrice));
  if (query.maxPrice !== undefined) params.set('max', String(query.maxPrice));
  if (query.storage?.length) params.set('storage', query.storage.join(','));
  if (query.colors?.length) params.set('color', query.colors.join(','));
  if (query.inStockOnly) params.set('stock', '1');
  if (query.onOffer) params.set('offers', '1');
  if (query.newOnly) params.set('new', '1');
  if (query.availability?.length) params.set('availability', query.availability.join(','));
  if (query.sort && query.sort !== 'featured') params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return params;
}

/** Number of user-facing filters applied (search text and sort excluded). */
export function activeFilterCount(query: CatalogQuery): number {
  return (
    (query.brands?.length ?? 0) +
    (query.categories?.length ?? 0) +
    (query.minPrice !== undefined || query.maxPrice !== undefined ? 1 : 0) +
    (query.storage?.length ?? 0) +
    (query.colors?.length ?? 0) +
    (query.inStockOnly ? 1 : 0) +
    (query.onOffer ? 1 : 0) +
    (query.newOnly ? 1 : 0) +
    (query.availability?.length ?? 0)
  );
}
