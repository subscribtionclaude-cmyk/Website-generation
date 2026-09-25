import type {
  AvailabilityState,
  MediaItem,
  ProductSummary,
  StockState,
} from '@/domain/catalog/types';
import type { LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';

/**
 * Customer relationship model (Phase 04). The demo engine (demoCustomer.ts) and the Supabase RPCs
 * (20260927* migrations) produce the same shapes, validated by ./schemas.ts.
 */

export interface ActionResult {
  ok: boolean;
  code?: string;
  field?: string;
}

// ── Profile & addresses ─────────────────────────────────────────────────────
export interface CustomerProfileInput {
  fullName: string;
  phone: string;
  preferredLocale: Locale;
}

export const ADDRESS_LABELS = ['home', 'work', 'other'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

/** Same shape as the checkout delivery address (governorate / area / address / notes). */
export interface AddressFields {
  governorate: string;
  area: string;
  address: string;
  notes: string | null;
}

export interface Address extends AddressFields {
  id: string;
  label: AddressLabel;
  phone: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput extends AddressFields {
  id?: string;
  label: AddressLabel;
  phone: string | null;
  isDefault: boolean;
}

// ── Wishlist ────────────────────────────────────────────────────────────────
/** Guest wishlist entry kept in this browser. `variantId` only when the customer chose one. */
export interface LocalWishlistItem {
  productId: string;
  productSlug: string;
  variantId: string | null;
  addedAt: string;
}

export interface WishlistEntry {
  id: string;
  productId: string;
  variantId: string | null;
  addedAt: string;
  referencePrice: number | null;
  currentPrice: number | null;
  /** Null when the product is no longer published. */
  product: ProductSummary | null;
  variant: { sku: string; label: LocalizedText | null } | null;
}

export interface WishlistView {
  items: WishlistEntry[];
  adjustments?: { productId: string; reason: string }[];
}

// ── Recently viewed ─────────────────────────────────────────────────────────
export interface LocalRecentItem {
  productId: string;
  productSlug: string;
  variantId: string | null;
  viewedAt: string;
}

export interface RecentEntry {
  productId: string;
  variantId: string | null;
  viewedAt: string;
  product: ProductSummary;
}

// ── Compare (browser only) ──────────────────────────────────────────────────
export interface CompareItem {
  productId: string;
  productSlug: string;
  /** Top-level category used for the compatibility rule. */
  rootCategory: string | null;
  addedAt: string;
}

// ── Requests (notify me / waitlist) ─────────────────────────────────────────
export const REQUEST_STATUSES = [
  'active',
  'available',
  'notified',
  'converted',
  'cancelled',
  'expired',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestProduct {
  id: string;
  slug: string;
  name: LocalizedText;
  image: MediaItem | null;
  availabilityState: AvailabilityState;
  isDemo: boolean;
  visible: boolean;
}

export interface NotifyRequest {
  id: string;
  kind: 'notify';
  status: RequestStatus;
  createdAt: string;
  availableAt: string | null;
  product: RequestProduct;
  variant: { sku: string; label: LocalizedText | null } | null;
  stockState: StockState | null;
}

export interface WaitlistRequest {
  id: string;
  kind: 'waitlist';
  status: RequestStatus;
  createdAt: string;
  availableAt: string | null;
  desiredStorage: string | null;
  desiredColor: string | null;
  product: RequestProduct;
}

export interface MyRequests {
  notify: NotifyRequest[];
  waitlist: WaitlistRequest[];
}

/** One-time claim token handed to a guest browser so the request can be linked after sign-in. */
export interface RequestClaim {
  kind: 'notify' | 'waitlist';
  id: string;
  token: string;
}

// ── Notifications ───────────────────────────────────────────────────────────
export const NOTIFICATION_CATEGORIES = [
  'order',
  'service',
  'back_in_stock',
  'waitlist',
  'price_drop',
  'review',
  'cart',
  'account',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: LocalizedText;
  body: LocalizedText;
  actionPath: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  isDemo: boolean;
}

export interface NotificationPage {
  items: AppNotification[];
  hasMore: boolean;
  unreadCount: number;
}

export interface NotificationPreference {
  category: Exclude<NotificationCategory, 'account'>;
  mandatory: boolean;
  channels: Record<NotificationChannel, { available: boolean; enabled: boolean }>;
}

// ── Cart status (abandoned cart) ────────────────────────────────────────────
export interface CartStatus {
  itemCount: number;
  lastActivity: string | null;
  abandoned: boolean;
}

export interface AbandonedCartList {
  settings: { enabled: boolean; thresholdHours: number; followUp: 'in_app' | 'off' };
  total: number;
  items: AbandonedCartRow[];
}

export interface AbandonedCartRow {
  customerId: string;
  customerName: string | null;
  email: string | null;
  itemCount: number;
  lastActivity: string;
  reminded: boolean;
  items: { sku: string; name: LocalizedText; quantity: number }[];
}

// ── Reviews ─────────────────────────────────────────────────────────────────
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verifiedBuyer: boolean;
  imagePath: string | null;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface OwnReview extends Review {
  status: ReviewStatus;
  productId: string;
  product?: { slug: string; name: LocalizedText; image: MediaItem | null };
}

export interface PublicReviews {
  summary: {
    count: number;
    average: number | null;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  };
  items: Review[];
}

export type ReviewIneligibleReason =
  'sign_in' | 'no_purchase' | 'not_delivered' | 'disabled' | 'not_found';

export interface ReviewEligibility {
  eligible: boolean;
  reason: ReviewIneligibleReason | null;
  review: OwnReview | null;
  allowImages?: boolean;
}

export interface ReviewInput {
  productSlug: string;
  rating: number;
  title: string | null;
  body: string;
  imagePath: string | null;
}

export interface StaffReview extends OwnReview {
  moderationNote: string | null;
  moderatedAt: string | null;
  orderNumber: string | null;
  product: { slug: string; name: LocalizedText; image: MediaItem | null };
}

// ── Recommendations ─────────────────────────────────────────────────────────
export interface Recommendations {
  related: ProductSummary[];
  accessories: ProductSummary[];
  compatible: ProductSummary[];
  boughtTogether: ProductSummary[];
  youMayAlsoLike: ProductSummary[];
}
