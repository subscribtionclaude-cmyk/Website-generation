import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';

/**
 * Phase 06 admin contracts. Every admin RPC response is parsed with these schemas at the adapter
 * boundary (supabase/migrations/20260929*_admin_*.sql ↔ src/domain/admin/demoAdmin.ts).
 */
const lt = localizedTextSchema;
const ltn = localizedTextSchema.nullable();
const money = z.coerce.number();
const moneyN = z.coerce.number().nullable();
const iso = z.string();
const isoN = z.string().nullable();

export const WARRANTY_KINDS = [
  'authorized_distributor',
  'store',
  'local',
  'none',
  'custom',
] as const;
export type WarrantyKind = (typeof WARRANTY_KINDS)[number];
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const AVAILABILITY_STATES = [
  'available',
  'coming_soon',
  'waitlist_only',
  'pre_order',
] as const;
export const STOCK_ADJUSTMENT_TYPES = [
  'addition',
  'reduction',
  'damage',
  'return',
  'correction',
] as const;
export type StockAdjustmentType = (typeof STOCK_ADJUSTMENT_TYPES)[number];
export const MOVEMENT_TYPES = [
  'sale',
  'cancellation_restock',
  'manual_adjustment',
  'restock',
  'addition',
  'reduction',
  'damage',
  'return',
  'correction',
  'import',
  'initial',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const RELATION_KINDS = ['accessory', 'similar', 'recommended', 'compatible'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const PRODUCT_STATE_ACTIONS = [
  'publish',
  'draft',
  'archive',
  'restore',
  'hide',
  'show',
] as const;
export type ProductStateAction = (typeof PRODUCT_STATE_ACTIONS)[number];
export const OFFER_KINDS = [
  'price_drop',
  'percentage',
  'fixed',
  'bundle',
  'free_gift',
  'buy_x_get_y',
  'limited_time',
  'flash',
  'promo_code',
] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];
export const ENTRY_TYPES = [
  'new_release',
  'coming_soon',
  'offer_update',
  'news',
  'campaign',
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const SERVICE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ServicePriority = (typeof SERVICE_PRIORITIES)[number];
export const SLA_STATES = [
  'on_track',
  'approaching',
  'overdue',
  'waiting_customer',
  'closed',
] as const;
export type SlaState = (typeof SLA_STATES)[number];
export const SERVICE_VIEWS = [
  'open',
  'new',
  'awaiting',
  'in_progress',
  'ready',
  'completed',
  'all',
] as const;
export type ServiceView = (typeof SERVICE_VIEWS)[number];
export const FOLLOW_UP_STATES = ['none', 'contacted', 'recovered', 'dismissed'] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];
export const AUDIT_MODULES = [
  'catalog',
  'orders',
  'services',
  'settings',
  'access',
  'content',
  'customers',
  'data',
  'other',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];
export const EXPORT_KINDS = [
  'products',
  'variants',
  'prices',
  'stock',
  'catalog',
  'orders',
  'customers',
  'repair',
  'trade_in',
  'used',
  'after_sales',
  'price_history',
  'stock_movements',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** `{ ok: false, code, field? }` business outcome shared by every admin write. */
export const adminProblemSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  field: z.string().optional(),
});
export type AdminProblem = z.infer<typeof adminProblemSchema>;
export const okSchema = z.object({ ok: z.literal(true) }).loose();
export const adminResultSchema = z.union([okSchema, adminProblemSchema]);
export type AdminResult<T extends object = object> = ({ ok: true } & T) | AdminProblem;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ total: z.coerce.number().int(), items: z.array(item) });

