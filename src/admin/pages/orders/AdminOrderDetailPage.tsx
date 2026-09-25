import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { deliveryPlace } from '@/domain/commerce/governorates';
import { toMinor } from '@/domain/commerce/money';
import { nextStatuses } from '@/domain/commerce/status';
import type { OrderStatus, StaffActionResult, StaffOrder } from '@/domain/commerce/types';
import { resolveLocalized } from '@/domain/localized';
import { useAccess, useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { OrderStatusBadge, PaymentStatusBadge } from '@/storefront/commerce/CommerceParts';
import {
  FULFILLMENT_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
} from '@/storefront/commerce/labels';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { useAdminPageMeta } from '../../useAdminPageMeta';
import adminStyles from '../../admin.module.css';
import styles from './orders.module.css';

const RESULT_MESSAGE: Record<string, AdminMessageKey> = {
  invalid_transition: 'orders.errors.invalid_transition',
  review_pending: 'orders.errors.review_pending',
  review_rejected: 'orders.errors.review_rejected',
  shipping_fee_pending: 'orders.errors.shipping_fee_pending',
  payment_not_verified: 'orders.errors.payment_not_verified',
  deposit_not_verified: 'orders.errors.deposit_not_verified',
  balance_due: 'orders.errors.balance_due',
  stock_unavailable: 'orders.errors.stock_unavailable',
  refund_required: 'orders.errors.refund_required',
  cannot_cancel: 'orders.errors.cannot_cancel',
  already_cancelled: 'orders.errors.already_cancelled',
  reason_required: 'orders.errors.reason_required',
  note_required: 'orders.errors.note_required',
  invalid_fee: 'orders.errors.invalid_fee',
  would_overpay: 'orders.errors.would_overpay',
  not_delivery: 'orders.errors.not_delivery',
  invalid_amount: 'orders.errors.invalid_amount',
  exceeds_remaining: 'orders.errors.exceeds_remaining',
  order_closed: 'orders.errors.order_closed',
  review_not_pending: 'orders.errors.review_not_pending',
  use_cancel: 'orders.errors.use_cancel',
  not_applicable: 'orders.errors.not_applicable',
  forbidden: 'orders.errors.forbidden',
};

type Feedback = { tone: 'success' | 'danger'; key: AdminMessageKey } | null;

/** Order detail: snapshots, verified payments, reservations, audit timeline and staff actions. */
export function AdminOrderDetailPage() {
  const { orderId = '' } = useParams();
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const order = useQuery({
    queryKey: ['admin-order', session?.userId ?? null, orderId],
    queryFn: () => repositories.orders.getOrder(orderId),
  });
  useAdminPageMeta(
    order.data ? at('orders.detailTitle', { number: order.data.orderNumber }) : at('orders.title'),
  );

  return (
    <>
      <Link to="/admin/orders" className={styles.back}>
        <ArrowLeft className="flip-rtl" aria-hidden="true" />
        {at('orders.backToList')}
      </Link>
      {order.isPending && <Skeleton height="30rem" radius="var(--radius-lg)" />}
      {order.isError && (
        <Alert
          tone="danger"
          live
          action={
            <Button size="sm" variant="secondary" onClick={() => void order.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {at('errors.loadFailed')}
        </Alert>
      )}
      {order.data === null && <Alert tone="warning">{at('orders.notFound')}</Alert>}
      {order.data && <OrderDetail order={order.data} />}
    </>
  );
}

function useStaffAction<TInput>(
  orderId: string,
  run: (input: TInput) => Promise<StaffActionResult>,
) {
  const queryClient = useQueryClient();
  const session = useSession();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const mutation = useMutation({
    mutationFn: run,
    onMutate: () => setFeedback(null),
    onSuccess: (result) => {
      if (result.order)
        queryClient.setQueryData(['admin-order', session?.userId ?? null, orderId], result.order);
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['public'] });
      setFeedback(
        result.ok
          ? { tone: 'success', key: 'orders.saved' }
          : { tone: 'danger', key: RESULT_MESSAGE[result.code] ?? 'orders.actionFailed' },
      );
    },
    onError: (error) => {
      const code = (error as { code?: string }).code;
      setFeedback({
        tone: 'danger',
        key: code === 'forbidden' ? 'orders.errors.forbidden' : 'orders.actionFailed',
      });
    },
  });
  return { mutation, feedback };
}

function ActionCard({
  title,
  children,
  feedback,
}: {
  title: string;
  children: ReactNode;
  feedback: Feedback;
}) {
  const { at } = useAdminI18n();
  return (
    <Card>
      <h2 className={adminStyles.sectionTitle}>{title}</h2>
      <div className={styles.actionBody}>
        {children}
        {feedback && (
          <Alert tone={feedback.tone} live>
            {at(feedback.key)}
          </Alert>
        )}
      </div>
    </Card>
  );
}

function OrderDetail({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { t, locale, format } = useI18n();
  const { can } = useAccess();
  const money = (amount: number) => format.money(amount, { fractionDigits: 2 });
  const closed = order.status === 'cancelled' || order.status === 'completed';

  return (
    <div className={adminStyles.stack}>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>
          <bdi dir="ltr">{order.orderNumber}</bdi>
        </h1>
        <div className={styles.flags}>
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          {order.manualReview.status === 'pending' && (
            <Badge tone="warning" icon={<ShieldAlert aria-hidden="true" />}>
              {at('orders.flagReview')}
            </Badge>
          )}
          {order.stockCommitted && <Badge tone="success">{at('orders.flagCommitted')}</Badge>}
          {order.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
        </div>
      </div>

      <div className={styles.detailGrid}>
        <div className={adminStyles.stack}>
          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('orders.items')}</h2>
            <ul className={styles.items}>
              {order.items.map((item) => (
                <li key={item.lineNo}>
                  <span>
                    <strong>{resolveLocalized(item.productName, locale)}</strong>
                    {item.variantLabel && ` — ${resolveLocalized(item.variantLabel, locale)}`}
                    {item.isGift && ` (${t('cart.freeGift')})`}
                    <span className={`${adminStyles.muted} ${styles.block}`}>
                      <bdi dir="ltr">{item.sku}</bdi> · × {format.number(item.quantity)} ·{' '}
                      {money(item.unitPrice)}
                    </span>
                  </span>
                  <span className={styles.num}>{money(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className={adminStyles.dl}>
              <Row label={t('checkout.subtotal')}>{money(order.totals.subtotal)}</Row>
              <Row label={t('checkout.discounts')}>
                {order.totals.discountTotal > 0
                  ? `−${money(order.totals.discountTotal)}`
                  : money(0)}
                {order.promoCode && ` (${order.promoCode})`}
              </Row>
              <Row label={t('checkout.shipping')}>
                {order.totals.shippingFeeStatus === 'pending'
                  ? t('checkout.shippingPending')
                  : order.totals.shippingFeeStatus === 'not_required'
                    ? t('checkout.shippingPickup')
                    : money(order.totals.shippingFee ?? 0)}
              </Row>
              <Row label={t('checkout.total')}>
                <strong>{money(order.totals.total)}</strong>
              </Row>
              <Row label={t('checkout.paid')}>{money(order.totals.paidAmount)}</Row>
              <Row label={t('checkout.remaining')}>{money(order.totals.remainingAmount)}</Row>
            </dl>
          </Card>

          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('orders.customerAndDelivery')}</h2>
            <dl className={adminStyles.dl}>
              <Row label={at('orders.customer')}>
                {order.customer.name} · <bdi dir="ltr">{order.customer.phone}</bdi>
                {order.customer.email && (
                  <>
                    {' · '}
                    <bdi dir="ltr">{order.customer.email}</bdi>
                  </>
                )}
              </Row>
              <Row label={t(FULFILLMENT_LABEL[order.fulfillment.method])}>
                {order.fulfillment.method === 'pickup'
                  ? order.fulfillment.pickupBranch &&
                    resolveLocalized(order.fulfillment.pickupBranch.name, locale)
                  : deliveryPlace(order.fulfillment, locale)}
                {order.fulfillment.notes && (
                  <span className={`${adminStyles.muted} ${styles.block}`}>
                    {order.fulfillment.notes}
                  </span>
                )}
              </Row>
              <Row label={t('order.paymentMethod')}>
                {t(PAYMENT_METHOD_LABEL[order.paymentMethod])}
              </Row>
              {order.customerNote && (
                <Row label={at('orders.customerNote')}>{order.customerNote}</Row>
              )}
              {order.staffNote && <Row label={at('orders.staffNote')}>{order.staffNote}</Row>}
              {order.cancelReason && (
                <Row label={at('orders.cancelReason')}>{order.cancelReason}</Row>
              )}
            </dl>
          </Card>

          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('orders.reviewTitle')}</h2>
            <p>
              {at(`orders.review.${order.manualReview.status}`)}
              {order.manualReview.note && ` — ${order.manualReview.note}`}
            </p>
            {order.manualReview.reasons.length > 0 && (
              <ul className={styles.reasons}>
                {order.manualReview.reasons.map((r) => (
                  <li key={r}>{REVIEW_REASON[r] ? at(REVIEW_REASON[r]) : r}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('orders.paymentsTitle')}</h2>
            {order.payments.length === 0 ? (
              <p className={adminStyles.muted}>{at('orders.noPayments')}</p>
            ) : (
              <ul className={styles.items}>
                {order.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {at(p.method === 'cash' ? 'orders.methodCash' : 'orders.methodInstapay')}
                      {p.kind === 'deposit' && ` · ${at('orders.deposit')}`}
                      {p.reference && (
                        <>
                          {' · '}
                          <bdi dir="ltr">{p.reference}</bdi>
                        </>
                      )}
                      <span className={`${adminStyles.muted} ${styles.block}`}>
                        {at('orders.verifiedAt', { time: format.dateTime(p.verifiedAt) })}
                      </span>
                    </span>
                    <span className={styles.num}>{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {order.reservations.length > 0 && (
              <>
                <h3 className={styles.subTitle}>{at('orders.reservationsTitle')}</h3>
                <ul className={styles.items}>
                  {order.reservations.map((r) => (
                    <li key={r.variantId}>
                      <span>
                        × {format.number(r.quantity)} · {at(`orders.reservation.${r.status}`)}
                      </span>
                      <span className={adminStyles.muted}>{format.dateTime(r.expiresAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('orders.timeline')}</h2>
            <ol className={styles.timeline}>
              {order.timeline.map((e, i) => (
                <li key={`${e.createdAt}-${i}`}>
                  <span className={adminStyles.muted}>{format.dateTime(e.createdAt)}</span>
                  <span>
                    <strong>{at(`orders.actor.${e.actorKind}`)}</strong> ·{' '}
                    {at(`orders.event.${e.type}`)}
                    {e.status &&
                      ` → ${isOrderStatus(e.status) ? t(ORDER_STATUS_LABEL[e.status]) : e.status}`}
                    {e.note && <span className={styles.block}>{e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className={adminStyles.stack}>
          {!closed && order.manualReview.status === 'pending' && can('payments.verify') && (
            <ReviewAction order={order} />
          )}
          {!closed && can('orders.manage') && <StatusAction order={order} />}
          {!closed && order.fulfillment.method === 'delivery' && can('shipping.manage') && (
            <ShippingAction order={order} />
          )}
          {!closed &&
            order.paymentMethod !== 'cod' &&
            can('orders.manage') &&
            order.totals.paidAmount === 0 && <VerificationAction order={order} />}
          {!closed && order.totals.remainingAmount > 0 && can('payments.verify') && (
            <PaymentAction order={order} />
          )}
          {!closed && can('orders.manage') && <CancelAction order={order} />}
          {can('orders.manage') && <NoteAction order={order} />}
          {!can('orders.manage') && <Alert tone="info">{at('orders.viewOnly')}</Alert>}
        </div>
      </div>
    </div>
  );
}

const REVIEW_REASON: Record<string, AdminMessageKey> = {
  high_value: 'orders.reason.high_value',
  multiple_expensive: 'orders.reason.multiple_expensive',
  new_customer: 'orders.reason.new_customer',
  split_payment: 'orders.reason.split_payment',
  unfinished_orders: 'orders.reason.unfinished_orders',
  order_velocity: 'orders.reason.order_velocity',
};

function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_LABEL;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={adminStyles.dlRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function submit(handler: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    handler();
  };
}

function NoteField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={500}
    />
  );
}

function ReviewAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [note, setNote] = useState('');
  const { mutation, feedback } = useStaffAction(order.id, (decision: 'approved' | 'rejected') =>
    repositories.orders.review(order.id, decision, note || null),
  );
  return (
    <ActionCard title={at('orders.reviewAction')} feedback={feedback}>
      <p className={adminStyles.muted}>{at('orders.reviewHint')}</p>
      <NoteField label={at('orders.note')} value={note} onChange={setNote} />
      <div className={styles.buttons}>
        <Button
          variant="primary"
          loading={mutation.isPending}
          onClick={() => mutation.mutate('approved')}
        >
          {at('orders.approve')}
        </Button>
        <Button
          variant="danger"
          loading={mutation.isPending}
          onClick={() => mutation.mutate('rejected')}
        >
          {at('orders.reject')}
        </Button>
      </div>
    </ActionCard>
  );
}

function StatusAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const options = nextStatuses(order);
  const [to, setTo] = useState<OrderStatus | ''>('');
  const [note, setNote] = useState('');
  const { mutation, feedback } = useStaffAction(order.id, (status: OrderStatus) =>
    repositories.orders.setStatus(order.id, status, note || null),
  );
  if (options.length === 0) return null;
  return (
    <ActionCard title={at('orders.statusAction')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(() => to && mutation.mutate(to))}>
        <div className={styles.field}>
          <label className={adminStyles.label} htmlFor="order-next-status">
            {at('orders.nextStatus')}
          </label>
          <select
            id="order-next-status"
            className={adminStyles.select}
            value={to}
            onChange={(e) => setTo(e.target.value as OrderStatus | '')}
            required
          >
            <option value="">{at('orders.choose')}</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {t(ORDER_STATUS_LABEL[s])}
              </option>
            ))}
          </select>
        </div>
        {to === 'confirmed' && <p className={adminStyles.muted}>{at('orders.confirmHint')}</p>}
        <NoteField label={at('orders.note')} value={note} onChange={setNote} />
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!to}>
          {at('orders.updateStatus')}
        </Button>
      </form>
    </ActionCard>
  );
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? toMinor(amount) / 100 : null;
}

function ShippingAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [fee, setFee] = useState(
    order.totals.shippingFee === null ? '' : String(order.totals.shippingFee),
  );
  const [eta, setEta] = useState(order.fulfillment.eta ?? '');
  const [courier, setCourier] = useState(order.fulfillment.courier ?? '');
  const [tracking, setTracking] = useState(order.fulfillment.trackingNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const { mutation, feedback } = useStaffAction(order.id, (amount: number) =>
    repositories.orders.setShipping(order.id, {
      fee: amount,
      eta: eta || null,
      courier: courier || null,
      tracking: tracking || null,
    }),
  );
  return (
    <ActionCard title={at('orders.shippingAction')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(() => {
          const amount = parseMoney(fee);
          if (amount === null) {
            setError(at('orders.errors.invalid_fee'));
            return;
          }
          setError(null);
          mutation.mutate(amount);
        })}
        noValidate
      >
        <p className={adminStyles.muted}>{at('orders.shippingHint')}</p>
        <TextField
          label={at('orders.shippingFee')}
          inputMode="decimal"
          dir="ltr"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          error={error}
        />
        <TextField
          label={at('orders.eta')}
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          maxLength={120}
        />
        <TextField
          label={at('orders.courier')}
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          maxLength={120}
        />
        <TextField
          label={at('orders.tracking')}
          dir="ltr"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          maxLength={120}
        />
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {at('orders.saveShipping')}
        </Button>
      </form>
    </ActionCard>
  );
}

function VerificationAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const { mutation, feedback } = useStaffAction(order.id, () =>
    repositories.orders.markPaymentVerification(order.id, null),
  );
  if (order.status === 'payment_verification') return null;
  return (
    <ActionCard title={at('orders.verificationAction')} feedback={feedback}>
      <p className={adminStyles.muted}>{at('orders.verificationHint')}</p>
      <Button
        variant="secondary"
        loading={mutation.isPending}
        onClick={() => mutation.mutate(undefined)}
      >
        {at('orders.markVerification')}
      </Button>
    </ActionCard>
  );
}

function PaymentAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { repositories } = useRuntime();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'instapay' | 'cash'>(
    order.paymentMethod === 'cod' ? 'cash' : 'instapay',
  );
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutation, feedback } = useStaffAction(order.id, (value: number) =>
    repositories.orders.recordPayment(order.id, {
      amount: value,
      method,
      reference: reference || null,
      note: note || null,
    }),
  );
  return (
    <ActionCard title={at('orders.paymentAction')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(() => {
          const value = parseMoney(amount);
          if (value === null || value <= 0) {
            setError(at('orders.errors.invalid_amount'));
            return;
          }
          setError(null);
          mutation.mutate(value);
        })}
        noValidate
      >
        <Alert tone="warning">{at('orders.paymentWarning')}</Alert>
        <p className={adminStyles.muted}>
          {at('orders.remainingNow', {
            amount: format.money(order.totals.remainingAmount, { fractionDigits: 2 }),
          })}
        </p>
        <fieldset className={styles.radios}>
          <legend className={adminStyles.label}>{at('orders.receivedVia')}</legend>
          {(['instapay', 'cash'] as const).map((m) => (
            <label key={m} className={styles.check}>
              <input
                type="radio"
                name="payment-method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
              />
              {at(m === 'cash' ? 'orders.methodCash' : 'orders.methodInstapay')}
            </label>
          ))}
        </fieldset>
        <TextField
          label={at('orders.amount')}
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error}
        />
        <TextField
          label={at('orders.reference')}
          dir="ltr"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={120}
        />
        <NoteField label={at('orders.note')} value={note} onChange={setNote} />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {at('orders.confirmReceived')}
        </label>
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!confirmed}>
          {at('orders.recordPayment')}
        </Button>
      </form>
    </ActionCard>
  );
}

function CancelAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [reason, setReason] = useState('');
  const { mutation, feedback } = useStaffAction(order.id, () =>
    repositories.orders.cancel(order.id, reason),
  );
  return (
    <ActionCard title={at('orders.cancelAction')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(() => mutation.mutate(undefined))}>
        <p className={adminStyles.muted}>
          {at(order.stockCommitted ? 'orders.cancelHintCommitted' : 'orders.cancelHint')}
        </p>
        <TextField
          label={at('orders.cancelReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          required
        />
        <Button
          type="submit"
          variant="danger"
          loading={mutation.isPending}
          disabled={!reason.trim()}
        >
          {at('orders.cancelOrder')}
        </Button>
      </form>
    </ActionCard>
  );
}

function NoteAction({ order }: { order: StaffOrder }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [note, setNote] = useState('');
  const { mutation, feedback } = useStaffAction(order.id, () =>
    repositories.orders.addNote(order.id, note),
  );
  return (
    <ActionCard title={at('orders.noteAction')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(() => {
          mutation.mutate(undefined, { onSuccess: (r) => r.ok && setNote('') });
        })}
      >
        <NoteField label={at('orders.note')} value={note} onChange={setNote} />
        <Button
          type="submit"
          variant="secondary"
          loading={mutation.isPending}
          disabled={!note.trim()}
        >
          {at('orders.addNote')}
        </Button>
      </form>
    </ActionCard>
  );
}
