import type { AvailabilityState, StockState } from '@/domain/catalog/types';
import { stockStateFor } from '@/domain/catalog/stock';
import type { LocalizedText } from '@/domain/localized';
import { addMoney, multiplyMoney, percentOf, subtractMoney } from './money';
import type {
  FulfillmentMethod,
  LineDiscount,
  OfferSnapshot,
  PromoResult,
  Quote,
  QuoteLine,
  QuoteLineStatus,
  VariantOptionSnapshot,
} from './types';

/**
 * Reference implementation of app.build_quote (20260926100200_commerce_checkout.sql), used by the
 * demo adapter. Same rules, same rounding (piasters, half-up):
 *   1. lines — identity, visibility, purchasability, per-line cap, availability, effective price;
 *   2. bundle offers — every bundle item present → discount_percent on complete sets;
 *   3. free-gift offers — gift line at price 0 when the gift is in stock;
 *   4. promo code — validated server-side; % per eligible line or fixed amount spread in order;
 *   5. totals over valid lines; delivery shipping fee stays "to be confirmed".
 */
export interface QuoteVariantInfo {
  variantId: string;
  productId: string;
  productSlug: string;
  sku: string;
  name: LocalizedText;
  brand: LocalizedText | null;
  variantLabel: LocalizedText | null;
  options: VariantOptionSnapshot[];
  image: string | null;
  warranty: LocalizedText | null;
  /** Product published, not deleted, brand visible, demo gate passed. */
  visible: boolean;
  active: boolean;
  availabilityState: AvailabilityState;
  regularPrice: number | null;
  unitPrice: number | null;
  offer: OfferSnapshot | null;
  available: number;
  lowStockThreshold: number;
  isDemo: boolean;
}

export interface QuoteOfferInfo {
  id: string;
  slug: string;
  kind: string;
  title: LocalizedText;
  badge: LocalizedText;
  discountPercent: number | null;
  discountAmount: number | null;
  promoCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  minSubtotal: number | null;
  sortOrder: number;
  products: { productSlug: string; role: 'target' | 'bundle_item' | 'gift'; quantity: number }[];
}

export interface QuoteContext {
  now: Date;
  customerId: string | null;
  maxQuantityPerLine: number;
  promoCodesEnabled: boolean;
  variant(variantId: string): QuoteVariantInfo | null;
  /** Published offers (any window) visible in this mode. */
  offers: QuoteOfferInfo[];
  /** Active redemptions of a promo offer (overall / by this customer). */
  redemptions(offerId: string, customerId: string | null): { total: number; customer: number };
  /** Default (or first active) variant of a product — gift lines. */
  defaultVariant(productSlug: string): string | null;
}

export interface QuoteItemInput {
  variantId: string;
  quantity: number;
  expectedUnitPrice?: number | null;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DEMO_ID = /^demo-[a-z0-9-]+$/;

/** Mirrors app.quote_items: valid entries only, duplicates summed (first position wins), ≤ 20 lines. */
export function normalizeQuoteItems(items: unknown): QuoteItemInput[] {
  if (!Array.isArray(items)) return [];
  const order: string[] = [];
  const byId = new Map<string, QuoteItemInput>();
  for (const raw of items as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = item.variantId;
    const quantity = item.quantity;
    if (typeof id !== 'string' || !(UUID.test(id) || DEMO_ID.test(id))) continue;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    )
      continue;
    const expected = typeof item.expectedUnitPrice === 'number' ? item.expectedUnitPrice : null;
    const existing = byId.get(id);
    if (existing) existing.quantity = Math.min(existing.quantity + quantity, 99);
    else {
      order.push(id);
      byId.set(id, { variantId: id, quantity, expectedUnitPrice: expected });
    }
  }
  return order.slice(0, 20).map((id) => byId.get(id) as QuoteItemInput);
}

const isActiveAt = (o: QuoteOfferInfo, now: Date) =>
  (o.startsAt === null || new Date(o.startsAt).getTime() <= now.getTime()) &&
  (o.endsAt === null || new Date(o.endsAt).getTime() > now.getTime());

const targets = (o: QuoteOfferInfo, productSlug: string | null, untargetedApplies: boolean) => {
  const hasTargets = o.products.some((p) => p.role === 'target');
  if (!hasTargets) return untargetedApplies;
  return o.products.some((p) => p.role === 'target' && p.productSlug === productSlug);
};

const snapshotOf = (o: QuoteOfferInfo): OfferSnapshot => ({
  slug: o.slug,
  kind: o.kind,
  title: o.title,
  badge: o.badge,
  discountPercent: o.discountPercent,
  discountAmount: o.discountAmount,
  endsAt: o.endsAt,
});

