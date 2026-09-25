import { LocaleNavLink } from '@/components/navigation/LocaleLink';
import { NavIcon } from '@/components/navigation/navIcons';
import { resolveLocalized } from '@/domain/localized';
import { useCart } from '@/features/cart/context';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import styles from './MobileTabBar.module.css';

/** App-like bottom navigation on phones (Home, Shop, Offers, Cart, Account — admin-configurable). */
export function MobileTabBar() {
  const { navigation } = useSettings();
  const { t, locale } = useI18n();
  const { count } = useCart();
  const items = navigation.mobileTabBar.filter((item) => item.visible && item.href.startsWith('/'));
  if (items.length === 0) return null;

  return (
    <nav className={styles.bar} aria-label={t('common.mobileNavigation')}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <LocaleNavLink to={item.href} className={styles.item}>
              <span className={styles.iconWrap}>
                <NavIcon icon={item.icon} />
                {item.href === '/cart' && count > 0 && (
                  <span className={styles.badge} aria-hidden="true">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              <span>
                {resolveLocalized(item.label, locale)}
                {item.href === '/cart' && count > 0 && (
                  <span className="visually-hidden"> ({t('cart.itemCount', { count })})</span>
                )}
              </span>
            </LocaleNavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
