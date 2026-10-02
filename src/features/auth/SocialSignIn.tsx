import '@/i18n/messages/integrations';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import type { SocialProvider } from '@/services/auth/types';
import { useAuth } from './context';
import styles from './SignInForm.module.css';

/**
 * Optional "Continue with Google / Apple" (Phase 09), shown only for providers the owner enabled.
 * OAuth secrets live in Supabase Auth; identity linking is Supabase's — never a custom merge.
 * Demo mode has no real provider, so it says so instead of pretending.
 */
export function SocialSignIn({
  providers,
  returnPath,
}: {
  providers: SocialProvider[];
  returnPath: string;
}) {
  const { t } = useI18n();
  const { service } = useAuth();
  const { config } = useRuntime();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  async function start(provider: SocialProvider) {
    setMessage(null);
    if (!service.signInWithProvider) {
      setMessage({ tone: 'info', text: t('integrations.socialAuth.demo') });
      return;
    }
    setPending(provider);
    try {
      const origin = config.siteUrl ?? window.location.origin;
      await service.signInWithProvider(provider, `${origin}${returnPath}`);
    } catch {
      setMessage({ tone: 'danger', text: t('integrations.socialAuth.error') });
      setPending(null);
    }
  }

  return (
    <div className={styles.social} data-testid="social-sign-in">
      <p className={styles.divider}>
        <span>{t('integrations.socialAuth.divider')}</span>
      </p>
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          block
          loading={pending === provider}
          disabled={pending !== null}
          onClick={() => void start(provider)}
        >
          {t(`integrations.socialAuth.${provider}`)}
        </Button>
      ))}
      <p className={styles.socialNote}>{t('integrations.socialAuth.privacy')}</p>
      {message && (
        <Alert tone={message.tone} live>
          {message.text}
        </Alert>
      )}
    </div>
  );
}
