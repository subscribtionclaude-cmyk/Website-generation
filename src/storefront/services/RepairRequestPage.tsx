import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gamepad2,
  Headphones,
  Laptop,
  PackageSearch,
  Send,
  Smartphone,
  Store,
  Tablet,
  Truck,
  Watch,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/TextField';
import { resolveLocalized } from '@/domain/localized';
import { limitsFromSettings } from '@/domain/services/media';
import type { Handoff } from '@/domain/services/types';
import { cleanText, contactProblem, repairProblem } from '@/domain/services/validation';
import { useSession } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { track } from '@/lib/analytics/track';
import { useRuntime } from '@/runtime/context';
import { DiagnosticStep, type Diagnosis } from './diagnostic/DiagnosticStep';
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

const MODEL_ICON: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  watch: Watch,
  earbuds: Headphones,
  console: Gamepad2,
  none: PackageSearch,
};

interface RepairForm {
  step: number;
  category: string;
  brand: string;
  brandOther: string;
  model: string;
  diagnosis: Diagnosis;
  consultation: boolean;
  description: string;
  handoff: Handoff;
  contact: ContactValue;
  uploads: UploadItem[];
  idempotencyKey: string;
}

const empty = (category: string): RepairForm => ({
  step: 0,
  category,
  brand: '',
  brandOther: '',
  model: '',
  diagnosis: { component: null, symptom: null, unsure: false, viewer: 'none' },
  consultation: false,
  description: '',
  handoff: 'store_visit',
  contact: { name: '', phone: '', preferredContact: 'whatsapp' },
  uploads: [],
  idempotencyKey: crypto.randomUUID(),
});

const STEP_FIELDS: Record<string, number> = {
  category: 0,
  brand: 0,
  model: 0,
  component: 1,
  symptom: 1,
  description: 2,
  media: 2,
  name: 3,
  phone: 3,
};

