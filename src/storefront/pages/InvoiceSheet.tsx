import { BidiText } from '@/components/text/BidiText';
import { deliveryPlace } from '@/domain/commerce/governorates';
import type { InvoiceTemplate } from '@/domain/commerce/invoiceTemplate';
import type { Order } from '@/domain/commerce/types';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import {
  FULFILLMENT_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
} from '../commerce/labels';
import styles from './invoice.module.css';

export type InvoiceSheetTemplate = InvoiceTemplate & {
  layout?: 'standard' | 'compact';
  accent?: 'brand' | 'mono';
};

/** The printable invoice sheet itself (also used by the Admin receipt-template preview). */
export function InvoiceSheet({
  order,
  template,
}: {
  order: Order;
  template: InvoiceSheetTemplate;
}) {
  const { t, locale, format } = useI18n();
  const { brand, store } = useSettings();
  const branch = store.branches[0];
  const money = (amount: number) => format.money(amount, { fractionDigits: 2 });
  const className = [
    styles.sheet,
    template.layout === 'compact' && styles.compact,
    template.accent === 'brand' && styles.accentBrand,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className} aria-labelledby="invoice-title">
      <header className={styles.top}>
        <div className={styles.brand}>
          {template.showLogo && (
            <img
              src="/brand/malek-store-mark-96.webp"
              alt=""
              width={56}
              height={55}
              className={styles.logo}
            />
          )}
          <div>
            <p className={styles.brandName} dir="ltr">
              {brand.name}
            </p>
            {template.fields.storeAddress && branch && (
              <p className={styles.small}>
                {resolveLocalized(branch.address, locale)}
                {branch.landmark && ` — ${resolveLocalized(branch.landmark, locale)}`} ·{' '}
                {resolveLocalized(branch.city, locale)}
              </p>
            )}
            {template.fields.storePhones && branch && (
              <p className={styles.small}>
                {branch.phones.map((p, i) => (
                  <span key={p}>
                    {i > 0 && ' · '}
                    <bdi dir="ltr">{p}</bdi>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className={styles.docMeta}>
          <h1 id="invoice-title" className={styles.docTitle}>
            {resolveLocalized(template.title, locale)}
          </h1>
          <p>
            {t('invoice.number')}: <bdi className={styles.mono}>{order.orderNumber}</bdi>
          </p>
          <p>
            {t('invoice.date')}:{' '}
            <time dateTime={order.createdAt}>{format.dateTime(order.createdAt)}</time>
          </p>
          <p>
            {t('invoice.status')}: {t(ORDER_STATUS_LABEL[order.status])}
          </p>
          {order.isDemo && <p className={styles.demo}>{t('invoice.demo')}</p>}
        </div>
      </header>

      <section className={styles.parties}>
        <div>
          <h2 className={styles.label}>{t('invoice.billTo')}</h2>
          <p>{order.customer.name}</p>
          {template.fields.customerPhone && (
            <p>
              <bdi dir="ltr">{order.customer.phoneDisplay ?? order.customer.phone}</bdi>
            </p>
          )}
          {template.fields.customerEmail && order.customer.email && <p>{order.customer.email}</p>}
        </div>
        <div>
          <h2 className={styles.label}>{t(FULFILLMENT_LABEL[order.fulfillment.method])}</h2>
          {order.fulfillment.method === 'pickup' && order.fulfillment.pickupBranch ? (
            <p>{resolveLocalized(order.fulfillment.pickupBranch.name, locale)}</p>
          ) : (
            <p>
              {deliveryPlace(
                { governorate: order.fulfillment.governorate, area: order.fulfillment.area },
                locale,
              )}
              <br />
              {order.fulfillment.address}
            </p>
          )}
        </div>
        <div>
          <h2 className={styles.label}>{t('order.paymentMethod')}</h2>
          <p>{t(PAYMENT_METHOD_LABEL[order.paymentMethod])}</p>
          {template.fields.paymentStatus && (
            <p className={styles.small}>{t(PAYMENT_STATUS_LABEL[order.paymentStatus])}</p>
          )}
        </div>
      </section>

      <table className={styles.table}>
        <caption className="visually-hidden">{t('invoice.items')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('invoice.item')}</th>
            <th scope="col">{t('invoice.qty')}</th>
            <th scope="col">{t('invoice.unitPrice')}</th>
            <th scope="col">{t('invoice.discount')}</th>
            <th scope="col">{t('invoice.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.lineNo}>
              <td>
                <strong>
                  <BidiText text={resolveLocalized(item.productName, locale)} />
                </strong>
                {item.variantLabel && (
                  <span className={styles.small}>
                    {' '}
                    — {resolveLocalized(item.variantLabel, locale)}
                  </span>
                )}
                {item.isGift && <span className={styles.small}> ({t('cart.freeGift')})</span>}
                {template.fields.sku && (
                  <span className={`${styles.small} ${styles.block}`}>
                    SKU <bdi className={styles.mono}>{item.sku}</bdi>
                  </span>
                )}
                {template.fields.warranty && item.warranty && (
                  <span className={`${styles.small} ${styles.block}`}>
                    {t('product.warranty')}: {resolveLocalized(item.warranty, locale)}
                  </span>
                )}
              </td>
              <td className={styles.num}>{format.number(item.quantity)}</td>
              <td className={styles.num}>{money(item.unitPrice)}</td>
              <td className={styles.num}>
                {item.discountAmount > 0 ? `−${money(item.discountAmount)}` : '—'}
              </td>
              <td className={styles.num}>{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className={styles.totals}>
        <div>
          <dt>{t('checkout.subtotal')}</dt>
          <dd>{money(order.totals.originalSubtotal)}</dd>
        </div>
        {order.totals.originalSubtotal > order.totals.subtotal && (
          <div>
            <dt>{t('checkout.offerSavings')}</dt>
            <dd>−{money(order.totals.originalSubtotal - order.totals.subtotal)}</dd>
          </div>
        )}
        {order.totals.discountTotal > 0 && (
          <div>
            <dt>
              {t('checkout.discounts')}
              {order.promoCode && ` (${order.promoCode})`}
            </dt>
            <dd>−{money(order.totals.discountTotal)}</dd>
          </div>
        )}
        <div>
          <dt>{t('checkout.shipping')}</dt>
          <dd>
            {order.totals.shippingFeeStatus === 'pending'
              ? t('checkout.shippingPending')
              : order.totals.shippingFeeStatus === 'not_required'
                ? t('checkout.shippingPickup')
                : money(order.totals.shippingFee ?? 0)}
          </dd>
        </div>
        <div className={styles.grand}>
          <dt>
            {order.totals.shippingFeeStatus === 'pending'
              ? t('checkout.totalBeforeShipping')
              : t('checkout.total')}
          </dt>
          <dd>{money(order.totals.total)}</dd>
        </div>
        <div>
          <dt>{t('checkout.paid')}</dt>
          <dd>{money(order.totals.paidAmount)}</dd>
        </div>
        <div>
          <dt>{t('checkout.remaining')}</dt>
          <dd>{money(order.totals.remainingAmount)}</dd>
        </div>
      </dl>

      <footer className={styles.footer}>
        <p className={styles.small}>{t('checkout.finalPriceNote')}</p>
        <p className={styles.small}>{t('invoice.notTaxInvoice')}</p>
        {template.terms && (
          <p className={styles.small}>{resolveLocalized(template.terms, locale)}</p>
        )}
        {template.footer && <p>{resolveLocalized(template.footer, locale)}</p>}
      </footer>
    </article>
  );
}
