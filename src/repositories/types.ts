import type { ServiceMime } from '@/domain/services/media';
import type {
  AfterSalesItem,
  CreateServiceResult,
  MediaRef,
  ProposedDevice,
  ServiceActionResult,
  ServiceBucket,
  ServiceInputs,
  ServiceKind,
  ServiceListFilter,
  ServiceRequestDetail,
  ServiceSummary,
  StaffRef,
  StaffServiceFilter,
  StaffServiceRequest,
  StaffServiceSummary,
  TradeInOfferInput,
} from '@/domain/services/types';
import type { AccessProfile } from '@/domain/access/access';
import type {
  Brand,
  CatalogPage,
  CatalogQuery,
  Category,
  ProductDetail,
  ProductSummary,
} from '@/domain/catalog/types';
import type {
  AccountCart,
  CartItemInput,
  CreateOrderPayload,
  CreateOrderResult,
  Order,
  OrderStatus,
  OrderSummary,
  Quote,
  QuoteOptions,
  StaffActionResult,
  StaffOrder,
  StaffOrderFilter,
  StaffOrderSummary,
} from '@/domain/commerce/types';
import type { ContentEntry, ContentType, Offer, PageSection } from '@/domain/content/types';
import type {
  AbandonedCartList,
  ActionResult,
  Address,
  AddressInput,
  CartStatus,
  CustomerProfileInput,
  MyRequests,
  NotificationChannel,
  NotificationPage,
  NotificationPreference,
  OwnReview,
  PublicReviews,
  RecentEntry,
  Recommendations,
  RequestClaim,
  ReviewEligibility,
  ReviewInput,
  StaffReview,
  WishlistView,
} from '@/domain/customer/types';
import type { RoleDefinition } from '@/domain/access/permissions';
import type { SettingRecord } from '@/domain/settings/resolve';
import type { Locale } from '@/i18n/config';
import type { AdminRepository } from './adminTypes';

export type { AdminRepository, Page } from './adminTypes';

/**
 * Repository ports. UI and features depend only on these interfaces; the concrete adapter
 * (demo seed data or Supabase) is chosen once at boot from the explicit data mode.
 * A future backend (or an ERP/POS sync layer) implements the same ports.
 */
export interface SettingsRepository {
  /** Published values of public settings (drafts are never returned). */
  listPublishedSettings(): Promise<SettingRecord[]>;
}

export interface AccessRepository {
  /** Effective access of the signed-in user; null when signed out. */
  getMyAccess(): Promise<AccessProfile | null>;
  /** Role definitions with their permissions (staff only). */
  listRoles(): Promise<RoleDefinition[]>;
}

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  preferredLocale: Locale;
  adminLocale: Locale | null;
  createdAt?: string | null;
}

export interface ProfilePreferencesUpdate {
  preferredLocale?: Locale;
  adminLocale?: Locale;
}

export interface ProfileRepository {
  getMyProfile(): Promise<Profile | null>;
  updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void>;
  /** Name, Egyptian mobile (normalised like checkout) and preferred language. */
  updateMyProfile(input: CustomerProfileInput): Promise<ActionResult>;
}

/** Storefront catalog reads. Only published rows; exact stock quantities are never exposed. */
export interface CatalogRepository {
  listBrands(): Promise<Brand[]>;
  listCategories(): Promise<Category[]>;
  /** Server-side search/filter/sort/paginate (never loads the whole catalog into the browser). */
  search(query: CatalogQuery): Promise<CatalogPage>;
  getProduct(slug: string): Promise<ProductDetail | null>;
  /** Cards for known product ids (guest wishlist, recently viewed, compare). Hidden ids are skipped. */
  getProductsByIds(ids: string[]): Promise<ProductSummary[]>;
  /** Rule-based recommendations for a product page (manual relations first; aggregates only). */
  getRecommendations(slug: string): Promise<Recommendations | null>;
}

export interface EntryFilter {
  types?: ContentType[];
  featuredOnly?: boolean;
  limit?: number;
}

/** Published CMS content: page sections, active offers and content entries. */
export interface ContentRepository {
  listPageSections(pageKey: string): Promise<PageSection[]>;
  listOffers(): Promise<Offer[]>;
  getOffer(slug: string): Promise<Offer | null>;
  listEntries(filter?: EntryFilter): Promise<ContentEntry[]>;
  getEntry(slug: string): Promise<ContentEntry | null>;
}

export interface StockAlertRequest {
  productSlug: string;
  variantSku: string | null;
  name: string;
  phone: string;
  email: string | null;
  locale: Locale;
}

export interface WaitlistRequest {
  productSlug: string;
  name: string;
  phone: string;
  email: string | null;
  desiredStorage: string | null;
  desiredColor: string | null;
  locale: Locale;
}