// ── Settings ────────────────────────────────────────────────────────────────
export const settingOverviewSchema = z.object({
  key: z.string(),
  scope: z.enum(['design', 'settings', 'content', 'security']),
  isPublic: z.boolean(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  published: z.record(z.string(), z.unknown()).nullable(),
  version: z.number().int().nullable(),
  publishedAt: isoN,
  publishedBy: z.string().nullable(),
  draft: z.record(z.string(), z.unknown()).nullable(),
  draftUpdatedAt: isoN,
  draftBaseVersion: z.number().int().nullable(),
  draftBy: z.string().nullable(),
});
export type SettingOverview = z.infer<typeof settingOverviewSchema>;
export const settingVersionSchema = z.object({
  version: z.number().int(),
  value: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  publishedAt: iso,
  publishedBy: z.string().nullable(),
});
export type SettingVersion = z.infer<typeof settingVersionSchema>;

// ── Audit ───────────────────────────────────────────────────────────────────
export const auditRowSchema = z.object({
  id: z.coerce.number(),
  occurredAt: iso,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  module: z.enum(AUDIT_MODULES),
  changedFields: z.array(z.string()).nullable(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;
export const auditDetailSchema = auditRowSchema.extend({
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  metadata: z.unknown().nullable(),
});
export type AuditDetail = z.infer<typeof auditDetailSchema>;
export interface AuditFilter {
  actor?: string | null;
  action?: string | null;
  module?: AuditModule | null;
  entityType?: string | null;
  entityId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

// ── Staff & roles ───────────────────────────────────────────────────────────
export const staffMemberSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  suspendedAt: isoN,
  suspensionReason: z.string().nullable(),
  lastActiveAt: isoN,
  createdAt: isoN,
  rank: z.number().int(),
  roles: z.array(z.object({ key: z.string(), name: lt, rank: z.number().int() })),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;
export const accountLookupSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    roles: z.array(z.string()),
  }),
]);
export type AccountLookup = z.infer<typeof accountLookupSchema>;
export const adminRoleSchema = z.object({
  key: z.string(),
  name: lt,
  description: ltn,
  rank: z.number().int(),
  grantsAll: z.boolean(),
  isSystem: z.boolean(),
  editable: z.boolean(),
  permissions: z.array(z.string()),
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string().nullable(),
      name: z.string().nullable(),
      suspended: z.boolean(),
    }),
  ),
});
export type AdminRole = z.infer<typeof adminRoleSchema>;

// ── Catalog ─────────────────────────────────────────────────────────────────
export const catalogLookupsSchema = z.object({
  brands: z.array(z.object({ id: z.string(), slug: z.string(), name: lt, isVisible: z.boolean() })),
  categories: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: lt,
      parentId: z.string().nullable(),
      isVisible: z.boolean(),
    }),
  ),
});
export type CatalogLookups = z.infer<typeof catalogLookupsSchema>;

export const productListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  model: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  isVisible: z.boolean(),
  isDemo: z.boolean(),
  isNew: z.boolean(),
  isFeatured: z.boolean(),
  availabilityState: z.enum(AVAILABILITY_STATES),
  updatedAt: iso,
  brand: z.object({ id: z.string(), name: lt }).nullable(),
  category: z.object({ id: z.string(), name: lt }).nullable(),
  image: z.string().nullable(),
  startingPrice: moneyN,
  variantCount: z.coerce.number().int(),
  stock: z.object({
    total: z.coerce.number().int(),
    available: z.coerce.number().int(),
    out: z.coerce.number().int(),
    low: z.coerce.number().int(),
  }),
  hasOffer: z.boolean(),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;
export interface ProductFilter {
  q?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  status?: ProductStatus | null;
  visibility?: 'visible' | 'hidden' | null;
  stock?: 'in_stock' | 'low' | 'out' | null;
  offer?: 'with' | 'without' | null;
  data?: 'demo' | 'live' | null;
  sort?: 'updated_desc' | 'name' | 'price_asc' | 'price_desc' | 'stock_asc';
  limit?: number;
  offset?: number;
}

