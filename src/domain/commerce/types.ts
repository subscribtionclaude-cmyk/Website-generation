import type { StockState } from '@/domain/catalog/types';
import type { LocalizedText } from '@/domain/localized';

/**
 * Commerce contracts shared by the Supabase adapter (RPCs in 20260926100200/…300) and the demo
 * adapter (src/domain/commerce/demoCommerce.ts). The DATABASE is the price authority: the browser
 * only sends variant ids + quantities (and the prices it displayed, to detect changes).
 */

export const FULFILLMENT_METHODS = ['delivery', 'pickup'] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

export const PAYMENT_METHODS = ['cod', 'instapay', 'split', 'pay_at_store'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'cod_pending',
  'awaiting_payment',
  'awaiting_deposit',
  'verification_pending',
  'deposit_verified',
  'partially_paid',
  'paid',
  'pay_at_store',
  'void',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'new',
  'awaiting_whatsapp',
  'awaiting_payment',
  'payment_verification',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type ShippingFeeStatus = 'pending' | 'confirmed' | 'not_required';

export const QUOTE_LINE_STATUSES = [
  'ok',
  'unavailable',
  'not_purchasable',
  'max_quantity',
  'out_of_stock',
  'insufficient_stock',
] as const;
export type QuoteLineStatus = (typeof QUOTE_LINE_STATUSES)[number];

export const PROMO_REASONS = [
  'disabled',
  'not_found',
  'not_started',
  'expired',
  'limit_reached',
  'customer_limit',
  'not_applicable',
  'min_subtotal',
] as const;
export type PromoReason = (typeof PROMO_REASONS)[number];

export const MANUAL_REVIEW_REASONS = [
  'high_value',
  'multiple_expensive',
  'new_customer',
  'split_payment',
  'unfinished_orders',
  'order_velocity',
] as const;
export type ManualReviewReason = (typeof MANUAL_REVIEW_REASONS)[number];

// ── Cart ───────────────────────────────────────────────────────────────────
/** One cart line: exactly one variant. Prices are never stored as authoritative. */
export interface CartLine {
  variantId: string;
  /** For links back to the product page (display only). */
  productSlug: string | null;
  quantity: number;
  savedForLater: boolean;
  /** Unit price the customer last saw — used only to show "price updated". */
  seenUnitPrice: number | null;
  addedAt: string;
}

export interface CartItemInput {
  variantId: string;
  quantity: number;
  savedForLater?: boolean;
  seenUnitPrice?: number | null;
}

export interface AccountCartItem {
  variantId: string;
  quantity: number;
  savedForLater: boolean;
  seenUnitPrice: number | null;
  addedAt: string;
}

export interface CartMergeAdjustment {
  variantId: string;
  reason: 'removed_missing' | 'capped_max' | 'capped_stock';
  quantity?: number;
}

export interface AccountCart {
  items: AccountCartItem[];
  adjustments?: CartMergeAdjustment[];
}

// ── Quote ──────────────────────────────────────────────────────────────────
export interface OfferSnapshot {
  slug: string;
  kind: string;
  title: LocalizedText;
  badge: LocalizedText;
  discountPercent: number | null;
  discountAmount: number | null;
  endsAt: string | null;
}

export interface LineDiscount {
  source: 'bundle' | 'promo';
  offerSlug: string;
  title: LocalizedText;
  amount: number;
  code?: string;
  units?: number;
}

export interface VariantOptionSnapshot {
  key: string;
  name: LocalizedText;
  valueKey: string;
  valueLabel: LocalizedText;
}

export interface QuoteLine {
  lineNo: number;
  variantId: string;
  productId: string | null;
  productSlug: string | null;
  sku: string | null;
  name: LocalizedText | null;
  brand: LocalizedText | null;
  variantLabel: LocalizedText | null;
  options: VariantOptionSnapshot[];
  image: string | null;
  warranty: LocalizedText | null;
  quantity: number;
  status: QuoteLineStatus;
  /** Highest quantity that can be ordered right now (only when the requested one can't). */
  maxQuantity: number | null;
  stockState: StockState | null;
  regularUnitPrice: number | null;
  unitPrice: number | null;
  expectedUnitPrice: number | null;
  lineSubtotal: number | null;
  discount: number;
  discounts: LineDiscount[];
  lineTotal: number | null;
  offer: OfferSnapshot | null;
  isGift: boolean;
  isDemo: boolean;
}

export type PromoResult =
  | { code: string; status: 'invalid'; reason: PromoReason; minSubtotal?: number }
  | {
      code: string;
      status: 'applied';
      offerSlug: string;
      title: LocalizedText;
      discountPercent: number | null;
      discountAmount: number | null;
      discount: number;
    };

export interface QuoteTotals {
  originalSubtotal: number;
  subtotal: number;
  discountTotal: number;
  shippingFee: number | null;
  shippingFeeStatus: ShippingFeeStatus;
  total: number;
}

export interface Quote {
  currency: 'EGP';
  computedAt: string;
  valid: boolean;
  issues: string[];
  lines: QuoteLine[];
  bundles: { offerSlug: string; title: LocalizedText; sets: number; discount: number }[];
  giftNotes: { offerSlug: string; title: LocalizedText; status: 'unavailable' }[];
  promo: PromoResult | null;
  totals: QuoteTotals;
}

export interface QuoteOptions {
  promoCode?: string | null;
  fulfillment?: FulfillmentMethod | null;
}

// ── Checkout ───────────────────────────────────────────────────────────────
export interface DeliveryAddressInput {
  governorate: string;
  area: string;
  address: string;
  notes?: string | null;
}

export interface CreateOrderPayload {
  idempotencyKey: string;
  items: { variantId: string; quantity: number; expectedUnitPrice: number | null }[];
  expectedTotal: number;
  promoCode: string | null;
  contact: { name: string; phone: string };
  fulfillment:
    { method: 'pickup'; branchId: string | null } | ({ method: 'delivery' } & DeliveryAddressInput);
  payment: { method: PaymentMethod; depositAmount?: number | null };
  note: string | null;
  locale: 'ar' | 'en';
}

export type CreateOrderErrorCode =
  | 'auth_required'
  | 'invalid_request'
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_fulfillment'
  | 'invalid_address'
  | 'pickup_unavailable'
  | 'payment_method_unavailable'
  | 'invalid_deposit'
  | 'too_many_open_orders'
  | 'cart_empty'
  | 'cart_invalid'
  | 'promo_invalid'
  | 'price_changed';

export type CreateOrderResult =
  | { ok: true; duplicate: boolean; order: Order }
  | { ok: false; code: CreateOrderErrorCode; field?: string; quote?: Quote };

// ── Orders ─────────────────────────────────────────────────────────────────
export interface PickupBranchSnapshot {
  id: string;
  name: LocalizedText;
  address: LocalizedText;
  landmark: LocalizedText | null;
  city: LocalizedText;
  phones: string[];
}

export interface OrderItem {
  lineNo: number;
  productSlug: string;
  productName: LocalizedText;
  brandName: LocalizedText | null;
  variantLabel: LocalizedText | null;
  options: VariantOptionSnapshot[];
  imageUrl: string | null;
  sku: string;
  warranty: LocalizedText | null;
  regularUnitPrice: number;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  discountAmount: number;
  lineTotal: number;
  appliedOffer: OfferSnapshot | null;
  discounts: LineDiscount[];
  isGift: boolean;
}

export interface OrderTotals {
  originalSubtotal: number;
  subtotal: number;
  discountTotal: number;
  shippingFee: number | null;
  shippingFeeStatus: ShippingFeeStatus;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  splitDepositAmount: number | null;
}

export interface OrderEvent {
  type: 'status' | 'payment' | 'shipping' | 'review' | 'reservation' | 'note' | 'assignment';
  status: string | null;
  fromStatus: string | null;
  createdAt: string;
  data: Record<string, unknown>;
  note: string | null;
  actorKind: 'customer' | 'staff' | 'system';
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  updatedAt: string;
  locale: 'ar' | 'en';
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customer: { name: string; phone: string; phoneDisplay: string | null; email: string | null };
  fulfillment: {
    method: FulfillmentMethod;
    pickupBranch: PickupBranchSnapshot | null;
    governorate: string | null;
    area: string | null;
    address: string | null;
    notes: string | null;
    eta: string | null;
    courier: string | null;
    trackingNumber: string | null;
  };
  items: OrderItem[];
  totals: OrderTotals;
  promoCode: string | null;
  customerNote: string | null;
  reservationExpiresAt: string | null;
  stockCommitted: boolean;
  reviewPending: boolean;
  canCancel: boolean;
  cancelledAt: string | null;
  isDemo: boolean;
  timeline: OrderEvent[];
}

/** Staff view adds operational fields (never sent to customers). */
export interface StaffOrder extends Order {
  customerId: string;
  manualReview: {
    required: boolean;
    status: 'not_required' | 'pending' | 'approved' | 'rejected';
    reasons: string[];
    reviewedAt: string | null;
    note: string | null;
  };
  staffNote: string | null;
  assignedStaffId: string | null;
  cancelReason: string | null;
  payments: {
    id: string;
    method: 'instapay' | 'cash';
    kind: 'payment' | 'deposit';
    amount: number;
    reference: string | null;
    note: string | null;
    verifiedBy: string;
    verifiedAt: string;
  }[];
  reservations: {
    variantId: string;
    quantity: number;
    status: 'active' | 'committed' | 'released' | 'expired';
    expiresAt: string;
  }[];
}

export interface OrderSummary {
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentMethod: FulfillmentMethod;
  shippingFeeStatus: ShippingFeeStatus;
  total: number;
  remainingAmount: number;
  isDemo: boolean;
  itemCount: number;
  firstItem: {
    name: LocalizedText;
    variantLabel: LocalizedText | null;
    imageUrl: string | null;
  } | null;
}

export interface StaffOrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentMethod: FulfillmentMethod;
  shippingFeeStatus: ShippingFeeStatus;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  customerName: string;
  customerPhone: string;
  reviewPending: boolean;
  reservationExpiresAt: string | null;
  stockCommitted: boolean;
  itemCount: number;
  isDemo: boolean;
}

export interface StaffOrderFilter {
  status?: OrderStatus | null;
  paymentStatus?: PaymentStatus | null;
  reviewPending?: boolean;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export type StaffActionResult =
  | { ok: true; order: StaffOrder }
  | {
      ok: false;
      code: string;
      order?: StaffOrder;
      lines?: { variantId: string; sku: string; quantity: number }[];
    };
