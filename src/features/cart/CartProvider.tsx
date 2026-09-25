import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  addToCart,
  cartCount,
  MAX_CART_LINES,
  removeFromCart,
  removeOrdered,
  setCartQuantity,
  setSavedForLater,
} from '@/domain/commerce/cart';
import type { AccountCart, CartLine, CartMergeAdjustment } from '@/domain/commerce/types';
import { useAuth } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { readStored, removeStored, writeStored } from '@/lib/storage/localStore';
import { useRuntime } from '@/runtime/context';
import { CartContext, type AddToCartInput, type CartContextValue } from './context';

const LOCAL_KEY = 'cart';
const localCartSchema = z
  .array(
    z.object({
      variantId: z.string().min(1).max(80),
      productSlug: z.string().max(80).nullable(),
      quantity: z.number().int().min(1).max(99),
      savedForLater: z.boolean(),
      seenUnitPrice: z.number().nonnegative().nullable(),
      addedAt: z.string(),
    }),
  )
  .max(MAX_CART_LINES);

const readLocal = (): CartLine[] => readStored(LOCAL_KEY, localCartSchema) ?? [];
const writeLocal = (lines: CartLine[]) => {
  if (lines.length === 0) removeStored(LOCAL_KEY);
  else writeStored(LOCAL_KEY, lines);
};

/**
 * Cart state. Signed out: the cart lives in this browser (display data only — prices are always
 * re-quoted by the backend). Signed in: the browser cart is merged ONCE into the account cart
 * (deterministic server merge, adjustments reported) and the account cart becomes the source.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { repositories } = useRuntime();
  const { state: auth } = useAuth();
  const { commerce } = useSettings();
  const maxPerLine = commerce.maxQuantityPerLine;
  const userId = auth.status === 'signed_in' ? auth.session.userId : null;
  const [lines, setLines] = useState<CartLine[]>(() => readLocal());
  // Which session the current lines belong to ('anon' = this browser); null until auth resolves.
  const sessionKey = auth.status === 'loading' ? null : (userId ?? 'anon');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (sessionKey === 'anon' && loadedFor !== 'anon') {
    // Signed out (or just signed out): the browser cart is the source. Adjusted during render.
    setLoadedFor('anon');
    setLines(readLocal());
  }
  const status: 'loading' | 'ready' =
    sessionKey !== null && loadedFor === sessionKey ? 'ready' : 'loading';
  const [mergeNotice, setMergeNotice] = useState<CartMergeAdjustment[] | null>(null);
  const [error, setError] = useState(false);
  // Product slugs are display-only and not stored server-side; remember them for links.
  const slugs = useRef(new Map<string, string>());

  const fromAccount = useCallback((cart: AccountCart): CartLine[] => {
    return cart.items.map((item) => ({
      variantId: item.variantId,
      productSlug: slugs.current.get(item.variantId) ?? null,
      quantity: item.quantity,
      savedForLater: item.savedForLater,
      seenUnitPrice: item.seenUnitPrice,
      addedAt: item.addedAt,
    }));
  }, []);

  useEffect(() => {
    if (sessionKey === null || sessionKey === 'anon') return;
    let active = true;
    const local = readLocal();
    for (const l of local) if (l.productSlug) slugs.current.set(l.variantId, l.productSlug);
    const load = local.length
      ? repositories.commerce.mergeCart(
          local.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            savedForLater: l.savedForLater,
            seenUnitPrice: l.seenUnitPrice,
          })),
        )
      : repositories.commerce.getCart();
    load
      .then((cart) => {
        if (!active) return;
        if (local.length) {
          writeLocal([]);
          if (cart.adjustments?.length) setMergeNotice(cart.adjustments);
        }
        setLines(fromAccount(cart));
        setError(false);
      })
      .catch(() => {
        // Never lose the browser cart: keep showing it and retry on the next sign-in/load.
        if (active) {
          setLines(local);
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoadedFor(sessionKey);
      });
    return () => {
      active = false;
    };
  }, [sessionKey, repositories, fromAccount]);

  // Keep several tabs in sync while signed out.
  useEffect(() => {
    if (userId !== null) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key?.endsWith(LOCAL_KEY)) setLines(readLocal());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const apply = useCallback(
    async (next: CartLine[], changed: string[]) => {
      setLines(next);
      if (userId === null) {
        writeLocal(next);
        return;
      }
      try {
        let cart: AccountCart | null = null;
        for (const variantId of changed) {
          const line = next.find((l) => l.variantId === variantId);
          cart = await repositories.commerce.setCartItem(
            variantId,
            line?.quantity ?? 0,
            line?.savedForLater ?? false,
            line?.seenUnitPrice ?? null,
          );
        }
        if (cart) setLines(fromAccount(cart));
        setError(false);
      } catch {
        setError(true);
        repositories.commerce
          .getCart()
          .then((cart) => setLines(fromAccount(cart)))
          .catch(() => undefined);
      }
    },
    [userId, repositories, fromAccount],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      mode: userId === null ? 'local' : 'account',
      status,
      lines,
      count: cartCount(lines),
      maxPerLine,
      mergeNotice,
      dismissMergeNotice: () => setMergeNotice(null),
      error,
      add: async (input: AddToCartInput) => {
        if (input.productSlug) slugs.current.set(input.variantId, input.productSlug);
        await apply(addToCart(lines, input, maxPerLine), [input.variantId]);
      },
      setQuantity: (variantId, quantity) =>
        apply(setCartQuantity(lines, variantId, quantity, maxPerLine), [variantId]),
      remove: (variantId) => apply(removeFromCart(lines, variantId), [variantId]),
      setSaved: (variantId, saved) => apply(setSavedForLater(lines, variantId, saved), [variantId]),
      acknowledgePrices: async (prices) => {
        const changed = lines.filter(
          (l) => l.variantId in prices && prices[l.variantId] !== l.seenUnitPrice,
        );
        if (changed.length === 0) return;
        await apply(
          lines.map((l) =>
            l.variantId in prices ? { ...l, seenUnitPrice: prices[l.variantId] ?? null } : l,
          ),
          changed.map((l) => l.variantId),
        );
      },
      afterOrder: async (variantIds) => {
        if (userId === null) {
          const next = removeOrdered(lines, variantIds);
          setLines(next);
          writeLocal(next);
          return;
        }
        // The server already removed ordered lines from the account cart.
        try {
          setLines(fromAccount(await repositories.commerce.getCart()));
        } catch {
          setLines(removeOrdered(lines, variantIds));
        }
      },
    }),
    [userId, status, lines, maxPerLine, mergeNotice, error, apply, repositories, fromAccount],
  );

  return <CartContext value={value}>{children}</CartContext>;
}
