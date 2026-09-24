import { ChevronRight, Phone, UserRound, X } from 'lucide-react';
import { useId } from 'react';
import { LanguageSwitch } from '@/components/navigation/LanguageSwitch';
import { LocaleLink, LocaleNavLink } from '@/components/navigation/LocaleLink';
import { NavIcon } from '@/components/navigation/navIcons';
import { Drawer } from '@/components/ui/Drawer';
import { resolveLocalized } from '@/domain/localized';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { isExternalHref } from '@/i18n/paths';
import { toTelHref } from '@/lib/phone';
import styles from './MobileMenu.module.css';

/** Mobile/tablet navigation drawer. Trade-In and Repairs (highlighted items) get prominent tiles. */
export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigation, store } = useSettings();
  const { t, locale } = useI18n();
  const titleId = useId();
  const items = navigation.primary.filter((item) => item.visible);
  const highlighted = items.filter((item) => item.highlight);
  const branch = store.branches[0];

  return (
    <Drawer open={open} onClose={onClose} labelledBy={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {t('common.menu')}
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={t('common.closeMenu')}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <div className={styles.body}>
        {highlighted.length > 0 && (
          <ul className={styles.tiles}>
            {highlighted.map((item) => (
              <li key={item.id}>
                <LocaleLink to={item.href} className={styles.tile} onClick={onClose}>
                  <NavIcon icon={item.icon} />
                  {resolveLocalized(item.label, locale)}
                </LocaleLink>
              </li>
            ))}
          </ul>
        )}

        <nav aria-label={t('common.mainNavigation')}>
          <ul className={styles.list}>
            {items.map((item) => {
              const content = (
                <>
                  <NavIcon icon={item.icon} />
                  <span>{resolveLocalized(item.label, locale)}</span>
                  <ChevronRight className={`${styles.chevron} flip-rtl`} aria-hidden="true" />
                </>
              );
              return (
                <li key={item.id}>
                  {isExternalHref(item.href) ? (
                    <LocaleLink to={item.href} className={styles.link} onClick={onClose}>
                      {content}
                    </LocaleLink>
                  ) : (
                    <LocaleNavLink to={item.href} className={styles.link} onClick={onClose}>
                      {content}
                    </LocaleNavLink>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.utility}>
          <LanguageSwitch className={styles.utilityLink} />
          <LocaleLink to="/account" className={styles.utilityLink} onClick={onClose}>
            <UserRound aria-hidden="true" />
            {t('common.account')}
          </LocaleLink>
        </div>

        {branch && (
          <section className={styles.contact} aria-labelledby={`${titleId}-contact`}>
            <h3 id={`${titleId}-contact`} className={styles.contactTitle}>
              {resolveLocalized(branch.name, locale)}
            </h3>
            <OpenStatus rules={branch.openingHours} />
            {branch.phones.map((phone) => {
              const href = toTelHref(phone);
              return href ? (
                <a key={phone} href={href} className={`${styles.utilityLink} ${styles.phone}`}>
                  <Phone aria-hidden="true" />
                  <bdi className="num">{phone}</bdi>
                </a>
              ) : null;
            })}
          </section>
        )}
      </div>
    </Drawer>
  );
}
