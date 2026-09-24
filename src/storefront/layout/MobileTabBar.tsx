import { LocaleNavLink } from '@/components/navigation/LocaleLink';
import { NavIcon } from '@/components/navigation/navIcons';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import styles from './MobileTabBar.module.css';

/** App-like bottom navigation on phones (Home, Shop, Offers, Cart, Account — admin-configurable). */
export function MobileTabBar() {
  const { navigation } = useSettings();
  const { t, locale } = useI18n();
  const items = navigation.mobileTabBar.filter((item) => item.visible && item.href.startsWith('/'));
  if (items.length === 0) return null;

  return (
    <nav className={styles.bar} aria-label={t('common.mobileNavigation')}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <LocaleNavLink to={item.href} className={styles.item}>
              <NavIcon icon={item.icon} />
              <span>{resolveLocalized(item.label, locale)}</span>
            </LocaleNavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