export const optionValueSchema = z.object({
  key: z.string(),
  label: lt,
  swatchHex: z.string().nullable().optional().default(null),
});
export const productOptionSchema = z.object({
  key: z.string(),
  name: lt,
  values: z.array(optionValueSchema),
});
export const adminVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  price: moneyN,
  compareAtPrice: moneyN,
  stock: z.coerce.number().int(),
  reserved: z.coerce.number().int(),
  available: z.coerce.number().int(),
  lowStockThreshold: z.coerce.number().int(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  warranty: ltn,
  warrantyKind: z.enum(WARRANTY_KINDS).nullable(),
  updatedAt: iso,
  options: z.record(z.string(), z.string()),
  lastPriceChange: z
    .object({
      at: iso,
      reason: z.string().nullable(),
      source: z.string(),
      oldPrice: moneyN,
      by: z.string().nullable(),
    })
    .nullable(),
});
export type AdminVariant = z.infer<typeof adminVariantSchema>;
export const productMediaSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['image', 'video']),
  url: z.string(),
  posterUrl: z.string().nullable(),
  captionsUrl: z.string().nullable().optional().default(null),
  alt: ltn,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  isCover: z.boolean(),
  variantSku: z.string().nullable(),
  colorKey: z.string().nullable(),
});
export type ProductMedia = z.infer<typeof productMediaSchema>;
export const specItemSchema = z.object({
  key: z.string(),
  label: lt,
  value: lt,
  visible: z.boolean(),
});
export const specGroupSchema = z.object({
  key: z.string(),
  title: lt,
  items: z.array(specItemSchema),
});
export type SpecGroup = z.infer<typeof specGroupSchema>;
export const productRelationSchema = z.object({
  kind: z.enum(RELATION_KINDS),
  productId: z.string(),
  slug: z.string(),
  name: lt,
});
export type ProductRelation = z.infer<typeof productRelationSchema>;
export const adminProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  brandId: z.string(),
  model: z.string().nullable(),
  name: lt,
  subtitle: ltn,
  description: ltn,
  warranty: ltn,
  warrantyKind: z.enum(WARRANTY_KINDS).nullable(),
  availabilityState: z.enum(AVAILABILITY_STATES),
  status: z.enum(PRODUCT_STATUSES),
  isVisible: z.boolean(),
  isNew: z.boolean(),
  isFeatured: z.boolean(),
  releaseDate: isoN,
  keywords: z.string(),
  seoTitle: ltn,
  seoDescription: ltn,
  isDemo: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
  hasHistory: z.boolean(),
  categories: z.array(z.object({ id: z.string(), isPrimary: z.boolean() })),
  options: z.array(productOptionSchema),
  variants: z.array(adminVariantSchema),
  media: z.array(productMediaSchema),
  specGroups: z.array(specGroupSchema),
  relations: z.array(productRelationSchema),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

/** Save payload (what the product editor sends). */
export interface ProductVariantInput {
  id?: string;
  updatedAt?: string;
  sku: string;
  barcode: string | null;
  options: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  initialStock?: number;
  lowStockThreshold: number;
  isActive: boolean;
  isDefault: boolean;
  warranty: z.infer<typeof ltn>;
  warrantyKind: WarrantyKind | null;
}
export interface ProductInput {
  id?: string;
  expectedUpdatedAt?: string;
  slug: string;
  brandId: string;
  categoryIds: string[];
  primaryCategoryId: string | null;
  model: string | null;
  name: z.infer<typeof lt>;
  subtitle: z.infer<typeof ltn>;
  description: z.infer<typeof ltn>;
  warranty: z.infer<typeof ltn>;
  warrantyKind: WarrantyKind | null;
  availabilityState: (typeof AVAILABILITY_STATES)[number];
  status: ProductStatus;
  isVisible: boolean;
  isNew: boolean;
  isFeatured: boolean;
  releaseDate: string | null;
  keywords: string;
  seoTitle: z.infer<typeof ltn>;
  seoDescription: z.infer<typeof ltn>;
  options: z.infer<typeof productOptionSchema>[];
  variants: ProductVariantInput[];
  media: Omit<ProductMedia, 'id'>[];
  specGroups: SpecGroup[];
  relations: { kind: RelationKind; productId: string }[];
  priceReason: string | null;
  isDemo?: boolean;
}

export const saveResultSchema = z.union([
  z.object({ ok: z.literal(true), id: z.string(), updatedAt: iso }),
  adminProblemSchema,
]);
export type SaveResult = z.infer<typeof saveResultSchema>;
export const countResultSchema = z.union([
  z.object({ ok: z.literal(true), updated: z.coerce.number().int() }),
  adminProblemSchema,
]);
export type CountResult = z.infer<typeof countResultSchema>;

