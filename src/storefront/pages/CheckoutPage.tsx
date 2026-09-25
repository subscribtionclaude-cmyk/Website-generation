import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  ChevronDown,
  CircleAlert,
  Clock3,
  Info,
  Landmark,
  PackageCheck,
  ShieldCheck,
  SplitSquareHorizontal,
  Store,
  Truck,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { parseAmount } from '@/domain/catalog/amount';
import { deliveryPlace, GOVERNORATES } from '@/domain/commerce/governorates';
import type { CreateOrderPayload, FulfillmentMethod, PaymentMethod } from '@/domain/commerce/types';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useCart } from '@/features/cart/context';
import { useQuote } from '@/features/cart/useQuote';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { OpeningHoursList } from '@/features/store-info/OpeningHoursList';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import { isolate } from '@/i18n/translator';
import { isEgyptianMobile } from '@/lib/phone';
import { useRuntime } from '@/runtime/context';
import { LineRow, Totals } from '../commerce/CommerceParts';
import { quoteLineView } from '../commerce/lineViews';
import { PAYMENT_METHOD_LABEL, PROMO_REASON_LABEL } from '../commerce/labels';
import styles from '../commerce/commerce.module.css';

type Step = 'contact' | 'fulfillment' | 'payment' | 'review';
const STEPS: Step[] = ['contact', 'fulfillment', 'payment', 'review'];
const STEP_LABEL: Record<Step, CoreMessageKey> = {
  contact: 'checkout.stepContact',
  fulfillment: 'checkout.stepFulfillment',
  payment: 'checkout.stepPayment',
  review: 'checkout.stepReview',
};

const ERROR_MESSAGE: Record<string, CoreMessageKey> = {
  price_changed: 'checkout.errorPriceChanged',
  cart_invalid: 'checkout.errorCartInvalid',
  cart_empty: 'checkout.errorCartInvalid',
  promo_invalid: 'checkout.errorPromo',
  too_many_open_orders: 'checkout.errorTooManyOpen',
  pickup_unavailable: 'checkout.errorPickup',
  payment_method_unavailable: 'checkout.errorPayment',
  invalid_deposit: 'checkout.errorDeposit',
  invalid_phone: 'checkout.errorPhone',
  invalid_name: 'checkout.errorName',
  invalid_address: 'checkout.errorAddress',
  invalid_fulfillment: 'checkout.errorAddress',
  invalid_request: 'checkout.errorGeneric',
  auth_required: 'checkout.errorAuth',
};

export function CheckoutPage() {
  return (
    <RequireAuth>
      <Checkout />
    </RequireAuth>
  );
}

interface FormState {
  name: string;
  phone: string;
  fulfillment: FulfillmentMethod | null;
  branchId: string | null;
  governorate: string;
  area: string;
  address: string;
  notes: string;
  payment: PaymentMethod | null;
  deposit: string;
  note: string;
}

