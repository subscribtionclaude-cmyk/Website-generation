import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';
import type { LocalizedDraft } from './hooks';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function describedBy(id: string, hint?: ReactNode, error?: string | null) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
}

function FieldMessages({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  return (
    <>
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </>
  );
}

export function InputField({
  label,
  hint,
  error,
  className,
  ltr,
  ...props
}: FieldShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { ltr?: boolean }) {
  const id = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={[styles.control, ltr && styles.ltrInput].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        dir={ltr ? 'ltr' : undefined}
        {...props}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  className,
  value,
  onChange,
  rows = 4,
  maxLength,
  required,
  dir,
}: FieldShellProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  dir?: 'ltr' | 'rtl';
}) {
  const id = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={styles.control}
        rows={rows}
        value={value}
        maxLength={maxLength}
        required={required}
        dir={dir}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  options,
  ...props
}: FieldShellProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
    options: { value: string; label: string }[];
  }) {
  const id = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.control}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.check} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** Arabic (required base language) + English inputs for one bilingual field. */
export function LocalizedField({
  legend,
  value,
  onChange,
  multiline,
  required,
  error,
  hint,
  className,
  rows = 4,
  maxLength,
}: {
  legend: string;
  value: LocalizedDraft;
  onChange: (value: LocalizedDraft) => void;
  multiline?: boolean;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  className?: string;
  rows?: number;
  maxLength?: number;
}) {
  const { at } = useAdminI18n();
  const id = useId();
  const input = (lang: 'ar' | 'en') => {
    const inputId = `${id}-${lang}`;
    const label = (
      <>
        {legend}{' '}
        <span className={styles.langTag}>
          ({lang === 'ar' ? at('ui.arabic') : at('ui.english')})
        </span>
      </>
    );
    const common = {
      id: inputId,
      className: styles.control,
      lang,
      dir: lang === 'ar' ? ('rtl' as const) : ('ltr' as const),
      value: value[lang],
      maxLength,
      required: lang === 'ar' && required,
      'aria-invalid': lang === 'ar' && error ? true : undefined,
      'aria-describedby': lang === 'ar' && error ? `${id}-error` : undefined,
    };
    return (
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
        {multiline ? (
          <textarea
            {...common}
            rows={rows}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
          />
        ) : (
          <input {...common} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
        )}
      </div>
    );
  };
  return (
    <fieldset className={[styles.localized, className].filter(Boolean).join(' ')}>
      <legend>
        {legend}
        {required ? ` · ${at('ui.required')}` : ''}
      </legend>
      {input('ar')}
      {input('en')}
      {hint && <span className={`${styles.hint} ${styles.full}`}>{hint}</span>}
      {error && (
        <span id={`${id}-error`} className={`${styles.error} ${styles.full}`} role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}
