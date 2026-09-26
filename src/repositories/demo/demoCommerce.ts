import { z } from 'zod';
import baseSeed from '@seed/base/site-settings.json';
import pageSectionsJson from '@seed/base/page-sections.json';
import demoCatalogJson from '@seed/demo/catalog.json';
import { DemoAdmin, DemoAdminForbidden, type AdminActor } from '@/domain/admin/demo/demoAdmin';
import type { DemoAdminState } from '@/domain/admin/demo/context';
import { DemoAccessControl, type DemoAccessState } from '@/domain/admin/demoAccess';
import { DemoSettings, type DemoSettingsState } from '@/domain/admin/demoSettings';
import type { CatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema, type RawCatalog } from '@/domain/catalog/raw';
import type { PageSection } from '@/domain/content/types';
import {
  DemoCommerce,
  DemoPermissionError,
  type DemoActor,
  type DemoCommerceSettings,
  type DemoCommerceState,
} from '@/domain/commerce/demoCommerce';
import {
  DemoCustomer,
  DemoPermissionError as DemoCustomerPermissionError,
  type DemoCustomerSettings,
  type DemoCustomerState,
} from '@/domain/customer/demoCustomer';
import {
  DemoServices,
  type DemoServicesSettings,
  type DemoServicesState,
} from '@/domain/services/demoServices';
import {
  abandonedCartSettingsSchema,
  commerceSettingsSchema,
  engagementSettingsSchema,
  featuresSettingsSchema,
  orderReviewSettingsSchema,
  repairCatalogSettingsSchema,
  servicesSettingsSchema,
  storeSettingsSchema,
} from '@/domain/settings/schemas';
import { readStored, removeStored, writeStored } from '@/lib/storage/localStore';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { RepositoryError } from '../supabase/errors';
import { DemoServiceMediaStore } from './demoServiceMedia';
import type { StaffActionResult } from '@/domain/commerce/types';
import type { CommerceRepository, OrderOperationsRepository } from '../types';

/**
 * DEMO MODE: settings overlay applied on top of the real base configuration so demo previews can
 * exercise optional systems (promo code DEMO10). Live mode never sees this overlay.
 */
export const DEMO_SETTINGS_OVERLAY = { features: { promoCodes: true } } as const;

/** Base configuration + the demo overlay = version 1 of every demo setting. */
export function demoBaseSettings(): Record<string, Record<string, unknown>> {
  const base = structuredClone(baseSeed.settings) as Record<string, Record<string, unknown>>;
  base.features = { ...base.features, ...DEMO_SETTINGS_OVERLAY.features };
  return base;
}

type Published = (key: string) => Record<string, unknown> | null;

/** Parse a published demo setting, falling back to the base value if an edit is unusable. */
function setting<T>(published: Published, key: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(published(key));
  return parsed.success ? parsed.data : schema.parse(demoBaseSettings()[key]);
}

export function demoCommerceSettings(published: Published): DemoCommerceSettings {
  return {
    features: setting(published, 'features', featuresSettingsSchema),
    commerce: setting(published, 'commerce', commerceSettingsSchema),
    orderReview: setting(published, 'order_review', orderReviewSettingsSchema),
    store: setting(published, 'store', storeSettingsSchema),
  };
}

const STORAGE_KEY = 'demo-commerce';
const CUSTOMER_STORAGE_KEY = 'demo-customer';
const SERVICES_STORAGE_KEY = 'demo-services';
const storedCustomerSchema = z.object({
  version: z.literal(1),
  seq: z.number().int().min(0),
  profiles: z.record(z.string(), z.any()),
  addresses: z.record(z.string(), z.array(z.any())),
  wishlist: z.record(z.string(), z.array(z.any())),
  recent: z.record(z.string(), z.array(z.any())),
  notifications: z.array(z.any()),
  preferences: z.record(z.string(), z.record(z.string(), z.boolean())),
  requests: z.array(z.any()),
  reviews: z.array(z.any()),
}) as unknown as z.ZodType<DemoCustomerState>;

export function demoCustomerSettings(published: Published): DemoCustomerSettings {
  return {
    engagement: setting(published, 'engagement', engagementSettingsSchema),
    abandonedCart: setting(published, 'abandoned_cart', abandonedCartSettingsSchema),
  };
}
export function demoServicesSettings(published: Published): DemoServicesSettings {
  return {
    services: setting(published, 'services', servicesSettingsSchema),
    repairCatalog: setting(published, 'repair_catalog', repairCatalogSettingsSchema).categories,
  };
}