export const priceHistoryRowSchema = z.object({
  id: z.coerce.number(),
  createdAt: iso,
  variantId: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: lt,
  productSlug: z.string(),
  variantLabel: z.array(lt),
  oldPrice: moneyN,
  newPrice: moneyN,
  oldCompareAt: moneyN,
  newCompareAt: moneyN,
  reason: z.string().nullable(),
  source: z.enum(['admin', 'bulk', 'import', 'system']),
  actorName: z.string().nullable(),
  isDemo: z.boolean(),
});
export type PriceHistoryRow = z.infer<typeof priceHistoryRowSchema>;
export interface PriceHistoryFilter {
  q?: string | null;
  variantId?: string | null;
  productId?: string | null;
  actor?: string | null;
  source?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export const inventoryRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: lt,
  productSlug: z.string(),
  variantLabel: z.array(lt),
  quantity: z.coerce.number().int(),
  reserved: z.coerce.number().int(),
  available: z.coerce.number().int(),
  lowStockThreshold: z.coerce.number().int(),
  isActive: z.boolean(),
  state: z.enum(['in_stock', 'low', 'out', 'inactive']),
  lastMovementAt: isoN,
  backInStockAt: isoN,
  updatedAt: iso,
  isDemo: z.boolean(),
});
export type InventoryRow = z.infer<typeof inventoryRowSchema>;
export interface InventoryFilter {
  q?: string | null;
  view?: 'all' | 'low' | 'out' | 'back_in_stock';
  brandId?: string | null;
  categoryId?: string | null;
  limit?: number;
  offset?: number;
}
export const stockAdjustResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    before: z.coerce.number().int(),
    after: z.coerce.number().int(),
    reserved: z.coerce.number().int(),
    available: z.coerce.number().int(),
    updatedAt: iso,
  }),
  adminProblemSchema.extend({
    reserved: z.coerce.number().optional(),
    quantity: z.coerce.number().optional(),
  }),
]);
export type StockAdjustResult = z.infer<typeof stockAdjustResultSchema>;
export const movementRowSchema = z.object({
  id: z.coerce.number(),
  createdAt: iso,
  type: z.enum(MOVEMENT_TYPES),
  variantId: z.string(),
  sku: z.string(),
  productName: lt,
  variantLabel: z.array(lt),
  quantityBefore: z.coerce.number().int(),
  change: z.coerce.number().int(),
  quantityAfter: z.coerce.number().int(),
  reason: z.string().nullable(),
  orderNumber: z.string().nullable(),
  actorName: z.string().nullable(),
  isDemo: z.boolean(),
});
export type MovementRow = z.infer<typeof movementRowSchema>;
export interface MovementFilter {
  q?: string | null;
  variantId?: string | null;
  type?: MovementType | null;
  actor?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}
export interface BulkVariantPatch {
  priceMode?: 'set' | 'percent' | 'amount';
  priceValue?: number;
  compareAt?: 'keep' | 'clear' | 'previous';
  isActive?: boolean;
  lowStockThreshold?: number;
  warrantyKind?: WarrantyKind | null;
  warranty?: z.infer<typeof ltn>;
}

export const adminCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
  name: lt,
  description: ltn,
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sortOrder: z.coerce.number().int(),
  isVisible: z.boolean(),
  showInNav: z.boolean(),
  showOnHome: z.boolean(),
  showInShop: z.boolean(),
  showInCategoryGrid: z.boolean(),
  seoTitle: ltn,
  seoDescription: ltn,
  isDemo: z.boolean(),
  updatedAt: iso,
  productCount: z.coerce.number().int(),
  childCount: z.coerce.number().int(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export type CategoryInput = Omit<
  AdminCategory,
  'id' | 'isDemo' | 'updatedAt' | 'productCount' | 'childCount'
> & { id?: string; expectedUpdatedAt?: string };

export const adminBrandSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  description: ltn,
  logoUrl: z.string().nullable(),
  sortOrder: z.coerce.number().int(),
  isVisible: z.boolean(),
  isFeatured: z.boolean(),
  showOnApple: z.boolean(),
  seoTitle: ltn,
  seoDescription: ltn,
  isDemo: z.boolean(),
  updatedAt: iso,
  categoryIds: z.array(z.string()),
  productCount: z.coerce.number().int(),
});
export type AdminBrand = z.infer<typeof adminBrandSchema>;
export type BrandInput = Omit<AdminBrand, 'id' | 'isDemo' | 'updatedAt' | 'productCount'> & {
  id?: string;
  expectedUpdatedAt?: string;
};

