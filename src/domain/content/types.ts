import type { AvailabilityState, ProductSummary } from '@/domain/catalog/types';
import type { LocalizedText } from '@/domain/localized';

export interface Cta {
  label: LocalizedText;
  href: string;
}

export interface ContentMedia {
  kind: 'image' | 'video';
  url: string;
  posterUrl: string | null;
  captionsUrl: string | null;
  alt: LocalizedText;
}

export const OFFER_KINDS = [
  'flash',
  'price_drop',
  'bundle',
  'free_gift',
  'promo_code',
  'limited_time',
  'percentage',
  'fixed',
  'buy_x_get_y',
] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export interface Offer {
  id: string;
  slug: string;
  kind: OfferKind;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  description: LocalizedText | null;
  badge: LocalizedText;
  media: ContentMedia | null;
  cta: Cta | null;
  discountPercent: number | null;
  discountAmount: number | null;
  bundlePrice: number | null;
  promoCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  showCountdown: boolean;
  featuredOnHome: boolean;
  sortOrder: number;
  products: ProductSummary[];
  /** Roles of linked products (e.g. gift items) keyed by product slug. */
  productRoles: Record<string, 'target' | 'bundle_item' | 'gift'>;
  isDemo: boolean;
}

export const CONTENT_TYPES = [
  'campaign',
  'new_release',
  'coming_soon',
  'offer_update',
  'news',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface ContentEntry {
  id: string;
  slug: string;
  type: ContentType;
  eyebrow: LocalizedText | null;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  excerpt: LocalizedText | null;
  /** Plain text; paragraphs separated by a blank line (never rendered as HTML). */
  body: LocalizedText | null;
  media: ContentMedia | null;
  cta: Cta | null;
  secondaryCta: Cta | null;
  state: AvailabilityState | null;
  releaseDate: string | null;
  publishAt: string;
  expiresAt: string | null;
  isFeatured: boolean;
  products: ProductSummary[];
  seo: { title: LocalizedText | null; description: LocalizedText | null };
  isDemo: boolean;
}

export interface PageSection {
  id: string;
  pageKey: string;
  type: string;
  sortOrder: number;
  isVisible: boolean;
  /** Validated per section type by the storefront section registry. */
  props: unknown;
}
