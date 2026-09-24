import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useAccess } from '@/features/auth/context';
import { useAdminI18n } from './i18n/context';
import type { AdminModule } from './modules';

/** Per-module permission gate inside the admin shell. */
export function RequireModule({ module, children }: { module: AdminModule; children: ReactNode }) {
  const { can } = useAccess();
  const { at } = useAdminI18n();
  if (!can(module.permission)) {
    return (
      <StateMessage
        headingLevel={1}
        icon={<ShieldAlert />}
        title={at('denied.moduleTitle')}
        body={at('denied.moduleBody')}
        actions={
          <Link to="/admin" className={buttonClassName({ variant: 'primary' })}>
            {at('planned.back')}
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
