import type { PermissionKey } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import type { RawCatalog, RawProduct } from '@/domain/catalog/raw';
import type { ProductSummary } from '@/domain/catalog/types';
import type { DemoActor, DemoCommerce, DemoOrderRecord } from '@/domain/commerce/demoCommerce';
import type { LocalizedText } from '@/domain/localized';
import type { AbandonedCartSettings, EngagementSettings } from '@/domain/settings/schemas';
import { isEgyptianMobile, normalizeEgyptianPhone } from '@/lib/phone';
import { addressProblem } from './address';
import { renderNotification, type TemplateVars } from './templates';
import type {
  AbandonedCartRow,
  ActionResult,
  Address,
  AddressInput,
  AppNotification,
  CartStatus,
  CustomerProfileInput,
  MyRequests,
  NotificationCategory,
  NotificationChannel,
  NotificationPage,
  NotificationPreference,
  OwnReview,
  PublicReviews,
  RecentEntry,
  Recommendations,
  RequestClaim,
  RequestStatus,
  Review,
  ReviewEligibility,
  ReviewInput,
  StaffReview,
  WishlistView,
} from './types';

/**
 * DEMO MODE ONLY — in-browser mirror of the Phase 04 customer RPCs (same rules as
 * supabase/tests/sql/08_customer.test.sql). Orders, carts and stock come from the demo commerce
 * store; everything here is kept in this browser and flagged demo. Live mode never uses it.
 */

export interface DemoCustomerSettings {
  engagement: EngagementSettings;
  abandonedCart: AbandonedCartSettings;
}

interface DemoProfile {
  fullName: string | null;
  phone: string | null;
  preferredLocale: 'ar' | 'en';
  createdAt: string;
}

interface DemoWishlistRow {
  id: string;
  productId: string;
  variantId: string | null;
  referencePrice: number | null;
  lastNotifiedPrice: number | null;
  createdAt: string;
}

interface DemoRecentRow {
  productId: string;
  variantId: string | null;
  viewedAt: string;
}

interface DemoNotification extends AppNotification {
  userId: string;
  dedupeKey: string;
}

interface DemoRequest {
  id: string;
  kind: 'notify' | 'waitlist';
  userId: string | null;
  productId: string;
  variantId: string | null;
  name: string;
  phone: string;
  email: string | null;
  desiredStorage: string | null;
  desiredColor: string | null;
  /** notify: pending | available | notified | cancelled; waitlist: waiting | … */
  status: string;
  createdAt: string;
  availableAt: string | null;
  claimToken: string | null;
}

interface DemoReview {
  id: string;
  productId: string;
  userId: string;
  orderId: string;
  rating: number;
  title: string | null;
  body: string;
  imagePath: string | null;
  authorName: string;
  status: 'pending' | 'approved' | 'rejected';
  verifiedBuyer: boolean;
  moderationNote: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoCustomerState {
  version: 1;
  seq: number;
  profiles: Record<string, DemoProfile>;
  addresses: Record<string, Address[]>;
  wishlist: Record<string, DemoWishlistRow[]>;
  recent: Record<string, DemoRecentRow[]>;
  notifications: DemoNotification[];
  preferences: Record<string, Record<string, boolean>>;
  requests: DemoRequest[];
  reviews: DemoReview[];
}

export const emptyDemoCustomerState = (): DemoCustomerState => ({
  version: 1,
  seq: 0,
  profiles: {},
  addresses: {},
  wishlist: {},
  recent: {},
  notifications: [],
  preferences: {},
  requests: [],
  reviews: [],
});

export class DemoPermissionError extends Error {
  readonly code = '42501';
}

const NOTIFIABLE_STATUSES = [
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
];
const MANDATORY: NotificationCategory[] = ['order', 'account'];
const PREF_CATEGORIES = [
  'order',
  'back_in_stock',
  'waitlist',
  'price_drop',
  'review',
  'cart',
] as const;
const CHANNELS: NotificationChannel[] = ['in_app', 'email', 'whatsapp', 'sms'];

export class DemoCustomer {
  private readonly raw: RawCatalog;
  private readonly commerce: DemoCommerce;
  private readonly settings: () => DemoCustomerSettings;
  private readonly storage: {
    load(): DemoCustomerState | null;
    save(state: DemoCustomerState): void;
  };
  private readonly now: () => Date;
  private readonly random: () => string;
  private readonly engineProvider: () => CatalogEngine;
  private state: DemoCustomerState;

  constructor(options: {
    raw: RawCatalog;
    commerce: DemoCommerce;
    settings: () => DemoCustomerSettings;
    storage: { load(): DemoCustomerState | null; save(state: DemoCustomerState): void };
    now?: () => Date;
    random?: () => string;
    /** Cached catalog engine (the demo store caches it); defaults to building one per call. */
    engine?: () => CatalogEngine;
  }) {
    this.raw = options.raw;
    this.commerce = options.commerce;
    this.settings = options.settings;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? (() => crypto.randomUUID());
    this.engineProvider = options.engine ?? (() => this.commerce.engine());
    this.state = this.storage.load() ?? emptyDemoCustomerState();
  }

  private persist() {
    this.storage.save(this.state);
  }

  private nextId(prefix: string) {
    this.state.seq += 1;
    return `demo-${prefix}-${this.state.seq}-${this.random().slice(0, 8)}`;
  }

  private iso() {
    return this.now().toISOString();
  }

  private require(actor: DemoActor, permission: PermissionKey) {
    if (!actor.userId || !actor.can(permission))
      throw new DemoPermissionError(`missing ${permission}`);
    return actor.userId;
  }

  // ── Catalog helpers ──────────────────────────────────────────────────────
  private engine(): CatalogEngine {
    return this.engineProvider();
  }

