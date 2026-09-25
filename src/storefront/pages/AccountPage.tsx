import { LayoutDashboard, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useAccess, useAuth } from '@/features/auth/context';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { MyOrders } from '../commerce/MyOrders';
import styles from './pages.module.css';

export function AccountPage() {
  return (
    <RequireAuth>
      <AccountContent />
    </RequireAuth>
  );
}

function AccountContent() {
  const { t } = useI18n();
  const { state, signOut } = useAuth();
  const { isStaff } = useAccess();
  usePageMeta({ title: t('account.title'), noIndex: true });
  const email = state.status === 'signed_in' ? state.session.email : null;

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.accountHead}>
        <div>
          <h1 className={styles.accountTitle}>{t('account.title')}</h1>
          {email && (
            <p className={styles.muted}>{t('auth.signedInAs', { email: isolate(email) })}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {isStaff && (
            <Link to="/admin" className={buttonClassName({ variant: 'secondary' })}>
              <LayoutDashboard aria-hidden="true" />
              {t('account.adminLink')}
            </Link>
          )}
          <Button
            variant="ghost"
            icon={<LogOut aria-hidden="true" />}
            onClick={() => void signOut()}
          >
            {t('common.signOut')}
          </Button>
        </div>
      </div>

      <section className={styles.panel} aria-labelledby="account-orders">
        <h2 id="account-orders" className={styles.panelTitle}>
          {t('account.ordersTitle')}
        </h2>
        <MyOrders />
      </section>
    </div>
  );
}
