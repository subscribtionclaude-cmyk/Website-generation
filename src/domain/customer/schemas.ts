import { z } from 'zod';
import {
  availabilityStateSchema,
  mediaItemSchema,
  productSummarySchema,
  stockStateSchema,
} from '@/domain/catalog/schemas';
import { localizedTextSchema } from '@/domain/localized';
import {
  ADDRESS_LABELS,
  NOTIFICATION_CATEGORIES,
  REQUEST_STATUSES,
  type AbandonedCartList,
  type ActionResult,
  type Address,
  type AppNotification,
  type CartStatus,
  type MyRequests,
  type NotificationPage,
  type NotificationPreference,
  type OwnReview,
  type PublicReviews,
  type RecentEntry,
  type Recommendations,
  type Review,
  type ReviewEligibility,
  type StaffReview,
  type WishlistView,
} from './types';

/** Zod contracts for the Phase 04 customer RPCs (Supabase adapter). */
const lt = localizedTextSchema;
const money = z.number().finite();
const ts = z.string().min(10);

export const actionResultSchema: z.ZodType<ActionResult> = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  field: z.string().optional(),
});

export const addressSchema: z.ZodType<Address> = z.object({
  id: z.string(),
  label: z.enum(ADDRESS_LABELS),
  governorate: z.string(),
  area: z.string(),
  address: z.string(),
  notes: z.string().nullable(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: ts,
  updatedAt: ts,
});

export const saveAddressResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  field: z.string().optional(),
  address: addressSchema.optional(),
});

export const profileResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  field: z.string().optional(),
});

const variantRefSchema = z.object({ sku: z.string(), label: lt.nullable() });

export const wishlistViewSchema: z.ZodType<WishlistView> = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      productId: z.string(),
      variantId: z.string().nullable(),
      addedAt: ts,
      referencePrice: money.nullable(),
      currentPrice: money.nullable(),
      product: productSummarySchema.nullable(),
      variant: variantRefSchema.nullable(),
    }),
  ),
  adjustments: z.array(z.object({ productId: z.string(), reason: z.string() })).optional(),
});

export const recentEntriesSchema: z.ZodType<RecentEntry[]> = z.array(
  z.object({
    productId: z.string(),
    variantId: z.string().nullable(),
    viewedAt: ts,
    product: productSummarySchema,
  }),
);

const requestProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  image: mediaItemSchema.nullable(),
  availabilityState: availabilityStateSchema,
  isDemo: z.boolean(),
  visible: z.boolean(),
});

export const myRequestsSchema: z.ZodType<MyRequests> = z.object({
  notify: z.array(
    z.object({
      id: z.string(),
      kind: z.literal('notify'),
      status: z.enum(REQUEST_STATUSES),
      createdAt: ts,
      availableAt: ts.nullable(),
      product: requestProductSchema,
      variant: variantRefSchema.nullable(),
      stockState: stockStateSchema.nullable(),
    }),
  ),
  waitlist: z.array(
    z.object({
      id: z.string(),
      kind: z.literal('waitlist'),
      status: z.enum(REQUEST_STATUSES),
      createdAt: ts,
      availableAt: ts.nullable(),
      desiredStorage: z.string().nullable(),
      desiredColor: z.string().nullable(),
      product: requestProductSchema,
    }),
  ),
});

export const requestResultSchema = z.object({
  status: z.enum(['created', 'duplicate']),
  id: z.string().optional(),
  claimToken: z.string().nullable().optional(),
});

