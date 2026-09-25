import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { activeLines } from '@/domain/commerce/cart';
import type { CartLine, FulfillmentMethod } from '@/domain/commerce/types';
import { useSession } from '@/features/auth/context';
import { useRuntime } from '@/runtime/context';

/**
 * Authoritative cart quote from the backend (prices, offers, discounts, stock issues).
 * The browser never computes charged amounts itself.
 */
export function useQuote(
  lines: CartLine[],
  options: {
    promoCode?: string | null;
    fulfillment?: FulfillmentMethod | null;
    saved?: boolean;
  } = {},
) {
  const { repositories } = useRuntime();
  const session = useSession();
  const source = options.saved ? lines.filter((l) => l.savedForLater) : activeLines(lines);
  const items = source.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
  return useQuery({
    queryKey: [
      'quote',
      // Scoped like every private query ([name, userId]) so AuthProvider's clean-up keeps it.
      session?.userId ?? null,
      items,
      options.promoCode ?? null,
      options.fulfillment ?? null,
    ],
    queryFn: () =>
      repositories.commerce.quote(items, {
        promoCode: options.promoCode ?? null,
        fulfillment: options.fulfillment ?? null,
      }),
    enabled: items.length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
