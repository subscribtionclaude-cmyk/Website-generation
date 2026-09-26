import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROMO_REASONS,
  QUOTE_LINE_STATUSES,
} from './types';

/**
 * Zod contracts for commerce RPC responses (Supabase adapter). Numbers arrive as JSON numbers
 * from numeric(12,2); nothing unvalidated reaches the UI.
 */
const lt = localizedTextSchema;
const money = z.number().finite();

const offerSnapshotSchema = z.object({
  slug: z.string(),
  kind: z.string(),
  title: lt,
  badge: lt,
  discountPercent: money.nullable(),
  discountAmount: money.nullable(),
  endsAt: z.string().nullable(),
});

const lineDiscountSchema = z.object({
  source: z.enum(['bundle', 'promo']),
  offerSlug: z.string(),
  title: lt,
  amount: money,
  code: z.string().optional(),
  units: z.number().int().optional(),
});

const optionSnapshotSchema = z.object({
  key: z.string(),
  name: lt,
  valueKey: z.string(),
  valueLabel: lt,
});

export const quoteLineSchema = z.object({
  lineNo: z.number().int(),
  variantId: z.string(),
  productId: z.string().nullable().default(null),
  productSlug: z.string().nullable().default(null),
  sku: z.string().nullable().default(null),
  name: lt.nullable().default(null),
  brand: lt.nullable().default(null),
  variantLabel: lt.nullable().default(null),
  options: z.array(optionSnapshotSchema).default([]),
  image: z.string().nullable().default(null),
  warranty: lt.nullable().default(null),
  quantity: z.number().int(),
  status: z.enum(QUOTE_LINE_STATUSES),
  maxQuantity: z.number().int().nullable().default(null),
  stockState: z.enum(['in_stock', 'low_stock', 'out_of_stock']).nullable().default(null),
  regularUnitPrice: money.nullable().default(null),
  unitPrice: money.nullable().default(null),
  expectedUnitPrice: money.nullable().default(null),
  lineSubtotal: money.nullable().default(null),
  discount: money,
  discounts: z.array(lineDiscountSchema),
  lineTotal: money.nullable().default(null),
  offer: offerSnapshotSchema.nullable().default(null),
  isGift: z.boolean(),
  isDemo: z.boolean().default(false),
});

const promoSchema = z.union([
  z.object({
    code: z.string(),
    status: z.literal('invalid'),
    reason: z.enum(PROMO_REASONS),
    minSubtotal: money.optional(),
  }),
  z.object({
    code: z.string(),
    status: z.literal('applied'),
    offerSlug: z.string(),
    title: lt,
    discountPercent: money.nullable(),
    discountAmount: money.nullable(),
    discount: money,
  }),
]);

export const quoteSchema = z.object({
  currency: z.literal('EGP'),
  computedAt: z.string(),
  valid: z.boolean(),
  issues: z.array(z.string()),
  lines: z.array(quoteLineSchema),
  bundles: z.array(
    z.object({ offerSlug: z.string(), title: lt, sets: z.number().int(), discount: money }),
  ),
  giftNotes: z.array(
    z.object({ offerSlug: z.string(), title: lt, status: z.literal('unavailable') }),
  ),
  promo: promoSchema.nullable(),
  totals: z.object({
    originalSubtotal: money,
    subtotal: money,
    discountTotal: money,
    shippingFee: money.nullable(),
    shippingFeeStatus: z.enum(['pending', 'confirmed', 'not_required']),
    total: money,
  }),
});

export const accountCartSchema = z.object({
  items: z.array(
    z.object({
      variantId: z.string(),
      quantity: z.number().int().min(1),
      savedForLater: z.boolean(),
      seenUnitPrice: money.nullable(),
      addedAt: z.string(),
    }),
  ),
  adjustments: z
    .array(
      z.object({
        variantId: z.string(),
        reason: z.enum(['removed_missing', 'capped_max', 'capped_stock']),
        quantity: z.number().int().optional(),
      }),
    )
    .optional(),
});

const branchSnapshotSchema = z.object({
  id: z.string(),
  name: lt,
  address: lt,
  landmark: lt.nullable(),
  city: lt,
  phones: z.array(z.string()),
});

const orderEventSchema = z.object({
  type: z.enum(['status', 'payment', 'shipping', 'review', 'reservation', 'note', 'assignment']),
  status: z.string().nullable(),
  fromStatus: z.string().nullable(),
  createdAt: z.string(),
  data: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  actorKind: z.enum(['customer', 'staff', 'system']),
});

