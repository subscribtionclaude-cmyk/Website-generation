import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';
import {
  AFTER_SALES_TYPES,
  SERVICE_KINDS,
  SERVICE_STATUSES,
  TAX_STATUSES,
  type AfterSalesItem,
  type CreateServiceResult,
  type ServiceActionResult,
  type ServiceEvent,
  type ServiceMediaItem,
  type ServiceOffer,
  type ServiceRequestDetail,
  type ServiceSummary,
  type StaffRef,
  type StaffServiceRequest,
  type StaffServiceSummary,
} from './types';

/** zod contracts for the service RPCs (validated at the repository boundary). */
const ts = z.string().min(1);
const money = z.coerce.number();
const allStatuses = [...new Set(Object.values(SERVICE_STATUSES).flat())] as [string, ...string[]];

const problemSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  field: z.string().optional(),
});

export const mediaItemSchema: z.ZodType<ServiceMediaItem> = z.object({
  id: z.string(),
  bucket: z.enum(['repairs', 'trade-in', 'after-sales', 'used-requests']),
  path: z.string(),
  mediaType: z.enum(['image', 'video']),
  mimeType: z.string().optional(),
  sizeBytes: z.coerce.number().optional(),
  label: z.string().nullable(),
  uploaderKind: z.enum(['customer', 'staff']).optional(),
  createdAt: z.string().optional(),
});

const targetSchema = z
  .object({
    variantId: z.string().optional(),
    productSlug: z.string().optional(),
    sku: z.string().optional(),
    name: localizedTextSchema.optional(),
    brand: z.union([localizedTextSchema, z.string()]).nullable().optional(),
    variantLabel: localizedTextSchema.nullable().optional(),
    image: z.string().nullable().optional(),
    price: money.nullable().optional(),
    isDemo: z.boolean().optional(),
    model: z.string().optional(),
    storage: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })
  .passthrough();

