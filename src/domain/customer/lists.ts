import type { CompareItem, LocalRecentItem, LocalWishlistItem } from './types';

/**
 * Browser-side lists (guests). Deterministic and pure so the UI, the demo engine and the tests
 * share one implementation. Server merges mirror these rules (wishlist_merge / recent_merge).
 */
export const LOCAL_WISHLIST_MAX = 100;
export const LOCAL_RECENT_MAX = 20;
export const COMPARE_MAX = 4;

const sameEntry = (
  a: { productId: string; variantId: string | null },
  productId: string,
  variantId: string | null,
) => a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

/** Saved at product level (any entry for the product) or for one exact variant. */
export function isWishlisted(
  list: readonly { productId: string; variantId: string | null }[],
  productId: string,
  variantId?: string | null,
): boolean {
  return variantId === undefined
    ? list.some((i) => i.productId === productId)
    : list.some((i) => sameEntry(i, productId, variantId ?? null));
}

export function toggleLocalWishlist(
  list: readonly LocalWishlistItem[],
  item: Omit<LocalWishlistItem, 'addedAt'>,
  now: Date,
  max = LOCAL_WISHLIST_MAX,
): { list: LocalWishlistItem[]; saved: boolean; full: boolean } {
  if (list.some((i) => sameEntry(i, item.productId, item.variantId)))
    return {
      list: list.filter((i) => !sameEntry(i, item.productId, item.variantId)),
      saved: false,
      full: false,
    };
  if (list.length >= max) return { list: [...list], saved: false, full: true };
  return { list: [{ ...item, addedAt: now.toISOString() }, ...list], saved: true, full: false };
}

/** Remove every entry of a product (e.g. "Remove" on a product card). */
export function removeProduct(
  list: readonly LocalWishlistItem[],
  productId: string,
): LocalWishlistItem[] {
  return list.filter((i) => i.productId !== productId);
}

/** Most recent first, one entry per product, capped. */
export function trackRecent(
  list: readonly LocalRecentItem[],
  item: Omit<LocalRecentItem, 'viewedAt'>,
  now: Date,
  max = LOCAL_RECENT_MAX,
): LocalRecentItem[] {
  return [
    { ...item, viewedAt: now.toISOString() },
    ...list.filter((i) => i.productId !== item.productId),
  ].slice(0, max);
}

/** Union of two histories: latest view per product wins, newest first, capped. */
export function mergeRecent(
  a: readonly LocalRecentItem[],
  b: readonly LocalRecentItem[],
  max = LOCAL_RECENT_MAX,
): LocalRecentItem[] {
  const byProduct = new Map<string, LocalRecentItem>();
  for (const item of [...a, ...b]) {
    const current = byProduct.get(item.productId);
    if (!current || item.viewedAt > current.viewedAt) byProduct.set(item.productId, item);
  }
  return [...byProduct.values()]
    .sort((x, y) =>
      x.viewedAt === y.viewedAt
        ? x.productId.localeCompare(y.productId)
        : x.viewedAt < y.viewedAt
          ? 1
          : -1,
    )
    .slice(0, max);
}

export type CompareAddResult = 'added' | 'exists' | 'full' | 'incompatible';

/**
 * Comparison tray: at most `max` products, all from the same top-level category (phones with
 * phones, laptops with laptops…) so the table stays meaningful.
 */
export function addToCompare(
  list: readonly CompareItem[],
  item: Omit<CompareItem, 'addedAt'>,
  now: Date,
  max = COMPARE_MAX,
): { list: CompareItem[]; result: CompareAddResult } {
  if (list.some((i) => i.productId === item.productId))
    return { list: [...list], result: 'exists' };
  if (list.length >= max) return { list: [...list], result: 'full' };
  const category = list[0]?.rootCategory ?? null;
  if (list.length > 0 && category !== item.rootCategory)
    return { list: [...list], result: 'incompatible' };
  return { list: [...list, { ...item, addedAt: now.toISOString() }], result: 'added' };
}

export function removeFromCompare(list: readonly CompareItem[], productId: string): CompareItem[] {
  return list.filter((i) => i.productId !== productId);
}
