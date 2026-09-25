import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import demoCatalogJson from '@seed/demo/catalog.json';
import { SYSTEM_ROLES } from '@/domain/access/permissions';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import {
  commerceSettingsSchema,
  featuresSettingsSchema,
  orderReviewSettingsSchema,
  storeSettingsSchema,
} from '@/domain/settings/schemas';
import {
  addToCart,
  cartCount,
  mergeCarts,
  removeOrdered,
  setCartQuantity,
  setSavedForLater,
} from './cart';
import {
  DemoCommerce,
  DemoPermissionError,
  emptyDemoCommerceState,
  type DemoActor,
  type DemoCommerceSettings,
  type DemoCommerceState,
} from './demoCommerce';
import { addMoney, multiplyMoney, percentOf, subtractMoney, toMinor } from './money';
import { normalizeQuoteItems } from './pricing';
import { derivedPaymentStatus, orderTransitionAllowed } from './status';
import type { CreateOrderPayload, Quote } from './types';

const raw = rawCatalogSchema.parse(demoCatalogJson);
const v = (sku: string) => {
  const found = raw.products.flatMap((p) => p.variants).find((x) => x.sku === sku);
  if (!found) throw new Error(`missing ${sku}`);
  return found.id;
};
const AIRPODS = v('APP3-WHITE');
const CASE = v('CASE18P-WHITE');
const CABLE = v('USBC-1M-WHITE');
const AP4 = v('AP4-STANDARD-WHITE');
const AWS = v('AWS11-42MM-BLACK');
const MBA = v('MBA13-256GB-MIDNIGHT');
const PS5 = v('PS5S-DIGITAL-WHITE');
const PROMAX = v('IP18PM-256GB-BLACK');
const SOLDOUT = v('IP18P-1TB-ORANGE');

const reviewOff = orderReviewSettingsSchema.parse({
  ...baseSeed.settings.order_review,
  highValue: { enabled: false, threshold: 100000 },
  multipleExpensive: { enabled: false, unitPrice: 20000, minUnits: 2 },
  newCustomer: { enabled: false, minTotal: 30000 },
  splitPayment: { enabled: false },
  unfinishedOrders: { enabled: false, maxCount: 2, windowDays: 7 },
  velocity: { enabled: false, maxOrders: 3, windowHours: 1 },
});

function setup(overrides: Partial<DemoCommerceSettings> = {}) {
  let now = new Date('2026-09-25T12:00:00Z');
  let state: DemoCommerceState | null = null;
  const settings: DemoCommerceSettings = {
    features: featuresSettingsSchema.parse({ ...baseSeed.settings.features, promoCodes: true }),
    commerce: commerceSettingsSchema.parse(baseSeed.settings.commerce),
    orderReview: reviewOff,
    store: storeSettingsSchema.parse(baseSeed.settings.store),
    ...overrides,
  };
  const commerce = new DemoCommerce({
    raw,
    storage: { load: () => state, save: (s) => (state = structuredClone(s)) },
    settings: () => settings,
    now: () => now,
  });
  const actor = (userId: string | null, role?: string): DemoActor => {
    const def = SYSTEM_ROLES.find((r) => r.key === role);
    return {
      userId,
      email: userId ? `${userId}@demo.invalid` : null,
      can: (p) => Boolean(def && (def.grantsAll || def.permissions.includes(p))),
    };
  };
  const checkout = (
    who: DemoActor,
    items: [string, number][],
    extra: Partial<CreateOrderPayload> = {},
    key = crypto.randomUUID(),
  ) => {
    const fulfillment = extra.fulfillment ?? { method: 'pickup' as const, branchId: 'abbasseya' };
    const quote: Quote = commerce.quote(
      who.userId,
      items.map(([variantId, quantity]) => ({ variantId, quantity })),
      { promoCode: extra.promoCode ?? null, fulfillment: fulfillment.method },
    );
    return commerce.createOrder(who, {
      idempotencyKey: key,
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
      payment: { method: 'cod' },
      note: null,
      locale: 'en',
      ...extra,
      fulfillment,
    });
  };
  return {
    commerce,
    actor,
    checkout,
    settings,
    tick: (ms: number) => (now = new Date(now.getTime() + ms)),
    state: () => state ?? emptyDemoCommerceState(),
  };
}

