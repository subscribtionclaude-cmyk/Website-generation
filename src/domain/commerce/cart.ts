import type { AccountCartItem, CartLine, CartMergeAdjustment } from './types';

/**
 * Browser cart (signed-out) operations. Pure functions over an ordered list of lines; one line per
 * variant. Quantities are clamped to 1…maxPerLine; stock is validated by the server quote.
 */
export const MAX_CART_LINES = 20;

export function clampQuantity(quantity: number, maxPerLine: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(Math.max(Math.trunc(quantity), 1), maxPerLine);
}

export function addToCart(
  lines: CartLine[],
  input: {
    variantId: string;
    productSlug: string | null;
    quantity: number;
    seenUnitPrice: number | null;
  },
  maxPerLine: number,
  now: Date = new Date(),
): CartLine[] {
  const existing = lines.find((l) => l.variantId === input.variantId);
  if (existing) {
    return lines.map((l) =>
      l.variantId === input.variantId
        ? {
            ...l,
            quantity: clampQuantity(l.quantity + input.quantity, maxPerLine),
            savedForLater: false,
            seenUnitPrice: input.seenUnitPrice ?? l.seenUnitPrice,
            productSlug: input.productSlug ?? l.productSlug,
          }
        : l,
    );
  }
  if (lines.length >= MAX_CART_LINES) return lines;
  return [
    ...lines,
    {
      variantId: input.variantId,
      productSlug: input.productSlug,
      quantity: clampQuantity(input.quantity, maxPerLine),
      savedForLater: false,
      seenUnitPrice: input.seenUnitPrice,
      addedAt: now.toISOString(),
    },
  ];
}

export function setCartQuantity(
  lines: CartLine[],
  variantId: string,
  quantity: number,
  maxPerLine: number,
) {
  if (quantity <= 0) return removeFromCart(lines, variantId);
  return lines.map((l) =>
    l.variantId === variantId ? { ...l, quantity: clampQuantity(quantity, maxPerLine) } : l,
  );
}

export function removeFromCart(lines: CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

export function setSavedForLater(lines: CartLine[], variantId: string, saved: boolean): CartLine[] {
  return lines.map((l) => (l.variantId === variantId ? { ...l, savedForLater: saved } : l));
}

export function removeOrdered(lines: CartLine[], variantIds: string[]): CartLine[] {
  const ordered = new Set(variantIds);
  return lines.filter((l) => l.savedForLater || !ordered.has(l.variantId));
}

export const activeLines = (lines: CartLine[]) => lines.filter((l) => !l.savedForLater);
export const savedLines = (lines: CartLine[]) => lines.filter((l) => l.savedForLater);
export const cartCount = (lines: CartLine[]) =>
  activeLines(lines).reduce((n, l) => n + l.quantity, 0);

/**
 * Deterministic merge of a browser cart into an account cart (mirrors public.cart_merge):
 * same variant → quantities added, capped at maxPerLine and at current availability when some
 * stock exists; a line stays saved-for-later only if both copies were saved; unknown variants are
 * dropped and reported. Account lines keep their order; new lines follow in browser order.
 */
export function mergeCarts(
  account: AccountCartItem[],
  local: {
    variantId: string;
    quantity: number;
    savedForLater: boolean;
    seenUnitPrice: number | null;
  }[],
  options: {
    maxPerLine: number;
    exists: (variantId: string) => boolean;
    available: (variantId: string) => number;
    now?: Date;
  },
): { items: AccountCartItem[]; adjustments: CartMergeAdjustment[] } {
  const items = account.map((i) => ({ ...i }));
  const adjustments: CartMergeAdjustment[] = [];
  const grouped = new Map<string, { quantity: number; saved: boolean; seen: number | null }>();
  for (const l of local) {
    const g = grouped.get(l.variantId);
    if (g) {
      g.quantity += l.quantity;
      g.saved = g.saved && l.savedForLater;
      g.seen = g.seen ?? l.seenUnitPrice;
    } else
      grouped.set(l.variantId, {
        quantity: l.quantity,
        saved: l.savedForLater,
        seen: l.seenUnitPrice,
      });
  }
  for (const [variantId, g] of grouped) {
    if (!options.exists(variantId)) {
      adjustments.push({ variantId, reason: 'removed_missing' });
      continue;
    }
    const existing = items.find((i) => i.variantId === variantId);
    let quantity = (existing?.quantity ?? 0) + g.quantity;
    if (quantity > options.maxPerLine) {
      quantity = options.maxPerLine;
      adjustments.push({ variantId, reason: 'capped_max', quantity });
    }
    const available = options.available(variantId);
    if (available > 0 && quantity > available) {
      quantity = available;
      adjustments.push({ variantId, reason: 'capped_stock', quantity });
    }
    if (existing) {
      existing.quantity = quantity;
      existing.savedForLater = existing.savedForLater && g.saved;
      existing.seenUnitPrice = g.seen ?? existing.seenUnitPrice;
    } else {
      items.push({
        variantId,
        quantity,
        savedForLater: g.saved,
        seenUnitPrice: g.seen,
        addedAt: (options.now ?? new Date()).toISOString(),
      });
    }
  }
  return { items, adjustments };
}
