import type { CatalogEngine } from '@/domain/catalog/engine';
import type { RawCatalog } from '@/domain/catalog/raw';
import type { DemoActor, DemoCommerce } from '@/domain/commerce/demoCommerce';
import { fromMinor, toMinor } from '@/domain/commerce/money';
import type { DemoCustomer } from '@/domain/customer/demoCustomer';
import type { TemplateVars } from '@/domain/customer/templates';
import type { LocalizedText } from '@/domain/localized';
import type { PermissionKey } from '@/domain/access/permissions';
import type { RepairCategory, ServicesSettings } from '@/domain/settings/schemas';
import { tradeInDifference } from './media';
import {
  customerCanCancel,
  isTerminal,
  NUMBER_PREFIX,
  SERVICE_BUCKET,
  statusNeedsOffer,
  statusTemplate,
  statusValid,
} from './status';
import {
  SERVICE_KINDS,
  type AfterSalesItem,
  type CreateServiceResult,
  type MediaRef,
  type OfferKind,
  type ProposedDevice,
  type ServiceActionResult,
  type ServiceBucket,
  type ServiceEvent,
  type ServiceInputs,
  type ServiceKind,
  type ServiceListFilter,
  type ServiceMediaItem,
  type ServiceOffer,
  type ServiceProblem,
  type ServiceRequestDetail,
  type ServiceStatus,
  type ServiceSummary,
  type StaffRef,
  type StaffServiceFilter,
  type StaffServiceRequest,
  type StaffServiceSummary,
  type TargetSnapshot,
  type TradeInOfferInput,
} from './types';
import {
  afterSalesProblem,
  cleanText,
  normalizeMobile,
  repairProblem,
  tradeInProblem,
  usedProblem,
} from './validation';

/**
 * In-browser mirror of the service-request RPCs (demo mode). Same validation, status rules,
 * money arithmetic, notification triggers and privacy rules as the SQL
 * (supabase/migrations/20260928*_service*.sql); state lives in this browser's localStorage and
 * every request is badged "Demo". Live mode never uses this engine.
 */
export class DemoServicePermissionError extends Error {}

export interface DemoServiceRecord {
  id: string;
  kind: ServiceKind;
  number: string;
  userId: string | null;
  idempotencyKey: string | null;
  status: ServiceStatus;
  contactName: string;
  contactPhone: string;
  preferredContact: 'whatsapp' | 'phone';
  handoff: 'store_visit' | 'pickup_delivery' | null;
  deviceCategory: string | null;
  brand: string | null;
  model: string | null;
  details: Record<string, unknown>;
  consultationRequired: boolean;
  awaitingCustomer: boolean;
  orderId: string | null;
  orderItemId: string | null;
  afterSalesType: 'exchange' | 'return' | 'warranty' | null;
  policyVersion: string | null;
  targetVariantId: string | null;
  assignedTo: string | null;
  locale: 'ar' | 'en';
  isDemo: true;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  events: ServiceEvent[];
  offers: (ServiceOffer & { createdBy: string | null })[];
  media: (ServiceMediaItem & { offerId: string | null })[];
}

export interface DemoServicesState {
  version: 1;
  seq: Record<ServiceKind, number>;
  eventSeq: number;
  requests: DemoServiceRecord[];
  /** Demo staff directory (names shown for assignment). */
  staff: Record<string, string>;
}

export const emptyDemoServicesState = (): DemoServicesState => ({
  version: 1,
  seq: { repair: 0, trade_in: 0, used: 0, after_sales: 0 },
  eventSeq: 0,
  requests: [],
  staff: {},
});

export interface DemoServicesSettings {
  services: ServicesSettings;
  repairCatalog: RepairCategory[];
}

/** What the demo media store knows about an uploaded object (for server-like validation). */
export interface DemoMediaInfo {
  bucket: ServiceBucket;
  path: string;
  mime: string;
  size: number;
}

const PERMISSION: Record<ServiceKind, { view: PermissionKey; manage: PermissionKey }> = {
  repair: { view: 'repairs.view', manage: 'repairs.manage' },
  trade_in: { view: 'tradein.view', manage: 'tradein.manage' },
  used: { view: 'used_requests.view', manage: 'used_requests.manage' },
  after_sales: { view: 'after_sales.view', manage: 'after_sales.manage' },
};

const MIME_FOR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const PATH_RE = /^[^/]{1,120}\/[0-9a-f-]{36}\.([a-z0-9]{2,5})$/;
const fail = (code: string, field?: string): ServiceProblem =>
  field ? { ok: false, code, field } : { ok: false, code };
const isWholePiasters = (value: number) =>
  Number.isFinite(value) && fromMinor(toMinor(value)) === value;

export class DemoServices {
  private readonly raw: RawCatalog;
  private readonly commerce: DemoCommerce;
  private readonly customer: DemoCustomer;
  private readonly settings: () => DemoServicesSettings;
  private readonly storage: {
    load(): DemoServicesState | null;
    save(state: DemoServicesState): void;
  };
  private readonly now: () => Date;
  private readonly random: () => string;
  private readonly engineProvider: () => CatalogEngine;
  private readonly mediaInfo: (bucket: ServiceBucket, path: string) => DemoMediaInfo | null;
  private state: DemoServicesState;