// ── Phase 06: editable demo catalog, settings, access registry and admin engine ──
const CATALOG_STORAGE_KEY = 'demo-catalog';
const SETTINGS_STORAGE_KEY = 'demo-settings';
const ACCESS_STORAGE_KEY = 'demo-access';
const ADMIN_STORAGE_KEY = 'demo-admin';
const MEDIA_STORAGE_KEY = 'demo-service-media';
/** Every browser key the demo stores use (reset / delete demo data). */
export const DEMO_STORAGE_KEYS = [
  STORAGE_KEY,
  CUSTOMER_STORAGE_KEY,
  SERVICES_STORAGE_KEY,
  CATALOG_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  ACCESS_STORAGE_KEY,
  ADMIN_STORAGE_KEY,
  MEDIA_STORAGE_KEY,
];

/** Changes whenever the shipped demo seed changes, so stale edited copies are discarded. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
const SEED_FINGERPRINT = fingerprint(JSON.stringify(demoCatalogJson));
const storedCatalogSchema = z.object({
  fingerprint: z.string(),
  catalog: z.unknown(),
});

function loadDemoCatalog(): RawCatalog {
  const stored = readStored(CATALOG_STORAGE_KEY, storedCatalogSchema);
  if (stored?.fingerprint === SEED_FINGERPRINT) {
    const parsed = rawCatalogSchema.safeParse(stored.catalog);
    if (parsed.success) return parsed.data;
  }
  return rawCatalogSchema.parse(demoCatalogJson);
}

const anyState = <T>() => z.object({ version: z.literal(1) }).loose() as unknown as z.ZodType<T>;

const baseSections: PageSection[] = pageSectionsJson.sections.map((s) => ({
  id: s.key,
  pageKey: s.pageKey,
  type: s.type,
  sortOrder: s.sortOrder,
  isVisible: s.isVisible,
  props: s.props,
}));

const storedServicesSchema = z.object({
  version: z.literal(1),
  seq: z.object({
    repair: z.number(),
    trade_in: z.number(),
    used: z.number(),
    after_sales: z.number(),
  }),
  eventSeq: z.number(),
  requests: z.array(z.any()),
  staff: z.record(z.string(), z.string()),
}) as unknown as z.ZodType<DemoServicesState>;

const storedStateSchema = z.object({
  version: z.literal(1),
  seq: z.number().int().min(0),
  carts: z.record(z.string(), z.array(z.any())),
  orders: z.array(z.any()),
  redemptions: z.array(z.any()),
  stockDelta: z.record(z.string(), z.number()),
  movements: z.array(z.any()),
  cartActivity: z.record(z.string(), z.string()).optional(),
}) as unknown as z.ZodType<DemoCommerceState>;

/** Simulated latency keeps loading states honest during demo previews. */
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

/** One demo commerce store per runtime (kept in this browser's localStorage). */
export class DemoCommerceStore {
  readonly commerce: DemoCommerce;
  /** Phase 04 customer features (wishlist, requests, notifications, reviews…) on the same store. */
  readonly customer: DemoCustomer;
  /** Phase 05 service requests (repairs, trade-in, used, after-sales) + their demo media. */
  readonly services: DemoServices;
  readonly media: DemoServiceMediaStore;
  /** Phase 06 admin: editable catalog, settings workflow, role registry and admin RPC mirror. */
  readonly settings: DemoSettings;
  readonly access: DemoAccessControl;
  readonly admin: DemoAdmin;
  readonly raw: RawCatalog;
  private version = 0;
  private cached: { engine: CatalogEngine; version: number; builtAt: number } | null = null;