export interface RequestResult {
  status: 'created' | 'duplicate';
  /** Returned for new requests; `claimToken` only for guests (to link the request after sign-in). */
  id?: string;
  claimToken?: string | null;
}

/**
 * Customer "notify me" / waitlist requests. Phase 02 persists requests; staff follow-up and
 * automatic notifications arrive in Phases 04/06.
 */
export interface CustomerRequestsRepository {
  requestStockAlert(request: StockAlertRequest): Promise<RequestResult>;
  joinWaitlist(request: WaitlistRequest): Promise<RequestResult>;
  /** The signed-in customer's own requests (refreshes their back-in-stock / waitlist state). */
  listMine(): Promise<MyRequests>;
  cancel(kind: 'notify' | 'waitlist', id: string): Promise<ActionResult>;
  /** Link guest requests from this browser (one-time tokens) or with the verified sign-in email. */
  claim(claims: RequestClaim[]): Promise<{ linked: number }>;
}

/** Saved addresses + cart state for the account area (owner only). */
export interface AccountRepository {
  listAddresses(): Promise<Address[]>;
  saveAddress(input: AddressInput): Promise<ActionResult & { address?: Address }>;
  deleteAddress(id: string): Promise<ActionResult>;
  getCartStatus(): Promise<CartStatus>;
}

export interface WishlistRepository {
  get(): Promise<WishlistView>;
  set(productId: string, variantId: string | null, saved: boolean): Promise<ActionResult>;
  /** Deterministic guest → account merge; safe to repeat (repeated or concurrent sign-ins). */
  merge(
    items: { productId: string; variantId: string | null; addedAt?: string }[],
  ): Promise<WishlistView>;
}

export interface RecentlyViewedRepository {
  track(productId: string, variantId: string | null): Promise<void>;
  merge(items: { productId: string; variantId: string | null; viewedAt: string }[]): Promise<void>;
  list(limit?: number): Promise<RecentEntry[]>;
  clear(): Promise<void>;
}

