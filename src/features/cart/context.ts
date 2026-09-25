import { createContext, useContext } from 'react';
import type { CartLine, CartMergeAdjustment } from '@/domain/commerce/types';

export interface AddToCartInput {
  variantId: string;
  productSlug: string | null;
  quantity: number;
  seenUnitPrice: number | null;
}

export interface CartContextValue {
  /** 'local' = browser cart (signed out); 'account' = server cart (signed in). */
  mode: 'local' | 'account';
  status: 'loading' | 'ready';
  lines: CartLine[];
  /** Active (not saved-for-later) item count for badges. */
  count: number;
  maxPerLine: number;
  /** Adjustments reported when a browser cart was merged into the account at sign-in. */
  mergeNotice: CartMergeAdjustment[] | null;
  dismissMergeNotice: () => void;
  error: boolean;
  add: (input: AddToCartInput) => Promise<void>;
  setQuantity: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  setSaved: (variantId: string, saved: boolean) => Promise<void>;
  /** Record the prices the customer has now seen (clears "price updated" notes). */
  acknowledgePrices: (prices: Record<string, number | null>) => Promise<void>;
  /** After an order: ordered lines leave the cart (saved-for-later lines stay). */
  afterOrder: (variantIds: string[]) => Promise<void>;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
