import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { Fragment } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PERMISSION_DEFINITIONS, PERMISSION_MODULES } from '@/domain/access/permissions';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from '../admin.module.css';

/** Read-only role × permission matrix (managing roles/users arrives in Phase 06). */
export function AdminRolesPage() {
  const { at } = useAdminI18n();
  const { locale, t } = useI18n();
  const { repositories } = useRuntime();
  useAdminPageMeta(at('roles.title'));
  const session = useSession();
  const roles = useQuery({
    queryKey: ['roles', session?.userId ?? null],
    queryFn: () => repositories.access.listRoles(),
  });

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{at('roles.title')}</h1>
        <p className={styles.pageSubtitle}>{at('roles.subtitle')}</p>
      </div>
      <div className={styles.stack}>
        <Alert tone="info">{at('roles.readOnlyNote')}</Alert>

        {roles.isPending && <Skeleton height="24rem" radius="var(--radius-lg)" />}
        {roles.isError && (
          <Alert
            tone="danger"
            live
            action={
              <Button size="sm" variant="secondary" onClick={() => void roles.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {at('errors.loadFailed')}
          </Alert>
        )}
        {roles.data && (
          <div
            className={styles.tableWrap}
            role="region"
            aria-label={at('roles.title')}
            // A scrollable region must be keyboard-focusable so the matrix can be scrolled without a mouse.
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption className="visually-hidden">{at('roles.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{at('roles.permission')}</th>
                  {roles.data.map((role) => (
                    <th key={role.key} scope="col">
                      <span className={styles.roleHead}>
                        {resolveLocalized(role.name, locale)}
                        <span className={styles.roleRank}>
                          {at('roles.rank', { rank: role.rank })}
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MODULES.map((module) => {
                  const permissions = PERMISSION_DEFINITIONS.filter((p) => p.module === module);
                  return (
                    <Fragment key={module}>
                      <tr className={styles.moduleRow}>
                        <th scope="colgroup" colSpan={roles.data.length + 1}>
                          {at(`permissionModules.${module}` as AdminMessageKey)}
                        </th>
                      </tr>
                      {permissions.map((permission) => (
                        <tr key={permission.key}>
                          <th scope="row">
                            {at(`permissions.${permission.key}` as AdminMessageKey)}{' '}
                            {permission.sensitive && (
                              <Badge tone="warning">{at('roles.sensitive')}</Badge>
                            )}
                            <span className={styles.permKey}>{permission.key}</span>
                          </th>
                          {roles.data.map((role) => {
                            const granted =
                              role.grantsAll || role.permissions.includes(permission.key);
                            return (
                              <td key={role.key} className={granted ? styles.yes : styles.no}>
                                {granted ? (
                                  <Check aria-hidden="true" />
                                ) : (
                                  <Minus aria-hidden="true" />
                                )}
                                <span className="visually-hidden">
                                  {granted ? at('roles.granted') : at('roles.notGranted')}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