  constructor(options: {
    raw: RawCatalog;
    commerce: DemoCommerce;
    customer: DemoCustomer;
    settings: () => DemoServicesSettings;
    storage: { load(): DemoServicesState | null; save(state: DemoServicesState): void };
    mediaInfo: (bucket: ServiceBucket, path: string) => DemoMediaInfo | null;
    now?: () => Date;
    random?: () => string;
    engine?: () => CatalogEngine;
  }) {
    this.raw = options.raw;
    this.commerce = options.commerce;
    this.customer = options.customer;
    this.settings = options.settings;
    this.storage = options.storage;
    this.mediaInfo = options.mediaInfo;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? (() => crypto.randomUUID());
    this.engineProvider = options.engine ?? (() => this.commerce.engine());
    this.state = this.storage.load() ?? emptyDemoServicesState();
    this.seedDemoRequests();
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private persist() {
    this.storage.save(this.state);
  }

  private iso() {
    return this.now().toISOString();
  }

  private require(actor: DemoActor, permission: PermissionKey): string {
    if (!actor.userId || !actor.can(permission))
      throw new DemoServicePermissionError(`missing ${permission}`);
    if (actor.email) this.state.staff[actor.userId] = actor.email;
    return actor.userId;
  }

  private requireCustomer(actor: DemoActor): string {
    if (!actor.userId) throw new DemoServicePermissionError('authentication required');
    return actor.userId;
  }

  private canViewAny(actor: DemoActor) {
    return SERVICE_KINDS.some((k) => actor.can(PERMISSION[k].view));
  }

  /** Seeded demo requests (no customer): visible to staff only, labelled Demo. */
  private seedDemoRequests() {
    let changed = false;
    for (const seed of this.raw.serviceRequests ?? []) {
      if (this.state.requests.some((r) => r.id === seed.id)) continue;
      const created = resolveRelative(seed.createdAt, this.now());
      this.state.requests.push({
        id: seed.id,
        kind: seed.kind,
        number: seed.number,
        userId: null,
        idempotencyKey: null,
        status: seed.status as ServiceStatus,
        contactName: 'عميل تجريبي (Demo)',
        contactPhone: '+201000000000',
        preferredContact: 'whatsapp',
        handoff: seed.handoff,
        deviceCategory: seed.deviceCategory,
        brand: seed.brand,
        model: seed.model,
        details: seed.details,
        consultationRequired: seed.consultation,
        awaitingCustomer: false,
        orderId: null,
        orderItemId: null,
        afterSalesType: seed.afterSalesType,
        policyVersion: seed.policyVersion,
        targetVariantId: seed.targetSku ? this.variantIdBySku(seed.targetSku) : null,
        assignedTo: null,
        locale: 'ar',
        isDemo: true,
        createdAt: created,
        updatedAt: created,
        closedAt: null,
        events: [
          this.event('created', { status: 'new', visible: true, actor: 'system', at: created }),
        ],
        offers: [],
        media: [],
      });
      changed = true;
    }
    if (changed) this.persist();
  }

  private variantIdBySku(sku: string): string | null {
    for (const p of this.raw.products) {
      const v = p.variants.find((x) => x.sku === sku);
      if (v) return v.id;
    }
    return null;
  }

  private event(
    type: ServiceEvent['type'],
    options: {
      status?: string | null;
      from?: string | null;
      message?: string | null;
      visible: boolean;
      actor: ServiceEvent['actorKind'];
      data?: Record<string, unknown>;
      at?: string;
    },
  ): ServiceEvent {
    this.state.eventSeq += 1;
    return {
      id: this.state.eventSeq,
      type,
      status: options.status ?? null,
      fromStatus: options.from ?? null,
      message: options.message ?? null,
      visibleToCustomer: options.visible,
      actorKind: options.actor,
      createdAt: options.at ?? this.iso(),
      data: options.data ?? {},
    };
  }

  private nextNumber(kind: ServiceKind) {
    this.state.seq[kind] += 1;
    const year = new Intl.DateTimeFormat('en', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
    }).format(this.now());
    return `${NUMBER_PREFIX[kind]}-${year}-${String(this.state.seq[kind]).padStart(6, '0')}`;
  }

  private notify(r: DemoServiceRecord, template: string | null, dedupe: string, amount?: number) {
    if (!template || !r.userId) return;
    const vars: TemplateVars = { code: r.number };
    if (amount !== undefined) vars.amount = egpText(amount);
    this.customer.notifyUser(
      r.userId,
      template,
      vars,
      `service:${r.id}:${dedupe}`,
      `/account/requests/${r.number}`,
      { requestId: r.id, kind: r.kind },
    );
  }

  private enabled(kind: ServiceKind) {
    const e = this.settings().services.enabled;
    return {
      repair: e.repairs,
      trade_in: e.tradeIn,
      used: e.used,
      after_sales: e.afterSales,
    }[kind];
  }