// ── Customers ───────────────────────────────────────────────────────────────
const customerStats = {
  ordersCount: z.coerce.number().int(),
  lifetimeValue: money,
  lastOrderAt: isoN,
  openRequests: z.coerce.number().int(),
  wishlistCount: z.coerce.number().int(),
};
export const customerListItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  joinedAt: isoN,
  preferredLocale: z.string().nullable(),
  ...customerStats,
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;
export interface CustomerFilter {
  q?: string | null;
  sort?: 'joined_desc' | 'orders_desc' | 'value_desc' | 'last_order_desc';
  limit?: number;
  offset?: number;
}
export const customerNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  isPinned: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
  authorName: z.string().nullable(),
});
export type CustomerNote = z.infer<typeof customerNoteSchema>;
export const customerDetailSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  preferredLocale: z.string().nullable(),
  joinedAt: isoN,
  isStaff: z.boolean(),
  lastSignInAt: isoN,
  stats: z.object(customerStats),
  addresses: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      governorate: z.string(),
      area: z.string(),
      address: z.string(),
      notes: z.string().nullable(),
      phone: z.string().nullable(),
      isDefault: z.boolean(),
    }),
  ),
  orders: z
    .array(
      z.object({
        id: z.string(),
        orderNumber: z.string(),
        createdAt: iso,
        status: z.string(),
        paymentStatus: z.string(),
        total: money,
        isDemo: z.boolean(),
      }),
    )
    .nullable(),
  serviceRequests: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      number: z.string(),
      status: z.string(),
      title: lt,
      createdAt: iso,
      isDemo: z.boolean(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: z.string(),
      rating: z.number().int(),
      status: z.string(),
      createdAt: iso,
      product: z.object({ slug: z.string(), name: lt }).nullable(),
    }),
  ),
  notifications: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      title: lt,
      createdAt: iso,
      read: z.boolean(),
    }),
  ),
  notes: z.array(customerNoteSchema),
  activity: z.object({
    cartItems: z.coerce.number().int(),
    recentlyViewed: z.coerce.number().int(),
    followUp: z
      .object({ state: z.enum(FOLLOW_UP_STATES), note: z.string().nullable(), updatedAt: iso })
      .nullable(),
  }),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const abandonedCartRowSchema = z.object({
  customerId: z.string(),
  customerName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  itemCount: z.coerce.number().int(),
  lastActivity: iso,
  cartValue: money,
  followUp: z.enum(FOLLOW_UP_STATES),
  followUpNote: z.string().nullable(),
  followUpAt: isoN,
  reminded: z.boolean(),
  items: z.array(z.object({ sku: z.string(), name: lt, quantity: z.number().int() })),
});
export type AbandonedCartRow = z.infer<typeof abandonedCartRowSchema>;
export const abandonedCartPageSchema = pageSchema(abandonedCartRowSchema).extend({
  settings: z.object({
    enabled: z.boolean(),
    thresholdHours: z.coerce.number(),
    followUp: z.string(),
  }),
});
export interface AbandonedCartFilter {
  minHours?: number | null;
  minValue?: number | null;
  state?: FollowUpState | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

// ── Services (queue upgrade) ────────────────────────────────────────────────
export const adminServiceRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['repair', 'trade_in', 'used', 'after_sales']),
  number: z.string(),
  status: z.string(),
  title: lt,
  deviceCategory: z.string().nullable(),
  afterSalesType: z.string().nullable(),
  awaitingCustomer: z.boolean(),
  openOffer: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
  isDemo: z.boolean(),
  contactName: z.string(),
  contactPhone: z.string(),
  priority: z.enum(SERVICE_PRIORITIES),
  sla: z.enum(SLA_STATES),
  lastChangeAt: iso,
  ageHours: z.coerce.number().int(),
  budget: z.coerce.number().nullable().optional().default(null),
  batteryPreference: z.string().nullable().optional().default(null),
  taxPreference: z.string().nullable().optional().default(null),
  product: ltn.optional().default(null),
  assignedTo: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
});
export type AdminServiceRow = z.infer<typeof adminServiceRowSchema>;
export const adminServicePageSchema = z.object({
  ok: z.literal(true),
  total: z.coerce.number().int(),
  items: z.array(adminServiceRowSchema),
  counts: z.object({
    new: z.coerce.number().int(),
    awaiting: z.coerce.number().int(),
    in_progress: z.coerce.number().int(),
    ready: z.coerce.number().int(),
    completed: z.coerce.number().int(),
    overdue: z.coerce.number().int(),
    approaching: z.coerce.number().int(),
  }),
  sla: z.object({ warnHours: z.coerce.number(), overdueHours: z.coerce.number() }),
});
export type AdminServicePage = z.infer<typeof adminServicePageSchema>;
export interface AdminServiceFilter {
  view?: ServiceView;
  status?: string | null;
  q?: string | null;
  assigned?: 'me' | 'unassigned' | string | null;
  priority?: ServicePriority | null;
  sla?: SlaState | null;
  deviceCategory?: string | null;
  afterSalesType?: string | null;
  battery?: string | null;
  tax?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}
