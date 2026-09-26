import { CircleCheck, History, Info, LogIn, MessageCircle, Phone } from 'lucide-react';
import { createElement, useId, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { TextField } from '@/components/ui/TextField';
import { progressIndex, PROGRESS_PATH } from '@/domain/services/status';
import type { PreferredContact, ServiceKind } from '@/domain/services/types';
import { useI18n } from '@/i18n/context';
import { statusIcon, statusLabelKey, statusTone } from './serviceLabels';
import styles from './services.module.css';

export interface ContactValue {
  name: string;
  phone: string;
  preferredContact: PreferredContact;
}

/** Contact details (prefilled from the profile) + preferred follow-up channel. */
export function ContactFields({
  value,
  onChange,
  errors,
}: {
  value: ContactValue;
  onChange: (next: ContactValue) => void;
  errors: Partial<Record<'name' | 'phone', string>>;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.fields}>
      <div className={`${styles.fields} ${styles.fields2}`}>
        <TextField
          label={t('checkout.name')}
          autoComplete="name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          error={errors.name}
          maxLength={120}
          required
        />
        <TextField
          label={t('checkout.phone')}
          hint={t('services.phoneHint')}
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
          error={errors.phone}
          required
        />
      </div>
      <fieldset className={styles.fieldset}>
        <legend>{t('services.preferredContact')}</legend>
        <div className={`${styles.choiceGrid} ${styles.choiceGridWide}`}>
          {(['whatsapp', 'phone'] as const).map((option) => (
            <label key={option} className={styles.choice}>
              <input
                type="radio"
                name="preferred-contact"
                checked={value.preferredContact === option}
                onChange={() => onChange({ ...value, preferredContact: option })}
              />
              <span className={styles.choiceBody}>
                <span className={styles.choiceIcon}>
                  {option === 'whatsapp' ? (
                    <MessageCircle aria-hidden="true" />
                  ) : (
                    <Phone aria-hidden="true" />
                  )}
                  {option === 'whatsapp'
                    ? t('services.contactWhatsApp')
                    : t('services.contactPhone')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Service requests need an account (private media, tracking). Drafts survive the sign-in. */
export function SignInNotice() {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const next = encodeURIComponent(pathname + search);
  return (
    <div className={styles.note}>
      <Info aria-hidden="true" />
      <div>
        <p>{t('services.signInNeeded')}</p>
        <ButtonLink
          to={`/account/sign-in?next=${next}`}
          variant="primary"
          size="sm"
          icon={<LogIn aria-hidden="true" />}
        >
          {t('services.signInToContinue')}
        </ButtonLink>
      </div>
    </div>
  );
}

export function DraftBar({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t, format } = useI18n();
  return (
    <div className={styles.draftBar} role="region" aria-label={t('services.draftTitle')}>
      <p>
        <History aria-hidden="true" />{' '}
        {t('services.draftFound', { date: format.dateTime(savedAt) })}
      </p>
      <div className={styles.heroActions}>
        <button type="button" className={styles.linkButton} onClick={onRestore}>
          {t('services.draftRestore')}
        </button>
        <button type="button" className={styles.linkButton} onClick={onDiscard}>
          {t('services.draftDiscard')}
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status, awaiting = false }: { status: string; awaiting?: boolean }) {
  const { t } = useI18n();
  const tone = statusTone(status, awaiting);
  const toneClass = {
    active: styles.pillActive,
    action: styles.pillAction,
    good: styles.pillGood,
    closed: styles.pillClosed,
  }[tone];
  return (
    <span className={`${styles.pill} ${toneClass}`}>
      {createElement(statusIcon(status, awaiting), { 'aria-hidden': true })}
      {awaiting ? t('serviceStatus.awaiting_customer') : t(statusLabelKey(status))}
    </span>
  );
}

/** Compact progress along the request type's main path (text alternative included). */
export function ProgressTrack({ kind, status }: { kind: ServiceKind; status: string }) {
  const { t } = useI18n();
  const path = PROGRESS_PATH[kind];
  const index = progressIndex(kind, status);
  if (index < 0) return null;
  return (
    <div>
      <ol className={styles.track} aria-hidden="true">
        {path.map((step, i) => (
          <li key={step} className={i <= index ? styles.trackDone : undefined} />
        ))}
      </ol>
      <p className="visually-hidden">
        {t('services.progressText', { step: index + 1, total: path.length })}
      </p>
    </div>
  );
}

export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  const { t } = useI18n();
  const labelId = useId();
  return (
    <nav aria-labelledby={labelId}>
      <span id={labelId} className="visually-hidden">
        {t('services.stepsLabel')}
      </span>
      <ol className={styles.progress}>
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === current ? 'step' : undefined}
            className={index < current ? styles.progressDone : undefined}
          >
            <span className={styles.progressNumber}>
              {index < current ? <CircleCheck aria-hidden="true" width={14} /> : index + 1}
            </span>
            <span className={styles.progressLabel}>{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function HonestNote({ children }: { children: ReactNode }) {
  return (
    <div className={styles.honest}>
      <Info aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
