import { useI18n } from '@/i18n/context';
import styles from './StorefrontLayout.module.css';

export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  const { t } = useI18n();
  return (
    <a className={`${styles.skipLink} print-hidden`} href={`#${targetId}`}>
      {t('common.skipToContent')}
    </a>
  );
}
