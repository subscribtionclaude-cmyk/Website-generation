import { NavLink } from 'react-router';
import { useAccess } from '@/features/auth/context';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import { ADMIN_MODULES, ADMIN_NAV_GROUPS, adminHref } from '../modules';
import styles from './AdminLayout.module.css';

/** Sidebar navigation: only modules the user's role can open are listed. */
export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { at } = useAdminI18n();
  const { can } = useAccess();

  return (
    <nav className={styles.nav} aria-label={at('shell.navLabel')}>
      {ADMIN_NAV_GROUPS.map((group) => {
        const modules = ADMIN_MODULES.filter(
          (module) => module.group === group && can(module.permission),
        );
        if (modules.length === 0) return null;
        return (
          <div key={group}>
            <h2 className={styles.groupTitle}>{at(`groups.${group}` as AdminMessageKey)}</h2>
            <ul className={styles.list}>
              {modules.map((module) => {
                const Icon = module.icon;
                return (
                  <li key={module.id}>
                    <NavLink
                      to={adminHref(module)}
                      end={module.path === ''}
                      className={styles.link}
                      onClick={onNavigate}
                    >
                      <Icon aria-hidden="true" />
                      <span className={styles.linkLabel}>
                        {at(`modules.${module.id}.title` as AdminMessageKey)}
                      </span>
                      {module.plannedPhase !== null && (
                        <span className={styles.phase}>
                          {at('shell.planned', {
                            phase: String(module.plannedPhase).padStart(2, '0'),
                          })}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
