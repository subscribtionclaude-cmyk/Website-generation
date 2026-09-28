import { ExternalLink, Phone } from 'lucide-react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { resolveLocalized } from '@/domain/localized';
import type { SocialSettings } from '@/domain/settings/schemas';
import { useSettings } from '@/features/settings/context';
import { OpeningHoursList } from '@/features/store-info/OpeningHoursList';
import { OpenStatus } from '@/features/store-info/OpenStatus';
import { useI18n } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { toTelHref } from '@/lib/phone';
import { getZonedParts } from '@/lib/time/zoned';
import styles from './SiteFooter.module.css';

const SOCIAL_KEYS = [
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
] as const satisfies readonly (keyof SocialSettings)[];

export function SiteFooter() {
  const { brand, navigation, store, social, legal } = useSettings();
  const { t, locale } = useI18n();
  // Footer presentation from the Site Editor (absent = the original footer).
  const footer = navigation.footer;
  const links = [
    ...navigation.primary.filter((item) => item.visible && item.href !== '/'),
    ...(footer?.links.filter((item) => item.visible) ?? []),
  ];
  const showServices = footer?.showServices ?? true;
  const showHours = footer?.showHours ?? true;
  const showSocial = footer?.showSocial ?? true;
  const socialLinks = SOCIAL_KEYS.flatMap((key) => {
    const url = social[key];
    return url ? [{ key, url }] : [];
  });
  const year = getZonedParts(new Date()).year;
  // Only policies with a published body are linked (never an empty "terms" page).
  const policies = Object.entries(legal.pages).filter(([, page]) => page.body);

  return (
    <footer className={`${styles.footer} print-hidden`}>
      <div className="container">
        <div className={styles.grid}>
          <div className={styles.brandCol}>
            <BrandLogo size="lg" tile decorative />
            <p className={styles.brandName} dir="ltr">
              {brand.name}
            </p>
            <p className={styles.tagline}>{resolveLocalized(brand.tagline, locale)}</p>
          </div>

          <nav aria-labelledby="footer-explore">
            <h2 id="footer-explore" className={styles.colTitle}>
              {t('footer.explore')}
            </h2>
            <ul className={styles.list}>
              {links.map((item) => (
                <li key={item.id}>
                  <LocaleLink to={item.href} className={styles.link}>
                    {resolveLocalized(item.label, locale)}
                  </LocaleLink>
                </li>
              ))}
              {showServices && (
                <>
                  <li>
                    <LocaleLink to="/services" className={styles.link}>
                      {t('footer.services')}
                    </LocaleLink>
                  </li>
                  <li>
                    <LocaleLink to="/after-sales" className={styles.link}>
                      {t('footer.afterSales')}
                    </LocaleLink>
                  </li>
                </>
              )}
            </ul>
          </nav>

          <section aria-labelledby="footer-visit">
            <h2 id="footer-visit" className={styles.colTitle}>
              {t('footer.visit')}
            </h2>
            {store.branches.map((branch) => (
              <div key={branch.id}>
                <address className={styles.address}>
                  <strong>{resolveLocalized(branch.name, locale)}</strong>
                  <span>{resolveLocalized(branch.address, locale)}</span>
                  {branch.landmark && <span>{resolveLocalized(branch.landmark, locale)}</span>}
                  <span>{resolveLocalized(branch.city, locale)}</span>
                </address>
                {showHours && (
                  <div className={styles.hours}>
                    <OpenStatus rules={branch.openingHours} onDark />
                    <OpeningHoursList rules={branch.openingHours} />
                    <p className={styles.tzNote}>{t('store.timeZoneNote')}</p>
                  </div>
                )}
              </div>
            ))}
          </section>

          <div>
            <section aria-labelledby="footer-call">
              <h2 id="footer-call" className={styles.colTitle}>
                {t('footer.call')}
              </h2>
              <ul className={styles.list}>
                {store.branches.flatMap((branch) =>
                  branch.phones.map((phone) => {
                    const href = toTelHref(phone);
                    return href ? (
                      <li key={`${branch.id}-${phone}`}>
                        <a
                          className={styles.link}
                          href={href}
                          aria-label={t('store.callNumber', { number: phone })}
                        >
                          <Phone aria-hidden="true" />
                          <bdi className="num">{phone}</bdi>
                        </a>
                      </li>
                    ) : null;
                  }),
                )}
              </ul>
            </section>

            {showSocial && socialLinks.length > 0 && (
              <section
                aria-labelledby="footer-follow"
                style={{ marginBlockStart: 'var(--space-8)' }}
              >
                <h2 id="footer-follow" className={styles.colTitle}>
                  {t('footer.follow')}
                </h2>
                <ul className={styles.list}>
                  {socialLinks.map(({ key, url }) => (
                    <li key={key}>
                      <LocaleLink to={url} className={styles.link}>
                        <ExternalLink aria-hidden="true" />
                        {t(`footer.social.${key}`)}
                      </LocaleLink>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <div className={styles.bottom}>
          <p>{t('footer.rights', { year, brand: isolate(brand.name) })}</p>
          {footer?.note && <p>{resolveLocalized(footer.note, locale)}</p>}
          {policies.length > 0 && (
            <nav aria-label={t('footer.policies')}>
              <ul className={styles.policies}>
                {policies.map(([key, page]) => (
                  <li key={key}>
                    <LocaleLink to={`/legal/${key.replace(/_/g, '-')}`} className={styles.link}>
                      {resolveLocalized(page.title, locale)}
                    </LocaleLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    </footer>
  );
}