export const notificationSchema: z.ZodType<AppNotification> = z.object({
  id: z.string(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  title: lt,
  body: lt,
  actionPath: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: ts.nullable(),
  createdAt: ts,
  isDemo: z.boolean(),
});

export const notificationPageSchema: z.ZodType<NotificationPage> = z.object({
  items: z.array(notificationSchema),
  hasMore: z.boolean(),
  unreadCount: z.number().int().min(0),
});

const channelStateSchema = z.object({ available: z.boolean(), enabled: z.boolean() });
export const notificationPreferencesSchema: z.ZodType<NotificationPreference[]> = z.array(
  z.object({
    category: z.enum([
      'order',
      'service',
      'back_in_stock',
      'waitlist',
      'price_drop',
      'review',
      'cart',
    ]),
    mandatory: z.boolean(),
    channels: z.object({
      in_app: channelStateSchema,
      email: channelStateSchema,
      whatsapp: channelStateSchema,
      sms: channelStateSchema,
    }),
  }),
);

export const cartStatusSchema: z.ZodType<CartStatus> = z.object({
  itemCount: z.number().int().min(0),
  lastActivity: ts.nullable(),
  abandoned: z.boolean(),
});

export const abandonedCartsSchema: z.ZodType<AbandonedCartList> = z.object({
  settings: z.object({
    enabled: z.boolean(),
    thresholdHours: z.number(),
    followUp: z.enum(['in_app', 'off']),
  }),
  total: z.number().int().min(0),
  items: z.array(
    z.object({
      customerId: z.string(),
      customerName: z.string().nullable(),
      email: z.string().nullable(),
      itemCount: z.number().int(),
      lastActivity: ts,
      reminded: z.boolean(),
      items: z.array(z.object({ sku: z.string(), name: lt, quantity: z.number().int() })),
    }),
  ),
});

export const reviewSchema: z.ZodType<Review> = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  authorName: z.string(),
  verifiedBuyer: z.boolean(),
  imagePath: z.string().nullable(),
  createdAt: ts,
  updatedAt: ts,
  isDemo: z.boolean(),
});

const reviewProductSchema = z.object({
  slug: z.string(),
  name: lt,
  image: mediaItemSchema.nullable().optional(),
});

export const ownReviewSchema: z.ZodType<OwnReview> = z
  .object({
    id: z.string(),
    rating: z.number().int().min(1).max(5),
    title: z.string().nullable(),
    body: z.string(),
    authorName: z.string(),
    verifiedBuyer: z.boolean(),
    imagePath: z.string().nullable(),
    createdAt: ts,
    updatedAt: ts,
    isDemo: z.boolean(),
    status: z.enum(['pending', 'approved', 'rejected']),
    productId: z.string(),
    product: reviewProductSchema.optional(),
  })
  .transform((r) => ({
    ...r,
    product: r.product ? { ...r.product, image: r.product.image ?? null } : undefined,
  }));

export const publicReviewsSchema: z.ZodType<PublicReviews> = z.object({
  summary: z.object({
    count: z.number().int().min(0),
    average: z.number().nullable(),
    distribution: z.object({
      '1': z.number().int(),
      '2': z.number().int(),
      '3': z.number().int(),
      '4': z.number().int(),
      '5': z.number().int(),
    }),
  }),
  items: z.array(reviewSchema),
});

export const reviewEligibilitySchema: z.ZodType<ReviewEligibility> = z.object({
  eligible: z.boolean(),
  reason: z.enum(['sign_in', 'no_purchase', 'not_delivered', 'disabled', 'not_found']).nullable(),
  review: ownReviewSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  allowImages: z.boolean().optional(),
});

export const submitReviewResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  field: z.string().optional(),
  review: ownReviewSchema.optional(),
});

export const staffReviewsSchema: z.ZodType<{ total: number; items: StaffReview[] }> = z.object({
  total: z.number().int().min(0),
  items: z.array(
    z
      .object({
        id: z.string(),
        rating: z.number().int(),
        title: z.string().nullable(),
        body: z.string(),
        authorName: z.string(),
        verifiedBuyer: z.boolean(),
        imagePath: z.string().nullable(),
        createdAt: ts,
        updatedAt: ts,
        isDemo: z.boolean(),
        status: z.enum(['pending', 'approved', 'rejected']),
        productId: z.string(),
        moderationNote: z.string().nullable(),
        moderatedAt: ts.nullable(),
        orderNumber: z.string().nullable(),
        product: reviewProductSchema,
      })
      .transform((r) => ({ ...r, product: { ...r.product, image: r.product.image ?? null } })),
  ),
});

export const recommendationsSchema: z.ZodType<Recommendations> = z.object({
  related: z.array(productSummarySchema),
  accessories: z.array(productSummarySchema),
  compatible: z.array(productSummarySchema),
  boughtTogether: z.array(productSummarySchema),
  youMayAlsoLike: z.array(productSummarySchema),
});