describe('money (integer piasters, DB-compatible rounding)', () => {
  it('avoids float artefacts and rounds half up like numeric round(x, 2)', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subtractMoney(13650, 5000)).toBe(8650);
    expect(multiplyMoney(900, 2)).toBe(1800);
    expect(percentOf(1800, 10)).toBe(180);
    expect(percentOf(29500, 6)).toBe(1770);
    expect(percentOf(0.05, 50)).toBe(0.03); // 2.5 piasters → 3
    expect(percentOf(123456789.99, 12.5)).toBe(15432098.75);
    expect(toMinor(99999999.99)).toBe(9999999999);
  });
});

describe('browser cart', () => {
  it('keeps one line per variant, clamps quantities and supports save-for-later', () => {
    let lines = addToCart(
      [],
      { variantId: CABLE, productSlug: 'usb-c-cable', quantity: 2, seenUnitPrice: 900 },
      5,
    );
    lines = addToCart(
      lines,
      { variantId: CABLE, productSlug: 'usb-c-cable', quantity: 9, seenUnitPrice: 900 },
      5,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(5);
    lines = addToCart(
      lines,
      { variantId: AIRPODS, productSlug: 'airpods-pro-3', quantity: 1, seenUnitPrice: 13500 },
      5,
    );
    lines = setSavedForLater(lines, AIRPODS, true);
    expect(cartCount(lines)).toBe(5);
    lines = setCartQuantity(lines, CABLE, 0, 5);
    expect(lines.map((l) => l.variantId)).toEqual([AIRPODS]);
    expect(removeOrdered(lines, [AIRPODS])).toHaveLength(1); // saved lines survive checkout
  });

  it('merges deterministically into the account cart (mirrors public.cart_merge)', () => {
    const result = mergeCarts(
      [{ variantId: CABLE, quantity: 3, savedForLater: false, seenUnitPrice: 900, addedAt: 'x' }],
      [
        { variantId: CABLE, quantity: 4, savedForLater: false, seenUnitPrice: 900 },
        { variantId: AIRPODS, quantity: 1, savedForLater: true, seenUnitPrice: null },
        { variantId: 'demo-variant-gone', quantity: 1, savedForLater: false, seenUnitPrice: null },
        { variantId: PS5, quantity: 3, savedForLater: false, seenUnitPrice: null },
      ],
      {
        maxPerLine: 5,
        exists: (id) => id !== 'demo-variant-gone',
        available: (id) => (id === PS5 ? 1 : 25),
      },
    );
    expect(result.items.map((i) => [i.variantId, i.quantity, i.savedForLater])).toEqual([
      [CABLE, 5, false],
      [AIRPODS, 1, true],
      [PS5, 1, false],
    ]);
    expect(result.adjustments.map((a) => a.reason)).toEqual([
      'capped_max',
      'removed_missing',
      'capped_stock',
    ]);
  });

  it('parses only well-formed items and aggregates duplicates', () => {
    expect(
      normalizeQuoteItems([
        { variantId: CABLE, quantity: 1 },
        { variantId: CABLE, quantity: 2, expectedUnitPrice: 900 },
        { variantId: 'x', quantity: 1 },
        { variantId: AIRPODS, quantity: 1.5 },
        { variantId: AIRPODS, quantity: '2' },
      ]),
    ).toEqual([{ variantId: CABLE, quantity: 3, expectedUnitPrice: null }]);
  });
});

describe('server-side quote (same expectations as 07_commerce.test.sql)', () => {
  it('prices a mixed cart with automatic offer, bundle, promo code and free gift', () => {
    const { commerce } = setup();
    const quote = commerce.quote(
      null,
      [
        { variantId: AIRPODS, quantity: 1 },
        { variantId: CASE, quantity: 2 },
        { variantId: AP4, quantity: 1 },
        { variantId: AWS, quantity: 1 },
        { variantId: MBA, quantity: 1 },
      ],
      { promoCode: 'demo10', fulfillment: 'pickup' },
    );
    expect(quote.valid).toBe(true);
    expect(quote.totals).toEqual({
      originalSubtotal: 111300,
      subtotal: 109800,
      discountTotal: 3430,
      shippingFee: 0,
      shippingFeeStatus: 'not_required',
      total: 106370,
    });
    expect(quote.bundles[0]?.discount).toBe(2950);
    expect(quote.promo).toMatchObject({ status: 'applied', discount: 480 });
    expect(quote.lines.filter((l) => l.isGift).map((l) => [l.sku, l.unitPrice])).toEqual([
      ['A20W-WHITE', 0],
    ]);
    expect(quote.lines[0]?.offer?.slug).toBe('airpods-pro-3-limited');
  });

  it('flags stock, caps, unknown variants and keeps delivery fees pending', () => {
    const { commerce } = setup();
    const q = (
      variantId: string,
      quantity: number,
      fulfillment: 'pickup' | 'delivery' = 'pickup',
    ) => commerce.quote(null, [{ variantId, quantity }], { fulfillment });
    expect(q(SOLDOUT, 1).lines[0]?.status).toBe('out_of_stock');
    expect(q(AIRPODS, 6).lines[0]).toMatchObject({ status: 'max_quantity', maxQuantity: 5 });
    expect(q(PS5, 2).lines[0]).toMatchObject({ status: 'insufficient_stock', maxQuantity: 1 });
    expect(q('demo-variant-nope', 1).lines[0]?.status).toBe('unavailable');
    expect(q(AIRPODS, 1, 'delivery').totals).toMatchObject({
      shippingFee: null,
      shippingFeeStatus: 'pending',
      total: 13500,
    });
  });

  it('validates promo codes server-side (toggle, applicability, window)', () => {
    const disabled = setup({
      features: featuresSettingsSchema.parse({ ...baseSeed.settings.features, promoCodes: false }),
    });
    expect(
      disabled.commerce.quote(null, [{ variantId: CABLE, quantity: 1 }], { promoCode: 'DEMO10' })
        .promo,
    ).toMatchObject({
      status: 'invalid',
      reason: 'disabled',
    });
    const { commerce } = setup();
    expect(
      commerce.quote(null, [{ variantId: AIRPODS, quantity: 1 }], { promoCode: 'DEMO10' }).promo,
    ).toMatchObject({
      reason: 'not_applicable',
    });
    expect(
      commerce.quote(null, [{ variantId: CABLE, quantity: 1 }], { promoCode: 'NOPE' }).promo,
    ).toMatchObject({
      reason: 'not_found',
    });
  });
});

describe('demo checkout lifecycle', () => {
  it('creates an idempotent COD order with snapshots and a 30-minute reservation', () => {
    const { checkout, actor, commerce } = setup();
    const me = actor('demo-customer-a');
    const key = crypto.randomUUID();
    const first = checkout(
      me,
      [
        [PS5, 1],
        [CABLE, 2],
      ],
      { promoCode: 'DEMO10' },
      key,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.order.orderNumber).toMatch(/^MS-\d{4}-000001$/);
    expect(first.order.totals).toMatchObject({
      total: 29120,
      paidAmount: 0,
      remainingAmount: 29120,
    });
    expect(first.order.paymentStatus).toBe('cod_pending');
    expect(first.order.customer.phone).toBe('+201012345678');
    expect(
      new Date(first.order.reservationExpiresAt ?? '').getTime() -
        new Date(first.order.createdAt).getTime(),
    ).toBe(30 * 60_000);
    const again = checkout(
      me,
      [
        [PS5, 1],
        [CABLE, 2],
      ],
      { promoCode: 'DEMO10' },
      key,
    );
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(commerce.listMyOrders(me.userId)).toHaveLength(1);
  });

  it('rejects unconfirmed prices and never trusts client totals', () => {
    const { commerce, actor } = setup();
    const result = commerce.createOrder(actor('demo-customer-a'), {
      idempotencyKey: crypto.randomUUID(),
      items: [{ variantId: AIRPODS, quantity: 1, expectedUnitPrice: 1 }],
      expectedTotal: 1,
      promoCode: null,
      contact: { name: 'Mona', phone: '01012345678' },
      fulfillment: { method: 'pickup', branchId: null },
      payment: { method: 'cod' },
      note: null,
      locale: 'ar',
    });
    expect(result).toMatchObject({ ok: false, code: 'price_changed' });
    if (!result.ok) expect(result.quote?.totals.total).toBe(13500);
  });

  it('reserves the last unit for one customer, releases it on expiry', () => {
    const { checkout, actor, commerce, tick } = setup();
    expect(checkout(actor('demo-customer-a'), [[PS5, 1]]).ok).toBe(true);
    expect(checkout(actor('demo-customer-b'), [[PS5, 1]])).toMatchObject({
      ok: false,
      code: 'cart_invalid',
    });
    expect(
      commerce
        .engine()
        .product('playstation-5-slim')
        ?.variants.find((x) => x.id === PS5)?.stockState,
    ).toBe('out_of_stock');
    tick(31 * 60_000);
    expect(
      commerce.quote(null, [{ variantId: PS5, quantity: 1 }], { fulfillment: 'pickup' }).lines[0]
        ?.status,
    ).toBe('ok');
  });

  it('confirms COD pickup: commits stock once; completes after cash is verified', () => {
    const { checkout, actor, commerce } = setup();
    const order = checkout(actor('demo-customer-a'), [[PS5, 1]]);
    if (!order.ok) throw new Error('order failed');
    const sales = actor('demo-sales', 'sales');
    const manager = actor('demo-manager', 'store_manager');
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null).ok).toBe(true);
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null)).toMatchObject({
      code: 'invalid_transition',
    });
    expect(commerce.engine().variant(PS5)?.stock).toBe(0);
    expect(commerce.setStatus(sales, order.order.id, 'preparing', null).ok).toBe(true);
    expect(commerce.setStatus(sales, order.order.id, 'ready_for_pickup', null).ok).toBe(true);
    expect(commerce.setStatus(sales, order.order.id, 'completed', null)).toMatchObject({
      code: 'balance_due',
    });
    expect(() =>
      commerce.recordPayment(sales, order.order.id, { amount: 27500, method: 'cash' }),
    ).toThrow(DemoPermissionError);
    const paid = commerce.recordPayment(manager, order.order.id, { amount: 27500, method: 'cash' });
    expect(paid.ok && paid.order.paymentStatus).toBe('paid');
    expect(commerce.setStatus(sales, order.order.id, 'completed', null).ok).toBe(true);
    expect(
      commerce
        .getMyOrder('demo-customer-a', order.order.orderNumber)
        ?.timeline.map((e) => e.status),
    ).toEqual(['new', 'confirmed', 'preparing', 'ready_for_pickup', null, 'completed']);
  });

  it('delivery + split payment: manual fee, verified deposit, balance on delivery', () => {
    const { checkout, actor, commerce } = setup();
    const order = checkout(actor('demo-customer-c'), [[AIRPODS, 1]], {
      fulfillment: {
        method: 'delivery',
        governorate: 'cairo',
        area: 'Nasr City',
        address: '12 Makram Ebeid St',
      },
      payment: { method: 'split', depositAmount: 5000 },
    });
    if (!order.ok) throw new Error(order.code);
    expect(order.order.totals).toMatchObject({ shippingFeeStatus: 'pending', total: 13500 });
    const sales = actor('demo-sales', 'sales');
    const manager = actor('demo-manager', 'store_manager');
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null)).toMatchObject({
      code: 'shipping_fee_pending',
    });
    expect(commerce.setShipping(sales, order.order.id, { fee: 150 })).toMatchObject({ ok: true });
    expect(
      commerce.markPaymentVerification(sales, order.order.id, 'Screenshot on WhatsApp'),
    ).toMatchObject({ ok: true });
    expect(commerce.getOrder(sales, order.order.id)?.totals.paidAmount).toBe(0); // a screenshot is not money
    expect(
      commerce.recordPayment(manager, order.order.id, { amount: 20000, method: 'instapay' }),
    ).toMatchObject({
      code: 'exceeds_remaining',
    });
    const deposit = commerce.recordPayment(manager, order.order.id, {
      amount: 5000,
      method: 'instapay',
    });
    if (!deposit.ok) throw new Error('deposit');
    expect(deposit.order.paymentStatus).toBe('deposit_verified');
    expect(deposit.order.totals).toMatchObject({
      total: 13650,
      paidAmount: 5000,
      remainingAmount: 8650,
    });
    expect(deposit.order.payments[0]?.kind).toBe('deposit');
    expect(commerce.setShipping(sales, order.order.id, { fee: 0 })).toMatchObject({ ok: true });
    expect(commerce.getOrder(sales, order.order.id)?.totals.remainingAmount).toBe(8500);
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null).ok).toBe(true);
  });

  it('manual review blocks confirmation until a manager decides; cancellations restock', () => {
    const { checkout, actor, commerce } = setup({
      orderReview: {
        ...reviewOff,
        multipleExpensive: { enabled: true, unitPrice: 20000, minUnits: 2 },
      },
    });
    const order = checkout(actor('demo-customer-b'), [[PROMAX, 2]]);
    if (!order.ok) throw new Error(order.code);
    expect(order.order.reviewPending).toBe(true);
    expect('manualReview' in order.order).toBe(false);
    const sales = actor('demo-sales', 'sales');
    const manager = actor('demo-manager', 'store_manager');
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null)).toMatchObject({
      code: 'review_pending',
    });
    expect(() => commerce.review(sales, order.order.id, 'approved', null)).toThrow(
      DemoPermissionError,
    );
    expect(commerce.review(manager, order.order.id, 'approved', 'Known customer').ok).toBe(true);
    const before = commerce.engine().variant(PROMAX)?.stock ?? 0;
    expect(commerce.setStatus(sales, order.order.id, 'confirmed', null).ok).toBe(true);
    expect(commerce.engine().variant(PROMAX)?.stock).toBe(before - 2);
    expect(commerce.cancel(sales, order.order.id, 'Customer changed plans').ok).toBe(true);
    expect(commerce.engine().variant(PROMAX)?.stock).toBe(before);
  });

  it('enforces customer cancel rules, promo limits and the open-order limit', () => {
    const { checkout, actor, commerce } = setup();
    const me = actor('demo-customer-a');
    const first = checkout(me, [[CASE, 1]], { promoCode: 'DEMO10' });
    if (!first.ok) throw new Error(first.code);
    expect(commerce.cancelMyOrder(me.userId, first.order.orderNumber, null).ok).toBe(true);
    expect(checkout(me, [[CASE, 1]], { promoCode: 'DEMO10' }).ok).toBe(true);
    expect(checkout(me, [[CABLE, 1]], { promoCode: 'DEMO10' }).ok).toBe(true);
    expect(checkout(me, [[CABLE, 1]], { promoCode: 'DEMO10' })).toMatchObject({
      code: 'promo_invalid',
    });
    expect(checkout(me, [[CABLE, 1]]).ok).toBe(true);
    expect(checkout(me, [[CABLE, 1]])).toMatchObject({ code: 'too_many_open_orders' });
    expect(commerce.getMyOrder('demo-customer-b', first.order.orderNumber)).toBeNull();
    expect(() => commerce.listOrders(me)).toThrow(DemoPermissionError);
  });

  it('validates contact, delivery address and payment availability', () => {
    const { checkout, actor } = setup();
    const me = actor('demo-customer-a');
    expect(
      checkout(me, [[CABLE, 1]], { contact: { name: 'M', phone: '01012345678' } }),
    ).toMatchObject({ code: 'invalid_name' });
    expect(checkout(me, [[CABLE, 1]], { contact: { name: 'Mona', phone: '12345' } })).toMatchObject(
      { code: 'invalid_phone' },
    );
    expect(
      checkout(me, [[CABLE, 1]], { contact: { name: 'Mona', phone: '+20 101 234 5678' } }),
    ).toMatchObject({ ok: true });
    expect(
      checkout(me, [[CABLE, 1]], {
        fulfillment: { method: 'delivery', governorate: 'cairo', area: 'N', address: '12 St' },
      }),
    ).toMatchObject({ code: 'invalid_address' });
    expect(checkout(me, [[CABLE, 1]], { payment: { method: 'pay_at_store' } })).toMatchObject({
      code: 'payment_method_unavailable',
    });
    expect(checkout(actor(null), [[CABLE, 1]])).toMatchObject({ code: 'auth_required' });
  });
});

