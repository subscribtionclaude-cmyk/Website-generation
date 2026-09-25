import { createCatalogEngine, type CatalogEngine } from '@/domain/catalog/engine';
import { resolveTime, type RawCatalog } from '@/domain/catalog/raw';
import type { PermissionKey } from '@/domain/access/permissions';
import type {
  CommerceSettings,
  FeaturesSettings,
  OrderReviewSettings,
  StoreSettings,
} from '@/domain/settings/schemas';
import { isEgyptianMobile, normalizeEgyptianPhone } from '@/lib/phone';
import { mergeCarts } from './cart';
import { addMoney, subtractMoney } from './money';
import { buildQuote, type QuoteContext, type QuoteItemInput, type QuoteOfferInfo } from './pricing';
import { manualReviewReasons } from './review';
import {
  canCustomerCancel,
  derivedPaymentStatus,
  initialPaymentStatus,
  OPEN_ORDER_STATUSES,
  orderTransitionAllowed,
} from './status';
import type {
  AccountCart,
  AccountCartItem,
  CartItemInput,
  CreateOrderPayload,
  CreateOrderResult,
  Order,
  OrderEvent,
  OrderStatus,
  OrderSummary,
  Quote,
  QuoteOptions,
  StaffActionResult,
  StaffOrder,
  StaffOrderFilter,
  StaffOrderSummary,
} from './types';

/**
 * DEMO MODE ONLY — an in-browser mirror of the commerce RPCs so the full checkout can be previewed
 * without a backend. Same rules as the SQL (see supabase/tests/sql/07_commerce.test.sql); state is
 * kept in this browser only and every order is flagged isDemo. Live mode never uses this class.
 * Single-tab semantics: JavaScript runs one call at a time, so "locks" are implicit here.
 */
interface DemoEvent extends OrderEvent {
  visible: boolean;
}

export interface DemoOrderRecord extends Omit<StaffOrder, 'timeline'> {
  idempotencyKey: string;
  events: DemoEvent[];
}

interface DemoRedemption {
  offerId: string;
  orderId: string;
  customerId: string;
  code: string;
  amount: number;
  status: 'active' | 'released';
}

interface DemoMovement {
  variantId: string;
  delta: number;
  quantityAfter: number;
  reason: 'sale' | 'cancellation_restock';
  orderId: string;
  at: string;
}

export interface DemoCommerceState {
  version: 1;
  seq: number;
  carts: Record<string, AccountCartItem[]>;
  orders: DemoOrderRecord[];
  redemptions: DemoRedemption[];
  stockDelta: Record<string, number>;
  movements: DemoMovement[];
}

export interface DemoCommerceStorage {
  load(): DemoCommerceState | null;
  save(state: DemoCommerceState): void;
}

export interface DemoCommerceSettings {
  features: FeaturesSettings;
  commerce: CommerceSettings;
  orderReview: OrderReviewSettings;
  store: StoreSettings;
}

export interface DemoActor {
  userId: string | null;
  email: string | null;
  can: (permission: PermissionKey) => boolean;
}

export const emptyDemoCommerceState = (): DemoCommerceState => ({
  version: 1,
  seq: 0,
  carts: {},
  orders: [],
  redemptions: [],
  stockDelta: {},
  movements: [],
});

class PermissionError extends Error {
  readonly code = '42501';
}

export class DemoCommerce {
  private readonly raw: RawCatalog;
  private readonly storage: DemoCommerceStorage;
  private readonly settings: () => DemoCommerceSettings;
  private readonly now: () => Date;
  private state: DemoCommerceState;

  constructor(options: {
    raw: RawCatalog;
    storage: DemoCommerceStorage;
    settings: () => DemoCommerceSettings;
    now?: () => Date;
  }) {
    this.raw = options.raw;
    this.storage = options.storage;
    this.settings = options.settings;
    this.now = options.now ?? (() => new Date());
    this.state = this.storage.load() ?? emptyDemoCommerceState();
  }

  // ── Stock ────────────────────────────────────────────────────────────────
  reservedQuantity(variantId: string, excludeOrderId?: string): number {
    const nowMs = this.now().getTime();
    let total = 0;
    for (const order of this.state.orders) {
      if (order.id === excludeOrderId) continue;
      for (const r of order.reservations) {
        if (
          r.variantId === variantId &&
          r.status === 'active' &&
          new Date(r.expiresAt).getTime() > nowMs
        )
          total += r.quantity;
      }
    }
    return total;
  }

  stockDelta(variantId: string): number {
    return this.state.stockDelta[variantId] ?? 0;
  }

  /** Catalog engine that sees this store's reservations and committed sales. */
  engine(): CatalogEngine {
    return createCatalogEngine(this.raw, this.now(), {
      reservedQuantity: (id) => this.reservedQuantity(id),
      stockDelta: (id) => this.stockDelta(id),
    });
  }