export const serviceContextSchema = z.object({
  priority: z.enum(SERVICE_PRIORITIES),
  sla: z.enum(SLA_STATES),
  slaHours: z.object({ warnHours: z.coerce.number(), overdueHours: z.coerce.number() }),
  lastChangeAt: iso,
  notifications: z.array(
    z.object({
      id: z.string(),
      templateKey: z.string().nullable(),
      title: lt,
      createdAt: iso,
      read: z.boolean(),
    }),
  ),
});
export type ServiceContext = z.infer<typeof serviceContextSchema>;

// ── Reviews / waitlists / notifications ─────────────────────────────────────
export const adminReviewSchema = z.object({
  id: z.string(),
  rating: z.number().int(),
  title: z.string().nullable(),
  body: z.string(),
  authorName: z.string(),
  verifiedBuyer: z.boolean(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: iso,
  imageUrl: z.string().nullable().optional().default(null),
  imagePath: z.string().nullable().optional().default(null),
  isDemo: z.boolean().optional().default(false),
  moderationNote: z.string().nullable(),
  moderatedAt: isoN,
  orderNumber: z.string().nullable(),
  eligible: z.boolean(),
  product: z.object({ slug: z.string(), name: lt }),
  history: z.array(
    z.object({
      at: iso,
      action: z.string(),
      status: z.string().nullable(),
      by: z.string().nullable(),
    }),
  ),
});
export type AdminReview = z.infer<typeof adminReviewSchema>;
export interface AdminReviewFilter {
  status?: 'pending' | 'approved' | 'rejected' | null;
  rating?: number | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}
export const waitlistRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['notify', 'waitlist']),
  productId: z.string(),
  productName: lt,
  productSlug: z.string(),
  sku: z.string().nullable(),
  variantLabel: z.array(lt).nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  hasAccount: z.boolean(),
  status: z.string(),
  createdAt: iso,
  notifiedAt: isoN,
  availableNow: z.boolean(),
  readiness: z.enum(['closed', 'ready_in_app', 'ready_contact', 'waiting']),
});
export type WaitlistRow = z.infer<typeof waitlistRowSchema>;
export interface WaitlistFilter {
  kind?: 'notify' | 'waitlist' | null;
  status?: string | null;
  readyOnly?: boolean;
  q?: string | null;
  limit?: number;
  offset?: number;
}
export const notificationTemplateSchema = z.object({
  key: z.string(),
  category: z.string(),
  title: lt,
  body: lt,
  isActive: z.boolean(),
  updatedAt: iso,
  sent30d: z.coerce.number().int(),
});
export type NotificationTemplateRow = z.infer<typeof notificationTemplateSchema>;
export const notificationAdminSchema = z.object({
  channels: z.record(z.string(), z.object({ enabled: z.boolean() }).loose()),
  templates: z.array(notificationTemplateSchema),
});
export type NotificationAdmin = z.infer<typeof notificationAdminSchema>;
export const recipientSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});
export type Recipient = z.infer<typeof recipientSchema>;