function Checkout() {
  const { t, locale, format } = useI18n();
  const { repositories, mode } = useRuntime();
  const session = useSession();
  const settings = useSettings();
  const cart = useCart();
  const navigate = useNavigate();
  usePageMeta({ title: t('checkout.title'), noIndex: true });

  const branches = settings.store.branches.filter((b) => b.pickupEnabled);
  const [step, setStep] = useState<Step>('contact');
  const [form, setForm] = useState<FormState>({
    name: '',
    phone: '',
    fulfillment: null,
    branchId: branches[0]?.id ?? null,
    governorate: 'cairo',
    area: '',
    address: '',
    notes: '',
    payment: null,
    deposit: '',
    note: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [promoInputError, setPromoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<CoreMessageKey | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryId = useId();

  // Prefill contact details the customer used before.
  const profile = useQuery({
    queryKey: ['profile', session?.userId ?? null],
    queryFn: () => repositories.profiles.getMyProfile(),
    enabled: Boolean(session),
  });
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && profile.data) {
    setPrefilled(true);
    setForm((f) => ({
      ...f,
      name: f.name || profile.data?.fullName || '',
      phone: f.phone || profile.data?.phone || '',
    }));
  }

  const quote = useQuote(cart.lines, { promoCode: appliedPromo, fulfillment: form.fulfillment });
  const data = quote.data;

  // An invalid code is never sent with the order: the quote says why, and payload drops it.
  const promo = data?.promo;
  const promoInvalid = Boolean(appliedPromo && promo && promo.status === 'invalid');
  const promoError =
    promoInputError ??
    (promo && promo.status === 'invalid' && appliedPromo
      ? t(PROMO_REASON_LABEL[promo.reason], {
          min: promo.minSubtotal !== undefined ? format.money(promo.minSubtotal) : '',
        })
      : null);

  const orderItems = useMemo(
    () =>
      (data?.lines ?? [])
        .filter((l) => !l.isGift && l.status === 'ok')
        .map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          expectedUnitPrice: l.unitPrice,
        })),
    [data],
  );
  const deposit =
    form.payment === 'split' && form.deposit.trim() ? parseAmount(form.deposit) : null;

  const payload: Omit<CreateOrderPayload, 'idempotencyKey'> | null =
    data && form.fulfillment && form.payment
      ? {
          items: orderItems,
          expectedTotal: data.totals.total,
          promoCode: promoInvalid ? null : appliedPromo,
          contact: { name: form.name.trim(), phone: form.phone.trim() },
          fulfillment:
            form.fulfillment === 'pickup'
              ? { method: 'pickup', branchId: form.branchId }
              : {
                  method: 'delivery',
                  governorate: form.governorate,
                  area: form.area.trim(),
                  address: form.address.trim(),
                  notes: form.notes.trim() || null,
                },
          payment: {
            method: form.payment,
            depositAmount: typeof deposit === 'number' && !Number.isNaN(deposit) ? deposit : null,
          },
          note: form.note.trim() || null,
          locale,
        }
      : null;

  // One idempotency key per exact payload: retries of the same checkout can never create two orders.
  const signature = JSON.stringify(payload);
  const idempotencyKey = useMemo(() => {
    void signature;
    return crypto.randomUUID();
  }, [signature]);

  const placeOrder = useMutation({
    mutationFn: (body: CreateOrderPayload) => repositories.commerce.createOrder(body),
    onSuccess: async (result) => {
      if (result.ok) {
        await cart.afterOrder(orderItems.map((i) => i.variantId));
        void navigate(`${localizePath(`/order/${result.order.orderNumber}`, locale)}?placed=1`, {
          replace: true,
        });
        return;
      }
      setSubmitError(ERROR_MESSAGE[result.code] ?? 'checkout.errorGeneric');
      if (result.code === 'price_changed' || result.code === 'cart_invalid') void quote.refetch();
      if (result.code === 'promo_invalid') {
        setAppliedPromo(null);
        void quote.refetch();
      }
      if (result.code === 'invalid_phone' || result.code === 'invalid_name') setStep('contact');
      if (result.code === 'invalid_address' || result.code === 'pickup_unavailable')
        setStep('fulfillment');
      if (result.code === 'payment_method_unavailable' || result.code === 'invalid_deposit')
        setStep('payment');
    },
    onError: () => setSubmitError('checkout.errorNetwork'),
  });

  // Move focus to the new step's heading on step changes (not on first load).
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (target: Step): boolean => {
    const next: typeof errors = {};
    if (target === 'contact') {
      if (form.name.trim().length < 2) next.name = t('checkout.errorName');
      if (!isEgyptianMobile(form.phone)) next.phone = t('checkout.errorPhone');
    }
    if (target === 'fulfillment') {
      if (!form.fulfillment) next.fulfillment = t('checkout.chooseFulfillment');
      if (form.fulfillment === 'delivery') {
        if (form.area.trim().length < 2) next.area = t('checkout.errorArea');
        if (form.address.trim().length < 5) next.address = t('checkout.errorAddressLine');
      }
    }
    if (target === 'payment') {
      if (!form.payment) next.payment = t('checkout.choosePayment');
      if (form.payment === 'split' && form.deposit.trim()) {
        const value = parseAmount(form.deposit);
        const itemsTotal = data ? data.totals.subtotal - data.totals.discountTotal : 0;
        if (value === null || Number.isNaN(value) || value <= 0 || value >= itemsTotal)
          next.deposit = t('checkout.errorDeposit');
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = (event: FormEvent) => {
    event.preventDefault();
    if (!validate(step)) return;
    const index = STEPS.indexOf(step);
    setSubmitError(null);
    setStep(STEPS[index + 1] ?? 'review');
  };

  if (cart.status === 'loading' || (quote.isPending && cart.count > 0)) {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <Skeleton width="30%" height="2.2rem" />
        <Skeleton height="240px" />
      </div>
    );
  }

  if (cart.count === 0) {
    return (
      <div className={`container ${styles.page}`}>
        <StateMessage
          icon={<PackageCheck />}
          headingLevel={1}
          title={t('checkout.emptyTitle')}
          body={t('checkout.emptyBody')}
          actions={
            <ButtonLink to="/store" variant="primary">
              {t('account.browseStore')}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const blockedByCart = data !== undefined && !data.valid;
  const stepIndex = STEPS.indexOf(step);
  const promoEnabled = settings.features.promoCodes;
  const methods = settings.commerce.paymentMethods;
  const paymentOptions: { key: PaymentMethod; icon: ReactNode; text: CoreMessageKey }[] = [
    ...(methods.cod
      ? [
          {
            key: 'cod' as const,
            icon: <Banknote aria-hidden="true" />,
            text: 'checkout.codText' as const,
          },
        ]
      : []),
    ...(methods.instapay
      ? [
          {
            key: 'instapay' as const,
            icon: <Landmark aria-hidden="true" />,
            text: 'checkout.instapayText' as const,
          },
        ]
      : []),
    ...(methods.split
      ? [
          {
            key: 'split' as const,
            icon: <SplitSquareHorizontal aria-hidden="true" />,
            text: 'checkout.splitText' as const,
          },
        ]
      : []),
    ...(settings.features.payAtStore && form.fulfillment === 'pickup'
      ? [
          {
            key: 'pay_at_store' as const,
            icon: <Store aria-hidden="true" />,
            text: 'checkout.payAtStoreText' as const,
          },
        ]
      : []),
  ];
  const instapay = settings.commerce.instapay;

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('checkout.title')}</h1>
        {session?.email && (
          <p className={styles.subtitle}>
            {t('auth.signedInAs', { email: isolate(session.email) })}
          </p>
        )}
      </header>

      <ol className={styles.steps} aria-label={t('checkout.progress')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={[
              styles.step,
              i < stepIndex && styles.stepDone,
              i === stepIndex && styles.stepCurrent,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={i === stepIndex ? 'step' : undefined}
          >
            <span>
              <span className="visually-hidden">
                {t('checkout.stepOf', { index: i + 1, total: STEPS.length })}{' '}
              </span>
              {t(STEP_LABEL[s])}
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.layout}>
        <div className={styles.card}>
          {blockedByCart && (
            <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
              <CircleAlert aria-hidden="true" />
              <p>
                {t('checkout.errorCartInvalid')}{' '}
                <LocaleLink to="/cart">{t('checkout.backToCart')}</LocaleLink>
              </p>
            </div>
          )}

          {step === 'contact' && (
            <form className={styles.section} onSubmit={goNext} noValidate>
              <h2 ref={headingRef} tabIndex={-1} className={styles.sectionTitle}>
                {t('checkout.stepContact')}
              </h2>
              <p className={styles.muted}>{t('checkout.contactIntro')}</p>
              <div className={`${styles.fields} ${styles.fieldsTwo}`}>
                <TextField
                  label={t('checkout.name')}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  error={errors.name}
                  required
                  maxLength={120}
                />
                <TextField
                  label={t('checkout.phone')}
                  hint={t('checkout.phoneHint')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  error={errors.phone}
                  required
                  maxLength={20}
                />
              </div>
              <p className={styles.muted}>{t('checkout.noSmsNote')}</p>
              <div className={styles.stepActions}>
                <LocaleLink to="/cart" className={styles.linkButton}>
                  {t('checkout.backToCart')}
                </LocaleLink>
                <Button type="submit" variant="primary" size="lg">
                  {t('checkout.continue')}
                </Button>
              </div>
            </form>
          )}

          {step === 'fulfillment' && (
            <form className={styles.section} onSubmit={goNext} noValidate>
              <h2 ref={headingRef} tabIndex={-1} className={styles.sectionTitle}>
                {t('checkout.stepFulfillment')}
              </h2>
              <fieldset
                className={styles.choices}
                aria-describedby={errors.fulfillment ? 'fulfillment-error' : undefined}
              >
                <legend>{t('checkout.chooseFulfillment')}</legend>
                <label className={styles.choice}>
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={form.fulfillment === 'delivery'}
                    onChange={() => set('fulfillment', 'delivery')}
                  />
                  <span className={styles.choiceBody}>
                    <span className={styles.choiceTitle}>
                      <Truck aria-hidden="true" />
                      {t('fulfillment.delivery')}
                    </span>
                    <span className={styles.choiceText}>{t('checkout.deliveryText')}</span>
                  </span>
                </label>
                {branches.length > 0 && (
                  <label className={styles.choice}>
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={form.fulfillment === 'pickup'}
                      onChange={() => set('fulfillment', 'pickup')}
                    />
                    <span className={styles.choiceBody}>
                      <span className={styles.choiceTitle}>
                        <Store aria-hidden="true" />
                        {t('fulfillment.pickup')}
                      </span>
                      <span className={styles.choiceText}>{t('checkout.pickupText')}</span>
                    </span>
                  </label>
                )}
                {errors.fulfillment && (
                  <p id="fulfillment-error" className={styles.fieldError} role="alert">
                    {errors.fulfillment}
                  </p>
                )}
              </fieldset>

              {form.fulfillment === 'delivery' && (
                <div className={styles.fields}>
                  <div>
                    <label className={styles.fieldLabel} htmlFor="governorate">
                      {t('checkout.governorate')}
                    </label>
                    <select
                      id="governorate"
                      className={styles.select}
                      value={form.governorate}
                      onChange={(e) => set('governorate', e.target.value)}
                    >
                      {GOVERNORATES.map((g) => (
                        <option key={g.key} value={g.key}>
                          {resolveLocalized(g.name, locale)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <TextField
                    label={t('checkout.area')}
                    autoComplete="address-level2"
                    value={form.area}
                    onChange={(e) => set('area', e.target.value)}
                    error={errors.area}
                    required
                    maxLength={120}
                  />
                  <TextField
                    label={t('checkout.address')}
                    hint={t('checkout.addressHint')}
                    autoComplete="street-address"
                    value={form.address}
                    onChange={(e) => set('address', e.target.value)}
                    error={errors.address}
                    required
                    maxLength={400}
                  />
                  <TextField
                    label={t('checkout.addressNotes')}
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    maxLength={400}
                  />
                  <p className={styles.notice} role="note">
                    <Info aria-hidden="true" />
                    <span>{t('checkout.shippingPendingNote')}</span>
                  </p>
                </div>
              )}

              {form.fulfillment === 'pickup' &&
                branches.map((branch) => (
                  <div key={branch.id} className={styles.card}>
                    <p className={styles.choiceTitle}>
                      <Store aria-hidden="true" />
                      {resolveLocalized(branch.name, locale)}
                    </p>
                    <p className={styles.muted}>
                      {resolveLocalized(branch.address, locale)}
                      {branch.landmark
                        ? ` — ${resolveLocalized(branch.landmark, locale)}`
                        : ''} · {resolveLocalized(branch.city, locale)}
                    </p>
                    <OpeningHoursList rules={branch.openingHours} />
                  </div>
                ))}

              <div className={styles.stepActions}>
                <Button variant="ghost" onClick={() => setStep('contact')}>
                  {t('checkout.back')}
                </Button>
                <Button type="submit" variant="primary" size="lg">
                  {t('checkout.continue')}
                </Button>
              </div>
            </form>
          )}

          {step === 'payment' && (
            <form className={styles.section} onSubmit={goNext} noValidate>
              <h2 ref={headingRef} tabIndex={-1} className={styles.sectionTitle}>
                {t('checkout.stepPayment')}
              </h2>
              <fieldset className={styles.choices}>
                <legend>{t('checkout.choosePayment')}</legend>
                {paymentOptions.map((option) => (
                  <label key={option.key} className={styles.choice}>
                    <input
                      type="radio"
                      name="payment"
                      checked={form.payment === option.key}
                      onChange={() => set('payment', option.key)}
                    />
                    <span className={styles.choiceBody}>
                      <span className={styles.choiceTitle}>
                        {option.icon}
                        {t(PAYMENT_METHOD_LABEL[option.key])}
                      </span>
                      <span className={styles.choiceText}>{t(option.text)}</span>
                    </span>
                  </label>
                ))}
                {errors.payment && (
                  <p className={styles.fieldError} role="alert">
                    {errors.payment}
                  </p>
                )}
              </fieldset>

              {(form.payment === 'instapay' || form.payment === 'split') && (
                <div className={styles.card}>
                  <p className={styles.choiceTitle}>
                    <Landmark aria-hidden="true" />
                    {t('checkout.instapayHowTitle')}
                  </p>
                  {instapay ? (
                    <div className={styles.muted}>
                      <p>
                        {t('checkout.instapayHandle')}: <bdi dir="ltr">{instapay.handle}</bdi>
                      </p>
                      {instapay.accountName && (
                        <p>{resolveLocalized(instapay.accountName, locale)}</p>
                      )}
                      {instapay.instructions && (
                        <p>{resolveLocalized(instapay.instructions, locale)}</p>
                      )}
                    </div>
                  ) : (
                    <p className={styles.muted}>{t('checkout.instapayViaWhatsapp')}</p>
                  )}
                  <p className={`${styles.notice} ${styles.noticeWarning}`} role="note">
                    <ShieldCheck aria-hidden="true" />
                    <span>{t('checkout.screenshotNote')}</span>
                  </p>
                </div>
              )}

              {form.payment === 'split' && (
                <TextField
                  label={t('checkout.depositLabel')}
                  hint={t('checkout.depositHint')}
                  inputMode="decimal"
                  dir="ltr"
                  value={form.deposit}
                  onChange={(e) => set('deposit', e.target.value)}
                  error={errors.deposit}
                />
              )}

              <div className={styles.stepActions}>
                <Button variant="ghost" onClick={() => setStep('fulfillment')}>
                  {t('checkout.back')}
                </Button>
                <Button type="submit" variant="primary" size="lg">
                  {t('checkout.continue')}
                </Button>
              </div>
            </form>
          )}

          {step === 'review' && (
            <form
              className={styles.section}
              onSubmit={(event) => {
                event.preventDefault();
                if (!payload || !data?.valid || placeOrder.isPending) return;
                setSubmitError(null);
                placeOrder.mutate({ ...payload, idempotencyKey });
              }}
              noValidate
            >
              <h2 ref={headingRef} tabIndex={-1} className={styles.sectionTitle}>
                {t('checkout.stepReview')}
              </h2>
              <dl className={styles.review}>
                <ReviewRow label={t('checkout.stepContact')} onEdit={() => setStep('contact')}>
                  {form.name} · <bdi dir="ltr">{form.phone}</bdi>
                </ReviewRow>
                <ReviewRow
                  label={t('checkout.stepFulfillment')}
                  onEdit={() => setStep('fulfillment')}
                >
                  {form.fulfillment === 'pickup'
                    ? `${t('fulfillment.pickup')} — ${resolveLocalized(branches.find((b) => b.id === form.branchId)?.name ?? { ar: '' }, locale)}`
                    : `${t('fulfillment.delivery')} — ${deliveryPlace({ governorate: form.governorate, area: form.area, address: form.address }, locale)}`}
                </ReviewRow>
                <ReviewRow label={t('checkout.stepPayment')} onEdit={() => setStep('payment')}>
                  {form.payment ? t(PAYMENT_METHOD_LABEL[form.payment]) : '—'}
                  {form.payment === 'split' && typeof deposit === 'number' && !Number.isNaN(deposit)
                    ? ` — ${t('checkout.depositPlanned', { amount: format.money(deposit) })}`
                    : ''}
                </ReviewRow>
              </dl>

              {promoEnabled && (
                <div>
                  <label className={styles.fieldLabel} htmlFor="promo">
                    {t('promo.label')}
                  </label>
                  <div className={styles.promoRow}>
                    <input
                      id="promo"
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(e.target.value);
                        setPromoError(null);
                        if (promoInvalid) setAppliedPromo(null);
                      }}
                      maxLength={30}
                      autoComplete="off"
                      aria-describedby={
                        promoError ? 'promo-error' : appliedPromo ? 'promo-ok' : undefined
                      }
                      aria-invalid={promoError ? true : undefined}
                    />
                    {appliedPromo && !promoInvalid ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAppliedPromo(null);
                          setPromoInput('');
                        }}
                      >
                        {t('promo.remove')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={!promoInput.trim()}
                        onClick={() => {
                          setPromoError(null);
                          setAppliedPromo(promoInput.trim().toUpperCase());
                        }}
                      >
                        {t('promo.apply')}
                      </Button>
                    )}
                  </div>
                  {promoError && (
                    <p id="promo-error" className={styles.fieldError} role="alert">
                      {promoError}
                    </p>
                  )}
                  {appliedPromo && promo?.status === 'applied' && (
                    <p id="promo-ok" className={styles.fieldHint} role="status">
                      {t('promo.applied', {
                        code: appliedPromo,
                        amount: format.money(promo.discount),
                      })}
                    </p>
                  )}
                </div>
              )}

              <TextField
                label={t('checkout.orderNote')}
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                maxLength={500}
              />

              <p className={styles.notice} role="note">
                <Clock3 aria-hidden="true" />
                <span>
                  {t('checkout.reservationNote', { minutes: settings.commerce.reservationMinutes })}
                </span>
              </p>
              {mode === 'demo' && (
                <p className={`${styles.notice} ${styles.noticeWarning}`} role="note">
                  <Info aria-hidden="true" />
                  <span>{t('checkout.demoNote')}</span>
                </p>
              )}

              {submitError && (
                <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
                  <CircleAlert aria-hidden="true" />
                  <div>
                    <p>{t(submitError)}</p>
                    {submitError === 'checkout.errorTooManyOpen' && (
                      <LocaleLink to="/account">{t('checkout.viewOrders')}</LocaleLink>
                    )}
                    {submitError === 'checkout.errorCartInvalid' && (
                      <LocaleLink to="/cart">{t('checkout.backToCart')}</LocaleLink>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.stepActions}>
                <Button variant="ghost" onClick={() => setStep('payment')}>
                  {t('checkout.back')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  size="lg"
                  loading={placeOrder.isPending}
                  disabled={!data?.valid || !payload || quote.isFetching}
                >
                  {submitError === 'checkout.errorPriceChanged'
                    ? t('checkout.confirmNewTotal', {
                        total: format.money(data?.totals.total ?? 0),
                      })
                    : t('checkout.placeOrder')}
                </Button>
              </div>
            </form>
          )}
        </div>

        <aside className={styles.aside} aria-labelledby={`${summaryId}-title`}>
          <div className={styles.card}>
            <h2 id={`${summaryId}-title`} className={styles.cardTitle}>
              <button
                type="button"
                className={styles.summaryToggle}
                aria-expanded={summaryOpen}
                aria-controls={summaryId}
                onClick={() => setSummaryOpen((o) => !o)}
              >
                <span>{t('checkout.summary')}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            </h2>
            <div id={summaryId} className={summaryOpen ? undefined : styles.summaryCollapsed}>
              <ul className={styles.lines}>
                {(data?.lines ?? []).map((l) => (
                  <LineRow
                    key={`${l.variantId}-${l.isGift}`}
                    compact
                    line={quoteLineView(l, locale)}
                  />
                ))}
              </ul>
            </div>
            {data && <Totals totals={data.totals} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: ReactNode;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.reviewRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
      <dd>
        <button type="button" className={styles.linkButton} onClick={onEdit}>
          {t('checkout.edit')}
          <span className="visually-hidden">: {label}</span>
        </button>
      </dd>
    </div>
  );
}