export function RepairRequestPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const session = useSession();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const catalog = settings.repair_catalog.categories;
  const initialCategory = catalog.some((c) => c.key === params.get('device'))
    ? (params.get('device') ?? '')
    : '';
  const [form, setForm] = useState<RepairForm>(() => empty(initialCategory));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(form.step);
  usePageMeta({ title: t('repairs.requestTitle'), noIndex: true });

  const draft = useServiceDraft(
    'repair',
    { ...form, uploads: uploadsForDraft(form.uploads) },
    dirty && done === null,
  );

  // Prefill contact once from the profile.
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
    track('repair_started', { category: initialCategory || null });
  }, [initialCategory]);

  useEffect(() => {
    if (shownStep.current === form.step) return;
    shownStep.current = form.step;
    headingRef.current?.focus();
  }, [form.step]);

  const update = (changes: Partial<RepairForm>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...changes }));
  };

  const category = catalog.find((c) => c.key === form.category) ?? null;
  const brand = form.brand === 'Other' ? form.brandOther : form.brand;
  const steps = [
    t('repairs.stepDevice'),
    t('repairs.stepDiagnose'),
    t('repairs.stepDetails'),
    t('repairs.stepContact'),
  ];
  const media = settings.services.media;

  const input = () => ({
    idempotencyKey: form.idempotencyKey,
    contact: { name: form.contact.name, phone: form.contact.phone },
    preferredContact: form.contact.preferredContact,
    locale,
    device: { category: form.category, brand, model: form.model },
    diagnosis: {
      ...form.diagnosis,
      viewer: form.diagnosis.viewer,
    },
    consultation: form.consultation,
    description: form.description,
    handoff: form.handoff,
    media: uploadsToMedia(form.uploads),
  });

  const validateStep = (step: number): boolean => {
    const next: Record<string, string> = {};
    if (step === 0) {
      if (!category) next.category = t('repairs.errorCategory');
      if (!cleanText(brand, 60)) next.brand = t('services.errorBrand');
      if (!cleanText(form.model, 80)) next.model = t('services.errorModel');
    }
    if (step === 2) {
      const text = cleanText(form.description, 2000);
      if (!text || text.length < 10) next.description = t('services.errorDescription');
      if (form.uploads.some((u) => u.status === 'uploading' || u.status === 'processing'))
        next.media = t('media.waitUploads');
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
    mutationFn: () => repositories.services.create('repair', input()),
    onSuccess: (result) => {
      if (!result.ok) {
        const key = PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric';
        setSubmitError(t(key));
        const step = result.field ? STEP_FIELDS[result.field] : undefined;
        if (step !== undefined) {
          setErrors({ [result.field ?? 'form']: t(key) });
          setForm((f) => ({ ...f, step }));
        }
        return;
      }
      track('repair_submitted', {
        category: form.category,
        component: form.diagnosis.component,
        consultation: form.consultation || form.diagnosis.unsure,
      });
      draft.clear();
      setDone(result.request.number);
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
    onError: () => setSubmitError(t('services.errorNetwork')),
  });

  const next = (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (!validateStep(form.step)) return;
    if (form.step < 3) {
      setForm((f) => ({ ...f, step: f.step + 1 }));
      return;
    }
    const problem = repairProblem(input(), catalog);
    if (problem) {
      setSubmitError(t(PROBLEM_MESSAGE[problem.code] ?? 'services.errorGeneric'));
      const step = problem.field ? STEP_FIELDS[problem.field] : undefined;
      if (step !== undefined) setForm((f) => ({ ...f, step }));
      return;
    }
    submit.mutate();
  };

  if (done) {
    return (
      <div className={`container ${styles.page}`}>
        <section className={styles.success} aria-labelledby="repair-done">
          <h2 id="repair-done" tabIndex={-1} ref={(el) => el?.focus()}>
            {t('services.submittedTitle')}
          </h2>
          <p>{t('services.requestNumberLabel')}</p>
          <p className={styles.requestNumber}>{done}</p>
          <p>{t('repairs.submittedBody')}</p>
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

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.formShell}>
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>{t('repairs.requestTitle')}</h1>
          <p className={styles.lead}>{t('repairs.requestLead')}</p>
        </header>
        {draft.pending && (
          <DraftBar
            savedAt={draft.pending.savedAt}
            onRestore={() => {
              const data = draft.restore();
              if (data)
                setForm({ ...data, idempotencyKey: data.idempotencyKey || crypto.randomUUID() });
            }}
            onDiscard={draft.discard}
          />
        )}
        <StepProgress steps={steps} current={form.step} />

        <form className={styles.panel} onSubmit={next} noValidate>
          <h2 ref={headingRef} tabIndex={-1} className={styles.panelTitle}>
            {steps[form.step]}
          </h2>

          {form.step === 0 && (
            <div className={styles.fields}>
              <fieldset
                className={styles.fieldset}
                aria-describedby={errors.category ? 'err-category' : undefined}
              >
                <legend>{t('repairs.chooseDevice')}</legend>
                <div className={styles.choiceGrid}>
                  {catalog.map((c) => {
                    const Icon = MODEL_ICON[c.model] ?? PackageSearch;
                    return (
                      <label key={c.key} className={styles.choice}>
                        <input
                          type="radio"
                          name="device-category"
                          checked={form.category === c.key}
                          onChange={() =>
                            update({
                              category: c.key,
                              brand: '',
                              diagnosis: {
                                component: null,
                                symptom: null,
                                unsure: false,
                                viewer: 'none',
                              },
                            })
                          }
                        />
                        <span className={styles.choiceBody}>
                          <span className={styles.choiceIcon}>
                            <Icon aria-hidden="true" />
                            {resolveLocalized(c.label, locale)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.category && (
                  <p id="err-category" className={styles.fieldError} role="alert">
                    {errors.category}
                  </p>
                )}
              </fieldset>
              {category && (
                <fieldset
                  className={styles.fieldset}
                  aria-describedby={errors.brand ? 'err-brand' : undefined}
                >
                  <legend>{t('services.brand')}</legend>
                  <div className={styles.choiceGrid}>
                    {category.brands.map((b) => (
                      <label key={b} className={styles.choice}>
                        <input
                          type="radio"
                          name="device-brand"
                          checked={form.brand === b}
                          onChange={() => update({ brand: b })}
                        />
                        <span className={styles.choiceBody}>
                          {b === 'Other' ? t('services.otherBrand') : b}
                        </span>
                      </label>
                    ))}
                  </div>
                  {form.brand === 'Other' && (
                    <TextField
                      label={t('services.brandName')}
                      value={form.brandOther}
                      onChange={(e) => update({ brandOther: e.target.value })}
                      maxLength={60}
                    />
                  )}
                  {errors.brand && (
                    <p id="err-brand" className={styles.fieldError} role="alert">
                      {errors.brand}
                    </p>
                  )}
                </fieldset>
              )}
              {category && (
                <TextField
                  label={t('services.model')}
                  hint={t('services.modelHint')}
                  value={form.model}
                  onChange={(e) => update({ model: e.target.value })}
                  error={errors.model}
                  maxLength={80}
                  autoComplete="off"
                />
              )}
            </div>
          )}

          {form.step === 1 && category && (
            <>
              {category.components.length > 0 ? (
                <DiagnosticStep
                  category={category}
                  value={form.diagnosis}
                  onChange={(diagnosis) => update({ diagnosis, consultation: false })}
                  onConsultation={() => {
                    update({
                      diagnosis: {
                        component: null,
                        symptom: null,
                        unsure: true,
                        viewer: form.diagnosis.viewer,
                      },
                      consultation: true,
                      step: 2,
                    });
                  }}
                />
              ) : (
                <HonestNote>{t('repairs.consultationOnly')}</HonestNote>
              )}
              {form.consultation && (
                <p className={styles.hint}>{t('repairs.consultationChosen')}</p>
              )}
            </>
          )}

          {form.step === 2 && (
            <div className={styles.fields}>
              <TextAreaField
                label={t('repairs.describe')}
                hint={t('repairs.describeHint')}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                error={errors.description}
                rows={5}
                maxLength={2000}
              />
              <fieldset className={styles.fieldset}>
                <legend>{t('repairs.mediaTitle')}</legend>
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
                  labels={['damage', 'front', 'back', 'screen_on', 'other']}
                  disabled={!session}
                  upload={(file, mime) => repositories.services.upload('repair', file, mime)}
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

          {form.step === 3 && (
            <div className={styles.fields}>
              {!session && <SignInNotice />}
              <ContactFields
                value={form.contact}
                onChange={(contact) => update({ contact })}
                errors={errors}
              />
              <fieldset className={styles.fieldset}>
                <legend>{t('repairs.handoff')}</legend>
                <div className={`${styles.choiceGrid} ${styles.choiceGridWide}`}>
                  {(['store_visit', 'pickup_delivery'] as const).map((h) => (
                    <label key={h} className={styles.choice}>
                      <input
                        type="radio"
                        name="handoff"
                        checked={form.handoff === h}
                        onChange={() => update({ handoff: h })}
                      />
                      <span className={styles.choiceBody}>
                        <span className={styles.choiceIcon}>
                          {h === 'store_visit' ? (
                            <Store aria-hidden="true" />
                          ) : (
                            <Truck aria-hidden="true" />
                          )}
                          {h === 'store_visit'
                            ? t('repairs.handoffStore')
                            : t('repairs.handoffPickup')}
                        </span>
                        <small>
                          {h === 'store_visit'
                            ? t('repairs.handoffStoreHint')
                            : t('repairs.handoffPickupHint')}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <dl className={styles.summary}>
                <div>
                  <dt>{t('services.device')}</dt>
                  <dd>
                    {category ? resolveLocalized(category.label, locale) : ''} · {brand}{' '}
                    {form.model}
                  </dd>
                </div>
                <div>
                  <dt>{t('repairs.issue')}</dt>
                  <dd>
                    {form.diagnosis.component && category
                      ? [
                          resolveLocalized(
                            category.components.find((c) => c.key === form.diagnosis.component)
                              ?.label ?? { ar: '' },
                            locale,
                          ),
                          form.diagnosis.symptom
                            ? resolveLocalized(
                                category.components
                                  .find((c) => c.key === form.diagnosis.component)
                                  ?.symptoms.find((s) => s.key === form.diagnosis.symptom)
                                  ?.label ?? { ar: '' },
                                locale,
                              )
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')
                      : t('repairs.consultation')}
                  </dd>
                </div>
                <div>
                  <dt>{t('repairs.mediaTitle')}</dt>
                  <dd>
                    {t('services.filesCount', { count: uploadsToMedia(form.uploads).length })}
                  </dd>
                </div>
              </dl>
              <HonestNote>{t('repairs.noAutoPrice')}</HonestNote>
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
                {t('repairs.submit')}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
