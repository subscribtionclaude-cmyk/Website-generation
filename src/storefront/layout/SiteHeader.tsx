import { Menu, ShoppingCart, UserRound } from 'lucide-react';
import { useState } from 'react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { LanguageSwitch } from '@/components/navigation/LanguageSwitch';
import { LocaleLink, LocaleNavLink } from '@/components/navigation/LocaleLink';
import { isExternalHref } from '@/i18n/paths';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { MobileMenu } from './MobileMenu';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const { navigation } = useSettings();
  const { t, locale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = navigation.primary.filter((item) => item.visible);

  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <LocaleLink to="/" className={styles.brandLink} aria-label={t('common.brandHome')}>
          <BrandLogo size="md" withWordmark />
        </LocaleLink>

        <div className={styles.actions}>
          <LanguageSwitch className={styles.action} />
          <LocaleLink
            to="/account"
            className={`${styles.iconAction} ${styles.desktopOnly}`}
            aria-label={t('common.account')}
          >
            <UserRound aria-hidden="true" />
          </LocaleLink>
          <LocaleLink
            to="/cart"
            className={`${styles.iconAction} ${styles.desktopOnly}`}
            aria-label={t('common.cart')}
          >
            <ShoppingCart aria-hidden="true" />
          </LocaleLink>
          <button
            type="button"
            className={styles.menuButton}
            aria-label={t('common.openMenu')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className={styles.nav} aria-label={t('common.mainNavigation')}>
        <ul className={`container ${styles.navList}`}>
          {items.map((item) => {
            const className = [styles.navLink, item.highlight && styles.highlight]
              .filter(Boolean)
              .join(' ');
            const label = resolveLocalized(item.label, locale);
            return (
              <li key={item.id}>
                {isExternalHref(item.href) ? (
                  <LocaleLink to={item.href} className={className}>
                    {label}
                  </LocaleLink>
                ) : (
                  <LocaleNavLink to={item.href} className={className}>
                    {label}
                  </LocaleNavLink>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
