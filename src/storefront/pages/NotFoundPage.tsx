import { House, ShoppingBag } from 'lucide-react';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import styles from './pages.module.css';

export function NotFoundPage() {
  const { t } = useI18n();
  usePageMeta({ title: t('errors.notFoundTitle'), noIndex: true });
  return (
    <div className={`container ${styles.page}`}>
      <div
        className={styles.narrow}
        style={{
          display: 'grid',
          gap: 'var(--space-4)',
          textAlign: 'center',
          justifyItems: 'center',
        }}
      >
        <p className={styles.bigCode} aria-hidden="true">
          404
        </p>
        <h1>{t('errors.notFoundTitle')}</h1>
        <p className={styles.muted}>{t('errors.notFoundBody')}</p>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <ButtonLink to="/" variant="primary" icon={<House aria-hidden="true" />}>
            {t('common.backHome')}
          </ButtonLink>
          <ButtonLink to="/store" variant="secondary" icon={<ShoppingBag aria-hidden="true" />}>
            {t('common.backToStore')}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
