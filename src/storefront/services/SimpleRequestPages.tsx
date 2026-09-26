import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageOpen, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/TextField';
import { parseAmount } from '@/domain/catalog/amount';
import { resolveLocalized } from '@/domain/localized';
import { limitsFromSettings } from '@/domain/services/media';
import {
  AFTER_SALES_REASONS,
  AFTER_SALES_TYPES,
  BATTERY_PREFERENCES,
  TAX_PREFERENCES,
  type AfterSalesReason,
  type AfterSalesType,
  type UsedDeviceRequest,
} from '@/domain/services/types';
import {
  afterSalesProblem,
  cleanText,
  contactProblem,
  usedProblem,
} from '@/domain/services/validation';
import { useSession } from '@/features/auth/context';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useSettings } from '@/features/settings/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { track } from '@/lib/analytics/track';
import { useRuntime } from '@/runtime/context';
import { MediaUploader } from './MediaUploader';
import {
  uploadsForDraft,
  uploadsToMedia,
  useProfileContact,
  type UploadItem,
} from './serviceHelpers';
import { AFTER_SALES_TYPE_LABEL, PROBLEM_MESSAGE } from './serviceLabels';
import {
  ContactFields,
  DraftBar,
  HonestNote,
  SignInNotice,
  type ContactValue,
} from './ServiceParts';
import { useServiceDraft } from './useServiceDraft';
import styles from './services.module.css';