// ── Offers / entries / sections ─────────────────────────────────────────────
export const offerListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: z.enum(OFFER_KINDS),
  title: lt,
  promoCode: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  state: z.enum(['draft', 'published', 'archived', 'scheduled', 'expired', 'active']),
  startsAt: isoN,
  endsAt: isoN,
  featuredOnHome: z.boolean(),
  discountPercent: moneyN,
  discountAmount: moneyN,
  sortOrder: z.coerce.number().int(),
  isDemo: z.boolean(),
  updatedAt: iso,
  productCount: z.coerce.number().int(),
  redemptions: z.coerce.number().int(),
});
export type OfferListItem = z.infer<typeof offerListItemSchema>;
export const adminOfferSchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: z.enum(OFFER_KINDS),
  title: lt,
  subtitle: ltn,
  description: ltn,
  badge: lt,
  mediaKind: z.enum(['image', 'video']).nullable(),
  mediaUrl: z.string().nullable(),
  mediaAlt: ltn,
  ctaLabel: ltn,
  ctaHref: z.string().nullable(),
  discountPercent: moneyN,
  discountAmount: moneyN,
  bundlePrice: moneyN,
  promoCode: z.string().nullable(),
  minSubtotal: moneyN,
  maxRedemptions: z.number().int().nullable(),
  maxRedemptionsPerCustomer: z.number().int().nullable(),
  buyQuantity: z.number().int().nullable(),
  getQuantity: z.number().int().nullable(),
  startsAt: isoN,
  endsAt: isoN,
  showCountdown: z.boolean(),
  featuredOnHome: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  state: z.string(),
  sortOrder: z.coerce.number().int(),
  seoTitle: ltn,
  seoDescription: ltn,
  isDemo: z.boolean(),
  updatedAt: iso,
  redemptions: z.coerce.number().int(),
  products: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullable(),
      role: z.enum(['target', 'bundle_item', 'gift']),
      quantity: z.number().int(),
      name: lt,
      slug: z.string(),
    }),
  ),
  categoryIds: z.array(z.string()),
});
export type AdminOffer = z.infer<typeof adminOfferSchema>;
export type OfferInput = Omit<
  AdminOffer,
  'id' | 'state' | 'isDemo' | 'updatedAt' | 'redemptions' | 'products'
> & {
  id?: string;
  expectedUpdatedAt?: string;
  products: {
    productId: string;
    variantId: string | null;
    role: 'target' | 'bundle_item' | 'gift';
    quantity: number;
  }[];
};
export interface OfferFilter {
  q?: string | null;
  kind?: OfferKind | null;
  state?: string | null;
  promoOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const entryListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  type: z.enum(ENTRY_TYPES),
  title: lt,
  status: z.enum(PRODUCT_STATUSES),
  publishAt: iso,
  expiresAt: isoN,
  isFeatured: z.boolean(),
  mediaUrl: z.string().nullable(),
  isDemo: z.boolean(),
  updatedAt: iso,
  live: z.boolean(),
});
export type EntryListItem = z.infer<typeof entryListItemSchema>;
export const adminEntrySchema = z.object({
  id: z.string(),
  slug: z.string(),
  type: z.enum(ENTRY_TYPES),
  eyebrow: ltn,
  title: lt,
  subtitle: ltn,
  excerpt: ltn,
  body: ltn,
  mediaKind: z.enum(['image', 'video']).nullable(),
  mediaUrl: z.string().nullable(),
  mediaPosterUrl: z.string().nullable(),
  mediaAlt: ltn,
  ctaLabel: ltn,
  ctaHref: z.string().nullable(),
  secondaryCtaLabel: ltn,
  secondaryCtaHref: z.string().nullable(),
  state: z.enum(AVAILABILITY_STATES).nullable(),
  releaseDate: isoN,
  publishAt: iso,
  expiresAt: isoN,
  isFeatured: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  seoTitle: ltn,
  seoDescription: ltn,
  isDemo: z.boolean(),
  updatedAt: iso,
  products: z.array(z.object({ productId: z.string(), name: lt, slug: z.string() })),
});
export type AdminEntry = z.infer<typeof adminEntrySchema>;
export type EntryInput = Omit<AdminEntry, 'id' | 'isDemo' | 'updatedAt' | 'products'> & {
  id?: string;
  expectedUpdatedAt?: string;
  productIds: string[];
};
export interface EntryFilter {
  q?: string | null;
  type?: EntryType | null;
  status?: ProductStatus | null;
  limit?: number;
  offset?: number;
}