  /** Mirrors app.service_media_problem (existence, owner folder, MIME ↔ extension, size, counts). */
  private mediaProblem(
    bucket: ServiceBucket,
    items: MediaRef[] | undefined,
    owner: string,
    request: DemoServiceRecord | null,
    checkFolder: boolean,
  ): string | null {
    if (!items || items.length === 0) return null;
    const cfg = this.settings().services.media;
    let images = request?.media.filter((m) => !m.offerId && m.mediaType === 'image').length ?? 0;
    let videos = request?.media.filter((m) => !m.offerId && m.mediaType === 'video').length ?? 0;
    for (const item of items) {
      const match = PATH_RE.exec(item.path);
      if (!match || (checkFolder && item.path.split('/')[0] !== owner)) return 'invalid_media';
      if (item.label && !/^[a-z][a-z_]{1,30}$/.test(item.label)) return 'invalid_media';
      const info = this.mediaInfo(bucket, item.path);
      if (!info) return 'media_missing';
      if (
        this.state.requests.some((r) =>
          r.media.some((m) => m.bucket === bucket && m.path === item.path),
        )
      )
        return 'media_in_use';
      if (MIME_FOR_EXT[match[1] ?? ''] !== info.mime) return 'invalid_media_type';
      if (info.size <= 0) return 'invalid_media';
      if (info.mime.startsWith('image/')) {
        images += 1;
        if (info.size > cfg.maxImageBytes) return 'media_too_large';
      } else if (info.mime.startsWith('video/')) {
        if (!cfg.allowVideo || bucket === 'used-requests') return 'video_not_allowed';
        videos += 1;
        if (info.size > cfg.maxVideoBytes) return 'media_too_large';
      } else return 'invalid_media_type';
    }
    if (images + videos > cfg.maxFiles) return 'too_many_files';
    if (videos > cfg.maxVideos) return 'too_many_videos';
    return null;
  }

  private attachMedia(
    r: DemoServiceRecord,
    bucket: ServiceBucket,
    items: MediaRef[] | undefined,
    uploader: 'customer' | 'staff',
    offerId: string | null,
  ): number {
    for (const item of items ?? []) {
      const info = this.mediaInfo(bucket, item.path);
      if (!info) continue;
      r.media.push({
        id: `demo-media-${this.random().slice(0, 12)}`,
        bucket,
        path: item.path,
        mediaType: info.mime.startsWith('video/') ? 'video' : 'image',
        mimeType: info.mime,
        sizeBytes: info.size,
        label: item.label ?? null,
        uploaderKind: uploader,
        createdAt: this.iso(),
        offerId,
      });
    }
    return items?.length ?? 0;
  }

  private targetSnapshot(variantId: string): TargetSnapshot | null {
    const found = this.engineProvider().variant(variantId);
    if (!found) return null;
    const { product, variant } = found;
    const options = product.options.flatMap((o) => {
      const value = o.values.find((val) => val.key === variant.options[o.key]);
      return value ? [value.label] : [];
    });
    const brand = this.raw.brands.find((b) => b.slug === product.brandSlug);
    const media = [...product.media].sort((a, b) => a.sortOrder - b.sortOrder);
    const image =
      media.find(
        (m) => m.kind === 'image' && m.colorKey !== null && m.colorKey === variant.options.color,
      ) ??
      media.find((m) => m.kind === 'image' && m.isCover) ??
      media.find((m) => m.kind === 'image');
    return {
      variantId,
      productSlug: product.slug,
      sku: variant.sku,
      name: product.name,
      brand: brand?.name ?? null,
      variantLabel: options.length
        ? {
            ar: options.map((l) => l.ar).join(' · '),
            en: options.map((l) => l.en ?? l.ar).join(' · '),
          }
        : null,
      image: image?.url ?? null,
      price: found.price,
      isDemo: true,
    };
  }

  /** Read-only view for the demo admin engine (Phase 06 queues, dashboard, exports). */
  records(): readonly DemoServiceRecord[] {
    return this.state.requests;
  }

  titleOf(r: DemoServiceRecord): LocalizedText {
    return this.title(r);
  }

  private title(r: DemoServiceRecord): LocalizedText {
    if (r.kind === 'after_sales') {
      const item = this.orderItem(r.orderItemId);
      if (item) return item.item.productName;
      const product = (r.details.product as { name?: LocalizedText } | undefined)?.name;
      return product ?? { ar: 'منتج', en: 'Product' };
    }
    const text = `${r.brand ?? ''} ${r.model ?? ''}`.trim();
    return { ar: text, en: text };
  }

  private orderItem(itemId: string | null) {
    if (!itemId) return null;
    for (const order of this.commerce.orderRecords()) {
      for (const item of order.items) {
        if (`${order.id}:${item.lineNo}` === itemId) return { order, item };
      }
    }
    return null;
  }

  private summary(r: DemoServiceRecord): ServiceSummary {
    return {
      id: r.id,
      kind: r.kind,
      number: r.number,
      status: r.status,
      title: this.title(r),
      deviceCategory: r.deviceCategory,
      afterSalesType: r.afterSalesType,
      awaitingCustomer: r.awaitingCustomer,
      openOffer: r.offers.some((o) => o.status === 'sent'),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isDemo: true,
    };
  }

  private offerView(o: DemoServiceRecord['offers'][number], r: DemoServiceRecord): ServiceOffer {
    return {
      id: o.id,
      kind: o.kind,
      status: o.status,
      amount: o.amount,
      deviceValue: o.deviceValue,
      targetPrice: o.targetPrice,
      difference: o.difference,
      target: o.target,
      device: o.device,
      note: o.note,
      inspectionNote: o.inspectionNote,
      expiresAt: o.expiresAt,
      expired: o.status === 'sent' && o.expiresAt !== null && o.expiresAt < this.iso(),
      createdAt: o.createdAt,
      respondedAt: o.respondedAt,
      media: r.media
        .filter((m) => m.offerId === o.id)
        .map((m) => ({
          id: m.id,
          bucket: m.bucket,
          path: m.path,
          mediaType: m.mediaType,
          label: m.label,
        })),
    };
  }

