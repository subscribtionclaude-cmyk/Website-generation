import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useI18n } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import { useAuth } from './context';

/**
 * Gate for account-linked features (checkout, account, service requests).
 * Browsing routes never use this — the public site never depends on login.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { locale } = useI18n();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        className="container"
        style={{ display: 'grid', gap: 'var(--space-3)', paddingBlock: 'var(--space-12)' }}
      >
        <Skeleton width="40%" height="2rem" />
        <Skeleton height="1rem" />
        <Skeleton width="70%" height="1rem" />
      </div>
    );
  }

  if (state.status === 'signed_out') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${localizePath('/account/sign-in', locale)}?next=${next}`} replace />;
  }

  return <>{children}</>;
}