export const adminSectionSchema = z.object({
  id: z.string(),
  pageKey: z.string(),
  key: z.string(),
  type: z.string(),
  sortOrder: z.coerce.number().int(),
  isVisible: z.boolean(),
  props: z.record(z.string(), z.unknown()),
  updatedAt: iso,
  updatedBy: z.string().nullable(),
});
export type AdminSection = z.infer<typeof adminSectionSchema>;

// ── Dashboard & analytics ───────────────────────────────────────────────────
const n = z.coerce.number();
export const dashboardSchema = z.object({
  range: z.object({ from: iso, to: iso }),
  includeDemo: z.boolean(),
  orders: z
    .object({
      count: n,
      revenue: n,
      paid: n,
      averageOrderValue: n,
      cancelled: n,
      demoExcluded: n,
      pendingVerification: n,
      manualReview: n,
      open: n,
    })
    .nullable(),
  stock: z.object({ low: n, out: n }).nullable(),
  services: z.record(z.string(), z.object({ open: n, overdue: n, created: n })).nullable(),
  reviews: z.object({ pending: n }).nullable(),
  requests: z.object({ notify: n, waitlist: n }).nullable(),
  carts: z.object({ abandoned: n }).nullable(),
  activity: z
    .array(
      z.object({
        id: z.coerce.number(),
        occurredAt: iso,
        action: z.string(),
        entityType: z.string(),
        entityId: z.string().nullable(),
        module: z.enum(AUDIT_MODULES),
        actorName: z.string().nullable(),
      }),
    )
    .nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export const analyticsSchema = z.object({
  range: z.object({ from: iso, to: iso }),
  includeDemo: z.boolean(),
  totals: z.object({
    orders: n,
    revenue: n,
    paid: n,
    averageOrderValue: n,
    cancelled: n,
    itemsSold: n,
    customers: n,
    activeCarts: n,
    conversion: n.nullable(),
  }),
  byDay: z.array(z.object({ day: z.string(), orders: n, revenue: n })),
  byStatus: z.record(z.string(), n),
  byPayment: z.record(z.string(), n),
  bestSellers: z.array(
    z.object({ productId: z.string(), slug: z.string(), name: lt, quantity: n, revenue: n }),
  ),
  repeatCustomers: z.object({ customers: n, ofCustomers: n }),
  services: z.record(z.string(), z.object({ created: n, completed: n, open: n })),
  stock: z.object({ low: n, out: n }),
  abandonedCarts: n,
});
export type Analytics = z.infer<typeof analyticsSchema>;

// ── Data ────────────────────────────────────────────────────────────────────
export const exportResultSchema = z.object({
  kind: z.string(),
  generatedAt: iso,
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type ExportResult = z.infer<typeof exportResultSchema>;
export const IMPORT_ROW_ACTIONS = ['create_product', 'create_variant', 'update', 'error'] as const;
export const importRowSchema = z.object({
  rowNo: z.number().int(),
  action: z.enum(IMPORT_ROW_ACTIONS),
  data: z.record(z.string(), z.unknown()),
  errors: z.array(z.string()),
});
export type ImportRowResult = z.infer<typeof importRowSchema>;
export const importSummarySchema = z.object({
  total: n,
  createProduct: n,
  createVariant: n,
  update: n,
  errors: n,
  applied: n.optional(),
});
export const importPreviewSchema = z.union([
  z.object({
    ok: z.literal(true),
    jobId: z.string(),
    summary: importSummarySchema,
    rows: z.array(importRowSchema),
  }),
  adminProblemSchema,
]);
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export const importCommitSchema = z.union([
  z.object({ ok: z.literal(true), applied: n }),
  adminProblemSchema.extend({ message: z.string().optional() }),
]);
export type ImportCommit = z.infer<typeof importCommitSchema>;
export const importJobSchema = z.object({
  id: z.string(),
  fileName: z.string().nullable(),
  status: z.enum(['previewed', 'committed', 'failed', 'cancelled']),
  rowCount: n,
  summary: importSummarySchema.partial(),
  error: z.string().nullable(),
  createdAt: iso,
  committedAt: isoN,
  createdBy: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;
export const demoSummarySchema = z.array(
  z.object({ table: z.string(), rows: z.coerce.number().int() }).loose(),
);
export const assigneeSchema = z.object({ id: z.string(), name: z.string().nullable() });
export type Assignee = z.infer<typeof assigneeSchema>;
