import { Mail, MessageCircle, Settings2 } from 'lucide-react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useAccess } from '@/features/auth/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { useIsDemoMode } from '@/runtime/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { TrustList } from '../components/TrustList';
import { BranchCard } from '../sections/InfoSections';
import styles from './contentPages.module.css';

const SOCIAL_KEYS = ['instagram', 'facebook', 'tiktok', 'telegram'] as const;

/**
 * Contact page — every channel comes from settings. Unconfigured channels (WhatsApp, maps,
 * social) are simply absent for customers; staff and demo previews see what is left to configure.
 */
export function ContactPage() {
  const { t } = useI18n();
  const { store, social, trust } = useSettings();
  const { isStaff } = useAccess();
  const isDemo = useIsDemoMode();
  usePageMeta({ title: t('contact.title'), description: t('contact.subtitle') });

  const whatsapp = buildWhatsAppLink(store.whatsappNumber, t('whatsapp.generalMessage'));
  const socials = SOCIAL_KEYS.flatMap((key) => (social[key] ? [{ key, url: social[key] }] : []));
  const missing: CoreMessageKey[] = [
    ...(whatsapp.status !== 'ok' ? (['contact.setupWhatsapp'] as const) : []),
    ...(store.branches.some((b) => !b.mapsUrl) ? (['contact.setupMaps'] as const) : []),
    ...(socials.length === 0 ? (['contact.setupSocial'] as const) : []),
  ];

  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs
        items={[{ label: t('common.home'), href: '/' }, { label: t('contact.title') }]}
      />
      <header className={styles.head}>
        <h1 className={styles.title}>{t('contact.title')}</h1>
        <p className={styles.subtitle}>{t('contact.subtitle')}</p>
      </header>
      <div className={styles.contactGrid}>
        <BranchCard headingLevel={2} />
        <div className={styles.channels}>
          <h2 className={styles.channelsTitle}>{t('contact.channels')}</h2>
          {whatsapp.status === 'ok' && (
            <a
              href={whatsapp.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName({ variant: 'accent', size: 'lg', block: true })}
            >
              <MessageCircle aria-hidden="true" />
              {t('contact.whatsapp')}
              <span className="visually-hidden"> {t('common.externalLink')}</span>
            </a>
          )}
          {store.email && (
            <a
              href={`mailto:${store.email}`}
              className={buttonClassName({ variant: 'secondary', size: 'lg', block: true })}
            >
              <Mail aria-hidden="true" />
              {t('contact.email')}
            </a>
          )}
          {socials.length > 0 && (
            <>
              <h3 className={styles.note}>{t('contact.social')}</h3>
              <ul className={styles.socials}>
                {socials.map(({ key, url }) => (
                  <li key={key}>
                    <LocaleLink
                      to={url}
                      className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                    >
                      {t(`footer.social.${key}`)}
                    </LocaleLink>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(isStaff || isDemo) && missing.length > 0 && (
            <div className={styles.setup} role="note">
              <p>
                <Settings2 aria-hidden="true" width={16} height={16} />{' '}
                <strong>{t('contact.setupTitle')}</strong>
              </p>
              <ul>
                {missing.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
              <p className={styles.note}>{t('contact.setupHint')}</p>
            </div>
          )}
        </div>
      </div>
      {trust.items.some((i) => i.visible) && (
        <section className={styles.section} aria-labelledby="contact-trust">
          <h2 id="contact-trust" className="visually-hidden">
            {t('sections.trustTitle')}
          </h2>
          <TrustList items={trust.items.filter((i) => i.visible)} />
        </section>
      )}
    </div>
  );
}
