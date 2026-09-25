import {
  ArrowLeft,
  BookmarkPlus,
  CircleAlert,
  Info,
  Minus,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useCart } from '@/features/cart/context';
import { changedPrices } from '@/features/cart/priceChanges';
import { useQuote } from '@/features/cart/useQuote';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { LineRow, Totals } from '../commerce/CommerceParts';
import { quoteLineView } from '../commerce/lineViews';
import { LINE_STATUS_LABEL } from '../commerce/labels';
import styles from '../commerce/commerce.module.css';

export function CartPage() {
  const { t, format, locale } = useI18n();
  const cart = useCart();
  usePageMeta({ title: t('cart.title'), noIndex: true });
  const quote = useQuote(cart.lines);
  const saved = useQuote(cart.lines, { saved: true });
  const active = cart.lines.filter((l) => !l.savedForLater);
  const savedLines = cart.lines.filter((l) => l.savedForLater);
  const data = quote.data;
  const changed = data ? changedPrices(cart.lines, data.lines) : [];
  const lineOf = (variantId: string) => cart.lines.find((l) => l.variantId === variantId);

  if (cart.status === 'loading') {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <Skeleton width="30%" height="2.2rem" />
        <Skeleton height="120px" />
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('cart.title')}</h1>
        {cart.count > 0 && (
          <p className={styles.subtitle}>{t('cart.itemCount', { count: cart.count })}</p>
        )}
      </header>

      {cart.mergeNotice && (
        <div className={styles.notice} role="status">
          <Info aria-hidden="true" />
          <div>
            <p>{t('cart.merged')}</p>
            {cart.mergeNotice.some((a) => a.reason !== 'removed_missing') && (
              <p>{t('cart.mergedAdjusted')}</p>
            )}
            {cart.mergeNotice.some((a) => a.reason === 'removed_missing') && (
              <p>{t('cart.mergedRemoved')}</p>
            )}
            <button type="button" className={styles.linkButton} onClick={cart.dismissMergeNotice}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
      {cart.error && (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          <TriangleAlert aria-hidden="true" />
          <p>{t('cart.syncError')}</p>
        </div>
      )}

      {active.length === 0 ? (
        <StateMessage
          icon={<ShoppingCart />}
          title={t('cart.empty')}
          body={t('cart.emptyBody')}
          actions={
            <ButtonLink to="/store" variant="primary" icon={<ShoppingBag aria-hidden="true" />}>
              {t('account.browseStore')}
            </ButtonLink>
          }
        />
      ) : (
        <div className={styles.layout}>
          <section className={styles.card} aria-labelledby="cart-lines">
            <h2 id="cart-lines" className="visually-hidden">
              {t('cart.linesTitle')}
            </h2>
            {changed.length > 0 && (
              <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
                <TriangleAlert aria-hidden="true" />
                <div>
                  <p>
                    <strong>{t('cart.priceUpdatedTitle')}</strong> {t('cart.priceUpdatedBody')}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void cart.acknowledgePrices(
                        Object.fromEntries(changed.map((q) => [q.variantId, q.unitPrice])),
                      )
                    }
                  >
                    {t('cart.acceptPrices')}
                  </Button>
                </div>
              </div>
            )}
            {quote.isPending ? (
              <div aria-busy="true">
                <Skeleton height="76px" />
              </div>
            ) : quote.isError || !data ? (
              <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
                <CircleAlert aria-hidden="true" />
                <p>{t('cart.quoteError')}</p>
              </div>
            ) : (
              <ul className={styles.lines}>
                {data.lines.map((q) => {
                  const line = lineOf(q.variantId);
                  const was = line?.seenUnitPrice;
                  const priceChanged = changed.some((c) => c.variantId === q.variantId);
                  const max = Math.min(q.maxQuantity ?? cart.maxPerLine, cart.maxPerLine);
                  return (
                    <LineRow
                      key={`${q.variantId}-${q.isGift ? 'gift' : 'line'}`}
                      line={quoteLineView(q, locale)}
                      notes={
                        <>
                          {q.status !== 'ok' && (
                            <p className={styles.lineIssue}>
                              <CircleAlert aria-hidden="true" />
                              <span>
                                {t(LINE_STATUS_LABEL[q.status], { count: q.maxQuantity ?? 0 })}
                              </span>
                            </p>
                          )}
                          {priceChanged && was != null && q.unitPrice !== null && (
                            <p className={styles.lineChanged}>
                              <TriangleAlert aria-hidden="true" />
                              <span>
                                {t('cart.lineChanged', {
                                  was: format.money(was, { fractionDigits: 'auto' }),
                                  now: format.money(q.unitPrice, { fractionDigits: 'auto' }),
                                })}
                              </span>
                            </p>
                          )}
                        </>
                      }
                      actions={
                        q.isGift ? null : (
                          <div className={styles.lineActions}>
                            {line && (
                              <QuantityStepper
                                label={t('cart.quantityFor', {
                                  product: quoteLineView(q, locale).name,
                                })}
                                value={line.quantity}
                                max={q.status === 'insufficient_stock' ? line.quantity : max}
                                onChange={(qty) => void cart.setQuantity(q.variantId, qty)}
                              />
                            )}
                            {q.status === 'insufficient_stock' &&
                              q.maxQuantity !== null &&
                              q.maxQuantity > 0 && (
                                <button
                                  type="button"
                                  className={styles.linkButton}
                                  onClick={() =>
                                    void cart.setQuantity(q.variantId, q.maxQuantity ?? 1)
                                  }
                                >
                                  {t('cart.reduceTo', { count: q.maxQuantity })}
                                </button>
                              )}
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => void cart.setSaved(q.variantId, true)}
                            >
                              <BookmarkPlus aria-hidden="true" />
                              {t('cart.saveForLater')}
                            </button>
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => void cart.remove(q.variantId)}
                            >
                              <Trash2 aria-hidden="true" />
                              {t('cart.remove')}
                              <span className="visually-hidden">
                                : {quoteLineView(q, locale).name}
                              </span>
                            </button>
                            {q.status !== 'ok' && q.productSlug && (
                              <LocaleLink
                                to={`/product/${q.productSlug}`}
                                className={styles.linkButton}
                              >
                                {t('cart.backToProduct')}
                              </LocaleLink>
                            )}
                          </div>
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>

          <aside className={styles.aside} aria-labelledby="cart-summary">
            <div className={styles.card}>
              <h2 id="cart-summary" className={styles.cardTitle}>
                {t('checkout.summary')}
              </h2>
              {data ? <Totals totals={data.totals} /> : <Skeleton height="120px" />}
              {data && !data.valid && (
                <p className={`${styles.notice} ${styles.noticeDanger}`} role="status">
                  <CircleAlert aria-hidden="true" />
                  <span>{t('cart.fixIssues')}</span>
                </p>
              )}
              <ButtonLink
                to="/checkout"
                variant="accent"
                size="lg"
                block
                aria-disabled={!data?.valid || changed.length > 0 || undefined}
                className={!data?.valid || changed.length > 0 ? styles.disabledLink : undefined}
                onClick={(event) => {
                  if (!data?.valid || changed.length > 0) event.preventDefault();
                }}
              >
                {t('cart.checkout')}
              </ButtonLink>
              <p className={styles.muted}>{t('cart.checkoutNote')}</p>
              <LocaleLink to="/store" className={styles.linkButton}>
                <ArrowLeft className="flip-rtl" aria-hidden="true" />
                {t('cart.continueShopping')}
              </LocaleLink>
            </div>
          </aside>
        </div>
      )}

      {savedLines.length > 0 && (
        <section className={`${styles.card} ${styles.savedSection}`} aria-labelledby="cart-saved">
          <h2 id="cart-saved" className={styles.cardTitle}>
            {t('cart.savedTitle')}
          </h2>
          <ul className={styles.lines}>
            {(saved.data?.lines ?? []).map((q) => (
              <LineRow
                key={q.variantId}
                line={quoteLineView(q, locale)}
                actions={
                  <div className={styles.lineActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void cart.setSaved(q.variantId, false)}
                    >
                      <ShoppingCart aria-hidden="true" />
                      {t('cart.moveToCart')}
                    </button>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void cart.remove(q.variantId)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('cart.remove')}
                    </button>
                  </div>
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function QuantityStepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { t, format } = useI18n();
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        aria-label={t('cart.decrease')}
      >
        <Minus aria-hidden="true" />
      </button>
      <output aria-live="polite">{format.number(value)}</output>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={t('cart.increase')}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