  constructor() {
    const raw = loadDemoCatalog();
    this.raw = raw;
    this.settings = new DemoSettings({
      base: demoBaseSettings(),
      storage: {
        load: () => readStored(SETTINGS_STORAGE_KEY, anyState<DemoSettingsState>()),
        save: (state) => writeStored(SETTINGS_STORAGE_KEY, state),
      },
    });
    this.access = new DemoAccessControl({
      storage: {
        load: () => readStored(ACCESS_STORAGE_KEY, anyState<DemoAccessState>()),
        save: (state) => writeStored(ACCESS_STORAGE_KEY, state),
      },
    });
    const published = (key: string) => this.settings.published(key);
    this.commerce = new DemoCommerce({
      raw,
      storage: {
        load: () => readStored(STORAGE_KEY, storedStateSchema),
        save: (state) => {
          this.version += 1;
          writeStored(STORAGE_KEY, state);
        },
      },
      settings: () => demoCommerceSettings(published),
      staffName: (id) => this.admin.staffName(id),
    });
    this.customer = new DemoCustomer({
      raw,
      commerce: this.commerce,
      settings: () => demoCustomerSettings(published),
      storage: {
        load: () => readStored(CUSTOMER_STORAGE_KEY, storedCustomerSchema),
        save: (state) => writeStored(CUSTOMER_STORAGE_KEY, state),
      },
      engine: () => this.engine(),
    });
    this.media = new DemoServiceMediaStore();
    this.services = new DemoServices({
      raw,
      commerce: this.commerce,
      customer: this.customer,
      settings: () => demoServicesSettings(published),
      storage: {
        load: () => readStored(SERVICES_STORAGE_KEY, storedServicesSchema),
        save: (state) => writeStored(SERVICES_STORAGE_KEY, state),
      },
      mediaInfo: (bucket, path) => this.media.info(bucket, path),
      engine: () => this.engine(),
    });
    this.admin = new DemoAdmin({
      raw,
      commerce: this.commerce,
      customer: this.customer,
      services: this.services,
      settings: this.settings,
      access: this.access,
      baseSections,
      storage: {
        load: () => readStored(ADMIN_STORAGE_KEY, anyState<DemoAdminState>()),
        save: (state) => writeStored(ADMIN_STORAGE_KEY, state),
      },
      onCatalogChange: () => {
        this.version += 1;
        writeStored(CATALOG_STORAGE_KEY, { fingerprint: SEED_FINGERPRINT, catalog: raw });
      },
      engine: () => this.engine(),
    });
  }

  /** Remove every demo store from this browser (the next load starts from the seed). */
  static resetBrowserData(options: { emptyCatalog?: boolean } = {}) {
    for (const key of DEMO_STORAGE_KEYS) removeStored(key);
    if (options.emptyCatalog) {
      const empty = rawCatalogSchema.parse(demoCatalogJson);
      empty.products = [];
      empty.offers = [];
      empty.entries = [];
      empty.reviews = [];
      empty.serviceRequests = [];
      writeStored(CATALOG_STORAGE_KEY, { fingerprint: SEED_FINGERPRINT, catalog: empty });
    }
  }

  /** Catalog engine that reflects demo reservations and sales (rebuilt on change / every 10 min). */
  engine(): CatalogEngine {
    const now = Date.now();
    if (
      !this.cached ||
      this.cached.version !== this.version ||
      now - this.cached.builtAt > 10 * 60_000
    ) {
      this.cached = { engine: this.commerce.engine(), version: this.version, builtAt: now };
    }
    return this.cached.engine;
  }
}

/**
 * Demo permission context of the signed-in preview user: roles come from the demo access registry
 * (admin role / permission edits and suspensions apply immediately).
 */
export async function actorOf(
  auth: DemoAuthService,
  store: DemoCommerceStore,
): Promise<AdminActor> {
  const session = await auth.getSession();
  const access = store.access.actor(session?.userId ?? null, auth.demo.getRoleKey());
  const roleKey = access.roles[0]?.key ?? null;
  return {
    ...access,
    email: session?.email ?? null,
    name: session ? (store.admin.staffName(session.userId) ?? session.email) : null,
    roleKey,
  };
}

export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (
      error instanceof DemoPermissionError ||
      error instanceof DemoCustomerPermissionError ||
      error instanceof DemoAdminForbidden
    )
      throw new RepositoryError(error.message, error, 'forbidden');
    if (error instanceof RangeError)
      throw new RepositoryError(error.message, error, 'invalid_response');
    throw error;
  }
}

async function requireUser(auth: DemoAuthService): Promise<string> {
  const session = await auth.getSession();
  if (!session) throw new RepositoryError('authentication required', null, 'forbidden');
  return session.userId;
}

export class DemoCommerceRepository implements CommerceRepository {
  private readonly store: DemoCommerceStore;
  private readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  async quote(
    items: Parameters<CommerceRepository['quote']>[0],
    options: Parameters<CommerceRepository['quote']>[1] = {},
  ) {
    await delay(120);
    const session = await this.auth.getSession();
    return this.store.commerce.quote(session?.userId ?? null, items, options);
  }

  async getCart() {
    await delay(80);
    return this.store.commerce.getCart(await requireUser(this.auth));
  }