  private productById(id: string): RawProduct | undefined {
    return this.raw.products.find((p) => p.id === id);
  }

  private productBySlug(slug: string): RawProduct | undefined {
    return this.raw.products.find((p) => p.slug === slug);
  }

  private summary(product: RawProduct): ProductSummary | null {
    return this.engine().summaries([product.slug])[0] ?? null;
  }

  summariesByIds(ids: string[]): ProductSummary[] {
    const slugs = ids
      .slice(0, 50)
      .map((id) => this.productById(id)?.slug)
      .filter((s): s is string => Boolean(s));
    const bySlug = new Map(
      this.engine()
        .summaries(slugs)
        .map((s) => [s.slug, s]),
    );
    return slugs.map((s) => bySlug.get(s)).filter((s): s is ProductSummary => Boolean(s));
  }

  private currentPrice(productId: string, variantId: string | null): number | null {
    const product = this.productById(productId);
    if (!product) return null;
    const engine = this.engine();
    const prices = product.variants
      .filter((v) => (variantId ? v.id === variantId : v.isActive))
      .map((v) => engine.variant(v.id)?.price ?? null)
      .filter((p): p is number => p !== null);
    return prices.length ? Math.min(...prices) : null;
  }

  private variantRef(productId: string, variantId: string | null) {
    if (!variantId) return null;
    const product = this.productById(productId);
    const variant = product?.variants.find((v) => v.id === variantId);
    if (!product || !variant) return null;
    const parts = product.options
      .map((o) => {
        const value = o.values.find((v) => v.key === variant.options[o.key]);
        return value ? value.label : null;
      })
      .filter((l): l is LocalizedText => l !== null);
    const label: LocalizedText | null = parts.length
      ? { ar: parts.map((p) => p.ar).join(' · '), en: parts.map((p) => p.en ?? p.ar).join(' · ') }
      : null;
    return { sku: variant.sku, label };
  }

  private validTarget(productId: string, variantId: string | null): boolean {
    const product = this.productById(productId);
    if (!product || !this.summary(product)) return false;
    return variantId === null || product.variants.some((v) => v.id === variantId);
  }

  // ── Profile & addresses ─────────────────────────────────────────────────
  profile(userId: string): DemoProfile {
    const existing = this.state.profiles[userId];
    if (existing) return existing;
    const created: DemoProfile = {
      fullName: null,
      phone: null,
      preferredLocale: 'ar',
      createdAt: this.iso(),
    };
    this.state.profiles[userId] = created;
    this.persist();
    return created;
  }

  /** Checkout fills name / phone once when the profile has none (like create_order). */
  fillProfileFromOrder(userId: string, name: string, phone: string) {
    const p = this.profile(userId);
    this.state.profiles[userId] = {
      ...p,
      fullName: p.fullName ?? name,
      phone: p.phone ?? normalizeEgyptianPhone(phone),
    };
    this.persist();
  }

  updateProfile(userId: string, input: CustomerProfileInput): ActionResult {
    const name = input.fullName.trim();
    if (name && (name.length < 2 || name.length > 120))
      return { ok: false, code: 'invalid_name', field: 'fullName' };
    let phone: string | null = null;
    if (input.phone.trim()) {
      if (!isEgyptianMobile(input.phone))
        return { ok: false, code: 'invalid_phone', field: 'phone' };
      phone = normalizeEgyptianPhone(input.phone);
    }
    const p = this.profile(userId);
    this.state.profiles[userId] = {
      ...p,
      fullName: name || null,
      phone,
      preferredLocale: input.preferredLocale,
    };
    this.persist();
    return { ok: true };
  }

  listAddresses(userId: string): Address[] {
    return [...(this.state.addresses[userId] ?? [])].sort((a, b) =>
      a.isDefault === b.isDefault ? a.createdAt.localeCompare(b.createdAt) : a.isDefault ? -1 : 1,
    );
  }

