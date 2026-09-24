import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CatalogQuery } from '@/domain/catalog/types';
import type { EntryFilter } from '@/repositories/types';
import { useRuntime } from '@/runtime/context';

/**
 * Storefront data hooks. Keys start with 'public' (shared, non-user data kept across sign-in).
 * In live mode a failed request surfaces as an error state — never a silent fallback to demo data.
 */
const STALE = 60_000;

export function useBrands() {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'brands'],
    queryFn: () => repositories.catalog.listBrands(),
    staleTime: 5 * STALE,
  });
}

export function useCategories() {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'categories'],
    queryFn: () => repositories.catalog.listCategories(),
    staleTime: 5 * STALE,
  });
}

export function useCatalogSearch(query: CatalogQuery, enabled = true) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'catalog', query],
    queryFn: () => repositories.catalog.search(query),
    staleTime: STALE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Paged listing with "load more" (page 1 is the URL page; later pages append). */
export function useCatalogPages(query: Omit<CatalogQuery, 'page'>, pageSize: number) {
  const { repositories } = useRuntime();
  return useInfiniteQuery({
    queryKey: ['public', 'catalog-pages', query, pageSize],
    queryFn: ({ pageParam }) =>
      repositories.catalog.search({ ...query, page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useProduct(slug: string) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'product', slug],
    queryFn: () => repositories.catalog.getProduct(slug),
    staleTime: STALE,
  });
}

export function usePageSections(pageKey: string) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'sections', pageKey],
    queryFn: () => repositories.content.listPageSections(pageKey),
    staleTime: 5 * STALE,
  });
}

export function useOffers() {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'offers'],
    queryFn: () => repositories.content.listOffers(),
    staleTime: STALE,
  });
}

export function useOffer(slug: string) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'offer', slug],
    queryFn: () => repositories.content.getOffer(slug),
    staleTime: STALE,
  });
}

export function useEntries(filter: EntryFilter = {}) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'entries', filter],
    queryFn: () => repositories.content.listEntries(filter),
    staleTime: STALE,
  });
}

export function useEntry(slug: string) {
  const { repositories } = useRuntime();
  return useQuery({
    queryKey: ['public', 'entry', slug],
    queryFn: () => repositories.content.getEntry(slug),
    staleTime: STALE,
    enabled: slug !== '',
  });
}