export const orderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  locale: z.enum(['ar', 'en']),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  customer: z.object({
    name: z.string(),
    phone: z.string(),
    phoneDisplay: z.string().nullable(),
    email: z.string().nullable(),
  }),
  fulfillment: z.object({
    method: z.enum(['delivery', 'pickup']),
    pickupBranch: branchSnapshotSchema.nullable(),
    governorate: z.string().nullable(),
    area: z.string().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    eta: z.string().nullable(),
    courier: z.string().nullable(),
    trackingNumber: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      lineNo: z.number().int(),
      productSlug: z.string(),
      productName: lt,
      brandName: lt.nullable(),
      variantLabel: lt.nullable(),
      options: z.array(optionSnapshotSchema),
      imageUrl: z.string().nullable(),
      sku: z.string(),
      warranty: lt.nullable(),
      regularUnitPrice: money,
      unitPrice: money,
      quantity: z.number().int(),
      lineSubtotal: money,
      discountAmount: money,
      lineTotal: money,
      appliedOffer: offerSnapshotSchema.nullable(),
      discounts: z.array(lineDiscountSchema),
      isGift: z.boolean(),
    }),
  ),
  totals: z.object({
    originalSubtotal: money,
    subtotal: money,
    discountTotal: money,
    shippingFee: money.nullable(),
    shippingFeeStatus: z.enum(['pending', 'confirmed', 'not_required']),
    total: money,
    paidAmount: money,
    remainingAmount: money,
    splitDepositAmount: money.nullable(),
  }),
  promoCode: z.string().nullable(),
  customerNote: z.string().nullable(),
  reservationExpiresAt: z.string().nullable(),
  stockCommitted: z.boolean(),
  reviewPending: z.boolean(),
  canCancel: z.boolean(),
  cancelledAt: z.string().nullable(),
  isDemo: z.boolean(),
  timeline: z.array(orderEventSchema),
});

export const staffOrderSchema = orderSchema.extend({
  customerId: z.string(),
  manualReview: z.object({
    required: z.boolean(),
    status: z.enum(['not_required', 'pending', 'approved', 'rejected']),
    reasons: z.array(z.string()),
    reviewedAt: z.string().nullable(),
    note: z.string().nullable(),
  }),
  staffNote: z.string().nullable(),
  assignedStaffId: z.string().nullable(),
  cancelReason: z.string().nullable(),
  payments: z.array(
    z.object({
      id: z.string(),
      method: z.enum(['instapay', 'cash']),
      kind: z.enum(['payment', 'deposit']),
      amount: money,
      reference: z.string().nullable(),
      note: z.string().nullable(),
      verifiedBy: z.string(),
      verifiedAt: z.string(),
    }),
  ),
  reservations: z.array(
    z.object({
      variantId: z.string(),
      quantity: z.number().int(),
      status: z.enum(['active', 'committed', 'released', 'expired']),
      expiresAt: z.string(),
    }),
  ),
});

export const orderSummarySchema = z.object({
  orderNumber: z.string(),
  createdAt: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fulfillmentMethod: z.enum(['delivery', 'pickup']),
  shippingFeeStatus: z.enum(['pending', 'confirmed', 'not_required']),
  total: money,
  remainingAmount: money,
  isDemo: z.boolean(),
  itemCount: z.number().int(),
  firstItem: z
    .object({ name: lt, variantLabel: lt.nullable(), imageUrl: z.string().nullable() })
    .nullable(),
});

export const staffOrderSummarySchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  createdAt: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fulfillmentMethod: z.enum(['delivery', 'pickup']),
  shippingFeeStatus: z.enum(['pending', 'confirmed', 'not_required']),
  total: money,
  paidAmount: money,
  remainingAmount: money,
  customerName: z.string(),
  customerPhone: z.string(),
  reviewPending: z.boolean(),
  reservationExpiresAt: z.string().nullable(),
  stockCommitted: z.boolean(),
  itemCount: z.number().int(),
  isDemo: z.boolean(),
  // Phase 06: assignment + customer link (optional so older fixtures still parse).
  assignedTo: z
    .object({ id: z.string(), name: z.string().nullable() })
    .nullable()
    .optional()
    .default(null),
  customerId: z.string().nullable().optional().default(null),
});

export const createOrderResultSchema = z.union([
  z.object({ ok: z.literal(true), duplicate: z.boolean(), order: orderSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'auth_required',
      'invalid_request',
      'invalid_name',
      'invalid_phone',
      'invalid_fulfillment',
      'invalid_address',
      'pickup_unavailable',
      'payment_method_unavailable',
      'invalid_deposit',
      'too_many_open_orders',
      'cart_empty',
      'cart_invalid',
      'promo_invalid',
      'price_changed',
    ]),
    field: z.string().optional(),
    quote: quoteSchema.optional(),
  }),
]);

export const staffActionResultSchema = z.union([
  z.object({ ok: z.literal(true), order: staffOrderSchema }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    order: staffOrderSchema.optional(),
    lines: z
      .array(z.object({ variantId: z.string(), sku: z.string(), quantity: z.number().int() }))
      .optional(),
  }),
]);
