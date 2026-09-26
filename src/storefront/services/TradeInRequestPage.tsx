import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageSearch, Search, Send } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/TextField';
import type { ProductDetail } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { limitsFromSettings } from '@/domain/services/media';
import {
  PHOTO_LABELS,
  TRADE_IN_ACCESSORIES,
  TRADE_IN_CONDITIONS,
  type ManualTarget,
  type TradeInCondition,
  type TradeInCurrentDevice,
  type TradeInInput,
  type TriState,
} from '@/domain/services/types';
import { cleanText, contactProblem, tradeInProblem } from '@/domain/services/validation';
import { useSession } from '@/features/auth/context';
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
import { PROBLEM_MESSAGE } from './serviceLabels';
import {
  ContactFields,
  DraftBar,
  HonestNote,
  SignInNotice,
  StepProgress,
  type ContactValue,
} from './ServiceParts';
import { useServiceDraft } from './useServiceDraft';
import styles from './services.module.css';

const STORAGE_OPTIONS = ['64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];

interface TradeInForm {
  step: number;
  current: TradeInCurrentDevice;
  batteryUnknown: boolean;
  target: {
    variantId: string | null;
    productSlug: string | null;
    manual: boolean;
    manualTarget: ManualTarget;
  };
  contact: ContactValue;
  uploads: UploadItem[];
  idempotencyKey: string;
}

const emptyForm = (): TradeInForm => ({
  step: 0,
  current: {
    category: 'smartphone',
    brand: '',
    model: '',
    storage: null,
    color: null,
    batteryHealth: null,
    taxPaid: 'unknown',
    openedBefore: 'unknown',
    repairedBefore: 'unknown',
    accessories: [],
    conditions: [],
    notes: null,
  },
  batteryUnknown: false,
  target: {
    variantId: null,
    productSlug: null,
    manual: false,
    manualTarget: { brand: '', model: '', storage: null, color: null },
  },
  contact: { name: '', phone: '', preferredContact: 'whatsapp' },
  uploads: [],
  idempotencyKey: crypto.randomUUID(),
});

const STEP_FIELDS: Record<string, number> = {
  category: 0,
  brand: 0,
  model: 0,
  batteryHealth: 0,
  current: 0,
  conditions: 1,
  accessories: 1,
  media: 1,
  target: 2,
  name: 3,
  phone: 3,
};

function TriStateField({
  legend,
  value,
  onChange,
  name,
}: {
  legend: string;
  value: TriState;
  onChange: (v: TriState) => void;
  name: string;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.choiceGrid}>
        {(['yes', 'no', 'unknown'] as const).map((v) => (
          <label key={v} className={styles.choice}>
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            <span className={styles.choiceBody}>{t(`services.tri_${v}` as CoreMessageKey)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TradeInRequestPage() {
  const { t, locale, format } = useI18n();
  const settings = useSettings();
  const session = useSession();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  // "Trade in for this" on a product page pre-selects that product (the variant is still chosen here).
  const [form, setForm] = useState<TradeInForm>(() => {
    const initial = emptyForm();
    const slug = params.get('product');
    return slug && /^[a-z0-9-]{1,120}$/.test(slug)
      ? { ...initial, target: { ...initial.target, productSlug: slug } }
      : initial;
  });
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(form.step);
  usePageMeta({ title: t('tradeIn.requestTitle'), noIndex: true });
  const draft = useServiceDraft(
    'trade-in',
    { ...form, uploads: uploadsForDraft(form.uploads) },
    dirty && !done,
  );
  const media = settings.services.media;

  const profile = useProfileContact();
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && profile.data) {
    setPrefilled(true);
    setForm((f) => ({
      ...f,
      contact: {
        ...f.contact,
        name: f.contact.name || profile.data?.fullName || '',
        phone: f.contact.phone || profile.data?.phone || '',
      },
    }));
  }

  useEffect(() => {
    track('trade_in_started');
  }, []);
  useEffect(() => {
    if (shownStep.current === form.step) return;
    shownStep.current = form.step;
    headingRef.current?.focus();
  }, [form.step]);

  const update = (changes: Partial<TradeInForm>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...changes }));
  };
  const setCurrent = (changes: Partial<TradeInCurrentDevice>) =>
    update({ current: { ...form.current, ...changes } });

  const toggleCondition = (c: TradeInCondition, on: boolean) => {
    let next = form.current.conditions.filter((x) => x !== c);
    if (on) next = c === 'none' ? ['none'] : [...next.filter((x) => x !== 'none'), c];
    setCurrent({ conditions: next });
  };

  const input = (): TradeInInput => ({
    idempotencyKey: form.idempotencyKey,
    contact: { name: form.contact.name, phone: form.contact.phone },
    preferredContact: form.contact.preferredContact,
    locale,
    current: {
      ...form.current,
      batteryHealth: form.batteryUnknown ? null : form.current.batteryHealth,
    },
    target: form.target.manual
      ? { manual: form.target.manualTarget }
      : { variantId: form.target.variantId ?? '' },
    media: uploadsToMedia(form.uploads),
  });

  const validateStep = (step: number) => {
    const next: Record<string, string> = {};
    const c = form.current;
    if (step === 0) {
      if (!cleanText(c.brand, 60)) next.brand = t('services.errorBrand');
      if (!cleanText(c.model, 80)) next.model = t('services.errorModel');
      if (
        !form.batteryUnknown &&
        c.batteryHealth !== null &&
        (c.batteryHealth < 1 || c.batteryHealth > 100)
      )
        next.batteryHealth = t('services.errorBattery');
    }
    if (step === 1) {
      if (c.conditions.length === 0) next.conditions = t('services.errorCondition');
      if (form.uploads.some((u) => u.status === 'uploading' || u.status === 'processing'))
        next.media = t('media.waitUploads');
    }
    if (step === 2) {
      const tgt = form.target;
      if (
        tgt.manual
          ? !cleanText(tgt.manualTarget.brand, 60) || !cleanText(tgt.manualTarget.model, 80)
          : !tgt.variantId
      )
        next.target = t('services.errorTarget');
    }
    if (step === 3) {
      const problem = contactProblem(form.contact);
      if (problem?.field === 'name') next.name = t('services.errorName');
      if (problem?.field === 'phone') next.phone = t('services.errorPhone');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = useMutation({
    mutationFn: () => repositories.services.create('trade_in', input()),
    onSuccess: (result) => {
      if (!result.ok) {
        const key = PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric';
        setSubmitError(t(key));
        const step = result.field ? STEP_FIELDS[result.field] : undefined;
        if (step !== undefined) setForm((f) => ({ ...f, step }));
        return;
      }
      track('trade_in_submitted', { targetFromCatalog: !form.target.manual });
      draft.clear();
      setDone(result.request.number);
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
    onError: () => setSubmitError(t('services.errorNetwork')),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (!validateStep(form.step)) return;
    if (form.step < 3) {
      setForm((f) => ({ ...f, step: f.step + 1 }));
      return;
    }
    const problem = tradeInProblem(input());
    if (problem) {
      setSubmitError(t(PROBLEM_MESSAGE[problem.code] ?? 'services.errorGeneric'));
      const step = problem.field ? STEP_FIELDS[problem.field] : undefined;
      if (step !== undefined) setForm((f) => ({ ...f, step }));
      return;
    }
    submit.mutate();
  };

  const steps = [
    t('tradeIn.stepDevice'),
    t('tradeIn.stepCondition'),
    t('tradeIn.stepTarget'),
    t('tradeIn.stepContact'),
  ];

  if (done) {
    return (
      <div className={`container ${styles.page}`}>
        <section className={styles.success} aria-labelledby="trade-done">
          <h2 id="trade-done" tabIndex={-1} ref={(el) => el?.focus()}>
            {t('services.submittedTitle')}
          </h2>
          <p>{t('services.requestNumberLabel')}</p>
          <p className={styles.requestNumber}>{done}</p>
          <p>{t('tradeIn.submittedBody')}</p>
          <div className={styles.heroActions}>
            <ButtonLink to={`/account/requests/${done}`} variant="accent">
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

  const c = form.current;
  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.formShell}>
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>{t('tradeIn.requestTitle')}</h1>
          <p className={styles.lead}>{t('tradeIn.requestLead')}</p>
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
        <StepProgress steps={steps} current={form.step} />
        <form className={styles.panel} onSubmit={onSubmit} noValidate>
          <h2 ref={headingRef} tabIndex={-1} className={styles.panelTitle}>
            {steps[form.step]}
          </h2>

          {form.step === 0 && (
            <div className={styles.fields}>
              <fieldset className={styles.fieldset}>
                <legend>{t('tradeIn.deviceType')}</legend>
                <div className={styles.choiceGrid}>
                  {settings.repair_catalog.categories
                    .filter((cat) => cat.key !== 'other')
                    .map((cat) => (
                      <label key={cat.key} className={styles.choice}>
                        <input
                          type="radio"
                          name="trade-category"
                          checked={c.category === cat.key}
                          onChange={() => setCurrent({ category: cat.key })}
                        />
                        <span className={styles.choiceBody}>
                          {resolveLocalized(cat.label, locale)}
                        </span>
                      </label>
                    ))}
                </div>
              </fieldset>
              <div className={`${styles.fields} ${styles.fields2}`}>
                <TextField
                  label={t('services.brand')}
                  value={c.brand}
                  onChange={(e) => setCurrent({ brand: e.target.value })}
                  error={errors.brand}
                  maxLength={60}
                />
                <TextField
                  label={t('services.model')}
                  hint={t('services.modelHint')}
                  value={c.model}
                  onChange={(e) => setCurrent({ model: e.target.value })}
                  error={errors.model}
                  maxLength={80}
                />
                <div>
                  <label className={styles.fieldLabel} htmlFor="ti-storage">
                    {t('services.storage')}
                  </label>
                  <select
                    id="ti-storage"
                    className={styles.select}
                    value={c.storage ?? ''}
                    onChange={(e) => setCurrent({ storage: e.target.value || null })}
                  >
                    <option value="">{t('services.notSpecified')}</option>
                    {STORAGE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  label={t('services.color')}
                  value={c.color ?? ''}
                  onChange={(e) => setCurrent({ color: e.target.value || null })}
                  maxLength={30}
                />
                <TextField
                  label={t('tradeIn.batteryHealth')}
                  hint={t('tradeIn.batteryHint')}
                  inputMode="numeric"
                  dir="ltr"
                  value={c.batteryHealth === null ? '' : String(c.batteryHealth)}
                  disabled={form.batteryUnknown}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                    setCurrent({ batteryHealth: Number.isNaN(n) ? null : n });
                  }}
                  error={errors.batteryHealth}
                />
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.batteryUnknown}
                    onChange={(e) => update({ batteryUnknown: e.target.checked })}
                  />
                  {t('tradeIn.batteryUnknown')}
                </label>
              </div>
              <TriStateField
                legend={t('tradeIn.taxPaid')}
                name="tax-paid"
                value={c.taxPaid}
                onChange={(v) => setCurrent({ taxPaid: v })}
              />
              <div className={`${styles.fields} ${styles.fields2}`}>
                <TriStateField
                  legend={t('tradeIn.openedBefore')}
                  name="opened"
                  value={c.openedBefore}
                  onChange={(v) => setCurrent({ openedBefore: v })}
                />
                <TriStateField
                  legend={t('tradeIn.repairedBefore')}
                  name="repaired"
                  value={c.repairedBefore}
                  onChange={(v) => setCurrent({ repairedBefore: v })}
                />
              </div>
            </div>
          )}

          {form.step === 1 && (
            <div className={styles.fields}>
              <fieldset
                className={styles.fieldset}
                aria-describedby={errors.conditions ? 'err-cond' : 'hint-cond'}
              >
                <legend>{t('tradeIn.conditionTitle')}</legend>
                <p id="hint-cond" className={styles.hint}>
                  {t('tradeIn.conditionHint')}
                </p>
                <div className={styles.checkGrid}>
                  {TRADE_IN_CONDITIONS.map((cond) => (
                    <label key={cond} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={c.conditions.includes(cond)}
                        onChange={(e) => toggleCondition(cond, e.target.checked)}
                      />
                      {t(`tradeIn.cond_${cond}` as CoreMessageKey)}
                    </label>
                  ))}
                </div>
                {errors.conditions && (
                  <p id="err-cond" className={styles.fieldError} role="alert">
                    {errors.conditions}
                  </p>
                )}
              </fieldset>
              <fieldset className={styles.fieldset}>
                <legend>{t('tradeIn.accessoriesTitle')}</legend>
                <div className={styles.checkGrid}>
                  {TRADE_IN_ACCESSORIES.map((a) => (
                    <label key={a} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={c.accessories.includes(a)}
                        onChange={(e) =>
                          setCurrent({
                            accessories: e.target.checked
                              ? [...c.accessories, a]
                              : c.accessories.filter((x) => x !== a),
                          })
                        }
                      />
                      {t(`tradeIn.acc_${a}` as CoreMessageKey)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <TextAreaField
                label={t('tradeIn.notes')}
                value={c.notes ?? ''}
                onChange={(e) => setCurrent({ notes: e.target.value || null })}
                rows={3}
                maxLength={2000}
              />
              <fieldset className={styles.fieldset}>
                <legend>{t('tradeIn.photosTitle')}</legend>
                <p className={styles.hint}>{t('tradeIn.photosHint')}</p>
                {!session && <SignInNotice />}
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
                  labels={PHOTO_LABELS}
                  disabled={!session}
                  upload={(file, mime) => repositories.services.upload('trade_in', file, mime)}
                  discard={(u) => repositories.services.discardUpload(u)}
                  resolveUrls={(items) => repositories.services.mediaUrls(items)}
                />
                {errors.media && (
                  <p className={styles.fieldError} role="alert">
                    {errors.media}
                  </p>
                )}
              </fieldset>
            </div>
          )}

          {form.step === 2 && (
            <div className={styles.fields}>
              {!form.target.manual ? (
                <TargetPicker
                  variantId={form.target.variantId}
                  productSlug={form.target.productSlug}
                  onChange={(productSlug, variantId) =>
                    update({ target: { ...form.target, productSlug, variantId } })
                  }
                />
              ) : (
                <div className={`${styles.fields} ${styles.fields2}`}>
                  {(['brand', 'model', 'storage', 'color'] as const).map((k) => (
                    <TextField
                      key={k}
                      label={t(`services.${k}` as CoreMessageKey)}
                      value={form.target.manualTarget[k] ?? ''}
                      onChange={(e) =>
                        update({
                          target: {
                            ...form.target,
                            manualTarget: {
                              ...form.target.manualTarget,
                              [k]:
                                k === 'brand' || k === 'model'
                                  ? e.target.value
                                  : e.target.value || null,
                            },
                          },
                        })
                      }
                      maxLength={k === 'model' ? 80 : 60}
                    />
                  ))}
                </div>
              )}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => update({ target: { ...form.target, manual: !form.target.manual } })}
              >
                {form.target.manual ? t('tradeIn.pickFromCatalog') : t('tradeIn.cantFind')}
              </button>
              {errors.target && (
                <p className={styles.fieldError} role="alert">
                  {errors.target}
                </p>
              )}
              <HonestNote>{t('tradeIn.valuationNote')}</HonestNote>
            </div>
          )}

          {form.step === 3 && (
            <div className={styles.fields}>
              {!session && <SignInNotice />}
              <ContactFields
                value={form.contact}
                onChange={(contact) => update({ contact })}
                errors={errors}
              />
              <dl className={styles.summary}>
                <div>
                  <dt>{t('tradeIn.currentDevice')}</dt>
                  <dd>
                    {c.brand} {c.model} {c.storage ?? ''}
                  </dd>
                </div>
                <div>
                  <dt>{t('tradeIn.batteryHealth')}</dt>
                  <dd>
                    {form.batteryUnknown || c.batteryHealth === null
                      ? t('services.notSpecified')
                      : `${format.number(c.batteryHealth)}%`}
                  </dd>
                </div>
                <div>
                  <dt>{t('tradeIn.targetDevice')}</dt>
                  <dd>
                    {form.target.manual
                      ? `${form.target.manualTarget.brand} ${form.target.manualTarget.model}`
                      : t('tradeIn.targetFromCatalog')}
                  </dd>
                </div>
                <div>
                  <dt>{t('tradeIn.photosTitle')}</dt>
                  <dd>
                    {t('services.filesCount', { count: uploadsToMedia(form.uploads).length })}
                  </dd>
                </div>
              </dl>
              <HonestNote>{t('tradeIn.valuationNote')}</HonestNote>
            </div>
          )}

          {submitError && (
            <p className={styles.fieldError} role="alert">
              {submitError}
            </p>
          )}
          <div className={styles.actions}>
            {form.step > 0 ? (
              <Button variant="ghost" onClick={() => setForm((f) => ({ ...f, step: f.step - 1 }))}>
                {t('services.back')}
              </Button>
            ) : (
              <span />
            )}
            {form.step < 3 ? (
              <Button type="submit" variant="primary">
                {t('services.continue')}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="accent"
                loading={submit.isPending}
                disabled={!session}
                icon={<Send aria-hidden="true" className="flip-rtl" />}
              >
                {t('tradeIn.submit')}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Pick the exact new device variant from the live catalog (authoritative price shown). */
function TargetPicker({
  variantId,
  productSlug,
  onChange,
}: {
  variantId: string | null;
  productSlug: string | null;
  onChange: (productSlug: string | null, variantId: string | null) => void;
}) {
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const results = useQuery({
    queryKey: ['public', 'trade-in-targets', deferred],
    queryFn: () =>
      repositories.catalog.search({
        q: deferred || undefined,
        categories: deferred ? undefined : ['phones'],
        pageSize: 6,
      }),
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: ['public', 'product', productSlug],
    queryFn: () => repositories.catalog.getProduct(productSlug ?? ''),
    enabled: Boolean(productSlug),
  });
  const product: ProductDetail | null | undefined = detail.data;
  const selected = product?.variants.find((v) => v.id === variantId) ?? null;

  const pickOption = (optionKey: string, valueKey: string) => {
    if (!product) return;
    const wanted = { ...(selected?.options ?? {}), [optionKey]: valueKey };
    const match =
      product.variants.find((v) =>
        Object.entries(wanted).every(([k, val]) => v.options[k] === val),
      ) ??
      product.variants.find((v) => v.options[optionKey] === valueKey) ??
      null;
    onChange(product.slug, match?.id ?? null);
  };

  return (
    <div className={styles.fields}>
      <TextField
        label={t('tradeIn.searchTarget')}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      <ul
        className={styles.searchResults}
        aria-label={t('tradeIn.results')}
        aria-busy={results.isFetching}
      >
        {(results.data?.items ?? []).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={styles.searchResult}
              aria-pressed={productSlug === p.slug}
              onClick={() => {
                const target = p.slug;
                onChange(target, null);
              }}
            >
              {p.image ? <img src={p.image.url} alt="" /> : <PackageSearch aria-hidden="true" />}
              <span>
                <strong>{resolveLocalized(p.name, locale)}</strong>
                <br />
                <small className={styles.muted}>
                  {p.price.min !== null
                    ? t('tradeIn.fromPrice', { price: format.money(p.price.min) })
                    : t('tradeIn.priceTba')}
                </small>
              </span>
            </button>
          </li>
        ))}
        {results.data && results.data.items.length === 0 && (
          <li className={styles.muted}>
            <Search aria-hidden="true" width={16} /> {t('tradeIn.noResults')}
          </li>
        )}
      </ul>
      {product && (
        <div className={styles.fields}>
          {product.options.map((option) => (
            <fieldset key={option.key} className={styles.fieldset}>
              <legend>{resolveLocalized(option.name, locale)}</legend>
              <div className={styles.choiceGrid}>
                {option.values.map((value) => {
                  const available = product.variants.some(
                    (v) => v.options[option.key] === value.key,
                  );
                  return (
                    <label key={value.key} className={styles.choice}>
                      <input
                        type="radio"
                        name={`target-${option.key}`}
                        checked={selected?.options[option.key] === value.key}
                        disabled={!available}
                        onChange={() => pickOption(option.key, value.key)}
                      />
                      <span className={styles.choiceBody}>
                        {resolveLocalized(value.label, locale)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {selected && (
            <div className={styles.targetCard} role="status">
              {product.image ? <img src={product.image.url} alt="" /> : <span />}
              <div>
                <p>
                  <strong>{resolveLocalized(product.name, locale)}</strong>
                </p>
                <p className={styles.muted}>
                  {product.options
                    .map((o) => {
                      const v = o.values.find((x) => x.key === selected.options[o.key]);
                      return v ? resolveLocalized(v.label, locale) : null;
                    })
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className={styles.money}>
                  {selected.price !== null
                    ? t('tradeIn.currentPrice', { price: format.money(selected.price) })
                    : t('tradeIn.priceTba')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