export interface NotificationsRepository {
  list(options?: {
    limit?: number;
    before?: string | null;
    unreadOnly?: boolean;
  }): Promise<NotificationPage>;
  unreadCount(): Promise<number>;
  markRead(id: string): Promise<number>;
  markAllRead(): Promise<number>;
  preferences(): Promise<NotificationPreference[]>;
  setPreference(
    category: string,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<ActionResult>;
}

export interface ReviewsRepository {
  listPublic(productSlug: string, limit?: number, offset?: number): Promise<PublicReviews | null>;
  myStatus(productSlug: string): Promise<ReviewEligibility>;
  submit(input: ReviewInput): Promise<ActionResult & { review?: OwnReview }>;
  deleteMine(id: string): Promise<ActionResult>;
  listMine(): Promise<OwnReview[]>;
  /** Stores a (compressed) review photo in the customer's own folder; returns its path. */
  uploadImage(file: Blob): Promise<string>;
  /** Displayable URLs for stored review photos (approved ones for the public, own ones for the author). */
  imageUrls(paths: string[]): Promise<Record<string, string>>;
}

/** Minimal staff tools for Phase 04 (full admin in Phase 06). Every call is permission-checked. */
export interface CustomerOperationsRepository {
  listReviews(
    status: 'pending' | 'approved' | 'rejected' | null,
  ): Promise<{ total: number; items: StaffReview[] }>;
  moderateReview(
    id: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): Promise<ActionResult>;
  listAbandonedCarts(): Promise<AbandonedCartList>;
}

/**
 * Customer commerce. Every amount is computed by the backend (RPCs / demo mirror); the browser sends
 * variant ids + quantities and, at checkout, the prices it displayed (to detect changes only).
 */
export interface CommerceRepository {
  /** Authoritative cart validation (works signed out). */
  quote(items: { variantId: string; quantity: number }[], options?: QuoteOptions): Promise<Quote>;
  getCart(): Promise<AccountCart>;
  /** Merge a browser cart into the account cart after sign-in (deterministic). */
  mergeCart(items: CartItemInput[]): Promise<AccountCart>;
  setCartItem(
    variantId: string,
    quantity: number,
    savedForLater: boolean,
    seenUnitPrice: number | null,
  ): Promise<AccountCart>;
  /** Atomic, idempotent order creation (reserves stock for the configured window). */
  createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult>;
  getMyOrder(orderNumber: string): Promise<Order | null>;
  listMyOrders(): Promise<OrderSummary[]>;
  cancelMyOrder(
    orderNumber: string,
    reason: string | null,
  ): Promise<{ ok: boolean; code?: string; order?: Order }>;
}

/** Staff order operations (permission-checked by the backend). Full Orders module: Phase 06. */
export interface OrderOperationsRepository {
  listOrders(filter?: StaffOrderFilter): Promise<{ total: number; items: StaffOrderSummary[] }>;
  getOrder(orderId: string): Promise<StaffOrder | null>;
  setStatus(orderId: string, status: OrderStatus, note: string | null): Promise<StaffActionResult>;
  cancel(orderId: string, reason: string): Promise<StaffActionResult>;
  setShipping(
    orderId: string,
    input: {
      fee: number | null;
      eta?: string | null;
      courier?: string | null;
      tracking?: string | null;
      note?: string | null;
    },
  ): Promise<StaffActionResult>;
  markPaymentVerification(orderId: string, note: string | null): Promise<StaffActionResult>;
  recordPayment(
    orderId: string,
    input: {
      amount: number;
      method: 'instapay' | 'cash';
      reference?: string | null;
      note?: string | null;
    },
  ): Promise<StaffActionResult>;
  review(
    orderId: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): Promise<StaffActionResult>;
  addNote(orderId: string, note: string): Promise<StaffActionResult>;
  releaseExpiredReservations(): Promise<number>;
}

/** Uploaded private service media (caller's own folder of the kind's bucket). */
export interface ServiceUpload {
  bucket: ServiceBucket;
  path: string;
  mime: ServiceMime;
  size: number;
}

/**
 * Phase 05 customer service requests (repairs, trade-in, used devices, after-sales). Validation,
 * ownership, numbering and money are enforced by the database; media is uploaded first and
 * attached by path.
 */
export interface ServiceRequestsRepository {
  create<K extends ServiceKind>(kind: K, input: ServiceInputs[K]): Promise<CreateServiceResult>;
  listMine(filter?: ServiceListFilter): Promise<{ total: number; items: ServiceSummary[] }>;
  getMine(number: string): Promise<ServiceRequestDetail | null>;
  cancel(number: string, reason?: string | null): Promise<ServiceActionResult>;
  respond(number: string, message: string | null, media?: MediaRef[]): Promise<ServiceActionResult>;
  respondOffer(
    offerId: string,
    decision: 'accept' | 'decline',
    note?: string | null,
  ): Promise<ServiceActionResult>;
  afterSalesItems(): Promise<AfterSalesItem[]>;
  upload(kind: ServiceKind, file: Blob, mime: ServiceMime): Promise<ServiceUpload>;
  /** Remove a file that was uploaded but not submitted (removed / replaced before submit). */
  discardUpload(upload: { bucket: ServiceBucket; path: string }): Promise<void>;
  /** Short-lived URLs keyed by "bucket/path" for media the caller may read. */
  mediaUrls(items: { bucket: ServiceBucket; path: string }[]): Promise<Record<string, string>>;
}

/** Minimal staff service workflow (Phase 05; full admin polish in Phase 06). */
export interface ServiceOperationsRepository {
  list(
    kind: ServiceKind,
    filter?: StaffServiceFilter,
  ): Promise<{ total: number; items: StaffServiceSummary[] }>;
  get(id: string): Promise<StaffServiceRequest | null>;
  assignees(kind: ServiceKind): Promise<StaffRef[]>;
  assign(id: string, staffId: string | null): Promise<ServiceActionResult<StaffServiceRequest>>;
  setStatus(
    id: string,
    status: string,
    note?: string | null,
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  addNote(
    id: string,
    message: string,
    visible: boolean,
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  requestInfo(id: string, message: string): Promise<ServiceActionResult<StaffServiceRequest>>;
  sendRepairQuote(
    id: string,
    kind: 'estimate' | 'final',
    amount: number,
    note?: string | null,
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  sendTradeInOffer(
    id: string,
    input: TradeInOfferInput,
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  sendUsedProposal(
    id: string,
    device: ProposedDevice,
    price: number,
    note?: string | null,
    media?: MediaRef[],
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  decideAfterSales(
    id: string,
    decision: 'approved' | 'rejected',
    note?: string | null,
  ): Promise<ServiceActionResult<StaffServiceRequest>>;
  uploadProposalPhoto(file: Blob, mime: ServiceMime): Promise<ServiceUpload>;
}

export interface Repositories {
  settings: SettingsRepository;
  access: AccessRepository;
  profiles: ProfileRepository;
  catalog: CatalogRepository;
  content: ContentRepository;
  requests: CustomerRequestsRepository;
  commerce: CommerceRepository;
  orders: OrderOperationsRepository;
  account: AccountRepository;
  wishlist: WishlistRepository;
  recent: RecentlyViewedRepository;
  notifications: NotificationsRepository;
  reviews: ReviewsRepository;
  customerOps: CustomerOperationsRepository;
  services: ServiceRequestsRepository;
  serviceOps: ServiceOperationsRepository;
  /** Phase 06 admin control center. */
  admin: AdminRepository;
}
