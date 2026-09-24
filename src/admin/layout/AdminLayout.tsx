import { ExternalLink, Languages, LogOut, Menu, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, Outlet } from 'react-router';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { resolveLocalized } from '@/domain/localized';
import { useAccess, useAuth } from '@/features/auth/context';
import { DemoModeBanner } from '@/features/data-mode/DemoModeBanner';
import { useSettings } from '@/features/settings/context';
import { otherLocale } from '@/i18n/config';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { SkipLink } from '@/storefront/layout/SkipLink';
import { useSetAdminLocale } from '../AdminLocaleContext';
import { useAdminI18n } from '../i18n/context';
import { AdminNav } from './AdminNav';
import styles from './AdminLayout.module.css';

export function AdminLayout() {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { signOut } = useAuth();
  const { access } = useAccess();
  const { mode } = useRuntime();
  const setLocale = useSetAdminLocale();
  const [navOpen, setNavOpen] = useState(false);
  const drawerTitleId = useId();
  const primaryRole = access?.roles[0];

  return (
    <div className={styles.shell}>
      <SkipLink targetId="admin-main" />
      <DemoModeBanner />
      <div className={styles.frame}>
        <aside className={styles.sidebar}>
          <SidebarHead />
          <AdminNav />
        </aside>

        <div className={styles.column}>
          <header className={styles.topbar}>
            <button
              type="button"
              className={styles.menuButton}
              aria-label={at('shell.openNav')}
              aria-haspopup="dialog"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Menu aria-hidden="true" />
            </button>
            <span className={styles.mobileBrand}>
              <BrandLogo size="sm" decorative />
            </span>

            <div className={styles.topActions}>
              {mode === 'demo' && primaryRole && (
                <Badge tone="warning">
                  {at('shell.demoRole', { role: resolveLocalized(primaryRole.name, locale) })}
                </Badge>
              )}
              <button
                type="button"
                className={styles.topButton}
                onClick={() => setLocale(otherLocale(locale))}
                aria-label={at('shell.switchLanguageLabel')}
                lang={locale === 'ar' ? 'en' : 'ar'}
              >
                <Languages aria-hidden="true" />
                {at('shell.switchLanguage')}
              </button>
              <Link to="/" className={styles.topButton} target="_blank" rel="noopener">
                <ExternalLink aria-hidden="true" />
                <span className={styles.hideSmall}>{at('shell.viewSite')}</span>
              </Link>
              <button type="button" className={styles.topButton} onClick={() => void signOut()}>
                <LogOut aria-hidden="true" />
                <span className={styles.hideSmall}>{at('shell.signOut')}</span>
              </button>
            </div>
          </header>

          <main id="admin-main" tabIndex={-1} className={styles.main}>
            <Outlet />
          </main>
        </div>
      </div>

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        labelledBy={drawerTitleId}
        side="start"
      >
        <div className={styles.drawerHead}>
          <h2 id={drawerTitleId} className={styles.drawerTitle}>
            {at('shell.title')}
          </h2>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setNavOpen(false)}
            aria-label={at('shell.closeNav')}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <AdminNav onNavigate={() => setNavOpen(false)} />
      </Drawer>
    </div>
  );
}

function SidebarHead() {
  const { at } = useAdminI18n();
  const { brand } = useSettings();
  return (
    <div className={styles.sideHead}>
      <BrandLogo size="sm" decorative />
      <div className={styles.sideTitle}>
        <strong>{brand.name}</strong>
        <span>{at('shell.title')}</span>
      </div>
    </div>
  );
}
