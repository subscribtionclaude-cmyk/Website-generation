import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { toLatinDigits } from '@/lib/phone';
import { useRuntime } from '@/runtime/context';
import { AuthError, EMAIL_PATTERN, OTP_PATTERN, type AuthSession } from '@/services/auth/types';
import { useAuth } from './context';
import styles from './SignInForm.module.css';

const RESEND_COOLDOWN_SECONDS = 60;

const ERROR_KEYS: Record<AuthError['code'], CoreMessageKey> = {
  invalid_email: 'auth.errors.invalidEmail',
  invalid_code: 'auth.errors.invalidCode',
  rate_limited: 'auth.errors.rateLimited',
  network: 'auth.errors.network',
  unknown: 'auth.errors.generic',
};

interface SignInFormProps {
  /** Locale-aware path the emailed magic link should return to (e.g. "/en/account"). */
  returnPath: string;
  onSignedIn: (session: AuthSession) => void;
  headingLevel?: 1 | 2;
}

/**
 * Passwordless sign-in (free-first): Supabase emails a 6-digit code + magic link.
 * Phone number stays required later for checkout/contact; paid SMS OTP is an optional integration.
 */
export function SignInForm({ returnPath, onSignedIn, headingLevel = 1 }: SignInFormProps) {
  const { t, locale } = useI18n();
  const { service } = useAuth();
  const { mode, config } = useRuntime();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const describeError = (error: unknown) =>
    t(error instanceof AuthError ? ERROR_KEYS[error.code] : 'auth.errors.generic');

  async function sendCode() {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setFieldError(t('auth.errors.invalidEmail'));
      return;
    }
    setPending(true);
    setFieldError(null);
    setFormError(null);
    try {
      const origin = config.siteUrl ?? window.location.origin;
      await service.requestEmailCode(normalized, { redirectTo: `${origin}${returnPath}`, locale });
      setEmail(normalized);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setPending(false);
    }
  }

  async function verify() {
    const normalized = toLatinDigits(code).replace(/\s/g, '');
    if (!OTP_PATTERN.test(normalized)) {
      setFieldError(t('auth.errors.codeFormat'));
      return;
    }
    setPending(true);
    setFieldError(null);
    setFormError(null);
    try {
      onSignedIn(await service.verifyEmailCode(email, normalized));
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return; // duplicate-submission guard
    void (step === 'email' ? sendCode() : verify());
  }

  const Heading = `h${headingLevel}` as const;

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.heading}>
        <Heading className={styles.title}>
          {step === 'email' ? t('auth.signInTitle') : t('auth.codeSentTitle')}
        </Heading>
        <p className={styles.subtitle}>
          {step === 'email'
            ? t('auth.signInSubtitle')
            : t('auth.codeSentBody', { email: isolate(email) })}
        </p>
      </div>

      {mode === 'demo' && <Alert tone="info">{t('auth.demoHint')}</Alert>}
      {formError && (
        <Alert tone="danger" live>
          {formError}
        </Alert>
      )}

      {step === 'email' ? (
        <TextField
          className={styles.email}
          label={t('auth.emailLabel')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
          required
        />
      ) : (
        <TextField
          className={styles.code}
          label={t('auth.codeLabel')}
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={fieldError}
          required
        />
      )}

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        {step === 'email'
          ? pending
            ? t('auth.sending')
            : t('auth.sendCode')
          : pending
            ? t('auth.verifying')
            : t('auth.verify')}
      </Button>

      {step === 'code' && (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setStep('email');
              setCode('');
              setFieldError(null);
              setFormError(null);
            }}
          >
            {t('auth.changeEmail')}
          </button>
          <button
            type="button"
            className={styles.textButton}
            disabled={cooldown > 0 || pending}
            onClick={() => void sendCode()}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          </button>
        </div>
      )}
    </form>
  );
}