  private persist() {
    this.storage.save(this.state);
  }

  // ── Quote ────────────────────────────────────────────────────────────────
  private quoteContext(customerId: string | null): QuoteContext {
    const now = this.now();
    const engine = this.engine();
    const settings = this.settings();
    const offers: QuoteOfferInfo[] = this.raw.offers.map((o) => ({
      id: o.id,
      slug: o.slug,
      kind: o.kind,
      title: o.title,
      badge: o.badge,
      discountPercent: o.discountPercent,
      discountAmount: o.discountAmount,
      promoCode: o.promoCode,
      startsAt: resolveTime(o.startsAt, now),
      endsAt: resolveTime(o.endsAt, now),
      maxRedemptions: o.maxRedemptions,
      maxRedemptionsPerCustomer: o.maxRedemptionsPerCustomer,
      minSubtotal: o.minSubtotal,
      sortOrder: o.sortOrder,
      products: o.products.map((p) => ({ productSlug: p.slug, role: p.role, quantity: 1 })),
    }));
    const brandName = (slug: string) => this.raw.brands.find((b) => b.slug === slug)?.name ?? null;
    return {
      now,
      customerId,
      maxQuantityPerLine: settings.commerce.maxQuantityPerLine,
      promoCodesEnabled: settings.features.promoCodes,
      offers,
      redemptions: (offerId, customer) => {
        const active = this.state.redemptions.filter(
          (r) => r.offerId === offerId && r.status === 'active',
        );
        return {
          total: active.length,
          customer: active.filter((r) => r.customerId === customer).length,
        };
      },
      defaultVariant: (productSlug) => {
        const product = this.raw.products.find((p) => p.slug === productSlug);
        const active = product?.variants.filter((v) => v.isActive) ?? [];
        return (active.find((v) => v.isDefault) ?? active[0])?.id ?? null;
      },
      variant: (variantId) => {
        const found = engine.variant(variantId);
        if (!found) return null;
        const { product, variant } = found;
        const optionSnapshots = product.options.flatMap((o) => {
          const value = o.values.find((val) => val.key === variant.options[o.key]);
          return value
            ? [{ key: o.key, name: o.name, valueKey: value.key, valueLabel: value.label }]
            : [];
        });
        const media = [...product.media].sort((a, b) => a.sortOrder - b.sortOrder);
        const image =
          media.find(
            (m) =>
              m.kind === 'image' && m.colorKey !== null && m.colorKey === variant.options.color,
          ) ??
          media.find((m) => m.kind === 'image' && m.isCover) ??
          media.find((m) => m.kind === 'image');
        const offer = found.priceOfferSlug
          ? offers.find((o) => o.slug === found.priceOfferSlug)
          : null;
        return {
          variantId,
          productId: product.id,
          productSlug: product.slug,
          sku: variant.sku,
          name: product.name,
          brand: brandName(product.brandSlug),
          variantLabel: optionSnapshots.length
            ? {
                ar: optionSnapshots.map((o) => o.valueLabel.ar).join(' · '),
                en: optionSnapshots.map((o) => o.valueLabel.en ?? o.valueLabel.ar).join(' · '),
              }
            : null,
          options: optionSnapshots,
          image: image?.url ?? null,
          warranty: variant.warranty ?? product.warranty,
          visible: true,
          active: variant.isActive,
          availabilityState: product.availabilityState,
          regularPrice: found.regularPrice,
          unitPrice: found.price,
          offer: offer
            ? {
                slug: offer.slug,
                kind: offer.kind,
                title: offer.title,
                badge: offer.badge,
                discountPercent: offer.discountPercent,
                discountAmount: offer.discountAmount,
                endsAt: offer.endsAt,
              }
            : null,
          available: found.available,
          lowStockThreshold: variant.lowStockThreshold,
          isDemo: true,
        };
      },
    };
  }

  quote(customerId: string | null, items: unknown, options: QuoteOptions = {}): Quote {
    return buildQuote(this.quoteContext(customerId), items, options);
  }

  // ── Account cart ─────────────────────────────────────────────────────────
  getCart(userId: string): AccountCart {
    return { items: this.state.carts[userId] ?? [] };
  }