function Submitted({ number, body }: { number: string; body: string }) {
  const { t } = useI18n();
  return (
    <div className={`container ${styles.page}`}>
      <section className={styles.success} aria-labelledby="request-done">
        <h2 id="request-done" tabIndex={-1} ref={(el) => el?.focus()}>
          {t('services.submittedTitle')}
        </h2>
        <p>{t('services.requestNumberLabel')}</p>
        <p className={styles.requestNumber}>{number}</p>
        <p>{body}</p>
        <div className={styles.heroActions}>
          <ButtonLink to={`/account/requests/${number}`} variant="accent">
            {t('services.trackRequest')}
          </ButtonLink>
          <ButtonLink to="/services" variant="inverse">
            {t('services.backToServices')}
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

function usePrefill(setContact: (fn: (c: ContactValue) => ContactValue) => void) {
  const profile = useProfileContact();
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && profile.data) {
    setPrefilled(true);
    setContact((c) => ({
      ...c,
      name: c.name || profile.data?.fullName || '',
      phone: c.phone || profile.data?.phone || '',
    }));
  }
}

// ── Used-device request ─────────────────────────────────────────────────────
interface UsedForm {
  device: UsedDeviceRequest;
  budgetText: string;
  contact: ContactValue;
  idempotencyKey: string;
}

export function UsedRequestPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const session = useSession();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  usePageMeta({ title: t('used.requestTitle'), noIndex: true });
  const [form, setForm] = useState<UsedForm>(() => ({
    device: {
      category: 'smartphone',
      brand: '',
      model: '',
      storage: null,
      color: null,
      batteryPreference: 'none',
      taxPreference: 'no_preference',
      budget: null,
      notes: null,
    },
    budgetText: '',
    contact: { name: '', phone: '', preferredContact: 'whatsapp' },
    idempotencyKey: crypto.randomUUID(),
  }));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const draft = useServiceDraft('used', form, dirty && !done);
  usePrefill((fn) => setForm((f) => ({ ...f, contact: fn(f.contact) })));

  const setDevice = (changes: Partial<UsedDeviceRequest>) => {
    setDirty(true);
    setForm((f) => ({ ...f, device: { ...f.device, ...changes } }));
  };

  const budget = form.budgetText.trim() ? parseAmount(form.budgetText) : null;
  const input = () => ({
    idempotencyKey: form.idempotencyKey,
    contact: { name: form.contact.name, phone: form.contact.phone },
    preferredContact: form.contact.preferredContact,
    locale,
    device: { ...form.device, budget: budget !== null && !Number.isNaN(budget) ? budget : null },
  });

  const submit = useMutation({
    mutationFn: () => repositories.services.create('used', input()),
    onSuccess: (result) => {
      if (!result.ok) {
        setSubmitError(t(PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric'));
        return;
      }
      track('used_request_submitted', { battery: form.device.batteryPreference });
      draft.clear();
      setDone(result.request.number);
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
    onError: () => setSubmitError(t('services.errorNetwork')),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const next: Record<string, string> = {};
    if (!cleanText(form.device.brand, 60)) next.brand = t('services.errorBrand');
    if (!cleanText(form.device.model, 80)) next.model = t('services.errorModel');
    if (form.budgetText.trim() && (budget === null || Number.isNaN(budget) || budget <= 0))
      next.budget = t('services.errorBudget');
    const contact = contactProblem(form.contact);
    if (contact?.field === 'name') next.name = t('services.errorName');
    if (contact?.field === 'phone') next.phone = t('services.errorPhone');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const problem = usedProblem(input());
    if (problem) {
      setSubmitError(t(PROBLEM_MESSAGE[problem.code] ?? 'services.errorGeneric'));
      return;
    }
    submit.mutate();
  };

  if (done) return <Submitted number={done} body={t('used.submittedBody')} />;
  const d = form.device;
  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.formShell}>
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>{t('used.requestTitle')}</h1>
          <p className={styles.lead}>{t('used.requestLead')}</p>
        </header>
        {draft.pending && (
          <DraftBar
            savedAt={draft.pending.savedAt}
            onRestore={() => {
              const data = draft.restore();
              if (data) setForm(data);
            }}
            onDiscard={draft.discard}
          />
        )}
        <form className={styles.panel} onSubmit={onSubmit} noValidate>
          <h2 className={styles.panelTitle}>{t('used.deviceTitle')}</h2>
          <fieldset className={styles.fieldset}>
            <legend>{t('tradeIn.deviceType')}</legend>
            <div className={styles.choiceGrid}>
              {settings.repair_catalog.categories
                .filter((c) => c.key !== 'other')
                .map((c) => (
                  <label key={c.key} className={styles.choice}>
                    <input
                      type="radio"
                      name="used-category"
                      checked={d.category === c.key}
                      onChange={() => setDevice({ category: c.key })}
                    />
                    <span className={styles.choiceBody}>{resolveLocalized(c.label, locale)}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          <div className={`${styles.fields} ${styles.fields2}`}>
            <TextField
              label={t('services.brand')}
              value={d.brand}
              onChange={(e) => setDevice({ brand: e.target.value })}
              error={errors.brand}
              maxLength={60}
            />
            <TextField
              label={t('services.model')}
              value={d.model}
              onChange={(e) => setDevice({ model: e.target.value })}
              error={errors.model}
              maxLength={80}
            />
            <TextField
              label={t('services.storage')}
              value={d.storage ?? ''}
              onChange={(e) => setDevice({ storage: e.target.value || null })}
              maxLength={20}
            />
            <TextField
              label={t('services.color')}
              value={d.color ?? ''}
              onChange={(e) => setDevice({ color: e.target.value || null })}
              maxLength={30}
            />
          </div>
          <fieldset className={styles.fieldset}>
            <legend>{t('used.batteryPreference')}</legend>
            <div className={styles.choiceGrid}>
              {BATTERY_PREFERENCES.map((b) => (
                <label key={b} className={styles.choice}>
                  <input
                    type="radio"
                    name="battery-pref"
                    checked={d.batteryPreference === b}
                    onChange={() => setDevice({ batteryPreference: b })}
                  />
                  <span className={styles.choiceBody}>
                    {t(`used.battery_${b}` as CoreMessageKey)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>{t('used.taxPreference')}</legend>
            <div className={styles.choiceGrid}>
              {TAX_PREFERENCES.map((x) => (
                <label key={x} className={styles.choice}>
                  <input
                    type="radio"
                    name="tax-pref"
                    checked={d.taxPreference === x}
                    onChange={() => setDevice({ taxPreference: x })}
                  />
                  <span className={styles.choiceBody}>{t(`used.tax_${x}` as CoreMessageKey)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={`${styles.fields} ${styles.fields2}`}>
            <TextField
              label={t('used.budget')}
              hint={t('used.budgetHint')}
              inputMode="decimal"
              dir="ltr"
              value={form.budgetText}
              onChange={(e) => {
                setDirty(true);
                setForm((f) => ({ ...f, budgetText: e.target.value }));
              }}
              error={errors.budget}
            />
          </div>
          <TextAreaField
            label={t('used.notes')}
            value={d.notes ?? ''}
            onChange={(e) => setDevice({ notes: e.target.value || null })}
            rows={3}
            maxLength={2000}
          />
          <h2 className={styles.panelTitle}>{t('services.contactTitle')}</h2>
          {!session && <SignInNotice />}
          <ContactFields
            value={form.contact}
            onChange={(contact) => {
              setDirty(true);
              setForm((f) => ({ ...f, contact }));
            }}
            errors={errors}
          />
          <HonestNote>{t('used.noCatalogNote')}</HonestNote>
          {submitError && (
            <p className={styles.fieldError} role="alert">
              {submitError}
            </p>
          )}
          <div className={`${styles.actions} ${styles.actionsEnd}`}>
            <Button
              type="submit"
              variant="accent"
              loading={submit.isPending}
              disabled={!session}
              icon={<Send aria-hidden="true" className="flip-rtl" />}
            >
              {t('used.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── After-sales request (requires sign-in; owned, delivered items only) ────
export function AfterSalesRequestPage() {
  return (
    <RequireAuth>
      <AfterSalesForm />
    </RequireAuth>
  );
}

interface AfterSalesFormState {
  orderItemId: string;
  type: AfterSalesType;
  reason: AfterSalesReason;
  description: string;
  policyAccepted: boolean;
  contact: ContactValue;
  uploads: UploadItem[];
  idempotencyKey: string;
}

function AfterSalesForm() {
  const { t, locale, format } = useI18n();
  const settings = useSettings();
  const session = useSession();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  usePageMeta({ title: t('afterSales.requestTitle'), noIndex: true });
  const policy = settings.services.afterSales;
  const media = settings.services.media;
  const items = useQuery({
    queryKey: ['after-sales-items', session?.userId ?? null],
    queryFn: () => repositories.services.afterSalesItems(),
  });
  const [form, setForm] = useState<AfterSalesFormState>(() => ({
    orderItemId: '',
    type: 'warranty',
    reason: 'defective',
    description: '',
    policyAccepted: false,
    contact: { name: '', phone: '', preferredContact: 'whatsapp' },
    uploads: [],
    idempotencyKey: crypto.randomUUID(),
  }));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const draft = useServiceDraft(
    'after-sales',
    { ...form, uploads: uploadsForDraft(form.uploads), policyAccepted: false },
    dirty && !done,
  );
  usePrefill((fn) => setForm((f) => ({ ...f, contact: fn(f.contact) })));
  const update = (changes: Partial<AfterSalesFormState>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...changes }));
  };

  const input = () => ({
    idempotencyKey: form.idempotencyKey,
    contact: { name: form.contact.name, phone: form.contact.phone },
    preferredContact: form.contact.preferredContact,
    locale,
    orderItemId: form.orderItemId,
    type: form.type,
    reason: form.reason,
    description: form.description,
    policyVersion: policy.policyVersion,
    policyAccepted: form.policyAccepted,
    media: uploadsToMedia(form.uploads),
  });

  const submit = useMutation({
    mutationFn: () => repositories.services.create('after_sales', input()),
    onSuccess: (result) => {
      if (!result.ok) {
        setSubmitError(t(PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric'));
        return;
      }
      track('after_sales_submitted', { type: form.type, reason: form.reason });
      draft.clear();
      setDone(result.request.number);
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['after-sales-items'] });
    },
    onError: () => setSubmitError(t('services.errorNetwork')),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const next: Record<string, string> = {};
    if (!form.orderItemId) next.orderItemId = t('afterSales.errorItem');
    const text = cleanText(form.description, 2000);
    if (!text || text.length < 10) next.description = t('services.errorDescription');
    if (!form.policyAccepted) next.policy = t('services.errorPolicy');
    if (form.uploads.some((u) => u.status === 'uploading' || u.status === 'processing'))
      next.media = t('media.waitUploads');
    const contact = contactProblem(form.contact);
    if (contact?.field === 'name') next.name = t('services.errorName');
    if (contact?.field === 'phone') next.phone = t('services.errorPhone');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const problem = afterSalesProblem(input(), policy.policyVersion);
    if (problem) {
      setSubmitError(t(PROBLEM_MESSAGE[problem.code] ?? 'services.errorGeneric'));
      return;
    }
    submit.mutate();
  };

  if (done) return <Submitted number={done} body={t('afterSales.submittedBody')} />;

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.formShell}>
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>{t('afterSales.requestTitle')}</h1>
          <p className={styles.lead}>{t('afterSales.requestLead')}</p>
        </header>
        {draft.pending && (
          <DraftBar
            savedAt={draft.pending.savedAt}
            onRestore={() => {
              const data = draft.restore();
              if (data) setForm({ ...data, policyAccepted: false });
            }}
            onDiscard={draft.discard}
          />
        )}
        {items.isPending ? (
          <Skeleton height="200px" />
        ) : (items.data?.length ?? 0) === 0 ? (
          <StateMessage
            headingLevel={2}
            icon={<PackageOpen />}
            title={t('afterSales.noItemsTitle')}
            body={t('afterSales.noItemsBody')}
            actions={
              <ButtonLink to="/account/orders" variant="secondary">
                {t('afterSales.viewOrders')}
              </ButtonLink>
            }
          />
        ) : (
          <form className={styles.panel} onSubmit={onSubmit} noValidate>
            <fieldset
              className={styles.fieldset}
              aria-describedby={errors.orderItemId ? 'err-item' : undefined}
            >
              <legend>{t('afterSales.chooseItem')}</legend>
              <div className={`${styles.choiceGrid} ${styles.choiceGridWide}`}>
                {items.data?.map((item) => (
                  <label key={item.itemId} className={styles.choice}>
                    <input
                      type="radio"
                      name="after-sales-item"
                      checked={form.orderItemId === item.itemId}
                      onChange={() => update({ orderItemId: item.itemId })}
                    />
                    <span className={styles.choiceBody}>
                      <strong>{resolveLocalized(item.name, locale)}</strong>
                      {item.variantLabel && (
                        <small>{resolveLocalized(item.variantLabel, locale)}</small>
                      )}
                      <small>
                        <bdi dir="ltr">{item.orderNumber}</bdi> · {format.date(item.orderDate)}
                      </small>
                      {item.openRequests.length > 0 && (
                        <small>
                          {t('afterSales.openRequest', {
                            number: item.openRequests.map((r) => r.number).join(', '),
                          })}
                        </small>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {errors.orderItemId && (
                <p id="err-item" className={styles.fieldError} role="alert">
                  {errors.orderItemId}
                </p>
              )}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend>{t('afterSales.typeTitle')}</legend>
              <div className={styles.choiceGrid}>
                {AFTER_SALES_TYPES.map((type) => (
                  <label key={type} className={styles.choice}>
                    <input
                      type="radio"
                      name="after-sales-type"
                      checked={form.type === type}
                      onChange={() => update({ type })}
                    />
                    <span className={styles.choiceBody}>
                      {t(AFTER_SALES_TYPE_LABEL[type] ?? 'afterSales.typeWarranty')}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className={styles.fieldLabel} htmlFor="as-reason">
                {t('afterSales.reason')}
              </label>
              <select
                id="as-reason"
                className={styles.select}
                value={form.reason}
                onChange={(e) => update({ reason: e.target.value as AfterSalesReason })}
              >
                {AFTER_SALES_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`afterSales.reason_${r}` as CoreMessageKey)}
                  </option>
                ))}
              </select>
            </div>
            <TextAreaField
              label={t('afterSales.description')}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              error={errors.description}
              rows={4}
              maxLength={2000}
            />
            <fieldset className={styles.fieldset}>
              <legend>{t('afterSales.photos')}</legend>
              <MediaUploader
                value={form.uploads}
                onChange={(fn) => {
                  setDirty(true);
                  setForm((f) => ({ ...f, uploads: fn(f.uploads) }));
                }}
                limits={limitsFromSettings(media)}
                imageMaxDimension={media.imageMaxDimension}
                imageQuality={media.imageQuality}
                allowVideo
                labels={['damage', 'front', 'back', 'receipt', 'other']}
                upload={(file, mime) => repositories.services.upload('after_sales', file, mime)}
                discard={(u) => repositories.services.discardUpload(u)}
                resolveUrls={(list) => repositories.services.mediaUrls(list)}
              />
              {errors.media && (
                <p className={styles.fieldError} role="alert">
                  {errors.media}
                </p>
              )}
            </fieldset>
            <h2 className={styles.panelTitle}>{t('services.contactTitle')}</h2>
            <ContactFields
              value={form.contact}
              onChange={(contact) => update({ contact })}
              errors={errors}
            />
            <section className={styles.honest} aria-labelledby="policy-title">
              <div>
                <h3 id="policy-title" className={styles.cardTitle}>
                  {t('afterSales.policyTitle', {
                    type: t(AFTER_SALES_TYPE_LABEL[form.type] ?? 'afterSales.typeWarranty'),
                  })}
                </h3>
                <p>{resolveLocalized(policy.policies[form.type], locale)}</p>
                <p className={styles.muted}>
                  {t('afterSales.policyVersion', { version: policy.policyVersion })}
                  {policy.policyPath && (
                    <>
                      {' · '}
                      <LocaleLink to={policy.policyPath}>{t('afterSales.fullPolicy')}</LocaleLink>
                    </>
                  )}
                </p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.policyAccepted}
                    onChange={(e) => update({ policyAccepted: e.target.checked })}
                    aria-describedby={errors.policy ? 'err-policy' : undefined}
                  />
                  {t('afterSales.acknowledge')}
                </label>
                {errors.policy && (
                  <p id="err-policy" className={styles.fieldError} role="alert">
                    {errors.policy}
                  </p>
                )}
              </div>
            </section>
            {submitError && (
              <p className={styles.fieldError} role="alert">
                {submitError}
              </p>
            )}
            <div className={`${styles.actions} ${styles.actionsEnd}`}>
              <Button
                type="submit"
                variant="accent"
                loading={submit.isPending}
                icon={<Send aria-hidden="true" className="flip-rtl" />}
              >
                {t('afterSales.submit')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
