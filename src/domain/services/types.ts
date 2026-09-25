import type { LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';

/** Service experiences (Phase 05). Mirrors supabase/migrations/20260928*_service*.sql. */
export const SERVICE_KINDS = ['repair', 'trade_in', 'used', 'after_sales'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_STATUSES = {
  repair: [
    'new',
    'under_review',
    'consultation_required',
    'device_received',
    'diagnosing',
    'quote_sent',
    'customer_approved',
    'repairing',
    'quality_check',
    'ready',
    'completed',
    'cancelled',
  ],
  trade_in: [
    'new',
    'under_review',
    'need_more_info',
    'inspection_required',
    'valuation_ready',
    'offer_sent',
    'customer_accepted',
    'customer_declined',
    'device_received',
    'completed',
    'rejected',
    'cancelled',
  ],
  used: [
    'new',
    'searching',
    'option_found',
    'offer_sent',
    'customer_interested',
    'reserved',
    'completed',
    'not_available',
    'cancelled',
  ],
  after_sales: [
    'new',
    'under_review',
    'approved',
    'rejected',
    'item_received',
    'inspection',
    'exchange_handling',
    'refund_handling',
    'warranty_handling',
    'completed',
    'cancelled',
  ],
} as const satisfies Record<ServiceKind, readonly string[]>;

export type ServiceStatus = (typeof SERVICE_STATUSES)[ServiceKind][number];

export const AFTER_SALES_TYPES = ['exchange', 'return', 'warranty'] as const;
export type AfterSalesType = (typeof AFTER_SALES_TYPES)[number];
export const AFTER_SALES_REASONS = [
  'defective',
  'damaged_on_arrival',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'warranty_issue',
  'other',
] as const;
export type AfterSalesReason = (typeof AFTER_SALES_REASONS)[number];

export const TRADE_IN_ACCESSORIES = ['box', 'charger', 'cable', 'accessories', 'receipt'] as const;
export type TradeInAccessory = (typeof TRADE_IN_ACCESSORIES)[number];
export const TRADE_IN_CONDITIONS = [
  'none',
  'scratches',
  'dents',
  'broken_glass',
  'display',
  'camera',
  'speaker',
  'battery',
  'opened',
  'repaired',
  'replaced_parts',
  'other',
] as const;
export type TradeInCondition = (typeof TRADE_IN_CONDITIONS)[number];
export const TRI_STATE = ['yes', 'no', 'unknown'] as const;
export type TriState = (typeof TRI_STATE)[number];

export const BATTERY_PREFERENCES = ['90_plus', '85_89', '80_84', 'none'] as const;
export type BatteryPreference = (typeof BATTERY_PREFERENCES)[number];
export const TAX_PREFERENCES = ['tax_paid', 'not_tax_paid', 'no_preference'] as const;
export type TaxPreference = (typeof TAX_PREFERENCES)[number];
export const TAX_STATUSES = ['tax_paid', 'not_tax_paid', 'unknown'] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

/** Photo guidance for trade-in / repair uploads (stored as the media label). */
export const PHOTO_LABELS = [
  'front',
  'back',
  'sides',
  'screen_on',
  'camera',
  'damage',
  'receipt',
  'other',
] as const;
export type PhotoLabel = (typeof PHOTO_LABELS)[number];

export type ServiceBucket = 'repairs' | 'trade-in' | 'after-sales' | 'used-requests';
export type PreferredContact = 'whatsapp' | 'phone';
export type Handoff = 'store_visit' | 'pickup_delivery';
export type DiagnosticViewer = '3d' | '2d' | 'list' | 'none';

// ── Inputs ──────────────────────────────────────────────────────────────────
export interface MediaRef {
  path: string;
  label?: string | null;
  width?: number | null;
  height?: number | null;
}

interface BaseInput {
  idempotencyKey: string;
  contact: { name: string; phone: string };
  preferredContact: PreferredContact;
  locale: Locale;
}

export interface RepairInput extends BaseInput {
  device: { category: string; brand: string; model: string };
  diagnosis: {
    component: string | null;
    symptom: string | null;
    unsure: boolean;
    viewer: DiagnosticViewer;
  };
  consultation: boolean;
  description: string;
  handoff: Handoff;
  media: MediaRef[];
}

export interface TradeInCurrentDevice {
  category: string | null;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  batteryHealth: number | null;
  taxPaid: TriState;
  openedBefore: TriState;
  repairedBefore: TriState;
  accessories: TradeInAccessory[];
  conditions: TradeInCondition[];
  notes: string | null;
}

export interface ManualTarget {
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
}

export type TradeInTarget = { variantId: string } | { manual: ManualTarget };

export interface TradeInInput extends BaseInput {
  current: TradeInCurrentDevice;
  target: TradeInTarget;
  media: MediaRef[];
}

export interface UsedDeviceRequest {
  category: string | null;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  batteryPreference: BatteryPreference;
  taxPreference: TaxPreference;
  budget: number | null;
  notes: string | null;
}

export interface UsedInput extends BaseInput {
  device: UsedDeviceRequest;
}

export interface AfterSalesInput extends BaseInput {
  orderItemId: string;
  type: AfterSalesType;
  reason: AfterSalesReason;
  description: string;
  policyVersion: string;
  policyAccepted: boolean;
  media: MediaRef[];
}

export interface ServiceInputs {
  repair: RepairInput;
  trade_in: TradeInInput;
  used: UsedInput;
  after_sales: AfterSalesInput;
}

export interface ServiceProblem {
  ok: false;
  code: string;
  field?: string;
}

export type CreateServiceResult =
  | { ok: true; duplicate?: boolean; request: { id: string; number: string; status: string } }
  | ServiceProblem;

// ── Views ───────────────────────────────────────────────────────────────────
export interface ServiceMediaItem {
  id: string;
  bucket: ServiceBucket;
  path: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  sizeBytes?: number;
  label: string | null;
  uploaderKind?: 'customer' | 'staff';
  createdAt?: string;
}

export type OfferKind = 'repair_estimate' | 'repair_final' | 'trade_in' | 'used_proposal';
export type OfferStatus = 'sent' | 'accepted' | 'declined' | 'superseded' | 'withdrawn';

export interface ProposedDevice {
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  batteryHealth: number | null;
  condition: string | null;
  taxStatus: TaxStatus;
}

export interface TargetSnapshot {
  variantId?: string;
  productSlug?: string;
  sku?: string;
  name?: LocalizedText;
  brand?: LocalizedText | string | null;
  variantLabel?: LocalizedText | null;
  image?: string | null;
  price?: number | null;
  isDemo?: boolean;
  // Manual targets.
  model?: string;
  storage?: string | null;
  color?: string | null;
}

export interface ServiceOffer {
  id: string;
  kind: OfferKind;
  status: OfferStatus;
  amount: number | null;
  deviceValue: number | null;
  targetPrice: number | null;
  difference: number | null;
  target: TargetSnapshot | null;
  device: ProposedDevice | null;
  note: string | null;
  inspectionNote: string | null;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  respondedAt: string | null;
  media: ServiceMediaItem[];
}

export type ServiceEventType =
  | 'created'
  | 'status'
  | 'note'
  | 'update'
  | 'info_requested'
  | 'customer_response'
  | 'offer'
  | 'offer_response'
  | 'assignment'
  | 'media';

export interface ServiceEvent {
  id: number;
  type: ServiceEventType;
  status: string | null;
  fromStatus: string | null;
  message: string | null;
  visibleToCustomer: boolean;
  actorKind: 'customer' | 'staff' | 'system';
  createdAt: string;
  data: Record<string, unknown>;
}

export interface ServiceSummary {
  id: string;
  kind: ServiceKind;
  number: string;
  status: ServiceStatus;
  title: LocalizedText;
  deviceCategory: string | null;
  afterSalesType: AfterSalesType | null;
  awaitingCustomer: boolean;
  openOffer: boolean;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface ServiceOrderRef {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  item: {
    id: string;
    name: LocalizedText;
    variantLabel: LocalizedText | null;
    sku: string;
    image: string | null;
    quantity: number;
  } | null;
}

export interface ServiceRequestDetail extends ServiceSummary {
  contact: { name: string; phone: string };
  preferredContact: PreferredContact;
  handoff: Handoff | null;
  brand: string | null;
  model: string | null;
  details: Record<string, unknown>;
  consultationRequired: boolean;
  policyVersion: string | null;
  closedAt: string | null;
  locale: Locale;
  canCancel: boolean;
  order: ServiceOrderRef | null;
  target: TargetSnapshot | null;
  targetIsCatalog: boolean;
  offers: ServiceOffer[];
  media: ServiceMediaItem[];
  events: ServiceEvent[];
}

export interface StaffRef {
  id: string;
  name: string;
}

export interface StaffServiceSummary extends ServiceSummary {
  contactName: string;
  contactPhone: string;
  assignedTo: StaffRef | null;
}

export interface StaffServiceRequest extends ServiceRequestDetail {
  customerId: string | null;
  customerEmail: string | null;
  assignedTo: StaffRef | null;
}

export type ServiceActionResult<T = ServiceRequestDetail> =
  { ok: true; request: T } | ServiceProblem;

export interface AfterSalesItem {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderDate: string;
  itemId: string;
  name: LocalizedText;
  variantLabel: LocalizedText | null;
  sku: string;
  image: string | null;
  quantity: number;
  isGift: boolean;
  warranty: LocalizedText | null;
  openRequests: { type: AfterSalesType; number: string }[];
}

export interface ServiceListFilter {
  kind?: ServiceKind | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export interface StaffServiceFilter {
  status?: string | null;
  q?: string | null;
  assigned?: 'me' | 'unassigned' | null;
  limit?: number;
  offset?: number;
}

export interface TradeInOfferInput {
  deviceValue: number;
  /** Only for a manual target — a catalog target always uses the authoritative catalog price. */
  targetPrice: number | null;
  note: string | null;
  inspectionNote: string | null;
  validDays: number | null;
}