export const offerSchema: z.ZodType<ServiceOffer> = z.object({
  id: z.string(),
  kind: z.enum(['repair_estimate', 'repair_final', 'trade_in', 'used_proposal']),
  status: z.enum(['sent', 'accepted', 'declined', 'superseded', 'withdrawn']),
  amount: money.nullable(),
  deviceValue: money.nullable(),
  targetPrice: money.nullable(),
  difference: money.nullable(),
  target: targetSchema.nullable(),
  device: z
    .object({
      brand: z.string(),
      model: z.string(),
      storage: z.string().nullable(),
      color: z.string().nullable(),
      batteryHealth: z.number().nullable(),
      condition: z.string().nullable(),
      taxStatus: z.enum(TAX_STATUSES),
    })
    .nullable(),
  note: z.string().nullable(),
  inspectionNote: z.string().nullable(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
  createdAt: ts,
  respondedAt: z.string().nullable(),
  media: z.array(mediaItemSchema),
});

export const eventSchema: z.ZodType<ServiceEvent> = z.object({
  id: z.coerce.number(),
  type: z.enum([
    'created',
    'status',
    'note',
    'update',
    'info_requested',
    'customer_response',
    'offer',
    'offer_response',
    'assignment',
    'media',
  ]),
  status: z.string().nullable(),
  fromStatus: z.string().nullable(),
  message: z.string().nullable(),
  visibleToCustomer: z.boolean(),
  actorKind: z.enum(['customer', 'staff', 'system']),
  createdAt: ts,
  data: z.record(z.string(), z.unknown()),
});

const summaryShape = {
  id: z.string(),
  kind: z.enum(SERVICE_KINDS),
  number: z.string(),
  status: z.enum(allStatuses),
  title: localizedTextSchema,
  deviceCategory: z.string().nullable(),
  afterSalesType: z.enum(AFTER_SALES_TYPES).nullable(),
  awaitingCustomer: z.boolean(),
  openOffer: z.boolean(),
  createdAt: ts,
  updatedAt: ts,
  isDemo: z.boolean(),
};

export const summarySchema = z.object(summaryShape) as unknown as z.ZodType<ServiceSummary>;

const staffRefSchema: z.ZodType<StaffRef> = z.object({ id: z.string(), name: z.string() });

const detailShape = {
  ...summaryShape,
  contact: z.object({ name: z.string(), phone: z.string() }),
  preferredContact: z.enum(['whatsapp', 'phone']),
  handoff: z.enum(['store_visit', 'pickup_delivery']).nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  consultationRequired: z.boolean(),
  policyVersion: z.string().nullable(),
  closedAt: z.string().nullable(),
  locale: z.enum(['ar', 'en']),
  canCancel: z.boolean(),
  order: z
    .object({
      id: z.string(),
      number: z.string(),
      status: z.string(),
      createdAt: ts,
      item: z
        .object({
          id: z.string(),
          name: localizedTextSchema,
          variantLabel: localizedTextSchema.nullable(),
          sku: z.string(),
          image: z.string().nullable(),
          quantity: z.number(),
        })
        .nullable(),
    })
    .nullable(),
  target: targetSchema.nullable(),
  targetIsCatalog: z.boolean(),
  offers: z.array(offerSchema),
  media: z.array(mediaItemSchema),
  events: z.array(eventSchema),
};

export const detailSchema = z.object(detailShape) as unknown as z.ZodType<ServiceRequestDetail>;

export const staffDetailSchema = z.object({
  ...detailShape,
  customerId: z.string().nullable(),
  customerEmail: z.string().nullable(),
  assignedTo: staffRefSchema.nullable().optional().default(null),
}) as unknown as z.ZodType<StaffServiceRequest>;

export const staffSummarySchema = z.object({
  ...summaryShape,
  contactName: z.string(),
  contactPhone: z.string(),
  assignedTo: staffRefSchema.nullable(),
}) as unknown as z.ZodType<StaffServiceSummary>;

export const listSchema = z.object({ total: z.number(), items: z.array(summarySchema) });
export const staffListSchema = z.object({ total: z.number(), items: z.array(staffSummarySchema) });

export const createResultSchema: z.ZodType<CreateServiceResult> = z.union([
  z.object({
    ok: z.literal(true),
    duplicate: z.boolean().optional(),
    request: z.object({ id: z.string(), number: z.string(), status: z.string() }),
  }),
  problemSchema,
]);

export const actionResultSchema: z.ZodType<ServiceActionResult> = z.union([
  z.object({ ok: z.literal(true), request: detailSchema }),
  problemSchema,
]);

export const staffActionResultSchema: z.ZodType<ServiceActionResult<StaffServiceRequest>> = z.union(
  [z.object({ ok: z.literal(true), request: staffDetailSchema }), problemSchema],
);

export const afterSalesItemsSchema: z.ZodType<AfterSalesItem[]> = z.array(
  z.object({
    orderId: z.string(),
    orderNumber: z.string(),
    orderStatus: z.string(),
    orderDate: ts,
    itemId: z.string(),
    name: localizedTextSchema,
    variantLabel: localizedTextSchema.nullable(),
    sku: z.string(),
    image: z.string().nullable(),
    quantity: z.number(),
    isGift: z.boolean(),
    warranty: localizedTextSchema.nullable(),
    openRequests: z.array(z.object({ type: z.enum(AFTER_SALES_TYPES), number: z.string() })),
  }),
);

export const assigneesSchema = z.array(staffRefSchema);

// Kind-specific detail payloads (for rendering; tolerant of older rows).
export const repairDetailsSchema = z.object({
  diagnosis: z
    .object({
      component: z.string().nullable(),
      componentLabel: localizedTextSchema.nullable().optional(),
      symptom: z.string().nullable(),
      symptomLabel: localizedTextSchema.nullable().optional(),
      unsure: z.boolean(),
      usedViewer: z.string().nullable().optional(),
    })
    .optional(),
  description: z.string().optional(),
});

export const tradeInDetailsSchema = z.object({
  current: z
    .object({
      category: z.string().nullable().optional(),
      brand: z.string(),
      model: z.string(),
      storage: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      batteryHealth: z.number().nullable().optional(),
      taxPaid: z.string().optional(),
      openedBefore: z.string().optional(),
      repairedBefore: z.string().optional(),
      accessories: z.array(z.string()).optional(),
      conditions: z.array(z.string()).optional(),
      notes: z.string().nullable().optional(),
    })
    .optional(),
});

export const usedDetailsSchema = z.object({
  device: z
    .object({
      brand: z.string(),
      model: z.string(),
      storage: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      batteryPreference: z.string().optional(),
      taxPreference: z.string().optional(),
      budget: z.number().nullable().optional(),
      notes: z.string().nullable().optional(),
    })
    .optional(),
});

export const afterSalesDetailsSchema = z.object({
  reason: z.string().optional(),
  description: z.string().optional(),
});