  async mergeCart(items: Parameters<CommerceRepository['mergeCart']>[0]) {
    await delay(120);
    return this.store.commerce.mergeCart(await requireUser(this.auth), items);
  }

  async setCartItem(
    variantId: string,
    quantity: number,
    savedForLater: boolean,
    seenUnitPrice: number | null,
  ) {
    await delay(60);
    return this.store.commerce.setCartItem(
      await requireUser(this.auth),
      variantId,
      quantity,
      savedForLater,
      seenUnitPrice,
    );
  }

  async createOrder(payload: Parameters<CommerceRepository['createOrder']>[0]) {
    await delay(400);
    const actor = await actorOf(this.auth, this.store);
    const result = this.store.commerce.createOrder(actor, payload);
    // Like create_order: remember the checkout name / phone when the profile has none yet.
    if (result.ok && actor.userId)
      this.store.customer.fillProfileFromOrder(
        actor.userId,
        payload.contact.name,
        payload.contact.phone,
      );
    return result;
  }

  async getMyOrder(orderNumber: string) {
    await delay(120);
    const session = await this.auth.getSession();
    return this.store.commerce.getMyOrder(session?.userId ?? null, orderNumber);
  }

  async listMyOrders() {
    await delay(120);
    const session = await this.auth.getSession();
    return this.store.commerce.listMyOrders(session?.userId ?? null);
  }

  async cancelMyOrder(orderNumber: string, reason: string | null) {
    await delay(250);
    const session = await this.auth.getSession();
    return this.store.commerce.cancelMyOrder(session?.userId ?? null, orderNumber, reason);
  }
}

export class DemoOrderOperationsRepository implements OrderOperationsRepository {
  private readonly store: DemoCommerceStore;
  private readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  private async run<T>(fn: (actor: DemoActor) => T): Promise<T> {
    await delay(150);
    const actor = await actorOf(this.auth, this.store);
    return guard(() => fn(actor));
  }

  /** Staff writes are recorded in the demo audit log (the database audits by trigger). */
  private async write(
    action: string,
    orderId: string,
    detail: Record<string, unknown>,
    fn: (actor: DemoActor) => StaffActionResult,
  ): Promise<StaffActionResult> {
    await delay(150);
    const actor = await actorOf(this.auth, this.store);
    const result = guard(() => fn(actor));
    if (result.ok) this.store.admin.audit(actor, action, 'public.orders', orderId, detail);
    return result;
  }

  listOrders(filter: Parameters<OrderOperationsRepository['listOrders']>[0] = {}) {
    return this.run((a) => this.store.commerce.listOrders(a, filter));
  }
  getOrder(orderId: string) {
    return this.run((a) => this.store.commerce.getOrder(a, orderId));
  }
  setStatus(
    orderId: string,
    status: Parameters<OrderOperationsRepository['setStatus']>[1],
    note: string | null,
  ) {
    return this.write('order.status_changed', orderId, { status, note }, (a) =>
      this.store.commerce.setStatus(a, orderId, status, note),
    );
  }
  cancel(orderId: string, reason: string) {
    return this.write('order.cancelled', orderId, { reason }, (a) =>
      this.store.commerce.cancel(a, orderId, reason),
    );
  }
  setShipping(orderId: string, input: Parameters<OrderOperationsRepository['setShipping']>[1]) {
    return this.write('order.shipping_set', orderId, { fee: input.fee }, (a) =>
      this.store.commerce.setShipping(a, orderId, input),
    );
  }
  markPaymentVerification(orderId: string, note: string | null) {
    return this.write('payment.verification_started', orderId, {}, (a) =>
      this.store.commerce.markPaymentVerification(a, orderId, note),
    );
  }
  recordPayment(orderId: string, input: Parameters<OrderOperationsRepository['recordPayment']>[1]) {
    return this.write(
      'payment.recorded',
      orderId,
      { amount: input.amount, method: input.method },
      (a) => this.store.commerce.recordPayment(a, orderId, input),
    );
  }
  review(orderId: string, decision: 'approved' | 'rejected', note: string | null) {
    return this.write('order.reviewed', orderId, { decision }, (a) =>
      this.store.commerce.review(a, orderId, decision, note),
    );
  }
  addNote(orderId: string, note: string) {
    return this.write('order.note_added', orderId, {}, (a) =>
      this.store.commerce.addNote(a, orderId, note),
    );
  }
  releaseExpiredReservations() {
    return this.run((a) => this.store.commerce.releaseExpiredReservations(a));
  }
}
