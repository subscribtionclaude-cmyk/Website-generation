import { ShieldAlert } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useAccess, useAuth } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from './i18n/context';
import { AdminLayout } from './layout/AdminLayout';

/**
 * Admin gate: signed-in staff only. The UI check is for experience — every admin read/write is
 * authorised again in the database (RLS + permission-checking RPCs).
 */
export function AdminShell() {
  const { state, signOut } = useAuth();
  const access = useAccess();
  const location = useLocation();
  const { at } = useAdminI18n();
  const { t } = useI18n();

  if (state.status === 'loading' || access.status === 'loading') {
    return (
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          padding: 'var(--space-10)',
          maxWidth: 720,
          marginInline: 'auto',
        }}
      >
        <Skeleton width="30%" height="2rem" />
        <Skeleton height="6rem" radius="var(--radius-lg)" />
        <Skeleton height="6rem" radius="var(--radius-lg)" />
      </div>
    );
  }

  if (state.status === 'signed_out') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/admin/sign-in?next=${next}`} replace />;
  }

  if (access.status === 'error') {
    return (
      <StateMessage
        headingLevel={1}
        role="alert"
        icon={<ShieldAlert />}
        title={at('errors.accessFailed')}
        actions={
          <Button variant="primary" onClick={access.refetch}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  if (!access.isStaff) {
    return (
      <StateMessage
        headingLevel={1}
        icon={<ShieldAlert />}
        title={at('denied.title')}
        body={at('denied.body')}
        actions={
          <>
            <Link to="/" className={buttonClassName({ variant: 'primary' })}>
              {at('denied.backToSite')}
            </Link>
            <Button variant="secondary" onClick={() => void signOut()}>
              {t('common.signOut')}
            </Button>
          </>
        }
      />
    );
  }

  return <AdminLayout />;
}