  saveAddress(userId: string, input: AddressInput): ActionResult & { address?: Address } {
    const problem = addressProblem(input);
    if (problem) return { ok: false, code: 'invalid_address', field: problem };
    let phone: string | null = null;
    if (input.phone?.trim()) {
      if (!isEgyptianMobile(input.phone))
        return { ok: false, code: 'invalid_phone', field: 'phone' };
      phone = normalizeEgyptianPhone(input.phone);
    }
    const list = this.state.addresses[userId] ?? [];
    const existing = input.id ? list.find((a) => a.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, code: 'not_found' };
    if (!existing && list.length >= 10) return { ok: false, code: 'too_many_addresses' };
    const makeDefault = input.isDefault || list.filter((a) => a.id !== input.id).length === 0;
    const now = this.iso();
    const address: Address = {
      id: existing?.id ?? this.nextId('address'),
      label: input.label,
      governorate: input.governorate.trim().toLowerCase(),
      area: input.area.trim(),
      address: input.address.trim(),
      notes: input.notes?.trim() || null,
      phone,
      isDefault: makeDefault || (existing?.isDefault ?? false),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const others = list
      .filter((a) => a.id !== address.id)
      .map((a) => (address.isDefault ? { ...a, isDefault: false } : a));
    this.state.addresses[userId] = [...others, address];
    this.persist();
    return { ok: true, address };
  }

  deleteAddress(userId: string, id: string): ActionResult {
    const list = this.state.addresses[userId] ?? [];
    const target = list.find((a) => a.id === id);
    if (!target) return { ok: false, code: 'not_found' };
    let next = list.filter((a) => a.id !== id);
    if (target.isDefault && next.length > 0) {
      const oldest = [...next].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      next = next.map((a) => (a.id === oldest?.id ? { ...a, isDefault: true } : a));
    }
    this.state.addresses[userId] = next;
    this.persist();
    return { ok: true };
  }

  // ── Notifications ───────────────────────────────────────────────────────
  private prefEnabled(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ) {
    if (channel !== 'in_app') return false;
    if (MANDATORY.includes(category)) return true;
    return this.state.preferences[userId]?.[`${category}:${channel}`] ?? true;
  }

  /** Idempotent on (user, dedupeKey). Returns true when a new notification was created. */
  private notify(
    userId: string | null,
    templateKey: string,
    vars: TemplateVars,
    dedupeKey: string,
    actionPath: string | null,
    data: Record<string, unknown> = {},
  ): boolean {
    if (!userId) return false;
    const rendered = renderNotification(templateKey, vars);
    if (!rendered) return false;
    if (!this.prefEnabled(userId, rendered.category, 'in_app')) return false;
    if (this.state.notifications.some((n) => n.userId === userId && n.dedupeKey === dedupeKey))
      return false;
    this.state.notifications.push({
      id: this.nextId('notification'),
      userId,
      dedupeKey,
      category: rendered.category,
      title: rendered.title,
      body: rendered.body,
      actionPath,
      data,
      readAt: null,
      createdAt: this.iso(),
      isDemo: true,
    });
    return true;
  }

  /** Order status events → notifications (dedupe per order + status), like the SQL trigger. */
  private syncOrderNotifications(userId: string) {
    for (const order of this.commerce.orderRecords()) {
      if (order.customerId !== userId) continue;
      for (const event of order.events) {
        if (
          event.type !== 'status' ||
          !event.visible ||
          event.actorKind === 'customer' ||
          !event.status ||
          !NOTIFIABLE_STATUSES.includes(event.status)
        )
          continue;
        this.notify(
          userId,
          `order.${event.status}`,
          { order_number: order.orderNumber, customer_name: order.customer.name },
          `order:${order.id}:${event.status}`,
          `/order/${order.orderNumber}`,
          { orderNumber: order.orderNumber, status: event.status },
        );
      }
    }
  }

  private expired(createdAt: string) {
    const days = this.settings().engagement.requests.expireAfterDays;
    return this.now().getTime() - new Date(createdAt).getTime() > days * 86_400_000;
  }

  private processStockAlerts(userId: string | null, requestId?: string) {
    const engine = this.engine();
    for (const r of this.state.requests) {
      if (r.kind !== 'notify' || r.status !== 'pending' || this.expired(r.createdAt)) continue;
      if (userId !== null && r.userId !== userId) continue;
      if (requestId && r.id !== requestId) continue;
      const product = this.productById(r.productId);
      if (!product || product.availabilityState !== 'available' || !this.summary(product)) continue;
      const buyable = product.variants.some((v) => {
        if (r.variantId && v.id !== r.variantId) return false;
        const ev = engine.variant(v.id);
        return Boolean(ev && ev.price !== null && ev.available > 0 && v.isActive);
      });
      if (!buyable) continue;
      r.availableAt = this.iso();
      if (r.userId) {
        this.notify(
          r.userId,
          'stock.back_in_stock',
          { product_name: product.name },
          `stock:${r.id}`,
          `/product/${product.slug}`,
          {
            productId: product.id,
            variantId: r.variantId,
          },
        );
        r.status = 'notified';
      } else r.status = 'available';
    }
  }

  private processWaitlist(userId: string | null) {
    for (const r of this.state.requests) {
      if (r.kind !== 'waitlist' || r.status !== 'waiting' || this.expired(r.createdAt)) continue;
      if (userId !== null && r.userId !== userId) continue;
      const product = this.productById(r.productId);
      if (!product || !['available', 'pre_order'].includes(product.availabilityState)) continue;
      r.availableAt = this.iso();
      if (r.userId) {
        this.notify(
          r.userId,
          product.availabilityState === 'pre_order' ? 'waitlist.pre_order' : 'waitlist.available',
          { product_name: product.name },
          `waitlist:${r.id}:${product.availabilityState}`,
          `/product/${product.slug}`,
          { productId: product.id, state: product.availabilityState },
        );
        r.status = 'notified';
      } else r.status = 'available';
    }
  }

  private processPriceDrops(userId: string) {
    const pct = this.settings().engagement.wishlist.priceDropPercent;
    for (const w of this.state.wishlist[userId] ?? []) {
      if (w.referencePrice === null) continue;
      const now = this.currentPrice(w.productId, w.variantId);
      const product = this.productById(w.productId);
      if (now === null || !product) continue;
      if (now > (w.referencePrice * (100 - pct)) / 100) continue;
      if (w.lastNotifiedPrice !== null && now >= w.lastNotifiedPrice) continue;
      const amount = now.toLocaleString('en-US');
      this.notify(
        userId,
        'price.drop',
        { product_name: product.name, amount: { ar: `${amount} ج.م.`, en: `EGP ${amount}` } },
        `price:${w.id}:${now}`,
        `/product/${product.slug}`,
        { productId: product.id, price: now, was: w.referencePrice },
      );
      w.lastNotifiedPrice = now;
    }
  }

  private cartActivity(userId: string) {
    const items = this.commerce.getCart(userId).items;
    const activity =
      this.commerce.cartActivity(userId) ??
      items.reduce<string | null>(
        (max, i) => (max === null || i.addedAt > max ? i.addedAt : max),
        null,
      );
    const itemCount = items.filter((i) => !i.savedForLater).reduce((n, i) => n + i.quantity, 0);
    const converted =
      activity !== null &&
      this.commerce.orderRecords().some((o) => o.customerId === userId && o.createdAt >= activity);
    return { itemCount, activity, converted };
  }

  cartStatus(userId: string): CartStatus {
    const { itemCount, activity } = this.cartActivity(userId);
    return { itemCount, lastActivity: activity, abandoned: this.isAbandoned(userId) };
  }

  private isAbandoned(userId: string) {
    const cfg = this.settings().abandonedCart;
    const { itemCount, activity, converted } = this.cartActivity(userId);
    if (!cfg.enabled || itemCount === 0 || converted || activity === null) return false;
    return this.now().getTime() - new Date(activity).getTime() > cfg.thresholdHours * 3_600_000;
  }

  private processAbandonedCart(userId: string) {
    if (this.settings().abandonedCart.followUp !== 'in_app' || !this.isAbandoned(userId)) return;
    const { itemCount, activity } = this.cartActivity(userId);
    this.notify(
      userId,
      'cart.abandoned',
      {},
      `cart:${Math.floor(new Date(activity ?? 0).getTime() / 1000)}`,
      '/cart',
      {
        itemCount,
      },
    );
  }

  /** Lazy per-user refresh (the SQL runs the same processing on inbox / request reads). */
  refresh(userId: string) {
    this.syncOrderNotifications(userId);
    this.processStockAlerts(userId);
    this.processWaitlist(userId);
    this.processPriceDrops(userId);
    this.processAbandonedCart(userId);
    this.persist();
  }

  listNotifications(
    userId: string,
    options: { limit?: number; before?: string | null; unreadOnly?: boolean } = {},
  ): NotificationPage {
    this.refresh(userId);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const mine = this.state.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) =>
        a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
      );
    const page = mine.filter(
      (n) =>
        (!options.before || n.createdAt < options.before) &&
        (!options.unreadOnly || n.readAt === null),
    );
    return {
      items: page.slice(0, limit).map(({ userId: _u, dedupeKey: _d, ...n }) => n),
      hasMore: page.length > limit,
      unreadCount: mine.filter((n) => n.readAt === null).length,
    };
  }

