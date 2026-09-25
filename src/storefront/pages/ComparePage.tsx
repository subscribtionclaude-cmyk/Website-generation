import { useQueries } from '@tanstack/react-query';
import { GitCompareArrows, ShoppingBag, X } from 'lucide-react';
import { useId, useState } from 'react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { BidiText } from '@/components/text/BidiText';
import { Button } from '@/components/ui/Button';
import type { ProductDetail } from '@/domain/catalog/types';
import { buildCompareRows } from '@/domain/customer/compare';
import { resolveLocalized } from '@/domain/localized';
import { useCustomerLists } from '@/features/customer/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { stockLabelKey } from '../components/stockLabel';
import styles from '../customer/compare.module.css';

/**
 * Side-by-side comparison (browser only, max N, same top-level category). The table scrolls
 * inside a labelled, keyboard-focusable region with a sticky label column; the page never scrolls
 * sideways.
 */
export function ComparePage() {
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const { compare } = useCustomerLists();
  const captionId = useId();
  const [differencesOnly, setDifferencesOnly] = useState(false);
  usePageMeta({ title: t('compare.title'), noIndex: true });

  const queries = useQueries({
    queries: compare.items.map((item) => ({
      queryKey: ['public', 'product', item.productSlug],
      queryFn: () => repositories.catalog.getProduct(item.productSlug),
      staleTime: 60_000,
    })),
  });
  const loading = queries.some((q) => q.isPending);
  const products = queries.map((q) => q.data).filter((p): p is ProductDetail => Boolean(p));

  const rows = buildCompareRows(
    products,
    locale,
    {
      price: { ar: t('compare.rowPrice'), en: t('compare.rowPrice') },
      availability: { ar: t('compare.rowAvailability'), en: t('compare.rowAvailability') },
      storage: { ar: t('compare.rowStorage'), en: t('compare.rowStorage') },
      colors: { ar: t('compare.rowColors'), en: t('compare.rowColors') },
      warranty: { ar: t('compare.rowWarranty'), en: t('compare.rowWarranty') },
      brand: { ar: t('compare.rowBrand'), en: t('compare.rowBrand') },
    },
    {
      price: (p) =>
        p.price.min === null
          ? t('compare.priceTba')
          : p.price.max !== null && p.price.max !== p.price.min
            ? `${format.money(p.price.min)} – ${format.money(p.price.max)}`
            : format.money(p.price.min),
      availability: (p) => t(stockLabelKey(p.stockState, p.availabilityState)),
    },
  ).filter((row) => !differencesOnly || row.differs || products.length < 2);

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{t('compare.title')}</h1>
          <p className={styles.muted}>{t('compare.subtitle', { max: compare.max })}</p>
        </div>
        {compare.items.length > 0 && (
          <Button variant="ghost" onClick={compare.clear} icon={<X aria-hidden="true" />}>
            {t('compare.clear')}
          </Button>
        )}
      </header>

      {compare.items.length === 0 ? (
        <StateMessage
          icon={<GitCompareArrows />}
          title={t('compare.emptyTitle')}
          body={t('compare.emptyBody')}
          actions={
            <ButtonLink to="/store" variant="primary" icon={<ShoppingBag aria-hidden="true" />}>
              {t('account.browseStore')}
            </ButtonLink>
          }
        />
      ) : loading ? (
        <Skeleton height="320px" />
      ) : (
        <>
          {products.length < 2 && <p className={styles.notice}>{t('compare.addMore')}</p>}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={differencesOnly}
              onChange={(e) => setDifferencesOnly(e.target.checked)}
            />
            {t('compare.differencesOnly')}
          </label>
          <div
            className={styles.scroller}
            role="region"
            aria-labelledby={captionId}
            // The comparison can be wider than a phone: its region scrolls, the page never does.
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption id={captionId} className="visually-hidden">
                {t('compare.caption', { count: products.length })}
              </caption>
              <thead>
                <tr>
                  <td className={styles.corner} />
                  {products.map((p) => {
                    const name = resolveLocalized(p.name, locale);
                    return (
                      <th key={p.id} scope="col" className={styles.productHead}>
                        {p.image && (
                          <img src={p.image.url} alt="" width={96} height={96} loading="lazy" />
                        )}
                        <LocaleLink to={`/product/${p.slug}`} className={styles.productName}>
                          <BidiText text={name} />
                        </LocaleLink>
                        <button
                          type="button"
                          className={styles.remove}
                          onClick={() => compare.remove(p.id)}
                        >
                          <X aria-hidden="true" />
                          {t('compare.remove')}
                          <span className="visually-hidden">: {name}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={row.differs ? styles.differs : undefined}>
                    <th scope="row">
                      {row.group && (
                        <span className={styles.group}>{resolveLocalized(row.group, locale)}</span>
                      )}
                      {resolveLocalized(row.label, locale)}
                    </th>
                    {row.values.map((value, i) => (
                      <td key={products[i]?.id ?? i}>
                        {value ?? <span className={styles.muted}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products.some((p) => p.isDemo) && (
            <p className={styles.muted}>{t('product.demoSpecsNote')}</p>
          )}
        </>
      )}
    </div>
  );
}