export function buildQuote(
  ctx: QuoteContext,
  rawItems: unknown,
  options: { promoCode?: string | null; fulfillment?: FulfillmentMethod | null } = {},
): Quote {
  const items = normalizeQuoteItems(rawItems);
  const lines: QuoteLine[] = [];
  const productOf = new Map<number, string>(); // lineNo → productSlug

  // 1. Lines
  items.forEach((item, index) => {
    const lineNo = index + 1;
    const info = ctx.variant(item.variantId);
    const base: QuoteLine = {
      lineNo,
      variantId: item.variantId,
      productId: null,
      productSlug: null,
      sku: null,
      name: null,
      brand: null,
      variantLabel: null,
      options: [],
      image: null,
      warranty: null,
      quantity: item.quantity,
      status: 'unavailable',
      maxQuantity: null,
      stockState: null,
      regularUnitPrice: null,
      unitPrice: null,
      expectedUnitPrice: item.expectedUnitPrice ?? null,
      lineSubtotal: null,
      discount: 0,
      discounts: [],
      lineTotal: null,
      offer: null,
      isGift: false,
      isDemo: false,
    };
    if (!info) {
      lines.push(base);
      return;
    }
    let status: QuoteLineStatus = 'ok';
    let maxQuantity: number | null = null;
    if (!info.active || !info.visible) status = 'unavailable';
    else if (info.availabilityState !== 'available' || info.unitPrice === null)
      status = 'not_purchasable';
    else if (item.quantity > ctx.maxQuantityPerLine) {
      status = 'max_quantity';
      maxQuantity = ctx.maxQuantityPerLine;
    } else if (info.available <= 0) {
      status = 'out_of_stock';
      maxQuantity = 0;
    } else if (info.available < item.quantity) {
      status = 'insufficient_stock';
      maxQuantity = Math.min(info.available, ctx.maxQuantityPerLine);
    }
    productOf.set(lineNo, info.productSlug);
    lines.push({
      ...base,
      productId: info.productId,
      productSlug: info.productSlug,
      sku: info.sku,
      name: info.name,
      brand: info.brand,
      variantLabel: info.variantLabel,
      options: info.options,
      image: info.image,
      warranty: info.warranty,
      status,
      maxQuantity,
      stockState: stockStateFor(info.available, info.lowStockThreshold, info.active) as StockState,
      regularUnitPrice: info.regularPrice,
      unitPrice: info.unitPrice,
      lineSubtotal: info.unitPrice !== null ? multiplyMoney(info.unitPrice, item.quantity) : null,
      offer: info.offer,
      isDemo: info.isDemo,
    });
  });

  const okLines = () => lines.filter((l) => l.status === 'ok' && !l.isGift);
  const addDiscount = (line: QuoteLine, entry: LineDiscount) => {
    line.discount = addMoney(line.discount, entry.amount);
    line.discounts.push(entry);
  };

  const activeOffers = ctx.offers
    .filter((o) => isActiveAt(o, ctx.now))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  // 2. Bundles
  const used = new Map<number, number>();
  const bundles: Quote['bundles'] = [];
  for (const offer of activeOffers.filter(
    (o) => o.kind === 'bundle' && o.discountPercent !== null,
  )) {
    const itemsOf = offer.products.filter((p) => p.role === 'bundle_item');
    if (itemsOf.length < 2) continue;
    let sets = Number.POSITIVE_INFINITY;
    for (const bundleItem of itemsOf) {
      const units = okLines()
        .filter((l) => l.productSlug === bundleItem.productSlug)
        .reduce((n, l) => n + l.quantity - (used.get(l.lineNo) ?? 0), 0);
      sets = Math.min(sets, Math.floor(units / bundleItem.quantity));
    }
    if (!Number.isFinite(sets) || sets <= 0) continue;
    let bundleDiscount = 0;
    for (const bundleItem of itemsOf) {
      let units = sets * bundleItem.quantity;
      for (const line of lines) {
        if (units <= 0) break;
        if (line.status !== 'ok' || line.isGift || line.productSlug !== bundleItem.productSlug)
          continue;
        const count = Math.min(units, line.quantity - (used.get(line.lineNo) ?? 0));
        if (count <= 0) continue;
        const amount = percentOf(
          multiplyMoney(line.unitPrice ?? 0, count),
          offer.discountPercent ?? 0,
        );
        addDiscount(line, {
          source: 'bundle',
          offerSlug: offer.slug,
          title: offer.title,
          units: count,
          amount,
        });
        used.set(line.lineNo, (used.get(line.lineNo) ?? 0) + count);
        bundleDiscount = addMoney(bundleDiscount, amount);
        units -= count;
      }
    }
    bundles.push({ offerSlug: offer.slug, title: offer.title, sets, discount: bundleDiscount });
  }

  // 3. Free gifts
  const giftNotes: Quote['giftNotes'] = [];
  for (const offer of activeOffers.filter((o) => o.kind === 'free_gift')) {
    if (!okLines().some((l) => targets(offer, l.productSlug, false))) continue;
    const gift = offer.products.find((p) => p.role === 'gift');
    const giftVariant = gift ? ctx.defaultVariant(gift.productSlug) : null;
    if (!gift || !giftVariant) continue;
    const info = ctx.variant(giftVariant);
    const alreadyRequested = lines
      .filter((l) => l.variantId === giftVariant && l.status === 'ok')
      .reduce((n, l) => n + l.quantity, 0);
    if (info && info.visible && info.available - alreadyRequested >= gift.quantity) {
      lines.push({
        lineNo: lines.length + 1,
        variantId: giftVariant,
        productId: info.productId,
        productSlug: info.productSlug,
        sku: info.sku,
        name: info.name,
        brand: info.brand,
        variantLabel: info.variantLabel,
        options: info.options,
        image: info.image,
        warranty: info.warranty,
        quantity: gift.quantity,
        status: 'ok',
        maxQuantity: null,
        stockState: 'in_stock',
        regularUnitPrice: info.regularPrice ?? 0,
        unitPrice: 0,
        expectedUnitPrice: null,
        lineSubtotal: 0,
        discount: 0,
        discounts: [],
        lineTotal: null,
        offer: snapshotOf(offer),
        isGift: true,
        isDemo: info.isDemo,
      });
    } else {
      giftNotes.push({ offerSlug: offer.slug, title: offer.title, status: 'unavailable' });
    }
  }

  // 4. Promo code
  let promo: PromoResult | null = null;
  const code = (options.promoCode ?? '').trim().toUpperCase();
  if (code) {
    const offer = ctx.offers.find(
      (o) => o.kind === 'promo_code' && (o.promoCode ?? '').toUpperCase() === code,
    );
    const invalid = (reason: Extract<PromoResult, { status: 'invalid' }>['reason']) =>
      ({ code, status: 'invalid', reason }) as const;
    if (!ctx.promoCodesEnabled) promo = invalid('disabled');
    else if (!offer) promo = invalid('not_found');
    else if (offer.startsAt && new Date(offer.startsAt).getTime() > ctx.now.getTime())
      promo = invalid('not_started');
    else if (offer.endsAt && new Date(offer.endsAt).getTime() <= ctx.now.getTime())
      promo = invalid('expired');
    else {
      const counts = ctx.redemptions(offer.id, ctx.customerId);
      if (offer.maxRedemptions !== null && counts.total >= offer.maxRedemptions)
        promo = invalid('limit_reached');
      else if (
        ctx.customerId !== null &&
        offer.maxRedemptionsPerCustomer !== null &&
        counts.customer >= offer.maxRedemptionsPerCustomer
      )
        promo = invalid('customer_limit');
      else {
        const eligible = okLines().filter((l) => targets(offer, l.productSlug, true));
        const base = eligible.reduce(
          (sum, l) => addMoney(sum, subtractMoney(l.lineSubtotal ?? 0, l.discount)),
          0,
        );
        if (eligible.length === 0) promo = invalid('not_applicable');
        else if (offer.minSubtotal !== null && base < offer.minSubtotal)
          promo = {
            code,
            status: 'invalid',
            reason: 'min_subtotal',
            minSubtotal: offer.minSubtotal,
          };
        else {
          let left = Math.min(offer.discountAmount ?? 0, base);
          let total = 0;
          for (const line of eligible) {
            const lineBase = subtractMoney(line.lineSubtotal ?? 0, line.discount);
            let amount: number;
            if (offer.discountPercent !== null) amount = percentOf(lineBase, offer.discountPercent);
            else {
              amount = Math.min(left, lineBase);
              left = subtractMoney(left, amount);
            }
            if (amount <= 0) continue;
            addDiscount(line, {
              source: 'promo',
              offerSlug: offer.slug,
              code,
              title: offer.title,
              amount,
            });
            total = addMoney(total, amount);
          }
          promo = {
            code,
            status: 'applied',
            offerSlug: offer.slug,
            title: offer.title,
            discountPercent: offer.discountPercent,
            discountAmount: offer.discountAmount,
            discount: total,
          };
        }
      }
    }
  }

  // 5. Totals
  let original = 0;
  let subtotal = 0;
  let discount = 0;
  const issues = new Set<string>();
  for (const line of lines) {
    if (line.status === 'ok') {
      line.lineTotal = subtractMoney(line.lineSubtotal ?? 0, line.discount);
      if (!line.isGift) {
        original = addMoney(original, multiplyMoney(line.regularUnitPrice ?? 0, line.quantity));
        subtotal = addMoney(subtotal, line.lineSubtotal ?? 0);
      }
      discount = addMoney(discount, line.discount);
    } else {
      issues.add(line.status);
      line.lineTotal = null;
    }
  }
  if (items.length === 0) issues.add('empty');
  const pickup = options.fulfillment === 'pickup';
  const shippingFee = pickup ? 0 : null;
  return {
    currency: 'EGP',
    computedAt: ctx.now.toISOString(),
    valid: issues.size === 0,
    issues: [...issues],
    lines,
    bundles,
    giftNotes,
    promo,
    totals: {
      originalSubtotal: original,
      subtotal,
      discountTotal: discount,
      shippingFee,
      shippingFeeStatus: pickup ? 'not_required' : 'pending',
      total: addMoney(subtractMoney(subtotal, discount), shippingFee ?? 0),
    },
  };
}