  private detail(r: DemoServiceRecord, staff: false): ServiceRequestDetail;
  private detail(r: DemoServiceRecord, staff: true): StaffServiceRequest;
  private detail(r: DemoServiceRecord, staff: boolean): ServiceRequestDetail | StaffServiceRequest {
    const found = this.orderItem(r.orderItemId);
    const target = r.targetVariantId
      ? this.targetSnapshot(r.targetVariantId)
      : ((r.details.target as { manual?: TargetSnapshot } | undefined)?.manual ?? null);
    const offers = [...r.offers]
      .filter((o) => staff || o.status !== 'withdrawn')
      .sort(
        (a, b) =>
          Number(b.status === 'sent') - Number(a.status === 'sent') ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .map((o) => this.offerView(o, r));
    const base: ServiceRequestDetail = {
      ...this.summary(r),
      contact: { name: r.contactName, phone: r.contactPhone },
      preferredContact: r.preferredContact,
      handoff: r.handoff,
      brand: r.brand,
      model: r.model,
      details: r.details,
      consultationRequired: r.consultationRequired,
      policyVersion: r.policyVersion,
      closedAt: r.closedAt,
      locale: r.locale,
      canCancel: customerCanCancel(r.kind, r.status),
      order: found
        ? {
            id: found.order.id,
            number: found.order.orderNumber,
            status: found.order.status,
            createdAt: found.order.createdAt,
            item: {
              id: r.orderItemId ?? '',
              name: found.item.productName,
              variantLabel: found.item.variantLabel,
              sku: found.item.sku,
              image: found.item.imageUrl,
              quantity: found.item.quantity,
            },
          }
        : null,
      target,
      targetIsCatalog: r.targetVariantId !== null,
      offers,
      media: r.media.filter((m) => !m.offerId).map(({ offerId: _offer, ...m }) => m),
      events: r.events
        .filter((e) => staff || e.visibleToCustomer)
        .map((e) => (staff ? e : { ...e, data: omit(e.data, 'staffId') })),
    };
    if (!staff) return base;
    return {
      ...base,
      customerId: r.userId,
      customerEmail: r.userId?.startsWith('demo-customer-')
        ? r.userId.slice('demo-customer-'.length)
        : null,
      assignedTo: r.assignedTo ? { id: r.assignedTo, name: this.staffName(r.assignedTo) } : null,
    };
  }

  private staffName(id: string) {
    return this.state.staff[id] ?? id;
  }

  private find(id: string) {
    return this.state.requests.find((r) => r.id === id) ?? null;
  }

  private mine(actor: DemoActor, number: string) {
    const uid = this.requireCustomer(actor);
    const wanted = number.trim().toUpperCase();
    return this.state.requests.find((r) => r.number === wanted && r.userId === uid) ?? null;
  }

  private staffRequest(actor: DemoActor, id: string, action: 'view' | 'manage') {
    const r = this.find(id);
    if (!r) {
      if (!this.canViewAny(actor)) throw new DemoServicePermissionError('permission denied');
      return null;
    }
    this.require(actor, PERMISSION[r.kind][action]);
    return r;
  }

  private setStatus(
    r: DemoServiceRecord,
    status: ServiceStatus,
    message: string | null,
    actorKind: 'staff' | 'customer',
    notify: boolean,
    data: Record<string, unknown> = {},
  ) {
    const from = r.status;
    r.status = status;
    r.updatedAt = this.iso();
    r.closedAt = isTerminal(status) ? this.iso() : null;
    if (isTerminal(status)) {
      r.awaitingCustomer = false;
      for (const o of r.offers) if (o.status === 'sent') o.status = 'withdrawn';
    }
    r.events.push(
      this.event('status', { status, from, message, visible: true, actor: actorKind, data }),
    );
    if (notify) this.notify(r, statusTemplate(r.kind, status), `status:${status}`);
  }

  // ── Customer ────────────────────────────────────────────────────────────
  create<K extends ServiceKind>(
    actor: DemoActor,
    kind: K,
    input: ServiceInputs[K],
  ): CreateServiceResult {
    const uid = this.requireCustomer(actor);
    if (!this.enabled(kind)) return fail('service_disabled');
    const existing = this.state.requests.find(
      (r) => r.userId === uid && r.idempotencyKey === input.idempotencyKey,
    );
    if (existing)
      return {
        ok: true,
        duplicate: true,
        request: { id: existing.id, number: existing.number, status: existing.status },
      };
    const open = this.state.requests.filter(
      (r) => r.userId === uid && !isTerminal(r.status),
    ).length;
    if (open >= this.settings().services.requests.maxOpenPerCustomer) return fail('too_many_open');

    const settings = this.settings();
    const bucket = SERVICE_BUCKET[kind];
    const base = {
      contactName: cleanText(input.contact.name, 120) ?? '',
      contactPhone: normalizeMobile(input.contact.phone) ?? '',
      preferredContact: input.preferredContact,
      locale: input.locale,
    };
    let problem: ServiceProblem | null;
    let record: Partial<DemoServiceRecord>;
    let media: MediaRef[] | undefined;
    let orderId: string | null = null;

    if (kind === 'repair') {
      const i = input as ServiceInputs['repair'];
      problem = repairProblem(i, settings.repairCatalog);
      if (problem) return problem;
      const category = settings.repairCatalog.find((c) => c.key === i.device.category);
      const component = category?.components.find((c) => c.key === i.diagnosis.component);
      const symptom = component?.symptoms.find((s) => s.key === i.diagnosis.symptom);
      record = {
        deviceCategory: i.device.category,
        brand: cleanText(i.device.brand, 60),
        model: cleanText(i.device.model, 80),
        handoff: i.handoff,
        consultationRequired: i.consultation || i.diagnosis.unsure || !i.diagnosis.component,
        details: {
          diagnosis: {
            component: i.diagnosis.component,
            componentLabel: component?.label ?? null,
            symptom: i.diagnosis.symptom,
            symptomLabel: symptom?.label ?? null,
            unsure: i.diagnosis.unsure,
            usedViewer: i.diagnosis.viewer,
          },
          description: cleanText(i.description, 2000),
        },
      };
      media = i.media;
    } else if (kind === 'trade_in') {
      const i = input as ServiceInputs['trade_in'];
      problem = tradeInProblem(i);
      if (problem) return problem;
      let targetVariantId: string | null = null;
      if ('variantId' in i.target) {
        const found = this.engineProvider().variant(i.target.variantId);
        if (!found || !found.variant.isActive) return fail('invalid_target', 'target');
        targetVariantId = i.target.variantId;
      }
      const c = i.current;
      record = {
        deviceCategory: c.category,
        brand: cleanText(c.brand, 60),
        model: cleanText(c.model, 80),
        consultationRequired: true,
        targetVariantId,
        details: {
          current: {
            ...c,
            brand: cleanText(c.brand, 60),
            model: cleanText(c.model, 80),
            storage: cleanText(c.storage, 20),
            color: cleanText(c.color, 30),
            accessories: [...new Set(c.accessories)],
            conditions: [...new Set(c.conditions)],
            notes: cleanText(c.notes, 2000),
          },
          ...('manual' in i.target
            ? {
                target: {
                  manual: {
                    brand: cleanText(i.target.manual.brand, 60),
                    model: cleanText(i.target.manual.model, 80),
                    storage: cleanText(i.target.manual.storage, 20),
                    color: cleanText(i.target.manual.color, 30),
                  },
                },
              }
            : {}),
        },
      };
      media = i.media;
    } else if (kind === 'used') {
      const i = input as ServiceInputs['used'];
      problem = usedProblem(i);
      if (problem) return problem;
      const d = i.device;
      record = {
        deviceCategory: d.category,
        brand: cleanText(d.brand, 60),
        model: cleanText(d.model, 80),
        details: {
          device: {
            ...d,
            brand: cleanText(d.brand, 60),
            model: cleanText(d.model, 80),
            storage: cleanText(d.storage, 20),
            color: cleanText(d.color, 30),
            budget: d.budget === null ? null : fromMinor(toMinor(d.budget)),
            notes: cleanText(d.notes, 2000),
          },
        },
      };
    } else {
      const i = input as ServiceInputs['after_sales'];
      problem = afterSalesProblem(i, settings.services.afterSales.policyVersion);
      // Ownership first (never reveal whether a forged id exists).
      const found = this.orderItem(i.orderItemId);
      if (!found || found.order.customerId !== uid) return fail('not_eligible', 'orderItemId');
      if (!['delivered', 'completed'].includes(found.order.status))
        return fail('not_delivered', 'orderItemId');
      if (
        this.state.requests.some(
          (r) =>
            r.orderItemId === i.orderItemId && r.afterSalesType === i.type && !isTerminal(r.status),
        )
      )
        return fail('duplicate_open', 'orderItemId');
      if (problem) return problem;
      orderId = found.order.id;
      record = {
        orderItemId: i.orderItemId,
        afterSalesType: i.type,
        policyVersion: i.policyVersion,
        details: {
          reason: i.reason,
          description: cleanText(i.description, 2000),
          product: { name: found.item.productName, sku: found.item.sku },
        },
      };
      media = i.media;
    }

    const mediaCode = this.mediaProblem(bucket, media, uid, null, true);
    if (mediaCode) return fail(mediaCode, 'media');

    const now = this.iso();
    const r: DemoServiceRecord = {
      id: `demo-service-${this.random()}`,
      kind,
      number: this.nextNumber(kind),
      userId: uid,
      idempotencyKey: input.idempotencyKey,
      status: 'new',
      ...base,
      handoff: null,
      deviceCategory: null,
      brand: null,
      model: null,
      details: {},
      consultationRequired: false,
      awaitingCustomer: false,
      orderId,
      orderItemId: null,
      afterSalesType: null,
      policyVersion: null,
      targetVariantId: null,
      assignedTo: null,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      events: [],
      offers: [],
      media: [],
      ...record,
    };
    this.attachMedia(r, bucket, media, 'customer', null);
    r.events.push(
      this.event('created', {
        status: 'new',
        visible: true,
        actor: 'customer',
        data: { media: media?.length ?? 0 },
      }),
    );
    this.state.requests.push(r);
    this.persist();
    return { ok: true, request: { id: r.id, number: r.number, status: r.status } };
  }

  listMine(actor: DemoActor, filter: ServiceListFilter = {}) {
    const uid = this.requireCustomer(actor);
    const rows = this.state.requests
      .filter(
        (r) =>
          r.userId === uid &&
          (!filter.kind || r.kind === filter.kind) &&
          (!filter.status || r.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Math.max(filter.offset ?? 0, 0);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    return {
      total: rows.length,
      items: rows.slice(offset, offset + limit).map((r) => this.summary(r)),
    };
  }

  getMine(actor: DemoActor, number: string): ServiceRequestDetail | null {
    const r = this.mine(actor, number);
    return r ? this.detail(r, false) : null;
  }

  cancel(actor: DemoActor, number: string, reason: string | null): ServiceActionResult {
    const r = this.mine(actor, number);
    if (!r) return fail('not_found');
    if (!customerCanCancel(r.kind, r.status)) return fail('cannot_cancel');
    this.setStatus(r, 'cancelled', cleanText(reason, 500), 'customer', false);
    this.persist();
    return { ok: true, request: this.detail(r, false) };
  }

  respond(
    actor: DemoActor,
    number: string,
    message: string | null,
    media: MediaRef[] = [],
  ): ServiceActionResult {
    const uid = this.requireCustomer(actor);
    const r = this.mine(actor, number);
    if (!r) return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    if (r.kind === 'used' && media.length > 0) return fail('invalid_media', 'media');
    const text = cleanText(message, 2000);
    if (!text && media.length === 0) return fail('message_required', 'message');
    const code = this.mediaProblem(SERVICE_BUCKET[r.kind], media, uid, r, true);
    if (code) return fail(code, 'media');
    const count = this.attachMedia(r, SERVICE_BUCKET[r.kind], media, 'customer', null);
    const reopened = r.kind === 'trade_in' && r.status === 'need_more_info';
    const from = r.status;
    r.awaitingCustomer = false;
    if (reopened) r.status = 'under_review';
    r.updatedAt = this.iso();
    r.events.push(
      this.event('customer_response', {
        status: reopened ? 'under_review' : null,
        from: reopened ? from : null,
        message: text,
        visible: true,
        actor: 'customer',
        data: { media: count },
      }),
    );
    this.persist();
    return { ok: true, request: this.detail(r, false) };
  }

  respondOffer(
    actor: DemoActor,
    offerId: string,
    decision: 'accept' | 'decline',
    note: string | null,
  ): ServiceActionResult {
    const uid = this.requireCustomer(actor);
    const r = this.state.requests.find(
      (x) => x.userId === uid && x.offers.some((o) => o.id === offerId),
    );
    const o = r?.offers.find((x) => x.id === offerId);
    if (!r || !o) return fail('not_found');
    if (o.status !== 'sent' || isTerminal(r.status)) return fail('offer_closed');
    if (o.expiresAt !== null && o.expiresAt < this.iso()) return fail('offer_expired');
    const accept = decision === 'accept';
    const status: ServiceStatus =
      o.kind === 'trade_in'
        ? accept
          ? 'customer_accepted'
          : 'customer_declined'
        : o.kind === 'used_proposal'
          ? accept
            ? 'customer_interested'
            : 'searching'
          : accept
            ? 'customer_approved'
            : 'under_review';
    o.status = accept ? 'accepted' : 'declined';
    o.respondedAt = this.iso();
    const from = r.status;
    r.status = status;
    r.awaitingCustomer = false;
    r.updatedAt = this.iso();
    r.events.push(
      this.event('offer_response', {
        status,
        from,
        message: cleanText(note, 1000),
        visible: true,
        actor: 'customer',
        data: { offerId, decision },
      }),
    );
    this.persist();
    return { ok: true, request: this.detail(r, false) };
  }

  afterSalesItems(actor: DemoActor): AfterSalesItem[] {
    const uid = this.requireCustomer(actor);
    return this.commerce
      .orderRecords()
      .filter((o) => o.customerId === uid && ['delivered', 'completed'].includes(o.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((o) =>
        o.items.map((item) => {
          const itemId = `${o.id}:${item.lineNo}`;
          return {
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderStatus: o.status,
            orderDate: o.createdAt,
            itemId,
            name: item.productName,
            variantLabel: item.variantLabel,
            sku: item.sku,
            image: item.imageUrl,
            quantity: item.quantity,
            isGift: item.isGift,
            warranty: item.warranty,
            openRequests: this.state.requests
              .filter((r) => r.orderItemId === itemId && !isTerminal(r.status) && r.afterSalesType)
              .map((r) => ({ type: r.afterSalesType ?? 'warranty', number: r.number })),
          };
        }),
      );
  }

  /** Customers can read their own uploads and media attached to their own requests. */
  canReadMedia(actor: DemoActor, bucket: ServiceBucket, path: string): boolean {
    if (!actor.userId) return false;
    if (path.split('/')[0] === actor.userId) return true;
    const r = this.state.requests.find((x) =>
      x.media.some((m) => m.bucket === bucket && m.path === path),
    );
    if (!r) return false;
    return r.userId === actor.userId || actor.can(PERMISSION[r.kind].view);
  }

  // ── Staff ───────────────────────────────────────────────────────────────
  staffList(actor: DemoActor, kind: ServiceKind, filter: StaffServiceFilter = {}) {
    const uid = this.require(actor, PERMISSION[kind].view);
    const q = filter.q?.trim().toLowerCase() ?? '';
    const rows = this.state.requests
      .filter(
        (r) =>
          r.kind === kind &&
          (!filter.status ||
            r.status === filter.status ||
            (filter.status === 'open' && !isTerminal(r.status))) &&
          (!filter.assigned ||
            (filter.assigned === 'me' && r.assignedTo === uid) ||
            (filter.assigned === 'unassigned' && r.assignedTo === null)) &&
          (!q ||
            [r.number, r.contactPhone, r.contactName, r.brand ?? '', r.model ?? ''].some((v) =>
              v.toLowerCase().includes(q),
            )),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Math.max(filter.offset ?? 0, 0);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return {
      total: rows.length,
      items: rows.slice(offset, offset + limit).map((r): StaffServiceSummary => ({
        ...this.summary(r),
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        assignedTo: r.assignedTo ? { id: r.assignedTo, name: this.staffName(r.assignedTo) } : null,
      })),
    };
  }

  staffGet(actor: DemoActor, id: string): StaffServiceRequest | null {
    const r = this.staffRequest(actor, id, 'view');
    return r ? this.detail(r, true) : null;
  }

  /** Demo staff directory: every staff member who used a service module in this browser. */
  assignees(actor: DemoActor, kind: ServiceKind): StaffRef[] {
    const uid = this.require(actor, PERMISSION[kind].manage);
    const ids = new Set([uid, ...Object.keys(this.state.staff)]);
    return [...ids].map((id) => ({ id, name: this.staffName(id) }));
  }

  private staffResult(r: DemoServiceRecord): ServiceActionResult<StaffServiceRequest> {
    r.updatedAt = this.iso();
    this.persist();
    return { ok: true, request: this.detail(r, true) };
  }

  assign(
    actor: DemoActor,
    id: string,
    staffId: string | null,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r) return fail('not_found');
    if (staffId !== null && !this.assignees(actor, r.kind).some((a) => a.id === staffId))
      return fail('not_staff');
    r.assignedTo = staffId;
    r.events.push(this.event('assignment', { visible: false, actor: 'staff', data: { staffId } }));
    return this.staffResult(r);
  }

  setStatusStaff(
    actor: DemoActor,
    id: string,
    status: string,
    note: string | null,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r) return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    if (status === r.status) return fail('same_status');
    if (!statusValid(r.kind, status, r.afterSalesType)) return fail('invalid_status');
    if (statusNeedsOffer(r.kind, status)) return fail('use_offer');
    if (
      r.kind === 'after_sales' &&
      [
        'item_received',
        'inspection',
        'exchange_handling',
        'refund_handling',
        'warranty_handling',
        'completed',
      ].includes(status) &&
      !r.events.some((e) => e.status === 'approved')
    )
      return fail('approval_required');
    this.setStatus(r, status, cleanText(note, 2000), 'staff', true);
    return this.staffResult(r);
  }

  addNote(
    actor: DemoActor,
    id: string,
    message: string,
    visible: boolean,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r) return fail('not_found');
    const text = cleanText(message, 2000);
    if (!text) return fail('message_required');
    const event = this.event(visible ? 'update' : 'note', {
      message: text,
      visible,
      actor: 'staff',
    });
    r.events.push(event);
    if (visible) this.notify(r, 'service.updated', `update:${event.id}`);
    return this.staffResult(r);
  }

  requestInfo(
    actor: DemoActor,
    id: string,
    message: string,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r) return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    const text = cleanText(message, 2000);
    if (!text) return fail('message_required');
    const from = r.status;
    r.awaitingCustomer = true;
    if (r.kind === 'trade_in') r.status = 'need_more_info';
    const event = this.event('info_requested', {
      status: r.kind === 'trade_in' ? 'need_more_info' : null,
      from: r.kind === 'trade_in' ? from : null,
      message: text,
      visible: true,
      actor: 'staff',
    });
    r.events.push(event);
    this.notify(r, 'service.info_needed', `info:${event.id}`);
    return this.staffResult(r);
  }

  private pushOffer(
    r: DemoServiceRecord,
    kind: OfferKind,
    values: Partial<ServiceOffer>,
    actor: DemoActor,
  ) {
    for (const o of r.offers) if (o.status === 'sent') o.status = 'superseded';
    const offer = {
      id: `demo-offer-${this.random()}`,
      kind,
      status: 'sent' as const,
      amount: null,
      deviceValue: null,
      targetPrice: null,
      difference: null,
      target: null,
      device: null,
      note: null,
      inspectionNote: null,
      expiresAt: null,
      expired: false,
      createdAt: this.iso(),
      respondedAt: null,
      media: [],
      createdBy: actor.userId,
      ...values,
    };
    r.offers.push(offer);
    return offer;
  }

  sendRepairQuote(
    actor: DemoActor,
    id: string,
    kind: 'estimate' | 'final',
    amount: number,
    note: string | null,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r || r.kind !== 'repair') return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    if (!(amount >= 0 && amount <= 1_000_000 && isWholePiasters(amount)))
      return fail('invalid_amount');
    const offer = this.pushOffer(
      r,
      kind === 'estimate' ? 'repair_estimate' : 'repair_final',
      {
        amount,
        note: cleanText(note, 1000),
      },
      actor,
    );
    const from = r.status;
    r.status = 'quote_sent';
    r.events.push(
      this.event('offer', {
        status: 'quote_sent',
        from,
        visible: true,
        actor: 'staff',
        data: { offerId: offer.id, kind: offer.kind },
      }),
    );
    this.notify(r, 'service.repair.quote_ready', `offer:${offer.id}`, amount);
    return this.staffResult(r);
  }

  sendTradeInOffer(
    actor: DemoActor,
    id: string,
    input: TradeInOfferInput,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r || r.kind !== 'trade_in') return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    const value = input.deviceValue;
    if (!(value >= 0 && value <= 10_000_000 && isWholePiasters(value)))
      return fail('invalid_amount', 'deviceValue');
    let targetPrice: number;
    let snapshot: TargetSnapshot;
    if (r.targetVariantId) {
      if (input.targetPrice !== null) return fail('catalog_price_only', 'targetPrice');
      const snap = this.targetSnapshot(r.targetVariantId);
      if (!snap || snap.price === null || snap.price === undefined)
        return fail('target_price_unavailable', 'targetPrice');
      targetPrice = snap.price;
      snapshot = snap;
    } else {
      const price = input.targetPrice;
      if (price === null || !(price >= 0 && price <= 10_000_000 && isWholePiasters(price)))
        return fail('invalid_amount', 'targetPrice');
      targetPrice = price;
      snapshot = {
        ...((r.details.target as { manual?: TargetSnapshot } | undefined)?.manual ?? {}),
        price,
      };
    }
    const days = Math.min(
      Math.max(input.validDays ?? this.settings().services.tradeIn.offerValidityDays, 1),
      60,
    );
    const offer = this.pushOffer(
      r,
      'trade_in',
      {
        deviceValue: value,
        targetPrice,
        difference: tradeInDifference(targetPrice, value),
        target: snapshot,
        note: cleanText(input.note, 1000),
        inspectionNote: cleanText(input.inspectionNote, 1000),
        expiresAt: new Date(this.now().getTime() + days * 86_400_000).toISOString(),
      },
      actor,
    );
    const from = r.status;
    r.status = 'offer_sent';
    r.awaitingCustomer = false;
    r.events.push(
      this.event('offer', {
        status: 'offer_sent',
        from,
        visible: true,
        actor: 'staff',
        data: { offerId: offer.id, kind: 'trade_in' },
      }),
    );
    this.notify(r, 'service.trade_in.offer_ready', `offer:${offer.id}`, value);
    return this.staffResult(r);
  }

