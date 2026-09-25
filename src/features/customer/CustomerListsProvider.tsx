import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  addToCompare,
  COMPARE_MAX,
  isWishlisted,
  LOCAL_RECENT_MAX,
  LOCAL_WISHLIST_MAX,
  removeFromCompare,
  toggleLocalWishlist,
  trackRecent,
} from '@/domain/customer/lists';
import type {
  CompareItem,
  LocalRecentItem,
  LocalWishlistItem,
  RequestClaim,
} from '@/domain/customer/types';
import { useAuth } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { readStored, removeStored, writeStored } from '@/lib/storage/localStore';
import { useRuntime } from '@/runtime/context';
import {
  CustomerListsContext,
  type CustomerListsValue,
  type WishlistTarget,
  type WishlistToggleResult,
} from './context';

const WISHLIST_KEY = 'wishlist';
const RECENT_KEY = 'recent';
const COMPARE_KEY = 'compare';
const CLAIMS_KEY = 'request-claims';

const idSchema = z.string().min(1).max(80);
const wishlistSchema = z
  .array(
    z.object({
      productId: idSchema,
      productSlug: z.string().max(80),
      variantId: idSchema.nullable(),
      addedAt: z.string(),
    }),
  )
  .max(LOCAL_WISHLIST_MAX);
const recentSchema = z
  .array(
    z.object({
      productId: idSchema,
      productSlug: z.string().max(80),
      variantId: idSchema.nullable(),
      viewedAt: z.string(),
    }),
  )
  .max(LOCAL_RECENT_MAX);
const compareSchema = z
  .array(
    z.object({
      productId: idSchema,
      productSlug: z.string().max(80),
      rootCategory: z.string().nullable(),
      addedAt: z.string(),
    }),
  )
  .max(COMPARE_MAX);
const claimsSchema = z
  .array(
    z.object({
      kind: z.enum(['notify', 'waitlist']),
      id: idSchema,
      token: z.string().min(10).max(200),
    }),
  )
  .max(50);

const read = <T,>(key: string, schema: z.ZodType<T[]>): T[] => readStored(key, schema) ?? [];
const write = (key: string, list: readonly unknown[]) => {
  if (list.length === 0) removeStored(key);
  else writeStored(key, list);
};

/**
 * Wishlist, recently viewed, compare and guest request claims. Signed out: kept in this browser.
 * On sign-in the browser lists are merged ONCE into the account (deterministic server merge),
 * local copies are cleared only after the merge succeeded, and the account becomes the source.
 * Compare stays in the browser (no personal data, nothing to sync).
 */
