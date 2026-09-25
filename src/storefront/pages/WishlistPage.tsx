import { Heart, Info, ShoppingBag, TrendingDown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { ProductSummary } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useCustomerLists } from '@/features/customer/context';
import { useProductsByIds } from '@/features/customer/hooks';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '@/runtime/context';
import { ProductGrid } from '../components/ProductGrid';
import { CompareButton } from '../customer/CompareButton';
import styles from '../customer/account.module.css';

/**
 * Wishlist — works signed out (this browser) and signed in (account, merged at sign-in).
 * Shows price drops since an item was saved and items that are no longer available.
 */
export function WishlistPage() {
  const { t, locale, format } = useI18n();
  const session = useSession();
  const lists = useCustomerLists();
  const { repositories } = useRuntime();
  usePageMeta({ title: t('wishlist.title'), noIndex: true });
  const [message, setMessage] = useState<string | null>(null);

  const account = useQuery({
    queryKey: ['wishlist', session?.userId ?? null],
    queryFn: () => repositories.wishlist.get(),
    enabled: Boolean(session) && lists.status === 'ready',
  });
  const localIds = session ? [] : [...new Set(lists.wishlist.entries.map((e) => e.productId))];
  const local = useProductsByIds(localIds);

  const products: ProductSummary[] = session
    ? (account.data?.items ?? []).flatMap((i) => (i.product ? [i.product] : []))
    : (local.data ?? []);
  const unavailable = session
    ? (account.data?.items ?? []).filter((i) => !i.product).length
    : localIds.length - products.length;
  const drops = new Map(
    (account.data?.items ?? [])
      .filter(
        (i) =>
          i.product &&
          i.referencePrice !== null &&
          i.currentPrice !== null &&
          i.currentPrice < i.referencePrice,
      )
      .map((i) => [i.productId, { was: i.referencePrice ?? 0, now: i.currentPrice ?? 0 }]),
  );
  const loading =
    lists.status === 'loading' ||
    (session ? account.isPending : localIds.length > 0 && local.isPending);
  const failed = session ? account.isError : local.isError;

  const remove = async (product: ProductSummary) => {
    const entries = lists.wishlist.entries.filter((e) => e.productId === product.id);
    for (const entry of entries)
      await lists.wishlist.toggle({
        productId: product.id,
        productSlug: product.slug,
        variantId: entry.variantId,
      });
    setMessage(t('wishlist.removedStatus', { product: resolveLocalized(product.name, locale) }));
  };

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{t('wishlist.title')}</h1>
        {products.length > 0 && (
          <p className={styles.muted}>
            {t('wishlist.count', { count: format.number(products.length) })}
          </p>
        )}
      </header>
      <p className="visually-hidden" role="status">
        {message}
      </p>
      {!session && lists.wishlist.count > 0 && (
        <p className={styles.notice}>
          <Info aria-hidden="true" />
          <span>
            {t('wishlist.guestNote')}{' '}
            <LocaleLink to="/account">{t('wishlist.signInToSync')}</LocaleLink>
          </span>
        </p>
      )}
      {lists.wishlist.mergeDropped > 0 && (
        <p className={styles.notice} role="status">
          <Info aria-hidden="true" />
          <span>{t('wishlist.mergeDropped')}</span>
        </p>
      )}
      {loading ? (
        <Skeleton height="260px" />
      ) : failed ? (
        <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <Info aria-hidden="true" />
          <span>{t('wishlist.loadError')}</span>
        </p>
      ) : products.length === 0 && unavailable === 0 ? (
        <StateMessage
          icon={<Heart />}
          title={t('wishlist.emptyTitle')}
          body={t('wishlist.emptyBody')}
          actions={
            <ButtonLink to="/store" variant="primary" icon={<ShoppingBag aria-hidden="true" />}>
              {t('account.browseStore')}
            </ButtonLink>
          }
        />
      ) : (
        <>
          {unavailable > 0 && (
            <p className={styles.notice}>
              <Info aria-hidden="true" />
              <span>{t('wishlist.unavailable', { count: unavailable })}</span>
            </p>
          )}
          <ProductGrid
            products={products}
            renderActions={(product) => {
              const name = resolveLocalized(product.name, locale);
              const drop = drops.get(product.id);
              return (
                <>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => void remove(product)}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('wishlist.remove')}
                    <span className="visually-hidden">: {name}</span>
                  </button>
                  <CompareButton product={product} name={name} />
                  {drop && (
                    <span className={styles.drop}>
                      <TrendingDown aria-hidden="true" />
                      {t('wishlist.priceDropped', {
                        was: format.money(drop.was),
                        now: format.money(drop.now),
                      })}
                    </span>
                  )}
                </>
              );
            }}
          />
        </>
      )}
    </div>
  );
}
