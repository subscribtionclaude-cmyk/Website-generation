import { Menu, Search, ShoppingCart, UserRound } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { LanguageSwitch } from '@/components/navigation/LanguageSwitch';
import { LocaleLink, LocaleNavLink } from '@/components/navigation/LocaleLink';
import { isExternalHref, localizePath, parseLocalePath } from '@/i18n/paths';
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

        <HeaderSearch />

        <div className={styles.actions}>
          <LocaleLink
            to="/search"
            className={`${styles.iconAction} ${styles.searchLink}`}
            aria-label={t('search.open')}
          >
            <Search aria-hidden="true" />
          </LocaleLink>
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

/** Desktop search (≥1024px). Smaller screens use the search icon → /search page. */
function HeaderSearch() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const id = useId();
  const [value, setValue] = useState('');
  const onSearchPage = parseLocalePath(location.pathname).path === '/search';
  if (onSearchPage) return <div className={styles.searchSpacer} />;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    if (!q) return;
    void navigate(localizePath(`/search?q=${encodeURIComponent(q)}`, locale));
    setValue('');
  };
  return (
    <form role="search" className={styles.search} onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        {t('search.label')}
      </label>
      <Search className={styles.searchIcon} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className={styles.searchInput}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="search"
        maxLength={80}
      />
    </form>
  );
}