export function CustomerListsProvider({ children }: { children: ReactNode }) {
  const { repositories } = useRuntime();
  const { state: auth } = useAuth();
  const { engagement } = useSettings();
  const queryClient = useQueryClient();
  const userId = auth.status === 'signed_in' ? auth.session.userId : null;
  const sessionKey = auth.status === 'loading' ? null : (userId ?? 'anon');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [localWishlist, setLocalWishlist] = useState<LocalWishlistItem[]>(() =>
    read(WISHLIST_KEY, wishlistSchema),
  );
  const [localRecent, setLocalRecent] = useState<LocalRecentItem[]>(() =>
    read(RECENT_KEY, recentSchema),
  );
  const [compare, setCompare] = useState<CompareItem[]>(() => read(COMPARE_KEY, compareSchema));
  const [mergeDropped, setMergeDropped] = useState(0);
  const [error, setError] = useState(false);

  if (sessionKey === 'anon' && loadedFor !== 'anon') {
    setLoadedFor('anon');
    setLocalWishlist(read(WISHLIST_KEY, wishlistSchema));
    setLocalRecent(read(RECENT_KEY, recentSchema));
  }
  const status: 'loading' | 'ready' =
    sessionKey !== null && loadedFor === sessionKey ? 'ready' : 'loading';

  // Sign-in: merge browser lists and link guest requests, then clear what was merged.
  useEffect(() => {
    if (sessionKey === null || sessionKey === 'anon') return;
    let active = true;
    const wishlist = read(WISHLIST_KEY, wishlistSchema);
    const recent = read(RECENT_KEY, recentSchema);
    const claims = read(CLAIMS_KEY, claimsSchema);
    const tasks: Promise<unknown>[] = [];
    if (wishlist.length)
      tasks.push(
        repositories.wishlist
          .merge(
            wishlist.map((w) => ({
              productId: w.productId,
              variantId: w.variantId,
              addedAt: w.addedAt,
            })),
          )
          .then((view) => {
            write(WISHLIST_KEY, []);
            queryClient.setQueryData(['wishlist', sessionKey], view);
            if (active) setMergeDropped(view.adjustments?.length ?? 0);
          }),
      );
    if (recent.length)
      tasks.push(
        repositories.recent
          .merge(
            recent.map((r) => ({
              productId: r.productId,
              variantId: r.variantId,
              viewedAt: r.viewedAt,
            })),
          )
          .then(() => write(RECENT_KEY, [])),
      );
    // Always ask: requests made with this account's verified email are linked too.
    tasks.push(repositories.requests.claim(claims).then(() => write(CLAIMS_KEY, [])));
    Promise.allSettled(tasks).then((results) => {
      if (!active) return;
      setError(results.some((r) => r.status === 'rejected'));
      setLocalWishlist(read(WISHLIST_KEY, wishlistSchema));
      setLocalRecent(read(RECENT_KEY, recentSchema));
      void queryClient.invalidateQueries({ queryKey: ['recent', sessionKey] });
      void queryClient.invalidateQueries({ queryKey: ['requests', sessionKey] });
      setLoadedFor(sessionKey);
    });
    return () => {
      active = false;
    };
  }, [sessionKey, repositories, queryClient]);

  // Keep tabs in sync while signed out.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key?.endsWith(WISHLIST_KEY)) setLocalWishlist(read(WISHLIST_KEY, wishlistSchema));
      if (event.key?.endsWith(COMPARE_KEY)) setCompare(read(COMPARE_KEY, compareSchema));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const account = useQuery({
    queryKey: ['wishlist', userId],
    queryFn: () => repositories.wishlist.get(),
    enabled: userId !== null && status === 'ready',
  });

  const entries = useMemo(
    () =>
      userId === null
        ? localWishlist.map((w) => ({ productId: w.productId, variantId: w.variantId }))
        : (account.data?.items ?? []).map((w) => ({
            productId: w.productId,
            variantId: w.variantId,
          })),
    [userId, localWishlist, account.data],
  );

  const toggle = useCallback(
    async (target: WishlistTarget): Promise<WishlistToggleResult> => {
      if (userId === null) {
        const result = toggleLocalWishlist(
          read(WISHLIST_KEY, wishlistSchema),
          target,
          new Date(),
          engagement.wishlist.maxItems,
        );
        write(WISHLIST_KEY, result.list);
        setLocalWishlist(result.list);
        return result.full ? 'full' : result.saved ? 'saved' : 'removed';
      }
      const saved = !isWishlisted(entries, target.productId, target.variantId);
      try {
        const result = await repositories.wishlist.set(target.productId, target.variantId, saved);
        await queryClient.invalidateQueries({ queryKey: ['wishlist', userId] });
        if (!result.ok) return result.code === 'wishlist_full' ? 'full' : 'error';
        setError(false);
        return saved ? 'saved' : 'removed';
      } catch {
        setError(true);
        return 'error';
      }
    },
    [userId, entries, repositories, queryClient, engagement.wishlist.maxItems],
  );

  const track = useCallback(
    (target: WishlistTarget) => {
      if (userId === null) {
        const next = trackRecent(
          read(RECENT_KEY, recentSchema),
          target,
          new Date(),
          engagement.recentlyViewed.maxItems,
        );
        write(RECENT_KEY, next);
        setLocalRecent(next);
        return;
      }
      repositories.recent
        .track(target.productId, target.variantId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['recent', userId] }))
        .catch(() => undefined);
    },
    [userId, repositories, queryClient, engagement.recentlyViewed.maxItems],
  );

  const value = useMemo<CustomerListsValue>(
    () => ({
      mode: userId === null ? 'local' : 'account',
      status,
      wishlist: {
        entries,
        count: entries.length,
        isSaved: (productId, variantId) => isWishlisted(entries, productId, variantId),
        toggle,
        mergeDropped,
        error,
      },
      recent: {
        local: localRecent,
        track,
        clear: async () => {
          write(RECENT_KEY, []);
          setLocalRecent([]);
          if (userId !== null) {
            await repositories.recent.clear();
            await queryClient.invalidateQueries({ queryKey: ['recent', userId] });
          }
        },
      },
      compare: {
        items: compare,
        max: engagement.compare.maxItems,
        add: (item) => {
          const result = addToCompare(
            read(COMPARE_KEY, compareSchema),
            item,
            new Date(),
            engagement.compare.maxItems,
          );
          write(COMPARE_KEY, result.list);
          setCompare(result.list);
          return result.result;
        },
        remove: (productId) => {
          const next = removeFromCompare(read(COMPARE_KEY, compareSchema), productId);
          write(COMPARE_KEY, next);
          setCompare(next);
        },
        clear: () => {
          write(COMPARE_KEY, []);
          setCompare([]);
        },
      },
      rememberClaim: (claim: RequestClaim) => {
        const claims = [
          ...read(CLAIMS_KEY, claimsSchema).filter((c) => c.id !== claim.id),
          claim,
        ].slice(-50);
        write(CLAIMS_KEY, claims);
      },
    }),
    [
      userId,
      status,
      entries,
      toggle,
      mergeDropped,
      error,
      localRecent,
      track,
      compare,
      engagement,
      repositories,
      queryClient,
    ],
  );

  return <CustomerListsContext value={value}>{children}</CustomerListsContext>;
}
