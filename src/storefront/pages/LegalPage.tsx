import { useParams } from 'react-router';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { resolveLocalized } from '@/domain/localized';
import { LEGAL_PAGE_KEYS, type LegalPageKey } from '@/domain/settings/schemas';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { NotFoundPage } from './NotFoundPage';
import styles from './contentPages.module.css';

/** URL slug ("trade-in") ↔ setting key ("trade_in"). */
const legalSlug = (key: LegalPageKey) => key.replace(/_/g, '-');

/**
 * Policy pages published from Admin → Legal pages (draft → publish → versions). A page without a
 * published body says so honestly instead of showing invented terms.
 */
export function LegalPage() {
  const { page = '' } = useParams();
  const key = LEGAL_PAGE_KEYS.find((k) => legalSlug(k) === page);
  return key ? <LegalContent pageKey={key} /> : <NotFoundPage />;
}

function LegalContent({ pageKey }: { pageKey: LegalPageKey }) {
  const { t, locale, format } = useI18n();
  const { legal } = useSettings();
  const doc = legal.pages[pageKey];
  const title = resolveLocalized(doc.title, locale);
  const body = doc.body ? resolveLocalized(doc.body, locale) : '';
  usePageMeta({ title, noIndex: !body });
  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs items={[{ label: t('common.home'), href: '/' }, { label: title }]} />
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {body && doc.updatedAt && (
          <p className={styles.subtitle}>
            {t('legal.updated', { date: format.date(`${doc.updatedAt}T12:00:00Z`) })}
          </p>
        )}
      </header>
      {body ? (
        <div className={styles.prose}>
          {body
            .split(/\n\s*\n/)
            .filter((p) => p.trim())
            .map((paragraph, i) => (
              <p key={i} style={{ whiteSpace: 'pre-line' }}>
                {paragraph.trim()}
              </p>
            ))}
        </div>
      ) : (
        <p className={styles.note}>
          {t('legal.notPublished')} <LocaleLink to="/contact">{t('contact.title')}</LocaleLink>
        </p>
      )}
    </div>
  );
}
