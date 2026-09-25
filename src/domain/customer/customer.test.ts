import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import demoCatalogJson from '@seed/demo/catalog.json';
import { SYSTEM_ROLES } from '@/domain/access/permissions';
import type { CatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import type { ProductDetail } from '@/domain/catalog/types';
import {
  DemoCommerce,
  type DemoActor,
  type DemoCommerceState,
} from '@/domain/commerce/demoCommerce';
import type { CreateOrderPayload } from '@/domain/commerce/types';
import {
  abandonedCartSettingsSchema,
  commerceSettingsSchema,
  engagementSettingsSchema,
  featuresSettingsSchema,
  orderReviewSettingsSchema,
  storeSettingsSchema,
} from '@/domain/settings/schemas';
import { addressProblem } from './address';
import { buildCompareRows, rootCategoryOf } from './compare';
import { DemoCustomer, DemoPermissionError, type DemoCustomerState } from './demoCustomer';
import {
  addToCompare,
  isWishlisted,
  mergeRecent,
  removeFromCompare,
  toggleLocalWishlist,
  trackRecent,
} from './lists';
import { NOTIFICATION_TEMPLATES, renderTemplate } from './templates';
import notificationsSql from '../../../supabase/migrations/20260927100100_notifications.sql?raw';
import servicesSql from '../../../supabase/migrations/20260928100000_services.sql?raw';

const raw = rawCatalogSchema.parse(demoCatalogJson);
const product = (slug: string) => {
  const p = raw.products.find((x) => x.slug === slug);
  if (!p) throw new Error(slug);
  return p;
};
const variant = (sku: string) => {
  const v = raw.products.flatMap((p) => p.variants).find((x) => x.sku === sku);
  if (!v) throw new Error(sku);
  return v.id;
};
const CABLE = variant('USBC-1M-WHITE');
const CHARGER = variant('A20W-WHITE');
const AP4 = variant('AP4-STANDARD-WHITE');
const PS5 = variant('PS5S-DIGITAL-WHITE');
const P_CABLE = product('usb-c-cable').id;
const P_AP4 = product('airpods-4').id;
const P_CHARGER = product('apple-20w-usb-c-adapter').id;

function setup() {
  let now = new Date('2026-09-25T12:00:00Z');
  let commerceState: DemoCommerceState | null = null;
  let customerState: DemoCustomerState | null = null;
  let version = 0;
  let cached: { engine: CatalogEngine; version: number; at: number } | null = null;
  const commerce = new DemoCommerce({
    raw,
    storage: {
      load: () => commerceState,
      save: (s) => {
        version += 1;
        commerceState = structuredClone(s);
      },
    },
    settings: () => ({
      features: featuresSettingsSchema.parse(baseSeed.settings.features),
      commerce: commerceSettingsSchema.parse({
        ...baseSeed.settings.commerce,
        maxOpenOrdersPerCustomer: 20,
      }),
      orderReview: orderReviewSettingsSchema.parse({
        ...baseSeed.settings.order_review,
        newCustomer: { enabled: false, minTotal: 30000 },
        highValue: { enabled: false, threshold: 100000 },
        splitPayment: { enabled: false },
        unfinishedOrders: { enabled: false, maxCount: 2, windowDays: 7 },
        velocity: { enabled: false, maxOrders: 3, windowHours: 1 },
        multipleExpensive: { enabled: false, unitPrice: 20000, minUnits: 2 },
      }),
      store: storeSettingsSchema.parse(baseSeed.settings.store),
    }),
    now: () => now,
  });
  const settings = {
    engagement: engagementSettingsSchema.parse(baseSeed.settings.engagement),
    abandonedCart: abandonedCartSettingsSchema.parse(baseSeed.settings.abandoned_cart),
  };
  let seq = 0;
  const customer = new DemoCustomer({
    raw,
    commerce,
    settings: () => settings,
    storage: { load: () => customerState, save: (s) => (customerState = structuredClone(s)) },
    now: () => now,
    random: () => `rnd${(seq += 1).toString().padStart(8, '0')}abcdefghijklmnop`,
    engine: () => {
      if (!cached || cached.version !== version || cached.at !== now.getTime())
        cached = { engine: commerce.engine(), version, at: now.getTime() };
      return cached.engine;
    },
  });
  const actor = (userId: string | null, role?: string, email?: string): DemoActor => {
    const def = SYSTEM_ROLES.find((r) => r.key === role);
    return {
      userId,
      email: email ?? (userId ? `${userId}@demo.invalid` : null),
      can: (p) => Boolean(def && (def.grantsAll || def.permissions.includes(p))),
    };
  };
  const order = (who: string, items: [string, number][]) => {
    const quote = commerce.quote(
      who,
      items.map(([variantId, quantity]) => ({ variantId, quantity })),
      { fulfillment: 'delivery' },
    );
    const payload: CreateOrderPayload = {
      idempotencyKey: crypto.randomUUID(),
      items: quote.lines
        .filter((l) => !l.isGift)
        .map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          expectedUnitPrice: l.unitPrice,
        })),
      expectedTotal: quote.totals.total,
      promoCode: null,
      contact: { name: 'Test Customer', phone: '01012345678' },
      fulfillment: {
        method: 'delivery',
        governorate: 'cairo',
        area: 'Nasr City',
        address: '12 Makram Ebeid St',
      },
      payment: { method: 'cod' },
      note: null,
      locale: 'en',
    };
    const result = commerce.createOrder(actor(who), payload);
    if (!result.ok) throw new Error(result.code);
    return result.order;
  };
  const deliver = (orderId: string) => {
    const manager = actor('demo-manager', 'store_manager');
    expect(commerce.setShipping(manager, orderId, { fee: 50 }).ok).toBe(true);
    for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const)
      expect(commerce.setStatus(manager, orderId, status, null).ok).toBe(true);
  };
  return {
    commerce,
    customer,
    settings,
    actor,
    order,
    deliver,
    tick: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe('browser lists (guest)', () => {
  const now = new Date('2026-09-25T12:00:00Z');

  it('wishlist: toggle, variant-level entries, no duplicates, cap', () => {
    let list = toggleLocalWishlist(
      [],
      { productId: 'p1', productSlug: 'a', variantId: null },
      now,
    ).list;
    list = toggleLocalWishlist(
      list,
      { productId: 'p1', productSlug: 'a', variantId: 'v1' },
      now,
    ).list;
    expect(list).toHaveLength(2);
    expect(isWishlisted(list, 'p1')).toBe(true);
    expect(isWishlisted(list, 'p1', 'v2')).toBe(false);
    const removed = toggleLocalWishlist(
      list,
      { productId: 'p1', productSlug: 'a', variantId: 'v1' },
      now,
    );
    expect(removed.saved).toBe(false);
    expect(removed.list).toHaveLength(1);
    expect(
      toggleLocalWishlist(list, { productId: 'p9', productSlug: 'z', variantId: null }, now, 2)
        .full,
    ).toBe(true);
  });

  it('recently viewed: most recent first, deduplicated, capped, merge keeps the latest view', () => {
    let list = trackRecent([], { productId: 'a', productSlug: 'a', variantId: null }, now);
    list = trackRecent(
      list,
      { productId: 'b', productSlug: 'b', variantId: null },
      new Date(now.getTime() + 1000),
    );
    list = trackRecent(
      list,
      { productId: 'a', productSlug: 'a', variantId: 'v' },
      new Date(now.getTime() + 2000),
      2,
    );
    expect(list.map((i) => i.productId)).toEqual(['a', 'b']);
    expect(list[0]?.variantId).toBe('v');
    const merged = mergeRecent(
      list,
      [
        { productId: 'b', productSlug: 'b', variantId: null, viewedAt: '2030-01-01T00:00:00.000Z' },
        { productId: 'c', productSlug: 'c', variantId: null, viewedAt: '2000-01-01T00:00:00.000Z' },
      ],
      2,
    );
    expect(merged.map((i) => i.productId)).toEqual(['b', 'a']);
  });

  it('compare: same top-level category, maximum count, remove', () => {
    let list = addToCompare(
      [],
      { productId: 'p1', productSlug: 'p1', rootCategory: 'phones' },
      now,
    ).list;
    expect(
      addToCompare(list, { productId: 'l1', productSlug: 'l1', rootCategory: 'laptops' }, now)
        .result,
    ).toBe('incompatible');
    for (const id of ['p2', 'p3', 'p4'])
      list = addToCompare(
        list,
        { productId: id, productSlug: id, rootCategory: 'phones' },
        now,
      ).list;
    expect(
      addToCompare(list, { productId: 'p5', productSlug: 'p5', rootCategory: 'phones' }, now)
        .result,
    ).toBe('full');
    expect(removeFromCompare(list, 'p2').map((i) => i.productId)).toEqual(['p1', 'p3', 'p4']);
  });

  it('compare rows come from the flexible spec model, only shared attributes, differences flagged', () => {
    const { commerce } = setup();
    const engine = commerce.engine();
    const phones = ['iphone-18-pro', 'galaxy-s26-ultra'].map((s) =>
      engine.product(s),
    ) as ProductDetail[];
    const L = (en: string) => ({ ar: en, en });
    const rows = buildCompareRows(
      phones,
      'en',
      {
        price: L('Price'),
        availability: L('Availability'),
        storage: L('Storage'),
        colors: L('Colours'),
        warranty: L('Warranty'),
        brand: L('Brand'),
      },
      { price: (p) => String(p.price.min), availability: (p) => p.stockState },
    );
    const keys = rows.map((r) => r.key);
    expect(keys.slice(0, 3)).toEqual(['price', 'availability', 'brand']);
    expect(keys.some((k) => k.startsWith('spec:'))).toBe(true);
    expect(rows.find((r) => r.key === 'brand')?.differs).toBe(true);
    const categories = engine.categories();
    expect(rootCategoryOf('phones', categories)).toBe('phones');
  });
});

describe('notification templates', () => {
  it('match the SQL seed exactly (demo mode renders the same text)', () => {
    const sql = notificationsSql + servicesSql;
    for (const [key, t] of Object.entries(NOTIFICATION_TEMPLATES)) {
      expect(sql).toContain(`('${key}', '${t.category}'`);
      for (const text of [t.title.ar, t.title.en, t.body.ar, t.body.en])
        expect(sql).toContain(JSON.stringify(text));
    }
  });

  it('closed placeholder set; values cannot inject placeholders; unknown ones dropped', () => {
    expect(
      renderTemplate('Hi {{customer_name}} {{unknown}}', { customer_name: 'A {{status}}' }, 'en'),
    ).toBe('Hi A status');
    expect(
      renderTemplate('{{product_name}}', { product_name: { ar: 'آيفون', en: 'iPhone' } }, 'ar'),
    ).toBe('آيفون');
  });
});

describe('demo customer engine (mirrors 08_customer.test.sql)', () => {
  it('profile and addresses: shared validation, one default, owner only', () => {
    const { customer } = setup();
    expect(
      customer.updateProfile('u1', {
        fullName: 'Alice Adel',
        phone: '0101 234 5678',
        preferredLocale: 'en',
      }),
    ).toEqual({
      ok: true,
    });
    expect(customer.profile('u1').phone).toBe('+201012345678');
    expect(
      customer.updateProfile('u1', { fullName: 'A', phone: '', preferredLocale: 'ar' }),
    ).toMatchObject({
      code: 'invalid_name',
    });
    const home = {
      label: 'home' as const,
      governorate: 'cairo',
      area: 'Nasr City',
      address: '12 Makram St',
      notes: null,
      phone: null,
      isDefault: false,
    };
    expect(customer.saveAddress('u1', home).address?.isDefault).toBe(true);
    const work = customer.saveAddress('u1', { ...home, label: 'work', isDefault: true }).address;
    expect(
      customer
        .listAddresses('u1')
        .filter((a) => a.isDefault)
        .map((a) => a.id),
    ).toEqual([work?.id]);
    expect(customer.saveAddress('u1', { ...home, area: 'N' })).toMatchObject({ field: 'area' });
    expect(customer.saveAddress('u2', { ...home, id: work?.id })).toMatchObject({
      code: 'not_found',
    });
    expect(customer.listAddresses('u2')).toEqual([]);
    expect(
      addressProblem({ governorate: 'giza', area: 'Dokki', address: '5 Tahrir St', notes: null }),
    ).toBeNull();
  });

  it('order status → in-app notifications once per status; mark read; mandatory order category', () => {
    const { customer, order, deliver } = setup();
    const o = order('u1', [[CABLE, 1]]);
    deliver(o.id);
    const inbox = customer.listNotifications('u1');
    expect(inbox.items.filter((n) => n.category === 'order')).toHaveLength(4);
    expect(customer.listNotifications('u1').items).toHaveLength(4); // re-sync is idempotent
    expect(inbox.items[0]?.actionPath).toBe(`/order/${o.orderNumber}`);
    expect(customer.markRead('u1', inbox.items[0]?.id ?? '')).toBe(3);
    expect(customer.markAllRead('u1')).toBe(0);
    expect(customer.listNotifications('u2').items).toEqual([]);
    expect(customer.setPreference('u1', 'order', 'in_app', false)).toMatchObject({
      code: 'mandatory_category',
    });
    expect(customer.setPreference('u1', 'price_drop', 'email', true)).toMatchObject({
      code: 'channel_unavailable',
    });
  });

  it('wishlist: deterministic merge, repeat-safe, invalid reported, private', () => {
    const { customer } = setup();
    customer.setWishlist('u1', P_CABLE, null, true);
    const merged = customer.mergeWishlist('u1', [
      { productId: P_CABLE, variantId: null, addedAt: '2026-01-01T00:00:00Z' },
      { productId: P_AP4, variantId: AP4, addedAt: '2026-01-02T00:00:00Z' },
      { productId: P_AP4, variantId: AP4 },
      { productId: 'demo-product-missing', variantId: null },
    ]);
    expect(merged.items).toHaveLength(2);
    expect(merged.adjustments).toEqual([
      { productId: 'demo-product-missing', reason: 'removed_missing' },
    ]);
    expect(customer.mergeWishlist('u1', merged.items).items).toHaveLength(2);
    expect(customer.wishlist('u2').items).toEqual([]);
    expect(customer.setWishlist('u1', P_CABLE, null, false)).toMatchObject({ saved: false });
    expect(customer.wishlist('u1').items.map((i) => i.productId)).toEqual([P_AP4]);
  });

  it('recently viewed: dedupe, order, cap, merge, private', () => {
    const { customer, settings, tick } = setup();
    settings.engagement.recentlyViewed.maxItems = 2;
    customer.trackRecent('u1', P_CABLE, null);
    tick(1000);
    customer.trackRecent('u1', P_CHARGER, null);
    tick(1000);
    customer.trackRecent('u1', P_CABLE, null);
    expect(customer.listRecent('u1').map((r) => r.productId)).toEqual([P_CABLE, P_CHARGER]);
    customer.mergeRecent('u1', [
      { productId: P_AP4, variantId: null, viewedAt: '2030-01-01T00:00:00Z' },
    ]);
    expect(customer.listRecent('u1')).toHaveLength(2);
    expect(customer.listRecent('u1')[0]?.productId).toBe(P_AP4);
    expect(customer.listRecent('u2')).toEqual([]);
  });

  it('notify me: guest claim token, back in stock notifies once, expiry derived', () => {
    const { customer, commerce, actor, order, tick } = setup();
    // Hold every PS5 Digital unit so the variant is unavailable.
    const stock = commerce.engine().variant(PS5)?.available ?? 0;
    const holder = order('holder', [[PS5, stock]]);
    const guest = customer.createRequest(actor(null), {
      kind: 'notify',
      productSlug: 'playstation-5-slim',
      variantSku: 'PS5S-DIGITAL-WHITE',
      name: 'Guest',
      phone: '01112223334',
      email: null,
    });
    expect(guest.claimToken).toBeTruthy();
    expect(
      customer.claimRequests(actor('u1'), [
        { kind: 'notify', id: guest.id ?? '', token: 'wrong-token-wrong-token' },
      ]).linked,
    ).toBe(0);
    expect(
      customer.claimRequests(actor('u1'), [
        { kind: 'notify', id: guest.id ?? '', token: guest.claimToken ?? '' },
      ]).linked,
    ).toBe(1);
    expect(customer.listRequests('u1').notify[0]?.status).toBe('active');
    expect(customer.listRequests('u2').notify).toEqual([]);
    commerce.cancel(actor('demo-manager', 'store_manager'), holder.id, 'test');
    expect(customer.listRequests('u1').notify[0]?.status).toBe('notified');
    customer.listNotifications('u1');
    expect(
      customer.listNotifications('u1').items.filter((n) => n.category === 'back_in_stock'),
    ).toHaveLength(1);
    const later = customer.createRequest(actor('u3'), {
      kind: 'waitlist',
      productSlug: 'iphone-duo',
      variantSku: null,
      name: 'Carol',
      phone: '01212223334',
      email: null,
      desiredStorage: '256GB',
      desiredColor: null,
    });
    expect(later.status).toBe('created');
    tick(400 * 86_400_000);
    expect(customer.listRequests('u3').waitlist[0]?.status).toBe('expired');
  });

  it('abandoned cart: recent / old / converted / empty / disabled', () => {
    const { customer, commerce, settings, order, tick } = setup();
    expect(customer.cartStatus('u1').abandoned).toBe(false); // empty
    commerce.setCartItem('u1', CABLE, 1);
    expect(customer.cartStatus('u1').abandoned).toBe(false); // recent
    tick(49 * 3_600_000);
    expect(customer.cartStatus('u1').abandoned).toBe(true);
    customer.listNotifications('u1');
    customer.listNotifications('u1');
    expect(
      customer.listNotifications('u1').items.filter((n) => n.category === 'cart'),
    ).toHaveLength(1);
    settings.abandonedCart.enabled = false;
    expect(customer.cartStatus('u1').abandoned).toBe(false);
    settings.abandonedCart.enabled = true;
    order('u1', [[CHARGER, 1]]);
    expect(customer.cartStatus('u1').abandoned).toBe(false); // converted
  });

  it('reviews: eligibility, pending → approved/rejected, one per product, staff-only moderation', () => {
    const { customer, actor, order, deliver } = setup();
    const o = order('u1', [[CHARGER, 1]]);
    expect(customer.reviewStatus('u1', 'apple-20w-usb-c-adapter').reason).toBe('not_delivered');
    expect(
      customer.submitReview('u1', {
        productSlug: 'apple-20w-usb-c-adapter',
        rating: 5,
        title: null,
        body: 'Great charger!!',
        imagePath: null,
      }),
    ).toMatchObject({ code: 'not_eligible' });
    deliver(o.id);
    expect(customer.reviewStatus('u1', 'apple-20w-usb-c-adapter').eligible).toBe(true);
    expect(customer.reviewStatus('u2', 'apple-20w-usb-c-adapter').reason).toBe('no_purchase');
    expect(customer.reviewStatus(null, 'apple-20w-usb-c-adapter').reason).toBe('sign_in');
    const first = customer.submitReview('u1', {
      productSlug: 'apple-20w-usb-c-adapter',
      rating: 5,
      title: 'Top',
      body: 'Great charger, fast!',
      imagePath: null,
    });
    expect(first.review).toMatchObject({ status: 'pending', verifiedBuyer: true });
    const edited = customer.submitReview('u1', {
      productSlug: 'apple-20w-usb-c-adapter',
      rating: 4,
      title: null,
      body: 'Edited: still great.',
      imagePath: null,
    });
    expect(edited.review?.id).toBe(first.review?.id);
    expect(customer.publicReviews('apple-20w-usb-c-adapter')?.summary.count).toBe(0);
    expect(() =>
      customer.moderateReview(actor('u2'), first.review?.id ?? '', 'approved', null),
    ).toThrow(DemoPermissionError);
    expect(
      customer.moderateReview(
        actor('u1', 'customer_service'),
        first.review?.id ?? '',
        'approved',
        null,
      ),
    ).toMatchObject({ code: 'own_review' });
    expect(
      customer.moderateReview(
        actor('cs', 'customer_service'),
        first.review?.id ?? '',
        'approved',
        'ok',
      ).ok,
    ).toBe(true);
    const pub = customer.publicReviews('apple-20w-usb-c-adapter');
    expect(pub?.summary.count).toBe(1);
    expect(JSON.stringify(pub)).not.toMatch(/u1@|moderation|userId/);
    customer.moderateReview(
      actor('cs', 'customer_service'),
      first.review?.id ?? '',
      'rejected',
      'off-topic',
    );
    expect(customer.publicReviews('apple-20w-usb-c-adapter')?.summary.count).toBe(0);
    expect(
      customer.listNotifications('u1').items.filter((n) => n.category === 'review'),
    ).toHaveLength(2);
    // Demo reviews are labelled and never verified buyers.
    expect(customer.publicReviews('iphone-18-pro')?.items[0]).toMatchObject({
      isDemo: true,
      verifiedBuyer: false,
    });
  });

  it('recommendations: manual first, compatibility both ways, bought together needs ≥ 2 customers', () => {
    const { customer, commerce, actor, order, deliver } = setup();
    const rec = customer.recommendations('iphone-18-pro');
    expect(rec?.boughtTogether[0]?.slug).toBe('apple-20w-usb-c-adapter');
    expect(rec?.compatible.map((p) => p.slug)).toContain('magsafe-clear-case-18-pro');
    expect(
      customer.recommendations('magsafe-clear-case-18-pro')?.compatible.map((p) => p.slug),
    ).toContain('iphone-18-pro');
    expect(rec?.related[0]?.slug).toBe('iphone-18-pro-max');
    expect(rec?.youMayAlsoLike.map((p) => p.slug)).not.toContain('iphone-18-pro');
    const pair = (): string[] =>
      customer.recommendations('usb-c-cable')?.boughtTogether.map((p) => p.slug) ?? [];
    deliver(
      order('a', [
        [CABLE, 1],
        [AP4, 1],
      ]).id,
    );
    expect(pair()).not.toContain('airpods-4'); // one customer only
    const cancelled = order('b', [
      [CABLE, 1],
      [AP4, 1],
    ]);
    commerce.cancel(actor('demo-manager', 'store_manager'), cancelled.id, 'test');
    expect(pair()).not.toContain('airpods-4'); // cancelled excluded
    deliver(
      order('b', [
        [CABLE, 1],
        [AP4, 1],
      ]).id,
    );
    expect(pair()).toContain('airpods-4');
    expect(JSON.stringify(customer.recommendations('usb-c-cable'))).not.toMatch(/customer|MS-20/);
  });
});