  sendUsedProposal(
    actor: DemoActor,
    id: string,
    device: ProposedDevice,
    price: number,
    note: string | null,
    media: MediaRef[] = [],
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r || r.kind !== 'used') return fail('not_found');
    if (isTerminal(r.status)) return fail('closed');
    if (!(price > 0 && price <= 10_000_000 && isWholePiasters(price)))
      return fail('invalid_amount', 'price');
    if (!cleanText(device.brand, 60) || !cleanText(device.model, 80))
      return fail('invalid_device', 'device');
    if (device.batteryHealth !== null && (device.batteryHealth < 1 || device.batteryHealth > 100))
      return fail('invalid_battery', 'batteryHealth');
    const code = this.mediaProblem('used-requests', media, actor.userId ?? '', null, false);
    if (code) return fail(code, 'media');
    const offer = this.pushOffer(
      r,
      'used_proposal',
      {
        amount: price,
        note: cleanText(note, 1000),
        device: {
          brand: cleanText(device.brand, 60) ?? '',
          model: cleanText(device.model, 80) ?? '',
          storage: cleanText(device.storage, 20),
          color: cleanText(device.color, 30),
          batteryHealth: device.batteryHealth,
          condition: cleanText(device.condition, 500),
          taxStatus: device.taxStatus,
        },
      },
      actor,
    );
    this.attachMedia(r, 'used-requests', media, 'staff', offer.id);
    const from = r.status;
    r.status = 'option_found';
    r.awaitingCustomer = false;
    r.events.push(
      this.event('offer', {
        status: 'option_found',
        from,
        visible: true,
        actor: 'staff',
        data: { offerId: offer.id, kind: 'used_proposal' },
      }),
    );
    this.notify(r, 'service.used.option_found', `offer:${offer.id}`, price);
    return this.staffResult(r);
  }

  decideAfterSales(
    actor: DemoActor,
    id: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): ServiceActionResult<StaffServiceRequest> {
    const r = this.staffRequest(actor, id, 'manage');
    if (!r || r.kind !== 'after_sales') return fail('not_found');
    if (!['new', 'under_review'].includes(r.status)) return fail('already_decided');
    const text = cleanText(note, 2000);
    if (decision === 'rejected' && !text) return fail('reason_required', 'note');
    this.setStatus(r, decision, text, 'staff', true, { decision });
    return this.staffResult(r);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function egpText(amount: number): LocalizedText {
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
  return { ar: `${formatted} ج.م.`, en: `EGP ${formatted}` };
}

function omit(data: Record<string, unknown>, key: string) {
  const { [key]: _removed, ...rest } = data;
  return rest;
}

const RELATIVE = /^([+-])(\d+)([dhm])$/;
function resolveRelative(value: string, now: Date): string {
  const match = RELATIVE.exec(value);
  if (!match) return new Date(value).toISOString();
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[3] as 'd' | 'h' | 'm'];
  const delta = Number(match[2]) * unit * (match[1] === '-' ? -1 : 1);
  return new Date(now.getTime() + delta).toISOString();
}