  unreadCount(userId: string): number {
    this.syncOrderNotifications(userId);
    this.persist();
    return this.state.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
  }

  markRead(userId: string, id: string): number {
    const n = this.state.notifications.find((x) => x.id === id && x.userId === userId);
    if (n && !n.readAt) n.readAt = this.iso();
    this.persist();
    return this.state.notifications.filter((x) => x.userId === userId && x.readAt === null).length;
  }

  markAllRead(userId: string): number {
    for (const n of this.state.notifications)
      if (n.userId === userId && !n.readAt) n.readAt = this.iso();
    this.persist();
    return 0;
  }

  preferences(userId: string): NotificationPreference[] {
    return PREF_CATEGORIES.map((category) => ({
      category,
      mandatory: MANDATORY.includes(category),
      channels: Object.fromEntries(
        CHANNELS.map((channel) => [
          channel,
          { available: channel === 'in_app', enabled: this.prefEnabled(userId, category, channel) },
        ]),
      ) as NotificationPreference['channels'],
    }));
  }

  setPreference(
    userId: string,
    category: string,
    channel: NotificationChannel,
    enabled: boolean,
  ): ActionResult {
    if (!(PREF_CATEGORIES as readonly string[]).includes(category) || !CHANNELS.includes(channel))
      return { ok: false, code: 'invalid_preference' };
    if (channel !== 'in_app') return { ok: false, code: 'channel_unavailable' };
    if (MANDATORY.includes(category as NotificationCategory) && !enabled)
      return { ok: false, code: 'mandatory_category' };
    this.state.preferences[userId] = {
      ...this.state.preferences[userId],
      [`${category}:${channel}`]: enabled,
    };
    this.persist();
    return { ok: true };
  }

  // ── Wishlist ────────────────────────────────────────────────────────────
  wishlist(userId: string): WishlistView {
    this.processPriceDrops(userId);
    this.persist();
    return this.wishlistView(userId);
  }

