import { Eye } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button } from '@/components/ui/Button';
import { resolveLocalized } from '@/domain/localized';
import { SYSTEM_ROLES } from '@/domain/access/permissions';
import { useAuth } from '@/features/auth/context';
import { safeNextPath } from '@/features/auth/safeRedirect';
import { SignInForm } from '@/features/auth/SignInForm';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../i18n/context';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from '../admin.module.css';

export function AdminSignInPage() {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { state, service } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), '/admin');
  const [demoRole, setDemoRole] = useState('owner');
  const [pending, setPending] = useState(false);
  useAdminPageMeta(at('signIn.title'));

  if (state.status === 'signed_in' && !service.demo) return <Navigate to={next} replace />;

  const demo = service.demo;

  return (
    <div className={styles.signInWrap}>
      <div className={styles.signInCard}>
        <BrandLogo size="md" withWordmark />
        <SignInForm returnPath={next} onSignedIn={() => navigate(next, { replace: true })} />

        {demo && (
          <>
            <div className={styles.divider}>{at('signIn.or')}</div>
            <section className={styles.stack} aria-labelledby="demo-preview-title">
              <h2 id="demo-preview-title" className={styles.sectionTitle}>
                {at('signIn.demoTitle')}
              </h2>
              <p className={styles.muted}>{at('signIn.demoBody')}</p>
              <label className={styles.label} htmlFor="demo-role">
                {at('signIn.demoRoleLabel')}
              </label>
              <select
                id="demo-role"
                className={styles.select}
                value={demoRole}
                onChange={(event) => setDemoRole(event.target.value)}
              >
                {SYSTEM_ROLES.map((role) => (
                  <option key={role.key} value={role.key}>
                    {resolveLocalized(role.name, locale)}
                  </option>
                ))}
              </select>
              <Button
                variant="accent"
                size="lg"
                block
                loading={pending}
                icon={<Eye aria-hidden="true" />}
                onClick={async () => {
                  setPending(true);
                  await demo.signInAsRole(demoRole);
                  navigate(next, { replace: true });
                }}
              >
                {at('signIn.demoEnter')}
              </Button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
