import { createContext, useContext } from 'react';
import type { CompareAddResult } from '@/domain/customer/lists';
import type { CompareItem, LocalRecentItem, RequestClaim } from '@/domain/customer/types';

export interface WishlistTarget {
  productId: string;
  productSlug: string;
  /** Only when the customer explicitly chose a variant. */
  variantId: string | null;
}

export type WishlistToggleResult = 'saved' | 'removed' | 'full' | 'error';

export interface CustomerListsValue {
  mode: 'local' | 'account';
  status: 'loading' | 'ready';
  wishlist: {
    entries: { productId: string; variantId: string | null }[];
    count: number;
    isSaved: (productId: string, variantId?: string | null) => boolean;
    toggle: (target: WishlistTarget) => Promise<WishlistToggleResult>;
    /** Items dropped during the last guest → account merge (no longer available). */
    mergeDropped: number;
    error: boolean;
  };
  recent: {
    /** Browser history (guests; emptied after it is merged into the account). */
    local: LocalRecentItem[];
    track: (target: WishlistTarget) => void;
    clear: () => Promise<void>;
  };
  compare: {
    items: CompareItem[];
    add: (item: Omit<CompareItem, 'addedAt'>) => CompareAddResult;
    remove: (productId: string) => void;
    clear: () => void;
    max: number;
  };
  /** Remember a guest request's one-time claim token so it can be linked after sign-in. */
  rememberClaim: (claim: RequestClaim) => void;
}

export const CustomerListsContext = createContext<CustomerListsValue | null>(null);

export function useCustomerLists(): CustomerListsValue {
  const value = useContext(CustomerListsContext);
  if (!value) throw new Error('useCustomerLists must be used inside CustomerListsProvider');
  return value;
}
