import { Apple } from 'lucide-react';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SectionPage } from '../sections/SectionRenderer';
import styles from './contentPages.module.css';

/** Apple landing page — section-driven (page key "apple"), editable in Phase 07. */
export function ApplePage() {
  const { t } = useI18n();
  usePageMeta({ title: t('apple.title'), description: t('apple.description') });
  return (
    <SectionPage
      pageKey="apple"
      headerAlways
      header={
        <div className={`container ${styles.pageIntro}`}>
          <Breadcrumbs items={[{ label: t('common.home'), href: '/' }, { label: 'Apple' }]} />
          <header className={styles.head}>
            <h1 className={styles.title}>{t('apple.title')}</h1>
            <p className={styles.subtitle}>{t('apple.description')}</p>
          </header>
        </div>
      }
      fallback={
        <div className="container">
          <StateMessage
            icon={<Apple />}
            headingLevel={1}
            title={t('apple.title')}
            body={t('catalog.loadError')}
            actions={
              <ButtonLink to="/brand/apple" variant="primary">
                {t('apple.browse')}
              </ButtonLink>
            }
          />
        </div>
      }
    />
  );
}
