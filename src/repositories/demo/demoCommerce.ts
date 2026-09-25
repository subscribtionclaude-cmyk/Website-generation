import { z } from 'zod';
import baseSeed from '@seed/base/site-settings.json';
import demoCatalogJson from '@seed/demo/catalog.json';
import { SYSTEM_ROLES } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
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
  abandonedCartSettingsSchema,
  commerceSettingsSchema,
  engagementSettingsSchema,
  featuresSettingsSchema,
  orderReviewSettingsSchema,
  storeSettingsSchema,
} from '@/domain/settings/schemas';
import { readStored, writeStored } from '@/lib/storage/localStore';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { RepositoryError } from '../supabase/errors';
import type { CommerceRepository, OrderOperationsRepository } from '../types';

/**
 * DEMO MODE: settings overlay applied on top of the real base configuration so demo previews can
 * exercise optional systems (promo code DEMO10). Live mode never sees this overlay.
 */
export const DEMO_SETTINGS_OVERLAY = { features: { promoCodes: true } } as const;

export function demoCommerceSettings(): DemoCommerceSettings {
  return {
    features: featuresSettingsSchema.parse({
      ...baseSeed.settings.features,
      ...DEMO_SETTINGS_OVERLAY.features,
    }),
    commerce: commerceSettingsSchema.parse(baseSeed.settings.commerce),
    orderReview: orderReviewSettingsSchema.parse(baseSeed.settings.order_review),
    store: storeSettingsSchema.parse(baseSeed.settings.store),
  };
}

const STORAGE_KEY = 'demo-commerce';
const CUSTOMER_STORAGE_KEY = 'demo-customer';
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

export function demoCustomerSettings(): DemoCustomerSettings {
  return {
    engagement: engagementSettingsSchema.parse(baseSeed.settings.engagement),
    abandonedCart: abandonedCartSettingsSchema.parse(baseSeed.settings.abandoned_cart),
  };
}
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
  private version = 0;
  private cached: { engine: CatalogEngine; version: number; builtAt: number } | null = null;

  constructor() {
    const raw = rawCatalogSchema.parse(demoCatalogJson);
    this.commerce = new DemoCommerce({
      raw,
      storage: {
        load: () => readStored(STORAGE_KEY, storedStateSchema),
        save: (state) => {
          this.version += 1;
          writeStored(STORAGE_KEY, state);
        },
      },
      settings: demoCommerceSettings,
    });
    this.customer = new DemoCustomer({
      raw,
      commerce: this.commerce,
      settings: demoCustomerSettings,
      storage: {
        load: () => readStored(CUSTOMER_STORAGE_KEY, storedCustomerSchema),
        save: (state) => writeStored(CUSTOMER_STORAGE_KEY, state),
      },
      engine: () => this.engine(),
    });
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

export async function actorOf(auth: DemoAuthService): Promise<DemoActor> {
  const session = await auth.getSession();
  const role = SYSTEM_ROLES.find((r) => r.key === auth.demo.getRoleKey());
  return {
    userId: session?.userId ?? null,
    email: session?.email ?? null,
    can: (permission) => Boolean(role && (role.grantsAll || role.permissions.includes(permission))),
  };
}

export function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof DemoPermissionError || error instanceof DemoCustomerPermissionError)
      throw new RepositoryError(error.message, error, 'forbidden');
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
    const actor = await actorOf(this.auth);
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
    const actor = await actorOf(this.auth);
    return guard(() => fn(actor));
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
    return this.run((a) => this.store.commerce.setStatus(a, orderId, status, note));
  }
  cancel(orderId: string, reason: string) {
    return this.run((a) => this.store.commerce.cancel(a, orderId, reason));
  }
  setShipping(orderId: string, input: Parameters<OrderOperationsRepository['setShipping']>[1]) {
    return this.run((a) => this.store.commerce.setShipping(a, orderId, input));
  }
  markPaymentVerification(orderId: string, note: string | null) {
    return this.run((a) => this.store.commerce.markPaymentVerification(a, orderId, note));
  }
  recordPayment(orderId: string, input: Parameters<OrderOperationsRepository['recordPayment']>[1]) {
    return this.run((a) => this.store.commerce.recordPayment(a, orderId, input));
  }
  review(orderId: string, decision: 'approved' | 'rejected', note: string | null) {
    return this.run((a) => this.store.commerce.review(a, orderId, decision, note));
  }
  addNote(orderId: string, note: string) {
    return this.run((a) => this.store.commerce.addNote(a, orderId, note));
  }
  releaseExpiredReservations() {
    return this.run((a) => this.store.commerce.releaseExpiredReservations(a));
  }
}