  private wishlistView(userId: string): WishlistView {
    const rows = [...(this.state.wishlist[userId] ?? [])].sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
    );
    return {
      items: rows.map((w) => {
        const product = this.productById(w.productId);
        return {
          id: w.id,
          productId: w.productId,
          variantId: w.variantId,
          addedAt: w.createdAt,
          referencePrice: w.referencePrice,
          currentPrice: this.currentPrice(w.productId, w.variantId),
          product: product ? this.summary(product) : null,
          variant: this.variantRef(w.productId, w.variantId),
        };
      }),
    };
  }

  setWishlist(
    userId: string,
    productId: string,
    variantId: string | null,
    saved: boolean,
  ): ActionResult & { saved?: boolean } {
    const list = this.state.wishlist[userId] ?? [];
    const same = (w: DemoWishlistRow) => w.productId === productId && w.variantId === variantId;
    if (!saved) {
      this.state.wishlist[userId] = list.filter((w) => !same(w));
      this.persist();
      return { ok: true, saved: false };
    }
    if (!this.validTarget(productId, variantId)) return { ok: false, code: 'not_found' };
    if (list.some(same)) return { ok: true, saved: true };
    if (list.length >= this.settings().engagement.wishlist.maxItems)
      return { ok: false, code: 'wishlist_full' };
    this.state.wishlist[userId] = [
      ...list,
      {
        id: this.nextId('wish'),
        productId,
        variantId,
        referencePrice: this.currentPrice(productId, variantId),
        lastNotifiedPrice: null,
        createdAt: this.iso(),
      },
    ];
    this.persist();
    return { ok: true, saved: true };
  }

  /** Mirrors wishlist_merge: account entries kept, guest ones added oldest-first, invalid reported. */
  mergeWishlist(
    userId: string,
    items: { productId: string; variantId: string | null; addedAt?: string }[],
  ): WishlistView {
    const adjustments: { productId: string; reason: string }[] = [];
    const max = this.settings().engagement.wishlist.maxItems;
    const ordered = items
      .slice(0, 200)
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const x = a.item.addedAt ?? '';
        const y = b.item.addedAt ?? '';
        if (!x !== !y) return x ? -1 : 1;
        return x === y ? a.index - b.index : x < y ? -1 : 1;
      });
    for (const { item } of ordered) {
      if (!this.validTarget(item.productId, item.variantId)) {
        adjustments.push({ productId: item.productId, reason: 'removed_missing' });
        continue;
      }
      const list = this.state.wishlist[userId] ?? [];
      if (list.some((w) => w.productId === item.productId && w.variantId === item.variantId))
        continue;
      if (list.length >= max) {
        adjustments.push({ productId: item.productId, reason: 'wishlist_full' });
        continue;
      }
      const nowIso = this.iso();
      const addedAt = item.addedAt && item.addedAt < nowIso ? item.addedAt : nowIso;
      this.state.wishlist[userId] = [
        ...list,
        {
          id: this.nextId('wish'),
          productId: item.productId,
          variantId: item.variantId,
          referencePrice: this.currentPrice(item.productId, item.variantId),
          lastNotifiedPrice: null,
          createdAt: addedAt,
        },
      ];
    }
    this.persist();
    return { ...this.wishlistView(userId), adjustments };
  }

  // ── Recently viewed ─────────────────────────────────────────────────────
  private trimRecent(userId: string) {
    const max = this.settings().engagement.recentlyViewed.maxItems;
    this.state.recent[userId] = [...(this.state.recent[userId] ?? [])]
      .sort((a, b) =>
        a.viewedAt === b.viewedAt
          ? a.productId.localeCompare(b.productId)
          : a.viewedAt < b.viewedAt
            ? 1
            : -1,
      )
      .slice(0, max);
  }

  trackRecent(userId: string, productId: string, variantId: string | null): ActionResult {
    if (!this.validTarget(productId, variantId)) return { ok: false, code: 'not_found' };
    this.state.recent[userId] = [
      { productId, variantId, viewedAt: this.iso() },
      ...(this.state.recent[userId] ?? []).filter((r) => r.productId !== productId),
    ];
    this.trimRecent(userId);
    this.persist();
    return { ok: true };
  }

  mergeRecent(
    userId: string,
    items: { productId: string; variantId: string | null; viewedAt: string }[],
  ): ActionResult {
    const nowIso = this.iso();
    for (const item of items.slice(0, 100)) {
      if (!this.validTarget(item.productId, item.variantId)) continue;
      const at = item.viewedAt < nowIso ? item.viewedAt : nowIso;
      const list = this.state.recent[userId] ?? [];
      const existing = list.find((r) => r.productId === item.productId);
      if (existing) {
        if (at > existing.viewedAt) {
          existing.viewedAt = at;
          existing.variantId = item.variantId;
        }
      } else
        this.state.recent[userId] = [
          ...list,
          { productId: item.productId, variantId: item.variantId, viewedAt: at },
        ];
    }
    this.trimRecent(userId);
    this.persist();
    return { ok: true };
  }

  listRecent(userId: string, limit = 20): RecentEntry[] {
    return (this.state.recent[userId] ?? [])
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((r) => {
        const product = this.productById(r.productId);
        const summary = product ? this.summary(product) : null;
        return summary
          ? {
              productId: r.productId,
              variantId: r.variantId,
              viewedAt: r.viewedAt,
              product: summary,
            }
          : null;
      })
      .filter((r): r is RecentEntry => r !== null);
  }

  clearRecent(userId: string): ActionResult {
    this.state.recent[userId] = [];
    this.persist();
    return { ok: true };
  }

  // ── Requests ────────────────────────────────────────────────────────────
  createRequest(
    actor: DemoActor,
    input: {
      kind: 'notify' | 'waitlist';
      productSlug: string;
      variantSku: string | null;
      name: string;
      phone: string;
      email: string | null;
      desiredStorage?: string | null;
      desiredColor?: string | null;
    },
  ): { status: 'created' | 'duplicate'; id?: string; claimToken?: string | null } {
    const product = this.productBySlug(input.productSlug);
    if (!product) throw new Error('product_not_found');
    const variant = input.variantSku
      ? product.variants.find((v) => v.sku === input.variantSku)
      : undefined;
    if (input.variantSku && !variant) throw new Error('variant_not_found');
    const phone = normalizeEgyptianPhone(input.phone) ?? input.phone;
    const active = input.kind === 'notify' ? 'pending' : 'waiting';
    const duplicate = this.state.requests.find(
      (r) =>
        r.kind === input.kind &&
        r.productId === product.id &&
        (input.kind === 'waitlist' || r.variantId === (variant?.id ?? null)) &&
        r.phone === phone &&
        r.status === active,
    );
    if (duplicate) {
      if (actor.userId && !duplicate.userId) {
        duplicate.userId = actor.userId;
        this.persist();
      }
      return { status: 'duplicate' };
    }
    const token = actor.userId ? null : `${this.random()}${this.random()}`;
    const request: DemoRequest = {
      id: this.nextId('request'),
      kind: input.kind,
      userId: actor.userId,
      productId: product.id,
      variantId: variant?.id ?? null,
      name: input.name.trim(),
      phone,
      email: input.email?.trim() || null,
      desiredStorage: input.desiredStorage?.trim() || null,
      desiredColor: input.desiredColor?.trim() || null,
      status: active,
      createdAt: this.iso(),
      availableAt: null,
      claimToken: token,
    };
    this.state.requests.push(request);
    if (input.kind === 'notify') this.processStockAlerts(null, request.id);
    this.persist();
    return { status: 'created', id: request.id, claimToken: token };
  }

  claimRequests(actor: DemoActor, claims: RequestClaim[]): { ok: true; linked: number } {
    const uid = actor.userId;
    if (!uid) throw new DemoPermissionError('authentication required');
    let linked = 0;
    for (const claim of claims.slice(0, 50)) {
      const r = this.state.requests.find((x) => x.id === claim.id && x.kind === claim.kind);
      if (r && r.userId === null && r.claimToken !== null && r.claimToken === claim.token) {
        r.userId = uid;
        r.claimToken = null;
        linked += 1;
      }
    }
    const email = actor.email?.toLowerCase();
    if (email)
      for (const r of this.state.requests)
        if (
          r.userId === null &&
          r.email?.toLowerCase() === email &&
          ['pending', 'waiting', 'available'].includes(r.status)
        ) {
          r.userId = uid;
          linked += 1;
        }
    this.persist();
    return { ok: true, linked };
  }

  private requestStatus(r: DemoRequest): RequestStatus {
    if (r.status === 'pending' || r.status === 'waiting')
      return this.expired(r.createdAt) ? 'expired' : 'active';
    return r.status as RequestStatus;
  }

  listRequests(userId: string): MyRequests {
    this.refresh(userId);
    const engine = this.engine();
    const productRef = (id: string) => {
      const p = this.productById(id);
      const summary = p ? this.summary(p) : null;
      return {
        id,
        slug: p?.slug ?? '',
        name: p?.name ?? { ar: '—' },
        image: summary?.image ?? null,
        availabilityState: p?.availabilityState ?? 'available',
        isDemo: true,
        visible: Boolean(summary),
      };
    };
    const mine = this.state.requests
      .filter((r) => r.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return {
      notify: mine
        .filter((r) => r.kind === 'notify')
        .map((r) => ({
          id: r.id,
          kind: 'notify' as const,
          status: this.requestStatus(r),
          createdAt: r.createdAt,
          availableAt: r.availableAt,
          product: productRef(r.productId),
          variant: this.variantRef(r.productId, r.variantId),
          stockState: r.variantId
            ? (engine.variant(r.variantId)?.stockState ?? null)
            : productRef(r.productId).visible
              ? (this.summariesByIds([r.productId])[0]?.stockState ?? null)
              : null,
        })),
      waitlist: mine
        .filter((r) => r.kind === 'waitlist')
        .map((r) => ({
          id: r.id,
          kind: 'waitlist' as const,
          status: this.requestStatus(r),
          createdAt: r.createdAt,
          availableAt: r.availableAt,
          desiredStorage: r.desiredStorage,
          desiredColor: r.desiredColor,
          product: productRef(r.productId),
        })),
    };
  }

  cancelRequest(userId: string, kind: 'notify' | 'waitlist', id: string): ActionResult {
    const r = this.state.requests.find(
      (x) => x.id === id && x.kind === kind && x.userId === userId,
    );
    const open = kind === 'notify' ? ['pending', 'available'] : ['waiting', 'available'];
    if (!r || !open.includes(r.status)) return { ok: false, code: 'not_found' };
    r.status = 'cancelled';
    this.persist();
    return { ok: true };
  }

  // ── Abandoned carts (staff) ─────────────────────────────────────────────
  abandonedCarts(actor: DemoActor): { total: number; items: AbandonedCartRow[] } {
    this.require(actor, 'customers.view');
    const customers = new Set(this.commerce.orderRecords().map((o) => o.customerId));
    for (const id of Object.keys(this.state.profiles)) customers.add(id);
    const engine = this.engine();
    const rows: AbandonedCartRow[] = [];
    for (const id of customers) {
      if (!this.isAbandoned(id)) continue;
      const { itemCount, activity } = this.cartActivity(id);
      const profile = this.state.profiles[id];
      rows.push({
        customerId: id,
        customerName: profile?.fullName ?? null,
        email: id.startsWith('demo-customer-') ? id.slice('demo-customer-'.length) : null,
        itemCount,
        lastActivity: activity ?? this.iso(),
        reminded: this.state.notifications.some(
          (n) =>
            n.userId === id &&
            n.dedupeKey === `cart:${Math.floor(new Date(activity ?? 0).getTime() / 1000)}`,
        ),
        items: this.commerce
          .getCart(id)
          .items.filter((i) => !i.savedForLater)
          .map((i) => {
            const v = engine.variant(i.variantId);
            return {
              sku: v?.variant.sku ?? i.variantId,
              name: v?.product.name ?? { ar: '—' },
              quantity: i.quantity,
            };
          }),
      });
    }
    rows.sort((a, b) => a.lastActivity.localeCompare(b.lastActivity));
    return { total: rows.length, items: rows };
  }

  // ── Reviews ─────────────────────────────────────────────────────────────
  private eligibleOrder(userId: string, productId: string): DemoOrderRecord | null {
    const statuses: string[] = this.settings().engagement.reviews.eligibleStatuses;
    const slug = this.productById(productId)?.slug;
    return (
      this.commerce
        .orderRecords()
        .filter(
          (o) =>
            o.customerId === userId &&
            statuses.includes(o.status) &&
            o.items.some((i) => i.productSlug === slug && !i.isGift),
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
    );
  }

  private authorName(userId: string) {
    const name = this.state.profiles[userId]?.fullName?.trim();
    if (!name) return 'MALEK STORE customer';
    const [first, second] = name.split(/\s+/);
    return second ? `${first} ${second.charAt(0)}.` : (first ?? name);
  }

  private reviewJson(r: DemoReview): Review {
    return {
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      verifiedBuyer: r.verifiedBuyer,
      imagePath: r.imagePath,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isDemo: true,
    };
  }

  private ownReview(r: DemoReview): OwnReview {
    const product = this.productById(r.productId);
    return {
      ...this.reviewJson(r),
      status: r.status,
      productId: r.productId,
      product: product
        ? { slug: product.slug, name: product.name, image: this.summary(product)?.image ?? null }
        : undefined,
    };
  }

  reviewStatus(userId: string | null, productSlug: string): ReviewEligibility {
    const product = this.productBySlug(productSlug);
    if (!product || !this.summary(product))
      return { eligible: false, reason: 'not_found', review: null };
    const cfg = this.settings().engagement.reviews;
    if (!cfg.enabled) return { eligible: false, reason: 'disabled', review: null };
    if (!userId) return { eligible: false, reason: 'sign_in', review: null };
    const existing = this.state.reviews.find(
      (r) => r.userId === userId && r.productId === product.id,
    );
    const review = existing ? this.ownReview(existing) : null;
    if (this.eligibleOrder(userId, product.id))
      return { eligible: true, reason: null, review, allowImages: cfg.allowImages };
    const bought = this.commerce
      .orderRecords()
      .some(
        (o) =>
          o.customerId === userId &&
          o.status !== 'cancelled' &&
          o.items.some((i) => i.productSlug === product.slug),
      );
    return { eligible: false, reason: bought ? 'not_delivered' : 'no_purchase', review };
  }

  submitReview(userId: string, input: ReviewInput): ActionResult & { review?: OwnReview } {
    const product = this.productBySlug(input.productSlug);
    if (!product || !this.summary(product)) return { ok: false, code: 'not_found' };
    const cfg = this.settings().engagement.reviews;
    if (!cfg.enabled) return { ok: false, code: 'reviews_disabled' };
    const order = this.eligibleOrder(userId, product.id);
    if (!order) return { ok: false, code: 'not_eligible' };
    const body = input.body.trim();
    const title = input.title?.trim() || null;
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
      return { ok: false, code: 'invalid_review', field: 'rating' };
    if (body.length < 10 || body.length > 2000)
      return { ok: false, code: 'invalid_review', field: 'body' };
    if (title && (title.length < 2 || title.length > 120))
      return { ok: false, code: 'invalid_review', field: 'title' };
    if (input.imagePath && (!cfg.allowImages || !input.imagePath.startsWith('data:image/')))
      return { ok: false, code: 'invalid_review', field: 'image' };
    const now = this.iso();
    const existing = this.state.reviews.find(
      (r) => r.userId === userId && r.productId === product.id,
    );
    const next: DemoReview = {
      id: existing?.id ?? this.nextId('review'),
      productId: product.id,
      userId,
      orderId: order.id,
      rating: input.rating,
      title,
      body,
      imagePath: input.imagePath,
      authorName: this.authorName(userId),
      status: 'pending',
      verifiedBuyer: true,
      moderationNote: null,
      moderatedBy: null,
      moderatedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.state.reviews = [...this.state.reviews.filter((r) => r.id !== next.id), next];
    this.persist();
    return { ok: true, review: this.ownReview(next) };
  }

  deleteReview(userId: string, id: string): ActionResult {
    const before = this.state.reviews.length;
    this.state.reviews = this.state.reviews.filter((r) => !(r.id === id && r.userId === userId));
    this.persist();
    return before === this.state.reviews.length ? { ok: false, code: 'not_found' } : { ok: true };
  }

  myReviews(userId: string): OwnReview[] {
    return this.state.reviews
      .filter((r) => r.userId === userId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((r) => this.ownReview(r));
  }

  publicReviews(productSlug: string, limit = 10, offset = 0): PublicReviews | null {
    const product = this.productBySlug(productSlug);
    if (!product || !this.summary(product)) return null;
    const seeded: Review[] = (this.raw.reviews ?? [])
      .filter((r) => r.product === productSlug)
      .map((r) => {
        const at = new Date(this.now().getTime() - relativeMs(r.createdAt)).toISOString();
        return {
          id: r.id,
          rating: r.rating,
          title: r.title?.ar ?? null,
          body: r.body.ar,
          authorName: r.author,
          verifiedBuyer: false,
          imagePath: null,
          createdAt: at,
          updatedAt: at,
          isDemo: true,
        };
      });
    const approved = [
      ...seeded,
      ...this.state.reviews
        .filter((r) => r.productId === product.id && r.status === 'approved')
        .map((r) => this.reviewJson(r)),
    ].sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
    );
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const r of approved) distribution[String(r.rating) as keyof typeof distribution] += 1;
    const average = approved.length
      ? Math.round((approved.reduce((n, r) => n + r.rating, 0) / approved.length) * 10) / 10
      : null;
    return {
      summary: { count: approved.length, average, distribution },
      items: approved.slice(offset, offset + Math.min(Math.max(limit, 1), 50)),
    };
  }

  staffReviews(
    actor: DemoActor,
    status: 'pending' | 'approved' | 'rejected' | null = 'pending',
  ): { total: number; items: StaffReview[] } {
    this.require(actor, 'reviews.moderate');
    const rows = this.state.reviews
      .filter((r) => status === null || r.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      total: rows.length,
      items: rows.map((r) => {
        const product = this.productById(r.productId);
        const order = this.commerce.orderRecords().find((o) => o.id === r.orderId);
        return {
          ...this.ownReview(r),
          moderationNote: r.moderationNote,
          moderatedAt: r.moderatedAt,
          orderNumber: order?.orderNumber ?? null,
          product: {
            slug: product?.slug ?? '',
            name: product?.name ?? { ar: '—' },
            image: product ? (this.summary(product)?.image ?? null) : null,
          },
        };
      }),
    };
  }

  moderateReview(
    actor: DemoActor,
    id: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): ActionResult & { review?: OwnReview } {
    const uid = this.require(actor, 'reviews.moderate');
    const r = this.state.reviews.find((x) => x.id === id);
    if (!r) return { ok: false, code: 'not_found' };
    if (r.userId === uid) return { ok: false, code: 'own_review' };
    r.status = decision;
    r.moderationNote = note?.trim().slice(0, 500) || null;
    r.moderatedBy = uid;
    r.moderatedAt = this.iso();
    const product = this.productById(r.productId);
    this.notify(
      r.userId,
      `review.${decision}`,
      { product_name: product?.name ?? { ar: '—' } },
      `review:${r.id}:${decision}:${Math.floor(new Date(r.moderatedAt).getTime() / 1000)}`,
      decision === 'approved' && product ? `/product/${product.slug}` : '/account/reviews',
      { reviewId: r.id },
    );
    this.persist();
    return { ok: true, review: this.ownReview(r) };
  }

  // ── Recommendations ─────────────────────────────────────────────────────
  recommendations(productSlug: string): Recommendations | null {
    const product = this.productBySlug(productSlug);
    if (!product || !this.summary(product)) return null;
    const limit = this.settings().engagement.recommendations.limit;
    const minCustomers = this.settings().engagement.recommendations.minCustomers;
    const visible = (slug: string) => {
      const p = this.productBySlug(slug);
      return p && this.summary(p) ? p : null;
    };
    const manual = (kinds: string[]) =>
      product.relations
        .filter((r) => kinds.includes(r.kind))
        .sort((a, b) =>
          a.kind === b.kind
            ? a.sortOrder - b.sortOrder
            : kinds.indexOf(a.kind) - kinds.indexOf(b.kind),
        )
        .map((r) => visible(r.slug))
        .filter((p): p is RawProduct => Boolean(p));
    const price = this.currentPrice(product.id, null) ?? 0;
    const primary = product.categorySlugs[0] ?? null;
    const available = (p: RawProduct) => p.availabilityState === 'available';

    const related = manual(['similar', 'recommended']);
    if (related.length < 4 && primary) {
      const extra = this.raw.products
        .filter(
          (p) =>
            p.id !== product.id &&
            !related.includes(p) &&
            p.categorySlugs.includes(primary) &&
            available(p) &&
            visible(p.slug),
        )
        .sort(
          (a, b) =>
            Math.abs((this.currentPrice(a.id, null) ?? 0) - price) -
              Math.abs((this.currentPrice(b.id, null) ?? 0) - price) || a.id.localeCompare(b.id),
        )
        .slice(0, 4 - related.length);
      related.push(...extra);
    }
    const accessories = manual(['accessory']);
    const compatible = [
      ...manual(['compatible']),
      ...this.raw.products.filter(
        (p) =>
          p.relations.some((r) => r.kind === 'compatible' && r.slug === product.slug) &&
          visible(p.slug),
      ),
    ].filter((p, i, all) => all.indexOf(p) === i);
    const manualBt = manual(['bought_together']);

    // Demo-only aggregation from this browser's demo orders (delivered/completed, ≥ minCustomers).
    const customersByProduct = new Map<string, Set<string>>();
    for (const order of this.commerce.orderRecords()) {
      if (!['delivered', 'completed'].includes(order.status)) continue;
      const lines = order.items.filter((i) => !i.isGift && i.productSlug);
      if (!lines.some((i) => i.productSlug === product.slug)) continue;
      for (const line of lines) {
        const other = this.productBySlug(line.productSlug);
        if (!other || other.id === product.id) continue;
        const set = customersByProduct.get(other.id) ?? new Set<string>();
        set.add(order.customerId);
        customersByProduct.set(other.id, set);
      }
    }
    const fromOrders = [...customersByProduct.entries()]
      .filter(([, set]) => set.size >= minCustomers)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([id]) => this.productById(id))
      .filter((p): p is RawProduct => Boolean(p && visible(p.slug) && !manualBt.includes(p)));
    const boughtTogether = [...manualBt, ...fromOrders].slice(0, 4);

    const seen = new Set(
      [product, ...related, ...accessories, ...compatible, ...boughtTogether].map((p) => p.id),
    );
    const youMayAlsoLike = this.raw.products
      .filter((p) => !seen.has(p.id) && available(p) && visible(p.slug))
      .filter(
        (p) =>
          p.brandSlug === product.brandSlug ||
          (primary !== null && p.categorySlugs.includes(primary)),
      )
      .filter((p) => {
        const pp = this.currentPrice(p.id, null);
        return !price || (pp !== null && pp >= price * 0.6 && pp <= price * 1.4);
      })
      .sort((a, b) => {
        const sameA = primary !== null && a.categorySlugs.includes(primary) ? 0 : 1;
        const sameB = primary !== null && b.categorySlugs.includes(primary) ? 0 : 1;
        return (
          sameA - sameB ||
          Math.abs((this.currentPrice(a.id, null) ?? 0) - price) -
            Math.abs((this.currentPrice(b.id, null) ?? 0) - price) ||
          a.id.localeCompare(b.id)
        );
      })
      .slice(0, limit);

    const toSummaries = (list: RawProduct[]) =>
      this.summariesByIds(list.slice(0, limit).map((p) => p.id));
    return {
      related: toSummaries(related),
      accessories: toSummaries(accessories),
      compatible: toSummaries(compatible),
      boughtTogether: toSummaries(boughtTogether),
      youMayAlsoLike: toSummaries(youMayAlsoLike),
    };
  }
}

function relativeMs(value: string): number {
  const match = /^([+-])(\d+)([dhm])$/.exec(value);
  if (!match) return 0;
  const n = Number(match[2]);
  const unit = match[3] === 'd' ? 86_400_000 : match[3] === 'h' ? 3_600_000 : 60_000;
  return (match[1] === '-' ? 1 : -1) * n * unit;
}
