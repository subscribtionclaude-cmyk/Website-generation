import type { LocalizedText } from '@/domain/localized';

/**
 * Storefront catalog model. The same shapes are produced by the demo adapter (in-memory) and the
 * Supabase adapter (`catalog_*` RPCs) and validated by the zod schemas in ./schemas.ts.
 *
 * Product → Options (e.g. storage, color) → Option values
 * Product → Variants, each variant = one exact combination of option values with its own
 *           price, old price, SKU, stock state, media and warranty.
 */

/** Commercial state of a product line, independent from per-variant stock. */
export type AvailabilityState = 'available' | 'coming_soon' | 'waitlist_only' | 'pre_order';
/** Per-variant stock state. Exact quantities are never sent to the storefront. */
export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface BrandRef {
  slug: string;
  name: LocalizedText;
}

export interface Brand extends BrandRef {
  id: string;
  description: LocalizedText | null;
  logoUrl: string | null;
  sortOrder: number;
  categorySlugs: string[];
  productCount: number;
  isDemo: boolean;
}

export interface CategoryRef {
  slug: string;
  name: LocalizedText;
}

export interface Category extends CategoryRef {
  id: string;
  parentSlug: string | null;
  description: LocalizedText | null;
  icon: string | null;
  imageUrl: string | null;
  sortOrder: number;
  showInNav: boolean;
  showOnHome: boolean;
  showInShop: boolean;
  /** Appears in the "Shop by category" grid. */
  showInCategoryGrid: boolean;
  productCount: number;
  isDemo: boolean;
}

export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  url: string;
  posterUrl: string | null;
  /** WebVTT captions for video media. */
  captionsUrl: string | null;
  alt: LocalizedText;
  width: number | null;
  height: number | null;
  /** Colour option value this media belongs to (null = shared by all colours). */
  colorKey: string | null;
  isCover: boolean;
}

export interface OptionValue {
  key: string;
  label: LocalizedText;
  /** Swatch colour for colour options (#RRGGBB). */
  hex: string | null;
}

export interface ProductOption {
  key: string; // e.g. "storage", "color"
  name: LocalizedText;
  values: OptionValue[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  /** optionKey → valueKey, e.g. { storage: "512gb", color: "orange" }. */
  options: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  stockState: StockState;
  warranty: LocalizedText | null;
  isDefault: boolean;
}

export interface SpecItem {
  key: string;
  label: LocalizedText;
  value: LocalizedText;
}

export interface SpecGroup {
  key: string;
  title: LocalizedText;
  items: SpecItem[];
}

export interface OfferBadge {
  slug: string;
  kind: string;
  badge: LocalizedText;
  discountPercent: number | null;
  endsAt: string | null;
}

/** Card-level product data (lists, rails, search results). */
export interface ProductSummary {
  id: string;
  slug: string;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  model: string | null;
  brand: BrandRef;
  category: CategoryRef | null;
  categorySlugs: string[];
  availabilityState: AvailabilityState;
  stockState: StockState;
  isNew: boolean;
  isFeatured: boolean;
  releaseDate: string | null;
  /** Price range of the variants shown (respects an active price filter). */
  price: { min: number | null; max: number | null; compareAt: number | null };
  storages: { key: string; label: LocalizedText }[];
  colors: OptionValue[];
  image: MediaItem | null;
  offer: OfferBadge | null;
  isDemo: boolean;
}

export interface ProductDetail extends ProductSummary {
  description: LocalizedText | null;
  warranty: LocalizedText | null;
  options: ProductOption[];
  variants: ProductVariant[];
  media: MediaItem[];
  specGroups: SpecGroup[];
  relations: {
    accessories: ProductSummary[];
    similar: ProductSummary[];
    recommended: ProductSummary[];
  };
  seo: { title: LocalizedText | null; description: LocalizedText | null };
}

export type CatalogSort = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'best_selling';

export interface CatalogQuery {
  q?: string;
  brands?: string[];
  categories?: string[];
  minPrice?: number;
  maxPrice?: number;
  storage?: string[];
  colors?: string[];
  inStockOnly?: boolean;
  onOffer?: boolean;
  newOnly?: boolean;
  availability?: AvailabilityState[];
  featuredOnly?: boolean;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
}

export interface FacetOption {
  key: string;
  label: LocalizedText;
  count: number;
  hex?: string | null;
}

export interface CatalogFacets {
  brands: FacetOption[];
  categories: FacetOption[];
  storage: FacetOption[];
  colors: FacetOption[];
  price: { min: number | null; max: number | null };
}

export interface CatalogPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  facets: CatalogFacets;
}
