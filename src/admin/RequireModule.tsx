import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useAccess } from '@/features/auth/context';
import { useAdminI18n } from './i18n/context';
import { ADMIN_MODULES, type AdminModule } from './modules';

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

/** Same gate, looked up by module id (used by the lazily loaded Phase 06 routes). */
export function RequireModuleId({ id, children }: { id: string; children: ReactNode }) {
  const module = ADMIN_MODULES.find((m) => m.id === id);
  if (!module) throw new Error(`Unknown admin module: ${id}`);
  return <RequireModule module={module}>{children}</RequireModule>;
}