describe('status rules', () => {
  it('only allows the documented transitions', () => {
    expect(orderTransitionAllowed('new', 'confirmed', 'pickup')).toBe(true);
    expect(orderTransitionAllowed('preparing', 'out_for_delivery', 'pickup')).toBe(false);
    expect(orderTransitionAllowed('preparing', 'ready_for_pickup', 'pickup')).toBe(true);
    expect(orderTransitionAllowed('completed', 'new', 'pickup')).toBe(false);
  });

  it('derives payment status from verified money only', () => {
    const base = {
      status: 'new' as const,
      paymentStatus: 'awaiting_deposit' as const,
      total: 100,
      shippingFeeStatus: 'confirmed' as const,
    };
    expect(derivedPaymentStatus({ ...base, paymentMethod: 'split', paidAmount: 0 })).toBe(
      'awaiting_deposit',
    );
    expect(derivedPaymentStatus({ ...base, paymentMethod: 'split', paidAmount: 40 })).toBe(
      'deposit_verified',
    );
    expect(derivedPaymentStatus({ ...base, paymentMethod: 'instapay', paidAmount: 100 })).toBe(
      'paid',
    );
    expect(
      derivedPaymentStatus({
        ...base,
        paymentMethod: 'instapay',
        paidAmount: 100,
        shippingFeeStatus: 'pending',
      }),
    ).toBe('partially_paid');
  });
});
