import { useMutation } from '@tanstack/react-query';
import { CircleCheck, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { TextField } from '@/components/ui/TextField';
import type { ProductDetail } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { normalizeEgyptianPhone } from '@/lib/phone';
import { useIsDemoMode, useRuntime } from '@/runtime/context';
import styles from './product.module.css';

export type RequestKind = 'notify' | 'waitlist';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Notify-me (sold-out variant) and waitlist (coming soon) intake. Phase 02 only records the
 * request (RPC with server-side validation + duplicate protection); staff follow-up and
 * account-linked tracking arrive in Phases 04/06.
 */
export function RequestDrawer({
  kind,
  open,
  onClose,
  product,
  variantSku,
  variantLabel,
}: {
  kind: RequestKind;
  open: boolean;
  onClose: () => void;
  product: ProductDetail;
  variantSku: string | null;
  variantLabel: string | null;
}) {
  const { t, locale } = useI18n();
  const { repositories } = useRuntime();
  const isDemo = useIsDemoMode();
  const titleId = useId();
  const productName = resolveLocalized(product.name, locale);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [storage, setStorage] = useState('');
  const [color, setColor] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'email', string>>>({});

  const mutation = useMutation({
    mutationFn: () => {
      const normalized = normalizeEgyptianPhone(phone) ?? phone;
      return kind === 'notify'
        ? repositories.requests.requestStockAlert({
            productSlug: product.slug,
            variantSku,
            name: name.trim(),
            phone: normalized,
            email: email.trim() || null,
            locale,
          })
        : repositories.requests.joinWaitlist({
            productSlug: product.slug,
            name: name.trim(),
            phone: normalized,
            email: email.trim() || null,
            desiredStorage: storage || null,
            desiredColor: color || null,
            locale,
          });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = t('requests.invalidName');
    if (!normalizeEgyptianPhone(phone)?.startsWith('+201')) next.phone = t('requests.invalidPhone');
    if (email.trim() && !EMAIL.test(email.trim())) next.email = t('requests.invalidEmail');
    setErrors(next);
    if (Object.keys(next).length === 0) mutation.mutate();
  };

  const storageOption = product.options.find((o) => o.key === 'storage');
  const colorOption = product.options.find((o) => o.key === 'color');
  const title =
    kind === 'notify'
      ? t('requests.notifyTitle')
      : t('requests.waitlistTitle', { product: productName });

  return (
    <Drawer open={open} onClose={onClose} labelledBy={titleId}>
      <div className={styles.requestHead}>
        <h2 id={titleId} className={styles.requestTitle}>
          {title}
        </h2>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className={styles.requestBody}>
        {mutation.isSuccess ? (
          <div className={styles.success} role="status">
            <CircleCheck aria-hidden="true" />
            <p className={styles.successTitle}>{t('requests.successTitle')}</p>
            <p>
              {mutation.data.status === 'duplicate'
                ? t('requests.duplicateBody')
                : t('requests.successBody')}
            </p>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <form className={styles.requestBody} onSubmit={submit} noValidate>
            <p className={styles.requestIntro}>
              {kind === 'notify'
                ? t('requests.notifyBody', { product: productName })
                : t('requests.waitlistBody', { product: productName })}
            </p>
            {kind === 'notify' && variantLabel && (
              <p className={styles.requestIntro}>
                <strong>{t('requests.selection', { variant: variantLabel })}</strong>
              </p>
            )}
            <TextField
              label={t('requests.name')}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              required
              maxLength={80}
            />
            <TextField
              label={t('requests.phone')}
              hint={t('requests.phoneHint')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={errors.phone}
              required
              maxLength={20}
            />
            <TextField
              label={t('requests.email')}
              type="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              maxLength={120}
            />
            {kind === 'waitlist' && storageOption && (
              <SelectField
                label={t('requests.desiredStorage')}
                value={storage}
                onChange={setStorage}
                options={storageOption.values.map((v) => ({
                  value: v.key,
                  label: resolveLocalized(v.label, locale),
                }))}
              />
            )}
            {kind === 'waitlist' && colorOption && (
              <SelectField
                label={t('requests.desiredColor')}
                value={color}
                onChange={setColor}
                options={colorOption.values.map((v) => ({
                  value: v.key,
                  label: resolveLocalized(v.label, locale),
                }))}
              />
            )}
            {mutation.isError && (
              <Alert tone="danger" live>
                {t('requests.error')}
              </Alert>
            )}
            {isDemo && <p className={styles.demoNote}>{t('requests.demoNote')}</p>}
            <Button type="submit" variant="primary" size="lg" block loading={mutation.isPending}>
              {mutation.isPending ? t('requests.submitting') : t('requests.submit')}
            </Button>
            <p className={styles.requestPrivacy}>{t('requests.privacy')}</p>
          </form>
        )}
      </div>
    </Drawer>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