  mergeCart(userId: string, items: CartItemInput[]): AccountCart {
    const engine = this.engine();
    const result = mergeCarts(
      this.state.carts[userId] ?? [],
      items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        savedForLater: i.savedForLater ?? false,
        seenUnitPrice: i.seenUnitPrice ?? null,
      })),
      {
        maxPerLine: this.settings().commerce.maxQuantityPerLine,
        exists: (id) => engine.variant(id) !== null,
        available: (id) => engine.variant(id)?.available ?? 0,
        now: this.now(),
      },
    );
    this.state.carts[userId] = result.items;
    this.persist();
    return result;
  }

  setCartItem(
    userId: string,
    variantId: string,
    quantity: number,
    saved = false,
    seen: number | null = null,
  ) {
    const lines = this.state.carts[userId] ?? [];
    const max = this.settings().commerce.maxQuantityPerLine;
    if (quantity <= 0) this.state.carts[userId] = lines.filter((l) => l.variantId !== variantId);
    else if (this.engine().variant(variantId)) {
      const existing = lines.find((l) => l.variantId === variantId);
      const next: AccountCartItem = {
        variantId,
        quantity: Math.min(quantity, max),
        savedForLater: saved,
        seenUnitPrice: seen ?? existing?.seenUnitPrice ?? null,
        addedAt: existing?.addedAt ?? this.now().toISOString(),
      };
      this.state.carts[userId] = existing
        ? lines.map((l) => (l.variantId === variantId ? next : l))
        : [...lines, next];
    }
    this.persist();
    return this.getCart(userId);
  }

  // ── Checkout ─────────────────────────────────────────────────────────────
  createOrder(actor: DemoActor, payload: CreateOrderPayload): CreateOrderResult {
    const uid = actor.userId;
    if (!uid) return { ok: false, code: 'auth_required' };
    if (!payload.idempotencyKey)
      return { ok: false, code: 'invalid_request', field: 'idempotencyKey' };
    const existing = this.state.orders.find(
      (o) => o.customerId === uid && o.idempotencyKey === payload.idempotencyKey,
    );
    if (existing) return { ok: true, duplicate: true, order: this.customerView(existing) };

    const settings = this.settings();
    const name = payload.contact.name.trim();
    if (name.length < 2 || name.length > 120)
      return { ok: false, code: 'invalid_name', field: 'contact.name' };
    const phone = normalizeEgyptianPhone(payload.contact.phone);
    if (!phone || !isEgyptianMobile(payload.contact.phone))
      return { ok: false, code: 'invalid_phone', field: 'contact.phone' };

    const fulfillment = payload.fulfillment;
    let pickupBranch: StaffOrder['fulfillment']['pickupBranch'] = null;
    if (fulfillment.method === 'pickup') {
      const branch = settings.store.branches.find(
        (b) => b.pickupEnabled && (fulfillment.branchId === null || b.id === fulfillment.branchId),
      );
      if (!branch) return { ok: false, code: 'pickup_unavailable', field: 'fulfillment.branchId' };
      pickupBranch = {
        id: branch.id,
        name: branch.name,
        address: branch.address,
        landmark: branch.landmark,
        city: branch.city,
        phones: branch.phones,
      };
    } else if (fulfillment.method === 'delivery') {
      if (!/^[a-z_]{2,40}$/.test(fulfillment.governorate.trim().toLowerCase()))
        return { ok: false, code: 'invalid_address', field: 'fulfillment.governorate' };
      if (fulfillment.area.trim().length < 2 || fulfillment.area.trim().length > 120)
        return { ok: false, code: 'invalid_address', field: 'fulfillment.area' };
      if (fulfillment.address.trim().length < 5 || fulfillment.address.trim().length > 400)
        return { ok: false, code: 'invalid_address', field: 'fulfillment.address' };
      if ((fulfillment.notes ?? '').length > 400)
        return { ok: false, code: 'invalid_address', field: 'fulfillment.notes' };
    } else {
      return { ok: false, code: 'invalid_fulfillment', field: 'fulfillment.method' };
    }
    if ((payload.note ?? '').length > 500)
      return { ok: false, code: 'invalid_request', field: 'note' };

    const method = payload.payment.method;
    if (method === 'pay_at_store') {
      if (fulfillment.method !== 'pickup' || !settings.features.payAtStore)
        return { ok: false, code: 'payment_method_unavailable', field: 'payment.method' };
    } else if (
      !['cod', 'instapay', 'split'].includes(method) ||
      !settings.commerce.paymentMethods[method]
    ) {
      return { ok: false, code: 'payment_method_unavailable', field: 'payment.method' };
    }

    const open = this.state.orders.filter(
      (o) => o.customerId === uid && OPEN_ORDER_STATUSES.includes(o.status),
    );
    if (open.length >= settings.commerce.maxOpenOrdersPerCustomer)
      return { ok: false, code: 'too_many_open_orders' };

    const promoCode = payload.promoCode?.trim() ? payload.promoCode.trim() : null;
    const quote = this.quote(uid, payload.items, { promoCode, fulfillment: fulfillment.method });
    if (quote.lines.length === 0) return { ok: false, code: 'cart_empty', quote };
    if (!quote.valid) return { ok: false, code: 'cart_invalid', quote };
    if (promoCode && quote.promo?.status !== 'applied')
      return { ok: false, code: 'promo_invalid', quote };

    const expectedByVariant = new Map(
      (payload.items as QuoteItemInput[]).map((i) => [i.variantId, i.expectedUnitPrice ?? null]),
    );
    const mismatch = quote.lines.some(
      (l) => !l.isGift && expectedByVariant.get(l.variantId) !== l.unitPrice,
    );
    if (
      mismatch ||
      typeof payload.expectedTotal !== 'number' ||
      payload.expectedTotal !== quote.totals.total
    )
      return { ok: false, code: 'price_changed', quote };

    const itemsTotal = subtractMoney(quote.totals.subtotal, quote.totals.discountTotal);
    let deposit: number | null = null;
    if (method === 'split' && typeof payload.payment.depositAmount === 'number') {
      deposit = Math.round(payload.payment.depositAmount * 100) / 100;
      if (deposit <= 0 || deposit >= itemsTotal)
        return { ok: false, code: 'invalid_deposit', field: 'payment.depositAmount' };
    }

    const now = this.now();
    const reasons = manualReviewReasons(settings.orderReview, {
      itemsTotal,
      lines: quote.lines
        .filter((l) => l.status === 'ok')
        .map((l) => ({ unitPrice: l.unitPrice ?? 0, quantity: l.quantity, isGift: l.isGift })),
      paymentMethod: method,
      history: this.state.orders.filter((o) => o.customerId === uid),
      now,
    });

    this.state.seq += 1;
    const prefix = settings.commerce.orderNumberPrefix;
    const year = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
    }).format(now);
    const orderNumber = `${prefix}-${year}-${String(this.state.seq).padStart(6, '0')}`;
    const id = `demo-order-${this.state.seq}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(
      now.getTime() + settings.commerce.reservationMinutes * 60_000,
    ).toISOString();
    const at = now.toISOString();
    const okLines = quote.lines.filter((l) => l.status === 'ok');

    const order: DemoOrderRecord = {
      id,
      orderNumber,
      idempotencyKey: payload.idempotencyKey,
      createdAt: at,
      updatedAt: at,
      locale: payload.locale,
      status: 'new',
      paymentMethod: method,
      paymentStatus: initialPaymentStatus(method),
      customer: {
        name,
        phone,
        phoneDisplay: payload.contact.phone.slice(0, 30),
        email: actor.email,
      },
      fulfillment: {
        method: fulfillment.method,
        pickupBranch,
        governorate:
          fulfillment.method === 'delivery' ? fulfillment.governorate.trim().toLowerCase() : null,
        area: fulfillment.method === 'delivery' ? fulfillment.area.trim() : null,
        address: fulfillment.method === 'delivery' ? fulfillment.address.trim() : null,
        notes: fulfillment.method === 'delivery' ? fulfillment.notes?.trim() || null : null,
        eta: null,
        courier: null,
        trackingNumber: null,
      },
      items: okLines.map((l) => ({
        lineNo: l.lineNo,
        productSlug: l.productSlug ?? '',
        productName: l.name ?? { ar: l.sku ?? '' },
        brandName: l.brand,
        variantLabel: l.variantLabel,
        options: l.options,
        imageUrl: l.image,
        sku: l.sku ?? '',
        warranty: l.warranty,
        regularUnitPrice: l.regularUnitPrice ?? 0,
        unitPrice: l.unitPrice ?? 0,
        quantity: l.quantity,
        lineSubtotal: l.lineSubtotal ?? 0,
        discountAmount: l.discount,
        lineTotal: l.lineTotal ?? 0,
        appliedOffer: l.offer,
        discounts: l.discounts,
        isGift: l.isGift,
      })),
      totals: {
        originalSubtotal: quote.totals.originalSubtotal,
        subtotal: quote.totals.subtotal,
        discountTotal: quote.totals.discountTotal,
        shippingFee: quote.totals.shippingFee,
        shippingFeeStatus: quote.totals.shippingFeeStatus,
        total: quote.totals.total,
        paidAmount: 0,
        remainingAmount: quote.totals.total,
        splitDepositAmount: deposit,
      },
      promoCode: quote.promo?.status === 'applied' ? quote.promo.code : null,
      customerNote: payload.note?.trim() || null,
      reservationExpiresAt: expiresAt,
      stockCommitted: false,
      reviewPending: reasons.length > 0,
      canCancel: true,
      cancelledAt: null,
      isDemo: true,
      customerId: uid,
      manualReview: {
        required: reasons.length > 0,
        status: reasons.length > 0 ? 'pending' : 'not_required',
        reasons,
        reviewedAt: null,
        note: null,
      },
      staffNote: null,
      assignedStaffId: null,
      cancelReason: null,
      payments: [],
      reservations: okLines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        status: 'active',
        expiresAt,
      })),
      events: [
        this.event(
          'status',
          { status: 'new', data: { total: quote.totals.total } },
          true,
          'customer',
        ),
        this.event('reservation', { data: { action: 'reserved', expiresAt } }, false, 'system'),
        ...(reasons.length
          ? [this.event('review', { status: 'pending', data: { reasons } }, false, 'system')]
          : []),
      ],
    };
    this.state.orders.push(order);
    if (quote.promo?.status === 'applied') {
      const offer = this.raw.offers.find(
        (o) => o.slug === (quote.promo as { offerSlug: string }).offerSlug,
      );
      if (offer)
        this.state.redemptions.push({
          offerId: offer.id,
          orderId: id,
          customerId: uid,
          code: quote.promo.code,
          amount: quote.promo.discount,
          status: 'active',
        });
    }
    const ordered = new Set(okLines.map((l) => l.variantId));
    this.state.carts[uid] = (this.state.carts[uid] ?? []).filter(
      (l) => l.savedForLater || !ordered.has(l.variantId),
    );
    this.persist();
    return { ok: true, duplicate: false, order: this.customerView(order) };
  }

  // ── Customer reads ───────────────────────────────────────────────────────
  getMyOrder(userId: string | null, orderNumber: string): Order | null {
    if (!userId) return null;
    const order = this.state.orders.find(
      (o) => o.customerId === userId && o.orderNumber === orderNumber.trim().toUpperCase(),
    );
    return order ? this.customerView(order) : null;
  }

  listMyOrders(userId: string | null): OrderSummary[] {
    if (!userId) return [];
    return this.state.orders
      .filter((o) => o.customerId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        fulfillmentMethod: o.fulfillment.method,
        shippingFeeStatus: o.totals.shippingFeeStatus,
        total: o.totals.total,
        remainingAmount: o.totals.remainingAmount,
        isDemo: true,
        itemCount: o.items.filter((i) => !i.isGift).reduce((n, i) => n + i.quantity, 0),
        firstItem: o.items[0]
          ? {
              name: o.items[0].productName,
              variantLabel: o.items[0].variantLabel,
              imageUrl: o.items[0].imageUrl,
            }
          : null,
      }));
  }

  cancelMyOrder(userId: string | null, orderNumber: string, reason: string | null) {
    const order = this.state.orders.find(
      (o) => o.customerId === userId && o.orderNumber === orderNumber.trim().toUpperCase(),
    );
    if (!order) return { ok: false as const, code: 'not_found' };
    if (!this.canCancel(order))
      return { ok: false as const, code: 'cannot_cancel', order: this.customerView(order) };
    this.cancelInternal(order, reason?.trim() || 'customer_request', 'customer');
    this.persist();
    return { ok: true as const, order: this.customerView(order) };
  }

  // ── Staff ────────────────────────────────────────────────────────────────
  private require(actor: DemoActor, permission: PermissionKey) {
    if (!actor.userId || !actor.can(permission))
      throw new PermissionError(`permission denied: ${permission}`);
  }

  listOrders(
    actor: DemoActor,
    filter: StaffOrderFilter = {},
  ): { total: number; items: StaffOrderSummary[] } {
    this.require(actor, 'orders.view');
    const q = filter.q?.trim().toLowerCase();
    const digits = q?.replace(/[^0-9]/g, '');
    const matched = this.state.orders
      .filter(
        (o) =>
          (!filter.status || o.status === filter.status) &&
          (!filter.paymentStatus || o.paymentStatus === filter.paymentStatus) &&
          (!filter.reviewPending || o.manualReview.status === 'pending') &&
          (!q ||
            o.orderNumber.toLowerCase().includes(q) ||
            o.customer.name.toLowerCase().includes(q) ||
            (digits !== undefined && digits.length > 0 && o.customer.phone.includes(digits))),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    const offset = Math.max(filter.offset ?? 0, 0);
    return {
      total: matched.length,
      items: matched.slice(offset, offset + limit).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        fulfillmentMethod: o.fulfillment.method,
        shippingFeeStatus: o.totals.shippingFeeStatus,
        total: o.totals.total,
        paidAmount: o.totals.paidAmount,
        remainingAmount: o.totals.remainingAmount,
        customerName: o.customer.name,
        customerPhone: o.customer.phone,
        reviewPending: o.manualReview.status === 'pending',
        reservationExpiresAt: o.reservationExpiresAt,
        stockCommitted: o.stockCommitted,
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
        isDemo: true,
      })),
    };
  }

  getOrder(actor: DemoActor, orderId: string): StaffOrder | null {
    this.require(actor, 'orders.view');
    const order = this.state.orders.find((o) => o.id === orderId);
    return order ? this.staffView(order) : null;
  }

  private find(orderId: string) {
    return this.state.orders.find((o) => o.id === orderId) ?? null;
  }

  private done(order: DemoOrderRecord): StaffActionResult {
    order.updatedAt = this.now().toISOString();
    this.persist();
    return { ok: true, order: this.staffView(order) };
  }

  setStatus(
    actor: DemoActor,
    orderId: string,
    status: OrderStatus,
    note: string | null,
  ): StaffActionResult {
    this.require(actor, 'orders.manage');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (status === 'cancelled') return { ok: false, code: 'use_cancel' };
    if (!orderTransitionAllowed(order.status, status, order.fulfillment.method))
      return { ok: false, code: 'invalid_transition' };
    if (status === 'confirmed') {
      if (order.manualReview.status === 'pending') return { ok: false, code: 'review_pending' };
      if (order.manualReview.status === 'rejected') return { ok: false, code: 'review_rejected' };
      if (order.fulfillment.method === 'delivery' && order.totals.shippingFeeStatus !== 'confirmed')
        return { ok: false, code: 'shipping_fee_pending' };
      if (order.paymentMethod === 'instapay' && order.paymentStatus !== 'paid')
        return { ok: false, code: 'payment_not_verified' };
      if (order.paymentMethod === 'split' && order.totals.paidAmount <= 0)
        return { ok: false, code: 'deposit_not_verified' };
      const commit = this.commitStock(order);
      if (commit) return { ...commit, order: this.staffView(order) };
    } else if (status === 'completed' && order.totals.remainingAmount > 0) {
      return { ok: false, code: 'balance_due' };
    }
    order.events.push(
      this.event('status', { status, fromStatus: order.status, note }, true, 'staff'),
    );
    order.status = status;
    return this.done(order);
  }

  private commitStock(order: DemoOrderRecord): Extract<StaffActionResult, { ok: false }> | null {
    if (order.stockCommitted) return null;
    const nowMs = this.now().getTime();
    const failing = order.reservations.filter((r) => {
      if (r.status !== 'active' && r.status !== 'expired') return false;
      const stock =
        (this.raw.products.flatMap((p) => p.variants).find((v) => v.id === r.variantId)?.stock ??
          0) + this.stockDelta(r.variantId);
      const live = r.status === 'active' && new Date(r.expiresAt).getTime() > nowMs;
      return (
        stock < r.quantity ||
        (!live && stock - this.reservedQuantity(r.variantId, order.id) < r.quantity)
      );
    });
    if (failing.length) {
      return {
        ok: false,
        code: 'stock_unavailable',
        lines: failing.map((r) => ({
          variantId: r.variantId,
          sku:
            this.raw.products.flatMap((p) => p.variants).find((v) => v.id === r.variantId)?.sku ??
            '',
          quantity: r.quantity,
        })),
      };
    }
    for (const r of order.reservations) {
      if (r.status !== 'active' && r.status !== 'expired') continue;
      this.state.stockDelta[r.variantId] = this.stockDelta(r.variantId) - r.quantity;
      const base =
        this.raw.products.flatMap((p) => p.variants).find((v) => v.id === r.variantId)?.stock ?? 0;
      this.state.movements.push({
        variantId: r.variantId,
        delta: -r.quantity,
        quantityAfter: base + this.stockDelta(r.variantId),
        reason: 'sale',
        orderId: order.id,
        at: this.now().toISOString(),
      });
      r.status = 'committed';
    }
    order.stockCommitted = true;
    order.reservationExpiresAt = null;
    order.events.push(this.event('reservation', { data: { action: 'committed' } }, false, 'staff'));
    return null;
  }

  cancel(actor: DemoActor, orderId: string, reason: string): StaffActionResult {
    this.require(actor, 'orders.manage');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (order.status === 'cancelled') return { ok: false, code: 'already_cancelled' };
    if (['out_for_delivery', 'delivered', 'completed'].includes(order.status))
      return { ok: false, code: 'cannot_cancel' };
    if (order.totals.paidAmount > 0) return { ok: false, code: 'refund_required' };
    if (reason.trim().length < 3) return { ok: false, code: 'reason_required' };
    this.cancelInternal(order, reason.trim(), 'staff');
    return this.done(order);
  }

  setShipping(
    actor: DemoActor,
    orderId: string,
    input: {
      fee: number | null;
      eta?: string | null;
      courier?: string | null;
      tracking?: string | null;
      note?: string | null;
    },
  ): StaffActionResult {
    this.require(actor, 'shipping.manage');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (order.fulfillment.method !== 'delivery') return { ok: false, code: 'not_delivery' };
    if (['cancelled', 'completed', 'delivered'].includes(order.status))
      return { ok: false, code: 'order_closed' };
    const fromFee = order.totals.shippingFee;
    if (input.fee !== null) {
      if (input.fee < 0 || input.fee > 100_000) return { ok: false, code: 'invalid_fee' };
      const fee = Math.round(input.fee * 100) / 100;
      const total = addMoney(subtractMoney(order.totals.subtotal, order.totals.discountTotal), fee);
      if (total < order.totals.paidAmount) return { ok: false, code: 'would_overpay' };
      order.totals.shippingFee = fee;
      order.totals.shippingFeeStatus = 'confirmed';
      order.totals.total = total;
      order.totals.remainingAmount = subtractMoney(total, order.totals.paidAmount);
    }
    const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
    order.fulfillment.eta = clean(input.eta) ?? order.fulfillment.eta;
    order.fulfillment.courier = clean(input.courier) ?? order.fulfillment.courier;
    order.fulfillment.trackingNumber = clean(input.tracking) ?? order.fulfillment.trackingNumber;
    this.refreshPaymentStatus(order);
    order.events.push(
      this.event(
        'shipping',
        {
          note: input.note ?? null,
          data: {
            fromFee,
            toFee: order.totals.shippingFee,
            total: order.totals.total,
            eta: clean(input.eta),
            courier: clean(input.courier),
            trackingNumber: clean(input.tracking),
          },
        },
        true,
        'staff',
      ),
    );
    return this.done(order);
  }

  markPaymentVerification(
    actor: DemoActor,
    orderId: string,
    note: string | null,
  ): StaffActionResult {
    this.require(actor, 'orders.manage');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (['cancelled', 'completed'].includes(order.status))
      return { ok: false, code: 'order_closed' };
    if (!['instapay', 'split'].includes(order.paymentMethod) || order.totals.paidAmount > 0)
      return { ok: false, code: 'not_applicable' };
    order.paymentStatus = 'verification_pending';
    order.events.push(
      this.event('payment', { note, data: { action: 'verification_started' } }, true, 'staff'),
    );
    if (['new', 'awaiting_whatsapp', 'awaiting_payment'].includes(order.status)) {
      order.events.push(
        this.event(
          'status',
          { status: 'payment_verification', fromStatus: order.status },
          true,
          'staff',
        ),
      );
      order.status = 'payment_verification';
    }
    return this.done(order);
  }

  recordPayment(
    actor: DemoActor,
    orderId: string,
    input: {
      amount: number;
      method: 'instapay' | 'cash';
      reference?: string | null;
      note?: string | null;
    },
  ): StaffActionResult {
    this.require(actor, 'payments.verify');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (order.status === 'cancelled') return { ok: false, code: 'order_closed' };
    const amount = Math.round(input.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'invalid_amount' };
    if (!['instapay', 'cash'].includes(input.method)) return { ok: false, code: 'invalid_method' };
    if (amount > order.totals.remainingAmount) return { ok: false, code: 'exceeds_remaining' };
    const kind =
      order.paymentMethod === 'split' &&
      input.method === 'instapay' &&
      order.totals.paidAmount === 0 &&
      amount < order.totals.total
        ? 'deposit'
        : 'payment';
    order.payments.push({
      id: `demo-payment-${order.payments.length + 1}`,
      method: input.method,
      kind,
      amount,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      verifiedBy: actor.userId ?? '',
      verifiedAt: this.now().toISOString(),
    });
    order.totals.paidAmount = addMoney(order.totals.paidAmount, amount);
    order.totals.remainingAmount = subtractMoney(order.totals.total, order.totals.paidAmount);
    this.refreshPaymentStatus(order);
    order.events.push(
      this.event(
        'payment',
        {
          data: {
            action: kind === 'deposit' ? 'deposit_verified' : 'payment_verified',
            amount,
            method: input.method,
            paidAmount: order.totals.paidAmount,
            remainingAmount: order.totals.remainingAmount,
            paymentStatus: order.paymentStatus,
          },
        },
        true,
        'staff',
      ),
    );
    return this.done(order);
  }

  review(
    actor: DemoActor,
    orderId: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): StaffActionResult {
    this.require(actor, 'payments.verify');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (order.manualReview.status !== 'pending') return { ok: false, code: 'review_not_pending' };
    if (decision === 'rejected' && order.totals.paidAmount > 0)
      return { ok: false, code: 'refund_required' };
    order.manualReview = {
      ...order.manualReview,
      status: decision,
      reviewedAt: this.now().toISOString(),
      note: note?.trim() || null,
    };
    order.reviewPending = false;
    order.events.push(this.event('review', { status: decision, note }, false, 'staff'));
    if (decision === 'rejected' && order.status !== 'cancelled')
      this.cancelInternal(order, 'manual_review_rejected', 'staff');
    return this.done(order);
  }

  addNote(actor: DemoActor, orderId: string, note: string): StaffActionResult {
    this.require(actor, 'orders.manage');
    const order = this.find(orderId);
    if (!order) return { ok: false, code: 'not_found' };
    if (!note.trim()) return { ok: false, code: 'note_required' };
    order.events.push(this.event('note', { note: note.trim().slice(0, 1000) }, false, 'staff'));
    return this.done(order);
  }

  releaseExpiredReservations(actor: DemoActor): number {
    this.require(actor, 'orders.manage');
    const nowMs = this.now().getTime();
    let count = 0;
    for (const order of this.state.orders) {
      let hit = false;
      for (const r of order.reservations) {
        if (r.status === 'active' && new Date(r.expiresAt).getTime() <= nowMs) {
          r.status = 'expired';
          count += 1;
          hit = true;
        }
      }
      if (hit)
        order.events.push(
          this.event('reservation', { data: { action: 'expired' } }, false, 'system'),
        );
    }
    this.persist();
    return count;
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private event(
    type: OrderEvent['type'],
    fields: {
      status?: string;
      fromStatus?: string;
      note?: string | null;
      data?: Record<string, unknown>;
    },
    visible: boolean,
    actorKind: OrderEvent['actorKind'],
  ): DemoEvent {
    return {
      type,
      status: fields.status ?? null,
      fromStatus: fields.fromStatus ?? null,
      createdAt: this.now().toISOString(),
      data: fields.data ?? {},
      note: fields.note ?? null,
      actorKind,
      visible,
    };
  }

  private refreshPaymentStatus(order: DemoOrderRecord) {
    order.paymentStatus = derivedPaymentStatus({
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      total: order.totals.total,
      paidAmount: order.totals.paidAmount,
      shippingFeeStatus: order.totals.shippingFeeStatus,
    });
  }

  private canCancel(order: DemoOrderRecord) {
    return canCustomerCancel({
      status: order.status,
      paidAmount: order.totals.paidAmount,
      stockCommitted: order.stockCommitted,
    });
  }

  private cancelInternal(order: DemoOrderRecord, reason: string, actorKind: 'customer' | 'staff') {
    const restock = order.stockCommitted;
    for (const r of order.reservations) {
      if (r.status === 'committed') {
        this.state.stockDelta[r.variantId] = this.stockDelta(r.variantId) + r.quantity;
        this.state.movements.push({
          variantId: r.variantId,
          delta: r.quantity,
          quantityAfter:
            (this.raw.products.flatMap((p) => p.variants).find((v) => v.id === r.variantId)
              ?.stock ?? 0) + this.stockDelta(r.variantId),
          reason: 'cancellation_restock',
          orderId: order.id,
          at: this.now().toISOString(),
        });
      }
      if (r.status !== 'released') r.status = 'released';
    }
    for (const red of this.state.redemptions) if (red.orderId === order.id) red.status = 'released';
    order.events.push(
      this.event(
        'status',
        {
          status: 'cancelled',
          fromStatus: order.status,
          note: reason,
          data: { restocked: restock },
        },
        true,
        actorKind,
      ),
    );
    order.status = 'cancelled';
    order.cancelledAt = this.now().toISOString();
    order.cancelReason = reason;
    order.reservationExpiresAt = null;
    if (order.totals.paidAmount === 0) order.paymentStatus = 'void';
  }

  private staffView(order: DemoOrderRecord): StaffOrder {
    const { events, idempotencyKey: _key, ...rest } = order;
    return {
      ...structuredClone(rest),
      canCancel: this.canCancel(order),
      reviewPending: order.manualReview.status === 'pending',
      reservations: order.reservations.map((r) => ({
        ...r,
        status:
          r.status === 'active' && new Date(r.expiresAt).getTime() <= this.now().getTime()
            ? 'expired'
            : r.status,
      })),
      timeline: events.map(({ visible: _visible, ...e }) => ({ ...e })),
    };
  }

  private customerView(order: DemoOrderRecord): Order {
    const staff = this.staffView(order);
    const {
      customerId: _c,
      manualReview: _m,
      staffNote: _s,
      assignedStaffId: _a,
      cancelReason: _r,
      payments: _p,
      reservations: _res,
      ...customer
    } = staff;
    return {
      ...customer,
      timeline: order.events
        .filter((e) => e.visible)
        .map(({ visible: _visible, ...e }) => {
          const { reasons: _reasons, ...data } = e.data as Record<string, unknown> & {
            reasons?: unknown;
          };
          return { ...e, data, note: null };
        }),
    };
  }
}

export { PermissionError as DemoPermissionError };
