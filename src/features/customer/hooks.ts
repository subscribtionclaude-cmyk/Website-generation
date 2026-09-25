import { useQuery } from '@tanstack/react-query';
import type { ProductSummary } from '@/domain/catalog/types';
import { useSession } from '@/features/auth/context';
import { useRuntime } from '@/runtime/context';
import { useCustomerLists } from './context';

/** Product cards for ids (public data — shared cache key, survives sign-in/out). */
export function useProductsByIds(ids: string[]) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'products-by-ids', ids],
    queryFn: () => repositories.catalog.getProductsByIds(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

/** Recently viewed products: the account history when signed in, else this browser's. */
export function useRecentProducts(options: { limit?: number; excludeProductId?: string } = {}) {
  const { repositories } = useRuntime();
  const session = useSession();
  const lists = useCustomerLists();
  const limit = options.limit ?? 12;
  const account = useQuery({
    queryKey: ['recent', session?.userId ?? null, limit + 1],
    queryFn: () => repositories.recent.list(limit + 1),
    enabled: Boolean(session) && lists.status === 'ready',
  });
  const localIds = lists.recent.local.map((r) => r.productId);
  const local = useProductsByIds(session ? [] : localIds);
  const products: ProductSummary[] = session
    ? (account.data ?? []).map((r) => r.product)
    : (local.data ?? []);
  return {
    products: products.filter((p) => p.id !== options.excludeProductId).slice(0, limit),
    isPending: session ? account.isPending : localIds.length > 0 && local.isPending,
  };
}
