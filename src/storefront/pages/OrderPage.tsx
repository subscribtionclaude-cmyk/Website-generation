import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  MessageCircle,
  PackageX,
  Phone,
  Printer,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMyOrder } from '../commerce/useMyOrder';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { deliveryPlace } from '@/domain/commerce/governorates';
import { progressIndex, progressSteps } from '@/domain/commerce/status';
import type { Order } from '@/domain/commerce/types';
import { orderWhatsAppMessage } from '@/domain/commerce/whatsapp';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useWhatsAppMessage } from '@/features/whatsapp/context';
import { useI18n } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { useRuntime } from '@/runtime/context';
import {
  LineRow,
  Money,
  OrderStatusBadge,
  PaymentStatusBadge,
  Totals,
} from '../commerce/CommerceParts';
import { orderItemView } from '../commerce/lineViews';
import { FULFILLMENT_LABEL, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from '../commerce/labels';
import styles from '../commerce/commerce.module.css';

export function OrderPage() {
  return (
    <RequireAuth>
      <OrderView />
    </RequireAuth>
  );
}

function OrderView() {
  const { orderNumber = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const order = useMyOrder(orderNumber);
  usePageMeta({ title: t('order.title', { number: orderNumber }), noIndex: true });

  if (order.isPending) {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <Skeleton width="40%" height="2.2rem" />
        <Skeleton height="260px" />
      </div>
    );
  }
  if (order.isError || !order.data) {
    // Unknown number or someone else's order: the same answer, so numbers can't be probed.
    return (
      <div className={`container ${styles.page}`}>
        <StateMessage
          icon={<PackageX />}
          headingLevel={1}
          title={order.isError ? t('order.loadError') : t('order.notFoundTitle')}
          body={order.isError ? undefined : t('order.notFoundBody')}
          role={order.isError ? 'alert' : undefined}
          actions={
            <ButtonLink to="/account" variant="primary">
              {t('order.myOrders')}
            </ButtonLink>
          }
        />
      </div>
    );
  }
  return <Receipt order={order.data} placed={params.get('placed') === '1'} />;
}

function Receipt({ order, placed }: { order: Order; placed: boolean }) {
  const { t, locale, format } = useI18n();
  const { store, brand } = useSettings();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const session = useSession();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const message = orderWhatsAppMessage(
    order,
    locale,
    {
      intro: (n) => t('order.waIntro', { number: n }),
      customer: (name) => t('order.waCustomer', { name }),
      item: (l) =>
        t('order.waItem', {
          name: l.name,
          variant: l.variant ? ` (${l.variant})` : '',
          quantity: l.quantity,
        }),
      total: (total) => t('order.waTotal', { total }),
      shippingPending: t('order.waShippingPending'),
      payment: (m) => t('order.waPayment', { method: m }),
      fulfillment: (m) => t('order.waFulfillment', { method: m }),
    },
    (amount) => format.money(amount),
    t(PAYMENT_METHOD_LABEL[order.paymentMethod]),
    t(FULFILLMENT_LABEL[order.fulfillment.method]),
  );
  useWhatsAppMessage(message);
  const whatsapp = buildWhatsAppLink(store.whatsappNumber, message);
  const phone = store.branches[0]?.phones[0];
  const tel = phone ? toTelHref(phone) : null;

  const cancel = useMutation({
    mutationFn: () => repositories.commerce.cancelMyOrder(order.orderNumber, null),
    onSuccess: (result) => {
      setConfirmCancel(false);
      if (result.order)
        queryClient.setQueryData(
          ['order', session?.userId ?? null, order.orderNumber],
          result.order,
        );
    },
  });

  const steps = progressSteps(order.fulfillment.method);
  const currentIndex = progressIndex(steps, order.status);

  return (
    <div className={`container ${styles.page}`}>
      {placed && (
        <div className={styles.success} role="status">
          <CircleCheck aria-hidden="true" />
          <h1 className={styles.successTitle}>{t('order.placedTitle')}</h1>
          <p>{t(whatsapp.status === 'ok' ? 'order.placedBody' : 'order.placedBodyNoWhatsapp')}</p>
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.aside}>
          <section className={styles.card} aria-labelledby="receipt-title">
            <div className={styles.receiptHead}>
              <div>
                <p className={styles.muted}>{brand.name}</p>
                {placed ? (
                  <h2 id="receipt-title" className={styles.cardTitle}>
                    {t('order.receipt')}
                  </h2>
                ) : (
                  <h1 id="receipt-title" className={styles.title}>
                    {t('order.receipt')}
                  </h1>
                )}
                <p className={styles.orderNumber}>{order.orderNumber}</p>
                <p className={styles.muted}>
                  <time dateTime={order.createdAt}>{format.dateTime(order.createdAt)}</time>
                </p>
              </div>
              <div className={styles.lineMeta}>
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.paymentStatus} />
                {order.isDemo && <span className={styles.demoTag}>{t('order.demoOrder')}</span>}
              </div>
            </div>

            {order.reviewPending && order.status !== 'cancelled' && (
              <p className={styles.notice} role="note">
                <ShieldCheck aria-hidden="true" />
                <span>{t('order.reviewNote')}</span>
              </p>
            )}
            {order.reservationExpiresAt && order.status !== 'cancelled' && (
              <p className={styles.notice} role="note">
                <Clock3 aria-hidden="true" />
                <span>
                  {t('order.reservedUntil', { time: format.time(order.reservationExpiresAt) })}
                </span>
              </p>
            )}

            <ul className={styles.lines}>
              {order.items.map((item) => (
                <LineRow key={item.lineNo} line={orderItemView(item, locale)} />
              ))}
            </ul>
            <Totals totals={order.totals} />
            {order.promoCode && (
              <p className={styles.muted}>{t('order.promoUsed', { code: order.promoCode })}</p>
            )}
          </section>
        </div>

        <aside className={styles.aside} aria-label={t('order.detailsTitle')}>
          <section className={styles.card} aria-labelledby="order-next">
            <h2 id="order-next" className={styles.cardTitle}>
              {t('order.nextTitle')}
            </h2>
            <p className={styles.muted}>
              {t(whatsapp.status === 'ok' ? 'order.nextBody' : 'order.nextBodyNoWhatsapp')}
            </p>
            {whatsapp.status === 'ok' ? (
              <a
                href={whatsapp.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClassName({ variant: 'accent', size: 'lg', block: true })}
              >
                <MessageCircle aria-hidden="true" />
                {t('order.continueWhatsapp')}
                <span className="visually-hidden"> {t('common.externalLink')}</span>
              </a>
            ) : (
              <p className={`${styles.notice} ${styles.noticeWarning}`} role="note">
                <CircleAlert aria-hidden="true" />
                <span>{t('order.whatsappNotConfigured')}</span>
              </p>
            )}
            {tel && (
              <a href={tel} className={buttonClassName({ variant: 'secondary', block: true })}>
                <Phone aria-hidden="true" />
                {t('order.callStore')} · <bdi className="num">{phone}</bdi>
              </a>
            )}
            <ButtonLink
              to={`/order/${order.orderNumber}/invoice`}
              variant="secondary"
              block
              icon={<Printer aria-hidden="true" />}
            >
              {t('order.printInvoice')}
            </ButtonLink>
          </section>

          <section className={styles.card} aria-labelledby="order-details">
            <h2 id="order-details" className={styles.cardTitle}>
              {t('order.detailsTitle')}
            </h2>
            <dl className={styles.meta}>
              <div>
                <dt>{t('order.customer')}</dt>
                <dd>
                  {order.customer.name}
                  <br />
                  <bdi dir="ltr">{order.customer.phoneDisplay ?? order.customer.phone}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t(FULFILLMENT_LABEL[order.fulfillment.method])}</dt>
                <dd>
                  {order.fulfillment.method === 'pickup' && order.fulfillment.pickupBranch ? (
                    <>
                      {resolveLocalized(order.fulfillment.pickupBranch.name, locale)}
                      <br />
                      {resolveLocalized(order.fulfillment.pickupBranch.address, locale)}
                      {order.fulfillment.pickupBranch.landmark &&
                        ` — ${resolveLocalized(order.fulfillment.pickupBranch.landmark, locale)}`}
                    </>
                  ) : (
                    <>
                      {deliveryPlace(
                        {
                          governorate: order.fulfillment.governorate,
                          area: order.fulfillment.area,
                        },
                        locale,
                      )}
                      <br />
                      {order.fulfillment.address}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('order.paymentMethod')}</dt>
                <dd>{t(PAYMENT_METHOD_LABEL[order.paymentMethod])}</dd>
              </div>
              <div>
                <dt>{t('checkout.shipping')}</dt>
                <dd>
                  {order.totals.shippingFeeStatus === 'pending'
                    ? t('checkout.shippingPending')
                    : order.totals.shippingFeeStatus === 'not_required'
                      ? t('checkout.shippingPickup')
                      : format.money(order.totals.shippingFee ?? 0)}
                  {order.fulfillment.eta && (
                    <>
                      <br />
                      {t('order.eta', { eta: order.fulfillment.eta })}
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="order-progress">
            <h2 id="order-progress" className={styles.cardTitle}>
              {t('order.progressTitle')}
            </h2>
            {order.status === 'cancelled' ? (
              <p className={`${styles.notice} ${styles.noticeDanger}`}>
                <XCircle aria-hidden="true" />
                <span>{t('order.cancelledNote')}</span>
              </p>
            ) : (
              <ol className={styles.timeline}>
                {steps.map((s, i) => (
                  <li
                    key={s}
                    className={styles.timelineItem}
                    aria-current={i === currentIndex ? 'step' : undefined}
                  >
                    <span
                      className={[styles.dot, i <= currentIndex && styles.dotDone]
                        .filter(Boolean)
                        .join(' ')}
                      aria-hidden="true"
                    />
                    <span>
                      {/* The current step shows the real status (e.g. "Awaiting payment" on step 1). */}
                      {t(ORDER_STATUS_LABEL[i === currentIndex ? order.status : s])}
                      <span className="visually-hidden">
                        {' '}
                        —{' '}
                        {i < currentIndex
                          ? t('order.stepDone')
                          : i === currentIndex
                            ? t('order.stepCurrent')
                            : t('order.stepUpcoming')}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {order.totals.remainingAmount > 0 && order.status !== 'cancelled' && (
              <p className={styles.muted}>
                {t('order.balanceDue')} <Money amount={order.totals.remainingAmount} />
              </p>
            )}
          </section>

          {order.canCancel && (
            <section className={styles.card} aria-labelledby="order-cancel">
              <h2 id="order-cancel" className={styles.cardTitle}>
                {t('order.cancelTitle')}
              </h2>
              {confirmCancel ? (
                <>
                  <p className={styles.muted}>{t('order.cancelConfirm')}</p>
                  <div className={styles.actions}>
                    <Button
                      variant="danger"
                      loading={cancel.isPending}
                      onClick={() => cancel.mutate()}
                    >
                      {t('order.cancelYes')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                      {t('order.cancelNo')}
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                  {t('order.cancel')}
                </Button>
              )}
              {cancel.isError || (cancel.data && !cancel.data.ok) ? (
                <p className={styles.fieldError} role="alert">
                  {t('order.cancelError')}
                </p>
              ) : null}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
