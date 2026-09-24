import { ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/features/auth/context';
import { safeNextPath } from '@/features/auth/safeRedirect';
import { SignInForm } from '@/features/auth/SignInForm';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import styles from './pages.module.css';

export function SignInPage() {
  const { t, locale } = useI18n();
  const { state } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), localizePath('/account', locale));
  usePageMeta({ title: t('auth.signInTitle'), noIndex: true });

  if (state.status === 'signed_in') return <Navigate to={next} replace />;

  return (
    <div className={`container ${styles.authLayout}`}>
      <div className={styles.authCard}>
        <SignInForm returnPath={next} onSignedIn={() => navigate(next, { replace: true })} />
      </div>
      <aside className={styles.aside}>
        <h2 className={styles.asideTitle}>
          <ShieldCheck aria-hidden="true" />
          {t('auth.whyTitle')}
        </h2>
        <p className={styles.asideBody}>{t('auth.whyBody')}</p>
      </aside>
    </div>
  );
}
